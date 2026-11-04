import 'dart:math' as math;

import 'package:flutter/painting.dart';

import '../../model/board_object.dart';
import '../object_renderers.dart';
import '../paint_utils.dart';
import 'render_common.dart';

// Renderer of `frame` objects (split out of `object_renderers.dart` in F2).

/// Frame body (title is drawn in screen space by the painter); optional grid with labels.
void paintFrame(Canvas c, BoardObject o, RenderContext ctx) {
  final r = Rect.fromLTWH(0, 0, o.w, o.h);
  c.drawRect(r, fillPaint..color = parseColor(o.color ?? '#ffffff', const Color(0xFFFFFFFF)));
  final g = o.frameGrid;
  if (g != null && g >= 8) {
    final p = strokePaint(const Color(0x22000000), 1);
    final lines = Path();
    for (var x = g; x < o.w && x / g < 400; x += g) {
      lines
        ..moveTo(x, 0)
        ..lineTo(x, o.h);
    }
    for (var y = g; y < o.h && y / g < 400; y += g) {
      lines
        ..moveTo(0, y)
        ..lineTo(o.w, y);
    }
    c.drawPath(lines, p);
    if (o.frameGridLabels) {
      final fs = math.min(g * 0.22, 14.0);
      TextPainter label(String s) => ctx.text.layout(
        ('gridLabel', s, fs),
        () => TextSpan(
          text: s,
          style: TextStyle(
            fontFamily: ctx.fonts.regular,
            fontSize: fs,
            fontWeight: FontWeight.w600,
            color: BoardColors.muted,
          ),
        ),
        maxWidth: g,
        align: TextAlign.left,
      );
      for (var i = 0; i * g < o.w && i < 400; i++) {
        label(gridColumnLabel(i)).paint(c, Offset(i * g + 4, 3));
      }
      for (var i = 1; i * g < o.h && i < 400; i++) {
        label('${i + 1}').paint(c, Offset(4, i * g + 3));
      }
    }
  }
  c.drawRect(r, strokePaint(BoardColors.frameBorder, 1.5));
}

/// Grid labels of a frame (A, B, … / 1, 2, …) are part of the frame body.
String gridColumnLabel(int i) {
  var n = i, s = '';
  do {
    s = String.fromCharCode(65 + n % 26) + s;
    n = n ~/ 26 - 1;
  } while (n >= 0);
  return s;
}

/// Flat look of a frame below 30 % zoom (see `paintObjectSimple`).
void paintFrameSimple(Canvas c, BoardObject o, RenderContext ctx, Rect r) {
  c.drawRect(r, fillPaint..color = parseColor(o.color ?? '#ffffff', const Color(0xFFFFFFFF)));
  c.drawRect(r, strokePaint(BoardColors.frameBorder, 2));
}
