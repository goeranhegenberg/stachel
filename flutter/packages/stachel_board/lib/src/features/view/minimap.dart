import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as dui;

import 'package:flutter/material.dart';

import '../../editor/camera.dart';
import '../../editor/registry/board_ui.dart';
import '../../geometry/connector_route.dart';
import '../../model/board_object.dart';
import '../../render/board_scene.dart';
import 'board_prefs.dart';

// Overview map (M08, web editor/Minimap.tsx): all objects small (frames with title, notes in their color, connectors
// as lines), the visible area in blue; tap jumps there, dragging the blue area moves the view; open/closed remembered
// (on the phone closed until opened once).

const minimapW = 208.0;
const minimapH = 132.0;

/// Redraw of the objects at most this often while the content keeps changing (web `REDRAW_MS`).
const minimapRedrawMs = 200;

/// Map section: world rectangle, scale and offset inside the map.
class MapFrame {
  const MapFrame(this.world, this.scale, this.ox, this.oy);
  final Rect world;
  final double scale;
  final double ox;
  final double oy;

  Offset toMap(Offset w) => Offset(ox + (w.dx - world.left) * scale, oy + (w.dy - world.top) * scale);
  Offset toWorld(Offset m) => Offset((m.dx - ox) / scale + world.left, (m.dy - oy) / scale + world.top);

  /// Fits [world] into a map of [size] (centered).
  factory MapFrame.fit(Rect world, Size size) {
    final scale = math.min(size.width / math.max(world.width, 1), size.height / math.max(world.height, 1));
    return MapFrame(world, scale, (size.width - world.width * scale) / 2, (size.height - world.height * scale) / 2);
  }
}

/// Section of the map: content + view with margin; stays while both fit and it is not much too big (web `nextFrame`).
MapFrame nextMapFrame(MapFrame? prev, Rect? content, Rect view, {Size size = const Size(minimapW, minimapH)}) {
  final need = content == null ? view : content.expandToInclude(view);
  final p = prev?.world;
  if (prev != null &&
      p!.left <= need.left &&
      p.top <= need.top &&
      p.right >= need.right &&
      p.bottom >= need.bottom &&
      p.width * p.height < need.width * need.height * 4) {
    return prev;
  }
  return MapFrame.fit(need.inflate(math.max(need.width, need.height) * 0.06 + 40), size);
}

Color _hex(String? c, Color fallback) {
  if (c == null || !RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(c)) return fallback;
  return Color(0xFF000000 | int.parse(c.substring(1), radix: 16));
}

