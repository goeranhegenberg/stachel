// WebSocket transport of the native API v1 (contract §8.4) against an in-process server: hello with token and resume,
// welcome/patch forwarded, ping, new token once on 4401, fatal closes, reconnect with resume after a drop or silence.
// The same source against the real Stachel sandbox: native_live_test.dart (tag `live`).
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

/// Minimal gateway: records hellos, answers with [onHello] (send / close).
class FakeGateway {
  late HttpServer server;
  final hellos = <Map<String, Object?>>[];
  final received = <Map<String, Object?>>[];
  final authHeaders = <String?>[];
  final sockets = <WebSocket>[];
  late void Function(WebSocket ws, Map<String, Object?> hello, int n) onHello;

  Future<Uri> start() async {
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((req) async {
      if (req.uri.path != '/native/v1') {
        req.response.statusCode = 404;
        await req.response.close();
        return;
      }
      authHeaders.add(req.headers.value('authorization'));
      final ws = await WebSocketTransformer.upgrade(req);
      sockets.add(ws);
      ws.listen((data) {
        final m = (jsonDecode(data as String) as Map).cast<String, Object?>();
        received.add(m);
        if (m['t'] == 'hello') {
          hellos.add(m);
          onHello(ws, m, hellos.length);
        }
      });
    });
    return Uri.parse('http://127.0.0.1:${server.port}');
  }

  Future<void> stop() => server.close(force: true);
}

Map<String, Object?> welcome({int rev = 10, String epoch = 'e1'}) => {
  't': 'welcome',
  'proto': 1,
  'epoch': epoch,
  'rev': rev,
  'board': {'id': 'b1', 'title': 'Test'},
  'role': 'edit',
  'below': ['frame'],
  'snapshot': {
    'objects': [
      {'id': 'n1', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'z': 'a', 'text': 'Hallo'},
    ],
  },
};

