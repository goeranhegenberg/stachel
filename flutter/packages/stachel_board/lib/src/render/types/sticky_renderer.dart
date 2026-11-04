import 'dart:math' as math;

import 'package:flutter/painting.dart';

import '../../model/board_object.dart';
import '../object_renderers.dart';
import '../paint_utils.dart';
import '../text_fit.dart';
import '../text_layout.dart';
import 'render_common.dart';

// Renderer of `sticky` objects (split out of `object_renderers.dart` in F2).

/// Sticky note: fill, soft shadow, auto-fit text (web `stickyFontSize`, same numbers: [stickyAutoFontSize]), tags.
/// The text box is the padded note like the web (the tags lie over its bottom in their own layer).
void paintSticky(Canvas c, BoardObject o, RenderContext ctx) {
  final fill = parseColor(o.color ?? defaultStickyColor, const Color(0xFFFFF27A));
  final r = Rect.fromLTWH(0, 0, o.w, o.h);
  if (o.raw['stacked'] == true && o.groupId != null) {
    // note stack (Q2, web `shapes/stack/view.tsx`): two paper edges below, same color a little darker
    for (final (d, dark) in const [(10.0, 0.14), (5.0, 0.07)]) {
      final e = r.shift(Offset(d, d));
      c.drawRect(e.shift(const Offset(0, 1)), fillPaint..color = const Color(0x1F000000));
      c.drawRect(e, fillPaint..color = Color.lerp(fill, const Color(0xFF000000), dark)!);
    }
  }
  c.drawRect(r.shift(const Offset(0, 2)), fillPaint..color = const Color(0x12000000));
  c.drawRect(r, fillPaint..color = fill);
  final pad = stickyPadding(o.w, o.h);
  final tags = o.tags;
  final inner = Rect.fromLTRB(pad, pad, o.w - pad, o.h - pad);
  final ink = textOn(fill);
  final text = o.displayText;
  if (text.trim().isNotEmpty && ctx.editingId != o.id) {
    final key = ('s', o.raw['text'], o.raw['content'], o.w, o.h, o.bold, o.italic, o.fontFamily);
    final fs = stickyFontSizeOf(o, (fs) => objectTextSpan(o, fontSize: fs, color: ink, fonts: ctx.fonts));
    final tp = ctx.text.layout(
      (key, fs, o.align, o.strike),
      () => objectTextSpan(o, fontSize: fs, color: ink, fonts: ctx.fonts),
      maxWidth: inner.width,
      align: textAlignOf(o.align, TextAlign.center),
    );
    paintTextBox(c, tp, inner, valign: o.valign ?? 'middle');
  }
  if (tags.isNotEmpty) _tags(c, o, ctx);
}

/// Tags like the web's tag layer (`tags.tsx`, `.tools-tags`): font min(14, max(9, w/16)) px Barlow Condensed 600,
/// pills with 0.15/0.6 em padding and line height 1.3, from the bottom left (7 % in from the sides, 6 % up from the
/// bottom), rows growing upwards (`wrap-reverse`), 0.35 em apart, at most 40 % of the note high.
void _tags(Canvas c, BoardObject o, RenderContext ctx) {
  final fs = (o.w / 16).clamp(9.0, 14.0).toDouble();
  final left = o.w * 0.07, maxW = o.w * 0.86, bottom = o.h * 0.94;
  final pillH = fs * 1.6, gap = fs * 0.35, padX = fs * 0.6;
  final rows = <List<(TextPainter, double, Color)>>[[]];
  var rowW = 0.0;
  for (final t in o.tags) {
    final color = parseColor(t.color, BoardColors.blue);
    final tp = ctx.text.layout(
      ('tag', t.label, fs, t.color, maxW),
      () => TextSpan(
        text: t.label,
        style: TextStyle(
          fontFamily: ctx.fonts.condensed,
          fontSize: fs,
          height: 1.3,
          letterSpacing: 0.02 * fs,
          color: textOn(color),
          fontWeight: FontWeight.w600,
        ),
      ),
      maxWidth: math.max(1, maxW - 2 * padX),
      align: TextAlign.left,
      fill: false,
      ellipsis: '…',
    );
    final w = math.min(maxW, tp.width + 2 * padX);
    if (rows.last.isNotEmpty && rowW + gap + w > maxW) {
      rows.add([]);
      rowW = 0;
    }
    rowW += (rows.last.isEmpty ? 0 : gap) + w;
    rows.last.add((tp, w, color));
  }
  c.save();
  c.clipRect(Rect.fromLTRB(left, bottom - o.h * 0.4, left + maxW, bottom));
  for (var r = 0; r < rows.length; r++) {
    final y = bottom - pillH - r * (pillH + gap);
    var x = left;
    for (final (tp, w, color) in rows[r]) {
      c.drawRRect(
        RRect.fromRectAndRadius(Rect.fromLTWH(x, y, w, pillH), Radius.circular(pillH / 2)),
        fillPaint..color = color,
      );
      tp.paint(c, Offset(x + padX, y + (pillH - tp.height) / 2));
      x += w + gap;
    }
  }
  c.restore();
}

/// Flat look of a sticky below 30 % zoom (see `paintObjectSimple`).
void paintStickySimple(Canvas c, BoardObject o, RenderContext ctx, Rect r) {
  c.drawRect(r, fillPaint..color = parseColor(o.color ?? defaultStickyColor, const Color(0xFFFFF27A)));
}
