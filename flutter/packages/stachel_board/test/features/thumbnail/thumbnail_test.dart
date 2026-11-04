// P6 preview image (audit N09): the part of the board like the web's `thumbRect` (`tools.test.ts`, `collab4.test.ts`),
// rendering 560 × 260 PNG and the uploader: nothing before the first sync, once after it, after changes only after the
// quiet time and at most every 30 s, the last state when leaving; no host → no overlay.
import 'dart:typed_data';
import 'dart:ui' as dui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/src/features/thumbnail/thumbnail.dart';
import 'package:stachel_board/stachel_board.dart';

class _Host extends BoardHost implements BoardAdminHost {
  final uploads = <(int, String)>[];

  @override
  String errorText(Object error) => '$error';
  @override
  bool get isTemplate => false;
  @override
  String get boardTitle => 'Festival';
  @override
  Future<void> duplicateBoard() async {}
  @override
  Future<void> saveAsTemplate() async {}
  @override
  Future<List<BoardVersion>> listVersions() async => const [];
  @override
  Future<BoardVersion> saveVersion(String name) => throw UnimplementedError();
  @override
  Future<BoardVersion> renameVersion(String id, String name) => throw UnimplementedError();
  @override
  Future<bool> restoreVersion(String id) async => true;
  @override
  Future<void> openVersionCopy(String id, String title) async {}
  @override
  Future<Map<String, Object?>> versionSnapshot(String id) async => const {};
  @override
  Future<void> shareFile(Uint8List bytes, String fileName, String mimeType) async {}
  @override
  Future<String?> uploadThumbnail(Uint8List bytes, String mimeType) async {
    uploads.add((bytes.length, mimeType));
    return '2026-11-02T10:00:00Z';
  }

  @override
  Future<McpTokens> listTokens() async => const McpTokens([], '');
  @override
  Future<McpNewToken> createToken(String label) => throw UnimplementedError();
  @override
  Future<void> revokeToken(String id) async {}
  @override
  Future<void> shareText(String text, {String? subject}) async {}
  @override
  Future<void> copyText(String text) async {}
}

BoardObject _o(Map<String, Object?> m) => BoardObject({'x': 0, 'y': 0, 'w': 100, 'h': 100, ...m});
Rect _rect(BoardObject o) => Rect.fromLTWH(o.x, o.y, o.w, o.h);

const _note = {'id': 'n1', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'z': 'a1', 'color': '#ff0000'};

