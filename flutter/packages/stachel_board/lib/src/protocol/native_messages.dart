/// Messages of the native API v1 (`wss://<origin>/native/v1`, JSON text frames, every message has `t`).
///
/// Source: `stachel/docs/contract.md` §8 (binding; draft in the concept §4.3). Parsing is
/// isolated here and tolerant: unknown messages become [UnknownMessage], unknown fields are ignored (additive
/// versioning §4.4), so a newer server never breaks this app version.
library;

import '../model/board_object.dart';

/// Protocol version this app speaks.
const nativeProtocolVersion = 1;

/// Path of the gateway.
const nativeGatewayPath = '/native/v1';

// ---- server → app -----------------------------------------------------------------------------------------------------

sealed class ServerMessage {
  const ServerMessage();

  /// Parses one decoded JSON frame. Never throws.
  static ServerMessage parse(Object? json) {
    if (json is! Map) return const UnknownMessage(null);
    final j = json.cast<String, Object?>();
    try {
      return switch (j['t']) {
        'welcome' => WelcomeMessage.fromJson(j),
        'resumed' => ResumedMessage.fromJson(j),
        'patch' => PatchMessage.fromJson(j),
        'ack' => AckMessage(_int(j['req']) ?? -1, _int(j['rev']), [
          for (final c in (j['conflict'] is List ? j['conflict'] as List : const []))
            if (c is String) c,
        ], ActResult.allFromJson(j['results'])),
        'nack' => NackMessage(_int(j['req']) ?? -1, _str(j['error']) ?? 'error', _str(j['message']), _int(j['index'])),
        'history' => HistoryMessage(j['canUndo'] == true, j['canRedo'] == true),
        'presence' => PresenceMessage(_peers(j['peers'])),
        'event' => EventMessage(_str(j['type']) ?? '', j),
        'private' => PrivateMessage.fromJson(j),
        'pong' => const PongMessage(),
        'error' => ErrorMessage(_str(j['error']) ?? 'error', _str(j['message'])),
        _ => UnknownMessage(_str(j['t'])),
      };
    } catch (_) {
      return UnknownMessage(_str(j['t']));
    }
  }
}

/// The person as Stachel knows them.
class NativeUser {
  const NativeUser({required this.key, required this.name, this.isOrga = false});
  final String key;
  final String name;
  final bool isOrga;

  static NativeUser? fromJson(Object? j) {
    if (j is! Map || j['key'] is! String) return null;
    return NativeUser(key: j['key'] as String, name: _str(j['name']) ?? '', isOrga: j['isOrga'] == true);
  }
}

/// Board snapshot: all objects plus raw feature structures (`ext`, e.g. `collab.comments`).
class BoardSnapshot {
  const BoardSnapshot({required this.objects, this.ext = const {}, this.skipped = 0});

  /// Objects without string `id`/`type` are skipped (counted in [skipped]); unknown types are kept.
  factory BoardSnapshot.fromJson(Object? j) {
    final list = j is Map ? j['objects'] : null;
    final objects = <BoardObject>[];
    var skipped = 0;
    if (list is List) {
      for (final o in list) {
        final b = BoardObject.fromJson(o);
        if (b == null) {
          skipped++;
        } else {
          objects.add(b);
        }
      }
    }
    final ext = j is Map && j['ext'] is Map ? (j['ext'] as Map).cast<String, Object?>() : const <String, Object?>{};
    return BoardSnapshot(objects: objects, ext: ext, skipped: skipped);
  }

  final List<BoardObject> objects;
  final Map<String, Object?> ext;
  final int skipped;

  Map<String, Object?> toJson() => {
    'objects': [for (final o in objects) o.raw],
    if (ext.isNotEmpty) 'ext': ext,
  };
}

/// What `welcome` and `resumed` both tell about the connection (contract §8.4).
class ConnectionInfo {
  const ConnectionInfo({
    this.epoch = '',
    this.boardId,
    this.boardTitle,
    this.user,
    this.role = 'edit',
    this.color,
    this.clientId,
    this.features = const [],
    this.below = const ['frame'],
    this.peers = const [],
    this.canUndo = false,
    this.canRedo = false,
    this.actions = const {},
  });

