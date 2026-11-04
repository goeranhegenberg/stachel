import 'dart:typed_data';
import 'dart:ui';

import '../../editor/registry/board_ui.dart';

// What the documents feature (P7) needs from the app: a PDF engine (the web uses pdf.js in the browser, the app
// PDFium), the board's REST endpoints for the original PDF and the page images, the system file picker and share
// sheet. The package keeps the web's logic (sizes, render scale, pages, act calls); the app implements this.

/// A PDF chosen by the user or shared into the app.
class PdfInput {
  const PdfInput({required this.bytes, required this.name});
  final Uint8List bytes;
  final String name;
}

/// What „Einfügen“ finds in the system clipboard besides text (D24, web: Strg V of a copied file or image).
class ClipboardFiles {
  const ClipboardFiles({this.image, this.pdfs = const []});
  final Uint8List? image;
  final List<PdfInput> pdfs;
  bool get isEmpty => image == null && pdfs.isEmpty;
}

/// A rendered page image, ready for the image upload (`POST /api/boards/:id/images`).
class RenderedPage {
  const RenderedPage({required this.bytes, required this.mime, required this.width, required this.height});
  final Uint8List bytes;
  final String mime;
  final int width;
  final int height;
}

/// An opened PDF.
abstract class PdfFile {
  int get pageCount;

  /// Page size in points (1/72 inch), page [i] from 0.
  Size pageSize(int i);

  /// Page [i] rendered at [width] × [height] pixels on white, encoded for the upload.
  Future<RenderedPage> render(int i, int width, int height);
  void dispose();
}

/// Why a PDF could not be opened (web `PdfError`).
class PdfOpenError implements Exception {
  const PdfOpenError(this.code, this.message);

  /// `password`, `invalid`.
  final String code;
  final String message;

  static const password = PdfOpenError(
    'password',
    'Die PDF ist mit einem Passwort geschützt. Bitte ohne Passwort speichern und erneut hochladen.',
  );
  static const invalid = PdfOpenError('invalid', 'Die Datei ist keine lesbare PDF.');

  @override
  String toString() => message;
}

/// A failed REST call with a German text for the hint (network, too large, gone …).
class DocumentError implements Exception {
  const DocumentError(this.message, {this.network = false});
  final String message;

  /// No connection (the web says the same as for other network errors).
  final bool network;

  @override
  String toString() => message;
}

/// Services of the host app for PDF documents. The board screen's [BoardHost] implements it; without it the PDF
/// entries are hidden (and paging still works).
abstract interface class DocumentHost {
  /// Opens [bytes]; throws [PdfOpenError] (password, broken).
  Future<PdfFile> openPdf(Uint8List bytes);

  /// Uploads the original (`POST /api/boards/:id/files`), returns the file ID.
  Future<String> uploadPdf(Uint8List bytes, String name);

  /// The original (`GET /api/files/:id`).
  Future<Uint8List> fetchPdf(String fileId);

  /// Uploads a page image (image pipeline), returns the image ID.
  Future<String> uploadPage(RenderedPage page, String name);

  /// „PDF herunterladen“: the original with its name through the system share sheet / „Öffnen mit“.
  Future<void> savePdf(String fileId, String name);

  /// A page image in full size for the full-screen view (`GET /api/images/:id`).
  Future<Uint8List> pageImageBytes(String imageId);

  /// System file picker for PDFs (several at once like the web's file input); empty = cancelled.
  Future<List<PdfInput>> pickPdfs();

  /// Image / PDF files in the system clipboard (empty = only text or nothing).
  Future<ClipboardFiles> readClipboardFiles();

  /// Puts an image on the board around [at] through the app's image pipeline (upload, placeholder, offline queue).
  Future<void> addImage(Uint8List bytes, Offset at);
}

/// The [DocumentHost] of [ui] (null: no PDF upload/download in this host).
DocumentHost? documentHost(BoardUi ui) => ui.host is DocumentHost ? ui.host as DocumentHost : null;
