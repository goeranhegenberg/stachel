// Restliste der Abnahme (native Parität, Branch feat/stachel-rest): Verbinder-Vorschau wie im Web (G02/D38),
// „Bild nicht verfügbar“ (K03), großer Rahmentitel unter 25 % (H07), „Alles einpassen“ mit Platz für Zoom-Leiste und
// Übersichtskarte (M04), Kommentar-Filter auch für die Pins (L03), Hinweis „Wird gerade auch von … bearbeitet“ (F20),
// Handballen beim Stift (M01).
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/view/view_camera.dart';

const _objects = [
  {'id': 'a', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'A', 'z': 'a0'},
  {'id': 'b', 'type': 'shape', 'shape': 'rect', 'x': 400, 'y': 0, 'w': 200, 'h': 100, 'z': 'a1', 'text': 'B'},
  {'id': 'f', 'type': 'frame', 'x': 0, 'y': 1000, 'w': 640, 'h': 420, 'title': 'Bühne', 'z': '0'},
];

Future<(BoardController, FixtureBoardSource, BoardEditor, BoardUi)> _pump(
  WidgetTester tester, {
  List<Map<String, Object?>> objects = _objects,
  Map<String, Object?> ext = const {},
  BoardImages? images,
  Size size = const Size(800, 600),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  BoardSnapshot snap() => BoardSnapshot(objects: [for (final o in objects) BoardObject(o)], ext: ext);
  final source = FixtureBoardSource(snap(), rev: 20);
  final controller = BoardController(
    source,
    presenceInterval: Duration.zero,
    sendInterval: const Duration(milliseconds: 30),
  );
  addTearDown(controller.dispose);
  final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController())
    ..textDebounce = const Duration(milliseconds: 50)
    ..onHaptic = () {};
  addTearDown(editor.dispose);
  final ui = BoardUi(editor: editor, registry: standardBoardRegistry());
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: BoardUiScope(
          ui: ui,
          child: Stack(
            children: [
              Positioned.fill(
                child: BoardView(
                  key: ui.viewKey,
                  controller: controller,
                  editor: editor,
                  fitOnLoad: false,
                  images: images,
                ),
              ),
              Positioned.fill(child: BoardOverlays(ui: ui)),
            ],
          ),
        ),
      ),
    ),
  );
  await controller.start();
  await tester.pump();
  source.push(
    WelcomeMessage(
      proto: 1,
      rev: 20,
      snapshot: snap(),
      info: const ConnectionInfo(
        epoch: 'fixture',
        user: NativeUser(key: 'm:1', name: 'Mara'),
        features: ['objects', 'ext', 'ops', 'text', 'comments', 'reactions'],
      ),
    ),
  );
  await tester.pump();
  return (controller, source, editor, ui);
}

List<Map<String, Object?>> _ops(FixtureBoardSource s) => [
  for (final m in s.sent)
    if (m['t'] == 'ops') ...(m['ops'] as List).cast<Map<String, Object?>>(),
];

BoardScene _scene() {
  final state = BoardState()
    ..applySnapshot(BoardSnapshot(objects: [for (final o in _objects) BoardObject(o)]), rev: 1, epoch: 'e');
  return BoardScene(state)..sync();
}

RenderBox _painterBox(WidgetTester tester, String type) => tester.renderObject<RenderBox>(
  find.byWidgetPredicate((w) => w is CustomPaint && w.painter.runtimeType.toString() == type).first,
);

