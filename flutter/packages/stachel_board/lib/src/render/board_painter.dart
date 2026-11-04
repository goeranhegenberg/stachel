import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/scheduler.dart';

import '../editor/camera.dart';
import '../mindmap/mind_measure.dart';
import '../mindmap/mind_render.dart';
import '../model/board_object.dart';
import 'board_scene.dart';
import 'object_renderers.dart';
import 'paint_utils.dart';

/// Below this zoom the board is drawn flat (no text, see [paintObjectSimple]).
const simpleZoom = 0.3;

/// Below this zoom frames show the big title (web `FAR_ZOOM`).
const farZoom = 0.25;

/// Size of the small frame title at zoom [z] (web Overlay: shrinks a little when zooming out, 10–14 px).
double frameTitleFontSize(double z) => (14 * z * 1.5).clamp(10.0, 14.0).toDouble();

/// The big frame title far out (web `FrameBigTitle`, below [farZoom]): above the frame's top edge (not in the middle,
/// so it hides no content), 11–18 px depending on the frame's width on screen (zoom rounded to 1/8 of a power of
/// two like the web's `zq`), condensed 700 in capitals on a white pill; cut to the frame width. Screen space.
void paintFrameBigTitle(Canvas c, BoardObject o, Camera cam, RenderContext ctx, String title) {
  final zq = (math.log(cam.z) / math.ln2 * 8).round() / 8;
  final zz = math.pow(2, zq).toDouble();
  final screenW = o.w * zz;
  if (screenW < 40) return;
  final upper = title.toUpperCase();
  final perPx = TextMetrics.instance.measure(upper, 100, 700, 'Barlow Condensed') / 100 + 0.04 * title.length + 1;
  final px = (screenW / perPx).clamp(11.0, 18.0).toDouble();
  final s = cam.z / zz; // world px/zz → screen
  final f = px * s;
  final r = cam.rectToScreen(Rect.fromLTWH(o.x, o.y, o.w, o.h));
  final maxW = o.w * cam.z;
  final padX = 0.5 * f, padY = 0.12 * f;
  final tp = ctx.text.layout(
    ('frameBigTitle', upper, f, maxW),
    () => TextSpan(
      text: upper,
      style: TextStyle(
        fontFamily: ctx.fonts.condensed,
        fontSize: f,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.04 * f,
        height: 1.1,
        color: const Color(0xFF3A3A36),
      ),
    ),
    maxWidth: math.max(1, maxW - 2 * padX),
    align: TextAlign.left,
    fill: false,
    ellipsis: '…',
  );
  final h = tp.height + 2 * padY;
  final w = math.min(maxW, tp.width + 2 * padX);
  final box = Rect.fromLTWH(r.left, r.top - 4 * s - h, w, h);
  final rr = RRect.fromRectAndRadius(box, Radius.circular(0.3 * f));
  c.drawRRect(
    rr.shift(Offset(0, 0.1 * f)),
    Paint()
      ..color = const Color(0x1F000000)
      ..maskFilter = MaskFilter.blur(BlurStyle.normal, 0.25 * f),
  );
  c.drawRRect(rr, Paint()..color = const Color(0xE0FFFFFF));
  c.save();
  c.clipRRect(rr);
  tp.paint(c, Offset(box.left + padX, box.top + padY));
  c.restore();
}

/// At most this many object pictures are recorded per frame; the rest is drawn flat for a frame and recorded in
/// the following frames, so zooming into a dense area never stalls one frame.
const recordBudgetPerFrame = 120;

/// Counters of the last frame (debug overlay, benchmark).
class PaintStats {
  int visible = 0;
  int recorded = 0;
  int deferred = 0;
  int cachedPictures = 0;
  Duration paintTime = Duration.zero;
}

/// One picture per object (key: object version + its connector route / mind map color), reused across frames.
class _PictureEntry {
  _PictureEntry(this.object, this.dep, this.picture);
  final BoardObject object;
  final Object? dep;
  final ui.Picture picture;
}

/// Draws the whole board with one [CustomPainter]: world → screen via the camera, only objects in view (grid
/// index), each object from a cached [ui.Picture] (re-recorded only when the object changes), flat below 30 % zoom.
/// Overlays in screen space: frame titles (constant size), selection.
class BoardPainter extends CustomPainter {
  BoardPainter({
    required this.ctx,
    required this.camera,
    required this.selection,
    required Listenable repaint,
    this.stats,
    this.showGrid = true,
  }) : super(repaint: Listenable.merge([repaint, camera, selection, _more]));

