import 'dart:math' as math;
import 'dart:ui';

import '../../model/board_object.dart';
import '../../web/web_constants.dart';
import 'fold_table.g.dart';

// Port of the web's board search (M13): `ui/search.ts` (fold, findMatch – case, accent and „ae = ä“ tolerant) and
// `features/tools/search.tsx` (searchText per type, hits in reading order). Checked against the web's reference values
// (`docs/native_fixtures/web/view.json`, `stachel/tools/native-view-fixtures.mts`).

/// A folded text and where each of its UTF-16 units came from in the original (`[start, end)`).
class Folded {
  Folded(this.text, this.start, this.end);
  final String text;
  final List<int> start;
  final List<int> end;
}

String _foldChar(int rune, String ch) {
  if (rune == 0xdf || rune == 0x1e9e) return 'ss';
  // Hangul syllables: NFD by formula (Unicode §3.12), no marks to strip
  if (rune >= 0xac00 && rune <= 0xd7a3) {
    final s = rune - 0xac00;
    final l = 0x1100 + s ~/ 588, v = 0x1161 + (s % 588) ~/ 28, t = s % 28;
    return String.fromCharCodes([l, v, if (t != 0) 0x11a7 + t]);
  }
  return foldTable[rune] ?? ch.toLowerCase();
}

/// Folds [s] for the search and remembers where every character came from (web `fold`).
Folded fold(String s) {
  final text = StringBuffer();
  var last = -1; // last UTF-16 unit of `text`
  var len = 0;
  final start = <int>[], end = <int>[];
  var i = 0;
  for (final rune in s.runes) {
    final ch = String.fromCharCode(rune);
    final n = ch.length;
    var f = _foldChar(rune, ch);
    // „ae/oe/ue“ like „ä/ö/ü“: the e after a/o/u is dropped
    if (f == 'e' && len > 0 && (last == 0x61 || last == 0x6f || last == 0x75) && end.last == i) {
      end[end.length - 1] = i + n;
      f = '';
    }
    for (var k = 0; k < f.length; k++) {
      start.add(i);
      end.add(i + n);
    }
    if (f.isNotEmpty) {
      text.write(f);
      len += f.length;
      last = f.codeUnitAt(f.length - 1);
    }
    i += n;
  }
  return Folded(text.toString(), start, end);
}

/// Normalized query (spaces collapsed, web `foldQuery`).
String foldQuery(String q) => fold(q.trim().replaceAll(RegExp(r'\s+'), ' ')).text;

/// Where [query] is in [haystack] as `(from, to)` in the original, or null (web `findMatch`).
(int, int)? findMatch(String haystack, String query) {
  final q = foldQuery(query);
  if (q.isEmpty) return null;
  final f = fold(haystack);
  final at = f.text.indexOf(q);
  if (at < 0) return null;
  return (f.start[at], f.end[at + q.length - 1]);
}

// ---- search text per type ----------------------------------------------------------------------------------------

String? _s(Object? v) => v is String ? v : null;

/// Plain text of an object like the web's `plainTextOf` (registered per type).
String? plainTextOf(BoardObject o) {
  final raw = o.raw;
  switch (o.type) {
    case 'frame':
      return _s(raw['title']);
    case 'card':
      return [_s(raw['text']), _s(raw['desc'])].where((t) => t != null && t.isNotEmpty).join('\n');
    case 'table':
      return _tableText(raw['table']);
    case 'timeline':
      return _timelineText(raw['timeline']);
    case 'document':
      return _s(raw['docName']) ?? 'PDF';
    case 'sticker':
      return _s(raw['emoji']) ?? _stampLabel(_s(raw['stamp'])) ?? 'Sticker';
    case 'icon':
      return _s(raw['icon']);
    default:
      return _s(raw['text']);
  }
}

String? _stampLabel(String? id) {
  if (id == null) return null;
  for (final s in WebConstants.instance.maps('stickers.stamps')) {
    if (s['id'] == id) return _s(s['label']);
  }
  return null;
}

/// Text that is searched (web `searchText`): plain text, plus tags of notes/cards and a card's assignee.
String searchText(BoardObject o) {
  final parts = [plainTextOf(o) ?? ''];
  final tags = o.raw['tags'];
  if (tags is List) {
    for (final t in tags) {
      if (t is Map && t['label'] is String) parts.add(t['label'] as String);
    }
  }
  final a = o.raw['assignee'];
  if (a is Map && a['name'] is String) parts.add(a['name'] as String);
  return parts.where((p) => p.isNotEmpty).join('\n');
}

List<String> _strings(Object? v) => [
  if (v is List)
    for (final x in v)
      if (x is String) x,
];

/// Table cells as rows of tab separated text (web `matrix(safeTable(o.table))`).
String _tableText(Object? t) {
  final m = t is Map ? t : const {};
  var rows = _strings(m['rows']), cols = _strings(m['cols']);
  if (rows.isEmpty) rows = ['r'];
  if (cols.isEmpty) cols = ['c'];
  final cells = m['cells'] is Map ? m['cells'] as Map : const {};
  String cell(String r, String c) {
    final v = cells['$r:$c'];
    return v == null ? '' : '$v';
  }

  return rows.map((r) => cols.map((c) => cell(r, c)).join('\t')).join('\n');
}

final _iso = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$');

