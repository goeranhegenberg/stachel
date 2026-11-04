import 'dart:math' as math;

import 'mind_measure.dart';

// Port of the web's mind map data code (stachel `web/src/features/structure/mindmap/{style,layout,ops}.ts`,
// `structure/text.ts`), line by line and with JavaScript number semantics (`Math.round`, `Math.ceil`, order of
// additions), so the app predicts exactly what the server writes (test: `mind_web_reference_test.dart` against
// `fixtures/web/mindmap.json` from `stachel/tools/native-mind-fixtures.mts`). Nodes are raw object maps (like the
// web's `BoardObject`: unknown fields stay).

/// Horizontal / vertical gap of the layout (web `H_GAP`, `V_GAP`).
const mindHGap = 64.0;
const mindVGap = 16.0;

/// Look of a level (web `MIND_STYLES`): root, main topic, subtopic.
class MindStyle {
  const MindStyle({
    required this.fs,
    required this.weight,
    required this.condensed,
    required this.ls,
    required this.padX,
    required this.padY,
    required this.minW,
    required this.maxW,
    required this.lh,
  });

  final double fs;
  final int weight;

  /// Barlow Condensed (root) instead of Barlow.
  final bool condensed;

  /// Letter spacing in em.
  final double ls;
  final double padX, padY, minW, maxW, lh;
}

const mindStyles = [
  MindStyle(fs: 28, weight: 700, condensed: true, ls: 0.01, padX: 26, padY: 14, minW: 140, maxW: 360, lh: 1.15),
  MindStyle(fs: 18, weight: 600, condensed: false, ls: 0, padX: 18, padY: 9, minW: 80, maxW: 280, lh: 1.3),
  MindStyle(fs: 16, weight: 500, condensed: false, ls: 0, padX: 6, padY: 6, minW: 60, maxW: 260, lh: 1.3),
];

MindStyle mindStyle(int level) => mindStyles[math.min(math.max(0, level), mindStyles.length - 1)];

/// Branch colors (main topics in turn, subtopics inherit) – web `MIND_COLORS`.
const mindColors = ['#ec4e92', '#1763b5', '#7aa21b', '#e8590c', '#7048e8', '#0c8599', '#c2255c', '#0a0a0a'];

/// Placeholder per level (web `MIND_PLACEHOLDER`).
const mindPlaceholders = ['Zentrales Thema', 'Hauptthema', 'Unterthema'];

/// JavaScript `Math.round` (halves towards +∞, Dart's `round` goes away from zero).
double jsRound(num v) => (v + 0.5).floorToDouble();

/// Measure of a level like the web's `mindMeasure` (font metrics + letter spacing per UTF-16 unit).
double Function(String) mindMeasure(int level) {
  final st = mindStyle(level);
  final m = TextMetrics.instance;
  final family = st.condensed ? 'Barlow Condensed' : 'Barlow';
  return (s) => m.measure(s, st.fs, st.weight, family) + st.ls * st.fs * s.length;
}

final _wordBreak = RegExp(r'(?<=\s)');

/// Line wrapping like the web's `wrapText` (paragraphs at `\n`, words at spaces, too long words per character).
List<String> wrapText(String text, double maxW, double Function(String) measure) {
  final out = <String>[];
  for (final para in text.split('\n')) {
    final words = para.split(_wordBreak);
    var line = '';
    for (final word in words) {
      final next = line + word;
      if (line.isEmpty || measure(next.trimRight()) <= maxW) {
        line = next;
        if (measure(line.trimRight()) > maxW) {
          var part = '';
          for (final r in line.runes) {
            final ch = String.fromCharCode(r);
            if (part.isNotEmpty && measure(part + ch) > maxW) {
              out.add(part);
              part = '';
            }
            part += ch;
          }
          line = part;
        }
        continue;
      }
      out.add(line.trimRight());
      line = word.trimLeft();
    }
    out.add(line.trimRight());
  }
  return out;
}