  final RenderContext ctx;
  final ValueListenable<Camera> camera;
  final ValueListenable<Set<String>> selection;
  final PaintStats? stats;
  final bool showGrid;

  BoardScene get scene => ctx.scene;

  final _pictures = <String, _PictureEntry>{};
  static final _more = _Pulse();
  bool _morePending = false;

  @override
  void paint(Canvas canvas, Size size) {
    final sw = Stopwatch()..start();
    final cam = camera.value;
    ctx.zoom = cam.z;
    // board background (P4: color, dots/lines/none from `tools.settings`) – the one hook of this painter
    final bg = ctx.background;
    if (bg == null || !bg(canvas, size, cam)) {
      canvas.drawRect(Offset.zero & size, Paint()..color = BoardColors.background);
      if (showGrid) _dots(canvas, size, cam);
    }
    final view = cam.viewRect(size);
    final objects = scene.visible(view.inflate(8 / cam.z));
    final simple = cam.z < simpleZoom;
    var recorded = 0, deferred = 0;

    canvas.save();
    canvas.translate(cam.x, cam.y);
    canvas.scale(cam.z);
    for (final o in objects) {
      if (!isVisibleObject(o)) continue;
      final world = isWorldType(o.type);
      if (!world) _transform(canvas, o);
      if (simple) {
        paintObjectSimple(canvas, o, ctx);
      } else if (isLiveType(o.type) || o.id == ctx.editingId) {
        paintObject(canvas, o, ctx);
      } else {
        final pic = _picture(o, allowRecord: recorded < recordBudgetPerFrame);
        if (pic == null) {
          deferred++;
          paintObjectSimple(canvas, o, ctx);
        } else {
          if (pic.$2) recorded++;
          canvas.drawPicture(pic.$1);
        }
      }
      if (!world) canvas.restore();
    }
    // mind map lines above the objects (web: SVG in the world layer after the objects)
    for (final o in objects) {
      if (o.type != 'mindnode' || !isVisibleObject(o)) continue;
      final p = scene.mindParent(o);
      if (p != null && isVisibleObject(p)) paintMindEdgeOf(canvas, p, o);
    }
    canvas.restore();

    _frameTitles(canvas, objects, cam, simple);
    _selection(canvas, cam);

    if (deferred > 0 && !_morePending) {
      _morePending = true;
      SchedulerBinding.instance.addPostFrameCallback((_) {
        _morePending = false;
        _more.pulse();
      });
    }
    final s = stats;
    if (s != null) {
      s
        ..visible = objects.length
        ..recorded = recorded
        ..deferred = deferred
        ..cachedPictures = _pictures.length
        ..paintTime = sw.elapsed;
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

  /// Cached picture of [o] (and whether it was recorded just now); null if recording is over budget.
  (ui.Picture, bool)? _picture(BoardObject o, {required bool allowRecord}) {
    final dep = switch (o.type) {
      'connector' => scene.connector(o.id),
      _ => null,
    };
    final hit = _pictures[o.id];
    if (hit != null && identical(hit.object, o) && hit.dep == dep) return (hit.picture, false);
    if (!allowRecord) return hit == null ? null : (hit.picture, false); // stale but close: better than flat
    final rec = ui.PictureRecorder();
    paintObject(Canvas(rec), o, ctx);
    final pic = rec.endRecording();
    hit?.picture.dispose();
    _pictures[o.id] = _PictureEntry(o, dep, pic);
    if (_pictures.length > 12000) _prune();
    return (pic, true);
  }

  /// Drops pictures of objects that are gone or changed.
  void _prune() {
    _pictures.removeWhere((id, e) {
      final stale = !identical(scene.state[id], e.object);
      if (stale) e.picture.dispose();
      return stale;
    });
  }

  /// Dot grid like the web (`tools.settings.pattern = dots`), only when the dots are far enough apart.
  void _dots(Canvas c, Size size, Camera cam) {
    var step = 24.0;
    while (step * cam.z < 14) {
      step *= 4;
    }
    final view = cam.viewRect(size);
    final x0 = (view.left / step).floor() * step, y0 = (view.top / step).floor() * step;
    final cols = (view.width / step).ceil() + 1, rows = (view.height / step).ceil() + 1;
    if (cols * rows > 20000) return;
    final pts = Float32List(cols * rows * 2);
    var i = 0;
    for (var r = 0; r < rows; r++) {
      for (var k = 0; k < cols; k++) {
        pts[i++] = (x0 + k * step) * cam.z + cam.x;
        pts[i++] = (y0 + r * step) * cam.z + cam.y;
      }
    }
    c.drawRawPoints(
      ui.PointMode.points,
      pts,
      Paint()
        ..color = BoardColors.grid
        ..strokeWidth = 2
        ..strokeCap = StrokeCap.round,
    );
  }

  /// Frame titles above frames in screen size, like the web: from 25 % zoom the small title (`ov-frame-title`: 10–14
  /// px, condensed 600, capitals, blue when selected), below it the big title (`FrameBigTitle`, see
  /// [paintFrameBigTitle]).
  void _frameTitles(Canvas c, List<BoardObject> objects, Camera cam, bool simple) {
    final far = cam.z < farZoom;
    final sel = selection.value;
    for (final o in objects) {
      if (o.type != 'frame' || !isVisibleObject(o)) continue;
      final title = (o.title ?? '').isEmpty ? 'Rahmen' : o.title!;
      if (far) {
        paintFrameBigTitle(c, o, cam, ctx, title);
        continue;
      }
      final r = cam.rectToScreen(Rect.fromLTWH(o.x, o.y, o.w, o.h));
      if (r.width < 48) continue;
      final fs = frameTitleFontSize(cam.z);
      final selected = sel.contains(o.id);
      // web: box at (x, y − 1.6·fs − 3), height 1.6·fs, at most max(48, width) wide, 2 px padding, ellipsis
      final box = Rect.fromLTWH(r.left, r.top - fs * 1.6 - 3, math.max(48, r.width), fs * 1.6);
      final tp = ctx.text.layout(
        ('frameTitle', title, fs, selected, box.width),
        () => TextSpan(
          text: title.toUpperCase(),
          style: TextStyle(
            fontFamily: ctx.fonts.condensed,
            fontSize: fs,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.06 * fs,
            height: 1.6,
            color: selected ? BoardColors.selection : const Color(0xFF3A3A36),
          ),
        ),
        maxWidth: box.width - 4,
        align: TextAlign.left,
        fill: false,
        ellipsis: '…',
      );
      c.save();
      c.clipRect(box);
      tp.paint(c, Offset(box.left + 2, box.top + (box.height - tp.height) / 2));
      c.restore();
    }
  }

  void _selection(Canvas c, Camera cam) {
    final ids = selection.value;
    if (ids.isEmpty) return;
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = BoardColors.selection;
    for (final id in ids) {
      final o = scene.state[id];
      if (o != null) _selectionOf(c, cam, o, paint);
    }
  }

  void _selectionOf(Canvas c, Camera cam, BoardObject o, Paint paint) {
    final id = o.id;
    if (o.type == 'connector') {
      final g = scene.connector(id);
      if (g == null) return;
      for (final p in [g.a, g.b]) {
        c.drawCircle(cam.toScreen(p), 6, Paint()..color = const Color(0xFFFFFFFF));
        c.drawCircle(cam.toScreen(p), 6, paint);
      }
      return;
    }
    final r = cam.rectToScreen(Rect.fromLTWH(o.x, o.y, o.w, o.h)).inflate(3);
    c.save();
    if (o.rotation != 0) {
      c.translate(r.center.dx, r.center.dy);
      c.rotate(o.rotation * math.pi / 180);
      c.translate(-r.center.dx, -r.center.dy);
    }
    c.drawRect(r, paint);
    c.restore();
  }

  /// Frees all cached pictures (e.g. when the widget goes away).
  void dispose() {
    for (final e in _pictures.values) {
      e.picture.dispose();
    }
    _pictures.clear();
  }

  @override
  bool shouldRepaint(covariant BoardPainter old) => !identical(old, this);
}

class _Pulse extends ChangeNotifier {
  void pulse() => notifyListeners();
}
