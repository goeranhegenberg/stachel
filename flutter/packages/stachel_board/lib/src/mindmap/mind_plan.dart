import 'dart:math' as math;

import '../model/board_object.dart';
import '../model/board_state.dart';
import '../protocol/native_messages.dart';
import 'mind_model.dart';

/// Tree of a new mind map (template, contract §8.6 `mind` `tree`): `side` only on main topics.
class MindTreeSpec {
  const MindTreeSpec(this.text, {this.side, this.children = const []});
  final String text;
  final String? side;
  final List<MindTreeSpec> children;

  Map<String, Object?> toJson() => {
    'text': text,
    if (side != null) 'side': side,
    if (children.isNotEmpty) 'children': [for (final c in children) c.toJson()],
  };

  static MindTreeSpec fromJson(Map<String, Object?> j) => MindTreeSpec(
    j['text'] as String? ?? '',
    side: j['side'] as String?,
    children: [for (final c in (j['children'] as List? ?? const [])) fromJson((c as Map).cast<String, Object?>())],
  );
}

/// Predicts what the server writes for mind map ops (contract §8.6 `mind`): runs the port of the web's `ops.ts` on a
/// working copy of the board's mind nodes, op after op like the server inside one message, and gives the result as
/// plain ops ([diff]) – shown at once until the server's patch arrives, or sent as such to a server without the
/// `mind` feature.
class MindPlanner {
  MindPlanner(BoardState state)
    : this.fromRaw([
        for (final o in state.ordered)
          if (o.type == 'mindnode') o.raw,
      ]);

  /// From raw mind nodes in paint order (bottom → top).
  MindPlanner.fromRaw(Iterable<Map<String, Object?>> nodes) {
    for (final o in nodes) {
      final copy = _deepCopy(o);
      _start[rid(copy)] = _deepCopy(o);
      _nodes.add(copy);
    }
  }

  final _start = <String, MindRaw>{};
  final _nodes = <MindRaw>[];

  /// Current mind nodes (bottom → top).
  List<MindRaw> get nodes => List.unmodifiable(_nodes);
  MindRaw? operator [](String id) => _byId[id];
  Map<String, MindRaw> get _byId => {for (final o in _nodes) rid(o): o};

  // ---- web ops.ts ---------------------------------------------------------------------------------------------------

  /// `commitMind`: change + layout of the touched maps as one write.
  void _commit({
    List<MindRaw> add = const [],
    Map<String, Map<String, Object?>> patch = const {},
    List<String> remove = const [],
  }) {
    final before = _byId;
    final removed = remove.toSet();
    final next = <MindRaw>[
      for (final o in _nodes)
        if (!removed.contains(rid(o))) patch[rid(o)] != null ? _merged(o, patch[rid(o)]!) : o,
      for (final a in add)
        if (a['type'] == 'mindnode') {'z': '', 'createdBy': '', 'updatedAt': '', ...a},
    ];
    final byId = {for (final o in next) rid(o): o};
    final roots = <String>{};
    for (final id in [...patch.keys, for (final a in add) rid(a)]) {
      if (byId.containsKey(id)) roots.add(mindRootOf(byId, id));
    }
    for (final id in remove) {
      final p = before[id] == null ? null : rparent(before[id]!);
      if (p != null && byId.containsKey(p)) roots.add(mindRootOf(byId, p));
    }
    final lay = mindLayoutPatches(next, roots);
    // write like the store: remove, create (on top), update
    _nodes.removeWhere((o) => removed.contains(rid(o)));
    final added = <String>{};
    for (final a in add) {
      if (_byId.containsKey(rid(a))) continue;
      _nodes.add({...a, ...?lay[rid(a)]});
      added.add(rid(a));
    }
    final patches = <String, Map<String, Object?>>{...patch};
    lay.forEach((id, p) {
      if (!added.contains(id)) patches[id] = {...?patches[id], ...p};
    });
    _update(patches);
  }