  factory ConnectionInfo.fromJson(Map<String, Object?> j) {
    final history = j['history'] is Map ? j['history'] as Map : const {};
    final board = j['board'] is Map ? j['board'] as Map : const {};
    List<String> strings(Object? v) => [
      for (final f in (v is List ? v : const []))
        if (f is String) f,
    ];
    return ConnectionInfo(
      epoch: _str(j['epoch']) ?? '',
      boardId: _str(board['id']),
      boardTitle: _str(board['title']),
      user: NativeUser.fromJson(j['user']),
      role: _str(j['role']) ?? 'edit',
      color: _str(j['color']),
      clientId: _int(j['clientId']),
      features: strings(j['features']),
      below: j['below'] is List ? strings(j['below']) : const ['frame'],
      peers: _peers(j['peers']),
      canUndo: history['canUndo'] == true,
      canRedo: history['canRedo'] == true,
      actions: {
        if (j['actions'] is Map)
          for (final e in (j['actions'] as Map).entries)
            if (e.key is String && e.value is num) e.key as String: (e.value as num).toInt(),
      },
    );
  }

  final String epoch;
  final String? boardId;

  /// Title when connecting (later only `board.renamed` with a newer `titleSeq`).
  final String? boardTitle;
  final NativeUser? user;

  /// `owner` / `edit` / `comment` / `view` (mode local: `comment`/`view` = ops rejected).
  final String role;

  /// Own presence color.
  final String? color;

  /// Own awareness client (not part of [peers]).
  final int? clientId;
  final List<String> features;

  /// Types drawn below everything (paint order, contract §8.4).
  final List<String> below;
  final List<Peer> peers;
  final bool canUndo;
  final bool canRedo;

  /// Web actions the server runs (`welcome.actions`, feature `act`, contract §8.12): `<modul>.<aktion>` → version. The
  /// app hides entries whose action is missing or too old instead of showing errors.
  final Map<String, int> actions;
}

class WelcomeMessage extends ServerMessage {
  const WelcomeMessage({
    required this.proto,
    required this.rev,
    required this.snapshot,
    this.info = const ConnectionInfo(),
  });

  factory WelcomeMessage.fromJson(Map<String, Object?> j) => WelcomeMessage(
    proto: _int(j['proto']) ?? nativeProtocolVersion,
    rev: _int(j['rev']) ?? 0,
    snapshot: BoardSnapshot.fromJson(j['snapshot']),
    info: ConnectionInfo.fromJson(j),
  );

  final int proto;
  final int rev;
  final BoardSnapshot snapshot;
  final ConnectionInfo info;

  String get epoch => info.epoch;
}

/// Instead of a welcome snapshot when the server's ring buffer still has every patch since `hello.resume.rev`
/// (`patches: []` when nothing is missing).
class ResumedMessage extends ServerMessage {
  const ResumedMessage(this.rev, this.patches, {this.info = const ConnectionInfo()});

  factory ResumedMessage.fromJson(Map<String, Object?> j) => ResumedMessage(_int(j['rev']) ?? 0, [
    for (final p in (j['patches'] is List ? j['patches'] as List : const []))
      if (p is Map) PatchMessage.fromJson(p.cast<String, Object?>()),
  ], info: ConnectionInfo.fromJson(j));

  final int rev;
  final List<PatchMessage> patches;
  final ConnectionInfo info;
}

/// One object change of a patch.
sealed class ObjectChange {
  const ObjectChange(this.id);
  final String id;

  static ObjectChange? fromJson(Object? j) {
    if (j is! Map || j['id'] is! String) return null;
    final id = j['id'] as String;
    if (j['removed'] == true) return ObjectRemoved(id);
    final created = j['created'];
    if (created is Map) {
      final o = BoardObject.fromJson({...created, 'id': id});
      return o == null ? null : ObjectCreated(o);
    }
    final set = j['set'] is Map ? (j['set'] as Map).cast<String, Object?>() : const <String, Object?>{};
    final unset = [
      for (final k in (j['unset'] is List ? j['unset'] as List : const []))
        if (k is String) k,
    ];
    return ObjectUpdated(id, set, unset);
  }
}

