import 'stachel_boards_api.dart';

// Logic of the board overview like the web (`web/src/pages/BoardsPage.tsx`, `ui/search.ts`, `ui/time.ts`,
// `pages/trashTime.ts`): sort modes, search that ignores case and accents, relative times, trash deadlines.
// Pure functions, tested in `test/stachel_overview_test.dart`.

/// Order of the board list (web `SortMode`), remembered per device.
enum StachelSort {
  recent('Geändert', 'Zuletzt geändert'),
  opened('Geöffnet', 'Zuletzt geöffnet'),
  name('Name', 'Name'),
  mine('Von mir', 'Von mir');

  const StachelSort(this.label, this.tooltip);

  /// Short label of the segment (four fit in one row at 390 px).
  final String label;
  final String tooltip;

  static StachelSort parse(String? v) => StachelSort.values.firstWhere((s) => s.name == v, orElse: () => recent);
}

/// SharedPreferences key of the chosen order (web `stachel:boards-sort`).
const stachelSortKey = 'stachel_boards_sort_v1';

/// Filter of the board list on instances with own accounts (web `OwnerFilter` in `boardsLocal.tsx`, audit R10),
/// remembered per device.
enum StachelOwnerFilter {
  all('Alle'),
  mine('Meine Boards'),
  shared('Mit mir geteilt'),
  favorites('Favoriten');

  const StachelOwnerFilter(this.label);
  final String label;

  static StachelOwnerFilter parse(String? v) =>
      StachelOwnerFilter.values.firstWhere((f) => f.name == v, orElse: () => all);
}

/// SharedPreferences key of the chosen filter (web `stachel:boards-filter`).
const stachelFilterKey = 'stachel_boards_filter_v1';

/// [list] after [filter] (web `apply`): mine = created by [me], shared = everything else, favorites = starred. With a
/// role from the server (instances with own accounts) it decides instead of `createdBy`.
List<StachelBoardInfo> filterBoards(List<StachelBoardInfo> list, StachelOwnerFilter filter, String? me) {
  bool own(StachelBoardInfo b) => b.role != null ? b.role == 'owner' : b.createdBy == me;
  return switch (filter) {
    StachelOwnerFilter.all => list,
    StachelOwnerFilter.mine => [
      for (final b in list)
        if (own(b)) b,
    ],
    StachelOwnerFilter.shared => [
      for (final b in list)
        if (!own(b)) b,
    ],
    StachelOwnerFilter.favorites => [
      for (final b in list)
        if (b.favorite) b,
    ],
  };
}

/// SharedPreferences key: trash section open (web `stachel:trash-open`).
const stachelTrashOpenKey = 'stachel_trash_open_v1';

int _byUpdated(StachelBoardInfo a, StachelBoardInfo b) {
  final x = a.updatedAt, y = b.updatedAt;
  if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
  return y.compareTo(x);
}

/// German collation „sensitivity base, numeric“ in short: case and accents ignored, numbers by value.
int compareNames(String a, String b) {
  final fa = fold(a).text, fb = fold(b).text;
  final num = RegExp(r'\d+|\D+');
  final pa = num.allMatches(fa).map((m) => m[0]!).toList();
  final pb = num.allMatches(fb).map((m) => m[0]!).toList();
  for (var i = 0; i < pa.length && i < pb.length; i++) {
    final na = int.tryParse(pa[i]), nb = int.tryParse(pb[i]);
    final c = na != null && nb != null ? na.compareTo(nb) : pa[i].compareTo(pb[i]);
    if (c != 0) return c;
  }
  return pa.length.compareTo(pb.length);
}

/// Boards (no templates) in [mode], favorites first like the web (`arrange`).
List<StachelBoardInfo> arrangeBoards(List<StachelBoardInfo> list, StachelSort mode, String? me) {
  final recent = [...list]..sort(_byUpdated);
  final List<StachelBoardInfo> sorted;
  switch (mode) {
    case StachelSort.recent:
      sorted = recent;
    case StachelSort.name:
      sorted = recent..sort((a, b) => compareNames(a.title, b.title));
    case StachelSort.mine:
      sorted = [
        for (final b in recent)
          if (b.createdBy == me) b,
        for (final b in recent)
          if (b.createdBy != me) b,
      ];
    case StachelSort.opened:
      final opened = [
        for (final b in recent)
          if (b.openedAt != null) b,
      ]..sort((a, b) => b.openedAt!.compareTo(a.openedAt!));
      sorted = [
        ...opened,
        for (final b in recent)
          if (b.openedAt == null) b,
      ];
  }
  return [
    for (final b in sorted)
      if (b.favorite) b,
    for (final b in sorted)
      if (!b.favorite) b,
  ];
}

/// Templates by name (web `templates`).
List<StachelBoardInfo> sortTemplates(List<StachelBoardInfo> list) =>
    [...list]..sort((a, b) => compareNames(a.title, b.title));

// ---- search (web `ui/search.ts`) ---------------------------------------------------------------------------------

/// A folded text and where each of its characters came from in the original (UTF-16 indices).
class Folded {
  const Folded(this.text, this.start, this.end);
  final String text;
  final List<int> start;
  final List<int> end;
}