/// `YYYY-MM-DD` → day number since 1970-01-01 (web `parseDay`).
int? _parseDay(Object? s) {
  if (s is! String) return null;
  final m = _iso.firstMatch(s);
  if (m == null) return null;
  final y = int.parse(m[1]!), mo = int.parse(m[2]!), d = int.parse(m[3]!);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  final t = DateTime.utc(y, mo, d);
  if (t.month != mo) return null;
  return (t.millisecondsSinceEpoch / 86400000).round();
}

({int y, int m, int d}) _ymd(int n) {
  final t = DateTime.fromMillisecondsSinceEpoch(n * 86400000, isUtc: true);
  return (y: t.year, m: t.month, d: t.day);
}

/// „1.7.–3.7.2026“ (web `spanLabel`).
String _spanLabel(int a, int b) {
  final x = _ymd(a), z = _ymd(b);
  if (a == b) return '${x.d}.${x.m}.${x.y}';
  return '${x.d}.${x.m}.${x.y == z.y ? '' : x.y}–${z.d}.${z.m}.${z.y}';
}

/// Lanes and entries as text (web `timelineText(safeTimeline(o.timeline))`).
String _timelineText(Object? raw) {
  final t = raw is Map ? raw : const {};
  final seen = <String>{};
  final lanes = [
    for (final l in _strings(t['lanes']))
      if (seen.add(l)) l,
  ];
  if (lanes.isEmpty) lanes.add('');
  final names = t['names'] is Map ? t['names'] as Map : const {};
  final items = <({String lane, int start, int end, String startKey, String title})>[];
  final rawItems = t['items'] is Map ? t['items'] as Map : const {};
  for (final it in rawItems.values) {
    if (it is! Map) continue;
    var a = _parseDay(it['start']);
    var b = _parseDay(it['end']) ?? a;
    if (a == null || b == null) continue;
    if (b < a) (a, b) = (b, a);
    final ms = it['ms'] == true;
    final lane = it['lane'] is String && seen.contains(it['lane']) ? it['lane'] as String : lanes.first;
    final s = _ymd(a);
    String two(int n) => n.toString().padLeft(2, '0');
    items.add((
      lane: lane,
      start: a,
      end: ms ? a : b,
      startKey: '${s.y.toString().padLeft(4, '0')}-${two(s.m)}-${two(s.d)}',
      title: it['title'] is String ? it['title'] as String : '',
    ));
  }
  final lines = <String>[];
  for (final l in lanes) {
    final its = [
      for (final it in items)
        if (it.lane == l) it,
    ];
    // stable like the web's sort by the start day
    final sorted = [for (final e in its.indexed) e]
      ..sort((p, q) {
        final c = p.$2.startKey.compareTo(q.$2.startKey);
        return c != 0 ? c : p.$1.compareTo(q.$1);
      });
    final name = names[l];
    lines.add(name is String && name.isNotEmpty ? name : 'Spur');
    for (final (_, it) in sorted) {
      lines.add('\t${it.title.isEmpty ? 'Ohne Titel' : it.title}\t${_spanLabel(it.start, it.end)}');
    }
  }
  return lines.join('\n');
}

// ---- hits ---------------------------------------------------------------------------------------------------------

/// A hit of the search: the object and its box on the board.
class SearchHit {
  const SearchHit(this.object, this.rect);
  final BoardObject object;
  final Rect rect;
}

/// Rows top → bottom (same row if the top lies in the upper half of the row's first one), in a row left → right
/// (web `readingOrder` of search.tsx; JavaScript's stable sort).
List<T> readingOrder<T>(List<T> items, Rect Function(T) rectOf) {
  final sorted = items.indexed.toList()
    ..sort((a, b) {
      final ra = rectOf(a.$2), rb = rectOf(b.$2);
      var c = ra.top.compareTo(rb.top);
      if (c == 0) c = ra.left.compareTo(rb.left);
      return c != 0 ? c : a.$1.compareTo(b.$1);
    });
  final rows = <List<T>>[];
  for (final (_, it) in sorted) {
    final row = rows.isEmpty ? null : rows.last;
    final r = rectOf(it);
    if (row != null && r.top < rectOf(row.first).top + math.min(rectOf(row.first).height, r.height) / 2) {
      row.add(it);
    } else {
      rows.add([it]);
    }
  }
  return [
    for (final row in rows)
      ...(row.indexed.toList()..sort((a, b) {
            final c = rectOf(a.$2).left.compareTo(rectOf(b.$2).left);
            return c != 0 ? c : a.$1.compareTo(b.$1);
          }))
          .map((e) => e.$2),
  ];
}

/// Objects matching [query] in reading order (web `findHits`); hidden ones only with [includeHidden]. [bounds] gives
/// the box (null = not searchable, e.g. no geometry).
List<SearchHit> findHits(
  Iterable<BoardObject> objects,
  String query,
  Rect? Function(BoardObject o) bounds, {
  bool includeHidden = false,
}) {
  if (query.trim().isEmpty) return const [];
  final out = <SearchHit>[];
  for (final o in objects) {
    if (o.hidden && !includeHidden) continue;
    final text = searchText(o);
    if (text.isEmpty || findMatch(text, query) == null) continue;
    final r = bounds(o);
    if (r != null) out.add(SearchHit(o, r));
  }
  return readingOrder(out, (h) => h.rect);
}
