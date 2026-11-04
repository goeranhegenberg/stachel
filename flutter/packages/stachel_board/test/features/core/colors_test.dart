// Notizfarben (Welle B, web `board/colors.ts` `readableInk`, `ui/ColorPicker.tsx`): 36 Farben (zwölf Farbtöne ×
// hell/kräftig/dunkel), Schrift nach WCAG-Kontrast (dunkle Notizen weiß, die alten hellen unverändert schwarz), eigener Farbwähler mit Spektrum/Hex und
// „zuletzt benutzt“. Goldens nur unter Windows: `flutter test --update-goldens test/features/core/colors_test.dart`.
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import '../../test_fonts.dart';

Color _c(String hex) => parseColor(hex, const Color(0xFF000000));

const _white = Color(0xFFFFFFFF);

void main() {
  setUpAll(() async {
    await loadBoardFonts();
  });
  setUp(() => BoardPrefs.load(const {}));

  group('Schrift auf Notizen (WCAG wie im Web)', () {
    test('36 Notizfarben: hell schwarz, dunkel weiß, kräftig nach Kontrast – immer ≥ 4,5 : 1', () {
      expect(stickyColors, hasLength(36));
      expect(stickyGridCols, 12);
      const whiteStrong = {'#c62828', '#5c6bc0', '#1565c0'};
      for (final (i, hex) in stickyColors.indexed) {
        final ink = readableInk(_c(hex));
        final white = i >= 24 || whiteStrong.contains(hex);
        expect(ink, white ? _white : BoardColors.ink, reason: hex);
        expect(contrastRatio(_c(hex), ink), greaterThanOrEqualTo(4.5), reason: hex);
      }
      // die alten hellen: wie bisher (textOn) – bestehende Boards sehen gleich aus
      for (final hex in stickyColors.take(12)) {
        expect(readableInk(_c(hex)), textOn(_c(hex)), reason: hex);
      }
      // Dunkelgrün eindeutig dunkel
      expect(stickyColors[24 + 9], '#1b5e20');
    });

    test('freie Farben berechnet, Kontrast wie WCAG', () {
      expect(readableInk(_c('#123456')), _white);
      expect(readableInk(_c('#f0f0a0')), BoardColors.ink);
      expect(contrastRatio(const Color(0xFF000000), _white), closeTo(21, 1e-6));
      expect(contrastRatio(const Color(0xFF777777), _white), closeTo(4.48, 0.01));
    });

    test('alle Notizfarben haben deutsche Namen', () {
      for (final hex in stickyColors) {
        expect(colorName(hex), isNot(startsWith('#')), reason: hex);
      }
      expect(stickyColors.skip(24).map(colorName).toList(), [
        'Ocker',
        'Braun',
        'Weinrot',
        'Brombeere',
        'Aubergine',
        'Nachtblau',
        'Marineblau',
        'Ozeanblau',
        'Dunkeltürkis',
        'Waldgrün',
        'Oliv',
        'Anthrazit',
      ]);
    });
  });

  group('Farbwähler', () {
    test('Hex-Eingabe wie das Web (parseHex)', () {
      expect(parseHexColor('#ABC'), '#aabbcc');
      expect(parseHexColor('c62828'), '#c62828');
      expect(parseHexColor(' #1565C0 '), '#1565c0');
      expect(parseHexColor('#12345'), isNull);
      expect(parseHexColor('blau'), isNull);
      for (final hex in stickyColors) {
        expect(hexOfColor(HSVColor.fromColor(_c(hex)).toColor()), hex);
      }
    });

    test('zuletzt benutzt: neueste zuerst, ohne Doppelte, höchstens acht, je Gerät (BoardPrefs)', () {
      for (var i = 0; i < 10; i++) {
        RecentColors.add('#00000$i');
      }
      RecentColors.add('#000003');
      RecentColors.add('kaputt');
      final r = RecentColors.list;
      expect(r, hasLength(8));
      expect(r.first, '#000003');
      expect(r.toSet(), hasLength(8));
      expect(BoardPrefs.get(RecentColors.key), isNotNull);
    });

    testWidgets('Kontextleiste „Farbe“: Palette → „+“ → Hex → ÜBERNEHMEN; danach unter „zuletzt benutzt“', (
      tester,
    ) async {
      final b = await _pump(tester, const Size(390, 844));
      final got = <String?>[];
      Future<void> open() async {
        final f = pickColor(b.ctx, b.ui, stickyColors, custom: true, current: '#fff27a');
        f.then(got.add);
        await tester.pumpAndSettle();
      }

      await open();
      for (final hex in stickyColors) {
        expect(find.byKey(Key('stachelColor-$hex')), findsOneWidget);
      }
      expect(find.byKey(const Key('stachelCustomColorPlus')), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelCustomColorPlus')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelCustomColorSheet')), findsOneWidget);
      await tester.enterText(find.byKey(const Key('stachelCustomHex')), 'C62829');
      await tester.pump();
      await tester.tap(find.byKey(const Key('stachelCustomColorOk')));
      await tester.pumpAndSettle();
      expect(got, ['#c62829']);
      expect(RecentColors.list, ['#c62829']);
      // beim nächsten Mal: die eigene Farbe direkt wählbar
      await open();
      await tester.tap(find.byKey(const Key('stachelRecentColor-#c62829')));
      await tester.pumpAndSettle();
      expect(got, ['#c62829', '#c62829']);
    });

    testWidgets('Spektrum: Tippen setzt Sättigung und Helligkeit, Farbton-Regler den Ton', (tester) async {
      final b = await _pump(tester, const Size(390, 844));
      String? got;
      pickOwnColor(b.ctx, b.ui, initial: '#ff0000').then((v) => got = v);
      await tester.pumpAndSettle();
      final area = tester.getRect(find.byKey(const Key('stachelCustomSpectrum')));
      // unten links = schwarz
      await tester.tapAt(area.bottomLeft + const Offset(1, -1));
      await tester.pump();
      await tester.tap(find.byKey(const Key('stachelCustomColorOk')));
      await tester.pumpAndSettle();
      final c = _c(got!);
      expect(c.computeLuminance(), lessThan(0.01), reason: got);
    });

    testWidgets('Handy (390 dp): Raster bleibt drei Reihen hoch, sechs Spalten sichtbar, seitlich scrollbar', (tester) async {
      final b = await _pump(tester, const Size(390, 844));
      pickColor(b.ctx, b.ui, stickyColors, custom: true);
      await tester.pumpAndSettle();
      final grid = find.byKey(const Key('stachelColorGrid'));
      expect(grid, findsOneWidget);
      final scroll = find.ancestor(of: grid, matching: find.byType(SingleChildScrollView)).first;
      expect(tester.widget<SingleChildScrollView>(scroll).scrollDirection, Axis.horizontal);
      // drei Reihen, die erste Spalte ganz sichtbar, die zwölfte erst nach dem Wischen
      final first = tester.getRect(find.byKey(Key('stachelColor-${stickyColors[0]}')));
      final third = tester.getRect(find.byKey(Key('stachelColor-${stickyColors[24]}')));
      expect(third.top - first.top, lessThan(3 * 60));
      final last = find.byKey(Key('stachelColor-${stickyColors[11]}'));
      expect(tester.getRect(last).left, greaterThan(390));
      expect(tester.getRect(find.byKey(Key('stachelColor-${stickyColors[5]}'))).right, lessThan(390));
      if (Platform.isWindows) await expectLater(find.byKey(const Key('shot')), matchesGoldenFile('goldens/colors_palette_phone.png'));
      await tester.drag(scroll, const Offset(-400, 0));
      await tester.pumpAndSettle();
      expect(tester.getRect(last).right, lessThan(390));
    });

    testWidgets('Golden: Palette mit 36 Farben und „zuletzt benutzt“, Farbwähler, Notizen mit dunklen Farben', (
      tester,
    ) async {
      RecentColors.add('#8e44ad');
      RecentColors.add('#c62829');
      final b = await _pump(tester, const Size(780, 844), notes: true);
      pickColor(b.ctx, b.ui, stickyColors, custom: true, current: '#c62829');
      await tester.pumpAndSettle();
      await expectLater(find.byKey(const Key('shot')), matchesGoldenFile('goldens/colors_palette.png'));
      Navigator.of(b.ctx).pop();
      await tester.pumpAndSettle();
      pickOwnColor(b.ctx, b.ui, initial: '#1565c0', title: 'Eigene Notizfarbe');
      await tester.pumpAndSettle();
      await expectLater(find.byKey(const Key('shot')), matchesGoldenFile('goldens/colors_picker.png'));
    }, skip: !Platform.isWindows);
  });
}