/// Widest line (web `widest`).
double widest(List<String> lines, double Function(String) measure) =>
    lines.fold(0.0, (m, l) => math.max(m, measure(l)));

/// Size of a node from text and level (web `mindSize`).
({double w, double h}) mindSize(String text, int level) {
  final st = mindStyle(level);
  final measure = mindMeasure(level);
  final shown = text.isEmpty ? mindPlaceholders[math.min(level, 2)] : text;
  final lines = wrapText(shown, st.maxW - 2 * st.padX, measure);
  final w = math.min(st.maxW, math.max(st.minW, widest(lines, measure) + 2 * st.padX + 2)).ceilToDouble();
  final h = (lines.length * st.fs * st.lh + 2 * st.padY).ceilToDouble();
  return (w: w, h: h);
}

// ---- raw node access (like the web's normalized BoardObject) ---------------------------------------------------------

typedef MindRaw = Map<String, Object?>;

double _num(Object? v, [double d = 0]) => v is num && v.isFinite ? v.toDouble() : d;
double rx(MindRaw o) => _num(o['x']);
double ry(MindRaw o) => _num(o['y']);
double rw(MindRaw o) => math.max(1, _num(o['w'], 100));
double rh(MindRaw o) => math.max(1, _num(o['h'], 100));
String rid(MindRaw o) => o['id'] as String;
Map<String, Object?>? rmind(MindRaw o) {
  final m = o['mind'];
  return m is Map ? m.cast<String, Object?>() : null;
}

String? rparent(MindRaw o) {
  final p = rmind(o)?['parent'];
  return p is String && p.isNotEmpty ? p : null;
}

num? rorder(MindRaw o) {
  final v = rmind(o)?['order'];
  return v is num ? v : null;
}

String? rside(MindRaw o) {
  final v = rmind(o)?['side'];
  return v is String ? v : null;
}

bool rcollapsed(MindRaw o) => rmind(o)?['collapsed'] == true;
bool rhidden(MindRaw o) => rmind(o)?['hidden'] == true;
String? rcolor(MindRaw o) => o['color'] is String ? o['color'] as String : null;
String rtext(MindRaw o) => o['text'] is String ? o['text'] as String : '';
bool isMindRaw(MindRaw? o) => o != null && o['type'] == 'mindnode';

// ---- layout.ts ------------------------------------------------------------------------------------------------------

class MindIn {
  const MindIn({
    required this.id,
    this.parent,
    this.order,
    this.side,
    this.collapsed = false,
    required this.x,
    required this.y,
  });
  final String id;
  final String? parent;
  final num? order;
  final String? side;
  final bool collapsed;
  final double x, y;
}

class MindOut {
  const MindOut({
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    required this.level,
    required this.side,
    required this.hidden,
  });
  final double x, y, w, h;
  final int level;
  final String side;
  final bool hidden;
}

int _byOrder(MindIn a, MindIn b) {
  final d = (a.order ?? 0) - (b.order ?? 0);
  if (d != 0) return d < 0 ? -1 : 1;
  return a.id.compareTo(b.id);
}

/// Parent → children (sorted) and roots; missing parents and cycles make a node a root (web `mindTree`).
class MindTree {
  MindTree(List<MindIn> nodes) {
    final byId = {for (final n in nodes) n.id: n};
    for (final n in nodes) {
      final p = n.parent;
      if (p != null && p != n.id && byId.containsKey(p)) _parentOf[n.id] = p;
    }
    // cycles (concurrent reparenting): the smallest node in the loop becomes a root
    for (final n in nodes) {
      final seen = <String>[];
      String? cur = n.id;
      while (cur != null && !seen.contains(cur)) {
        seen.add(cur);
        cur = _parentOf[cur];
      }
      if (cur != null) {
        final loop = seen.sublist(seen.indexOf(cur))..sort();
        _parentOf.remove(loop.first);
      }
    }
    for (final n in nodes) {
      final p = _parentOf[n.id];
      if (p == null) {
        roots.add(n);
      } else {
        (_kids[p] ??= []).add(n);
      }
    }
    for (final list in _kids.values) {
      list.sort(_byOrder);
    }
    roots.sort(_byOrder);
  }

