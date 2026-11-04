// Presentation additions (docs/features/private.md §7): speaker notes per frame (frame list → sheet → `notes`, only the
// presenting person sees them over the bar) and the handover („Übergeben an …“ → `structure.handover`, the other one
// takes over with `structure.present.from`, the old presenter stops and follows, followers move on to the new one).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/view/view_camera.dart';

import '../view/p4_harness.dart';

const _frames = [
  {'id': 'f1', 'type': 'frame', 'x': 0, 'y': 0, 'w': 640, 'h': 420, 'title': 'Start', 'color': '#ffffff'},
  {
    'id': 'f2',
    'type': 'frame',
    'x': 800,
    'y': 30,
    'w': 640,
    'h': 420,
    'title': 'Mitte',
    'color': '#ffffff',
    'notes': 'Hier die Zahlen nennen.',
  },
];

Peer _peer(int id, String key, String name, {Map<String, Object?> extra = const {}}) =>
    Peer(id: id, key: key, name: name, color: '#ec4e92', extra: extra, client: 'web');

Future<P4Board> _pump(WidgetTester tester) async {
  final b = await pumpP4(tester, objects: _frames);
  b.controller
    ..user = const NativeUser(key: 'a:mara', name: 'Mara')
    ..clientId = 99;
  return b;
}

