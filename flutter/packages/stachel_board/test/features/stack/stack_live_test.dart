// Q2 live: note stacks against the real Stachel server in its sandbox – the app asks (`shapes.stackDrop`,
// `shapes.stackCycle`, `shapes.stackTake`, `shapes.stackSpread`), the server runs the web code, the web
// (`tools/web-peer.mts`) sees the same stack.
//
//   cd stachel && npm --prefix server run build
//   server\node_modules\.bin\tsx.cmd tools/sandbox.mts 8865 --seed
//   flutter test test/features/stack/stack_live_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8865
//     (--dart-define=STACHEL_REPO=<stachel> when the repo is not at ../../../stachel)
//
// Skipped without STACHEL_SANDBOX (or without the stachel repo for the web side).
@Tags(['live'])
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/stack/stack_model.dart';

import '../../live_support.dart';

void main() {
  late String boardId;
  final tokens = <String, String>{};

  Future<String> token(String who) async => tokens[who] ??=
      ((await liveHttp('POST', '$sandbox/api/auth/app-session', bearer: 'sandbox-$who', body: {}))! as Map)['token']
          as String;

  setUpAll(() async {
    if (liveSkip != null) return;
    final t = await token('mara');
    final b = await liveHttp(
      'POST',
      '$sandbox/api/boards',
      bearer: t,
      write: true,
      body: {'title': 'Q2 Stapel live ${DateTime.now().toIso8601String()}'},
    );
    boardId = ((b! as Map)['board'] as Map)['id'] as String;
  });

  test('Ablegen, Blättern, Abnehmen, Auffächern: Server rechnet mit dem Web-Code, Web sieht denselben Stapel', () async {
    final source = NativeBoardSource(
      base: Uri.parse(sandbox),
      board: boardId,
      token: ({bool fresh = false}) async {
        if (fresh) tokens.remove('mara');
        return token('mara');
      },
      appVersion: '1.25.0+1',
      retryDelays: const [Duration(milliseconds: 100)],
    );
    final c = BoardController(source, presenceInterval: const Duration(milliseconds: 30));
    addTearDown(c.dispose);
    c.notices.listen((n) => printOnFailure('Hinweis ${n.kind}: ${n.error} ${n.message}'));
    final peer = await WebPeer.start();
    addTearDown(peer.close);
    await peer.cmd({'cmd': 'open', 'board': boardId});
    await c.start();
    await until(() => c.loaded && c.canEdit);
    for (final n in ['shapes.stackDrop', 'shapes.stackCycle', 'shapes.stackSpread', 'shapes.stackTake']) {
      expect(c.canAct(n), isTrue, reason: n);
    }
    final p = 'q${BoardController.newActKey().substring(0, 6)}';
    Map<String, Object?> note(String id, double x) =>
        {'id': '$p$id', 'type': 'sticky', 'x': x, 'y': 0, 'w': 200, 'h': 200, 'text': id, 'color': '#fff27a'};
    c.apply([
      CreateOp([note('a', 0), note('b', 400), note('c', 800)]),
    ]);
    await until(() => !c.hasPending('${p}c'));

    // b and c dropped near the middle of a (the move, then the drop like the editor does it)
    for (final id in ['b', 'c']) {
      c.apply([
        UpdateOp({
          '$p$id': {'x': 14, 'y': 9},
        }),
      ]);
      final d = await c.act('shapes.stackDrop', {
        'ids': ['$p$id'],
        'grabbed': '$p$id',
      }).timeout(const Duration(seconds: 10));
      expect(d.ok, isTrue, reason: '${d.error} ${d.message}');
    }
    await until(() => stackOf(c.state['${p}a'], c.state).length == 3);
    expect([for (final o in stackOf(c.state['${p}a'], c.state)) o.id], ['${p}a', '${p}b', '${p}c']);
    expect((c.state['${p}c']!.x, c.state['${p}c']!.y), (0.0, 0.0));
    final g = c.state['${p}a']!.groupId;
    await untilAsync(() async {
      final w = await peer.object('${p}c');
      return w?['groupId'] == g && w?['stacked'] == true && w?['x'] == 0;
    });

    // leaf through: c goes down, b is on top
    var d = await c.act('shapes.stackCycle', {'id': '${p}a', 'dir': 1}).timeout(const Duration(seconds: 10));
    expect((d.result!.data! as Map)['top'], '${p}b');
    await until(() => stackOf(c.state['${p}a'], c.state).last.id == '${p}b');

    // take the top one (b) off: right next to the stack
    d = await c.act('shapes.stackTake', {'id': '${p}a'}).timeout(const Duration(seconds: 10));
    expect(d.result!.select, ['${p}b']);
    await until(() => c.state['${p}b']!.groupId == null && c.state['${p}b']!.x == 224);
    await untilAsync(() async => (await peer.object('${p}b'))?['x'] == 224);

    // spread the rest (a, c): grid from the corner, top first
    d = await c.act('shapes.stackSpread', {'id': '${p}a'}).timeout(const Duration(seconds: 10));
    expect(d.ok, isTrue);
    await until(() => allStacks(c.state).isEmpty);
    await untilAsync(() async => (await peer.object('${p}a'))?['groupId'] == null);
  }, skip: liveSkip);
}
