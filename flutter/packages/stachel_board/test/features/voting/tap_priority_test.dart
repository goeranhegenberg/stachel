// Welle 2 merge: who gets a tap on the board – a running vote (P5) before a pick mode (format painter / „Link zu …“,
// P1) before the text taps (check boxes/links, P8) before the default selection.
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

  // a note with two check boxes (top left), a plain note, a frame (not votable)
  final todo = {
    'id': 'todo',
    'type': 'sticky',
    'x': 0,
    'y': 150,
    'w': 200,
    'h': 200,
    'fontSize': 24,
    'valign': 'top',
    'align': 'left',
    'text': 'Eins\nZwei',
    'content': {
      'type': 'doc',
      'content': [
        {
          'type': 'taskList',
          'content': [
            for (final t in ['Eins', 'Zwei'])
              {
                'type': 'taskItem',
                'attrs': {'checked': false},
                'content': [
                  {
                    'type': 'paragraph',
                    'content': [
                      {'type': 'text', 'text': t},
                    ],
                  },
                ],
              },
          ],
        },
      ],
    },
    'z': 'a0',
  };
  final objects = [
    todo,
    sticky('n2', 0, 400, text: 'Zelt'),
    {'id': 'f1', 'type': 'frame', 'x': 220, 'y': 400, 'w': 150, 'h': 150, 'title': 'Rahmen', 'z': 'a9'},
  ];
  const actions = {...p5Actions, 'richtext.toggleTask': 1, 'tools.copyStyle': 1, 'tools.pasteStyle': 1};
  final vote = {
    'collab.vote': {
      'session': {
        'id': 'v1',
        'title': 'Welche Bühne?',
        'perPerson': 3,
        'multi': true,
        'endsAt': now + 65000,
        'startedBy': 'a:mara',
        'startedByName': 'Mara',
        'startedAt': 1,
        'ended': false,
        'anonymous': false,
      },
    },
  };

  // the first check box of the todo note (left padding + half a box, like p8_ui_test); objects lie below the bars
  final pad = (200 * 0.09).roundToDouble();
  final box = Offset(pad + 10, 150 + pad + 14);

  Future<void> tapWorld(WidgetTester tester, P5Board b, Offset w) async {
    await tester.tapAt(b.cam.toScreen(w) + tester.getTopLeft(find.byType(BoardView)));
    await tester.pump(const Duration(milliseconds: 350));
  }

  testWidgets('ohne Abstimmung und Pinsel: Kästchen antippen hakt ab (P8)', (tester) async {
    final b = await pumpP5(tester, objects: objects, actions: actions);
    await tapWorld(tester, b, box);
    expectAct(b.acts.last, 'richtext.toggleTask', {'id': 'todo', 'index': 0});
  });

  testWidgets('laufende Abstimmung vor P8: Kästchen antippen = Stimme, kein Abhaken', (tester) async {
    final b = await pumpP5(tester, objects: objects, ext: vote, actions: actions);
    await tapWorld(tester, b, box);
    expect(b.acts.map((a) => a.$1), isNot(contains('richtext.toggleTask')));
    expectAct(b.acts.last, 'collab.vote.cast', {'objectId': 'todo', 'delta': 1});
  });

  testWidgets('Format-Pinsel vor P8: Kästchen antippen überträgt das Format', (tester) async {
    final b = await pumpP5(tester, objects: objects, actions: actions);
    ArrangeModes.of(b.ui).startPainter('n2');
    await tester.pump();
    await tapWorld(tester, b, box);
    expect(b.acts.map((a) => a.$1), isNot(contains('richtext.toggleTask')));
    expect(b.acts.last.$1, 'tools.pasteStyle');
    expect(b.acts.last.$2['ids'], ['todo']);
  });

  testWidgets('Abstimmung vor Format-Pinsel; nicht Abstimmbares (Rahmen) geht an den Pinsel', (tester) async {
    final b = await pumpP5(tester, objects: objects, ext: vote, actions: actions);
    ArrangeModes.of(b.ui).startPainter('todo');
    await tester.pump();
    await tapWorld(tester, b, const Offset(60, 460));
    expectAct(b.acts.last, 'collab.vote.cast', {'objectId': 'n2', 'delta': 1});
    // the frame cannot be voted on: the painter gets the tap
    await tapWorld(tester, b, const Offset(295, 500));
    expect(b.acts.last.$1, 'tools.pasteStyle');
    expect(b.acts.last.$2['ids'], ['f1']);
    expect(ArrangeModes.of(b.ui).painter.value, 'todo', reason: 'der Pinsel bleibt an');
    // painter off: the vote keeps its taps
    ArrangeModes.of(b.ui).stopPainter();
    expect(b.editor.voteTapInterceptor, isNotNull);
  });
}
