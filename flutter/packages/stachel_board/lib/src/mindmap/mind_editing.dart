import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart' show TextPainter;

import '../editor/camera.dart';
import '../model/board_object.dart';
import '../model/board_source.dart';
import '../protocol/native_messages.dart';
import '../render/board_scene.dart';
import 'mind_model.dart';
import 'mind_plan.dart';
import 'mind_render.dart';

/// A button at a mind node (web `MindControls`), in screen space: `add` (+, new subtopic on [side]) or `toggle`
/// (collapse „−“ / expand with the number of hidden topics).
class MindButton {
  const MindButton({
    required this.nodeId,
    required this.kind,
    required this.side,
    required this.at,
    required this.color,
    this.count = 0,
    this.collapsed = false,
  });

  final String nodeId;

  /// `add` or `toggle`.
  final String kind;
  final String side;
  final Offset at;
  final String color;

  /// Hidden topics of a collapsed branch (shown on the toggle).
  final int count;
  final bool collapsed;

  /// Handle ID for the gesture machine (`mind-add-r|<id>`, `mind-toggle|<id>`).
  String get handle => kind == 'add' ? 'mind-add-$side|$nodeId' : 'mind-toggle|$nodeId';

  /// Radius on screen (drawn; touches count a bit further, [mindButtonTouch]).
  double get radius => kind == 'add' ? 13 : 12;
}

/// Touch radius of mind buttons (screen px).
const mindButtonTouch = 22.0;

