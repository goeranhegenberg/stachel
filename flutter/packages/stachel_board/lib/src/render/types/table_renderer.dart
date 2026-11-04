import 'dart:math' as math;

import 'package:flutter/painting.dart';

import '../../mindmap/mind_render.dart' show webTextOn;
import '../../features/tables/table_model.dart';
import '../../model/board_object.dart';
import '../object_renderers.dart';
import '../paint_utils.dart';
import 'render_common.dart';

// Renderer of `table` objects (owner P3) like the web's `TableView` + structure.css: grid of cells (padding 10/12,
// 15 px, line height 1.35, lines wrapped like the browser), head row in the head color (bold, text color by contrast),
// head column light grey and bold, cell borders #e0e0d9, rounded frame. The active cell and the cell editor are an
// overlay of the tables package (they depend on the selection).

const _cellInk = Color(0xFF1C1C1A);
const _headColBg = Color(0xFFF3F3EE);
const _border = Color(0xFFE0E0D9);

/// Table: column widths from weights, row heights from the wrapped cells (stretched to `h` like the web).
void paintTable(Canvas c, BoardObject o, RenderContext ctx) {
  final g = TableGeometry(o);
  final d = g.data;
  final body = RRect.fromRectAndRadius(Rect.fromLTWH(0, 0, o.w, o.h), const Radius.circular(8));
  c.drawRRect(body.shift(const Offset(0, 4)), fillPaint..color = const Color(0x14000000));
  c.drawRRect(body, fillPaint..color = const Color(0xFFFFFFFF));
  c.save();
  c.clipRRect(body);
  final headColor = parseColor(o.color, BoardColors.ink);
  final headInk = webTextOn(o.color ?? '#0a0a0a');
  final headRow = hasHeadRow(o), headCol = hasHeadCol(o);
  final headBorder = Color.lerp(const Color(0x00000000), headInk, 0.18)!;
  var y = 0.0;
  for (var ri = 0; ri < d.rows.length; ri++) {
    final rh = g.heights[ri];
    var x = 0.0;
    for (var ci = 0; ci < d.cols.length; ci++) {
      final cw = g.widths[ci];
      final isHead = headRow && ri == 0;
      final isHeadCol = headCol && ci == 0 && !isHead;
      final cell = Rect.fromLTWH(x, y, cw, rh);
      if (isHead) c.drawRect(cell, fillPaint..color = headColor);
      if (isHeadCol) c.drawRect(cell, fillPaint..color = _headColBg);
      final text = d.cell(d.rows[ri], d.cols[ci]);
      if (text.isNotEmpty) {
        final bold = isHead || isHeadCol;
        final color = isHead ? headInk : _cellInk;
        // line breaks like the browser (the web measures the head row bold)
        final lines = cellLines(text, cw, headRow && ri == 0);
        final lh = tableFs * tableLh;
        c.save();
        c.clipRect(cell);
        var ly = y + tablePadY;
        for (final line in lines) {
          if (line.isNotEmpty) {
            final tp = ctx.text.layout(
              ('tableLine', line, bold, color.toARGB32()),
              () => TextSpan(
                text: line,
                style: TextStyle(
                  fontFamily: ctx.fonts.regular,
                  fontSize: tableFs,
                  fontWeight: bold ? FontWeight.w700 : FontWeight.w500,
                  color: color,
                ),
              ),
              maxWidth: 4000,
              align: TextAlign.left,
              fill: false,
            );
            tp.paint(c, Offset(x + tablePadX, ly + (lh - tp.height) / 2));
          }
          ly += lh;
        }
        c.restore();
      }
      // right and bottom border of the cell
      final b = strokePaint(isHead ? headBorder : _border, 1);
      c.drawLine(Offset(x + cw - 0.5, y), Offset(x + cw - 0.5, y + rh), b);
      c.drawLine(Offset(x, y + rh - 0.5), Offset(x + cw, y + rh - 0.5), b);
      x += cw;
    }
    y += rh;
  }
  c.restore();
  c.drawRRect(body, strokePaint(const Color(0xFFCFCFC8), 1.5));
}

/// Flat look of a table below 30 % zoom (see `paintObjectSimple`; web `simpleStyle`: white, head band, grey edge).
void paintTableSimple(Canvas c, BoardObject o, RenderContext ctx, Rect r) {
  final body = RRect.fromRectAndRadius(r, const Radius.circular(6));
  c.drawRRect(body, fillPaint..color = const Color(0xFFFFFFFF));
  c.save();
  c.clipRRect(body);
  c.drawRect(
    Rect.fromLTWH(r.left, r.top, r.width, math.max(6, math.min(o.h * 0.2, 40))),
    fillPaint..color = o.type == 'table' ? parseColor(o.color, BoardColors.ink) : const Color(0xFFE6E6E1),
  );
  c.restore();
  c.drawRRect(body, strokePaint(const Color(0xFFD9D9D3), 2));
}
