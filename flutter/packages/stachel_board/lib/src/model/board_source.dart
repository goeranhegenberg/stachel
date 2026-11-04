import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' show Rect;

import 'package:flutter/foundation.dart';

import '../protocol/native_messages.dart';
import '../protocol/presence_sender.dart';
import 'board_cache.dart';
import 'board_object.dart';
import 'board_state.dart';
import 'pending_ops.dart';
import 'pending_store.dart';

/// An own image upload in progress (E3): placeholder at [rect] with the image's average [color]; [progress] 0…1,
/// [waiting] = no connection, goes on later.
class BoardUpload {
  const BoardUpload({required this.key, required this.rect, this.color, this.progress = 0, this.waiting = false});
  final String key;
  final Rect rect;
  final String? color;
  final double progress;
  final bool waiting;

  BoardUpload copyWith({Rect? rect, double? progress, bool? waiting}) => BoardUpload(
    key: key,
    rect: rect ?? this.rect,
    color: color,
    progress: progress ?? this.progress,
    waiting: waiting ?? this.waiting,
  );
}

/// Connection state of a [BoardSource].
enum BoardConnection {
  /// Opening / waiting for `welcome`.
  connecting,

  /// Live: snapshot loaded, patches arrive.
  live,

  /// Connection lost, the source reconnects (resume) by itself.
  offline,

  /// Closed for good (closed by the app, or rejected: see [BoardSource.closeReason]).
  closed,
}

/// Where a board comes from: snapshot + patches in, operations out (concept §2.3/§3.1).
///
/// E1's WebSocket client (`NativeBoardSource`, native API v1) implements this; tests and the debug screen use
/// [FixtureBoardSource]. A CRDT source could replace it later without touching renderer or editor.
abstract class BoardSource {
  /// Server messages in order (welcome/resumed/patch/ack/nack/presence/event …).
  Stream<ServerMessage> get messages;

  ValueListenable<BoardConnection> get connection;

  /// Why the source closed for good: `not_logged_in`, `unknown_board`, `board_deleted`, `no_access`,
  /// `upgrade_required` … (null while open or after [close]).
  String? get closeReason;

  /// Connects; with [resumeEpoch]/[resumeRev] (from a cached state) the server may answer `resumed` instead of a
  /// full snapshot.
  Future<void> open({String? resumeEpoch, int? resumeRev});

  /// Sends one app → server message (`presence`, `ops`, `step`, `undo` …).
  void send(Map<String, Object?> message);

  Future<void> close();
}

/// In-memory source: answers [open] with a `welcome` carrying [snapshot]; tests push further messages with [push]
/// and read what the app sent from [sent].
class FixtureBoardSource implements BoardSource {
  FixtureBoardSource(
    this.snapshot, {
    this.epoch = 'fixture',
    this.rev = 1,
    this.role = 'edit',
    this.title,
    this.features = const ['objects', 'ext', 'presence', 'ops', 'undo', 'text'],
    this.actions = const {},
  });

  final BoardSnapshot snapshot;
  final String epoch;
  final int rev;
  final String role;
  final String? title;

  /// `welcome.features` / `welcome.actions` (F2: `act` with web actions and their versions).
  final List<String> features;
  final Map<String, int> actions;

  /// A recorded `welcome` (e.g. `docs/native_fixtures/all_types.welcome.json`) as source.
  factory FixtureBoardSource.fromWelcome(Map<String, Object?> welcome) {
    final w = WelcomeMessage.fromJson(welcome);
    return FixtureBoardSource(w.snapshot, epoch: w.epoch, rev: w.rev, role: w.info.role, title: w.info.boardTitle);
  }

  final _messages = StreamController<ServerMessage>.broadcast(sync: true);
  final _connection = ValueNotifier(BoardConnection.connecting);
  final sent = <Map<String, Object?>>[];
  String? _closeReason;

  @override
  Stream<ServerMessage> get messages => _messages.stream;

  @override
  ValueListenable<BoardConnection> get connection => _connection;

  @override
  String? get closeReason => _closeReason;

