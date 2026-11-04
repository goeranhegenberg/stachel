// E2 acceptance against the real Stachel server in its sandbox (concept §5 E2, §6.4, contract §8.6): the app edits
// (BoardController/BoardEditor over NativeBoardSource), a web client (`stachel/tools/web-peer.mts`, Hocuspocus like the
// browser) edits the same board at the same time.
//
//   cd stachel && npm --prefix server run build
//   server\node_modules\.bin\tsx.cmd tools/sandbox.mts 8600 --seed
//   flutter test test/native_e2_live_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8600
//
// - app creates/moves/writes → the web has it (rich text as Y.XmlFragment with marks, `text` mirror); undo only own,
// - same note at the same time: web types in one paragraph while the app writes in another → both (server rebase);
//   both change the same word → app wins, `ack.conflict`, nothing else lost; both apps' and web's state equal,
// - same object, different fields at the same time → both kept; same field → both converge (last writer wins),
// - network gap: changes queue, after the reconnect sent again with the same req → applied once, nothing doubled,
// - „schreibt hier gerade“ both ways (web caret → app refuses to edit; app editing → web sees caret with the id).
// Skipped without STACHEL_SANDBOX (or without the stachel repo for the web side).
@Tags(['live'])
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

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
    final tsx = Platform.isWindows ? '$_repo\\server\\node_modules\\.bin\\tsx.cmd' : '$_repo/server/node_modules/.bin/tsx';
    final p = await Process.start(tsx, ['tools/web-peer.mts', _sandbox, login], workingDirectory: _repo, runInShell: Platform.isWindows);
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

  Future<Map<String, Object?>?> object(String id) async => ((await cmd({'cmd': 'get', 'obj': id}))['object'] as Map?)?.cast<String, Object?>();

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

Map<String, Object?> _t(String text, [List<Map<String, Object?>> marks = const []]) => {
  'type': 'text',
  'text': text,
  if (marks.isNotEmpty) 'marks': marks,
};
Map<String, Object?> _p(List<Map<String, Object?>> c) => {'type': 'paragraph', if (c.isNotEmpty) 'content': c};

