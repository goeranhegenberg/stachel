// P2 against the real Stachel server in its sandbox: what the shapes/stickers/text features of the app write is
// accepted by the server (no nack) and arrives in the web exactly – note in its shape and color, library shape in its
// catalog size, stamp/emoji/icon (with `iconNode`), fill opacity, border, vertical alignment, font, „Form anhängen“.
//
//   cd stachel && npm --prefix server run build
//   server\node_modules\.bin\tsx.cmd tools/sandbox.mts 8630 --seed
//   flutter test test/features/shapes/p2_live_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8630
@Tags(['live'])
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/src/features/shapes/attach.dart';
import 'package:stachel_board/src/features/shapes/shape_state.dart';
import 'package:stachel_board/src/features/stickers/sticker_data.dart';
import 'package:stachel_board/stachel_board.dart';

import '../../live_support.dart';

void main() {
  late String boardId;
  late String token;

  setUpAll(() async {
    if (liveSkip != null) return;
    token =
        ((await liveHttp('POST', '$sandbox/api/auth/app-session', bearer: 'sandbox-mara', body: {}))! as Map)['token']
            as String;
    final b = await liveHttp(
      'POST',
      '$sandbox/api/boards',
      bearer: token,
      write: true,
      body: {'title': 'P2 live ${DateTime.now().toIso8601String()}'},
    );
    boardId = ((b! as Map)['board'] as Map)['id'] as String;
  });

  test(
    'Objekte und Formate der Formen/Sticker/Text-Funktionen kommen unverändert im Web an',
    () async {
      final source = NativeBoardSource(
        base: Uri.parse(sandbox),
        board: boardId,
        token: ({bool fresh = false}) async => token,
        appVersion: '1.25.0+1',
        retryDelays: const [Duration(milliseconds: 100)],
      );
      final c = BoardController(source, presenceInterval: const Duration(milliseconds: 30), boardId: boardId);
      final editor = BoardEditor(controller: c, scene: BoardScene(c.state), camera: CameraController());
      final ui = BoardUi(editor: editor, registry: standardBoardRegistry());
      final nacks = <String>[];
      c.notices.listen((n) => nacks.add('${n.kind} ${n.error} ${n.message}'));
      final web = await WebPeer.start();
      addTearDown(() async {
        await web.close();
        ui.dispose();
        editor.dispose();
        c.dispose();
      });
      await web.cmd({'cmd': 'open', 'board': boardId});
      await c.start();
      await until(() => c.loaded && c.canEdit);

      // note in its tool shape and color (C04), shape in its library size (C06), text measured (C05)
      P2Tools.of(editor).stickyShape = 'rect';
      editor.stickyColor = '#9fd3ff';
      final note = editor.create('sticky', const Offset(0, 0))!;
      editor.stopEditing();
      P2Tools.of(editor).setShape('ellipse', 'circle');
      final circle = editor.create('shape', const Offset(500, 0))!;
      // stickers (J03–J05)
      final ids = <String>[];
      for (final item in [
        const StampItem('plusOne'),
        const EmojiItem('🌵'),
        IconItem(icons.firstWhere((i) => i.name == 'star')),
      ]) {
        final id = BoardController.newId();
        ids.add(id);
        c.apply([
          CreateOp([
            {'id': id, ...stickerObjectFor(item, 800.0 + ids.length * 120, 0)},
          ]),
        ]);
      }
      await untilAsync(() async => (await web.object(ids.last)) != null);
      final n = (await web.object(note))!;
      expect((n['w'], n['h'], n['color']), (350, 200, '#9fd3ff'));
      final s = (await web.object(circle))!;
      expect((s['shape'], s['w'], s['h'], s['strokeWidth']), ('ellipse', 140, 140, 2));
      expect((await web.object(ids[0]))!['stamp'], 'plusOne');
      expect((await web.object(ids[1]))!['emoji'], '🌵');
      final icon = (await web.object(ids[2]))!;
      expect((icon['icon'], icon['w'], icon['color']), ('star', 64, '#0a0a0a'));
      expect(icon['iconNode'], isA<List<Object?>>());

      // formats of the context bar (E03, E04, E07, E09, E10, E11, E14)
      editor.select({circle});
      patchSelection(ui, (o) => {'fillOpacity': 0.35, 'stroke': '#7048e8', 'dash': 'dotted', 'valign': 'bottom'});
      editor.select({note});
      patchSelection(ui, (o) => {'fontFamily': 'serif', 'strike': true, ...?stickyShapePatch(o, 'square')});
      editor.select({ids[2]});
      patchSelection(ui, (o) => {'strokeWidth': 1.5, 'color': '#1763b5'});
      await untilAsync(() async => (await web.object(ids[2]))!['strokeWidth'] == 1.5);
      final s2 = (await web.object(circle))!;
      expect((s2['fillOpacity'], s2['stroke'], s2['dash'], s2['valign']), (0.35, '#7048e8', 'dotted', 'bottom'));
      final n2 = (await web.object(note))!;
      expect(
        (n2['fontFamily'], n2['strike'], n2['w'], n2['x']),
        ('serif', true, 200, -100),
        reason: 'Quadrat: Mitte bleibt (-175 + 75)',
      );

      // „Form anhängen“ (D39): a connector from the note into the empty board, then a rectangle at its end
      editor.scene.sync(); // no BoardView here: the hit test needs the index
      editor.connectorDragStart(Offset.zero);
      editor.connectorDragUpdate(const Offset(400, 600));
      final con = editor.connectorDragEnd(const Offset(400, 600), moved: true)!;
      final p = attachFor(ui)!;
      final made = attachAt(ui, p, 'rect')!;
      editor.stopEditing();
      await untilAsync(() async => ((await web.object(con))?['to'] as Map?)?['objectId'] == made);
      final cw = (await web.object(con))!;
      expect(cw['lineStyle'], 'curved');
      expect((await web.object(made))!['shape'], 'rect');
      await until(() => c.pendingCount == 0);
      expect(nacks, isEmpty, reason: 'der Server nimmt alle Felder an');
    },
    skip: liveSkip,
    timeout: const Timeout(Duration(minutes: 2)),
  );
}
