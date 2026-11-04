// P5 Laserpointer (audit C18, L17): tool behind „···“, a finger draws the trail (awareness `collab.laser` like the
// web's LaserMsg), own and the others' trails fade; also while presenting.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import '../follow/p5_harness.dart';

void main() {
  var t = 0;
  setUp(() {
    t = 0;
    laserNow = () => t;
  });

  testWidgets('Werkzeug: Finger zieht die Spur, Nachricht wie im Web (s, p, g), nach dem Verblassen null', (
    tester,
  ) async {
    final b = await pumpP5(tester);
    await tester.tap(find.byKey(const Key('stachelToolMore')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.ensureVisible(find.byKey(const Key('stachelMoreLaser')));
    await tester.tap(find.byKey(const Key('stachelMoreLaser')));
    await tester.pump(const Duration(milliseconds: 400));
    expect(b.editor.activeToolId, 'collab.laser');
    final o = tester.getTopLeft(find.byType(BoardView));
    final g = await tester.startGesture(o + const Offset(100, 200));
    for (var i = 1; i <= 5; i++) {
      t += 16;
      await g.moveTo(o + Offset(100 + i * 10.0, 200));
      await tester.pump(const Duration(milliseconds: 16));
    }
    final msg = b.sentExtra('collab.laser')! as Map;
    expect(msg['s'], greaterThanOrEqualTo(5));
    expect(msg['g'], [1]);
    expect((msg['p'] as List).take(2), [100, 200]);
    expect(find.byKey(const Key('collabLaser')), findsOneWidget);
    await g.up();
    await tester.pump();
    expect(b.editor.activeToolId, 'collab.laser', reason: 'bleibt aktiv');
    // a second stroke starts a new one
    final g2 = await tester.startGesture(o + const Offset(50, 50));
    await tester.pump();
    final m2 = b.sentExtra('collab.laser')! as Map;
    expect((m2['g'] as List).last, m2['s']);
    await g2.up();
    t += 1000;
    await tester.pump(const Duration(milliseconds: 1600));
    expect(b.sentExtra('collab.laser'), isNull);
    expect(find.byKey(const Key('collabLaser')), findsNothing);
  });

  testWidgets('fremde Spur erscheint und verblasst (auch in der Präsentation)', (tester) async {
    final b = await pumpP5(tester);
    b.ui.presenting.value = true;
    b.peers([
      peer(
        'a:jonas',
        'Jonas',
        extra: const {
          'collab.laser': {
            's': 3,
            'p': [10, 10, 40, 10, 80, 30],
            'g': [1],
          },
        },
      ),
    ]);
    await tester.pump();
    expect(find.byKey(const Key('collabLaser')), findsOneWidget);
    t += 950;
    await tester.pump(const Duration(milliseconds: 16));
    await tester.pump(const Duration(milliseconds: 16));
    expect(find.byKey(const Key('collabLaser')), findsNothing);
    b.ui.presenting.value = false;
  });
}
