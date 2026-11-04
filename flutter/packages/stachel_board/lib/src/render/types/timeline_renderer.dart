import 'dart:math' as math;

import 'package:flutter/painting.dart';

import '../../features/timeline/timeline_model.dart';
import '../../mindmap/mind_render.dart' show webTextOn;
import '../../model/board_object.dart';
import '../object_renderers.dart';
import '../paint_utils.dart';
import 'render_common.dart';

// Renderer of `timeline` objects (owner P9) like the web's `TimelineView` + `timeline.css`: black header (Monat/Jahr
// above, KW/Tag/Monat below, today in pink), lanes with names left, weekend columns and day/week lines, month lines,
// today line, bars and milestones; „‹ n“ / „n ›“ for items outside the range. Geometry = the web's layout
// (features/timeline/timeline_model.dart): the inner area W0 × H0 is shown scaled to w × h.

const _ink = Color(0xFF0A0A0A);
const _text = Color(0xFF1C1C1A);
const _green = Color(0xFFC9E14A);
const _pink = Color(0xFFEC4E92);
const _mutedOnInk = Color(0xFFA3A39C);
const _laneLine = Color(0xFFE3E3DC);
const _labelLine = Color(0xFFD6D6CF);

/// Width of the „‹ n“ / „n ›“ button (inner units; web: min 34, padding 8, 13 px condensed).
double tlOutsideW(int n) => math.max(34.0, 16 + '‹ $n'.length * 7.0);

/// Box of the button for [side] (`before`/`after`) in inner units.
Rect tlOutsideRect(TlLayout l, String side, int n) {
  final w = tlOutsideW(n);
  return side == 'before'
      ? Rect.fromLTWH(tlLabelW + 4, tlHeadTop + 4, w, 26)
      : Rect.fromLTWH(l.w0 - 4 - w, tlHeadTop + 4, w, 26);
}

