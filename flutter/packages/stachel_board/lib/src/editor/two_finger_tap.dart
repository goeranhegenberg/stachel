import 'dart:ui';

/// What [MultiFingerTaps] recognized.
enum MultiTapKind {
  /// Two fingers tapped once (UX P13: Rückgängig) – reported only when no second tap followed in time.
  twoFingerTap,

  /// Two fingers tapped twice (E1: back to 100 %).
  twoFingerDoubleTap,

  /// Three fingers tapped once (UX P13: Wiederholen).
  threeFingerTap,
}

/// One recognized tap with several fingers: kind and the center of the fingers (screen).
class MultiTap {
  const MultiTap(this.kind, this.center);
  final MultiTapKind kind;
  final Offset center;

  @override
  bool operator ==(Object other) => other is MultiTap && other.kind == kind && other.center == center;

  @override
  int get hashCode => Object.hash(kind, center);

  @override
  String toString() => 'MultiTap($kind, $center)';
}

/// Taps with two and three fingers from raw pointer events (plain Dart, unit-testable), like common mobile canvas
/// apps: two fingers = undo, three fingers = redo, two fingers twice = 100 % (E1).
///
/// A tap: exactly two (three) fingers down, none moved more than [slop], all up within [tapTimeout]
/// ([threeTapTimeout]). A single two-finger tap is held back until [doubleTimeout] has passed without a second one
/// ([deadline], then [timeout]) – or until the next gesture shows it is no second tap; a second one within
/// [doubleTimeout] turns both into [MultiTapKind.twoFingerDoubleTap].
class MultiFingerTaps {
  MultiFingerTaps({
    this.tapTimeout = const Duration(milliseconds: 300),
    this.threeTapTimeout = const Duration(milliseconds: 400),
    this.doubleTimeout = const Duration(milliseconds: 450),
    this.slop = 24,
  });

  final Duration tapTimeout;
  final Duration threeTapTimeout;
  final Duration doubleTimeout;
  final double slop;

  final _start = <int, Offset>{};
  final _last = <int, Offset>{};
  int _max = 0;
  bool _moved = false;
  Duration _gestureStart = Duration.zero;
  Offset _tapCenter = Offset.zero;

  /// A two-finger tap waiting for a possible second one, and when it ended.
  MultiTap? _pending;
  Duration _pendingAt = Duration.zero;

  /// When the waiting two-finger tap becomes final ([timeout]); null = nothing waits.
  Duration? get deadline => _pending == null ? null : _pendingAt + doubleTimeout;

  /// Fingers on the screen.
  bool get active => _start.isNotEmpty;

  void down(int pointer, Offset position, Duration time) {
    if (_start.isEmpty) {
      _gestureStart = time;
      _max = 0;
      _moved = false;
    }
    _start[pointer] = position;
    _last[pointer] = position;
    if (_start.length > _max) _max = _start.length;
    if (_start.length >= 2) _tapCenter = _center();
  }

  void move(int pointer, Offset position) {
    final s = _start[pointer];
    if (s == null) return;
    _last[pointer] = position;
    if ((position - s).distance > slop) _moved = true;
  }

  /// What the lifted finger completes (usually nothing; a waiting two-finger tap and a three-finger tap may come
  /// out together, in order).
  List<MultiTap> up(int pointer, Duration time) {
    if (!_start.containsKey(pointer)) return const [];
    _start.remove(pointer);
    _last.remove(pointer);
    if (_start.isNotEmpty) return const [];
    final limit = _max == 3 ? threeTapTimeout : tapTimeout;
    final isTap = (_max == 2 || _max == 3) && !_moved && time - _gestureStart <= limit;
    final out = <MultiTap>[];
    final waiting = _pending;
    if (waiting != null) {
      _pending = null;
      if (isTap && _max == 2 && time - _pendingAt <= doubleTimeout) {
        return [MultiTap(MultiTapKind.twoFingerDoubleTap, _tapCenter)];
      }
      out.add(waiting);
    }
    if (isTap && _max == 2) {
      _pending = MultiTap(MultiTapKind.twoFingerTap, _tapCenter);
      _pendingAt = time;
    } else if (isTap && _max == 3) {
      out.add(MultiTap(MultiTapKind.threeFingerTap, _tapCenter));
    }
    return out;
  }

  /// Time [t] passed (a timer at [deadline], or any pointer event): the waiting two-finger tap when it can no longer
  /// become a double tap, else null.
  MultiTap? timeout(Duration t) {
    final p = _pending, d = deadline;
    if (p == null || d == null) return null;
    if (_start.isNotEmpty) {
      // fingers are down: wait while this gesture may still be the second tap
      final mayBeSecond = !_moved && _max <= 2 && _gestureStart <= d;
      if (mayBeSecond) return null;
    } else if (t < d) {
      return null;
    }
    _pending = null;
    return p;
  }

  void cancel(int pointer) {
    _start.remove(pointer);
    _last.remove(pointer);
    _moved = true;
    _pending = null;
  }

  Offset _center() {
    var sum = Offset.zero;
    for (final p in _last.values) {
      sum += p;
    }
    return sum / _last.length.toDouble();
  }
}