void main() {
  group('Sprechernotizen', () {
    testWidgets('Rahmen-Liste: Notiz-Knopf → Blatt → Speichern schreibt `notes`, leer entfernt', (tester) async {
      final b = await _pump(tester);
      b.ui.openRegisteredSheet(tester.element(find.byType(BoardView)), framesListSheet);
      await tester.pumpAndSettle();
      expect(
        tester.widget<IconButton>(find.byKey(const Key('stachelFrameNotes-f2'))).isSelected,
        isTrue,
        reason: 'f2 hat Notizen',
      );
      await tester.tap(find.byKey(const Key('stachelFrameNotes-f1')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelFrameNotesSheet')), findsOneWidget);
      await tester.enterText(find.byKey(const Key('stachelFrameNotesField')), 'Begrüßung, dann Agenda');
      await tester.tap(find.byKey(const Key('stachelFrameNotesSave')));
      await tester.pumpAndSettle();
      expect(b.ops.last, {
        'op': 'update',
        'patches': {
          'f1': {'notes': 'Begrüßung, dann Agenda'},
        },
      });
      expect(b.controller.state['f1']!.raw['notes'], 'Begrüßung, dann Agenda', reason: 'gleich sichtbar');
      await tester.tap(find.byKey(const Key('stachelFrameNotes-f2')));
      await tester.pumpAndSettle();
      expect(find.text('Hier die Zahlen nennen.'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('stachelFrameNotesField')), '   ');
      await tester.tap(find.byKey(const Key('stachelFrameNotesSave')));
      await tester.pumpAndSettle();
      expect(b.ops.last, {
        'op': 'update',
        'patches': {
          'f2': {'notes': null},
        },
      });
    });

    testWidgets('nur ansehen: Notiz-Knopf nur bei vorhandenen Notizen, Blatt ohne Speichern', (tester) async {
      final b = await pumpP4(tester, objects: _frames, role: 'view');
      b.ui.openRegisteredSheet(tester.element(find.byType(BoardView)), framesListSheet);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelFrameNotes-f1')), findsNothing);
      await tester.tap(find.byKey(const Key('stachelFrameNotes-f2')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelFrameNotesSave')), findsNothing);
    });

    testWidgets('beim Präsentieren: Notizen des aktuellen Rahmens aufklappbar über der Leiste', (tester) async {
      final b = await _pump(tester);
      Presentation.of(b.ui).start(0);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelPresentNotes')), findsNothing, reason: 'f1 ohne Notizen');
      await tester.tap(find.byKey(const Key('stachelPresentNext')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelPresentNotesText')), findsNothing, reason: 'zugeklappt');
      await tester.tap(find.byKey(const Key('stachelPresentNotes')));
      await tester.pumpAndSettle();
      expect(find.text('Hier die Zahlen nennen.'), findsOneWidget);
      final notes = tester.getRect(find.byKey(const Key('stachelPresentNotesPanel')));
      final row = tester.getRect(find.byKey(const Key('stachelPresentPos')));
      expect(notes.bottom, lessThanOrEqualTo(row.top), reason: 'über der Leiste');
      await tester.tap(find.byKey(const Key('stachelPresentNotes')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelPresentNotesText')), findsNothing);
      // nobody else gets the notes: the presence carries only frame, index, total, title
      expect(b.controller.presence.extra['structure.present'], {
        'frameId': 'f2',
        'index': 1,
        'total': 2,
        'title': 'Mitte',
      });
      Presentation.of(b.ui).stop();
      await tester.pumpAndSettle();
    });
  });

  group('Übergabe', () {
    testWidgets('„Übergeben an …“ → Angebot; die andere Person übernimmt → ich beende und folge ihr', (tester) async {
      final b = await _pump(tester);
      b.source.push(PresenceMessage([_peer(7, 'k:jonas', 'Jonas'), _peer(8, 'a:mara', 'Mara (Laptop)')]));
      await tester.pump();
      final p = Presentation.of(b.ui)..start(0);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('stachelPresentHandover')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelHandoverTo-a:mara')), findsNothing, reason: 'nicht ich selbst');
      await tester.tap(find.byKey(const Key('stachelHandoverTo-k:jonas')));
      await tester.pumpAndSettle();
      final offer = b.controller.presence.extra['structure.handover']! as Map;
      expect((offer['to'], offer['index'], offer['frameId']), ('k:jonas', 0, 'f1'));
      expect(offer['id'], matches(RegExp(r'^[A-Za-z0-9_-]{1,16}$')));
      expect(find.text('Angeboten an Jonas …'), findsOneWidget);
      // paging hands over the frame shown now
      await tester.tap(find.byKey(const Key('stachelPresentNext')));
      await tester.pumpAndSettle();
      final moved = b.controller.presence.extra['structure.handover']! as Map;
      expect((moved['id'], moved['index'], moved['frameId']), (offer['id'], 1, 'f2'));
      // withdraw and offer again
      await tester.tap(find.byKey(const Key('stachelPresentWithdraw')));
      await tester.pumpAndSettle();
      expect(b.controller.presence.extra.containsKey('structure.handover'), isFalse);
      await tester.tap(find.byKey(const Key('stachelPresentHandover')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('stachelHandoverTo-k:jonas')));
      await tester.pumpAndSettle();
      // Jonas presents with from = my client → I stop, the offer goes, I follow Jonas
      b.source.push(
        PresenceMessage([
          _peer(
            7,
            'k:jonas',
            'Jonas',
            extra: {
              'structure.present': {'frameId': 'f2', 'index': 1, 'total': 2, 'title': 'Mitte', 'from': 99},
            },
          ),
        ]),
      );
      await tester.pumpAndSettle();
      expect(p.running, isFalse);
      expect(b.ui.presenting.value, isFalse);
      expect(b.controller.presence.extra.containsKey('structure.handover'), isFalse);
      expect(b.controller.presence.extra.containsKey('structure.present'), isFalse);
      expect(p.following, 7);
      expect(find.text('Jonas präsentiert · 2/2 · Mitte'), findsOneWidget);
      expect(find.text('Nicht mehr folgen'), findsOneWidget);
    });

    testWidgets('Angebot an mich: Übernehmen präsentiert ab dem Rahmen mit `from`; Ablehnen schließt nur', (
      tester,
    ) async {
      final b = await _pump(tester);
      Peer jonas(String id) => _peer(
        7,
        'k:jonas',
        'Jonas',
        extra: {
          'structure.present': {'frameId': 'f2', 'index': 1, 'total': 2, 'title': 'Mitte'},
          'structure.handover': {'to': 'a:mara', 'id': id, 'index': 1, 'frameId': 'f2'},
        },
      );
      b.source.push(PresenceMessage([jonas('o1')]));
      await tester.pumpAndSettle();
      expect(find.text('Jonas möchte dir die Präsentation übergeben'), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelHandoverDecline')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelHandoverNotice')), findsNothing);
      expect(b.ui.presenting.value, isFalse);
      // a new offer (new id) shows again
      b.source.push(PresenceMessage([jonas('o2')]));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('stachelHandoverAccept')));
      await tester.pumpAndSettle();
      expect(b.ui.presenting.value, isTrue);
      expect(b.controller.presence.extra['structure.present'], {
        'frameId': 'f2',
        'index': 1,
        'total': 2,
        'title': 'Mitte',
        'from': 7,
      });
      expect(find.byKey(const Key('stachelHandoverNotice')), findsNothing);
      // an offer to somebody else is not shown
      Presentation.of(b.ui).stop();
      await tester.pumpAndSettle();
      b.source.push(
        PresenceMessage([
          _peer(
            7,
            'k:jonas',
            'Jonas',
            extra: {
              'structure.present': {'frameId': 'f2', 'index': 1, 'total': 2, 'title': 'Mitte'},
              'structure.handover': {'to': 'k:lea', 'id': 'o3', 'index': 1, 'frameId': 'f2'},
            },
          ),
        ]),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelHandoverNotice')), findsNothing);
    });

    testWidgets('wer der alten Person folgte, folgt der neuen', (tester) async {
      final b = await _pump(tester);
      Map<String, Object?> present(String frame, int i, [int? from]) => {
        'structure.present': {'frameId': frame, 'index': i, 'total': 2, 'title': 'T', 'from': ?from},
      };
      b.source.push(PresenceMessage([_peer(7, 'k:jonas', 'Jonas', extra: present('f1', 0))]));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('stachelFollowPresenterButton')));
      await tester.pumpAndSettle();
      expect(Presentation.of(b.ui).following, 7);
      // Lea takes over (both present for a moment) …
      b.source.push(
        PresenceMessage([
          _peer(7, 'k:jonas', 'Jonas', extra: present('f1', 0)),
          _peer(8, 'k:lea', 'Lea', extra: present('f2', 1, 7)),
        ]),
      );
      await tester.pumpAndSettle();
      expect(find.text('Jonas präsentiert · 1/2 · T'), findsOneWidget, reason: 'noch bei Jonas');
      // … Jonas stops
      b.source.push(
        PresenceMessage([_peer(7, 'k:jonas', 'Jonas'), _peer(8, 'k:lea', 'Lea', extra: present('f2', 1, 7))]),
      );
      await tester.pumpAndSettle();
      expect(Presentation.of(b.ui).following, 8);
      expect(find.text('Lea präsentiert · 2/2 · T'), findsOneWidget);
      expect(find.text('Nicht mehr folgen'), findsOneWidget);
      final f2 = b.controller.state['f2']!;
      expect(b.cam, closeCam(fitCamera(Rect.fromLTWH(f2.x, f2.y, f2.w, f2.h), b.view.viewSize, maxZoomFit: maxZoom)));
    });
  });
}
