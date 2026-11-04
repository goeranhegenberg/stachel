import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../../editor/camera.dart';
import '../../editor/registry/board_ui.dart';

/// State of the view per board screen (P4): UI hidden („Oberfläche ausblenden“, M14), fullscreen (immersive, M15),
/// search open (M13), camera animation. Kept next to the [BoardUi] (no change to the core classes); the app reads
/// [chromeHidden] to hide its bars.
class BoardViewPrefs {
  BoardViewPrefs._(this.ui);
  final BoardUi ui;

  static final _of = Expando<BoardViewPrefs>('BoardViewPrefs');

  /// The view state of [ui] (created on first use).
  static BoardViewPrefs of(BoardUi ui) => _of[ui] ??= BoardViewPrefs._(ui);

  /// „Oberfläche ausblenden“ (focus mode): bars, zoom bar and minimap away, an eye brings them back.
  final uiHidden = ValueNotifier<bool>(false);

  /// Fullscreen (immersive: status and navigation bar away).
  final immersive = ValueNotifier<bool>(false);

  /// Search bar open (M13).
  final searchOpen = ValueNotifier<bool>(false);

  /// Bars lying on the board right now, in board coordinates (set by the view layer: zoom bar + minimap) – the web
  /// measures them for „Alles einpassen“ (`chromeInsets`).
  List<Rect> Function() chromeRects = () => const [];

  /// The app hides its bars (title bar, tool bar, context bar) while this is true: presenting or UI hidden.
  late final ValueListenable<bool> chromeHidden = _Or([ui.presenting, uiHidden]);

  // ---- immersive -------------------------------------------------------------------------------------------------

  /// Platform hook (tests replace it): turns the system bars off/on.
  static Future<void> Function(bool on) setSystemImmersive = (on) =>
      SystemChrome.setEnabledSystemUIMode(on ? SystemUiMode.immersiveSticky : SystemUiMode.edgeToEdge);

  void setImmersive(bool on) {
    if (immersive.value == on) return;
    immersive.value = on;
    unawaited(setSystemImmersive(on).catchError((_) {}));
  }

  // ---- camera animation (web `animateCamera`: zoom logarithmic, the target's center linear, ease-out cubic) ----------

  Ticker? _ticker;
  Camera? _lastSet;

  /// Moves the camera softly to [to] in [ms] (web 280 ms). A camera change from elsewhere (a finger) stops it.
  void animateCamera(Camera to, {int ms = 280}) {
    final view = ui.view;
    final cam = view?.camera;
    if (view == null || cam == null) return;
    _stopAnimation();
    final size = view.viewSize;
    final from = cam.value;
    // P8 (audit P05): the system asks for less motion – jump instead of gliding
    if (view.mounted && (MediaQuery.maybeDisableAnimationsOf(view.context) ?? false)) ms = 0;
    if (size == Size.zero || ms <= 0) {
      cam.value = to;
      return;
    }
    final focus = to.toWorld(size.center(Offset.zero));
    final s0 = Offset(focus.dx * from.z + from.x, focus.dy * from.z + from.y);
    final s1 = size.center(Offset.zero);
    void onCam() {
      if (_lastSet != null && cam.value != _lastSet) _stopAnimation();
    }

    cam.addListener(onCam);
    final ticker = Ticker((elapsed) {
      final t = math.min(1.0, elapsed.inMicroseconds / (ms * 1000));
      final e = 1 - math.pow(1 - t, 3).toDouble();
      final z = from.z * math.pow(to.z / from.z, e).toDouble();
      final sx = s0.dx + (s1.dx - s0.dx) * e;
      final sy = s0.dy + (s1.dy - s0.dy) * e;
      final next = t >= 1 ? to : Camera(sx - focus.dx * z, sy - focus.dy * z, z);
      _lastSet = next;
      cam.value = next;
      if (t >= 1) _stopAnimation(fromTick: true);
    });
    _cleanup = () => cam.removeListener(onCam);
    _ticker = ticker..start();
  }

  VoidCallback? _cleanup;

  /// The camera is animated right now.
  bool get animating => _ticker != null;

  void _stopAnimation({bool fromTick = false}) {
    final t = _ticker;
    _ticker = null;
    if (t != null) fromTick ? scheduleMicrotask(t.dispose) : t.dispose();
    _lastSet = null;
    _cleanup?.call();
    _cleanup = null;
  }

  void dispose() {
    _stopAnimation();
    if (immersive.value) setImmersive(false);
  }
}

class _Or extends ChangeNotifier implements ValueListenable<bool> {
  _Or(this.parts) {
    for (final p in parts) {
      p.addListener(notifyListeners);
    }
  }
  final List<ValueListenable<bool>> parts;

  @override
  bool get value => parts.any((p) => p.value);
}