class _B {
  _B(this.ui, this.ctx);
  final BoardUi ui;
  final BuildContext ctx;
}

/// Board with notes in all 36 colors (left: the board, right: room for sheets) – screen [size].
Future<_B> _pump(WidgetTester tester, Size size, {bool notes = false}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final objects = [
    if (notes)
      for (final (i, c) in stickyColors.indexed)
        BoardObject({
          'id': 'n$i',
          'type': 'sticky',
          'x': 20 + (i % 12) * 63.0,
          'y': 20 + (i ~/ 12) * 63.0,
          'w': 58,
          'h': 58,
          'color': c,
          'text': colorName(c),
          'z': 'a${i.toString().padLeft(2, '0')}',
        }),
  ];
  final controller = BoardController(
    FixtureBoardSource(BoardSnapshot(objects: objects)),
    presenceInterval: Duration.zero,
  );
  final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController());
  final ui = BoardUi(editor: editor, registry: standardBoardRegistry());
  addTearDown(() {
    ui.dispose();
    editor.dispose();
    controller.dispose();
  });
  late BuildContext ctx;
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData(fontFamily: 'Barlow'),
      // the whole navigator (sheets included) in the shot
      builder: (c, child) => BoardUiScope(
        ui: ui,
        child: RepaintBoundary(key: const Key('shot'), child: child),
      ),
      home: Scaffold(
        body: Builder(
          builder: (c) {
            ctx = c;
            return BoardView(key: ui.viewKey, controller: controller, editor: editor, fitOnLoad: false);
          },
        ),
      ),
    ),
  );
  await controller.start();
  await tester.pump();
  await tester.pump();
  return _B(ui, ctx);
}
