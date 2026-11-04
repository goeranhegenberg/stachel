// Port of the web's shape geometry: core shapes (`web/src/editor/core/shapeKinds.tsx`) and the shape library
// (`web/src/features/shapes/geometry.ts`). Each kind yields the same SVG path string as the web (number format
// included), the text insets (top, right, bottom, left) and the outline polygon used for docking connectors.
import 'dart:math' as math;
import 'dart:ui';

/// All shape kinds of the web (`ShapeKindMap`): 4 core + 37 library shapes = 41.
const shapeKinds = [
  'rect', 'roundrect', 'ellipse', 'diamond', 'triangle', 'pentagon', 'hexagon', 'octagon', 'star', //
  'parallelogram', 'trapezoid', 'cylinder', 'cloud', 'callout', 'arrowRight', 'arrowLeft', 'arrowDouble',
  'arrowUp', 'arrowDown', 'chevron', 'cross', 'braceLeft', 'braceRight', 'terminator', 'document', 'predefined',
  'manualInput', 'delay', 'pentagonArrow', 'heart', 'manualOperation', 'offPage', 'merge', 'card', 'sort',
  'multiDocument', 'display', 'storedData', 'internalStorage', 'summing', 'or',
];

/// Text area insets: top, right, bottom, left.
typedef Insets4 = (double, double, double, double);

class _Kind {
  const _Kind({required this.path, this.insets, this.outline, this.open = false});
  final String Function(double w, double h, double inset) path;
  final Insets4 Function(double w, double h)? insets;
  final List<Offset> Function(double w, double h)? outline;

  /// Line only, no fill (braces).
  final bool open;
}

/// JS-like `Math.round(v * 100) / 100` (half rounds up, also for negatives).
double _r2(double v) => (v * 100 + 0.5).floorToDouble() / 100;

/// Number as JavaScript's `String(n)` prints it (no trailing `.0`).
String jsNum(double v) {
  if (v == v.roundToDouble() && v.abs() < 1e15) {
    final i = v.toInt();
    return i == 0 ? '0' : '$i';
  }
  return v.toString();
}

String _n(double v) => jsNum(_r2(v));
String _p(double x, double y) => '${_n(x)} ${_n(y)}';

List<Offset> _scale(List<(double, double)> unit, double w, double h, [double inset = 0]) => [
  for (final (u, v) in unit) Offset(inset + u * (w - 2 * inset), inset + v * (h - 2 * inset)),
];

String _polyPath(List<Offset> pts) => 'M${pts.map((p) => _p(p.dx, p.dy)).join('L')}Z';

_Kind _polygonKind(List<(double, double)> unit, [Insets4 Function(double, double)? insets]) => _Kind(
  path: (w, h, inset) => _polyPath(_scale(unit, w, h, inset)),
  outline: (w, h) => _scale(unit, w, h),
  insets: insets,
);

_Kind _dynamicPolygon(List<Offset> Function(double w, double h) points, [Insets4 Function(double, double)? insets]) =>
    _Kind(
      path: (w, h, inset) =>
          _polyPath([for (final p in points(w - 2 * inset, h - 2 * inset)) Offset(p.dx + inset, p.dy + inset)]),
      outline: points,
      insets: insets,
    );

List<Offset> _ellipsePoints(double cx, double cy, double rx, double ry, [int n = 32, double a0 = 0, double? a1]) {
  final end = a1 ?? math.pi * 2;
  final full = end - a0 >= math.pi * 2 - 1e-9;
  return [
    for (var i = 0; i < n; i++)
      () {
        final a = a0 + ((end - a0) * i) / (n - (full ? 0 : 1));
        return Offset(cx + rx * math.cos(a), cy + ry * math.sin(a));
      }(),
  ];
}

String _roundRectPath(double x1, double y1, double x2, double y2, double r) {
  final rr = math.max(0.0, math.min(r, math.min((x2 - x1) / 2, (y2 - y1) / 2)));
  final a = '${_n(rr)} ${_n(rr)} 0 0 1';
  return 'M${_p(x1 + rr, y1)}H${_n(x2 - rr)}A$a ${_p(x2, y1 + rr)}V${_n(y2 - rr)}'
      'A$a ${_p(x2 - rr, y2)}H${_n(x1 + rr)}A$a ${_p(x1, y2 - rr)}V${_n(y1 + rr)}'
      'A$a ${_p(x1 + rr, y1)}Z';
}

