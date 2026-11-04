// E1 acceptance against the real Stachel server in its sandbox (concept §6.4, contract §8): a web client (Hocuspocus
// like the browser, `stachel/tools/web-peer.mts`) and the app's NativeBoardSource on the same board.
//
//   cd stachel && npm --prefix server run build
//   server\node_modules\.bin\tsx.cmd tools/sandbox.mts 8600 --seed
//   flutter test test/native_cross_client_live_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8600
//     [--dart-define=STACHEL_REPO=<path to the stachel repo>]   (default ../../../stachel)
//
// - web edits (create, move, rich change) arrive in the app in ≤ 1 s and render (painter over the new state),
// - presence both ways: the web's cursor/selection in the app, the app's viewport/selection in the web as the person
//   itself (`client: app`, not an AI),
// - connection lost while the web edits → reconnect with `resume` → `resumed` with exactly the missing patches
//   (no new snapshot), also from a cached state in a new controller (offline cache → resume),
// - 4401: a rejected token gets a fresh one once; logging the session out on the server reconnects with a new one,
// - renaming the board while it is open (`board.renamed`).
// Skipped without STACHEL_SANDBOX (or without the stachel repo for the web side).
@Tags(['live'])
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

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

/// `tools/web-peer.mts`: a browser-like Yjs client, one JSON command per line.
class _WebPeer {
  _WebPeer._(this._process, this._lines);

  final Process _process;
  final Stream<Map<String, Object?>> _lines;
  var _id = 0;

