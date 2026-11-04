import 'dart:math' as math;

import '../../model/board_object.dart';

// Port of the web's `features/structure/timeline/model.ts` (+ `create.ts`): data model, dates, layout (lanes, rows,
// bars/milestones), header ticks, hits, dragging on days, range at the side handles, new timelines and items. Days are
// whole numbers since 1970-01-01 (no time zones) like the web. Checked against the web code with
// `docs/native_fixtures/web/timeline.json` (stachel `tools/native-timeline-fixtures.mts`).

const tlDayMs = 86400000;

/// `YYYY-MM-DD` → day number; invalid → null (web `parseDay`).
int? tlParseDay(Object? s) {
  if (s is! String) return null;
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(s);
  if (m == null) return null;
  final y = int.parse(m[1]!), mo = int.parse(m[2]!), d = int.parse(m[3]!);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  final t = DateTime.utc(y, mo, d);
  if (t.month != mo) return null; // 31.02. …
  return (t.millisecondsSinceEpoch / tlDayMs).round();
}

DateTime _utc(int n) => DateTime.fromMillisecondsSinceEpoch(n * tlDayMs, isUtc: true);
int _num(DateTime d) => (d.millisecondsSinceEpoch / tlDayMs).round();
String _pad(int n) => n.toString().padLeft(2, '0');

/// Day number → `YYYY-MM-DD`.
String tlFmtDay(int n) {
  final d = _utc(n);
  return '${d.year}-${_pad(d.month)}-${_pad(d.day)}';
}

/// Today (local date) as day number.
int tlToday([DateTime? now]) {
  final t = now ?? DateTime.now();
  return _num(DateTime.utc(t.year, t.month, t.day));
}

/// Weekday, Monday = 0 … Sunday = 6.
int tlWeekday(int n) => (n + 3) % 7;
bool tlIsWeekend(int n) => tlWeekday(n) >= 5;
int tlMondayOf(int n) => n - tlWeekday(n);

/// ISO calendar week.
int tlIsoWeek(int n) {
  final thu = n - tlWeekday(n) + 3;
  final y = _utc(thu).year;
  final jan1 = _num(DateTime.utc(y, 1, 1));
  return ((thu - jan1) / 7).floor() + 1;
}

/// First day of the month of [n], or [k] months later.
int tlMonthStart(int n, [int k = 0]) {
  final d = _utc(n);
  return _num(DateTime.utc(d.year, d.month + k, 1));
}

const tlMonths = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];
const tlMonthsShort = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const tlWeekdays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/// „Mo 3.11.“ or with the year.
String tlDayLabel(int n, [bool year = false]) {
  final d = _utc(n);
  return '${tlWeekdays[tlWeekday(n)]} ${d.day}.${d.month}.${year ? d.year : ''}';
}

/// „3.11.–9.11.2026“ or one day.
String tlSpanLabel(int a, int b) {
  final x = _utc(a), z = _utc(b);
  if (a == b) return '${x.day}.${x.month}.${x.year}';
  return '${x.day}.${x.month}.${x.year == z.year ? '' : x.year}–${z.day}.${z.month}.${z.year}';
}

// ---- sizes (inner units) ------------------------------------------------------------------------------------------

const tlLabelW = 168.0;
const tlHeadTop = 24.0;
const tlHeadH = 58.0;
const tlBarH = 30.0;
const tlRowH = 38.0;
const tlLanePad = 10.0;
const tlMinLaneH = 54.0;
const tlDayPx = {'day': 40.0, 'week': 18.0, 'month': 5.0};
const tlNewLen = {'day': 1, 'week': 7, 'month': 14};
const tlMinDays = 3;
const tlMaxDays = 1100;
const tlMaxLanes = 40;
const tlDiamond = 22.0;
const tlUnits = [('day', 'Tag'), ('week', 'Woche'), ('month', 'Monat')];
const tlColors = [
  '#1763b5',
  '#ec4e92',
  '#c9e14a',
  '#7aa21b',
  '#fff27a',
  '#ffd08a',
  '#9fd3ff',
  '#e2d5ff',
  '#8a8a85',
  '#0a0a0a',
];
const tlDefaultColor = '#1763b5';

/// Zeitskala of an object (missing = week).
String tlUnitOf(Map<String, Object?> o) =>
    o['tlUnit'] == 'day' || o['tlUnit'] == 'month' ? o['tlUnit']! as String : 'week';

double _jsRound(num v) => (v + 0.5).floorToDouble();

