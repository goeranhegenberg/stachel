// P5 Cursor-Chat (audit L18, L19): the others' messages at their pointer (typing), own short message from the board
// menu at the middle of the view (= the app's pointer for the others), 5 s after sending, then gone.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import '../follow/p5_harness.dart';

void main() {
  testWidgets('fremde Nachricht am Zeiger mit Namen und Tipp-Punkten', (tester) async {
    final b = await pumpP5(tester);
    b.peers([
      peer(
        'a:jonas',
        'Jonas',
        x: 100,
        y: 100,
        extra: const {
          'collab.chat': {'text': 'Hier!', 'typing': true},
        },
      ),
      peer(
        'a:lena',
        'Lena',
        id: 2,
        extra: const {
          'collab.chat': {'text': 'ohne Zeiger'},
        },
      ),
    ]);
    await tester.pump();
    expect(find.byKey(const ValueKey('collabChat-1')), findsOneWidget);
    expect(find.text('Jonas'), findsOneWidget);
    expect(find.text('Hier! …', findRichText: true), findsOneWidget);
    expect(find.text('ohne Zeiger', findRichText: true), findsNothing);
    final at = tester.getTopLeft(find.byKey(const ValueKey('collabChat-1')));
    expect(
      at - tester.getTopLeft(find.byType(BoardView)),
      b.cam.toScreen(const Offset(100, 100)) + const Offset(15, 17),
    );
  });

  testWidgets('eigene Kurznachricht: live beim Tippen, nach Senden 5 s stehen, dann weg; ✕ verwirft', (tester) async {
    final b = await pumpP5(tester);
    await boardMenu(tester, 'collabMenuChat');
    expect(find.byKey(const Key('collabChatInput')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('collabChatInput')), 'Pause?');
    await tester.pump();
    expect(b.sentExtra('collab.chat'), {'text': 'Pause?', 'typing': true});
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pump();
    expect(b.sentExtra('collab.chat'), {'text': 'Pause?'});
    expect(find.byKey(const Key('collabChatInput')), findsNothing);
    await tester.pump(const Duration(seconds: 5));
    expect(b.sentExtra('collab.chat'), isNull);

    await boardMenu(tester, 'collabMenuChat');
    await tester.enterText(find.byKey(const Key('collabChatInput')), 'doch nicht');
    await tester.pump();
    await tester.tap(find.byKey(const Key('collabChatCancel')));
    await tester.pump();
    expect(b.sentExtra('collab.chat'), isNull);
    expect(find.byKey(const Key('collabChatInput')), findsNothing);
  });
}