/// Some drawRect/drawRRect call with [color] (in any order).
PaintPattern _fills(Color color, {bool rrect = false}) => paints
  ..something(
    (m, args) => m == (rrect ? #drawRRect : #drawRect) && (args.last as Paint).color.toARGB32() == color.toARGB32(),
  );

void main() {
  group('G02/D38 Verbinder-Vorschau wie im Web', () {
    testWidgets('Plus-Griff ins Leere: echte Linienführung, Spitze, Geisterform; Loslassen legt sie dort an', (
      tester,
    ) async {
      final (c, s, e, _) = await _pump(tester);
      e.select({'b'});
      await tester.pump();
      final plus = e.handles().firstWhere((h) => h.id == 'add-s').at;
      final g = await tester.startGesture(plus);
      for (var i = 1; i <= 8; i++) {
        await g.moveTo(plus + Offset(0, 30.0 * i));
        await tester.pump(const Duration(milliseconds: 16));
      }
      final d = e.draft.value! as ConnectorDraft;
      expect(d.ghost, isNotNull, reason: 'Geisterform am freien Ende');
      expect((d.ghost!.shape, d.ghost!.w, d.ghost!.h), ('rect', 200.0, 100.0));
      expect(d.ghost!.y + d.ghost!.h / 2, closeTo(plus.dy + 240, 1));
      expect(d.route, isNotNull);
      expect(d.route!.style, 'curved', reason: 'zwischen zwei Objekten geschwungen (newLineStyle)');
      expect(d.route!.pts.length, 4);
      expect(d.cap, 'triangle');
      expect(d.line, isTrue);
      // painted: dashed ghost outline + blue route
      expect(_painterBox(tester, 'DraftPainter'), paints..path(color: const Color(0x0F1763B5)));
      await g.up();
      await tester.pump(const Duration(milliseconds: 100));
      final created = (_ops(s).last['objects'] as List).cast<Map>();
      final copy = created.firstWhere((o) => o['type'] == 'shape');
      final conn = created.firstWhere((o) => o['type'] == 'connector');
      expect(copy['y'], d.ghost!.y);
      expect(conn['to'], {'objectId': copy['id'], 'side': 'n'});
      expect(conn['lineStyle'], 'curved');
      expect(e.draft.value, isNull);
      expect(c.state[copy['id'] as String], isNotNull);
    });

    testWidgets('Ziehen auf ein Objekt: keine Geisterform, Ziel umrandet, Andockpunkte in der Nähe', (tester) async {
      final (_, _, e, _) = await _pump(tester);
      e.select({'a'});
      await tester.pump();
      final plus = e.handles().firstWhere((h) => h.id == 'add-e').at;
      final g = await tester.startGesture(plus);
      const target = Offset(500, 50); // middle of b
      for (var i = 1; i <= 8; i++) {
        await g.moveTo(Offset.lerp(plus, target, i / 8)!);
        await tester.pump(const Duration(milliseconds: 16));
      }
      final d = e.draft.value! as ConnectorDraft;
      expect(d.ghost, isNull);
      expect(d.anchorsOf?.id, 'b');
      expect(d.near.map((o) => o.id), contains('b'));
      expect(d.near.map((o) => o.id), isNot(contains('a')), reason: 'nicht die Quelle');
      await g.up();
      await tester.pump(const Duration(milliseconds: 100));
    });

    testWidgets('Plus-Griff auf einen Rahmen: Rahmen ist kein Ziel, die Kopie landet darin (wie viaPlus)', (
      tester,
    ) async {
      final (_, s, e, _) = await _pump(tester);
      e.camera.value = const Camera(50, 20, 0.4);
      e.select({'a'});
      await tester.pump();
      final plus = e.handles().firstWhere((h) => h.id == 'add-s').at;
      final g = await tester.startGesture(plus);
      final into = e.camera.value.toScreen(const Offset(320, 1100));
      for (var i = 1; i <= 8; i++) {
        await g.moveTo(Offset.lerp(plus, into, i / 8)!);
        await tester.pump(const Duration(milliseconds: 16));
      }
      expect((e.draft.value! as ConnectorDraft).ghost, isNotNull);
      await g.up();
      await tester.pump(const Duration(milliseconds: 100));
      final created = (_ops(s).last['objects'] as List).cast<Map>();
      expect(created.map((o) => o['type']), containsAll(['sticky', 'connector']));
    });

    test('nearAnchorables wie das Web: höchstens 8, nächste zuerst, ohne Rahmen/Verbinder', () {
      final scene = _scene();
      expect(nearAnchorables(scene, const Offset(390, 50), 1).map((o) => o.id), ['b']);
      // a's center is 200 away, b's 206
      expect(nearAnchorables(scene, const Offset(300, 100), 0.5).map((o) => o.id), ['a', 'b']);
      expect(nearAnchorables(scene, const Offset(300, 990), 1), isEmpty);
    });
  });

  group('K03 Bild nicht verfügbar', () {
    testWidgets('dauerhaft fehlendes Bild: Streifen + Text statt Platzhalter', (tester) async {
      final images = MemoryBoardImages();
      await _pump(
        tester,
        images: images,
        objects: const [
          {'id': 'i', 'type': 'image', 'x': 10, 'y': 10, 'w': 300, 'h': 200, 'imageId': 'gone', 'color': '#8899aa'},
        ],
      );
      final board = _painterBox(tester, 'BoardPainter');
      expect(board, _fills(const Color(0xFF8899AA)), reason: 'lädt noch: Durchschnittsfarbe');
      images.markMissing('gone');
      await tester.pump();
      expect(board, _fills(const Color(0xFFECECE7)));
      expect(board, isNot(_fills(const Color(0xFF8899AA))));
      expect(imageMissingText, 'Bild nicht verfügbar');
    });
  });

  group('H07 Rahmentitel', () {
    testWidgets('unter 25 %: großer Titel auf weißer Pille über der Oberkante; ab 25 % der kleine', (tester) async {
      final (_, _, e, _) = await _pump(tester);
      e.camera.value = const Camera(100, 100, 0.2);
      await tester.pump();
      final board = _painterBox(tester, 'BoardPainter');
      expect(board, _fills(const Color(0xE0FFFFFF), rrect: true));
      e.camera.value = const Camera(100, 100, 0.5);
      await tester.pump();
      expect(board, isNot(_fills(const Color(0xE0FFFFFF), rrect: true)));
    });

    test('Schriftgröße des kleinen Titels wie das Overlay (10–14 px)', () {
      expect(frameTitleFontSize(1), 14);
      expect(frameTitleFontSize(0.5), closeTo(10.5, 1e-9));
      expect(frameTitleFontSize(0.3), 10);
      expect(farZoom, 0.25);
    });

    test('Titel bleibt bei kleinem Zoom greifbar (Bildschirmgröße)', () {
      final scene = _scene();
      // 20 screen px above the frame at 10 %: 200 world units
      expect(scene.hitTest(const Offset(100, 800), 0.1)?.id, 'f');
      expect(scene.hitTest(const Offset(100, 800), 1)?.id, isNull);
      expect(frameTitleHeight(1), frameTitleSpace);
      expect(frameTitleHeight(0.1), 300);
    });
  });

  group('M04 Alles einpassen', () {
    test('chromeInsets: Übersichtskarte unten rechts wird zur Seite, die weniger Zoom kostet; sonst 24', () {
      const board = Size(400, 800);
      expect(chromeFitPadding(board, const []).left, chromeMin);
      // zoom bar bottom right (220 × 40), minimap above (180 × 120)
      const zoom = Rect.fromLTWH(172, 752, 220, 40);
      const map = Rect.fromLTWH(212, 626, 180, 120);
      // wide content: the bars count below (right would cost width)
      final wide = chromeFitPadding(board, const [zoom, map], r: const Rect.fromLTWH(0, 0, 2000, 400), maxZoom: 1);
      expect(wide.bottom, 800 - 626 + chromeGap);
      expect(wide.right, chromeMin);
      // without content: each bar its cheapest side
      final plain = chromeFitPadding(board, const [zoom]);
      expect(plain.bottom, 800 - 752 + chromeGap);
    });

    testWidgets('„Alles einpassen“ legt nichts unter Zoom-Leiste/Übersichtskarte; leeres Board = 100 % Mitte', (
      tester,
    ) async {
      // UX-A1 (P9): the zoom bar from 700 dp on; a tall board so the content would reach it
      final (_, _, e, ui) = await _pump(
        tester,
        size: const Size(760, 800),
        objects: const [
          {'id': 'w', 'type': 'shape', 'shape': 'rect', 'x': 0, 'y': 0, 'w': 800, 'h': 900, 'z': 'a0'},
        ],
      );
      ui.view!.fitAll();
      await tester.pump();
      final zoomBar = tester.getRect(find.byKey(const Key('stachelZoomBar')));
      final content = e.camera.value.rectToScreen(const Rect.fromLTWH(0, 0, 800, 900));
      expect(content.overlaps(zoomBar), isFalse);
    });

    testWidgets('am Handy (UX-A1): „Alles einpassen“ legt nichts unter den Minikarten-Knopf oben rechts', (tester) async {
      final (_, _, e, ui) = await _pump(
        tester,
        size: const Size(400, 800),
        objects: const [
          {'id': 'w', 'type': 'shape', 'shape': 'rect', 'x': 0, 'y': 0, 'w': 400, 'h': 900, 'z': 'a0'},
        ],
      );
      ui.view!.fitAll();
      await tester.pump();
      expect(find.byKey(const Key('stachelZoomBar')), findsNothing);
      final map = tester.getRect(find.byKey(const Key('stachelMinimapToggle')));
      final content = e.camera.value.rectToScreen(const Rect.fromLTWH(0, 0, 400, 900));
      expect(content.overlaps(map), isFalse);
    });

    testWidgets('leeres Board: Alles einpassen = 100 % um den Ursprung', (tester) async {
      final (_, _, e, ui) = await _pump(tester, objects: const []);
      ui.view!.fitAll();
      expect(e.camera.value, const Camera(400, 300, 1));
    });
  });

  group('L03 Filter auch für die Pins', () {
    const ext = {
      'collab.comments': {
        'o1': {
          'x': 10,
          'y': 10,
          'resolved': false,
          'messages': [
            {'id': 'm', 'by': 'm:2', 'name': 'Jonas', 'text': 'offen', 'at': '2026-11-01T10:00:00Z'},
          ],
        },
        'd1': {
          'x': 50,
          'y': 10,
          'resolved': true,
          'messages': [
            {'id': 'm', 'by': 'm:2', 'name': 'Jonas', 'text': 'erledigt', 'at': '2026-11-01T10:00:00Z'},
          ],
        },
      },
    };
    testWidgets('Offen/Erledigt/Alle wie CommentLayer; der offene Thread immer', (tester) async {
      final (c, _, e, _) = await _pump(tester, ext: ext);
      final layer = CollabLayer(controller: c, scene: e.scene);
      Iterable<String> ids() => layer.shownThreads.map((t) => t.id);
      expect(ids(), ['o1']);
      layer.filter = 'resolved';
      expect(ids(), ['d1']);
      layer.filter = 'all';
      expect(ids(), unorderedEquals(['o1', 'd1']));
      layer
        ..filter = 'open'
        ..openThread = 'd1';
      expect(ids(), unorderedEquals(['o1', 'd1']));
      layer.showPins = false;
      expect(ids(), ['d1'], reason: 'Pins aus: nur der offene Thread');
    });
  });

  group('F20 Hinweis', () {
    testWidgets('writerOf mit vollem Namen wie RemoteHint, ohne Namen „jemand anderem“', (tester) async {
      final (_, s, e, _) = await _pump(tester);
      s.push(const PresenceMessage([Peer(id: 9, key: 'm:9', name: 'Mara Muster', color: '#ec4e92', editing: 'a')]));
      await tester.pump();
      expect(e.writerOf('a'), 'Mara');
      expect(e.writerOf('a', fullName: true), 'Mara Muster');
      s.push(const PresenceMessage([Peer(id: 9, key: 'm:9', name: '', color: '#ec4e92', editing: 'a')]));
      await tester.pump();
      expect(e.writerOf('a', fullName: true), 'jemand anderem');
      expect(e.writerOf('b', fullName: true), '');
    });
  });

  group('F16 HTML einfügen beim Schreiben', () {
    tearDown(() => BoardClipboard.readHtml = null);

    testWidgets('Einfügen (Menü und Strg+V) nimmt das HTML der Zwischenablage wie der Web-Editor', (tester) async {
      final (_, s, e, _) = await _pump(tester);
      BoardClipboard.readHtml = () async => '<p>Hallo <b>Welt</b></p><ul><li>Punkt</li></ul><script>x</script>';
      e.select({'a'});
      await tester.pump();
      expect(e.startEditing('a'), isTrue);
      await tester.pump();
      final field = tester.state<BoardTextEditorState>(find.byType(BoardTextEditor));
      e.textRange = (start: 1, end: 1); // after „A“
      await field.paste();
      await tester.pump();
      expect(e.editingDoc!.toJson(), {
        'type': 'doc',
        'content': [
          {
            'type': 'paragraph',
            'content': [
              {'type': 'text', 'text': 'AHallo '},
              {
                'type': 'text',
                'text': 'Welt',
                'marks': [
                  {'type': 'bold'},
                ],
              },
            ],
          },
          {
            'type': 'bulletList',
            'content': [
              {
                'type': 'listItem',
                'content': [
                  {
                    'type': 'paragraph',
                    'content': [
                      {'type': 'text', 'text': 'Punkt'},
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
      final ctl =
          tester.widget<TextField>(find.byKey(const Key('boardTextField'))).controller! as RichTextEditingController;
      expect(ctl.docSelection, (start: 17, end: 17), reason: 'Schreibmarke am Ende des Eingefügten');
      await tester.pump(const Duration(milliseconds: 100));
      expect(_ops(s).where((o) => o['op'] == 'text'), isNotEmpty, reason: 'geht raus wie Tippen');

      // Strg+V: same path
      BoardClipboard.readHtml = () async => '<i>kursiv</i>';
      await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyV);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
      await tester.pump();
      expect(e.editingDoc!.text, contains('kursiv'));
      e.stopEditing();
      await tester.pump(const Duration(milliseconds: 100));
    });

    testWidgets('ohne HTML (iOS, nur Text): Klartext wie bisher', (tester) async {
      final (_, _, e, _) = await _pump(tester);
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.getData') return {'text': 'nur Text'};
        if (call.method == 'Clipboard.hasStrings') return {'value': true};
        return null;
      });
      addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
      e.select({'a'});
      await tester.pump();
      e.startEditing('a');
      await tester.pump();
      await tester.state<BoardTextEditorState>(find.byType(BoardTextEditor)).paste();
      await tester.pumpAndSettle();
      expect(e.editingDoc!.text, contains('nur Text'));
      e.stopEditing();
      await tester.pump(const Duration(milliseconds: 100));
    });
  });

  group('M01 Handballen beim Stift', () {
    testWidgets('Handballen zuerst, dann Stift: Schwenken zurückgenommen, Handballen danach übergangen', (
      tester,
    ) async {
      final (_, _, e, _) = await _pump(tester);
      final palm = await tester.createGesture(kind: PointerDeviceKind.touch, pointer: 3);
      await palm.down(const Offset(300, 400));
      await tester.pump();
      await palm.moveTo(const Offset(340, 400));
      await tester.pump();
      await palm.moveTo(const Offset(380, 420));
      await tester.pump();
      expect(e.camera.value, isNot(Camera.identity), reason: 'der Handballen schwenkt zuerst');
      final pen = await tester.createGesture(kind: PointerDeviceKind.stylus, pointer: 7);
      await pen.down(const Offset(700, 500));
      await tester.pump();
      expect(e.camera.value, Camera.identity, reason: 'Stift kommt: Schwenken des Handballens zurück');
      await palm.moveTo(const Offset(500, 500));
      await tester.pump();
      expect(e.camera.value, Camera.identity, reason: 'Handballen zählt nicht mehr');
      await pen.up();
      await palm.up();
      await tester.pump(const Duration(milliseconds: 400));
    });

    testWidgets('Stift liegt auf: Finger/Handballen schwenken und zoomen nicht, der Stift zeichnet', (tester) async {
      final (_, s, e, _) = await _pump(tester);
      e.tool = BoardTool.pen;
      await tester.pump();
      final pen = await tester.createGesture(kind: PointerDeviceKind.stylus, pointer: 7);
      await pen.down(const Offset(300, 400));
      await tester.pump();
      final palm = await tester.createGesture(kind: PointerDeviceKind.touch, pointer: 3);
      await palm.down(const Offset(500, 500));
      final palm2 = await tester.createGesture(kind: PointerDeviceKind.touch, pointer: 4);
      await palm2.down(const Offset(600, 550));
      await tester.pump();
      for (var i = 1; i <= 6; i++) {
        await pen.moveTo(Offset(300.0 + 20 * i, 400.0 + 5 * i));
        await palm.moveTo(Offset(500.0 + 15 * i, 500));
        await palm2.moveTo(Offset(600.0 + 40 * i, 550.0 + 20 * i));
        await tester.pump(const Duration(milliseconds: 16));
      }
      expect(e.camera.value, Camera.identity, reason: 'kein Schwenken, kein Zoom');
      expect(e.draft.value, isA<PenDraft>());
      await pen.up();
      await palm.up();
      await palm2.up();
      await tester.pump(const Duration(milliseconds: 100));
      final created = _ops(s).where((o) => o['op'] == 'create').expand((o) => (o['objects'] as List).cast<Map>());
      expect(created.map((o) => o['type']), contains('pen'));
    });

    testWidgets('mit dem Finger allein bleibt alles wie vorher (Schwenken)', (tester) async {
      final (_, _, e, _) = await _pump(tester);
      final finger = await tester.createGesture(kind: PointerDeviceKind.touch, pointer: 3);
      await finger.down(const Offset(300, 400));
      await tester.pump();
      for (var i = 1; i <= 4; i++) {
        await finger.moveTo(Offset(300.0 + 20 * i, 400));
        await tester.pump(const Duration(milliseconds: 16));
      }
      await finger.up();
      await tester.pump(const Duration(milliseconds: 400));
      expect(e.camera.value.x, greaterThan(40));
    });
  });
}
