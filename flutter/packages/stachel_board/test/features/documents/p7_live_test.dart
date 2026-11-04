// P7 live: PDF documents against the real Stachel server in its sandbox – the app uploads the original and the page
// images with its session (Bearer), creates the document (the web sees `docPages` as its Y.Map), fills the other pages
// in the background (`documents.addPage`), pages for everyone without an undo step (`documents.page`), „Alle Seiten
// aufs Board“ (`documents.expand`: the web has the images, one undo step).
//
//   cd stachel && npm --prefix server run build
//   server\node_modules\.bin\tsx.cmd tools/sandbox.mts 8730 --seed
//   flutter test test/features/documents/p7_live_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8730
//
// Skipped without STACHEL_SANDBOX (or without the stachel repo for the web side).
@Tags(['live'])
library;

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import '../../live_support.dart';

/// 1×1 PNG (page image; the server checks the type and size).
final _png = base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==');

/// Smallest valid PDF with three empty pages (the server checks `%PDF-` and `%%EOF`).
Uint8List _pdf() {
  final objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>',
    for (var i = 0; i < 3; i++) '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>',
  ];
  final out = StringBuffer('%PDF-1.4\n');
  final offs = <int>[];
  for (final (i, o) in objs.indexed) {
    offs.add(out.length);
    out.write('${i + 1} 0 obj\n$o\nendobj\n');
  }
  final xref = out.length;
  out.write('xref\n0 ${objs.length + 1}\n0000000000 65535 f \n');
  for (final o in offs) {
    out.write('${o.toString().padLeft(10, '0')} 00000 n \n');
  }
  out.write('trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n$xref\n%%EOF\n');
  return Uint8List.fromList(latin1.encode(out.toString()));
}

class _Pdf implements PdfFile {
  @override
  int get pageCount => 3;
  @override
  Size pageSize(int i) => const Size(595, 842);
  @override
  Future<RenderedPage> render(int i, int width, int height) async =>
      RenderedPage(bytes: _png, mime: 'image/png', width: 1, height: 1);
  @override
  void dispose() {}
}

/// The app's REST side over dart:io (like `StachelDocuments`).
class _LiveHost extends BoardHost implements DocumentHost {
  _LiveHost(this.board, this.token);
  final String board;
  final Future<String> Function() token;

  Future<Map<String, Object?>> _multipart(String path, Uint8List bytes, String name, String mime) async {
    final client = HttpClient();
    try {
      final boundary = 'p7-${DateTime.now().microsecondsSinceEpoch}';
      final req = await client.postUrl(Uri.parse('$sandbox$path'));
      req.headers
        ..set('Authorization', 'Bearer ${await token()}')
        ..set('X-Stachel', '1')
        ..set('Content-Type', 'multipart/form-data; boundary=$boundary');
      req.add(utf8.encode('--$boundary\r\nContent-Disposition: form-data; name="file"; filename="$name"\r\nContent-Type: $mime\r\n\r\n'));
      req.add(bytes);
      req.add(utf8.encode('\r\n--$boundary--\r\n'));
      final res = await req.close();
      final text = await res.transform(utf8.decoder).join();
      if (res.statusCode != 201) throw DocumentError('$path → ${res.statusCode} $text');
      return (jsonDecode(text) as Map).cast<String, Object?>();
    } finally {
      client.close();
    }
  }

  Future<Uint8List> _get(String path) async {
    final client = HttpClient();
    try {
      final req = await client.getUrl(Uri.parse('$sandbox$path'));
      req.headers.set('Authorization', 'Bearer ${await token()}');
      final res = await req.close();
      final b = BytesBuilder();
      await for (final c in res) {
        b.add(c);
      }
      if (res.statusCode != 200) throw DocumentError('$path → ${res.statusCode}');
      return b.takeBytes();
    } finally {
      client.close();
    }
  }

  @override
  Future<PdfFile> openPdf(Uint8List bytes) async => _Pdf();
  @override
  Future<String> uploadPdf(Uint8List bytes, String name) async =>
      ((await _multipart('/api/boards/$board/files', bytes, name, 'application/pdf'))['file']! as Map)['id']! as String;
  @override
  Future<Uint8List> fetchPdf(String fileId) => _get('/api/files/$fileId');
  @override
  Future<String> uploadPage(RenderedPage page, String name) async =>
      ((await _multipart('/api/boards/$board/images', page.bytes, '$name.png', page.mime))['image']! as Map)['id']!
          as String;
  @override
  Future<Uint8List> pageImageBytes(String imageId) => _get('/api/images/$imageId');
  final saved = <Uint8List>[];
  @override
  Future<void> savePdf(String fileId, String name) async => saved.add(await fetchPdf(fileId));
  @override
  Future<List<PdfInput>> pickPdfs() async => const [];
  @override
  Future<ClipboardFiles> readClipboardFiles() async => const ClipboardFiles();
  @override
  Future<void> addImage(Uint8List bytes, Offset at) async {}
}

