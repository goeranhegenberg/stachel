import '../../mindmap/mind_measure.dart';
import '../../mindmap/mind_model.dart' show wrapText;
import '../../model/board_object.dart';
import '../../model/board_source.dart';
import '../../web/web_constants.dart';

// Cards without widgets (port of the web's `structure/card/model.ts`, package P3): colors, due date label, height from
// the content (the layout of `.structure-card__inner` with the Chromium font metrics – the same numbers as the server's
// `cardContentHeight`), people for „Zuständig“.

WebConstants get _wc => WebConstants.instance;

/// Card colors (8), tag colors (8), status list – from the web constants.
List<String> get cardColors => _wc.strings('card.colors');
List<String> get tagColors => _wc.strings('card.tagColors');
double get cardWidth => _wc.number('card.width') ?? 300;
double get cardMinWidth => _wc.number('card.minWidth') ?? 160;
int get tagMax => (_wc.number('card.tagMax') ?? 40).round();
String get cardPlaceholder => _wc.string('card.placeholder') ?? 'Titel der Karte';

/// A card status (`todo` …) with its German label and color.
class CardStatus {
  const CardStatus(this.s, this.label, this.color);
  final String s;
  final String label;
  final String color;
}

List<CardStatus> get cardStatuses => [
  for (final m in _wc.maps('card.statuses'))
    CardStatus(m['s'] as String? ?? '', m['label'] as String? ?? '', m['color'] as String? ?? '#8a8a85'),
];

CardStatus? statusOf(String? s) => s == null ? null : cardStatuses.where((x) => x.s == s).firstOrNull;

const _monthsShort = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];

/// `YYYY-MM-DD` → „12. Juni“ (with the year when not this year) like the web's `formatDue` (`de-DE`, month short).
String formatDue(String due, [DateTime? now]) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(due);
  if (m == null) return due;
  final y = int.parse(m[1]!), mo = int.parse(m[2]!), d = int.parse(m[3]!);
  final date = DateTime(y, mo, d);
  final label = '${date.day}. ${_monthsShort[date.month - 1]}';
  return date.year != (now ?? DateTime.now()).year ? '$label ${date.year}' : label;
}

/// Overdue: date before today and not done (web `isOverdue`).
bool isOverdue(BoardObject o, [DateTime? now]) {
  final due = o.due;
  if (due == null || o.status == 'done') return false;
  final n = now ?? DateTime.now();
  final today = '${n.year}-${'${n.month}'.padLeft(2, '0')}-${'${n.day}'.padLeft(2, '0')}';
  return due.compareTo(today) < 0;
}

/// Text width (Barlow) like `measureText` – the font metrics of the server.
typedef CardMeasure = double Function(String text, double fs, int weight);

double _metrics(String text, double fs, int weight) => TextMetrics.instance.measure(text, fs, weight, 'Barlow');

// sizes from structure.css (.structure-card__inner, __title, __desc, __foot, .structure-chip, avatar 26)
const _padT = 14.0, _padB = 14.0, _padL = 22.0, _padR = 16.0;
const _titleFs = 17.0, _titleLh = 17 * 1.3;
const _descFs = 14.0, _descLh = 14 * 1.45, _descMaxLines = 4;
const _footGap = 6.0, _chipH = 24.0, _chipPad = 8.0, _chipFs = 12.5;
const _chipIcon = 13.0, _chipDot = 7.0, _chipIconGap = 5.0, _avatar = 26.0;

/// Layout numbers of a card (also used by the renderer): inner width, title lines, description lines, foot rows.
class CardLayout {
  const CardLayout({
    required this.inner,
    required this.titleLines,
    required this.descLines,
    required this.foot,
    required this.footHeight,
    required this.height,
  });
  final double inner;
  final List<String> titleLines;
  final List<String> descLines;

  /// Foot items (status, due, tags, person) with their place inside the foot.
  final List<CardFootItem> foot;
  final double footHeight;

  /// Height like the browser measures `.structure-card__inner` (`offsetHeight`, at least 40).
  final double height;

  static const padTop = _padT, padLeft = _padL, padRight = _padR;
  static const titleSize = _titleFs, titleLine = _titleLh, descSize = _descFs, descLine = _descLh;
  static const chipHeight = _chipH, chipPad = _chipPad, chipSize = _chipFs, avatar = _avatar;
  static const chipIcon = _chipIcon, chipDot = _chipDot, chipIconGap = _chipIconGap;
}

/// One element of the foot: [kind] `status`/`due`/`tag`/`person`, its box relative to the foot's top left.
class CardFootItem {
  const CardFootItem(this.kind, this.label, this.x, this.y, this.w, this.h, {this.color});
  final String kind;
  final String label;
  final double x, y, w, h;
  final String? color;
}

