// Golden of PDF documents (P7) like the web's `DocumentView` + world slot: page image fitted in white paper, missing
// page („Seite 3 wird vorbereitet …“ with lines), file name top right and page bar „‹ n / N ›“ in constant size,
// rotated with the object, the upload placeholder „<Name> wird vorbereitet …“.
// Windows only: `flutter test --update-goldens test/features/documents/documents_golden_test.dart`.
@Tags(['golden'])
library;

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/documents/documents.dart';

import '../../test_fonts.dart';

Map<String, Object?> _doc(
  String id,
  double x,
  double y, {
  int page = 0,
  double rotation = 0,
  double w = 283,
  double h = 400,
}) => {
  'id': id,
  'type': 'document',
  'x': x,
  'y': y,
  'w': w,
  'h': h,
  'rotation': rotation,
  'docFile': 'f',
  'docName': id == 'a' ? 'Lageplan 2027.pdf' : 'Ablauf Samstag mit sehr langem Dateinamen.pdf',
  'docCount': 3,
  'docPage': page,
  'docPages': {'0': 'img'},
  'docRatios': [0.707, 1.415, 0.707],
  'imageId': ?(page == 0 ? 'img' : null),
  'z': 'a$id',
};

Future<ui.Image> _page() async {
  final rec = ui.PictureRecorder();
  final c = Canvas(rec);
  c.drawRect(const Rect.fromLTWH(0, 0, 141, 200), Paint()..color = Colors.white);
  c.drawRect(const Rect.fromLTWH(14, 16, 113, 18), Paint()..color = const Color(0xFF1763B5));
  for (var y = 50.0; y < 180; y += 14) {
    c.drawRect(Rect.fromLTWH(14, y, 100 + (y % 3) * 4, 5), Paint()..color = const Color(0xFFBBBBBB));
  }
  return rec.endRecording().toImage(141, 200);
}

void main() {
  setUpAll(() async {
    await loadBoardFonts();
  });

  testWidgets('Seite, fehlende Seite, Name, Seitenleiste (auch gedreht), Upload-Platzhalter', (tester) async {
    tester.view.physicalSize = const Size(1000, 620);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final objects = [_doc('a', 40, 80), _doc('b', 380, 120, page: 2, rotation: 8, w: 400, h: 283)];
    final source = FixtureBoardSource(
      BoardSnapshot(objects: [for (final o in objects) BoardObject(o)]),
      features: const ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'act'],
      actions: const {'documents.page': 1},
    );
    final controller = BoardController(source, presenceInterval: Duration.zero);
    final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController());
    final ui = BoardUi(editor: editor, registry: standardBoardRegistry());
    addTearDown(() {
      ui.dispose();
      editor.dispose();
      controller.dispose();
    });
    final images = MemoryBoardImages();
    final img = await tester.runAsync(_page);
    images.put('img', img!);
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
                  child: BoardView(
                    key: ui.viewKey,
                    controller: controller,
                    editor: editor,
                    images: images,
                    fitOnLoad: false,
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
    Documents.of(ui).uploads.value = [
      const DocUpload(key: 'u', rect: Rect.fromLTWH(820, 120, 160, 226), name: 'Programm.pdf'),
    ];
    for (var i = 0; i < 4; i++) {
      await tester.pump();
    }
    await expectLater(find.byKey(const Key('board')), matchesGoldenFile('goldens/documents.png'));
    Documents.of(ui).uploads.value = const [];
    await tester.pump();
  }, skip: !Platform.isWindows);
}
