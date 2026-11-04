/// Comments, reactions and @mentions of a board (E3) – read from the feature structures the native API sends in `ext`
/// (`collab.comments`, `collab.reactions`, `collab.reads`; format: `stachel/docs/features/collab.md`), tolerant like
/// the web module (`web/src/features/collab/comments.ts`, `reactions.ts`, `mentions.ts`): broken or foreign entries
/// are skipped, never removed.
library;

import 'dart:ui';

import 'board_object.dart';

/// Names of the feature structures.
const commentsExt = 'collab.comments';
const reactionsExt = 'collab.reactions';
const readsExt = 'collab.reads';

/// Awareness field of running image uploads (others see „Mara lädt hoch …“).
const uploadsAwareness = 'collab.uploads';

/// Reactions offered like the web (`EMOJIS`).
const reactionEmojis = ['👍', '❤️', '😂', '🎉', '🤔', '👀', '🔥', '✅', '❓', '🌵'];

double _num(Object? v) => v is num && v.isFinite ? v.toDouble() : 0;
String _str(Object? v, [String d = '']) => v is String ? v : d;

/// One message of a thread.
class CommentMessage {
  const CommentMessage({
    required this.id,
    required this.by,
    required this.name,
    required this.text,
    required this.at,
    this.mentions = const [],
    this.edited,
  });

  static CommentMessage? fromJson(Object? j) {
    if (j is! Map || j['id'] is! String || j['text'] is! String) return null;
    return CommentMessage(
      id: j['id'] as String,
      by: _str(j['by']),
      name: _str(j['name'], 'Unbekannt'),
      text: j['text'] as String,
      at: _str(j['at']),
      mentions: [
        for (final k in (j['mentions'] is List ? j['mentions'] as List : const []))
          if (k is String) k,
      ],
      edited: j['edited'] is String ? j['edited'] as String : null,
    );
  }

  final String id;

  /// user key of the author.
  final String by;
  final String name;
  final String text;

  /// ISO time.
  final String at;

  /// Mentioned user keys.
  final List<String> mentions;
  final String? edited;

  Map<String, Object?> toJson() => {
    'id': id,
    'by': by,
    'name': name,
    'text': text,
    'at': at,
    if (mentions.isNotEmpty) 'mentions': mentions,
    'edited': ?edited,
  };
}

/// A comment thread: pinned to an object ([objectId], offset [dx]/[dy] from its top left corner) or free on the board.
class CommentThread {
  const CommentThread({
    required this.id,
    required this.x,
    required this.y,
    this.objectId,
    this.dx = 0,
    this.dy = 0,
    this.resolved = false,
    this.resolvedBy,
    required this.createdBy,
    required this.createdAt,
    required this.messages,
  });

  final String id;
  final double x;
  final double y;
  final String? objectId;
  final double dx;
  final double dy;
  final bool resolved;
  final String? resolvedBy;
  final String createdBy;
  final String createdAt;
  final List<CommentMessage> messages;

  /// Latest activity (newest message or creation).
  String get lastActivity => messages.fold(createdAt, (a, m) => m.at.compareTo(a) > 0 ? m.at : a);

  /// Board position of the pin: follows the object (offset clamped to its size), else the stored point.
  Offset position(BoardObject? Function(String id) lookup) {
    final o = objectId == null ? null : lookup(objectId!);
    if (o == null) return Offset(x, y);
    return Offset(o.x + dx.clamp(0, o.w), o.y + dy.clamp(0, o.h));
  }
}

/// Threads from `ext['collab.comments']` (map thread id → thread JSON); threads without readable messages are skipped.
List<CommentThread> readThreads(Object? raw) {
  if (raw is! Map) return const [];
  final out = <CommentThread>[];
  raw.forEach((id, t) {
    if (id is! String || t is! Map) return;
    final messages = [for (final m in (t['messages'] is List ? t['messages'] as List : const [])) ?CommentMessage.fromJson(m)];
    if (messages.isEmpty) return;
    out.add(
      CommentThread(
        id: id,
        x: _num(t['x']),
        y: _num(t['y']),
        objectId: t['objectId'] is String ? t['objectId'] as String : null,
        dx: _num(t['dx']),
        dy: _num(t['dy']),
        resolved: t['resolved'] == true,
        resolvedBy: t['resolvedBy'] is String ? t['resolvedBy'] as String : null,
        createdBy: _str(t['createdBy'], messages.first.by),
        createdAt: _str(t['createdAt'], messages.first.at),
        messages: messages,
      ),
    );
  });
  return out;
}

