// Abnahme 2026-11-02 (native Parität): Stichproben der riskanten ✓-Zeilen gegen den echten Server in der Sandbox –
// Rückgängig je Paket (ein Schritt, „none“-Aktionen nicht), Warteschlange offline mit Web-Aktionen, Mehrfachauswahl
// mit allen Objektarten (Duplizieren, Löschen, Rahmen nimmt Inhalt mit), Konflikte, Anwesenheit, Reaktionen,
// gesperrte Objekte. Das Web (`tools/web-peer.mts`) muss jeweils dasselbe sehen.
//
//   cd stachel && npm --prefix server run build
//   server\node_modules\.bin\tsx.cmd tools/sandbox.mts 8780 --seed
//   flutter test test/abnahme/abnahme_live_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8780
//
// Skipped without STACHEL_SANDBOX (or without the stachel repo for the web side).
@Tags(['live'])
library;

import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/timeline/timeline_model.dart';

import '../live_support.dart';

void main() {
  late String boardId;
  final tokens = <String, String>{};

  Future<String> token(String who) async => tokens[who] ??=
      ((await liveHttp('POST', '$sandbox/api/auth/app-session', bearer: 'sandbox-$who', body: {}))! as Map)['token']
          as String;

  setUpAll(() async {
    if (liveSkip != null) return;
    final t = await token('mara');
    final b = await liveHttp(
      'POST',
      '$sandbox/api/boards',
      bearer: t,
      write: true,
      body: {'title': 'Abnahme live ${DateTime.now().toIso8601String()}'},
    );
    boardId = ((b! as Map)['board'] as Map)['id'] as String;
  });

  /// App side (own session per call, so undo histories do not mix); [connect] lets a test cut the network.
  Future<(NativeBoardSource, BoardController, BoardEditor)> app({WebSocketConnector? connect}) async {
    String? t;
    final source = NativeBoardSource(
      base: Uri.parse(sandbox),
      board: boardId,
      token: ({bool fresh = false}) async {
        if (fresh || t == null) {
          t = ((await liveHttp('POST', '$sandbox/api/auth/app-session', bearer: 'sandbox-mara', body: {}))! as Map)['token']
              as String;
        }
        return t!;
      },
      appVersion: '1.26.0+35',
      connect: connect,
      retryDelays: const [Duration(milliseconds: 100)],
    );
    final c = BoardController(source, presenceInterval: const Duration(milliseconds: 30));
    c.notices.listen((n) => printOnFailure('Hinweis ${n.kind}: ${n.error} ${n.message}'));
    final e = BoardEditor(controller: c, scene: BoardScene(c.state), camera: CameraController());
    await c.start();
    await until(() => c.loaded && c.canEdit);
    addTearDown(() {
      e.dispose();
      c.dispose();
    });
    return (source, c, e);
  }

  Future<WebPeer> web() async {
    final p = await WebPeer.start();
    addTearDown(p.close);
    await p.cmd({'cmd': 'open', 'board': boardId});
    return p;
  }

  Future<ActDone> act(BoardController c, String name, Map<String, Object?> args, {String? key}) async {
    final d = await c.act(name, args, key: key).timeout(const Duration(seconds: 10));
    expect(d.ok, isTrue, reason: '$name: ${d.error} ${d.message}');
    return d;
  }

  String pre() => 'a${BoardController.newActKey().substring(0, 6)}';

  Map<String, Object?> sticky(String id, double x, double y, [Map<String, Object?> extra = const {}]) => {
    'id': id,
    'type': 'sticky',
    'x': x,
    'y': y,
    'w': 100,
    'h': 100,
    'text': id,
    ...extra,
  };

  Future<void> created(BoardController c, WebPeer p, List<Map<String, Object?>> objs) async {
    c.apply([CreateOp(objs)]);
    for (final o in objs) {
      await until(() => !c.hasPending(o['id']! as String) && c.confirmed[o['id']! as String] != null);
    }
    await untilAsync(() async => (await p.object(objs.last['id']! as String)) != null);
  }

  /// Undo of the last own step: back to [check] in the app and at the web.
  Future<void> undoUntil(BoardController c, bool Function() app, Future<bool> Function() webSide) async {
    c.undo();
    await until(app);
    await untilAsync(webSide);
  }

  test(
    'Rückgängig je Paket: Web-Aktionen (Ausrichten, Gruppieren, Vorlage, Tabelle, Zeitleiste, Rich-Text, Rahmen-Reihenfolge) '
    'je ein Schritt beim Web; „none“-Aktionen (Hintergrund, Timer) bleiben',
    () async {
      final (_, c, _) = await app();
      final p = await web();
      final x = pre();
      final ids = ['${x}a', '${x}b', '${x}c'];
      await created(c, p, [sticky(ids[0], 0, 0), sticky(ids[1], 300, 50), sticky(ids[2], 140, 260)]);
      c.closeStep();

      // P1 core.align → undo
      await act(c, 'core.align', {'ids': ids, 'mode': 'top'});
      await untilAsync(() async => (await p.object(ids[2]))?['y'] == 0);
      await undoUntil(c, () => c.state[ids[2]]!.y == 260, () async => (await p.object(ids[2]))?['y'] == 260);
      expect(c.state[ids[1]]!.y, 50);

      // P1 core.group → undo
      await act(c, 'core.group', {'ids': ids});
      await until(() => c.state[ids[0]]!.groupId != null);
      await undoUntil(c, () => ids.every((id) => c.state[id]!.groupId == null), () async => (await p.object(ids[1]))?['groupId'] == null);

      // P8 richtext.whole → undo
      await act(c, 'richtext.whole', {
        'ids': [ids[0]],
        'op': 'underline',
        'value': true,
      });
      bool underlined(Object? content) => content.toString().contains('underline');
      await untilAsync(() async => underlined((await p.content(ids[0])).$1));
      await undoUntil(c, () => !underlined(c.state[ids[0]]!.raw['content']), () async => !underlined((await p.content(ids[0])).$1));

      // P3 structure.template → one undo step takes all objects of the template away
      final tk = BoardController.newActKey();
      final t = await act(c, 'structure.template', {'template': 'retro', 'x': 5000, 'y': 5000}, key: tk);
      final made = t.result!.select!;
      expect(made, isNotEmpty);
      await untilAsync(() async => (await p.object(made.last)) != null);
      await undoUntil(c, () => made.every((id) => c.state[id] == null), () async => (await p.object(made.first)) == null);

      // P3 table.addRow → undo
      final tab = '${x}t';
      await created(c, p, [
        {
          'id': tab,
          'type': 'table',
          'x': 0,
          'y': 600,
          'w': 480,
          'h': 126,
          'color': '#0a0a0a',
          'table': {
            'rows': ['r1', 'r2', 'r3'],
            'cols': ['c1', 'c2', 'c3'],
            'cells': {},
            'widths': {},
          },
        },
      ]);
      c.closeStep();
      await act(c, 'table.addRow', {'id': tab, 'after': 'r1'});
      List<Object?> rowsOf(Map<String, Object?>? o) => ((o?['table'] as Map?)?['rows'] as List?) ?? const [];
      await untilAsync(() async => rowsOf(await p.object(tab)).length == 4);
      await undoUntil(c, () => rowsOf(c.state[tab]!.raw).length == 3, () async => rowsOf(await p.object(tab)).length == 3);

      // P9 timeline.addItem → undo
      final tl = '${x}l';
      final start = tlParseDay('2026-11-02')!;
      await created(c, p, [
        {'id': tl, ...tlNewTimeline(0, 1200, tlToday(), start: start, end: start + 55)},
      ]);
      c.closeStep();
      await act(c, 'timeline.addItem', {'id': tl, 'lane': 'l1', 'start': '2026-11-04', 'end': '2026-11-10'}, key: '${x}k');
      Map<Object?, Object?> itemsOf(Map<String, Object?>? o) =>
          ((o?['timeline'] as Map?)?['items'] as Map?) ?? const {};
      await untilAsync(() async => itemsOf(await p.object(tl)).containsKey('${x}k-1'));
      await undoUntil(c, () => !itemsOf(c.state[tl]!.raw).containsKey('${x}k-1'), () async => !itemsOf(await p.object(tl)).containsKey('${x}k-1'));

      // P4 frames.reorder → undo
      final f = ['${x}f1', '${x}f2'];
      await created(c, p, [
        {'id': f[0], 'type': 'frame', 'x': 0, 'y': 2000, 'w': 200, 'h': 100, 'title': 'A'},
        {'id': f[1], 'type': 'frame', 'x': 400, 'y': 2000, 'w': 200, 'h': 100, 'title': 'B'},
      ]);
      c.closeStep();
      await act(c, 'frames.reorder', {'id': f[1], 'to': 0});
      await untilAsync(() async => (await p.object(f[1]))?['slide'] != null);
      await undoUntil(c, () => c.state[f[1]]!.raw['slide'] == null, () async => (await p.object(f[1]))?['slide'] == null);

      // „none“: tools.settings and the timer stay; undo takes the last undoable step instead (here: nothing left
      // from this session that is still undoable but the frames/timeline/table creates – the settings stay)
      await act(c, 'tools.settings', {'pattern': 'lines', 'color': '#fbeff4'});
      await act(c, 'collab.timer.start', {'ms': 60000});
      c.undo();
      await untilAsync(() async => (await p.object(f[1])) == null);
      final s = (await p.cmd({'cmd': 'ext', 'name': 'tools.settings'}))['value']! as Map;
      expect(s['pattern'], 'lines', reason: 'Hintergrund ist nicht im Rückgängig');
      final timer = (await p.cmd({'cmd': 'ext', 'name': 'collab.timer'}))['value']! as Map;
      expect((timer['timer'] as Map?)?['state'], 'running', reason: 'Timer läuft weiter');
      await act(c, 'collab.timer.stop', const {});
      await act(c, 'tools.settings', {'pattern': 'dots', 'color': '#ffffff'});
    },
    skip: liveSkip,
  );

  test(
    'Warteschlange offline mit Web-Aktionen und Ops: geht nach dem Wiederverbinden genau einmal raus, Ergebnis wie online',
    () async {
      WebSocket? ws;
      var offline = false;
      Future<WebSocket> connect(Uri u, Map<String, String> h) async {
        if (offline) throw const SocketException('offline (Test)');
        return ws = await WebSocket.connect(u.toString(), headers: h);
      }

      final (source, c, e) = await app(connect: connect);
      final p = await web();
      final x = pre();
      final ids = ['${x}a', '${x}b', '${x}c'];
      await created(c, p, [sticky(ids[0], 0, 3000), sticky(ids[1], 300, 3050), sticky(ids[2], 140, 3260)]);

      offline = true;
      await ws!.close();
      await until(() => source.connection.value == BoardConnection.offline);
      // offline: an update, an action, a template (fixed key → fixed IDs), a delete
      e.select({ids[1]});
      e.setField('color', '#9fd3ff');
      final align = c.act('core.align', {'ids': ids, 'mode': 'left'}, label: 'Ausrichten');
      final tk = BoardController.newActKey();
      final tpl = c.act('structure.template', {'template': 'swot', 'x': 6000, 'y': 3000}, key: tk, label: 'Vorlage');
      expect(c.runningActs, hasLength(2), reason: '„wird ausgeführt, sobald online“');
      await Future<void>.delayed(const Duration(milliseconds: 300));
      offline = false;
      await until(() => source.connection.value == BoardConnection.live);
      final a = await align.timeout(const Duration(seconds: 10));
      final t = await tpl.timeout(const Duration(seconds: 10));
      expect(a.ok && t.ok, isTrue);
      await until(() => c.pendingCount == 0);
      await untilAsync(() async => (await p.object(ids[2]))?['x'] == 0);
      expect((await p.object(ids[1]))?['color'], '#9fd3ff');
      // the template exactly once (IDs from the fixed key)
      final made = t.result!.select!;
      expect(made.every((id) => id.startsWith('$tk-')), isTrue);
      final before = c.confirmed.length;
      // a second connection with the same key must not place it again
      final again = await c.act('structure.template', {'template': 'swot', 'x': 6000, 'y': 3000}, key: tk).timeout(
        const Duration(seconds: 10),
      );
      expect(again.ok, isTrue);
      await Future<void>.delayed(const Duration(milliseconds: 300));
      expect(c.confirmed.length, before, reason: 'gleiche key → nichts doppelt');
    },
    skip: liveSkip,
  );

  test(
    'Mehrfachauswahl mit allen Arten: Duplizieren (+24, Verbinder zwischen Kopien angedockt, ohne Sperre), Rahmen nimmt '
    'ganz Enthaltenes mit (auch kantenbündig), Löschen nimmt angedockte Verbinder mit, gesperrt bleibt',
    () async {
      final (_, c, e) = await app();
      final p = await web();
      final x = pre();
      final start = tlParseDay('2026-11-02')!;
      final objs = <Map<String, Object?>>[
        {'id': '${x}fr', 'type': 'frame', 'x': 0, 'y': 8000, 'w': 1200, 'h': 900, 'title': 'Rahmen'},
        sticky('${x}s1', 20, 8020),
        sticky('${x}s2', 400, 8020, {'locked': true}),
        {'id': '${x}sh', 'type': 'shape', 'shape': 'ellipse', 'x': 1100, 'y': 8800, 'w': 100, 'h': 100},
        {
          'id': '${x}co',
          'type': 'connector',
          'x': 120,
          'y': 8070,
          'w': 980,
          'h': 780,
          'from': {'objectId': '${x}s1'},
          'to': {'objectId': '${x}sh'},
          'arrowEnd': true,
        },
        {
          'id': '${x}pe',
          'type': 'pen',
          'x': 30,
          'y': 8300,
          'w': 100,
          'h': 20,
          'points': [0, 0, 50, 20, 100, 0],
          'strokeWidth': 4,
          'color': '#0a0a0a',
        },
        {
          'id': '${x}ta',
          'type': 'table',
          'x': 200,
          'y': 8400,
          'w': 480,
          'h': 126,
          'color': '#0a0a0a',
          'table': {
            'rows': ['r1', 'r2'],
            'cols': ['c1', 'c2'],
            'cells': {},
            'widths': {},
          },
        },
        {'id': '${x}tl', ...tlNewTimeline(0, 9000, tlToday(), start: start, end: start + 13)},
      ];
      await created(c, p, objs);
      c.closeStep();

      // frame drag: everything completely inside (also the shape flush with the bottom right edge) comes along,
      // the locked note and the connector not
      e.select({'${x}fr'});
      e.dragStart(const Offset(600, 8000), grab: '${x}fr');
      e.dragUpdate(const Offset(700, 8000));
      e.dragUpdate(const Offset(700, 8000), end: true);
      e.dragEnd();
      await untilAsync(() async => (await p.object('${x}sh'))?['x'] == 1200);
      expect((await p.object('${x}s1'))?['x'], 120);
      expect((await p.object('${x}pe'))?['x'], 130);
      expect((await p.object('${x}ta'))?['x'], 300);
      expect((await p.object('${x}s2'))?['x'], 400, reason: 'gesperrt bleibt');
      c.closeStep();

      // duplicate a mixed selection (note, shape, pen, table, timeline + the connector between note and shape)
      final sel = {'${x}s1', '${x}sh', '${x}pe', '${x}ta', '${x}tl', '${x}co', '${x}s2'};
      e.select(sel);
      final before = c.state.objects.keys.toSet();
      e.duplicateSelection();
      await until(() => c.pendingCount == 0);
      final copies = c.state.objects.keys.toSet().difference(before);
      expect(copies, hasLength(7));
      final byType = {for (final id in copies) c.state[id]!.type: c.state[id]!};
      expect(byType.keys.toSet(), {'sticky', 'shape', 'pen', 'table', 'timeline', 'connector'});
      final copyNotes = copies.where((id) => c.state[id]!.type == 'sticky').map((id) => c.state[id]!).toList();
      expect(copyNotes.map((o) => o.locked), everyElement(isFalse), reason: 'Kopien ohne Sperre');
      expect(copyNotes.map((o) => o.x).toSet(), {144.0, 424.0});
      final con = byType['connector']!;
      expect(
        {(con.from! as AttachedEnd).objectId, (con.to! as AttachedEnd).objectId},
        {for (final id in copies) if (c.state[id]!.type == 'sticky' && c.state[id]!.x == 144 || c.state[id]!.type == 'shape') id},
      );
      expect(e.selection.value, copies, reason: 'Kopien gewählt');
      await untilAsync(() async => (await p.object(con.id)) != null);

      // delete the copied note: its connector goes with it (server, web D25)
      final note = copyNotes.firstWhere((o) => o.x == 144).id;
      e.select({note});
      e.deleteSelection();
      await untilAsync(() async => (await p.object(con.id)) == null);
      expect(c.state[con.id], isNull);

      // locked: no move, no delete
      e.select({'${x}s2'});
      e.deleteSelection();
      await Future<void>.delayed(const Duration(milliseconds: 300));
      expect(await p.object('${x}s2'), isNotNull);
    },
    skip: liveSkip,
  );

  test('Konflikt und Anwesenheit: gleiches Feld gleichzeitig → beide beim selben Stand; Web-Cursor/Auswahl in der App, '
      'App-Auswahl beim Web; Reaktion für mehrere schaltet wie im Web', () async {
    final (_, c, e) = await app();
    final p = await web();
    final x = pre();
    await created(c, p, [sticky('${x}a', 0, 12000), sticky('${x}b', 200, 12000)]);

    // same field at the same time: both end up equal
    e.select({'${x}a'});
    e.setField('color', '#ffb3d1');
    await p.cmd({
      'cmd': 'set',
      'obj': '${x}a',
      'fields': {'color': '#9fd3ff'},
    });
    await until(() => c.pendingCount == 0);
    await Future<void>.delayed(const Duration(milliseconds: 500));
    expect(c.state['${x}a']!.color, (await p.object('${x}a'))!['color']);

    // presence: web → app (cursor + selection), app → web (selection)
    await p.cmd({
      'cmd': 'awareness',
      'fields': {
        'cursor': {'x': 50, 'y': 12050},
        'selection': ['${x}b'],
      },
    });
    await until(() => c.peers.any((pe) => pe.selection.contains('${x}b')));
    c.presence.update(viewport: const Rect.fromLTWH(0, 11800, 400, 800), selection: ['${x}a']);
    await untilAsync(() async {
      final peers = ((await p.cmd({'cmd': 'peers'}))['peers'] as List?) ?? const [];
      return peers.any((pe) => (pe as Map).toString().contains('${x}a'));
    });

    // reactions on two objects: on for both, then (all have it) off for both – like the web's toggleReaction
    e.toggleReaction(['${x}a', '${x}b'], '👍');
    Future<int> count() async {
      final m = (await p.cmd({'cmd': 'ext', 'name': 'collab.reactions'}))['value'] as Map? ?? const {};
      return m.keys.where((k) => k.toString().contains(x) && k.toString().contains('👍')).length;
    }

    await untilAsync(() async => await count() == 2);
    e.toggleReaction(['${x}a', '${x}b'], '👍');
    await untilAsync(() async => await count() == 0);
  }, skip: liveSkip);

  test('F20: das Web schreibt schon in der Notiz → die App schreibt trotzdem mit, beide Änderungen bleiben', () async {
    final (_, c, e) = await app();
    final p = await web();
    final id = '${pre()}n';
    await p.cmd({
      'cmd': 'create',
      'object': {
        'id': id,
        'type': 'sticky',
        'x': 0,
        'y': 14000,
        'w': 200,
        'h': 200,
        'z': 'zz',
        'text': 'Bühne\nNord',
        'content': {
          'type': 'doc',
          'content': [
            {
              'type': 'paragraph',
              'content': [
                {'type': 'text', 'text': 'Bühne'},
              ],
            },
            {
              'type': 'paragraph',
              'content': [
                {'type': 'text', 'text': 'Nord'},
              ],
            },
          ],
        },
      },
    });
    await until(() => c.state[id] != null);
    await p.cmd({'cmd': 'caret', 'obj': id});
    await until(() => c.peers.any((pe) => pe.editing == id));
    expect(e.startEditing(id), isTrue, reason: 'wie zwei Browser: kein Sperren');
    expect(e.writerOf(id), 'jonas');
    await p.cmd({'cmd': 'type', 'obj': id, 'block': 1, 'at': 4, 'text': 'seite'});
    e.textChanged('Große Bühne\nNord', caret: 11);
    await untilAsync(() async => (await p.object(id))?['text'] == 'Große Bühne\nNordseite');
    e.stopEditing();
    await until(() => c.pendingCount == 0);
    await until(() => c.state[id]!.text == 'Große Bühne\nNordseite');
    await p.cmd({'cmd': 'caret', 'obj': null});
  }, skip: liveSkip);

  test(
    'Rückgängig 2: Verteilen, Ebene, Format einfügen, In Karte umwandeln, Einfügen als Tabelle, Mindmap-Unterthema, '
    'Kommentar-Pin verschieben je ein Schritt; Abstimmen nicht im Rückgängig',
    () async {
      final (_, c, e) = await app();
      final p = await web();
      final x = pre();
      final ids = ['${x}a', '${x}b', '${x}c'];
      await created(c, p, [
        sticky(ids[0], 0, 20000),
        sticky(ids[1], 150, 20000, {'color': '#9fd3ff', 'fontSize': 32}),
        sticky(ids[2], 600, 20000),
      ]);
      c.closeStep();
      Future<num?> webX(String id) async => (await p.object(id))?['x'] as num?;

      printOnFailure('Schritt D12');
      // D12 distribute → undo
      await act(c, 'core.distribute', {'ids': ids, 'axis': 'x'});
      await untilAsync(() async => await webX(ids[1]) == 300);
      await undoUntil(c, () => c.state[ids[1]]!.x == 150, () async => await webX(ids[1]) == 150);

      printOnFailure('Schritt D27');
      // D27 layer step → undo (order back)
      c.apply([
        UpdateOp({
          ids[0]: {'x': 100},
        }),
      ]);
      await until(() => !c.hasPending(ids[0]));
      final before = c.state.orderOf(ids[0]);
      await act(c, 'tools.layerStep', {
        'ids': [ids[0]],
        'dir': 1,
      });
      await until(() => c.state.orderOf(ids[0]) > c.state.orderOf(ids[1]));
      c.undo();
      await until(() => c.state.orderOf(ids[0]) == before);

      printOnFailure('Schritt D30');
      // D30 paste style → undo
      final copy = await act(c, 'tools.copyStyle', {'id': ids[1]});
      await act(c, 'tools.pasteStyle', {
        'ids': [ids[2]],
        'style': copy.result!.data,
      });
      await untilAsync(() async => (await p.object(ids[2]))?['color'] == '#9fd3ff');
      await undoUntil(c, () => c.state[ids[2]]!.color == null, () async => (await p.object(ids[2]))?['color'] == null);

      printOnFailure('Schritt I08');
      // I08 to card → undo brings the note back
      final ck = BoardController.newActKey();
      await act(c, 'structure.toCard', {
        'ids': [ids[2]],
      }, key: ck);
      await until(() => c.state[ids[2]] == null && c.state['$ck-1'] != null);
      await undoUntil(c, () => c.state[ids[2]] != null && c.state['$ck-1'] == null, () async => (await p.object(ids[2])) != null);

      printOnFailure('Schritt D23');
      // D23 paste as table → one step
      final pk = BoardController.newActKey();
      final pd = await act(c, 'structure.paste', {'text': 'Bereich\tFr\nBar\tLena', 'as': 'table', 'x': 0, 'y': 21000}, key: pk);
      final made = pd.result!.select!;
      await untilAsync(() async => (await p.object(made.single)) != null);
      await undoUntil(c, () => c.state[made.single] == null, () async => (await p.object(made.single)) == null);

      printOnFailure('Schritt I24');
      // I24 mind map: root + child, undo takes the child only
      final root = e.createMindMap(const Offset(0, 22000))!;
      e.mindText(root, 'Fest');
      e.stopEditing();
      await until(() => c.pendingCount == 0 && c.confirmed[root] != null);
      c.closeStep();
      final child = e.mindChild(root)!;
      e.mindText(child, 'Bühne');
      e.stopEditing();
      await until(() => c.pendingCount == 0);
      await untilAsync(() async => (await p.object(child))?['text'] == 'Bühne');
      // like the web (commitMind stops capturing): first the typed text, then the new node
      c.undo();
      await untilAsync(() async => (await p.object(child))?['text'] != 'Bühne');
      c.undo();
      await untilAsync(() async => (await p.object(child)) == null);
      expect(await p.object(root), isNotNull);

      printOnFailure('Schritt L02');
      // L02 comment pin move → undo
      final thread = e.addComment(CommentAnchor(0, 23000), 'Hier?', const [])!;
      await until(() => c.pendingCount == 0);
      c.closeStep();
      await act(c, 'collab.commentMove', {'thread': thread, 'x': 400, 'y': 23100});
      Future<num?> webPinX() async {
        final m = (await p.cmd({'cmd': 'ext', 'name': 'collab.comments'}))['value'] as Map? ?? const {};
        return (m[thread] as Map?)?['x'] as num?;
      }

      await untilAsync(() async => await webPinX() == 400);
      c.undo();
      await untilAsync(() async => await webPinX() == 0);

      printOnFailure('Schritt L08');
      // L08 voting: a vote is not undone by undo (web: own origin without history)
      await act(c, 'collab.vote.start', {'title': 'Abnahme', 'perPerson': 2, 'minutes': 1, 'multi': false, 'anonymous': false});
      await act(c, 'collab.vote.cast', {'objectId': ids[0], 'delta': 1});
      Future<int> votes() async {
        final v = (await p.cmd({'cmd': 'ext', 'name': 'collab.votes'}))['value'] as Map? ?? const {};
        return v.length;
      }

      await untilAsync(() async => await votes() == 1);
      c.undo();
      await Future<void>.delayed(const Duration(milliseconds: 400));
      expect(await votes(), 1, reason: 'Stimmen sind nicht im Rückgängig');
      await act(c, 'collab.vote.end', const {});
      await act(c, 'collab.vote.close', const {});
    },
    skip: liveSkip,
  );
}
