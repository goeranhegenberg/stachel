// F2 live: web actions (`act`, contract §8.12) against the real Stachel server in its sandbox – the sandbox enables the
// test action `dev.note` (STACHEL_NATIVE_DEV_ACTIONS=1): the app asks, the server runs the web code, the app selects /
// writes / shows the toast from `ack.results`, the web (`tools/web-peer.mts`) has the note, the same `key` runs once,
// an action asked for before the connection is up waits and goes out after `welcome`, an unknown action is refused,
// undo takes the note away again; presence.extra reaches the web as awareness.
//
//   cd stachel && npm --prefix server run build
//   server\node_modules\.bin\tsx.cmd tools/sandbox.mts 8600 --seed
//   flutter test test/native_act_live_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8600
//
// Skipped without STACHEL_SANDBOX (or without the stachel repo for the web side).
@Tags(['live'])
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import 'live_support.dart';

void main() {
  late String boardId;
  final tokens = <String, String>{};

  Future<String> token(String who) async => tokens[who] ??=
      ((await liveHttp('POST', '$sandbox/api/auth/app-session', bearer: 'sandbox-$who', body: {}))! as Map)['token'] as String;

  setUpAll(() async {
    if (liveSkip != null) return;
    final t = await token('mara');
    final b = await liveHttp('POST', '$sandbox/api/boards', bearer: t, write: true, body: {'title': 'F2 act live ${DateTime.now().toIso8601String()}'});
    boardId = ((b! as Map)['board'] as Map)['id'] as String;
  });

  Future<(NativeBoardSource, BoardController)> app() async {
    final source = NativeBoardSource(
      base: Uri.parse(sandbox),
      board: boardId,
      token: ({bool fresh = false}) async {
        if (fresh) tokens.remove('mara');
        return token('mara');
      },
      appVersion: '1.24.0+33',
      retryDelays: const [Duration(milliseconds: 100)],
    );
    final c = BoardController(source, presenceInterval: const Duration(milliseconds: 30));
    c.notices.listen((n) => printOnFailure('Hinweis ${n.kind}: ${n.error} ${n.message}'));
    return (source, c);
  }

  test('dev.note: Server führt den Web-Code aus, ack.results, Web hat die Notiz, gleiche key nur einmal, Rückgängig', () async {
    final (_, c) = await app();
    addTearDown(c.dispose);
    final peer = await WebPeer.start();
    addTearDown(peer.close);
    await peer.cmd({'cmd': 'open', 'board': boardId});
    await c.start();
    await until(() => c.loaded && c.canEdit);
    expect(c.features, contains('act'));
    expect(c.canAct('dev.note'), isTrue, reason: 'Sandbox: STACHEL_NATIVE_DEV_ACTIONS=1');
    expect(c.canAct('dev.note', 99), isFalse);

    final key = BoardController.newActKey();
    final d = await c.act('dev.note', {'x': 100, 'y': 50, 'text': 'Aus der App'}, key: key, label: 'Notiz').timeout(const Duration(seconds: 10));
    expect(d.ok, isTrue, reason: '${d.error} ${d.message}');
    expect(d.result!.select, ['$key-1']);
    expect(d.result!.edit, '$key-1');
    expect(d.result!.toast, 'Notiz angelegt.');
    final note = c.state['$key-1'];
    expect(note, isNotNull, reason: 'der Patch kam vor dem ack');
    expect(note!.type, 'sticky');
    expect(note.text, 'Aus der App');
    expect(c.runningActs, isEmpty);
    await untilAsync(() async => (await peer.object('$key-1')) != null);

    // the same key again (e.g. a repetition after a restart of the app): nothing twice, the remembered result
    final again = await c.act('dev.note', {'x': 100, 'y': 50, 'text': 'Aus der App'}, key: key).timeout(const Duration(seconds: 10));
    expect(again.ok, isTrue);
    expect(again.result?.select, ['$key-1']);
    expect(c.state.objects.values.where((o) => o.type == 'sticky').length, 1);

    // unknown action: refused, nothing written
    final bad = await c.act('nope.nothing', const {}).timeout(const Duration(seconds: 10));
    expect(bad.error, 'unsupported');

    // undo class `undo`: the note goes away again
    c.undo();
    await until(() => c.state['$key-1'] == null);
    await untilAsync(() async => (await peer.object('$key-1')) == null);
  }, skip: liveSkip);

  test('Aktion vor der Verbindung: wartet („sobald online“), geht nach welcome raus; presence.extra beim Web', () async {
    final (_, c) = await app();
    addTearDown(c.dispose);
    final peer = await WebPeer.start(login: 'jonas');
    addTearDown(peer.close);
    await peer.cmd({'cmd': 'open', 'board': boardId});
    final key = BoardController.newActKey();
    final done = c.act('dev.note', {'x': 400, 'y': 50}, key: key, label: 'Notiz');
    expect(c.runningActs.single.queued, isTrue);
    await c.start();
    final d = await done.timeout(const Duration(seconds: 10));
    expect(d.ok, isTrue, reason: '${d.error} ${d.message}');
    expect(c.state['$key-1'], isNotNull);
    await untilAsync(() async => (await peer.object('$key-1')) != null);

    c.presence.setExtra('collab.status', 'idle', immediate: true);
    await untilAsync(() async {
      final peers = (await peer.cmd({'cmd': 'peers'}))['peers'];
      return peers is List && peers.any((p) => p is Map && p['state'] is Map && (p['state'] as Map)['collab.status'] == 'idle');
    });
  }, skip: liveSkip);
}