class ObjectCreated extends ObjectChange {
  ObjectCreated(this.object) : super(object.id);
  final BoardObject object;
}

class ObjectUpdated extends ObjectChange {
  const ObjectUpdated(super.id, this.set, this.unset);
  final Map<String, Object?> set;
  final List<String> unset;
}

class ObjectRemoved extends ObjectChange {
  const ObjectRemoved(super.id);
}

class PatchMessage extends ServerMessage {
  const PatchMessage({required this.rev, required this.changes, this.by, this.ext = const {}});

  factory PatchMessage.fromJson(Map<String, Object?> j) => PatchMessage(
    rev: _int(j['rev']) ?? 0,
    by: _str(j['by']),
    changes: [for (final c in (j['changes'] is List ? j['changes'] as List : const [])) ?ObjectChange.fromJson(c)],
    ext: j['ext'] is Map ? (j['ext'] as Map).cast<String, Object?>() : const {},
  );

  final int rev;
  final String? by;
  final List<ObjectChange> changes;
  final Map<String, Object?> ext;
}

class AckMessage extends ServerMessage {
  const AckMessage(this.req, this.rev, [this.conflict = const [], this.results = const {}]);
  final int req;
  final int? rev;

  /// Objects whose rich text was changed at the same place by someone else meanwhile (`text` op, the app won).
  final List<String> conflict;

  /// Results of the web actions (`act`) of this message by op index (`ack.results`, contract §8.12).
  final Map<int, ActResult> results;
}

/// Result of a web action in the `ack` (`results: {"<index>": {select, focus, edit, toast, data, skipped, error}}`,
/// contract §8.12): the app selects, moves the camera and starts writing like the web after the action, and shows the
/// web's hint text. Unknown fields stay in [raw].
class ActResult {
  const ActResult({
    this.select,
    this.focus,
    this.focusRect,
    this.edit,
    this.toast,
    this.data,
    this.skipped = false,
    this.error,
    this.message,
    this.raw = const {},
  });

  /// `results` of an `ack` by op index (bad entries are left out).
  static Map<int, ActResult> allFromJson(Object? j) {
    if (j is! Map) return const {};
    final out = <int, ActResult>{};
    for (final e in j.entries) {
      final i = int.tryParse('${e.key}');
      final r = fromJson(e.value);
      if (i != null && r != null) out[i] = r;
    }
    return out;
  }

  /// Null for anything that is not a map (no result).
  static ActResult? fromJson(Object? j) {
    if (j is! Map) return null;
    final m = j.cast<String, Object?>();
    List<String>? ids(Object? v) => v is List
        ? [
            for (final s in v)
              if (s is String) s,
          ]
        : (v is String ? [v] : null);
    final f = m['focus'];
    ({double x, double y, double w, double h})? rect;
    if (f is Map) {
      final x = _dbl(f['x']), y = _dbl(f['y']), w = _dbl(f['w']), h = _dbl(f['h']);
      if (x != null && y != null && w != null && h != null) rect = (x: x, y: y, w: w, h: h);
    }
    return ActResult(
      select: ids(m['select']),
      focus: rect == null ? ids(f) : null,
      focusRect: rect,
      edit: _str(m['edit']),
      toast: _str(m['toast']),
      data: m['data'],
      skipped: m['skipped'] == true,
      error: _str(m['error']),
      message: _str(m['message']),
      raw: m,
    );
  }

  /// Objects to select afterwards (null = leave the selection).
  final List<String>? select;

  /// Objects the camera shows afterwards.
  final List<String>? focus;

  /// Or a board rectangle for the camera.
  final ({double x, double y, double w, double h})? focusRect;

  /// Object whose text is written right away (like the web after e.g. a new note).
  final String? edit;

  /// Hint text of the web („Vorlage eingefügt.“).
  final String? toast;

  /// Action-specific data.
  final Object? data;

  /// Nothing to do (e.g. the target was deleted meanwhile).
  final bool skipped;

