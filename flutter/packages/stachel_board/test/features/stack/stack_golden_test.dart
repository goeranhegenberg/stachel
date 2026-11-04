// Golden of note stacks (Q2, web `shapes/stack/view.tsx` + `stack.css`): paper edges below the top note (same color a
// little darker, 5 and 10 px), the count at the top right inside the top note; the selected stack in blue with ‹ ›.
// Windows only: `flutter test --update-goldens test/features/stack/stack_golden_test.dart`.
@Tags(['golden'])
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import '../../test_fonts.dart';

Map<String, Object?> _note(String id, double x, String color, String text, {String? stack}) => {
  'id': id,
  'type': 'sticky',
  'x': x,
  'y': 40,
  'w': 200,
  'h': 200,
  'text': text,
  'color': color,
  'z': 'a$id',
  if (stack != null) ...{'groupId': stack, 'stacked': true},
};

void main() {
  setUpAll(() async {
    await loadBoardFonts();
  });

  testWidgets('Stapel mit Papierkanten und Zahl, gewählter Stapel mit ‹ ›, einzelne Notiz', (tester) async {
    tester.view.physicalSize = const Size(820, 320);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final objects = [
      _note('a', 40, '#9fd3ff', 'unten', stack: 'g1'),
      _note('b', 40, '#ffb3d1', 'Mitte', stack: 'g1'),
      _note('c', 40, '#fff27a', 'Shuttle vom Bahnhof?', stack: 'g1'),
      _note('d', 320, '#c9e14a', 'eins', stack: 'g2'),
      _note('e', 320, '#c9e14a', 'Awareness-Team Schichtplan', stack: 'g2'),
      _note('f', 600, '#ffd08a', 'Einzelne Notiz'),
    ];
    final source = FixtureBoardSource(
      BoardSnapshot(objects: [for (final o in objects) BoardObject(o)]),
      features: const ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'act'],
      actions: const {'shapes.stackDrop': 1, 'shapes.stackCycle': 1, 'shapes.stackSpread': 1, 'shapes.stackTake': 1},
    );
    final controller = BoardController(source, presenceInterval: Duration.zero);
    final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController());
    final ui = BoardUi(editor: editor, registry: standardBoardRegistry());
    addTearDown(() {
      ui.dispose();
      editor.dispose();
      controller.dispose();
    });
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        home: BoardUiScope(
          ui: ui,
          child: RepaintBoundary(
            key: const Key('board'),
            child: Stack(
              children: [
                Positioned.fill(
                  child: BoardView(key: ui.viewKey, controller: controller, editor: editor, fitOnLoad: false),
                ),
                Positioned.fill(child: BoardOverlays(ui: ui)),
              ],
            ),
          ),
        ),
      ),
    );
    await controller.start();
    editor.select({'d', 'e'});
    for (var i = 0; i < 4; i++) {
      await tester.pump();
    }
    await expectLater(find.byKey(const Key('board')), matchesGoldenFile('goldens/stack.png'));
  }, skip: !Platform.isWindows);
}
