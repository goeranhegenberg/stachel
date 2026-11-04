import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart';

import '../geometry/connector_route.dart';
import '../geometry/shape_paths.dart';
import '../geometry/svg_path.dart';
import '../model/board_object.dart';
import '../model/board_source.dart';
import '../model/collab.dart';
import '../model/rich_edit.dart';
import '../protocol/native_messages.dart';
import '../render/board_scene.dart';
import '../render/paint_utils.dart';
import 'camera.dart';

/// Pen colors like the web (`INK_COLORS.slice(0, 6)`), widths `PEN_WIDTHS`.
const penColors = ['#0a0a0a', '#1763b5', '#ec4e92', '#7aa21b', '#e8590c', '#7048e8'];
const penWidths = [2.0, 4.0, 8.0];

/// Highlighter like the web (`MARKER_COLORS`, `MARKER_WIDTHS`).
const markerColors = ['#ffe14d', '#c9e14a', '#ec4e92', '#4fa3ff', '#ff9a3c'];
const markerWidths = [12.0, 20.0, 32.0];

/// Eraser sizes (screen px, web `ERASER_SIZES`).
const eraserSizes = [8.0, 20.0, 40.0];

/// Connector caps (shapes module) and line styles.
const connectorCaps = [
  'none',
  'arrow',
  'triangle',
  'triangleOpen',
  'circle',
  'circleOpen',
  'diamond',
  'diamondOpen',
  'bar',
];
const connectorStyles = ['straight', 'elbow', 'curved'];

/// Anchor points snap within this many screen pixels.
const anchorSnap = 22.0;

/// Default frame like the web (`frame.create`): 640×420, white.
const frameSize = Size(640, 420);

/// What is being drawn right now (shown by the view, not on the board yet).
sealed class BoardDraft {
  const BoardDraft();
}

/// A connector being dragged: from [a] to [b]; [anchorsOf] = object the end would dock to (outlined), [snapped] = the
/// anchor the end would dock to.
///
/// Like the web's `connectGesture` preview (G02/D38): [route] = the real line the connector will get (line style of
/// the tool, docking), drawn blue with the tool's cap ([cap], „none“ shows a triangle); [near] = objects whose anchor
/// points show (nearest first); [ghost] = the copy a plus handle will create at the free end (dashed). Without
/// [route] a straight line from [a] to [b]; [line] false = no line (an end of an existing connector is dragged, the
/// connector itself shows where it goes).
class ConnectorDraft extends BoardDraft {
  const ConnectorDraft(
    this.a,
    this.b, {
    this.anchorsOf,
    this.snapped,
    this.route,
    this.cap = 'triangle',
    this.near = const [],
    this.ghost,
    this.line = true,
  });
  final Offset a;
  final Offset b;
  final BoardObject? anchorsOf;
  final Offset? snapped;
  final ConnectorGeometry? route;
  final String cap;
  final List<BoardObject> near;
  final BoardObject? ghost;
  final bool line;
}

/// Radius (screen px) in which objects show their anchor points while a connector is dragged (web `NEAR_PX`).
const anchorNear = 70.0;

/// Objects with anchor points near [p] (not [skip]), nearest center first, at most 8 (web `nearAnchorables`).
List<BoardObject> nearAnchorables(BoardScene scene, Offset p, double zoom, {String? skip}) {
  final radius = anchorNear / zoom;
  final out = <BoardObject>[];
  for (final id in scene.grid.query(Rect.fromCenter(center: p, width: radius * 2, height: radius * 2))) {
    final o = scene.state[id];
    if (o == null || id == skip || !connectable(o) || o.type == 'frame') continue;
    out.add(o);
  }
  double d(BoardObject o) => (Offset(o.x + o.w / 2, o.y + o.h / 2) - p).distance;
  out.sort((a, b) => d(a).compareTo(d(b)));
  return out.take(8).toList();
}

class PenDraft extends BoardDraft {
  const PenDraft(this.points, {required this.color, required this.width, this.marker = false});
  final List<Offset> points;
  final String color;
  final double width;
  final bool marker;
}

/// The eraser at [at] (world radius [radius]); [hit] = pen strokes it will remove.
class EraserDraft extends BoardDraft {
  const EraserDraft(this.at, this.radius, this.hit);
  final Offset at;
  final double radius;
  final Set<String> hit;
}

/// Where a connector end lands: docked to an object (optionally at a side) or free.
class EndDrop {
  const EndDrop(this.point, {this.objectId, this.side});
  final Offset point;
  final String? objectId;
  final String? side;

  bool get attached => objectId != null;
  Map<String, Object?> toJson() => objectId != null
      ? {'objectId': objectId, 'side': ?side}
      : {'x': point.dx.roundToDouble(), 'y': point.dy.roundToDouble()};
}

