import '../../model/board_object.dart';
import '../search/search_model.dart';

// Q3 „Bedienung“: what the app shows before it asks the server – which objects can be clustered or change their type
// (web `features/tools/cluster.ts` `clusterUnits`, `convert.ts` `convertTargets`) and the count preview of „Suchen &
// Ersetzen“ (web `replace.ts` `findAll`/`replaceFields`/`replacePreview`, same folding as the search). The change itself
// always runs on the server with the web code (`tools.cluster`, `tools.convert`, `tools.replace`).

// ---- clustering --------------------------------------------------------------------------------------------------

/// What takes part in clustering (web `clusterable`): no connectors, frames, mind map nodes, nothing locked.
bool clusterable(BoardObject o) => o.type != 'connector' && o.type != 'frame' && o.type != 'mindnode' && !o.locked;

/// Number of units of the selection (a group counts once, web `clusterUnits`).
int clusterUnitCount(Iterable<BoardObject> selected) {
  final groups = <String>{};
  var n = 0;
  for (final o in selected) {
    if (!clusterable(o)) continue;
    final g = o.groupId;
    if (g == null) {
      n++;
    } else if (groups.add(g)) {
      n++;
    }
  }
  return n;
}

/// Clustering needs at least two units.
bool canCluster(Iterable<BoardObject> selected) => clusterUnitCount(selected) >= 2;

/// Ways to cluster (web `CLUSTER_LABELS`): argument `by` and label.
const clusterModes = [('color', 'Nach Farbe'), ('tag', 'Nach Tag'), ('author', 'Nach Autor:in')];

// ---- type switch -------------------------------------------------------------------------------------------------

/// Types an object can change between (web `CONVERT_TYPES`) and their names.
const convertTypes = ['sticky', 'shape', 'text', 'card'];
const convertLabels = {'sticky': 'Haftnotiz', 'shape': 'Form', 'text': 'Text', 'card': 'Karte'};

/// Targets for the selection (web `convertTargets`): all four without the common type; none if anything cannot change.
List<String> convertTargets(List<BoardObject> selected) {
  if (selected.isEmpty || selected.any((o) => o.locked || !convertTypes.contains(o.type))) return const [];
  final same = selected.every((o) => o.type == selected.first.type) ? selected.first.type : null;
  return [
    for (final t in convertTypes)
      if (t != same) t,
  ];
}

// ---- find & replace ----------------------------------------------------------------------------------------------

/// All matches (no overlap) as `(from, to)` in the original (web `findAll`).
List<(int, int)> findAll(String text, String query) {
  final q = foldQuery(query);
  if (q.isEmpty || text.isEmpty) return const [];
  final f = fold(text);
  final out = <(int, int)>[];
  var at = f.text.indexOf(q);
  while (at >= 0) {
    out.add((f.start[at], f.end[at + q.length - 1]));
    at = f.text.indexOf(q, at + q.length);
  }
  return out;
}

const _richTypes = {'sticky', 'text', 'shape', 'connector'};

/// Texts that „Ersetzen“ changes (web `replaceFields`): text of notes/texts/shapes/connector labels, frame title, card
/// title and description – not tags, tables, mind maps.
List<String> replaceTexts(BoardObject o) {
  String s(Object? v) => v is String ? v : '';
  if (_richTypes.contains(o.type)) return [s(o.raw['text'])];
  if (o.type == 'frame') return [s(o.raw['title'])];
  if (o.type == 'card') return [s(o.raw['text']), s(o.raw['desc'])];
  return const [];
}

/// Number of replaceable matches in [o].
int replaceCount(BoardObject o, String query) => replaceTexts(o).fold(0, (n, t) => n + findAll(t, query).length);

/// Preview „3 Stellen in 2 Objekten“ (web `replacePreview`): matches and objects that will change, matches in locked
/// objects (stay).
({int total, int objects, int locked}) replacePreview(Iterable<BoardObject> objects, String query) {
  var total = 0, count = 0, locked = 0;
  for (final o in objects) {
    final n = replaceCount(o, query);
    if (n == 0) continue;
    if (o.locked) {
      locked += n;
    } else {
      total += n;
      count++;
    }
  }
  return (total: total, objects: count, locked: locked);
}

/// Text of the preview (web `replacePreviewText`).
String replacePreviewText(({int total, int objects, int locked}) p) {
  if (p.total == 0 && p.locked == 0) return 'Keine Stelle zum Ersetzen';
  final main =
      '${p.total == 1 ? '1 Stelle' : '${p.total} Stellen'} in ${p.objects == 1 ? '1 Objekt' : '${p.objects} Objekten'}';
  return p.locked > 0 ? '$main, ${p.locked} gesperrt' : main;
}

// ---- command palette ---------------------------------------------------------------------------------------------

/// Score of [label] for [query] (web `filterCommands`): 0 = starts with it, 1 = a word starts with it, 2 = inside,
/// null = no match (label or [group]).
int? commandScore(String label, String group, String query) {
  final q = foldQuery(query);
  if (q.isEmpty) return 0;
  if (findMatch('$label $group', query) == null) return null;
  final f = fold(label).text;
  if (f.startsWith(q)) return 0;
  if (RegExp('(^|[\\s›(„-])${RegExp.escape(q)}').hasMatch(f)) return 1;
  return 2;
}
