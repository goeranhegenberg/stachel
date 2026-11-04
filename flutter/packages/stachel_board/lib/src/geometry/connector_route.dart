// Port of `web/src/board/connector.ts` and `web/src/features/shapes/connectorGeom.ts`: docking connector ends
// (center ray or side midpoint, also on rotated objects and library shape outlines), straight / elbow / curved
// routes, label position and the cap shapes.
import 'dart:math' as math;
import 'dart:ui';

import '../model/board_object.dart';
import 'shape_paths.dart';

/// Gap between a docked end and the object edge.
const connectorGap = 6.0;

/// Minimum length of the first/last piece of an elbow connector.
const elbowStub = 28.0;

typedef ObjectLookup = BoardObject? Function(String id);

const _dir = {'n': Offset(0, -1), 'e': Offset(1, 0), 's': Offset(0, 1), 'w': Offset(-1, 0)};

Offset _center(BoardObject o) => Offset(o.x + o.w / 2, o.y + o.h / 2);

/// Rotates [p] around [c] by [deg] degrees (clockwise with y down).
Offset rotatePoint(Offset p, Offset c, double deg) {
  if (deg == 0) return p;
  final a = deg * math.pi / 180;
  final cos = math.cos(a), sin = math.sin(a);
  final d = p - c;
  return Offset(c.dx + d.dx * cos - d.dy * sin, c.dy + d.dx * sin + d.dy * cos);
}

/// Reference point of an end: center of the object or the free point; null if the object is missing.
Offset? endAnchor(ConnectorEnd? end, ObjectLookup lookup) {
  switch (end) {
    case AttachedEnd(:final objectId):
      final o = lookup(objectId);
      return o == null ? null : _center(o);
    case FreeEnd(:final x, :final y):
      return Offset(x, y);
    case null:
      return null;
  }
}

/// Where the ray from the center of [o] toward [toward] leaves the outline of [o] (rotation respected).
Offset boundaryPoint(BoardObject o, Offset toward, {bool ignoreRotation = false}) {
  final c = _center(o);
  final deg = ignoreRotation ? 0.0 : o.rotation;
  final t0 = deg != 0 ? rotatePoint(toward, c, -deg) : toward;
  final dx = t0.dx - c.dx, dy = t0.dy - c.dy;
  if (dx == 0 && dy == 0) return c;
  final hw = o.w / 2, hh = o.h / 2;
  double t;
  final kind = o.type == 'shape' ? o.shape : null;
  if (kind == 'ellipse') {
    t = 1 / math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  } else if (kind == 'diamond') {
    t = 1 / (dx.abs() / hw + dy.abs() / hh);
  } else if (kind == 'triangle') {
    t = _rayPolygon(c, Offset(dx, dy), [Offset(o.x + hw, o.y), Offset(o.x + o.w, o.y + o.h), Offset(o.x, o.y + o.h)]);
  } else if (shapeOutline(kind, o.w, o.h) case final outline?) {
    t = _rayPolygon(c, Offset(dx, dy), [for (final q in outline) Offset(o.x + q.dx, o.y + q.dy)]);
  } else {
    t = math.min(dx == 0 ? double.infinity : hw / dx.abs(), dy == 0 ? double.infinity : hh / dy.abs());
  }
  if (!t.isFinite) t = 1;
  final p = Offset(c.dx + dx * t, c.dy + dy * t);
  return deg != 0 ? rotatePoint(p, c, deg) : p;
}

double _rayPolygon(Offset origin, Offset dir, List<Offset> poly) {
  var best = double.infinity;
  for (var i = 0; i < poly.length; i++) {
    final a = poly[i], b = poly[(i + 1) % poly.length];
    final ex = b.dx - a.dx, ey = b.dy - a.dy;
    final den = dir.dx * ey - dir.dy * ex;
    if (den.abs() < 1e-9) continue;
    final t = ((a.dx - origin.dx) * ey - (a.dy - origin.dy) * ex) / den;
    final u = ((a.dx - origin.dx) * dir.dy - (a.dy - origin.dy) * dir.dx) / den;
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = math.min(best, t);
  }
  return best.isFinite ? best : 1;
}

