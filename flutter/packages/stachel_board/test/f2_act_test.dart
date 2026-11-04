// F2 web actions (contract §8.12, parity audit §3.2/O04): `act` op with key/v in its own message, the „wird ausgeführt“
// list, ack.results → select/focus/edit/toast, nack, offline queue on the device (same req and key after a restart),
// predicted preview, which actions the server offers (welcome.actions with version); generic presence.extra; the web
// constants and the font metrics of all web fonts (contract §8.13).

import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/mindmap/text_metrics.g.dart';
import 'package:stachel_board/src/web/web_constants.g.dart';

final _snap = BoardSnapshot.fromJson({
  'objects': [
    {'id': 'n1', 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'A', 'z': 'a0'},
  ],
});

FixtureBoardSource _source() => FixtureBoardSource(
  _snap,
  rev: 5,
  features: const ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'act', 'extra'],
  actions: const {'dev.note': 1, 'core.align': 2},
);

List<Map<String, Object?>> _messages(FixtureBoardSource s, String t) => [
  for (final m in s.sent)
    if (m['t'] == t) m,
];

void main() {
  group('Protokoll', () {
    test('welcome.actions mit Version, ack.results je Op-Index, act-Op mit key und v (v=1 weggelassen)', () {
      final w = WelcomeMessage.fromJson({
        't': 'welcome',
        'rev': 1,
        'snapshot': {'objects': []},
        'features': ['act'],
        'actions': {'dev.note': 1, 'core.align': 2, 'kaputt': 'x'},
      });
      expect(w.info.actions, {'dev.note': 1, 'core.align': 2});
      final ack = ServerMessage.parse({
        't': 'ack',
        'req': 3,
        'rev': 9,
        'results': {
          '0': {
            'select': ['k-1'],
            'focus': {'x': 1, 'y': 2, 'w': 3, 'h': 4},
            'edit': 'k-1',
            'toast': 'Notiz angelegt.',
            'data': {'n': 1},
          },
          '1': {'skipped': true},
          'x': {'toast': 'nie'},
        },
      }) as AckMessage;
      expect(ack.results.keys, [0, 1]);
      final r = ack.results[0]!;
      expect(r.select, ['k-1']);
      expect(r.data, {'n': 1});
      expect((r.focus, r.focusRect, r.edit, r.toast), (null, (x: 1.0, y: 2.0, w: 3.0, h: 4.0), 'k-1', 'Notiz angelegt.'));
      expect(ack.results[1]!.skipped, isTrue);
      expect(const ActOp('dev.note', args: {'x': 1}, key: 'k').toJson(), {
        'op': 'act',
        'name': 'dev.note',
        'args': {'x': 1},
        'key': 'k',
      });
      expect(const ActOp('core.align', key: 'k', v: 2).toJson()['v'], 2);
      // the queue on the device keeps label and prediction, the server never sees them
      const op = ActOp(
        'dev.note',
        args: {'x': 1},
        key: 'k',
        label: 'Notiz',
        predicted: [
          CreateOp([
            {'id': 'k-1', 'type': 'sticky'},
          ]),
        ],
      );
      final back = boardOpFromJson(op.toStoredJson())! as ActOp;
      expect((back.name, back.key, back.label, back.predicted.single.toJson()['op']), ('dev.note', 'k', 'Notiz', 'create'));
      expect(back.args, {'x': 1});
      expect(op.toJson().containsKey('label'), isFalse);
    });
  });

  group('BoardController.act', () {
    test('eigene Nachricht mit Schritt, „wird ausgeführt“, ack → Ergebnis (Future und Strom), Liste leer', () async {
      final s = _source();
      final c = BoardController(s);
      addTearDown(c.dispose);
      await c.start();
      expect((c.canAct('dev.note'), c.canAct('core.align', 2), c.canAct('core.align', 3), c.canAct('table.addRow')), (true, true, false, false));
      final streamed = <ActDone>[];
      c.actResults.listen(streamed.add);
      final done = c.act('dev.note', {'x': 10, 'y': 20}, key: 'k1', label: 'Notiz');
      expect(c.runningActs.single.label, 'Notiz');
      expect(c.runningActs.single.queued, isFalse);
      final m = _messages(s, 'ops').single;
      expect(m['ops'], [
        {
          'op': 'act',
          'name': 'dev.note',
          'args': {'x': 10, 'y': 20},
          'key': 'k1',
        },
      ]);
      expect(s.sent.last, {'t': 'step'}, reason: 'eigener Rückgängig-Schritt');
      s.push(
        AckMessage(m['req']! as int, 6, const [], {
          0: const ActResult(select: ['k1-1'], edit: 'k1-1', toast: 'Notiz angelegt.'),
        }),
      );
      final d = await done;
      expect((d.ok, d.name, d.key, d.result!.toast), (true, 'dev.note', 'k1', 'Notiz angelegt.'));
      expect(d.result!.select, ['k1-1']);
      await pumpEventQueue();
      expect(streamed.single.req, d.req);
      expect(c.runningActs, isEmpty);
    });

    test('abgelehnt (unsupported) → Fehler im Ergebnis und Hinweis „rejected“', () async {
      final s = _source();
      final c = BoardController(s);
      addTearDown(c.dispose);
      await c.start();
      final notices = <BoardNotice>[];
      c.notices.listen(notices.add);
      final done = c.act('core.align', {'mode': 'left'}, v: 3);
      expect(_messages(s, 'ops').single['ops'], [
        {'op': 'act', 'name': 'core.align', 'args': {'mode': 'left'}, 'key': isA<String>(), 'v': 3},
      ]);
      s.push(NackMessage(_messages(s, 'ops').single['req']! as int, 'unsupported', 'Aktion unbekannt', 0));
      final d = await done;
      expect((d.ok, d.error), (false, 'unsupported'));
      await pumpEventQueue();
      expect(notices.single.kind, 'rejected');
    });

    test('offline: wartet („sobald online“), auf dem Gerät gespeichert; nächster Start sendet dieselbe req/key, ack → Strom', () async {
      final store = MemoryPendingStore();
      final s1 = _source();
      final c1 = BoardController(s1, boardId: 'b', pendingStore: store, offlineEditWindow: const Duration(minutes: 5));
      await c1.start();
      await pumpEventQueue();
      s1.drop();
      final unawaitedDone = c1.act('dev.note', {'x': 1, 'y': 2}, key: 'kk', label: 'Notiz');
      expect(c1.runningActs.single.queued, isTrue);
      expect(_messages(s1, 'ops'), isEmpty);
      await c1.persistPending();
      final saved = store.saved['b']!.single;
      expect(((saved['ops'] as List).single as Map)['label'], 'Notiz');
      c1.dispose();
      expect(unawaitedDone, isA<Future<ActDone>>());

      final s2 = _source();
      final c2 = BoardController(s2, boardId: 'b', pendingStore: store);
      addTearDown(c2.dispose);
      final streamed = <ActDone>[];
      c2.actResults.listen(streamed.add);
      await c2.start();
      await pumpEventQueue();
      final m = _messages(s2, 'ops').single;
      expect(m['req'], saved['req']);
      expect(((m['ops'] as List).single as Map)['key'], 'kk');
      expect(((m['ops'] as List).single as Map).containsKey('label'), isFalse);
      expect(c2.runningActs.single.queued, isFalse);
      s2.push(
        AckMessage(m['req']! as int, 9, const [], {
          0: const ActResult(select: ['kk-1']),
        }),
      );
      await pumpEventQueue();
      expect(streamed.single.result!.select, ['kk-1']);
      await c2.persistPending();
      expect(store.saved.containsKey('b'), isFalse);
    });

    test('Vorschau (predicted) bis zum Patch des Servers, dann dessen Stand', () async {
      final s = _source();
      final c = BoardController(s);
      addTearDown(c.dispose);
      await c.start();
      c.act(
        'dev.note',
        {'x': 300, 'y': 0},
        key: 'p',
        predicted: [
          const CreateOp([
            {'id': 'p-1', 'type': 'sticky', 'x': 300, 'y': 0, 'w': 200, 'h': 200, 'text': ''},
          ]),
        ],
      );
      expect(c.state['p-1']!.x, 300);
      final req = _messages(s, 'ops').single['req']! as int;
      s.push(
        PatchMessage(
          rev: 6,
          changes: [
            ObjectCreated(BoardObject.fromJson({'id': 'p-1', 'type': 'sticky', 'x': 310, 'y': 0, 'w': 200, 'h': 200, 'z': 'b0'})!),
          ],
        ),
      );
      s.push(AckMessage(req, 6));
      await pumpEventQueue();
      expect(c.state['p-1']!.x, 310);
    });

    testWidgets('Ergebnis im Board: wählt aus, Kamera hin, schreibt sofort; Hinweis-Text als Meldung', (tester) async {
      tester.view.physicalSize = const Size(800, 600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final s = _source();
      final c = BoardController(s, presenceInterval: Duration.zero);
      final editor = BoardEditor(controller: c, scene: BoardScene(c.state), camera: CameraController());
      final ui = BoardUi(editor: editor, registry: standardBoardRegistry());
      addTearDown(() {
        ui.dispose();
        editor.dispose();
        c.dispose();
      });
      final said = <String>[];
      ui.hints.messages.listen(said.add);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BoardView(key: ui.viewKey, controller: c, editor: editor, fitOnLoad: false),
          ),
        ),
      );
      await c.start();
      await tester.pump();
      c.act('dev.note', {'x': 2000, 'y': 2000}, key: 'z');
      final req = _messages(s, 'ops').single['req']! as int;
      s.push(
        PatchMessage(
          rev: 6,
          changes: [
            ObjectCreated(BoardObject.fromJson({'id': 'z-1', 'type': 'sticky', 'x': 2000, 'y': 2000, 'w': 200, 'h': 200, 'text': '', 'z': 'b0'})!),
          ],
        ),
      );
      s.push(
        AckMessage(req, 6, const [], {
          0: const ActResult(select: ['z-1'], focus: ['z-1'], edit: 'z-1', toast: 'Notiz angelegt.'),
        }),
      );
      await tester.pump();
      await tester.pump();
      expect(editor.selection.value, {'z-1'});
      expect(editor.editingId, 'z-1');
      final center = ui.view!.camera.value.toWorld(const Offset(400, 300));
      expect((center - const Offset(2100, 2100)).distance, lessThan(2), reason: 'Kamera auf dem neuen Objekt');
      expect(said, ['Notiz angelegt.']);
    });
  });

  group('presence.extra', () {
    test('Teil-Aktualisierung je Schlüssel, null einmal zum Entfernen, sofort für Laser', () {
      final sent = <Map<String, Object?>>[];
      final p = PresenceSender(sent.add, interval: Duration.zero)..live = true;
      p.setExtra('collab.status', 'idle');
      expect(sent.last['extra'], {'collab.status': 'idle'});
      p.setExtra('collab.laser', {
        's': 1,
        'p': [1, 2],
      }, immediate: true);
      expect(sent.last['extra'], {
        'collab.status': 'idle',
        'collab.laser': {
          's': 1,
          'p': [1, 2],
        },
      });
      p.setExtra('collab.laser', null, immediate: true);
      expect(sent.last['extra'], {'collab.laser': null, 'collab.status': 'idle'});
      p.update(selection: ['n1']);
      expect(sent.last['extra'], {'collab.status': 'idle'}, reason: 'Entfernen ging einmal raus');
      final n = sent.length;
      p.setExtra('collab.status', 'idle');
      expect(sent.length, n, reason: 'gleicher Wert: nichts');
      p.dispose();
    });
  });

  group('Web-Konstanten und Schriftmaße (§8.13)', () {
    test('die erzeugte Datei = docs/native_fixtures/web/constants.json; App-Werte = Web-Werte', () {
      final fixture = File('../../../docs/native_fixtures/web/constants.json').readAsStringSync().trim();
      expect(jsonDecode(webConstantsJson), jsonDecode(fixture), reason: 'neu erzeugen: dart run tool/gen_web_constants.dart');
      final w = WebConstants.instance;
      expect(w.version, greaterThanOrEqualTo(1));
      expect(w.strings('colors.sticky'), stickyColors);
      expect(w.strings('colors.mind'), mindColors);
      expect(w.strings('reactions'), reactionEmojis);
      expect(w.numbers('eraserSizes'), eraserSizes);
      expect(w.strings('shapes.capStyles'), connectorCaps);
      expect(w.number('timeline.layout.rowH'), 38);
      expect(w.string('colors.shape.0.name'), 'Weiß');
      expect(w.value('fehlt.ganz'), isNull);
    });

    test('Schriftmaße aller Schnitte: Familie aus dem CSS-Namen, kursiv, Aliasse; Mindmap-Schnitte unverändert', () {
      final m = TextMetrics.instance;
      expect(TextMetrics.familyOf("'Source Serif 4', serif"), 'Source Serif 4');
      expect(TextMetrics.familyOf('JetBrains Mono, monospace'), 'JetBrains Mono');
      expect(TextMetrics.familyOf('"Barlow Condensed", sans-serif'), 'Barlow Condensed');
      expect(TextMetrics.familyOf('Barlow, sans-serif'), 'Barlow');
      final barlow = m.measure('Festival', 20, 500, 'Barlow');
      expect(m.measure('Festival', 20, 500, 'Source Serif 4'), isNot(barlow));
      expect(m.measure('Festival', 20, 500, 'Barlow', italic: true), isNot(barlow));
      expect(m.measure('Festival', 20, 520, 'Barlow'), barlow, reason: 'auf Hunderter gerundet');
      final j = jsonDecode(textMetricsJson) as Map<String, Object?>;
      final aliases = (j['aliases'] as Map?) ?? const {};
      if (aliases.isNotEmpty) {
        final e = aliases.entries.first;
        final (fam, wt) = ((e.key as String).split('|').first, int.parse((e.key as String).split('|').last));
        final (tfam, twt) = ((e.value as String).split('|').first, int.parse((e.value as String).split('|').last));
        final italic = fam.endsWith(' Italic');
        expect(
          m.measure('Abc 123', 16, wt, fam.replaceAll(' Italic', ''), italic: italic),
          m.measure('Abc 123', 16, twt, tfam.replaceAll(' Italic', ''), italic: tfam.endsWith(' Italic')),
        );
      }
    });
  });
}
