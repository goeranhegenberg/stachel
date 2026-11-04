// E2 model: rich text editing on ProseMirror JSON (unknown marks/nodes survive), optimistic changes with ack/nack,
// queue and resend with the same req during a short network gap, coalesced drag updates, undo/redo, text op.
import 'dart:convert';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

Map<String, Object?> t(String text, [List<Map<String, Object?>> marks = const []]) => {
  'type': 'text',
  'text': text,
  if (marks.isNotEmpty) 'marks': marks,
};
Map<String, Object?> p(List<Map<String, Object?>> content) => {'type': 'paragraph', if (content.isNotEmpty) 'content': content};
Map<String, Object?> doc(List<Map<String, Object?>> content) => {'type': 'doc', 'content': content};
const bold = {'type': 'bold'};
const comment = {
  'type': 'comment',
  'attrs': {'id': 'c1', 'by': 'm:7'},
};

String canon(Object? v) => canonicalJson(v);

void main() {
  group('pmPlainText / effectivePmDoc', () {
    test('wie plainOf im Web: Textblöcke und Listeneinträge mit \\n, hardBreak = \\n, leere Absätze zählen', () {
      final d = doc([
        {
          'type': 'heading',
          'attrs': {'level': 1},
          'content': [t('Titel')],
        },
        p([t('a'), {'type': 'hardBreak'}, t('b')]),
        {
          'type': 'bulletList',
          'content': [
            {
              'type': 'listItem',
              'content': [p([t('eins')])],
            },
          ],
        },
        {'type': 'horizontalRule'},
        p([]),
      ]);
      expect(pmPlainText(d), 'Titel\na\nb\neins\n');
    });

    test('content gilt nur, wenn sein Klartext gleich text ist; sonst text als Absätze', () {
      final c = doc([p([t('Hallo', [bold])])]);
      expect(canon(effectivePmDoc(c, 'Hallo')), canon(c));
      expect(canon(effectivePmDoc(c, 'Hallo Welt\nZwei')), canon(doc([p([t('Hallo Welt')]), p([t('Zwei')])])));
      expect(canon(effectivePmDoc(null, '')), canon(doc([])));
    });
  });

  group('RichEditDoc', () {
    test('Tippen erbt die Marks des Zeichens davor, unbekannte Marks/Knoten/Attribute bleiben unangetastet', () {
      final start = doc([
        p([t('fett', [bold]), t(' und '), t('kommentiert', [comment])]),
        {
          'type': 'callout',
          'attrs': {'tone': 'warn'},
          'content': [p([t('Achtung')])],
        },
        {
          'type': 'mention',
          'attrs': {'id': 'm:7'},
        },
      ]);
      final d = RichEditDoc(start);
      expect(d.text, 'fett und kommentiert\nAchtung');
      expect(d.setText('fetter und kommentiert\nAchtung', caret: 6), isTrue);
      d.setText('fetter und kommentiert!\nAchtung');
      d.setText('fetter und kommentiert!\nAchtung!!');
      expect(d.setText('fetter und kommentiert!\nAchtung!!'), isFalse);
      expect(
        canon(d.toJson()),
        canon(
          doc([
            p([t('fetter', [bold]), t(' und '), t('kommentiert!', [comment])]),
            {
              'type': 'callout',
              'attrs': {'tone': 'warn'},
              'content': [p([t('Achtung!!')])],
            },
            {
              'type': 'mention',
              'attrs': {'id': 'm:7'},
            },
          ]),
        ),
      );
      expect(pmPlainText(d.toJson()), d.text);
      expect(start['content'], hasLength(3), reason: 'Original bleibt unverändert');
      expect(((start['content'] as List).first as Map)['content'], hasLength(3));
    });

    test('Enter teilt den Absatz, in Listen entsteht ein neuer Eintrag (Aufgabe unerledigt), im Code bleibt es Text', () {
      final d = RichEditDoc(
        doc([
          p([t('Eins zwei')]),
          {
            'type': 'taskList',
            'content': [
              {
                'type': 'taskItem',
                'attrs': {'checked': true},
                'content': [p([t('Zelte')])],
              },
            ],
          },
          {
            'type': 'codeBlock',
            'attrs': {'language': 'js'},
            'content': [t('a()')],
          },
        ]),
      );
      d.setText('Eins\nzwei\nZelte\na()');
      d.setText('Eins\nzwei\nZelte\n\na()', caret: 16);
      d.setText('Eins\nzwei\nZelte\nStrom\na()');
      d.setText('Eins\nzwei\nZelte\nStrom\na()\nb()');
      expect(
        canon(d.toJson()),
        canon(
          doc([
            p([t('Eins')]),
            p([t('zwei')]),
            {
              'type': 'taskList',
              'content': [
                {
                  'type': 'taskItem',
                  'attrs': {'checked': true},
                  'content': [p([t('Zelte')])],
                },
                {
                  'type': 'taskItem',
                  'attrs': {'checked': false},
                  'content': [p([t('Strom')])],
                },
              ],
            },
            {
              'type': 'codeBlock',
              'attrs': {'language': 'js'},
              'content': [t('a()\nb()')],
            },
          ]),
        ),
      );
      expect(pmPlainText(d.toJson()), d.text);
    });

    test('Rücktaste am Absatzanfang verbindet Absätze; leere Listen verschwinden; Überschrift am Ende → Absatz', () {
      final d = RichEditDoc(
        doc([
          {
            'type': 'heading',
            'attrs': {'level': 2},
            'content': [t('Titel', [bold])],
          },
          {
            'type': 'bulletList',
            'content': [
              {
                'type': 'listItem',
                'content': [p([t('weg')])],
              },
            ],
          },
          p([t('Ende')]),
        ]),
      );
      d.setText('Titel\nEnde'); // „weg“ und ein Trenner gelöscht
      expect(
        canon(d.toJson()),
        canon(
          doc([
            {
              'type': 'heading',
              'attrs': {'level': 2},
              'content': [t('Titel', [bold])],
            },
            p([t('Ende')]),
          ]),
        ),
      );
      d.setText('TitelEnde');
      expect(canon(d.toJson()), canon(doc([{'type': 'heading', 'attrs': {'level': 2}, 'content': [t('Titel', [bold]), t('Ende')]}])));
      d.setText('TitelEnde\n');
      expect((d.toJson()['content'] as List).last, {'type': 'paragraph'});
      expect(d.text, 'TitelEnde\n');
    });

    test('hardBreak bleibt ein Umbruch im Block; Links enden an ihrem Ende; leeres Dokument bekommt einen Absatz', () {
      final link = {
        'type': 'link',
        'attrs': {'href': 'https://beispiel.org'},
      };
      final d = RichEditDoc(doc([p([t('Link', [link]), {'type': 'hardBreak'}, t('x')])]));
      expect(d.text, 'Link\nx');
      d.setText('Links\nx');
      expect(canon(d.toJson()), canon(doc([p([t('Link', [link]), t('s'), {'type': 'hardBreak'}, t('x')])])));
      final e = RichEditDoc(doc([]));
      expect(e.text, '');
      e.setText('Neu');
      expect(canon(e.toJson()), canon(doc([p([t('Neu')])])));
    });

    test('Zufall: nach beliebigen Änderungen ist der Klartext des JSON immer der Editor-Text', () {
      var seed = 11;
      int rnd(int n) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
      const alphabet = 'ab \n';
      for (var round = 0; round < 200; round++) {
        final d = RichEditDoc.forObject(
          doc([
            p([t('Hallo', [bold]), t(' Welt')]),
            {
              'type': 'bulletList',
              'content': [
                {
                  'type': 'listItem',
                  'content': [p([t('eins')])],
                },
                {
                  'type': 'listItem',
                  'content': [p([t('zwei', [comment])])],
                },
              ],
            },
          ]),
          'Hallo Welt\neins\nzwei',
        );
        for (var k = 0; k < 6; k++) {
          final s = d.text;
          final at = rnd(s.length + 1);
          final del = rnd(4).clamp(0, s.length - at);
          final ins = String.fromCharCodes(List.generate(rnd(3), (_) => alphabet.codeUnitAt(rnd(alphabet.length))));
          final next = s.substring(0, at) + ins + s.substring(at + del);
          d.setText(next, caret: at + ins.length);
          expect(d.text, next);
          expect(pmPlainText(d.toJson()), next, reason: jsonEncode(d.toJson()));
        }
      }
    });

    test('mapCaret: Schreibmarke bleibt bei fremden Änderungen davor/dahinter an ihrer Stelle', () {
      expect(mapCaret('Hallo Welt', 'Oh, Hallo Welt', 5), 9);
      expect(mapCaret('Hallo Welt', 'Hallo Welt!', 5), 5);
      expect(mapCaret('Hallo Welt', 'Hallo Leute', 8), 11);
    });
  });

  group('BoardController: optimistisch, ack/nack, Warteschlange', () {
    late FixtureBoardSource source;
    late BoardController c;
    final notices = <BoardNotice>[];

    setUp(() async {
      notices.clear();
      source = FixtureBoardSource(
        BoardSnapshot.fromJson({
          'objects': [
            {'id': 'a', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'A', 'z': 'a0'},
            {'id': 'b', 'type': 'shape', 'x': 300, 'y': 0, 'w': 100, 'h': 100, 'z': 'a1', 'myorg.taskId': 7},
          ],
        }),
        rev: 10,
      );
      c = BoardController(source, sendInterval: const Duration(milliseconds: 20));
      c.notices.listen(notices.add);
      await c.start();
    });
    tearDown(() => c.dispose());

    List<Map<String, Object?>> ops() => [for (final m in source.sent) if (m['t'] == 'ops') m];

    test('Änderung gilt sofort, geht mit req raus, Server-Patch + ack übernehmen den Server-Stand', () async {
      c.apply([
        const UpdateOp({
          'a': {'x': 40, 'color': '#c9e14a'},
        }),
      ]);
      expect(c.state['a']!.x, 40);
      expect(c.confirmed['a']!.x, 0);
      final sent = ops().single;
      expect(sent['ops'], [
        {
          'op': 'update',
          'patches': {
            'a': {'x': 40, 'color': '#c9e14a'},
          },
        },
      ]);
      expect(source.sent.last, {'t': 'step'});
      final req = sent['req'] as int;
      expect(req, greaterThan(1700000000000), reason: 'req zeitbasiert, über App-Starts hinweg steigend');
      // fremde Änderung an einem anderen Feld vor dem ack: bleibt, eigene bleibt sichtbar
      source.push(PatchMessage(rev: 11, by: 'm:7', changes: [ObjectUpdated('a', const {'text': 'Web'}, const [])]));
      expect(c.state['a']!.text, 'Web');
      expect(c.state['a']!.x, 40);
      source.push(PatchMessage(rev: 12, by: 'me', changes: [ObjectUpdated('a', const {'x': 40, 'color': '#c9e14a'}, const [])]));
      source.push(AckMessage(req, 12));
      expect(c.pendingCount, 0);
      expect(c.state['a']!.raw, c.confirmed['a']!.raw);
      expect(c.state['b']!.raw['myorg.taskId'], 7, reason: 'unbekannte Felder bleiben');
    });

    test('nack nimmt die Änderung zurück und meldet sie; angelegtes Objekt verschwindet wieder', () async {
      c.apply([
        const CreateOp([
          {'id': 'n1', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': ''},
        ]),
      ]);
      expect(c.state['n1'], isNotNull);
      expect(c.state.ordered.last.id, 'n1', reason: 'neu liegt oben');
      source.push(NackMessage(ops().last['req'] as int, 'invalid_input', 'Ungültiger Wert'));
      expect(c.state['n1'], isNull);
      await Future<void>.delayed(Duration.zero);
      expect(notices.single.kind, 'rejected');
      expect(notices.single.ids, ['n1']);
    });

    test('Funkloch: Änderungen warten, gehen nach dem Wiederverbinden mit derselben req raus; ack für Bekanntes', () async {
      c.apply([
        const UpdateOp({
          'a': {'x': 1},
        }),
      ]);
      final first = ops().single['req'];
      source.drop();
      expect(c.canEdit, isTrue, reason: 'kurz offline: weiter bearbeiten');
      c.apply([
        const RemoveOp(['b']),
      ]);
      expect(c.state['b'], isNull);
      expect(ops(), hasLength(1), reason: 'offline nichts gesendet');
      expect(c.queuedCount, 2);
      source.sent.clear();
      await source.open(); // welcome: Server-Stand ohne die Änderungen, die Warteschlange liegt wieder darüber
      expect(c.state['a']!.x, 1);
      expect(c.state['b'], isNull);
      expect([for (final m in ops()) m['req']], [first, isNot(first)]);
      expect(c.queuedCount, 0);
      for (final m in ops()) {
        source.push(AckMessage(m['req'] as int, 13));
      }
      expect(c.pendingCount, 0);
    });

    test('offline ohne Zeitgrenze wie im Web; mit Offline-Fenster pausiert das Bearbeiten; Rolle ohne Schreibrecht nie', () async {
      final open = BoardController(FixtureBoardSource(BoardSnapshot.fromJson(const {'objects': []})));
      await open.start();
      (open.source as FixtureBoardSource).drop();
      expect(open.canEdit, isTrue, reason: 'Abnahme O01: kein 2-Minuten-Fenster mehr');
      open.dispose();
      final short = BoardController(source, offlineEditWindow: Duration.zero);
      await short.start();
      expect(short.canEdit, isTrue);
      source.drop();
      expect(short.canEdit, isFalse);
      short.dispose();
    });

    test('Ziehen: Zwischenstände werden zusammengefasst (eine req, ≤ 15/s), das Ende schließt den Schritt', () async {
      for (var i = 1; i <= 5; i++) {
        c.apply([
          UpdateOp({
            'a': {'x': i * 10},
          }),
        ], step: false, coalesce: 'move');
      }
      expect(c.state['a']!.x, 50);
      expect(ops(), isEmpty, reason: 'gedrosselt');
      await Future<void>.delayed(const Duration(milliseconds: 40));
      expect(ops(), hasLength(1));
      expect(source.sent.last['t'], 'ops', reason: 'mitten in der Geste kein step');
      c.apply([
        const UpdateOp({
          'a': {'x': 60},
        }),
      ], coalesce: 'move');
      expect(ops(), hasLength(2));
      expect(source.sent.last, {'t': 'step'});
    });

    test('schon gesendeter Zwischenstand wird nach einem Abriss nicht ersetzt (der Server kennt die req evtl.)', () async {
      c.apply([
        const UpdateOp({
          'a': {'x': 10},
        }),
      ], step: false, coalesce: 'move');
      await Future<void>.delayed(const Duration(milliseconds: 40));
      final first = ops().single['req'];
      source.drop();
      c.apply([
        const UpdateOp({
          'a': {'x': 20},
        }),
      ], coalesce: 'move');
      source.sent.clear();
      await source.open();
      expect([for (final m in ops()) m['req']], [first, isNot(first)], reason: 'beide req, die neue mit x 20');
      expect((((ops().last['ops'] as List).single as Map)['patches'] as Map)['a'], {'x': 20});
    });

    test('Rückgängig/Wiederholen gehen mit req raus; nothing schaltet den Knopf ab; history vom Server gilt', () async {
      c.apply([
        const UpdateOp({
          'a': {'x': 5},
        }),
      ]);
      expect(c.canUndo, isTrue);
      c.undo();
      final undo = source.sent.lastWhere((m) => m['t'] == 'undo');
      source.push(const HistoryMessage(false, true));
      expect(c.canUndo, isFalse);
      expect(c.canRedo, isTrue);
      c.redo();
      final redo = source.sent.lastWhere((m) => m['t'] == 'redo');
      expect(redo['req'], greaterThan(undo['req'] as int));
      source.push(NackMessage(redo['req'] as int, 'nothing', 'Nichts zum Wiederholen.'));
      expect(c.canRedo, isFalse);
    });

    test('text-Op: Klartext-Spiegel sofort, conflict im ack wird gemeldet', () async {
      final d = RichEditDoc.forObject(null, 'A')..setText('A und B');
      c.apply([TextOp('a', c.confirmed.rev, d.toJson(), epoch: c.confirmed.epoch, baseDoc: textToPmDoc('A'))]);
      expect(c.state['a']!.text, 'A und B');
      expect(c.state['a']!.richText!.plainText, 'A und B');
      final m = ops().single;
      expect((m['ops'] as List).single, {
        'op': 'text',
        'id': 'a',
        'base': 10,
        'doc': d.toJson(),
        'epoch': 'fixture',
        'baseDoc': textToPmDoc('A'),
      });
      expect(c.hasPending('a', textOnly: true), isTrue);
      source.push(AckMessage(m['req'] as int, 11, const ['a']));
      await Future<void>.delayed(Duration.zero);
      expect(notices.single.kind, 'conflict');
      expect(c.hasPending('a'), isFalse);
    });

    test('Ebene nach vorne/hinten sofort sichtbar (vorläufige Schlüssel)', () {
      c.apply([
        const OrderOp(['a'], toFront: true),
      ]);
      expect(c.state.ordered.last.id, 'a');
      c.apply([
        const OrderOp(['a'], toFront: false),
      ]);
      expect(c.state.ordered.first.id, 'a');
    });

    test('Anwesenheit: editing geht sofort raus', () async {
      c.presence.update(viewport: const Rect.fromLTWH(0, 0, 100, 100));
      await Future<void>.delayed(const Duration(milliseconds: 300));
      c.presence.editing = 'a';
      expect(source.sent.lastWhere((m) => m['t'] == 'presence')['editing'], 'a');
      c.presence.editing = null;
      expect(source.sent.lastWhere((m) => m['t'] == 'presence')['editing'], isNull);
    });
  });

  test('neue IDs: 21 Zeichen aus [A-Za-z0-9_-], verschieden', () {
    final ids = {for (var i = 0; i < 1000; i++) BoardController.newId()};
    expect(ids, hasLength(1000));
    expect(ids.every((id) => RegExp(r'^[A-Za-z0-9_-]{21}$').hasMatch(id)), isTrue);
  });
}

