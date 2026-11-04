import 'dart:math' as math;

import 'package:flutter/painting.dart';

import '../../geometry/connector_route.dart';
import '../../model/board_object.dart';
import '../object_renderers.dart';
import '../paint_utils.dart';
import '../text_layout.dart';
import 'render_common.dart';

// Renderer of `connector` objects (split out of `object_renderers.dart` in F2).

/// Connector in world coordinates: route, dash, caps, label in a white pill.
void paintConnector(Canvas c, BoardObject o, RenderContext ctx) {
  final g = ctx.scene.connector(o.id);
  if (g == null) return;
  final sw = o.strokeWidth ?? 2;
  final color = parseColor(o.color, BoardColors.ink);
  final capA = o.capStart, capB = o.capEnd;
  final path = connectorPath(g, trimA: capTrim(capA, sw), trimB: capTrim(capB, sw));
  final paint = strokePaint(color, sw)
    ..strokeJoin = StrokeJoin.round
    ..strokeCap = o.dash == 'dotted' ? StrokeCap.round : StrokeCap.butt;
  final pattern = dashPattern(o.dash, sw);
  c.drawPath(pattern == null ? path : dashPath(path, pattern), paint);
  for (final (cap, tip, dir) in [(capA, g.a, g.dirA), (capB, g.b, g.dirB)]) {
    final s = capShape(cap, tip, dir, sw);
    if (s == null) continue;
    if (s.filled) {
      c.drawPath(s.path, fillPaint..color = color);
    } else {
      c.drawPath(
        s.path,
        Paint()
          ..color = cap == 'circleOpen' || cap == 'diamondOpen' || cap == 'triangleOpen'
              ? const Color(0xFFFFFFFF)
              : color
          ..style = PaintingStyle.fill,
      );
      c.drawPath(
        s.path,
        strokePaint(color, sw)
          ..strokeJoin = StrokeJoin.round
          ..strokeCap = StrokeCap.round,
      );
    }
  }
  final label = o.displayText;
  if (label.trim().isEmpty) return;
  // web ConnectorView: `max(12, fontSize ?? 14 + strokeWidth)`, text in the line's color
  final fs = connectorLabelSize(o);
  final ink = parseColor(o.color, BoardColors.ink);
  final tp = ctx.text.layout(
    ('c', o.raw['text'], o.raw['content'], fs, o.bold, o.italic, o.color),
    () => objectTextSpan(o, fontSize: fs, color: ink, fonts: ctx.fonts),
    maxWidth: 260,
    align: TextAlign.center,
    fill: false,
  );
  final at = g.pointAt(o.labelPos);
  final box = Rect.fromCenter(center: at, width: tp.width + 12, height: tp.height + 6);
  c.drawRRect(RRect.fromRectAndRadius(box, const Radius.circular(4)), fillPaint..color = const Color(0xFFFFFFFF));
  tp.paint(c, Offset(box.left + 6, box.top + 3));
}

/// Font size of a connector label (web `labelFs`).
double connectorLabelSize(BoardObject o) => math.max(12, o.fontSize ?? 14 + (o.strokeWidth ?? 2));

/// Flat look of a connector below 30 % zoom (see `paintObjectSimple`).
void paintConnectorSimple(Canvas c, BoardObject o, RenderContext ctx, Rect r) {
  final g = ctx.scene.connector(o.id);
  if (g != null) {
    c.drawLine(g.a, g.b, strokePaint(parseColor(o.color, BoardColors.ink), math.max(o.strokeWidth ?? 2, 2)));
  }
}