/// Side of [o] that faces [toward] most (relative to the object size).
String nearestSide(BoardObject o, Offset toward) {
  final c = _center(o);
  final p = o.rotation != 0 ? rotatePoint(toward, c, -o.rotation) : toward;
  final dx = (p.dx - c.dx) / math.max(1, o.w);
  final dy = (p.dy - c.dy) / math.max(1, o.h);
  if (dx.abs() >= dy.abs()) return dx >= 0 ? 'e' : 'w';
  return dy >= 0 ? 's' : 'n';
}

/// Midpoint of a side (on the outline) and the outward direction, both rotated.
(Offset, Offset) sidePoint(BoardObject o, String side) {
  final c = _center(o);
  final d = _dir[side]!;
  final raw = boundaryPoint(o, Offset(c.dx + d.dx * o.w, c.dy + d.dy * o.h), ignoreRotation: true);
  final deg = o.rotation;
  if (deg == 0) return (raw, d);
  final p = rotatePoint(raw, c, deg);
  final q = rotatePoint(c + d, c, deg);
  return (p, q - c);
}

/// Route of a connector.
class ConnectorGeometry {
  const ConnectorGeometry({
    required this.a,
    required this.b,
    required this.style,
    required this.pts,
    required this.mid,
    required this.dirA,
    required this.dirB,
  });

  /// Start and end (with gap to the object edge).
  final Offset a;
  final Offset b;
  final String style;

  /// straight: [a, b] · elbow: corner points a … b · curved: [a, c1, c2, b] (cubic Bézier).
  final List<Offset> pts;
  final Offset mid;

  /// Direction the line points at the start / end (away from the path, for caps).
  final Offset dirA;
  final Offset dirB;

  /// Point at fraction [t] along the path (curved: curve parameter), like `pathPointAt`.
  Offset pointAt(double t) => style == 'curved' && pts.length == 4 ? bezierAt(pts, t) : polylineAt(pts, t);
}

Offset _pullBack(Offset p, Offset toward, double by) {
  final d = toward - p;
  final len = d.distance;
  if (len < by * 2 || len == 0) return p;
  return p + d / len * by;
}

Offset _unit(Offset d) {
  final l = d.distance;
  return l == 0 ? const Offset(1, 0) : d / l;
}

Offset _axisToward(Offset from, Offset to) {
  final dx = to.dx - from.dx, dy = to.dy - from.dy;
  if (dx.abs() >= dy.abs()) return Offset(dx >= 0 ? 1 : -1, 0);
  return Offset(0, dy >= 0 ? 1 : -1);
}

(Offset, Offset?)? _resolveEnd(ConnectorEnd? end, Offset other, String style, ObjectLookup lookup) {
  switch (end) {
    case null:
      return null;
    case FreeEnd(:final x, :final y):
      return (Offset(x, y), null);
    case AttachedEnd(:final objectId, side: final fixed):
      final o = lookup(objectId);
      if (o == null) return null;
      final side = fixed ?? (style == 'straight' ? null : nearestSide(o, other));
      if (side == null) return (_pullBack(boundaryPoint(o, other), other, connectorGap), null);
      final (p, dir) = sidePoint(o, side);
      final u = _unit(dir);
      return (p + u * connectorGap, u);
  }
}

