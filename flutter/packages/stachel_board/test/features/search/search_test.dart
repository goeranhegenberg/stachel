// P4 search on the board (parity audit M13): from the board menu and the empty board's menu, hits in reading order
// („i von n“, ↑/↓, search key = next, „Keine Treffer“), umlaut/accent tolerant, frame titles/tags/assignee, the camera
// moves only when the hit is not well visible, „Alle wählen“ selects all hits and closes, back closes.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import '../view/p4_harness.dart';

const _objects = [
  {'id': 'n1', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'Bühne aufbauen'},
  {
    'id': 'n2',
    'type': 'sticky',
    'x': 3000,
    'y': 0,
    'w': 200,
    'h': 200,
    'text': 'Kasse',
    'tags': [
      {'label': 'Buehne', 'color': '#1763b5'},
    ],
  },
  {'id': 'f1', 'type': 'frame', 'x': 0, 'y': 2000, 'w': 640, 'h': 420, 'title': 'BÜHNE Süd', 'color': '#ffffff'},
  {
    'id': 'c1',
    'type': 'card',
    'x': 600,
    'y': 0,
    'w': 300,
    'h': 96,
    'text': 'Zelte',
    'assignee': {'key': 'k', 'name': 'Mara'},
  },
  {'id': 'h1', 'type': 'sticky', 'x': 0, 'y': 400, 'w': 200, 'h': 200, 'text': 'Bühne versteckt', 'hidden': true},
];

void main() {
  testWidgets('Suchen: Treffer in Lesereihenfolge, ↑/↓, Kamera nur bei Bedarf, Alle wählen', (tester) async {
    final b = await pumpP4(tester, objects: _objects);
    b.view.camera.value = const Camera(100, 200, 1);
    await boardMenu(tester, 'stachelBoardSearch');
    expect(find.byKey(const Key('stachelSearchBar')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('stachelSearchField')), 'buhne');
    await tester.pumpAndSettle();
    // n1 (top left), n2 (tag „Buehne“, top right), f1 (frame title, further down); the hidden note is not found
    expect(find.text('1 von 3'), findsOneWidget);
    expect(b.cam, closeCam(const Camera(100, 200, 1)), reason: 'n1 ist gut sichtbar: Kamera bleibt');
    await tester.tap(find.byKey(const Key('stachelSearchNext')));
    await tester.pumpAndSettle();
    expect(find.text('2 von 3'), findsOneWidget);
    final c = b.cam;
    final n2 = c.rectToScreen(const Rect.fromLTWH(3000, 0, 200, 200));
    expect(n2.center.dx, closeTo(b.view.viewSize.width / 2, 1), reason: 'zum Treffer gefahren (gleicher Zoom)');
    expect(c.z, 1);
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(find.text('3 von 3'), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelSearchPrev')));
    await tester.pumpAndSettle();
    expect(find.text('2 von 3'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('stachelSearchField')), 'mara');
    await tester.pumpAndSettle();
    expect(find.text('1 von 1'), findsOneWidget, reason: 'zuständige Person der Karte');
    await tester.enterText(find.byKey(const Key('stachelSearchField')), 'xyz');
    await tester.pumpAndSettle();
    expect(find.text('Keine Treffer'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('stachelSearchField')), 'bühne');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelSearchAll')));
    await tester.pumpAndSettle();
    expect(b.editor.selection.value, {'n1', 'n2', 'f1'});
    expect(find.byKey(const Key('stachelSearchBar')), findsNothing);
  });

  testWidgets('aus dem Menü der leeren Fläche; Zurück schließt die Suche', (tester) async {
    await pumpP4(tester, objects: _objects);
    await tester.longPressAt(tester.getTopLeft(find.byType(BoardView)) + const Offset(300, 500));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelCanvasSearch')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelSearchBar')), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelSearchBar')), findsNothing);
  });
}