  @override
  Future<void> open({String? resumeEpoch, int? resumeRev}) async {
    _connection.value = BoardConnection.connecting;
    sent.add(helloMessage(board: 'fixture', app: 'test', resumeEpoch: resumeEpoch, resumeRev: resumeRev));
    _connection.value = BoardConnection.live;
    push(
      WelcomeMessage(
        proto: nativeProtocolVersion,
        rev: rev,
        snapshot: snapshot,
        info: ConnectionInfo(
          epoch: epoch,
          role: role,
          boardId: 'fixture',
          boardTitle: title,
          features: features,
          actions: actions,
        ),
      ),
    );
  }

  /// Delivers [message] as if the server had sent it.
  void push(ServerMessage message) {
    if (!_messages.isClosed) _messages.add(message);
  }

  /// Simulates a rejection or loss of the connection.
  void drop({String? reason}) {
    _closeReason = reason;
    _connection.value = reason == null ? BoardConnection.offline : BoardConnection.closed;
  }

  @override
  void send(Map<String, Object?> message) => sent.add(message);

  @override
  Future<void> close() async {
    _connection.value = BoardConnection.closed;
    await _messages.close();
  }
}

/// A web action (`act`) of this app that the server has not answered yet: shown as „wird ausgeführt …“ (or „wird
/// ausgeführt, sobald online“ while [queued]) instead of a local preview (audit §3.2, O04).
class RunningAct {
  const RunningAct({required this.req, required this.name, this.key, this.label, this.queued = false});
  final int req;
  final String name;
  final String? key;
  final String? label;

  /// Waits for the connection (not sent on the current one).
  final bool queued;
}

/// A web action the server answered: [result] from `ack` (null on `nack` – then [error] is set). Also for actions
/// from the queue on the device that a former app run sent.
class ActDone {
  const ActDone({required this.req, required this.name, this.key, this.result, this.error, this.message});
  final int req;
  final String name;

  /// The action's key: what it created has the IDs `<key>-1`, `<key>-2` …
  final String? key;
  final ActResult? result;
  final String? error;
  final String? message;
  bool get ok => error == null;
}

/// A hint for the user about own changes: rejected by the server, merged with a concurrent text edit, nothing to
/// undo.
class BoardNotice {
  const BoardNotice(this.kind, {this.message, this.ids = const [], this.error});

  /// `rejected` (nack), `conflict` (text edited at the same place meanwhile, the app won), `nothing` (undo/redo).
  final String kind;
  final String? message;
  final String? error;
  final List<String> ids;
}

/// Keeps a [BoardState] in sync with a [BoardSource] and tells listeners what changed.
///
/// Offline (E1): [restore] shows a cached state right away; [start] then resumes from its epoch/revision, so the
/// server sends only what is missing (`resumed`) or a fresh snapshot (`welcome`). [staleSince] says how old the shown
/// state is while not live. Own presence goes out through [presence] (throttled, only while live).
///
/// Editing (E2, concept §3.5): [apply] shows own changes at once ([state] = [confirmed] + pending ops), sends them
/// with an increasing `req` and drops them on `ack` (the server's patch has come before) or `nack` (rolled back,
/// [notices]). While the connection is gone, changes queue up and go out again with the same `req` after the
/// reconnect – the server executes every `req` once (contract §8.6). Like the web, editing goes on offline without a
/// time limit (Abnahme O01; [offlineEditWindow] null) – the queue is kept on the device and goes out later.
class BoardController extends ChangeNotifier {
  BoardController(
    this.source, {
    Duration presenceInterval = const Duration(milliseconds: 250),
    this.offlineEditWindow,
    this.sendInterval = const Duration(milliseconds: 66),
    this.pendingStore,
    this.boardId,
    this.pendingMaxAge,
  }) : presence = PresenceSender(source.send, interval: presenceInterval) {
    // the others see „… lädt hoch“ at the same place (presence `uploads`, contract §8.4)
    uploads.addListener(() => presence.uploads = [for (final u in uploads.value) (rect: u.rect, color: u.color)]);
  }

  final BoardSource source;

  /// Keeps unconfirmed own changes on the device (E3): they survive leaving the board and an app kill and go out on
  /// the next open (with [boardId]; null = only in memory).
  final PendingStore? pendingStore;
  final String? boardId;

  /// Saved changes older than this are dropped instead of sent; null = never (web: offline changes are always merged).
  final Duration? pendingMaxAge;

  /// Own image uploads in progress (drawn as placeholders, sent as presence `uploads`).
  final uploads = ValueNotifier<List<BoardUpload>>(const []);

