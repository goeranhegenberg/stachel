import 'dart:math' as math;

import 'package:flutter/painting.dart';

import '../../geometry/connector_route.dart';
import '../../geometry/shape_paths.dart';
import '../../geometry/svg_path.dart';
import '../../model/board_object.dart';
import '../object_renderers.dart';
import '../paint_utils.dart';
import '../text_fit.dart';
import '../text_layout.dart';
import 'render_common.dart';

// Renderer of `shape` objects (split out of `object_renderers.dart` in F2).

final _pathCache = Expando<Path>('shapePath');

/// Shape path in object coordinates, cached per object version.
Path shapePathOf(BoardObject o) =>
    _pathCache[o] ??= parseSvgPath(shapePathData(o.shape, o.w, o.h, math.max(0, o.strokeWidth ?? 2) / 2));

void paintShape(Canvas c, BoardObject o, RenderContext ctx) {
  final sw = math.max(0.0, o.strokeWidth ?? 2);
  final fill = parseColor(o.color ?? '#ffffff', const Color(0xFFFFFFFF));
  final open = isOpenShapeKind(o.shape);
  final alpha = open ? 0.0 : o.fillOpacity;
  final path = shapePathOf(o);
  if (alpha > 0) c.drawPath(path, fillPaint..color = fill.withValues(alpha: fill.a * alpha));
  if (sw > 0) {
    final paint = strokePaint(parseColor(o.stroke, BoardColors.ink), sw)
      ..strokeJoin = StrokeJoin.round
      ..strokeCap = o.dash == 'dotted' || open ? StrokeCap.round : StrokeCap.butt;
    final pattern = o.dash == 'dotted' ? [0.0, sw * 2 + 3] : (o.dash == 'dashed' ? dashPattern('dashed', sw) : null);
    c.drawPath(pattern == null ? path : dashPath(path, pattern), paint);
  }
  final text = o.displayText;
  if (text.trim().isEmpty || ctx.editingId == o.id) return;
  final (t, r, b, l) = shapeInsets(o.shape, o.w, o.h);
  final inner = Rect.fromLTRB(l, t, o.w - r, o.h - b);
  final ink = alpha < 0.5 ? BoardColors.ink : textOn(fill);
  final wanted = o.fontSize ?? 20;
  final key = (
    'f',
    o.raw['text'],
    o.raw['content'],
    wanted,
    inner.width.round(),
    inner.height.round(),
    o.bold,
    o.italic,
    o.fontFamily,
  );
  // web `shapeFontSize` (same numbers, F19)
  final fs = shapeFontSizeOf(
    o,
    inner.width,
    inner.height,
    (fs) => objectTextSpan(o, fontSize: fs, color: ink, fonts: ctx.fonts, weight: 600),
  );
  final tp = ctx.text.layout(
    (key, fs, ink, o.align, o.strike),
    () => objectTextSpan(o, fontSize: fs, color: ink, fonts: ctx.fonts, weight: 600),
    maxWidth: inner.width,
    align: textAlignOf(o.align, TextAlign.center),
  );
  paintTextBox(c, tp, inner, valign: o.valign ?? 'middle');
}

/// Flat look of a shape below 30 % zoom (see `paintObjectSimple`).
void paintShapeSimple(Canvas c, BoardObject o, RenderContext ctx, Rect r) {
  final fill = parseColor(o.color ?? '#ffffff', const Color(0xFFFFFFFF));
  final open = isOpenShapeKind(o.shape);
  if (!open && o.fillOpacity > 0) {
    c.drawPath(shapePathOf(o), fillPaint..color = fill.withValues(alpha: fill.a * o.fillOpacity));
  }
  if ((o.strokeWidth ?? 2) > 0) {
    c.drawPath(shapePathOf(o), strokePaint(parseColor(o.stroke, BoardColors.ink), math.max(o.strokeWidth ?? 2, 2)));
  }
}
