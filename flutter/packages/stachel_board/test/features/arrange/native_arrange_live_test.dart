// P1 live: the web actions of „Auswahl & Anordnen“ against the real Stachel server in its sandbox – the app asks
// (`core.align`, `core.distribute`, `core.group`, `core.ungroup`, `tools.layerStep`, `tools.copyStyle`,
// `tools.pasteStyle`), the server runs the web code, the app and the web (`tools/web-peer.mts`) see the same result;
// lock/hide/link/tags go as plain updates and reach the web.
//
//   cd stachel && npm --prefix server run build
//   server\node_modules\.bin\tsx.cmd tools/sandbox.mts 8620 --seed
//   flutter test test/features/arrange/native_arrange_live_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8620
//
// Skipped without STACHEL_SANDBOX (or without the stachel repo for the web side).
@Tags(['live'])
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

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
      body: {'title': 'P1 live ${DateTime.now().toIso8601String()}'},
    );
    boardId = ((b! as Map)['board'] as Map)['id'] as String;
  });

  Future<BoardController> app() async {
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
    c.notices.listen((n) => printOnFailure('Hinweis ${n.kind}: ${n.error} ${n.message}'));
    return c;
  }

  Map<String, Object?> sticky(String id, double x, double y, [Map<String, Object?> extra = const {}]) => {
    'id': id,
    'type': 'sticky',
    'x': x,
    'y': y,
    'w': 100,
    'h': 100,
    'text': id,
    ...extra,
  };

  test(
    'Ausrichten, Verteilen, Gruppieren, Ebene, Format: Server rechnet mit dem Web-Code, Web sieht dasselbe',
    () async {
      final c = await app();
      addTearDown(c.dispose);
      final peer = await WebPeer.start();
      addTearDown(peer.close);
      await peer.cmd({'cmd': 'open', 'board': boardId});
      await c.start();
      await until(() => c.loaded && c.canEdit);
      for (final n in [
        'core.align',
        'core.distribute',
        'core.group',
        'core.ungroup',
        'tools.layerStep',
        'tools.copyStyle',
        'tools.pasteStyle',
      ]) {
        expect(c.canAct(n), isTrue, reason: n);
      }
      final p = 'p${BoardController.newActKey().substring(0, 6)}';
      c.apply([
        CreateOp([
          sticky('${p}a', 0, 0),
          sticky('${p}b', 300, 40),
          sticky('${p}c', 120, 220, {'color': '#c9e14a', 'fontSize': 32}),
        ]),
      ]);
      await until(() => !c.hasPending('${p}c'));
      final ids = ['${p}a', '${p}b', '${p}c'];

      // align top: everyone on y = 0
      var d = await c.act('core.align', {'ids': ids, 'mode': 'top'}).timeout(const Duration(seconds: 10));
      expect(d.ok, isTrue, reason: '${d.error} ${d.message}');
      await until(() => ids.every((id) => c.state[id]!.y == 0));
      await untilAsync(() async => (await peer.object('${p}c'))?['y'] == 0);

      // distribute horizontally: equal gaps, outer ones stay
      d = await c.act('core.distribute', {'ids': ids, 'axis': 'x'}).timeout(const Duration(seconds: 10));
      expect(d.ok, isTrue);
      await until(() => c.state['${p}c']!.x == 150);
      expect((c.state['${p}a']!.x, c.state['${p}b']!.x), (0.0, 300.0));

      // group: one groupId on all three (web sees it), then ungroup
      d = await c.act('core.group', {'ids': ids}).timeout(const Duration(seconds: 10));
      expect(d.result!.select, ids);
      await until(() => c.state['${p}a']!.groupId != null);
      final g = c.state['${p}a']!.groupId;
      expect(ids.map((id) => c.state[id]!.groupId), everyElement(g));
      await untilAsync(() async => (await peer.object('${p}b'))?['groupId'] == g);
      await c.act('core.ungroup', {'ids': ids}).timeout(const Duration(seconds: 10));
      await until(() => ids.every((id) => c.state[id]!.groupId == null));

      // layer: a overlaps nothing above after aligning? put c over a, then a one step forward
      c.apply([
        UpdateOp({
          '${p}c': {'x': 50},
        }),
      ]);
      await until(() => !c.hasPending('${p}c'));
      expect(c.state.orderOf('${p}a') < c.state.orderOf('${p}c'), isTrue);
      await c
          .act('tools.layerStep', {
            'ids': ['${p}a'],
            'dir': 1,
          })
          .timeout(const Duration(seconds: 10));
      await until(() => c.state.orderOf('${p}a') > c.state.orderOf('${p}c'));

      // format: copy c, paste on b
      final copy = await c.act('tools.copyStyle', {'id': '${p}c'}).timeout(const Duration(seconds: 10));
      expect(copy.result!.toast, 'Format kopiert.');
      final style = copy.result!.data! as Map;
      expect((style['fields'] as Map)['color'], '#c9e14a');
      await c
          .act('tools.pasteStyle', {
            'ids': ['${p}b'],
            'style': style,
          })
          .timeout(const Duration(seconds: 10));
      await until(() => c.state['${p}b']!.color == '#c9e14a' && c.state['${p}b']!.fontSize == 32);
      await untilAsync(() async => (await peer.object('${p}b'))?['color'] == '#c9e14a');

      // undo takes the format back (one step like the web)
      c.undo();
      await until(() => c.state['${p}b']!.color != '#c9e14a');
    },
    skip: liveSkip,
  );

  test('Sperren, Ausblenden, Link zu, Tags: Felder wie im Web', () async {
    final c = await app();
    addTearDown(c.dispose);
    final peer = await WebPeer.start();
    addTearDown(peer.close);
    await peer.cmd({'cmd': 'open', 'board': boardId});
    await c.start();
    await until(() => c.loaded && c.canEdit);
    final p = 'q${BoardController.newActKey().substring(0, 6)}';
    c.apply([
      CreateOp([sticky('${p}a', 0, 600), sticky('${p}b', 300, 600)]),
    ]);
    await until(() => !c.hasPending('${p}b'));
    c.apply([
      UpdateOp({
        '${p}a': {
          'locked': true,
          'linkTo': '${p}b',
          'tags': [
            {'label': 'Strom', 'color': '#1763b5'},
          ],
        },
        '${p}b': {'hidden': true},
      }),
    ]);
    await untilAsync(() async {
      final a = await peer.object('${p}a');
      final b = await peer.object('${p}b');
      return a?['locked'] == true && a?['linkTo'] == '${p}b' && b?['hidden'] == true && a?['tags'] is List;
    });
    expect(((await peer.object('${p}a'))!['tags']! as List).single, {'label': 'Strom', 'color': '#1763b5'});
  }, skip: liveSkip);
}