/// Objects a connector can dock to (web: everything but connectors and pen strokes).
bool connectable(BoardObject o) => o.type != 'connector' && o.type != 'pen' && isVisibleObject(o);

/// Where a connector end dropped at world point [p] docks: an anchor (side midpoint) within [anchorSnap] screen px,
/// else the object under [p] (docking by direction), else free. [self] (the connector) and [exclude] never count;
/// [noFrames]: a frame under [p] is no target either (plus handle: the new shape lands there, web `viaPlus`).
EndDrop dropEnd(BoardScene scene, Offset p, double zoom, {String? self, String? exclude, bool noFrames = false}) {
  final snap = anchorSnap / zoom;
  EndDrop? best;
  var bestD = snap;
  for (final id in scene.grid.query(Rect.fromCenter(center: p, width: snap * 4, height: snap * 4))) {
    final o = scene.state[id];
    if (o == null || id == self || id == exclude || !connectable(o) || o.type == 'frame') continue;
    for (final side in const ['n', 'e', 's', 'w']) {
      final (pt, _) = sidePoint(o, side);
      final d = (pt - p).distance;
      if (d <= bestD) {
        bestD = d;
        best = EndDrop(pt, objectId: id, side: side);
      }
    }
  }
  if (best != null) return best;
  final hit = scene.hitTest(p, zoom);
  if (hit != null && hit.id != self && hit.id != exclude && connectable(hit) && !(noFrames && hit.type == 'frame')) {
    return EndDrop(Offset(hit.x + hit.w / 2, hit.y + hit.h / 2), objectId: hit.id);
  }
  return EndDrop(p);
}

/// Normalized box of two points (connectors store it; at least 1 × 1).
Map<String, Object?> boxOf(Offset a, Offset b) => {
  'x': math.min(a.dx, b.dx).roundToDouble(),
  'y': math.min(a.dy, b.dy).roundToDouble(),
  'w': math.max(1.0, (a.dx - b.dx).abs().roundToDouble()),
  'h': math.max(1.0, (a.dy - b.dy).abs().roundToDouble()),
};

/// Patch that sets a cap like the shapes module: `arrowStart`/`arrowEnd` follow (none → off), `triangle` is the
/// fallback and needs no `capX` field.
Map<String, Object?> capPatch(String which, String cap) {
  final start = which == 'start';
  return {
    start ? 'capStart' : 'capEnd': cap == 'triangle' || cap == 'none' ? null : cap,
    // like the web: `arrowStart` true or gone, `arrowEnd` true/false
    start ? 'arrowStart' : 'arrowEnd': start ? (cap == 'none' ? null : true) : cap != 'none',
  };
}

/// Caps offered by the connector tool for new connectors (web `TOOL_CAPS`).
const toolCaps = ['triangle', 'arrow', 'none'];

/// Reverses a connector: ends, caps and label position swap (shapes module).
Map<String, Object?> reversePatch(BoardObject c) {
  final raw = c.raw;
  return {
    'from': raw['to'],
    'to': raw['from'],
    ...capPatch('start', c.capEnd),
    ...capPatch('end', c.capStart),
    if (raw['labelPos'] is num) 'labelPos': 1 - (raw['labelPos'] as num).toDouble(),
  };
}

// ---- pen (port of web/src/board/pen.ts) --------------------------------------------------------------------------