  /// Store `updateMany`: null removes a field; unknown IDs are skipped.
  void _update(Map<String, Map<String, Object?>> patches) {
    for (var i = 0; i < _nodes.length; i++) {
      final p = patches[rid(_nodes[i])];
      if (p != null) _nodes[i] = _merged(_nodes[i], p);
    }
  }

  static MindRaw _merged(MindRaw o, Map<String, Object?> p) {
    final out = <String, Object?>{...o};
    p.forEach((k, v) => v == null ? out.remove(k) : out[k] = v);
    return out;
  }

  /// Next free branch color of a root (web `branchColor`).
  String _branchColor(String rootId) {
    final used = [for (final k in mindChildrenOf(_nodes, rootId)) rcolor(k)];
    for (final c in mindColors) {
      if (!used.contains(c)) return c;
    }
    return mindColors[used.length % mindColors.length];
  }

  /// Subtopic [newId] at [id] (plus, Tab) – web `addChild`. False if [id] is missing or [newId] exists.
  bool child(String id, String newId, {String? side}) {
    final byId = _byId;
    final node = byId[id];
    if (!isMindRaw(node) || byId.containsKey(newId)) return false;
    final root = isMindRoot(byId, node!);
    final kids = mindChildrenOf(_nodes, id);
    final order = kids.isEmpty ? 0 : kids.map((k) => rorder(k) ?? 0).reduce(math.max) + 1;
    final s = mindSize('', root ? 1 : 2);
    final dir = (root ? side : rside(node)) == 'l' ? -1 : 1;
    final add = <String, Object?>{
      'id': newId,
      'type': 'mindnode',
      'x': jsRound(dir > 0 ? rx(node) + rw(node) + mindHGap : rx(node) - mindHGap - s.w),
      'y': ry(node),
      'w': s.w,
      'h': s.h,
      'text': '',
      'color': root ? _branchColor(id) : (rcolor(node) ?? mindColors.first),
      'mind': {'parent': id, 'order': order, if (root) 'side': side ?? 'r'},
    };
    final patch = rcollapsed(node)
        ? {
            id: {
              'mind': {...?rmind(node)}..remove('collapsed'),
            },
          }
        : const <String, Map<String, Object?>>{};
    _commit(add: [add], patch: patch);
    return true;
  }

  /// Topic below on the same level (Enter) – web `addSibling`; roots have none (false).
  bool sibling(String id, String newId) {
    final byId = _byId;
    final node = byId[id];
    if (!isMindRaw(node) || byId.containsKey(newId) || isMindRoot(byId, node!)) return false;
    final parent = byId[rparent(node)]!;
    final sibs = mindChildrenOf(_nodes, rid(parent));
    final i = sibs.indexWhere((k) => rid(k) == id);
    final a = rorder(node) ?? 0;
    final next = i + 1 < sibs.length ? rorder(sibs[i + 1]) : null;
    final order = next != null && next > a ? (a + next) / 2 : a + 1;
    final parentIsRoot = isMindRoot(byId, parent);
    final s = mindSize('', parentIsRoot ? 1 : 2);
    final add = <String, Object?>{
      'id': newId,
      'type': 'mindnode',
      'x': rx(node),
      'y': ry(node) + rh(node) + 16,
      'w': s.w,
      'h': s.h,
      'text': '',
      'color': parentIsRoot ? _branchColor(rid(parent)) : (rcolor(node) ?? mindColors.first),
      'mind': {'parent': rid(parent), 'order': order, if (parentIsRoot) 'side': rside(node) ?? 'r'},
    };
    _commit(add: [add]);
    return true;
  }

