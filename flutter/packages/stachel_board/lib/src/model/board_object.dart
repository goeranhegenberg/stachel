import 'dart:math' as math;

import 'rich_text.dart';

/// Object types the native renderer knows (contract §4 + feature modules shapes, structure, tools, documents).
/// Everything else is drawn as placeholder and passed through untouched.
const knownObjectTypes = {
  'sticky',
  'text',
  'shape',
  'connector',
  'pen',
  'frame',
  'image',
  'card',
  'table',
  'mindnode',
  'timeline',
  'sticker',
  'icon',
  'document',
};

/// One end of a connector: attached to an object (optionally at a fixed side) or a free point.
sealed class ConnectorEnd {
  const ConnectorEnd();

  /// Tolerant like the web: `{objectId, side?}` or `{x, y}` with finite numbers, else null.
  static ConnectorEnd? fromJson(Object? j) {
    if (j is! Map) return null;
    final id = j['objectId'];
    if (id is String) {
      final side = j['side'];
      return AttachedEnd(id, side is String && const {'n', 'e', 's', 'w'}.contains(side) ? side : null);
    }
    final x = j['x'];
    final y = j['y'];
    if (x is num && y is num && x.isFinite && y.isFinite) return FreeEnd(x.toDouble(), y.toDouble());
    return null;
  }
}

class AttachedEnd extends ConnectorEnd {
  const AttachedEnd(this.objectId, [this.side]);
  final String objectId;

  /// `n`/`e`/`s`/`w` or null (client picks the nearest side or the center ray).
  final String? side;
}

class FreeEnd extends ConnectorEnd {
  const FreeEnd(this.x, this.y);
  final double x;
  final double y;
}

/// Tag of a sticky note or card.
class BoardTag {
  const BoardTag(this.label, this.color);
  final String label;
  final String? color;
}

/// Table contents (snapshot copy of the `table` Y.Map: rows, cols, cells `row:col`, relative widths).
class TableData {
  const TableData({required this.rows, required this.cols, required this.cells, required this.widths});

  static TableData? fromJson(Object? j) {
    if (j is! Map) return null;
    final rows = _strings(j['rows']);
    final cols = _strings(j['cols']);
    if (rows.isEmpty || cols.isEmpty) return null;
    final cells = <String, String>{};
    final c = j['cells'];
    if (c is Map) {
      c.forEach((k, v) {
        if (k is String && v is String) cells[k] = v;
      });
    }
    final widths = <String, double>{};
    final w = j['widths'];
    if (w is Map) {
      w.forEach((k, v) {
        if (k is String && v is num && v.isFinite && v > 0) widths[k] = v.toDouble();
      });
    }
    return TableData(rows: rows, cols: cols, cells: cells, widths: widths);
  }

  final List<String> rows;
  final List<String> cols;
  final Map<String, String> cells;
  final Map<String, double> widths;

  String cell(String row, String col) => cells['$row:$col'] ?? '';
  double weight(String col) => widths[col] ?? 1;
}

/// One bar or milestone of a timeline.
class TimelineItem {
  const TimelineItem({
    required this.id,
    required this.lane,
    required this.start,
    required this.end,
    required this.title,
    this.color,
    this.milestone = false,
  });
  final String id;
  final String lane;
  final DateTime start;
  final DateTime end;
  final String title;
  final String? color;
  final bool milestone;
}

/// Snapshot copy of the `timeline` Y.Map: lanes (order), lane names, items. Tolerant like `safeTimeline` in the
/// web: duplicate lanes dropped, end before start swapped, items of unknown lanes go to the first lane.
class TimelineData {
  const TimelineData({required this.lanes, required this.names, required this.items});