Future<void> until(bool Function() cond, {Duration timeout = const Duration(seconds: 5)}) async {
  final sw = Stopwatch()..start();
  while (!cond()) {
    if (sw.elapsed > timeout) throw TimeoutException('condition not met');
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}

void main() {
  late FakeGateway gw;
  late Uri base;
  final tokens = <bool>[];

  Future<String> tokenProvider({bool fresh = false}) async {
    tokens.add(fresh);
    return fresh ? 'sts_neu' : 'sts_alt';
  }

  NativeBoardSource source({Duration silence = const Duration(seconds: 25)}) => NativeBoardSource(
    base: base,
    board: 'b1',
    token: tokenProvider,
    appVersion: '1.22.0+31',
    pingEvery: const Duration(milliseconds: 40),
    silenceLimit: silence,
    retryDelays: const [Duration(milliseconds: 20)],
  );

  setUp(() async {
    tokens.clear();
    gw = FakeGateway();
    base = await gw.start();
  });

  tearDown(() => gw.stop());

  test('URL: https → wss, http → ws, Pfad /native/v1', () {
    expect(
      NativeBoardSource(
        base: Uri.parse('https://stachel.example.org'),
        board: 'b',
        token: tokenProvider,
        appVersion: '1',
      ).url,
      Uri.parse('wss://stachel.example.org/native/v1'),
    );
    expect(source().url.scheme, 'ws');
  });

  test('hello mit Token im Header, welcome/patch kommen an, Ping läuft, BoardController lädt', () async {
    gw.onHello = (ws, hello, n) {
      ws.add(jsonEncode(welcome()));
      ws.add(
        jsonEncode({
          't': 'patch',
          'rev': 11,
          'by': 'm:7',
          'changes': [
            {
              'id': 'n1',
              'set': {'x': 50},
            },
          ],
        }),
      );
    };
    final s = source();
    final c = BoardController(s);
    await c.start();
    await until(() => c.state.rev == 11);
    expect(gw.authHeaders.single, 'Bearer sts_alt');
    expect(gw.hellos.single, {
      't': 'hello',
      'proto': 1,
      'board': 'b1',
      'app': '1.22.0+31',
      'want': ['objects', 'ext'],
    });
    expect(s.connection.value, BoardConnection.live);
    expect(c.state['n1']!.x, 50);
    expect(c.title, 'Test');
    await until(() => gw.received.any((m) => m['t'] == 'ping'));
    s.send(presenceMessage(cursorX: 1, cursorY: 2));
    await until(() => gw.received.any((m) => m['t'] == 'presence'));
    c.dispose();
  });

  test('4401: einmal neues Token, neu verbinden mit resume; zweimal 4401 → zu (not_logged_in)', () async {
    gw.onHello = (ws, hello, n) {
      if (n == 1) {
        ws.add(jsonEncode(welcome()));
        Timer(const Duration(milliseconds: 30), () => ws.close(4401, 'not_logged_in'));
      } else if (n == 2) {
        ws.add(jsonEncode({'t': 'resumed', 'proto': 1, 'epoch': 'e1', 'rev': 12, 'patches': []}));
      }
    };
    final s = source();
    await s.open();
    await until(() => gw.hellos.length == 2 && s.connection.value == BoardConnection.live);
    expect(tokens, [false, true]);
    expect(gw.authHeaders.last, 'Bearer sts_neu');
    expect(gw.hellos.last['resume'], {'epoch': 'e1', 'rev': 10});
    await s.close();

    gw.onHello = (ws, hello, n) => ws.close(4401, 'not_logged_in');
    final s2 = source();
    await s2.open();
    await until(() => s2.connection.value == BoardConnection.closed);
    expect(s2.closeReason, 'not_logged_in');
  });

  test('Board im Papierkorb (4410) beendet ohne neuen Versuch', () async {
    gw.onHello = (ws, hello, n) {
      ws.add(jsonEncode({'t': 'error', 'error': 'board_deleted', 'message': 'Papierkorb'}));
      ws.close(4410, 'board_deleted');
    };
    final s = source();
    await s.open();
    await until(() => s.connection.value == BoardConnection.closed);
    expect(s.closeReason, 'board_deleted');
    await Future<void>.delayed(const Duration(milliseconds: 100));
    expect(gw.hellos, hasLength(1));
  });

  test('Verbindung weg (1001) → offline, neu verbinden mit resume', () async {
    gw.onHello = (ws, hello, n) {
      if (n == 1) {
        ws.add(jsonEncode(welcome(rev: 7)));
        ws.add(jsonEncode({'t': 'patch', 'rev': 8, 'changes': []}));
        Timer(const Duration(milliseconds: 40), () => ws.close(1001, 'server_restart'));
      } else {
        ws.add(jsonEncode(welcome(rev: 3, epoch: 'e2')));
      }
    };
    final s = source();
    final states = <BoardConnection>[];
    s.connection.addListener(() => states.add(s.connection.value));
    await s.open();
    await until(() => gw.hellos.length == 2 && s.connection.value == BoardConnection.live);
    expect(states, containsAllInOrder([BoardConnection.live, BoardConnection.offline, BoardConnection.live]));
    expect(gw.hellos.last['resume'], {'epoch': 'e1', 'rev': 8});
    expect(tokens, [false, false]);
    await s.close();
  });

  test('25 s Stille (hier verkürzt) → neu verbinden', () async {
    gw.onHello = (ws, hello, n) {
      if (n == 1) ws.add(jsonEncode(welcome()));
      // the server never answers pings → silence
    };
    final s = source(silence: const Duration(milliseconds: 150));
    await s.open();
    await until(() => gw.hellos.length >= 2);
    await s.close();
  });

  test('Token-Quelle sagt „Anmeldung weg“ → zu, ohne Verbindung', () async {
    final s = NativeBoardSource(
      base: base,
      board: 'b1',
      token: ({bool fresh = false}) async => stopNativeSource('invalid_token'),
      appVersion: '1',
    );
    await s.open();
    expect(s.connection.value, BoardConnection.closed);
    expect(s.closeReason, 'invalid_token');
    expect(gw.hellos, isEmpty);
  });
}
