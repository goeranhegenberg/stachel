import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:stachel_board/stachel_board.dart';

/// Board images and PDF pages over HTTP (contract §3/§8.1: `GET /api/images/:id?w=256|1024` with
/// `Authorization: Bearer sts_…`):
/// - decoded in memory, bounded by decoded size ([maxMemoryBytes], least recently used go first),
/// - on disk per tier ([disk], bounded by [maxDiskBytes]; the server sends them `immutable`, so a stored file never
///   needs checking) – boards opened before show their images offline,
/// - at most 4 downloads at once, newest request first (what is on screen now); a failed download waits
///   [retryAfter] before it is tried again (no request storm while offline),
/// - offline without the wanted tier on disk: another tier from disk is better than nothing.
///
/// The renderer shows the image's average color plus a picture symbol until it is there and gets notified when it
/// arrives. A larger tier replaces a smaller one.
class HttpBoardImages extends ChangeNotifier implements BoardImages {
  HttpBoardImages({
    required this.base,
    required this.token,
    required this.client,
    this.disk,
    this.pinned,
    this.maxMemoryBytes = 96 * 1024 * 1024,
    this.maxDiskBytes = 150 * 1024 * 1024,
    this.retryAfter = const Duration(seconds: 15),
  });

  final String base;
  final Future<String> Function() token;
  final http.Client client;

  /// Directory for the disk cache (null = memory only).
  final Future<Directory?>? disk;

  /// Images of boards kept „Offline verfügbar“ (`StachelOffline`, same file names, never pruned here): read first.
  final Future<Directory?>? pinned;
  final int maxMemoryBytes;
  final int maxDiskBytes;
  final Duration retryAfter;

  final _images = <String, (ui.Image, int)>{};
  int _memoryBytes = 0;
  final _loading = <String>{};
  final _failedAt = <String, DateTime>{};
  final _missing = <String>{}; // 404 etc.: never again in this session
  final _queue = <(String, int)>[];
  int _running = 0;
  int _writes = 0;
  bool _disposed = false;

  /// Decoded bytes held in memory (tests, debug).
  int get memoryBytes => _memoryBytes;

  @override
  ui.Image? image(String id, int tier) {
    final hit = _images.remove(id);
    if (hit != null) _images[id] = hit; // most recently used last
    final have = hit?.$2 ?? 0;
    if (have < tier) _request(id, tier);
    return hit?.$1;
  }

  /// No tier of [id] can be loaded and none is held: the board shows „Bild nicht verfügbar“ like the web.
  @override
  bool missing(String id) => _images[id] == null && imageTiers.every((t) => _missing.contains('$id@$t'));

  /// [tier] of [id] is gone for good. Like the web (a failed tier falls back to the original) the other tier is tried;
  /// when that is gone too, listeners hear it (the renderer switches to „Bild nicht verfügbar“).
  void _markMissing(String id, int tier) {
    _missing.add('$id@$tier');
    if (_disposed || _images[id] != null) return;
    final other = tier == 1024 ? 256 : 1024;
    if (!_missing.contains('$id@$other')) {
      _request(id, other);
    } else {
      notifyListeners();
    }
  }

  void _request(String id, int tier) {
    final key = '$id@$tier';
    if (_disposed || _loading.contains(key) || _missing.contains(key)) return;
    final failed = _failedAt[key];
    if (failed != null && DateTime.now().difference(failed) < retryAfter) return;
    _loading.add(key);
    _queue.add((id, tier));
    _pump();
  }

  void _pump() {
    while (_running < 4 && _queue.isNotEmpty) {
      final (id, tier) = _queue.removeLast();
      _running++;
      unawaited(
        _load(id, tier).whenComplete(() {
          _running--;
          _loading.remove('$id@$tier');
          if (!_disposed) _pump();
        }),
      );
    }
  }

  File? _file(Directory? dir, String id, int tier) {
    if (dir == null || !RegExp(r'^[A-Za-z0-9_-]{1,64}$').hasMatch(id)) return null;
    return File('${dir.path}/${id}_$tier.img');
  }

