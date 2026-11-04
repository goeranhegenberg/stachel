import 'dart:math' as math;
import 'dart:ui';

/// Grid index for fast area queries (culling, hit-test), like the web's `GridIndex`: cells of [cell] world
/// points; very large entries go into an extra list instead of thousands of cells.
class SpatialGrid {
  SpatialGrid({this.cell = 512, this.maxCells = 1024});

  final double cell;
  final int maxCells;

  final _cells = <int, Set<String>>{};
  final _rects = <String, Rect>{};
  final _big = <String>{};

  int get length => _rects.length;
  Rect? rectOf(String id) => _rects[id];
  Iterable<String> get ids => _rects.keys;

  /// Cell key: two 32-bit signed coordinates packed into one int.
  static int _key(int cx, int cy) => ((cx & 0xffffffff) << 32) | (cy & 0xffffffff);

  (int, int, int, int) _span(Rect r) =>
      ((r.left / cell).floor(), (r.top / cell).floor(), (r.right / cell).floor(), (r.bottom / cell).floor());

  void set(String id, Rect r) {
    remove(id);
    if (!(r.left + r.top + r.right + r.bottom).isFinite) return;
    _rects[id] = r;
    final (x1, y1, x2, y2) = _span(r);
    if ((x2 - x1 + 1) * (y2 - y1 + 1) > maxCells) {
      _big.add(id);
      return;
    }
    for (var cx = x1; cx <= x2; cx++) {
      for (var cy = y1; cy <= y2; cy++) {
        (_cells[_key(cx, cy)] ??= <String>{}).add(id);
      }
    }
  }

  void remove(String id) {
    final r = _rects.remove(id);
    if (r == null) return;
    if (_big.remove(id)) return;
    final (x1, y1, x2, y2) = _span(r);
    for (var cx = x1; cx <= x2; cx++) {
      for (var cy = y1; cy <= y2; cy++) {
        final k = _key(cx, cy);
        final s = _cells[k];
        if (s == null) continue;
        s.remove(id);
        if (s.isEmpty) _cells.remove(k);
      }
    }
  }

  void clear() {
    _cells.clear();
    _rects.clear();
    _big.clear();
  }

  /// IDs of all entries whose rectangle intersects [r] (edges count), unordered.
  Set<String> query(Rect r) {
    final out = <String>{};
    final (x1, y1, x2, y2) = _span(r);
    final cellsInQuery = (x2 - x1 + 1) * (y2 - y1 + 1);
    if (cellsInQuery > _cells.length) {
      // Query larger than the occupied area: just test everything.
      _rects.forEach((id, b) {
        if (_hits(b, r)) out.add(id);
      });
      return out;
    }
    for (var cx = x1; cx <= x2; cx++) {
      for (var cy = y1; cy <= y2; cy++) {
        final s = _cells[_key(cx, cy)];
        if (s == null) continue;
        for (final id in s) {
          if (!out.contains(id) && _hits(_rects[id]!, r)) out.add(id);
        }
      }
    }
    for (final id in _big) {
      if (_hits(_rects[id]!, r)) out.add(id);
    }
    return out;
  }

  Set<String> queryPoint(Offset p) => query(Rect.fromLTWH(p.dx, p.dy, 0, 0));

  /// Bounding box of all entries (null if empty).
  Rect? get bounds {
    if (_rects.isEmpty) return null;
    var l = double.infinity, t = double.infinity, r = -double.infinity, b = -double.infinity;
    for (final x in _rects.values) {
      l = math.min(l, x.left);
      t = math.min(t, x.top);
      r = math.max(r, x.right);
      b = math.max(b, x.bottom);
    }
    return Rect.fromLTRB(l, t, r, b);
  }

  static bool _hits(Rect a, Rect b) => a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
}
