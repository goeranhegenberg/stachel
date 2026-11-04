// Native API v1 messages (concept §4.3): every server message parses, unknown ones do not break anything, and the
// app's messages have the documented shape. BoardController applies them.
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

void main() {
  group('Server → App', () {
    test('welcome mit Schnappschuss, Rolle, Person, Funktionen, Verlauf', () {
      final m = ServerMessage.parse({
        't': 'welcome',
        'proto': 1,
        'epoch': 'e7f',
        'rev': 4711,
        'user': {'key': 'm:12', 'name': 'Mara', 'isOrga': false},
        'role': 'view',
        'color': '#1763b5',
        'board': {'id': 'abc', 'title': 'Sommerfest 2027'},
        'below': ['frame'],
        'features': ['objects', 'comments', 'undo'],
        'snapshot': {
          'objects': [
            {'id': 'n1', 'type': 'sticky', 'text': 'Hi'},
          ],
          'ext': {
            'collab.comments': {'c1': {}},
          },
        },
        'peers': [
          {'id': 3, 'key': 'm:7', 'name': 'Jonas', 'color': '#ec4e92', 'client': 'web'},
        ],
        'history': {'canUndo': true, 'canRedo': false},
        'somethingNew': 1,
      });
      expect(m, isA<WelcomeMessage>());
      final w = m as WelcomeMessage;
      expect((w.proto, w.epoch, w.rev, w.info.role, w.info.color), (1, 'e7f', 4711, 'view', '#1763b5'));
      expect(w.info.user!.name, 'Mara');
      expect(w.info.boardTitle, 'Sommerfest 2027');
      expect(w.info.below, ['frame']);
      expect(w.info.features, contains('undo'));
      expect(w.snapshot.objects.single.text, 'Hi');
      expect(w.snapshot.ext.keys, ['collab.comments']);
      expect(w.info.peers.single.client, 'web');
      expect(w.info.canUndo, isTrue);
    });

    test('resumed, patch, ack, nack, history, presence, event, pong, error', () {
      final r = ServerMessage.parse({
        't': 'resumed',
        'rev': 4720,
        'patches': [
          {
            't': 'patch',
            'rev': 4712,
            'changes': [
              {'id': 'a', 'removed': true},
            ],
          },
        ],
      });
      expect(r, isA<ResumedMessage>().having((m) => m.patches.single.changes.single, 'change', isA<ObjectRemoved>()));
      final p =
          ServerMessage.parse({
                't': 'patch',
                'rev': 5,
                'by': 'm:7',
                'changes': [
                  {
                    'id': 'n',
                    'set': {'x': 40},
                    'unset': ['dash'],
                  },
                  {
                    'id': 't',
                    'created': {'type': 'text'},
                  },
                  {'id': 'x', 'removed': true},
                  {'kaputt': true},
                ],
                'ext': {'collab.votes': {}},
              })
              as PatchMessage;
      expect(p.by, 'm:7');
      expect(p.changes.map((c) => c.runtimeType), [ObjectUpdated, ObjectCreated, ObjectRemoved]);
      expect((p.changes.first as ObjectUpdated).unset, ['dash']);
      expect(p.ext.keys, ['collab.votes']);
      expect(
        ServerMessage.parse({'t': 'ack', 'req': 12, 'rev': 4712}),
        isA<AckMessage>().having((a) => a.rev, 'rev', 4712),
      );
      final n =
          ServerMessage.parse({'t': 'nack', 'req': 12, 'error': 'invalid_input', 'message': 'Nein', 'index': 3})
              as NackMessage;
      expect((n.req, n.error, n.message, n.index), (12, 'invalid_input', 'Nein', 3));
      expect(ServerMessage.parse({'t': 'history', 'canUndo': true}), isA<HistoryMessage>());
      final pr =
          ServerMessage.parse({
                't': 'presence',
                'peers': [
                  {
                    'id': 123,
                    'key': 'm:7',
                    'name': 'Jonas',
                    'color': '#ec4e92',
                    'cursor': {'x': 1, 'y': 2},
                    'selection': ['n'],
                    'editing': null,
                  },
                  {'kaputt': 1},
                ],
              })
              as PresenceMessage;
      expect(pr.peers.single.cursorX, 1);
      expect(pr.peers.single.selection, ['n']);
      final ev =
          ServerMessage.parse({'t': 'event', 'type': 'board.renamed', 'title': 'Neu', 'titleSeq': 5}) as EventMessage;
      expect((ev.type, ev.title, ev.titleSeq), ('board.renamed', 'Neu', 5));
      expect(ServerMessage.parse({'t': 'pong'}), isA<PongMessage>());
      final e = ServerMessage.parse({'t': 'error', 'error': 'upgrade_required', 'message': 'Bitte aktualisieren'});
      expect(e, isA<ErrorMessage>().having((x) => x.error, 'error', 'upgrade_required'));
    });

    test('Unbekanntes und Kaputtes wird zu UnknownMessage, nie zur Ausnahme', () {
      expect(
        ServerMessage.parse({'t': 'cursorChat', 'x': 1}),
        isA<UnknownMessage>().having((m) => m.t, 't', 'cursorChat'),
      );
      expect(ServerMessage.parse('quatsch'), isA<UnknownMessage>());
      expect(ServerMessage.parse({'t': 'welcome', 'snapshot': 'kaputt'}), isA<WelcomeMessage>());
      expect(ServerMessage.parse({'t': 'patch', 'changes': 'kaputt'}), isA<PatchMessage>());
    });
  });

  group('App → Server', () {
    test('hello mit und ohne Resume', () {
      expect(helloMessage(board: 'abc', app: '1.22.0+31'), {
        't': 'hello',
        'proto': 1,
        'board': 'abc',
        'app': '1.22.0+31',
        'want': ['objects', 'ext'],
      });
      expect(helloMessage(board: 'abc', app: 'x', resumeEpoch: 'e', resumeRev: 7)['resume'], {'epoch': 'e', 'rev': 7});
    });

    test('ops: create, update (null entfernt), remove, order, text mit Basis-Revision', () {
      final m = opsMessage(12, [
        const CreateOp([
          {'id': 'n', 'type': 'sticky'},
        ]),
        const UpdateOp({
          'n': {'x': 40, 'dash': null},
        }),
        const RemoveOp(['s']),
        const OrderOp(['n'], toFront: true),
        const TextOp('n', 4711, {'type': 'doc', 'content': []}),
      ]);
      expect(m['t'], 'ops');
      expect(m['req'], 12);
      final ops = m['ops'] as List;
      expect(ops.map((o) => (o as Map)['op']), ['create', 'update', 'remove', 'order', 'text']);
      expect((ops[1] as Map)['patches'], {
        'n': {'x': 40, 'dash': null},
      });
      expect((ops[3] as Map)['to'], 'front');
      expect((ops[4] as Map)['base'], 4711);
    });

    test('presence mit Ansicht', () {
      final p = presenceMessage(cursorX: 1, cursorY: 2, selection: ['a'], viewport: (x: 0, y: 0, w: 390, h: 800));
      expect(p['cursor'], {'x': 1.0, 'y': 2.0});
      expect(p['viewport'], {'x': 0.0, 'y': 0.0, 'w': 390.0, 'h': 800.0});
      expect(presenceMessage()['cursor'], isNull);
    });
  });

  group('BoardController mit FixtureBoardSource', () {
    test('welcome lädt, Patches ändern, Umbenennen nur mit neuerem titleSeq, Löschen merkt sich wer', () async {
      final source = FixtureBoardSource(
        BoardSnapshot.fromJson({
          'objects': [
            {'id': 'a', 'type': 'sticky', 'x': 0},
          ],
        }),
        rev: 3,
      );
      final c = BoardController(source);
      var notified = 0;
      c.addListener(() => notified++);
      await c.start();
      expect(c.loaded, isTrue);
      expect(c.lastChanged, isNull);
      expect(c.state['a'], isNotNull);
      expect(source.sent.first['t'], 'hello');

      source.push(
        PatchMessage.fromJson({
          't': 'patch',
          'rev': 4,
          'changes': [
            {
              'id': 'a',
              'set': {'x': 9},
            },
          ],
        }),
      );
      expect(c.state['a']!.x, 9);
      expect(c.lastChanged, {'a'});

      source.push(const EventMessage('board.renamed', {'title': 'Zwei', 'titleSeq': 2}));
      source.push(const EventMessage('board.renamed', {'title': 'Eins (alt)', 'titleSeq': 1}));
      expect(c.title, 'Zwei');

      source.push(const EventMessage('board.deleted', {'by': 'Lena'}));
      expect(c.deletedBy, 'Lena');
      expect(notified, 5, reason: 'Verbindung live, welcome, Patch, Umbenennen, Löschen');
      c.dispose();
    });

    test('resumed wendet nur fehlende Patches an', () async {
      final source = FixtureBoardSource(
        BoardSnapshot.fromJson({
          'objects': [
            {'id': 'a', 'type': 'sticky', 'x': 0},
          ],
        }),
        rev: 10,
      );
      final c = BoardController(source);
      await c.start();
      source.push(
        ResumedMessage.fromJson({
          'rev': 12,
          'patches': [
            {
              'rev': 9,
              'changes': [
                {
                  'id': 'a',
                  'set': {'x': -1},
                },
              ],
            },
            {
              'rev': 12,
              'changes': [
                {
                  'id': 'a',
                  'set': {'x': 5},
                },
              ],
            },
          ],
        }),
      );
      expect(c.state['a']!.x, 5);
      expect(c.state.rev, 12);
      c.dispose();
    });
  });
}