/// Draws [objects] small like the web's minimap (`drawObjects`); [connector] gives the routes of connectors.
void paintMiniObjects(
  Canvas canvas,
  Iterable<BoardObject> objects,
  MapFrame m, {
  ConnectorGeometry? Function(BoardObject o)? connector,
  bool titles = true,
}) {
  final tp = <(Offset, double, String)>[];
  for (final o in objects) {
    if (o.type == 'connector') continue;
    final r = objectRect(o);
    final p = m.toMap(r.topLeft);
    final w = math.max(1.5, r.width * m.scale), h = math.max(1.5, r.height * m.scale);
    final box = Rect.fromLTWH(p.dx, p.dy, w, h);
    if (o.type == 'frame') {
      canvas.drawRect(box, Paint()..color = _hex(o.color, const Color(0xFFFFFFFF)));
      canvas.drawRect(
        Rect.fromLTWH(
          p.dx.roundToDouble() + 0.5,
          p.dy.roundToDouble() + 0.5,
          w.roundToDouble() - 1,
          h.roundToDouble() - 1,
        ),
        Paint()
          ..color = const Color(0x4D0A0A0A)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1,
      );
      if (titles && w >= 40) tp.add((p, w, (o.title?.isNotEmpty == true ? o.title! : 'Rahmen').toUpperCase()));
      continue;
    }
    final color = switch (o.type) {
      'sticky' => _hex(o.color, const Color(0xFFFFF27A)),
      'image' => _hex(o.color, const Color(0xFF9A9A94)),
      'pen' => _hex(o.color, const Color(0xFF0A0A0A)),
      'shape' when (o.color ?? '#ffffff').toLowerCase() == '#ffffff' => const Color(0xFFCFCFC8),
      _ => _hex(o.color, const Color(0xFFD8D8D2)),
    };
    final pts = o.type == 'pen' ? o.points : const <double>[];
    if (o.type == 'pen' && pts.length >= 4 && math.max(w, h) > 6) {
      final path = Path()
        ..moveTo(m.toMap(Offset(o.x + pts[0], o.y + pts[1])).dx, m.toMap(Offset(o.x + pts[0], o.y + pts[1])).dy);
      for (var i = 2; i + 1 < pts.length; i += 2) {
        final q = m.toMap(Offset(o.x + pts[i], o.y + pts[i + 1]));
        path.lineTo(q.dx, q.dy);
      }
      canvas.drawPath(
        path,
        Paint()
          ..color = color
          ..style = PaintingStyle.stroke
          ..strokeWidth = math.max(
            1,
            (o.raw['strokeWidth'] is num ? (o.raw['strokeWidth'] as num).toDouble() : 4) * m.scale,
          ),
      );
      continue;
    }
    final paint = Paint()..color = (o.type == 'pen' || o.type == 'text') ? color.withValues(alpha: 0.55) : color;
    if (o.type == 'shape' && o.shape == 'ellipse' && w > 4) {
      canvas.drawOval(box, paint);
    } else {
      canvas.drawRect(box, paint);
    }
  }
  if (connector != null) {
    for (final o in objects) {
      if (o.type != 'connector') continue;
      final g = connector(o);
      if (g == null) continue;
      final pts = g.style == 'curved' && g.pts.length == 4
          ? [for (var i = 0; i <= 8; i++) bezierAt(g.pts, i / 8)]
          : g.pts;
      if (pts.length < 2) continue;
      final path = Path()..moveTo(m.toMap(pts.first).dx, m.toMap(pts.first).dy);
      for (final q in pts.skip(1)) {
        final s = m.toMap(q);
        path.lineTo(s.dx, s.dy);
      }
      canvas.drawPath(
        path,
        Paint()
          ..color = _hex(o.color, const Color(0xFF0A0A0A)).withValues(alpha: 0.7)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1,
      );
    }
  }
  for (final (p, w, text) in tp) {
    final painter = TextPainter(
      text: TextSpan(
        text: text,
        style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w600, color: Color(0xFF3A3A36)),
      ),
      textDirection: TextDirection.ltr,
      maxLines: 1,
      ellipsis: '…',
    )..layout(maxWidth: math.max(0, w - 2));
    painter.paint(canvas, Offset(p.dx + 1, math.max(10, p.dy - 1) - painter.height));
  }
}

/// Open on the phone? Stored choice, otherwise only in big windows (web `readOpen`).
bool minimapOpen(Size screen) {
  final v = BoardPrefs.get(BoardPrefs.minimap);
  if (v == 'open') return true;
  if (v == 'closed') return false;
  return screen.width > 700 && screen.height > 640;
}

