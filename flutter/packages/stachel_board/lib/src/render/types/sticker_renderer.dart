import 'dart:math' as math;

import 'package:flutter/painting.dart';

import '../../features/stickers/sticker_data.dart';
import '../../geometry/svg_path.dart';
import '../../model/board_object.dart';
import '../object_renderers.dart';
import '../paint_utils.dart';
import 'render_common.dart';

// Renderer of `sticker` objects (owner P2): emoji in the system's emoji font, stamps like the web's `StampSvg`
// (round badge, dashed ring, glyph from the web constants).

/// Sticker: emoji (web: `font-size = min(w, h) × 0.84`) or stamp.
void paintSticker(Canvas c, BoardObject o, RenderContext ctx) {
  final s = math.min(o.w, o.h);
  final center = Offset(o.w / 2, o.h / 2);
  final emoji = o.emoji;
  if (emoji == null) {
    c.save();
    c.translate(center.dx - s / 2, center.dy - s / 2);
    paintStamp(c, stampById(o.stamp) ?? stamps.first, s, condensed: ctx.fonts.condensed);
    c.restore();
    return;
  }
  final tp = ctx.text.layout(
    ('emoji', emoji, s),
    () => TextSpan(
      text: emoji,
      style: TextStyle(fontSize: s * 0.84, fontFamily: ctx.fonts.emoji, height: 1),
    ),
    maxWidth: s * 2,
    align: TextAlign.center,
  );
  tp.paint(c, center - Offset(tp.width / 2, tp.height / 2));
}

/// Flat look of a sticker below 30 % zoom (web `simpleStyle`: emoji yellow, stamp its color).
void paintStickerSimple(Canvas c, BoardObject o, RenderContext ctx, Rect r) {
  final bg = o.emoji != null ? '#ffd23f' : (stampById(o.stamp)?.bg ?? '#1763b5');
  c.drawCircle(r.center, math.min(o.w, o.h) / 2, fillPaint..color = parseColor(bg, BoardColors.blue));
}

/// Paints stamp [s] into the square (0,0)–([size],[size]) like the web's `StampSvg` (viewBox 64).
void paintStamp(Canvas c, StampDef s, double size, {String condensed = 'BarlowCondensed'}) {
  final k = size / 64;
  final ink = parseColor(s.ink, const Color(0xFFFFFFFF));
  c.save();
  c.scale(k);
  c.drawCircle(const Offset(32, 32), 29.5, Paint()..color = parseColor(s.bg, BoardColors.blue));
  final ring = Path()..addOval(Rect.fromCircle(center: const Offset(32, 32), radius: 25.5));
  c.drawPath(dashPath(ring, const [2, 3]), strokePaint(ink.withValues(alpha: ink.a * 0.28), 1.5));
  for (final n in s.glyph) {
    _node(c, n, ink, condensed);
  }
  c.restore();
}

double _num(Object? v, [double d = 0]) => v is num ? v.toDouble() : (v is String ? double.tryParse(v) ?? d : d);

/// One SVG node of a stamp glyph (`path`, `text`, `g` with `rotate(a cx cy)`); fill is the ink unless `none`.
void _node(Canvas c, Object? node, Color ink, String condensed) {
  if (node is! List || node.isEmpty || node.first is! String) return;
  final tag = node[0] as String;
  final a = node.length > 1 && node[1] is Map ? (node[1] as Map).cast<String, Object?>() : const <String, Object?>{};
  final children = node.length > 2 && node[2] is List ? node[2] as List : const [];
  switch (tag) {
    case 'path':
      final d = a['d'];
      if (d is! String) return;
      final path = parseSvgPath(d);
      if (a['fill'] != 'none') c.drawPath(path, Paint()..color = ink);
      if (a['stroke'] == 'currentColor') {
        c.drawPath(
          path,
          strokePaint(ink, _num(a['strokeWidth'], 1))
            ..strokeCap = a['strokeLinecap'] == 'round' ? StrokeCap.round : StrokeCap.butt
            ..strokeJoin = a['strokeLinejoin'] == 'round' ? StrokeJoin.round : StrokeJoin.miter,
        );
      }
    case 'text':
      final text = [
        for (final ch in children)
          if (ch is List && ch.length > 2 && ch[0] == '#text') '${ch[2]}',
      ].join();
      final tp = TextPainter(
        text: TextSpan(
          text: text,
          style: TextStyle(
            fontFamily: condensed,
            fontSize: _num(a['fontSize'], 30),
            fontWeight: FontWeight.w800,
            letterSpacing: _num(a['letterSpacing']),
            color: ink,
            height: 1,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      final base = tp.computeDistanceToActualBaseline(TextBaseline.alphabetic);
      final x = _num(a['x'], 32), y = _num(a['y'], 32);
      final dx = a['textAnchor'] == 'middle' ? x - tp.width / 2 : x;
      tp.paint(c, Offset(dx, y - base));
      tp.dispose();
    case 'g':
      c.save();
      final m = RegExp(r'rotate\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)').firstMatch('${a['transform'] ?? ''}');
      if (m != null) {
        final cx = double.parse(m[2]!), cy = double.parse(m[3]!);
        c
          ..translate(cx, cy)
          ..rotate(double.parse(m[1]!) * math.pi / 180)
          ..translate(-cx, -cy);
      }
      for (final ch in children) {
        _node(c, ch, ink, condensed);
      }
      c.restore();
  }
}
