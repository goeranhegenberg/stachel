import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/foundation.dart';

/// Snapping like the web (`editor/interaction/snapping.ts`, `lasso.ts`, `features/tools/grid.ts`, edge pan in
/// `Editor.tsx`) – a line-by-line port, checked against reference values from the web code
/// (`docs/native_fixtures/web/arrange.json` from `stachel/tools/native-arrange-fixtures.mts`).

/// Snap distance in screen px (web `SNAP_PX`); in world units `snapPx / zoom`.
const snapPx = 6.0;

/// Grid of „Am Raster einrasten“ (web `GRID`).
const snapGrid = 24.0;

/// Edge pan: within this many px of the view's edge (web `EDGE_PX`) …
const edgePx = 32.0;

/// … the view pans by up to this many px per frame (web `EDGE_SPEED`).
const edgeSpeed = 16.0;

/// A guide line (world).
@immutable
class GuideLine {
  const GuideLine(this.x1, this.y1, this.x2, this.y2);
  final double x1, y1, x2, y2;

  Map<String, double> toJson() => {'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2};

  @override
  bool operator ==(Object other) =>
      other is GuideLine && other.x1 == x1 && other.y1 == y1 && other.x2 == x2 && other.y2 == y2;
  @override
  int get hashCode => Object.hash(x1, y1, x2, y2);
  @override
  String toString() => 'GuideLine($x1, $y1, $x2, $y2)';
}

/// A gap mark: horizontal or vertical distance with its length in world units (web `GapMark`).
@immutable
class GapMark extends GuideLine {
  const GapMark(super.x1, super.y1, super.x2, super.y2, this.len);
  final int len;

  @override
  Map<String, double> toJson() => {...super.toJson(), 'len': len.toDouble()};

