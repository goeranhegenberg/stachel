import 'dart:math' as math;

import 'package:flutter/painting.dart';

import '../../model/board_object.dart';
import '../board_images.dart';
import '../object_renderers.dart';
import '../paint_utils.dart';
import 'render_common.dart';

// Renderer of `image` objects (split out of `object_renderers.dart` in F2).

/// Image: the best loaded tier, else its average color.
void paintImageObject(Canvas c, BoardObject o, RenderContext ctx) {
  final r = Rect.fromLTWH(0, 0, o.w, o.h);
  final id = o.imageId;
  final img = id == null ? null : ctx.images.image(id, imageTierFor(o.w * ctx.zoom * ctx.devicePixelRatio));
  if (img == null) {
    if (id == null || ctx.images.missing(id)) return paintImageMissing(c, r, ctx);
    // average color like the web, plus a picture symbol while the image loads (or is not cached offline)
    final fill = parseColor(o.color, BoardColors.placeholder);
    c.drawRect(r, fillPaint..color = fill);
    _imageGlyph(c, r, textOn(fill).withValues(alpha: 0.35));
    return;
  }
  c.drawImageRect(
    img,
    Rect.fromLTWH(0, 0, img.width.toDouble(), img.height.toDouble()),
    r,
    Paint()..filterQuality = FilterQuality.medium,
  );
}

/// Text of a permanently missing image (web `ImageView`: `image-missing`).
const imageMissingText = 'Bild nicht verfügbar';

/// A permanently missing image like the web's `.image-missing`: grey stripes (−45°, #ecece7/#e4e4de, 10 px each),
/// in the middle the picture symbol (28 px) and „Bild nicht verfügbar“ (14 px, 600, `--muted`), 6 px apart, 8 px
/// padding – all in object units like the web's CSS px.
void paintImageMissing(Canvas c, Rect r, RenderContext ctx) {
  const muted = Color(0xFF6B6B66);
  c.save();
  c.clipRect(r);
  c.drawRect(r, fillPaint..color = const Color(0xFFECECE7));
  final band = Paint()
    ..color = const Color(0xFFE4E4DE)
    ..strokeWidth = 10;
  // stripes x + y = d·√2, d = 15, 35, … (the darker half of each 20 px period)
  final reach = r.width + r.height + 20;
  for (var d = 15.0; d * math.sqrt2 < reach; d += 20) {
    final s = d * math.sqrt2;
    c.drawLine(Offset(r.left + s, r.top), Offset(r.left, r.top + s), band);
  }
  final tp = ctx.text.layout(
    ('imageMissing', r.width),
    () => TextSpan(
      text: imageMissingText,
      style: TextStyle(
        fontFamily: ctx.fonts.regular,
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: muted,
        height: 1.2,
      ),
    ),
    maxWidth: math.max(1, r.width - 16),
    align: TextAlign.center,
  );
  const icon = 28.0, gap = 6.0;
  final top = r.top + (r.height - (icon + gap + tp.height)) / 2;
  _missingIcon(c, Offset(r.center.dx - icon / 2, top), icon, muted);
  tp.paint(c, Offset(r.left + 8, top + icon + gap));
  c.restore();
}

/// The web's symbol (viewBox 24: frame `M4 5h16v14H4z`, hills `M4 15l4.5-4.5 4 4 2.5-2.5L20 17`, sun r 1.6 at
/// 15.5/9; stroke 1.6) at [at] in [size].
void _missingIcon(Canvas c, Offset at, double size, Color color) {
  final k = size / 24;
  Offset p(double x, double y) => at + Offset(x * k, y * k);
  final stroke = Paint()
    ..style = PaintingStyle.stroke
    ..strokeWidth = 1.6 * k
    ..strokeJoin = StrokeJoin.round
    ..color = color;
  final path = Path()
    ..moveTo(p(4, 5).dx, p(4, 5).dy)
    ..lineTo(p(20, 5).dx, p(20, 5).dy)
    ..lineTo(p(20, 19).dx, p(20, 19).dy)
    ..lineTo(p(4, 19).dx, p(4, 19).dy)
    ..close()
    ..moveTo(p(4, 15).dx, p(4, 15).dy)
    ..lineTo(p(8.5, 10.5).dx, p(8.5, 10.5).dy)
    ..lineTo(p(12.5, 14.5).dx, p(12.5, 14.5).dy)
    ..lineTo(p(15, 12).dx, p(15, 12).dy)
    ..lineTo(p(20, 17).dx, p(20, 17).dy);
  c.drawPath(path, stroke);
  c.drawCircle(p(15.5, 9), 1.6 * k, Paint()..color = color);
}

/// Small picture symbol (frame, sun, hills) in the middle of [r], at most a quarter of its short side.
void _imageGlyph(Canvas c, Rect r, Color color) {
  final s = math.min(48.0, math.min(r.width, r.height) * 0.25);
  if (s < 8) return;
  final box = Rect.fromCenter(center: r.center, width: s, height: s * 0.8);
  final stroke = Paint()
    ..style = PaintingStyle.stroke
    ..strokeWidth = math.max(1, s * 0.07)
    ..strokeJoin = StrokeJoin.round
    ..color = color;
  c.drawRRect(RRect.fromRectAndRadius(box, Radius.circular(s * 0.08)), stroke);
  c.drawCircle(box.topLeft + Offset(s * 0.3, s * 0.27), s * 0.08, Paint()..color = color);
  c.drawPath(
    Path()
      ..moveTo(box.left + s * 0.12, box.bottom - s * 0.12)
      ..lineTo(box.left + s * 0.42, box.top + s * 0.38)
      ..lineTo(box.left + s * 0.62, box.top + s * 0.55)
      ..lineTo(box.left + s * 0.74, box.top + s * 0.45)
      ..lineTo(box.right - s * 0.12, box.bottom - s * 0.12),
    stroke,
  );
}

/// Flat look of a image below 30 % zoom (see `paintObjectSimple`).
void paintImageObjectSimple(Canvas c, BoardObject o, RenderContext ctx, Rect r) {
  final id = o.imageId;
  final img = id == null ? null : ctx.images.image(id, 256);
  if (img == null) {
    c.drawRect(r, fillPaint..color = parseColor(o.color, BoardColors.placeholder));
  } else {
    c.drawImageRect(img, Rect.fromLTWH(0, 0, img.width.toDouble(), img.height.toDouble()), r, Paint());
  }
}
