// Mind maps live against the real Stachel server in its sandbox (contract §8.6 `mind`): the app edits a mind map
// with BoardEditor over NativeBoardSource, the server runs the web's mind map code. Checks: the prediction the app shows
// at once is exactly what the server writes (no jump on ack), a web client (`stachel/tools/web-peer.mts`) sees the
// same, and a map the web side writes shows up in the app.
//
//   cd stachel && npm --prefix server run build
//   server\node_modules\.bin\tsx.cmd tools/sandbox.mts 8600 --seed
//   flutter test test/native_mind_live_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8600
// (browser side incl. the web's own layout: stachel `e2e/tests/native-mind.spec.ts`)
@Tags(['live'])
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import 'sample_mindmap.dart';

const _sandbox = String.fromEnvironment('STACHEL_SANDBOX');
const _repoDefine = String.fromEnvironment('STACHEL_REPO', defaultValue: '../../../stachel');

final _repo = Directory(_repoDefine).absolute.path;
final _haveRepo = File('$_repo/tools/web-peer.mts').existsSync();
final _skip = _sandbox.isEmpty
    ? 'STACHEL_SANDBOX fehlt'
    : !_haveRepo
    ? 'Stachel-Repo nicht gefunden ($_repo)'
    : null;

Future<Object?> _http(String method, String url, {String? bearer, Object? body, bool write = false}) async {
  final client = HttpClient();
  try {
    final req = await client.openUrl(method, Uri.parse(url));
    if (bearer != null) req.headers.set('Authorization', 'Bearer $bearer');
    if (write) req.headers.set('X-Stachel', '1');
    if (body != null) {
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode(body));
    }
    final res = await req.close();
    final text = await res.transform(utf8.decoder).join();
    if (res.statusCode >= 300) throw HttpException('$method $url → ${res.statusCode} $text');
    return text.isEmpty ? null : jsonDecode(text);
  } finally {
    client.close();
  }
}

