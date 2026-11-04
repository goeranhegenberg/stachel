import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';
import 'dart:typed_data';
import 'dart:ui' show Offset, Size;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/widgets.dart' show BuildContext;
import 'package:http/http.dart' as http;
import 'package:image/image.dart' as img;
import 'package:pasteboard/pasteboard.dart';
import 'package:pdfrx/pdfrx.dart' as rx;
import 'package:stachel_board/stachel_board.dart';

import 'stachel_board_admin.dart' show StachelSharer;
import 'stachel_boards_api.dart';
import 'stachel_client_base.dart';

// PDFs on Stachel boards (audit P7, web `features/documents/files.ts`/`pdf.ts`): the app's side of the package's
// `DocumentHost` – PDFium (pdfrx) instead of pdf.js, the board's REST endpoints with the app session (Bearer), the
// system file picker and share sheet. The logic (sizes, pages, act calls) lives in the package (`Documents`).

/// PDF engine over pdfrx (PDFium): open (password/broken → German error like the web), page sizes in points, render
/// on white and encode as JPEG 0.88 (off the UI thread).
class StachelPdfEngine {
  const StachelPdfEngine();

  static Future<void>? _init;

  /// pdfrx needs its cache directory etc. once; failures (tests without path_provider) do not matter for
  /// `openData`.
  static Future<void> _ensureInit() => _init ??= rx.pdfrxFlutterInitialize().catchError((Object _) {});

  Future<PdfFile> open(Uint8List bytes) async {
    if (!looksLikePdf(bytes)) throw PdfOpenError.invalid;
    await _ensureInit();
    try {
      // PDFium keeps the buffer: a copy, so the caller keeps its bytes
      final doc = await rx.PdfDocument.openData(Uint8List.fromList(bytes));
      return _PdfrxFile(doc);
    } on rx.PdfPasswordException {
      throw PdfOpenError.password;
    } catch (_) {
      throw PdfOpenError.invalid;
    }
  }
}

class _PdfrxFile implements PdfFile {
  _PdfrxFile(this._doc);
  final rx.PdfDocument _doc;
  bool _disposed = false;

  @override
  int get pageCount => _doc.pages.length;

  @override
  Size pageSize(int i) {
    final p = _doc.pages[i];
    return Size(p.width, p.height);
  }

  @override
  Future<RenderedPage> render(int i, int width, int height) async {
    final page = await _doc.pages[i].render(
      fullWidth: width.toDouble(),
      fullHeight: height.toDouble(),
      backgroundColor: 0xffffffff,
    );
    if (page == null) {
      throw const DocumentError('Seite ließ sich nicht als Bild speichern.');
    }
    try {
      final pixels = page.pixels;
      final w = page.width, h = page.height;
      final jpeg = await Isolate.run(() => encodeBgraJpeg(pixels, w, h));
      return RenderedPage(bytes: jpeg, mime: 'image/jpeg', width: w, height: h);
    } finally {
      page.dispose();
    }
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    unawaited(_doc.dispose());
  }
}

/// BGRA pixels (PDFium) → JPEG with the web's quality (0.88).
Uint8List encodeBgraJpeg(Uint8List bgra, int width, int height) {
  final image = img.Image.fromBytes(
    width: width,
    height: height,
    bytes: bgra.buffer,
    bytesOffset: bgra.offsetInBytes,
    numChannels: 4,
    order: img.ChannelOrder.bgra,
  );
  return img.encodeJpg(image, quality: pageJpegQuality);
}

/// Picks PDFs (system file picker). Tests replace it.
typedef StachelPdfPicker = Future<List<PdfInput>> Function();

Future<List<PdfInput>> pickPdfFiles() async {
  final files = await FilePicker.pickFiles(
    dialogTitle: 'PDF wählen',
    type: FileType.custom,
    allowedExtensions: ['pdf'],
  );
  return [for (final f in files) PdfInput(bytes: await f.readAsBytes(), name: f.name)];
}

/// Reads images / files from the system clipboard. Tests replace it.
typedef StachelClipboardReader = Future<ClipboardFiles> Function();

