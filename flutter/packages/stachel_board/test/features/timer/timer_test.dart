// P5 Timer für alle (audit L12): board menu, chip on top with time and progress, sheet with the web's buttons, „Zeit
// ist um!“ with the signal once per run (only on devices that saw it run), sound per device.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import '../follow/p5_harness.dart';

void main() {
  var now = 1000000;
  setUp(() {
    now = 1000000;
    collabDeviceNow = () => now;
  });
  tearDown(() => collabDeviceNow = () => DateTime.now().millisecondsSinceEpoch);

  Map<String, Object?> timer(String state, {int endsAt = 0, int remaining = 0, int duration = 300000, int run = 1}) => {
    'collab.timer': {
      'timer': {
        'state': state,
        'endsAt': endsAt,
        'remaining': remaining,
        'duration': duration,
        'by': 'Jonas',
        'run': run,
      },
    },
  };

  testWidgets('Board-Menü: „Timer für alle: 5 Min.“ startet, „Timer einstellen …“ mit Voreinstellungen', (
    tester,
  ) async {
    final b = await pumpP5(tester);
    await boardMenu(tester, 'collabMenuTimer');
    expectAct(b.acts.last, 'collab.timer.start', {'ms': 300000});
    await boardMenu(tester, 'collabMenuTimerSet');
    expect(find.byKey(const Key('collabTimerSheet')), findsOneWidget);
    expect(find.text('5:00'), findsOneWidget);
    await tester.tap(find.byKey(const Key('collabTimerPreset-15')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('collabTimerMore')));
    await tester.pump();
    expect(find.text('16:00'), findsOneWidget);
    await tester.tap(find.byKey(const Key('collabTimerStart')));
    await tester.pump(const Duration(milliseconds: 400));
    expectAct(b.acts.last, 'collab.timer.start', {'ms': 16 * 60000});
  });

  testWidgets('läuft: Chip oben mit Restzeit, Blatt mit Pause/+1/+5/Beenden, Menü „Timer beenden“', (tester) async {
    final b = await pumpP5(tester, ext: timer('running', endsAt: now + 125000));
    expect(find.byKey(const Key('collabTimerChip')), findsOneWidget);
    expect(find.text('2:05'), findsOneWidget);
    now += 1000;
    await tester.pump(const Duration(milliseconds: 250));
    expect(find.text('2:04'), findsOneWidget);
    await tester.tap(find.byKey(const Key('collabTimerChip')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Läuft · gestartet von Jonas'), findsOneWidget);
    await tester.tap(find.byKey(const Key('collabTimerPause')));
    await tester.tap(find.byKey(const Key('collabTimerPlus1')));
    await tester.tap(find.byKey(const Key('collabTimerPlus5')));
    await tester.pump();
    expect(b.acts.map((a) => a.$1).toList(), ['collab.timer.pause', 'collab.timer.add', 'collab.timer.add']);
    expect(b.acts[2].$2, {'ms': 300000});
    b.ext(timer('paused', remaining: 60000));
    await tester.pump();
    expect(find.text('Pausiert · gestartet von Jonas'), findsOneWidget);
    await tester.tap(find.byKey(const Key('collabTimerResume')));
    await tester.tap(find.byKey(const Key('collabTimerStop')));
    await tester.pump(const Duration(milliseconds: 400));
    expect(b.acts.map((a) => a.$1).skip(3), ['collab.timer.resume', 'collab.timer.stop']);
    await tester.tap(find.byKey(const Key('stachelBoardMenu')));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Timer beenden'), findsOneWidget);
    await tester.tapAt(const Offset(5, 5));
    await tester.pump(const Duration(milliseconds: 400));
  });

  testWidgets('„Zeit ist um!“ mit Signal einmal je Lauf, nur wer ihn laufen sah; OK beendet; stumm je Gerät', (
    tester,
  ) async {
    final b = await pumpP5(tester, ext: timer('running', endsAt: now + 1000));
    now += 1100;
    await tester.pump(const Duration(milliseconds: 250));
    await tester.pump();
    expect(find.byKey(const Key('collabTimesUp')), findsOneWidget);
    expect(find.text('Zeit ist um!'), findsOneWidget);
    expect(b.host.chimes, 1);
    now += 1000;
    await tester.pump(const Duration(milliseconds: 600));
    expect(b.host.chimes, 1, reason: 'einmal je Lauf');
    await tester.tap(find.byKey(const Key('collabTimesUpOk')));
    await tester.pump();
    expect(b.acts.last.$1, 'collab.timer.stop');
    // after 12 s it is off by itself
    now += 12000;
    await tester.pump(const Duration(milliseconds: 250));
    expect(find.byKey(const Key('collabTimesUp')), findsNothing);
    expect(find.byKey(const Key('collabTimerChip')), findsNothing);

    // a run this device never saw running: no signal
    b.ext(timer('running', endsAt: now - 500, run: 2));
    await tester.pump(const Duration(milliseconds: 250));
    expect(find.byKey(const Key('collabTimesUp')), findsNothing);
    expect(find.text('Zeit!'), findsOneWidget, reason: 'Chip zeigt das Ende');
    expect(b.host.chimes, 1);

    // sound off on this device: no tones on the next end
    await tester.tap(find.byKey(const Key('collabTimerChip')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.tap(find.byKey(const Key('collabTimerSound')));
    await tester.pump();
    expect(b.host.settings['stachel.collab.timerSound'], 'off');
    await tester.tapAt(const Offset(5, 5));
    await tester.pump(const Duration(milliseconds: 400));
    b.ext(timer('running', endsAt: now + 500, run: 3));
    await tester.pump(const Duration(milliseconds: 250));
    now += 600;
    await tester.pump(const Duration(milliseconds: 250));
    await tester.pump();
    expect(find.byKey(const Key('collabTimesUp')), findsOneWidget);
    expect(b.host.chimes, 1, reason: 'stumm');
    now += 13000;
    await tester.pump(const Duration(milliseconds: 250));
  });
}
