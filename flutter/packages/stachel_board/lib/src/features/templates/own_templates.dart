import 'dart:convert';

import '../../model/board_object.dart';
import '../../model/board_state.dart';
import '../../render/board_scene.dart' show objectRect;

// Own templates („Auswahl als Vorlage speichern …“, package Q2; web `templates/own.ts`, `ownApi.ts`): the selection is
// stored on the server (`/api/templates`, per person, private) in the clipboard format (snapshot objects, rich text as
// `content` document) and inserted with the web action `structure.insert` like the gallery (middle of the view or the
// next free place, new IDs, references rewritten). The app reaches the REST routes through its host.

/// The host's REST access to `/api/templates` (stachel_client implements it; without it the gallery has no „Meine
/// Vorlagen“). Raw JSON like the server answers: `{id, name, createdAt, objects}`.
abstract interface class OwnTemplatesHost {
  Future<List<Object?>> listOwnTemplates();
  Future<Object?> saveOwnTemplate(String name, List<Map<String, Object?>> objects);
  Future<void> deleteOwnTemplate(String id);

  /// German text of an error of these calls.
  String errorText(Object error);
}

/// Category of the own templates in the gallery (web `OWN_CATEGORY`).
const ownCategory = 'Meine Vorlagen';

/// At most this many objects per own template (web `MAX_OWN_OBJECTS`, server).
const maxOwnObjects = 500;

/// Largest template: characters of the act's args `{json: "…"}` (web `MAX_OWN_ARGS_JSON`).
const maxOwnArgsJson = 250000;
const maxOwnName = 80;

/// An own template of the gallery.
class OwnTemplate {
  const OwnTemplate({required this.id, required this.name, required this.createdAt, required this.raw});
  final String id;
  final String name;
  final String createdAt;

  /// The stored objects (clipboard format).
  final List<Map<String, Object?>> raw;

  /// Objects for the preview (paint order = stored order).
  List<BoardObject> get objects => [
    for (final (i, o) in raw.indexed) BoardObject({...o, 'z': 'a${'$i'.padLeft(5, '0')}'}),
  ];

  static OwnTemplate? fromJson(Object? j) {
    if (j is! Map) return null;
    final id = j['id'], name = j['name'], objs = j['objects'];
    if (id is! String || name is! String || objs is! List) return null;
    return OwnTemplate(
      id: id,
      name: name,
      createdAt: j['createdAt'] is String ? j['createdAt'] as String : '',
      raw: [
        for (final o in objs)
          if (o is Map && o['id'] is String && o['type'] is String) o.cast<String, Object?>(),
      ],
    );
  }
}

/// What of the selection [ids] goes into the template, in paint order (web `templateFromSelection`): the selected
/// objects, everything lying completely inside selected frames, connectors whose both ends come along.
List<Map<String, Object?>> templateFromSelection(BoardState state, Iterable<String> ids) {
  final take = <String>{};
  final ordered = state.ordered;
  for (final id in ids) {
    final o = state[id];
    if (o == null) continue;
    take.add(id);
    if (o.type == 'frame') {
      final r = objectRect(o);
      for (final c in ordered) {
        if (c.type == 'frame' || c.type == 'connector') continue;
        final b = objectRect(c);
        if (b.left >= r.left && b.top >= r.top && b.right <= r.right && b.bottom <= r.bottom) take.add(c.id);
      }
    }
  }
  for (final c in ordered) {
    if (c.type != 'connector' || take.contains(c.id)) continue;
    final f = c.from, t = c.to;
    if (f is AttachedEnd && t is AttachedEnd && take.contains(f.objectId) && take.contains(t.objectId)) take.add(c.id);
  }
  return [
    for (final o in ordered)
      if (take.contains(o.id)) Map<String, Object?>.of(o.raw),
  ];
}

/// Size of the act's args (web `insertArgsSize`).
int insertArgsSize(List<Map<String, Object?>> objs) => jsonEncode({'json': jsonEncode(objs)}).length;

/// Name check (web `cleanTemplateName`): whitespace collapsed; null = empty or too long.
String? cleanTemplateName(String v) {
  final s = v.replaceAll(RegExp(r'\s+'), ' ').trim();
  return s.isNotEmpty && s.length <= maxOwnName ? s : null;
}

/// Why the selection cannot be saved (web `saveProblem`); null = fine.
String? saveProblem(List<Map<String, Object?>> objs) {
  if (objs.isEmpty) return 'Wähle zuerst aus, was in die Vorlage soll.';
  if (objs.length > maxOwnObjects) return 'Eine Vorlage hat höchstens $maxOwnObjects Objekte.';
  if (insertArgsSize(objs) > maxOwnArgsJson) return 'Die Auswahl ist zu groß für eine Vorlage.';
  return null;
}

/// Name suggestion (web `suggestName`): the first frame's title, else the first text line, else „Meine Vorlage“.
String suggestTemplateName(List<Map<String, Object?>> objs) {
  String? first(Object? v) {
    if (v is! String) return null;
    final s = v.split('\n').first.trim();
    return s.isEmpty ? null : s;
  }

  final frame = objs.where((o) => o['type'] == 'frame' && first(o['title']) != null).firstOrNull;
  final text = frame != null ? (frame['title'] as String) : objs.map((o) => first(o['text'])).nonNulls.firstOrNull;
  final s = text ?? 'Meine Vorlage';
  return s.length > maxOwnName ? s.substring(0, maxOwnName) : s;
}

/// Does [t] match the gallery's search (web `ownMatches`)?
bool ownMatches(OwnTemplate t, String q) {
  final needle = q.trim().toLowerCase();
  return needle.isEmpty || '${t.name} meine vorlagen'.toLowerCase().contains(needle);
}
