import 'dart:convert';
import 'dart:math' as math;

import '../../model/board_object.dart';
import '../../web/web_constants.dart';
import 'template_previews.g.dart';

// Templates and „Einfügen als …“ without widgets (package P3): the gallery's list from the web constants
// (`templates.list`: id, name, description, category, contents), the objects of every template for the previews
// (`template_previews.g.dart`, built by the web code), and a port of the web's `paste-model.ts` (table data / lines) so
// the app knows when to ask. Inserting runs on the server (`structure.template`, `structure.paste`).

/// A template of the gallery.
class BoardTemplate {
  const BoardTemplate({
    required this.id,
    required this.name,
    required this.desc,
    required this.category,
    required this.contains,
    this.keywords = const [],
  });
  final String id;
  final String name;
  final String desc;
  final String category;

  /// Extra search words of the gallery (web `Template.keywords`).
  final List<String> keywords;

  /// Objects per type (`{"card": 7, "frame": 1}`).
  final Map<String, int> contains;
}

WebConstants get _wc => WebConstants.instance;

/// Categories of the gallery (Planung, Ideen, Abläufe, Events).
List<String> get templateCategories => _wc.strings('templates.categories');

/// All templates in the web's order.
List<BoardTemplate> get boardTemplates => [
  for (final m in _wc.maps('templates.list'))
    BoardTemplate(
      id: m['id'] as String? ?? '',
      name: m['name'] as String? ?? '',
      desc: m['desc'] as String? ?? '',
      category: m['category'] as String? ?? '',
      keywords: [
        if (m['keywords'] is List)
          for (final k in m['keywords'] as List)
            if (k is String) k,
      ],
      contains: {
        if (m['contains'] is Map)
          for (final e in (m['contains'] as Map).entries)
            if (e.value is num) '${e.key}': (e.value as num).toInt(),
      },
    ),
];

/// Text the gallery searches in (web `searchText`: name, description, category, keywords; lower case).
String templateSearchText(BoardTemplate t) => [t.name, t.desc, t.category, ...t.keywords].join(' ').toLowerCase();

/// Templates matching category [cat] (null = all) and the search [q] (like the web's `matchesSearch`).
List<BoardTemplate> filterTemplates(String? cat, String q) {
  final needle = q.trim().toLowerCase();
  return [
    for (final t in boardTemplates)
      if ((cat == null || t.category == cat) && (needle.isEmpty || templateSearchText(t).contains(needle))) t,
  ];
}

const _kinds = [
  ('frame', 'Rahmen', 'Rahmen'),
  ('card', 'Karte', 'Karten'),
  ('sticky', 'Haftnotiz', 'Haftnotizen'),
  ('table', 'Tabelle', 'Tabellen'),
  ('timeline', 'Zeitleiste', 'Zeitleisten'),
  ('mindnode', 'Thema', 'Themen'),
  ('shape', 'Form', 'Formen'),
  ('connector', 'Verbinder', 'Verbinder'),
];

/// „1 Rahmen“, „7 Karten“ … (web `contents`, only these kinds, in this order).
List<String> templateContents(BoardTemplate t) => [
  for (final (type, one, many) in _kinds)
    if ((t.contains[type] ?? 0) > 0) '${t.contains[type]} ${t.contains[type] == 1 ? one : many}',
];

Map<String, List<BoardObject>>? _previews;

/// Objects of template [id] for its preview (paint order = the template's order).
List<BoardObject> templateObjects(String id) {
  final all = _previews ??= () {
    final j = jsonDecode(templatePreviewsJson) as Map<String, Object?>;
    final t = j['templates'] as Map<String, Object?>? ?? const {};
    return {
      for (final e in t.entries)
        e.key: [
          for (final (i, o) in ((e.value as List?) ?? const []).indexed)
            if (o is Map) BoardObject({...o.cast<String, Object?>(), 'z': 'a${'$i'.padLeft(5, '0')}'}),
        ],
    };
  }();
  return all[id] ?? const [];
}

// ---- „Einfügen als …“ (port of paste-model.ts) ----------------------------------------------------------------------

int get pasteMaxNotes => (_wc.number('paste.maxNotes') ?? 200).round();

String _clean(String text) => text.replaceAll(RegExp(r'\r\n?'), '\n').replaceFirst(RegExp(r'\n+$'), '');

/// Non-empty lines (web `pasteLines`).
List<String> pasteLines(String text) => [
  for (final l in _clean(text).split('\n'))
    if (l.trim().isNotEmpty) l.trim(),
];

/// Table data (tab separated like Excel/Google Sheets, fields with line breaks in "…"), else null; at least one row
/// with two columns (web `parseTsv`).
List<List<String>>? parseTsv(String text) {
  final s = _clean(text);
  if (!s.contains('\t')) return null;
  final rows = <List<String>>[];
  var row = <String>[];
  var i = 0;
  while (i <= s.length) {
    final cell = StringBuffer();
    if (i < s.length && s[i] == '"') {
      i++;
      while (i < s.length) {
        if (s[i] == '"' && i + 1 < s.length && s[i + 1] == '"') {
          cell.write('"');
          i += 2;
        } else if (s[i] == '"') {
          i++;
          break;
        } else {
          cell.write(s[i++]);
        }
      }
      while (i < s.length && s[i] != '\t' && s[i] != '\n') {
        cell.write(s[i++]);
      }
    } else {
      while (i < s.length && s[i] != '\t' && s[i] != '\n') {
        cell.write(s[i++]);
      }
    }
    row.add(cell.toString().trim());
    if (i >= s.length || s[i] == '\n') {
      rows.add(row);
      row = [];
    }
    i++;
  }
  if (!rows.any((r) => r.length > 1)) return null;
  final cols = rows.fold<int>(0, (m, r) => math.max(m, r.length));
  return [
    for (final r in rows) [...r, for (var k = r.length; k < cols; k++) ''],
  ];
}

/// What „Einfügen als …“ offers for [text]; null = no question (one line, no table data – a single note).
({List<List<String>>? table, List<String> lines})? pasteChoice(String text) {
  final table = parseTsv(text);
  final lines = pasteLines(text);
  if (table == null && lines.length < 2) return null;
  return (table: table, lines: lines);
}

/// Number of notes „N Haftnotizen“ creates.
int pasteNotesCount(({List<List<String>>? table, List<String> lines}) c) {
  final n = c.table != null ? c.table!.expand((r) => r).where((x) => x.isNotEmpty).length : c.lines.length;
  return math.min(pasteMaxNotes, n);
}
