import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:stachel_board/stachel_board.dart';

import 'stachel_boards_api.dart';
import 'stachel_cache.dart';

/// App version for `hello.app` of the background refresh (same as the board screen's).
const _appVersion =
    '${String.fromEnvironment('FLUTTER_BUILD_NAME', defaultValue: '0.0.0')}'
    '+${String.fromEnvironment('FLUTTER_BUILD_NUMBER', defaultValue: '0')}';

/// Image tiers the app shows (`GET /api/images/:id?w=…`, contract §3); 1024 is the largest the renderer asks for.
const stachelOfflineTiers = [256, 1024];

/// One board kept „Offline verfügbar“ (N10).
class StachelOfflineEntry {
  StachelOfflineEntry({
    required this.id,
    required this.title,
    required this.pinnedAt,
    this.syncedAt,
    this.boardBytes = 0,
    this.images = const [],
    this.imageBytes = 0,
    this.missing = 0,
    this.full = false,
    this.error,
  });

  final String id;
  String title;
  final DateTime pinnedAt;

  /// Last time board and images were brought up to date (null = not yet).
  DateTime? syncedAt;
  int boardBytes;

  /// Image IDs stored for this board (all tiers in [stachelOfflineTiers]).
  List<String> images;
  int imageBytes;

  /// Images of the board not on the device yet (no connection, storage full).
  int missing;

  /// The storage for offline boards was full at the last refresh.
  bool full;

  /// `too_large` (board over the size limit), `gone` (deleted / no access), `offline` (no connection) or null.
  String? error;

  int get bytes => boardBytes + imageBytes;
  bool get complete => syncedAt != null && missing == 0 && error == null;

  Map<String, Object?> toJson() => {
    'id': id,
    'title': title,
    'pinnedAt': pinnedAt.toUtc().toIso8601String(),
    'syncedAt': ?syncedAt?.toUtc().toIso8601String(),
    'boardBytes': boardBytes,
    'images': images,
    'imageBytes': imageBytes,
    'missing': missing,
    'full': full,
    'error': ?error,
  };

  static StachelOfflineEntry? fromJson(Object? j) {
    if (j is! Map || j['id'] is! String) return null;
    DateTime? time(String k) => j[k] is String ? DateTime.tryParse(j[k] as String)?.toLocal() : null;
    int n(String k) => j[k] is int ? j[k] as int : 0;
    return StachelOfflineEntry(
      id: j['id'] as String,
      title: j['title'] is String ? j['title'] as String : 'Board',
      pinnedAt: time('pinnedAt') ?? DateTime.now(),
      syncedAt: time('syncedAt'),
      boardBytes: n('boardBytes'),
      images: [
        for (final i in (j['images'] is List ? j['images'] as List : const []))
          if (i is String) i,
      ],
      imageBytes: n('imageBytes'),
      missing: n('missing'),
      full: j['full'] == true,
      error: j['error'] is String ? j['error'] as String : null,
    );
  }
}

/// Progress of a running refresh.
typedef StachelOfflineProgress = ({int done, int total});

/// Images and PDF pages a board shows: image objects and every page of a PDF document.
Set<String> offlineImageIds(Iterable<BoardObject> objects) => {
  for (final o in objects) ...[?o.imageId, if (o.type == 'document') ...o.docPages.values],
};

/// „Offline verfügbar“ per board (audit N10, concept E4c, app extra without a web counterpart): the board and all its
/// images/PDF pages are kept on the device and kept up to date, outside the normal caches' limits (20 boards / 40 MB,
/// 150 MB images, least recently used go first).
///
/// - Storage `<app support>/stachel/offline/`: `boards/` (snapshots, [FileBoardCache] without the count limit, a board
///   up to [maxBoardBytes]), `images/` (`<id>_<tier>.img` like `HttpBoardImages`, which reads them first),
///   `pinned.json` (the entries). Everything goes with the logout (`StachelCache.clearAll`).
/// - All offline boards together at most [maxBytes]; beyond that images stay out ([StachelOfflineEntry.full]).
/// - Up to date: right after switching on, whenever the open board saves its state (`StachelCache.boards` routes pinned
///   boards here), when the board list loads (boards changed since the last refresh) and when the app comes to the
///   front ([refreshIfDue], at most every 15 min). The refresh connects briefly to the board (`/native/v1`, resume
///   from the stored state) like opening it – others may see the person for a moment.
class StachelOffline extends ChangeNotifier {
  StachelOffline({
    this.maxBytes = 500 * 1024 * 1024,
    this.maxBoardBytes = 32 * 1024 * 1024,
    this.timeout = const Duration(seconds: 30),
  });

  /// The app's instance (tests replace it).
  static StachelOffline instance = StachelOffline();

