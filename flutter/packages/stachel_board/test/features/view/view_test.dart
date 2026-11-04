// P4 view (parity audit M02–M03, M05–M06, M08, M10–M15): zoom bar and menu, zoom to the selection (animated, max
// 200 %), start camera on the phone (≥ 35 %), the view's center stays on resize, minimap (closed on the phone,
// remembered, tap jumps), board background from `tools.settings` (painted like the web, written with the web action),
// grid on/off, settings sheet, UI hidden with the eye, fullscreen.
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/view/board_background.dart';
import 'package:stachel_board/src/features/view/minimap.dart';
import 'package:stachel_board/src/features/view/view_camera.dart';

import 'p4_harness.dart';

Map<String, Object?> sticky(String id, double x, double y, {String text = ''}) => {
  'id': id,
  'type': 'sticky',
  'x': x,
  'y': y,
  'w': 200,
  'h': 200,
  'text': text,
};

Map<String, Object?> frame(String id, double x, double y, double w, double h, {String? title, String? slide}) => {
  'id': id,
  'type': 'frame',
  'x': x,
  'y': y,
  'w': w,
  'h': h,
  'title': ?title,
  'slide': ?slide,
  'color': '#ffffff',
};

void main() {
  group('Zoom-Leiste und Zoom-Menü (M02, M03)', () {
    testWidgets('− / + in Web-Stufen um die Bildmitte, Prozent zeigt den Zoom, Menü: 50/100/200 % und Einpassen', (
      tester,
    ) async {
      // UX-A1 (P9): the zoom bar is there from 700 dp on (tablet, landscape); a phone zooms with two fingers
      final b = await pumpP4(tester, objects: [sticky('a', 0, 0)], size: const Size(800, 760));
      b.view.camera.value = const Camera(0, 0, 0.8);
      await tester.pump();
      expect(find.byKey(const Key('stachelZoomBar')), findsOneWidget);
      expect(find.text('80 %'), findsOneWidget);
      final center = b.view.viewSize.center(Offset.zero);
      final world = b.cam.toWorld(center);
      await tester.tap(find.byKey(const Key('stachelZoomIn')));
      await tester.pump();
      expect(b.cam.z, 1.0);
      expect(b.cam.toWorld(center).dx, closeTo(world.dx, 1e-9), reason: 'Bildmitte bleibt');
      await tester.tap(find.byKey(const Key('stachelZoomIn')));
      await tester.pump();
      expect(b.cam.z, 1.25);
      await tester.tap(find.byKey(const Key('stachelZoomOut')));
      await tester.tap(find.byKey(const Key('stachelZoomOut')));
      await tester.pump();
      expect(b.cam.z, 0.75);
      expect(find.text('75 %'), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelZoomValue')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('stachelZoomMenu-200')));
      await tester.pumpAndSettle();
      expect(b.cam.z, 2.0);
      expect(b.cam.toWorld(center).dx, closeTo(world.dx, 1e-9));
      await tester.tap(find.byKey(const Key('stachelZoomValue')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('stachelZoomMenuFit')));
      await tester.pumpAndSettle();
      // M04: room for zoom bar and minimap like the web's `chromeInsets`
      const all = Rect.fromLTWH(0, 0, 200, 200);
      expect(b.cam, closeCam(Camera.fit(all, b.view.viewSize, padding: measuredFitPadding(b.ui, all, 1)!)));
    });

    testWidgets('Zoom-Leiste weg, solange etwas gewählt ist (dort sitzt die Kontextleiste)', (tester) async {
      final b = await pumpP4(tester, objects: [sticky('a', 0, 0)], size: const Size(800, 760));
      b.editor.select({'a'});
      await tester.pump();
      expect(find.byKey(const Key('stachelZoomBar')), findsNothing);
      b.editor.select(const {});
      await tester.pump();
      expect(find.byKey(const Key('stachelZoomBar')), findsOneWidget);
    });
  });

  testWidgets('Auf Auswahl zoomen (M05): animiert 280 ms, höchstens 200 %', (tester) async {
    final b = await pumpP4(tester, objects: [sticky('a', 1000, 500), sticky('b', 4000, 4000)]);
    b.editor.select({'a'});
    await tester.pump();
    final start = b.cam;
    expect(zoomToSelection(b.ui), isTrue);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(b.cam, isNot(closeCam(start)), reason: 'unterwegs');
    await tester.pump(const Duration(milliseconds: 300));
    final want = Camera.fit(
      const Rect.fromLTWH(1000, 500, 200, 200),
      b.view.viewSize,
      padding: fitInsets,
      maxZoomFit: 2,
    );
    expect(b.cam, closeCam(want));
    expect(want.z, lessThanOrEqualTo(2));
  });

  group('Start-Kamera am Handy (M06)', () {
    test('alles ≥ 35 % → wie „Alles zeigen“; sonst erster Rahmen; sonst 35 % links beginnend', () {
      final small = BoardState()
        ..applySnapshot(
          BoardSnapshot.fromJson({
            'objects': [sticky('a', 0, 0)],
          }),
          rev: 1,
          epoch: 'e',
        );
      expect(phoneStartCamera(small, const Rect.fromLTWH(0, 0, 200, 200), const Size(390, 700)), isNull);
      final wide = BoardState()
        ..applySnapshot(
          BoardSnapshot.fromJson({
            'objects': [
              sticky('a', 0, 0),
              sticky('b', 9000, 0),
              frame('f2', 3000, 0, 640, 420),
              frame('f1', 0, 300, 640, 420, slide: 'a0'),
            ],
          }),
          rev: 1,
          epoch: 'e',
        );
      const size = Size(390, 700);
      final cam = phoneStartCamera(wide, const Rect.fromLTWH(0, 0, 9200, 720), size)!;
      expect(cam, closeCam(Camera.fit(const Rect.fromLTWH(0, 300, 640, 420), size, padding: fitInsets, maxZoomFit: 1)));
      expect(cam.z, greaterThanOrEqualTo(phoneMinStartZoom));
      // no frame and too wide: 35 %, starting at the left edge, vertically centered
      final noFrame = BoardState()
        ..applySnapshot(
          BoardSnapshot.fromJson({
            'objects': [sticky('a', 0, 0), sticky('b', 9000, 0)],
          }),
          rev: 1,
          epoch: 'e',
        );
      final c2 = phoneStartCamera(noFrame, const Rect.fromLTWH(0, 0, 9200, 200), size)!;
      expect(c2.z, phoneMinStartZoom);
      expect(c2.x, 16);
      expect(
        phoneStartCamera(noFrame, const Rect.fromLTWH(0, 0, 9200, 200), const Size(800, 600)),
        isNull,
        reason: 'kein Handy',
      );
    });

    testWidgets('Board öffnet am Handy nicht unter 35 %; Drehen/Größe ändern: die Bildmitte bleibt', (tester) async {
      final b = await pumpP4(
        tester,
        fitOnLoad: true,
        objects: [sticky('a', 0, 0), sticky('b', 9000, 0), frame('f1', 4000, 0, 640, 420)],
      );
      await tester.pump();
      expect(b.cam.z, greaterThanOrEqualTo(phoneMinStartZoom));
      final center = b.cam.toWorld(b.view.viewSize.center(Offset.zero));
      tester.view.physicalSize = const Size(760, 390);
      await tester.pump();
      await tester.pump();
      final after = b.cam.toWorld(b.view.viewSize.center(Offset.zero));
      expect(after.dx, closeTo(center.dx, 1e-6));
      expect(after.dy, closeTo(center.dy, 1e-6));
    });
  });

  group('Übersichtskarte (M08)', () {
    testWidgets('am Handy eingeklappt; Aufklappen wird gemerkt; Antippen springt hin, Sichtbereich ziehen verschiebt', (
      tester,
    ) async {
      final b = await pumpP4(
        tester,
        objects: [
          sticky('a', 0, 0),
          sticky('b', 3000, 2000),
          frame('f', 1000, 1000, 640, 420, title: 'Bühne'),
        ],
      );
      expect(find.byKey(const Key('stachelMinimap')), findsNothing);
      await tester.tap(find.byKey(const Key('stachelMinimapToggle')));
      await tester.pump();
      expect(find.byKey(const Key('stachelMinimap')), findsOneWidget);
      expect(BoardPrefs.get(BoardPrefs.minimap), 'open');
      final z = b.cam.z;
      final map = tester.getRect(find.byKey(const Key('stachelMinimap')));
      await tester.tapAt(map.center);
      await tester.pump();
      expect(b.cam.z, z, reason: 'nur verschieben');
      final mid = b.cam.toWorld(b.view.viewSize.center(Offset.zero));
      // the map shows content + view: its center is somewhere inside the content's area
      expect(mid.dx, inInclusiveRange(-500, 3700));
      final before = b.cam;
      await tester.dragFrom(map.center, const Offset(20, 0));
      await tester.pump();
      expect(b.cam.x, lessThan(before.x), reason: 'Sichtbereich nach rechts gezogen → Ansicht wandert nach rechts');
      await tester.tap(find.byKey(const Key('stachelMinimapToggle')));
      await tester.pump();
      expect(BoardPrefs.get(BoardPrefs.minimap), 'closed');
      expect(find.byKey(const Key('stachelMinimap')), findsNothing);
    });

    test('Kartenausschnitt bleibt stehen, solange Inhalt und Sicht hineinpassen (web nextFrame)', () {
      final a = nextMapFrame(null, const Rect.fromLTWH(0, 0, 1000, 500), const Rect.fromLTWH(100, 100, 300, 300));
      expect(nextMapFrame(a, const Rect.fromLTWH(0, 0, 1000, 500), const Rect.fromLTWH(200, 100, 300, 300)), same(a));
      expect(
        nextMapFrame(a, const Rect.fromLTWH(0, 0, 1000, 500), const Rect.fromLTWH(5000, 100, 300, 300)),
        isNot(same(a)),
      );
      expect(
        a.scale,
        closeTo(
          minimapW / a.world.width < minimapH / a.world.height ? minimapW / a.world.width : minimapH / a.world.height,
          1e-9,
        ),
      );
    });
  });

  group('Hintergrund und Board-Einstellungen (M10–M12)', () {
    testWidgets('Hintergrund aus tools.settings im Painter (Haken), Einstellungs-Blatt schreibt per Web-Aktion', (
      tester,
    ) async {
      final b = await pumpP4(
        tester,
        objects: [sticky('a', 0, 0)],
        ext: {
          'tools.settings': {'pattern': 'lines', 'color': '#FBF6E9'},
        },
      );
      expect(b.view.renderContext.background, isNotNull);
      expect(boardSettingsOf(b.ui), const BoardSettings(pattern: 'lines', color: '#fbf6e9'));
      await boardMenu(tester, 'stachelBoardSettings');
      expect(find.byKey(const Key('stachelSettingsSheet')), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelBgColor-#e9f1f8')));
      await tester.pump();
      expect(b.ops.last, {
        'op': 'act',
        'name': 'tools.settings',
        'args': {'color': '#e9f1f8'},
        'key': b.ops.last['key'],
      });
      b.confirm(
        ext: {
          'tools.settings': {'pattern': 'lines', 'color': '#e9f1f8'},
        },
      );
      await tester.pump();
      expect(boardSettingsOf(b.ui).color, '#e9f1f8');
      await tester.tap(find.byKey(const Key('stachelPattern-dots')));
      await tester.pump();
      expect((b.ops.last['args'] as Map)['pattern'], 'dots');
      // „Am Raster einrasten“ only for me (stored on the device)
      await tester.tap(find.byKey(const Key('stachelSnapSwitch')));
      await tester.pump();
      expect(snapToGridPref, isTrue);
    });

    testWidgets('„Autor:in an Haftnotizen zeigen“: Schalter für alle per Web-Aktion (ab Version 2), sonst gesperrt', (
      tester,
    ) async {
      final b = await pumpP4(tester, objects: [sticky('a', 0, 0)], actions: const {'tools.settings': 2});
      expect(boardSettingsOf(b.ui).authors, isFalse);
      await boardMenu(tester, 'stachelBoardSettings');
      final sw = find.byKey(const Key('stachelAuthorsSwitch'));
      await tester.ensureVisible(sw);
      expect(tester.widget<SwitchListTile>(sw).value, isFalse);
      await tester.tap(sw);
      await tester.pump();
      expect(b.ops.last['name'], 'tools.settings');
      expect(b.ops.last['args'], {'authors': true});
      b.confirm(
        ext: {
          'tools.settings': {'pattern': 'dots', 'authors': true},
        },
      );
      await tester.pump();
      expect(boardSettingsOf(b.ui).authors, isTrue);
      expect(tester.widget<SwitchListTile>(sw).value, isTrue);
    });

    testWidgets('„Autor:in an Haftnotizen zeigen“ gesperrt bei älterem Server (tools.settings Version 1)', (tester) async {
      await pumpP4(tester, objects: [sticky('a', 0, 0)]);
      await boardMenu(tester, 'stachelBoardSettings');
      final sw = find.byKey(const Key('stachelAuthorsSwitch'));
      await tester.ensureVisible(sw);
      expect(tester.widget<SwitchListTile>(sw).onChanged, isNull);
    });

    testWidgets('Raster ein/aus im Board-Menü (An/Aus) und auf der leeren Fläche', (tester) async {
      final b = await pumpP4(tester, objects: [sticky('a', 0, 0)]);
      await tester.tap(find.byKey(const Key('stachelBoardMenu')));
      await tester.pumpAndSettle();
      expect(find.text('Raster anzeigen'), findsOneWidget);
      expect(find.text('An'), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelBoardGrid')));
      await tester.pumpAndSettle();
      expect(b.ops.last['args'], {'toggleGrid': true});
      b.confirm(
        ext: {
          'tools.settings': {'pattern': 'none', 'lastPattern': 'dots'},
        },
      );
      await tester.pump();
      // long press on the empty board → „Raster einblenden“
      await tester.longPressAt(const Offset(300, 300));
      await tester.pumpAndSettle();
      expect(find.text('Raster einblenden'), findsOneWidget);
      expect(find.text('Hintergrund & Raster …'), findsOneWidget);
      expect(find.text('Auf dem Board suchen'), findsOneWidget);
    });

    testWidgets('ohne Web-Aktion (älterer Server) bzw. nur lesen: keine Raster-Einträge', (tester) async {
      await pumpP4(tester, actions: const {});
      await tester.tap(find.byKey(const Key('stachelBoardMenu')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelBoardGrid')), findsNothing);
    });

    test('Muster wie im Web: Punkte im 24er-Raster (≥ 14 px), Linien, leer; Farbe als Grund', () async {
      Future<ui.Image> render(BoardSettings s, Camera cam) {
        final rec = ui.PictureRecorder();
        paintBoardBackground(Canvas(rec), const Size(48, 48), cam, s);
        return rec.endRecording().toImage(48, 48);
      }

      Future<List<int>> px(ui.Image img, int x, int y) async {
        final d = (await img.toByteData())!;
        final i = (y * img.width + x) * 4;
        return [d.getUint8(i), d.getUint8(i + 1), d.getUint8(i + 2)];
      }

      final none = await render(const BoardSettings(pattern: 'none', color: '#e9f1f8'), Camera.identity);
      expect(await px(none, 1, 1), [0xe9, 0xf1, 0xf8]);
      final dots = await render(const BoardSettings(), Camera.identity);
      expect(await px(dots, 10, 10), [0xf3, 0xf3, 0xef]);
      expect((await px(dots, 25, 25))[0], lessThan(0xf3), reason: 'Punkt bei 24 + Radius');
      final lines = await render(const BoardSettings(pattern: 'lines'), Camera.identity);
      expect((await px(lines, 24, 10))[0], lessThan(0xf3));
      expect(await px(lines, 12, 10), [0xf3, 0xf3, 0xef]);
    });
  });

  group('Oberfläche ausblenden und Vollbild (M14, M15)', () {
    testWidgets('ausblenden: Leisten weg, Hinweis, Auge holt sie zurück', (tester) async {
      final b = await pumpP4(tester, objects: [sticky('a', 0, 0)]);
      final messages = <String>[];
      expect(find.byType(AppBar), findsOneWidget);
      await boardMenu(tester, 'stachelBoardHideUi');
      expect(BoardViewPrefs.of(b.ui).chromeHidden.value, isTrue);
      expect(find.byType(AppBar), findsNothing);
      expect(find.byKey(const Key('stachelZoomBar')), findsNothing);
      expect(find.byType(BoardToolbar), findsNothing);
      expect(messages, isEmpty);
      await tester.tap(find.byKey(const Key('stachelShowUi')));
      await tester.pump();
      expect(find.byType(AppBar), findsOneWidget);
      expect(find.byKey(const Key('stachelShowUi')), findsNothing);
    });

    testWidgets('Vollbild = immersiv (Systemleisten weg), Menü heißt dann „Vollbild beenden“; Verlassen beendet es', (
      tester,
    ) async {
      final calls = <bool>[];
      final b = await pumpP4(tester, objects: [sticky('a', 0, 0)]);
      BoardViewPrefs.setSystemImmersive = (on) async => calls.add(on);
      await boardMenu(tester, 'stachelBoardFullscreen');
      expect(calls, [true]);
      await tester.tap(find.byKey(const Key('stachelBoardMenu')));
      await tester.pumpAndSettle();
      expect(find.text('Vollbild beenden'), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelBoardFullscreen')));
      await tester.pumpAndSettle();
      expect(calls, [true, false]);
      BoardViewPrefs.of(b.ui).setImmersive(true);
      await tester.pumpWidget(const SizedBox());
      expect(calls.last, isFalse, reason: 'Board verlassen beendet das Vollbild');
    });
  });
}
