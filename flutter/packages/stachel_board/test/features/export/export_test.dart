// P6 export (audit N07/N08): pages, page size and scale limits with the web's numbers (`tools.test.ts`), file names,
// the PDF writer (structure, xref offsets, Flate image), the offscreen renderer (size, pixels, transparent), the
// export sheet (PNG and PDF to the share sheet, info line, frame choice) and the menu entries (board, empty board,
// object, duplicate/template with hints, hidden without the app's host).

import 'dart:convert';
import 'dart:io' show ZLibCodec;
import 'dart:typed_data';
import 'dart:ui' as dui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/src/features/export/export_pages.dart';
import 'package:stachel_board/src/features/export/export_sheet.dart';
import 'package:stachel_board/src/features/export/pdf_writer.dart';
import 'package:stachel_board/src/features/export/register.dart';
import 'package:stachel_board/src/features/export/render_board.dart';
import 'package:stachel_board/stachel_board.dart';

BoardObject _o(Map<String, Object?> m) => BoardObject({'x': 0, 'y': 0, 'w': 100, 'h': 100, ...m});

class _Host extends BoardHost implements BoardAdminHost {
  final shared = <(String, String, int)>[];
  final calls = <String>[];
  Object? fail;

  @override
  String get boardId => 'b1';
  @override
  String errorText(Object error) => 'Fehler: $error';
  @override
  bool get isTemplate => false;
  @override
  String get boardTitle => 'Sommerfest: 2027';
  @override
  Future<void> duplicateBoard() async {
    calls.add('duplicate');
    if (fail != null) throw fail!;
  }

  @override
  Future<void> saveAsTemplate() async {
    calls.add('template');
    if (fail != null) throw fail!;
  }

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
  Future<void> shareFile(Uint8List bytes, String fileName, String mimeType) async =>
      shared.add((fileName, mimeType, bytes.length));
  @override
  Future<String?> uploadThumbnail(Uint8List bytes, String mimeType) async => null;
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

const _board = [
  {'id': 'fr', 'type': 'frame', 'x': 0, 'y': 0, 'w': 400, 'h': 300, 'title': 'Bühne', 'z': 'a0'},
  {'id': 'in', 'type': 'sticky', 'x': 20, 'y': 20, 'w': 100, 'h': 100, 'z': 'a1', 'color': '#ff0000', 'text': ''},
  {'id': 'out', 'type': 'sticky', 'x': 1000, 'y': 0, 'w': 100, 'h': 100, 'z': 'a2', 'color': '#0000ff'},
  {'id': 'hid', 'type': 'sticky', 'x': 2000, 'y': 0, 'w': 100, 'h': 100, 'z': 'a3', 'hidden': true},
  {
    'id': 'cn',
    'type': 'connector',
    'z': 'a4',
    'from': {'objectId': 'in'},
    'to': {'objectId': 'out'},
  },
  {'id': 'fr2', 'type': 'frame', 'x': 0, 'y': 600, 'w': 200, 'h': 100, 'title': '', 'z': 'a5'},
];

Future<(BoardUi, BoardController)> _ui({BoardHost? host, List<Map<String, Object?>> objects = _board}) async {
  final controller = BoardController(
    FixtureBoardSource(BoardSnapshot.fromJson({'objects': objects}), rev: 3),
    presenceInterval: Duration.zero,
  );
  final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController());
  final ui = BoardUi(editor: editor, registry: standardBoardRegistry(), host: host ?? const BoardHost());
  await controller.start();
  return (ui, controller);
}

void _dispose(BoardUi ui, BoardController c) {
  ui.dispose();
  ui.editor.dispose();
  c.dispose();
}

Future<Uint8List> _rgba(dui.Image img) async =>
    (await img.toByteData(format: dui.ImageByteFormat.rawStraightRgba))!.buffer.asUint8List();

List<int> _px(Uint8List rgba, int width, int x, int y) => rgba.sublist((y * width + x) * 4, (y * width + x) * 4 + 4);

String _de(int n) => n.toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => '.');