// ---- data -----------------------------------------------------------------------------------------------------------

/// One bar or milestone (days `YYYY-MM-DD`, [end] inclusive).
class TlItem {
  const TlItem({
    required this.lane,
    required this.start,
    required this.end,
    this.title = '',
    this.color,
    this.ms = false,
  });
  final String lane;
  final String start;
  final String end;
  final String title;
  final String? color;
  final bool ms;

  int get a => tlParseDay(start)!;
  int get b => tlParseDay(end)!;

  TlItem copyWith({
    String? lane,
    String? start,
    String? end,
    String? title,
    String? color,
    bool clearColor = false,
    bool? ms,
  }) => TlItem(
    lane: lane ?? this.lane,
    start: start ?? this.start,
    end: end ?? this.end,
    title: title ?? this.title,
    color: clearColor ? null : (color ?? this.color),
    ms: ms ?? this.ms,
  );

  Map<String, Object?> toJson() => {
    'lane': lane,
    'start': start,
    'end': end,
    'title': title,
    'color': ?color,
    if (ms) 'ms': true,
  };
}

/// Read copy of the field `timeline` (web `TimelineData`): lane order, names, items by id (in the web's order).
class TimelineData {
  TimelineData({required this.lanes, required this.names, required this.items});
  final List<String> lanes;
  final Map<String, String> names;
  final Map<String, TlItem> items;

  TimelineData copy() => TimelineData(lanes: [...lanes], names: {...names}, items: {...items});

  Map<String, Object?> toJson() => {
    'lanes': [...lanes],
    'names': {...names},
    'items': {for (final e in items.entries) e.key: e.value.toJson()},
  };
}

/// Valid read copy (web `safeTimeline`): lanes without duplicates (at least one), items with valid days (end ≥ start),
/// items of unknown lanes in the first lane.
TimelineData safeTimeline(Object? raw) {
  final t = raw is Map ? raw : const {};
  final seen = <String>{};
  final lanes = <String>[
    if (t['lanes'] is List)
      for (final x in t['lanes'] as List)
        if (x is String && seen.add(x)) x,
  ];
  if (lanes.isEmpty) {
    lanes.add('l');
    seen.add('l');
  }
  final rawNames = t['names'] is Map ? t['names'] as Map : const {};
  final names = {for (final l in lanes) l: rawNames[l] is String ? rawNames[l] as String : ''};
  final items = <String, TlItem>{};
  final rawItems = t['items'] is Map ? t['items'] as Map : const {};
  rawItems.forEach((id, it) {
    if (id is! String || it is! Map) return;
    var a = tlParseDay(it['start']);
    var b = tlParseDay(it['end']) ?? a;
    if (a == null || b == null) return;
    if (b < a) (a, b) = (b, a);
    final ms = it['ms'] == true;
    items[id] = TlItem(
      lane: it['lane'] is String && seen.contains(it['lane']) ? it['lane'] as String : lanes.first,
      start: tlFmtDay(a),
      end: tlFmtDay(ms ? a : b),
      title: it['title'] is String ? it['title'] as String : '',
      color: it['color'] is String ? it['color'] as String : null,
      ms: ms,
    );
  });
  return TimelineData(lanes: lanes, names: names, items: items);
}

class TlRange {
  const TlRange(this.start, this.end) : days = end - start + 1;
  final int start;
  final int end;
  final int days;
}

/// Visible range (missing/broken: 8 weeks from this week's Monday).
TlRange tlRangeOf(Map<String, Object?> o, int today) {
  var a = tlParseDay(o['tlStart']);
  var b = tlParseDay(o['tlEnd']);
  if (a == null && b == null) a = tlMondayOf(today);
  a ??= b! - 55;
  b ??= a + 55;
  if (b < a) (a, b) = (b, a);
  b = math.min(b, a + tlMaxDays - 1);
  return TlRange(a, b);
}

// ---- packing ----------------------------------------------------------------------------------------------------------

/// Estimated width of a milestone title (inner units).
double tlMsLabelW(String title) => 16 + math.min(math.max(title.length, 4), 36) * 7.4;

/// Days an item takes for packing: milestones with their title right of it.
(int, int) tlExtentOf(TlItem it, double dayPx) {
  final a = it.a;
  if (!it.ms) return (a, it.b);
  final px = dayPx / 2 + tlDiamond / 2 + tlMsLabelW(it.title);
  return (a, a + math.max(0, (px / dayPx).ceil() - 1));
}

