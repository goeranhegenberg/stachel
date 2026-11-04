import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../../editor/camera.dart';
import '../../editor/registry/board_ui.dart';
import '../../editor/board_editor.dart';
import '../../editor/registry/tool_def.dart';
import '../../model/board_source.dart';
import '../follow/collab_common.dart';
import 'laser_model.dart';

// Laserpointer (web `LaserLayer.tsx`): tool (hold a finger down and move), fading trail – own and the others'
// (awareness `collab.laser`). Audit rows C18, L17.

/// Monotonic clock of the trails (ms); tests replace it.
int Function() laserNow = () => _watch.elapsedMilliseconds;
final _watch = Stopwatch()..start();

/// Laser state of one board (per controller – the tool's behavior only knows the editor): own sender and trail, the
/// others' receivers.
class LaserRuntime extends ChangeNotifier {
  LaserRuntime._(this.controller);
  static final _of = Expando<LaserRuntime>('LaserRuntime');
  static LaserRuntime of(BoardController c) => _of[c] ??= LaserRuntime._(c);
  final BoardController controller;

  final sender = LaserSender();

  /// Own trail (drawn locally).
  final own = <TrailPoint>[];

  /// Others' trails by awareness client.
  final receivers = <int, LaserReceiver>{};
  Timer? _clear;

  void _add(Offset world, {required bool gap}) {
    controller.presence.setExtra(awLaser, sender.add(world), immediate: true);
    final now = laserNow();
    own
      ..removeWhere((p) => p.t <= now - laserLife)
      ..add(TrailPoint(world.dx, world.dy, now, gap: gap));
    notifyListeners();
  }

  /// Finger down with the laser tool (web `laserDown`).
  void down(Offset world) {
    sender.begin();
    _clear?.cancel();
    _add(world, gap: true);
  }

  void move(Offset world) => _add(world, gap: false);

  /// Finger up: after the fading nothing is sent any more.
  void up() {
    _clear?.cancel();
    _clear = Timer(const Duration(milliseconds: laserLife + 600), () => controller.presence.setExtra(awLaser, null));
  }

  void cancel() {
    _clear?.cancel();
    controller.presence.setExtra(awLaser, null);
  }

  /// Takes new points of the others; true = something new.
  bool takePeers() {
    final now = laserNow();
    final alive = <int>{};
    var changed = false;
    for (final p in controller.peers) {
      alive.add(p.id);
      final msg = p.extra[awLaser];
      if (msg == null) continue;
      final r = receivers.putIfAbsent(p.id, LaserReceiver.new);
      if (r.take(msg, now)) changed = true;
    }
    receivers.removeWhere((id, _) => !alive.contains(id));
    return changed;
  }

  /// Something still to draw.
  bool get active {
    final now = laserNow();
    return own.any((p) => now - p.t < laserLife) || receivers.values.any((r) => r.points.isNotEmpty);
  }

  @override
  void dispose() {
    _clear?.cancel();
    super.dispose();
  }
}

/// The tool's behavior: one finger draws the trail (two fingers still zoom).
final laserBehavior = BoardToolBehavior(
  draws: true,
  onDrawStart: (e) => LaserRuntime.of(e.editor.controller).down(e.world),
  onDrawUpdate: (e) => LaserRuntime.of(e.editor.controller).move(e.world),
  onDrawEnd: (e) => LaserRuntime.of(e.editor.controller).up(),
  onDrawCancel: _cancel,
);

void _cancel(BoardEditor e) => LaserRuntime.of(e.controller).cancel();

/// Overlay `collab.laser` (also while presenting): own and the others' trails, fading in [laserLife].
class LaserLayer extends StatefulWidget {
  const LaserLayer({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<LaserLayer> createState() => _LaserLayerState();
}

class _LaserLayerState extends State<LaserLayer> with SingleTickerProviderStateMixin {
  late final LaserRuntime rt = LaserRuntime.of(widget.ui.controller);
  late final Ticker _ticker = createTicker((_) {
    rt.receivers.forEach((_, r) => r.prune(laserNow()));
    if (!rt.active) _ticker.stop();
    setState(() {});
  });

  @override
  void initState() {
    super.initState();
    widget.ui.controller.addListener(_peers);
    rt.addListener(_wake);
  }

  @override
  void dispose() {
    widget.ui.controller.removeListener(_peers);
    rt.removeListener(_wake);
    _ticker.dispose();
    super.dispose();
  }

  void _peers() {
    if (rt.takePeers()) _wake();
  }

  void _wake() {
    if (!mounted) return;
    if (!_ticker.isActive && rt.active) _ticker.start();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final view = widget.ui.view;
    if (view == null || !rt.active) return const SizedBox.shrink();
    return IgnorePointer(
      child: ValueListenableBuilder<Camera>(
        valueListenable: view.camera,
        builder: (context, cam, _) => CustomPaint(
          key: const Key('collabLaser'),
          size: Size.infinite,
          painter: _LaserPainter(
            cam: cam,
            now: laserNow(),
            trails: [rt.own, for (final r in rt.receivers.values) r.points],
          ),
        ),
      ),
    );
  }
}

class _LaserPainter extends CustomPainter {
  _LaserPainter({required this.cam, required this.now, required this.trails});
  final Camera cam;
  final int now;
  final List<List<TrailPoint>> trails;
  static const _color = CollabColors.laser;

  @override
  void paint(Canvas canvas, Size size) {
    for (final pts in trails) {
      if (pts.isEmpty) continue;
      for (final s in trailSegments(pts, now)) {
        final a = cam.toScreen(s.a), b = cam.toScreen(s.b);
        Paint line(Color c, double w) => Paint()
          ..color = c
          ..strokeWidth = w
          ..strokeCap = StrokeCap.round;
        final al = s.alpha.clamp(0.0, 1.0);
        canvas
          ..drawLine(a, b, line(_color.withValues(alpha: 0.28 * al), 12))
          ..drawLine(a, b, line(_color.withValues(alpha: al), 4))
          ..drawLine(a, b, line(Colors.white.withValues(alpha: 0.85 * al), 1.4));
      }
      final head = pts.last;
      if (now - head.t < laserLife) {
        final c = cam.toScreen(head.offset);
        canvas
          ..drawCircle(c, 7, Paint()..color = _color)
          ..drawCircle(
            c,
            7,
            Paint()
              ..style = PaintingStyle.stroke
              ..strokeWidth = 2
              ..color = Colors.white,
          );
      }
    }
  }

  @override
  bool shouldRepaint(_LaserPainter old) => true;
}