  static TimelineData? fromJson(Object? j) {
    if (j is! Map) return null;
    final lanes = <String>[];
    for (final l in _strings(j['lanes'])) {
      if (!lanes.contains(l)) lanes.add(l);
    }
    if (lanes.isEmpty) return null;
    final names = <String, String>{};
    final n = j['names'];
    if (n is Map) {
      n.forEach((k, v) {
        if (k is String && v is String) names[k] = v;
      });
    }
    final items = <TimelineItem>[];
    final it = j['items'];
    if (it is Map) {
      it.forEach((k, v) {
        if (k is! String || v is! Map) return;
        var start = parseDay(v['start']);
        var end = parseDay(v['end']) ?? start;
        if (start == null || end == null) return;
        if (end.isBefore(start)) (start, end) = (end, start);
        final lane = v['lane'] is String && lanes.contains(v['lane']) ? v['lane'] as String : lanes.first;
        final ms = v['ms'] == true;
        items.add(
          TimelineItem(
            id: k,
            lane: lane,
            start: start,
            end: ms ? start : end,
            title: v['title'] is String ? v['title'] as String : '',
            color: v['color'] is String ? v['color'] as String : null,
            milestone: ms,
          ),
        );
      });
    }
    items.sort((a, b) => a.start.compareTo(b.start) != 0 ? a.start.compareTo(b.start) : a.id.compareTo(b.id));
    return TimelineData(lanes: lanes, names: names, items: items);
  }

  final List<String> lanes;
  final Map<String, String> names;
  final List<TimelineItem> items;
}

/// `YYYY-MM-DD` as UTC date, null otherwise.
DateTime? parseDay(Object? v) {
  if (v is! String) return null;
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(v);
  if (m == null) return null;
  final d = DateTime.utc(int.parse(m[1]!), int.parse(m[2]!), int.parse(m[3]!));
  return d.month == int.parse(m[2]!) ? d : null;
}

/// Mind map fields of a `mindnode` (`mind.*`, written by the web layout).
class MindInfo {
  const MindInfo({this.parent, this.order, this.side, this.collapsed = false, this.level, this.hidden = false});

  static MindInfo fromJson(Object? j) {
    if (j is! Map) return const MindInfo();
    return MindInfo(
      parent: j['parent'] is String ? j['parent'] as String : null,
      order: _num(j['order']),
      side: j['side'] is String ? j['side'] as String : null,
      collapsed: j['collapsed'] == true,
      level: j['level'] is num ? (j['level'] as num).toInt() : null,
      hidden: j['hidden'] == true,
    );
  }

  final String? parent;
  final double? order;
  final String? side;
  final bool collapsed;
  final int? level;
  final bool hidden;
}

/// One board object of the native snapshot (contract §4 `BoardObject` + feature fields).
///
/// Immutable wrapper around the raw JSON map: typed getters read tolerantly (missing/broken field = default, like
/// the web), and [raw] keeps every field — also the ones this app version does not know — so nothing is lost.
/// A patch creates a new instance, which renderers use as cache key (identity = version).
class BoardObject {
  BoardObject(Map<String, Object?> raw) : raw = Map.unmodifiable(raw);

  /// Null if [j] is no object with string `id` and `type` (such entries are skipped, like the web store).
  static BoardObject? fromJson(Object? j) {
    if (j is! Map) return null;
    if (j['id'] is! String || j['type'] is! String || (j['id'] as String).isEmpty) return null;
    return BoardObject(j.cast<String, Object?>());
  }

  final Map<String, Object?> raw;

  String get id => raw['id'] as String;
  String get type => raw['type'] as String;
  bool get isKnownType => knownObjectTypes.contains(type);

  double get x => _num(raw['x']) ?? 0;
  double get y => _num(raw['y']) ?? 0;

  /// Missing/invalid size = 100, at least 1 (contract §8.5, like `normalize` in the web).
  double get w => _dim(raw['w']);
  double get h => _dim(raw['h']);

  /// Fractional index (byte-wise order); broken keys sort as empty string.
  String get z => _str('z') ?? '';

  String? get color => _str('color');
  String get text => _str('text') ?? '';
  double? get fontSize => _pos('fontSize');
  String? get fontFamily => _str('fontFamily');
  bool get bold => raw['bold'] == true;
  bool get italic => raw['italic'] == true;
  bool get strike => raw['strike'] == true;
  String? get align => _oneOf('align', const {'left', 'center', 'right'});
  String? get valign => _oneOf('valign', const {'top', 'middle', 'bottom'});
  bool get autoWidth => raw['autoWidth'] == true;
  bool get locked => raw['locked'] == true;
  bool get hidden => raw['hidden'] == true;
  String? get groupId => _str('groupId');
  String? get linkTo => _str('linkTo');