/// Rows per item (greedy like Gantt charts): sorted by start, each into the first row whose last item ends before.
({Map<String, int> row, int rows}) tlPackRows(List<({String id, int a, int b})> list) {
  final sorted = [...list]
    ..sort((x, y) {
      if (x.a != y.a) return x.a - y.a;
      if (x.b != y.b) return x.b - y.b;
      return x.id.compareTo(y.id);
    });
  final ends = <int>[];
  final row = <String, int>{};
  for (final it in sorted) {
    var r = ends.indexWhere((e) => e < it.a);
    if (r < 0) {
      r = ends.length;
      ends.add(it.b);
    } else {
      ends[r] = it.b;
    }
    row[it.id] = r;
  }
  return (row: row, rows: math.max(1, ends.length));
}

double tlLaneHeight(int rows) => math.max(tlMinLaneH, 2 * tlLanePad + rows * tlRowH - (tlRowH - tlBarH));

// ---- layout -----------------------------------------------------------------------------------------------------------

class TlLaneBox {
  const TlLaneBox({required this.id, required this.name, required this.y, required this.h, required this.rows});
  final String id;
  final String name;
  final double y;
  final double h;
  final int rows;
}

class TlItemBox {
  const TlItemBox({
    required this.id,
    required this.it,
    required this.a,
    required this.b,
    required this.lane,
    required this.row,
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    required this.cutL,
    required this.cutR,
  });
  final String id;
  final TlItem it;
  final int a;
  final int b;
  final String lane;
  final int row;

  /// Bar or diamond (+ title for milestones), inner units.
  final double x;
  final double y;
  final double w;
  final double h;

  /// Cut off at the range's edge.
  final bool cutL;
  final bool cutR;
}

class TlLayout {
  TlLayout({
    required this.range,
    required this.unit,
    required this.dayPx,
    required this.w0,
    required this.h0,
    required this.lanes,
    required this.items,
    required this.before,
    required this.after,
  });
  final TlRange range;
  final String unit;
  final double dayPx;
  final double w0;
  final double h0;
  final List<TlLaneBox> lanes;
  final List<TlItemBox> items;

  /// Items completely outside the range.
  final int before;
  final int after;

  int get start => range.start;
  int get end => range.end;
  int get days => range.days;
}

/// Layout for data, range and unit (web `layoutOf`).
TlLayout tlLayoutOf(TimelineData d, TlRange r, String unit) {
  final dayPx = tlDayPx[unit]!;
  final perLane = {for (final l in d.lanes) l: <({String id, int a, int b})>[]};
  var before = 0, after = 0;
  d.items.forEach((id, it) {
    final a = it.a, b = it.b;
    if (b < r.start) {
      before++;
      return;
    }
    if (a > r.end) {
      after++;
      return;
    }
    final (ea, eb) = tlExtentOf(it, dayPx);
    perLane[it.lane]?.add((id: id, a: math.max(ea, r.start), b: eb));
  });
  final lanes = <TlLaneBox>[];
  final rowOf = <String, int>{};
  var y = tlHeadH;
  for (final l in d.lanes) {
    final p = tlPackRows(perLane[l] ?? const []);
    rowOf.addAll(p.row);
    final h = tlLaneHeight(p.rows);
    lanes.add(TlLaneBox(id: l, name: d.names[l] ?? '', y: y, h: h, rows: p.rows));
    y += h;
  }
  final laneY = {for (final l in lanes) l.id: l.y};
  final items = <TlItemBox>[];
  d.items.forEach((id, it) {
    final row = rowOf[id];
    if (row == null) return;
    final a = it.a, b = it.b;
    final top = laneY[it.lane]! + tlLanePad + row * tlRowH;
    if (it.ms) {
      final cx = tlLabelW + (a - r.start + 0.5) * dayPx;
      items.add(
        TlItemBox(
          id: id,
          it: it,
          a: a,
          b: b,
          lane: it.lane,
          row: row,
          x: cx - tlDiamond / 2,
          y: top,
          w: tlDiamond + 6 + tlMsLabelW(it.title),
          h: tlBarH,
          cutL: false,
          cutR: false,
        ),
      );
      return;
    }
    final va = math.max(a, r.start), vb = math.min(b, r.end);
    items.add(
      TlItemBox(
        id: id,
        it: it,
        a: a,
        b: b,
        lane: it.lane,
        row: row,
        x: tlLabelW + (va - r.start) * dayPx,
        y: top,
        w: (vb - va + 1) * dayPx,
        h: tlBarH,
        cutL: a < r.start,
        cutR: b > r.end,
      ),
    );
  });
  return TlLayout(
    range: r,
    unit: unit,
    dayPx: dayPx,
    w0: tlLabelW + r.days * dayPx,
    h0: y,
    lanes: lanes,
    items: items,
    before: before,
    after: after,
  );
}