const _accents = {
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'ā': 'a', 'ă': 'a', 'ą': 'a', //
  'ç': 'c', 'ć': 'c', 'č': 'c', 'ĉ': 'c', 'ċ': 'c', 'ď': 'd', //
  'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'ē': 'e', 'ė': 'e', 'ę': 'e', 'ě': 'e', //
  'ğ': 'g', 'ģ': 'g', 'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ī': 'i', 'į': 'i', 'ı': 'i', //
  'ķ': 'k', 'ĺ': 'l', 'ļ': 'l', 'ľ': 'l', 'ñ': 'n', 'ń': 'n', 'ņ': 'n', 'ň': 'n', //
  'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ō': 'o', 'ő': 'o', //
  'ŕ': 'r', 'ř': 'r', 'ś': 's', 'ş': 's', 'š': 's', 'ș': 's', 'ţ': 't', 'ť': 't', 'ț': 't', //
  'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u', 'ū': 'u', 'ů': 'u', 'ű': 'u', 'ų': 'u', //
  'ý': 'y', 'ÿ': 'y', 'ź': 'z', 'ż': 'z', 'ž': 'z',
};

/// Folds [s] for searching: lower case, accents off, „ß“ = „ss“, „ae/oe/ue“ = „ä/ö/ü“ (the e after a/o/u drops).
Folded fold(String s) {
  var folded = '';
  final start = <int>[], end = <int>[];
  var i = 0;
  for (final rune in s.runes) {
    final ch = String.fromCharCode(rune);
    final len = ch.length;
    var f = ch == 'ß' || ch == 'ẞ' ? 'ss' : ch.toLowerCase();
    f = _accents[f] ?? f;
    if (f == 'e' && folded.isNotEmpty && 'aou'.contains(folded[folded.length - 1]) && end.last == i) {
      end[end.length - 1] = i + len;
      f = '';
    }
    for (var k = 0; k < f.length; k++) {
      start.add(i);
      end.add(i + len);
    }
    folded += f;
    i += len;
  }
  return Folded(folded, start, end);
}

/// The query folded (spaces collapsed).
String foldQuery(String q) => fold(q.trim().replaceAll(RegExp(r'\s+'), ' ')).text;

/// Where [query] is in [haystack] as `(from, to)` in the original, or null.
(int, int)? findMatch(String haystack, String query) {
  final q = foldQuery(query);
  if (q.isEmpty) return null;
  final f = fold(haystack);
  final at = f.text.indexOf(q);
  if (at < 0) return null;
  return (f.start[at], f.end[at + q.length - 1]);
}

/// Boards whose title or creator matches [query] (web: `findMatch(title) || findMatch(createdByName)`).
bool boardMatches(StachelBoardInfo b, String query) =>
    findMatch(b.title, query) != null || findMatch(b.createdByName, query) != null;

// ---- times (web `ui/time.ts`, `pages/trashTime.ts`) -------------------------------------------------------------

const _months = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sept.', 'Okt.', 'Nov.', 'Dez.'];

/// „gerade eben“, „vor 5 Min.“, „vor 2 Std.“, „gestern“, „vor 3 Tagen“, „12. Okt.“ (with year after 300 days).
String relativeTime(DateTime t, {DateTime? now}) {
  final n = now ?? DateTime.now();
  final s = ((n.millisecondsSinceEpoch - t.millisecondsSinceEpoch) / 1000).round().clamp(0, 1 << 52);
  if (s < 45) return 'gerade eben';
  final m = (s / 60).round();
  if (m < 60) return 'vor $m Min.';
  final h = (m / 60).round();
  if (h < 24) return 'vor $h Std.';
  final d = (h / 24).round();
  if (d == 1) return 'gestern';
  if (d < 7) return 'vor $d Tagen';
  final l = t.toLocal();
  return '${l.day}. ${_months[l.month - 1]}${d > 300 ? ' ${l.year}' : ''}';
}

/// Whole days until the board is deleted for good (rounded up, never negative).
int trashDaysLeft(DateTime purgeAt, {DateTime? now}) {
  final ms = purgeAt.millisecondsSinceEpoch - (now ?? DateTime.now()).millisecondsSinceEpoch;
  return ms <= 0 ? 0 : (ms / Duration.millisecondsPerDay).ceil();
}

/// „Wird endgültig gelöscht in 29 Tagen“ / „… in 1 Tag“ / „Wird heute endgültig gelöscht“.
String trashPurgeText(DateTime purgeAt, {DateTime? now}) {
  final n = trashDaysLeft(purgeAt, now: now);
  if (n == 0) return 'Wird heute endgültig gelöscht';
  return 'Wird endgültig gelöscht in $n ${n == 1 ? 'Tag' : 'Tagen'}';
}

/// „30. Okt. 2026, 14:05“ (web `fullDate`).
String fullDate(DateTime t) {
  final l = t.toLocal();
  String two(int v) => v.toString().padLeft(2, '0');
  return '${l.day}. ${_months[l.month - 1]} ${l.year}, ${two(l.hour)}:${two(l.minute)}';
}

/// Who may delete a board (web `canDelete`): its creator or the Orga; unknown person → let the server decide.
bool mayDeleteBoard(StachelBoardInfo b, StachelUser? me) => me == null || me.isOrga || b.createdBy == me.key;

/// Text below a disabled „Löschen“ (web `DELETE_REASON`).
const stachelDeleteReason = 'Nur wer es angelegt hat oder zur Orga gehört.';

/// The same with roles (instances with own accounts): deleting is the owner's (`ROUTE_ROLES`, server `forbiddenText`).
const stachelOwnerDeleteReason = 'Nur die Besitzerin bzw. der Besitzer des Boards.';

/// Text below disabled trash actions (web `MANAGE_REASON`).
const stachelManageReason = 'Nur wer es angelegt oder gelöscht hat oder die Orga.';
