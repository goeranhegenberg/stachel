import 'dart:math' as math;

import 'package:flutter/painting.dart';

import '../../model/board_object.dart';
import '../object_renderers.dart';
import '../paint_utils.dart';
import '../text_layout.dart';
import 'render_common.dart';

// Renderer of `text` objects (split out of `object_renderers.dart` in F2).

/// Free text: no background, wraps at `w` (autoWidth: no wrapping), top aligned.
void paintTextObject(Canvas c, BoardObject o, RenderContext ctx) {
  if (ctx.editingId == o.id) return;
  final color = parseColor(o.color, BoardColors.ink);
  final fs = o.fontSize ?? 24;
  final tp = ctx.text.layout(
    (
      't',
      o.raw['text'],
      o.raw['content'],
      fs,
      o.w,
      o.autoWidth,
      o.bold,
      o.italic,
      o.strike,
      o.align,
      o.color,
      o.fontFamily,
    ),
    () => objectTextSpan(o, fontSize: fs, color: color, fonts: ctx.fonts),
    maxWidth: o.autoWidth ? double.infinity : math.max(1, o.w),
    align: textAlignOf(o.align, TextAlign.left),
  );
  final box = Rect.fromLTWH(0, 0, math.max(o.w, tp.width), math.max(o.h, tp.height));
  paintTextBox(c, tp, box);
}

/// Flat look of a text below 30 % zoom (see `paintObjectSimple`).
void paintTextObjectSimple(Canvas c, BoardObject o, RenderContext ctx, Rect r) {
  c.drawRect(Rect.fromLTWH(0, r.height * 0.2, r.width, r.height * 0.6), fillPaint..color = const Color(0x33000000));
}