/// Start/end and path of [c]; null if an attached object is missing.
ConnectorGeometry? connectorGeometry(BoardObject c, ObjectLookup lookup) {
  final from = c.from, to = c.to;
  final fa = endAnchor(from, lookup), ta = endAnchor(to, lookup);
  if (fa == null || ta == null) return null;
  final style = c.lineStyle;
  final ea = _resolveEnd(from, ta, style, lookup);
  final eb = _resolveEnd(to, fa, style, lookup);
  if (ea == null || eb == null) return null;
  final (a, dA) = ea;
  final (b, dB) = eb;

  if (style == 'straight') {
    final d = _unit(b - a);
    return ConnectorGeometry(a: a, b: b, style: style, pts: [a, b], mid: (a + b) / 2, dirA: -d, dirB: d);
  }
  final da = dA ?? _axisToward(a, b);
  final db = dB ?? _axisToward(b, a);
  if (style == 'curved') {
    final dist = (b - a).distance;
    final k = math.max(40.0, math.min(dist * 0.45, 260.0));
    final c1 = a + (dA ?? _unit(b - a)) * (dA != null ? k : 0);
    final c2 = b + (dB ?? _unit(a - b)) * (dB != null ? k : 0);
    final pts = [a, c1, c2, b];
    return ConnectorGeometry(
      a: a,
      b: b,
      style: style,
      pts: pts,
      mid: bezierAt(pts, 0.5),
      dirA: _unit(a - bezierAt(pts, 0.04)),
      dirB: _unit(b - bezierAt(pts, 0.96)),
    );
  }
  final pts = _simplifyOrtho(elbowRoute(a, _axisDir(da), b, _axisDir(db)));
  final n = pts.length;
  return ConnectorGeometry(
    a: a,
    b: b,
    style: style,
    pts: pts,
    mid: polylineAt(pts, 0.5),
    dirA: _unit(pts[0] - pts[1]),
    dirB: _unit(pts[n - 1] - pts[n - 2]),
  );
}

Offset _axisDir(Offset d) =>
    d.dx.abs() >= d.dy.abs() ? Offset(d.dx == 0 ? 1 : d.dx.sign, 0) : Offset(0, d.dy == 0 ? 1 : d.dy.sign);

/// Orthogonal way from [a] (exit [da]) to [b] (entered from outside, direction [db]) with few corners.
List<Offset> elbowRoute(Offset a, Offset da, Offset b, Offset db) {
  const s = elbowStub;
  final ha = da.dx != 0, hb = db.dx != 0;
  final pa = a + da * s, pb = b + db * s;
  if (ha && hb) {
    if (da.dx == -db.dx) {
      if ((b.dx - a.dx) * da.dx >= 2 * s) {
        final mx = (a.dx + b.dx) / 2;
        return [a, Offset(mx, a.dy), Offset(mx, b.dy), b];
      }
      final my = (a.dy + b.dy) / 2;
      return [a, pa, Offset(pa.dx, my), Offset(pb.dx, my), pb, b];
    }
    final x = da.dx > 0 ? math.max(pa.dx, pb.dx) : math.min(pa.dx, pb.dx);
    return [a, Offset(x, a.dy), Offset(x, b.dy), b];
  }
  if (!ha && !hb) {
    if (da.dy == -db.dy) {
      if ((b.dy - a.dy) * da.dy >= 2 * s) {
        final my = (a.dy + b.dy) / 2;
        return [a, Offset(a.dx, my), Offset(b.dx, my), b];
      }
      final mx = (a.dx + b.dx) / 2;
      return [a, pa, Offset(mx, pa.dy), Offset(mx, pb.dy), pb, b];
    }
    final y = da.dy > 0 ? math.max(pa.dy, pb.dy) : math.min(pa.dy, pb.dy);
    return [a, Offset(a.dx, y), Offset(b.dx, y), b];
  }
  if (ha) {
    if ((b.dx - a.dx) * da.dx > 0 && (a.dy - b.dy) * db.dy > 0) return [a, Offset(b.dx, a.dy), b];
    return [a, pa, Offset(pa.dx, pb.dy), pb, b];
  }
  if ((b.dy - a.dy) * da.dy > 0 && (a.dx - b.dx) * db.dx > 0) return [a, Offset(a.dx, b.dy), b];
  return [a, pa, Offset(pb.dx, pa.dy), pb, b];
}