  /// New mind map: root centered at ([x], [y]) – web `newRoot` + layout.
  bool root(String newId, double x, double y, {String text = ''}) {
    if (_byId.containsKey(newId)) return false;
    final s = mindSize(text, 0);
    _commit(
      add: [
        {
          'id': newId,
          'type': 'mindnode',
          'x': jsRound(x - s.w / 2),
          'y': jsRound(y - s.h / 2),
          'w': s.w,
          'h': s.h,
          'text': text,
          'color': '#0a0a0a',
          'mind': {'level': 0},
        },
      ],
    );
    return true;
  }

  /// New mind map from a tree (template), root centered at ([x], [y]); subtopics get `$newId-1`, `-2` … (server
  /// `tree`, like the web's `TemplateBuilder.mind`).
  bool tree(String newId, double x, double y, MindTreeSpec spec) {
    final nodes = <MindRaw>[];
    var n = 0;
    void walk(MindTreeSpec s, String? parent, int level, String color, int order) {
      final id = parent != null ? '$newId-${++n}' : newId;
      final size = mindSize(s.text, level);
      nodes.add({
        'id': id,
        'type': 'mindnode',
        'x': 0.0,
        'y': 0.0,
        'w': size.w,
        'h': size.h,
        'z': '',
        'text': s.text,
        'color': color,
        'mind': {
          if (parent != null) ...{'parent': parent, 'order': order} else 'level': 0,
          if (level == 1) 'side': s.side ?? 'r',
        },
      });
      for (var i = 0; i < s.children.length; i++) {
        walk(s.children[i], id, level + 1, level == 0 ? mindColors[i % mindColors.length] : color, i);
      }
    }

    walk(spec, null, 0, '#0a0a0a', 0);
    final byId = _byId;
    if (nodes.any((o) => byId.containsKey(rid(o)))) return false;
    final first = nodes.first;
    final at = {'x': jsRound(x - rw(first) / 2), 'y': jsRound(y - rh(first) / 2)};
    final placed = [
      for (final o in nodes) <String, Object?>{...o, ...at},
    ];
    final lay = mindLayoutPatches(placed);
    for (final o in placed) {
      _nodes.add({...o, ...?lay[rid(o)]});
    }
    return true;
  }

  /// Sets the text and lays out again.
  void text(String id, String text) {
    if (isMindRaw(_byId[id])) {
      _commit(
        patch: {
          id: {'text': text},
        },
      );
    }
  }

  /// Collapses/expands a branch (target state) – web `toggleCollapse`.
  void collapse(String id, bool collapsed) {
    final o = _byId[id];
    if (!isMindRaw(o) || rcollapsed(o!) == collapsed) return;
    final mind = <String, Object?>{...?rmind(o)};
    if (collapsed) {
      mind['collapsed'] = true;
    } else {
      mind.remove('collapsed');
    }
    _commit(
      patch: {
        id: {'mind': mind},
      },
    );
  }

  /// Nodes with all descendants (web `withDescendants`, mind nodes only).
  List<String> withDescendants(Iterable<String> ids) {
    final byId = _byId;
    final out = <String>{};
    for (final id in ids) {
      if (isMindRaw(byId[id])) out.addAll(mindSubtree(_nodes, id));
    }
    return out.toList();
  }

  /// Deletes nodes with their subtopics, lays out the rest.
  void remove(Iterable<String> ids) {
    final live = [
      for (final id in ids.toSet())
        if (isMindRaw(_byId[id])) id,
    ];
    if (live.isNotEmpty) _commit(remove: withDescendants(live));
  }

