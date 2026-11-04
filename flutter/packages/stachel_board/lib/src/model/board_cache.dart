import 'dart:convert';
import 'dart:io';
import 'dart:isolate';

import '../protocol/native_messages.dart';
import 'board_state.dart';

/// Last confirmed state of one board on this device (E1 offline: open from the cache, then resume from [epoch]/[rev]).
class CachedBoard {
  const CachedBoard({
    required this.boardId,
    required this.snapshot,
    required this.epoch,
    required this.rev,
    required this.savedAt,
    this.title,
    this.below = const ['frame'],
    this.role,
  });

  final String boardId;
  final String? title;

  /// Own role when it was saved (`welcome.role`): a board opened from the cache shows the right tools before the
  /// server answers (`view`/`comment` in instances with own accounts). Null = unknown (older entries).
  final String? role;
  final BoardSnapshot snapshot;
  final String epoch;
  final int rev;

  /// When the board was last live (the time shown as „Stand von …“).
  final DateTime savedAt;
  final List<String> below;

  /// The [state] of [boardId] as cache entry.
  factory CachedBoard.of(String boardId, BoardState state, {String? title, DateTime? savedAt, String? role}) =>
      CachedBoard(
        boardId: boardId,
        title: title,
        role: role,
        snapshot: BoardSnapshot(objects: state.ordered, ext: state.ext),
        epoch: state.epoch,
        rev: state.rev,
        savedAt: savedAt ?? DateTime.now(),
        below: state.below.toList(),
      );

  Map<String, Object?> toJson() => {
    'v': 1,
    'board': boardId,
    'title': ?title,
    'role': ?role,
    'epoch': epoch,
    'rev': rev,
    'savedAt': savedAt.toUtc().toIso8601String(),
    'below': below,
    'snapshot': snapshot.toJson(),
  };

  /// Null for anything that is not a cache entry of this version.
  static CachedBoard? fromJson(Object? j) {
    if (j is! Map || j['v'] != 1 || j['board'] is! String || j['epoch'] is! String || j['rev'] is! int) return null;
    final savedAt = DateTime.tryParse(j['savedAt'] is String ? j['savedAt'] as String : '');
    if (savedAt == null) return null;
    return CachedBoard(
      boardId: j['board'] as String,
      title: j['title'] is String ? j['title'] as String : null,
      role: j['role'] is String ? j['role'] as String : null,
      snapshot: BoardSnapshot.fromJson(j['snapshot']),
      epoch: j['epoch'] as String,
      rev: j['rev'] as int,
      savedAt: savedAt.toLocal(),
      below: [
        for (final b in (j['below'] is List ? j['below'] as List : const ['frame']))
          if (b is String) b,
      ],
    );
  }
}

/// Where boards are kept for offline reading.
abstract class BoardCache {
  Future<CachedBoard?> load(String boardId);
  Future<void> save(CachedBoard board);

  /// Removes everything (logout).
  Future<void> clear();
}

/// In memory (tests, debug screen).
class MemoryBoardCache implements BoardCache {
  final boards = <String, CachedBoard>{};

  @override
  Future<CachedBoard?> load(String boardId) async => boards[boardId];

  @override
  Future<void> save(CachedBoard board) async => boards[board.boardId] = board;

  @override
  Future<void> clear() async => boards.clear();
}

/// One JSON file per board in [dir], size-bounded: after each save the least recently saved boards go until at most
/// [maxBoards] files and [maxBytes] remain (the board just saved always stays). A board whose JSON alone exceeds
/// [maxBoardBytes] is not cached. Encoding/decoding runs in a background isolate (a 5 000-object board is a few MB).
class FileBoardCache implements BoardCache {
  FileBoardCache(
    this.dir, {
    this.maxBoards = 20,
    this.maxBytes = 40 * 1024 * 1024,
    this.maxBoardBytes = 16 * 1024 * 1024,
  });

  final Directory dir;
  final int maxBoards;
  final int maxBytes;
  final int maxBoardBytes;

  static final _safeId = RegExp(r'^[A-Za-z0-9_-]{1,64}$');

  File? _file(String boardId) => _safeId.hasMatch(boardId) ? File('${dir.path}/board_$boardId.json') : null;

  @override
  Future<CachedBoard?> load(String boardId) async {
    final f = _file(boardId);
    if (f == null) return null;
    try {
      if (!await f.exists()) return null;
      final bytes = await f.readAsBytes();
      return await Isolate.run(() => CachedBoard.fromJson(jsonDecode(utf8.decode(bytes))));
    } catch (_) {
      return null; // broken file: as if nothing was cached
    }
  }

  @override
  Future<void> save(CachedBoard board) async {
    final f = _file(board.boardId);
    if (f == null) return;
    final json = board.toJson();
    final bytes = await Isolate.run(() => utf8.encode(jsonEncode(json)));
    if (bytes.length > maxBoardBytes) {
      if (await f.exists()) await f.delete();
      return;
    }
    await dir.create(recursive: true);
    final tmp = File('${f.path}.tmp');
    await tmp.writeAsBytes(bytes, flush: true);
    await tmp.rename(f.path);
    await _prune(keep: 'board_${board.boardId}.json');
  }

  Future<void> _prune({required String keep}) async {
    final files = <(File, FileStat)>[];
    await for (final e in dir.list()) {
      final name = e.uri.pathSegments.last;
      if (e is File && name.endsWith('.json') && name.startsWith('board_')) {
        files.add((e, await e.stat()));
      }
    }
    files.sort((a, b) => b.$2.modified.compareTo(a.$2.modified)); // newest first
    var total = 0, count = 0;
    for (final (f, s) in files) {
      final mine = f.uri.pathSegments.last == keep;
      if (!mine && (count >= maxBoards || total + s.size > maxBytes)) {
        try {
          await f.delete();
        } catch (_) {}
        continue;
      }
      total += s.size;
      count++;
    }
  }

  @override
  Future<void> clear() async {
    try {
      if (await dir.exists()) await dir.delete(recursive: true);
    } catch (_) {}
  }
}
