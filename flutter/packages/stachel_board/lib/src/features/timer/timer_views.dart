import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../editor/registry/board_ui.dart';
import '../follow/collab_common.dart';
import '../voting/vote_model.dart' show readVoteSession;
import 'timer_model.dart';

// Timer für alle (web `TimerViews.tsx`, `Notices.tsx` `TimerNotice`): chip on top in the middle (the web shows it
// there on phones and while presenting), settings as a sheet, „Zeit ist um!“ with three tones (+ vibration) once per
// run on every device that saw it run; sound per device. Audit row L12.

/// Device setting of the end signal (web `localStorage` `stachel.collab.timerSound`, 'off' = muted).
const timerSoundKey = 'stachel.collab.timerSound';

/// Timer state of one board screen that is not in the document (web: refs of `useTimerEnd`, `soundOn()`).
class TimerRuntime {
  TimerRuntime._(this.ui) {
    unawaited(ui.host.readSetting(timerSoundKey).then((v) => sound.value = v != 'off', onError: (_) {}));
  }
  static final _of = Expando<TimerRuntime>('TimerRuntime');
  static TimerRuntime of(BoardUi ui) => _of[ui] ??= TimerRuntime._(ui);
  final BoardUi ui;

  /// Ton am Ende (on unless switched off on this device).
  final sound = ValueNotifier<bool>(true);

  /// The run this device saw running / already signalled.
  int? seenRun;
  int? rangRun;

  /// Signals played (tests).
  int chimes = 0;

  void setSound(bool on) {
    sound.value = on;
    unawaited(ui.host.writeSetting(timerSoundKey, on ? 'on' : 'off').catchError((_) {}));
  }

  /// Three tones (+ vibration) unless muted on this device (web `chime`).
  void chime() {
    chimes++;
    if (!sound.value) return;
    unawaited(ui.host.playChime().catchError((_) {}));
    unawaited(HapticFeedback.vibrate());
  }

  TimerState get timer => timerOf(ui.controller.state.ext);

  Future<void> act(String name, [Map<String, Object?> args = const {}]) =>
      ui.controller.act('collab.timer.$name', args, label: 'Timer');
}

/// „Timer für alle“ with the setter or the running timer's buttons (web `TimerPop`) as a sheet.
Future<void> showTimerSheet(BuildContext context, BoardUi ui) => ui.openSheet<void>(
  context,
  (context) => _TimerSheet(ui: ui),
  closeOnSelectionChange: false,
  scrollControlled: true,
);

class _TimerSheet extends StatefulWidget {
  const _TimerSheet({required this.ui});
  final BoardUi ui;

  @override
  State<_TimerSheet> createState() => _TimerSheetState();
}

class _TimerSheetState extends State<_TimerSheet> {
  int _min = 5;
  Timer? _tick;