  /// Degrees clockwise around the center, normalised to (-180, 180] (0 if missing/invalid), like `rotationOf`.
  double get rotation {
    final r = _num(raw['rotation']);
    if (r == null) return 0;
    final n = ((r + 180) % 360 + 360) % 360 - 180;
    return n == -180 ? 180 : n;
  }

  // ---- shape --------------------------------------------------------------------------------------------------------
  String? get shape => _str('shape');
  String? get stroke => _str('stroke');
  double? get strokeWidth {
    final v = _num(raw['strokeWidth']);
    return v == null ? null : math.max(0, v);
  }

  /// `solid` / `dashed` / `dotted` (null = solid).
  String? get dash => _oneOf('dash', const {'solid', 'dashed', 'dotted'});
  double get fillOpacity => (_num(raw['fillOpacity']) ?? 1).clamp(0, 1).toDouble();

  // ---- connector ----------------------------------------------------------------------------------------------------
  ConnectorEnd? get from => ConnectorEnd.fromJson(raw['from']);
  ConnectorEnd? get to => ConnectorEnd.fromJson(raw['to']);

  /// `straight` (default), `elbow` or `curved`.
  String get lineStyle {
    final s = raw['lineStyle'];
    return s == 'elbow' || s == 'curved' ? s as String : 'straight';
  }

  /// Cap at the start: `capStart`, else `arrowStart: true` → triangle, else none (shapes.md fallback).
  String get capStart => _cap('capStart') ?? (raw['arrowStart'] == true ? 'triangle' : 'none');

  /// Cap at the end: `capEnd`, else `arrowEnd !== false` → triangle, else none.
  String get capEnd => _cap('capEnd') ?? (raw['arrowEnd'] == false ? 'none' : 'triangle');
  double get labelPos => (_num(raw['labelPos']) ?? 0.5).clamp(0.02, 0.98).toDouble(); // web `labelPosOf`

  // ---- pen ----------------------------------------------------------------------------------------------------------
  /// Relative points `[x0, y0, x1, y1, …]`; an odd tail or non-numbers end the list.
  List<double> get points {
    final p = raw['points'];
    if (p is! List) return const [];
    final out = <double>[];
    for (final v in p) {
      if (v is! num || !v.isFinite) break;
      out.add(v.toDouble());
    }
    if (out.length.isOdd) out.removeLast();
    return out;
  }

  bool get marker => raw['marker'] == true;

  // ---- image / document ---------------------------------------------------------------------------------------------
  String? get imageId => _str('imageId');
  String? get docName => _str('docName');
  int get docCount => math.max(0, _num(raw['docCount'])?.toInt() ?? 0);

  /// Current page, clamped to 0 … docCount − 1.
  int get docPage {
    final p = _num(raw['docPage'])?.toInt() ?? 0;
    return docCount == 0 ? 0 : p.clamp(0, docCount - 1);
  }

  /// Page number → image ID (snapshot copy of the `docPages` Y.Map).
  Map<int, String> get docPages {
    final m = raw['docPages'];
    if (m is! Map) return const {};
    final out = <int, String>{};
    m.forEach((k, v) {
      final i = int.tryParse('$k');
      if (i != null && v is String) out[i] = v;
    });
    return out;
  }

  // ---- frame --------------------------------------------------------------------------------------------------------
  String? get title => _str('title');
  double? get frameGrid => _pos('frameGrid');
  bool get frameGridLabels => raw['frameGridLabels'] == true;

  // ---- card / sticky tags -------------------------------------------------------------------------------------------
  String? get desc => _str('desc');
  String? get status => _oneOf('status', const {'todo', 'doing', 'blocked', 'done'});
  String? get due => parseDay(raw['due']) == null ? null : raw['due'] as String;
  String? get assigneeName {
    final a = raw['assignee'];
    return a is Map && a['name'] is String ? a['name'] as String : null;
  }

  List<BoardTag> get tags {
    final t = raw['tags'];
    if (t is! List) return const [];
    return [
      for (final e in t)
        if (e is Map && e['label'] is String)
          BoardTag(e['label'] as String, e['color'] is String ? e['color'] as String : null),
    ];
  }

