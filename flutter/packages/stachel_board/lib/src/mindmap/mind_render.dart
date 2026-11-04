import 'dart:math' as math;

import 'package:flutter/painting.dart';

import '../model/board_object.dart';
import '../render/object_renderers.dart';
import '../render/paint_utils.dart';
import 'mind_model.dart';

// Mind map nodes and lines like the web (stachel `structure/mindmap/mindmap.tsx` `MindView`, `structure.css`
// `.structure-mind*`, `edges.tsx`): root = filled pill in its color with white/black text (Barlow Condensed 28),
// main topic = white pill with a 2.5 px inner border, subtopic = text with a 3 px underline; text with the level's
// padding, left aligned (root centered), placeholder at 40 %; lines from the parent's edge (subtopics: from their
// underline) as a horizontal S-curve in the child's color.

/// Level of a node for drawing (web `levelOf`).
int mindLevel(BoardObject o) => mindLevelOf(o.raw);

/// Color of a node like the web view: own color, else black (root) / the first branch color.
String mindNodeColor(BoardObject o) => o.color ?? (mindLevel(o) == 0 ? '#0a0a0a' : mindColors.first);

/// Readable text on [hex] like the web's `textOn` (luminance by 0.299/0.587/0.114, white below 0.55).
Color webTextOn(String? hex) {
  if (hex == null || !RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(hex)) return BoardColors.ink;
  final r = int.parse(hex.substring(1, 3), radix: 16);
  final g = int.parse(hex.substring(3, 5), radix: 16);
  final b = int.parse(hex.substring(5, 7), radix: 16);
  final lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.55 ? const Color(0xFFFFFFFF) : BoardColors.ink;
}

final _fill = Paint()..isAntiAlias = true;

void _shadow(
  Canvas c,
  RRect r, {
  required double dy,
  required double blur,
  required double spread,
  required double alpha,
}) {
  final s = r.deflate(spread).shift(Offset(0, dy));
  if (s.width <= 0 || s.height <= 0) return;
  c.drawRRect(
    s,
    Paint()
      ..color = Color.fromRGBO(0, 0, 0, alpha)
      ..maskFilter = MaskFilter.blur(BlurStyle.normal, blur / 2),
  );
}

/// Text style of a node (also for the text field while writing).
TextStyle mindTextStyle(BoardObject o, RenderContext ctx, {Color? color}) {
  final level = mindLevel(o);
  final st = mindStyle(level);
  return TextStyle(
    fontFamily: st.condensed ? ctx.fonts.condensed : ctx.fonts.regular,
    fontSize: st.fs,
    fontWeight: FontWeight.values[((o.bold ? 800 : st.weight) ~/ 100 - 1).clamp(0, 8)],
    fontStyle: o.italic ? FontStyle.italic : FontStyle.normal,
    decoration: o.strike ? TextDecoration.lineThrough : TextDecoration.none,
    letterSpacing: st.ls == 0 ? null : st.ls * st.fs,
    height: st.lh,
    color: color ?? (level == 0 ? webTextOn(mindNodeColor(o)) : BoardColors.ink),
  );
}

/// Text area of a node (object coordinates) and its alignment.
EditTextBox mindEditBox(BoardObject o, RenderContext ctx) {
  final level = mindLevel(o);
  final st = mindStyle(level);
  final style = mindTextStyle(o, ctx);
  return EditTextBox(
    box: Rect.fromLTRB(st.padX, st.padY, math.max(st.padX + 1, o.w - st.padX), math.max(st.padY + 1, o.h - st.padY)),
    fontSize: st.fs,
    align: level == 0 ? TextAlign.center : TextAlign.left,
    valign: 'middle',
    color: style.color!,
    weight: o.bold ? 800 : st.weight,
  );
}

