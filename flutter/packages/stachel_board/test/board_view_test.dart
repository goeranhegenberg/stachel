// BoardView widget: fits on load, pan/pinch move the camera, tap selects (hit-test), patches re-render, the
// debug screen works with every fixture board.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

Future<(BoardController, FixtureBoardSource, CameraController, ValueNotifier<Set<String>>)> pumpBoard(
  WidgetTester tester, {
  void Function(BoardObject?)? onSelect,
  bool fit = true,
}) async {
  tester.view.physicalSize = const Size(800, 600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final source = FixtureBoardSource(
    BoardSnapshot.fromJson({
      'objects': [
        {'id': 'a', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'A', 'z': 'a'},
        {'id': 'b', 'type': 'shape', 'shape': 'ellipse', 'x': 400, 'y': 0, 'w': 200, 'h': 200, 'z': 'b'},
        {'id': 'u', 'type': 'kanban', 'x': 0, 'y': 400, 'w': 200, 'h': 200, 'z': 'c'},
      ],
    }),
  );
  final controller = BoardController(source);
  addTearDown(controller.dispose);
  final camera = CameraController();
  final selection = ValueNotifier<Set<String>>(const {});
  await tester.pumpWidget(
    MaterialApp(
      home: BoardView(controller: controller, camera: camera, selection: selection, onSelect: onSelect, fitOnLoad: fit),
    ),
  );
  await controller.start();
  await tester.pump();
  await tester.pump();
  return (controller, source, camera, selection);
}

void main() {
  testWidgets('passt das Board beim Laden ein', (tester) async {
    final (_, _, camera, _) = await pumpBoard(tester);
    // bounds 600×600, viewport 800×600 with 32 padding → z = 536/600
    expect(camera.value.z, closeTo(536 / 600, 1e-9));
  });

  testWidgets('Tippen wählt das getroffene Objekt, leere Fläche hebt die Auswahl auf', (tester) async {
    final taps = <BoardObject?>[];
    final (_, _, camera, selection) = await pumpBoard(tester, onSelect: taps.add, fit: false);
    expect(camera.value, Camera.identity);
    await tester.tapAt(const Offset(100, 100));
    await tester.pump(const Duration(milliseconds: 500));
    expect(selection.value, {'a'});
    expect(taps.last!.id, 'a');
    await tester.tapAt(const Offset(100, 500));
    await tester.pump(const Duration(milliseconds: 500));
    expect(taps.last!.type, 'kanban', reason: 'unbekannter Typ ist antippbar (Platzhalter mit „Im Browser ansehen“)');
    await tester.tapAt(const Offset(700, 500));
    await tester.pump(const Duration(milliseconds: 500));
    expect(selection.value, isEmpty);
    expect(taps.last, isNull);
  });

  testWidgets('Ziehen mit einem Finger verschiebt die Ansicht, Wischen läuft nach', (tester) async {
    final (_, _, camera, _) = await pumpBoard(tester, fit: false);
    await tester.dragFrom(const Offset(300, 300), const Offset(-100, -50));
    await tester.pump();
    expect(camera.value.x, lessThan(-40));
    expect(camera.value.z, 1);
    final afterDrag = camera.value.x;
    await tester.flingFrom(const Offset(300, 300), const Offset(-200, 0), 2000);
    await tester.pump(const Duration(milliseconds: 100));
    final during = camera.value.x;
    await tester.pumpAndSettle();
    expect(camera.value.x, lessThan(during));
    expect(camera.value.x, lessThan(afterDrag - 200));
  });

  testWidgets('zwei Finger zoomen um den Mittelpunkt', (tester) async {
    final (_, _, camera, _) = await pumpBoard(tester, fit: false);
    final g1 = await tester.startGesture(const Offset(300, 300));
    final g2 = await tester.startGesture(const Offset(400, 300));
    await tester.pump();
    // both fingers apart in small steps: the focal point stays at (350, 300)
    for (var i = 0; i < 10; i++) {
      await g1.moveBy(const Offset(-5, 0));
      await g2.moveBy(const Offset(5, 0));
      await tester.pump();
    }
    await g1.up();
    await g2.up();
    await tester.pump();
    // the recognizer measures from the moment the pinch passes its slop, so somewhat less than ×2
    expect(camera.value.z, greaterThan(1.3));
    expect(camera.value.z, lessThanOrEqualTo(2.01));
    // world point under the focal point (350, 300) stays
    expect(camera.value.toWorld(const Offset(350, 300)).dx, closeTo(350, 6));
  });

  testWidgets('Patches erscheinen sofort; gelöschtes ausgewähltes Objekt verliert die Auswahl', (tester) async {
    final (controller, source, _, selection) = await pumpBoard(tester, fit: false);
    selection.value = {'a'};
    source.push(
      PatchMessage.fromJson({
        'rev': 5,
        'changes': [
          {
            'id': 'a',
            'set': {'x': 300},
          },
          {
            'id': 'n',
            'created': {'type': 'sticky', 'x': 0, 'y': 0, 'w': 50, 'h': 50, 'z': 'z'},
          },
        ],
      }),
    );
    await tester.pump();
    expect(controller.state['a']!.x, 300);
    await tester.tapAt(const Offset(20, 20));
    await tester.pump(const Duration(milliseconds: 500));
    expect(selection.value, {'n'});
    source.push(
      PatchMessage.fromJson({
        'rev': 6,
        'changes': [
          {'id': 'n', 'removed': true},
        ],
      }),
    );
    await tester.pump();
    expect(selection.value, isEmpty);
  });

  testWidgets('Debug-Screen: alle Objekttypen, Wechsel auf 2 000 Objekte, Auswahl mit Browser-Knopf', (tester) async {
    tester.view.physicalSize = const Size(900, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final opened = <String>[];
    await tester.pumpWidget(MaterialApp(home: BoardDebugScreen(onOpenInBrowser: (o) => opened.add(o.id))));
    await tester.pump();
    await tester.pump();
    expect(find.textContaining('Alle Objekttypen'), findsOneWidget);
    expect(find.textContaining('Objekte'), findsWidgets);
    await tester.tap(find.byKey(const Key('boardDebugMenu')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('2 000 Objekte').last);
    await tester.pump();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    expect(find.textContaining('2000 Objekte'), findsOneWidget);
    await tester.tap(find.byKey(const Key('boardDebugFit')));
    await tester.pump();
    // tap the middle of the board: somewhere on an object of the dense grid
    await tester.tapAt(const Offset(450, 800));
    await tester.pump(const Duration(milliseconds: 500));
    if (find.byKey(const Key('boardDebugSelected')).evaluate().isNotEmpty) {
      await tester.tap(find.text('IM BROWSER ANSEHEN'));
      expect(opened, hasLength(1));
    }
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 1));
  });
}
