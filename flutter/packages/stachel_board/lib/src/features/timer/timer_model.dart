import 'dart:math' as math;

import '../follow/collab_common.dart';

// Port of the web's `features/collab/timer.ts` (reading side) and `TimerViews.tsx` `timerView`; writing runs on the
// server with the web's code (actions `collab.timer.*`). Times in ms since 1970 (server clock).

/// Longest timer (web `MAX_TIMER_MS`).
const maxTimerMs = 3 * 3600 * 1000;

/// After the end „Zeit ist um“ shows this long, then the timer counts as off (web `OVER_SHOW_MS`).
const overShowMs = 12000;

/// Quick choices in minutes (web `PRESETS`).
const timerPresets = [1, 3, 5, 10, 15, 30];

/// Minutes of the setter (web: 1–180).
const timerMinMinutes = 1;
const timerMaxMinutes = 180;

enum TimerRun { idle, running, paused }

class TimerState {
  const TimerState({
    this.state = TimerRun.idle,
    this.endsAt = 0,
    this.remaining = 0,
    this.duration = 0,
    this.by = '',
    this.run = 0,
  });

  final TimerRun state;

  /// End (running).
  final int endsAt;

  /// Time left (paused).
  final int remaining;

  /// Whole duration (for the progress).
  final int duration;

  /// Name of the person who started it.
  final String by;

  /// Counts up with every start (the sound only once per run).
  final int run;
}

double _num(Object? v) => v is num && v.isFinite ? v.toDouble() : 0;

/// Timer from `ext['collab.timer']` (web `readTimer`): tolerant.
TimerState readTimer(Object? ext) {
  final t = ext is Map ? ext['timer'] : null;
  if (t is! Map) return const TimerState();
  final state = switch (t['state']) {
    'running' => TimerRun.running,
    'paused' => TimerRun.paused,
    _ => TimerRun.idle,
  };
  return TimerState(
    state: state,
    endsAt: _num(t['endsAt']).toInt(),
    remaining: math.max(0, _num(t['remaining'])).toInt(),
    duration: math.max(0, _num(t['duration'])).toInt(),
    by: t['by'] is String ? t['by'] as String : '',
    run: _num(t['run']).toInt(),
  );
}

TimerState timerOf(Map<String, Object?> ext) => readTimer(ext[extTimer]);

/// Time left in ms (0 = over or off) – web `remainingMs`.
int remainingMs(TimerState t, int now) => switch (t.state) {
  TimerRun.running => math.max(0, t.endsAt - now),
  TimerRun.paused => t.remaining,
  TimerRun.idle => 0,
};

/// Running and over (web `isOver`).
bool isOver(TimerState t, int now) => t.state == TimerRun.running && now >= t.endsAt;

/// „4:05“, from one hour on „1:02:03“ (seconds rounded up) – web `formatMs`.
String formatMs(int ms) {
  final s = (math.max(0, ms) / 1000).ceil();
  final h = s ~/ 3600;
  final m = (s % 3600) ~/ 60;
  final sec = (s % 60).toString().padLeft(2, '0');
  return h > 0 ? '$h:${m.toString().padLeft(2, '0')}:$sec' : '$m:$sec';
}

/// What to show: running, paused, just over or off (web `timerView`).
enum TimerView { running, paused, over, idle }

TimerView timerView(TimerState t, int now) {
  if (t.state == TimerRun.paused) return TimerView.paused;
  if (t.state != TimerRun.running) return TimerView.idle;
  if (now < t.endsAt) return TimerView.running;
  return now - t.endsAt < overShowMs ? TimerView.over : TimerView.idle;
}