  /// Bumped whenever the shown feature structures ([BoardState.ext]: comments, reactions …) change.
  int extVersion = 0;

  /// What is shown: the server's state plus own changes not yet confirmed.
  final state = BoardState();

  /// The state as the server confirmed it (saved for offline use).
  final confirmed = BoardState();
  final PresenceSender presence;

  // ---- private mode (docs/features/private.md §5) -----------------------------------------------------------------

  /// Own private objects (server message `private`, the whole own store): shown and edited like board objects (the
  /// server routes ops on them into the store), not cached, a board object with the same ID wins.
  Map<String, BoardObject> get privateObjects => Map.unmodifiable(_private);
  Map<String, BoardObject> _private = const {};

  /// Bumped whenever [privateObjects] change.
  int privateVersion = 0;

  /// [id] is one of my private objects (only I see it; not, once the board has it).
  bool isPrivate(String id) => _private.containsKey(id) && confirmed[id] == null;

  /// The server supports the private mode (`welcome.features` has `private`).
  bool get privateFeature => features.contains('private');

  /// How long editing goes on without connection (changes queue up); null = no limit (web).
  final Duration? offlineEditWindow;

  /// Drag updates go out at most this often (≤ 15/s like the web, the last state wins).
  final Duration sendInterval;
  StreamSubscription<ServerMessage>? _sub;
  bool _listening = false;

  /// IDs changed by the last notification; null = everything (snapshot).
  Set<String>? lastChanged;

  List<Peer> peers = const [];
  String role = 'edit';

  /// What the server can (`welcome.features`): `text` = rich text op with merging (E2), `act` = web actions.
  List<String> features = const [];

  /// Web actions the server offers with their version (`welcome.actions`, contract §8.12).
  Map<String, int> actions = const {};

  /// The server runs the web action [name] in version [v] or newer (feature `act`, `welcome.actions`). Entries of the
  /// registries that need an action are hidden while this is false (older server, action not deployed yet).
  bool canAct(String name, [int v = 1]) => features.contains('act') && (actions[name] ?? 0) >= v;
  NativeUser? user;

  /// Own awareness client (`welcome.clientId`; peers' `id` is theirs, e.g. `structure.present.from`).
  int? clientId;

  /// Own presence color (from `welcome`).
  String? color;

  /// Title from `board.renamed` (only taken when `titleSeq` is newer, contract §4).
  String? title;
  int _titleSeq = -1;

  /// Set when the board was moved to the trash while open (`board.deleted`): who did it ('' = unknown).
  String? deletedBy;

  bool get loaded => _loaded;
  bool _loaded = false;

  /// The shown state came from the device cache and the server has not confirmed it yet.
  bool get fromCache => _cachedAt != null && !_confirmed;
  DateTime? _cachedAt;
  bool _confirmed = false;
  DateTime? _lastLiveAt;

  /// How old the shown state is: null while live (or before anything is shown), else when it was last current
  /// (connection lost → that moment; from the cache → when it was saved).
  DateTime? get staleSince {
    if (!_loaded || source.connection.value == BoardConnection.live) return null;
    return _confirmed ? _lastLiveAt : _cachedAt;
  }

  // ---- editing ------------------------------------------------------------------------------------------------------

  final _pending = <PendingEntry>[];
  final _notices = StreamController<BoardNotice>.broadcast();
  Timer? _sendTimer;
  String? _coalesceKey;
  static int _lastReq = 0;

  /// Server history of own steps (`history`), optimistic after own changes.
  bool canUndo = false;
  bool canRedo = false;

  /// Rejections, merged text, nothing to undo.
  Stream<BoardNotice> get notices => _notices.stream;

  /// Own changes the server has not confirmed yet.
  int get pendingCount => _pending.length;

  /// Own changes waiting for the connection (not sent on the current one).
  int get queuedCount => _pending.where((e) => !e.sent).length;

  /// Changes not confirmed yet that touch [id] (only `text` ops with [textOnly]).
  bool hasPending(String id, {bool textOnly = false}) =>
      _pending.any((e) => e.touched.contains(id) && (!textOnly || e.ops.any((o) => o is TextOp)));

  /// Role allows editing (`owner`/`edit`; `comment`/`view` only in instances with own accounts).
  bool get mayEdit => role == 'edit' || role == 'owner';

