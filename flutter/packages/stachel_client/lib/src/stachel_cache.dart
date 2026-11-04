import 'dart:async';
import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:stachel_board/stachel_board.dart';

import 'stachel_offline.dart';

/// Stachel data on this device (E1 offline reading), all below `<app support>/stachel/`:
/// - `boards/` last snapshot per board ([FileBoardCache], at most 20 boards / 40 MB),
/// - `images/` board images and PDF pages per tier (at most 150 MB, see `HttpBoardImages`),
/// - `thumbs/` preview images of the board list (`StachelThumbnail`),
/// - `offline/` boards switched to „Offline verfügbar“ with all their images (`StachelOffline`, own limit).
///
/// Bound to the login: every team logout calls [clearAll] (contract §8.1 „löscht den App-Cache der Boards“).
class StachelCache {
  StachelCache._();

  /// Tests point this at a temp directory (null = app support directory).
  static Directory? rootOverride;

  static Directory? _root;

  static Future<Directory> root() async {
    final o = rootOverride;
    if (o != null) return Directory('${o.path}/stachel');
    // the value is kept, not the future: a failure (no path_provider) is tried again next time
    return _root ??= Directory('${(await getApplicationSupportDirectory()).path}/stachel');
  }

  static Future<Directory> dir(String name) async {
    final d = Directory('${(await root()).path}/$name');
    await d.create(recursive: true);
    return d;
  }

  /// [dir], or null when there is no storage (tests without path_provider, full disk). Never throws.
  static Future<Directory?> tryDir(String name) async {
    try {
      return await dir(name);
    } catch (_) {
      return null;
    }
  }

  /// Snapshot cache of the boards.
  static final BoardCache boards = _LazyFileBoardCache();

  /// Removes boards, images, thumbnails and offline boards (logout). Never throws.
  static Future<void> clearAll() async {
    StachelOffline.instance.forget();
    try {
      final r = await root();
      if (await r.exists()) await r.delete(recursive: true);
    } catch (_) {}
  }
}

/// [FileBoardCache] whose directory is resolved on first use (path_provider is async). Boards switched to „Offline
/// verfügbar“ live in `offline/boards/` instead (`StachelOffline`: no count limit, images kept up to date).
class _LazyFileBoardCache implements BoardCache {
  Future<FileBoardCache> _cache() async => FileBoardCache(await StachelCache.dir('boards'));

  @override
  Future<CachedBoard?> load(String boardId) async {
    try {
      if (await StachelOffline.instance.pinned(boardId)) {
        final kept = await StachelOffline.instance.loadBoard(boardId);
        if (kept != null) return kept;
      }
      return await (await _cache()).load(boardId);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> save(CachedBoard board) async {
    try {
      if (await StachelOffline.instance.pinned(board.boardId)) return await StachelOffline.instance.saveBoard(board);
      await (await _cache()).save(board);
    } catch (_) {}
  }

  @override
  Future<void> clear() async {
    try {
      await (await _cache()).clear();
    } catch (_) {}
  }
}