  /// `failed` (error in the web code – should never happen) with [message].
  final String? error;
  final String? message;
  final Map<String, Object?> raw;
}

class NackMessage extends ServerMessage {
  const NackMessage(this.req, this.error, this.message, [this.index]);
  final int req;
  final String error;
  final String? message;

  /// Index of the rejected op (`invalid_input`).
  final int? index;
}

class HistoryMessage extends ServerMessage {
  const HistoryMessage(this.canUndo, this.canRedo);
  final bool canUndo;
  final bool canRedo;
}

/// Somebody else on the board (web, app or AI).
class Peer {
  const Peer({
    required this.id,
    required this.key,
    required this.name,
    required this.color,
    this.cursorX,
    this.cursorY,
    this.selection = const [],
    this.editing,
    this.client,
    this.since,
    this.extra = const {},
  });

  static Peer? fromJson(Object? j) {
    if (j is! Map || j['key'] is! String) return null;
    final c = j['cursor'];
    return Peer(
      id: _int(j['id']) ?? 0,
      key: j['key'] as String,
      name: _str(j['name']) ?? '',
      color: _str(j['color']) ?? '#1763b5',
      cursorX: c is Map ? _dbl(c['x']) : null,
      cursorY: c is Map ? _dbl(c['y']) : null,
      selection: [
        for (final s in (j['selection'] is List ? j['selection'] as List : const []))
          if (s is String) s,
      ],
      editing: _str(j['editing']),
      client: _str(j['client']),
      since: _int(j['since']),
      extra: j['extra'] is Map ? (j['extra'] as Map).cast<String, Object?>() : const {},
    );
  }

  final int id;
  final String key;
  final String name;
  final String color;
  final double? cursorX;
  final double? cursorY;
  final List<String> selection;
  final String? editing;

  /// `web`, `app`, `ai` (null = unknown).
  final String? client;

  /// When the person came (ms, clock of their client).
  final int? since;

  /// Further awareness fields of feature modules, raw (e.g. `collab.status`).
  final Map<String, Object?> extra;
}

class PresenceMessage extends ServerMessage {
  const PresenceMessage(this.peers);
  final List<Peer> peers;
}

/// `board.renamed` (`title`, `titleSeq`), `board.deleted` (`by`, `byKey`), unknown types with their raw fields.
class EventMessage extends ServerMessage {
  const EventMessage(this.type, this.raw);
  final String type;
  final Map<String, Object?> raw;

  String? get title => _str(raw['title']);
  int? get titleSeq => _int(raw['titleSeq']);
  String? get by => _str(raw['by']);
}

/// The whole own private store (private mode, docs/features/private.md §5): objects only this connection sees, bottom
/// to top. Comes after `welcome`/`resumed`, on every change of the store and before the `ack` of ops that changed it;
/// replaces the previous list. Objects without string `id`/`type` are skipped.
class PrivateMessage extends ServerMessage {
  const PrivateMessage(this.objects);

  factory PrivateMessage.fromJson(Map<String, Object?> j) => PrivateMessage([
    for (final o in (j['objects'] is List ? j['objects'] as List : const [])) ?BoardObject.fromJson(o),
  ]);

  final List<BoardObject> objects;
}

class PongMessage extends ServerMessage {
  const PongMessage();
}

/// Fatal error, e.g. `upgrade_required`.
class ErrorMessage extends ServerMessage {
  const ErrorMessage(this.error, this.message);
  final String error;
  final String? message;
}

class UnknownMessage extends ServerMessage {
  const UnknownMessage(this.t);
  final String? t;
}

// ---- app → server -----------------------------------------------------------------------------------------------------

/// `hello`: first message after the WebSocket is open.
Map<String, Object?> helloMessage({
  required String board,
  required String app,
  String? client,
  String? resumeEpoch,
  int? resumeRev,
  List<String> want = const ['objects', 'ext'],
}) => {
  't': 'hello',
  'proto': nativeProtocolVersion,
  'board': board,
  'app': app,
  // which app (contract §8.4 `client`: left out by host apps, `stachel` = the Stachel app; own minimum version)
  'client': ?client,
  if (resumeEpoch != null && resumeRev != null) 'resume': {'epoch': resumeEpoch, 'rev': resumeRev},
  'want': want,
};