  BoardUi get ui => widget.ui;
  TimerRuntime get rt => TimerRuntime.of(ui);

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(milliseconds: 200), (_) {
      if (mounted && rt.timer.state == TimerRun.running) setState(() {});
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  void _done() => Navigator.of(context).maybePop();

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([ui.controller, rt.sound]),
    builder: (context, _) {
      final t = rt.timer;
      final now = CollabSession.of(ui).now;
      final view = timerView(t, now);
      final running = view == TimerView.running || view == TimerView.paused;
      final theme = ui.theme;
      final big = TextStyle(
        fontSize: 44,
        fontWeight: FontWeight.w700,
        fontFamily: theme.condensedFont,
        fontFeatures: const [FontFeature.tabularFigures()],
        color: view == TimerView.paused ? theme.grey : theme.ink,
      );
      return SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            key: const Key('collabTimerSheet'),
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Timer für alle', style: theme.label(size: 20)),
              const SizedBox(height: 10),
              if (running) ...[
                Text(
                  formatMs(remainingMs(t, now)),
                  key: const Key('collabTimerBig'),
                  textAlign: TextAlign.center,
                  style: big,
                ),
                Text(
                  '${view == TimerView.paused ? 'Pausiert' : 'Läuft'} · gestartet von ${t.by.isEmpty ? 'jemandem' : t.by}',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: theme.grey),
                ),
                const SizedBox(height: 12),
                Wrap(
                  alignment: WrapAlignment.center,
                  spacing: 10,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    if (view == TimerView.paused)
                      IconButton.filled(
                        key: const Key('collabTimerResume'),
                        tooltip: 'Weiter',
                        style: IconButton.styleFrom(
                          backgroundColor: CollabColors.green,
                          foregroundColor: CollabColors.ink,
                        ),
                        onPressed: () => unawaited(rt.act('resume')),
                        icon: const Icon(Icons.play_arrow),
                      )
                    else
                      IconButton.outlined(
                        key: const Key('collabTimerPause'),
                        tooltip: 'Pause',
                        onPressed: () => unawaited(rt.act('pause')),
                        icon: const Icon(Icons.pause),
                      ),
                    OutlinedButton(
                      key: const Key('collabTimerPlus1'),
                      onPressed: () => unawaited(rt.act('add', {'ms': 60000})),
                      child: const Text('+1 Min.'),
                    ),
                    OutlinedButton(
                      key: const Key('collabTimerPlus5'),
                      onPressed: () => unawaited(rt.act('add', {'ms': 5 * 60000})),
                      child: const Text('+5 Min.'),
                    ),
                    IconButton.filled(
                      key: const Key('collabTimerStop'),
                      tooltip: 'Timer beenden',
                      style: IconButton.styleFrom(backgroundColor: CollabColors.pink),
                      onPressed: () {
                        unawaited(rt.act('stop'));
                        _done();
                      },
                      icon: const Icon(Icons.stop),
                    ),
                  ],
                ),
              ] else ...[
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    IconButton.outlined(
                      key: const Key('collabTimerLess'),
                      tooltip: 'Eine Minute weniger',
                      onPressed: _min <= timerMinMinutes ? null : () => setState(() => _min--),
                      icon: const Icon(Icons.remove),
                    ),
                    const SizedBox(width: 12),
                    Text(formatMs(_min * 60000), key: const Key('collabTimerBig'), style: big),
                    const SizedBox(width: 12),
                    IconButton.outlined(
                      key: const Key('collabTimerMore'),
                      tooltip: 'Eine Minute mehr',
                      onPressed: _min >= timerMaxMinutes ? null : () => setState(() => _min++),
                      icon: const Icon(Icons.add),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Wrap(
                  alignment: WrapAlignment.center,
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final m in timerPresets)
                      ChoiceChip(
                        key: Key('collabTimerPreset-$m'),
                        label: Text('$m Min.'),
                        selected: m == _min,
                        onSelected: (_) => setState(() => _min = m),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                FilledButton.icon(
                  key: const Key('collabTimerStart'),
                  style: FilledButton.styleFrom(backgroundColor: CollabColors.green, foregroundColor: CollabColors.ink),
                  onPressed: () {
                    unawaited(rt.act('start', {'ms': _min * 60000}));
                    _done();
                  },
                  icon: const Icon(Icons.play_arrow),
                  label: const Text('Für alle starten'),
                ),
              ],
              const SizedBox(height: 8),
              SwitchListTile(
                key: const Key('collabTimerSound'),
                contentPadding: EdgeInsets.zero,
                value: rt.sound.value,
                onChanged: rt.setSound,
                secondary: Icon(rt.sound.value ? Icons.volume_up_outlined : Icons.volume_off_outlined),
                title: const Text('Ton am Ende'),
              ),
            ],
          ),
        ),
      );
    },
  );
}

/// A timer and a vote that end at most this far apart count as one remaining time (UX-Review P2).
const sameEndMs = 5000;

