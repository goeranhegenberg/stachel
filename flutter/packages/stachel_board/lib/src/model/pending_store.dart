import 'dart:convert';
import 'dart:io';

/// Own changes the server has not confirmed yet, kept per board on the device (E3): leaving the board or killing the
/// app while offline loses nothing – the next open shows them again and sends them with their old `req` (the server
/// executes every `req` once; creates with fixed IDs, field updates and the comment ops with fixed IDs are safe to
/// repeat even after a server restart, contract §8.6).
abstract class PendingStore {
  /// Entries as saved (JSON of `PendingEntry.toJson`), oldest first; empty if none.
  Future<List<Object?>> load(String boardId);

  /// Replaces what is saved for [boardId]; an empty list removes it.
  Future<void> save(String boardId, List<Map<String, Object?>> entries);
}

/// In memory (tests; a controller without device storage).
class MemoryPendingStore implements PendingStore {
  final saved = <String, List<Map<String, Object?>>>{};

  @override
  Future<List<Object?>> load(String boardId) async => [...?saved[boardId]];

  @override
  Future<void> save(String boardId, List<Map<String, Object?>> entries) async {
    if (entries.isEmpty) {
      saved.remove(boardId);
    } else {
      // a JSON round trip like the file (no shared mutable maps)
      saved[boardId] = [for (final e in jsonDecode(jsonEncode(entries)) as List) (e as Map).cast<String, Object?>()];
    }
  }
}

/// One small file `pending_<board>.json` per board in [dir] (written to a temporary file first, then renamed, so an
/// app kill in the middle never leaves half a file). Errors are swallowed: the queue in memory still works.
class FilePendingStore implements PendingStore {
  FilePendingStore(this.dir);

  /// Directory (created on first save); null = nothing is stored.
  final Future<Directory?> Function() dir;

  /// Writes per board in order (a later save never loses against an earlier one still running).
  final _chains = <String, Future<void>>{};

  Future<File?> _file(String boardId) async {
    final d = await dir();
    if (d == null || !RegExp(r'^[A-Za-z0-9_-]{1,64}$').hasMatch(boardId)) return null;
    return File('${d.path}${Platform.pathSeparator}pending_$boardId.json');
  }

  @override
  Future<List<Object?>> load(String boardId) async {
    try {
      final f = await _file(boardId);
      if (f == null || !await f.exists()) return const [];
      final j = jsonDecode(await f.readAsString());
      return j is Map && j['v'] == 1 && j['entries'] is List ? j['entries'] as List : const [];
    } catch (_) {
      return const [];
    }
  }

  @override
  Future<void> save(String boardId, List<Map<String, Object?>> entries) {
    final body = entries.isEmpty ? null : jsonEncode({'v': 1, 'board': boardId, 'entries': entries});
    final next = (_chains[boardId] ?? Future.value()).then((_) async {
      try {
        final f = await _file(boardId);
        if (f == null) return;
        if (body == null) {
          if (await f.exists()) await f.delete();
          return;
        }
        await f.parent.create(recursive: true);
        final tmp = File('${f.path}.tmp');
        await tmp.writeAsString(body, flush: true);
        await tmp.rename(f.path);
      } catch (_) {}
    });
    _chains[boardId] = next;
    return next;
  }
}