/// Layout of an object (its raw fields).
TlLayout tlLayoutFor(Map<String, Object?> o, int today) =>
    tlLayoutOf(safeTimeline(o['timeline']), tlRangeOf(o, today), tlUnitOf(o));

// ---- hits (inner units) ---------------------------------------------------------------------------------------------

/// What is under an inner point: `header` (day or null over the name column), `label` (lane name), `lane` (lane and
/// day), `item` (id, lane, day).
class TlHit {
  const TlHit(this.kind, {this.day, this.lane, this.id});
  final String kind;
  final int? day;
  final String? lane;
  final String? id;

  @override
  String toString() => 'TlHit($kind, day: $day, lane: $lane, id: $id)';
}

/// Day under x (limited to the range).
int tlDayAt(TlLayout l, double lx) => math.max(l.start, math.min(l.end, l.start + ((lx - tlLabelW) / l.dayPx).floor()));

/// Lane under y; above/below the lanes the first/last.
TlLaneBox tlLaneAt(TlLayout l, double ly) {
  for (final x in l.lanes) {
    if (ly < x.y + x.h) return x;
  }
  return l.lanes.last;
}

TlHit? tlHitLocal(TlLayout l, double lx, double ly) {
  if (lx < 0 || ly < 0 || lx > l.w0 || ly > l.h0) return null;
  if (ly < tlHeadH) return TlHit('header', day: lx >= tlLabelW ? tlDayAt(l, lx) : null);
  final lane = tlLaneAt(l, ly);
  if (lx < tlLabelW) return TlHit('label', lane: lane.id);
  final day = tlDayAt(l, lx);
  for (var i = l.items.length - 1; i >= 0; i--) {
    final b = l.items[i];
    if (lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h) {
      return TlHit('item', id: b.id, lane: b.lane, day: day);
    }
  }
  return TlHit('lane', lane: lane.id, day: day);
}

/// World point → inner units (timelines are not rotated).
({double lx, double ly}) tlToLocal(BoardObject o, TlLayout l, double x, double y) =>
    (lx: (x - o.x) * l.w0 / o.w, ly: (y - o.y) * l.h0 / o.h);

/// Inner rect → world rect `(x, y, w, h)`.
({double x, double y, double w, double h}) tlToWorldRect(
  BoardObject o,
  TlLayout l,
  double x,
  double y,
  double w,
  double h,
) {
  final kx = o.w / l.w0, ky = o.h / l.h0;
  return (x: o.x + x * kx, y: o.y + y * ky, w: w * kx, h: h * ky);
}

// ---- dragging (snapped to days) -------------------------------------------------------------------------------------

/// New days of an item after a drag by [dd] days (`move`/`start`/`end`): moving stays (partly) in the range, the
/// length keeps at least one day.
(int, int) tlDragDays(int a, int b, String mode, int dd, TlRange r) {
  if (mode == 'move') {
    final d = math.max(r.start - b, math.min(r.end - a, dd));
    return (a + d, b + d);
  }
  if (mode == 'start') return (math.min(b, math.max(r.start, a + dd)), b);
  return (a, math.max(a, math.min(r.end, b + dd)));
}

/// Days from a pointer movement (inner units), rounded = snapped to days.
int tlSnapDays(double dx, double dayPx) => _jsRound(dx / dayPx).toInt();

// ---- header ---------------------------------------------------------------------------------------------------------

class TlTick {
  const TlTick({
    required this.x,
    required this.w,
    required this.label,
    this.sub,
    this.weekend = false,
    this.today = false,
  });

  /// x from the range's start (inner units).
  final double x;
  final double w;
  final String label;
  final String? sub;
  final bool weekend;
  final bool today;

  TlTick withToday(bool t) => TlTick(x: x, w: w, label: label, sub: sub, weekend: weekend, today: t);
}

List<TlTick> _segments(TlRange r, double dayPx, int Function(int n) next, (String, String?) Function(int n) label) {
  final out = <TlTick>[];
  var a = r.start;
  while (a <= r.end && out.length < 2000) {
    final b = math.min(r.end, next(a) - 1);
    final (l, s) = label(a);
    out.add(TlTick(x: (a - r.start) * dayPx, w: (b - a + 1) * dayPx, label: l, sub: s));
    a = b + 1;
  }
  return out;
}

