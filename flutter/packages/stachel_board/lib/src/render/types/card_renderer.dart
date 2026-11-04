import 'dart:math' as math;

import 'package:flutter/painting.dart';

import '../../features/cards/card_model.dart';
import '../../mindmap/mind_render.dart' show webTextOn;
import '../../model/board_object.dart';
import '../object_renderers.dart';
import '../paint_utils.dart';
import 'render_common.dart';

// Renderer of `card` objects (owner P3) like the web's `CardView` + structure.css: white body with the color strip,
// title (17/600, wrapped like the browser, placeholder „Titel der Karte“), description (14, at most 4 lines), foot with
// status chip, due date (overdue pink), tags, person avatar on the right. Line breaks and the foot come from
// [cardLayout] (Chromium font metrics), so app, server and browser agree on the height.

const _ink = Color(0xFF0A0A0A);
const _doneInk = Color(0xFF6B6B66);
const _placeholderInk = Color(0x590A0A0A);
const _descInk = Color(0xFF55554F);

Color _mix(Color a, double share, Color b) => Color.lerp(b, a, share)!;

/// Today for due dates (overdue, year shown when not this year); tests with pictures fix it.
DateTime Function() cardNow = DateTime.now;

/// Card: the layout of `.structure-card__inner` (padding 14/16/14/22, radius 10, color strip 6).
void paintCard(Canvas c, BoardObject o, RenderContext ctx) {
  final color = parseColor(o.color, BoardColors.blue);
  final body = RRect.fromRectAndRadius(Rect.fromLTWH(0, 0, o.w, o.h), const Radius.circular(10));
  c.drawRRect(body.shift(const Offset(0, 3)), fillPaint..color = const Color(0x1A000000));
  c.drawRRect(body, fillPaint..color = const Color(0xFFFFFFFF));
  c.save();
  c.clipRRect(body);
  c.drawRect(Rect.fromLTWH(0, 0, 6, o.h), fillPaint..color = color);
  final now = cardNow();
  final l = cardLayout(o, now: now);
  const left = CardLayout.padLeft;
  var y = CardLayout.padTop;
  // title (not drawn while it is edited: the text field shows it)
  final done = o.status == 'done';
  if (ctx.editingId != o.id) {
    final empty = o.text.isEmpty;
    for (final line in l.titleLines) {
      _line(
        c,
        ctx,
        line,
        Offset(left, y),
        CardLayout.titleSize,
        FontWeight.w600,
        empty ? _placeholderInk : (done ? _doneInk : _ink),
        CardLayout.titleLine,
      );
      y += CardLayout.titleLine;
    }
  } else {
    y += l.titleLines.length * CardLayout.titleLine;
  }
  if (l.descLines.isNotEmpty) {
    y += 6;
    final shown = math.min(4, l.descLines.length);
    for (var i = 0; i < shown; i++) {
      var line = l.descLines[i];
      if (i == shown - 1 && l.descLines.length > shown) line = '${line.trimRight()}…';
      _line(
        c,
        ctx,
        line,
        Offset(left, y),
        CardLayout.descSize,
        FontWeight.w500,
        _descInk,
        CardLayout.descLine,
        maxW: l.inner,
      );
      y += CardLayout.descLine;
    }
  }
  if (l.foot.isNotEmpty) {
    final top = y + 12;
    for (final it in l.foot) {
      final r = Rect.fromLTWH(left + it.x, top + it.y, it.w, it.h);
      switch (it.kind) {
        case 'person':
          final key = o.raw['assignee'] is Map ? '${(o.raw['assignee'] as Map)['key'] ?? ''}' : '';
          c.drawCircle(r.center, it.w / 2 + 2, fillPaint..color = const Color(0xFFFFFFFF));
          c.drawCircle(r.center, it.w / 2, fillPaint..color = parseColor(userColorOf(key), BoardColors.blue));
          final ini = initialsOf(it.label);
          final tp = ctx.text.layout(
            ('cardIni', ini),
            () => TextSpan(
              text: ini,
              style: TextStyle(
                fontFamily: ctx.fonts.regular,
                fontSize: it.w * 0.42,
                fontWeight: FontWeight.w700,
                color: const Color(0xFFFFFFFF),
              ),
            ),
            maxWidth: 60,
            align: TextAlign.left,
            fill: false,
          );
          tp.paint(c, r.center - Offset(tp.width / 2, tp.height / 2));
        default:
          final Color bg, fg;
          var lead = 0.0;
          if (it.kind == 'status') {
            final sc = parseColor(it.color, BoardColors.muted);
            bg = _mix(sc, 0.14, const Color(0xFFFFFFFF));
            fg = _mix(sc, 0.8, const Color(0xFF000000));
            lead = CardLayout.chipDot;
          } else if (it.kind == 'due') {
            final over = isOverdue(o, now);
            bg = over ? const Color(0xFFFDE7F0) : const Color(0xFFF1F1EC);
            fg = over ? const Color(0xFFB0175A) : const Color(0xFF3A3A36);
            lead = CardLayout.chipIcon;
          } else {
            bg = parseColor(it.color, BoardColors.green);
            fg = webTextOn(it.color);
          }
          c.drawRRect(RRect.fromRectAndRadius(r, const Radius.circular(6)), fillPaint..color = bg);
          var x = r.left + CardLayout.chipPad;
          if (it.kind == 'status') {
            c.drawCircle(
              Offset(x + lead / 2, r.center.dy),
              lead / 2,
              fillPaint..color = parseColor(it.color, BoardColors.muted),
            );
          } else if (it.kind == 'due') {
            _calendar(c, Rect.fromLTWH(x, r.center.dy - lead / 2, lead, lead), fg);
          }
          if (lead > 0) x += lead + CardLayout.chipIconGap;
          c.save();
          c.clipRect(Rect.fromLTRB(r.left, r.top, r.right - CardLayout.chipPad + 1, r.bottom));
          final tp = ctx.text.layout(
            ('cardChip', it.label, fg.toARGB32()),
            () => TextSpan(
              text: it.label,
              style: TextStyle(
                fontFamily: ctx.fonts.regular,
                fontSize: CardLayout.chipSize,
                fontWeight: FontWeight.w600,
                color: fg,
              ),
            ),
            maxWidth: 2000,
            align: TextAlign.left,
            fill: false,
          );
          tp.paint(c, Offset(x, r.center.dy - tp.height / 2));
          c.restore();
      }
    }
  }
  c.restore();
  c.drawRRect(body, strokePaint(const Color(0x140A0A0A), 1));
}