void paintTimeline(Canvas c, BoardObject o, RenderContext ctx) {
  final today = tlToday();
  final l = tlLayoutFor(o.raw, today);
  final t = tlTicks(l.range, l.unit, today);
  final dp = l.dayPx;
  final regular = ctx.fonts.regular, cond = ctx.fonts.condensed;
  final outer = RRect.fromRectAndRadius(Rect.fromLTWH(0, 0, o.w, o.h), const Radius.circular(10));
  c.save();
  c.clipRRect(outer);
  c.drawRRect(outer, fillPaint..color = const Color(0xFFFFFFFF));
  c.scale(o.w / l.w0, o.h / l.h0);

  // lanes: background (every second slightly darker), line on top
  for (final (i, lane) in l.lanes.indexed) {
    if (i.isOdd) c.drawRect(Rect.fromLTWH(0, lane.y, l.w0, lane.h), fillPaint..color = const Color(0xFFFAFAF7));
  }
  // grid: weekend columns and day (Tag) / week (Woche) lines
  final gridTop = tlHeadH, gridH = l.h0 - tlHeadH;
  if (l.unit != 'month') {
    final weekend = Paint()..color = const Color(0x0B0A0A0A);
    final line = Paint()..color = const Color(0x120A0A0A);
    for (var n = l.start; n <= l.end; n++) {
      final x = tlLabelW + (n - l.start) * dp;
      if (tlIsWeekend(n)) c.drawRect(Rect.fromLTWH(x, gridTop, dp, gridH), weekend);
      if (l.unit == 'day' || tlWeekday(n) == 0) c.drawRect(Rect.fromLTWH(x, gridTop, 1, gridH), line);
    }
  }
  // month lines (not at the first month)
  final months = l.unit == 'month' ? t.bottom : t.top;
  for (final m in months.skip(1)) {
    c.drawRect(
      Rect.fromLTWH(tlLabelW + m.x - 0.75, tlHeadTop, 1.5, l.h0 - tlHeadTop),
      fillPaint..color = const Color(0x290A0A0A),
    );
  }
  for (final lane in l.lanes) {
    c.drawRect(Rect.fromLTWH(0, lane.y, l.w0, 1), fillPaint..color = _laneLine);
  }
  // name column
  c.drawRect(Rect.fromLTWH(0, tlHeadH, tlLabelW, l.h0 - tlHeadH), fillPaint..color = const Color(0xFFFFFFFF));
  for (final lane in l.lanes) {
    c.drawRect(Rect.fromLTWH(0, lane.y, tlLabelW, 1), fillPaint..color = _laneLine);
    final empty = lane.name.isEmpty;
    final tp = _layout(
      (empty ? 'Ohne Namen' : lane.name).toUpperCase(),
      TextStyle(
        fontFamily: cond,
        fontSize: 17,
        height: 1.15,
        fontWeight: empty ? FontWeight.w600 : FontWeight.w700,
        letterSpacing: 17 * 0.02,
        color: empty ? const Color(0xFFB0B0AA) : _text,
      ),
      tlLabelW - 26,
      maxLines: 2,
    );
    tp.paint(c, Offset(14, lane.y + (lane.h - tp.height) / 2));
    tp.dispose();
  }
  c.drawRect(Rect.fromLTWH(tlLabelW - 1.5, tlHeadH, 1.5, l.h0 - tlHeadH), fillPaint..color = _labelLine);

  // header
  c.drawRect(Rect.fromLTWH(0, 0, l.w0, tlHeadH), fillPaint..color = _ink);
  for (final tk in t.top) {
    final x = tlLabelW + tk.x;
    c.drawRect(Rect.fromLTWH(x, 0, 1, tlHeadTop), fillPaint..color = const Color(0x38FFFFFF));
    if (tk.w < 30) continue;
    final tp = _layout(
      tk.label.toUpperCase(),
      TextStyle(
        fontFamily: cond,
        fontSize: 14,
        fontWeight: FontWeight.w700,
        letterSpacing: 14 * 0.04,
        color: const Color(0xFFFFFFFF),
      ),
      math.max(1, tk.w - 16),
    );
    tp.paint(c, Offset(x + 8, (tlHeadTop - tp.height) / 2));
    tp.dispose();
  }
  for (final tk in t.bottom) {
    final x = tlLabelW + tk.x;
    c.drawRect(Rect.fromLTWH(x, tlHeadTop, 1, tlHeadH - tlHeadTop), fillPaint..color = const Color(0x1FFFFFFF));
    final main = _layout(
      tk.label,
      TextStyle(
        fontFamily: cond,
        fontSize: 14,
        height: 1,
        fontWeight: FontWeight.w600,
        color: tk.today ? const Color(0xFFFFFFFF) : (tk.weekend ? _mutedOnInk : const Color(0xFFE9E9E4)),
      ),
      math.max(1, tk.w),
    );
    final sub = tk.sub != null && (l.unit == 'day' || (l.unit == 'week' && tk.w >= 70))
        ? _layout(
            tk.sub!,
            TextStyle(fontFamily: regular, fontSize: 11, height: 1, fontWeight: FontWeight.w500, color: _mutedOnInk),
            math.max(1, tk.w),
          )
        : null;
    final pad = tk.today ? const (5.0, 2.0) : const (0.0, 0.0);
    final mainH = main.height + 2 * pad.$2;
    final total = mainH + (sub == null ? 0 : sub.height + 1);
    var y = tlHeadTop + (tlHeadH - tlHeadTop - total) / 2;
    final cx = x + tk.w / 2;
    void drawMain() {
      if (tk.today) {
        c.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromLTWH(cx - main.width / 2 - pad.$1, y, main.width + 2 * pad.$1, mainH),
            const Radius.circular(4),
          ),
          fillPaint..color = _pink,
        );
      }
      main.paint(c, Offset(cx - main.width / 2, y + pad.$2));
      y += mainH + 1;
    }

    if (l.unit == 'day' && sub != null) {
      sub.paint(c, Offset(cx - sub.width / 2, y));
      y += sub.height + 1;
      drawMain();
    } else {
      drawMain();
      sub?.paint(c, Offset(cx - sub.width / 2, y));
    }
    main.dispose();
    sub?.dispose();
  }
  // corner („Wochen“)
  c.drawRect(Rect.fromLTWH(0, 0, tlLabelW, tlHeadH), fillPaint..color = _ink);
  c.drawRect(Rect.fromLTWH(tlLabelW - 1, 0, 1, tlHeadH), fillPaint..color = const Color(0x2EFFFFFF));
  final corner = _layout(
    (switch (l.unit) {
      'day' => 'Tage',
      'month' => 'Monate',
      _ => 'Wochen',
    }).toUpperCase(),
    TextStyle(
      fontFamily: cond,
      fontSize: 15,
      height: 1,
      fontWeight: FontWeight.w700,
      letterSpacing: 15 * 0.06,
      color: _green,
    ),
    tlLabelW - 28,
  );
  corner.paint(c, Offset(14, tlHeadH - 9 - corner.height));
  corner.dispose();
  // items outside the range
  for (final (side, n) in [('before', l.before), ('after', l.after)]) {
    if (n == 0) continue;
    final r = tlOutsideRect(l, side, n);
    c.drawRRect(RRect.fromRectAndRadius(r, const Radius.circular(13)), fillPaint..color = _green);
    final tp = _layout(
      side == 'before' ? '‹ $n' : '$n ›',
      TextStyle(fontFamily: cond, fontSize: 13, height: 1, fontWeight: FontWeight.w700, color: _ink),
      r.width,
    );
    tp.paint(c, Offset(r.center.dx - tp.width / 2, r.center.dy - tp.height / 2));
    tp.dispose();
  }
  // today
  if (today >= l.start && today <= l.end) {
    final x = tlLabelW + (today - l.start + 0.5) * dp;
    c.drawRect(Rect.fromLTWH(x - 1, tlHeadTop, 2, l.h0 - tlHeadTop), fillPaint..color = _pink);
  }
  // items
  for (final b in l.items) {
    paintTimelineItem(c, b, regular);
  }
  c.restore();
  c.drawRRect(outer, strokePaint(BoardColors.frameBorder, 1.5));
}

