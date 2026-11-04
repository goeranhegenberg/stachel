// Live test against the real Stachel server in its sandbox (contract §8, stachel/docs/native_fixtures/README.md):
//
//   cd stachel && npm --prefix server run build
//   server\node_modules\.bin\tsx.cmd tools/sandbox.mts 8600 --seed
//   flutter test test/native_live_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8600
//
// App session with a sandbox team token, board list, NativeBoardSource: welcome of „Alle Typen“ (every type renders
// natively, the snapshot is in paint order), ops create/update/remove → ack + own patch, the 5 000-object board.
// Skipped without STACHEL_SANDBOX.
@Tags(['live'])
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

const _sandbox = String.fromEnvironment('STACHEL_SANDBOX');

Future<Object?> _http(String method, String url, {String? bearer, Object? body, bool write = false}) async {
  final client = HttpClient();
  try {
    final req = await client.openUrl(method, Uri.parse(url));
    if (bearer != null) req.headers.set('Authorization', 'Bearer $bearer');
    if (write) req.headers.set('X-Stachel', '1');
    if (body != null) {
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode(body));
    }
    final res = await req.close();
    final text = await res.transform(utf8.decoder).join();
    if (res.statusCode >= 300) throw HttpException('$method $url → ${res.statusCode} $text');
    return jsonDecode(text);
  } finally {
    client.close();
  }
}

Future<void> _until(bool Function() cond, {Duration timeout = const Duration(seconds: 20)}) async {
  final sw = Stopwatch()..start();
  while (!cond()) {
    if (sw.elapsed > timeout) throw TimeoutException('condition not met');
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
}

void main() {
  late String token;
  late List<Map<String, Object?>> boards;
  var sessions = 0;

  Future<String> provider({bool fresh = false}) async {
    if (fresh || sessions == 0) {
      sessions++;
      final j = await _http('POST', '$_sandbox/api/auth/app-session', bearer: 'sandbox-mara', body: {}) as Map;
      token = j['token'] as String;
    }
    return token;
  }

  setUpAll(() async {
    if (_sandbox.isEmpty) return;
    await provider();
    final j = await _http('GET', '$_sandbox/api/boards', bearer: token) as Map;
    boards = (j['boards'] as List).cast<Map<String, Object?>>();
  });

  String boardId(String title) => boards.firstWhere((b) => b['title'] == title)['id'] as String;

  test('App-Sitzung und Board-Liste', () {
    expect(token, startsWith('sts_'));
    expect(boards.map((b) => b['title']), containsAll(['Alle Typen', 'Groß 2000', 'Groß 5000']));
  }, skip: _sandbox.isEmpty);

  test('welcome „Alle Typen“: alle Typen nativ, Reihenfolge wie der Server; Ops → ack + eigener Patch', () async {
    final source = NativeBoardSource(
      base: Uri.parse(_sandbox),
      board: boardId('Alle Typen'),
      token: provider,
      appVersion: '1.22.0+31',
    );
    final c = BoardController(source);
    final acks = <AckMessage>[];
    final patches = <PatchMessage>[];
    source.messages.listen((m) {
      if (m is AckMessage) acks.add(m);
      if (m is PatchMessage) patches.add(m);
    });
    await c.start();
    await _until(() => c.loaded);
    expect(source.connection.value, BoardConnection.live);
    final objects = c.state.ordered;
    expect(objects.length, greaterThan(60));
    expect({
      for (final o in objects)
        if (!o.isKnownType) o.type,
    }, everyElement(startsWith('future.')));
    expect(c.title, 'Alle Typen');
    expect(c.user!.key, 'a:mara');

    // ops: create, move, remove (own changes come back as patch with by = own key, then ack)
    const id = 'app_live_test_note';
    source.send(
      opsMessage(1, [
        const CreateOp([
          {
            'id': id,
            'type': 'sticky',
            'x': -400,
            'y': -400,
            'w': 200,
            'h': 200,
            'color': '#fff27a',
            'text': 'Aus der App',
          },
        ]),
      ]),
    );
    await _until(() => acks.any((a) => a.req == 1));
    expect(c.state[id]!.text, 'Aus der App');
    expect(patches.last.by, 'a:mara');
    source.send(
      opsMessage(2, [
        const UpdateOp({
          id: {'x': -300},
        }),
      ]),
    );
    await _until(() => acks.any((a) => a.req == 2));
    expect(c.state[id]!.x, -300);
    source.send(
      opsMessage(3, [
        const RemoveOp([id]),
      ]),
    );
    await _until(() => acks.any((a) => a.req == 3));
    expect(c.state[id], isNull);
    c.dispose();
  }, skip: _sandbox.isEmpty);

  test('Groß 5000: Schnappschuss laden und indexieren', () async {
    final sw = Stopwatch()..start();
    final source = NativeBoardSource(
      base: Uri.parse(_sandbox),
      board: boardId('Groß 5000'),
      token: provider,
      appVersion: '1.22.0+31',
    );
    final c = BoardController(source);
    await c.start();
    await _until(() => c.loaded);
    final loadMs = sw.elapsedMilliseconds;
    final scene = BoardScene(c.state)..sync();
    final indexMs = sw.elapsedMilliseconds - loadMs;
    expect(c.state.length, greaterThanOrEqualTo(5000));
    // ignore: avoid_print
    print(
      'LIVE Groß 5000: ${c.state.length} Objekte, welcome nach $loadMs ms, Index $indexMs ms, '
      'Grenzen ${scene.bounds}',
    );
    c.dispose();
  }, skip: _sandbox.isEmpty);
}