  // ---- structure ----------------------------------------------------------------------------------------------------
  TableData? get table => TableData.fromJson(raw['table']);

  /// `row` (default), `col`, `both`, `none`.
  String get tableHead => _oneOf('tableHead', const {'row', 'col', 'both', 'none'}) ?? 'row';
  MindInfo get mind => MindInfo.fromJson(raw['mind']);
  TimelineData? get timeline => TimelineData.fromJson(raw['timeline']);
  DateTime? get tlStart => parseDay(raw['tlStart']);
  DateTime? get tlEnd => parseDay(raw['tlEnd']);

  /// `day`, `month` or `week` (default).
  String get tlUnit => _oneOf('tlUnit', const {'day', 'month'}) ?? 'week';

  // ---- sticker / icon -----------------------------------------------------------------------------------------------
  String? get emoji => _str('emoji');

  /// Stamp ID; unknown IDs count as `like` (shapes.md).
  String? get stamp {
    final s = _str('stamp');
    if (s == null) return null;
    return const {'like', 'heart', 'check', 'question', 'plusOne', 'star', 'exclaim', 'dislike'}.contains(s)
        ? s
        : 'like';
  }

  String? get icon => _str('icon');

  /// Drawing of an icon: lucide-style `[tag, attrs]` list.
  List<(String, Map<String, Object?>)> get iconNode {
    final n = raw['iconNode'];
    if (n is! List) return const [];
    return [
      for (final e in n)
        if (e is List && e.length >= 2 && e[0] is String && e[1] is Map)
          (e[0] as String, (e[1] as Map).cast<String, Object?>()),
    ];
  }

  // ---- rich text ----------------------------------------------------------------------------------------------------
  RichDoc? _rich;
  bool _richParsed = false;

  /// Rich text from `content` (ProseMirror JSON). Null without `content` or if its plain text differs from `text`
  /// (an older client changed only `text`: `text` wins, contract §4 „Rich-Text“).
  RichDoc? get richText {
    if (!_richParsed) {
      _richParsed = true;
      final doc = RichDoc.fromJson(raw['content']);
      if (doc != null && raw['text'] is String && _normWs(doc.plainText) != _normWs(text)) {
        _rich = null;
      } else {
        _rich = doc;
      }
    }
    return _rich;
  }

  /// Text shown on the object: plain text of [richText] or [text] (frames: title, cards: title).
  String get displayText => richText?.plainText ?? text;

  // ---- helpers ------------------------------------------------------------------------------------------------------
  String? _str(String k) {
    final v = raw[k];
    return v is String ? v : null;
  }

  double? _pos(String k) {
    final v = _num(raw[k]);
    return v != null && v > 0 ? v : null;
  }

  String? _oneOf(String k, Set<String> allowed) {
    final v = raw[k];
    return v is String && allowed.contains(v) ? v : null;
  }

  String? _cap(String k) => _oneOf(k, const {
    'none',
    'arrow',
    'triangle',
    'triangleOpen',
    'circle',
    'circleOpen',
    'diamond',
    'diamondOpen',
    'bar',
  });

  /// A copy with [set] fields set and [unset] fields removed (patch semantics of the native API).
  BoardObject patched({Map<String, Object?> set = const {}, Iterable<String> unset = const []}) {
    final next = Map<String, Object?>.of(raw)..addAll(set);
    for (final k in unset) {
      next.remove(k);
    }
    next['id'] = id; // identity never changes through a patch
    if (next['type'] is! String) next['type'] = type;
    return BoardObject(next);
  }

  @override
  String toString() => 'BoardObject($type $id)';
}

double? _num(Object? v) => v is num && v.isFinite ? v.toDouble() : null;

double _dim(Object? v) {
  final n = _num(v);
  return n == null || n <= 0 ? 100 : math.max(1, n);
}

List<String> _strings(Object? v) => v is List
    ? [
        for (final e in v)
          if (e is String) e,
      ]
    : const [];

String _normWs(String s) => s.replaceAll(RegExp(r'\s+'), ' ').trim();
