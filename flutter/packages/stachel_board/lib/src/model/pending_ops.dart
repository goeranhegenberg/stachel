import 'dart:math' as math;

import '../protocol/native_messages.dart';
import 'board_object.dart';
import 'collab.dart';
import 'rich_edit.dart';

/// One message of own changes the server has not confirmed yet (concept §3.5): shown right away (optimistic
/// overlay), sent when live, sent again after a reconnect with the same [req] (the server answers an already
/// executed `req` only with `ack`, contract §8.6), removed on `ack`/`nack`.
class PendingEntry {
  PendingEntry.ops(this.req, this.ops, {this.step = true, DateTime? at}) : kind = 'ops', at = at ?? DateTime.now();
  PendingEntry.history(this.req, this.kind) : ops = const [], step = false, at = DateTime.now();

  final int req;

  /// `ops`, `undo` or `redo`.
  final String kind;
  final List<BoardOp> ops;

  /// Close the undo step after this message (`step`): end of a gesture or a single action.
  final bool step;
  final DateTime at;

  /// Sent on the current connection (reset when the connection drops).
  bool sent = false;

  /// Sent at least once (the server may have executed it): never replace it by a coalesced newer state.
  bool sentOnce = false;

  /// Object IDs whose shown state this entry changes.
  late final Set<String> touched = {for (final op in ops) ...touchedBy(op)};

  Map<String, Object?> get message => kind == 'ops' ? opsMessage(req, ops) : {'t': kind, 'req': req};

  /// Changes a feature structure (comments, reactions …).
  bool get touchesExt => ops.any((o) => o is ExtOp);

  /// The web actions of this message (`act`, audit §3.2).
  Iterable<ActOp> get acts => ops.whereType<ActOp>();

  /// For the persisted queue (only `ops` entries are kept; undo/redo refer to a server history that may be gone).
  Map<String, Object?> toJson() => {
    'req': req,
    'step': step,
    'at': at.toUtc().toIso8601String(),
    'ops': [
      for (final o in ops)
        if (o is MindOp)
          {
            ...o.toJson(),
            'predicted': [for (final p in o.predicted) p.toJson()],
          }
        else if (o is ActOp)
          o.toStoredJson()
        else
          o.toJson(),
    ],
  };

  /// A persisted entry (null if broken); it may have reached the server before: never coalesce it.
  static PendingEntry? fromJson(Object? j) {
    if (j is! Map || j['req'] is! int || j['ops'] is! List) return null;
    final ops = <BoardOp>[];
    for (final o in j['ops'] as List) {
      final op = boardOpFromJson(o);
      if (op == null) return null;
      ops.add(op);
    }
    if (ops.isEmpty) return null;
    final at = j['at'] is String ? DateTime.tryParse(j['at'] as String) : null;
    return PendingEntry.ops(j['req'] as int, ops, step: j['step'] != false, at: at?.toLocal())..sentOnce = true;
  }
}

/// IDs an op changes.
Iterable<String> touchedBy(BoardOp op) => switch (op) {
  CreateOp(:final objects) => [for (final o in objects) ?(o['id'] is String ? o['id'] as String : null)],
  UpdateOp(:final patches) => patches.keys,
  RemoveOp(:final ids) => ids,
  OrderOp(:final ids) => ids,
  TextOp(:final id) => [id],
  MindOp(:final predicted) => predicted.expand(touchedBy),
  ActOp(:final predicted) => predicted.expand(touchedBy),
  ExtOp() => const [],
};

/// Applies [op] to the shown object [o] with [id] (null = not there); [zTop]/[zBottom] give temporary layer keys
/// for new objects and `order` until the server sends the real ones.
BoardObject? applyOp(
  BoardOp op,
  String id,
  BoardObject? o, {
  required String Function() zTop,
  required String Function() zBottom,
}) {
  switch (op) {
    case CreateOp(:final objects):
      if (o != null) return o; // already there (the server's version wins, `create` skips existing IDs)
      final raw = objects.firstWhere((x) => x['id'] == id, orElse: () => const {});
      if (raw.isEmpty) return o;
      return BoardObject({...raw, 'z': zTop()});
    case UpdateOp(:final patches):
      final p = patches[id];
      if (o == null || p == null) return o;
      final set = <String, Object?>{};
      final unset = <String>[];
      p.forEach((k, v) => v == null ? unset.add(k) : set[k] = v);
      return o.patched(set: set, unset: unset);
    case RemoveOp():
      return null;
    case OrderOp(:final toFront):
      return o?.patched(set: {'z': toFront ? zTop() : zBottom()});
    case TextOp(:final doc):
      return o?.patched(set: {'content': doc, 'text': pmPlainText(doc)});
    case MindOp(:final predicted) || ActOp(:final predicted):
      var r = o;
      for (final p in predicted) {
        if (!touchedBy(p).contains(id)) continue;
        // a node created by an earlier pending op: the prediction carries its whole new state (keep its layer)
        final cur = r;
        if (p is CreateOp && cur != null) {
          final raw = p.objects.firstWhere((x) => x['id'] == id);
          r = BoardObject({...raw, 'z': cur.z});
        } else {
          r = applyOp(p, id, r, zTop: zTop, zBottom: zBottom);
        }
      }
      return r;
    case ExtOp():
      return o;
  }
}

