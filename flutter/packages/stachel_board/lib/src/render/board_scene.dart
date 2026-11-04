import 'dart:math' as math;
import 'dart:ui';

import '../geometry/connector_route.dart';
import '../geometry/shape_paths.dart';
import '../geometry/spatial_grid.dart';
import '../geometry/svg_path.dart';
import '../model/board_object.dart';
import '../model/board_state.dart';

/// Height above a frame that belongs to it (title).
const frameTitleSpace = 28.0;

/// World height above a frame where its title can be grabbed at [zoom]: the title is drawn in screen size (≈ 26 px,
/// the big one below 25 % ≈ 30 px), never less than [frameTitleSpace].
double frameTitleHeight(double zoom) => math.max(frameTitleSpace, (zoom < 0.25 ? 30 : 26) / zoom);

/// Hit tolerance for lines (connectors, pen strokes) in screen pixels (concept §3.2) from 50 % zoom up.
const lineHitTolerance = 12.0;

/// Below this many screen pixels from a line the finger is right on it: the line wins over what lies beneath
/// (UX P3). Between this and [lineHitToleranceAt] a line only counts if no surface is under the finger.
const lineCoreTolerance = 3.0;

/// Screen pixels around a preferred object (running vote: votable ones) that still count as a hit on it (UX P3).
const preferHitSlop = 6.0;

/// Line tolerance in screen pixels at [zoom] (UX P3, B3): [lineHitTolerance] from 50 % up, shrinking linearly to
/// half of it at 20 % and below – in the overview a fixed 12 px would cover small shapes completely.
double lineHitToleranceAt(double zoom) {
  if (zoom >= 0.5) return lineHitTolerance;
  final t = ((zoom - 0.2) / 0.3).clamp(0.0, 1.0);
  return lineHitTolerance * (0.5 + 0.5 * t);
}

/// World rectangle of an object: the rotated rectangle's axis-aligned bounds (`objRect` in the web).
Rect objectRect(BoardObject o) {
  final deg = o.rotation;
  if (deg == 0) return Rect.fromLTWH(o.x, o.y, o.w, o.h);
  final a = deg * math.pi / 180;
  final c = math.cos(a).abs(), s = math.sin(a).abs();
  final w = o.w * c + o.h * s, h = o.w * s + o.h * c;
  return Rect.fromCenter(center: Offset(o.x + o.w / 2, o.y + o.h / 2), width: w, height: h);
}

/// Spatial view of a [BoardState]: grid index for culling and hit-testing, connector routes, mind map edges.
/// [sync] updates only what changed (patches touch few objects).
class BoardScene {
  BoardScene(this.state);

  final BoardState state;
  final grid = SpatialGrid();
  final _connectors = <String, ConnectorGeometry?>{};

  /// object id → connectors docked to it.
  final _attached = <String, Set<String>>{};

  /// mind node id → its children (for edges and inherited colors).
  final _mindChildren = <String, Set<String>>{};
  int _syncedVersion = -1;

  ConnectorGeometry? connector(String id) => _connectors[id];

  BoardObject? lookup(String id) => state[id];

  /// Re-indexes [changed] objects (null = everything) and the connectors and mind map edges that depend on them.
  void sync([Set<String>? changed]) {
    if (changed == null || _syncedVersion < 0) {
      grid.clear();
      _connectors.clear();
      _attached.clear();
      _mindChildren.clear();
      for (final o in state.ordered) {
        _indexRelations(o);
      }
      for (final o in state.ordered) {
        _place(o);
      }
      _syncedVersion = state.version;
      return;
    }
    final dirty = <String>{...changed};
    for (final id in changed) {
      dirty.addAll(_attached[id] ?? const {});
      final o = state[id];
      if (o != null && o.type == 'mindnode') {
        dirty.addAll(_mindChildren[id] ?? const {});
      }
    }
    // Relations of changed objects may have moved (new ends, new parent): rebuild them for those.
    for (final id in changed) {
      for (final s in _attached.values) {
        s.remove(id);
      }
      for (final s in _mindChildren.values) {
        s.remove(id);
      }
      final o = state[id];
      if (o != null) _indexRelations(o);
    }
    for (final id in dirty) {
      final o = state[id];
      if (o == null) {
        grid.remove(id);
        _connectors.remove(id);
      } else {
        _place(o);
      }
    }
    _syncedVersion = state.version;
  }