void main() {
  group('Ausschnitt wie im Web (thumbRect)', () {
    test('Seitenverhältnis der Karte, Inhalt in der Mitte; leer = null', () {
      final r = thumbRect([_o({'id': 'a', 'type': 'sticky'})], _rect)!;
      expect(r.width / r.height, closeTo(thumbWidth / thumbHeight, 1e-9));
      expect(r.center.dx, closeTo(50, 1e-9));
      expect(r.center.dy, closeTo(50, 1e-9));
      expect(thumbRect(const [], _rect), isNull);
    });

    test('Platz für den Rahmentitel oberhalb des Rahmens (x-display B14)', () {
      final frame = _o({'id': 'f', 'type': 'frame', 'w': 400, 'h': 200, 'title': 'Lageplan'});
      expect(thumbRect([frame], _rect)!.top, greaterThan(-40));
      final r = thumbRect([frame], _rect, titleSpace: 40)!;
      expect(r.top, lessThanOrEqualTo(-40));
      expect(r.bottom, greaterThanOrEqualTo(200));
    });

    test('Rand: mindestens 24, sonst 4 % der größeren Seite', () {
      // 1000 wide → margin 40 → 1080 wide, height 1080 / (560/260)
      final r = thumbRect([_o({'id': 'a', 'type': 'sticky', 'w': 1000, 'h': 100})], _rect)!;
      expect(r.left, closeTo(-40, 1e-9));
      expect(r.width, closeTo(1080, 1e-9));
    });
  });

  group('Hochladen', () {
    late FixtureBoardSource source;
    late BoardController controller;
    late BoardUi ui;
    late _Host host;

    Future<void> setUpBoard(WidgetTester tester, {BoardHost? withHost, bool connect = true}) async {
      host = _Host();
      source = FixtureBoardSource(BoardSnapshot.fromJson({'objects': [_note]}), rev: 1);
      controller = BoardController(source, presenceInterval: Duration.zero);
      final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController());
      ui = BoardUi(editor: editor, registry: standardBoardRegistry(), host: withHost ?? host);
      if (connect) await controller.start();
      await tester.pumpWidget(
        MaterialApp(
          home: BoardUiScope(ui: ui, child: BoardOverlays(ui: ui)),
        ),
      );
    }

    /// Lets the real rendering (toImage, toByteData) finish between fake-time steps.
    Future<void> settle(WidgetTester tester) async {
      for (var i = 0; i < 6; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 40)));
        await tester.pump();
      }
    }

    void tearDownBoard() {
      ui.dispose();
      ui.editor.dispose();
      controller.dispose();
    }

    testWidgets('PNG 560 × 260 mit dem Board', (tester) async {
      await setUpBoard(tester);
      final png = (await tester.runAsync(() => renderThumbnail(ui, imageWait: Duration.zero)))!;
      final codec = (await tester.runAsync(() => dui.instantiateImageCodec(png)))!;
      final frame = (await tester.runAsync(codec.getNextFrame))!;
      expect((frame.image.width, frame.image.height), (thumbWidth, thumbHeight));
      final data = (await tester.runAsync(() => frame.image.toByteData(format: dui.ImageByteFormat.rawStraightRgba)))!;
      // middle of the image = the red note
      final i = (thumbHeight ~/ 2 * thumbWidth + thumbWidth ~/ 2) * 4;
      expect(data.getUint8(i), greaterThan(200));
      expect(data.getUint8(i + 2), lessThan(60));
      frame.image.dispose();
      tearDownBoard();
    });

    testWidgets('nach dem ersten Sync einmal, Änderungen erst nach 4 s Ruhe und höchstens alle 30 s, beim Verlassen',
        (tester) async {
      await setUpBoard(tester);
      expect(host.uploads, isEmpty);
      await tester.pump(const Duration(milliseconds: 1400));
      await settle(tester);
      expect(host.uploads, isEmpty);
      await tester.pump(const Duration(milliseconds: 200));
      await settle(tester);
      expect(host.uploads.length, 1);
      expect(host.uploads.single.$2, 'image/png');

      // a change by someone else: after the quiet time, but the 30 s gap holds it back
      source.push(PatchMessage(rev: 2, by: 'm:7', changes: [ObjectUpdated('n1', const {'x': 50}, const [])]));
      await tester.pump(const Duration(seconds: 5));
      await settle(tester);
      expect(host.uploads.length, 1);
      await tester.pump(const Duration(seconds: 30));
      await settle(tester);
      expect(host.uploads.length, 2);

      // another change, then leave before the quiet time ends: uploaded on leaving
      source.push(PatchMessage(rev: 3, by: 'm:7', changes: [ObjectUpdated('n1', const {'x': 80}, const [])]));
      await tester.pump(const Duration(seconds: 1));
      await tester.pumpWidget(const SizedBox());
      await settle(tester);
      expect(host.uploads.length, 3);
      tearDownBoard();
    });

    testWidgets('ohne Server-Stand (nicht verbunden) und ohne Host der App: nichts', (tester) async {
      await setUpBoard(tester, connect: false);
      await tester.pump(const Duration(seconds: 10));
      await tester.pumpWidget(const SizedBox());
      expect(host.uploads, isEmpty);
      tearDownBoard();

      await setUpBoard(tester, withHost: const BoardHost());
      await tester.pump(const Duration(seconds: 10));
      expect(find.byType(ThumbnailUploader), findsNothing);
      tearDownBoard();
    });
  });
}
