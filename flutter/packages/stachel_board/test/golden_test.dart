// Goldens of the all-types fixture board (concept §6.3). Generated and checked on Windows only (fonts/raster
// differ per platform): `flutter test --update-goldens test/golden_test.dart` on Windows.
@Tags(['golden'])
library;

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import 'test_fonts.dart';

Future<void> _pumpBoard(WidgetTester tester, {required Camera camera, Size size = const Size(1200, 1000)}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final controller = BoardController(FixtureBoardSource(BoardSnapshot.fromJson(allTypesBoardJson())));
  addTearDown(controller.dispose);
  await controller.start();
  final images = MemoryBoardImages();
  await tester.runAsync(() async {
    final rec = ui.PictureRecorder();
    final c = Canvas(rec);
    c.drawRect(const Rect.fromLTWH(0, 0, 240, 160), Paint()..color = const Color(0xFF4F87E0));
    c.drawCircle(const Offset(170, 60), 30, Paint()..color = const Color(0xFFFFF27A));
    c.drawRect(const Rect.fromLTWH(0, 110, 240, 50), Paint()..color = const Color(0xFF5C940D));
    images.put('img-1', await rec.endRecording().toImage(240, 160));
  });
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      home: RepaintBoundary(
        key: const Key('board'),
        child: BoardView(controller: controller, camera: CameraController(camera), images: images, fitOnLoad: false),
      ),
    ),
  );
  // pictures are recorded within a budget per frame: pump until everything is recorded
  for (var i = 0; i < 5; i++) {
    await tester.pump();
  }
}

void main() {
  final windows = Platform.isWindows;

  setUpAll(() async {
    await loadBoardFonts();
    // due dates of cards relative to a fixed day (overdue, year), so the pictures do not change with the date
    cardNow = () => DateTime(2026, 11, 2);
  });

  testWidgets('alle Objekttypen – Übersicht', (tester) async {
    await _pumpBoard(tester, camera: const Camera(70, 90, 0.5));
    await expectLater(find.byKey(const Key('board')), matchesGoldenFile('goldens/all_types_overview.png'));
  }, skip: !windows);

  testWidgets('alle Objekttypen – Notizen, Text, Formen in 100 %', (tester) async {
    await _pumpBoard(tester, camera: const Camera(40, 60, 1));
    await expectLater(find.byKey(const Key('board')), matchesGoldenFile('goldens/all_types_top.png'));
  }, skip: !windows);

  testWidgets('alle Objekttypen – Struktur, Medien, Platzhalter in 100 %', (tester) async {
    await _pumpBoard(tester, camera: const Camera(40, -1060, 1), size: const Size(1800, 700));
    await expectLater(find.byKey(const Key('board')), matchesGoldenFile('goldens/all_types_bottom.png'));
  }, skip: !windows);

  testWidgets('alle Objekttypen – Rechts oben (Formen-Varianten, Verbinder, Stift, unbekannter Typ)', (tester) async {
    await _pumpBoard(tester, camera: const Camera(-1150, 40, 1), size: const Size(1100, 700));
    await expectLater(find.byKey(const Key('board')), matchesGoldenFile('goldens/all_types_right.png'));
  }, skip: !windows);

  testWidgets('weit herausgezoomt: flache Darstellung ohne Text', (tester) async {
    await _pumpBoard(tester, camera: const Camera(40, 40, 0.2), size: const Size(600, 500));
    await expectLater(find.byKey(const Key('board')), matchesGoldenFile('goldens/all_types_simple.png'));
  }, skip: !windows);
}