  void _indexRelations(BoardObject o) {
    if (o.type == 'connector') {
      for (final e in [o.from, o.to]) {
        if (e is AttachedEnd) (_attached[e.objectId] ??= {}).add(o.id);
      }
    } else if (o.type == 'mindnode') {
      final p = o.mind.parent;
      if (p != null) (_mindChildren[p] ??= {}).add(o.id);
    }
  }

  void _place(BoardObject o) {
    if (!isVisibleObject(o)) {
      grid.remove(o.id);
      _connectors.remove(o.id);
      return;
    }
    switch (o.type) {
      case 'connector':
        final g = connectorGeometry(o, lookup);
        _connectors[o.id] = g;
        if (g == null) {
          grid.remove(o.id);
        } else {
          grid.set(o.id, connectorBounds(g, 12 + (o.strokeWidth ?? 2) * 3));
        }
      case 'frame':
        grid.set(o.id, Rect.fromLTRB(o.x, o.y - frameTitleSpace, o.x + o.w, o.y + o.h));
      case 'mindnode':
        final p = mindParent(o);
        final r = objectRect(o);
        grid.set(o.id, p == null ? r : r.expandToInclude(objectRect(p)));
      default:
        grid.set(o.id, objectRect(o));
    }
  }

  /// Parent of a mind node (null for the root or a missing/hidden parent).
  BoardObject? mindParent(BoardObject o) {
    final pid = o.mind.parent;
    if (pid == null || pid == o.id) return null;
    final p = state[pid];
    return p != null && p.type == 'mindnode' ? p : null;
  }

  /// Objects intersecting [world] in paint order.
  List<BoardObject> visible(Rect world) {
    if (_syncedVersion != state.version) sync();
    final ids = grid.query(world);
    final list = [for (final id in ids) ?state[id]];
    list.sort((a, b) => state.orderOf(a.id).compareTo(state.orderOf(b.id)));
    return list;
  }

  /// Bounds of everything (for „Alles zeigen“).
  Rect? get bounds {
    if (_syncedVersion != state.version) sync();
    return grid.bounds;
  }

  /// Topmost object at world point [p] ([zoom] scales the tolerances). Frames only count through their title or
  /// when nothing else is hit (`hit: 'background'`), connectors and pen strokes by distance to the line.
  ///
  /// UX P3 (B3, small zoom): surfaces go before thin lines. A line wins in paint order only when the finger is right
  /// on it ([lineCoreTolerance]); merely near it ([lineHitToleranceAt], at most half the line's length) it counts
  /// only when no note, shape … lies under the finger – then the nearest such line. With [prefer] (a running vote:
  /// votable objects) the topmost preferred object under the finger or within [preferHitSlop] wins over everything.
  BoardObject? hitTest(Offset p, double zoom, {bool Function(BoardObject o)? prefer}) {
    if (_syncedVersion != state.version) sync();
    final tol = lineHitToleranceAt(zoom) / zoom;
    final core = lineCoreTolerance / zoom;
    final slop = prefer == null ? 0.0 : preferHitSlop / zoom;
    final reach = math.max(tol, slop);
    // frame titles are drawn in screen size (big below 25 %): reach down for frames whose title is at p
    final titleH = frameTitleHeight(zoom);
    final ids = grid.query(Rect.fromLTRB(p.dx - reach, p.dy - reach, p.dx + reach, p.dy + math.max(reach, titleH)));
    final candidates = [for (final id in ids) ?state[id]]
      ..sort((a, b) => state.orderOf(b.id).compareTo(state.orderOf(a.id)));
    if (prefer != null) {
      for (final o in candidates) {
        if (prefer(o) && _onSurface(o, p, slop)) return o;
      }
    }
    BoardObject? background, near;
    var nearD = double.infinity;
    for (final o in candidates) {
      switch (o.type) {
        case 'connector':
          final g = _connectors[o.id];
          if (g == null) continue;
          final half = (o.strokeWidth ?? 2) / 2;
          final d = _pathDistance(g, p);
          if (d <= half + core) return o;
          if (d <= half + math.max(core, math.min(tol, _pathLength(g) / 2)) && d < nearD) (near, nearD) = (o, d);
        case 'pen':
          final half = (o.strokeWidth ?? 3) / 2;
          final d = _penDistance(o, p);
          if (d <= half + core) return o;
          if (d <= half + tol && d < nearD) (near, nearD) = (o, d);
        case 'frame':
          final title = Rect.fromLTWH(o.x, o.y - titleH, math.max(o.w, 1), titleH);
          if (title.contains(p)) return o;
          if (Rect.fromLTWH(o.x, o.y, o.w, o.h).contains(p)) background ??= o;
        default:
          if (_onSurface(o, p, 0)) return o;
      }
    }
    return near ?? background;
  }

