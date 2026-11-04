import 'dart:math' as math;
import 'dart:ui';

import '../geometry/connector_route.dart' show rotatePoint;
import '../mindmap/mind_model.dart' show jsRound;
import '../model/board_object.dart';
import 'editor_tools.dart';

export '../mindmap/mind_model.dart' show jsRound;

/// Resizing and rotating like the web (P1, audit D32–D36): line-by-line ports of `board/geometry.ts` `resizeRect`/
/// `mapRect`, `interaction/resize.ts` `rotatedResize`, `interaction/rotate.ts` and `board/pen.ts` `scalePoints`, checked
/// against reference values of the web code (`docs/native_fixtures/web/arrange.json`).

/// Rounds to 0.1 like the web (`Math.round(v * 10) / 10`).
double round1(double v) => jsRound(v * 10) / 10;

/// New box when dragging [handle] by (dx, dy) world units from [start] (web `resizeRect`): the opposite side stays;
/// [keepAspect]: corners keep the ratio, sides scale the other dimension around the center.
Rect resizeRect(Rect start, String handle, double dx, double dy, {bool keepAspect = false, double min = 8}) {
  var x1 = start.left, y1 = start.top, x2 = start.right, y2 = start.bottom;
  if (handle.contains('w')) x1 += dx;
  if (handle.contains('e')) x2 += dx;
  if (handle.contains('n')) y1 += dy;
  if (handle.contains('s')) y2 += dy;
  var w = math.max(min, x2 - x1);
  var h = math.max(min, y2 - y1);
  if (handle.contains('w')) x1 = x2 - w;
  if (handle.contains('n')) y1 = y2 - h;
  if (keepAspect && start.width > 0 && start.height > 0) {
    final ratio = start.width / start.height;
    final horizontal = handle == 'e' || handle == 'w';
    final vertical = handle == 'n' || handle == 's';
    if (horizontal) {
      h = w / ratio;
    } else if (vertical) {
      w = h * ratio;
    } else if (w / h > ratio) {
      h = w / ratio;
    } else {
      w = h * ratio;
    }
    if (handle.contains('w')) x1 = x2 - w;
    if (handle.contains('n')) y1 = y2 - h;
    if (vertical) x1 = start.left + (start.width - w) / 2;
    if (horizontal) y1 = start.top + (start.height - h) / 2;
  }
  return Rect.fromLTWH(x1, y1, w, h);
}

/// Resizing an object rotated by [rot] degrees (web `rotatedResize`): the world drag turned into the object's axes,
/// resized unrotated, then moved so the opposite corner stays where it is in the world.
Rect rotatedResize(Rect box, String handle, double dx, double dy, double rot, bool keep, {bool widthOnly = false}) {
  final a = rot * math.pi / 180;
  final cos = math.cos(a), sin = math.sin(a);
  final ldx = dx * cos + dy * sin;
  final ldy = -dx * sin + dy * cos;
  var nb = resizeRect(box, handle, ldx, ldy, keepAspect: keep, min: 12);
  if (widthOnly) nb = Rect.fromLTWH(nb.left, box.top, nb.width, box.height);
  final vx = box.left + box.width / 2 - (nb.left + nb.width / 2);
  final vy = box.top + box.height / 2 - (nb.top + nb.height / 2);
  return Rect.fromLTWH(nb.left + vx - (vx * cos - vy * sin), nb.top + vy - (vx * sin + vy * cos), nb.width, nb.height);
}

/// [r] mapped from [from] to [to] (web `mapRect`, members of a scaled selection).
Rect mapRect(Rect r, Rect from, Rect to) {
  final sx = from.width == 0 ? 1.0 : to.width / from.width;
  final sy = from.height == 0 ? 1.0 : to.height / from.height;
  return Rect.fromLTWH(
    to.left + (r.left - from.left) * sx,
    to.top + (r.top - from.top) * sy,
    r.width * sx,
    r.height * sy,
  );
}

/// Pen points scaled with the stroke (web `scalePoints`).
List<double> scalePoints(List<double> points, double sx, double sy) => [
  for (var i = 0; i < points.length; i++) round1(i.isEven ? points[i] * sx : points[i] * sy),
];

/// Angle normalized to (−180, 180] (web `normDeg`).
double normDeg(double d) {
  final n = ((d + 180) % 360 + 360) % 360 - 180;
  return n == -180 ? 180 : n;
}

/// The angle label while rotating: whole degrees, never „-0°“ (web `angleLabel`).
String angleLabel(double deg) {
  final r = jsRound(normDeg(deg));
  return '${r == 0 ? 0 : r.toInt()}°';
}

/// Rotation as the field `rotation` (0 = no field, web `rotationField`).
double? rotationField(double deg) {
  final n = round1(normDeg(deg));
  return n == 0 ? null : (n == -180 ? 180 : n);
}

/// Types that can be rotated (web `rotatable`).
const rotatableTypes = {'sticky', 'shape', 'text', 'image', 'sticker', 'icon', 'document'};

/// Types derived from others (connectors follow their ends; web `derive`).
const derivedTypes = {'connector'};

/// Can the selection be rotated together (web `canRotateAll`)? All rotatable, pen strokes or derived; nothing locked,
/// at least one solid object.
bool canRotateAll(List<BoardObject> selected) {
  if (selected.length < 2) return false;
  var solid = 0;
  for (final o in selected) {
    if (o.locked) return false;
    if (derivedTypes.contains(o.type)) continue;
    if (!rotatableTypes.contains(o.type) && o.type != 'pen') return false;
    solid++;
  }
  return solid > 0;
}

/// Patches rotating [origin] (state at the start of the gesture) around [c] by [delta] degrees (web `rotateMany`):
/// rotatable objects move their center and turn, pen strokes rotate their points, connectors only their free ends.
Map<String, Map<String, Object?>> rotateMany(Map<String, BoardObject> origin, Offset c, double delta) {
  final out = <String, Map<String, Object?>>{};
  for (final MapEntry(key: id, value: o) in origin.entries) {
    if (delta == 0) {
      out[id] = o.type == 'pen'
          ? {'x': o.x, 'y': o.y, 'w': o.w, 'h': o.h, 'points': o.raw['points']}
          : o.type == 'connector'
          ? {'from': o.raw['from'], 'to': o.raw['to']}
          : {'x': o.x, 'y': o.y, 'rotation': o.raw['rotation']};
      continue;
    }
    if (o.type == 'connector') {
      final p = <String, Object?>{};
      for (final k in const ['from', 'to']) {
        final e = o.raw[k];
        if (e is Map && e['objectId'] == null && e['x'] is num && e['y'] is num) {
          final q = rotatePoint(Offset((e['x'] as num).toDouble(), (e['y'] as num).toDouble()), c, delta);
          p[k] = {'x': jsRound(q.dx), 'y': jsRound(q.dy)};
        }
      }
      out[id] = p;
      continue;
    }
    if (o.type == 'pen') {
      final pts = o.points;
      final abs = <Offset>[
        for (var i = 0; i + 1 < pts.length; i += 2) rotatePoint(Offset(o.x + pts[i], o.y + pts[i + 1]), c, delta),
      ];
      if (abs.isNotEmpty) out[id] = penFromPoints(abs, o.strokeWidth ?? 4);
      continue;
    }
    final m = rotatePoint(Offset(o.x + o.w / 2, o.y + o.h / 2), c, delta);
    out[id] = {'x': round1(m.dx - o.w / 2), 'y': round1(m.dy - o.h / 2), 'rotation': rotationField(o.rotation + delta)};
  }
  return out;
}