/// The minimap with its toggle (web `Minimap`).
class MinimapView extends StatefulWidget {
  const MinimapView({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<MinimapView> createState() => _MinimapViewState();
}

class _MinimapViewState extends State<MinimapView> {
  MapFrame? _frame;
  Rect? _content;
  int _contentAt = -1;
  Timer? _trail;
  ({Offset start, Offset center})? _drag;
  Rect? _view;

  /// Objects drawn once per content state and map section (web: offscreen canvas), the view rectangle on top.
  dui.Picture? _pic;
  Object? _picContent;
  MapFrame? _picFrame;

  BoardUi get ui => widget.ui;

  @override
  void dispose() {
    _trail?.cancel();
    _pic?.dispose();
    super.dispose();
  }

  /// Picture of the objects: re-recorded when the section changed or – at most every 200 ms – the content.
  dui.Picture _objects(MapFrame m) {
    final ordered = widget.ui.controller.state.ordered;
    final pic = _pic;
    if (pic != null && identical(_picFrame, m) && (identical(_picContent, ordered) || _throttled())) return pic;
    final rec = dui.PictureRecorder();
    final scene = widget.ui.view?.scene;
    paintMiniObjects(Canvas(rec), ordered, m, connector: scene == null ? null : (o) => scene.connector(o.id));
    pic?.dispose();
    _picContent = ordered;
    _picFrame = m;
    _picAt = DateTime.now().millisecondsSinceEpoch;
    return _pic = rec.endRecording();
  }

  int _picAt = 0;

  bool _throttled() {
    final wait = minimapRedrawMs - (DateTime.now().millisecondsSinceEpoch - _picAt);
    if (wait <= 0) return false;
    _trail ??= Timer(Duration(milliseconds: wait), () {
      _trail = null;
      if (mounted) setState(() {});
    });
    return true;
  }

  void _toggle(bool open) => BoardPrefs.set(BoardPrefs.minimap, open ? 'closed' : 'open');

  /// Content box (redrawn at most every 200 ms while it keeps changing; the last state follows).
  Rect? _contentRect() {
    final now = DateTime.now().millisecondsSinceEpoch;
    if (_contentAt < 0 || now - _contentAt >= minimapRedrawMs) {
      _contentAt = now;
      _content = ui.view?.scene.bounds;
    } else {
      _trail ??= Timer(Duration(milliseconds: minimapRedrawMs - (now - _contentAt)), () {
        _trail = null;
        if (mounted) setState(() => _contentAt = -1);
      });
    }
    return _content;
  }

  void _centerOn(Offset world) {
    final v = ui.view;
    if (v == null) return;
    final c = v.camera.value, s = v.viewSize;
    v.camera.value = Camera(s.width / 2 - world.dx * c.z, s.height / 2 - world.dy * c.z, c.z);
  }

  @override
  Widget build(BuildContext context) {
    final t = ui.theme;
    return ValueListenableBuilder<int>(
      valueListenable: BoardPrefs.changes,
      builder: (context, _, _) {
        final open = minimapOpen(MediaQuery.sizeOf(context));
        final toggle = IconButton(
          key: const Key('stachelMinimapToggle'),
          tooltip: open ? 'Übersicht ausblenden' : 'Übersicht einblenden',
          icon: Icon(open ? Icons.expand_more : Icons.picture_in_picture_alt_outlined, size: open ? 18 : 22),
          onPressed: () => _toggle(open),
        );
        if (!open) return Material(color: t.surface, elevation: 2, shape: _shape(t), child: toggle);
        final view = ui.view;
        if (view == null) return const SizedBox.shrink();
        return Material(
          color: t.surface,
          elevation: 2,
          shape: _shape(t),
          child: Stack(
            children: [
              ListenableBuilder(
                listenable: Listenable.merge([ui.controller, view.camera]),
                builder: (context, _) {
                  final v = view.camera.value.viewRect(view.viewSize);
                  _view = v;
                  if (_drag == null || _frame == null) _frame = nextMapFrame(_frame, _contentRect(), v);
                  final m = _frame!;
                  return GestureDetector(
                    key: const Key('stachelMinimap'),
                    onPanDown: (d) {
                      final p = m.toWorld(d.localPosition);
                      final cur = _view!;
                      if (cur.contains(p)) {
                        _drag = (start: p, center: cur.center);
                      } else {
                        _centerOn(p);
                        _drag = (start: p, center: p);
                      }
                    },
                    onPanUpdate: (d) {
                      final g = _drag;
                      if (g == null) return;
                      final p = m.toWorld(d.localPosition);
                      _centerOn(g.center + (p - g.start));
                    },
                    onPanEnd: (_) => _drag = null,
                    onPanCancel: () => _drag = null,
                    child: Semantics(
                      label: 'Übersichtskarte',
                      image: true,
                      child: CustomPaint(
                        size: const Size(minimapW, minimapH),
                        painter: _MinimapPainter(_objects(m), m, v),
                      ),
                    ),
                  );
                },
              ),
              Positioned(right: 0, bottom: 0, child: SizedBox(width: 36, height: 36, child: toggle)),
            ],
          ),
        );
      },
    );
  }

  ShapeBorder _shape(BoardUiTheme t) => RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(8),
    side: BorderSide(color: t.ink.withValues(alpha: 0.25)),
  );
}

class _MinimapPainter extends CustomPainter {
  _MinimapPainter(this.objects, this.m, this.view);
  final dui.Picture objects;
  final MapFrame m;
  final Rect view;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.clipRect(Offset.zero & size);
    canvas.drawPicture(objects);
    final a = m.toMap(view.topLeft);
    final r = Rect.fromLTWH(a.dx, a.dy, view.width * m.scale, view.height * m.scale);
    canvas.drawRect(r, Paint()..color = const Color(0x1A1763B5));
    canvas.drawRect(
      r,
      Paint()
        ..color = const Color(0xFF1763B5)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5,
    );
  }

  @override
  bool shouldRepaint(_MinimapPainter old) => !identical(old.objects, objects) || old.m != m || old.view != view;
}