void main() {
  late String boardId;

  Future<String> newSession(String who) async =>
      ((await _http('POST', '$_sandbox/api/auth/app-session', bearer: 'sandbox-$who', body: {}))! as Map)['token'] as String;

  setUpAll(() async {
    if (_skip != null) return;
    // a fresh board per run: the tests write
    final t = await newSession('mara');
    final b = await _http('POST', '$_sandbox/api/boards', bearer: t, write: true, body: {'title': 'E2 live ${DateTime.now().toIso8601String()}'});
    boardId = ((b! as Map)['board'] as Map)['id'] as String;
  });

  /// App side as [who]; [connect] lets a test cut the network.
  Future<(NativeBoardSource, BoardController, BoardEditor)> app({String who = 'mara', WebSocketConnector? connect}) async {
    String? t;
    final source = NativeBoardSource(
      base: Uri.parse(_sandbox),
      board: boardId,
      token: ({bool fresh = false}) async {
        if (fresh || t == null) t = await newSession(who);
        return t!;
      },
      appVersion: '1.23.0+32',
      connect: connect,
      retryDelays: const [Duration(milliseconds: 100)],
    );
    final c = BoardController(source, presenceInterval: const Duration(milliseconds: 30));
    final editor = BoardEditor(controller: c, scene: BoardScene(c.state), camera: CameraController())
      ..textDebounce = const Duration(milliseconds: 30);
    await c.start();
    await _until(() => c.loaded && c.canEdit);
    return (source, c, editor);
  }

  test('App legt an, verschiebt, schreibt (Rich-Text mit Marks) → Web hat es; Rückgängig nimmt nur Eigenes', () async {
    final (_, c, e) = await app();
    final web = await _WebPeer.start();
    addTearDown(() async {
      await web.close();
      e.dispose();
      c.dispose();
    });
    await web.cmd({'cmd': 'open', 'board': boardId});

    final id = e.create('sticky', const Offset(100, 100))!;
    expect(e.editingId, id);
    e.textChanged('Zelte');
    await _until(() => !c.hasPending(id) && c.confirmed[id]?.text == 'Zelte');
    e.stopEditing();
    await _untilAsync(() async => (await web.object(id))?['text'] == 'Zelte');
    final (doc, text) = await web.content(id);
    expect(text, 'Zelte');
    expect(doc, {
      'type': 'doc',
      'content': [
        _p([_t('Zelte')]),
      ],
    }, reason: 'im Web als Y.XmlFragment (Rich-Text), nicht nur Klartext');

    // Web färbt, App verschiebt: beide Felder bleiben (Feld-Patches)
    await web.cmd({
      'cmd': 'set',
      'obj': id,
      'fields': {'color': '#c9e14a'},
    });
    await _until(() => c.state[id]!.color == '#c9e14a');
    e.select({id});
    e.dragStart(const Offset(100, 100));
    for (var i = 1; i <= 10; i++) {
      e.dragUpdate(Offset(100 + i * 10.0, 100));
      await Future<void>.delayed(const Duration(milliseconds: 16));
    }
    e.dragEnd();
    await _untilAsync(() async => (await web.object(id))?['x'] == 100);
    expect((await web.object(id))!['color'], '#c9e14a', reason: 'Feld-Patches: die Farbe des Web bleibt');

    // Rückgängig: Verschieben zurück, die Farbe (Web) bleibt
    c.undo();
    await _untilAsync(() async => (await web.object(id))?['x'] == 0);
    expect((await web.object(id))!['color'], '#c9e14a');
    c.redo();
    await _untilAsync(() async => (await web.object(id))?['x'] == 100);
  }, skip: _skip);

  test('dieselbe Notiz gleichzeitig: verschiedene Absätze → beides; dasselbe Wort → App gewinnt mit Hinweis', () async {
    final (_, c, e) = await app();
    final web = await _WebPeer.start();
    final notices = <BoardNotice>[];
    final sub = c.notices.listen(notices.add);
    addTearDown(() async {
      await sub.cancel();
      await web.close();
      e.dispose();
      c.dispose();
    });
    await web.cmd({'cmd': 'open', 'board': boardId});
    final id = 'note_${DateTime.now().microsecondsSinceEpoch}';
    final comment = {
      'type': 'comment',
      'attrs': {'id': 'c9'},
    };
    await web.cmd({
      'cmd': 'create',
      'object': {
        'id': id,
        'type': 'sticky',
        'x': 400,
        'y': 0,
        'w': 200,
        'h': 200,
        'z': 'zz',
        'text': 'Einkaufen\nZelte',
        'content': {
          'type': 'doc',
          'content': [
            _p([
              _t('Ein', [
                {'type': 'bold'},
              ]),
              _t('kaufen', [comment]),
            ]),
            _p([_t('Zelte')]),
          ],
        },
      },
    });
    await _until(() => c.state[id] != null);

    // App beginnt zu schreiben (Basis = jetziger Stand), das Web tippt gleichzeitig im zweiten Absatz
    expect(e.startEditing(id), isTrue);
    await web.cmd({'cmd': 'type', 'obj': id, 'block': 1, 'at': 5, 'text': ' und Planen'});
    e.textChanged('Einkaufen gehen\nZelte', caret: 15);
    await _untilAsync(() async => (await web.object(id))?['text'] == 'Einkaufen gehen\nZelte und Planen');
    final (doc, _) = await web.content(id);
    expect(doc!['content'], [
      _p([
        _t('Ein', [
          {'type': 'bold'},
        ]),
        _t('kaufen gehen', [comment]),
      ]),
      _p([_t('Zelte und Planen')]),
    ], reason: 'beide Eingaben, Fett und unbekanntes Mark (Kommentar) erhalten');
    await _until(() => c.confirmed[id]!.text == 'Einkaufen gehen\nZelte und Planen' && !c.hasPending(id));
    // die App übernimmt den zusammengeführten Stand in den offenen Editor
    expect(e.adoptRemoteText() || e.editingDoc!.text == 'Einkaufen gehen\nZelte und Planen', isTrue);
    expect(e.editingDoc!.text, 'Einkaufen gehen\nZelte und Planen');
    expect(notices.where((n) => n.kind == 'conflict'), isEmpty);

    // dasselbe Wort gleichzeitig: Web „Zelte“ → „Zelt“, App „Zelte“ → „Zeltplatz“ (Basis noch mit „Zelte“)
    await web.cmd({'cmd': 'type', 'obj': id, 'block': 1, 'at': 4, 'del': 1});
    e.textChanged('Einkaufen gehen\nZeltplatz und Planen', caret: 25);
    await _until(() => notices.any((n) => n.kind == 'conflict'));
    await _untilAsync(() async => (await web.object(id))?['text'] == 'Einkaufen gehen\nZeltplatz und Planen');
    e.stopEditing();
    await _until(() => !c.hasPending(id));
    expect(c.confirmed[id]!.text, (await web.object(id))!['text'], reason: 'App und Web gleich');
  }, skip: _skip);

  test('dasselbe Objekt gleichzeitig: verschiedene Felder bleiben beide; gleiches Feld → alle beim selben Stand', () async {
    final (_, c, e) = await app();
    final (_, c2, e2) = await app(who: 'lena');
    final web = await _WebPeer.start();
    addTearDown(() async {
      await web.close();
      e.dispose();
      e2.dispose();
      c.dispose();
      c2.dispose();
    });
    await web.cmd({'cmd': 'open', 'board': boardId});
    final id = e.create('shape', const Offset(0, 600))!;
    await _until(() => c2.state[id] != null);
    e.select({id});
    // gleichzeitig: App setzt Farbe, Web verschiebt
    final setColor = Future(() => e.setField('color', '#1763b5'));
    final move = web.cmd({
      'cmd': 'set',
      'obj': id,
      'fields': {'x': 77},
    });
    await Future.wait([setColor, move]);
    await _untilAsync(() async {
      final w = await web.object(id);
      return w?['x'] == 77 && w?['color'] == '#1763b5';
    });
    await _until(() => c.state[id]!.x == 77 && c2.state[id]!.color == '#1763b5');
    // gleiches Feld von drei Seiten gleichzeitig
    e2.select({id});
    e.setField('color', '#ec4e92');
    e2.setField('color', '#c9e14a');
    await web.cmd({
      'cmd': 'set',
      'obj': id,
      'fields': {'color': '#000000'},
    });
    await _until(() => !c.hasPending(id) && !c2.hasPending(id));
    await Future<void>.delayed(const Duration(milliseconds: 300));
    final webColor = (await web.object(id))!['color'];
    expect(c.state[id]!.color, webColor);
    expect(c2.state[id]!.color, webColor);
    expect(c.state[id]!.raw, c.confirmed[id]!.raw);
  }, skip: _skip);

  test('Funkloch: Änderungen warten, gehen mit derselben req nach dem Wiederverbinden raus, nichts doppelt', () async {
    WebSocket? ws;
    var offline = false;
    Future<WebSocket> connect(Uri u, Map<String, String> h) async {
      if (offline) throw const SocketException('offline (Test)');
      return ws = await WebSocket.connect(u.toString(), headers: h);
    }

    final (source, c, e) = await app(connect: connect);
    final web = await _WebPeer.start();
    addTearDown(() async {
      await web.close();
      e.dispose();
      c.dispose();
    });
    await web.cmd({'cmd': 'open', 'board': boardId});
    final before = c.confirmed.length;

    // die Op ist gesendet, aber die Verbindung reißt vor dem ack ab: nach dem Wiederverbinden noch einmal
    final id = e.create('sticky', const Offset(800, 0))!;
    e.stopEditing();
    offline = true;
    await ws!.close();
    await _until(() => source.connection.value == BoardConnection.offline);
    // offline weiter bearbeiten (kurz): wartet
    e.select({id});
    e.setField('color', '#9fd3ff');
    expect(c.queuedCount, greaterThan(0));
    expect(c.state[id]!.color, '#9fd3ff');
    await Future<void>.delayed(const Duration(milliseconds: 300));
    offline = false;
    await _until(() => source.connection.value == BoardConnection.live);
    await _until(() => c.pendingCount == 0);
    await _untilAsync(() async => (await web.object(id))?['color'] == '#9fd3ff');
    expect(c.confirmed.length, before + 1, reason: 'genau eine neue Notiz');
    expect(c.state[id]!.color, '#9fd3ff');
  }, skip: _skip);

  test('„schreibt hier gerade“ in beide Richtungen', () async {
    final (_, c, e) = await app();
    final web = await _WebPeer.start();
    addTearDown(() async {
      await web.close();
      e.dispose();
      c.dispose();
    });
    await web.cmd({'cmd': 'open', 'board': boardId});
    final id = e.create('sticky', const Offset(1200, 0))!;
    e.stopEditing();
    await _until(() => !c.hasPending(id));

    // Web schreibt → die App darf trotzdem mitschreiben (wie zwei Browser), sie zeigt, wer dort schreibt
    await web.cmd({'cmd': 'caret', 'obj': id});
    await _until(() => c.peers.any((p) => p.editing == id));
    expect(e.writerOf(id), 'jonas');
    expect(e.startEditing(id), isTrue);
    e.stopEditing();
    await web.cmd({'cmd': 'caret', 'obj': null});
    await _until(() => c.peers.every((p) => p.editing == null));

    // App schreibt → das Web sieht richtext.caret mit der ID (ohne Schreibmarke)
    expect(e.startEditing(id), isTrue);
    Map<String, Object?>? caret;
    await _untilAsync(() async {
      final peers = ((await web.cmd({'cmd': 'peers'}))['peers'] as List).cast<Map<String, Object?>>();
      for (final p in peers) {
        final s = (p['state'] as Map?)?.cast<String, Object?>();
        if ((s?['user'] as Map?)?['key'] == 'a:mara' && s?['richtext.caret'] is Map) caret = (s!['richtext.caret'] as Map).cast<String, Object?>();
      }
      return caret != null;
    });
    expect(caret, {'id': id, 'anchor': null, 'head': null});
    e.stopEditing();
  }, skip: _skip);
}
