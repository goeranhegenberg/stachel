// Rauchtest der Desktop-App (Windows/Linux, docs/release/desktop.md): startet die echte App wie main.dart (echte Plugins,
// echtes Fenster), prüft die Anmeldeseite und – mit Sandbox – Anmeldung, Board-Liste und ein Board, dann Maus und
// Tastatur (docs/features/desktop.md: Auswahl, Rechtsklick-Menüs, Befehlspalette, Kürzel, Dunkelmodus). Bildschirmfotos
// der Stationen landen mit STACHEL_SHOTS als PNG in diesem Ordner.
//
//   MSYS_NO_PATHCONV=1 server/node_modules/.bin/tsx tools/sandbox.mts 8871 --local --seed
//   flutter test integration_test/desktop_smoke_test.dart -d windows --dart-define=STACHEL_BASE=http://127.0.0.1:8871
//     --dart-define=STACHEL_SHOTS=<ordner>
//
// Ohne STACHEL_BASE läuft nur der erste Teil (Anmeldeseite gegen die Standard-Instanz, ohne Anmeldung).
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel/main.dart' as app;
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_client/stachel_client.dart';

const _sandbox = String.fromEnvironment('STACHEL_BASE');
const _shots = String.fromEnvironment('STACHEL_SHOTS');
const _password = 'Stachel-Probe-2026';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Desktop: App startet, Anmeldung, Board-Liste, Board', (tester) async {
    // fresh start: no stored login of an earlier run
    await (await SharedPreferences.getInstance()).clear();
    await StachelSession.clear();

    app.main();
    await _until(tester, find.byKey(const Key('loginEmail')));
    expect(find.byKey(const Key('loginSubmit')), findsOneWidget);
    // desktop: no camera, drag and drop instead of the share target
    expect(stachelHasCamera, isFalse);
    await _shot(tester, 'desktop_login');

    if (_sandbox.isEmpty) return;
    await tester.enterText(find.byKey(const Key('loginEmail')), 'owner@sandbox.test');
    await tester.enterText(find.byKey(const Key('loginPassword')), _password);
    await tester.tap(find.byKey(const Key('loginSubmit')));
    await _until(tester, find.text('Geteiltes Board'));
    await _shot(tester, 'desktop_boards');

    await tester.tap(find.text('Geteiltes Board').first);
    // the board is live once the toolbar is there; then give images and the PDF a moment
    await _until(tester, find.byType(CustomPaint), seconds: 30);
    await _pumpFor(tester, const Duration(seconds: 6));
    // first board: the short introduction comes up – skip it for the picture
    final skip = find.text('Überspringen');
    if (skip.evaluate().isNotEmpty) {
      // desktop: mouse and keyboard instead of finger gestures
      expect(find.text('Ansicht bewegen'), findsOneWidget);
      await _shot(tester, 'desktop_onboarding');
      await tester.tap(skip.first);
      await _pumpFor(tester, const Duration(seconds: 1));
    }
    expect(tester.takeException(), isNull);
    await _shot(tester, 'desktop_board');
    await _desktopTour(tester);
  });
}