  /// Role allows writing comments (`comment`/`edit`/`owner`): comment, reply, edit/delete own messages, done/open,
  /// mentions read – the only ops the server takes from `comment` (contract §6; `view` gets `nack forbidden` for all).
  bool get mayComment => mayEdit || role == 'comment';

  /// Editing possible now: allowed, the server's state is there, and live or offline only shortly.
  bool get canEdit => mayEdit && _writable;

  /// Commenting possible now: like [canEdit], but with [mayComment] (for `edit`/`owner` always equal to [canEdit]).
  bool get canComment => mayComment && _writable;

  /// The server's state is there, and live or offline only shortly ([offlineEditWindow]).
  bool get _writable {
    if (!_confirmed) return false;
    final c = source.connection.value;
    if (c == BoardConnection.live) return true;
    if (c == BoardConnection.closed) return false;
    final since = _lastLiveAt;
    final window = offlineEditWindow;
    return since != null && (window == null || DateTime.now().difference(since) < window);
  }

  /// A new object ID (21 characters from nanoid's alphabet).
  static String newId() {
    const alphabet = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
    return String.fromCharCodes(List.generate(21, (_) => alphabet.codeUnitAt(_random.nextInt(64))));
  }

  static final _random = math.Random.secure();

  /// Next `req`: strictly increasing per app session, also across controllers and app starts (time based).
  static int nextReq() {
    final now = DateTime.now().millisecondsSinceEpoch;
    _lastReq = math.max(_lastReq + 1, now);
    return _lastReq;
  }

  /// Applies own [ops]: shown at once, sent (now or after the reconnect). [step] closes the undo step after them
  /// (single action, end of a gesture). [coalesce]: updates of a running gesture with the same key replace the
  /// previous unsent one and go out at most every [sendInterval].
  void apply(List<BoardOp> ops, {bool step = true, String? coalesce}) {
    if (ops.isEmpty) return;
    final last = _pending.isEmpty ? null : _pending.last;
    final PendingEntry entry;
    final touched = <String>{};
    if (coalesce != null && last != null && !last.sentOnce && _coalesceKey == coalesce && last.kind == 'ops') {
      entry = PendingEntry.ops(last.req, ops, step: step);
      touched.addAll(last.touched);
      _pending[_pending.length - 1] = entry;
    } else {
      entry = PendingEntry.ops(nextReq(), ops, step: step);
      _pending.add(entry);
    }
    _coalesceKey = coalesce;
    touched.addAll(entry.touched);
    if (!ops.every((o) => o is MentionsReadOp)) {
      canUndo = true;
      canRedo = false;
    }
    _refresh(touched);
    if (coalesce != null && !step) {
      _sendTimer ??= Timer(sendInterval, () {
        _sendTimer = null;
        _flush();
      });
    } else {
      _flush();
    }
  }

  /// Closes the undo step of what was sent last (end of a text edit).
  void closeStep() {
    _coalesceKey = null;
    final last = _pending.isEmpty ? null : _pending.last;
    if (last != null && !last.sentOnce && last.kind == 'ops') {
      _pending[_pending.length - 1] = PendingEntry.ops(last.req, last.ops, step: true);
      _flush();
    } else if (source.connection.value == BoardConnection.live) {
      source.send(const {'t': 'step'});
    }
  }

  // ---- web actions (F2, audit §3.2) -------------------------------------------------------------------------------

  final _actWaiters = <int, Completer<ActDone>>{};
  final _actResults = StreamController<ActDone>.broadcast();

  /// Answered web actions in order (also those restored from the queue on the device): the view selects/focuses/hints
  /// from their [ActDone.result].
  Stream<ActDone> get actResults => _actResults.stream;

  /// Own web actions waiting for the server's answer.
  List<RunningAct> get runningActs => [
    for (final e in _pending)
      for (final a in e.acts) RunningAct(req: e.req, name: a.name, key: a.key, label: a.label, queued: !e.sent),
  ];

