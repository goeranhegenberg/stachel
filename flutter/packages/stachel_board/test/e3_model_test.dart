// E3 model: comments/reactions/mentions from `ext` (like web/src/features/collab), optimistic ext ops, persisted queue
// (survives leaving the board and an app kill), rich-text formatting on ranges, pen/connector/frame helpers.
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

Map<String, Object?> _t(String text, [List<Map<String, Object?>> marks = const []]) => {
  'type': 'text',
  'text': text,
  if (marks.isNotEmpty) 'marks': marks,
};
Map<String, Object?> _p(List<Map<String, Object?>> c) => {'type': 'paragraph', if (c.isNotEmpty) 'content': c};
Map<String, Object?> _doc(List<Map<String, Object?>> c) => {'type': 'doc', 'content': c};

const _people = [Person('m:1', 'Mara Lindner'), Person('m:2', 'Jonas'), Person('m:3', 'Jo'), Person('m:4', 'Lena')];

Map<String, Object?> _thread({bool resolved = false, String? objectId, List<Map<String, Object?>>? messages}) => {
  'x': 10,
  'y': 20,
  'objectId': ?objectId,
  if (objectId != null) ...{'dx': 500, 'dy': 5},
  'resolved': resolved,
  'createdBy': 'm:1',
  'createdAt': '2026-11-01T10:00:00.000Z',
  'messages':
      messages ??
      [
        {'id': 'a', 'by': 'm:1', 'name': 'Mara', 'text': 'Hallo @Jonas', 'at': '2026-11-01T10:00:00.000Z', 'mentions': ['m:2']},
      ],
};

