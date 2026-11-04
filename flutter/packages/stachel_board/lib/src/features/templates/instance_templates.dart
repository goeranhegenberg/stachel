import '../../model/board_object.dart';
import 'own_templates.dart' show maxOwnObjects;

// Templates of the instance (web `templates/packApi.ts`, contract §3 „Vorlagen der Instanz“): whoever runs the instance
// puts template files on the server; `GET /api/templates/instance` lists them with the instance's category. The gallery
// shows that category (before „Meine Vorlagen“) only when there are templates, and inserts them like own templates
// (clipboard format, web action `structure.insert`). The app reaches the route through its host.

/// The host's access to `GET /api/templates/instance` (stachel_client implements it; without it the gallery has no
/// templates of the instance). Raw JSON like the server answers: `{ok, category, templates: [{id, name, desc, keywords,
/// objects}]}`.
abstract interface class InstanceTemplatesHost {
  Future<Object?> instanceTemplates();
}

/// Category when the server names none (web `packFromServer`).
const instanceCategoryFallback = 'Weitere Vorlagen';

/// A template of the instance.
class InstanceTemplate {
  const InstanceTemplate({
    required this.id,
    required this.name,
    required this.desc,
    required this.keywords,
    required this.raw,
  });
  final String id;
  final String name;
  final String desc;
  final List<String> keywords;

  /// The objects (clipboard format).
  final List<Map<String, Object?>> raw;

  /// Objects for the preview (paint order = stored order).
  List<BoardObject> get objects => [
    for (final (i, o) in raw.indexed) BoardObject({...o, 'z': 'a${'$i'.padLeft(5, '0')}'}),
  ];
}

/// What `GET /api/templates/instance` brought: [category] null = no templates of the instance.
class InstanceTemplates {
  const InstanceTemplates({required this.category, required this.list});
  static const empty = InstanceTemplates(category: null, list: []);

  final String? category;
  final List<InstanceTemplate> list;

  /// The server's answer, tolerant like the web's `packFromServer`: templates without ID, name or objects fall away;
  /// no templates = no category.
  static InstanceTemplates fromJson(Object? j) {
    if (j is! Map) return empty;
    final list = <InstanceTemplate>[];
    for (final t in (j['templates'] is List ? j['templates'] as List : const [])) {
      if (t is! Map || t['id'] is! String || t['name'] is! String) continue;
      final raw = <Map<String, Object?>>[
        for (final o in (t['objects'] is List ? t['objects'] as List : const []).take(maxOwnObjects))
          if (o is Map && o['id'] is String && o['type'] is String) o.cast<String, Object?>(),
      ];
      if (raw.isEmpty) continue;
      list.add(
        InstanceTemplate(
          id: t['id'] as String,
          name: t['name'] as String,
          desc: t['desc'] is String ? t['desc'] as String : '',
          keywords: [
            if (t['keywords'] is List)
              for (final k in t['keywords'] as List)
                if (k is String) k,
          ],
          raw: raw,
        ),
      );
    }
    final c = j['category'] is String ? (j['category'] as String).trim() : '';
    return InstanceTemplates(category: list.isEmpty ? null : (c.isEmpty ? instanceCategoryFallback : c), list: list);
  }
}

/// Does [t] match the gallery's search (web `packMatches`: name, description, category, keywords)?
bool instanceTemplateMatches(InstanceTemplate t, String category, String q) {
  final needle = q.trim().toLowerCase();
  return needle.isEmpty || [t.name, t.desc, category, ...t.keywords].join(' ').toLowerCase().contains(needle);
}