/// Mind map editing of the board editor (like the web's `structure/mindmap/mindmap.tsx`): plus buttons and context
/// actions for subtopic / same level, collapse with count, writing (Enter = same level), delete with subtopics,
/// dragging = reparent/sort in, a root takes its map along, new map and template. Everything goes out as the `mind`
/// op (contract §8.6) – the server runs the web's code – with the app's prediction ([MindPlanner]) shown at once;
/// a server without the feature gets the predicted plain ops.
mixin BoardEditorMind on ChangeNotifier {
  BoardController get controller;
  BoardScene get scene;
  CameraController get camera;
  ValueNotifier<Set<String>> get selection;
  bool get editable;
  String? get editingId;
  void select(Set<String> ids);
  bool startEditing(String id);
  void stopEditing({Size? measured});

  /// Mind map tool: what a tap puts there (null = an empty map to write in, else this template).
  MindTreeSpec? mindTemplate;

  /// Nodes created here and not written in yet: left empty they go away again (web: like never created).
  final _fresh = <String, bool>{};

  bool get _serverMind => controller.features.contains('mind');

  /// Sends a mind op (with [before] in the same message) or, without the feature, the predicted result.
  void _sendMind(
    MindPlanner plan,
    Map<String, Object?> json, {
    List<BoardOp> before = const [],
    bool step = true,
    String? coalesce,
    Map<String, Map<String, Object?>>? base,
  }) {
    if (_serverMind) {
      controller.apply(
        [...before, plan.op(json, base: base)],
        step: step,
        coalesce: coalesce,
      );
    } else {
      final ops = plan.diff(base: base);
      if (ops.isNotEmpty) controller.apply(ops, step: step, coalesce: coalesce);
    }
  }

  BoardObject? _node(String id) {
    final o = controller.state[id];
    return o != null && o.type == 'mindnode' ? o : null;
  }

  /// Is [id] the root of its map?
  bool isMindRootNode(String id) {
    final o = _node(id);
    if (o == null) return false;
    final byId = {
      for (final x in controller.state.ordered)
        if (x.type == 'mindnode') x.id: x.raw,
    };
    return isMindRoot(byId, o.raw);
  }

  /// Children of a node (also hidden ones).
  List<String> mindChildren(String id) {
    final nodes = [
      for (final x in controller.state.ordered)
        if (x.type == 'mindnode') x.raw,
    ];
    return [for (final k in mindChildrenOf(nodes, id)) rid(k)];
  }

  /// Topics below [ids] (without them), for „delete with n subtopics?“.
  int mindDescendantCount(Iterable<String> ids) {
    final plan = MindPlanner(controller.state);
    final mind = [
      for (final id in ids)
        if (_node(id) != null) id,
    ];
    return plan.withDescendants(mind).length - mind.toSet().length;
  }

  /// New subtopic of [id] (plus button, „Unterthema“), selected and in writing. Returns its ID.
  String? mindChild(String id, {String? side}) {
    if (!editable || _node(id) == null || _node(id)!.locked) return null;
    // typed text is its own step (web: ends writing first)
    if (editingId != null) controller.closeStep();
    final nid = BoardController.newId();
    final plan = MindPlanner(controller.state);
    if (!plan.child(id, nid, side: side)) return null;
    _sendMind(plan, {'do': 'child', 'id': id, 'new': nid, 'side': ?side});
    _startFresh(nid);
    return nid;
  }

  /// New topic on the same level below [id] („Gleiche Ebene“, Enter); null at the root.
  String? mindSibling(String id) {
    if (!editable || _node(id) == null || _node(id)!.locked) return null;
    if (editingId != null) controller.closeStep();
    final nid = BoardController.newId();
    final plan = MindPlanner(controller.state);
    if (!plan.sibling(id, nid)) return null;
    _sendMind(plan, {'do': 'sibling', 'id': id, 'new': nid});
    _startFresh(nid);
    return nid;
  }

  /// New mind map at world point [p] (root centered there), from [template] or empty (then in writing).
  String? createMindMap(Offset p, {MindTreeSpec? template}) {
    if (!editable) return null;
    final nid = BoardController.newId();
    final plan = MindPlanner(controller.state);
    final x = p.dx.roundToDouble(), y = p.dy.roundToDouble();
    if (template != null) {
      plan.tree(nid, x, y, template);
      _sendMind(plan, {'do': 'tree', 'new': nid, 'x': x, 'y': y, 'tree': template.toJson()});
      select({nid});
    } else {
      plan.root(nid, x, y);
      _sendMind(plan, {'do': 'root', 'new': nid, 'x': x, 'y': y, 'text': ''});
      _startFresh(nid);
    }
    return nid;
  }

  void _startFresh(String id) {
    _fresh[id] = true;
    select({id});
    startEditing(id);
  }

  /// Collapses or expands the branch of [id].
  void mindCollapse(String id, bool collapsed) {
    if (!editable || _node(id) == null) return;
    final plan = MindPlanner(controller.state)..collapse(id, collapsed);
    _sendMind(plan, {'do': 'collapse', 'id': id, 'collapsed': collapsed});
    // hidden nodes do not stay selected (web)
    final keep = {
      for (final s in selection.value)
        if (!(controller.state[s]?.mind.hidden ?? false)) s,
    };
    if (keep.length != selection.value.length) select(keep);
  }

  /// Typed text of a node (while writing): shown at once with the new layout, sent at most every 66 ms.
  void mindText(String id, String text) {
    if (_node(id) == null) return;
    _fresh[id] = false;
    final plan = MindPlanner(controller.state)..text(id, text);
    final base = {
      for (final o in controller.confirmed.objects.values)
        if (o.type == 'mindnode') o.id: o.raw,
    };
    _sendMind(plan, {'do': 'text', 'id': id, 'text': text}, step: false, coalesce: 'mindtext-$id', base: base);
  }

  /// Writing in node [id] ended. A new node left empty (and without subtopics) goes away again (web: like never
  /// created; here removed in its own step – undoing the creation could hit a later step).
  void mindEditDone(String id) {
    final fresh = _fresh.remove(id);
    final o = _node(id);
    controller.closeStep();
    if (o == null || o.text.trim().isNotEmpty || fresh == null || mindChildren(id).isNotEmpty) return;
    mindRemove([id]);
    final p = o.mind.parent;
    select(p != null && controller.state[p] != null ? {p} : const {});
  }

  /// Enter while writing in a mind node (web): ends writing and starts a topic on the same level – at the root, or
  /// in a new node still empty, only ends writing.
  void mindEnter() {
    final id = editingId;
    final o = id == null ? null : _node(id);
    if (o == null) return;
    if (isMindRootNode(id!) || (_fresh.containsKey(id) && o.text.trim().isEmpty)) {
      stopEditing();
    } else {
      mindSibling(id);
    }
  }

  /// Tab while writing (button „Unterthema“): a subtopic of the node being written in (an empty new node stays,
  /// it has a subtopic now).
  void mindTab() {
    final id = editingId;
    if (id != null && _node(id) != null) mindChild(id);
  }

  /// Deletes nodes with their subtopics (and lays out the rest); [others] (no mind nodes) go in the same step.
  void mindRemove(Iterable<String> ids, {List<String> others = const []}) {
    final plan = MindPlanner(controller.state)..remove(ids);
    if (_serverMind) {
      controller.apply([
        if (others.isNotEmpty) RemoveOp(others),
        plan.op({'do': 'remove', 'ids': ids.toList()}),
      ]);
    } else {
      controller.apply([if (others.isNotEmpty) RemoveOp(others), ...plan.diff()]);
    }
  }

  /// Copies of mind nodes like the web's `remap`: the parent is the copy of the parent, without a copied parent the
  /// node becomes a root. [copies] = new raw objects (already moved); returns the ops (create + layout).
  List<BoardOp> mindDuplicateOps(List<Map<String, Object?>> copies, Map<String, String> idMap) {
    final minds = <Map<String, Object?>>[];
    for (final c in copies) {
      if (c['type'] != 'mindnode') continue;
      final m = <String, Object?>{...?((c['mind'] is Map) ? (c['mind'] as Map).cast<String, Object?>() : null)};
      final parent = m['parent'] is String ? idMap[m['parent']] : null;
      if (parent == null) {
        m
          ..remove('parent')
          ..remove('side')
          ..remove('hidden')
          ..['level'] = 0;
      } else {
        m['parent'] = parent;
      }
      c['mind'] = m;
      minds.add(c);
    }
    if (minds.isEmpty) return [CreateOp(copies)];
    // the server lays out created nodes; the prediction starts from the copies as if created
    final plan = MindPlanner.fromRaw([
      for (final o in controller.state.ordered)
        if (o.type == 'mindnode') o.raw,
      ...minds,
    ]);
    final ids = [for (final c in minds) c['id'] as String];
    plan.layout(ids);
    return [
      CreateOp(copies),
      if (_serverMind) plan.op({'do': 'layout', 'ids': ids}) else ...plan.diff(),
    ];
  }

  /// Ops of a drag step of the selection ([patches] = new positions): a moved root takes its map along (layout),
  /// at the [end] dragged subtopics are hung in / sorted in (`drop`). Null = nothing mind map specific.
  List<BoardOp>? mindDragOps(Map<String, Map<String, Object?>> patches, {required bool end}) {
    final ids = [
      for (final id in patches.keys)
        if (_node(id) != null) id,
    ];
    if (ids.isEmpty) return null;
    final plan = MindPlanner(controller.state)..update(patches);
    final roots = [
      for (final id in ids)
        if (isMindRootNode(id)) id,
    ];
    // steps of a gesture replace each other while unsent: predict against the server's state, not the shown one
    final base = {
      for (final o in controller.confirmed.objects.values)
        if (o.type == 'mindnode') o.id: o.raw,
    };
    if (end) {
      plan.drop(ids);
      return [
        UpdateOp(patches),
        if (_serverMind) plan.op({'do': 'drop', 'ids': ids}, base: base) else ...plan.diff(base: base),
      ];
    }
    if (roots.isEmpty) return null;
    plan.layout(roots);
    return [
      UpdateOp(patches),
      if (_serverMind) plan.op({'do': 'layout', 'ids': roots}, base: base) else ...plan.diff(base: base),
    ];
  }

  // ---- buttons --------------------------------------------------------------------------------------------------

  /// Buttons at the nodes like the web: every collapsed node shows its count; the selected node (not locked, not
  /// being written in) shows „−“ (if it has subtopics) and „+“ – the root on both sides. Screen space.
  List<MindButton> mindButtons() {
    final nodes = [
      for (final o in controller.state.ordered)
        if (o.type == 'mindnode') o,
    ];
    if (nodes.isEmpty) return const [];
    final raws = [for (final o in nodes) o.raw];
    final byId = {for (final o in nodes) o.id: o.raw};
    final sel = selection.value.length == 1 ? selection.value.single : null;
    final cam = camera.value;
    final out = <MindButton>[];
    for (final n in nodes) {
      if (n.mind.hidden || n.hidden) continue;
      final kids = mindChildrenOf(raws, n.id);
      final isSel = editable && sel == n.id && !n.locked && editingId != n.id;
      final collapsed = n.mind.collapsed;
      if (kids.isEmpty && !isSel) continue;
      final root = isMindRoot(byId, n.raw);
      final sides = root ? (isSel ? const ['r', 'l'] : const ['r']) : [n.mind.side ?? 'r'];
      final color = n.color ?? mindColors.first;
      for (final side in sides) {
        final dir = side == 'r' ? 1.0 : -1.0;
        final edge = cam.toScreen(Offset(side == 'r' ? n.x + n.w : n.x, mindLevel(n) >= 2 ? n.y + n.h : n.y + n.h / 2));
        final sideKids = root
            ? [
                for (final k in kids)
                  if ((rside(k) ?? 'r') == side) k,
              ]
            : kids;
        var off = 18.0;
        // collapsed root: count only on the right; collapsed nodes on the left show it on their side
        if (sideKids.isNotEmpty && (collapsed || isSel) && (!root || side == 'r' || !collapsed)) {
          out.add(
            MindButton(
              nodeId: n.id,
              kind: 'toggle',
              side: side,
              at: edge + Offset(dir * off, 0),
              color: color,
              count: mindSubtree(raws, n.id).length - 1,
              collapsed: collapsed,
            ),
          );
          off += 32;
        }
        if (isSel && !collapsed) {
          out.add(
            MindButton(nodeId: n.id, kind: 'add', side: side, at: edge + Offset(dir * (off + 2), 0), color: color),
          );
        }
      }
    }
    return out;
  }

  /// Button at screen point [p] (only while editable).
  MindButton? mindButtonAt(Offset p) {
    if (!editable) return null;
    MindButton? best;
    var bestD = mindButtonTouch;
    for (final b in mindButtons()) {
      final d = (b.at - p).distance;
      if (d <= bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /// A mind button was tapped ([handle] from [MindButton.handle]); true if it was one.
  bool mindPress(String handle) {
    if (!handle.startsWith('mind-')) return false;
    final bar = handle.indexOf('|');
    final id = handle.substring(bar + 1);
    final kind = handle.substring(5, bar);
    if (kind == 'toggle') {
      final o = _node(id);
      if (o != null) mindCollapse(id, !o.mind.collapsed);
    } else if (kind.startsWith('add-')) {
      mindChild(id, side: isMindRootNode(id) ? kind.substring(4) : null);
    }
    return true;
  }
}

/// Paints the mind buttons (screen space) like the web's `.structure-mind-btn`: toggle white with colored ring and
/// „−“, collapsed filled with the count; plus in blue.
void paintMindButtons(
  Canvas c,
  List<MindButton> buttons, {
  required TextPainter Function(String text, Color color, double size) label,
}) {
  for (final b in buttons) {
    final color = parseHex(b.color);
    final shadow = Paint()
      ..color = const Color(0x2E000000)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3);
    if (b.kind == 'add') {
      c.drawCircle(b.at + const Offset(0, 2), b.radius, shadow);
      c.drawCircle(b.at, b.radius, Paint()..color = const Color(0xFF1763B5));
      final p = Paint()
        ..color = const Color(0xFFFFFFFF)
        ..strokeWidth = 2.4
        ..strokeCap = StrokeCap.round;
      c.drawLine(b.at - const Offset(5.5, 0), b.at + const Offset(5.5, 0), p);
      c.drawLine(b.at - const Offset(0, 5.5), b.at + const Offset(0, 5.5), p);
      continue;
    }
    final text = b.collapsed ? '${b.count}' : '−';
    final tp = label(text, b.collapsed ? const Color(0xFFFFFFFF) : color, b.collapsed ? 12 : 15);
    final w = math.max(b.radius * 2, tp.width + 12);
    final r = RRect.fromRectAndRadius(
      Rect.fromCenter(center: b.at, width: w, height: b.radius * 2),
      Radius.circular(b.radius),
    );
    c.drawRRect(r.shift(const Offset(0, 2)), shadow);
    c.drawRRect(r, Paint()..color = b.collapsed ? color : const Color(0xFFFFFFFF));
    if (!b.collapsed) {
      c.drawRRect(
        r.deflate(1),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..color = color,
      );
    }
    tp.paint(c, b.at - Offset(tp.width / 2, tp.height / 2));
  }
}

/// `#rrggbb` → color (ink if broken).
Color parseHex(String hex) {
  final v = int.tryParse(hex.length == 7 ? hex.substring(1) : '', radix: 16);
  return v == null ? const Color(0xFF0A0A0A) : Color(0xFF000000 | v);
}