  /// Runs the web action [name] with [args] on the server (`{"op":"act"}` in its own `ops` message, closed as its own
  /// undo step; whether it can be undone at all is the action's undo class). Offline it waits in the (persisted)
  /// queue like every op and goes out with the same `req` later. [key] (default: a new one, see [newActKey]) fixes the
  /// IDs of what it creates (`<key>-1` …), [v] = version needed, [label] names it for the „wird ausgeführt …“
  /// marker, [predicted] is an optional preview until the server's patch arrives. Completes when the server answered
  /// (never if the board is closed before – the queue on the device sends it next time, see [actResults]).
  Future<ActDone> act(
    String name,
    Map<String, Object?> args, {
    String? key,
    int v = 1,
    String? label,
    List<BoardOp> predicted = const [],
  }) {
    final req = nextReq();
    final done = Completer<ActDone>();
    _actWaiters[req] = done;
    _coalesceKey = null;
    final entry = PendingEntry.ops(req, [
      ActOp(name, args: args, key: key ?? newActKey(), v: v, label: label, predicted: predicted),
    ]);
    _pending.add(entry);
    canUndo = true;
    canRedo = false;
    _refresh(entry.touched);
    _flush();
    return done.future;
  }

  /// A key for [act] (`[A-Za-z0-9_-]{1,40}`): 16 characters of [newId]'s alphabet.
  static String newActKey() => newId().substring(0, 16);

  void _actAnswered(PendingEntry e, {Map<int, ActResult> results = const {}, String? error, String? message}) {
    for (final (i, op) in e.ops.indexed) {
      if (op is! ActOp) continue;
      final r = results[i];
      final d = ActDone(
        req: e.req,
        name: op.name,
        key: op.key,
        result: r,
        error: error ?? r?.error,
        message: message ?? r?.message,
      );
      final w = _actWaiters.remove(e.req);
      if (w != null && !w.isCompleted) w.complete(d);
      if (!_actResults.isClosed) _actResults.add(d);
    }
  }

  /// Undo / redo own steps (server history, contract §8.6).
  void undo() => _history('undo');
  void redo() => _history('redo');

  void _history(String kind) {
    if (!canEdit) return;
    _coalesceKey = null;
    _pending.add(PendingEntry.history(nextReq(), kind));
    _flush();
  }

  /// Sends what is not sent yet on this connection (in order, with step markers).
  void _flush() {
    _sendTimer?.cancel();
    _sendTimer = null;
    if (source.connection.value != BoardConnection.live || !_confirmed) return;
    for (final e in _pending) {
      if (e.sent) continue;
      source.send(e.message);
      if (e.step) source.send(const {'t': 'step'});
      e.sent = true;
      e.sentOnce = true;
    }
  }

  /// Recomputes the shown objects [ids]: server state + pending ops in order. Returns what changed.
  Set<String> _overlay(Iterable<String> ids) {
    final next = <String, BoardObject?>{};
    for (final id in ids) {
      var o = confirmed[id] ?? _private[id];
      for (final e in _pending) {
        if (!e.touched.contains(id)) continue;
        for (final op in e.ops) {
          // temporary layer keys from the server's state (stable while the op waits for its ack)
          o = applyOp(op, id, o, zTop: () => zAbove(confirmed.topZ), zBottom: () => zBelow(confirmed.bottomZ));
        }
      }
      next[id] = o;
    }
    return state.setObjects(next);
  }

  void _refresh(Set<String> ids) {
    lastChanged = _overlay(ids);
    _overlayExt();
    _persistSoon();
    notifyListeners();
  }

  /// Shown feature structures = the server's plus own pending comment/reaction ops (optimistic).
  void _overlayExt() {
    var ext = confirmed.ext;
    final now = DateTime.now().toUtc().toIso8601String();
    for (final e in _pending) {
      for (final op in e.ops) {
        if (op is ExtOp) ext = applyExtOp(op, ext, me: user?.key ?? '', name: user?.name ?? '', now: now);
      }
    }
    if (!identical(ext, state.ext)) {
      state.ext = ext;
      extVersion++;
    }
  }

  // ---- persisted queue (E3) ---------------------------------------------------------------------------------------

  Timer? _persistTimer;
  bool _pendingLoaded = false;

  void _persistSoon() {
    if (pendingStore == null || boardId == null || !_pendingLoaded) return;
    _persistTimer?.cancel();
    _persistTimer = Timer(const Duration(milliseconds: 150), persistPending);
  }

  /// Saves the unconfirmed own changes now (app goes to the background, board closes).
  Future<void> persistPending() async {
    _persistTimer?.cancel();
    _persistTimer = null;
    final store = pendingStore, id = boardId;
    if (store == null || id == null || !_pendingLoaded) return;
    await store.save(id, [
      for (final e in _pending)
        if (e.kind == 'ops') e.toJson(),
    ]);
  }