  final roots = <MindIn>[];
  final _kids = <String, List<MindIn>>{};
  final _parentOf = <String, String>{};

  List<MindIn> kids(String id) => _kids[id] ?? const [];
  String? parentOf(String id) => _parentOf[id];
}

/// Positions, sizes, level, side and visibility of all nodes (several maps possible) – web `layoutMind`.
Map<String, MindOut> layoutMind(List<MindIn> nodes, ({double w, double h}) Function(MindIn n, int level) size) {
  final tree = MindTree(nodes);
  final out = <String, MindOut>{};
  final sizes = <String, ({double w, double h})>{};
  ({double w, double h}) sz(MindIn n, int level) => sizes[n.id] ??= size(n, level);
  final span = <String, double>{};
  double spanOf(MindIn n, int level) {
    final have = span[n.id];
    if (have != null) return have;
    final list = n.collapsed ? const <MindIn>[] : tree.kids(n.id);
    final own = sz(n, level).h;
    final sum = list.fold(0.0, (s, k) => s + spanOf(k, level + 1)) + mindVGap * math.max(0, list.length - 1);
    final v = math.max(own, sum);
    span[n.id] = v;
    return v;
  }

  void hide(List<MindIn> list, MindOut anchor, int level) {
    for (final k in list) {
      final s = sz(k, level);
      out[k.id] = MindOut(x: anchor.x, y: anchor.y, w: s.w, h: s.h, level: level, side: anchor.side, hidden: true);
      hide(tree.kids(k.id), anchor, level + 1);
    }
  }

  void placeKids(MindOut p, List<MindIn> list, String side, int level) {
    if (list.isEmpty) return;
    final total = list.fold(0.0, (s, k) => s + spanOf(k, level)) + mindVGap * (list.length - 1);
    var top = p.y + p.h / 2 - total / 2;
    for (final k in list) {
      final s = sz(k, level);
      final sp = spanOf(k, level);
      final x = side == 'r' ? p.x + p.w + mindHGap : p.x - mindHGap - s.w;
      final me = MindOut(
        x: jsRound(x),
        y: jsRound(top + sp / 2 - s.h / 2),
        w: s.w,
        h: s.h,
        level: level,
        side: side,
        hidden: false,
      );
      out[k.id] = me;
      if (k.collapsed) {
        hide(tree.kids(k.id), me, level + 1);
      } else {
        placeKids(me, tree.kids(k.id), side, level + 1);
      }
      top += sp + mindVGap;
    }
  }

  for (final r in tree.roots) {
    final s = sz(r, 0);
    final me = MindOut(x: r.x, y: r.y, w: s.w, h: s.h, level: 0, side: 'r', hidden: false);
    out[r.id] = me;
    final list = tree.kids(r.id);
    if (r.collapsed) {
      hide(list, me, 1);
      continue;
    }
    placeKids(
      me,
      [
        for (final k in list)
          if (k.side != 'l') k,
      ],
      'r',
      1,
    );
    placeKids(
      me,
      [
        for (final k in list)
          if (k.side == 'l') k,
      ],
      'l',
      1,
    );
  }
  return out;
}

// ---- ops.ts (pure parts) --------------------------------------------------------------------------------------------

MindIn _toIn(MindRaw o) => MindIn(
  id: rid(o),
  parent: rparent(o),
  order: rorder(o),
  side: rside(o),
  collapsed: rcollapsed(o),
  x: rx(o),
  y: ry(o),
);

/// Root of a node (parent chain, cycle safe) – web `rootOf`.
String mindRootOf(Map<String, MindRaw> byId, String id) {
  final seen = <String>{};
  var cur = id;
  for (;;) {
    seen.add(cur);
    final p = byId[cur] == null ? null : rparent(byId[cur]!);
    if (p == null || seen.contains(p) || !isMindRaw(byId[p])) return cur;
    cur = p;
  }
}