void main() {
  group('Kommentare, Reaktionen, Erwähnungen (wie das Web-Modul collab)', () {
    test('readThreads: tolerant, Position folgt dem Objekt (Abstand auf die Größe begrenzt)', () {
      final threads = readThreads({
        't1': _thread(objectId: 'n1'),
        'kaputt': {'messages': 'x'},
        'leer': _thread(messages: []),
        't2': _thread(resolved: true),
      });
      expect(threads.map((t) => t.id), ['t1', 't2']);
      final t1 = threads.first;
      expect(t1.messages.single.mentions, ['m:2']);
      final note = BoardObject({'id': 'n1', 'type': 'sticky', 'x': 100, 'y': 100, 'w': 200, 'h': 200});
      expect(t1.position((id) => id == 'n1' ? note : null), const Offset(300, 105));
      expect(t1.position((_) => null), const Offset(10, 20), reason: 'Objekt weg: gespeicherte Stelle');
      expect(threads[1].resolved, isTrue);
    });

    test('unreadMentions: nur fremde Nachrichten nach dem Gelesen-Stand, neueste zuerst', () {
      final threads = readThreads({
        't1': _thread(
          messages: [
            {'id': 'a', 'by': 'm:1', 'name': 'Mara', 'text': '@Jonas eins', 'at': '2026-11-01T10:00:00.000Z', 'mentions': ['m:2']},
            {'id': 'b', 'by': 'm:2', 'name': 'Jonas', 'text': 'ich selbst @Jonas', 'at': '2026-11-01T11:00:00.000Z', 'mentions': ['m:2']},
            {'id': 'c', 'by': 'm:4', 'name': 'Lena', 'text': '@Jonas zwei', 'at': '2026-11-01T12:00:00.000Z', 'mentions': ['m:2']},
          ],
        ),
      });
      expect(unreadMentions(threads, 'm:2', null).map((x) => x.$2.id), ['c', 'a']);
      expect(unreadMentions(threads, 'm:2', '2026-11-01T10:30:00.000Z').map((x) => x.$2.id), ['c']);
      expect(readStateOf({'collab.reads': {'m:2': 'x'}}, 'm:2'), 'x');
    });

    test('reactionsByObject: Reihenfolge der ersten Reaktion, eigene markiert; peopleText', () {
      final r = reactionsByObject({
        'n1|👍|m:2': {'o': 'n1', 'e': '👍', 'u': 'm:2', 'n': 'Jonas', 'at': '2026-11-01T10:00:02Z'},
        'n1|🎉|m:1': {'o': 'n1', 'e': '🎉', 'u': 'm:1', 'n': 'Mara', 'at': '2026-11-01T10:00:01Z'},
        'n1|👍|m:1': {'o': 'n1', 'e': '👍', 'u': 'm:1', 'n': 'Mara', 'at': '2026-11-01T10:00:03Z'},
        'kaputt': 'x',
      }, 'm:1');
      expect(r['n1']!.map((g) => g.emoji), ['🎉', '👍']);
      expect(r['n1']![1].people.map((p) => p.name), ['Jonas', 'Mara']);
      expect(r['n1']![1].mine, isTrue);
      expect(peopleText(r['n1']![1].people, 'm:1'), 'Jonas und du');
      expect(peopleText(const [Person('a', 'A'), Person('b', 'B'), Person('c', 'C')], 'x'), 'A, B und C');
    });

    test('@Erwähnungen wie mentions.ts: Eingabe erkennen, Vorschläge, einsetzen, längster Name, Wortgrenze', () {
      expect(mentionQuery('Hallo @Ma', 9), (start: 6, query: 'Ma'));
      expect(mentionQuery('mail@host', 9), isNull, reason: 'kein Wortanfang');
      expect(mentionQuery('a @b\nc', 6), isNull);
      expect(matchPeople(_people, 'jo').map((p) => p.name), ['Jo', 'Jonas']);
      expect(matchPeople(_people, 'lind').map((p) => p.name), ['Mara Lindner']);
      expect(mentionDone('Lena ', _people), isTrue);
      final ins = insertMention('Hallo @Ma und', 6, 9, 'Mara Lindner');
      expect(ins, (text: 'Hallo @Mara Lindner und', caret: 20));
      expect(extractMentions('@Jonas und @Jo, @Mara Lindner! @Lenas', _people), ['m:2', 'm:3', 'm:1']);
      expect(splitMentions('Hi @Jo!', _people), [(text: 'Hi ', key: null), (text: '@Jo', key: 'm:3'), (text: '!', key: null)]);
      final hit = BoardObject({'id': 'n1', 'type': 'sticky', 'x': 100, 'y': 100, 'w': 200, 'h': 200});
      expect(commentAnchor(const Offset(150.4, 120.6), hit), (x: 150.0, y: 121.0, objectId: 'n1', dx: 50.0, dy: 21.0));
      expect(commentAnchor(const Offset(5, 5), BoardObject({'id': 'c', 'type': 'connector'})).objectId, isNull);
    });
  });

  group('optimistische ext-Ops (wie der Server sie ausführt)', () {
    const me = 'm:1', name = 'Mara', now = '2026-11-01T12:00:00.000Z';
    Map<String, Object?> run(BoardOp op, Map<String, Object?> ext) => applyExtOp(op as ExtOp, ext, me: me, name: name, now: now);

    test('Thread anlegen (Wiederholung ändert nichts), antworten öffnet wieder, bearbeiten/löschen nur Eigenes', () {
      var ext = run(const CommentOp('t1', 'a', CommentAnchor(1, 2, objectId: 'n1', dx: 3, dy: 4), 'Hi @Jonas', mentions: ['m:2']), const {});
      final t = (ext[commentsExt]! as Map)['t1'] as Map;
      expect(t['objectId'], 'n1');
      expect((t['messages'] as List).single, {'id': 'a', 'by': me, 'name': name, 'text': 'Hi @Jonas', 'at': now, 'mentions': ['m:2']});
      expect(identical(run(const CommentOp('t1', 'x', CommentAnchor(0, 0), 'anders'), ext), ext), isTrue);
      ext = run(const ResolveOp('t1', resolved: true), ext);
      expect(readThreads(ext[commentsExt]).single.resolvedBy, me);
      ext = run(const ReplyOp('t1', 'b', 'Antwort'), ext);
      expect(readThreads(ext[commentsExt]).single.resolved, isFalse);
      // fremde Nachricht
      ext = {
        ...ext,
        commentsExt: {
          ...(ext[commentsExt]! as Map).cast<String, Object?>(),
          't2': _thread(messages: [
            {'id': 'f', 'by': 'm:9', 'name': 'X', 'text': 'fremd', 'at': now},
          ]),
        },
      };
      expect(identical(run(const CommentDeleteOp('t2'), ext), ext), isTrue);
      ext = run(const CommentEditOp('t2', 'f', 'gehackt'), ext);
      expect(readThreads(ext[commentsExt]).firstWhere((t) => t.id == 't2').messages.single.text, 'fremd');
      ext = run(const CommentEditOp('t1', 'b', 'Antwort 2', mentions: ['m:4']), ext);
      final b = readThreads(ext[commentsExt]).first.messages[1];
      expect((b.text, b.edited), ('Antwort 2', now));
      expect(b.mentions, ['m:4']);
      ext = run(const CommentDeleteOp('t1', 'b'), ext);
      expect(readThreads(ext[commentsExt]).first.messages, hasLength(1));
      ext = run(const CommentDeleteOp('t1'), ext);
      expect(readThreads(ext[commentsExt]).map((t) => t.id), ['t2']);
    });

    test('Reaktionen an/aus, Gelesen-Stand nur vorwärts', () {
      var ext = run(const ReactOp(['n1', 'n2'], '👍', on: true), const {});
      expect((ext[reactionsExt]! as Map).keys, ['n1|👍|m:1', 'n2|👍|m:1']);
      ext = run(const ReactOp(['n1'], '👍', on: false), ext);
      expect((ext[reactionsExt]! as Map).keys, ['n2|👍|m:1']);
      ext = run(const MentionsReadOp('2026-11-01T11:00:00.000Z'), ext);
      expect(identical(run(const MentionsReadOp('2026-11-01T10:00:00.000Z'), ext), ext), isTrue);
    });
  });

  group('Warteschlange auf dem Gerät (E3)', () {
    final snap = BoardSnapshot.fromJson({
      'objects': [
        {'id': 'n1', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'z': 'a0', 'text': ''},
      ],
    });

    test('jede Op hin und zurück (JSON), kaputte Einträge fallen weg', () {
      final ops = <BoardOp>[
        const CreateOp([
          {'id': 'x', 'type': 'sticky', 'x': 1, 'y': 2, 'w': 3, 'h': 4},
        ]),
        const UpdateOp({
          'n1': {'x': 5, 'dash': null},
        }),
        const RemoveOp(['a']),
        const OrderOp(['a'], toFront: false),
        TextOp('n1', 7, _doc([_p([_t('a')])]), epoch: 'e', baseDoc: _doc([])),
        const CommentOp('t', 'm', CommentAnchor(1, 2, objectId: 'n1', dx: 3, dy: 4), 'hi', mentions: ['m:2']),
        const ReplyOp('t', 'm2', 'r'),
        const CommentEditOp('t', 'm2', 'e'),
        const CommentDeleteOp('t', 'm2'),
        const ResolveOp('t', resolved: true),
        const ReactOp(['n1'], '🎉', on: true),
        const MentionsReadOp('2026-11-01T10:00:00.000Z'),
      ];
      for (final op in ops) {
        expect(boardOpFromJson(op.toJson())!.toJson(), op.toJson());
      }
      final e = PendingEntry.ops(42, ops, step: false);
      final back = PendingEntry.fromJson(e.toJson())!;
      expect(back.req, 42);
      expect(back.step, isFalse);
      expect(back.sentOnce, isTrue, reason: 'vielleicht schon gesendet: nie zusammenfassen');
      expect(back.message, e.message);
      expect(PendingEntry.fromJson({'req': 1, 'ops': [{'op': 'quatsch'}]}), isNull);
    });

    test('offline geändert, Board verlassen → beim nächsten Öffnen gezeigt und mit derselben req gesendet; alte verfallen', () async {
      final store = MemoryPendingStore();
      final s1 = FixtureBoardSource(snap);
      final c1 = BoardController(s1, boardId: 'b', pendingStore: store, offlineEditWindow: const Duration(minutes: 5));
      await c1.start();
      await pumpEventQueue();
      s1.drop();
      c1.apply([
        const UpdateOp({
          'n1': {'x': 40},
        }),
      ]);
      c1.apply([const CommentOp('t1', 'm1', CommentAnchor(0, 0), 'offline geschrieben')]);
      c1.undo(); // Verlauf des Servers: wird nicht gespeichert
      await c1.persistPending();
      final saved = store.saved['b']!;
      expect(saved, hasLength(2));
      c1.dispose();

      // nächstes Öffnen (neuer Controller, z. B. nach App-Neustart)
      final s2 = FixtureBoardSource(snap);
      final c2 = BoardController(s2, boardId: 'b', pendingStore: store);
      await c2.start();
      await pumpEventQueue();
      expect(c2.state['n1']!.x, 40, reason: 'eigene Änderung gleich wieder sichtbar');
      expect(readThreads(c2.state.ext[commentsExt]).single.messages.single.text, 'offline geschrieben');
      final sent = [for (final m in s2.sent) if (m['t'] == 'ops') m['req']];
      expect(sent, [saved[0]['req'], saved[1]['req']], reason: 'dieselben req: der Server führt jede einmal aus');
      // ack → aus der Warteschlange und vom Gerät
      s2.push(AckMessage(saved[0]['req']! as int, 2));
      s2.push(AckMessage(saved[1]['req']! as int, 3));
      await c2.persistPending();
      expect(store.saved.containsKey('b'), isFalse);
      c2.dispose();

      // wie im Web ohne Zeitgrenze: auch drei Tage alt geht raus (Abnahme O01) …
      store.saved['b'] = [
        PendingEntry.ops(4, const [
          UpdateOp({
            'n1': {'x': 77},
          }),
        ], at: DateTime.now().subtract(const Duration(days: 3))).toJson(),
      ];
      final s4 = FixtureBoardSource(snap);
      final c4 = BoardController(s4, boardId: 'b', pendingStore: store);
      await c4.start();
      await pumpEventQueue();
      expect(c4.state['n1']!.x, 77);
      expect(s4.sent.where((m) => m['t'] == 'ops'), hasLength(1));
      c4.dispose();

      // … nur mit ausdrücklicher Höchstdauer: zu alt = verworfen statt gesendet
      store.saved['b'] = [
        PendingEntry.ops(5, const [
          UpdateOp({
            'n1': {'x': 99},
          }),
        ], at: DateTime.now().subtract(const Duration(days: 3))).toJson(),
      ];
      final s3 = FixtureBoardSource(snap);
      final c3 = BoardController(s3, boardId: 'b', pendingStore: store, pendingMaxAge: const Duration(hours: 48));
      await c3.start();
      await pumpEventQueue();
      expect(c3.state['n1']!.x, 0);
      expect(s3.sent.where((m) => m['t'] == 'ops'), isEmpty);
      await pumpEventQueue();
      expect(store.saved.containsKey('b'), isFalse);
      c3.dispose();
    });

    test('Kommentar optimistisch sichtbar, nack nimmt ihn zurück; extVersion zählt', () async {
      final s = FixtureBoardSource(snap);
      final c = BoardController(s);
      await c.start();
      final v0 = c.extVersion;
      c.apply([const CommentOp('t1', 'm1', CommentAnchor(0, 0), 'hi')]);
      expect(readThreads(c.state.ext[commentsExt]), hasLength(1));
      expect(c.extVersion, greaterThan(v0));
      final req = s.sent.lastWhere((m) => m['t'] == 'ops')['req']! as int;
      s.push(NackMessage(req, 'invalid_input', 'nein'));
      expect(readThreads(c.state.ext[commentsExt]), isEmpty);
      c.dispose();
    });

    test('Upload-Platzhalter gehen als presence.uploads raus (leer räumt sie weg)', () async {
      final s = FixtureBoardSource(snap);
      final c = BoardController(s, presenceInterval: Duration.zero);
      await c.start();
      c.uploads.value = [const BoardUpload(key: 'u', rect: Rect.fromLTWH(1, 2, 300, 200), color: '#aabbcc')];
      expect(s.sent.last['uploads'], [
        {'x': 1.0, 'y': 2.0, 'w': 300.0, 'h': 200.0, 'color': '#aabbcc'},
      ]);
      c.uploads.value = const [];
      expect(s.sent.last['uploads'], isEmpty);
      c.dispose();
    });
  });

  group('Format-Leiste (Textteile wie das Web)', () {
    final link = {
      'type': 'link',
      'attrs': {'href': 'https://beispiel.org'},
    };
    final comment = {
      'type': 'comment',
      'attrs': {'id': 'c1'},
    };

    test('fett an/aus auf einem Bereich; nichts ausgewählt = ganzer Text; unbekannte Marks bleiben', () {
      final d = RichEditDoc(_doc([_p([_t('Hallo '), _t('Welt', [comment])])]));
      expect(d.toggleMark(0, 5, 'bold'), isTrue);
      expect(d.hasMark(0, 5, 'bold'), isTrue);
      expect(d.hasMark(0, 10, 'bold'), isFalse);
      expect(d.toJson(), _doc([_p([_t('Hallo', [{'type': 'bold'}]), _t(' '), _t('Welt', [comment])])]));
      d.toggleMark(3, 3, 'italic'); // leer: alles
      expect(d.hasMark(0, 0, 'italic'), isTrue);
      d.toggleMark(0, 5, 'bold');
      expect(d.toJson(), _doc([_p([_t('Hallo ', [{'type': 'italic'}]), _t('Welt', [comment, {'type': 'italic'}])])]));
    });

    test('Textfarbe als textStyle.color (fontSize bleibt), Markierung, Link (nur sichere Ziele)', () {
      final big = {
        'type': 'textStyle',
        'attrs': {'fontSize': '2em'},
      };
      final d = RichEditDoc(_doc([_p([_t('ab', [big]), _t('cd', [link])])]));
      d.setMarkAttr(0, 2, 'textStyle', 'color', '#ec4e92');
      expect(d.markAttr(0, 2, 'textStyle', 'color'), '#ec4e92');
      expect(d.markAttr(0, 2, 'textStyle', 'fontSize'), '2em');
      d.setMarkAttr(0, 2, 'textStyle', 'color', null);
      expect(d.toJson(), _doc([_p([_t('ab', [big]), _t('cd', [link])])]));
      d.setMarkAttr(2, 4, 'highlight', 'color', '#fff27a');
      expect(d.hasMark(2, 4, 'highlight'), isTrue);
      d.removeMark(2, 4, 'highlight');
      expect(d.hasMark(2, 4, 'highlight'), isFalse);
      expect(d.setLink(0, 2, 'javascript:alert(1)'), isFalse);
      expect(d.setLink(0, 2, 'beispiel.org/plan'), isTrue);
      expect(d.markAttr(0, 2, 'link', 'href'), 'https://beispiel.org/plan');
      expect(safeHref('mailto:a@b.de'), 'mailto:a@b.de');
      expect(safeHref('https:'), isNull);
    });

    test('Überschrift 1–3 und zurück; in Listen bleibt der Absatz', () {
      final d = RichEditDoc(_doc([_p([_t('Titel')]), _p([_t('Text')])]));
      expect(d.setBlockKind(0, 0, 'h2'), isTrue);
      expect(d.blockKind(0, 0), 'h2');
      expect(d.setBlockKind(0, 0, 'h2'), isTrue, reason: 'nochmal = normaler Text');
      expect(d.toJson(), _doc([_p([_t('Titel')]), _p([_t('Text')])]));
    });

    test('Listen: einpacken, Art wechseln (Aufgaben), abhaken, auspacken – der Text bleibt gleich', () {
      final d = RichEditDoc(_doc([_p([_t('Zelte')]), _p([_t('Strom')]), _p([_t('Ende')])]));
      expect(d.toggleList(0, 8, 'bulletList'), isTrue); // „Zelte\nStr|om“
      expect(d.listKind(0, 8), 'bulletList');
      expect(d.text, 'Zelte\nStrom\nEnde');
      expect(d.toJson(), {
        'type': 'doc',
        'content': [
          {
            'type': 'bulletList',
            'content': [
              {'type': 'listItem', 'content': [_p([_t('Zelte')])]},
              {'type': 'listItem', 'content': [_p([_t('Strom')])]},
            ],
          },
          _p([_t('Ende')]),
        ],
      });
      d.toggleList(0, 0, 'taskList');
      expect(d.listKind(0, 8), 'taskList');
      expect(d.toggleTaskDone(7, 7), isTrue);
      final items = ((d.toJson()['content'] as List).first as Map)['content'] as List;
      expect([for (final i in items) (i as Map)['attrs']], [
        {'checked': false},
        {'checked': true},
      ]);
      // tippen in der Liste geht weiter wie gewohnt
      expect(d.setText('Zelte\nStrom!\nEnde'), isTrue);
      d.toggleList(0, 0, 'taskList'); // erste Zeile auspacken
      expect(d.listKind(0, 0), isNull);
      expect(d.listKind(7, 7), 'taskList');
      expect(d.text, 'Zelte\nStrom!\nEnde');
    });
  });

  group('Stift, Verbinder, Rahmen, Bilder', () {
    test('Strich wie pen.ts: ausdünnen, Box mit halber Strichbreite, relative Punkte', () {
      final pts = [for (var i = 0; i <= 10; i++) Offset(i * 10.0, 0)] + [const Offset(100, 50)];
      expect(simplifyStroke(pts, 0.6), [const Offset(0, 0), const Offset(100, 0), const Offset(100, 50)]);
      expect(penFromPoints(const [Offset(10, 10), Offset(30, 20)], 4), {
        'x': 8.0,
        'y': 8.0,
        'w': 24.0,
        'h': 14.0,
        'points': [2.0, 2.0, 22.0, 12.0],
      });
      final pen = BoardObject({
        'id': 'p',
        'type': 'pen',
        'x': 0,
        'y': 0,
        'w': 104,
        'h': 4,
        'points': [2, 2, 102, 2],
        'strokeWidth': 4,
      });
      expect(penHit(pen, const Offset(50, 10), 6), isTrue);
      expect(penHit(pen, const Offset(50, 20), 6), isFalse);
    });

    test('Spitzen setzen wie das shapes-Modul, Richtung umkehren tauscht alles', () {
      expect(capPatch('end', 'triangle'), {'capEnd': null, 'arrowEnd': true});
      // web `capPatch`: „none“ = keine Felder (capStart weg, arrowStart weg), am Ende arrowEnd false
      expect(capPatch('start', 'none'), {'capStart': null, 'arrowStart': null});
      expect(capPatch('end', 'none'), {'capEnd': null, 'arrowEnd': false});
      expect(capPatch('end', 'arrow'), {'capEnd': 'arrow', 'arrowEnd': true});
      final c = BoardObject({
        'id': 'c',
        'type': 'connector',
        'from': {'objectId': 'a'},
        'to': {'x': 1, 'y': 2},
        'capEnd': 'circle',
        'labelPos': 0.25,
      });
      expect(reversePatch(c), {
        'from': {'x': 1, 'y': 2},
        'to': {'objectId': 'a'},
        'capStart': 'circle',
        'capEnd': null,
        'arrowStart': true,
        'arrowEnd': false,
        'labelPos': 0.75,
      });
    });

    test('Rahmen-Liste: erst mit slide, dann Lesereihenfolge; Inhalt = ganz drin, nicht gesperrt/Verbinder', () {
      final objs = [
        BoardObject({'id': 'f3', 'type': 'frame', 'x': 0, 'y': 1000, 'w': 100, 'h': 100}),
        BoardObject({'id': 'f2', 'type': 'frame', 'x': 900, 'y': 10, 'w': 100, 'h': 100}),
        BoardObject({'id': 'f1', 'type': 'frame', 'x': 0, 'y': 0, 'w': 640, 'h': 420}),
        BoardObject({'id': 's', 'type': 'frame', 'x': 5000, 'y': 5000, 'w': 10, 'h': 10, 'slide': 'a0'}),
        BoardObject({'id': 'in', 'type': 'sticky', 'x': 10, 'y': 10, 'w': 100, 'h': 100}),
        BoardObject({'id': 'half', 'type': 'sticky', 'x': 600, 'y': 10, 'w': 100, 'h': 100}),
        BoardObject({'id': 'lock', 'type': 'sticky', 'x': 10, 'y': 200, 'w': 50, 'h': 50, 'locked': true}),
        // flush with the right/bottom edge: inside like the web's `contains` (Abnahme D17)
        BoardObject({'id': 'edge', 'type': 'shape', 'x': 540, 'y': 320, 'w': 100, 'h': 100}),
      ];
      expect(framesInOrder(objs).map((f) => f.id), ['s', 'f1', 'f2', 'f3']);
      expect(frameContents(objs[2], objs).map((o) => o.id), ['in', 'edge']);
    });

    test('Bildgröße wie das Web (520 / 120), freie Stelle neben belegter', () {
      expect(boardImageSize(4000, 3000), const Size(520, 390));
      expect(boardImageSize(60, 30), const Size(120, 60));
      expect(boardImageSize(300, 200), const Size(300, 200));
      final state = BoardState()
        ..applySnapshot(
          BoardSnapshot.fromJson({
            'objects': [
              {'id': 'n', 'type': 'sticky', 'x': -100, 'y': -100, 'w': 200, 'h': 200},
            ],
          }),
          rev: 1,
          epoch: 'e',
        );
      final scene = BoardScene(state)..sync();
      final at = freeSpot(scene, Offset.zero, const Size(100, 100));
      final r = Rect.fromLTWH(at.dx, at.dy, 100, 100);
      expect(r.overlaps(const Rect.fromLTWH(-100, -100, 200, 200)), isFalse);
      expect((r.center - Offset.zero).distance, lessThan(200));
    });

    test('Verbinder-Ende: Andockpunkt rastet ein, sonst Objekt darunter, sonst frei', () {
      final state = BoardState()
        ..applySnapshot(
          BoardSnapshot.fromJson({
            'objects': [
              {'id': 'a', 'type': 'shape', 'shape': 'rect', 'x': 0, 'y': 0, 'w': 200, 'h': 100},
            ],
          }),
          rev: 1,
          epoch: 'e',
        );
      final scene = BoardScene(state)..sync();
      final snap = dropEnd(scene, const Offset(205, 52), 1);
      expect((snap.objectId, snap.side), ('a', 'e'));
      expect(snap.toJson(), {'objectId': 'a', 'side': 'e'});
      final inside = dropEnd(scene, const Offset(60, 40), 1);
      expect((inside.objectId, inside.side), ('a', null));
      final free = dropEnd(scene, const Offset(500, 500), 1);
      expect(free.toJson(), {'x': 500.0, 'y': 500.0});
      expect(dropEnd(scene, const Offset(205, 52), 1, exclude: 'a').attached, isFalse);
    });
  });
}