Map<String, Object?> pingMessage() => const {'t': 'ping'};

/// `presence`: own cursor/selection/viewport (world coordinates).
Map<String, Object?> presenceMessage({
  double? cursorX,
  double? cursorY,
  List<String> selection = const [],
  String? editing,
  ({double x, double y, double w, double h})? viewport,
  List<Map<String, Object?>>? uploads,
  Map<String, Object?>? extra,
}) => {
  't': 'presence',
  'cursor': cursorX == null || cursorY == null ? null : {'x': cursorX, 'y': cursorY},
  'selection': selection,
  'editing': editing,
  if (viewport != null) 'viewport': {'x': viewport.x, 'y': viewport.y, 'w': viewport.w, 'h': viewport.h},
  'uploads': ?uploads,
  'extra': ?extra,
};

/// One operation inside an `ops` message (E2).
sealed class BoardOp {
  const BoardOp();
  Map<String, Object?> toJson();
}

class CreateOp extends BoardOp {
  const CreateOp(this.objects);
  final List<Map<String, Object?>> objects;
  @override
  Map<String, Object?> toJson() => {'op': 'create', 'objects': objects};
}

/// Field patches per object ID; a `null` value removes the field.
class UpdateOp extends BoardOp {
  const UpdateOp(this.patches);
  final Map<String, Map<String, Object?>> patches;
  @override
  Map<String, Object?> toJson() => {'op': 'update', 'patches': patches};
}

class RemoveOp extends BoardOp {
  const RemoveOp(this.ids);
  final List<String> ids;
  @override
  Map<String, Object?> toJson() => {'op': 'remove', 'ids': ids};
}

class OrderOp extends BoardOp {
  const OrderOp(this.ids, {required this.toFront});
  final List<String> ids;
  final bool toFront;
  @override
  Map<String, Object?> toJson() => {'op': 'order', 'ids': ids, 'to': toFront ? 'front' : 'back'};
}

/// Rich text of one object (contract §8.6 `text`): the new [doc], the state it started from ([baseDoc], revision
/// [baseRev] in [epoch]); the server merges concurrent edits of others (concept §4.6).
class TextOp extends BoardOp {
  const TextOp(this.id, this.baseRev, this.doc, {this.epoch, this.baseDoc});
  final String id;
  final int baseRev;
  final Map<String, Object?> doc;
  final String? epoch;
  final Map<String, Object?>? baseDoc;
  @override
  Map<String, Object?> toJson() => {
    'op': 'text',
    'id': id,
    'base': baseRev,
    'doc': doc,
    'epoch': ?epoch,
    'baseDoc': ?baseDoc,
  };
}

/// Mind map op (contract §8.6 `mind`, feature `mind`): the server runs the web's mind map code with the layout;
/// [json] is the op without `op` (`{'do': 'child', 'id': …, 'new': …}`). [predicted] = the same result computed in the
/// app (`MindPlanner`), shown until the server's patch arrives – it is never sent.
class MindOp extends BoardOp {
  const MindOp(this.json, {this.predicted = const []});
  final Map<String, Object?> json;
  final List<BoardOp> predicted;
  @override
  Map<String, Object?> toJson() => {'op': 'mind', ...json};
}

/// Web action (audit §3.2, contract §8.12, feature `act`): the server runs the web's own code for [name]
/// (`<modul>.<aktion>`, e.g. `core.align`) with [args] like the browser does – identical results without a Dart port.
/// [key] gives the fixed IDs of what it creates (`<key>-1`, `<key>-2` …) and makes a repetition harmless (the same
/// key never runs twice); [v] = the version the app needs at least.
///
/// [label] names the action for the „wird ausgeführt …“ marker and [predicted] is an optional preview (like
/// [MindOp]) shown until the server's patch arrives; both stay on the device (persisted queue) and never go to the
/// server.
class ActOp extends BoardOp {
  const ActOp(this.name, {this.args = const {}, this.key, this.v = 1, this.label, this.predicted = const []});
  final String name;
  final Map<String, Object?> args;
  final String? key;
  final int v;
  final String? label;
  final List<BoardOp> predicted;
  @override
  Map<String, Object?> toJson() => {'op': 'act', 'name': name, 'args': args, 'key': ?key, if (v != 1) 'v': v};

