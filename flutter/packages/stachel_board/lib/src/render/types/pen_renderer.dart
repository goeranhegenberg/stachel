
import 'package:flutter/painting.dart';

import '../../model/board_object.dart';
import '../object_renderers.dart';
import '../paint_utils.dart';
import 'render_common.dart';

// Renderer of `pen` objects (split out of `object_renderers.dart` in F2).

final _penCache = Expando<Path>('penPath');

/// Smoothed pen path through midpoints (port of `smoothPath`), relative to (x, y).
Path penPathOf(BoardObject o) => _penCache[o] ??= () {
  final f = o.points;
  final n = f.length ~/ 2;
  final p = Path();
  if (n == 0) return p;
  p.moveTo(f[0], f[1]);
  if (n == 1) return p..lineTo(f[0] + 0.01, f[1]);
  if (n == 2) return p..lineTo(f[2], f[3]);
  for (var i = 1; i < n - 1; i++) {
    final x = f[i * 2], y = f[i * 2 + 1];
    p.quadraticBezierTo(x, y, (x + f[i * 2 + 2]) / 2, (y + f[i * 2 + 3]) / 2);
  }
  return p..lineTo(f[(n - 1) * 2], f[(n - 1) * 2 + 1]);
}();

void paintPen(Canvas c, BoardObject o) {
  final paint = strokePaint(parseColor(o.color, BoardColors.ink), o.strokeWidth ?? 3)
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round;
  if (o.marker) {
    paint
      ..color = paint.color.withValues(alpha: 0.45)
      ..blendMode = BlendMode.multiply;
  }
  c.drawPath(penPathOf(o), paint);
}

/// Flat look of a pen below 30 % zoom (see `paintObjectSimple`).
void paintPenSimple(Canvas c, BoardObject o, RenderContext ctx, Rect r) {
  paintPen(c, o);
}
