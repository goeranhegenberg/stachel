// P3 live: the structure web actions against the real Stachel server in its sandbox – card title/description (merged
// with what the web typed meanwhile, height from the content = the app's own computation), „In Karte umwandeln“, table
// cells/rows (height = the app's computation), templates (the web has the objects), „Einfügen als …“.
//
//   cd stachel && npm --prefix server run build
//   server\node_modules\.bin\tsx.cmd tools/sandbox.mts 8640 --seed
//   flutter test test/features/cards/p3_live_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8640
//
// Skipped without STACHEL_SANDBOX (or without the stachel repo for the web side).
@Tags(['live'])
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/cards/card_model.dart';
import 'package:stachel_board/src/features/tables/table_model.dart';
import 'package:stachel_board/src/features/templates/template_model.dart' as tm;

import '../../live_support.dart';

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
      body: {'title': 'P3 live ${DateTime.now().toIso8601String()}'},
    );
    boardId = ((b! as Map)['board'] as Map)['id'] as String;
  });

  Future<BoardController> app() async {
    final source = NativeBoardSource(
      base: Uri.parse(sandbox),
      board: boardId,
      token: ({bool fresh = false}) async {
        if (fresh) tokens.remove('mara');
        return token('mara');
      },
      appVersion: '1.24.0+33',
      retryDelays: const [Duration(milliseconds: 100)],
    );
    final c = BoardController(source, presenceInterval: const Duration(milliseconds: 30));
    c.notices.listen((n) => printOnFailure('Hinweis ${n.kind}: ${n.error} ${n.message}'));
    await c.start();
    await until(() => c.loaded && c.canEdit);
    return c;
  }

  Future<ActDone> act(BoardController c, String name, Map<String, Object?> args, {String? key}) async {
    final d = await c.act(name, args, key: key).timeout(const Duration(seconds: 10));
    expect(d.ok, isTrue, reason: '$name: ${d.error} ${d.message}');
    return d;
  }

  test('Karten: Titel/Beschreibung zusammengeführt mit dem Web, Höhe = Rechnung der App, in Karte umwandeln', () async {
    final c = await app();
    addTearDown(c.dispose);
    final peer = await WebPeer.start();
    addTearDown(peer.close);
    await peer.cmd({'cmd': 'open', 'board': boardId});
    for (final n in ['structure.people', 'structure.toCard', 'card.title', 'card.desc']) {
      expect(c.canAct(n), isTrue, reason: n);
    }
    await act(c, 'structure.people', const {});
    final id = BoardController.newId();
    c.apply([
      CreateOp([
        {'id': id, 'type': 'card', 'x': 0, 'y': 0, 'w': 300, 'h': 96, 'text': 'Strom', 'color': '#1763b5'},
      ]),
    ]);
    await untilAsync(() async => (await peer.object(id)) != null);
    // das Web ändert den Titel vorne, die App hängt hinten an (Basis = alter Stand)
    await peer.cmd({
      'cmd': 'set',
      'obj': id,
      'fields': {'text': 'Viel Strom'},
    });
    await until(() => c.state[id]?.text == 'Viel Strom');
    await act(c, 'card.title', {'id': id, 'base': 'Strom', 'text': 'Strom für die Bühne und alle Stände am Gelände'});
    await until(() => c.state[id]?.text == 'Viel Strom für die Bühne und alle Stände am Gelände');
    await act(c, 'card.desc', {
      'id': id,
      'base': '',
      'text': 'Kabel und Verteiler bei der Technik abholen, Kabeltrommeln prüfen',
    });
    await until(() => (c.state[id]?.desc ?? '').startsWith('Kabel'));
    final o = c.state[id]!;
    expect(o.h, cardContentHeight(o), reason: 'Server und App rechnen mit denselben Schriftmaßen');
    expect((await peer.object(id))!['desc'], o.desc);
    // Haftnotiz → Karte
    final n = BoardController.newId();
    c.apply([
      CreateOp([
        {
          'id': n,
          'type': 'sticky',
          'x': 400,
          'y': 0,
          'w': 200,
          'h': 200,
          'text': 'Getränke bestellen',
          'color': '#fff27a',
        },
      ]),
    ]);
    await until(() => c.state[n] != null);
    final key = BoardController.newActKey();
    final d = await act(c, 'structure.toCard', {
      'ids': [n],
    }, key: key);
    expect(d.result!.select, ['$key-1']);
    await until(() => c.state['$key-1'] != null && c.state[n] == null);
    final k = c.state['$key-1']!;
    expect((k.type, k.text, k.w, k.h), ('card', 'Getränke bestellen', 300.0, cardContentHeight(k)));
  }, skip: liveSkip);

  test('Tabellen: Zelle, Zeile, Kopfbereich – Höhe = Rechnung der App', () async {
    final c = await app();
    addTearDown(c.dispose);
    final id = BoardController.newId();
    c.apply([
      CreateOp([
        {
          'id': id,
          'type': 'table',
          'x': 0,
          'y': 300,
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
      ]),
    ]);
    await until(() => c.state[id] != null);
    await act(c, 'table.setCell', {
      'id': id,
      'r': 'r2',
      'c': 'c2',
      'base': '',
      'text': 'Lena, Tom und Mira übernehmen die Bar am Freitagabend bis Mitternacht',
    });
    await until(() => safeTable(c.state[id]!).cell('r2', 'c2').startsWith('Lena'));
    var o = c.state[id]!;
    expect(o.h, tableHeight(safeTable(o), o.w, boldRow0: hasHeadRow(o)));
    expect(o.h, greaterThan(126));
    final key = BoardController.newActKey();
    final d = await act(c, 'table.addRow', {'id': id, 'after': 'r1'}, key: key);
    expect((d.result!.data as Map)['row'], '$key-1');
    await until(() => safeTable(c.state[id]!).rows.length == 4);
    expect(safeTable(c.state[id]!).rows, ['r1', '$key-1', 'r2', 'r3']);
    await act(c, 'table.setHead', {'id': id, 'head': 'both'});
    await until(() => c.state[id]!.tableHead == 'both');
    o = c.state[id]!;
    expect(o.h, tableHeight(safeTable(o), o.w, boldRow0: true));
  }, skip: liveSkip);

  test('Vorlage einfügen und „Einfügen als …“: das Web hat die Objekte, ausgewählt sind die neuen', () async {
    final c = await app();
    addTearDown(c.dispose);
    final peer = await WebPeer.start();
    addTearDown(peer.close);
    await peer.cmd({'cmd': 'open', 'board': boardId});
    final key = BoardController.newActKey();
    final d = await act(c, 'structure.template', {'template': 'kanban', 'x': 3000, 'y': 3000}, key: key);
    final want = tm.boardTemplates.firstWhere((t) => t.id == 'kanban').contains.values.fold<int>(0, (a, b) => a + b);
    expect(d.result!.select, hasLength(want));
    final rect = (d.result!.data as Map)['rect'] as Map;
    expect((rect['x'] as num) + (rect['w'] as num) / 2, closeTo(3000, 1));
    await untilAsync(() async => (await peer.object('$key-$want')) != null);
    expect(c.state['$key-1']!.type, 'frame');
    final p = BoardController.newActKey();
    final pd = await act(c, 'structure.paste', {
      'text': 'Bereich\tFr\nBar\tLena',
      'as': 'table',
      'x': -2000,
      'y': 0,
      'color': '#9fd3ff',
    }, key: p);
    expect(pd.result!.select, ['$p-1']);
    await until(() => c.state['$p-1'] != null);
    expect(
      safeTable(c.state['$p-1']!).cell(safeTable(c.state['$p-1']!).rows[1], safeTable(c.state['$p-1']!).cols[1]),
      'Lena',
    );
  }, skip: liveSkip);
}