void _line(
  Canvas c,
  RenderContext ctx,
  String text,
  Offset at,
  double size,
  FontWeight weight,
  Color color,
  double lineHeight, {
  double maxW = 4000,
}) {
  if (text.isEmpty) return;
  final tp = ctx.text.layout(
    ('cardLine', text, size, weight.value, color.toARGB32()),
    () => TextSpan(
      text: text,
      style: TextStyle(fontFamily: ctx.fonts.regular, fontSize: size, fontWeight: weight, color: color),
    ),
    maxWidth: 4000,
    align: TextAlign.left,
    fill: false,
  );
  c.save();
  c.clipRect(Rect.fromLTWH(at.dx, at.dy, maxW, lineHeight));
  tp.paint(c, Offset(at.dx, at.dy + (lineHeight - tp.height) / 2));
  c.restore();
}

/// Small calendar symbol (web `IconCalendar` at 13 px).
void _calendar(Canvas c, Rect r, Color color) {
  final p = strokePaint(color, 1.4);
  final box = Rect.fromLTRB(r.left + 1, r.top + 2, r.right - 1, r.bottom - 1);
  c.drawRRect(RRect.fromRectAndRadius(box, const Radius.circular(2)), p);
  c.drawLine(Offset(box.left, box.top + 3.5), Offset(box.right, box.top + 3.5), p);
  c.drawLine(Offset(box.left + 3, r.top + 0.5), Offset(box.left + 3, box.top + 1.5), p);
  c.drawLine(Offset(box.right - 3, r.top + 0.5), Offset(box.right - 3, box.top + 1.5), p);
}

/// Flat look of a card below 30 % zoom (see `paintObjectSimple`; web `simpleStyle`: white, color edge ≥ 6, radius 8).
void paintCardSimple(Canvas c, BoardObject o, RenderContext ctx, Rect r) {
  c.drawRRect(RRect.fromRectAndRadius(r, const Radius.circular(8)), fillPaint..color = const Color(0xFFFFFFFF));
  c.drawRect(
    Rect.fromLTWH(r.left, r.top, math.min(math.max(6, o.w * 0.04), r.width), r.height),
    fillPaint..color = parseColor(o.color, BoardColors.blue),
  );
}
