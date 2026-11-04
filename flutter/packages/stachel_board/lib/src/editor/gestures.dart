import 'dart:ui';

/// What is under a finger when it goes down (asked once per touch).
class GestureHit {
  const GestureHit({
    this.objectId,
    this.selected = false,
    this.handle,
    this.movable = false,
    this.draw = false,
    this.overlay,
    this.overlayMovable = false,
  });

  /// A drawing tool is active here (pen, eraser, connector): one finger draws instead of panning (E3).
  final bool draw;

  /// Something drawn over the board was hit (E3: `comment:<thread>`, `reaction:<object>|<emoji>`): a tap acts on it.
  final String? overlay;

  /// P5 (web L02): the [overlay] can be held and dragged like an object (comment pin) – holding grabs it, no menu.
  final bool overlayMovable;

  /// Object under the finger (null = empty board).
  final String? objectId;

  /// The object is selected (dragging it moves it right away).
  final bool selected;

  /// A selection handle (`nw`/`ne`/`se`/`sw`/`n`/`e`/`s`/`w`, `rotate`, `add-n`/…): acts right away.
  final String? handle;

  /// Holding the object grabs it (editable, not locked).
  final bool movable;

  static const empty = GestureHit();
}

/// Receives what [BoardGestures] recognised (screen coordinates).
abstract class BoardGestureHandler {
  GestureHit hitAt(Offset p);

  /// Long press and drag on the board need editing rights.
  bool get editable;

  /// Comments can be written ([BoardController.canComment]): read only, holding the empty board still opens its menu
  /// („Hier kommentieren“, role `comment`).
  bool get commentable;

  void panStart(Offset p);
  void panUpdate(Offset delta);
  void panEnd(Offset velocity);

  void pinchStart(Offset focal);
  void pinchUpdate(Offset focal, double scale);
  void pinchEnd();

  void tap(Offset p, GestureHit hit);
  void doubleTap(Offset p, GestureHit hit);

  /// Moving objects: the selected one ([grabbed] false) or one grabbed by holding ([grabbed] true, haptic).
  void dragStart(Offset p, GestureHit hit, {required bool grabbed});
  void dragUpdate(Offset p);
  void dragEnd();

  void handleStart(String handle, Offset p);
  void handleUpdate(Offset p);
  void handleEnd();

  /// Long press on the empty board, released without moving: menu.
  void longPressEmpty(Offset p);

  /// F2 (web D41): an object held [BoardGestures.menuTime] without moving: its context menu (the view selects it
  /// first). Also read only and on locked objects (the menu shows what is possible there).
  void longPressObject(Offset p, GestureHit hit);

  /// Long press on the empty board, then drag: selection rectangle.
  void marqueeStart(Offset p);
  void marqueeUpdate(Offset start, Offset p);
  void marqueeEnd();

  /// Drawing with a tool ([GestureHit.draw]): starts on touch, ends on release ([moved]: beyond the slop); a second
  /// finger cancels it (then pinch).
  void drawStart(Offset p);
  void drawUpdate(Offset p);
  void drawEnd(Offset p, {required bool moved});
  void drawCancel();
}

enum _Mode { idle, pending, held, pan, drag, handle, holdEmpty, marquee, pinch, draw, done }

/// Touch gestures of the board as a state machine (concept §3.3), plain Dart so tests drive it with events:
///
/// | gesture | effect |
/// |---|---|
/// | 1 finger on the empty board or an unselected object, drag | pan (with inertia) |
/// | 1 finger on a selected object, drag | move it |
/// | 1 finger held [holdTime] on an object, then drag | grab and move it (haptic) |
/// | 1 finger held [menuTime] on an object without moving ([menuSlop]) | its context menu (web D41) |
/// | 1 finger held on the empty board, then drag | selection rectangle; released without moving: menu |
/// | 1 finger on a handle | resize / rotate / add right away |
/// | tap / double tap | [BoardGestureHandler.tap] / [BoardGestureHandler.doubleTap] |
/// | 2 fingers | pinch zoom + pan; a second finger ends any one-finger gesture |
///
/// The widget feeds pointer events and calls [timeout] when [deadline] has passed.
class BoardGestures {
  BoardGestures(
    this.handler, {
    this.slop = 18,
    this.holdTime = const Duration(milliseconds: 300),
    this.menuTime = const Duration(milliseconds: 500),
    this.menuSlop = 8,
    this.doubleTapTime = const Duration(milliseconds: 300),
    this.doubleTapSlop = 40,
  });

