// P5 Anwesenheit (audit B03, L13–L16, L20, L02): avatars with status, follow, being followed, summon, status, author
// of a note, dragging a comment pin.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import 'p5_harness.dart';

void main() {
  var now = 1000000;
  setUp(() {
    now = 1000000;
    collabDeviceNow = () => now;
  });
  tearDown(() => collabDeviceNow = () => DateTime.now().millisecondsSinceEpoch);

  Finder inSheet(String text) => find.descendant(of: find.byKey(const Key('collabPeople')), matching: find.text(text));

  Offset board(WidgetTester tester, P5Board b, Offset world) =>
      b.cam.toScreen(world) + tester.getTopLeft(find.byType(BoardView));

  testWidgets('Avatare: vier + „+N“ + ich mit Status-Punkt, Liste mit Status und „folgt …“', (tester) async {
    final b = await pumpP5(tester);
    b.peers([
      peer('a:jonas', 'Jonas Weber', id: 1, extra: const {'collab.status': 'idle'}),
      peer('a:jonas', 'Jonas Weber', id: 2, client: 'app'),
      peer('a:lena', 'Lena', id: 3, extra: const {'collab.status': 'away'}),
      peer('a:tom', 'Tom', id: 4, extra: const {'collab.follow': 'a:mara'}),
      peer('a:ute', 'Ute', id: 5, extra: const {'collab.follow': 'a:tom'}),
      peer('a:max', 'Max', id: 6),
    ]);
    await tester.pump();
    expect(find.text('JW'), findsOneWidget);
    expect(find.text('LE'), findsOneWidget);
    expect(find.text('+1'), findsOneWidget);
    expect(find.text('MK'), findsOneWidget, reason: 'ich');
    expect(find.byKey(const ValueKey('collabDot-idle')), findsOneWidget);
    expect(find.byKey(const ValueKey('collabDot-away')), findsOneWidget);
    await tester.tap(find.byKey(const Key('collabAvatarMe')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(inSheet('Auf dem Board'), findsOneWidget);
    expect(inSheet('6'), findsOneWidget);
    expect(inSheet('Mara Kern (du)'), findsOneWidget);
    expect(inSheet('Tom folgt dir'), findsOneWidget);
    expect(inSheet('inaktiv'), findsOneWidget);
    expect(inSheet('gleich zurück'), findsOneWidget);
    expect(inSheet('folgt dir'), findsOneWidget);
    expect(inSheet('folgt Tom'), findsOneWidget);
    // status „Gleich zurück“ goes out
    await tester.tap(find.text('Gleich zurück'));
    await tester.pump();
    expect(b.sentExtra('collab.status'), 'away');
    expect(find.byKey(const ValueKey('collabDot-away')), findsNWidgets(4), reason: 'Lena und ich, Leiste und Liste');
  });

  testWidgets(
    'Folgen: Avatar antippen springt zum Ausschnitt und folgt ihm, Rahmen + „Du folgst …“, eigene Geste beendet',
    (tester) async {
      final b = await pumpP5(tester);
      b.peers([
        peer(
          'a:jonas',
          'Jonas',
          extra: const {
            'collab.viewport': {'x': 1000, 'y': 500, 'w': 780, 'h': 1340},
          },
        ),
      ]);
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('collabAvatar-a:jonas')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(b.sentExtra('collab.follow'), 'a:jonas');
      final size = b.view.viewSize;
      final want = Camera.fit(
        const Rect.fromLTWH(1000, 500, 780, 1340),
        size,
        padding: const FitPadding.all(0),
        maxZoomFit: maxZoom,
      );
      expect((b.cam.x - want.x).abs() < 0.5 && (b.cam.z - want.z).abs() < 1e-3, isTrue, reason: '${b.cam} vs $want');
      expect(find.byKey(const Key('collabFollowFrame')), findsOneWidget);
      expect(find.byKey(const Key('collabFollowing')), findsOneWidget);
      // their view moves → mine follows
      b.peers([
        peer(
          'a:jonas',
          'Jonas',
          extra: const {
            'collab.viewport': {'x': 3000, 'y': 500, 'w': 780, 'h': 1340},
          },
        ),
      ]);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      final want2 = Camera.fit(
        const Rect.fromLTWH(3000, 500, 780, 1340),
        size,
        padding: const FitPadding.all(0),
        maxZoomFit: maxZoom,
      );
      expect((b.cam.x - want2.x).abs() < 0.5, isTrue);
      // own touch on the board ends following
      await tester.tapAt(board(tester, b, b.cam.toWorld(const Offset(100, 300))));
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.byKey(const Key('collabFollowFrame')), findsNothing);
      expect(b.sentExtra('collab.follow'), isNull);
    },
  );

  testWidgets('Folgen: Person kurz weg → „Verbindung … kurz weg“, nach 12 s beendet mit Hinweis', (tester) async {
    final b = await pumpP5(tester);
    b.peers([peer('a:jonas', 'Jonas')]);
    await tester.pump();
    followPerson(b.ui, 'a:jonas');
    await tester.pump();
    b.peers(const []);
    await tester.pump();
    expect(find.byKey(const Key('collabFollowWaiting')), findsOneWidget);
    expect(find.textContaining('kurz weg – Folgen geht gleich weiter'), findsOneWidget);
    // back within the grace time: goes on
    await tester.pump(const Duration(seconds: 5));
    b.peers([peer('a:jonas', 'Jonas')]);
    await tester.pump(const Duration(seconds: 10));
    expect(find.byKey(const Key('collabFollowing')), findsOneWidget);
    b.peers(const []);
    await tester.pump(const Duration(seconds: 13));
    expect(find.byKey(const Key('collabFollowWaiting')), findsNothing);
    expect(b.hints.last, 'Jonas ist nicht mehr auf dem Board – Folgen beendet.');
  });

  testWidgets('Geführt werden: „Jonas folgt dir“ / „2 Personen folgen dir“', (tester) async {
    final b = await pumpP5(tester);
    b.peers([
      peer('a:jonas', 'Jonas', extra: const {'collab.follow': 'a:mara'}),
    ]);
    await tester.pump();
    expect(find.byKey(const Key('collabFollowers')), findsOneWidget);
    expect(find.text('Jonas folgt dir'), findsOneWidget);
    b.peers([
      peer('a:jonas', 'Jonas', extra: const {'collab.follow': 'a:mara'}),
      peer('a:lena', 'Lena', id: 2, extra: const {'collab.follow': 'a:mara'}),
    ]);
    await tester.pump();
    expect(find.textContaining('2 Personen', findRichText: true), findsOneWidget);
  });

  testWidgets('Alle zu mir holen senden (Board-Menü) und empfangen (nur frisch beim ersten Sehen)', (tester) async {
    final b = await pumpP5(tester);
    await tester.tap(find.byKey(const Key('stachelBoardMenu')));
    await tester.pump(const Duration(milliseconds: 400));
    final entry = tester.widget<ListTile>(
      find.ancestor(of: find.text('Alle zu mir holen'), matching: find.byType(ListTile)),
    );
    expect(entry.enabled, isFalse, reason: 'niemand da');
    await tester.tapAt(const Offset(5, 5));
    await tester.pump(const Duration(milliseconds: 400));
    // a stale call of someone already there when I come: ignored
    b.peers([
      peer(
        'a:jonas',
        'Jonas',
        extra: {
          'collab.summon': {
            'id': 'old1',
            'rect': {'x': 0, 'y': 0, 'w': 100, 'h': 100},
            'ts': now - 60000,
          },
        },
      ),
    ]);
    await tester.pump(const Duration(milliseconds: 600));
    expect(b.hints, isEmpty);
    final before = b.cam;
    // a new call: camera there, hint
    b.peers([
      peer(
        'a:jonas',
        'Jonas',
        extra: {
          'collab.summon': {
            'id': 'new1',
            'rect': {'x': 5000, 'y': 5000, 'w': 390, 'h': 600},
            'ts': now - 60000,
          },
        },
      ),
    ]);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    expect(b.hints.last, 'Jonas hat dich zu sich geholt.');
    expect(b.cam, isNot(before));
    expect(b.cam.toWorld(b.view.viewSize.center(Offset.zero)).dx, closeTo(5195, 1));
    // send
    await boardMenu(tester, 'collabMenuSummon');
    final s = b.sentExtra('collab.summon')! as Map;
    expect(s['id'], isA<String>());
    expect((s['rect'] as Map).keys, ['x', 'y', 'w', 'h']);
    expect(b.hints.last, 'Alle werden zu dir geholt.');
  });

  testWidgets('Status: aktiv, nach 2 Min. ohne Eingabe inaktiv, Berührung macht wieder aktiv, Hintergrund = inaktiv', (
    tester,
  ) async {
    final b = await pumpP5(tester);
    expect(b.sentExtra('collab.status'), 'active');
    now += 125000;
    await tester.pump(const Duration(seconds: 10));
    expect(b.sentExtra('collab.status'), 'idle');
    await tester.tapAt(const Offset(200, 400));
    await tester.pump(const Duration(milliseconds: 400));
    expect(b.sentExtra('collab.status'), 'active');
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    expect(b.sentExtra('collab.status'), 'idle');
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(b.sentExtra('collab.status'), 'active');
  });

  testWidgets('Autor einer gewählten Notiz: „von dir“ / „von Jonas“, nicht beim Schreiben', (tester) async {
    final b = await pumpP5(
      tester,
      objects: [
        sticky('n1', 40, 60, by: 'a:mara'),
        sticky('n2', 200, 60, by: 'a:jonas'),
        sticky('n3', 40, 300, by: 'a:wer'),
      ],
    );
    b.host.known = const [Person('a:wer', 'Wera')];
    b.editor.select({'n1'});
    await tester.pump();
    expect(find.text('von dir'), findsOneWidget);
    b.peers([peer('a:jonas', 'Jonas')]);
    b.editor.select({'n2'});
    await tester.pump();
    expect(find.text('von Jonas'), findsOneWidget);
    b.editor.select({'n3'});
    await tester.pump();
    await tester.pump();
    expect(find.text('von Wera'), findsOneWidget, reason: 'Liste des Servers (Host)');
    b.editor.select({'n1', 'n2'});
    await tester.pump();
    expect(find.byKey(const Key('collabNoteAuthor')), findsNothing);
  });

  testWidgets('Board-Einstellung „Autor:in an Haftnotizen zeigen“: Name an jeder Notiz im Bild (auch der eigene), '
      'nicht beim Schreiben, ohne „von …“ an der gewählten', (tester) async {
    final b = await pumpP5(
      tester,
      objects: [
        sticky('n1', 40, 60, by: 'a:mara'),
        sticky('n2', 200, 60, by: 'a:jonas'),
        sticky('n3', 40, 300, by: 'a:niemand'),
        sticky('n4', 40, 300, by: ''),
      ],
    );
    b.peers([peer('a:jonas', 'Jonas')]);
    await tester.pump();
    expect(find.byKey(const Key('collabNoteAuthors')), findsNothing, reason: 'aus = wie bisher');
    b.ext({
      'tools.settings': {'pattern': 'dots', 'authors': true},
    });
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const Key('collabNoteAuthor-n1')), findsOneWidget);
    expect(find.text('Mara Kern'), findsOneWidget, reason: 'eigene Notiz mit dem echten Namen');
    expect(find.text('Jonas'), findsOneWidget);
    expect(find.byKey(const Key('collabNoteAuthor-n3')), findsNothing, reason: 'unbekannte Person');
    expect(find.byKey(const Key('collabNoteAuthor-n4')), findsNothing, reason: 'ohne createdBy');
    // links unten in der Notiz
    final n1 = b.controller.state['n1']!;
    final note = b.cam.toScreen(Offset(n1.x, n1.y + n1.h));
    final r = tester.getRect(find.byKey(const Key('collabNoteAuthor-n1')));
    final overlay = tester.getTopLeft(find.byKey(const Key('collabNoteAuthors')));
    expect(r.left - overlay.dx, closeTo(note.dx, 1));
    expect(r.bottom - overlay.dy, closeTo(note.dy, 1));
    // gewählt: kein zusätzliches „von dir“
    b.editor.select({'n1'});
    await tester.pump();
    expect(find.byKey(const Key('collabNoteAuthor')), findsNothing);
    // beim Schreiben nicht an dieser Notiz
    expect(b.editor.startEditing('n2'), isTrue);
    await tester.pump();
    expect(find.byKey(const Key('collabNoteAuthor-n2')), findsNothing);
    expect(find.byKey(const Key('collabNoteAuthor-n1')), findsOneWidget);
    // wieder aus
    b.ext({
      'tools.settings': {'pattern': 'dots', 'authors': false},
    });
    await tester.pump();
    expect(find.byKey(const Key('collabNoteAuthors')), findsNothing);
  });

  testWidgets('Kommentar-Pin halten und ziehen = umhängen (Aktion), bleibt bis zur Antwort an der neuen Stelle', (
    tester,
  ) async {
    final b = await pumpP5(
      tester,
      objects: [sticky('n1', 200, 300)],
      ext: {
        'collab.comments': {
          't1': {
            'x': 60,
            'y': 100,
            'resolved': false,
            'createdBy': 'a:mara',
            'createdAt': '2026-11-02T10:00:00Z',
            'messages': [
              {'id': 'm1', 'by': 'a:mara', 'name': 'Mara', 'text': 'Strom?', 'at': '2026-11-02T10:00:00Z'},
            ],
          },
        },
      },
    );
    final pin = board(tester, b, const Offset(60, 100)) + const Offset(15, -15);
    final g = await tester.startGesture(pin);
    await tester.pump(const Duration(milliseconds: 350));
    for (var i = 1; i <= 10; i++) {
      await g.moveTo(pin + Offset(i * 20.0, i * 25.0));
      await tester.pump(const Duration(milliseconds: 16));
    }
    await g.up();
    await tester.pump();
    final act = b.acts.last;
    expect(act.$1, 'collab.commentMove');
    expect(act.$2['thread'], 't1');
    expect(act.$2['x'], closeTo(260, 0.01));
    expect(act.$2['y'], closeTo(350, 0.01));
    expect(act.$2['objectId'], 'n1');
    expect(b.editor.selection.value, isEmpty, reason: 'nichts gewählt oder verschoben');
    expect(b.ops.where((o) => o['op'] == 'update'), isEmpty);
    // a short tap still opens the thread (not dragged)
    b.ack(result: const {});
    await tester.pump();
  });
}

extension on P5Board {
  List<Map<String, Object?>> get ops => [
    for (final m in source.sent)
      if (m['t'] == 'ops') ...(m['ops'] as List).cast<Map<String, Object?>>(),
  ];
}
