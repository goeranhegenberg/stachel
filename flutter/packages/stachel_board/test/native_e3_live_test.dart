// E3 acceptance against the real Stachel server in its sandbox (concept §5 E3, §6.4, contract §8.6/§8.11): the app
// (BoardController/BoardEditor over NativeBoardSource) and a web client (`stachel/tools/web-peer.mts`) on the same board.
//
//   cd stachel && npm --prefix server run build
//   server\node_modules\.bin\tsx.cmd tools/sandbox.mts 8600 --seed
//   flutter test test/native_e3_live_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8600
//
// - web creates a connector → the app shows it docked; the app connects two objects → the web has from/to,
// - comments: the web mentions the app user → the app sees the thread (unread), the inbox has it; the app replies with
//   a mention → the web has the message, the inbox of the mentioned person has it; done; reactions both ways,
// - image: the app uploads (multipart, sts token) and places it → the web has the object and can load the image,
// - persisted queue: changes made offline, the board left (controller gone), the next open sends them – once.
// Skipped without STACHEL_SANDBOX (or without the stachel repo for the web side).
@Tags(['live'])
library;

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:stachel_board/stachel_board.dart';

import 'live_support.dart';

/// A 4×3 PNG, uploadable.
final _png = base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEklEQVR4nGP4z8CAhBgo4wMAuqoL9RNfp7cAAAAASUVORK5CYII=');

Future<Map<String, Object?>> _upload(String board, String token, Uint8List bytes) async {
  final client = HttpClient();
  try {
    final req = await client.postUrl(Uri.parse('$sandbox/api/boards/$board/images'));
    const boundary = 'live-boundary';
    req.headers
      ..set('Authorization', 'Bearer $token')
      ..set('X-Stachel', '1')
      ..set('Content-Type', 'multipart/form-data; boundary=$boundary');
    req.add(utf8.encode('--$boundary\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n'));
    req.add(bytes);
    req.add(utf8.encode('\r\n--$boundary--\r\n'));
    final res = await req.close();
    final text = await res.transform(utf8.decoder).join();
    if (res.statusCode != 201) throw HttpException('upload → ${res.statusCode} $text');
    return ((jsonDecode(text) as Map)['image'] as Map).cast<String, Object?>();
  } finally {
    client.close();
  }
}