/// Upper (coarse) and lower (fine) row of the header (web `ticks`).
({List<TlTick> top, List<TlTick> bottom}) tlTicks(TlRange r, String unit, int today) {
  final dayPx = tlDayPx[unit]!;
  List<TlTick> months(bool short) => _segments(r, dayPx, (n) => tlMonthStart(n, 1), (n) {
    final d = _utc(n);
    return (short ? tlMonthsShort[d.month - 1] : '${tlMonths[d.month - 1]} ${d.year}', null);
  });
  bool inTick(TlTick t) => today >= r.start + t.x / dayPx && today < r.start + (t.x + t.w) / dayPx;
  if (unit == 'month') {
    final years = _segments(
      r,
      dayPx,
      (n) => _num(DateTime.utc(_utc(n).year + 1, 1, 1)),
      (n) => ('${_utc(n).year}', null),
    );
    return (top: years, bottom: [for (final t in months(true)) t.withToday(inTick(t))]);
  }
  if (unit == 'week') {
    final weeks = _segments(
      r,
      dayPx,
      (n) => tlMondayOf(n) + 7,
      (n) => ('KW ${tlIsoWeek(n)}', '${_utc(n).day}.${_utc(n).month}.'),
    );
    return (top: months(false), bottom: [for (final t in weeks) t.withToday(inTick(t))]);
  }
  return (
    top: months(false),
    bottom: [
      for (var n = r.start; n <= r.end; n++)
        TlTick(
          x: (n - r.start) * dayPx,
          w: dayPx,
          label: '${_utc(n).day}',
          sub: tlWeekdays[tlWeekday(n)],
          weekend: tlIsWeekend(n),
          today: n == today,
        ),
    ],
  );
}

// ---- size ------------------------------------------------------------------------------------------------------------

/// Scale of the object (inner units → world), from its width.
double tlScaleOf(double w, TlLayout l) => l.w0 > 0 ? w / l.w0 : 1;

/// Object size for a new layout at the same scale.
({double w, double h}) tlSizeFor(double k, TlLayout l) =>
    (w: math.max(8, _jsRound(l.w0 * k)), h: math.max(8, _jsRound(l.h0 * k)));

/// Range from the side handles (more/fewer days, the day width stays). [west]: left edge.
TlRange tlResizeRange(TlRange r, double k, String unit, double newW, bool west) {
  final dayPx = tlDayPx[unit]!;
  final days = math.max(tlMinDays, math.min(tlMaxDays, _jsRound((newW / k - tlLabelW) / dayPx).toInt()));
  return west ? TlRange(r.end - days + 1, r.end) : TlRange(r.start, r.start + days - 1);
}

/// Side handle `e`/`w` of the timeline (web `resize` of the type): range and size, the day width stays; corners and
/// unchanged widths keep the editor's [box].
Map<String, Object?> tlResize(BoardObject o, Map<String, Object?> box, String handle, int today) {
  if (handle != 'e' && handle != 'w') return box;
  final newW = (box['w'] as num?)?.toDouble() ?? o.w;
  if (newW == o.w) return box;
  final l = tlLayoutFor(o.raw, today);
  final k = tlScaleOf(o.w, l);
  final west = handle == 'w';
  final r = tlResizeRange(l.range, k, l.unit, newW, west);
  final l2 = tlLayoutOf(safeTimeline(o.raw['timeline']), r, l.unit);
  final size = tlSizeFor(k, l2);
  return {
    'x': west ? _jsRound(o.x + o.w - size.w) : o.x,
    'y': o.y,
    'w': size.w,
    'h': size.h,
    'tlStart': tlFmtDay(r.start),
    'tlEnd': tlFmtDay(r.end),
  };
}

/// New timeline's range per unit around [today] (week: 8 weeks from Monday).
TlRange tlDefaultRange(String unit, int today) {
  if (unit == 'day') {
    final s = tlMondayOf(today);
    return TlRange(s, s + 20);
  }
  if (unit == 'month') return TlRange(tlMonthStart(today), tlMonthStart(today, 6) - 1);
  final s = tlMondayOf(today);
  return TlRange(s, s + 55);
}