void main() {
  late String boardId;
  final tokens = <String, String>{};

  Future<String> token(String who) async => tokens[who] ??=
      ((await liveHttp('POST', '$sandbox/api/auth/app-session', bearer: 'sandbox-$who', body: {}))! as Map)['token']
          as String;

  setUpAll(() async {
    if (liveSkip != null) return;
    final t = await token('mara');
    final b = await liveHttp(
      'POST',
      '$sandbox/api/boards',
      bearer: t,
      write: true,
      body: {'title': 'P7 live ${DateTime.now().toIso8601String()}'},
    );
    boardId = ((b! as Map)['board'] as Map)['id'] as String;
  });

  test('PDF hochladen, Seiten nachtragen, blättern ohne Undo, alle Seiten aufs Board – das Web sieht alles', () async {
    final source = NativeBoardSource(
      base: Uri.parse(sandbox),
      board: boardId,
      token: ({bool fresh = false}) async {
        if (fresh) tokens.remove('mara');
        return token('mara');
      },
      appVersion: '1.25.0+34',
      retryDelays: const [Duration(milliseconds: 100)],
    );
    final c = BoardController(source, presenceInterval: const Duration(milliseconds: 30));
    c.notices.listen((n) => printOnFailure('Hinweis ${n.kind}: ${n.error} ${n.message}'));
    final editor = BoardEditor(controller: c, scene: BoardScene(c.state), camera: CameraController());
    final host = _LiveHost(boardId, () => token('mara'));
    final ui = BoardUi(editor: editor, registry: standardBoardRegistry(), host: host);
    final said = <String>[];
    ui.hints.messages.listen(said.add);
    addTearDown(() {
      Documents.of(ui).closeAll();
      ui.dispose();
      editor.dispose();
      c.dispose();
    });
    await c.start();
    await until(() => c.loaded && c.canEdit);
    for (final n in ['documents.page', 'documents.addPage', 'documents.repair', 'documents.expand']) {
      expect(c.canAct(n), isTrue, reason: n);
    }
    final peer = await WebPeer.start();
    addTearDown(peer.close);
    await peer.cmd({'cmd': 'open', 'board': boardId});

    final docs = Documents.of(ui);
    final ids = await docs.addPdfs([PdfInput(bytes: _pdf(), name: 'Lageplan 2027.pdf')], at: const Offset(0, 0));
    expect(ids, hasLength(1), reason: said.join(' | '));
    final id = ids.single;
    // the web has the document; the other two pages follow in the background
    await untilAsync(() async => ((await peer.object(id))?['docPages'] as Map?)?.length == 3,
        timeout: const Duration(seconds: 20));
    final web = (await peer.object(id))!;
    expect((web['type'], web['docName'], web['docCount'], web['docPage']), ('document', 'Lageplan 2027.pdf', 3, 0));
    expect((web['w'], web['h']), (452, 640));
    expect(web['imageId'], (web['docPages']! as Map)['0']);
    // original: same bytes
    await docs.download(c.state[id]!);
    expect(host.saved.single, _pdf());

    // page for everyone, no undo step
    docs.goToPage(id, 2);
    await untilAsync(() async => (await peer.object(id))?['docPage'] == 2);
    final paged = (await peer.object(id))!;
    expect(paged['imageId'], (paged['docPages']! as Map)['2']);

    // all pages as images (one undo step); undo takes them away, the page stays
    await docs.expand(id);
    await until(() => c.state.objects.values.where((o) => o.type == 'image').length == 3);
    final imgs = [for (final o in c.state.objects.values) if (o.type == 'image') o];
    for (final o in imgs) {
      await untilAsync(() async => (await peer.object(o.id)) != null);
    }
    expect(said.last, '3 Seiten liegen als Bilder auf dem Board.');
    final web0 = (await peer.object(imgs.first.id))!;
    expect((web0['type'], web0['color']), ('image', '#ffffff'));
    c.undo();
    await untilAsync(() async => (await peer.object(imgs.first.id)) == null);
    expect((await peer.object(id))?['docPage'], 2);
  }, skip: liveSkip, timeout: const Timeout(Duration(minutes: 2)));
}