  /// Takes the changes saved by an earlier session of this board (before connecting): shown at once, sent after
  /// `welcome`/`resumed` with their old `req`.
  Future<void> _loadPending() async {
    if (_pendingLoaded) return;
    final store = pendingStore, id = boardId;
    if (store == null || id == null) {
      _pendingLoaded = true;
      return;
    }
    final List<Object?> saved;
    try {
      saved = await store.load(id);
    } catch (_) {
      _pendingLoaded = true;
      return;
    }
    if (_disposed) return;
    _pendingLoaded = true;
    final known = {for (final e in _pending) e.req};
    final maxAge = pendingMaxAge;
    final cutoff = maxAge == null ? null : DateTime.now().subtract(maxAge);
    final restored = <PendingEntry>[];
    for (final j in saved) {
      final e = PendingEntry.fromJson(j);
      if (e == null || known.contains(e.req) || (cutoff != null && e.at.isBefore(cutoff))) continue;
      restored.add(e);
      _lastReq = math.max(_lastReq, e.req);
    }
    if (restored.isEmpty) {
      // dropped old ones, or changes made while reading: save the current list
      if (saved.isNotEmpty || _pending.isNotEmpty) unawaited(persistPending());
      return;
    }
    // older ones first (they were made before anything typed since)
    _pending.insertAll(0, restored..sort((a, b) => a.req.compareTo(b.req)));
    canUndo = true;
    _refresh({for (final e in restored) ...e.touched});
    _flush();
  }

  bool _disposed = false;

  Set<String> get _pendingIds => {for (final e in _pending) ...e.touched};

  /// Shows [cached] before the connection is up (call before [start]).
  void restore(CachedBoard cached) {
    if (_confirmed) return; // the server was faster
    confirmed.applySnapshot(cached.snapshot, rev: cached.rev, epoch: cached.epoch, below: cached.below.toSet());
    state.copyFrom(confirmed);
    extVersion++;
    _overlay({..._pendingIds, ..._private.keys});
    _overlayExt();
    if (cached.title != null && _titleSeq < 0) title = cached.title;
    // the role it had then (until `welcome` says otherwise): no tool bar for a `view` board opened offline
    if (cached.role != null) role = cached.role!;
    _cachedAt = cached.savedAt;
    _loaded = true;
    lastChanged = null;
    notifyListeners();
  }

  /// The confirmed state as cache entry (null before anything was confirmed by the server).
  CachedBoard? toCache(String boardId) {
    if (!_confirmed) return null;
    return CachedBoard.of(boardId, confirmed, title: title, savedAt: _lastLiveAt ?? DateTime.now(), role: role);
  }

  Future<void> start() async {
    // saved changes come in when read (the connection does not wait for the device storage)
    unawaited(_loadPending());
    _sub ??= source.messages.listen(_onMessage);
    if (!_listening) {
      _listening = true;
      source.connection.addListener(_onConnection);
    }
    await source.open(
      resumeEpoch: confirmed.epoch.isEmpty ? null : confirmed.epoch,
      resumeRev: confirmed.epoch.isEmpty ? null : confirmed.rev,
    );
  }

  void _onConnection() {
    final live = source.connection.value == BoardConnection.live;
    if (!live && presence.live) _lastLiveAt = DateTime.now();
    if (!live) {
      // the server may not have them: send again after the reconnect (same req, executed once)
      for (final e in _pending) {
        e.sent = false;
      }
    }
    presence.live = live && _confirmed;
    lastChanged = const {};
    notifyListeners();
  }

