import 'package:flutter/painting.dart';

import '../../geometry/svg_path.dart';
import '../../model/board_object.dart';
import '../object_renderers.dart';
import '../paint_utils.dart';
import 'render_common.dart';

// Renderer of `icon` objects (owner P2): the lucide drawing `iconNode` (24 grid) in `color` and `strokeWidth`.

final _iconCache = Expando<(Path, Path)>('iconPaths');

/// Icon: lucide-style `iconNode` (24×24 grid) scaled to the object, stroke in `color`.
void paintIcon(Canvas c, BoardObject o) {
  final (stroked, filled) = _iconCache[o] ??= iconPaths(o.iconNode);
  final color = parseColor(o.color, BoardColors.ink);
  c.save();
  c.scale(o.w / 24, o.h / 24);
  c.drawPath(filled, fillPaint..color = color);
  c.drawPath(
    stroked,
    strokePaint(color, o.strokeWidth ?? 2)
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round,
  );
  c.restore();
}

/// Paths of an icon drawing: (everything stroked, the parts filled with `currentColor`).
(Path, Path) iconPaths(List<(String, Map<String, Object?>)> node) {
  final stroked = Path(), filled = Path();
  double n(Map<String, Object?> a, String k) {
    final v = a[k];
    return v is num ? v.toDouble() : (v is String ? double.tryParse(v) ?? 0 : 0);
  }

  for (final (tag, a) in node) {
    Path? p;
    switch (tag) {
      case 'path':
        if (a['d'] is String) p = parseSvgPath(a['d'] as String);
      case 'circle':
        p = Path()..addOval(Rect.fromCircle(center: Offset(n(a, 'cx'), n(a, 'cy')), radius: n(a, 'r')));
      case 'ellipse':
        p = Path()
          ..addOval(
            Rect.fromCenter(center: Offset(n(a, 'cx'), n(a, 'cy')), width: n(a, 'rx') * 2, height: n(a, 'ry') * 2),
          );
      case 'rect':
        final r = Rect.fromLTWH(n(a, 'x'), n(a, 'y'), n(a, 'width'), n(a, 'height'));
        p = Path()..addRRect(RRect.fromRectAndRadius(r, Radius.circular(n(a, 'rx'))));
      case 'line':
        p = Path()
          ..moveTo(n(a, 'x1'), n(a, 'y1'))
          ..lineTo(n(a, 'x2'), n(a, 'y2'));
      case 'polyline' || 'polygon':
        final nums = '${a['points'] ?? ''}'
            .trim()
            .split(RegExp(r'[\s,]+'))
            .map(double.tryParse)
            .whereType<double>()
            .toList();
        if (nums.length >= 4) {
          p = Path()..moveTo(nums[0], nums[1]);
          for (var i = 2; i + 1 < nums.length; i += 2) {
            p.lineTo(nums[i], nums[i + 1]);
          }
          if (tag == 'polygon') p.close();
        }
    }
    if (p == null) continue;
    if (a['fill'] == 'currentColor') filled.addPath(p, Offset.zero);
    stroked.addPath(p, Offset.zero);
  }
  return (stroked, filled);
}

/// Paints an icon drawing ([node] as stored in `iconNode`) into (0,0)–([size],[size]) – library tiles, tool options.
void paintIconGlyph(Canvas c, Object? node, Color color, double size, {double width = 2}) {
  final (stroked, filled) = iconPaths(BoardObject({'iconNode': node}).iconNode);
  c.save();
  c.scale(size / 24, size / 24);
  c.drawPath(filled, Paint()..color = color);
  c.drawPath(
    stroked,
    strokePaint(color, width)
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round,
  );
  c.restore();
}

/// Flat look of a icon below 30 % zoom (see `paintObjectSimple`).
void paintIconSimple(Canvas c, BoardObject o, RenderContext ctx, Rect r) {
  c.drawRect(r.deflate(o.w * 0.2), fillPaint..color = parseColor(o.color, BoardColors.ink).withValues(alpha: 0.5));
}