  final BoardGestureHandler handler;

  /// Movement (screen px) that turns a touch into a drag.
  final double slop;
  final Duration holdTime;

  /// Holding an object this long without moving opens its menu (web: 500 ms, touch).
  final Duration menuTime;

  /// Movement (screen px) after grabbing that still counts as „not moved“ for the menu (web: 8 px).
  final double menuSlop;
  final Duration doubleTapTime;
  final double doubleTapSlop;

  final _pointers = <int, Offset>{};
  final _samples = <(Duration, Offset)>[];
  _Mode _mode = _Mode.idle;
  int? _primary;
  Offset _down = Offset.zero;
  Duration _downAt = Duration.zero;
  GestureHit _hit = GestureHit.empty;
  Offset _last = Offset.zero;
  double _pinchDist0 = 1;
  Offset? _lastTapAt;
  Duration? _lastTapTime;
  bool _moved = false;

  /// When [timeout] must be called (holding a finger still); null = nothing pending. After the first timeout a
  /// second one may follow (grab at [holdTime], menu at [menuTime]).
  Duration? get deadline => switch (_mode) {
    _Mode.pending => _downAt + (_hit.objectId != null && !(_hit.movable && handler.editable) ? menuTime : holdTime),
    _Mode.held => _hit.objectId == null ? null : _downAt + menuTime,
    _ => null,
  };

  /// Time of the current finger's touch down.
  Duration get downAt => _downAt;

  bool get active => _mode != _Mode.idle;

  void down(int pointer, Offset p, Duration t) {
    _pointers[pointer] = p;
    if (_pointers.length == 1) {
      _primary = pointer;
      _down = _last = p;
      _downAt = t;
      _samples
        ..clear()
        ..add((t, p));
      _hit = handler.hitAt(p);
      if (_hit.handle != null && handler.editable) {
        _mode = _Mode.handle;
        handler.handleStart(_hit.handle!, p);
      } else if (_hit.draw && handler.editable) {
        _mode = _Mode.draw;
        _moved = false;
        handler.drawStart(p);
      } else {
        _mode = _Mode.pending;
      }
      return;
    }
    if (_pointers.length == 2) _startPinch();
  }

  void move(int pointer, Offset p, Duration t) {
    if (!_pointers.containsKey(pointer)) return;
    _pointers[pointer] = p;
    if (_mode == _Mode.pinch) {
      if (_pointers.length >= 2) handler.pinchUpdate(_focal, _distance / _pinchDist0);
      return;
    }
    if (pointer != _primary) return;
    _samples.add((t, p));
    if (_samples.length > 20) _samples.removeAt(0);
    switch (_mode) {
      case _Mode.pending:
        if ((p - _down).distance < slop) return;
        if (_hit.objectId != null && _hit.selected && _hit.movable && handler.editable) {
          _mode = _Mode.drag;
          handler.dragStart(_down, _hit, grabbed: false);
          handler.dragUpdate(p);
        } else {
          _mode = _Mode.pan;
          handler.panStart(_down);
          handler.panUpdate(p - _down);
        }
      case _Mode.held:
        // grabbed (haptic), the object follows only once the finger really moves; until then the menu may come
        if ((p - _down).distance < menuSlop) return;
        _mode = _Mode.drag;
        handler.dragUpdate(p);
      case _Mode.pan:
        handler.panUpdate(p - _last);
      case _Mode.drag:
        handler.dragUpdate(p);
      case _Mode.handle:
        handler.handleUpdate(p);
      case _Mode.draw:
        if ((p - _down).distance >= slop / 3) _moved = true;
        handler.drawUpdate(p);
      case _Mode.holdEmpty:
        if ((p - _down).distance < slop) return;
        if (!handler.editable) {
          _mode = _Mode.pan;
          handler.panStart(_down);
          handler.panUpdate(p - _down);
          break;
        }
        _mode = _Mode.marquee;
        handler.marqueeStart(_down);
        handler.marqueeUpdate(_down, p);
      case _Mode.marquee:
        handler.marqueeUpdate(_down, p);
      default:
        break;
    }
    _last = p;
  }

