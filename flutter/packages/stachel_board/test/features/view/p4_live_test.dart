// P4 live against the real Stachel server in its sandbox: board background (`tools.settings`, web action without undo)
// and frame list order (`frames.reorder`, one undo step) are computed by the server with the web's code – the web
// (`tools/web-peer.mts`) sees the same; a presentation (`structure.present`) reaches the web as awareness and the web's
// presentation reaches the app (follow).
//
//   cd stachel && npm --prefix server run build
//   server\node_modules\.bin\tsx.cmd tools/sandbox.mts 8650 --seed
//   flutter test test/features/view/p4_live_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8650
//
// Skipped without STACHEL_SANDBOX (or without the stachel repo for the web side).
@Tags(['live'])
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/frames/frames_model.dart';

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
      body: {'title': 'P4 live ${DateTime.now().toIso8601String()}'},
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
      appVersion: '1.24.0+33',
      retryDelays: const [Duration(milliseconds: 100)],
    );
    final c = BoardController(source, presenceInterval: const Duration(milliseconds: 30));
    c.notices.listen((n) => printOnFailure('Hinweis ${n.kind}: ${n.error} ${n.message}'));
    await c.start();
    await until(() => c.loaded && c.canEdit);
    return c;
  }

  test(
    'tools.settings: Web hat Muster und Farbe, App bekommt sie als ext, Raster aus/an merkt das Muster, kein Rückgängig',
    () async {
      final c = await app();
      addTearDown(c.dispose);
      final peer = await WebPeer.start();
      addTearDown(peer.close);
      await peer.cmd({'cmd': 'open', 'board': boardId});
      expect(c.canAct('tools.settings'), isTrue);

      final d = await c
          .act('tools.settings', {'pattern': 'lines', 'color': '#fbeff4'})
          .timeout(const Duration(seconds: 10));
      expect(d.ok, isTrue, reason: '${d.error} ${d.message}');
      expect(d.result!.data, {'pattern': 'lines', 'color': '#fbeff4', 'authors': false});
      expect(BoardSettings.fromExt(c.state.ext), const BoardSettings(pattern: 'lines', color: '#fbeff4'));
      await untilAsync(
        () async =>
            ((await peer.cmd({'cmd': 'ext', 'name': 'tools.settings'}))['value'] as Map?)?['pattern'] == 'lines',
      );

      final off = await c.act('tools.settings', {'toggleGrid': true}).timeout(const Duration(seconds: 10));
      expect(off.result!.data, {'pattern': 'none', 'color': '#fbeff4', 'authors': false});
      final on = await c.act('tools.settings', {'toggleGrid': true}).timeout(const Duration(seconds: 10));
      expect((on.result!.data! as Map)['pattern'], 'lines', reason: 'lastPattern');
      final web = (await peer.cmd({'cmd': 'ext', 'name': 'tools.settings'}))['value']! as Map;
      expect((web['pattern'], web['color'], web['lastPattern']), ('lines', '#fbeff4', 'lines'));
    },
    skip: liveSkip,
  );

  test(
    'frames.reorder: Reihenfolge rechnet der Server wie die Web-Liste, Web sieht slide, ein Rückgängig-Schritt',
    () async {
      final c = await app();
      addTearDown(c.dispose);
      final peer = await WebPeer.start();
      addTearDown(peer.close);
      await peer.cmd({'cmd': 'open', 'board': boardId});
      final stamp = DateTime.now().microsecondsSinceEpoch;
      final ids = [for (var i = 0; i < 3; i++) 'p4f$stamp$i'];
      c.apply([
        CreateOp([
          for (final (i, id) in ids.indexed)
            {
              'id': id,
              'type': 'frame',
              'x': 5000 + i * 800,
              'y': 5000,
              'w': 640,
              'h': 420,
              'title': 'R$i',
              'color': '#ffffff',
            },
        ]),
      ]);
      c.closeStep();
      await until(() => ids.every((id) => c.state[id] != null && c.confirmed[id] != null));
      List<String> mine() => [
        for (final f in framesInOrderWeb(c.state.ordered))
          if (ids.contains(f.id)) f.id,
      ];
      expect(mine(), ids);
      final d = await c
          .act('frames.reorder', {'id': ids[2], 'to': 0}, label: 'Rahmen umsortieren')
          .timeout(const Duration(seconds: 10));
      expect(d.ok, isTrue, reason: '${d.error} ${d.message}');
      expect(mine(), [ids[2], ids[0], ids[1]]);
      await untilAsync(() async => (await peer.object(ids[2]))?['slide'] is String);
      c.undo();
      await until(() => mine().first == ids[0]);
    },
    skip: liveSkip,
  );

  test('Präsentation: structure.present beim Web; Präsentation im Web erscheint in der App (Folgen)', () async {
    final c = await app();
    addTearDown(c.dispose);
    final peer = await WebPeer.start(login: 'jonas');
    addTearDown(peer.close);
    await peer.cmd({'cmd': 'open', 'board': boardId});
    c.presence.setExtra(presentField, {'frameId': 'x1', 'index': 0, 'total': 2, 'title': 'Start'}, immediate: true);
    await untilAsync(() async {
      final peers = (await peer.cmd({'cmd': 'peers'}))['peers'];
      return peers is List &&
          peers.any(
            (p) => p is Map && p['state'] is Map && ((p['state'] as Map)[presentField] as Map?)?['title'] == 'Start',
          );
    });
    await peer.cmd({
      'cmd': 'awareness',
      'fields': {
        presentField: {'frameId': 'y1', 'index': 1, 'total': 3, 'title': 'Mitte'},
      },
    });
    await until(() => c.peers.any((p) => (p.extra[presentField] as Map?)?['title'] == 'Mitte'));
    c.presence.setExtra(presentField, null, immediate: true);
    await untilAsync(() async {
      final peers = (await peer.cmd({'cmd': 'peers'}))['peers'];
      return peers is List &&
          peers.every((p) => p is! Map || p['state'] is! Map || (p['state'] as Map)[presentField] == null);
    });
  }, skip: liveSkip);
}