void main() {
  group('Seiten wie im Web (tools.test.ts „Export-Bereiche“)', () {
    final frame = _o({'id': 'fr', 'type': 'frame', 'x': 0, 'y': 0, 'w': 400, 'h': 300, 'title': 'Bühne', 'z': 'a0'});
    final inside = _o({'id': 'in', 'type': 'sticky', 'x': 20, 'y': 20, 'z': 'a1'});
    final outside = _o({'id': 'out', 'type': 'sticky', 'x': 1000, 'y': 0, 'z': 'a2'});
    final hidden = _o({'id': 'hid', 'type': 'sticky', 'x': 2000, 'y': 0, 'z': 'a3', 'hidden': true});
    final conn = _o({
      'id': 'cn',
      'type': 'connector',
      'z': 'a4',
      'from': {'objectId': 'in'},
      'to': {'objectId': 'out'},
    });
    final ordered = [frame, inside, outside, hidden, conn];
    Rect bounds(BoardObject o) =>
        o.type == 'connector' ? const Rect.fromLTWH(70, 70, 980, 10) : Rect.fromLTWH(o.x, o.y, o.w, o.h);

    test('ganzes Board ohne Ausgeblendete, mit Rand', () {
      final p = exportPages(ordered, {}, const ExportBoardArea(), bounds).single;
      expect(p.objects.map((o) => o.id), isNot(contains('hid')));
      expect(p.rect, const Rect.fromLTWH(-40, -40, 1180, 380));
    });

    test('Auswahl nimmt Verbinder zwischen ausgewählten mit; Rahmen = Rahmen-Ausschnitt', () {
      final p = exportPages(ordered, {'in', 'out'}, const ExportSelectionArea(), bounds).single;
      expect(p.objects.map((o) => o.id), ['in', 'out', 'cn']);
      final f = exportPages(ordered, {'fr'}, const ExportSelectionArea(), bounds).single;
      expect(f.rect, const Rect.fromLTWH(0, 0, 400, 300));
      expect(f.label, 'Bühne');
      expect(f.objects.map((o) => o.id), ['fr', 'in', 'cn']);
      expect(exportPages(ordered, {}, const ExportFramesArea(), bounds), hasLength(1));
      expect(exportPages(ordered, {}, const ExportSelectionArea(), bounds), isEmpty);
      expect(exportPages(ordered, {}, const ExportFrameArea('weg'), bounds), isEmpty);
      // a connector with a free end does not come along
      final free = _o({
        'id': 'cf',
        'type': 'connector',
        'from': {'objectId': 'in'},
        'to': {'x': 5, 'y': 5},
      });
      expect(
        exportPages(
          [...ordered, free],
          {'in', 'out'},
          const ExportSelectionArea(),
          bounds,
        ).single.objects.map((o) => o.id),
        ['in', 'out', 'cn'],
      );
    });

    test('Abnahme: „Alle Rahmen“ in der Reihenfolge der Rahmen-Liste (slide zuerst, wie framesInOrder im Web)', () {
      final a = _o({'id': 'A', 'type': 'frame', 'x': 0, 'y': 0, 'w': 100, 'h': 100, 'z': 'b0', 'title': 'A'});
      final b = _o({'id': 'B', 'type': 'frame', 'x': 300, 'y': 0, 'w': 100, 'h': 100, 'z': 'b1', 'title': 'B'});
      final c = _o({'id': 'C', 'type': 'frame', 'x': 0, 'y': 400, 'w': 100, 'h': 100, 'z': 'b2', 'title': 'C', 'slide': 'a0'});
      final pages = exportPages([a, b, c], {}, const ExportFramesArea(), bounds);
      expect(pages.map((p) => p.label), ['C', 'A', 'B']);
    });

    test('Seitengröße und Maßstab begrenzt', () {
      final s = pageSizePt(const Rect.fromLTWH(0, 0, 800, 600));
      expect((s.widthPt, s.heightPt), (600, 450));
      expect(pageSizePt(const Rect.fromLTWH(0, 0, 10000, 5000)).widthPt, closeTo(1684, 1e-9));
      expect(pageSizePt(const Rect.fromLTWH(0, 0, 100, 50)).widthPt, closeTo(420, 1e-9));
      expect(clampScale(const Rect.fromLTWH(0, 0, 20000, 1000), 2), closeTo(8192 / 20000, 1e-12));
      expect(clampScale(const Rect.fromLTWH(0, 0, 500, 400), 2), 2);
      expect(clampScale(const Rect.fromLTWH(0, 0, 6000, 6000), 3), closeTo(1, 1e-12));
      expect(exportPixels(const Rect.fromLTWH(0, 0, 617.3, 200.25), 2), (width: 1235, height: 401));
    });

    test('Dateinamen wie im Web', () {
      expect(exportFileName('Sommerfest: 2027 / Ablauf?', 'png'), 'Sommerfest 2027 Ablauf.png');
      expect(exportFileName('  ', 'pdf'), 'Stachel.pdf');
      expect(exportFileName('x' * 90, 'png'), '${'x' * 80}.png');
      final page = [ExportPage(Rect.zero, const [], label: 'Bühne')];
      expect(exportNameFor('Festival', const ExportFrameArea('fr'), page, ExportFormat.png), 'Festival – Bühne.png');
      expect(exportNameFor('Festival', const ExportSelectionArea(), page, ExportFormat.pdf), 'Festival – Bühne.pdf');
      expect(
        exportNameFor('Festival', const ExportBoardArea(), [ExportPage(Rect.zero, const [])], ExportFormat.png),
        'Festival.png',
      );
      expect(exportNameFor('', const ExportFramesArea(), [...page, ...page], ExportFormat.pdf), 'Board.pdf');
    });
  });

  group('PDF', () {
    test('gültige Struktur mit korrekter xref-Tabelle (wie tools.test.ts)', () {
      final img = PdfImage(width: 2, height: 1, data: Uint8List.fromList([1, 2, 3, 4, 5, 6]));
      final bytes = buildPdf(
        [PdfPage(widthPt: 200, heightPt: 100, image: img), PdfPage(widthPt: 100.123, heightPt: 300, image: img)],
        title: 'Lageplan Größe',
        date: DateTime.utc(2026, 10, 23, 12),
      );
      final text = latin1.decode(bytes);
      expect(text.startsWith('%PDF-1.4'), isTrue);
      expect(text.trimRight().endsWith('%%EOF'), isTrue);
      expect(text, contains('/Count 2'));
      expect(text, contains('/MediaBox [0 0 100.12 300]'));
      expect(text, contains('/MediaBox [0 0 200 100]'));
      expect(text, contains('/CreationDate (D:20261023120000Z)'));
      expect(text, contains('/Title ${pdfText('Lageplan Größe')}'));
      final start = int.parse(RegExp(r'startxref\n(\d+)').firstMatch(text)!.group(1)!);
      expect(text.substring(start, start + 4), 'xref');
      final entries = RegExp(r'(\d{10}) 00000 n ').allMatches(text).toList();
      expect(entries, hasLength(9));
      for (var n = 0; n < entries.length; n++) {
        final at = int.parse(entries[n].group(1)!);
        expect(text.substring(at).startsWith('${n + 1} 0 obj'), isTrue, reason: 'Objekt ${n + 1}');
      }
    });

    test('Titel als UTF-16, RGBA → RGB auf Hintergrund, Flate = zlib', () {
      expect(pdfText('Ä'), '<FEFF00C4>');
      expect(rgbaToRgb(Uint8List.fromList([255, 0, 0, 255, 0, 0, 0, 0]), [10, 20, 30]), [255, 0, 0, 10, 20, 30]);
      final img = pdfImageFromRgba(Uint8List.fromList([1, 2, 3, 255, 9, 9, 9, 0]), 2, 1);
      expect(ZLibCodec().decode(img.data), [1, 2, 3, 255, 255, 255]);
    });
  });

  group('Rendern', () {
    testWidgets('Bildgröße, Hintergrund, Objekte an ihrer Stelle; durchsichtig ohne Hintergrund', (tester) async {
      final (ui, c) = await _ui();
      addTearDown(() => _dispose(ui, c));
      await tester.runAsync(() async {
        final img = await renderBoardRegion(ui, world: const Rect.fromLTWH(0, 0, 200, 100), scale: 2);
        expect((img.width, img.height), (400, 200));
        // the red note at (20..120) world = (40..240) px
        final note = _px(await _rgba(img), 400, 140, 150);
        expect(note[0], greaterThan(200));
        expect(note[1], lessThan(60));
        img.dispose();
        // empty part of the board: background #f3f3ef, transparent = alpha 0
        final empty = await renderBoardRegion(ui, world: const Rect.fromLTWH(0, 320, 200, 100), scale: 0.5);
        expect((empty.width, empty.height), (100, 50));
        expect(_px(await _rgba(empty), 100, 50, 25), [0xf3, 0xf3, 0xef, 255]);
        empty.dispose();
        final clear = await renderBoardRegion(
          ui,
          world: const Rect.fromLTWH(0, 320, 200, 100),
          scale: 1,
          transparent: true,
        );
        expect(_px(await _rgba(clear), 200, 100, 50)[3], 0);
        clear.dispose();
        // only the given objects
        final only = await renderBoardRegion(
          ui,
          world: const Rect.fromLTWH(0, 0, 200, 100),
          scale: 1,
          objects: [ui.editor.scene.state['out']!],
          background: const Color(0xFF00FF00),
        );
        expect(_px(await _rgba(only), 200, 70, 70), [0, 255, 0, 255]);
        only.dispose();
      });
    });

    test('Hintergrundfarbe aus tools.settings', () async {
      final (ui, c) = await _ui();
      addTearDown(() => _dispose(ui, c));
      expect(boardBackgroundColor(ui), BoardColors.background);
      c.state.ext = {
        'tools.settings': {'color': '#e9f1f8', 'pattern': 'dots'},
      };
      expect(boardBackgroundColor(ui), const Color(0xFFE9F1F8));
    });

    testWidgets('runBoardExport: PNG eines Rahmens, PDF aller Rahmen (eine Seite je Rahmen)', (tester) async {
      final (ui, c) = await _ui();
      addTearDown(() => _dispose(ui, c));
      await tester.runAsync(() async {
        final png = await runBoardExport(
          ui,
          const ExportOptions(format: ExportFormat.png, area: ExportFrameArea('fr'), quality: 1),
          boardTitle: 'Sommerfest 2027',
        );
        expect(png!.name, 'Sommerfest 2027 – Bühne.png');
        expect(png.mimeType, 'image/png');
        expect(png.bytes.sublist(1, 4), utf8.encode('PNG'));
        final progress = <(int, int)>[];
        final pdf = await runBoardExport(
          ui,
          const ExportOptions(format: ExportFormat.pdf, area: ExportFramesArea(), quality: 1),
          boardTitle: 'Sommerfest 2027',
          onProgress: (d, t) => progress.add((d, t)),
        );
        expect(pdf!.name, 'Sommerfest 2027.pdf');
        expect(pdf.pages, 2);
        expect(progress, [(0, 2), (1, 2), (2, 2)]);
        final text = latin1.decode(pdf.bytes);
        expect(text, contains('/Count 2'));
        expect(text, contains('/Width 400 /Height 300'));
        expect(
          await runBoardExport(ui, const ExportOptions(format: ExportFormat.png, area: ExportSelectionArea())),
          isNull,
        );
      });
    });
  });

  group('Blatt und Menüs', () {
    Future<(BoardUi, BoardController, _Host)> pump(WidgetTester tester, {Set<String> select = const {}}) async {
      tester.view.physicalSize = const Size(500, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final host = _Host();
      final (ui, c) = await _ui(host: host);
      addTearDown(() => _dispose(ui, c));
      ui.editor.selection.value = select;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => Center(
                child: TextButton(
                  key: const Key('open'),
                  onPressed: () => openExportSheet(context, ui),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        ),
      );
      return (ui, c, host);
    }

    testWidgets('PNG: Info in Pixeln, Exportieren teilt die Datei und zeigt „Gespeichert: …“', (tester) async {
      final (ui, _, host) = await pump(tester);
      final hints = <String>[];
      final sub = ui.hints.messages.listen(hints.add);
      addTearDown(sub.cancel);
      await tester.tap(find.byKey(const Key('open')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelExportSheet')), findsOneWidget);
      // whole board (no selection): 1180 + 2·40 … at Scharf = 2 px per unit
      final rect = boardExportPages(ui, const ExportBoardArea()).single.rect;
      final px = exportPixels(rect, 2);
      expect(find.text('${_de(px.width)} × ${_de(px.height)} Pixel'), findsOneWidget);
      expect(find.text('Nichts ausgewählt'), findsOneWidget);
      expect(find.text('5 Objekte'), findsOneWidget);
      // PDF only: „Alle Rahmen“
      expect(find.byKey(const Key('stachelExportArea-frames')), findsNothing);
      await tester.tap(find.byKey(const Key('stachelExportQuality-1')));
      await tester.pump();
      final one = exportPixels(rect, 1);
      expect(find.text('${_de(one.width)} × ${_de(one.height)} Pixel'), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelExportStart')));
      await tester.pump();
      expect(find.text('Wird erstellt …'), findsOneWidget);
      for (var i = 0; i < 20 && host.shared.isEmpty; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
        await tester.pump();
      }
      await tester.pumpAndSettle();
      expect(host.shared.single.$1, 'Sommerfest 2027.png');
      expect(host.shared.single.$2, 'image/png');
      expect(hints, ['Gespeichert: Sommerfest 2027.png']);
      expect(find.byKey(const Key('stachelExportSheet')), findsNothing);
    });

    testWidgets('PDF: „Alle Rahmen“ mit Seitenzahl, Rahmen-Auswahl „1. Bühne“', (tester) async {
      final (_, _, host) = await pump(tester, select: {'in'});
      await tester.tap(find.byKey(const Key('open')));
      await tester.pumpAndSettle();
      expect(find.text('1 ausgewählt'), findsOneWidget);
      expect(find.text('1. Bühne'), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelExportPdf')));
      await tester.pump();
      expect(find.text('Eine Seite je Rahmen (2)'), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelExportArea-frames')));
      await tester.pump();
      expect(find.text('2 Seiten'), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelExportQuality-1')));
      await tester.tap(find.byKey(const Key('stachelExportStart')));
      await tester.pump();
      for (var i = 0; i < 40 && host.shared.isEmpty; i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
        await tester.pump();
      }
      await tester.pumpAndSettle();
      expect(host.shared.single.$1, 'Sommerfest 2027.pdf');
      expect(host.shared.single.$2, 'application/pdf');
    });

    test('Menüs: Board, Fläche, Objekt (Rahmen/Auswahl); ohne App-Host nichts', () async {
      final host = _Host();
      final (ui, c) = await _ui(host: host);
      addTearDown(() => _dispose(ui, c));
      List<String?> keys(MenuTarget on) => [for (final e in menuEntries(ui, on, const MenuAt(Offset.zero))) e.key];
      expect(
        keys(MenuTarget.board),
        containsAll(['stachelBoardExport', 'stachelBoardDuplicate', 'stachelBoardTemplate']),
      );
      final board = keys(MenuTarget.board);
      expect(board.indexOf('stachelBoardExport'), lessThan(board.indexOf('stachelBoardDuplicate')));
      expect(board.indexOf('stachelBoardDuplicate'), lessThan(board.indexOf('stachelBoardTemplate')));
      expect(keys(MenuTarget.canvas), contains('stachelCanvasExport'));
      MenuEntry objectEntry() => menuEntries(
        ui,
        MenuTarget.object,
        const MenuAt(Offset.zero),
      ).firstWhere((e) => e.key == 'stachelObjectExport');
      ui.editor.selection.value = {'fr'};
      expect(objectEntry().label, 'Rahmen exportieren …');
      ui.editor.selection.value = {'in', 'out'};
      expect(objectEntry().label, 'Als Bild exportieren …');

      final (bare, c2) = await _ui();
      addTearDown(() => _dispose(bare, c2));
      for (final on in MenuTarget.values) {
        expect(
          [for (final e in menuEntries(bare, on, const MenuAt(Offset.zero))) e.key],
          isNot(
            anyOf(contains('stachelBoardExport'), contains('stachelCanvasExport'), contains('stachelObjectExport')),
          ),
        );
      }
    });

    testWidgets('Duplizieren und Als Vorlage speichern: Host, Hinweis, Fehlertext', (tester) async {
      final host = _Host();
      final (ui, c) = await _ui(host: host);
      addTearDown(() => _dispose(ui, c));
      final hints = <String>[];
      final sub = ui.hints.messages.listen(hints.add);
      addTearDown(sub.cancel);
      MenuEntry entry(String key) =>
          menuEntries(ui, MenuTarget.board, const MenuAt(Offset.zero)).firstWhere((e) => e.key == key);
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      final context = tester.element(find.byType(SizedBox));
      entry('stachelBoardDuplicate').onSelect!(context, ui);
      entry('stachelBoardTemplate').onSelect!(context, ui);
      await tester.pump();
      expect(host.calls, ['duplicate', 'template']);
      expect(hints, ['Als Vorlage gespeichert. Du findest sie in der Board-Übersicht.']);
      host.fail = 'offline';
      entry('stachelBoardDuplicate').onSelect!(context, ui);
      await tester.pump();
      expect(hints.last, 'Fehler: offline');
    });
  });
}
