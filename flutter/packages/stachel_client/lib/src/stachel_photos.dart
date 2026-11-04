import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:image_picker/image_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'stachel_cache.dart';

/// A photo for a Stachel board, ready to upload: bytes in a type the server takes (JPEG/PNG/WebP/GIF), pixel size and
/// average color (the web stores it as `color`, the board shows it while loading and far out).
class StachelPhoto {
  const StachelPhoto({required this.bytes, required this.mime, required this.width, required this.height, this.color});
  final Uint8List bytes;
  final String mime;
  final int width;
  final int height;
  final String? color;
}

/// Where a photo comes from.
enum StachelPhotoSource { camera, gallery }

/// Picks a photo (camera or gallery), resized and compressed on the device. Tests replace it.
abstract class StachelPhotoPicker {
  /// Null = cancelled.
  Future<Uint8List?> pick(StachelPhotoSource source);

  /// Several photos from the gallery at once (web: several files in the file dialog); empty = cancelled.
  Future<List<Uint8List>> pickMany() async {
    final one = await pick(StachelPhotoSource.gallery);
    return one == null ? const [] : [one];
  }
}

/// [image_picker]: longest side 2048 px, JPEG quality 82 (a phone photo becomes ~0.5–1 MB instead of 5–12 MB; the
/// server limit is 15 MB).
class ImagePickerPhotos implements StachelPhotoPicker {
  ImagePickerPhotos([ImagePicker? picker]) : _picker = picker ?? ImagePicker();
  final ImagePicker _picker;

  static const maxSide = 2048.0;
  static const quality = 82;

  @override
  Future<Uint8List?> pick(StachelPhotoSource source) async {
    final f = await _picker.pickImage(
      source: source == StachelPhotoSource.camera ? ImageSource.camera : ImageSource.gallery,
      maxWidth: maxSide,
      maxHeight: maxSide,
      imageQuality: quality,
      requestFullMetadata: false,
    );
    return f?.readAsBytes();
  }

  @override
  Future<List<Uint8List>> pickMany() async {
    final files = await _picker.pickMultiImage(
      maxWidth: maxSide,
      maxHeight: maxSide,
      imageQuality: quality,
      requestFullMetadata: false,
    );
    return [for (final f in files) await f.readAsBytes()];
  }
}

/// Type by magic bytes (the server checks the same way).
String? imageMime(Uint8List b) {
  if (b.length >= 3 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4e && b[3] == 0x47) return 'image/png';
  if (b.length >= 6 && b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46) return 'image/gif';
  if (b.length >= 12 &&
      b[0] == 0x52 &&
      b[1] == 0x49 &&
      b[2] == 0x46 &&
      b[3] == 0x46 &&
      b[8] == 0x57 &&
      b[9] == 0x45 &&
      b[10] == 0x42 &&
      b[11] == 0x50) {
    return 'image/webp';
  }
  return null;
}

/// Size, average color and an uploadable type for [bytes]; other formats (HEIC …) are re-encoded as PNG with the
/// longest side at most [maxSide]. Null if it is no image.
Future<StachelPhoto?> preparePhoto(Uint8List bytes, {int maxSide = 2048}) async {
  try {
    var data = bytes;
    var mime = imageMime(bytes);
    final full = await ui.instantiateImageCodec(bytes);
    final frame = await full.getNextFrame();
    var img = frame.image;
    if (mime == null) {
      final scale = (maxSide / (img.width > img.height ? img.width : img.height)).clamp(0.0, 1.0);
      if (scale < 1) {
        final c = await ui.instantiateImageCodec(
          bytes,
          targetWidth: (img.width * scale).round(),
          targetHeight: (img.height * scale).round(),
        );
        img.dispose();
        img = (await c.getNextFrame()).image;
      }
      final png = await img.toByteData(format: ui.ImageByteFormat.png);
      if (png == null) return null;
      data = png.buffer.asUint8List();
      mime = 'image/png';
    }
    final w = img.width, h = img.height;
    img.dispose();
    return StachelPhoto(bytes: data, mime: mime, width: w, height: h, color: await averageColor(bytes));
  } catch (_) {
    return null;
  }
}

/// Average color (#rrggbb, alpha weighted) of an image, from a 4 × 4 decode like the web's `averageColor`.
Future<String?> averageColor(Uint8List bytes) async {
  try {
    final c = await ui.instantiateImageCodec(bytes, targetWidth: 4, targetHeight: 4);
    final img = (await c.getNextFrame()).image;
    final d = await img.toByteData(format: ui.ImageByteFormat.rawRgba);
    img.dispose();
    if (d == null) return null;
    var r = 0.0, g = 0.0, b = 0.0, a = 0.0;
    for (var i = 0; i + 3 < d.lengthInBytes; i += 4) {
      final w = d.getUint8(i + 3) / 255;
      r += d.getUint8(i) * w;
      g += d.getUint8(i + 1) * w;
      b += d.getUint8(i + 2) * w;
      a += w;
    }
    if (a == 0) return null;
    String hex(double v) => v.round().clamp(0, 255).toRadixString(16).padLeft(2, '0');
    return '#${hex(r / a)}${hex(g / a)}${hex(b / a)}';
  } catch (_) {
    return null;
  }
}

/// A photo waiting to go onto a board (offline-safe: the file and this entry survive leaving the board and an app
/// kill; the next open of the board uploads it and places it where it was meant to go).
class StachelUpload {
  const StachelUpload({
    required this.key,
    required this.board,
    required this.file,
    required this.mime,
    required this.width,
    required this.height,
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    this.color,
    this.imageId,
    required this.createdAt,
  });

