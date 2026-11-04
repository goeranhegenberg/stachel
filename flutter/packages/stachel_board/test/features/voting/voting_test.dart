// P5 Abstimmung (audit L07–L11): start sheet, voting by tapping objects, bar, end after the time, result.
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

  final objects = [
    sticky('n1', 40, 200, text: 'Bühne'),
    sticky('n2', 200, 200, text: 'Zelt'),
    {'id': 'f1', 'type': 'frame', 'x': 0, 'y': 400, 'w': 300, 'h': 200, 'title': 'Rahmen', 'z': 'a0'},
  ];

  Map<String, Object?> session({
    String id = 'v1',
    String by = 'a:mara',
    int? endsAt,
    bool ended = false,
    bool multi = false,
    int per = 3,
    bool anonymous = false,
  }) => {
    'collab.vote': {
      'session': {
        'id': id,
        'title': 'Welche Bühne?',
        'perPerson': per,
        'multi': multi,
        'endsAt': endsAt,
        'startedBy': by,
        'startedByName': by == 'a:mara' ? 'Mara' : 'Jonas',
        'startedAt': 1,
        'ended': ended,
        'anonymous': anonymous,
      },
    },
  };

  testWidgets('Board-Menü „Abstimmung starten“: Blatt wie der Web-Dialog, Aktion mit den Einstellungen', (
    tester,
  ) async {
    final b = await pumpP5(tester, objects: objects);
    b.editor.select({'n1'});
    await boardMenu(tester, 'collabMenuVote');
    expect(find.byKey(const Key('collabVoteStart')), findsOneWidget);
    expect(find.text('Alle auf dem Board stimmen gleichzeitig ab, indem sie Objekte antippen.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('collabVoteTitle')), 'Welche Bühne?');
    await tester.tap(find.byKey(const Key('collabVoteLess')));
    await tester.pump();
    expect(find.text('2'), findsOneWidget);
    await tester.tap(find.byKey(const Key('collabVoteDur-0')));
    await tester.tap(find.byKey(const Key('collabVoteMulti')));
    await tester.tap(find.byKey(const Key('collabVoteAnonymous')));
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('collabVoteStartGo')));
    await tester.tap(find.byKey(const Key('collabVoteStartGo')));
    await tester.pump(const Duration(milliseconds: 400));
    expectAct(b.acts.last, 'collab.vote.start', {
      'title': 'Welche Bühne?',
      'perPerson': 2,
      'minutes': null,
      'multi': true,
      'anonymous': true,
    });
    expect(b.editor.selection.value, isEmpty, reason: 'wie das Web: Auswahl weg');
  });

  testWidgets('Stepper 1–20, Dauer 5 Min. vorgewählt', (tester) async {
    await pumpP5(tester, objects: objects);
    await boardMenu(tester, 'collabMenuVote');
    for (var i = 0; i < 20; i++) {
      await tester.tap(find.byKey(const Key('collabVoteMore')), warnIfMissed: false);
      await tester.pump();
    }
    await tester.pump();
    expect(find.text('20'), findsOneWidget);
    final more = tester.widget<IconButton>(find.byKey(const Key('collabVoteMore')));
    expect(more.onPressed, isNull);
    expect(tester.widget<ChoiceChip>(find.byKey(const Key('collabVoteDur-5'))).selected, isTrue);
  });

  testWidgets('Abstimmen: Objekt antippen gibt eine Stimme (sofort sichtbar), Rahmen nicht; Leiste mit Zeit', (
    tester,
  ) async {
    final b = await pumpP5(
      tester,
      objects: objects,
      ext: session(endsAt: now + 65000),
    );
    expect(find.byKey(const Key('collabVoteBar')), findsOneWidget);
    expect(find.text('Welche Bühne?'), findsOneWidget);
    expect(find.text('Objekte antippen zum Abstimmen · 0 dabei'), findsOneWidget);
    expect(find.text('1:05'), findsOneWidget);
    expect(find.byKey(const Key('collabVoteEnd')), findsOneWidget, reason: 'ich habe gestartet');
    // menu: running
    await tester.tap(find.byKey(const Key('stachelBoardMenu')));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Abstimmung läuft …'), findsOneWidget);
    await tester.tapAt(const Offset(5, 5));
    await tester.pump(const Duration(milliseconds: 400));

    final cam = b.cam;
    await tester.tapAt(cam.toScreen(const Offset(100, 260)) + tester.getTopLeft(find.byType(BoardView)));
    await tester.pump();
    expectAct(b.acts.last, 'collab.vote.cast', {'objectId': 'n1', 'delta': 1});
    expect(find.byKey(const ValueKey('collabVoteBadge-n1')), findsOneWidget, reason: 'sofort sichtbar');
    expect(b.editor.selection.value, isEmpty, reason: 'Abstimmen wählt nicht aus');
    // server: the vote is there, then the answer
    b.ack(
      ext: {
        'collab.votes': {
          'v1|a:mara|n1': {'n': 1, 'name': 'Mara Kern'},
        },
      },
      result: {
        'data': {'outcome': 'added', 'now': now},
      },
    );
    await tester.pump();
    expect(find.byKey(const ValueKey('collabVoteBadge-n1')), findsOneWidget);
    expect(find.text('Objekte antippen zum Abstimmen · 1 dabei'), findsOneWidget);
    // frame: not a target → selected as usual
    final n = b.acts.length;
    await tester.tapAt(cam.toScreen(const Offset(10, 410)) + tester.getTopLeft(find.byType(BoardView)));
    await tester.pump(const Duration(milliseconds: 400));
    expect(b.acts.length, n);
  });

  testWidgets('mehrere je Objekt: „−“ nimmt eine Stimme zurück; keine übrig: Hinweis des Servers', (tester) async {
    final b = await pumpP5(
      tester,
      objects: objects,
      ext: {
        ...session(multi: true, per: 2),
        'collab.votes': {
          'v1|a:mara|n1': {'n': 2, 'name': 'Mara Kern'},
        },
      },
    );
    expect(find.text('Alle Stimmen vergeben'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('collabVoteMinus-n1')));
    await tester.pump();
    expectAct(b.acts.last, 'collab.vote.cast', {'objectId': 'n1', 'delta': -1});
    b.ack(result: {'toast': 'Keine Stimmen mehr übrig – klick auf eine vergebene Stimme, um sie zurückzunehmen.'});
    await tester.pump();
    expect(b.hints.last, startsWith('Keine Stimmen mehr übrig'));
  });

  testWidgets('Zeit um: jeder Client beendet (einmal), danach öffnet das Ergebnis von selbst', (tester) async {
    final b = await pumpP5(
      tester,
      objects: objects,
      ext: session(endsAt: now + 1500, by: 'a:jonas'),
    );
    b.peers([peer('a:jonas', 'Jonas')]);
    await tester.pump();
    expect(find.byKey(const Key('collabVoteEnd')), findsNothing, reason: 'Jonas moderiert und ist da');
    now += 1600;
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    expect(b.acts.where((a) => a.$1 == 'collab.vote.end').length, 1);
    await tester.pump(const Duration(milliseconds: 600));
    expect(b.acts.where((a) => a.$1 == 'collab.vote.end').length, 1, reason: 'nur einmal');
    b.ack(
      ext: {
        ...session(endsAt: now, by: 'a:jonas', ended: true),
        'collab.votes': {
          'v1|a:jonas|n2': {'n': 2, 'name': 'Jonas'},
          'v1|a:mara|n2': {'n': 1, 'name': 'Mara Kern'},
          'v1|a:mara|n1': {'n': 1, 'name': 'Mara Kern'},
        },
      },
    );
    await tester.pump();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byKey(const Key('collabVoteResults')), findsOneWidget);
    expect(find.text('2 Personen · 4 Stimmen'), findsOneWidget);
    expect(find.text('Haftnotiz „Zelt“'), findsOneWidget);
    expect(find.text('Jonas, Mara Kern'), findsOneWidget);
    expect(find.byKey(const Key('collabVoteCloseResults')), findsNothing, reason: 'Jonas ist da');
    // totals at the objects, winner green
    expect(find.byKey(const ValueKey('collabVoteTotal-n2')), findsOneWidget);
    // tap a rank: closes, selects, flies there
    await tester.ensureVisible(find.byKey(const ValueKey('collabRank-n1')));
    await tester.tap(find.byKey(const ValueKey('collabRank-n1')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    expect(b.editor.selection.value, {'n1'});
    expect(find.byKey(const Key('collabVoteResults')), findsNothing);
    // Jonas leaves: everybody may close (takeover)
    b.peers(const []);
    await tester.pump();
    expect(find.byKey(const Key('collabVoteClose')), findsOneWidget);
    await tester.tap(find.byKey(const Key('collabVoteClose')));
    await tester.pump();
    expect(b.acts.last.$1, 'collab.vote.close');
  });

  testWidgets('Frühere Abstimmungen im Board-Menü; Ergebnis ohne Stimmen', (tester) async {
    await pumpP5(
      tester,
      objects: objects,
      ext: {
        'collab.voteHistory': [
          {
            'id': 'old',
            'title': 'Erste',
            'at': '2026-11-02T10:00:00Z',
            'voters': 1,
            'total': 1,
            'ranking': [
              {'objectId': 'n2', 'votes': 1, 'rank': 1},
            ],
          },
          {'id': 'older', 'title': 'Nullte', 'at': '2026-10-28T10:00:00Z', 'voters': 0, 'total': 0, 'ranking': []},
        ],
      },
    );
    await boardMenu(tester, 'collabMenuVoteHistory');
    expect(find.text('Erste'), findsOneWidget);
    expect(find.text('1 Person · 1 Stimme'), findsOneWidget);
    await tester.tap(find.byKey(const Key('collabVoteHistory')));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('28. Okt.'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('collabVoteOld-older')));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Es wurde keine Stimme abgegeben.'), findsOneWidget);
  });

  testWidgets('ohne Server-Aktion kein Menüeintrag', (tester) async {
    await pumpP5(tester, objects: objects, actions: const {});
    await tester.tap(find.byKey(const Key('stachelBoardMenu')));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byKey(const Key('collabMenuVote')), findsNothing);
    expect(find.byKey(const Key('collabMenuTimer')), findsNothing);
  });
}
