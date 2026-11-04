import 'dart:math' as math;

import 'package:flutter/painting.dart';

import '../../features/documents/doc_pages.dart';
import '../../model/board_object.dart';
import '../board_images.dart';
import '../object_renderers.dart';
import 'render_common.dart';

// Renderer of `document` objects (owner P7), like the web's `DocumentView` (`features/documents/view.tsx` +
// `documents.css`): white paper with a light border, the current page fitted in by its ratio, while it is missing lines
// + „Seite n wird vorbereitet …“. File name and page bar are an overlay (`features/documents/document_widgets.dart`),
// constant size at every zoom like the web's world slot.

const _paperBorder = Color(0x1F0A0A0A);
const _missingInk = Color(0xFF6B6B6B);

/// The page area inside the object (other page formats fitted in the middle).
Rect documentSheet(BoardObject o) {
  final r = pageRatio(o, currentPage(o));
  final box = o.w / math.max(1e-9, o.h);
  if (r > box) {
    final h = o.h * box / r;
    return Rect.fromLTWH(0, (o.h - h) / 2, o.w, h);
  }
  final w = o.w * r / box;
  return Rect.fromLTWH((o.w - w) / 2, 0, w, o.h);
}

/// PDF document: the current page image, else a placeholder page.
void paintDocument(Canvas c, BoardObject o, RenderContext ctx) {
  final r = Rect.fromLTWH(0, 0, o.w, o.h);
  c.drawRect(r, fillPaint..color = const Color(0xFFFFFFFF));
  final page = currentPage(o);
  final sheet = documentSheet(o);
  final id = pageImage(o, page);
  final img = id == null ? null : ctx.images.image(id, imageTierFor(o.w * ctx.zoom * ctx.devicePixelRatio));
  if (img != null) {
    c.drawImageRect(
      img,
      Rect.fromLTWH(0, 0, img.width.toDouble(), img.height.toDouble()),
      sheet,
      Paint()..filterQuality = FilterQuality.medium,
    );
  } else if (id == null) {
    // web `.documents-missing`: lines 22/2 in the middle 76 % × 64 %, icon and „Seite n wird vorbereitet …“
    final area = Rect.fromLTWH(
      sheet.left + sheet.width * 0.12,
      sheet.top + sheet.height * 0.18,
      sheet.width * 0.76,
      sheet.height * 0.64,
    );
    final line = Paint()..color = const Color(0x0D0A0A0A);
    for (var y = area.top + 22; y + 2 <= area.bottom; y += 24) {
      c.drawRect(Rect.fromLTWH(area.left, y, area.width, 2), line);
    }
    final fs = 14.0;
    final text = DocumentTextsRender.pagePreparing(page + 1);
    final tp = ctx.text.layout(
      ('docwait', text, sheet.width),
      () => TextSpan(
        text: text,
        style: TextStyle(fontFamily: ctx.fonts.regular, fontSize: fs, fontWeight: FontWeight.w600, color: _missingInk),
      ),
      maxWidth: math.max(20, sheet.width * 0.84),
      align: TextAlign.center,
    );
    final icon = math.max(18.0, math.min(64.0, o.w / 8));
    final total = icon + 8 + tp.height;
    final top = sheet.center.dy - total / 2;
    _docGlyph(c, Rect.fromLTWH(sheet.center.dx - icon / 2, top, icon, icon), _missingInk);
    tp.paint(c, Offset(sheet.center.dx - tp.width / 2, top + icon + 8));
  }
  c.drawRect(r.deflate(0.5), strokePaint(_paperBorder, 1));
}

/// Texts the renderer draws (same as `DocumentTexts` of the feature).
abstract final class DocumentTextsRender {
  static String pagePreparing(int page) => 'Seite $page wird vorbereitet …';
}

/// Document symbol (sheet with folded corner and lines) in [box].
void _docGlyph(Canvas c, Rect box, Color color) {
  final s = box.width;
  final p = strokePaint(color, math.max(1, s * 0.075))
    ..strokeJoin = StrokeJoin.round
    ..strokeCap = StrokeCap.round;
  final l = box.left + s * 0.2, r = box.right - s * 0.2, t = box.top + s * 0.1, b = box.bottom - s * 0.1;
  final fold = s * 0.22;
  c.drawPath(
    Path()
      ..moveTo(l, t)
      ..lineTo(r - fold, t)
      ..lineTo(r, t + fold)
      ..lineTo(r, b)
      ..lineTo(l, b)
      ..close(),
    p,
  );
  for (final f in [0.5, 0.65, 0.8]) {
    c.drawLine(Offset(l + s * 0.12, box.top + s * f), Offset(r - s * 0.12, box.top + s * f), p);
  }
}

/// Flat look of a document below 30 % zoom (web `simpleStyle`: white with a 1 px border).
void paintDocumentSimple(Canvas c, BoardObject o, RenderContext ctx, Rect r) {
  c.drawRect(r, fillPaint..color = const Color(0xFFFFFFFF));
  c.drawRect(r.deflate(0.5), strokePaint(const Color(0x240A0A0A), 1));
}