List<Offset> _simplifyOrtho(List<Offset> pts) {
  final out = <Offset>[];
  for (final p in pts) {
    if (out.isNotEmpty && (out.last.dx - p.dx).abs() < 0.01 && (out.last.dy - p.dy).abs() < 0.01) continue;
    out.add(p);
  }
  for (var i = out.length - 2; i >= 1; i--) {
    final p = out[i - 1], q = out[i], r = out[i + 1];
    final cross = (q.dx - p.dx) * (r.dy - q.dy) - (q.dy - p.dy) * (r.dx - q.dx);
    if (cross.abs() < 0.01) out.removeAt(i);
  }
  return out.length >= 2 ? out : [pts.first, pts.last];
}

Offset bezierAt(List<Offset> p, double t) {
  final u = 1 - t;
  final a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return Offset(
    a * p[0].dx + b * p[1].dx + c * p[2].dx + d * p[3].dx,
    a * p[0].dy + b * p[1].dy + c * p[2].dy + d * p[3].dy,
  );
}

/// Point at fraction [f] of the total length of a polyline.
Offset polylineAt(List<Offset> pts, double f) {
  var total = 0.0;
  for (var i = 1; i < pts.length; i++) {
    total += (pts[i] - pts[i - 1]).distance;
  }
  var rest = total * f;
  for (var i = 1; i < pts.length; i++) {
    final l = (pts[i] - pts[i - 1]).distance;
    if (rest <= l && l > 0) return pts[i - 1] + (pts[i] - pts[i - 1]) * (rest / l);
    rest -= l;
  }
  return pts.last;
}