  /// The finger was held still until [deadline].
  void timeout(Duration t) {
    final d = deadline;
    if (d == null || t < d) return;
    if (_mode == _Mode.held || (_mode == _Mode.pending && _hit.objectId != null && d == _downAt + menuTime)) {
      // held without moving: the object's menu (a grab that did not move ends without a change)
      if (_mode == _Mode.held) handler.dragEnd();
      _mode = _Mode.done;
      handler.longPressObject(_down, _hit);
      return;
    }
    if (!handler.editable) {
      // read only: holding the empty board does nothing, lifting is a tap – with comment rights the menu comes on
      // release (no selection rectangle: moving pans)
      if (handler.commentable && _hit.objectId == null && !_hit.overlayMovable) {
        _mode = _Mode.holdEmpty;
      }
      return;
    }
    if (_hit.objectId != null || _hit.overlayMovable) {
      _mode = _Mode.held;
      handler.dragStart(_down, _hit, grabbed: true);
    } else {
      _mode = _Mode.holdEmpty;
    }
  }

  void up(int pointer, Duration t) {
    if (!_pointers.containsKey(pointer)) return;
    final p = _pointers.remove(pointer)!;
    if (_mode == _Mode.pinch) {
      if (_pointers.length < 2) {
        handler.pinchEnd();
        if (_pointers.isEmpty) {
          _mode = _Mode.idle;
        } else {
          // one finger stays: it pans on (like the scale gesture), the board never jumps
          _mode = _Mode.pan;
          _primary = _pointers.keys.first;
          _last = _down = _pointers.values.first;
          _samples.clear();
          handler.panStart(_last);
        }
      }
      return;
    }
    if (pointer != _primary) return;
    _endOne(p, t, cancelled: false);
    _mode = _pointers.isEmpty ? _Mode.idle : _Mode.done;
  }

  void cancel(int pointer) {
    if (!_pointers.containsKey(pointer)) return;
    final p = _pointers.remove(pointer)!;
    if (_mode == _Mode.pinch) {
      if (_pointers.length < 2) handler.pinchEnd();
      _mode = _pointers.isEmpty ? _Mode.idle : _Mode.done;
      return;
    }
    if (pointer == _primary) _endOne(p, Duration.zero, cancelled: true);
    _mode = _pointers.isEmpty ? _Mode.idle : _Mode.done;
  }

  void _endOne(Offset p, Duration t, {required bool cancelled}) {
    switch (_mode) {
      case _Mode.pending:
        if (cancelled) return;
        final prev = _lastTapAt, prevAt = _lastTapTime;
        if (prev != null && prevAt != null && t - prevAt <= doubleTapTime && (p - prev).distance <= doubleTapSlop) {
          _lastTapAt = null;
          _lastTapTime = null;
          handler.doubleTap(p, _hit);
        } else {
          _lastTapAt = p;
          _lastTapTime = t;
          handler.tap(p, _hit);
        }
      case _Mode.pan:
        handler.panEnd(cancelled ? Offset.zero : _velocity());
      case _Mode.drag || _Mode.held:
        handler.dragEnd();
      case _Mode.handle:
        handler.handleEnd();
      case _Mode.draw:
        if (cancelled) {
          handler.drawCancel();
        } else {
          handler.drawEnd(p, moved: _moved);
        }
      case _Mode.holdEmpty:
        if (!cancelled) handler.longPressEmpty(p);
      case _Mode.marquee:
        handler.marqueeEnd();
      default:
        break;
    }
  }

  void _startPinch() {
    // a second finger ends every one-finger gesture
    switch (_mode) {
      case _Mode.pan:
        handler.panEnd(Offset.zero);
      case _Mode.drag || _Mode.held:
        handler.dragEnd();
      case _Mode.handle:
        handler.handleEnd();
      case _Mode.marquee:
        handler.marqueeEnd();
      case _Mode.draw:
        handler.drawCancel();
      default:
        break;
    }
    _mode = _Mode.pinch;
    _pinchDist0 = _distance.clamp(1, double.infinity);
    handler.pinchStart(_focal);
  }

  Offset get _focal {
    final ps = _pointers.values.take(2).toList();
    return ps.length < 2 ? ps.first : (ps[0] + ps[1]) / 2;
  }

  double get _distance {
    final ps = _pointers.values.take(2).toList();
    return ps.length < 2 ? 1 : (ps[0] - ps[1]).distance;
  }

  /// Release velocity (px/s) from the last ~80 ms.
  Offset _velocity() {
    if (_samples.length < 2) return Offset.zero;
    final last = _samples.last;
    var first = _samples.first;
    for (final s in _samples) {
      if (last.$1 - s.$1 <= const Duration(milliseconds: 80)) {
        first = s;
        break;
      }
    }
    final dt = (last.$1 - first.$1).inMicroseconds / 1e6;
    if (dt <= 0) return Offset.zero;
    return (last.$2 - first.$2) / dt;
  }
}