/// The card's layout like the browser (web `cardContentHeight`): title wrapped (empty = placeholder), description at
/// most 4 lines, foot (flex wrap, gap 6, row height = highest element, the person pushed right).
CardLayout cardLayout(BoardObject o, {CardMeasure measure = _metrics, DateTime? now}) {
  final inner = o.w - _padL - _padR < 8 ? 8.0 : o.w - _padL - _padR;
  final title = o.text.isEmpty ? cardPlaceholder : o.text;
  final tl = wrapText(title, inner, (s) => measure(s, _titleFs, 600));
  var h = _padT + tl.length * _titleLh;
  var dl = <String>[];
  final desc = o.desc;
  if (desc != null && desc.isNotEmpty) {
    dl = wrapText(desc, inner, (s) => measure(s, _descFs, 500));
    h += 6 + (dl.length < _descMaxLines ? dl.length : _descMaxLines) * _descLh;
  }
  // foot items in the order of the view
  final raw = <(String, String, double, double, String?)>[];
  double chip(String label, double lead) {
    final w = _chipPad * 2 + (lead > 0 ? lead + _chipIconGap : 0) + measure(label, _chipFs, 600);
    return w < inner ? w : inner;
  }

  final st = statusOf(o.status);
  if (st != null) raw.add(('status', st.label, chip(st.label, _chipDot), _chipH, st.color));
  final due = o.due;
  if (due != null) {
    final label = formatDue(due, now);
    raw.add(('due', label, chip(label, _chipIcon), _chipH, null));
  }
  for (final t in o.tags) {
    raw.add(('tag', t.label, chip(t.label, 0), _chipH, t.color));
  }
  final who = o.assigneeName;
  if (o.raw['assignee'] is Map) raw.add(('person', who ?? '', _avatar, _avatar, null));
  // flex wrap
  final foot = <CardFootItem>[];
  var total = 0.0, rowW = 0.0, rowH = 0.0, rowStart = 0;
  final rows = <(int, int, double, double)>[]; // start, end, y, height
  for (var i = 0; i < raw.length; i++) {
    final it = raw[i];
    if (rowW > 0 && rowW + _footGap + it.$3 > inner + 0.01) {
      rows.add((rowStart, i, total, rowH));
      total += rowH + _footGap;
      rowW = 0;
      rowH = 0;
      rowStart = i;
    }
    rowW += (rowW > 0 ? _footGap : 0) + it.$3;
    if (it.$4 > rowH) rowH = it.$4;
  }
  if (raw.isNotEmpty) rows.add((rowStart, raw.length, total, rowH));
  final footH = raw.isEmpty ? 0.0 : total + rowH;
  for (final (start, end, y, rh) in rows) {
    var x = 0.0;
    for (var i = start; i < end; i++) {
      final it = raw[i];
      // the person sits at the right end of its row (margin-left: auto)
      final ix = it.$1 == 'person' ? inner - it.$3 : x;
      foot.add(CardFootItem(it.$1, it.$2, ix, y + (rh - it.$4) / 2, it.$3, it.$4, color: it.$5));
      x += it.$3 + _footGap;
    }
  }
  if (footH > 0) h += 12 + footH;
  final height = (h + _padB).roundToDouble();
  return CardLayout(
    inner: inner,
    titleLines: tl,
    descLines: dl,
    foot: foot,
    footHeight: footH,
    height: height < 40 ? 40 : height,
  );
}

/// Height of a card from its content (web `cardContentHeight`).
double cardContentHeight(BoardObject o, {CardMeasure measure = _metrics, DateTime? now}) =>
    cardLayout(o, measure: measure, now: now).height;

/// A person for „Zuständig“ (`assignee` = `{key, name}`).
class CardPerson {
  const CardPerson(this.key, this.name);
  final String key;
  final String name;
  Map<String, Object?> toJson() => {'key': key, 'name': name};
}

/// People for „Zuständig“ like the web's `usePeople`: everyone who opened the board (`structure.people`), me, the ones
/// present now; sorted by name (German).
List<CardPerson> cardPeople(BoardController c) {
  final all = <String, String>{};
  final stored = c.state.ext['structure.people'];
  if (stored is Map) {
    stored.forEach((k, v) {
      if (k is String && v is String) all[k] = v;
    });
  }
  final me = c.user;
  if (me != null && me.key.isNotEmpty) all[me.key] = me.name;
  for (final p in c.peers) {
    all[p.key] = p.name;
  }
  final list = [for (final e in all.entries) CardPerson(e.key, e.value)];
  list.sort((a, b) => _deCompare(a.name, b.name));
  return list;
}

/// Name order like `localeCompare(…, 'de')` for the usual cases (umlauts as their base letter, case-insensitive).
int _deCompare(String a, String b) {
  String k(String s) =>
      s.toLowerCase().replaceAll('ä', 'a').replaceAll('ö', 'o').replaceAll('ü', 'u').replaceAll('ß', 'ss');
  final c = k(a).compareTo(k(b));
  return c != 0 ? c : a.compareTo(b);
}

/// Initials like the web's `initials` (two words: first letters of the first and last; one word: two letters).
String initialsOf(String name) {
  final parts = name
      .replaceAll(RegExp(r'[^\p{L}\p{N}\s-]', unicode: true), ' ')
      .trim()
      .split(RegExp(r'[\s-]+'))
      .where((p) => p.isNotEmpty)
      .toList();
  if (parts.isEmpty) return '?';
  String first(String s, int n) => String.fromCharCodes(s.runes.take(n)).toUpperCase();
  if (parts.length == 1) return first(parts.single, 2);
  return (first(parts.first, 1) + first(parts.last, 1)).toUpperCase();
}

/// Color of a person like the web's `userColor` (FNV-1a over the key → `colors.user`).
String userColorOf(String key) {
  var h = 0x811c9dc5;
  for (final c in key.codeUnits) {
    h ^= c;
    h = (h * 0x01000193) & 0xffffffff;
  }
  final colors = _wc.strings('colors.user');
  return colors.isEmpty ? '#1763b5' : colors[h % colors.length];
}
