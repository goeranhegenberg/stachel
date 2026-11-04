import 'dart:async';
import 'dart:ui';

import 'native_messages.dart';

/// Own presence for the others (contract §8.4 `presence`): viewport (board coordinates), a cursor in its center (a
/// phone has no hover cursor; the web shows where this person looks) and the selection.
///
/// Throttled: at most one message per [interval], the last state wins (trailing send). Only sends while [live]; a
/// new connection gets the whole state again ([resend]) because the server keeps presence per connection.
///
/// F2: feature fields go out generically as `extra` ([setExtra]: `collab.status`, `collab.follow`, `collab.laser` …,
/// positive list on the server, F1) – packages never touch this file for a new field.
class PresenceSender {
  PresenceSender(this._send, {this.interval = const Duration(milliseconds: 250)});

  final void Function(Map<String, Object?> message) _send;
  final Duration interval;

  Rect? _viewport;
  List<String> _selection = const [];
  String? _editing;
  List<({Rect rect, String? color})> _uploads = const [];
  bool _sentUploads = false;
  final _extra = <String, Object?>{};
  final _clearedExtra = <String>{};
  Map<String, Object?>? _lastSent;
  DateTime? _lastAt;
  Timer? _timer;
  bool _live = false;
  bool _disposed = false;

  /// Messages actually sent (tests, debug).
  int sentCount = 0;

  bool get live => _live;
  set live(bool v) {
    if (v == _live) return;
    _live = v;
    if (!v) {
      _timer?.cancel();
      _timer = null;
    }
  }

  /// New viewport and/or selection; null leaves a part as it is.
  void update({Rect? viewport, List<String>? selection}) {
    if (viewport != null) _viewport = viewport;
    if (selection != null) _selection = List.unmodifiable(selection);
    _schedule();
  }

  /// The object whose text this person is writing in (null = none): the web shows „… schreibt hier gerade“.
  /// Sent right away (not throttled behind viewport updates).
  set editing(String? id) {
    if (id == _editing) return;
    _editing = id;
    _timer?.cancel();
    _timer = null;
    _flush();
  }

  String? get editing => _editing;

  /// Running image uploads (board rectangles + average color): the others see „Mara lädt hoch …“ there. Sent right
  /// away; an empty list clears them.
  set uploads(List<({Rect rect, String? color})> list) {
    _uploads = List.unmodifiable(list);
    _timer?.cancel();
    _timer = null;
    _flush();
  }

  List<({Rect rect, String? color})> get uploads => _uploads;

  /// Sets the awareness field [key] of a feature module (`extra`, contract §8.4; e.g. `collab.status` →
  /// `'away'`); null removes it (sent once as null). [immediate] skips the throttle (laser, summon).
  void setExtra(String key, Object? value, {bool immediate = false}) {
    if (value == null) {
      if (!_extra.containsKey(key)) return;
      _extra.remove(key);
      _clearedExtra.add(key);
    } else {
      if (_extra[key] == value) return;
      _extra[key] = value;
      _clearedExtra.remove(key);
    }
    if (immediate) {
      _timer?.cancel();
      _timer = null;
      _flush();
    } else {
      _schedule();
    }
  }

  /// Current feature fields (read only).
  Map<String, Object?> get extra => Map.unmodifiable(_extra);

  Map<String, Object?>? get _extraJson =>
      _extra.isEmpty && _clearedExtra.isEmpty ? null : {for (final k in _clearedExtra) k: null, ..._extra};

  /// Only once uploads were announced (then an empty list clears them; older servers ignore the field).
  List<Map<String, Object?>>? get _uploadsJson => _uploads.isEmpty && !_sentUploads
      ? null
      : [
          for (final u in _uploads)
            {
              'x': u.rect.left.roundToDouble(),
              'y': u.rect.top.roundToDouble(),
              'w': u.rect.width.roundToDouble(),
              'h': u.rect.height.roundToDouble(),
              'color': ?u.color,
            },
        ];

  /// Sends the whole state now (after `welcome`/`resumed`).
  void resend() {
    _lastSent = null;
    _timer?.cancel();
    _timer = null;
    _flush();
  }

  /// The message for the current state (null while there is nothing to tell).
  Map<String, Object?>? get message {
    final v = _viewport;
    // without a view yet only what someone does (writing, selection) – nothing at all if there is nothing
    if (v == null) {
      if (_editing == null && _selection.isEmpty && _uploadsJson == null && _extraJson == null) return null;
      return presenceMessage(selection: _selection, editing: _editing, uploads: _uploadsJson, extra: _extraJson);
    }
    double r(double x) => x.roundToDouble();
    return presenceMessage(
      cursorX: r(v.center.dx),
      cursorY: r(v.center.dy),
      selection: _selection,
      editing: _editing,
      viewport: (x: r(v.left), y: r(v.top), w: r(v.width), h: r(v.height)),
      uploads: _uploadsJson,
      extra: _extraJson,
    );
  }

  void _schedule() {
    if (!_live || _disposed || _timer != null) return;
    final last = _lastAt;
    final wait = last == null ? Duration.zero : interval - DateTime.now().difference(last);
    if (wait <= Duration.zero) return _flush();
    _timer = Timer(wait, () {
      _timer = null;
      _flush();
    });
  }

  void _flush() {
    if (!_live || _disposed) return;
    final m = message;
    if (m == null || _same(m, _lastSent)) return;
    _send(m);
    sentCount++;
    _sentUploads = _uploads.isNotEmpty;
    _clearedExtra.clear(); // removals went out once
    _lastSent = m;
    _lastAt = DateTime.now();
  }

  static bool _same(Map<String, Object?> a, Map<String, Object?>? b) {
    if (b == null) return false;
    return a.toString() == b.toString();
  }

  /// Drops a pending trailing send (the view went away).
  void cancelPending() {
    _timer?.cancel();
    _timer = null;
  }

  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _timer = null;
  }
}