  /// For the queue on the device: with [label] and [predicted].
  Map<String, Object?> toStoredJson() => {
    ...toJson(),
    'label': ?label,
    if (predicted.isNotEmpty) 'predicted': [for (final p in predicted) p.toJson()],
  };
}

// ---- E3: comments, reactions, read state (contract §8.6) ----------------------------------------------------------

/// Anchor of a comment: board point, optionally pinned to an object ([dx]/[dy] from its top left corner).
class CommentAnchor {
  const CommentAnchor(this.x, this.y, {this.objectId, this.dx = 0, this.dy = 0});
  final double x;
  final double y;
  final String? objectId;
  final double dx;
  final double dy;

  static CommentAnchor fromJson(Object? j) {
    final m = j is Map ? j : const {};
    return CommentAnchor(
      _dbl(m['x']) ?? 0,
      _dbl(m['y']) ?? 0,
      objectId: _str(m['objectId']),
      dx: _dbl(m['dx']) ?? 0,
      dy: _dbl(m['dy']) ?? 0,
    );
  }

  Map<String, Object?> toJson() => {
    'x': x,
    'y': y,
    if (objectId != null) ...{'objectId': objectId, 'dx': dx, 'dy': dy},
  };
}

/// Ops that change a feature structure (`ext`) instead of objects.
sealed class ExtOp extends BoardOp {
  const ExtOp();

  /// The structure it changes (`collab.comments`, …).
  String get ext;
}

/// New thread (IDs from the app: a repetition creates nothing twice).
class CommentOp extends ExtOp {
  const CommentOp(this.thread, this.msg, this.at, this.text, {this.mentions = const []});
  final String thread;
  final String msg;
  final CommentAnchor at;
  final String text;
  final List<String> mentions;
  @override
  String get ext => 'collab.comments';
  @override
  Map<String, Object?> toJson() => {
    'op': 'comment',
    'thread': thread,
    'msg': msg,
    'at': at.toJson(),
    'text': text,
    'mentions': mentions,
  };
}

class ReplyOp extends ExtOp {
  const ReplyOp(this.thread, this.msg, this.text, {this.mentions = const []});
  final String thread;
  final String msg;
  final String text;
  final List<String> mentions;
  @override
  String get ext => 'collab.comments';
  @override
  Map<String, Object?> toJson() => {'op': 'reply', 'thread': thread, 'msg': msg, 'text': text, 'mentions': mentions};
}

class CommentEditOp extends ExtOp {
  const CommentEditOp(this.thread, this.msg, this.text, {this.mentions = const []});
  final String thread;
  final String msg;
  final String text;
  final List<String> mentions;
  @override
  String get ext => 'collab.comments';
  @override
  Map<String, Object?> toJson() => {
    'op': 'commentEdit',
    'thread': thread,
    'msg': msg,
    'text': text,
    'mentions': mentions,
  };
}

/// Deletes a message; without [msg] (or the first message) the whole thread.
class CommentDeleteOp extends ExtOp {
  const CommentDeleteOp(this.thread, [this.msg]);
  final String thread;
  final String? msg;
  @override
  String get ext => 'collab.comments';
  @override
  Map<String, Object?> toJson() => {'op': 'commentDelete', 'thread': thread, 'msg': ?msg};
}

class ResolveOp extends ExtOp {
  const ResolveOp(this.thread, {required this.resolved});
  final String thread;
  final bool resolved;
  @override
  String get ext => 'collab.comments';
  @override
  Map<String, Object?> toJson() => {'op': 'resolve', 'thread': thread, 'resolved': resolved};
}