/// Fraction `t` of the path point nearest to [p] (web `projectOnPath`: 160 steps, then 20 finer, rounded to 0.001).
double projectOnPath(ConnectorGeometry g, Offset p, {int steps = 160}) {
  var best = 0.0, bestD = double.infinity;
  for (var i = 0; i <= steps; i++) {
    final d = (g.pointAt(i / steps) - p).distanceSquared;
    if (d < bestD) {
      bestD = d;
      best = i / steps;
    }
  }
  final lo = math.max(0.0, best - 1 / steps), hi = math.min(1.0, best + 1 / steps);
  for (var i = 0; i <= 20; i++) {
    final t = lo + (hi - lo) * i / 20;
    final d = (g.pointAt(t) - p).distanceSquared;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return (best * 1000).roundToDouble() / 1000;
}

/// Bounding box of a route (curves sampled, not the control points) with [pad].
Rect connectorBounds(ConnectorGeometry g, [double pad = 12]) {
  final sample = g.style == 'curved' && g.pts.length == 4
      ? [for (var i = 0; i <= 16; i++) bezierAt(g.pts, i / 16)]
      : g.pts;
  var x1 = double.infinity, y1 = double.infinity, x2 = -double.infinity, y2 = -double.infinity;
  for (final p in sample) {
    x1 = math.min(x1, p.dx);
    y1 = math.min(y1, p.dy);
    x2 = math.max(x2, p.dx);
    y2 = math.max(y2, p.dy);
  }
  return Rect.fromLTRB(x1 - pad, y1 - pad, x2 + pad, y2 + pad);
}

/// Path of the route; [trimA]/[trimB] shorten the ends (room for caps). Elbows get round corners like the web
/// module (`roundedElbowPath`, radius 12).
Path connectorPath(ConnectorGeometry g, {double trimA = 0, double trimB = 0}) {
  final pts = List<Offset>.of(g.pts);
  final n = pts.length;
  final total = (g.b - g.a).distance;
  if (total > trimA + trimB) {
    pts[0] = pts[0] - g.dirA * trimA;
    pts[n - 1] = pts[n - 1] - g.dirB * trimB;
  }
  final path = Path()..moveTo(pts[0].dx, pts[0].dy);
  if (g.style == 'curved' && n == 4) {
    path.cubicTo(pts[1].dx, pts[1].dy, pts[2].dx, pts[2].dy, pts[3].dx, pts[3].dy);
    return path;
  }
  if (g.style == 'elbow') {
    for (var i = 1; i < n - 1; i++) {
      final p = pts[i - 1], q = pts[i], nx = pts[i + 1];
      final l1 = (q - p).distance, l2 = (nx - q).distance;
      final r = math.min(12.0, math.min(l1 / 2, l2 / 2));
      if (r < 0.5) {
        path.lineTo(q.dx, q.dy);
        continue;
      }
      final a = q - (q - p) / l1 * r;
      final b = q + (nx - q) / l2 * r;
      path
        ..lineTo(a.dx, a.dy)
        ..quadraticBezierTo(q.dx, q.dy, b.dx, b.dy);
    }
    path.lineTo(pts[n - 1].dx, pts[n - 1].dy);
    return path;
  }
  for (var i = 1; i < n; i++) {
    path.lineTo(pts[i].dx, pts[i].dy);
  }
  return path;
}

// ---- caps ---------------------------------------------------------------------------------------------------------

double capSize(double sw) => 8 + sw * 3;

/// How far the line stops before the tip.
double capTrim(String cap, double sw) {
  final s = capSize(sw);
  return switch (cap) {
    'triangle' => s * 0.7,
    'triangleOpen' => s * 0.9,
    'circle' || 'circleOpen' => s * 0.84,
    'diamond' || 'diamondOpen' => s * 1.2,
    'arrow' => sw * 0.5,
    _ => 0,
  };
}

/// Arrow head triangle at [tip]; [dir] points from the line to the tip.
List<Offset> arrowHeadAt(Offset tip, Offset dir, double size) {
  final ang = math.atan2(dir.dy, dir.dx);
  const spread = 0.45;
  return [
    tip,
    Offset(tip.dx - size * math.cos(ang - spread), tip.dy - size * math.sin(ang - spread)),
    Offset(tip.dx - size * math.cos(ang + spread), tip.dy - size * math.sin(ang + spread)),
  ];
}

/// A cap as path plus whether it is filled (else stroked with the line color).
class CapShape {
  const CapShape(this.path, {required this.filled});
  final Path path;
  final bool filled;
}

/// Shape of a cap at [tip] (like `capGeom`); null for `none`.
CapShape? capShape(String cap, Offset tip, Offset dir, double sw) {
  final s = capSize(sw);
  final d = _unit(dir);
  final nrm = Offset(-d.dy, d.dx);
  Offset at(double k, [double m = 0]) => tip - d * k + nrm * m;
  Path poly(List<Offset> pts, {bool close = true}) {
    final p = Path()..moveTo(pts[0].dx, pts[0].dy);
    for (final q in pts.skip(1)) {
      p.lineTo(q.dx, q.dy);
    }
    if (close) p.close();
    return p;
  }

  switch (cap) {
    case 'triangle' || 'triangleOpen':
      return CapShape(poly(arrowHeadAt(tip, d, s)), filled: cap == 'triangle');
    case 'arrow':
      final h = arrowHeadAt(tip, d, s * 1.05);
      return CapShape(poly([h[1], tip, h[2]], close: false), filled: false);
    case 'circle' || 'circleOpen':
      final r = s * 0.42;
      return CapShape(
        Path()..addOval(Rect.fromCircle(center: at(r), radius: r)),
        filled: cap == 'circle',
      );
    case 'diamond' || 'diamondOpen':
      final l = s * 1.2, w = s * 0.42;
      return CapShape(poly([tip, at(l / 2, w), at(l), at(l / 2, -w)]), filled: cap == 'diamond');
    case 'bar':
      return CapShape(poly([at(0, s * 0.55), at(0, -s * 0.55)], close: false), filled: false);
    default:
      return null;
  }
}

/// Dash pattern for `dash` (scaled with the stroke width), like `dashArray`; null = solid.
List<double>? dashPattern(String? dash, double strokeWidth) {
  final sw = math.max(1.0, strokeWidth);
  if (dash == 'dashed') return [sw * 4 + 2, sw * 2.5 + 3];
  if (dash == 'dotted') return [0, sw * 2 + 2];
  return null;
}
