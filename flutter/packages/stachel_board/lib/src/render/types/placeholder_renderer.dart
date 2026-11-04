import 'dart:math' as math;

import 'package:flutter/painting.dart';

import '../../model/board_object.dart';
import '../object_renderers.dart';
import '../paint_utils.dart';
import 'render_common.dart';

// Renderer of `placeholder` objects (split out of `object_renderers.dart` in F2).

/// Text shown on the placeholder of an unknown type.
const placeholderHint = 'Im Browser ansehen';

/// Unknown type (newer web feature): grey area in the object's size with the type name and „Im Browser ansehen“.
void paintPlaceholder(Canvas c, BoardObject o, RenderContext ctx) {
  final r = Rect.fromLTWH(0, 0, math.max(o.w, 1), math.max(o.h, 1));
  c.drawRect(r, fillPaint..color = BoardColors.placeholder);
  c.drawPath(dashPath(Path()..addRect(r.deflate(1)), [8, 6]), strokePaint(const Color(0xFF9A9A93), 2));
  final fs = (math.min(r.width, r.height) * 0.12).clamp(8.0, 28.0);
  final tp = ctx.text.layout(
    ('ph', o.type, r.width, fs),
    () => TextSpan(
      style: TextStyle(fontFamily: ctx.fonts.regular, color: const Color(0xFF55554F), height: 1.25),
      children: [
        TextSpan(
          text: '${o.type}\n',
          style: TextStyle(fontSize: fs, fontWeight: FontWeight.w700),
        ),
        TextSpan(
          text: placeholderHint,
          style: TextStyle(fontSize: fs * 0.8, decoration: TextDecoration.underline),
        ),
      ],
    ),
    maxWidth: r.width - 12,
    align: TextAlign.center,
  );
  paintTextBox(c, tp, r.deflate(6), valign: 'middle');
}

/// Flat look of an unknown type below 30 % zoom (see `paintObjectSimple`).
void paintPlaceholderSimple(Canvas c, BoardObject o, RenderContext ctx, Rect r) {
  c.drawRect(r, fillPaint..color = BoardColors.placeholder);
}
