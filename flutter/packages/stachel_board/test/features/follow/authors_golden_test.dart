// Golden: board setting „Autor:in an Haftnotizen zeigen“ on a phone – the creator's name small at the bottom left of
// every note (own notes with my real name), on notes in the five new colors (Koralle, Mint, Türkis, Mittelblau,
// Steingrau) next to two old ones. Windows only: `flutter test --update-goldens test/features/follow/authors_golden_test.dart`.
@Tags(['golden'])
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import '../../test_fonts.dart';
import 'p5_harness.dart';

Map<String, Object?> _note(String id, double x, double y, String color, String text, String by) => {
  ...sticky(id, x, y, text: text, by: by),
  'w': 160,
  'h': 160,
  'color': color,
};

void main() {
  setUpAll(loadBoardFonts);

  testWidgets('Autor:in an jeder Notiz, neue Notizfarben', (tester) async {
    final b = await pumpP5(
      tester,
      objects: [
        _note('n1', 20, 40, '#fff27a', 'Bühne aufbauen', 'a:mara'),
        _note('n2', 200, 40, '#ff9e8a', 'Awareness-Zelt', 'a:jonas'),
        _note('n3', 20, 220, '#b9ecd8', 'Mehrweg-Becher', 'a:jonas'),
        _note('n4', 200, 220, '#7fd6e0', 'Shuttle vom Bahnhof', 'a:mara'),
        _note('n5', 20, 400, '#7fb2f0', 'Licht & Ton', 'a:lena'),
        _note('n6', 200, 400, '#d4d4cc', 'Kasse', 'a:mara'),
      ],
      ext: {
        'tools.settings': {'pattern': 'dots', 'authors': true},
      },
    );
    b.peers([peer('a:jonas', 'Jonas Brandt'), peer('a:lena', 'Lena', id: 2, color: '#1763b5')]);
    b.view.camera.value = const Camera(0, 40, 1);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('collabNoteAuthors')), findsOneWidget);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('../../goldens/p5_authors.png'));
  }, skip: !Platform.isWindows);
}