List<Offset> _roundRectOutline(double w, double h, double r) {
  final rr = math.max(0.0, math.min(r, math.min(w / 2, h / 2)));
  const q = math.pi / 2;
  return [
    ..._ellipsePoints(w - rr, rr, rr, rr, 5, -q, 0),
    ..._ellipsePoints(w - rr, h - rr, rr, rr, 5, 0, q),
    ..._ellipsePoints(rr, h - rr, rr, rr, 5, q, 2 * q),
    ..._ellipsePoints(rr, rr, rr, rr, 5, 2 * q, 3 * q),
  ];
}

final List<(double, double)> _starUnit = () {
  final pts = <(double, double)>[];
  for (var i = 0; i < 10; i++) {
    final a = -math.pi / 2 + (i * math.pi) / 5;
    final r = i.isOdd ? 0.4 : 1.0;
    pts.add((math.cos(a) * r, math.sin(a) * r));
  }
  final xs = pts.map((p) => p.$1), ys = pts.map((p) => p.$2);
  final x0 = xs.reduce(math.min), x1 = xs.reduce(math.max), y0 = ys.reduce(math.min), y1 = ys.reduce(math.max);
  return [for (final (x, y) in pts) ((x - x0) / (x1 - x0), (y - y0) / (y1 - y0))];
}();

List<Offset> _arrowPoints(double w, double h, String dir) {
  final head = math.min(w * (dir == 'both' ? 0.34 : 0.45), h * 0.9);
  final t = h * 0.22;
  if (dir == 'right') {
    return [
      Offset(0, t),
      Offset(w - head, t),
      Offset(w - head, 0),
      Offset(w, h / 2),
      Offset(w - head, h),
      Offset(w - head, h - t),
      Offset(0, h - t),
    ];
  }
  if (dir == 'left') return [for (final p in _arrowPoints(w, h, 'right')) Offset(w - p.dx, p.dy)];
  return [
    Offset(0, h / 2),
    Offset(head, 0),
    Offset(head, t),
    Offset(w - head, t),
    Offset(w - head, 0),
    Offset(w, h / 2),
    Offset(w - head, h),
    Offset(w - head, h - t),
    Offset(head, h - t),
    Offset(head, h),
  ];
}

List<Offset> _crossPoints(double w, double h) {
  final a = math.min(w, h) * 0.34;
  final x1 = (w - a) / 2, x2 = (w + a) / 2, y1 = (h - a) / 2, y2 = (h + a) / 2;
  return [
    Offset(x1, 0),
    Offset(x2, 0),
    Offset(x2, y1),
    Offset(w, y1),
    Offset(w, y2),
    Offset(x2, y2),
    Offset(x2, h),
    Offset(x1, h),
    Offset(x1, y2),
    Offset(0, y2),
    Offset(0, y1),
    Offset(x1, y1),
  ];
}

String _cloudPath(double w, double h, double inset) {
  final cx = w / 2, cy = h / 2 + h * 0.03;
  final rx = w / 2 - inset - w * 0.08, ry = h / 2 - inset - h * 0.14;
  const n = 9;
  const a0 = -math.pi / 2 - 0.25;
  final pts = _ellipsePoints(cx, cy, rx, ry, n, a0, a0 + math.pi * 2);
  final d = StringBuffer('M${_p(pts[0].dx, pts[0].dy)}');
  for (var i = 1; i <= n; i++) {
    final a = pts[i - 1], b = pts[i % n];
    final r = (b - a).distance * 0.62;
    d.write('A${_n(r)} ${_n(r)} 0 0 1 ${_p(b.dx, b.dy)}');
  }
  return '${d}Z';
}

String _calloutPath(double w, double h, double inset) {
  final x1 = inset, y1 = inset, x2 = w - inset, y2 = h * 0.78 - inset / 2;
  final r = math.min(14.0, math.min((x2 - x1) / 4, (y2 - y1) / 4));
  final t1 = x1 + w * 0.2, t2 = x1 + w * 0.38;
  final tipX = x1 + w * 0.1, tipY = h - inset;
  return 'M${_p(x1 + r, y1)}H${_n(x2 - r)}Q${_p(x2, y1)} ${_p(x2, y1 + r)}V${_n(y2 - r)}Q${_p(x2, y2)} ${_p(x2 - r, y2)}'
      'H${_n(t2)}L${_p(tipX, tipY)}L${_p(t1, y2)}H${_n(x1 + r)}Q${_p(x1, y2)} ${_p(x1, y2 - r)}V${_n(y1 + r)}'
      'Q${_p(x1, y1)} ${_p(x1 + r, y1)}Z';
}

