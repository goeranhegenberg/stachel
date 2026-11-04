import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as dui;

import 'package:flutter/widgets.dart';

import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../model/board_source.dart';
import '../export/render_board.dart';
import '../versions/admin_host.dart';

// Preview image of the board overview (web `features/tools/thumbnail.tsx`, audit N09): rendered from the board with
// the export renderer and uploaded with `PUT /api/boards/:id/thumbnail` – after 4 s without changes (at most every
// 30 s), once after the first sync and when leaving the board. Without it, boards edited only in the app kept their
// old preview.

/// Pixel size of the preview (twice the overview card 280 × 130).
const thumbWidth = 560;
const thumbHeight = 260;

/// Quiet time after the last change and minimum gap between two uploads (web `IDLE_MS`, `MIN_GAP_MS`).
const thumbIdle = Duration(seconds: 4);
const thumbMinGap = Duration(seconds: 30);

/// After the first sync (web: 1500 ms).
const thumbFirst = Duration(milliseconds: 1500);

/// Height of the frame title above a frame in the preview (px in the image) and at least in board units.
const _frameTitlePx = 24.0;
const _frameTitleMin = 30.0;

/// The part of the board in the preview (web `thumbRect`): the content with a margin, widened to the card's aspect
/// ratio; frames carry their title above their bounds, so [titleSpace] (board units) is added on top of them.
Rect? thumbRect(Iterable<BoardObject> objects, Rect? Function(BoardObject o) bounds, {double titleSpace = 0}) {
  Rect? r;
  for (final o in objects) {
    var b = bounds(o);
    if (b == null) continue;
    if (o.type == 'frame' && titleSpace > 0) {
      b = Rect.fromLTWH(b.left, b.top - titleSpace, b.width, b.height + titleSpace);
    }
    r = r == null ? b : r.expandToInclude(b);
  }
  if (r == null) return null;
  final m = math.max(24.0, math.max(r.width, r.height) * 0.04);
  final p = r.inflate(m);
  const aspect = thumbWidth / thumbHeight;
  if (p.width / p.height > aspect) {
    final h = p.width / aspect;
    return Rect.fromLTWH(p.left, p.top - (h - p.height) / 2, p.width, h);
  }
  final w = p.height * aspect;
  return Rect.fromLTWH(p.left - (w - p.width) / 2, p.top, w, p.height);
}

/// Renders the preview as PNG (null = empty board). [imageWait] zero = right now with the images in memory.
Future<Uint8List?> renderThumbnail(BoardUi ui, {Duration imageWait = const Duration(seconds: 3)}) async {
  final scene = ui.editor.scene;
  final objects = [
    for (final o in ui.controller.state.ordered)
      if (!o.hidden) o,
  ];
  Rect? bounds(BoardObject o) => boardObjectBounds(scene, o);
  // the title height depends on the scale and the scale on the part: estimate once, then again with the real scale
  final first = thumbRect(objects, bounds, titleSpace: _frameTitleMin);
  if (first == null) return null;
  final rect = thumbRect(
    objects,
    bounds,
    titleSpace: math.max(_frameTitleMin, _frameTitlePx * first.width / thumbWidth),
  )!;
  final img = await renderBoardRegion(
    ui,
    world: rect,
    scale: thumbWidth / rect.width,
    objects: objects,
    imageWait: imageWait,
  );
  try {
    final data = await img.toByteData(format: dui.ImageByteFormat.png);
    return data?.buffer.asUint8List();
  } finally {
    img.dispose();
  }
}

/// Invisible overlay of the board screen that keeps the preview image fresh (web `ThumbnailUploader`). Only after
/// the first sync with the server, so a board still empty on the phone never overwrites the preview; only with a
/// [BoardAdminHost] (like the web: for everyone who has the board open).
class ThumbnailUploader extends StatefulWidget {
  const ThumbnailUploader({super.key, required this.ui, this.idle = thumbIdle, this.minGap = thumbMinGap});
  final BoardUi ui;
  final Duration idle;
  final Duration minGap;

  @override
  State<ThumbnailUploader> createState() => _ThumbnailUploaderState();
}

class _ThumbnailUploaderState extends State<ThumbnailUploader> {
  BoardController get _c => widget.ui.controller;
  bool _synced = false;
  bool _dirty = false;
  bool _busy = false;
  bool _cooling = false;
  Timer? _timer;
  Timer? _gap;
  int _seen = -1;

  @override
  void initState() {
    super.initState();
    _c.addListener(_changed);
    _c.source.connection.addListener(_changed);
    _changed();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _gap?.cancel();
    _c.removeListener(_changed);
    _c.source.connection.removeListener(_changed);
    // leaving: save the last state (recorded now – the board's images and scene go away with the screen)
    final host = adminHost(widget.ui);
    if (_dirty && _synced && host != null) unawaited(_upload(host, imageWait: Duration.zero));
    super.dispose();
  }

  bool get _live => _c.loaded && !_c.fromCache && _c.source.connection.value == BoardConnection.live;

  void _changed() {
    final version = _c.state.version;
    if (!_synced) {
      if (!_live) return;
      // after the first sync once (also older boards without a preview)
      _synced = true;
      _seen = version;
      _dirty = true;
      _schedule(thumbFirst);
      return;
    }
    if (version == _seen) return;
    _seen = version;
    _dirty = true;
    _schedule(widget.idle);
  }

  void _schedule(Duration d) {
    _timer?.cancel();
    _timer = Timer(d, _run);
  }

  Future<void> _run() async {
    final host = adminHost(widget.ui);
    // within the gap after the last upload: the gap's end runs it
    if (!_dirty || _busy || _cooling || !_synced || host == null || !mounted) return;
    _busy = true;
    _dirty = false;
    _cooling = true;
    _gap?.cancel();
    _gap = Timer(widget.minGap, () {
      _cooling = false;
      if (_dirty && mounted) unawaited(_run());
    });
    try {
      await _upload(host);
    } finally {
      _busy = false;
    }
  }

  Future<void> _upload(BoardAdminHost host, {Duration imageWait = const Duration(seconds: 3)}) async {
    try {
      final png = await renderThumbnail(widget.ui, imageWait: imageWait);
      if (png != null) await host.uploadThumbnail(png, 'image/png');
    } catch (_) {
      // the preview is only a comfort
    }
  }

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