  @override
  bool operator ==(Object other) => other is GapMark && super == other && other.len == len;
  @override
  int get hashCode => Object.hash(super.hashCode, len);
}

/// Result of [snapMove]: correction and what to draw.
class SnapResult {
  SnapResult({this.dx = 0, this.dy = 0, this.lines = const [], this.gaps = const []});
  double dx, dy;
  List<GuideLine> lines;
  List<GapMark> gaps;
}

/// Guides drawn while dragging/resizing (world).
class SnapGuides {
  const SnapGuides({this.lines = const [], this.gaps = const []});
  final List<GuideLine> lines;
  final List<GapMark> gaps;
  bool get isEmpty => lines.isEmpty && gaps.isEmpty;
}

enum _Axis { x, y }

double _pos(Rect r, _Axis a) => a == _Axis.x ? r.left : r.top;
double _len(Rect r, _Axis a) => a == _Axis.x ? r.width : r.height;
List<double> _edges(Rect r, _Axis a) => [_pos(r, a), _pos(r, a) + _len(r, a) / 2, _pos(r, a) + _len(r, a)];
_Axis _other(_Axis a) => a == _Axis.x ? _Axis.y : _Axis.x;
bool _overlaps(Rect a, Rect b, _Axis ax) =>
    _pos(a, ax) < _pos(b, ax) + _len(b, ax) && _pos(b, ax) < _pos(a, ax) + _len(a, ax);

/// Smallest correction that puts one of [mine] onto one of [theirs] (or null).
double? _bestEdge(List<double> mine, List<double> theirs, double tol) {
  double? best;
  for (final m in mine) {
    for (final t in theirs) {
      final d = t - m;
      if (d.abs() <= tol && (best == null || d.abs() < best.abs())) best = d;
    }
  }
  return best;
}

class _GapSnap {
  _GapSnap(this.d, this.marks);
  final double d;
  final List<GapMark> Function(Rect r) marks;
}

/// JS `Math.round` (halves up, also for negatives).
int _jsRound(double v) => (v + 0.5).floor();

GapMark? _mark(Rect a, Rect b, _Axis axis) {
  // distance between the right/bottom edge of a and the left/top edge of b, centered in the overlap
  final o = _other(axis);
  final lo = math.max(_pos(a, o), _pos(b, o));
  final hi = math.min(_pos(a, o) + _len(a, o), _pos(b, o) + _len(b, o));
  final c = lo <= hi ? (lo + hi) / 2 : (_pos(a, o) + _len(a, o) / 2 + _pos(b, o) + _len(b, o) / 2) / 2;
  final s = _pos(a, axis) + _len(a, axis);
  final e = _pos(b, axis);
  if (e - s < 1) return null;
  return axis == _Axis.x ? GapMark(s, c, e, c, _jsRound(e - s)) : GapMark(c, s, c, e, _jsRound(e - s));
}

List<GapMark> _marks(List<GapMark?> m) => [for (final x in m) ?x];

_GapSnap? _gapSnap(Rect box, List<Rect> others, _Axis axis, double tol) {
  final o = _other(axis);
  final row = [
    for (final r in others)
      if (_overlaps(r, box, o)) r,
  ];
  double end(Rect r) => _pos(r, axis) + _len(r, axis);
  final bs = _pos(box, axis);
  final be = bs + _len(box, axis);
  Rect? left, right;
  for (final r in row) {
    if (end(r) <= bs + tol && (left == null || end(r) > end(left))) left = r;
    if (_pos(r, axis) >= be - tol && (right == null || _pos(r, axis) < _pos(right, axis))) right = r;
  }
  final options = <_GapSnap>[];
  if (left != null && right != null && _pos(right, axis) - end(left) > _len(box, axis)) {
    final l = left, rr = right;
    final target = (end(l) + _pos(rr, axis) - _len(box, axis)) / 2;
    options.add(_GapSnap(target - bs, (r) => _marks([_mark(l, r, axis), _mark(r, rr, axis)])));
  }
  if (left != null) {
    final l = left;
    Rect? ll;
    for (final r in row) {
      if (!identical(r, l) && end(r) <= _pos(l, axis) && (ll == null || end(r) > end(ll))) ll = r;
    }
    if (ll != null) {
      final p = ll;
      final g = _pos(l, axis) - end(p);
      options.add(_GapSnap(end(l) + g - bs, (r) => _marks([_mark(p, l, axis), _mark(l, r, axis)])));
    }
  }
  if (right != null) {
    final rr = right;
    Rect? rrr;
    for (final r in row) {
      if (!identical(r, rr) && _pos(r, axis) >= end(rr) && (rrr == null || _pos(r, axis) < _pos(rrr, axis))) rrr = r;
    }
    if (rrr != null) {
      final n = rrr;
      final g = _pos(n, axis) - end(rr);
      options.add(_GapSnap(_pos(rr, axis) - g - be, (r) => _marks([_mark(r, rr, axis), _mark(rr, n, axis)])));
    }
  }
  _GapSnap? best;
  for (final opt in options) {
    if (opt.d.abs() <= tol && (best == null || opt.d.abs() < best.d.abs())) best = opt;
  }
  return best;
}

/// Guide lines for every edge/center of [r] that lines up with an edge/center of another rect (web `guideLines`).
List<GuideLine> guideLines(Rect r, List<Rect> others, {double eps = 0.5}) {
  final lines = <GuideLine>[];
  for (final axis in _Axis.values) {
    final o = _other(axis);
    for (final v in _edges(r, axis)) {
      var lo = _pos(r, o);
      var hi = _pos(r, o) + _len(r, o);
      var hit = false;
      for (final q in others) {
        if (!_edges(q, axis).any((e) => (e - v).abs() <= eps)) continue;
        hit = true;
        lo = math.min(lo, _pos(q, o));
        hi = math.max(hi, _pos(q, o) + _len(q, o));
      }
      if (hit) lines.add(axis == _Axis.x ? GuideLine(v, lo, v, hi) : GuideLine(lo, v, hi, v));
    }
  }
  return lines;
}

/// Snaps a moved selection ([box] already moved by the raw offset) to edges/centers and equal gaps (web `snapMove`).
SnapResult snapMove(Rect box, List<Rect> others, double tol) {
  final res = SnapResult();
  if (others.isEmpty) return res;
  final gapsFor = <List<GapMark> Function(Rect)>[];
  for (final axis in _Axis.values) {
    final e = _bestEdge(_edges(box, axis), [for (final r in others) ..._edges(r, axis)], tol);
    final g = _gapSnap(box, others, axis, tol);
    var d = 0.0;
    if (g != null && (e == null || g.d.abs() < e.abs() - 0.01)) {
      d = g.d;
      gapsFor.add(g.marks);
    } else if (e != null) {
      d = e;
    }
    if (axis == _Axis.x) {
      res.dx = d;
    } else {
      res.dy = d;
    }
  }
  final r = box.shift(Offset(res.dx, res.dy));
  res.lines = guideLines(r, others);
  res.gaps = [for (final f in gapsFor) ...f(r)];
  return res;
}

/// While resizing only the dragged edges snap; the correction of the pointer offset (web `snapResize`).
({double dx, double dy}) snapResize(Rect nb, String handle, List<Rect> others, double tol) {
  final xs = <double>[], ys = <double>[];
  if (handle.contains('w')) xs.add(nb.left);
  if (handle.contains('e')) xs.add(nb.left + nb.width);
  if (handle.contains('n')) ys.add(nb.top);
  if (handle.contains('s')) ys.add(nb.top + nb.height);
  final dx = xs.isNotEmpty ? _bestEdge(xs, [for (final r in others) ..._edges(r, _Axis.x)], tol) : null;
  final dy = ys.isNotEmpty ? _bestEdge(ys, [for (final r in others) ..._edges(r, _Axis.y)], tol) : null;
  return (dx: dx ?? 0, dy: dy ?? 0);
}

// ---- lasso (web `lasso.ts`) ----------------------------------------------------------------------------------------

/// Point in polygon (even-odd; the polygon is closed).
bool pointInPolygon(Offset p, List<Offset> poly) {
  var inside = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    final a = poly[i], b = poly[j];
    if ((a.dy > p.dy) != (b.dy > p.dy) && p.dx < (b.dx - a.dx) * (p.dy - a.dy) / (b.dy - a.dy) + a.dx) inside = !inside;
  }
  return inside;
}

