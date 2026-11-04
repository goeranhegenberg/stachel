import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';

/// Image tiers of the server (`GET /api/images/:id?w=256|1024`, contract §3).
const imageTiers = [256, 1024];

/// Tier for an object drawn [screenWidth] device pixels wide (object width × zoom × devicePixelRatio, like the web).
int imageTierFor(double screenWidth) => screenWidth <= 256 ? 256 : 1024;

/// Decoded board images. The renderer asks synchronously and draws what is there (else the image's average color);
/// an implementation loads missing tiers in the background and notifies listeners when one arrives.
///
/// The app's implementation (E1) fetches with `Authorization: Bearer sts_…`, keeps a memory LRU and a disk cache.
abstract class BoardImages implements Listenable {
  /// Best image available for [id] (any tier); requests tier [tier] if it is not there yet.
  ui.Image? image(String id, int tier);

  /// [id] is gone for good (no tier could be loaded: 404, broken file) – the renderer then shows „Bild nicht
  /// verfügbar“ like the web (`image-missing`) instead of the loading placeholder. Notify listeners when it changes.
  bool missing(String id);
}

/// No images (tests, offline without cache): every image shows its average color.
class NoBoardImages extends ChangeNotifier implements BoardImages {
  @override
  ui.Image? image(String id, int tier) => null;

  @override
  bool missing(String id) => false;
}

/// Images held in memory (debug screen, benchmark, golden tests).
class MemoryBoardImages extends ChangeNotifier implements BoardImages {
  final _images = <String, ui.Image>{};
  final _missing = <String>{};
  final requested = <(String, int)>{};

  void put(String id, ui.Image image) {
    _images[id] = image;
    _missing.remove(id);
    notifyListeners();
  }

  /// Marks [id] as permanently missing (tests).
  void markMissing(String id) {
    _missing.add(id);
    notifyListeners();
  }

  @override
  ui.Image? image(String id, int tier) {
    final img = _images[id];
    if (img == null) requested.add((id, tier));
    return img;
  }

  @override
  bool missing(String id) => _images[id] == null && _missing.contains(id);
}