/// Timer in the notices on top (web `TimerNotice`, also while presenting): „Zeit ist um!“ + OK after the end (sound
/// once per run), else while it runs/pauses the chip with the time and the progress bar (tap = settings).
class TimerNotice extends StatefulWidget {
  const TimerNotice({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<TimerNotice> createState() => _TimerNoticeState();
}

class _TimerNoticeState extends State<TimerNotice> {
  Timer? _tick;
  BoardUi get ui => widget.ui;
  TimerRuntime get rt => TimerRuntime.of(ui);

  void _ticking(bool on) {
    if (on && _tick == null) {
      _tick = Timer.periodic(const Duration(milliseconds: 200), (_) {
        if (mounted) setState(() {});
      });
    } else if (!on && _tick != null) {
      _tick!.cancel();
      _tick = null;
    }
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: ui.controller,
    builder: (context, _) {
      final t = rt.timer;
      final now = CollabSession.of(ui).now;
      // ticks while running and while „Zeit ist um“ may still show
      _ticking(t.state == TimerRun.running && now - t.endsAt < overShowMs);
      if (t.state == TimerRun.running && now < t.endsAt) rt.seenRun = t.run;
      final over = isOver(t, now) && rt.seenRun == t.run && now - t.endsAt < overShowMs;
      if (over && rt.rangRun != t.run) {
        rt.rangRun = t.run;
        rt.chime();
      }
      if (over) {
        return CollabPill(
          key: const Key('collabTimesUp'),
          ring: CollabColors.pink,
          minHeight: 52,
          padding: const EdgeInsets.fromLTRB(10, 6, 8, 6),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: const BoxDecoration(color: CollabColors.pink, shape: BoxShape.circle),
                child: const Icon(Icons.timer_outlined, size: 22),
              ),
              const SizedBox(width: 12),
              const Text('Zeit ist um!', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
              const SizedBox(width: 12),
              CollabPillButton(
                key: const Key('collabTimesUpOk'),
                label: 'OK',
                green: true,
                onPressed: () => unawaited(rt.act('stop')),
              ),
            ],
          ),
        );
      }
      final view = timerView(t, now);
      if (view == TimerView.idle) return const SizedBox.shrink();
      final rem = remainingMs(t, now);
      // UX-Review P2: one remaining time on top – with a running vote that ends (almost) together with the timer the
      // vote bar shows the time alone; ending at another time, the chip says „Timer“ to tell the two apart
      final vote = readVoteSession(ui.controller.state.ext[extVote]);
      final voteEnds = vote != null && vote.endsAt != null && vote.runningAt(now) && !ui.presenting.value
          ? vote.endsAt! - now
          : null;
      if (voteEnds != null && view == TimerView.running && (voteEnds - rem).abs() <= sameEndMs) {
        return const SizedBox.shrink(key: Key('collabTimerInVote'));
      }
      final named = voteEnds != null;
      final pct = t.duration > 0 ? (1 - rem / t.duration).clamp(0.0, 1.0) : 0.0;
      return Semantics(
        button: true,
        label: 'Timer ${view == TimerView.over ? 'abgelaufen' : formatMs(rem)}',
        child: GestureDetector(
          key: const Key('collabTimerChip'),
          onTap: () => unawaited(showTimerSheet(context, ui)),
          child: Container(
            height: 40,
            decoration: BoxDecoration(
              color: CollabColors.ink,
              borderRadius: BorderRadius.circular(999),
              boxShadow: const [BoxShadow(color: Color(0x40000000), blurRadius: 18, offset: Offset(0, 6))],
            ),
            clipBehavior: Clip.antiAlias,
            child: Stack(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 0, 14, 0),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.timer_outlined,
                        size: 20,
                        color: view == TimerView.paused ? CollabColors.idle : Colors.white,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        view == TimerView.over ? 'Zeit!' : '${named ? 'Timer ' : ''}${formatMs(rem)}',
                        key: const Key('collabTimerTime'),
                        style: TextStyle(
                          color: view == TimerView.paused ? CollabColors.idle : Colors.white,
                          fontWeight: FontWeight.w700,
                          fontSize: 17,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    ],
                  ),
                ),
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 3,
                  child: FractionallySizedBox(
                    alignment: Alignment.centerLeft,
                    widthFactor: view == TimerView.over ? 1 : pct,
                    child: ColoredBox(color: view == TimerView.over ? CollabColors.ink : CollabColors.green),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
}