/// Is [r] completely inside the lasso? Corners, edge centers and the center inside, no lasso point inside [r].
bool rectInLasso(Rect r, List<Offset> poly) {
  if (poly.length < 3) return false;
  final xs = [r.left, r.left + r.width / 2, r.left + r.width];
  final ys = [r.top, r.top + r.height / 2, r.top + r.height];
  for (final x in xs) {
    for (final y in ys) {
      if (!pointInPolygon(Offset(x, y), poly)) return false;
    }
  }
  // a dent of the lasso reaching into the rect excludes it
  for (final q in poly) {
    if (q.dx > r.left && q.dx < r.left + r.width && q.dy > r.top && q.dy < r.top + r.height) return false;
  }
  return true;
}

/// Bounding box of the lasso points.
Rect lassoBounds(List<Offset> poly) {
  var x1 = double.infinity, y1 = double.infinity, x2 = double.negativeInfinity, y2 = double.negativeInfinity;
  for (final p in poly) {
    x1 = math.min(x1, p.dx);
    y1 = math.min(y1, p.dy);
    x2 = math.max(x2, p.dx);
    y2 = math.max(y2, p.dy);
  }
  return Rect.fromLTRB(x1, y1, x2, y2);
}

// ---- grid and edge pan --------------------------------------------------------------------------------------------

/// Snaps [v] to the grid (web `snapToGrid`, JS rounding).
double snapToGrid(double v, [double g = snapGrid]) => _jsRound(v / g) * g;

/// Pan speed (screen px per frame) at the view's edge (web `edgeVelocity`): grows to [edgeSpeed] the closer to or the
/// further beyond the edge the finger is; positive = the view moves right/down (content follows the finger).
Offset edgeVelocity(Offset sp, Size size) {
  double v(double d) => d > 0 ? math.min(d, edgePx) / edgePx * edgeSpeed : 0;
  return Offset(
    v(edgePx - sp.dx) - v(sp.dx - (size.width - edgePx)),
    v(edgePx - sp.dy) - v(sp.dy - (size.height - edgePx)),
  );
}

/// Local, per device settings of snapping (web `tools/prefs.ts`; „Am Raster einrasten“ is kept by the app).
class SnapPrefs {
  SnapPrefs._();

  /// „Am Raster einrasten“: moved objects land with their top left corner on the 24 grid (only while dragging).
  /// In memory unless [load]/[save] connect a device setting (P4's `BoardPrefs` key `stachel.tools.snap`).
  static final grid = ValueNotifier<bool>(false);

  /// Device setting behind [grid] (null = only in memory, until the app restarts).
  static bool Function()? load;
  static void Function(bool on)? save;

  /// „Am Raster einrasten“ is on.
  static bool get gridOn => load?.call() ?? grid.value;

  static void setGrid(bool on) {
    grid.value = on;
    save?.call(on);
  }
}
