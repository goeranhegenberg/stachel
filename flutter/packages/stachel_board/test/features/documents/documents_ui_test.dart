// P7 in the board UI (parity audit C13, E20, K05–K11): PDFs on the board like the web's `features/documents` – upload
// (check, original, page 1 at 1800 px, document in a 640 box, other pages in the background, placeholder), page bar at
// the object (act `documents.page`, no undo step, missing page rendered + `documents.addPage`), name label, context bar
// and object menu, full-screen view, download, „Alle Seiten aufs Board legen“ (missing pages first, act
// `documents.expand`), missing current page of a visible document after 1.5 s, mirror repair.

import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/documents/doc_pages.dart';
import 'package:stachel_board/src/features/documents/document_viewer.dart';

const _actions = {'documents.page': 1, 'documents.addPage': 1, 'documents.repair': 1, 'documents.expand': 1};

/// 1×1 PNG (viewer image).
final _png = Uint8List.fromList(const [
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0x00,
  0x00,
  0x00,
  0x0d,
  0x49,
  0x48,
  0x44,
  0x52,
  0x00,
  0x00,
  0x00,
  0x01, //
  0x00,
  0x00,
  0x00,
  0x01,
  0x08,
  0x06,
  0x00,
  0x00,
  0x00,
  0x1f,
  0x15,
  0xc4,
  0x89,
  0x00,
  0x00,
  0x00,
  0x0d,
  0x49,
  0x44,
  0x41,
  0x54,
  0x78,
  0xda,
  0x63,
  0xfc,
  0xcf,
  0xc0,
  0xf0,
  0x1f,
  0x00,
  0x05,
  0x05,
  0x02,
  0x00,
  0x5f,
  0xc8,
  0xf1,
  0xd2,
  0x00,
  0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

final _pdfBytes = Uint8List.fromList('%PDF-1.4\n…\n%%EOF\n'.codeUnits);

class _FakePdf implements PdfFile {
  _FakePdf(this.sizes);
  final List<Size> sizes;
  final rendered = <(int, int, int)>[];
  bool disposed = false;

  @override
  int get pageCount => sizes.length;
  @override
  Size pageSize(int i) => sizes[i];
  @override
  Future<RenderedPage> render(int i, int width, int height) async {
    rendered.add((i, width, height));
    return RenderedPage(bytes: Uint8List.fromList([i]), mime: 'image/jpeg', width: width, height: height);
  }

  @override
  void dispose() => disposed = true;
}

class _Host extends BoardHost implements DocumentHost {
  _Host(this.pdf);
  _FakePdf pdf;
  Object? openError;
  Completer<String>? holdUpload;
  final uploadedPdfs = <String>[];
  final pages = <String>[];
  final fetched = <String>[];
  final saved = <(String, String)>[];
  final images = <String>[];
  List<PdfInput> picked = const [];
  var _n = 0;

  @override
  Future<PdfFile> openPdf(Uint8List bytes) async {
    final e = openError;
    if (e != null) throw e;
    return pdf;
  }

  @override
  Future<String> uploadPdf(Uint8List bytes, String name) async {
    uploadedPdfs.add(name);
    final h = holdUpload;
    if (h != null) return h.future;
    return 'file-1';
  }

  @override
  Future<Uint8List> fetchPdf(String fileId) async {
    fetched.add(fileId);
    return _pdfBytes;
  }

  @override
  Future<String> uploadPage(RenderedPage page, String name) async {
    pages.add(name);
    return 'img-${++_n}';
  }

  @override
  Future<void> savePdf(String fileId, String name) async => saved.add((fileId, name));

  @override
  Future<Uint8List> pageImageBytes(String imageId) async {
    images.add(imageId);
    return _png;
  }

  @override
  Future<List<PdfInput>> pickPdfs() async => picked;

  ClipboardFiles clipboard = const ClipboardFiles();
  final addedImages = <(int, Offset)>[];

  @override
  Future<ClipboardFiles> readClipboardFiles() async => clipboard;

  @override
  Future<void> addImage(Uint8List bytes, Offset at) async => addedImages.add((bytes.length, at));
}

/// Answers the app's ops like the server (create, update, documents.* with the web's rules).
class _Server {
  _Server(this.source, List<Map<String, Object?>> objects) {
    for (final o in objects) {
      this.objects[o['id']! as String] = {...o};
    }
  }
  final FixtureBoardSource source;
  final objects = <String, Map<String, Object?>>{};
  final answered = <int>{};
  final acts = <Map<String, Object?>>[];
  var rev = 20;
  var z = 0;

  /// Leave act names unanswered (to look at the state in between).
  final hold = <String>{};

  Map<String, Object?> _page(String id, Map<String, Object?> o) {
    final b = BoardObject.fromJson({'id': id, ...o})!;
    final p = currentPage(b);
    return {'page': p, 'imageId': pageImage(b, p)};
  }

  void process() {
    for (final m in [...source.sent]) {
      if (m['t'] != 'ops') continue;
      final req = m['req']! as int;
      if (answered.contains(req)) continue;
      final ops = (m['ops']! as List).cast<Map<String, Object?>>();
      if (ops.any((op) => op['op'] == 'act' && hold.contains(op['name']))) continue;
      answered.add(req);
      final changes = <ObjectChange>[];
      final results = <int, ActResult>{};
      for (final (i, op) in ops.indexed) {
        switch (op['op']) {
          case 'create':
            for (final o in (op['objects']! as List).cast<Map<String, Object?>>()) {
              final full = {...o, 'z': 'b${z++}'};
              objects[o['id']! as String] = full;
              changes.add(ObjectCreated(BoardObject.fromJson(full)!));
            }
          case 'update':
            for (final e in (op['patches']! as Map).cast<String, Map<String, Object?>>().entries) {
              objects[e.key]?.addAll(e.value);
              changes.add(ObjectUpdated(e.key, e.value, const []));
            }
          case 'act':
            acts.add(op);
            final a = (op['args']! as Map).cast<String, Object?>();
            final id = a['id']! as String;
            final o = objects[id];
            if (o == null) {
              results[i] = const ActResult(skipped: true);
              continue;
            }
            final pages = {...((o['docPages'] as Map?) ?? const {})}.cast<String, Object?>();
            switch (op['name']) {
              case 'documents.page':
                final b = BoardObject.fromJson({'id': id, ...o})!;
                final p = currentPage(b, a['page']);
                o['docPage'] = p;
                final img = pages['$p'];
                if (img != null) {
                  o['imageId'] = img;
                  changes.add(ObjectUpdated(id, {'docPage': p, 'imageId': img}, const []));
                } else {
                  o.remove('imageId');
                  changes.add(ObjectUpdated(id, {'docPage': p}, const ['imageId']));
                }
                results[i] = ActResult(data: _page(id, o));
              case 'documents.addPage':
                final p = a['page']! as int;
                final have = pages['$p'];
                final valid = have ?? a['imageId'];
                pages['$p'] = valid;
                o['docPages'] = pages;
                final set = <String, Object?>{'docPages': pages};
                if ((o['docPage'] ?? 0) == p) {
                  o['imageId'] = valid;
                  set['imageId'] = valid;
                }
                changes.add(ObjectUpdated(id, set, const []));
                results[i] = ActResult(data: {'imageId': valid});
              case 'documents.repair':
                final b = BoardObject.fromJson({'id': id, ...o})!;
                final img = pageImage(b, currentPage(b));
                o['imageId'] = img;
                changes.add(ObjectUpdated(id, {'imageId': img}, const []));
                results[i] = const ActResult();
              case 'documents.expand':
                final b = BoardObject.fromJson({'id': id, ...o})!;
                final missing = missingPages(b);
                if (missing.isNotEmpty) {
                  results[i] = ActResult(skipped: true, data: {'missing': missing});
                  continue;
                }
                final ids = <String>[];
                for (final (n, r) in expandLayout(b).indexed) {
                  final nid = '${op['key']}-${n + 1}';
                  ids.add(nid);
                  final img = {
                    'id': nid,
                    'type': 'image',
                    'x': r.left,
                    'y': r.top,
                    'w': r.width,
                    'h': r.height,
                    'imageId': pages['$n'],
                    'color': '#ffffff',
                    'z': 'c${z++}',
                  };
                  objects[nid] = img;
                  changes.add(ObjectCreated(BoardObject.fromJson(img)!));
                }
                results[i] = ActResult(select: ids, toast: '${ids.length} Seiten liegen als Bilder auf dem Board.');
            }
        }
      }
      if (changes.isNotEmpty) source.push(PatchMessage(rev: ++rev, changes: changes));
      source.push(AckMessage(req, rev, const [], results));
    }
  }
}

class _Board {
  _Board(this.controller, this.source, this.editor, this.ui, this.host, this.server, this.hints);
  final BoardController controller;
  final FixtureBoardSource source;
  final BoardEditor editor;
  final BoardUi ui;
  final _Host host;
  final _Server server;
  final List<String> hints;
  Documents get docs => Documents.of(ui);

  /// Lets the fake server answer until nothing is left (futures in between).
  Future<void> settle(WidgetTester tester, {int rounds = 12}) async {
    for (var i = 0; i < rounds; i++) {
      server.process();
      // 1 ms: zero timers (yield between background pages) fire too
      await tester.pump(const Duration(milliseconds: 1));
    }
  }

  List<Map<String, Object?>> acts(String name) => [
    for (final a in server.acts)
      if (a['name'] == name) a,
  ];
}

Map<String, Object?> _doc({
  String id = 'd',
  double x = 100,
  double y = 100,
  int count = 3,
  int page = 0,
  Map<String, String> pages = const {'0': 'p0', '1': 'p1'},
  bool locked = false,
}) => {
  'id': id,
  'type': 'document',
  'x': x,
  'y': y,
  'w': 300,
  'h': 424,
  'docFile': 'f1',
  'docName': 'Lageplan 2027.pdf',
  'docCount': count,
  'docPage': page,
  'docPages': pages,
  'docRatios': List.filled(count, 0.707),
  'imageId': ?pages['$page'],
  'locked': ?(locked ? true : null),
  'z': 'a$id',
};

Future<_Board> _pump(WidgetTester tester, {List<Map<String, Object?>> objects = const [], bool withHost = true}) async {
  tester.view.physicalSize = const Size(900, 700);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final source = FixtureBoardSource(
    BoardSnapshot.fromJson({'objects': objects}),
    rev: 20,
    features: const ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'act', 'extra'],
    actions: _actions,
  );
  final controller = BoardController(source, presenceInterval: Duration.zero);
  final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController())
    ..onHaptic = () {};
  final host = _Host(_FakePdf([const Size(595, 842), const Size(842, 595), const Size(595, 842)]));
  final ui = BoardUi(editor: editor, registry: standardBoardRegistry(), host: withHost ? host : const BoardHost());
  final hints = <String>[];
  final sub = ui.hints.messages.listen(hints.add);
  addTearDown(() {
    sub.cancel();
    ui.dispose();
    editor.dispose();
    controller.dispose();
  });
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: BoardUiScope(
          ui: ui,
          child: Builder(
            builder: (context) => Stack(
              children: [
                Positioned.fill(
                  child: BoardView(
                    key: ui.viewKey,
                    controller: controller,
                    editor: editor,
                    fitOnLoad: false,
                    onObjectMenu: (w, id) => showBoardMenu(context, ui, MenuTarget.object, MenuAt(w, objectId: id)),
                  ),
                ),
                Positioned.fill(child: BoardOverlays(ui: ui)),
                Positioned(
                  left: 8,
                  right: 8,
                  top: 8,
                  child: ListenableBuilder(
                    listenable: Listenable.merge([editor, controller]),
                    builder: (context, _) => BoardContextBar(ui: ui),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
  await controller.start();
  await tester.pump();
  await tester.pump();
  return _Board(controller, source, editor, ui, host, _Server(source, objects), hints);
}

/// Taps a context bar entry (inline or behind „···“).
Future<void> _ctx(WidgetTester tester, String key) async {
  final inline = find.byKey(Key(key));
  if (inline.evaluate().isNotEmpty) {
    await tester.tap(inline.first);
  } else {
    await tester.tap(find.byKey(const Key('stachelCtxMore')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(Key(key)));
    await tester.tap(find.byKey(Key(key)));
  }
  await tester.pump();
}

void main() {
  testWidgets(
    'PDF einfügen: prüfen, Original, Seite 1 mit 1800 px, Dokument in der 640er-Box, Rest im Hintergrund, gewählt',
    (tester) async {
      final b = await _pump(tester);
      final hold = Completer<String>();
      b.host.holdUpload = hold;
      final done = b.docs.addPdfs([
        PdfInput(bytes: _pdfBytes, name: r'C:\fakepath\Lageplan 2027.pdf'),
      ], at: const Offset(500, 400));
      await tester.pump();
      // placeholder „<Name> wird vorbereitet …“ while the upload runs (only here)
      expect(find.text('Lageplan 2027.pdf'), findsOneWidget);
      expect(find.text('wird vorbereitet …'), findsOneWidget);
      hold.complete('file-1');
      await b.settle(tester);
      final ids = await done;
      await b.settle(tester);
      expect(ids, hasLength(1));
      final created = b.server.objects[ids.single]!;
      expect(created, containsPair('type', 'document'));
      expect(created['docFile'], 'file-1');
      expect(created['docName'], 'Lageplan 2027.pdf');
      expect(created['docCount'], 3);
      expect(created['docRatios'], [0.707, 1.415, 0.707]);
      expect((created['x'], created['y'], created['w'], created['h']), (274.0, 80.0, 452.0, 640.0));
      // page 1 first (1800 px long side), then the others with documents.addPage
      final s = 1800 / 842;
      expect(b.host.pdf.rendered.first, (0, (595 * s).floor(), (842 * s).floor()));
      expect(b.host.pdf.rendered.map((r) => r.$1), [0, 1, 2]);
      expect(b.host.pages, ['Lageplan 2027-seite-1', 'Lageplan 2027-seite-2', 'Lageplan 2027-seite-3']);
      expect(b.acts('documents.addPage').map((a) => (a['args']! as Map)['page']), [1, 2]);
      expect(b.server.objects[ids.single]!['docPages'], {'0': 'img-1', '1': 'img-2', '2': 'img-3'});
      expect(b.editor.selection.value, {ids.single});
      expect(find.text('wird vorbereitet …'), findsNothing);
      // the opened PDF is kept a while, then released (60 s)
      expect(b.host.pdf.disposed, isFalse);
      await tester.pump(const Duration(seconds: 61));
      expect(b.host.pdf.disposed, isTrue);
    },
  );

  testWidgets('PDF abgelehnt: zu groß, Passwort, kaputt (Hinweise wie im Web)', (tester) async {
    final b = await _pump(tester);
    await b.docs.addPdfs([PdfInput(bytes: Uint8List(15 * 1024 * 1024 + 1), name: 'gross.pdf')]);
    b.host.openError = PdfOpenError.password;
    await b.docs.addPdfs([PdfInput(bytes: _pdfBytes, name: 'geheim.pdf')]);
    b.host.openError = PdfOpenError.invalid;
    await b.docs.addPdfs([PdfInput(bytes: _pdfBytes, name: 'kaputt.pdf')]);
    b.host.openError = null;
    b.host.pdf = _FakePdf(List.filled(301, const Size(595, 842)));
    final many = b.docs.addPdfs([PdfInput(bytes: _pdfBytes, name: 'dick.pdf')]);
    await b.settle(tester, rounds: 3);
    await tester.pump();
    expect(b.hints.take(4), [
      '„gross.pdf“ ist größer als 15 MB.',
      'Die PDF ist mit einem Passwort geschützt. Bitte ohne Passwort speichern und erneut hochladen.',
      'Die Datei ist keine lesbare PDF.',
      '„dick.pdf“ hat 301 Seiten – übernommen werden die ersten 300.',
    ]);
    expect(b.host.uploadedPdfs, ['dick.pdf']);
    final id = (await many).single;
    expect(b.server.objects[id]!['docCount'], 300);
    // leave the background pages alone for this test
    b.ui.controller.state[id];
  });

  testWidgets(
    'Seitenleiste am Objekt: blättern für alle ohne Undo-Schritt, fehlende Seite wird erzeugt; Name oben rechts',
    (tester) async {
      final b = await _pump(tester, objects: [_doc()]);
      expect(find.byKey(const Key('stachelDocName-d')), findsOneWidget);
      expect(find.text('Lageplan 2027.pdf'), findsOneWidget);
      expect(find.text('1 / 3'), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelDocNext-d')));
      await tester.pump();
      // preview right away, the server's answer later
      expect(find.text('2 / 3'), findsOneWidget);
      await b.settle(tester);
      expect(b.acts('documents.page').single['args'], {'id': 'd', 'page': 1});
      expect(b.server.objects['d']!['imageId'], 'p1');
      // page 3 has no image yet: rendered from the original and entered
      await tester.tap(find.byKey(const Key('stachelDocNext-d')));
      await b.settle(tester);
      expect(find.text('3 / 3'), findsOneWidget);
      expect(b.host.fetched, ['f1']);
      expect(b.host.pdf.rendered.single.$1, 2);
      expect(b.acts('documents.addPage').single['args'], {'id': 'd', 'page': 2, 'imageId': 'img-1'});
      expect(b.server.objects['d']!['imageId'], 'img-1');
      // at the end: › does nothing
      await tester.tap(find.byKey(const Key('stachelDocNext-d')));
      await b.settle(tester);
      expect(b.acts('documents.page'), hasLength(2));
      // zoomed far out (< 120 px on screen): no name, no page bar
      b.editor.camera.value = const Camera(0, 0, 0.3);
      await tester.pump();
      expect(find.byKey(const Key('stachelDocPager-d')), findsNothing);
      expect(find.byKey(const Key('stachelDocName-d')), findsNothing);
      await tester.pump(const Duration(seconds: 61));
    },
  );

  testWidgets('Kontextleiste und Objekt-Menü wie im Web; gesperrt ohne „Alle Seiten aufs Board“; Herunterladen', (
    tester,
  ) async {
    final b = await _pump(
      tester,
      objects: [
        _doc(),
        _doc(id: 'l', x: 500, locked: true, count: 1, pages: const {'0': 'q0'}),
      ],
    );
    b.editor.select({'d'});
    await tester.pump();
    await _ctx(tester, 'stachelCtxDocNext');
    await b.settle(tester);
    expect(b.server.objects['d']!['docPage'], 1);
    await _ctx(tester, 'stachelCtxDocDownload');
    await tester.pump();
    expect(b.host.saved, [('f1', 'Lageplan 2027.pdf')]);
    // long press menu: the three entries in the web's order (viewer 5, download 6, expand 7)
    b.editor.select({'l'});
    await tester.pump();
    final labels = [
      for (final def in b.ui.registry.menuItems.list().where((m) => m.on == MenuTarget.object))
        def.entry(b.ui, const MenuAt(Offset.zero, objectId: 'l'))?.label,
    ];
    expect(labels.whereType<String>(), containsAllInOrder(['Vollbild ansehen', 'PDF herunterladen']));
    expect(labels, isNot(contains('Alle Seiten aufs Board legen')));
    b.editor.select({'d'});
    await tester.pump();
    final dLabels = [
      for (final def in b.ui.registry.menuItems.list().where((m) => m.on == MenuTarget.object))
        def.entry(b.ui, const MenuAt(Offset.zero, objectId: 'd'))?.label,
    ];
    expect(
      dLabels.whereType<String>(),
      containsAllInOrder(['Vollbild ansehen', 'PDF herunterladen', 'Alle Seiten aufs Board legen']),
    );
    expect(describeObject(b.ui.registry, b.controller.state['d']!), 'PDF: Lageplan 2027.pdf');
    await tester.pump(const Duration(seconds: 61));
  });

  testWidgets('„Alle Seiten aufs Board legen“: fehlende Seiten zuerst, dann ein Schritt, gewählt, Hinweis', (
    tester,
  ) async {
    final b = await _pump(tester, objects: [_doc()]);
    b.editor.select({'d'});
    await tester.pump();
    await _ctx(tester, 'stachelCtxDocExpand');
    await b.settle(tester, rounds: 20);
    expect(b.hints.first, 'Seiten werden vorbereitet (2 von 3) …');
    expect(b.acts('documents.addPage').single['args'], {'id': 'd', 'page': 2, 'imageId': 'img-1'});
    final expand = b.acts('documents.expand').single;
    expect(expand['args'], {'id': 'd'});
    final key = expand['key'];
    expect(b.editor.selection.value, {'$key-1', '$key-2', '$key-3'});
    expect(b.controller.state['$key-3']!.imageId, 'img-1');
    expect(b.hints.last, '3 Seiten liegen als Bilder auf dem Board.');
    await tester.pump(const Duration(seconds: 61));
  });

  testWidgets('Vollbild: Name, n/N, blättern nur lokal, Nachbarn vorgeladen, fehlende Seite, schließt beim Löschen', (
    tester,
  ) async {
    final b = await _pump(tester, objects: [_doc()]);
    b.editor.select({'d'});
    await tester.pump();
    await _ctx(tester, 'stachelCtxDocViewer');
    await tester.pumpAndSettle();
    expect(find.byType(DocumentViewer), findsOneWidget);
    expect(find.byKey(const Key('stachelDocViewerPage')), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const Key('stachelDocViewerPage'))).data, '1 / 3');
    expect(b.host.images, containsAll(['p0', 'p1']));
    await tester.tap(find.byKey(const Key('stachelDocViewerNext')));
    await tester.pumpAndSettle();
    expect(tester.widget<Text>(find.byKey(const Key('stachelDocViewerPage'))).data, '2 / 3');
    // the page at the object stays
    expect(b.acts('documents.page'), isEmpty);
    await tester.tap(find.byKey(const Key('stachelDocViewerNext')));
    await tester.pumpAndSettle();
    // page 3 had no image: rendered and entered (for everyone), then shown
    expect(b.host.pdf.rendered.single.$1, 2);
    await b.settle(tester);
    expect(b.acts('documents.addPage').single['args'], {'id': 'd', 'page': 2, 'imageId': 'img-1'});
    await tester.pumpAndSettle();
    expect(b.host.images, contains('img-1'));
    await tester.tap(find.byKey(const Key('stachelDocViewerDownload')));
    await tester.pump();
    expect(b.host.saved.single.$2, 'Lageplan 2027.pdf');
    // deleted by someone else → closes
    b.source.push(PatchMessage(rev: 99, changes: [const ObjectRemoved('d')]));
    await tester.pumpAndSettle();
    expect(find.byType(DocumentViewer), findsNothing);
    await tester.pump(const Duration(seconds: 61));
  });

  testWidgets(
    'Fehlende aktuelle Seite eines sichtbaren Dokuments: nach 1,5 s selbst erzeugen; Spiegel richtigstellen',
    (tester) async {
      final b = await _pump(
        tester,
        objects: [
          _doc(page: 2),
          _doc(id: 'm', x: 500, page: 1, pages: const {'1': 'm1'})..remove('imageId'),
        ],
      );
      await tester.pump();
      b.server.process();
      await tester.pump();
      // mirror of „m“ is wrong (page 1 has an image, imageId missing) → documents.repair
      expect(b.acts('documents.repair').single['args'], {'id': 'm'});
      await tester.pump(const Duration(milliseconds: 1400));
      b.server.process();
      expect(b.acts('documents.addPage'), isEmpty);
      await tester.pump(const Duration(milliseconds: 200));
      await b.settle(tester);
      expect(b.acts('documents.addPage').single['args'], {'id': 'd', 'page': 2, 'imageId': 'img-1'});
      await tester.pump(const Duration(seconds: 61));
    },
  );

  testWidgets(
    '„Einfügen“ (D24): kopiertes Bild über die Bild-Pipeline, kopierte PDF als Dokument, sonst Text wie bisher',
    (tester) async {
      final b = await _pump(tester);
      final read = BoardClipboard.read;
      addTearDown(() => BoardClipboard.read = read);
      BoardClipboard.read = () async => 'Hallo';
      b.host.clipboard = ClipboardFiles(image: Uint8List(7));
      await pasteAt(b.ui, const Offset(300, 200));
      expect(b.host.addedImages, [(7, const Offset(300, 200))]);
      b.host.clipboard = ClipboardFiles(
        pdfs: [PdfInput(bytes: _pdfBytes, name: 'Kopie.pdf')],
      );
      final pasting = pasteAt(b.ui, const Offset(300, 200));
      await b.settle(tester);
      await pasting;
      await b.settle(tester);
      expect(b.server.objects.values.where((o) => o['type'] == 'document').single['docName'], 'Kopie.pdf');
      b.host.clipboard = const ClipboardFiles();
      await pasteAt(b.ui, const Offset(300, 200));
      await b.settle(tester);
      expect(b.server.objects.values.where((o) => o['type'] == 'sticky'), hasLength(1));
      expect(b.host.addedImages, hasLength(1));
      await tester.pump(const Duration(seconds: 61));
    },
  );

  testWidgets('ohne Dokument-Dienste der App: blättern geht, Herunterladen/Alle Seiten fehlen', (tester) async {
    final b = await _pump(tester, objects: [_doc()], withHost: false);
    b.editor.select({'d'});
    await tester.pump();
    expect(find.byKey(const Key('stachelDocNext-d')), findsOneWidget);
    final items = documentBarItemsForTest(b.ui, b.controller.state['d']!);
    expect(items, isNot(contains('stachelCtxDocDownload')));
    expect(items, isNot(contains('stachelCtxDocExpand')));
    expect(items, contains('stachelCtxDocViewer'));
    // full-screen on a page nobody rendered yet and no way to render it here
    unawaited(openDocumentViewer(tester.element(find.byType(BoardView)), b.ui, 'd'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelDocViewerNext')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelDocViewerNext')));
    await tester.pumpAndSettle();
    expect(find.text('Diese Seite lässt sich gerade nicht anzeigen.'), findsOneWidget);
    expect(find.byKey(const Key('stachelDocViewerDownload')), findsNothing);
  });
}

List<String> documentBarItemsForTest(BoardUi ui, BoardObject o) {
  final def = ui.registry.contextActions['documents.doc']!;
  final ctx = CtxInfo([o]);
  return [for (final i in def.items(_FakeContext(), ui, ctx)) i.key];
}

class _FakeContext extends Fake implements BuildContext {}