/// Mentions of [me] newer than [readAt] (own messages do not count), newest first (web `unreadMentions`).
List<(CommentThread, CommentMessage)> unreadMentions(List<CommentThread> threads, String me, String? readAt) {
  final out = <(CommentThread, CommentMessage)>[];
  for (final t in threads) {
    for (final m in t.messages) {
      if (m.by != me && m.mentions.contains(me) && (readAt == null || m.at.compareTo(readAt) > 0)) out.add((t, m));
    }
  }
  out.sort((a, b) => b.$2.at.compareTo(a.$2.at));
  return out;
}

/// Read state of [me] (`collab.reads`).
String? readStateOf(Map<String, Object?> ext, String me) {
  final r = ext[readsExt];
  return r is Map && r[me] is String ? r[me] as String : null;
}

/// A person (for mentions, reactions).
class Person {
  const Person(this.key, this.name);
  final String key;
  final String name;

  @override
  bool operator ==(Object other) => other is Person && other.key == key && other.name == name;
  @override
  int get hashCode => Object.hash(key, name);
}

/// Reactions of one emoji on one object.
class ReactionGroup {
  ReactionGroup(this.emoji);
  final String emoji;
  final people = <Person>[];
  bool mine = false;
}

/// Reactions per object from `ext['collab.reactions']` (key `objectId|emoji|userKey`), emojis in the order of their
/// first reaction (web `reactionsByObject`).
Map<String, List<ReactionGroup>> reactionsByObject(Object? raw, String me) {
  if (raw is! Map) return const {};
  final rows = <({String o, String e, String u, String n, String at})>[];
  for (final r in raw.values) {
    if (r is Map && r['o'] is String && r['e'] is String) {
      rows.add((o: r['o'] as String, e: r['e'] as String, u: _str(r['u']), n: _str(r['n'], 'Unbekannt'), at: _str(r['at'])));
    }
  }
  rows.sort((a, b) => a.at.compareTo(b.at));
  final out = <String, List<ReactionGroup>>{};
  for (final r in rows) {
    final groups = out.putIfAbsent(r.o, () => []);
    var g = groups.where((x) => x.emoji == r.e).firstOrNull;
    if (g == null) groups.add(g = ReactionGroup(r.e));
    g.people.add(Person(r.u, r.n));
    if (r.u == me) g.mine = true;
  }
  return out;
}

/// „Mara Lindner, Jonas Keller und du“ (web `peopleText`).
String peopleText(List<Person> people, String me) {
  final names = [for (final p in people) if (p.key != me) p.name];
  if (people.any((p) => p.key == me)) names.add('du');
  if (names.length <= 1) return names.isEmpty ? '' : names.first;
  return '${names.sublist(0, names.length - 1).join(', ')} und ${names.last}';
}

/// Who reacted with a chip's emoji, like the web's chip tooltip („Mara Lindner und du haben mit 👍 reagiert“).
String reactionNames(ReactionGroup g, String me) =>
    '${peopleText(g.people, me)} ${g.people.length == 1 && !g.mine ? 'hat' : 'haben'} mit ${g.emoji} reagiert'
        .replaceFirst(RegExp(r'^du haben'), 'Du hast');

// ---- @mentions (port of web/src/features/collab/mentions.ts) ------------------------------------------------------

