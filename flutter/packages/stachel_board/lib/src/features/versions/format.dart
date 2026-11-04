import 'dart:ui' show Color;

import 'admin_host.dart';

// Texts of the version history: day groups, times and descriptions (port of the web's `features/versions/format.ts`,
// same results – see test/features/versions/versions_test.dart, which mirrors the web's versions.test.ts). All times
// are shown in local time like the browser does.

String _pad(int n) => n.toString().padLeft(2, '0');

/// Calendar day in local time, e.g. „2026-10-30“.
String dayKey(DateTime d) {
  final l = d.toLocal();
  return '${l.year}-${_pad(l.month)}-${_pad(l.day)}';
}

const _weekdays = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const _months = [
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

/// „Heute“, „Gestern“, otherwise „Mittwoch, 28. Oktober“ (with the year when it is not this year).
String dayLabel(DateTime d, {DateTime? now}) {
  final n = (now ?? DateTime.now()).toLocal();
  final l = d.toLocal();
  if (dayKey(l) == dayKey(n)) return 'Heute';
  if (dayKey(l) == dayKey(DateTime(n.year, n.month, n.day - 1))) return 'Gestern';
  final s = '${_weekdays[l.weekday - 1]}, ${l.day}. ${_months[l.month - 1]}';
  return l.year == n.year ? s : '$s ${l.year}';
}

/// „14:20“
String timeLabel(DateTime d) {
  final l = d.toLocal();
  return '${_pad(l.hour)}:${_pad(l.minute)}';
}

/// „28.10., 14:20“ (with the year when it is not this year: „3.3.2025, 08:00“).
String stamp(DateTime d, {DateTime? now}) {
  final n = (now ?? DateTime.now()).toLocal();
  final l = d.toLocal();
  return '${l.day}.${l.month}.${l.year == n.year ? '' : l.year}, ${timeLabel(l)}';
}

/// „heute, 14:20“, „gestern, 9:05“ or „28.10., 14:20“ – for hints and the preview bar.
String whenLabel(DateTime d, {DateTime? now}) {
  final day = dayLabel(d, now: now);
  if (day == 'Heute' || day == 'Gestern') return '${day.toLowerCase()}, ${timeLabel(d)}';
  return stamp(d, now: now);
}

/// Versions of one calendar day.
class VersionDayGroup {
  VersionDayGroup(this.key, this.label);
  final String key;
  final String label;
  final items = <BoardVersion>[];
}

/// Versions (newest first) grouped by calendar day.
List<VersionDayGroup> groupByDay(List<BoardVersion> list, {DateTime? now}) {
  final groups = <VersionDayGroup>[];
  for (final v in list) {
    final key = dayKey(v.createdAt);
    if (groups.isEmpty || groups.last.key != key) groups.add(VersionDayGroup(key, dayLabel(v.createdAt, now: now)));
    groups.last.items.add(v);
  }
  return groups;
}

String _names(List<VersionPerson> people) {
  final n = [
    for (final p in people)
      () {
        final first = p.name.split(RegExp(r'\s+')).first;
        return first.isEmpty ? p.name : first;
      }(),
  ];
  return n.length <= 2 ? n.join(' und ') : '${n.take(2).join(', ')} und ${n.length - 2} weitere';
}

/// Second line of an entry: what this version is.
String describeVersion(BoardVersion v, {DateTime? now}) {
  switch (v.kind) {
    case 'manual':
      return v.by != null ? 'Gespeichert von ${v.by!.name}' : 'Gespeichert';
    case 'backup':
      return 'Sicherung vor dem Wiederherstellen';
    case 'restored':
      final from = v.restoredFrom;
      final what = from != null ? 'den Stand von ${whenLabel(from, now: now)}' : 'eine Version';
      return '${v.by?.name ?? 'Jemand'} hat $what wiederhergestellt';
    default:
      return v.people.isNotEmpty ? 'Bearbeitet von ${_names(v.people)}' : 'Automatisch gesichert';
  }
}

/// People for the avatars: who changed it, plus who saved/restored (no duplicates).
List<VersionPerson> peopleOf(BoardVersion v) {
  final out = [...v.people];
  final by = v.by;
  if (by != null && !out.any((p) => p.key == by.key)) out.add(by);
  return out;
}

/// „1 Objekt“, „3 Objekte“
String objectsLabel(int n) => n == 1 ? '1 Objekt' : '$n Objekte';

// ---- people (web `board/colors.ts`) ---------------------------------------------------------------------------------

/// The web's `USER_COLORS` (`shared/protocol.ts`).
const userColors = [
  Color(0xFFEC4E92),
  Color(0xFF1763B5),
  Color(0xFF7AA21B),
  Color(0xFFE8590C),
  Color(0xFF7048E8),
  Color(0xFF0C8599),
  Color(0xFFC2255C),
  Color(0xFF5C940D),
];

/// Deterministic color of a user key (FNV-1a over the UTF-16 code units, like the web's `userColor`).
Color userColor(String key) {
  var h = 0x811c9dc5;
  for (final c in key.codeUnits) {
    h = (h ^ c) & 0xffffffff;
    h = (h * 0x01000193) & 0xffffffff;
  }
  return userColors[h % userColors.length];
}

/// Initials like the web's `initials`: „Mara Lindner“ → „ML“, „Mara“ → „MA“, nothing usable → „?“.
String initials(String name) {
  final parts = name
      .replaceAll(RegExp(r'[^\p{L}\p{N}\s-]', unicode: true), ' ')
      .trim()
      .split(RegExp(r'[\s-]+'))
      .where((p) => p.isNotEmpty)
      .toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return (parts[0].length > 2 ? parts[0].substring(0, 2) : parts[0]).toUpperCase();
  return (parts.first[0] + parts.last[0]).toUpperCase();
}