Future<Duration> _until(bool Function() cond, {Duration timeout = const Duration(seconds: 10)}) async {
  final sw = Stopwatch()..start();
  while (!cond()) {
    if (sw.elapsed > timeout) throw TimeoutException('Bedingung nicht erfüllt nach $timeout');
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
  return sw.elapsed;
}

Future<void> _untilAsync(Future<bool> Function() cond, {Duration timeout = const Duration(seconds: 10)}) async {
  final sw = Stopwatch()..start();
  while (!await cond()) {
    if (sw.elapsed > timeout) throw TimeoutException('Bedingung nicht erfüllt nach $timeout');
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
}

/// `tools/web-peer.mts`: a browser-like Yjs client, one JSON command per line.
class _WebPeer {
  _WebPeer._(this._process, this._lines);

  final Process _process;
  final Stream<Map<String, Object?>> _lines;
  var _id = 0;

  static Future<_WebPeer> start({String login = 'jonas'}) async {
    final tsx = Platform.isWindows
        ? '$_repo\\server\\node_modules\\.bin\\tsx.cmd'
        : '$_repo/server/node_modules/.bin/tsx';
    final p = await Process.start(
      tsx,
      ['tools/web-peer.mts', _sandbox, login],
      workingDirectory: _repo,
      runInShell: Platform.isWindows,
    );
    p.stderr.transform(utf8.decoder).listen((e) => stderr.write('[web-peer] $e'));
    final lines = p.stdout
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .where((l) => l.startsWith('{'))
        .map((l) => (jsonDecode(l) as Map).cast<String, Object?>())
        .asBroadcastStream();
    await lines.firstWhere((m) => m['ready'] == true).timeout(const Duration(seconds: 30));
    return _WebPeer._(p, lines);
  }

  Future<Map<String, Object?>> cmd(Map<String, Object?> c) async {
    final id = ++_id;
    final answer = _lines.firstWhere((m) => m['id'] == id).timeout(const Duration(seconds: 20));
    _process.stdin.writeln(jsonEncode({...c, 'id': id}));
    final m = await answer;
    if (m['ok'] != true) throw StateError('web-peer: ${m['error']}');
    return m;
  }

  Future<Map<String, Object?>?> object(String id) async =>
      ((await cmd({'cmd': 'get', 'obj': id}))['object'] as Map?)?.cast<String, Object?>();

  Future<(Map<String, Object?>?, String?)> content(String id) async {
    final m = await cmd({'cmd': 'content', 'obj': id});
    return ((m['content'] as Map?)?.cast<String, Object?>(), m['text'] as String?);
  }

  Future<void> close() async {
    try {
      await cmd({'cmd': 'close'});
    } catch (_) {}
    _process.kill();
  }
}

/// Layout fields of all mind nodes.
Map<String, List<Object?>> _layout(BoardState s) => {
  for (final o in s.objects.values)
    if (o.type == 'mindnode') o.id: [o.x, o.y, o.w, o.h, o.text, o.color, jsonEncode(_sorted(o.raw['mind']))],
};

Object? _sorted(Object? v) =>
    v is Map ? {for (final k in (v.keys.map((k) => '$k').toList()..sort())) k: _sorted(v[k])} : v;

void main() {
  late String boardId;

  Future<String> newSession(String who) async =>
      ((await _http('POST', '$_sandbox/api/auth/app-session', bearer: 'sandbox-$who', body: {}))! as Map)['token']
          as String;

  setUpAll(() async {
    if (_skip != null) return;
    final t = await newSession('mara');
    final b = await _http(
      'POST',
      '$_sandbox/api/boards',
      bearer: t,
      write: true,
      body: {'title': 'Mindmap live ${DateTime.now().toIso8601String()}'},
    );
    boardId = ((b! as Map)['board'] as Map)['id'] as String;
  });

  Future<(BoardController, BoardEditor)> app() async {
    String? t;
    final source = NativeBoardSource(
      base: Uri.parse(_sandbox),
      board: boardId,
      token: ({bool fresh = false}) async {
        if (fresh || t == null) t = await newSession('mara');
        return t!;
      },
      appVersion: '1.24.0+33',
      retryDelays: const [Duration(milliseconds: 100)],
    );
    final c = BoardController(source, presenceInterval: const Duration(milliseconds: 30));
    final editor = BoardEditor(controller: c, scene: BoardScene(c.state), camera: CameraController());
    await c.start();
    await _until(() => c.loaded && c.canEdit);
    return (c, editor);
  }

  /// Runs [action], takes what the app shows right away (prediction), waits for the server and compares.
  Future<void> predicted(BoardController c, void Function() action, {String? why}) async {
    action();
    final shown = _layout(c.state);
    await _until(() => c.pendingCount == 0);
    expect(_layout(c.confirmed), shown, reason: why);
  }

  test(
    'Vorhersage der App = Ergebnis des Servers (Web-Code): Vorlage, Unterthema, gleiche Ebene, Text, Einklappen, Ziehen, Löschen',
    () async {
      final (c, e) = await app();
      final web = await _WebPeer.start();
      addTearDown(() async {
        await web.close();
        e.dispose();
        c.dispose();
      });
      await web.cmd({'cmd': 'open', 'board': boardId});
      expect(c.features, contains('mind'));

      late String root;
      await predicted(
        c,
        () => root = e.createMindMap(const Offset(400, 300), template: sampleMindmap)!,
        why: 'Vorlage',
      );
      expect(_layout(c.confirmed).length, 16);
      final prog = '$root-1', bands = '$root-2', orga = '$root-5', technik = '$root-9';

      late String n1;
      await predicted(c, () => n1 = e.mindChild(orga)!, why: 'Unterthema');
      e.textChanged('Getränke und Essen für alle Helfer:innen');
      await _until(() => c.pendingCount == 0 && c.confirmed[n1]?.text == 'Getränke und Essen für alle Helfer:innen');
      expect(_layout(c.confirmed), _layout(c.state), reason: 'Text: Umbruch und Größe wie der Server');
      late String n2;
      await predicted(c, () => n2 = e.mindSibling(n1)!, why: 'gleiche Ebene (aus dem Schreiben heraus)');
      e.textChanged('Kasse');
      await _until(() => c.pendingCount == 0 && c.confirmed[n2]?.text == 'Kasse');
      await predicted(c, () => e.stopEditing(), why: 'fertig');
      await predicted(c, () => e.mindChild(root, side: 'l'), why: 'Unterthema links an der Wurzel');
      await predicted(c, () => e.stopEditing(), why: 'leer gelassen → weg');
      await predicted(c, () => e.mindCollapse(technik, true), why: 'einklappen');
      expect(c.confirmed['$root-10']!.mind.hidden, isTrue);

      // Bands auf Orga ziehen
      e.select({bands});
      final b = c.state[bands]!, o = c.state[orga]!;
      await predicted(c, () {
        e.dragStart(Offset(b.x + 5, b.y + 5));
        e.dragUpdate(Offset(o.x + 10, o.y + 10));
        e.dragEnd();
      }, why: 'umhängen');
      expect(c.confirmed[bands]!.mind.parent, orga);
      // Wurzel ziehen nimmt alles mit
      e.select({root});
      final r = c.state[root]!;
      await predicted(c, () {
        e.dragStart(Offset(r.x + 5, r.y + 5));
        e.dragUpdate(Offset(r.x + 125, r.y + 65));
        e.dragEnd();
      }, why: 'Wurzel verschieben');
      await predicted(c, () {
        e.select({prog});
        e.deleteSelection();
      }, why: 'löschen mit Unterthemen');
      expect(c.confirmed['$root-3'], isNull);

      // die Web-Seite hat denselben Stand
      for (final id in [root, n1, n2, orga, bands]) {
        final w = (await web.object(id))!;
        final a = c.confirmed[id]!;
        expect([w['x'], w['y'], w['w'], w['h'], w['text']], [a.x, a.y, a.w, a.h, a.text], reason: id);
      }

      // Rückgängig nimmt das Löschen samt Layout zurück
      c.undo();
      await _until(() => c.pendingCount == 0 && c.confirmed[prog] != null);
      expect(c.confirmed['$root-3'], isNotNull);
    },
    skip: _skip,
  );

  test(
    'Web legt eine Mindmap an (wie der Browser samt Layout) → die App zeigt sie, Unterthema an einem Knoten des Web',
    () async {
      final (c, e) = await app();
      final web = await _WebPeer.start();
      addTearDown(() async {
        await web.close();
        e.dispose();
        c.dispose();
      });
      await web.cmd({'cmd': 'open', 'board': boardId});
      // der Browser schreibt Lage, Größe und `mind` aller Knoten selbst (Web-Laufzeit); hier dieselben Werte
      final plan = MindPlanner.fromRaw(const [])
        ..tree('w', -800, 0, const MindTreeSpec('Web', children: [MindTreeSpec('Eins'), MindTreeSpec('Zwei')]));
      for (final n in plan.nodes) {
        await web.cmd({
          'cmd': 'create',
          'object': {...n, 'z': 'zz${n['id']}'},
        });
      }
      await _until(() => c.state['w-2'] != null);
      expect(c.state['w-1']!.mind.level, 1);
      expect(e.isMindRootNode('w'), isTrue);
      await predicted(c, () => e.mindChild('w-2'), why: 'Unterthema an einem Knoten aus dem Web');
      final kid = c.confirmed.objects.values.singleWhere((o) => o.mind.parent == 'w-2');
      await _untilAsync(() async => (await web.object(kid.id))?['x'] == kid.x);
    },
    skip: _skip,
  );
}
