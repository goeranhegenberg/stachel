// „Zettel abfotografieren“ (P10, Welle B): Foto → eigener Server → Vorschau (abwählen, Text/Farbe korrigieren) → Web-Aktion
// `tools.photoNotes`; Fehlertexte des Servers; Golden des Vorschau-Blatts (nur Windows:
// `flutter test --update-goldens test/stachel_photo_notes_test.dart`).
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as dui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_client/stachel_client.dart';

/// a „JPEG“ for the type sniffing (only the magic bytes matter; the fake server does not read it)
final _jpeg = Uint8List.fromList([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);

class _Picker extends StachelPhotoPicker {
  final sources = <StachelPhotoSource>[];
  @override
  Future<Uint8List?> pick(StachelPhotoSource source) async {
    sources.add(source);
    return _jpeg;
  }
}

class _Api implements StachelPhotoNotesApi {
  _Api(this.answer);
  final Object answer;
  final calls = <(String, int, String)>[];

  @override
  Future<bool> photoNotesAvailable() async => true;

  @override
  Future<Map<String, Object?>> photoNotes(String boardId, Uint8List bytes, String mimeType) async {
    calls.add((boardId, bytes.length, mimeType));
    final a = answer;
    if (a is Exception) throw a;
    return a as Map<String, Object?>;
  }
}

Map<String, Object?> _answer({bool ocr = true, String? preview}) => {
  'ok': true,
  'width': 1200,
  'height': 800,
  'ocr': ocr,
  'preview': ?preview,
  'notes': [
    {
      'x': 100,
      'y': 100,
      'w': 300,
      'h': 300,
      'color': '#fff27a',
      'rgb': '#f4e46b',
      'text': 'Bühne aufbauen',
      'conf': 88,
    },
    {'x': 450, 'y': 110, 'w': 300, 'h': 290, 'color': '#c62828', 'rgb': '#b02a2a', 'text': 'Shuttel', 'conf': 61},
    {'x': 800, 'y': 420, 'w': 300, 'h': 300, 'color': '#9fd3ff', 'rgb': '#8ec4ee', 'text': '', 'conf': 0},
    {'x': 'kaputt'},
  ],
};

/// App host with only what the menu entry asks (the rest is never called here).
class _Host extends StachelAppHost {
  _Host(this.available);
  final bool available;
  @override
  bool get photoNotesAvailable => available;
  @override
  String get boardId => 'b1';
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Future<(BoardUi, FixtureBoardSource, BuildContext)> _pump(
  WidgetTester tester, {
  Size size = const Size(390, 844),
  BoardHost host = const BoardHost(),
  String role = 'edit',
  BoardRegistry? registry,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final source = FixtureBoardSource(
    BoardSnapshot(objects: const []),
    role: role,
    features: const ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'act'],
    actions: const {'tools.photoNotes': 1},
  );
  final controller = BoardController(source, presenceInterval: Duration.zero);
  final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController());
  final ui = BoardUi(editor: editor, registry: registry ?? standardBoardRegistry(), host: host);
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
  return (ui, source, ctx);
}

/// Simple „photo“ (PNG): a light wall with three colored notes where the answer says.
Future<String> _photo(WidgetTester tester) async {
  final png = await tester.runAsync(() async {
    final rec = dui.PictureRecorder();
    final c = Canvas(rec);
    c.drawRect(const Rect.fromLTWH(0, 0, 600, 400), Paint()..color = const Color(0xFFE8E4DC));
    for (final (r, col) in [
      (const Rect.fromLTWH(50, 50, 150, 150), const Color(0xFFF4E46B)),
      (const Rect.fromLTWH(225, 55, 150, 145), const Color(0xFFB02A2A)),
      (const Rect.fromLTWH(400, 210, 150, 150), const Color(0xFF8EC4EE)),
    ]) {
      c.drawRect(r, Paint()..color = col);
    }
    final img = await rec.endRecording().toImage(600, 400);
    final b = await img.toByteData(format: dui.ImageByteFormat.png);
    img.dispose();
    return b!.buffer.asUint8List();
  });
  return 'data:image/png;base64,${base64Encode(png!)}';
}

Future<void> _fonts() async {
  final dir = Directory('../../app/assets/fonts');
  if (!dir.existsSync()) return;
  final l = FontLoader('Barlow');
  for (final f in ['Barlow-Regular.ttf', 'Barlow-Medium.ttf', 'Barlow-SemiBold.ttf', 'Barlow-Bold.ttf']) {
    l.addFont(Future.value(ByteData.sublistView(File('${dir.path}/$f').readAsBytesSync())));
  }
  await l.load();
  final c = FontLoader('BarlowCondensed');
  for (final f in ['BarlowCondensed-SemiBold.ttf', 'BarlowCondensed-Bold.ttf']) {
    c.addFont(Future.value(ByteData.sublistView(File('${dir.path}/$f').readAsBytesSync())));
  }
  await c.load();
  final root = Platform.environment['FLUTTER_ROOT'];
  final icons = File('$root/bin/cache/artifacts/material_fonts/materialicons-regular.otf');
  if (root != null && icons.existsSync()) {
    await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(icons.readAsBytesSync())))).load();
  }
}