bool isMindRoot(Map<String, MindRaw> byId, MindRaw o) => mindRootOf(byId, rid(o)) == rid(o);

int _childOrder(MindRaw a, MindRaw b) {
  final d = (rorder(a) ?? 0) - (rorder(b) ?? 0);
  if (d != 0) return d < 0 ? -1 : 1;
  return rid(a).compareTo(rid(b)) < 0 ? -1 : 1;
}

/// Children of a node by order (web `childrenOf`).
List<MindRaw> mindChildrenOf(List<MindRaw> nodes, String id) => [
  for (final o in nodes)
    if (rparent(o) == id && rid(o) != id) o,
]..sort(_childOrder);

/// Node with all descendants (web `subtree`).
List<String> mindSubtree(List<MindRaw> nodes, String id) {
  final out = [id];
  for (var i = 0; i < out.length; i++) {
    for (final k in nodes) {
      if (rparent(k) == out[i] && !out.contains(rid(k))) out.add(rid(k));
    }
  }
  return out;
}

/// Equal like `JSON.stringify(a ?? {}) === JSON.stringify(b)`: same keys in the same order, same values.
bool _jsonEq(Object? a, Object? b) {
  if (a is Map && b is Map) {
    final ka = [
      for (final e in a.entries)
        if (e.value != null) e.key,
    ];
    final kb = [
      for (final e in b.entries)
        if (e.value != null) e.key,
    ];
    if (ka.length != kb.length) return false;
    for (var i = 0; i < ka.length; i++) {
      if (ka[i] != kb[i] || !_jsonEq(a[ka[i]], b[kb[i]])) return false;
    }
    return true;
  }
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!_jsonEq(a[i], b[i])) return false;
    }
    return true;
  }
  return a == b;
}

/// Field patch so that [o] matches the layout (null = fits already) – web `placePatch`.
Map<String, Object?>? _placePatch(MindRaw o, MindOut p, bool isRoot) {
  final mind = <String, Object?>{...?rmind(o), 'level': p.level};
  if (isRoot) {
    mind.remove('side');
  } else {
    mind['side'] = p.side;
  }
  if (p.hidden) {
    mind['hidden'] = true;
  } else {
    mind.remove('hidden');
  }
  final patch = <String, Object?>{};
  if (rx(o) != p.x) patch['x'] = p.x;
  if (ry(o) != p.y) patch['y'] = p.y;
  if (rw(o) != p.w) patch['w'] = p.w;
  if (rh(o) != p.h) patch['h'] = p.h;
  if (!_jsonEq(rmind(o) ?? const {}, mind)) patch['mind'] = mind;
  return patch.isEmpty ? null : patch;
}

/// Layout patches for the maps with these [roots] (all if null) – web `layoutPatches`.
Map<String, Map<String, Object?>> mindLayoutPatches(List<MindRaw> nodes, [Set<String>? roots]) {
  final ins = nodes.map(_toIn).toList();
  final text = {for (final o in nodes) rid(o): rtext(o)};
  final out = layoutMind(ins, (n, level) => mindSize(text[n.id] ?? '', level));
  final tree = MindTree(ins);
  final rootCache = <String, String>{};
  String root(String id) {
    final have = rootCache[id];
    if (have != null) return have;
    final p = tree.parentOf(id);
    final r = p != null ? root(p) : id;
    rootCache[id] = r;
    return r;
  }

  final patches = <String, Map<String, Object?>>{};
  for (final o in nodes) {
    final p = out[rid(o)];
    if (p == null || (roots != null && !roots.contains(root(rid(o))))) continue;
    final patch = _placePatch(o, p, tree.parentOf(rid(o)) == null);
    if (patch != null) patches[rid(o)] = patch;
  }
  return patches;
}

/// Level of a node for drawing (web `levelOf`).
int mindLevelOf(MindRaw o) {
  final l = rmind(o)?['level'];
  if (l is num) return l.toInt();
  return rparent(o) != null ? 1 : 0;
}