/// Mouse and keyboard on the board (docs/features/desktop.md): selection with the floating context bar, right click
/// on an object and on the empty board (popups), command palette, shortcut list, dark mode – one picture each.
Future<void> _desktopTour(WidgetTester tester) async {
  final view = tester.state<BoardViewState>(find.byType(BoardView));
  final editor = view.editor;
  final cam = editor.camera.value;
  final box = tester.getRect(find.byType(BoardView));
  // the largest sticky note in view (the seed board's „Sommerfest“ notes)
  final notes = [
    for (final o in editor.controller.state.objects.values)
      if (o.type == 'sticky' && box.contains(box.topLeft + cam.toScreen(objectRect(o).center))) o,
  ]..sort((a, b) => (b.w * b.h).compareTo(a.w * a.h));
  expect(notes, isNotEmpty);
  final note = box.topLeft + cam.toScreen(objectRect(notes.first).center);
  final mouse = TestPointer(7, PointerDeviceKind.mouse);
  await tester.sendEventToBinding(mouse.hover(note));
  await tester.tapAt(note, kind: PointerDeviceKind.mouse);
  await _pumpFor(tester, const Duration(milliseconds: 600));
  expect(editor.selection.value, {notes.first.id});
  await _shot(tester, 'desktop_selection');

  // right click on the note: its menu at the pointer
  await tester.tapAt(note, kind: PointerDeviceKind.mouse, buttons: kSecondaryMouseButton);
  await _pumpFor(tester, const Duration(milliseconds: 600));
  expect(find.byKey(const Key('stachelMenuCopy')), findsOneWidget);
  await _shot(tester, 'desktop_object_menu');
  await tester.sendKeyEvent(LogicalKeyboardKey.escape);
  await _pumpFor(tester, const Duration(milliseconds: 400));

  // right click on the empty board (far from everything): the board's menu
  final empty = _emptySpot(tester, view, box);
  await tester.tapAt(empty, kind: PointerDeviceKind.mouse, buttons: kSecondaryMouseButton);
  await _pumpFor(tester, const Duration(milliseconds: 600));
  expect(find.byKey(const Key('stachelSelectAll')), findsOneWidget);
  await _shot(tester, 'desktop_canvas_menu');
  await tester.sendKeyEvent(LogicalKeyboardKey.escape);
  await _pumpFor(tester, const Duration(milliseconds: 400));

  // Strg Umschalt K: command palette (Strg K on a selected note is „Link einfügen“ like the web; the note stays
  // selected – no second click, that would be a double click: the test events carry no time)
  expect(editor.selection.value, {notes.first.id});
  await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
  await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
  await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
  await _pumpFor(tester, const Duration(milliseconds: 600));
  expect(find.byKey(const Key('stachelPaletteSheet')), findsOneWidget);
  await _shot(tester, 'desktop_palette');
  await tester.sendKeyEvent(LogicalKeyboardKey.escape);
  await _pumpFor(tester, const Duration(milliseconds: 400));

  // Strg / (like ?): all shortcuts
  await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
  await tester.sendKeyEvent(LogicalKeyboardKey.slash);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
  await _pumpFor(tester, const Duration(milliseconds: 600));
  expect(find.byKey(const Key('stachelShortcuts')), findsOneWidget);
  await _shot(tester, 'desktop_shortcuts');
  await tester.sendKeyEvent(LogicalKeyboardKey.escape);
  await _pumpFor(tester, const Duration(milliseconds: 400));

  // dark mode (follows the system): bars dark, the board stays light
  tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
  await _pumpFor(tester, const Duration(seconds: 1));
  // a click on the empty board, then on the note again (apart from the last click: no double click)
  await tester.tapAt(empty, kind: PointerDeviceKind.mouse);
  await _pumpFor(tester, const Duration(milliseconds: 400));
  await tester.tapAt(note, kind: PointerDeviceKind.mouse);
  await _pumpFor(tester, const Duration(milliseconds: 600));
  await _shot(tester, 'desktop_dark');
  await tester.tapAt(note, kind: PointerDeviceKind.mouse, buttons: kSecondaryMouseButton);
  await _pumpFor(tester, const Duration(milliseconds: 600));
  await _shot(tester, 'desktop_dark_menu');
  await tester.sendKeyEvent(LogicalKeyboardKey.escape);
  tester.platformDispatcher.clearPlatformBrightnessTestValue();
  await _pumpFor(tester, const Duration(milliseconds: 400));
  expect(tester.takeException(), isNull);
}

/// A point on the board with no object near it (searched on a coarse grid, away from the bars).
Offset _emptySpot(WidgetTester tester, BoardViewState view, Rect box) {
  final cam = view.editor.camera.value;
  for (var y = box.bottom - 140; y > box.top + 120; y -= 40) {
    for (var x = box.right - 160; x > box.left + 160; x -= 40) {
      final p = Offset(x, y) - box.topLeft;
      var free = true;
      for (final d in const [Offset.zero, Offset(30, 0), Offset(-30, 0), Offset(0, 30), Offset(0, -30)]) {
        if (view.scene.hitTest(cam.toWorld(p + d), cam.z) != null) free = false;
      }
      if (free) return Offset(x, y);
    }
  }
  return box.bottomRight - const Offset(200, 160);
}

Future<void> _pumpFor(WidgetTester tester, Duration d) async {
  final end = DateTime.now().add(d);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> _until(WidgetTester tester, Finder finder, {int seconds = 20}) async {
  final end = DateTime.now().add(Duration(seconds: seconds));
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 100));
    if (finder.evaluate().isNotEmpty) return;
  }
  throw TestFailure('nicht erschienen: $finder');
}

/// The whole window as PNG (`<STACHEL_SHOTS>/<name>_<os>.png`).
Future<void> _shot(WidgetTester tester, String name) async {
  if (_shots.isEmpty) return;
  await tester.pump();
  final view = tester.binding.renderViews.first;
  final layer = view.debugLayer! as OffsetLayer;
  final ratio = tester.view.devicePixelRatio;
  final image = await layer.toImage(Offset.zero & view.size, pixelRatio: ratio);
  final png = await image.toByteData(format: ui.ImageByteFormat.png);
  final file = File('$_shots/${name}_${Platform.operatingSystem}.png');
  await file.parent.create(recursive: true);
  await file.writeAsBytes(png!.buffer.asUint8List());
  // ignore: avoid_print
  print('Bildschirmfoto: ${file.path} (${image.width}×${image.height})');
}