  /// [p] on the surface of [o] (not lines, frames only inside), grown by [slop] world units.
  static bool _onSurface(BoardObject o, Offset p, double slop) {
    switch (o.type) {
      case 'connector' || 'pen':
        return false;
      case 'frame':
        return Rect.fromLTWH(o.x, o.y, o.w, o.h).inflate(slop).contains(p);
      case 'shape':
        final local = _toLocal(o, p);
        if (!Rect.fromLTWH(0, 0, o.w, o.h).inflate(0.5 + slop).contains(local)) return false;
        if (slop > 0 || !isKnownShapeKind(o.shape) || o.shape == 'rect') return true;
        final path = parseSvgPath(shapePathData(o.shape, o.w, o.h, 0));
        return path.contains(local) || isOpenShapeKind(o.shape);
      default:
        return Rect.fromLTWH(0, 0, o.w, o.h).inflate(slop).contains(_toLocal(o, p));
    }
  }

  static Offset _toLocal(BoardObject o, Offset p) {
    final c = Offset(o.x + o.w / 2, o.y + o.h / 2);
    final q = o.rotation != 0 ? rotatePoint(p, c, -o.rotation) : p;
    return q - Offset(o.x, o.y);
  }

  static List<Offset> _polyline(ConnectorGeometry g) =>
      g.style == 'curved' && g.pts.length == 4 ? [for (var i = 0; i <= 24; i++) bezierAt(g.pts, i / 24)] : g.pts;

  /// Distance from [p] to the connector's center line.
  static double _pathDistance(ConnectorGeometry g, Offset p) {
    final pts = _polyline(g);
    var d = double.infinity;
    for (var i = 1; i < pts.length; i++) {
      d = math.min(d, distToSegment(p, pts[i - 1], pts[i]));
    }
    return d;
  }

  static double _pathLength(ConnectorGeometry g) {
    final pts = _polyline(g);
    var len = 0.0;
    for (var i = 1; i < pts.length; i++) {
      len += (pts[i] - pts[i - 1]).distance;
    }
    return len;
  }

  /// Distance from [p] to the pen stroke's center line.
  static double _penDistance(BoardObject o, Offset p) {
    final pts = o.points;
    final local = p - Offset(o.x, o.y);
    if (pts.length < 2) return double.infinity;
    if (pts.length < 4) return (local - Offset(pts[0], pts[1])).distance;
    var d = double.infinity;
    for (var i = 2; i + 1 < pts.length; i += 2) {
      d = math.min(d, distToSegment(local, Offset(pts[i - 2], pts[i - 1]), Offset(pts[i], pts[i + 1])));
    }
    return d;
  }
}

/// Hidden objects (`hidden`, collapsed mind map branch) are neither drawn nor hit.
bool isVisibleObject(BoardObject o) => (!o.hidden || showHiddenObjects) && !(o.type == 'mindnode' && o.mind.hidden);

/// „Ausgeblendete zeigen“ (web D28, only until the app restarts): objects with `hidden` are drawn faded and can be
/// selected. Switch it with `BoardEditor.setShowHidden` (re-syncs the scene).
bool showHiddenObjects = false;

/// Distance point – segment.
double distToSegment(Offset p, Offset a, Offset b) {
  final d = b - a;
  final len2 = d.dx * d.dx + d.dy * d.dy;
  final t = len2 == 0 ? 0.0 : (((p.dx - a.dx) * d.dx + (p.dy - a.dy) * d.dy) / len2).clamp(0.0, 1.0);
  return (p - (a + d * t)).distance;
}
