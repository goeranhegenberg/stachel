// Desktop: the board with a mouse like the web (docs/features/desktop.md §1) – wheel zooms at the pointer (setting
// „Schwenken“ pans), Umschalt + wheel pans sideways, Strg + wheel zooms, left drag on the empty board selects, objects move right away, right/middle button and Leertaste pan, a
// right click opens the menus, Umschalt/Alt/Strg modify, cursors and the hover outline. Touch stays as it was.
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

const _objects = [
  {'id': 'a', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'A', 'z': 'a0'},
  {'id': 'b', 'type': 'shape', 'shape': 'rect', 'x': 400, 'y': 0, 'w': 200, 'h': 100, 'z': 'a1', 'text': 'B'},
];

typedef _Board = ({
  BoardController controller,
  FixtureBoardSource source,
  BoardEditor editor,
  GlobalKey<BoardViewState> key,
  List<String> menus,
});

/// The board at 800 × 600 with the camera moved by (100, 100): world (0, 0) lies at screen (100, 100).
Future<_Board> _pump(WidgetTester tester) async {
  tester.view.physicalSize = const Size(800, 600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  addTearDown(BoardDesktop.resetForTest);
  final objs = [for (final o in _objects) BoardObject(o)];
  final source = FixtureBoardSource(BoardSnapshot(objects: objs), rev: 20);
  final controller = BoardController(
    source,
    presenceInterval: Duration.zero,
    sendInterval: const Duration(milliseconds: 30),
  );
  addTearDown(controller.dispose);
  final scene = BoardScene(controller.state);
  final editor = BoardEditor(controller: controller, scene: scene, camera: CameraController())
    ..textDebounce = const Duration(milliseconds: 50)
    ..onHaptic = () {};
  addTearDown(editor.dispose);
  final key = GlobalKey<BoardViewState>();
  final menus = <String>[];
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: BoardView(
          key: key,
          controller: controller,
          editor: editor,
          fitOnLoad: false,
          onLongPress: (w) => menus.add('canvas@${w.dx.round()},${w.dy.round()}'),
          onObjectMenu: (w, id) => menus.add('object:$id'),
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
      snapshot: BoardSnapshot(objects: objs),
      info: const ConnectionInfo(
        epoch: 'fixture',
        user: NativeUser(key: 'm:1', name: 'Mara'),
        features: ['objects', 'ext', 'ops', 'text'],
      ),
    ),
  );
  await tester.pump();
  editor.camera.value = const Camera(100, 100, 1);
  await tester.pump();
  return (controller: controller, source: source, editor: editor, key: key, menus: menus);
}

Future<void> _mouseDrag(
  WidgetTester tester,
  Offset from,
  Offset to, {
  int buttons = kPrimaryMouseButton,
  int steps = 8,
}) async {
  final g = await tester.startGesture(from, kind: PointerDeviceKind.mouse, buttons: buttons);
  for (var i = 1; i <= steps; i++) {
    await g.moveTo(Offset.lerp(from, to, i / steps)!);
    await tester.pump(const Duration(milliseconds: 16));
  }
  await g.up();
  await tester.pump(const Duration(milliseconds: 50));
}

Future<void> _scroll(WidgetTester tester, Offset at, Offset delta) async {
  final p = TestPointer(1, PointerDeviceKind.mouse);
  await tester.sendEventToBinding(p.hover(at));
  await tester.sendEventToBinding(p.scroll(delta));
  await tester.pump();
}

Future<void> _click(WidgetTester tester, Offset at, {int buttons = kPrimaryMouseButton}) async {
  final g = await tester.startGesture(at, kind: PointerDeviceKind.mouse, buttons: buttons);
  await g.up();
  await tester.pump(const Duration(milliseconds: 50));
}

Offset _xOf(BoardController c, String id) => Offset(c.state[id]!.x, c.state[id]!.y);