  final String key;
  final String board;

  /// Path of the bytes on the device.
  final String file;
  final String mime;
  final int width;
  final int height;

  /// Where it goes on the board (world box, as shown by the placeholder).
  final double x, y, w, h;
  final String? color;

  /// Already uploaded (only the object is still missing).
  final String? imageId;
  final DateTime createdAt;

  StachelUpload withImage(String id) => StachelUpload(
    key: key,
    board: board,
    file: file,
    mime: mime,
    width: width,
    height: height,
    x: x,
    y: y,
    w: w,
    h: h,
    color: color,
    imageId: id,
    createdAt: createdAt,
  );

  Map<String, Object?> toJson() => {
    'key': key,
    'board': board,
    'file': file,
    'mime': mime,
    'width': width,
    'height': height,
    'x': x,
    'y': y,
    'w': w,
    'h': h,
    'color': ?color,
    'imageId': ?imageId,
    'createdAt': createdAt.toUtc().toIso8601String(),
  };

  static StachelUpload? fromJson(Object? j) {
    if (j is! Map) return null;
    try {
      double n(String k) => (j[k] as num).toDouble();
      return StachelUpload(
        key: j['key'] as String,
        board: j['board'] as String,
        file: j['file'] as String,
        mime: j['mime'] as String,
        width: (j['width'] as num).toInt(),
        height: (j['height'] as num).toInt(),
        x: n('x'),
        y: n('y'),
        w: n('w'),
        h: n('h'),
        color: j['color'] as String?,
        imageId: j['imageId'] as String?,
        createdAt: DateTime.parse(j['createdAt'] as String).toLocal(),
      );
    } catch (_) {
      return null;
    }
  }
}

/// The waiting uploads of all boards (SharedPreferences `stachel_uploads_v1` + files under
/// `<app support>/stachel/uploads`). Tests use [MemoryStachelUploads].
abstract class StachelUploads {
  Future<List<StachelUpload>> of(String board);

  /// Stores [bytes] and the entry (null = could not be stored: the upload still runs, just not offline-safe).
  Future<StachelUpload?> add(StachelUpload entry, Uint8List bytes);
  Future<void> update(StachelUpload entry);
  Future<void> remove(StachelUpload entry);
  Future<Uint8List?> bytesOf(StachelUpload entry);
}

class MemoryStachelUploads implements StachelUploads {
  final entries = <String, StachelUpload>{};
  final files = <String, Uint8List>{};

  @override
  Future<List<StachelUpload>> of(String board) async => [
    for (final e in entries.values)
      if (e.board == board) e,
  ];

  @override
  Future<StachelUpload?> add(StachelUpload entry, Uint8List bytes) async {
    entries[entry.key] = entry;
    files[entry.key] = bytes;
    return entry;
  }

  @override
  Future<void> update(StachelUpload entry) async => entries[entry.key] = entry;

  @override
  Future<void> remove(StachelUpload entry) async {
    entries.remove(entry.key);
    files.remove(entry.key);
  }

  @override
  Future<Uint8List?> bytesOf(StachelUpload entry) async => files[entry.key];
}

class FileStachelUploads implements StachelUploads {
  FileStachelUploads._();
  static final instance = FileStachelUploads._();

  static const _key = 'stachel_uploads_v1';

  /// Entries older than this are dropped (with their file).
  static const maxAge = Duration(days: 7);

  Future<List<StachelUpload>> _all() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.reload();
      final raw = prefs.getString(_key);
      final list = raw == null ? const [] : jsonDecode(raw) as List;
      return [for (final j in list) ?StachelUpload.fromJson(j)];
    } catch (_) {
      return [];
    }
  }

  Future<void> _save(List<StachelUpload> list) async {
    final prefs = await SharedPreferences.getInstance();
    if (list.isEmpty) {
      await prefs.remove(_key);
    } else {
      await prefs.setString(_key, jsonEncode([for (final e in list) e.toJson()]));
    }
  }

  @override
  Future<List<StachelUpload>> of(String board) async {
    final all = await _all();
    final cutoff = DateTime.now().subtract(maxAge);
    final old = [
      for (final e in all)
        if (e.createdAt.isBefore(cutoff)) e,
    ];
    for (final e in old) {
      await remove(e);
    }
    return [
      for (final e in all)
        if (e.board == board && !e.createdAt.isBefore(cutoff)) e,
    ];
  }

  @override
  Future<StachelUpload?> add(StachelUpload entry, Uint8List bytes) async {
    final dir = await StachelCache.tryDir('uploads');
    if (dir == null) return null;
    try {
      await dir.create(recursive: true);
      final f = File('${dir.path}${Platform.pathSeparator}${entry.key}');
      await f.writeAsBytes(bytes, flush: true);
      final e = StachelUpload.fromJson({...entry.toJson(), 'file': f.path})!;
      await _save([...await _all(), e]);
      return e;
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> update(StachelUpload entry) async {
    final all = await _all();
    await _save([for (final e in all) e.key == entry.key ? entry : e]);
  }

  @override
  Future<void> remove(StachelUpload entry) async {
    final all = await _all();
    await _save([
      for (final e in all)
        if (e.key != entry.key) e,
    ]);
    try {
      await File(entry.file).delete();
    } catch (_) {}
  }

  @override
  Future<Uint8List?> bytesOf(StachelUpload entry) async {
    try {
      return await File(entry.file).readAsBytes();
    } catch (_) {
      return null;
    }
  }
}