/// Open mention before the caret („… @Ma|“): start of the `@` and the query typed so far.
({int start, String query})? mentionQuery(String text, int caret) {
  if (caret < 0 || caret > text.length) return null;
  final before = text.substring(0, caret);
  final at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !RegExp(r'[\s(\[{"„]').hasMatch(before[at - 1])) return null;
  final query = before.substring(at + 1);
  if (query.length > 30 || RegExp(r'[\n@]').hasMatch(query) || RegExp(r'\s{2}').hasMatch(query)) return null;
  return (start: at, query: query);
}

/// The mention is complete („@Lena␠“): no suggestions any more.
bool mentionDone(String query, List<Person> people) {
  if (!RegExp(r'\s$').hasMatch(query)) return false;
  final q = query.trim().toLowerCase();
  return q.isNotEmpty && people.any((p) => p.name.trim().toLowerCase() == q);
}

/// Matching people (start of first or last name first).
List<Person> matchPeople(List<Person> people, String query, {int limit = 6}) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty) return people.take(limit).toList();
  final scored = <(Person, int)>[];
  for (final p in people) {
    final n = p.name.toLowerCase();
    final score = n.startsWith(q) ? 0 : (n.split(RegExp(r'[\s-]+')).any((w) => w.startsWith(q)) ? 1 : (n.contains(q) ? 2 : -1));
    if (score >= 0) scored.add((p, score));
  }
  scored.sort((a, b) => a.$2 != b.$2 ? a.$2 - b.$2 : a.$1.name.compareTo(b.$1.name));
  return [for (final s in scored.take(limit)) s.$1];
}

/// Inserts `@name ` at the open mention; returns the new text and caret.
({String text, int caret}) insertMention(String text, int start, int caret, String name) {
  final ins = '@$name ';
  final after = text.substring(caret).replaceFirst(RegExp(r'^\S*'), '').replaceFirst(RegExp(r'^ '), '');
  return (text: text.substring(0, start) + ins + after, caret: start + ins.length);
}

final _wordChar = RegExp(r'[\p{L}\p{N}_]', unicode: true);
bool _isWord(String text, int i) => i >= 0 && i < text.length && _wordChar.hasMatch(text[i]);

List<({int start, int end, Person person})> _findMentions(String text, List<Person> people) {
  final sorted = [for (final p in people) if (p.name.trim().isNotEmpty) p]..sort((a, b) => b.name.length - a.name.length);
  final hits = <({int start, int end, Person person})>[];
  final lower = text.toLowerCase();
  for (var i = lower.indexOf('@'); i >= 0; i = lower.indexOf('@', i + 1)) {
    if (i > 0 && _isWord(text, i - 1)) continue;
    for (final p in sorted) {
      final n = p.name.toLowerCase();
      if (lower.startsWith(n, i + 1) && !_isWord(text, i + 1 + n.length)) {
        hits.add((start: i, end: i + 1 + n.length, person: p));
        break;
      }
    }
  }
  return hits;
}

/// User keys of everyone mentioned as „@Name“ in [text] (no duplicates).
List<String> extractMentions(String text, List<Person> people) => {for (final h in _findMentions(text, people)) h.person.key}.toList();

/// [text] split into parts, mentions marked with the person's key (for highlighting).
List<({String text, String? key})> splitMentions(String text, List<Person> people) {
  final out = <({String text, String? key})>[];
  var pos = 0;
  for (final h in _findMentions(text, people)) {
    if (h.start > pos) out.add((text: text.substring(pos, h.start), key: null));
    out.add((text: text.substring(h.start, h.end), key: h.person.key));
    pos = h.end;
  }
  if (pos < text.length) out.add((text: text.substring(pos), key: null));
  return out;
}

/// Anchor for a new comment at world point [p]: pinned to [hit] (not connectors/pen strokes), else free.
({double x, double y, String? objectId, double dx, double dy}) commentAnchor(Offset p, BoardObject? hit) {
  final x = p.dx.roundToDouble(), y = p.dy.roundToDouble();
  if (hit == null || hit.type == 'connector' || hit.type == 'pen') return (x: x, y: y, objectId: null, dx: 0, dy: 0);
  return (x: x, y: y, objectId: hit.id, dx: x - hit.x, dy: y - hit.y);
}