/// A new timeline centered at ([px], [py]) (web `newTimeline`): lanes „Spur 1–3“, 8 weeks from Monday.
Map<String, Object?> tlNewTimeline(double px, double py, int today, {String unit = 'week', int? start, int? end}) {
  final r0 = tlDefaultRange(unit, today);
  final r = TlRange(start ?? r0.start, end ?? r0.end);
  final data = TimelineData(
    lanes: ['l1', 'l2', 'l3'],
    names: {'l1': 'Spur 1', 'l2': 'Spur 2', 'l3': 'Spur 3'},
    items: {},
  );
  final size = tlSizeFor(1, tlLayoutOf(data, r, unit));
  return {
    'type': 'timeline',
    'x': _jsRound(px - size.w / 2),
    'y': _jsRound(py - size.h / 2),
    'w': size.w,
    'h': size.h,
    'timeline': data.toJson(),
    'tlStart': tlFmtDay(r.start),
    'tlEnd': tlFmtDay(r.end),
    if (unit != 'week') 'tlUnit': unit,
  };
}

// ---- operations without UI (the server runs the same in the web code; here for previews) --------------------------

/// Bar ↔ milestone (a bar gets the unit's default length again); `ms: null` = remove the field.
Map<String, Object?> tlToggleMsPatch(TlItem it, String unit) =>
    it.ms ? {'ms': null, 'end': tlFmtDay(it.a + tlNewLen[unit]! - 1)} : {'ms': true, 'end': it.start};

/// Dialog: start or end to day [n] (web `dayPatch`).
Map<String, String> tlDayPatch(TlItem it, String which, int n) {
  final a = it.a, b = it.b;
  if (which == 'start') {
    return it.ms
        ? {'start': tlFmtDay(n), 'end': tlFmtDay(n)}
        : {'start': tlFmtDay(n), 'end': tlFmtDay(math.max(n, n + (b - a)))};
  }
  return {'end': tlFmtDay(math.max(a, n))};
}

/// „‹ n“ / „n ›“: range up to the items before/after (web `extendRange`).
TlRange tlExtendRange(Map<String, Object?> o, String side, int today) {
  final days = [
    for (final it in safeTimeline(o['timeline']).items.values) ...[it.a, it.b],
  ];
  final r = tlRangeOf(o, today);
  final start = side == 'before' ? days.fold(r.start, math.min) : r.start;
  final end = side == 'after' ? days.fold(r.end, math.max) : r.end;
  return TlRange(start, math.min(end, start + tlMaxDays - 1));
}

/// New item with the default length from [day] (or today, else the range's start), at most to the end.
(int, int) tlNewItemSpan(TlLayout l, int? day, int today) {
  final a = day ?? (today >= l.start && today <= l.end ? today : l.start);
  final b = math.min(l.end, a + tlNewLen[l.unit]! - 1);
  return (a, math.max(a, b));
}

/// Plain text (clipboard, search): lanes with their items.
String tlText(TimelineData d) {
  final lines = <String>[];
  for (final l in d.lanes) {
    // stable like the web's sort: equal days keep the items' order
    final list = d.items.values.where((it) => it.lane == l).toList();
    final its = [for (var i = 0; i < list.length; i++) (i, list[i])]
      ..sort((x, y) {
        final c = x.$2.start.compareTo(y.$2.start);
        return c != 0 ? c : x.$1 - y.$1;
      });
    lines.add(d.names[l]?.isNotEmpty == true ? d.names[l]! : 'Spur');
    for (final (_, it) in its) {
      lines.add('\t${it.title.isEmpty ? 'Ohne Titel' : it.title}\t${tlSpanLabel(it.a, it.b)}');
    }
  }
  return lines.join('\n');
}

/// Update patch for [o] after a change of its data/range/unit (web `editTimeline`): the size follows the new layout at
/// the same scale. [next] = new data (null = unchanged), [extra] = object fields (`tlStart`, `tlEnd`, `tlUnit`; null
/// removes).
Map<String, Object?> tlEditPatch(
  BoardObject o,
  int today, {
  TimelineData? next,
  Map<String, Object?> extra = const {},
}) {
  final before = tlLayoutFor(o.raw, today);
  final k = tlScaleOf(o.w, before);
  final raw = {...o.raw, ...extra}..removeWhere((k, v) => v == null);
  final data = next ?? safeTimeline(o.raw['timeline']);
  final l = tlLayoutOf(data, tlRangeOf(raw, today), tlUnitOf(raw));
  final size = tlSizeFor(k, l);
  return {
    if (next != null) 'timeline': next.toJson(),
    ...extra,
    if (size.w != o.w) 'w': size.w,
    if (size.h != o.h) 'h': size.h,
  };
}
