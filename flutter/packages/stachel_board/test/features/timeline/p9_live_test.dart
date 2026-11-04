// P9 live: the timeline web actions against the real Stachel server in its sandbox – a timeline created by the app
// (the web has it), items added/moved/toggled/titled, lanes added/named/moved, unit and range, the side handle as update,
// a note dropped onto a lane; after every action the size the server wrote equals the app's own computation.
//
//   cd stachel && npm --prefix server run build
//   server\node_modules\.bin\tsx.cmd tools/sandbox.mts 8750 --seed
//   flutter test test/features/timeline/p9_live_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8750
//
// Skipped without STACHEL_SANDBOX (or without the stachel repo for the web side).
@Tags(['live'])
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/timeline/timeline_model.dart';

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
      body: {'title': 'P9 live ${DateTime.now().toIso8601String()}'},
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
      appVersion: '1.25.0+34',
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

  /// The server's size = the app's computation (same layout, same scale).
  void sameSize(BoardController c, String id) {
    final o = c.state[id]!;
    final l = tlLayoutFor(o.raw, tlToday());
    final s = tlSizeFor(tlScaleOf(o.w, l), l);
    expect((o.w, o.h), (s.w, s.h), reason: 'Größe wie die App sie rechnet');
  }

  Map<String, Object?> items(BoardController c, String id) =>
      ((c.state[id]!.raw['timeline']! as Map)['items']! as Map).cast<String, Object?>();

  test('Zeitleiste: anlegen, Einträge, Spuren, Skala, Zeitraum, Seitengriff, Notiz auf Spur', () async {
    final c = await app();
    addTearDown(c.dispose);
    final peer = await WebPeer.start();
    addTearDown(peer.close);
    await peer.cmd({'cmd': 'open', 'board': boardId});
    for (final n in [
      'addItem',
      'patchItem',
      'setDay',
      'removeItem',
      'setTitle',
      'addLane',
      'setLaneName',
      'moveLane',
      'removeLane',
      'setRange',
      'setUnit',
      'adopt',
    ]) {
      expect(c.canAct('timeline.$n'), isTrue, reason: n);
    }
    final id = BoardController.newId();
    final start = tlParseDay('2026-11-02')!;
    c.apply([
      CreateOp([
        {'id': id, ...tlNewTimeline(800, 400, tlToday(), start: start, end: start + 55)},
      ]),
    ]);
    await untilAsync(() async => (await peer.object(id)) != null);
    expect(((await peer.object(id))!['timeline'] as Map)['lanes'], ['l1', 'l2', 'l3']);
    // Eintrag mit fester ID, überlappender zweiter → zweite Zeile, Größe wie die App rechnet
    await act(c, 'timeline.addItem', {'id': id, 'lane': 'l1', 'start': '2026-11-04', 'end': '2026-11-10'}, key: 'pa');
    await act(c, 'timeline.addItem', {'id': id, 'lane': 'l1', 'start': '2026-11-06', 'end': '2026-11-07'}, key: 'pb');
    await until(() => items(c, id).containsKey('pb-1'));
    sameSize(c, id);
    expect(tlLayoutFor(c.state[id]!.raw, tlToday()).lanes.first.rows, 2);
    await act(c, 'timeline.setTitle', {'id': id, 'key': 'pa-1', 'base': '', 'text': 'Bühne aufbauen'});
    await act(c, 'timeline.patchItem', {'id': id, 'key': 'pb-1', 'start': '2026-11-12', 'end': '2026-11-13', 'lane': 'l2'});
    await act(c, 'timeline.patchItem', {'id': id, 'key': 'pa-1', 'ms': true});
    await until(() => (items(c, id)['pa-1']! as Map)['ms'] == true);
    expect(items(c, id)['pa-1'], {'lane': 'l1', 'start': '2026-11-04', 'end': '2026-11-04', 'title': 'Bühne aufbauen', 'ms': true});
    sameSize(c, id);
    final web = (await peer.object(id))!;
    expect(((web['timeline'] as Map)['items'] as Map)['pb-1'], containsPair('lane', 'l2'));
    // Spuren
    await act(c, 'timeline.addLane', {'id': id, 'after': 'l1'}, key: 'pl');
    await act(c, 'timeline.setLaneName', {'id': id, 'lane': 'pl-1', 'base': '', 'text': 'Technik'});
    await act(c, 'timeline.moveLane', {'id': id, 'lane': 'l3', 'to': 0});
    await until(() => ((c.state[id]!.raw['timeline']! as Map)['lanes'] as List).first == 'l3');
    expect((c.state[id]!.raw['timeline']! as Map)['lanes'], ['l3', 'l1', 'pl-1', 'l2']);
    expect(((c.state[id]!.raw['timeline']! as Map)['names'] as Map)['pl-1'], 'Technik');
    sameSize(c, id);
    // Skala und Zeitraum
    await act(c, 'timeline.setUnit', {'id': id, 'unit': 'day'});
    await until(() => c.state[id]!.raw['tlUnit'] == 'day');
    sameSize(c, id);
    await act(c, 'timeline.addItem', {'id': id, 'lane': 'l2', 'start': '2027-02-01', 'end': '2027-02-02'}, key: 'pc');
    await act(c, 'timeline.setRange', {'id': id, 'extend': 'after'});
    await until(() => c.state[id]!.raw['tlEnd'] == '2027-02-02');
    sameSize(c, id);
    // Seitengriff: die App schreibt Zeitraum und Größe selbst (update), der Server nimmt es an
    final o = c.state[id]!;
    final patch = tlResize(o, {'x': o.x, 'y': o.y, 'w': o.w - 40 * 10, 'h': o.h}, 'e', tlToday());
    c.apply([
      UpdateOp({id: patch}),
    ]);
    await untilAsync(() async => (await peer.object(id))?['tlEnd'] == patch['tlEnd']);
    expect((await peer.object(id))!['w'], patch['w']);
    // Haftnotiz auf Spur l2 („‹“: Tag 3 = 5.11.) → Eintrag
    final l = tlLayoutFor(c.state[id]!.raw, tlToday());
    final lane = l.lanes.firstWhere((x) => x.id == 'l2');
    final w = tlToWorldRect(c.state[id]!, l, tlLabelW + 3.5 * l.dayPx, lane.y + lane.h / 2, 0, 0);
    final n = BoardController.newId();
    c.apply([
      CreateOp([
        {'id': n, 'type': 'sticky', 'x': w.x - 100, 'y': w.y - 100, 'w': 200, 'h': 200, 'text': 'Soundcheck', 'color': '#ffd08a'},
      ]),
    ]);
    final d = await act(c, 'timeline.adopt', {
      'ids': [n],
    }, key: 'pd');
    expect(d.result?.toast, 'Als Eintrag in die Zeitleiste übernommen');
    await until(() => c.state[n] == null && items(c, id).containsKey('pd-1'));
    expect(items(c, id)['pd-1'], {'lane': 'l2', 'start': '2026-11-05', 'end': '2026-11-05', 'title': 'Soundcheck', 'color': '#ffd08a'});
    await untilAsync(() async => (await peer.object(n)) == null);
    // Rückgängig holt die Notiz zurück
    c.undo();
    await until(() => c.state[n] != null);
    // löschen
    await act(c, 'timeline.removeItem', {'id': id, 'key': 'pb-1'});
    await act(c, 'timeline.removeLane', {'id': id, 'lane': 'pl-1'});
    await until(() => !items(c, id).containsKey('pb-1'));
    sameSize(c, id);
  }, skip: liveSkip);
}
