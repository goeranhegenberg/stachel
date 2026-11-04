import '../../web/web_constants.dart';

// The web's shape library (`features/shapes/catalog.ts`) from the web constants (audit §3.3): entries with name,
// kind, start size, section and search words; the search (`normalize`/`matches`); the shape kinds in the order of
// the web's shape registry (`editor/core/shapeKinds.tsx` + `features/shapes/kinds.tsx`).

class ShapeEntry {
  const ShapeEntry({
    required this.id,
    required this.label,
    required this.kind,
    required this.w,
    required this.h,
    required this.section,
    this.keys = '',
  });

  final String id;
  final String label;
  final String kind;
  final double w;
  final double h;

  /// `basic`, `arrows`, `flow`.
  final String section;

  /// More search words (lower case).
  final String keys;
}

/// All library entries (49) in the web's order.
final List<ShapeEntry> shapeEntries = [
  for (final e in WebConstants.instance.maps('shapes.entries'))
    ShapeEntry(
      id: e['id'] as String,
      label: e['label'] as String,
      kind: e['kind'] as String,
      w: (e['w'] as num).toDouble(),
      h: (e['h'] as num).toDouble(),
      section: e['section'] as String,
      keys: (e['keys'] as String?) ?? '',
    ),
];

/// Sections of the library: (id, „Grundformen“ …).
final List<(String, String)> shapeSections = [
  for (final s in WebConstants.instance.maps('shapes.sections')) (s['id'] as String, s['label'] as String),
];

ShapeEntry? entryById(String? id) => shapeEntries.where((e) => e.id == id).firstOrNull;

/// First library entry of a kind (name and size, web `entryOfKind`).
ShapeEntry? entryOfKind(String? kind) => shapeEntries.where((e) => e.kind == kind).firstOrNull;

/// Search like the web: lower case, ä/ö/ü/ß as ae/oe/ue/ss, trimmed.
String normalizeSearch(String s) =>
    s.toLowerCase().replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue').replaceAll('ß', 'ss').trim();

/// Every word of [query] occurs in one of [fields] (empty query: all).
bool searchMatches(String query, List<String?> fields) {
  final q = normalizeSearch(query);
  if (q.isEmpty) return true;
  final hay = normalizeSearch(fields.whereType<String>().where((f) => f.isNotEmpty).join(' '));
  return q.split(RegExp(r'\s+')).every(hay.contains);
}

List<ShapeEntry> searchShapes(String query) => [
  for (final e in shapeEntries)
    if (searchMatches(query, [e.label, e.keys, e.kind])) e,
];

/// Quick choice of the shape tool (web `QUICK` in `library.tsx`), entry ids.
const quickShapeIds = [
  'rect',
  'roundrect',
  'circle',
  'triangle',
  'diamond',
  'star',
  'arrowRight',
  'callout',
  'cloud',
  'cylinder',
];

/// The core kinds with their own names (web `editor/core/shapeKinds.tsx`).
const _coreKinds = [('rect', 'Rechteck'), ('ellipse', 'Ellipse'), ('diamond', 'Raute'), ('triangle', 'Dreieck')];

/// All 41 shape kinds in the order of the web's shape registry: the 4 core kinds, then the library's kinds in entry
/// order, named after their first entry („Form ändern“, E05).
final List<(String kind, String label)> shapeKindList = () {
  final core = {for (final (k, _) in _coreKinds) k};
  final out = [..._coreKinds];
  final seen = <String>{...core};
  for (final e in shapeEntries) {
    if (seen.add(e.kind)) out.add((e.kind, e.label));
  }
  return out;
}();

/// German name of a kind (core name or first library entry).
String shapeKindLabel(String? kind) {
  for (final (k, l) in shapeKindList) {
    if (k == (kind ?? 'rect')) return l;
  }
  return kind ?? 'Rechteck';
}

/// Kinds matching [query] (web `KindPop`: name and the first entry's search words).
List<(String, String)> searchKinds(String query) => [
  for (final (k, l) in shapeKindList)
    if (searchMatches(query, [l, entryOfKind(k)?.keys])) (k, l),
];