  Future<void> _load(String id, int tier) async {
    final key = '$id@$tier';
    Directory? dir;
    try {
      dir = await disk;
    } catch (_) {}
    final file = _file(dir, id, tier);
    Uint8List? bytes;
    Directory? pinnedDir;
    try {
      pinnedDir = await pinned;
    } catch (_) {}
    try {
      final kept = _file(pinnedDir, id, tier);
      if (kept != null && await kept.exists()) {
        bytes = await kept.readAsBytes();
      } else if (file != null && await file.exists()) {
        bytes = await file.readAsBytes();
        unawaited(file.setLastModified(DateTime.now()).catchError((_) {})); // least recently used goes first
      }
    } catch (_) {}
    if (bytes == null) {
      try {
        final t = await token();
        final res = await client
            .get(
              Uri.parse('$base/api/images/${Uri.encodeComponent(id)}?w=$tier'),
              headers: {'Authorization': 'Bearer $t'},
            )
            .timeout(const Duration(seconds: 30));
        if (res.statusCode == 200) {
          bytes = res.bodyBytes;
          _failedAt.remove(key);
          if (file != null) unawaited(_store(file, bytes, dir!));
        } else if (res.statusCode == 404 || res.statusCode == 400 || res.statusCode == 410) {
          _markMissing(id, tier);
          return;
        } else {
          _failedAt[key] = DateTime.now();
        }
      } catch (_) {
        _failedAt[key] = DateTime.now(); // network: try again later
      }
    }
    // offline: another tier from disk is better than the placeholder
    if (bytes == null && _images[id] == null) {
      final other = _file(dir, id, tier == 1024 ? 256 : 1024);
      try {
        if (other != null && await other.exists()) {
          bytes = await other.readAsBytes();
          tier = tier == 1024 ? 256 : 1024;
        }
      } catch (_) {}
    }
    if (bytes == null) return;
    await _decode(id, tier, bytes);
  }

  Future<void> _decode(String id, int tier, Uint8List bytes) async {
    final ui.Image img;
    try {
      final codec = await ui.instantiateImageCodec(bytes);
      final frame = await codec.getNextFrame();
      codec.dispose();
      img = frame.image;
    } catch (_) {
      _markMissing(id, tier);
      return;
    }
    if (_disposed) {
      img.dispose();
      return;
    }
    final old = _images.remove(id);
    if (old != null && old.$2 > tier) {
      _images[id] = old;
      img.dispose();
      return;
    }
    if (old != null) {
      _memoryBytes -= _size(old.$1);
      old.$1.dispose();
    }
    _images[id] = (img, tier);
    _memoryBytes += _size(img);
    while (_memoryBytes > maxMemoryBytes && _images.length > 1) {
      final first = _images.keys.first;
      final e = _images.remove(first)!;
      _memoryBytes -= _size(e.$1);
      e.$1.dispose();
    }
    notifyListeners();
  }

  static int _size(ui.Image i) => i.width * i.height * 4;

  Future<void> _store(File file, Uint8List bytes, Directory dir) async {
    try {
      final tmp = File('${file.path}.tmp');
      await tmp.writeAsBytes(bytes);
      await tmp.rename(file.path);
      if (++_writes % 20 == 1) await pruneDisk(dir, maxDiskBytes);
    } catch (_) {}
  }

  /// Deletes the oldest files in [dir] until at most [maxBytes] remain.
  @visibleForTesting
  static Future<void> pruneDisk(Directory dir, int maxBytes) async {
    final files = <(File, FileStat)>[];
    await for (final e in dir.list()) {
      if (e is File) files.add((e, await e.stat()));
    }
    files.sort((a, b) => b.$2.modified.compareTo(a.$2.modified));
    var total = 0;
    for (final (f, s) in files) {
      total += s.size;
      if (total > maxBytes) {
        try {
          await f.delete();
        } catch (_) {}
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    for (final (img, _) in _images.values) {
      img.dispose();
    }
    _images.clear();
    _memoryBytes = 0;
    super.dispose();
  }
}