  static Future<_WebPeer> start({String login = 'jonas'}) async {
    final tsx = Platform.isWindows ? '$_repo\\server\\node_modules\\.bin\\tsx.cmd' : '$_repo/server/node_modules/.bin/tsx';
    final p = await Process.start(tsx, [
      'tools/web-peer.mts',
      _sandbox,
      login,
    ], workingDirectory: _repo, runInShell: Platform.isWindows);
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

  Future<void> close() async {
    try {
      await cmd({'cmd': 'close'});
    } catch (_) {}
    _process.kill();
  }
}

void main() {
  late List<Map<String, Object?>> boards;
  late String boardId;

  Future<String> newSession(String who) async =>
      ((await _http('POST', '$_sandbox/api/auth/app-session', bearer: 'sandbox-$who', body: {}))! as Map)['token']
          as String;

  setUpAll(() async {
    if (_skip != null) return;
    final t = await newSession('mara');
    boards = (((await _http('GET', '$_sandbox/api/boards', bearer: t))! as Map)['boards'] as List)
        .cast<Map<String, Object?>>();
    boardId = boards.firstWhere((b) => b['title'] == 'Alle Typen')['id'] as String;
  });

  /// App side as Mara; [connect] lets a test cut the network.
  (NativeBoardSource, BoardController, List<ServerMessage>) app({
    StachelTokenProvider? token,
    WebSocketConnector? connect,
    List<Duration> retry = const [Duration(milliseconds: 100)],
  }) {
    String? t;
    final source = NativeBoardSource(
      base: Uri.parse(_sandbox),
      board: boardId,
      token:
          token ??
          ({bool fresh = false}) async {
            if (fresh || t == null) t = await newSession('mara');
            return t!;
          },
      appVersion: '1.22.0+31',
      connect: connect,
      retryDelays: retry,
    );
    final c = BoardController(source, presenceInterval: const Duration(milliseconds: 50));
    final seen = <ServerMessage>[];
    source.messages.listen(seen.add);
    return (source, c, seen);
  }

  /// Draws the board around [id] like the app does (painter + scene over the controller's state).
  void paintAround(BoardController c, String id) {
    final o = c.state[id]!;
    final scene = BoardScene(c.state)..sync();
    final stats = PaintStats();
    final painter = BoardPainter(
      ctx: RenderContext(scene: scene, text: TextLayoutCache(), fonts: const BoardFonts(), images: NoBoardImages()),
      camera: ValueNotifier(Camera(200 - o.x, 200 - o.y, 1)),
      selection: ValueNotifier(const {}),
      repaint: c,
      stats: stats,
    );
    final rec = ui.PictureRecorder();
    painter.paint(Canvas(rec), const Size(800, 600));
    rec.endRecording().dispose();
    painter.dispose();
    expect(scene.visible(Rect.fromLTWH(o.x - 10, o.y - 10, o.w + 20, o.h + 20)).map((v) => v.id), contains(id));
    expect(stats.visible, greaterThan(0));
  }

  test('Web ändert → App hat es in ≤ 1 s und zeichnet es (anlegen, verschieben, Text)', () async {
    final (_, c, _) = app();
    final web = await _WebPeer.start();
    addTearDown(() async {
      await web.close();
      c.dispose();
    });
    await c.start();
    await web.cmd({'cmd': 'open', 'board': boardId});
    await _until(() => c.loaded);
    final id = 'web_live_${DateTime.now().microsecondsSinceEpoch}';
    final times = <String, Duration>{};

    var sw = Stopwatch()..start();
    await web.cmd({
      'cmd': 'create',
      'object': {
        'id': id,
        'type': 'sticky',
        'x': -900,
        'y': -900,
        'w': 200,
        'h': 200,
        'z': 'zzzz',
        'color': '#fff27a',
        'text': 'Vom Web',
      },
    });
    await _until(() => c.state[id] != null);
    times['anlegen'] = sw.elapsed;
    paintAround(c, id);

    sw = Stopwatch()..start();
    await web.cmd({
      'cmd': 'set',
      'obj': id,
      'fields': {'x': -700, 'color': '#ffb3d1'},
    });
    await _until(() => c.state[id]!.x == -700);
    times['verschieben'] = sw.elapsed;
    expect(c.state[id]!.color, '#ffb3d1');

    sw = Stopwatch()..start();
    await web.cmd({
      'cmd': 'set',
      'obj': id,
      'fields': {'text': 'Geändert im Web'},
    });
    await _until(() => c.state[id]!.text == 'Geändert im Web');
    times['Text'] = sw.elapsed;
    paintAround(c, id);

    sw = Stopwatch()..start();
    await web.cmd({'cmd': 'delete', 'obj': id});
    await _until(() => c.state[id] == null);
    times['löschen'] = sw.elapsed;

    // ignore: avoid_print
    print('LIVE Web → App (Befehl an den Web-Client bis Patch in der App): '
        '${times.entries.map((e) => '${e.key} ${e.value.inMilliseconds} ms').join(', ')}');
    for (final t in times.values) {
      expect(t, lessThan(const Duration(seconds: 1)));
    }
  }, skip: _skip);

  test('Anwesenheit in beide Richtungen: Web-Cursor/Auswahl in der App, App im Web als Person (client app)', () async {
    final (_, c, _) = app();
    final web = await _WebPeer.start();
    addTearDown(() async {
      await web.close();
      c.dispose();
    });
    await web.cmd({'cmd': 'open', 'board': boardId});
    await c.start();
    await _until(() => c.loaded);

    final sw = Stopwatch()..start();
    await web.cmd({
      'cmd': 'awareness',
      'fields': {
        'cursor': {'x': 123, 'y': 456},
        'selection': ['sticky_rect'],
      },
    });
    await _until(() => c.peers.any((p) => p.key == 'a:jonas' && p.cursorX == 123 && p.cursorY == 456));
    final cursorMs = sw.elapsedMilliseconds;
    final jonas = c.peers.firstWhere((p) => p.key == 'a:jonas');
    expect(jonas.selection, ['sticky_rect']);
    expect(jonas.client, 'web');
    expect(jonas.name, 'jonas', reason: 'Name der Sitzung (Sandbox-Admin-Login)');

    c.presence.update(viewport: const Rect.fromLTWH(100, 100, 400, 800), selection: ['sticky_rect']);
    Map<String, Object?>? mine;
    for (var i = 0; i < 50 && mine == null; i++) {
      final peers = ((await web.cmd({'cmd': 'peers'}))['peers'] as List).cast<Map<String, Object?>>();
      for (final p in peers) {
        final s = (p['state'] as Map?)?.cast<String, Object?>();
        final user = (s?['user'] as Map?)?.cast<String, Object?>();
        final cursor = (s?['cursor'] as Map?)?.cast<String, Object?>();
        if (user?['key'] == 'a:mara' && s?['client'] == 'app' && cursor?['x'] == 300) mine = s;
      }
      if (mine == null) await Future<void>.delayed(const Duration(milliseconds: 20));
    }
    expect(mine, isNotNull, reason: 'Web sieht die App-Anwesenheit');
    final state = mine!;
    expect((state['user'] as Map)['name'], 'mara');
    expect(state['cursor'], {'x': 300, 'y': 500}, reason: 'Mitte des Ausschnitts');
    expect(state['selection'], ['sticky_rect']);
    expect(state['collab.viewport'], {'x': 100, 'y': 100, 'w': 400, 'h': 800});
    // ignore: avoid_print
    print('LIVE Anwesenheit: Web-Cursor nach $cursorMs ms in der App');
  }, skip: _skip);

  test('Funkloch: Web ändert, App verbindet mit resume → genau die fehlenden Patches, kein neuer Schnappschuss; '
      'auch aus dem Cache in einem neuen Controller', () async {
    WebSocket? ws;
    var offline = false;
    Future<WebSocket> connect(Uri u, Map<String, String> h) async {
      if (offline) throw const SocketException('offline (Test)');
      return ws = await WebSocket.connect(u.toString(), headers: h);
    }

    final (source, c, seen) = app(connect: connect);
    final web = await _WebPeer.start();
    addTearDown(() async {
      await web.close();
      c.dispose();
    });
    await web.cmd({'cmd': 'open', 'board': boardId});
    await c.start();
    await _until(() => c.loaded);
    final welcomes = seen.whereType<WelcomeMessage>().length;
    final revBefore = c.state.rev;

    offline = true;
    await ws!.close();
    await _until(() => source.connection.value == BoardConnection.offline);
    final x = 1000 + DateTime.now().millisecond;
    await web.cmd({
      'cmd': 'set',
      'obj': 'sticky_rect',
      'fields': {'x': x},
    });
    await Future<void>.delayed(const Duration(milliseconds: 300));
    expect(c.state['sticky_rect']!.x, isNot(x), reason: 'offline: nichts kommt an');
    expect(c.staleSince, isNotNull);

    offline = false;
    await _until(() => source.connection.value == BoardConnection.live);
    await _until(() => c.state['sticky_rect']!.x == x);
    final resumed = seen.whereType<ResumedMessage>().toList();
    expect(resumed, hasLength(1));
    expect(resumed.single.patches, isNotEmpty);
    expect(seen.whereType<WelcomeMessage>().length, welcomes, reason: 'kein neuer Schnappschuss');
    expect(c.state.rev, greaterThan(revBefore));

    // offline cache → new controller resumes from it
    final cached = c.toCache(boardId)!;
    final file = FileBoardCache(Directory.systemTemp.createTempSync('stachel_live_cache'));
    await file.save(cached);
    await web.cmd({
      'cmd': 'set',
      'obj': 'sticky_rect',
      'fields': {'x': x + 1},
    });
    final (_, c2, seen2) = app();
    addTearDown(c2.dispose);
    c2.restore((await file.load(boardId))!);
    expect(c2.fromCache, isTrue);
    await c2.start();
    await _until(() => !c2.fromCache);
    expect(seen2.first, isA<ResumedMessage>(), reason: 'gleiche Epoche → resumed statt welcome');
    await _until(() => c2.state['sticky_rect']!.x == x + 1);
    await web.cmd({
      'cmd': 'set',
      'obj': 'sticky_rect',
      'fields': {'x': 300},
    });
    await file.clear();
  }, skip: _skip);

  test('4401: abgelehntes Token → einmal ein neues; Sitzung am Server abgemeldet → neu verbunden mit neuer', () async {
    final asked = <bool>[];
    String? current;
    Future<String> token({bool fresh = false}) async {
      asked.add(fresh);
      if (asked.length == 1) return current = 'sts_kaputt';
      if (fresh || current == null || current == 'sts_kaputt') current = await newSession('mara');
      return current!;
    }

    final (source, c, seen) = app(token: token);
    addTearDown(c.dispose);
    await c.start();
    await _until(() => c.loaded);
    expect(asked, [false, true]);
    expect(source.connection.value, BoardConnection.live);
    final welcomes = seen.where((m) => m is WelcomeMessage || m is ResumedMessage).length;

    // the session ends on the server (logout elsewhere) → close 4401 → one fresh token → back (resume)
    final old = current!;
    await _http('DELETE', '$_sandbox/api/auth/app-session', bearer: old, write: true);
    await _until(() => seen.where((m) => m is WelcomeMessage || m is ResumedMessage).length > welcomes);
    expect(current, isNot(old));
    expect(asked.last, isTrue);
    expect(source.connection.value, BoardConnection.live);
    expect(source.closeReason, isNull);
  }, skip: _skip);

  test('Board umbenennen, während es offen ist → neuer Titel (board.renamed)', () async {
    final (_, c, _) = app();
    addTearDown(c.dispose);
    await c.start();
    await _until(() => c.loaded);
    final t = await newSession('jonas');
    await _http('PATCH', '$_sandbox/api/boards/$boardId', bearer: t, write: true, body: {'title': 'Alle Typen (neu)'});
    await _until(() => c.title == 'Alle Typen (neu)');
    await _http('PATCH', '$_sandbox/api/boards/$boardId', bearer: t, write: true, body: {'title': 'Alle Typen'});
    await _until(() => c.title == 'Alle Typen');
  }, skip: _skip);
}