/// One bar or milestone at its inner box (also the drag preview of the overlay).
void paintTimelineItem(Canvas c, TlItemBox b, String font, {double opacity = 1}) {
  final hex = b.it.color ?? tlDefaultColor;
  final color = parseColor(hex, BoardColors.blue).withValues(alpha: opacity);
  if (b.it.ms) {
    // diamond (rotated 45°, scaled 0.82, white ring), title right of it
    final cx = b.x + tlDiamond / 2, cy = b.y + b.h / 2;
    final s = tlDiamond * 0.82;
    c.save();
    c.translate(cx, cy);
    c.rotate(math.pi / 4);
    final rr = RRect.fromRectAndRadius(
      Rect.fromCenter(center: Offset.zero, width: s, height: s),
      const Radius.circular(3),
    );
    c.drawRRect(rr.inflate(3), fillPaint..color = Color.fromRGBO(10, 10, 10, 0.25 * opacity));
    c.drawRRect(rr.inflate(2), fillPaint..color = Color.fromRGBO(255, 255, 255, opacity));
    c.drawRRect(rr, fillPaint..color = color);
    c.restore();
    if (b.it.title.isNotEmpty) {
      final tp = _layout(
        b.it.title,
        TextStyle(
          fontFamily: font,
          fontSize: 14,
          height: 1.1,
          fontWeight: FontWeight.w700,
          color: _text.withValues(alpha: opacity),
        ),
        math.max(1, b.w - tlDiamond - 8),
      );
      tp.paint(c, Offset(b.x + tlDiamond + 8, cy - tp.height / 2));
      tp.dispose();
    }
    return;
  }
  final r = Rect.fromLTWH(b.x, b.y, b.w, b.h);
  const rad = Radius.circular(7);
  final bar = RRect.fromRectAndCorners(
    r,
    topLeft: b.cutL ? Radius.zero : rad,
    bottomLeft: b.cutL ? Radius.zero : rad,
    topRight: b.cutR ? Radius.zero : rad,
    bottomRight: b.cutR ? Radius.zero : rad,
  );
  c.drawRRect(bar.shift(const Offset(0, 1)), fillPaint..color = Color.fromRGBO(0, 0, 0, 0.12 * opacity));
  c.drawRRect(bar, fillPaint..color = color);
  c.drawRRect(bar.deflate(0.5), strokePaint(Color.fromRGBO(0, 0, 0, 0.08 * opacity), 1));
  if (b.it.title.isNotEmpty && b.w > 20) {
    final tp = _layout(
      b.it.title,
      TextStyle(
        fontFamily: font,
        fontSize: 14,
        height: 1.1,
        fontWeight: FontWeight.w600,
        color: webTextOn(hex).withValues(alpha: opacity),
      ),
      b.w - 20,
    );
    c.save();
    c.clipRRect(bar);
    tp.paint(c, Offset(b.x + 10, b.y + (b.h - tp.height) / 2));
    c.restore();
    tp.dispose();
  }
}

/// One line (or [maxLines]) with „…“ like the web's `text-overflow: ellipsis` / line clamp.
TextPainter _layout(String s, TextStyle style, double maxWidth, {int maxLines = 1}) => TextPainter(
  text: TextSpan(text: s, style: style),
  textDirection: TextDirection.ltr,
  maxLines: maxLines,
  ellipsis: '…',
)..layout(maxWidth: math.max(1, maxWidth));

/// Flat look of a timeline below 30 % zoom (see `paintObjectSimple`; web `simpleStyle`: white, black head, ring).
void paintTimelineSimple(Canvas c, BoardObject o, RenderContext ctx, Rect r) {
  c.drawRect(r, fillPaint..color = const Color(0xFFFFFFFF));
  c.drawRect(Rect.fromLTWH(0, 0, r.width, math.min(r.height, 18)), fillPaint..color = _ink);
  c.drawRect(r.deflate(1), strokePaint(const Color(0xFFD9D9D3), 2));
}