  /// After dragging (web `dropNodes`): dropped on another node → hang it there (branch color of the new parent),
  /// else sort in among the siblings by height (or switch the root's side); then layout.
  void drop(Iterable<String> ids) {
    final live = [
      for (final id in ids.toSet())
        if (isMindRaw(_byId[id])) id,
    ];
    if (live.isEmpty) return;
    final byId = _byId;
    final nodes = List<MindRaw>.of(_nodes);
    final patch = <String, Map<String, Object?>>{};
    for (final id in live) {
      final o = byId[id]!;
      if (isMindRoot(byId, o)) continue;
      final cx = rx(o) + rw(o) / 2, cy = ry(o) + rh(o) / 2;
      final own = mindSubtree(nodes, id).toSet();
      MindRaw? target;
      for (final t in nodes.reversed) {
        if (!own.contains(rid(t)) &&
            !rhidden(t) &&
            cx >= rx(t) - 8 &&
            cx <= rx(t) + rw(t) + 8 &&
            cy >= ry(t) - 8 &&
            cy <= ry(t) + rh(t) + 8) {
          target = t;
          break;
        }
      }
      if (target != null && rid(target) != rparent(o)) {
        final kids = mindChildrenOf(nodes, rid(target));
        final toRoot = isMindRoot(byId, target);
        final mind = <String, Object?>{
          'parent': rid(target),
          'order': kids.isEmpty ? 0 : kids.map((k) => rorder(k) ?? 0).reduce(math.max) + 1,
        };
        if (toRoot) mind['side'] = cx < rx(target) + rw(target) / 2 ? 'l' : 'r';
        patch[id] = {'mind': mind};
        if (!toRoot) {
          for (final d in own) {
            patch[d] = {...?patch[d], 'color': rcolor(target)};
          }
        }
        continue;
      }
      final parent = byId[rparent(o) ?? ''];
      if (parent == null) continue;
      final mind = <String, Object?>{...?rmind(o)};
      if (isMindRoot(byId, parent)) mind['side'] = cx < rx(parent) + rw(parent) / 2 ? 'l' : 'r';
      final side = (mind['side'] as String?) ?? rside(o) ?? 'r';
      final sibs = [
        for (final k in mindChildrenOf(nodes, rid(parent)))
          if (rid(k) != id && (rside(k) ?? 'r') == side) k,
      ];
      final below = sibs.indexWhere((k) => ry(k) + rh(k) / 2 > cy);
      final prev = below < 0 ? (sibs.isEmpty ? null : sibs.last) : (below > 0 ? sibs[below - 1] : null);
      final next = below < 0 ? null : sibs[below];
      final a = prev == null ? null : rorder(prev), b = next == null ? null : rorder(next);
      mind['order'] = a == null ? (b == null ? 0 : b - 1) : (b == null ? a + 1 : (a + b) / 2);
      patch[id] = {'mind': mind};
    }
    _commit(patch: patch);
    layout(live);
  }

  /// Lays out the maps of these nodes again.
  void layout(Iterable<String> ids) {
    final live = [
      for (final id in ids.toSet())
        if (isMindRaw(_byId[id])) id,
    ];
    if (live.isNotEmpty) _commit(patch: {for (final id in live) id: const <String, Object?>{}});
  }

  /// A plain `update` as the server applies it, with the mind map rules for nodes (text, size, `mind` or a moved
  /// root → layout; a moved subtopic waits for `drop`).
  void update(Map<String, Map<String, Object?>> patches) {
    _update(patches);
    final byId = _byId;
    final relayout = <String>[];
    patches.forEach((id, p) {
      final o = byId[id];
      if (!isMindRaw(o)) return;
      final shape = p.keys.any((k) => k == 'text' || k == 'w' || k == 'h' || k == 'mind');
      final moved = p.containsKey('x') || p.containsKey('y');
      if (shape || (moved && isMindRoot(byId, o!))) relayout.add(id);
    });
    layout(relayout);
  }

  /// A plain `create` of mind nodes (duplicate): created on top, then laid out.
  void create(List<Map<String, Object?>> objects) {
    final byId = _byId;
    final ids = <String>[];
    for (final o in objects) {
      if (o['type'] != 'mindnode' || byId.containsKey(o['id'])) continue;
      _nodes.add(_deepCopy(o));
      ids.add(o['id'] as String);
    }
    layout(ids);
  }