  final int maxBytes;
  final int maxBoardBytes;
  final Duration timeout;

  /// Board connection for a refresh (tests pass a fixture); null = [NativeBoardSource] with the attached API.
  BoardSource Function(String boardId)? sourceFor;

  HttpStachelBoardsApi? _api;
  http.Client? _client;

  /// The API used for refreshes (session token, images); the Stachel screens attach theirs.
  void attach(HttpStachelBoardsApi api, http.Client client) {
    _api = api;
    _client = client;
  }

  Map<String, StachelOfflineEntry>? _entries;
  Future<Map<String, StachelOfflineEntry>>? _loading;
  final _progress = <String, StachelOfflineProgress>{};
  final _queue = <String>[];
  final _forced = <String>{};
  Future<void>? _running;
  final _imageTimers = <String, Timer>{};
  DateTime? _lastDue;

  /// Entries once loaded (empty before; call [load]).
  List<StachelOfflineEntry> get entries => [...?_entries?.values];
  StachelOfflineEntry? entry(String boardId) => _entries?[boardId];
  bool isPinned(String boardId) => _entries?.containsKey(boardId) ?? false;
  StachelOfflineProgress? progressOf(String boardId) => _progress[boardId];
  bool syncing(String boardId) => _progress.containsKey(boardId) || _queue.contains(boardId);
  int get totalBytes => entries.fold(0, (s, e) => s + e.bytes);

  // ---- storage ------------------------------------------------------------------------------------------------------

  Future<File?> _file() async {
    final d = await StachelCache.tryDir('offline');
    return d == null ? null : File('${d.path}/pinned.json');
  }

  /// Reads the entries (once; never throws).
  Future<Map<String, StachelOfflineEntry>> load() {
    final e = _entries;
    if (e != null) return Future.value(e);
    return _loading ??= () async {
      final out = <String, StachelOfflineEntry>{};
      try {
        final f = await _file();
        if (f != null && await f.exists()) {
          final j = jsonDecode(await f.readAsString());
          for (final x in (j is Map && j['boards'] is List ? j['boards'] as List : const [])) {
            if (StachelOfflineEntry.fromJson(x) case final entry?) out[entry.id] = entry;
          }
        }
      } catch (_) {}
      _entries = out;
      _loading = null;
      notifyListeners();
      return out;
    }();
  }

  Future<bool> pinned(String boardId) async => (await load()).containsKey(boardId);

  Future<void> _save() async {
    try {
      final f = await _file();
      if (f == null) return;
      final tmp = File('${f.path}.tmp');
      await tmp.writeAsString(
        jsonEncode({
          'v': 1,
          'boards': [for (final e in entries) e.toJson()],
        }),
      );
      await tmp.rename(f.path);
    } catch (_) {}
  }

  Future<FileBoardCache?> _boards() async {
    final d = await StachelCache.tryDir('offline/boards');
    return d == null ? null : FileBoardCache(d, maxBoards: 100000, maxBytes: 1 << 40, maxBoardBytes: maxBoardBytes);
  }

  Future<FileBoardCache?> _normalBoards() async {
    final d = await StachelCache.tryDir('boards');
    return d == null ? null : FileBoardCache(d);
  }

  /// The stored state of a pinned board (null = none).
  Future<CachedBoard?> loadBoard(String boardId) async {
    try {
      return await (await _boards())?.load(boardId);
    } catch (_) {
      return null;
    }
  }

  /// Stores the state of a pinned board (from the open board or a refresh) and brings its images up to date soon.
  Future<void> saveBoard(CachedBoard board, {bool imagesNow = false}) async {
    final e = (await load())[board.boardId];
    if (e == null) return;
    final cache = await _boards();
    if (cache == null) return;
    try {
      await cache.save(board);
    } catch (_) {}
    final f = File('${cache.dir.path}/board_${board.boardId}.json');
    final stored = await f.exists();
    e.boardBytes = stored ? await f.length() : 0;
    e.error = stored ? (e.error == 'too_large' ? null : e.error) : 'too_large';
    if (board.title != null) e.title = board.title!;
    await _save();
    notifyListeners();
    if (!stored) return;
    if (imagesNow) {
      await _syncImages(e, board);
    } else {
      // the open board saves every few seconds: images once it is quiet
      _imageTimers[board.boardId]?.cancel();
      _imageTimers[board.boardId] = Timer(const Duration(seconds: 5), () {
        _imageTimers.remove(board.boardId);
        unawaited(_syncImages(e, board));
      });
    }
  }

  // ---- switch -------------------------------------------------------------------------------------------------------