/// [pasteboard]: an image (Android: a copied image's content URI, iOS/desktop: image data) or PDF files with a
/// readable path (iOS/desktop file copies).
Future<ClipboardFiles> readSystemClipboardFiles() async {
  final pdfs = <PdfInput>[];
  try {
    for (final path in await Pasteboard.files()) {
      final f = File(path);
      if (isPdfFile(name: path) && await f.exists() && await f.length() <= maxPdfBytes) {
        pdfs.add(PdfInput(bytes: await f.readAsBytes(), name: path.split(RegExp(r'[\\/]')).last));
      }
    }
  } catch (_) {}
  if (pdfs.isNotEmpty) return ClipboardFiles(pdfs: pdfs);
  try {
    return ClipboardFiles(image: await Pasteboard.image);
  } catch (_) {
    return const ClipboardFiles();
  }
}

/// The [DocumentHost] services of one board screen over [HttpStachelBoardsApi].
class StachelDocuments implements DocumentHost {
  StachelDocuments({
    required this.api,
    required this.boardId,
    required http.Client client,
    this.engine = const StachelPdfEngine(),
    this.sharer = const StachelSharer(),
    StachelPdfPicker? picker,
    StachelClipboardReader? clipboard,
  }) : _client = client,
       _picker = picker ?? pickPdfFiles,
       _clipboard = clipboard ?? readSystemClipboardFiles;

  final HttpStachelBoardsApi api;
  final String boardId;
  final StachelPdfEngine engine;
  final StachelSharer sharer;
  final http.Client _client;
  final StachelPdfPicker _picker;
  final StachelClipboardReader _clipboard;

  static const _timeout = Duration(seconds: 30);

  String get _board => Uri.encodeComponent(boardId);

  DocumentError _network() => DocumentError(StachelException.forCode('network').message, network: true);

  Future<http.Response> _send(Future<http.BaseRequest> Function(String token) build, {bool retried = false}) async {
    final http.Response res;
    try {
      final token = await api.sessionToken(fresh: retried);
      res = await http.Response.fromStream(
        await _client.send(await build(token)).timeout(const Duration(seconds: 120)),
      ).timeout(_timeout);
    } on StachelException catch (e) {
      throw DocumentError(e.message, network: e.code == 'network');
    } catch (_) {
      throw _network();
    }
    if (res.statusCode == 401 && !retried) return _send(build, retried: true);
    return res;
  }

  static String? _error(http.Response res) => _field(res, 'error');

  static String? _field(http.Response res, String name) {
    try {
      final j = jsonDecode(utf8.decode(res.bodyBytes));
      return j is Map && j[name] is String ? j[name] as String : null;
    } catch (_) {
      return null;
    }
  }

  /// Limits of the instance (server `upload-limits.ts`): the server's German text names the size or the used space.
  static const _serverText = {'too_large', 'quota_exceeded', 'board_limit', 'rate_limited'};

  @override
  Future<PdfFile> openPdf(Uint8List bytes) => engine.open(bytes);

  @override
  Future<String> uploadPdf(Uint8List bytes, String name) async {
    final res = await _send((token) async {
      final req = http.MultipartRequest('POST', Uri.parse('${api.base}/api/boards/$_board/files'))
        ..headers.addAll({'Authorization': 'Bearer $token', 'Accept': 'application/json', 'X-Stachel': '1'})
        ..files.add(http.MultipartFile.fromBytes('file', bytes, filename: name));
      return req;
    });
    if (res.statusCode == 201) {
      try {
        final j = jsonDecode(utf8.decode(res.bodyBytes));
        final id = j is Map && j['file'] is Map ? (j['file'] as Map)['id'] : null;
        if (id is String) return id;
      } catch (_) {}
    }
    final code = _error(res);
    if (code == 'unsupported_type') throw const DocumentError('Das ist keine gültige PDF-Datei.');
    final message = _field(res, 'message');
    if (_serverText.contains(code) && message != null) throw DocumentError(message);
    if (code == 'too_large' || res.statusCode == 413) {
      throw const DocumentError('Die PDF ist zu groß (höchstens 15 MB).');
    }
    if (res.statusCode >= 500) throw _network();
    throw DocumentError(StachelException.forCode(code ?? 'error').message);
  }

  Future<Uint8List> _get(String path, {required String gone, required String failed}) async {
    final res = await _send(
      (token) async => http.Request('GET', Uri.parse('${api.base}$path'))..headers['Authorization'] = 'Bearer $token',
    );
    if (res.statusCode == 200) return res.bodyBytes;
    if (res.statusCode == 404) throw DocumentError(gone);
    if (res.statusCode >= 500) throw _network();
    throw DocumentError(failed);
  }