  /// Applies one op as JSON (contract §8.6: `mind`, or `update`/`create`/`remove` touching mind nodes).
  void applyJson(Map<String, Object?> op) {
    List<String> ids() => [for (final x in op['ids'] as List) x as String];
    switch (op['op']) {
      case 'update':
        update({
          for (final e in (op['patches'] as Map).entries) e.key as String: (e.value as Map).cast<String, Object?>(),
        });
      case 'create':
        create([for (final o in op['objects'] as List) (o as Map).cast<String, Object?>()]);
      case 'remove':
        remove(ids());
      case 'mind':
        switch (op['do']) {
          case 'child':
            child(op['id'] as String, op['new'] as String, side: op['side'] as String?);
          case 'sibling':
            sibling(op['id'] as String, op['new'] as String);
          case 'root':
            root(
              op['new'] as String,
              (op['x'] as num).toDouble(),
              (op['y'] as num).toDouble(),
              text: op['text'] as String? ?? '',
            );
          case 'tree':
            tree(
              op['new'] as String,
              (op['x'] as num).toDouble(),
              (op['y'] as num).toDouble(),
              MindTreeSpec.fromJson((op['tree'] as Map).cast()),
            );
          case 'text':
            text(op['id'] as String, op['text'] as String);
          case 'collapse':
            collapse(op['id'] as String, op['collapsed'] == true);
          case 'remove':
            remove(ids());
          case 'drop':
            drop(ids());
          case 'layout':
            layout(ids());
        }
    }
  }

  // ---- result -------------------------------------------------------------------------------------------------------

  /// Everything that changed since the start as plain ops: remove, create (new nodes with their layout), update.
  /// [base]: compare with these nodes instead (the server's confirmed state – for a gesture whose earlier, still
  /// unsent step is replaced, the prediction must carry everything since then).
  List<BoardOp> diff({Map<String, Map<String, Object?>>? base}) {
    final start = base ?? _start;
    final now = _byId;
    final removed = [
      for (final id in start.keys)
        if (!now.containsKey(id)) id,
    ];
    final created = <Map<String, Object?>>[];
    final patches = <String, Map<String, Object?>>{};
    for (final o in _nodes) {
      final id = rid(o);
      final was = start[id];
      if (was == null) {
        created.add(
          {...o}
            ..remove('z')
            ..remove('createdBy')
            ..remove('updatedAt'),
        );
        continue;
      }
      final p = <String, Object?>{};
      o.forEach((k, v) {
        if (!_deepEq(was[k], v)) p[k] = v;
      });
      for (final k in was.keys) {
        if (!o.containsKey(k)) p[k] = null;
      }
      if (p.isNotEmpty) patches[id] = p;
    }
    return [
      if (removed.isNotEmpty) RemoveOp(removed),
      if (created.isNotEmpty) CreateOp(created),
      if (patches.isNotEmpty) UpdateOp(patches),
    ];
  }

  /// The intent [json] (`mind` op without `op`) with this planner's result as prediction ([base] see [diff]).
  MindOp op(Map<String, Object?> json, {Map<String, Map<String, Object?>>? base}) =>
      MindOp(json, predicted: diff(base: base));
}

Object? _copy(Object? v) => switch (v) {
  Map() => {for (final e in v.entries) e.key as String: _copy(e.value)},
  List() => [for (final x in v) _copy(x)],
  _ => v,
};

MindRaw _deepCopy(Map<String, Object?> o) => _copy(o) as MindRaw;

/// Deep equality without regard to key order (numbers by value: 2 == 2.0).
bool _deepEq(Object? a, Object? b) {
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final k in a.keys) {
      if (!b.containsKey(k) || !_deepEq(a[k], b[k])) return false;
    }
    return true;
  }
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!_deepEq(a[i], b[i])) return false;
    }
    return true;
  }
  return a == b;
}

/// Mind node [o] as raw map (planner input).
MindRaw mindRawOf(BoardObject o) => o.raw;