/// Applies a feature-structure op to the shown [ext] (optimistic, like the server's `collab` code would): returns the
/// new ext map (unchanged structures stay identical). [me] = own user key and name, [now] = ISO time.
Map<String, Object?> applyExtOp(
  ExtOp op,
  Map<String, Object?> ext, {
  required String me,
  required String name,
  required String now,
}) {
  Map<String, Object?> copyMap(Object? v) =>
      v is Map ? {for (final e in v.entries) '${e.key}': e.value} : <String, Object?>{};
  Map<String, Object?> thread(Map<String, Object?> comments, String id) => copyMap(comments[id]);
  List<Object?> messages(Map<String, Object?> t) => [...(t['messages'] is List ? t['messages'] as List : const [])];
  Map<String, Object?> msg(String id, String text, List<String> mentions) => {
    'id': id,
    'by': me,
    'name': name,
    'text': text,
    'at': now,
    if (mentions.isNotEmpty) 'mentions': mentions,
  };
  switch (op) {
    case CommentOp(:final thread, :final msg, :final at, :final text, :final mentions):
      final c = copyMap(ext[commentsExt]);
      if (c.containsKey(thread)) return ext;
      c[thread] = {
        'x': at.x,
        'y': at.y,
        if (at.objectId != null) ...{'objectId': at.objectId, 'dx': at.dx, 'dy': at.dy},
        'resolved': false,
        'createdBy': me,
        'createdAt': now,
        'messages': [
          {'id': msg, 'by': me, 'name': name, 'text': text, 'at': now, if (mentions.isNotEmpty) 'mentions': mentions},
        ],
      };
      return {...ext, commentsExt: c};
    case ReplyOp(thread: final id, msg: final mid, :final text, :final mentions):
      final c = copyMap(ext[commentsExt]);
      if (!c.containsKey(id)) return ext;
      final t = thread(c, id);
      final ms = messages(t);
      if (ms.any((m) => m is Map && m['id'] == mid)) return ext;
      t['messages'] = [...ms, msg(mid, text, mentions)];
      if (t['resolved'] == true) {
        t['resolved'] = false;
        t.remove('resolvedBy');
      }
      c[id] = t;
      return {...ext, commentsExt: c};
    case CommentEditOp(thread: final id, msg: final mid, :final text, :final mentions):
      final c = copyMap(ext[commentsExt]);
      if (!c.containsKey(id)) return ext;
      final t = thread(c, id);
      t['messages'] = [
        for (final m in messages(t))
          if (m is Map && m['id'] == mid && m['by'] == me)
            {
              ...copyMap(m)..remove('mentions'),
              'text': text,
              'edited': now,
              if (mentions.isNotEmpty) 'mentions': mentions,
            }
          else
            m,
      ];
      c[id] = t;
      return {...ext, commentsExt: c};
    case CommentDeleteOp(thread: final id, msg: final mid):
      final c = copyMap(ext[commentsExt]);
      if (!c.containsKey(id)) return ext;
      final t = thread(c, id);
      final ms = messages(t);
      final first = ms.isEmpty ? null : ms.first;
      if (mid == null || (first is Map && first['id'] == mid)) {
        if (first is Map && first['by'] != me) return ext;
        c.remove(id);
      } else {
        t['messages'] = [
          for (final m in ms)
            if (!(m is Map && m['id'] == mid && m['by'] == me)) m,
        ];
        c[id] = t;
      }
      return {...ext, commentsExt: c};
    case ResolveOp(thread: final id, :final resolved):
      final c = copyMap(ext[commentsExt]);
      if (!c.containsKey(id)) return ext;
      final t = thread(c, id)..['resolved'] = resolved;
      if (resolved) {
        t['resolvedBy'] = me;
      } else {
        t.remove('resolvedBy');
      }
      c[id] = t;
      return {...ext, commentsExt: c};
    case ReactOp(:final ids, :final emoji, :final on):
      final r = copyMap(ext[reactionsExt]);
      for (final o in ids) {
        final k = '$o|$emoji|$me';
        if (!on) {
          r.remove(k);
        } else {
          r.putIfAbsent(k, () => {'o': o, 'e': emoji, 'u': me, 'n': name, 'at': now});
        }
      }
      return {...ext, reactionsExt: r};
    case MentionsReadOp(:final at):
      final r = copyMap(ext[readsExt]);
      final t = at ?? now;
      final cur = r[me];
      if (cur is String && cur.compareTo(t) >= 0) return ext;
      r[me] = t;
      return {...ext, readsExt: r};
  }
}

/// Temporary layer key above [top] (byte order: `~` sorts after every fractional-indexing character).
String zAbove(String top) => '$top~';

/// Temporary layer key below [bottom] (a space sorts before every fractional-indexing character).
String zBelow(String bottom) => ' ${bottom.isEmpty ? '' : bottom.substring(0, math.min(bottom.length, 1))}';