  /// „Offline verfügbar“ on: kept from now on (a state the device already has moves over), then refreshed fully.
  Future<void> pin(String boardId, String title) async {
    final all = await load();
    if (all.containsKey(boardId)) return;
    all[boardId] = StachelOfflineEntry(id: boardId, title: title, pinnedAt: DateTime.now());
    notifyListeners();
    await _save();
    final normal = await (await _normalBoards())?.load(boardId);
    if (normal != null) await saveBoard(normal, imagesNow: false);
    await sync(boardId, force: true);
  }

  /// „Offline verfügbar“ off: the state goes back to the normal cache (its limits apply again), images only this board
  /// used are deleted.
  Future<void> unpin(String boardId) async {
    final all = await load();
    final e = all.remove(boardId);
    if (e == null) return;
    _imageTimers.remove(boardId)?.cancel();
    _queue.remove(boardId);
    notifyListeners();
    await _save();
    final cache = await _boards();
    final board = await cache?.load(boardId);
    if (board != null) {
      try {
        await (await _normalBoards())?.save(board);
      } catch (_) {}
    }
    try {
      final f = cache == null ? null : File('${cache.dir.path}/board_$boardId.json');
      if (f != null && await f.exists()) await f.delete();
    } catch (_) {}
    final keep = {for (final o in all.values) ...o.images};
    await _deleteImages(e.images.where((i) => !keep.contains(i)));
  }

  /// Forgets everything in memory (logout; the files go with `StachelCache.clearAll`).
  void forget() {
    for (final t in _imageTimers.values) {
      t.cancel();
    }
    _imageTimers.clear();
    _queue.clear();
    _entries = {};
    _loading = null;
    _lastDue = null;
    notifyListeners();
  }

  // ---- refresh ------------------------------------------------------------------------------------------------------

  /// Brings [boardId] up to date (queued, one board at a time). [force] = even if nothing changed.
  Future<void> sync(String boardId, {bool force = false}) {
    if (!_queue.contains(boardId)) _queue.add(boardId);
    if (force) _forced.add(boardId);
    notifyListeners();
    return _running ??= _work().whenComplete(() => _running = null);
  }

  /// Boards of [list] changed since their last refresh (or never complete) are refreshed.
  Future<void> refresh(List<StachelBoardInfo> list) async {
    final all = await load();
    final byId = {for (final b in list) b.id: b};
    final due = <String>[];
    for (final e in all.values) {
      final b = byId[e.id];
      if (b == null) continue; // not in the list (deleted, no access): keep what is there
      if (b.title != e.title) e.title = b.title;
      final synced = e.syncedAt;
      final changed = synced == null || (b.updatedAt != null && b.updatedAt!.isAfter(synced));
      if (changed || !e.complete) due.add(e.id);
    }
    _lastDue = DateTime.now();
    await Future.wait([for (final id in due) sync(id)]);
  }

  /// App in front: at most every [every] the list is fetched and changed offline boards are refreshed. Never throws.
  Future<void> refreshIfDue(StachelBoardsApi boards, {Duration every = const Duration(minutes: 15)}) async {
    final last = _lastDue;
    if (last != null && DateTime.now().difference(last) < every) return;
    if ((await load()).isEmpty) return;
    _lastDue = DateTime.now();
    try {
      await refresh(await boards.boards());
    } catch (_) {}
  }

  Future<void> _work() async {
    while (_queue.isNotEmpty) {
      final id = _queue.first;
      try {
        await _syncOne(id, force: _forced.remove(id));
      } catch (_) {}
      _queue.remove(id);
      _progress.remove(id);
      notifyListeners();
    }
  }

  Future<void> _syncOne(String id, {required bool force}) async {
    final e = (await load())[id];
    if (e == null) return;
    _progress[id] = (done: 0, total: 0);
    notifyListeners();
    final stored = await loadBoard(id);
    final (fresh, closed) = await _fetchBoard(id, stored);
    if (!isPinned(id)) return; // switched off meanwhile
    if (fresh != null) {
      e.error = null;
      await saveBoard(fresh, imagesNow: true);
    } else {
      e.error = closed != null && closed != 'invalid_token' ? 'gone' : 'offline';
      if (stored != null) await _syncImages(e, stored); // the images of what is there
      await _save();
      notifyListeners();
      return;
    }
    if (e.error == null) {
      e.syncedAt = DateTime.now();
      await _save();
      notifyListeners();
    }
  }

  /// Connects briefly (resume from [stored]) and returns the server-confirmed state, or why it closed.
  Future<(CachedBoard?, String?)> _fetchBoard(String id, CachedBoard? stored) async {
    final source = sourceFor?.call(id) ?? _nativeSource(id);
    if (source == null) return (null, null);
    final c = BoardController(source);
    if (stored != null) c.restore(stored);
    final done = Completer<void>();
    void check() {
      if (!done.isCompleted && (c.toCache(id) != null || source.connection.value == BoardConnection.closed)) {
        done.complete();
      }
    }

    c.addListener(check);
    source.connection.addListener(check);
    try {
      unawaited(c.start().catchError((_) {}));
      check();
      await done.future.timeout(timeout);
    } catch (_) {}
    final entry = c.toCache(id);
    final reason = source.closeReason;
    c.removeListener(check);
    source.connection.removeListener(check);
    c.dispose();
    return (entry, reason);
  }