/// Thins out a stroke (Ramer-Douglas-Peucker with [epsilon]).
List<Offset> simplifyStroke(List<Offset> points, double epsilon) {
  if (points.length < 3) return [...points];
  final keep = List<bool>.filled(points.length, false);
  keep[0] = keep[points.length - 1] = true;
  final stack = <(int, int)>[(0, points.length - 1)];
  while (stack.isNotEmpty) {
    final (s, e) = stack.removeLast();
    var maxD = 0.0;
    var idx = -1;
    for (var i = s + 1; i < e; i++) {
      final d = distToSegment(points[i], points[s], points[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > epsilon) {
      keep[idx] = true;
      stack
        ..add((s, idx))
        ..add((idx, e));
    }
  }
  return [
    for (var i = 0; i < points.length; i++)
      if (keep[i]) points[i],
  ];
}

/// World points → pen fields (box with half the stroke as padding, points relative to it, 0.1 precision).
Map<String, Object?> penFromPoints(List<Offset> points, double strokeWidth) {
  final pad = strokeWidth / 2;
  var x1 = double.infinity, y1 = double.infinity, x2 = -double.infinity, y2 = -double.infinity;
  for (final p in points) {
    x1 = math.min(x1, p.dx);
    y1 = math.min(y1, p.dy);
    x2 = math.max(x2, p.dx);
    y2 = math.max(y2, p.dy);
  }
  final x = x1 - pad, y = y1 - pad;
  double r(double v) => (v * 10).roundToDouble() / 10;
  return {
    'x': r(x),
    'y': r(y),
    'w': r(x2 - x1 + pad * 2),
    'h': r(y2 - y1 + pad * 2),
    'points': [
      for (final p in points) ...[r(p.dx - x), r(p.dy - y)],
    ],
  };
}

/// Does the eraser (circle at [p], radius [r]) touch the pen stroke [o]? Checks the segments (web `penHit`).
bool penHit(BoardObject o, Offset p, double r) {
  final pts = o.points;
  final reach = r + (o.strokeWidth ?? 2) / 2;
  if (p.dx < o.x - reach || p.dy < o.y - reach || p.dx > o.x + o.w + reach || p.dy > o.y + o.h + reach) return false;
  Offset at(int i) => Offset(o.x + pts[i * 2], o.y + pts[i * 2 + 1]);
  final n = pts.length ~/ 2;
  if (n == 0) return false;
  if (n == 1) return (p - at(0)).distance <= reach;
  for (var i = 0; i < n - 1; i++) {
    if (distToSegment(p, at(i), at(i + 1)) <= reach) return true;
  }
  return false;
}

// ---- frames (structure module) -------------------------------------------------------------------------------------

/// Frames in list order like the web's frame list: frames with `slide` first (by it, byte order), then the others in
/// reading order (rows top → bottom, left → right).
List<BoardObject> framesInOrder(Iterable<BoardObject> objects) {
  final frames = [
    for (final o in objects)
      if (o.type == 'frame' && !o.hidden) o,
  ];
  final slides = [
    for (final f in frames)
      if (f.raw['slide'] is String) f,
  ]..sort((a, b) => (a.raw['slide'] as String).compareTo(b.raw['slide'] as String));
  final rest =
      [
        for (final f in frames)
          if (f.raw['slide'] is! String) f,
      ]..sort((a, b) {
        // same row when the tops are close (half the smaller height)
        final row = (a.y - b.y).abs() < math.min(a.h, b.h) / 2;
        if (!row) return a.y.compareTo(b.y);
        return a.x.compareTo(b.x);
      });
  return [...slides, ...rest];
}

/// Objects lying completely inside [frame] (they move with it, like the web's `movableSet`): not other frames,
/// connectors or locked ones.
Iterable<BoardObject> frameContents(BoardObject frame, Iterable<BoardObject> objects) {
  final r = Rect.fromLTWH(frame.x, frame.y, frame.w, frame.h);
  return objects.where((c) {
    if (c.id == frame.id || c.type == 'frame' || c.type == 'connector' || c.locked) return false;
    final b = objectRect(c);
    // inclusive like the web's `contains` (an object flush with the frame's right/bottom edge belongs to it)
    return b.left >= r.left && b.top >= r.top && b.right <= r.right && b.bottom <= r.bottom;
  });
}

/// Images like the web (`imageSize`): large ones capped at 520 px, tiny ones raised to 120 px, aspect kept.
Size boardImageSize(double width, double height) {
  final longest = math.max(1.0, math.max(width, height));
  final scale = math.max(120 / longest, math.min(1.0, 520 / longest));
  return Size(math.max(1, (width * scale).roundToDouble()), math.max(1, (height * scale).roundToDouble()));
}

/// A free spot for a [size] box near world point [center] (spiral outward, 40 px gaps): nothing but frames below it.
Offset freeSpot(BoardScene scene, Offset center, Size size) {
  bool free(Rect r) => !scene.grid.query(r).any((id) {
    final o = scene.state[id];
    return o != null && o.type != 'frame' && isVisibleObject(o) && objectRect(o).overlaps(r);
  });
  Rect at(double dx, double dy) =>
      Rect.fromCenter(center: center + Offset(dx, dy), width: size.width, height: size.height);
  if (free(at(0, 0))) return at(0, 0).topLeft;
  // rings of candidates in steps of a quarter of the box (at least 40): the nearest free one of the first ring with any
  final step = math.max(40.0, math.min(size.width, size.height) / 4);
  for (var ring = 1; ring <= 60; ring++) {
    Rect? best;
    var bestD = double.infinity;
    for (var i = -ring; i <= ring; i++) {
      for (final (dx, dy) in [(i, -ring), (i, ring), (-ring, i), (ring, i)]) {
        final r = at(dx * step, dy * step);
        final d = (r.center - center).distance;
        if (d < bestD && free(r)) {
          bestD = d;
          best = r;
        }
      }
    }
    if (best != null) return best.topLeft;
  }
  return at(0, 0).topLeft;
}

/// E3 editing on top of the core (`BoardEditor` mixes this in): connectors (tool, plus/anchor handles, ends),
/// pen/highlighter/eraser, frames, images, comments and reactions – all as ops through [controller].
mixin BoardEditorTools on ChangeNotifier {
  BoardController get controller;
  BoardScene get scene;
  CameraController get camera;
  ValueNotifier<Set<String>> get selection;
  bool get editable;
  void select(Set<String> ids);
  VoidCallback? get onHaptic;

  /// Comments can be written now ([BoardController.canComment]: also with the role `comment`; for `edit`/`owner`
  /// the same as [editable]).
  bool get commentable => controller.canComment;

  /// What is being drawn (connector, pen stroke, eraser); the view paints it.
  final draft = ValueNotifier<BoardDraft?>(null);

  /// Line style for new connectors (null = automatic: curved between two objects, else straight, like the web).
  String? connectorStyle;

  /// Cap at the end of new connectors (web tool option `cap`, default triangle).
  String connectorCap = 'triangle';

  /// Pen: color and width; highlighter ([penMarker]) its own color and width; eraser size (screen px).
  String penColor = penColors.first;
  double penWidth = 4;
  bool penMarker = false;
  String markerColor = markerColors.first;
  double markerWidth = 20;
  double eraserSize = eraserSizes[1];

  /// A stylus was used: from now on only it draws, fingers pan (palm rejection, concept §3.3).
  bool stylusSeen = false;

  // ---- connectors ---------------------------------------------------------------------------------------------------

  /// A new connector between [from] and [to] (web `connectorGesture` with the shapes module's `connectorFields`): black,
  /// 2 px, the tool's cap at the end, line style from the tool or automatic. Returns its ID.
  String? connect(EndDrop from, EndDrop to) {
    if (!editable) return null;
    if (from.objectId != null && from.objectId == to.objectId) return null;
    final id = BoardController.newId();
    final style = connectorStyle ?? (from.attached && to.attached ? 'curved' : null);
    controller.apply([
      CreateOp([
        {
          'id': id,
          'type': 'connector',
          ...boxOf(from.point, to.point),
          'from': from.toJson(),
          'to': to.toJson(),
          'color': '#0a0a0a',
          'strokeWidth': 2,
          for (final e in capPatch('end', connectorCap).entries)
            if (e.value != null) e.key: e.value,
          if (style != null && style != 'straight') 'lineStyle': style,
        },
      ]),
    ]);
    select({id});
    return id;
  }

  Offset? _dragA;
  EndDrop? _dragFrom;
  BoardObject? _dragPlus;

  /// Connector tool: drag starts at [p] (docked to the object there, without a side like the web). [viaPlus]: dragged
  /// from the plus handle of [from] – dropped on the empty board it makes a copy there, the preview shows it.
  void connectorDragStart(Offset world, {BoardObject? from, String? side, bool viaPlus = false}) {
    if (from != null && side != null) {
      final (pt, _) = sidePoint(from, side);
      _dragFrom = EndDrop(pt, objectId: from.id, side: side);
    } else if (from != null) {
      _dragFrom = EndDrop(Offset(from.x + from.w / 2, from.y + from.h / 2), objectId: from.id);
    } else {
      final hit = scene.hitTest(world, camera.value.z);
      _dragFrom = hit != null && connectable(hit)
          ? EndDrop(Offset(hit.x + hit.w / 2, hit.y + hit.h / 2), objectId: hit.id)
          : EndDrop(world);
    }
    _dragA = world;
    _dragPlus = viaPlus ? from : null;
    draft.value = ConnectorDraft(_dragFrom!.side != null ? _dragFrom!.point : world, world);
  }

  /// Line style a new connector between [from] and [to] gets (web `newLineStyle`): the tool's, else curved between
  /// two objects, else straight.
  String newLineStyle(EndDrop from, bool toAttached) =>
      connectorStyle ?? (from.attached && toAttached ? 'curved' : 'straight');

  void connectorDragUpdate(Offset world) {
    final from = _dragFrom;
    if (from == null) return;
    final z = camera.value.z;
    final plus = _dragPlus;
    final drop = dropEnd(scene, world, z, exclude: from.objectId, noFrames: plus != null);
    final target = drop.objectId == null ? null : controller.state[drop.objectId!];
    final a = from.side != null
        ? from.point
        : (from.objectId != null ? boundaryPoint(controller.state[from.objectId!]!, world) : from.point);
    // web preview: the real route; at the plus into the void the ghost copy the drop will create
    BoardObject? ghost;
    var to = drop.toJson();
    if (plus != null && !drop.attached) {
      ghost = BoardObject({
        ...plus.raw,
        'id': ghostId,
        'x': (world.dx - plus.w / 2).roundToDouble(),
        'y': (world.dy - plus.h / 2).roundToDouble(),
      });
      to = {'objectId': ghostId, 'side': nearestSide(ghost, Offset(plus.x + plus.w / 2, plus.y + plus.h / 2))};
    }
    final style = newLineStyle(from, to.containsKey('objectId'));
    final route = connectorGeometry(
      BoardObject({'id': '__draft__', 'type': 'connector', 'from': from.toJson(), 'to': to, 'lineStyle': style}),
      (id) => id == ghostId ? ghost : controller.state[id],
    );
    var near = nearAnchorables(scene, world, z, skip: from.objectId);
    if (target != null && target.type != 'frame' && !near.any((o) => o.id == target.id)) near = [...near, target];
    draft.value = ConnectorDraft(
      a,
      world,
      anchorsOf: target,
      snapped: drop.side != null ? drop.point : null,
      route: route,
      cap: connectorCap,
      near: near,
      ghost: ghost,
    );
  }

  /// Id of the preview copy at a plus handle's free end.
  static const ghostId = '__shapes_ghost__';

  /// Ends the drag at [world]: docked or free end; a short drag into the void creates nothing ([moved] false).
  /// [onEmpty]: what happens when dropped on the empty board (plus handle: a copy of the shape there).
  String? connectorDragEnd(Offset world, {required bool moved, String? Function(EndDrop from, Offset at)? onEmpty}) {
    final from = _dragFrom;
    final plus = _dragPlus != null;
    _dragFrom = null;
    _dragA = null;
    _dragPlus = null;
    draft.value = null;
    if (from == null || !moved) return null;
    final drop = dropEnd(scene, world, camera.value.z, exclude: from.objectId, noFrames: plus);
    if (!drop.attached && onEmpty != null) return onEmpty(from, world);
    return connect(from, drop);
  }

  void connectorDragCancel() {
    _dragFrom = null;
    _dragA = null;
    _dragPlus = null;
    draft.value = null;
  }

  /// Start point of the running connector drag (null = none).
  Offset? get connectorDragOrigin => _dragA;

  String _endKey = '';

  /// Dragging an end of the selected connector ([which] `from`/`to`) to [world]: docks live (anchor snap), one undo
  /// step for the whole drag.
  void connectorEndDrag(BoardObject c, String which, Offset world, {bool end = false}) {
    if (!editable || c.locked) return;
    if (_endKey.isEmpty) _endKey = 'end${BoardController.nextReq()}';
    final otherEnd = which == 'from' ? c.to : c.from;
    final drop = dropEnd(
      scene,
      world,
      camera.value.z,
      self: c.id,
      exclude: otherEnd is AttachedEnd ? otherEnd.objectId : null,
    );
    final g = scene.connector(c.id);
    final other =
        (g == null ? null : (which == 'from' ? g.b : g.a)) ??
        endAnchor(otherEnd, (id) => controller.state[id]) ??
        world;
    final target = drop.objectId == null ? null : controller.state[drop.objectId!];
    // web `EndDrag`: the target outlined and the anchor points nearby, no extra line (the connector itself follows)
    final skip = otherEnd is AttachedEnd ? otherEnd.objectId : null;
    var near = [
      for (final o in nearAnchorables(scene, world, camera.value.z))
        if (o.id != skip) o,
    ];
    if (target != null && target.type != 'frame' && !near.any((o) => o.id == target.id)) near = [...near, target];
    draft.value = end
        ? null
        : ConnectorDraft(
            other,
            world,
            anchorsOf: target,
            snapped: drop.side != null ? drop.point : null,
            near: near,
            line: false,
          );
    controller.apply(
      [
        UpdateOp({
          c.id: {which: drop.toJson(), ...boxOf(other, drop.point)},
        }),
      ],
      step: end,
      coalesce: _endKey,
    );
    if (end) _endKey = '';
  }

  /// Sets a field on all selected connectors.
  void setConnectorFields(Map<String, Object?> patch) {
    if (!editable) return;
    final patches = <String, Map<String, Object?>>{
      for (final id in selection.value)
        if (controller.state[id] case final o? when o.type == 'connector' && !o.locked) id: patch,
    };
    if (patches.isNotEmpty) controller.apply([UpdateOp(patches)]);
  }

  void reverseConnectors() {
    if (!editable) return;
    final patches = <String, Map<String, Object?>>{
      for (final id in selection.value)
        if (controller.state[id] case final o? when o.type == 'connector' && !o.locked) id: reversePatch(o),
    };
    if (patches.isNotEmpty) controller.apply([UpdateOp(patches)]);
  }

  /// Label of a connector (rich text: marks of the old label stay where the text stays).
  void setLabel(BoardObject c, String text) {
    if (!editable || c.locked) return;
    final doc = RichEditDoc.forObject(c.raw['content'], c.text);
    final base = doc.toJson();
    if (!doc.setText(text)) return;
    final next = doc.toJson();
    if (controller.features.contains('text')) {
      controller.apply([
        TextOp(c.id, controller.confirmed.rev, next, epoch: controller.confirmed.epoch, baseDoc: base),
      ]);
    } else {
      controller.apply([
        UpdateOp({
          c.id: {'content': next, 'text': pmPlainText(next)},
        }),
      ]);
    }
  }

  // ---- pen, highlighter, eraser ---------------------------------------------------------------------------------

  final _stroke = <Offset>[];

  void penStart(Offset world) {
    _stroke
      ..clear()
      ..add(world);
    draft.value = PenDraft(
      [world],
      color: penMarker ? markerColor : penColor,
      width: penMarker ? markerWidth : penWidth,
      marker: penMarker,
    );
  }

  void penUpdate(Offset world) {
    if (_stroke.isEmpty) return;
    if ((world - _stroke.last).distance * camera.value.z < 2) return;
    _stroke.add(world);
    draft.value = PenDraft(
      List.unmodifiable(_stroke),
      color: penMarker ? markerColor : penColor,
      width: penMarker ? markerWidth : penWidth,
      marker: penMarker,
    );
  }

  /// Ends the stroke: simplified and stored as a pen object (a dot for a tap). Returns its ID.
  String? penEnd() {
    final pts = simplifyStroke(_stroke, 0.6 / camera.value.z);
    _stroke.clear();
    draft.value = null;
    if (pts.isEmpty || !editable) return null;
    final width = penMarker ? markerWidth : penWidth;
    final id = BoardController.newId();
    controller.apply([
      CreateOp([
        {
          'id': id,
          'type': 'pen',
          ...penFromPoints(pts.length == 1 ? [pts.first, pts.first + const Offset(0.5, 0)] : pts, width),
          'color': penMarker ? markerColor : penColor,
          'strokeWidth': width,
          if (penMarker) 'marker': true,
        },
      ]),
    ]);
    return id;
  }

  void penCancel() {
    _stroke.clear();
    draft.value = null;
  }

  final _erased = <String>{};
  Offset? _eraseLast;

  /// Eraser at [world]: collects the pen strokes it sweeps over (steps in between so fast moves skip nothing).
  void eraseAt(Offset world) {
    final rad = eraserSize / 2 / camera.value.z;
    final last = _eraseLast ?? world;
    final steps = math.max(1, ((world - last).distance / math.max(1, rad)).ceil());
    for (var i = 1; i <= steps; i++) {
      final q = Offset.lerp(last, world, i / steps)!;
      for (final id in scene.grid.query(Rect.fromCircle(center: q, radius: rad + 20))) {
        final o = controller.state[id];
        if (o != null && o.type == 'pen' && !o.locked && !_erased.contains(id) && penHit(o, q, rad)) _erased.add(id);
      }
    }
    _eraseLast = world;
    draft.value = EraserDraft(world, rad, Set.unmodifiable(_erased));
  }

  /// Removes what the eraser swept over (one undo step). Returns how many strokes.
  int eraseEnd() {
    final ids = [..._erased];
    _erased.clear();
    _eraseLast = null;
    draft.value = null;
    if (ids.isEmpty || !editable) return 0;
    controller.apply([RemoveOp(ids)]);
    return ids.length;
  }

  void eraseCancel() {
    _erased.clear();
    _eraseLast = null;
    draft.value = null;
  }

  // ---- frames ------------------------------------------------------------------------------------------------------

  /// A new frame centered at [p] („Rahmen n“, white, 640 × 420 like the web). Returns its ID.
  String? createFrame(Offset p) {
    if (!editable) return null;
    final n = controller.state.objects.values.where((o) => o.type == 'frame').length + 1;
    final id = BoardController.newId();
    controller.apply([
      CreateOp([
        {
          'id': id,
          'type': 'frame',
          'x': (p.dx - frameSize.width / 2).roundToDouble(),
          'y': (p.dy - frameSize.height / 2).roundToDouble(),
          'w': frameSize.width,
          'h': frameSize.height,
          'title': 'Rahmen $n',
          'color': '#ffffff',
        },
      ]),
    ]);
    select({id});
    return id;
  }

  void renameFrame(String id, String title) {
    final o = controller.state[id];
    if (!editable || o == null || o.type != 'frame' || o.locked) return;
    final t = title.replaceAll(RegExp(r'\s+'), ' ').trim();
    if (t == (o.title ?? '')) return;
    controller.apply([
      UpdateOp({
        id: {'title': t.isEmpty ? null : t},
      }),
    ]);
  }

  /// Frames for the frame list.
  List<BoardObject> get frames => framesInOrder(controller.state.objects.values);

  // ---- images ------------------------------------------------------------------------------------------------------

  /// An uploaded image ([imageId], pixel size [width]×[height], average [color]) with its top left at [topLeft] (or
  /// centered at a free spot near [center]). Returns its ID.
  String? insertImage({
    required String imageId,
    required double width,
    required double height,
    String? color,
    Offset? topLeft,
    Offset? center,
  }) {
    if (!editable) return null;
    final size = boardImageSize(width, height);
    final at = topLeft ?? freeSpot(scene, center ?? Offset.zero, size);
    final id = BoardController.newId();
    controller.apply([
      CreateOp([
        {
          'id': id,
          'type': 'image',
          'x': at.dx.roundToDouble(),
          'y': at.dy.roundToDouble(),
          'w': size.width,
          'h': size.height,
          'imageId': imageId,
          'color': ?color,
        },
      ]),
    ]);
    select({id});
    return id;
  }

  // ---- comments, reactions ----------------------------------------------------------------------------------------

  /// Threads on the board (from `ext`, own pending ones included).
  List<CommentThread> get threads => readThreads(controller.state.ext[commentsExt]);

  /// Everyone known for @mentions: [people] (from the server) plus those on the board and comment authors.
  List<Person> mentionPeople(List<Person> people) {
    final out = <String, Person>{for (final p in people) p.key: p};
    for (final p in controller.peers) {
      out.putIfAbsent(p.key, () => Person(p.key, p.name));
    }
    for (final t in threads) {
      for (final m in t.messages) {
        out.putIfAbsent(m.by, () => Person(m.by, m.name));
      }
    }
    final me = controller.user?.key;
    return [
      for (final p in out.values)
        if (p.key != me && p.name.trim().isNotEmpty) p,
    ]..sort((a, b) => a.name.compareTo(b.name));
  }

  /// New thread at [at] with the first message. Returns its ID.
  String? addComment(CommentAnchor at, String text, List<Person> people) {
    final t = text.trim();
    if (t.isEmpty || !commentable) return null;
    final id = BoardController.newId();
    controller.apply([CommentOp(id, BoardController.newId(), at, t, mentions: extractMentions(t, people))]);
    return id;
  }

  void replyComment(String thread, String text, List<Person> people) {
    final t = text.trim();
    if (t.isEmpty || !commentable) return;
    controller.apply([ReplyOp(thread, BoardController.newId(), t, mentions: extractMentions(t, people))]);
  }

  void editComment(String thread, String msg, String text, List<Person> people) {
    final t = text.trim();
    if (t.isEmpty || !commentable) return;
    controller.apply([CommentEditOp(thread, msg, t, mentions: extractMentions(t, people))]);
  }

  /// Deletes a message; the first message (or none given) deletes the whole thread.
  void deleteComment(String thread, [String? msg]) {
    if (commentable) controller.apply([CommentDeleteOp(thread, msg)]);
  }

  void resolveComment(String thread, {required bool resolved}) {
    if (commentable) controller.apply([ResolveOp(thread, resolved: resolved)]);
  }

  /// Mentions of me are read (the web shows „Du wurdest erwähnt“ until then).
  void markMentionsRead() {
    if (controller.canComment) controller.apply([const MentionsReadOp()], step: false);
  }

  /// Toggles own reaction [emoji] on [ids] like the web: all have it → off, else on where missing.
  void toggleReaction(List<String> ids, String emoji) {
    if (!editable || ids.isEmpty) return;
    final me = controller.user?.key ?? '';
    final raw = controller.state.ext[reactionsExt];
    final has = raw is Map ? raw : const {};
    final all = ids.every((o) => has.containsKey('$o|$emoji|$me'));
    controller.apply([ReactOp(ids, emoji, on: !all)]);
    onHaptic?.call();
  }
}

/// Paints the editor's [BoardDraft] (screen space over the board): connector line with the target's anchor points,
/// pen stroke, eraser circle with the strokes it will remove.
class DraftPainter extends CustomPainter {
  DraftPainter({required this.draft, required this.camera, required this.lookup})
    : super(repaint: Listenable.merge([draft, camera]));

  final ValueListenable<BoardDraft?> draft;
  final ValueListenable<Camera> camera;
  final BoardObject? Function(String id) lookup;

  static const _blue = Color(0xFF1763B5);
  static const _pink = Color(0xFFEC4E92);

  @override
  void paint(Canvas canvas, Size size) {
    final d = draft.value;
    if (d == null) return;
    final cam = camera.value;
    switch (d) {
      case ConnectorDraft():
        _connector(canvas, cam, d);
      case PenDraft(:final points, :final color, :final width, :final marker):
        if (points.isEmpty) return;
        final path = Path()..moveTo(cam.toScreen(points.first).dx, cam.toScreen(points.first).dy);
        for (final p in points.skip(1)) {
          final s = cam.toScreen(p);
          path.lineTo(s.dx, s.dy);
        }
        if (points.length == 1) path.relativeLineTo(0.01, 0);
        final c = Color(int.parse('FF${color.substring(1)}', radix: 16));
        canvas.drawPath(
          path,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeCap = StrokeCap.round
            ..strokeJoin = StrokeJoin.round
            ..strokeWidth = width * cam.z
            ..color = marker ? c.withValues(alpha: 0.45) : c,
        );
      case EraserDraft(:final at, :final radius, :final hit):
        final mark = Paint()
          ..style = PaintingStyle.stroke
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round
          ..color = _pink.withValues(alpha: 0.55);
        for (final id in hit) {
          final o = lookup(id);
          if (o == null || o.points.length < 2) continue;
          final pts = o.points;
          final path = Path();
          for (var i = 0; i + 1 < pts.length; i += 2) {
            final s = cam.toScreen(Offset(o.x + pts[i], o.y + pts[i + 1]));
            if (i == 0) {
              path.moveTo(s.dx, s.dy);
            } else {
              path.lineTo(s.dx, s.dy);
            }
          }
          canvas.drawPath(path, mark..strokeWidth = (o.strokeWidth ?? 2) * cam.z + 4);
        }
        final c = cam.toScreen(at);
        canvas.drawCircle(c, radius * cam.z, Paint()..color = const Color(0x99FFFFFF));
        canvas.drawCircle(
          c,
          radius * cam.z,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1
            ..color = const Color(0xFF0A0A0A),
        );
    }
  }

  /// Connector preview like the web's `connectGesture` (shapes.css `.shapes-draft`): the target outlined (hover),
  /// ghost copy dashed with a light blue fill, anchor dots (white with blue ring, the snapped one filled, 5/7 px), the
  /// route in blue 2 px with the cap at the end – all in world units scaled like the web's `2 / z`.
  void _connector(Canvas canvas, Camera cam, ConnectorDraft d) {
    final z = cam.z;
    final stroke = Paint()
      ..color = _blue
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final target = d.anchorsOf;
    if (target != null) {
      canvas.drawRRect(
        RRect.fromRectAndRadius(cam.rectToScreen(objectRect(target)).inflate(4), const Radius.circular(6)),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..color = _blue.withValues(alpha: 0.55),
      );
    }
    canvas.save();
    canvas.translate(cam.x, cam.y);
    canvas.scale(z);
    final ghost = d.ghost;
    if (ghost != null) {
      final path = parseSvgPath(
        shapePathData(ghost.type == 'shape' ? (ghost.shape ?? 'rect') : 'rect', ghost.w, ghost.h, 0),
      ).shift(Offset(ghost.x, ghost.y));
      canvas.drawPath(path, Paint()..color = const Color(0x0F1763B5));
      canvas.drawPath(
        dashPath(path, [6 / z, 4 / z]),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5 / z
          ..color = _blue,
      );
    }
    for (final o in d.near) {
      for (final side in const ['n', 'e', 's', 'w']) {
        final at = sidePoint(o, side).$1;
        final on = d.snapped != null && (d.snapped! - at).distance < 0.5;
        canvas.drawCircle(at, (on ? 7 : 5) / z, Paint()..color = on ? _blue : const Color(0xFFFFFFFF));
        canvas.drawCircle(
          at,
          (on ? 7 : 5) / z,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 2 / z
            ..color = on ? const Color(0xFFFFFFFF) : _blue,
        );
      }
    }
    final g = d.route;
    if (d.line && g != null) {
      canvas.drawPath(connectorPath(g), stroke..strokeWidth = 2 / z);
      // web `CapMark` in blue: filled = stroke 1, open shapes white inside, lines max(1.5, sw)
      final cap = d.cap == 'none' ? 'triangle' : d.cap;
      final head = capShape(cap, g.b, g.dirB, 2 / z);
      if (head != null) {
        final closedOpen = const {'triangleOpen', 'circleOpen', 'diamondOpen'}.contains(cap);
        if (head.filled || closedOpen) {
          canvas.drawPath(head.path, Paint()..color = head.filled ? _blue : const Color(0xFFFFFFFF));
        }
        canvas.drawPath(head.path, stroke..strokeWidth = head.filled ? 1 : math.max(1.5, 2 / z));
      }
    }
    canvas.restore();
    if (d.line && g == null) {
      canvas.drawLine(cam.toScreen(d.a), cam.toScreen(d.b), stroke..strokeWidth = 2);
      canvas.drawCircle(cam.toScreen(d.b), 4, Paint()..color = _blue);
    }
  }

  @override
  bool shouldRepaint(covariant DraftPainter old) => !identical(old, this);
}
