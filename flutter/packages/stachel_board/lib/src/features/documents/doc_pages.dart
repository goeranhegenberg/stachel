import 'dart:math' as math;
import 'dart:ui';

import '../../model/board_object.dart';

// Pure page logic of the web module „documents“ (`web/src/features/documents/pages.ts`, `model.ts`): page count,
// current page, page images, ratios, sizes, render scale, file names. Same rules as the web, read from the raw object
// map (the typed getters of `BoardObject` clamp differently: `docCount` 0 there, here at least 1 like the web).

/// Object type of PDF documents.
const docType = 'document';

/// Size of the original PDF (like images: nginx takes at most 16 MB per request).
const maxPdfBytes = 15 * 1024 * 1024;

/// More pages are not taken over (memory, upload time).
const maxPages = 300;

/// Longer side of the page images in pixels.
const pagePx = 1800.0;

/// At most this many pixels per page image (very wide plans).
const pageMaxPixels = 4000000.0;

/// JPEG quality of page images (web: WebP 0.85 where the browser writes it, else JPEG 0.88 – Flutter writes JPEG).
const pageJpegQuality = 88;

/// Below this screen width (px) the document shows neither page bar nor name (web `MIN_SCREEN_W`).
const docMinScreenW = 120.0;

/// Wait this long before rendering a missing current page myself (the uploader is usually faster).
const lazyFillDelay = Duration(milliseconds: 1500);

/// Opened PDFs stay this long in memory (paging without a new download).
const keepPdfOpen = Duration(seconds: 60);

bool isDoc(BoardObject? o) => o != null && o.type == docType;

double? _num(Object? v) => v is num && v.isFinite ? v.toDouble() : null;

/// Page count (at least 1).
int pageCount(BoardObject o) => math.max(1, (_num(o.raw['docCount']) ?? 1).floor());

/// Current page, clamped to the valid range (foreign/broken values tolerated).
int currentPage(BoardObject o, [Object? page]) {
  final v = page ?? o.raw['docPage'];
  final p = (_num(v) ?? 0).floor();
  return math.min(pageCount(o) - 1, math.max(0, p));
}

/// Image ID of a page (null = not rendered yet).
String? pageImage(BoardObject o, int i) {
  final pages = o.raw['docPages'];
  if (pages is! Map) return null;
  final v = pages['$i'];
  return v is String && v.isNotEmpty ? v : null;
}

/// Aspect ratio width/height of a page (default: the first page's, else A4 portrait).
double pageRatio(BoardObject o, int i) {
  final rs = o.raw['docRatios'];
  Object? r;
  if (rs is List) r = i >= 0 && i < rs.length ? rs[i] : (rs.isNotEmpty ? rs[0] : null);
  final v = _num(r);
  return v != null && v > 0.05 && v < 20 ? v : 595 / 842;
}

/// Pages without an image, the current one first.
List<int> missingPages(BoardObject o) {
  final n = pageCount(o);
  final cur = currentPage(o);
  return [
    if (pageImage(o, cur) == null) cur,
    for (var i = 0; i < n; i++)
      if (i != cur && pageImage(o, i) == null) i,
  ];
}

/// „3 / 12“
String pageLabel(int i, int n) => '${i + 1} / $n';

/// Object size on insert: the page fits a square of [box] world units.
Size docSize(double ratio, [double box = 640]) =>
    ratio >= 1 ? Size(box, docRound(box / ratio)) : Size(docRound(box * ratio), box);

/// Scale for rendering a page (points → pixels): longer side [longSide], at most [maxPixels].
double renderScale(double wPt, double hPt, {double longSide = pagePx, double maxPixels = pageMaxPixels}) {
  final w = math.max(1.0, wPt);
  final h = math.max(1.0, hPt);
  return math.min(longSide / math.max(w, h), math.sqrt(maxPixels / (w * h)));
}

/// Pixel size of a rendered page like the web's canvas (`Math.floor` of the viewport, at least 1).
({int width, int height}) renderSize(double wPt, double hPt) {
  final s = renderScale(wPt, hPt);
  return (width: math.max(1, (wPt * s).floor()), height: math.max(1, (hPt * s).floor()));
}

/// Width/height with 3 decimals like the web's `pageRatios`.
double ratioOf(double wPt, double hPt) => docRound(wPt / math.max(1e-9, hPt) * 1000) / 1000;

/// Grid of „Alle Seiten aufs Board legen“ (web `expandLayout`): right of the document, top aligned, pages as wide as
/// the document, row by row, about as many columns as rows (wider than high), at most 10. The server computes it
/// (act `documents.expand`); the app uses it only for its own checks.
List<Rect> expandLayout(BoardObject o, [int? count]) {
  final n = count ?? pageCount(o);
  final w = math.max(40.0, o.w);
  final gap = docRound(w * 0.08);
  final cols = math.max(1, math.min(10, math.min(n, (math.sqrt(n * 1.6)).ceil())));
  final out = <Rect>[];
  var y = o.y;
  for (var row = 0; row * cols < n; row++) {
    var rowH = 0.0;
    for (var c = 0; c < cols && row * cols + c < n; c++) {
      final i = row * cols + c;
      final h = docRound(w / pageRatio(o, i));
      out.add(Rect.fromLTWH(docRound(o.x + o.w + gap + c * (w + gap)), docRound(y), docRound(w), h));
      rowH = math.max(rowH, h);
    }
    y += rowH + gap;
  }
  return out;
}

/// File name without path and control characters, at most 120 characters (display, download).
String cleanName(String name) {
  final parts = name.split(RegExp(r'[\\/]'));
  final s = parts.last.replaceAll(RegExp(r'[\u0000-\u001f\u007f]'), '').replaceAll(RegExp(r'\s+'), ' ').trim();
  final base = s.isEmpty ? 'Dokument.pdf' : s;
  return base.length > 120 ? '${base.substring(0, 116)}.pdf' : base;
}

/// Is that a PDF? (type or extension; the content is checked when opening and on the server)
bool isPdfFile({String? name, String? mime}) =>
    mime == 'application/pdf' || RegExp(r'\.pdf$', caseSensitive: false).hasMatch(name ?? '');

/// `%PDF-` at the start (magic bytes; the server checks the same plus `%%EOF`).
bool looksLikePdf(List<int> b) =>
    b.length >= 5 && b[0] == 0x25 && b[1] == 0x50 && b[2] == 0x44 && b[3] == 0x46 && b[4] == 0x2d;

/// JS `Math.round` (halves up, also for negative numbers).
double docRound(double v) => (v + 0.5).floorToDouble();