/// Own reaction [emoji] on [ids] on or off.
class ReactOp extends ExtOp {
  const ReactOp(this.ids, this.emoji, {required this.on});
  final List<String> ids;
  final String emoji;
  final bool on;
  @override
  String get ext => 'collab.reactions';
  @override
  Map<String, Object?> toJson() => {'op': 'react', 'ids': ids, 'emoji': emoji, 'on': on};
}

/// Own mentions read up to [at] (`collab.reads`, no undo).
class MentionsReadOp extends ExtOp {
  const MentionsReadOp([this.at]);
  final String? at;
  @override
  String get ext => 'collab.reads';
  @override
  Map<String, Object?> toJson() => {'op': 'mentionsRead', 'at': ?at};
}

/// An op from its JSON (persisted queue); null for unknown or broken ones.
BoardOp? boardOpFromJson(Object? j) {
  if (j is! Map) return null;
  final m = j.cast<String, Object?>();
  List<String> strings(Object? v) => [
    for (final s in (v is List ? v : const []))
      if (s is String) s,
  ];
  Map<String, Object?>? map(Object? v) => v is Map ? v.cast<String, Object?>() : null;
  try {
    return switch (m['op']) {
      'create' => CreateOp([for (final o in (m['objects'] as List)) (o as Map).cast<String, Object?>()]),
      'update' => UpdateOp({
        for (final e in (m['patches'] as Map).entries) '${e.key}': (e.value as Map).cast<String, Object?>(),
      }),
      'remove' => RemoveOp(strings(m['ids'])),
      'order' => OrderOp(strings(m['ids']), toFront: m['to'] != 'back'),
      'text' => TextOp(
        m['id'] as String,
        _int(m['base']) ?? 0,
        map(m['doc'])!,
        epoch: _str(m['epoch']),
        baseDoc: map(m['baseDoc']),
      ),
      'comment' => CommentOp(
        m['thread'] as String,
        m['msg'] as String,
        CommentAnchor.fromJson(m['at']),
        m['text'] as String,
        mentions: strings(m['mentions']),
      ),
      'reply' => ReplyOp(
        m['thread'] as String,
        m['msg'] as String,
        m['text'] as String,
        mentions: strings(m['mentions']),
      ),
      'commentEdit' => CommentEditOp(
        m['thread'] as String,
        m['msg'] as String,
        m['text'] as String,
        mentions: strings(m['mentions']),
      ),
      'commentDelete' => CommentDeleteOp(m['thread'] as String, _str(m['msg'])),
      'resolve' => ResolveOp(m['thread'] as String, resolved: m['resolved'] == true),
      'react' => ReactOp(strings(m['ids']), m['emoji'] as String, on: m['on'] == true),
      'mentionsRead' => MentionsReadOp(_str(m['at'])),
      // persisted with its prediction (`PendingEntry.toJson`); the prediction never goes to the server
      'act' => ActOp(
        m['name'] as String,
        args: map(m['args']) ?? const {},
        key: _str(m['key']),
        v: _int(m['v']) ?? 1,
        label: _str(m['label']),
        predicted: [for (final p in (m['predicted'] is List ? m['predicted'] as List : const [])) ?boardOpFromJson(p)],
      ),
      'mind' => MindOp(
        {
          for (final e in m.entries)
            if (e.key != 'op' && e.key != 'predicted') e.key: e.value,
        },
        predicted: [for (final p in (m['predicted'] is List ? m['predicted'] as List : const [])) ?boardOpFromJson(p)],
      ),
      _ => null,
    };
  } catch (_) {
    return null;
  }
}

Map<String, Object?> opsMessage(int req, List<BoardOp> ops) => {
  't': 'ops',
  'req': req,
  'ops': [for (final o in ops) o.toJson()],
};

// ---- helpers ----------------------------------------------------------------------------------------------------------

String? _str(Object? v) => v is String ? v : null;
int? _int(Object? v) => v is num && v.isFinite ? v.toInt() : null;
double? _dbl(Object? v) => v is num && v.isFinite ? v.toDouble() : null;
List<Peer> _peers(Object? v) => [for (final p in (v is List ? v : const [])) ?Peer.fromJson(p)];