double _cylRy(double w, double h) => math.min(h * 0.14, w * 0.22);

String _cylinderPath(double w, double h, double inset) {
  final x1 = inset, x2 = w - inset;
  final rx = (x2 - x1) / 2, ry = _cylRy(w, h);
  final top = inset + ry, bot = h - inset - ry;
  final a = '${_n(rx)} ${_n(ry)} 0 0 0';
  return 'M${_p(x1, top)}V${_n(bot)}A$a ${_p(x2, bot)}V${_n(top)}A$a ${_p(x1, top)}A$a ${_p(x2, top)}';
}

List<Offset> _cylinderOutline(double w, double h) {
  final ry = _cylRy(w, h);
  return [
    ..._ellipsePoints(w / 2, ry, w / 2, ry, 12, math.pi, math.pi * 2),
    ..._ellipsePoints(w / 2, h - ry, w / 2, ry, 12, 0, math.pi),
  ];
}

String _sheetPath(double x1, double y1, double x2, double y2, double d) {
  final b = y2 - d, mx = (x1 + x2) / 2;
  return 'M${_p(x1, y1)}H${_n(x2)}V${_n(b)}Q${_p(x2 - (x2 - x1) / 4, b - d * 1.6)} ${_p(mx, b)}T${_p(x1, b)}Z';
}

List<Offset> _documentOutline(double w, double h) {
  final d = h * 0.09, b = h - d;
  return [
    const Offset(0, 0),
    Offset(w, 0),
    for (var i = 0; i <= 16; i++) Offset(w * (1 - i / 16), b - math.sin(i / 16 * math.pi * 2) * d * 0.8),
  ];
}

String _delayPath(double w, double h, double inset) {
  final r = math.min((h - 2 * inset) / 2, (w - 2 * inset) / 2);
  final x2 = w - inset;
  return 'M${_p(inset, inset)}H${_n(x2 - r)}A${_n(r)} ${_n(h / 2 - inset)} 0 0 1 ${_p(x2 - r, h - inset)}H${_n(inset)}Z';
}

String _bracePath(double w, double h, double inset, bool left) {
  final x1 = left ? w - inset : inset, x2 = left ? inset : w - inset;
  final xm = (x1 + x2) / 2, y1 = inset, y2 = h - inset, ym = h / 2;
  final r = math.min((x1 - x2).abs() * 0.5, (y2 - y1) * 0.12);
  return 'M${_p(x1, y1)}Q${_p(xm, y1)} ${_p(xm, y1 + r)}V${_n(ym - r)}Q${_p(xm, ym)} ${_p(x2, ym)}'
      'Q${_p(xm, ym)} ${_p(xm, ym + r)}V${_n(y2 - r)}Q${_p(xm, y2)} ${_p(x1, y2)}';
}

List<Offset> _arrowVertical(double w, double h, bool down) => [
  for (final p in _arrowPoints(h, w, 'right')) Offset(p.dy, down ? p.dx : h - p.dx),
];

String _heartPath(double w, double h, double inset) {
  final x1 = inset, y1 = inset, ww = w - 2 * inset, hh = h - 2 * inset;
  String q(double u, double v) => _p(x1 + u * ww, y1 + v * hh);
  return 'M${q(0.5, 0.24)}C${q(0.62, -0.04)} ${q(1.02, 0.0)} ${q(1, 0.32)}'
      'C${q(0.98, 0.6)} ${q(0.66, 0.78)} ${q(0.5, 1)}'
      'C${q(0.34, 0.78)} ${q(0.02, 0.6)} ${q(0, 0.32)}'
      'C${q(-0.02, 0.0)} ${q(0.38, -0.04)} ${q(0.5, 0.24)}Z';
}

