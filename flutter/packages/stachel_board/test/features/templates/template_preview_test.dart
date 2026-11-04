// Previews of the template gallery: the frame titles are drawn in screen size above the frame, so the fit leaves room
// for them at the top – no title is cut off (web `previewBounds` has the title in its bounds). Golden of a gallery row
// on Windows only: `flutter test --update-goldens test/features/templates/template_preview_test.dart`.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/templates/template_model.dart';
import 'package:stachel_board/src/features/templates/template_previews.g.dart';
import 'package:stachel_board/src/features/templates/template_widgets.dart';

import '../../test_fonts.dart';

/// Every template of the gallery (generated from the web's `templates.json`).
final _ids = ((jsonDecode(templatePreviewsJson) as Map)['templates'] as Map).keys.cast<String>().toList();

Future<void> _pumpPreview(WidgetTester tester, String id, Size size) => tester.pumpWidget(
  MaterialApp(
    home: Align(
      alignment: Alignment.topLeft,
      child: SizedBox.fromSize(
        size: size,
        child: TemplatePreview(key: ValueKey(id), id: id),
      ),
    ),
  ),
);

Camera _camera(WidgetTester tester, String id) =>
    (tester.widget<CustomPaint>(find.byKey(Key('stachelTemplatePreview-$id'))).painter! as BoardPainter).camera.value;

void main() {
  setUpAll(loadBoardFonts);

  testWidgets('Rahmentitel ganz zu sehen: über dem obersten Rahmen bleibt Platz für den Titel', (tester) async {
    expect(_ids, contains('kanban'));
    var withFrames = 0;
    // preview area of a gallery cell on a phone (two columns), on a tablet (max. 220 px) and in the detail strip
    for (final size in const [Size(166, 110), Size(208, 150), Size(360, 160)]) {
      for (final id in _ids) {
        final objs = templateObjects(id);
        final frames = [
          for (final o in objs)
            if (o.type == 'frame') o,
        ];
        await _pumpPreview(tester, id, size);
        final cam = _camera(tester, id);
        if (frames.isEmpty) continue;
        withFrames++;
        final top = frames.map((f) => f.y).reduce((a, b) => a < b ? a : b);
        expect(
          cam.toScreen(Offset(0, top)).dy,
          greaterThanOrEqualTo(10 + 30),
          reason: '$id in $size: Titel braucht ≈ 30 px über dem Rahmen',
        );
        // everything stays inside the box
        final boxes = [
          for (final o in objs)
            if (o.type != 'connector') o,
        ];
        final b = Rect.fromLTRB(
          boxes.map((o) => o.x).reduce((a, b) => a < b ? a : b),
          boxes.map((o) => o.y).reduce((a, b) => a < b ? a : b),
          boxes.map((o) => o.x + o.w).reduce((a, b) => a > b ? a : b),
          boxes.map((o) => o.y + o.h).reduce((a, b) => a > b ? a : b),
        );
        final r = cam.rectToScreen(b);
        expect(r.bottom, lessThanOrEqualTo(size.height - 9), reason: '$id in $size unten');
        expect(r.left, greaterThanOrEqualTo(9), reason: '$id in $size links');
        expect(r.right, lessThanOrEqualTo(size.width - 9), reason: '$id in $size rechts');
      }
    }
    expect(withFrames, greaterThan(20));
  });

  testWidgets('ohne Rahmen bleibt die Einpassung wie bisher (10 px Rand)', (tester) async {
    const size = Size(210, 150);
    await _pumpPreview(tester, 'mindmap', size);
    final objs = templateObjects('mindmap');
    expect(objs.where((o) => o.type == 'frame'), isEmpty);
    expect(_camera(tester, 'mindmap'), isNot(equals(Camera.identity)));
  });

  testWidgets(
    'Golden: Galerie-Zeile mit Rahmentiteln',
    (tester) async {
      tester.view.physicalSize = const Size(660, 330);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      const ids = ['kanban', 'retro', 'swot', 'week', 'festival', 'journey'];
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          home: Scaffold(
            backgroundColor: Colors.white,
            body: GridView.count(
              key: const Key('gallery'),
              crossAxisCount: 3,
              padding: const EdgeInsets.all(12),
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              childAspectRatio: 1.4,
              children: [
                for (final id in ids)
                  Container(
                    decoration: BoxDecoration(
                      border: Border.all(color: const Color(0x22000000)),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    padding: const EdgeInsets.all(6),
                    child: TemplatePreview(key: ValueKey(id), id: id),
                  ),
              ],
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await expectLater(find.byType(MaterialApp), matchesGoldenFile('../../goldens/template_previews.png'));
    },
    skip: !Platform.isWindows,
    tags: ['golden'],
  );
}
