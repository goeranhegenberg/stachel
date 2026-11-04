// Q3 live: Clustern, Suchen & Ersetzen und Typ wechseln against the real Stachel server in its sandbox – the app asks
// (`tools.cluster`, `tools.replace`, `tools.convert`), the server runs the web code, the app and the web
// (`tools/web-peer.mts`) see the same result; undo takes each back in one step.
//
//   cd stachel && npm --prefix server run build
//   server\node_modules\.bin\tsx.cmd tools/sandbox.mts 8866 --seed
//   flutter test test/features/commands/q3_live_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8866
//     --dart-define=STACHEL_REPO=<stachel-Repo>
//
// Skipped without STACHEL_SANDBOX (or without the stachel repo for the web side).
@Tags(['live'])
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_board/src/features/commands/commands_model.dart';

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
      body: {'title': 'Q3 live ${DateTime.now().toIso8601String()}'},
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
      appVersion: '1.25.0+1',
      retryDelays: const [Duration(milliseconds: 100)],
    );
    final c = BoardController(source, presenceInterval: const Duration(milliseconds: 30));
    c.notices.listen((n) => printOnFailure('Hinweis ${n.kind}: ${n.error} ${n.message}'));
    return c;
  }

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

  test('Clustern, Ersetzen, Typ wechseln: Server rechnet mit dem Web-Code, Web sieht dasselbe', () async {
    final c = await app();
    addTearDown(c.dispose);
    final peer = await WebPeer.start();
    addTearDown(peer.close);
    await peer.cmd({'cmd': 'open', 'board': boardId});
    await c.start();
    await until(() => c.loaded && c.canEdit);
    for (final n in ['tools.cluster', 'tools.replace', 'tools.convert']) {
      expect(c.canAct(n), isTrue, reason: n);
    }
    final p = 'q${BoardController.newActKey().substring(0, 6)}';
    c.apply([
      CreateOp([
        sticky('${p}a', 0, 0, {'color': '#fff27a', 'text': 'Bühne aufbauen'}),
        sticky('${p}b', 150, 0, {'color': '#ffb3d1', 'text': 'Bar'}),
        sticky('${p}c', 300, 0, {'color': '#fff27a', 'text': 'Bühne abbauen'}),
        sticky('${p}l', 900, 900, {'locked': true, 'text': 'Bühne'}),
      ]),
    ]);
    await until(() => !c.hasPending('${p}l'));
    final ids = ['${p}a', '${p}b', '${p}c'];

    // Clustern nach Farbe: Gelb (a, c: round(√2) = 1 Spalte) links mit Überschrift, Rosa (b) rechts daneben
    final key = 'cl${p.substring(1)}';
    var d = await c.act('tools.cluster', {'ids': ids, 'by': 'color'}, key: key).timeout(const Duration(seconds: 10));
    expect(d.ok, isTrue, reason: '${d.error} ${d.message}');
    expect((d.result!.data! as Map)['groups'], 2);
    await until(() => c.state['$key-2'] != null);
    expect(c.state['$key-1']!.raw['text'], 'Gelb');
    expect(c.state['$key-2']!.raw['text'], 'Rosa');
    final labelH = (32 * 1.25).ceil() + 16;
    expect((c.state['${p}a']!.x, c.state['${p}a']!.y), (0.0, labelH.toDouble()));
    expect((c.state['${p}c']!.x, c.state['${p}c']!.y), (0.0, labelH + 124.0));
    expect(c.state['${p}b']!.x, 100.0 + 120);
    expect(d.result!.select!.toSet(), {...ids, '$key-1', '$key-2'});
    await untilAsync(() async => (await peer.object('${p}b'))?['x'] == 220);
    expect((await peer.object('$key-1'))?['text'], 'Gelb');
    c.undo();
    await until(() => c.state['$key-1'] == null && c.state['${p}b']!.x == 150);

    // Suchen & Ersetzen: Vorschau in der App = Ergebnis des Servers; Gesperrtes bleibt
    final hits = [...ids, '${p}l'];
    final preview = replacePreview([for (final id in hits) c.state[id]!], 'buehne');
    expect((preview.total, preview.objects, preview.locked), (2, 2, 1));
    d = await c
        .act('tools.replace', {'ids': hits, 'query': 'buehne', 'replace': 'Theke'})
        .timeout(const Duration(seconds: 10));
    expect(d.result!.data, {
      'replaced': 2,
      'changed': ['${p}a', '${p}c'],
      'locked': 1,
    });
    expect(d.result!.toast, '2 Stellen ersetzt. 1 in gesperrten Objekten nicht ersetzt.');
    await until(() => c.state['${p}a']!.raw['text'] == 'Theke aufbauen');
    expect(c.state['${p}l']!.raw['text'], 'Bühne');
    await untilAsync(() async => (await peer.object('${p}c'))?['text'] == 'Theke abbauen');
    c.undo();
    await until(
      () => c.state['${p}a']!.raw['text'] == 'Bühne aufbauen' && c.state['${p}c']!.raw['text'] == 'Bühne abbauen',
    );

    // Typ wechseln: Notiz → Form (gleiche ID, Farbe und Text bleiben) → Karte
    d = await c
        .act('tools.convert', {
          'ids': ['${p}b'],
          'to': 'shape',
        })
        .timeout(const Duration(seconds: 10));
    expect(d.result!.select, ['${p}b']);
    await until(() => c.state['${p}b']!.type == 'shape');
    expect(
      (c.state['${p}b']!.raw['shape'], c.state['${p}b']!.color, c.state['${p}b']!.raw['text']),
      ('rect', '#ffb3d1', 'Bar'),
    );
    await untilAsync(() async => (await peer.object('${p}b'))?['type'] == 'shape');
    await c
        .act('tools.convert', {
          'ids': ['${p}b'],
          'to': 'card',
        })
        .timeout(const Duration(seconds: 10));
    await until(() => c.state['${p}b']!.type == 'card');
    expect((c.state['${p}b']!.w, c.state['${p}b']!.color), (300.0, '#1763b5'));
    await untilAsync(() async => (await peer.object('${p}b'))?['type'] == 'card');
    c.undo();
    await until(() => c.state['${p}b']!.type == 'shape');
    c.undo();
    await until(() => c.state['${p}b']!.type == 'sticky' && c.state['${p}b']!.raw['shape'] == null);
  }, skip: liveSkip);
}