  void _onMessage(ServerMessage m) {
    if (source.connection.value == BoardConnection.live) _lastLiveAt = DateTime.now();
    switch (m) {
      case WelcomeMessage(:final info):
        confirmed.applySnapshot(m.snapshot, rev: m.rev, epoch: info.epoch, below: info.below.toSet());
        state.copyFrom(confirmed);
        _overlay({..._pendingIds, ..._private.keys});
        _connected(info);
        // a server without the private mode (older one after a restart): nothing is private any more
        if (!privateFeature && _private.isNotEmpty) _setPrivate(const []);
        extVersion++;
        _overlayExt();
        lastChanged = null;
        notifyListeners();
        _flush();
      case ResumedMessage(:final info):
        final changed = <String>{};
        for (final p in m.patches) {
          changed.addAll(confirmed.applyPatch(p));
        }
        if (m.rev > confirmed.rev) confirmed.rev = m.rev;
        _syncMeta();
        _connected(info);
        _overlayExt();
        lastChanged = _overlay(changed);
        notifyListeners();
        _flush();
      case PatchMessage():
        final changed = confirmed.applyPatch(m);
        if (changed.isEmpty && m.ext.isEmpty) return;
        _syncMeta();
        if (m.ext.isNotEmpty) _overlayExt();
        lastChanged = _overlay(changed);
        if (lastChanged!.isEmpty && m.ext.isEmpty) return;
        notifyListeners();
      case AckMessage():
        final e = _settle(m.req);
        if (e != null) _actAnswered(e, results: m.results);
        if (m.conflict.isNotEmpty) {
          _notices.add(BoardNotice('conflict', ids: m.conflict, message: 'Notiz wurde gleichzeitig geändert.'));
        }
      case NackMessage():
        final e = _settle(m.req);
        if (e == null) return;
        if (m.error == 'nothing') {
          if (e.kind == 'undo') canUndo = false;
          if (e.kind == 'redo') canRedo = false;
          notifyListeners();
          _notices.add(BoardNotice('nothing', error: m.error, message: m.message));
        } else {
          _notices.add(BoardNotice('rejected', error: m.error, message: m.message, ids: e.touched.toList()));
        }
        _actAnswered(e, error: m.error, message: m.message);
      case PrivateMessage(:final objects):
        if (!privateFeature) return;
        _setPrivate(objects);
      case HistoryMessage():
        canUndo = m.canUndo;
        canRedo = m.canRedo;
        lastChanged = const {};
        notifyListeners();
      case PresenceMessage():
        peers = m.peers;
        lastChanged = const {};
        notifyListeners();
      case EventMessage(type: 'board.renamed'):
        final seq = m.titleSeq ?? 0;
        if (seq > _titleSeq && m.title != null) {
          _titleSeq = seq;
          title = m.title;
          lastChanged = const {};
          notifyListeners();
        }
      case EventMessage(type: 'board.deleted'):
        deletedBy = m.by ?? '';
        lastChanged = const {};
        notifyListeners();
      default:
        break;
    }
  }

  /// Replaces the own private objects with [objects] (the whole store) and shows what changed.
  void _setPrivate(List<BoardObject> objects) {
    final next = {for (final o in objects) o.id: o};
    final ids = {..._private.keys, ...next.keys};
    _private = next;
    privateVersion++;
    lastChanged = _overlay(ids);
    notifyListeners();
  }

  /// Removes the pending entry [req] (confirmed or rejected) and shows the server's state for what it touched.
  PendingEntry? _settle(int req) {
    final i = _pending.indexWhere((e) => e.req == req);
    if (i < 0) return null;
    final e = _pending.removeAt(i);
    lastChanged = _overlay(e.touched);
    if (e.touchesExt) _overlayExt();
    _persistSoon();
    notifyListeners();
    return e;
  }

  void _syncMeta() {
    // `ext` comes through _overlayExt (own pending comment/reaction ops on top)
    state.rev = confirmed.rev;
    state.epoch = confirmed.epoch;
  }

  void _connected(ConnectionInfo info) {
    role = info.role;
    features = info.features;
    actions = info.actions;
    user = info.user;
    clientId = info.clientId ?? clientId;
    peers = info.peers;
    color = info.color ?? color;
    if (info.boardTitle != null && _titleSeq < 0) title = info.boardTitle;
    canUndo = info.canUndo;
    canRedo = info.canRedo;
    _loaded = true;
    _confirmed = true;
    _lastLiveAt = DateTime.now();
    presence.live = true;
    presence.resend();
  }

  @override
  void dispose() {
    _disposed = true;
    _sub?.cancel();
    _sendTimer?.cancel();
    if (_persistTimer != null) unawaited(persistPending());
    uploads.dispose();
    if (_listening) source.connection.removeListener(_onConnection);
    presence.dispose();
    _notices.close();
    _actResults.close();
    _actWaiters.clear();
    source.close();
    super.dispose();
  }
}