void main() {
  setUpAll(_fonts);

  test('Antwort des Servers: Zettel, Vorschau, kaputte Einträge fallen weg', () {
    final r = PhotoNotesResult.fromJson({
      ..._answer(),
      'preview': 'data:image/jpeg;base64,${base64Encode([1, 2, 3])}',
    })!;
    expect((r.width, r.height, r.ocr), (1200.0, 800.0, true));
    expect(r.notes.map((n) => n.text), ['Bühne aufbauen', 'Shuttel', '']);
    expect(r.preview, [1, 2, 3]);
    expect(r.notes.first.toArgs(), {
      'x': 100.0,
      'y': 100.0,
      'w': 300.0,
      'h': 300.0,
      'color': '#fff27a',
      'text': 'Bühne aufbauen',
    });
    expect(PhotoNotesResult.fromJson(const {'ok': true}), isNull);
  });

  testWidgets('Board-Menü „Zettel abfotografieren …“ nur, wenn der Server es anbietet und man bearbeiten darf', (
    tester,
  ) async {
    // only this entry (the app's other entries need a full board screen)
    MenuEntry? entry(BoardUi ui) => ui.registry.menuItems
        .list()
        .firstWhere((d) => d.id == 'tools.photoNotes')
        .entry(ui, const MenuAt(Offset.zero));
    var (ui, _, _) = await _pump(tester, host: _Host(true), registry: stachelBoardRegistry);
    final def = ui.registry.menuItems.list().firstWhere((d) => d.id == 'tools.photoNotes');
    expect((def.on, def.order, def.section), (MenuTarget.board, 22.0, MenuSection.board));
    expect(entry(ui)?.label, 'Zettel abfotografieren …');
    (ui, _, _) = await _pump(tester, host: _Host(false), registry: stachelBoardRegistry);
    expect(entry(ui), isNull, reason: 'Server bietet es nicht an');
    (ui, _, _) = await _pump(tester, host: _Host(true), registry: stachelBoardRegistry, role: 'view');
    expect(entry(ui), isNull, reason: 'nur ansehen');
  });

  testWidgets('Galerie → „Zettel werden erkannt …“ → abwählen, Text korrigieren → act tools.photoNotes', (
    tester,
  ) async {
    final (ui, source, ctx) = await _pump(tester);
    final api = _Api(_answer());
    final picker = _Picker();
    final done = startPhotoNotes(ctx, ui, api: api, boardId: 'b1', picker: picker);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelPhotoGallery')));
    await tester.pumpAndSettle();
    expect(picker.sources, [StachelPhotoSource.gallery]);
    expect(api.calls, [('b1', _jpeg.length, 'image/jpeg')]);
    expect(find.byKey(const Key('stachelPhotoNotesSheet')), findsOneWidget);
    expect(find.text('3 NOTIZEN ANLEGEN'), findsOneWidget);
    // Zettel 3 abwählen, Text von Zettel 2 korrigieren
    await tester.tap(find.byKey(const Key('stachelPhotoNoteOn-2')));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('stachelPhotoNoteText-1')), 'Shuttle vom Bahnhof');
    await tester.pump();
    expect(find.text('2 NOTIZEN ANLEGEN'), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelPhotoNotesCreate')));
    await tester.pump();
    final acts = [
      for (final m in source.sent)
        for (final op in (m['ops'] is List ? m['ops'] as List : const []))
          if (op is Map && op['op'] == 'act') op,
    ];
    expect(acts, hasLength(1));
    expect(acts.single['name'], 'tools.photoNotes');
    final args = acts.single['args'] as Map;
    expect((args['notes'] as List).map((n) => (n as Map)['text']), ['Bühne aufbauen', 'Shuttle vom Bahnhof']);
    expect((args['notes'] as List).map((n) => (n as Map)['color']), ['#fff27a', '#c62828']);
    expect(args['x'], isA<double>());
    unawaited(done);
  });

  testWidgets('Fehler des Servers als Hinweis (zu viele Fotos), kein Blatt', (tester) async {
    final (ui, _, ctx) = await _pump(tester);
    final hints = <String>[];
    final sub = ui.hints.messages.listen(hints.add);
    addTearDown(sub.cancel);
    final api = _Api(const StachelException('rate_limited', 'Gerade wurden viele Fotos ausgewertet.'));
    final done = startPhotoNotes(ctx, ui, api: api, boardId: 'b1', picker: _Picker());
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelPhotoCamera')));
    await tester.pumpAndSettle();
    await done;
    expect(hints, ['Gerade wurden viele Fotos ausgewertet.']);
    expect(find.byKey(const Key('stachelPhotoNotesSheet')), findsNothing);
    expect(find.byKey(const Key('stachelPhotoNotesBusy')), findsNothing);
  });

  testWidgets('ohne Texterkennung bzw. ohne Zettel: Hinweise, Anlegen gesperrt', (tester) async {
    final (ui, _, ctx) = await _pump(tester);
    final r = PhotoNotesResult.fromJson(_answer(ocr: false))!;
    ui.openSheet<List<PhotoNote>>(ctx, (c) => PhotoNotesSheet(ui: ui, result: r), scrollControlled: true);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelPhotoNotesNoOcr')), findsOneWidget);
    Navigator.of(ctx).pop();
    await tester.pumpAndSettle();
    final none = PhotoNotesResult.fromJson({..._answer(), 'notes': const []})!;
    ui.openSheet<List<PhotoNote>>(ctx, (c) => PhotoNotesSheet(ui: ui, result: none), scrollControlled: true);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelPhotoNotesNone')), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byKey(const Key('stachelPhotoNotesCreate'))).onPressed, isNull);
  });

  testWidgets('Golden: Vorschau-Blatt mit Foto, nummerierten Zetteln, einem abgewählten', (tester) async {
    final (ui, _, ctx) = await _pump(tester);
    final r = PhotoNotesResult.fromJson(_answer(preview: await _photo(tester)))!;
    r.notes[2].selected = false;
    ui.openSheet<List<PhotoNote>>(ctx, (c) => PhotoNotesSheet(ui: ui, result: r), scrollControlled: true);
    await tester.pumpAndSettle();
    // Bild dekodieren lassen
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
    await tester.pumpAndSettle();
    await expectLater(find.byKey(const Key('shot')), matchesGoldenFile('goldens/photo_notes_sheet.png'));
  }, skip: !Platform.isWindows);
}

void unawaited(Future<void> f) {}