  @override
  Future<Uint8List> fetchPdf(String fileId) => _get(
    '/api/files/${Uri.encodeComponent(fileId)}',
    gone: 'Die PDF-Datei gibt es nicht mehr.',
    failed: 'Die PDF konnte nicht geladen werden.',
  );

  @override
  Future<Uint8List> pageImageBytes(String imageId) => _get(
    '/api/images/${Uri.encodeComponent(imageId)}',
    gone: DocumentTexts.pageUnavailable,
    failed: DocumentTexts.pageUnavailable,
  );

  @override
  Future<String> uploadPage(RenderedPage page, String name) async {
    try {
      final r = await api.uploadImage(boardId, page.bytes, mime: page.mime, name: name);
      return r.id;
    } on StachelException catch (e) {
      throw DocumentError(e.message, network: e.code == 'network');
    }
  }

  @override
  Future<void> savePdf(String fileId, String name) async {
    final bytes = await fetchPdf(fileId);
    await sharer.shareFile(bytes, cleanName(name), 'application/pdf');
  }

  @override
  Future<List<PdfInput>> pickPdfs() => _picker();

  @override
  Future<ClipboardFiles> readClipboardFiles() => _clipboard();

  /// Images go through the board screen's photo pipeline (see [StachelDocumentsHost.addImage]).
  @override
  Future<void> addImage(Uint8List bytes, Offset at) async {}
}

/// [DocumentHost] of the board screen's host: delegates to [documents].
mixin StachelDocumentsHost implements DocumentHost {
  StachelDocuments get documents;

  /// The board screen's image pipeline (E3 `addPhoto`) with the image around [at].
  Future<void> addPhotoAt(Uint8List bytes, Offset at);

  @override
  Future<PdfFile> openPdf(Uint8List bytes) => documents.openPdf(bytes);
  @override
  Future<String> uploadPdf(Uint8List bytes, String name) => documents.uploadPdf(bytes, name);
  @override
  Future<Uint8List> fetchPdf(String fileId) => documents.fetchPdf(fileId);
  @override
  Future<String> uploadPage(RenderedPage page, String name) => documents.uploadPage(page, name);
  @override
  Future<void> savePdf(String fileId, String name) => documents.savePdf(fileId, name);
  @override
  Future<Uint8List> pageImageBytes(String imageId) => documents.pageImageBytes(imageId);
  @override
  Future<List<PdfInput>> pickPdfs() => documents.pickPdfs();
  @override
  Future<ClipboardFiles> readClipboardFiles() => documents.readClipboardFiles();
  @override
  Future<void> addImage(Uint8List bytes, Offset at) => addPhotoAt(bytes, at);
}

/// Share target hook (K13): puts shared PDFs on the open board of [ui] (like the file picker). Returns the new
/// document IDs. Non-PDF files are ignored here (images go through the photo pipeline).
Future<List<String>> addSharedPdfs(BoardUi ui, List<PdfInput> files) => Documents.of(ui).addPdfs([
  for (final f in files)
    if (isPdfFile(name: f.name) || looksLikePdf(f.bytes)) f,
]);

/// Share target (K13, package X's `lib/stachel/stachel_share_target.dart`): handler for `application/pdf`. The
/// integration wires it in X's file with
/// `stachelSharedFileHandlers['application/pdf'] = (context, ui, file) => handleSharedPdf(context, ui, file.path);`
/// (X calls it while the board is live and editable; [path] stays readable until the future completes). Too large
/// files are refused before reading them, like the web („… ist größer als 15 MB.“).
Future<void> handleSharedPdf(BuildContext context, BoardUi ui, String path, {String? name}) async {
  final file = File(path);
  final shown = cleanName(name ?? path.split(RegExp(r'[\\/]')).last);
  try {
    if (await file.length() > maxPdfBytes) {
      ui.hints.show(DocumentTexts.tooLarge(shown));
      return;
    }
    await addSharedPdfs(ui, [PdfInput(bytes: await file.readAsBytes(), name: shown)]);
  } on FileSystemException {
    ui.hints.show(DocumentTexts.uploadFailed);
  }
}