const List<(double, double)> _heartUnit = [
  (0.5, 0.24), (0.62, 0.06), (0.8, 0.02), (0.96, 0.14), (1, 0.32), (0.92, 0.56), (0.72, 0.78), //
  (0.5, 1), (0.28, 0.78), (0.08, 0.56), (0, 0.32), (0.04, 0.14), (0.2, 0.02), (0.38, 0.06),
];

String _multiDocumentPath(double w, double h, double inset) {
  final off = math.min(w, h) * 0.07;
  final fx2 = w - inset - 2 * off, fy1 = inset + 2 * off, fy2 = h - inset;
  final front = _sheetPath(inset, fy1, fx2, fy2, h * 0.09);
  String sheet(int k) =>
      'M${_p(inset + k * off, fy1 - (k - 1) * off)}V${_n(fy1 - k * off)}H${_n(fx2 + k * off)}'
      'V${_n(fy2 - (h * 0.09 + k * off))}H${_n(fx2 + (k - 1) * off)}';
  return sheet(2) + sheet(1) + front;
}

String _displayPath(double w, double h, double inset) {
  final x1 = inset, x2 = w - inset, y1 = inset, y2 = h - inset;
  final k = math.min((x2 - x1) * 0.18, (y2 - y1) * 0.5);
  return 'M${_p(x1, h / 2)}L${_p(x1 + k, y1)}H${_n(x2 - k)}A${_n(k)} ${_n((y2 - y1) / 2)} 0 0 1 ${_p(x2 - k, y2)}'
      'H${_n(x1 + k)}Z';
}

String _storedDataPath(double w, double h, double inset) {
  final x1 = inset, x2 = w - inset, y1 = inset, y2 = h - inset;
  final k = math.min((x2 - x1) * 0.14, (y2 - y1) * 0.35);
  final ry = _n((y2 - y1) / 2);
  return 'M${_p(x1 + k, y1)}H${_n(x2)}A${_n(k)} $ry 0 0 0 ${_p(x2, y2)}H${_n(x1 + k)}A${_n(k)} $ry 0 0 1 ${_p(x1 + k, y1)}Z';
}

String _circleWith(double w, double h, double inset, bool plus) {
  final cx = w / 2, cy = h / 2, rx = w / 2 - inset, ry = h / 2 - inset;
  final a = '${_n(rx)} ${_n(ry)} 0 1 1';
  final ring = 'M${_p(cx - rx, cy)}A$a ${_p(cx + rx, cy)}A$a ${_p(cx - rx, cy)}Z';
  if (plus) return '${ring}M${_p(cx, cy - ry)}V${_n(cy + ry)}M${_p(cx - rx, cy)}H${_n(cx + rx)}';
  const k = math.sqrt1_2;
  return '${ring}M${_p(cx - rx * k, cy - ry * k)}L${_p(cx + rx * k, cy + ry * k)}'
      'M${_p(cx + rx * k, cy - ry * k)}L${_p(cx - rx * k, cy + ry * k)}';
}

const List<(double, double)> _diamondUnit = [(0.5, 0), (1, 0.5), (0.5, 1), (0, 0.5)];

Insets4 Function(double, double) _pad(double t, double r, double b, double l) =>
    (w, h) => (h * t, w * r, h * b, w * l);

Insets4 _zero(double w, double h) => (0, 0, 0, 0);

// ---- core shapes (web/src/editor/core/shapeKinds.tsx; numbers unrounded like the web) -----------------------------

String _coreRoundRect(double w, double h, double inset) {
  final x1 = inset, y1 = inset, x2 = w - inset, y2 = h - inset;
  final r = math.min(6.0, math.min((x2 - x1) / 4, (y2 - y1) / 4));
  String n(double v) => jsNum(v);
  return 'M${n(x1 + r)} ${n(y1)}H${n(x2 - r)}Q${n(x2)} ${n(y1)} ${n(x2)} ${n(y1 + r)}V${n(y2 - r)}'
      'Q${n(x2)} ${n(y2)} ${n(x2 - r)} ${n(y2)}H${n(x1 + r)}Q${n(x1)} ${n(y2)} ${n(x1)} ${n(y2 - r)}V${n(y1 + r)}'
      'Q${n(x1)} ${n(y1)} ${n(x1 + r)} ${n(y1)}Z';
}