  BoardSource? _nativeSource(String id) {
    final api = _api;
    if (api == null) return null;
    return NativeBoardSource(
      base: Uri.parse(api.base),
      board: id,
      appVersion: _appVersion,
      token: ({bool fresh = false}) => api.sessionToken(fresh: fresh),
    );
  }

  // ---- images -------------------------------------------------------------------------------------------------------

  Future<void> _syncImages(StachelOfflineEntry e, CachedBoard board) async {
    final pinnedDir = await StachelCache.tryDir('offline/images');
    if (pinnedDir == null) return;
    final normalDir = await StachelCache.tryDir('images');
    final wanted = offlineImageIds(board.snapshot.objects).where((i) => _safeId.hasMatch(i)).toList()..sort();
    final others = {
      for (final o in entries)
        if (o.id != e.id) ...o.images,
    };
    final stored = <String>[];
    var bytes = 0, missing = 0;
    var full = false, offline = false;
    // room for this board's images: the limit minus the other offline boards and this board's state
    final budget = maxBytes - (totalBytes - e.imageBytes);
    var done = 0;
    for (final id in wanted) {
      var size = 0;
      var ok = true;
      for (final tier in stachelOfflineTiers) {
        if (offline || full) {
          ok = false;
          break;
        }
        final f = File('${pinnedDir.path}/${id}_$tier.img');
        if (await f.exists()) {
          size += await f.length();
          continue;
        }
        Uint8List? data;
        final cached = normalDir == null ? null : File('${normalDir.path}/${id}_$tier.img');
        if (cached != null && await cached.exists()) {
          try {
            data = await cached.readAsBytes();
          } catch (_) {}
        }
        if (data == null) {
          final (got, status) = await _download(id, tier);
          if (got == null) {
            ok = false;
            if (status == 0 || status >= 500 || status == 401 || status == 429) offline = true; // later again
            break; // 404 etc.: gone on the server
          }
          data = got;
        }
        if (bytes + size + data.length > budget) {
          full = true;
          ok = false;
          break;
        }
        try {
          final tmp = File('${f.path}.tmp');
          await tmp.writeAsBytes(data);
          await tmp.rename(f.path);
          size += data.length;
        } catch (_) {
          ok = false;
          break;
        }
      }
      if (ok) {
        stored.add(id);
        bytes += size;
      } else {
        missing++;
      }
      done++;
      if (_progress.containsKey(e.id)) _progress[e.id] = (done: done, total: wanted.length);
      notifyListeners();
    }
    if (!isPinned(e.id)) return;
    // pictures removed from the board: away unless another offline board shows them
    final keep = {...stored, ...others};
    await _deleteImages(e.images.where((i) => !keep.contains(i)));
    e
      ..images = stored
      ..imageBytes = bytes
      ..missing = missing
      ..full = full;
    if (offline && e.error == null) e.error = 'offline';
    await _save();
    notifyListeners();
  }

  static final _safeId = RegExp(r'^[A-Za-z0-9_-]{1,64}$');

  /// (bytes, HTTP status; 0 = network error).
  Future<(Uint8List?, int)> _download(String id, int tier) async {
    final api = _api, client = _client;
    if (api == null || client == null) return (null, 0);
    try {
      final token = await api.sessionToken();
      final res = await client
          .get(
            Uri.parse('${api.base}/api/images/${Uri.encodeComponent(id)}?w=$tier'),
            headers: {'Authorization': 'Bearer $token'},
          )
          .timeout(const Duration(seconds: 60));
      return res.statusCode == 200 ? (res.bodyBytes, 200) : (null, res.statusCode);
    } catch (_) {
      return (null, 0);
    }
  }

  Future<void> _deleteImages(Iterable<String> ids) async {
    final dir = await StachelCache.tryDir('offline/images');
    if (dir == null) return;
    for (final id in ids) {
      for (final tier in stachelOfflineTiers) {
        try {
          final f = File('${dir.path}/${id}_$tier.img');
          if (await f.exists()) await f.delete();
        } catch (_) {}
      }
    }
  }
}

/// „12,3 MB“ / „840 KB“.
String stachelBytes(int bytes) {
  if (bytes < 1024 * 1024) return '${(bytes / 1024).ceil()} KB';
  final mb = bytes / (1024 * 1024);
  return '${mb.toStringAsFixed(mb < 100 ? 1 : 0).replaceAll('.', ',')} MB';
}