/// A mind node in full detail, local coordinates (0,0)–(w,h).
void paintMindNode(Canvas c, BoardObject o, RenderContext ctx) {
  final level = mindLevel(o);
  final st = mindStyle(level);
  final colorHex = mindNodeColor(o);
  final color = parseColor(colorHex, BoardColors.ink);
  final r = Rect.fromLTWH(0, 0, o.w, o.h);
  if (level <= 1) {
    final rr = RRect.fromRectAndRadius(r, Radius.circular(math.min(o.h / 2, 26)));
    if (level == 0) {
      _shadow(c, rr, dy: 10, blur: 24, spread: 12, alpha: 0.55);
      c.drawRRect(rr, _fill..color = color);
    } else {
      _shadow(c, rr, dy: 6, blur: 14, spread: 10, alpha: 0.35);
      c.drawRRect(rr, _fill..color = const Color(0xFFFFFFFF));
      // inset 0 0 0 2.5px: a ring inside the edge
      c.drawDRRect(rr, rr.deflate(2.5), _fill..color = color);
    }
  } else {
    c.drawRect(Rect.fromLTWH(0, o.h - 3, o.w, 3), _fill..color = color);
  }
  if (ctx.editingId == o.id) return; // the text field shows the text
  final empty = o.text.isEmpty;
  final ink = level == 0 ? webTextOn(colorHex) : BoardColors.ink;
  final shown = empty ? mindPlaceholders[math.min(level, 2)] : o.text;
  final style = mindTextStyle(o, ctx, color: empty ? ink.withValues(alpha: 0.4) : ink);
  final align = level == 0 ? TextAlign.center : TextAlign.left;
  final inner = Rect.fromLTRB(st.padX, 0, math.max(st.padX + 1, o.w - st.padX), o.h);
  final tp = ctx.text.layout(
    ('mind', shown, inner.width, level, o.bold, o.italic, o.strike, style.color!.toARGB32()),
    () => TextSpan(text: shown, style: style),
    maxWidth: inner.width,
    align: align,
  );
  c.save();
  c.clipRect(r.inflate(2));
  tp.paint(c, Offset(inner.left, (o.h - tp.height) / 2));
  c.restore();
}

/// A mind node at low zoom (web `simpleStyle`): root filled pill, main topic white with a colored ring, subtopic a
/// colored underline.
void paintMindNodeSimple(Canvas c, BoardObject o) {
  final level = mindLevel(o);
  final color = parseColor(o.color ?? mindColors.first, BoardColors.ink);
  final r = Rect.fromLTWH(0, 0, o.w, o.h);
  final rr = RRect.fromRectAndRadius(r, Radius.circular(o.h / 2));
  if (level == 0) {
    c.drawRRect(rr, _fill..color = color);
  } else if (level == 1) {
    c.drawRRect(rr, _fill..color = const Color(0xFFFFFFFF));
    c.drawDRRect(rr, rr.deflate(math.max(3, o.h * 0.08)), _fill..color = color);
  } else {
    final t = math.max(3.0, o.h * 0.1);
    c.drawRect(Rect.fromLTWH(0, o.h - t, o.w, t), _fill..color = color);
  }
}

/// Line from [p] (parent) to [n] in world coordinates (web `mindEdge`): main topics at the middle, subtopics at
/// their underline.
Path mindEdgePath(BoardObject p, BoardObject n) {
  final side = n.mind.side ?? 'r';
  final pl = mindLevel(p), nl = mindLevel(n);
  final sx = side == 'r' ? p.x + p.w : p.x;
  final sy = pl >= 2 ? p.y + p.h : p.y + p.h / 2;
  final ex = side == 'r' ? n.x : n.x + n.w;
  final ey = nl >= 2 ? n.y + n.h : n.y + n.h / 2;
  final dx = (ex - sx) / 2;
  return Path()
    ..moveTo(sx, sy)
    ..cubicTo(sx + dx, sy, ex - dx, ey, ex, ey);
}

/// Draws the line of [n] to its parent [p] (both visible) in world coordinates.
void paintMindEdgeOf(Canvas c, BoardObject p, BoardObject n) {
  if (n.mind.hidden || p.mind.hidden || p.id == n.id) return;
  c.drawPath(
    mindEdgePath(p, n),
    Paint()
      ..isAntiAlias = true
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = mindLevel(n) <= 1 ? 3 : 2
      ..color = parseColor(n.color ?? mindColors.first, BoardColors.ink),
  );
}
