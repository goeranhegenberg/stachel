import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as dui;

import 'package:flutter/painting.dart';

import '../../editor/registry/board_ui.dart';
import '../../geometry/connector_route.dart';
import '../../mindmap/mind_render.dart';
import '../../model/board_object.dart';
import '../../render/board_images.dart';
import '../../render/board_scene.dart';
import '../../render/object_renderers.dart';
import '../../render/paint_utils.dart';
import '../../render/text_layout.dart';

// Offscreen rendering of a board region with the app's renderers (export N07/N08, preview image N09) – the web
// renders its ObjectLayer into a canvas (`features/tools/export/render.tsx`); the app draws the same objects with
// the painter's per-object renderers into a `PictureRecorder`.

/// World bounds of [o] like the web's `api.bounds`: connectors by their route, everything else by its rotated box.
Rect? boardObjectBounds(BoardScene scene, BoardObject o) {
  if (o.type == 'connector') {
    final g = scene.connector(o.id);
    return g == null ? null : connectorBounds(g, 0);
  }
  return objectRect(o);
}

/// Board background color from `tools.settings` (web `getSettings(api).color`), else the default.
Color boardBackgroundColor(BoardUi ui) {
  final s = ui.controller.state.ext['tools.settings'];
  final c = s is Map ? s['color'] : null;
  if (c is String && RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(c)) return parseColor(c, BoardColors.background);
  return BoardColors.background;
}

/// Renders the world rectangle [world] at [scale] pixels per board unit into an image of
/// `max(1, round(world.width * scale))` × `max(1, round(world.height * scale))` pixels.
///
/// - [objects]: what to draw, bottom → top (default: every visible object of the board); hidden ones are skipped.
/// - Background: [background] (default: the board's color from `tools.settings`), none with [transparent].
/// - Images and PDF pages are requested at the tier the image needs; the call waits up to [imageWait] for them
///   (then draws the average color like the board does). [Duration.zero] records the picture synchronously with
///   what is in memory now (only `toImage` is asynchronous).
///
/// Used by the export (pages of PNG/PDF). The overview's preview image is rendered by the server (P8, Welle B).
Future<dui.Image> renderBoardRegion(
  BoardUi ui, {
  required Rect world,
  required double scale,
  List<BoardObject>? objects,
  bool transparent = false,
  Color? background,
  Duration imageWait = const Duration(seconds: 3),
  BoardImages? images,
  BoardFonts? fonts,
}) async {
  final scene = ui.editor.scene;
  scene.bounds; // brings the scene (connector routes) up to date
  final view = ui.view?.widget;
  images ??= view?.images ?? NoBoardImages();
  final ctx = RenderContext(
    scene: scene,
    text: TextLayoutCache(maxEntries: 2000),
    fonts: fonts ?? view?.fonts ?? const BoardFonts(),
    images: images,
  )..zoom = scale;
  // like the web's export (its ObjectLayer only): no frame titles (they are the editor's overlay) and nothing for
  // types this app does not know (the web draws none; the board shows a hint there, the image does not – N07)
  final list = [
    for (final o in objects ?? scene.state.ordered)
      if (isVisibleObject(o) && isKnownObjectType(o.type)) o,
  ];
  // without waiting the picture is recorded right away (leaving the board: the images are about to be released)
  if (imageWait > Duration.zero) await _loadImages(images, list, scale, imageWait);

  final width = math.max(1, (world.width * scale).round());
  final height = math.max(1, (world.height * scale).round());
  final rec = dui.PictureRecorder();
  final c = Canvas(rec, Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()));
  c.clipRect(Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()));
  if (!transparent) {
    c.drawRect(
      Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()),
      Paint()..color = background ?? boardBackgroundColor(ui),
    );
  }
  c.save();
  c.scale(scale);
  c.translate(-world.left, -world.top);
  for (final o in list) {
    final inWorld = isWorldType(o.type);
    if (!inWorld) _transform(c, o);
    paintObject(c, o, ctx);
    if (!inWorld) c.restore();
  }
  // mind map lines above the objects (like the painter)
  final ids = {for (final o in list) o.id};
  for (final o in list) {
    if (o.type != 'mindnode') continue;
    final p = scene.mindParent(o);
    if (p != null && ids.contains(p.id) && isVisibleObject(p)) paintMindEdgeOf(c, p, o);
  }
  c.restore();
  final picture = rec.endRecording();
  try {
    return await picture.toImage(width, height);
  } finally {
    picture.dispose();
  }
}

void _transform(Canvas c, BoardObject o) {
  c.save();
  c.translate(o.x, o.y);
  final deg = o.rotation;
  if (deg != 0) {
    c.translate(o.w / 2, o.h / 2);
    c.rotate(deg * math.pi / 180);
    c.translate(-o.w / 2, -o.h / 2);
  }
}

/// Image ids an object draws (image, document page) with the tier it needs at [scale].
Iterable<(String, int)> _imageNeeds(List<BoardObject> list, double scale) sync* {
  for (final o in list) {
    final String? id = switch (o.type) {
      'image' => o.imageId,
      'document' => o.docPages[o.docPage] ?? o.imageId,
      _ => null,
    };
    if (id != null) yield (id, imageTierFor(o.w * scale));
  }
}

/// Requests every image and waits until all are there and nothing new arrived for a moment (at most [wait]).
Future<void> _loadImages(BoardImages images, List<BoardObject> list, double scale, Duration wait) async {
  if (images is NoBoardImages) return;
  final needs = _imageNeeds(list, scale).toSet();
  if (needs.isEmpty || wait <= Duration.zero) return;
  // a picture gone for good (404) is drawn as „Bild nicht verfügbar“ right away
  bool missing() => needs.any((n) => images.image(n.$1, n.$2) == null && !images.missing(n.$1));
  final done = Completer<void>();
  Timer? quiet;
  void settle() {
    quiet?.cancel();
    // a better tier may follow a lower one: wait until it is quiet for a moment
    if (!missing()) quiet = Timer(const Duration(milliseconds: 250), () => done.isCompleted ? null : done.complete());
  }

  images.addListener(settle);
  settle();
  try {
    await done.future.timeout(wait, onTimeout: () {});
  } finally {
    quiet?.cancel();
    images.removeListener(settle);
  }
}