void main() {
  group('Mausrad und Trackpad', () {
    testWidgets('Mausrad zoomt wie im Web am Mauszeiger (≈ 13 % je Raste, höchstens 3 Rasten je Ereignis)', (
      tester,
    ) async {
      final b = await _pump(tester);
      expect(BoardDesktop.wheel.value, WheelMode.zoom, reason: 'Standard wie im Web: Zoomen');
      const at = Offset(300, 200);
      final world = b.editor.camera.value.toWorld(at);
      await _scroll(tester, at, const Offset(0, 100));
      var cam = b.editor.camera.value;
      expect(cam.z, closeTo(0.887, 0.01)); // e^-0.12
      expect(cam.toScreen(world).dx, closeTo(at.dx, 0.01));
      expect(cam.toScreen(world).dy, closeTo(at.dy, 0.01));
      await _scroll(tester, at, const Offset(0, -100));
      expect(b.editor.camera.value.z, closeTo(1, 0.001));
      await _scroll(tester, at, const Offset(0, -500)); // 5 Rasten auf einmal → 3
      cam = b.editor.camera.value;
      expect(cam.z, closeTo(1.433, 0.01)); // e^0.36
    });

    testWidgets('Umschalt + Rad verschiebt seitlich (auch im Zoom-Modus)', (tester) async {
      final b = await _pump(tester);
      await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
      await _scroll(tester, const Offset(400, 300), const Offset(0, 60));
      await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
      expect(b.editor.camera.value, const Camera(40, 100, 1));
    });

    testWidgets('Einstellung „Mausrad: Schwenken“: das Rad verschiebt, Umschalt + Rad seitlich', (tester) async {
      final b = await _pump(tester);
      BoardDesktop.wheel.value = WheelMode.pan;
      await _scroll(tester, const Offset(400, 300), const Offset(0, 60));
      expect(b.editor.camera.value, const Camera(100, 40, 1));
      await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
      await _scroll(tester, const Offset(400, 300), const Offset(0, 60));
      await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
      expect(b.editor.camera.value, const Camera(40, 40, 1));
    });

    testWidgets('Strg + Rad zoomt am Mauszeiger (der Punkt darunter bleibt stehen)', (tester) async {
      final b = await _pump(tester);
      const at = Offset(300, 200);
      final world = b.editor.camera.value.toWorld(at);
      await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
      await _scroll(tester, at, const Offset(0, -100));
      await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
      final cam = b.editor.camera.value;
      expect(cam.z, closeTo(1.419, 0.01)); // e^0.35 per notch like the web
      expect(cam.toScreen(world).dx, closeTo(at.dx, 0.01));
      expect(cam.toScreen(world).dy, closeTo(at.dy, 0.01));
    });

    testWidgets('Strg + Rad zoomt auch bei „Schwenken“', (tester) async {
      final b = await _pump(tester);
      BoardDesktop.wheel.value = WheelMode.pan;
      await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
      await _scroll(tester, const Offset(400, 300), const Offset(0, 100));
      await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
      expect(b.editor.camera.value.z, closeTo(0.705, 0.01)); // e^-0.35
    });

    testWidgets('Trackpad-Wischen (Scroll-Ereignis vom Trackpad) verschiebt immer', (tester) async {
      final b = await _pump(tester);
      final p = TestPointer(3, PointerDeviceKind.trackpad);
      await tester.sendEventToBinding(p.hover(const Offset(400, 300)));
      await tester.sendEventToBinding(p.scroll(const Offset(10, 30)));
      await tester.pump();
      expect(b.editor.camera.value, const Camera(90, 70, 1));
    });

    testWidgets('Trackpad: zwei Finger verschieben, Spreizen zoomt', (tester) async {
      final b = await _pump(tester);
      final p = TestPointer(2, PointerDeviceKind.trackpad);
      await tester.sendEventToBinding(p.panZoomStart(const Offset(400, 300)));
      await tester.sendEventToBinding(p.panZoomUpdate(const Offset(400, 300), pan: const Offset(30, -20)));
      await tester.pump();
      expect(b.editor.camera.value, const Camera(130, 80, 1));
      await tester.sendEventToBinding(p.panZoomUpdate(const Offset(400, 300), pan: const Offset(30, -20), scale: 2));
      await tester.sendEventToBinding(p.panZoomEnd());
      await tester.pump();
      expect(b.editor.camera.value.z, 2);
    });
  });

  group('Linke Maustaste', () {
    testWidgets('Ziehen auf leerer Fläche wählt im Rechteck aus (statt zu verschieben)', (tester) async {
      final b = await _pump(tester);
      await _mouseDrag(tester, const Offset(60, 60), const Offset(330, 330));
      expect(b.editor.selection.value, {'a'});
      expect(b.editor.camera.value, const Camera(100, 100, 1));
    });

    testWidgets('Mit dem Finger verschiebt dasselbe Ziehen weiter die Ansicht', (tester) async {
      final b = await _pump(tester);
      final g = await tester.startGesture(const Offset(60, 60));
      for (var i = 1; i <= 8; i++) {
        await g.moveTo(Offset.lerp(const Offset(60, 60), const Offset(160, 160), i / 8)!);
        await tester.pump(const Duration(milliseconds: 16));
      }
      await g.up();
      await tester.pump(const Duration(seconds: 2));
      expect(b.editor.selection.value, isEmpty);
      expect(b.editor.camera.value.x, greaterThan(150));
    });

    testWidgets('Strg + Ziehen = Lasso, Umschalt + Ziehen ergänzt die Auswahl', (tester) async {
      final b = await _pump(tester);
      b.editor.select({'b'});
      await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
      await _mouseDrag(tester, const Offset(60, 60), const Offset(330, 330));
      await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
      expect(b.editor.selection.value, {'a', 'b'});
      b.editor.select(const {});
      await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
      final g = await tester.startGesture(const Offset(60, 60), kind: PointerDeviceKind.mouse);
      for (final p in const [Offset(340, 60), Offset(340, 340), Offset(60, 340), Offset(62, 62)]) {
        await g.moveTo(p);
        await tester.pump(const Duration(milliseconds: 16));
      }
      await g.up();
      await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
      await tester.pump();
      expect(b.editor.selection.value, {'a'});
    });

    testWidgets('Ein nicht gewähltes Objekt zieht sofort mit (vorher gewählt)', (tester) async {
      final b = await _pump(tester);
      await _mouseDrag(tester, const Offset(200, 200), const Offset(300, 250));
      expect(b.editor.selection.value, {'a'});
      expect(_xOf(b.controller, 'a'), const Offset(100, 50));
    });

    testWidgets('Alt + Ziehen zieht eine Kopie, das Original bleibt', (tester) async {
      final b = await _pump(tester);
      await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
      await _mouseDrag(tester, const Offset(200, 200), const Offset(300, 200));
      await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
      expect(_xOf(b.controller, 'a'), Offset.zero);
      final copy = b.editor.selection.value.single;
      expect(copy, isNot('a'));
      expect(b.controller.state[copy]!.type, 'sticky');
      expect(_xOf(b.controller, copy), const Offset(100, 0));
    });

    testWidgets('Umschalt + Klick nimmt dazu und wieder heraus', (tester) async {
      final b = await _pump(tester);
      await _click(tester, const Offset(200, 200));
      expect(b.editor.selection.value, {'a'});
      await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
      await _click(tester, const Offset(600, 150));
      expect(b.editor.selection.value, {'a', 'b'});
      await tester.pump(const Duration(milliseconds: 400));
      await _click(tester, const Offset(200, 200));
      await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
      expect(b.editor.selection.value, {'b'});
    });

    testWidgets('Klick auf die gewählte Notiz schreibt nicht (wie im Web), der Finger schon', (tester) async {
      final b = await _pump(tester);
      // far apart: not a double click (the test events all carry the same time stamp)
      await _click(tester, const Offset(130, 130));
      await tester.pump(const Duration(milliseconds: 400));
      await _click(tester, const Offset(270, 270));
      await tester.pump(const Duration(milliseconds: 400));
      expect(b.editor.selection.value, {'a'});
      expect(b.editor.editingId, isNull);
      await tester.tapAt(const Offset(130, 270));
      await tester.pump(const Duration(milliseconds: 400));
      expect(b.editor.editingId, 'a');
    });

    testWidgets('Doppelklick bearbeitet den Text', (tester) async {
      final b = await _pump(tester);
      await _click(tester, const Offset(600, 150));
      await tester.pump(const Duration(milliseconds: 400));
      await _click(tester, const Offset(200, 200));
      await tester.pump(const Duration(milliseconds: 60));
      await _click(tester, const Offset(200, 200));
      await tester.pump();
      expect(b.editor.editingId, 'a');
    });

    testWidgets('Leertaste + Ziehen verschiebt die Ansicht', (tester) async {
      final b = await _pump(tester);
      BoardDesktop.spaceDown.value = true;
      await _mouseDrag(tester, const Offset(200, 200), const Offset(260, 230));
      BoardDesktop.spaceDown.value = false;
      expect(b.editor.camera.value, const Camera(160, 130, 1));
      expect(_xOf(b.controller, 'a'), Offset.zero);
      expect(b.editor.selection.value, isEmpty);
    });
  });

  group('Mittlere und rechte Maustaste', () {
    testWidgets('Mittlere Taste + Ziehen verschiebt die Ansicht, auch über Objekten', (tester) async {
      final b = await _pump(tester);
      await _mouseDrag(tester, const Offset(200, 200), const Offset(150, 180), buttons: kMiddleMouseButton);
      expect(b.editor.camera.value, const Camera(50, 80, 1));
      expect(_xOf(b.controller, 'a'), Offset.zero);
    });

    testWidgets('Rechtsklick: Objekt-Menü (Objekt gewählt) bzw. Flächen-Menü am Mauszeiger', (tester) async {
      final b = await _pump(tester);
      await _click(tester, const Offset(200, 200), buttons: kSecondaryMouseButton);
      expect(b.menus, ['object:a']);
      expect(b.editor.selection.value, {'a'});
      await _click(tester, const Offset(700, 500), buttons: kSecondaryMouseButton);
      expect(b.menus, ['object:a', 'canvas@600,400']);
    });

    testWidgets('Die Menüs bekommen den Ort des Rechtsklicks (Popup statt Blatt), nur einmal', (tester) async {
      final b = await _pump(tester);
      Offset? anchor;
      final view = b.key.currentState!;
      // the screen takes it while opening its menu (showBoardMenu)
      final g = await tester.startGesture(
        const Offset(700, 500),
        kind: PointerDeviceKind.mouse,
        buttons: kSecondaryMouseButton,
      );
      await g.up();
      anchor = view.takeMenuAnchor();
      expect(anchor, const Offset(700, 500));
      expect(view.takeMenuAnchor(), isNull);
      await tester.pump();
    });

    testWidgets('Rechte Taste + Ziehen verschiebt die Ansicht, ohne Menü', (tester) async {
      final b = await _pump(tester);
      await _mouseDrag(tester, const Offset(700, 500), const Offset(640, 470), buttons: kSecondaryMouseButton);
      expect(b.editor.camera.value, const Camera(40, 70, 1));
      expect(b.menus, isEmpty);
    });
  });

  group('Zeiger und Hover', () {
    testWidgets('Hover umrandet das Objekt; Griffe zeigen Größen-Pfeile, die Auswahl „verschieben“', (tester) async {
      final b = await _pump(tester);
      final view = b.key.currentState!;
      final p = TestPointer(1, PointerDeviceKind.mouse);
      await tester.sendEventToBinding(p.hover(const Offset(600, 150)));
      await tester.pump();
      expect(view.hovered.value, 'b');
      expect(RendererBinding.instance.mouseTracker.debugDeviceActiveCursor(1), SystemMouseCursors.basic);
      b.editor.select({'a'});
      await tester.pump();
      // the selected object: move; its corner handle (bottom right at screen 300,300): resize
      await tester.sendEventToBinding(p.hover(const Offset(200, 200)));
      await tester.pump();
      expect(view.hovered.value, isNull);
      expect(RendererBinding.instance.mouseTracker.debugDeviceActiveCursor(1), SystemMouseCursors.move);
      expect(view.cursorAt(const Offset(300, 300)), SystemMouseCursors.resizeUpLeftDownRight);
      expect(view.cursorAt(const Offset(300, 200)), SystemMouseCursors.resizeLeftRight);
      expect(BoardViewState.handleCursor('rotate'), SystemMouseCursors.grab);
      // tools: text cursor, crosshair; Leertaste: grab
      b.editor.tool = BoardTool.text;
      expect(view.cursorAt(const Offset(700, 500)), SystemMouseCursors.text);
      b.editor.tool = BoardTool.sticky;
      expect(view.cursorAt(const Offset(700, 500)), SystemMouseCursors.precise);
      b.editor.tool = BoardTool.select;
      BoardDesktop.spaceDown.value = true;
      await tester.pump();
      expect(RendererBinding.instance.mouseTracker.debugDeviceActiveCursor(1), SystemMouseCursors.grab);
      BoardDesktop.spaceDown.value = false;
    });
  });
}
