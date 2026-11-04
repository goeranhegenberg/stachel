// Taps with several fingers (E1: two fingers twice = 100 %; UX P13: two fingers = Rückgängig, three = Wiederholen) as
// plain Dart with time stamps – widget tests carry none, so holding too long is checked here.
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

void main() {
  const t0 = Duration(seconds: 10);
  Duration ms(int v) => t0 + Duration(milliseconds: v);
  const two = MultiTap(MultiTapKind.twoFingerTap, Offset(125, 200));
  const double2 = MultiTap(MultiTapKind.twoFingerDoubleTap, Offset(125, 200));
  const three = MultiTap(MultiTapKind.threeFingerTap, Offset(150, 200));

  List<MultiTap> tap(MultiFingerTaps d, int at, {double move = 0, int hold = 80, int fingers = 2}) {
    for (var i = 0; i < fingers; i++) {
      d.down(i, Offset(100.0 + 50 * i, 200), ms(at));
    }
    if (move > 0) d.move(0, Offset(100 + move, 200));
    final out = <MultiTap>[];
    for (var i = 0; i < fingers; i++) {
      out.addAll(d.up(i, ms(at + hold)));
    }
    return out;
  }

  test('zweimal mit zwei Fingern tippen → Doppeltipp (Mitte), kein Rückgängig', () {
    final d = MultiFingerTaps();
    expect(tap(d, 0), isEmpty);
    expect(d.deadline, ms(80 + 450), reason: 'der einzelne Tipp wartet auf einen zweiten');
    expect(tap(d, 250), [double2]);
    expect(d.deadline, isNull);
    expect(d.timeout(ms(2000)), isNull);
  });

  test('einmal mit zwei Fingern tippen → nach der Wartezeit Rückgängig', () {
    final d = MultiFingerTaps();
    expect(tap(d, 0), isEmpty);
    expect(d.timeout(ms(400)), isNull, reason: 'noch in der Wartezeit');
    expect(d.timeout(ms(530)), two);
    expect(d.timeout(ms(600)), isNull, reason: 'nur einmal');
  });

  test('drei Finger tippen → sofort Wiederholen; zwei Finger davor werden vorher fertig', () {
    final d = MultiFingerTaps();
    expect(tap(d, 0, fingers: 3), [three]);
    expect(d.deadline, isNull);
    expect(tap(d, 1000), isEmpty);
    expect(tap(d, 1200, fingers: 3), [two, three], reason: 'Reihenfolge: erst Rückgängig, dann Wiederholen');
  });

  test('eine neue Geste, die kein zweiter Tipp wird, macht den wartenden Tipp fertig', () {
    final d = MultiFingerTaps();
    tap(d, 0);
    // a finger goes down within the wait and pans: no second tap any more
    d.down(0, const Offset(10, 10), ms(200));
    expect(d.timeout(ms(530)), isNull, reason: 'kann noch der zweite Tipp werden');
    d.move(0, const Offset(80, 10));
    expect(d.timeout(ms(540)), two);
    expect(d.up(0, ms(700)), isEmpty);
  });

  test('zu langsam, verschoben, gehalten oder ein Finger → kein Doppeltipp', () {
    final d = MultiFingerTaps();
    tap(d, 0);
    expect(tap(d, 900), [two], reason: 'zu lange Pause: der erste war ein einzelner Tipp');
    expect(tap(d, 1100, move: 60), [two], reason: 'Pinch/Verschieben ist kein Tipp');
    expect(d.deadline, isNull);
    expect(tap(d, 2200, hold: 600), isEmpty, reason: 'gehalten');
    expect(tap(d, 3000, fingers: 1), isEmpty, reason: 'ein Finger');
    expect(d.deadline, isNull);
    expect(tap(d, 4000, fingers: 3, hold: 500), isEmpty, reason: 'drei Finger zu lange');
  });

  test('abgebrochener Finger verwirft den wartenden Tipp', () {
    final d = MultiFingerTaps();
    tap(d, 0);
    d.down(0, const Offset(10, 10), ms(100));
    d.cancel(0);
    expect(d.deadline, isNull);
    expect(d.timeout(ms(2000)), isNull);
  });
}
