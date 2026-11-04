// P5 live against the real Stachel server in its sandbox: voting and timer run on the server with the web's code
// (`collab.vote.*`, `collab.timer.*`, results with the server time), the web (`tools/web-peer.mts`) sees the same
// structures; presence fields of the app (status, follow, laser with stroke starts, cursor chat) reach the web's
// awareness and the web's (viewport, summon) reach the app.
//
//   cd stachel && npm --prefix server run build
//   server\node_modules\.bin\tsx.cmd tools/sandbox.mts 8720 --seed
//   flutter test test/features/follow/p5_live_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8720
//
// Skipped without STACHEL_SANDBOX (or without the stachel repo for the web side).
@Tags(['live'])
library;

import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

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
      body: {'title': 'P5 live ${DateTime.now().toIso8601String()}'},
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
      appVersion: '1.26.0+35',
      retryDelays: const [Duration(milliseconds: 100)],
    );
    final c = BoardController(source, presenceInterval: const Duration(milliseconds: 30));
    c.notices.listen((n) => printOnFailure('Hinweis ${n.kind}: ${n.error} ${n.message}'));
    await c.start();
    await until(() => c.loaded && c.canEdit);
    return c;
  }

  test(
    'Abstimmung und Timer: Server rechnet mit dem Web-Code, das Web sieht Sitzung, Stimme mit Namen, Timer',
    () async {
      final c = await app();
      addTearDown(c.dispose);
      final peer = await WebPeer.start(login: 'jonas');
      addTearDown(peer.close);
      await peer.cmd({'cmd': 'open', 'board': boardId});
      for (final a in [
        'collab.vote.start',
        'collab.vote.cast',
        'collab.vote.end',
        'collab.vote.close',
        'collab.timer.start',
      ]) {
        expect(c.canAct(a), isTrue, reason: a);
      }
      final id = 'p5n${DateTime.now().microsecondsSinceEpoch}';
      c.apply([
        CreateOp([
          {'id': id, 'type': 'sticky', 'x': 9000, 'y': 9000, 'w': 200, 'h': 200, 'color': '#fff27a', 'text': 'Bühne'},
        ]),
      ]);
      c.closeStep();
      await until(() => c.confirmed[id] != null);

      final start = await c
          .act('collab.vote.start', {
            'title': 'Live?',
            'perPerson': 2,
            'minutes': 1,
            'multi': false,
            'anonymous': false,
          })
          .timeout(const Duration(seconds: 10));
      expect(start.ok, isTrue, reason: '${start.error} ${start.message}');
      final now = ((start.result!.data! as Map)['now'] as num).toInt();
      expect((now - DateTime.now().millisecondsSinceEpoch).abs(), lessThan(60000));
      final s = readVoteSession(c.state.ext['collab.vote'])!;
      expect((s.title, s.perPerson, s.startedBy.isNotEmpty, s.endsAt! - s.startedAt), ('Live?', 2, true, 60000));
      await untilAsync(
        () async => ((await peer.cmd({'cmd': 'ext', 'name': 'collab.vote'}))['value'] as Map?)?['session'] != null,
      );

      final cast = await c.act('collab.vote.cast', {'objectId': id, 'delta': 1}).timeout(const Duration(seconds: 10));
      expect((cast.result!.data! as Map)['outcome'], 'added');
      await untilAsync(() async {
        final v = (await peer.cmd({'cmd': 'ext', 'name': 'collab.votes'}))['value'];
        return v is Map && v.values.any((e) => e is Map && e['n'] == 1 && e['name'] is String);
      });
      expect(tally(readVoteKeys(c.state.ext['collab.votes']), s.id).ranking.single.objectId, id);
      await c.act('collab.vote.end', const {}).timeout(const Duration(seconds: 10));
      expect(readVoteSession(c.state.ext['collab.vote'])!.ended, isTrue);
      await c.act('collab.vote.close', const {}).timeout(const Duration(seconds: 10));
      expect(readVoteHistory(c.state.ext['collab.voteHistory']).first.ranking.single.objectId, id);

      final t = await c.act('collab.timer.start', {'ms': 120000}).timeout(const Duration(seconds: 10));
      expect((t.result!.data! as Map)['state'], 'running');
      await untilAsync(() async {
        final v = (await peer.cmd({'cmd': 'ext', 'name': 'collab.timer'}))['value'];
        return v is Map && (v['timer'] as Map?)?['state'] == 'running';
      });
      expect(readTimer(c.state.ext['collab.timer']).duration, 120000);
      await c.act('collab.timer.stop', const {}).timeout(const Duration(seconds: 10));
      expect(readTimer(c.state.ext['collab.timer']).state, TimerRun.idle);
    },
    skip: liveSkip,
  );

  test('Anwesenheit: Status, Folgen, Laser (mit g), Kurznachricht beim Web; Ausschnitt und Herholen vom Web', () async {
    final c = await app();
    addTearDown(c.dispose);
    final peer = await WebPeer.start(login: 'jonas');
    addTearDown(peer.close);
    await peer.cmd({'cmd': 'open', 'board': boardId});
    await until(() => c.peers.isNotEmpty);
    final jonas = c.peers.first.key;
    final laser = (LaserSender()..begin()).add(const Offset(10, 20));
    c.presence
      ..setExtra('collab.status', 'away', immediate: true)
      ..setExtra('collab.follow', jonas, immediate: true)
      ..setExtra('collab.laser', laser, immediate: true)
      ..setExtra('collab.chat', {'text': 'Hallo', 'typing': true}, immediate: true);
    Map? mine;
    await untilAsync(() async {
      final peers = (await peer.cmd({'cmd': 'peers'}))['peers'];
      for (final p in peers is List ? peers : const []) {
        final st = p is Map ? p['state'] : null;
        if (st is Map && st['client'] == 'app' && st['collab.chat'] != null) mine = st;
      }
      return mine != null;
    });
    expect(mine!['collab.status'], 'away');
    expect(mine!['collab.follow'], jonas);
    expect(mine!['collab.laser'], {
      's': 1,
      'p': [10, 20],
      'g': [1],
    });
    expect(mine!['collab.chat'], {'text': 'Hallo', 'typing': true});
    expect(mine!['collab.viewport'], isNull, reason: 'App ohne Ausschnitt (kein View im Test)');

    final ts = DateTime.now().millisecondsSinceEpoch;
    await peer.cmd({
      'cmd': 'awareness',
      'fields': {
        'collab.viewport': {'x': 100, 'y': 200, 'w': 1200, 'h': 800},
        'collab.summon': {
          'id': 'live1',
          'rect': {'x': 1, 'y': 2, 'w': 3, 'h': 4},
          'ts': ts,
        },
        'collab.follow': 'a:mara',
      },
    });
    await until(() => c.peers.any((p) => p.extra['collab.summon'] != null));
    final p = c.peers.firstWhere((p) => p.extra['collab.summon'] != null);
    expect(awRect(p.extra['collab.viewport']), const Rect.fromLTWH(100, 200, 1200, 800));
    expect((p.extra['collab.summon']! as Map)['id'], 'live1');
    expect(p.extra['collab.follow'], 'a:mara');
  }, skip: liveSkip);
}

/// Votes of `collab.votes` (key → n).
Map<String, int> readVoteKeys(Object? ext) => {
  if (ext is Map)
    for (final e in ext.entries)
      if (e.key is String && e.value is Map && (e.value as Map)['n'] is num)
        e.key as String: ((e.value as Map)['n'] as num).toInt(),
};