void main() {
  late String boardId;
  final tokens = <String, String>{};

  Future<String> newSession(String who) async =>
      ((await liveHttp('POST', '$sandbox/api/auth/app-session', bearer: 'sandbox-$who', body: {}))! as Map)['token'] as String;
  Future<String> token(String who) async => tokens[who] ??= await newSession(who);

  setUpAll(() async {
    if (liveSkip != null) return;
    final t = await token('mara');
    final b = await liveHttp('POST', '$sandbox/api/boards', bearer: t, write: true, body: {'title': 'E3 live ${DateTime.now().toIso8601String()}'});
    boardId = ((b! as Map)['board'] as Map)['id'] as String;
  });

  Future<(NativeBoardSource, BoardController, BoardEditor)> app({String who = 'mara', WebSocketConnector? connect, PendingStore? store}) async {
    final source = NativeBoardSource(
      base: Uri.parse(sandbox),
      board: boardId,
      token: ({bool fresh = false}) async {
        if (fresh) tokens.remove(who);
        return token(who);
      },
      appVersion: '1.24.0+33',
      connect: connect,
      retryDelays: const [Duration(milliseconds: 100)],
    );
    final c = BoardController(source, presenceInterval: const Duration(milliseconds: 30), boardId: boardId, pendingStore: store);
    final editor = BoardEditor(controller: c, scene: BoardScene(c.state), camera: CameraController());
    // rejected ops show up in the test log (they would fail the expectations later)
    c.notices.listen((n) => printOnFailure('Hinweis ${n.kind}: ${n.error} ${n.message}'));
    await c.start();
    await until(() => c.loaded && c.canEdit);
    return (source, c, editor);
  }

  Future<Map<String, Object?>> inbox(String who, String since) async =>
      ((await liveHttp('GET', '$sandbox/api/native/v1/inbox?since=${Uri.encodeQueryComponent(since)}', bearer: await token(who)))! as Map)
          .cast<String, Object?>();

  Future<Map?> extOf(WebPeer web, String name) async => (await web.cmd({'cmd': 'ext', 'name': name}))['value'] as Map?;

  test('Verbinder: Web legt an → App zeigt ihn angedockt; App verbindet (Andockpunkt), ändert Spitze, kehrt um → Web', () async {
    final (_, c, e) = await app();
    final web = await WebPeer.start();
    addTearDown(() async {
      await web.close();
      e.dispose();
      c.dispose();
    });
    await web.cmd({'cmd': 'open', 'board': boardId});
    for (final (id, x) in [('va', 0), ('vb', 400)]) {
      await web.cmd({
        'cmd': 'create',
        'object': {'id': id, 'type': 'sticky', 'x': x, 'y': 1000, 'w': 200, 'h': 200, 'z': 'a$x', 'text': id},
      });
    }
    await web.cmd({
      'cmd': 'create',
      'object': {
        'id': 'vw',
        'type': 'connector',
        'x': 100,
        'y': 1100,
        'w': 400,
        'h': 1,
        'z': 'b0',
        'from': {'objectId': 'va'},
        'to': {'objectId': 'vb', 'side': 'w'},
        'arrowEnd': true,
        'lineStyle': 'curved',
      },
    });
    final scene = e.scene;
    await until(() => c.state['vw'] != null && c.state['vb'] != null);
    scene.sync();
    final g = scene.connector('vw')!;
    expect(g.b.dx, closeTo(400 - connectorGap, 0.5), reason: 'am Andockpunkt w von vb');
    expect(g.style, 'curved');

    final from = EndDrop(sidePoint(c.state['va']!, 'e').$1, objectId: 'va', side: 'e');
    final to = dropEnd(scene, const Offset(500, 1003), 1);
    expect((to.objectId, to.side), ('vb', 'n'));
    final id = e.connect(from, to)!;
    await untilAsync(() async => (await web.object(id)) != null);
    final w = (await web.object(id))!;
    expect(w['from'], {'objectId': 'va', 'side': 'e'});
    expect(w['to'], {'objectId': 'vb', 'side': 'n'});
    expect(w['lineStyle'], 'curved');
    e.select({id});
    e.setConnectorFields(capPatch('start', 'circle'));
    e.reverseConnectors();
    await untilAsync(() async => (await web.object(id))?['capEnd'] == 'circle');
    expect((await web.object(id))!['from'], {'objectId': 'vb', 'side': 'n'});
  }, skip: liveSkip);

  test('Kommentare: Web erwähnt die App-Person → App + Posteingang; App antwortet mit @Erwähnung → Web + Posteingang', () async {
    const longAgo = '2000-01-01T00:00:00.000Z';
    final start = (await inbox('mara', longAgo))['now']! as String;
    final startJonas = (await inbox('jonas', longAgo))['now']! as String;
    final (_, c, e) = await app();
    final web = await WebPeer.start();
    addTearDown(() async {
      await web.close();
      e.dispose();
      c.dispose();
    });
    await web.cmd({'cmd': 'open', 'board': boardId});
    final me = c.user!;
    await web.cmd({
      'cmd': 'comment',
      'thread': 'wt1',
      'msg': 'wm1',
      'text': '@${me.name} Strom klären?',
      'mentions': [me.key],
      'at': {'x': 10, 'y': 10},
    });
    await until(() => e.threads.any((t) => t.id == 'wt1'));
    expect(e.threads.firstWhere((t) => t.id == 'wt1').messages.single.mentions, [me.key]);
    expect(unreadMentions(e.threads, me.key, readStateOf(c.state.ext, me.key)).map((x) => x.$1.id), contains('wt1'));
    await untilAsync(() async => ((await inbox('mara', start))['items']! as List).isNotEmpty);
    final item = ((await inbox('mara', start))['items']! as List).cast<Map>().last;
    expect((item['type'], item['boardId'], item['threadId'], item['byKey']), ('mention', boardId, 'wt1', 'a:jonas'));

    final people = e.mentionPeople(const [Person('a:jonas', 'Jonas')]);
    e.replyComment('wt1', 'Mach ich, @Jonas', people);
    e.markMentionsRead();
    await untilAsync(() async {
      final msgs = (((await extOf(web, 'collab.comments'))?['wt1'] as Map?)?['messages'] as List?) ?? const [];
      return msgs.length == 2 && (msgs.last as Map)['mentions'] is List;
    });
    await untilAsync(() async => ((await inbox('jonas', startJonas))['items']! as List).isNotEmpty);
    expect(((await inbox('jonas', startJonas))['items']! as List).cast<Map>().last['text'], 'Mach ich, @Jonas');
    await until(() => unreadMentions(e.threads, me.key, readStateOf(c.state.ext, me.key)).isEmpty);
    e.resolveComment('wt1', resolved: true);
    await untilAsync(() async => ((await extOf(web, 'collab.comments'))?['wt1'] as Map?)?['resolved'] == true);
  }, skip: liveSkip);

  test('Reaktionen in beide Richtungen', () async {
    final (_, c, e) = await app();
    final web = await WebPeer.start();
    addTearDown(() async {
      await web.close();
      e.dispose();
      c.dispose();
    });
    await web.cmd({'cmd': 'open', 'board': boardId});
    final id = e.create('sticky', const Offset(2000, 0))!;
    e.stopEditing();
    await until(() => !c.hasPending(id));
    bool has(Map? v, String emoji) => v?.keys.any((k) => '$k'.startsWith('$id|$emoji|')) ?? false;
    e.toggleReaction([id], '🎉');
    await untilAsync(() async => has(await extOf(web, 'collab.reactions'), '🎉'));
    await web.cmd({'cmd': 'react', 'obj': id, 'emoji': '👍'});
    await until(() => reactionsByObject(c.state.ext[reactionsExt], c.user!.key)[id]?.any((g) => g.emoji == '👍') ?? false);
    e.toggleReaction([id], '🎉');
    await untilAsync(() async => !has(await extOf(web, 'collab.reactions'), '🎉'));
  }, skip: liveSkip);

  test('Bild: App lädt hoch (sts-Token) und legt es ab → Web hat das Objekt und lädt das Bild', () async {
    final (_, c, e) = await app();
    final web = await WebPeer.start();
    addTearDown(() async {
      await web.close();
      e.dispose();
      c.dispose();
    });
    await web.cmd({'cmd': 'open', 'board': boardId});
    final img = await _upload(boardId, await token('mara'), _png);
    expect((img['width'], img['height']), (4, 3));
    final id = e.insertImage(imageId: img['id']! as String, width: 4, height: 3, color: '#ff0000', center: const Offset(3000, 0))!;
    await untilAsync(() async => (await web.object(id)) != null);
    final w = (await web.object(id))!;
    expect((w['type'], w['imageId'], w['w'], w['h'], w['color']), ('image', img['id'], 120, 90, '#ff0000'), reason: 'kleine Bilder auf 120 px wie im Web');
    final served = await web.cmd({'cmd': 'image', 'image': img['id']});
    expect((served['status'], served['type']), (200, 'image/png'));
  }, skip: liveSkip);

  test('Warteschlange auf dem Gerät: offline geändert, Board verlassen, beim nächsten Öffnen gesendet – einmal', () async {
    final store = MemoryPendingStore();
    WebSocket? ws;
    var offline = false;
    Future<WebSocket> connect(Uri u, Map<String, String> h) async {
      if (offline) throw const SocketException('offline (Test)');
      return ws = await WebSocket.connect(u.toString(), headers: h);
    }

    final (source, c, e) = await app(connect: connect, store: store);
    final web = await WebPeer.start();
    addTearDown(() async {
      await web.close();
    });
    await web.cmd({'cmd': 'open', 'board': boardId});
    offline = true;
    await ws!.close();
    await until(() => source.connection.value == BoardConnection.offline);
    expect(c.canEdit, isTrue, reason: 'kurz offline: Bearbeiten geht weiter (${c.role}, ${c.staleSince})');
    final id = e.create('sticky', const Offset(4000, 0))!;
    e.stopEditing();
    e.addComment(CommentAnchor(4000, 0, objectId: id), 'offline geschrieben', const []);
    await c.persistPending();
    expect(store.saved[boardId], hasLength(2));
    e.dispose();
    c.dispose(); // Board verlassen bzw. App beendet

    offline = false;
    final (_, c2, e2) = await app(store: store);
    addTearDown(() {
      e2.dispose();
      c2.dispose();
    });
    await until(() => c2.pendingCount == 0);
    await untilAsync(() async => (await web.object(id)) != null);
    final v = (await extOf(web, 'collab.comments'))!;
    expect(v.values.where((t) => ((t as Map)['messages'] as List).any((m) => (m as Map)['text'] == 'offline geschrieben')), hasLength(1));
    await c2.persistPending();
    expect(store.saved.containsKey(boardId), isFalse);
  }, skip: liveSkip);
}
