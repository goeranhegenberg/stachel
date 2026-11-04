import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/foundation.dart';

/// Zoom limits like the web (`MIN_ZOOM`/`MAX_ZOOM` in board/geometry.ts).
const minZoom = 0.05;
const maxZoom = 4.0;

/// Camera: screen = world × z + (x, y).
@immutable
class Camera {
  const Camera(this.x, this.y, this.z);
  static const identity = Camera(0, 0, 1);

  final double x;
  final double y;
  final double z;

  Offset toWorld(Offset screen) => Offset((screen.dx - x) / z, (screen.dy - y) / z);
  Offset toScreen(Offset world) => Offset(world.dx * z + x, world.dy * z + y);
  Rect rectToScreen(Rect r) => Rect.fromLTWH(r.left * z + x, r.top * z + y, r.width * z, r.height * z);

  /// Visible world area of a viewport of [size].
  Rect viewRect(Size size) => Rect.fromLTWH(-x / z, -y / z, size.width / z, size.height / z);

  /// Zooms so that the screen point [anchor] stays over the same world point.
  Camera zoomAt(Offset anchor, double nextZoom) {
    final nz = nextZoom.clamp(minZoom, maxZoom).toDouble();
    final w = toWorld(anchor);
    return Camera(anchor.dx - w.dx * nz, anchor.dy - w.dy * nz, nz);
  }

  Camera panBy(Offset delta) => Camera(x + delta.dx, y + delta.dy, z);

  /// Camera that fits [r] with [padding] into a viewport of [size] (at most [maxZoomFit]), like `fitRect`.
  static Camera fit(Rect r, Size size, {FitPadding padding = const FitPadding.all(40), double maxZoomFit = 1}) {
    final availW = math.max(1.0, size.width - padding.horizontal);
    final availH = math.max(1.0, size.height - padding.vertical);
    final z = math
        .min(math.min(availW / math.max(r.width, 1), availH / math.max(r.height, 1)), maxZoomFit)
        .clamp(minZoom, maxZoom)
        .toDouble();
    final c = r.center;
    return Camera(padding.left + availW / 2 - c.dx * z, padding.top + availH / 2 - c.dy * z, z);
  }

  @override
  bool operator ==(Object other) => other is Camera && other.x == x && other.y == y && other.z == z;

  @override
  int get hashCode => Object.hash(x, y, z);

  @override
  String toString() => 'Camera(${x.toStringAsFixed(1)}, ${y.toStringAsFixed(1)}, ${z.toStringAsFixed(3)})';
}

/// Free space around a fitted rectangle (left, top, right, bottom).
@immutable
class FitPadding {
  const FitPadding.all(double v) : left = v, top = v, right = v, bottom = v;
  const FitPadding.fromLTRB(this.left, this.top, this.right, this.bottom);
  final double left;
  final double top;
  final double right;
  final double bottom;
  double get horizontal => left + right;
  double get vertical => top + bottom;
}

/// The camera as listenable value; the painter repaints from it directly (no widget rebuild per frame).
class CameraController extends ValueNotifier<Camera> {
  CameraController([super.value = Camera.identity]);

  void zoomAt(Offset anchor, double nextZoom) => value = value.zoomAt(anchor, nextZoom);
  void panBy(Offset delta) => value = value.panBy(delta);
}

/// Pure pan/pinch math of one gesture: keeps the world point under the focal point under the fingers.
class PinchTracker {
  PinchTracker(this.start, Offset focal) : _worldFocal = start.toWorld(focal);

  final Camera start;
  final Offset _worldFocal;

  /// Camera for the current [focal] point and the [scale] since the gesture started.
  Camera update(Offset focal, double scale) {
    final z = (start.z * scale).clamp(minZoom, maxZoom).toDouble();
    return Camera(focal.dx - _worldFocal.dx * z, focal.dy - _worldFocal.dy * z, z);
  }
}

/// Inertia after a pan: velocity decays exponentially (friction), like a fling.
class PanInertia {
  PanInertia(this.velocity, {this.friction = 0.004});

  /// Pixels per second.
  final Offset velocity;

  /// Fraction of the speed kept after one second (smaller = stops sooner).
  final double friction;

  double get _k => -math.log(friction);

  /// Distance travelled after [t] seconds.
  Offset offsetAt(double t) => velocity * ((1 - math.exp(-_k * t)) / _k);

  /// Remaining speed after [t] seconds.
  double speedAt(double t) => velocity.distance * math.exp(-_k * t);

  /// Time until the speed drops below [stopSpeed] px/s.
  double get duration {
    final v = velocity.distance;
    if (v <= _stopSpeed) return 0;
    return math.log(v / _stopSpeed) / _k;
  }

  static const _stopSpeed = 20.0;
}