final Map<String, _Kind> _kinds = {
  'rect': const _Kind(path: _coreRoundRect),
  'ellipse': _Kind(
    path: (w, h, inset) {
      final rx = (w - 2 * inset) / 2, ry = (h - 2 * inset) / 2;
      return 'M${jsNum(inset)} ${jsNum(inset + ry)}a${jsNum(rx)} ${jsNum(ry)} 0 1 0 ${jsNum(rx * 2)} 0'
          'a${jsNum(rx)} ${jsNum(ry)} 0 1 0 ${jsNum(-rx * 2)} 0Z';
    },
    insets: (w, h) => (h * 0.14, w * 0.14, h * 0.14, w * 0.14),
    outline: (w, h) => _ellipsePoints(w / 2, h / 2, w / 2, h / 2, 32),
  ),
  'diamond': _Kind(
    path: (w, h, inset) =>
        'M${jsNum(w / 2)} ${jsNum(inset)}L${jsNum(w - inset)} ${jsNum(h / 2)}L${jsNum(w / 2)} ${jsNum(h - inset)}'
        'L${jsNum(inset)} ${jsNum(h / 2)}Z',
    insets: (w, h) => (h * 0.2, w * 0.22, h * 0.2, w * 0.22),
    outline: (w, h) => _scale(_diamondUnit, w, h),
  ),
  'triangle': _Kind(
    path: (w, h, inset) =>
        'M${jsNum(w / 2)} ${jsNum(inset)}L${jsNum(w - inset)} ${jsNum(h - inset)}L${jsNum(inset)} ${jsNum(h - inset)}Z',
    insets: (w, h) => (h * 0.42, w * 0.24, h * 0.08, w * 0.24),
    outline: (w, h) => [Offset(w / 2, 0), Offset(w, h), Offset(0, h)],
  ),
  // ---- library (features/shapes/geometry.ts) ----
  'roundrect': _Kind(
    path: (w, h, inset) => _roundRectPath(inset, inset, w - inset, h - inset, math.min(w, h) * 0.18),
    outline: (w, h) => _roundRectOutline(w, h, math.min(w, h) * 0.18),
  ),
  'pentagon': _polygonKind([(0.5, 0), (1, 0.38), (0.81, 1), (0.19, 1), (0, 0.38)], _pad(0.3, 0.2, 0.08, 0.2)),
  'hexagon': _polygonKind([(0.25, 0), (0.75, 0), (1, 0.5), (0.75, 1), (0.25, 1), (0, 0.5)], _pad(0.08, 0.2, 0.08, 0.2)),
  'octagon': _polygonKind([
    (0.29, 0), (0.71, 0), (1, 0.29), (1, 0.71), (0.71, 1), (0.29, 1), (0, 0.71), (0, 0.29), //
  ], _pad(0.12, 0.12, 0.12, 0.12)),
  'star': _polygonKind(_starUnit, _pad(0.38, 0.3, 0.26, 0.3)),
  'parallelogram': _polygonKind([(0.2, 0), (1, 0), (0.8, 1), (0, 1)], _pad(0.08, 0.18, 0.08, 0.18)),
  'trapezoid': _polygonKind([(0.2, 0), (0.8, 0), (1, 1), (0, 1)], _pad(0.1, 0.16, 0.08, 0.16)),
  'manualInput': _polygonKind([(0, 0.28), (1, 0), (1, 1), (0, 1)], _pad(0.3, 0.06, 0.06, 0.06)),
  'chevron': _polygonKind([(0, 0), (0.72, 0), (1, 0.5), (0.72, 1), (0, 1), (0.28, 0.5)], _pad(0.08, 0.22, 0.08, 0.26)),
  'arrowRight': _dynamicPolygon(
    (w, h) => _arrowPoints(w, h, 'right'),
    (w, h) => (h * 0.24, math.min(w * 0.3, h * 0.5), h * 0.24, w * 0.04),
  ),
  'arrowLeft': _dynamicPolygon(
    (w, h) => _arrowPoints(w, h, 'left'),
    (w, h) => (h * 0.24, w * 0.04, h * 0.24, math.min(w * 0.3, h * 0.5)),
  ),
  'arrowDouble': _dynamicPolygon(
    (w, h) => _arrowPoints(w, h, 'both'),
    (w, h) => (h * 0.24, math.min(w * 0.22, h * 0.45), h * 0.24, math.min(w * 0.22, h * 0.45)),
  ),
  'cross': _dynamicPolygon(_crossPoints, (w, h) => (h * 0.36, w * 0.36, h * 0.36, w * 0.36)),
  'cylinder': _Kind(
    path: _cylinderPath,
    outline: _cylinderOutline,
    insets: (w, h) => (_cylRy(w, h) * 2 + 4, w * 0.08, _cylRy(w, h) + 4, w * 0.08),
  ),
  'cloud': _Kind(
    path: _cloudPath,
    outline: (w, h) => _ellipsePoints(w / 2, h / 2, w / 2 - w * 0.02, h / 2 - h * 0.04, 24),
    insets: _pad(0.24, 0.2, 0.2, 0.2),
  ),
  'callout': _Kind(
    path: _calloutPath,
    outline: (w, h) => [
      const Offset(0, 0),
      Offset(w, 0),
      Offset(w, h * 0.78),
      Offset(w * 0.38, h * 0.78),
      Offset(w * 0.1, h),
      Offset(w * 0.2, h * 0.78),
      Offset(0, h * 0.78),
    ],
    insets: (w, h) => (10, 12, h * 0.22 + 10, 12),
  ),
  'terminator': _Kind(
    path: (w, h, inset) => _roundRectPath(inset, inset, w - inset, h - inset, h / 2),
    outline: (w, h) => _roundRectOutline(w, h, h / 2),
    insets: (w, h) => (8, math.min(w * 0.2, h * 0.4), 8, math.min(w * 0.2, h * 0.4)),
  ),
  'document': _Kind(
    path: (w, h, inset) => _sheetPath(inset, inset, w - inset, h - inset, h * 0.09),
    outline: _documentOutline,
    insets: (w, h) => (10, 12, h * 0.18 + 6, 12),
  ),
  'predefined': _Kind(
    path: (w, h, inset) {
      final k = math.min(w * 0.1, 22.0);
      return 'M${_p(inset, inset)}H${_n(w - inset)}V${_n(h - inset)}H${_n(inset)}Z'
          'M${_p(inset + k, inset)}V${_n(h - inset)}M${_p(w - inset - k, inset)}V${_n(h - inset)}';
    },
    insets: (w, h) => (10, math.min(w * 0.1, 22.0) + 8, 10, math.min(w * 0.1, 22.0) + 8),
  ),
  'delay': _Kind(
    path: _delayPath,
    outline: (w, h) {
      final r = math.min(h / 2, w / 2);
      return [
        const Offset(0, 0),
        ..._ellipsePoints(w - r, h / 2, r, h / 2, 13, -math.pi / 2, math.pi / 2),
        Offset(0, h),
      ];
    },
    insets: (w, h) => (10, math.min(h / 2, w / 2) * 0.45 + 8, 10, 12),
  ),
  'braceLeft': _Kind(path: (w, h, inset) => _bracePath(w, h, inset, true), insets: _zero, open: true),
  'braceRight': _Kind(path: (w, h, inset) => _bracePath(w, h, inset, false), insets: _zero, open: true),
  'arrowUp': _dynamicPolygon(
    (w, h) => _arrowVertical(w, h, false),
    (w, h) => (math.min(h * 0.3, w * 0.5), w * 0.24, h * 0.04, w * 0.24),
  ),
  'arrowDown': _dynamicPolygon(
    (w, h) => _arrowVertical(w, h, true),
    (w, h) => (h * 0.04, w * 0.24, math.min(h * 0.3, w * 0.5), w * 0.24),
  ),
  'pentagonArrow': _polygonKind([(0, 0), (0.76, 0), (1, 0.5), (0.76, 1), (0, 1)], _pad(0.08, 0.24, 0.08, 0.06)),
  'heart': _Kind(
    path: _heartPath,
    outline: (w, h) => [for (final (u, v) in _heartUnit) Offset(u * w, v * h)],
    insets: _pad(0.26, 0.2, 0.3, 0.2),
  ),
  'manualOperation': _polygonKind([(0, 0), (1, 0), (0.8, 1), (0.2, 1)], _pad(0.08, 0.18, 0.08, 0.18)),
  'offPage': _polygonKind([(0, 0), (1, 0), (1, 0.62), (0.5, 1), (0, 0.62)], _pad(0.08, 0.08, 0.36, 0.08)),
  'merge': _polygonKind([(0, 0), (1, 0), (0.5, 1)], _pad(0.06, 0.28, 0.5, 0.28)),
  'card': _polygonKind([(0.18, 0), (1, 0), (1, 1), (0, 1), (0, 0.28)], _pad(0.12, 0.08, 0.08, 0.1)),
  'sort': _Kind(
    path: (w, h, inset) => '${_polyPath(_scale(_diamondUnit, w, h, inset))}M${_p(inset, h / 2)}H${_n(w - inset)}',
    outline: (w, h) => _scale(_diamondUnit, w, h),
    insets: _pad(0.22, 0.25, 0.22, 0.25),
  ),
  'multiDocument': _Kind(
    path: _multiDocumentPath,
    outline: (w, h) => [
      Offset(0, math.min(w, h) * 0.14),
      Offset(math.min(w, h) * 0.14, 0),
      Offset(w, 0),
      Offset(w, h * 0.8),
      Offset(w * 0.5, h),
      Offset(0, h * 0.92),
    ],
    insets: (w, h) => (math.min(w, h) * 0.14 + 10, math.min(w, h) * 0.14 + 10, h * 0.2 + 4, 12),
  ),
  'display': _Kind(
    path: _displayPath,
    outline: (w, h) {
      final k = math.min(w * 0.18, h * 0.5);
      return [
        Offset(0, h / 2),
        Offset(k, 0),
        ..._ellipsePoints(w - k, h / 2, k, h / 2, 9, -math.pi / 2, math.pi / 2),
        Offset(k, h),
      ];
    },
    insets: (w, h) => (8, math.min(w * 0.18, h * 0.5) * 0.6 + 8, 8, math.min(w * 0.18, h * 0.5) + 6),
  ),
  'storedData': _Kind(
    path: _storedDataPath,
    insets: (w, h) => (8, math.min(w * 0.14, h * 0.35) + 6, 8, math.min(w * 0.14, h * 0.35) + 6),
  ),
  'internalStorage': _Kind(
    path: (w, h, inset) {
      final k = math.min(w, h) * 0.16;
      return 'M${_p(inset, inset)}H${_n(w - inset)}V${_n(h - inset)}H${_n(inset)}Z'
          'M${_p(inset + k, inset)}V${_n(h - inset)}M${_p(inset, inset + k)}H${_n(w - inset)}';
    },
    insets: (w, h) => (math.min(w, h) * 0.16 + 6, 10, 8, math.min(w, h) * 0.16 + 6),
  ),
  'summing': _Kind(
    path: (w, h, inset) => _circleWith(w, h, inset, false),
    outline: (w, h) => _ellipsePoints(w / 2, h / 2, w / 2, h / 2, 24),
    insets: _pad(0.3, 0.3, 0.3, 0.3),
  ),
  'or': _Kind(
    path: (w, h, inset) => _circleWith(w, h, inset, true),
    outline: (w, h) => _ellipsePoints(w / 2, h / 2, w / 2, h / 2, 24),
    insets: _pad(0.3, 0.3, 0.3, 0.3),
  ),
};

/// True if the renderer has its own geometry for [kind] (otherwise: rectangle, like old web clients).
bool isKnownShapeKind(String? kind) => kind != null && _kinds.containsKey(kind);

/// SVG path of a shape inset by [inset] (half the stroke width); unknown kinds draw the core rectangle.
String shapePathData(String? kind, double w, double h, double inset) =>
    (_kinds[kind] ?? _kinds['rect']!).path(w, h, inset);

/// Text area of a shape: top, right, bottom, left (default 10/12/10/12).
Insets4 shapeInsets(String? kind, double w, double h) => _kinds[kind]?.insets?.call(w, h) ?? (10, 12, 10, 12);

/// Outline polygon for docking connectors (object coordinates), null = dock at the rectangle.
List<Offset>? shapeOutline(String? kind, double w, double h) {
  if (kind == 'rect' || kind == 'ellipse' || kind == 'diamond' || kind == 'triangle') return null; // exact in route
  return _kinds[kind]?.outline?.call(w, h);
}

/// Line-only shapes (braces).
bool isOpenShapeKind(String? kind) => _kinds[kind]?.open ?? false;
