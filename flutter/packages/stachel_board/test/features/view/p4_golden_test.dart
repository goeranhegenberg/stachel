// Goldens of P4 on a phone: board background „Linien“ on „Papier“ with zoom bar and open minimap (frames with titles,
// notes, connector), the search bar with highlighted hits, and the presentation bar over a fitted frame.
// Windows only: `flutter test --update-goldens test/features/view/p4_golden_test.dart`.
@Tags(['golden'])
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import '../../test_fonts.dart';
import 'p4_harness.dart';

const _objects = [
  {'id': 'f1', 'type': 'frame', 'x': 0, 'y': 0, 'w': 640, 'h': 420, 'title': 'Bühne', 'color': '#ffffff', 'z': 'a0'},
  {
    'id': 'f2',
    'type': 'frame',
    'x': 800,
    'y': 0,
    'w': 640,
    'h': 420,
    'title': 'Einlass',
    'color': '#e2d5ff',
    'z': 'a1',
  },
  {'id': 'n1', 'type': 'sticky', 'x': 40, 'y': 60, 'w': 200, 'h': 200, 'text': 'Bühne aufbauen', 'z': 'a2'},
  {'id': 'n2', 'type': 'sticky', 'x': 300, 'y': 60, 'w': 200, 'h': 200, 'text': 'Licht', 'color': '#9fd3ff', 'z': 'a3'},
  {
    'id': 'n3',
    'type': 'sticky',
    'x': 860,
    'y': 60,
    'w': 200,
    'h': 200,
    'text': 'Kasse Bühne',
    'color': '#ffb3d1',
    'z': 'a4',
  },
  {
    'id': 'c',
    'type': 'connector',
    'from': {'objectId': 'n1', 'side': 'e'},
    'to': {'objectId': 'n3', 'side': 'w'},
    'z': 'a5',
  },
];

void main() {
  setUpAll(loadBoardFonts);

  testWidgets('Hintergrund, Zoom-Leiste, Übersichtskarte, Suche', (tester) async {
    final b = await pumpP4(
      tester,
      objects: _objects,
      ext: {
        'tools.settings': {'pattern': 'lines', 'color': '#fbf6e9'},
      },
    );
    BoardPrefs.set(BoardPrefs.minimap, 'open');
    b.view.camera.value = const Camera(20, 120, 0.45);
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('../../goldens/p4_view.png'));
    openSearch(b.ui);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('stachelSearchField')), 'bühne');
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('../../goldens/p4_search.png'));
  }, skip: !Platform.isWindows);

  testWidgets('Präsentation', (tester) async {
    final b = await pumpP4(tester, objects: _objects);
    Presentation.of(b.ui).start(1);
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('../../goldens/p4_present.png'));
  }, skip: !Platform.isWindows);
}
