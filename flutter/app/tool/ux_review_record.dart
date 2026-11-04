// UX-Review 2026-11 (docs/ux_review_app_2026-11.md): legt in der lokalen Sandbox (Modus local, --seed) realistische Boards an
// (Vorlagen als Web-Aktionen, Kommentar mit Erwähnung, Abstimmung, Freigaben) und schreibt je Board den native `welcome`
// als JSON plus ids.json. Aufruf: dart run tool/ux_review_record.dart <sandbox.json aus --info> <ausgabeordner>
import 'dart:async';
import 'dart:convert';
import 'dart:io';

late String base;
late String owner;
late String edit;

Future<Object?> rest(String method, String path, {Object? body, String? token}) async {
  final c = HttpClient();
  try {
    final r = await c.openUrl(method, Uri.parse('$base$path'));
    r.headers.set('Authorization', 'Bearer ${token ?? owner}');
    r.headers.set('X-Stachel', '1');
    if (body != null) {
      r.headers.contentType = ContentType.json;
      r.write(jsonEncode(body));
    }
    final res = await r.close();
    final t = await res.transform(utf8.decoder).join();
    if (res.statusCode >= 300) throw StateError('$method $path → ${res.statusCode} $t');
    return t.isEmpty ? null : jsonDecode(t);
  } finally {
    c.close();
  }
}

class Conn {
  Conn(this.ws) {
    ws.listen((m) {
      final j = jsonDecode(m as String) as Map<String, Object?>;
      _q.add(j);
    });
  }
  final WebSocket ws;
  final _q = StreamController<Map<String, Object?>>.broadcast();
  int _req = 0;

  static Future<(Conn, Map<String, Object?>)> open(String board, {String? token}) async {
    final ws = await WebSocket.connect(
      '${base.replaceFirst('http', 'ws')}/native/v1',
      headers: {'Authorization': 'Bearer ${token ?? owner}'},
    );
    final c = Conn(ws);
    final w = c._q.stream.firstWhere((m) => m['t'] == 'welcome' || m['t'] == 'error');
    ws.add(
      jsonEncode({
        't': 'hello',
        'proto': 1,
        'board': board,
        'app': '1.1.0+3',
        'client': 'stachel',
        'want': ['objects', 'ext'],
      }),
    );
    final welcome = await w.timeout(const Duration(seconds: 10));
    if (welcome['t'] != 'welcome') throw StateError('$welcome');
    return (c, welcome);
  }

  Future<Map<String, Object?>> ops(List<Map<String, Object?>> ops) async {
    final req = ++_req;
    final f = _q.stream.firstWhere((m) => (m['t'] == 'ack' || m['t'] == 'nack') && m['req'] == req);
    ws.add(jsonEncode({'t': 'ops', 'req': req, 'ops': ops}));
    final a = await f.timeout(const Duration(seconds: 15));
    if (a['t'] == 'nack') stderr.writeln('NACK $ops → $a');
    return a;
  }

  Future<void> close() => ws.close();
}

Future<String> board(String title) async =>
    (((await rest('POST', '/api/boards', body: {'title': title}))! as Map)['board'] as Map)['id'] as String;

Future<void> template(String id, String tpl, {double x = 0, double y = 0, String? token}) async {
  final (c, _) = await Conn.open(id, token: token);
  await c.ops([
    {
      'op': 'act',
      'name': 'structure.template',
      'args': {'template': tpl, 'x': x, 'y': y},
      'key': 'tpl$tpl',
    },
  ]);
  await c.close();
}

Future<void> save(String id, String file, {String? token}) async {
  final (c, w) = await Conn.open(id, token: token);
  await c.close();
  File(file).writeAsStringSync(const JsonEncoder.withIndent(' ').convert(w));
  stdout.writeln('$file: ${((w['snapshot'] as Map)['objects'] as List).length} Objekte');
}

Future<void> main(List<String> args) async {
  final info = jsonDecode(File(args[0]).readAsStringSync()) as Map;
  final out = args[1];
  base = info['stachelBase'] as String;
  final people = (info['people'] as List).cast<Map>();
  owner = people.firstWhere((p) => p['role'] == 'owner')['token'] as String;
  edit = people.firstWhere((p) => p['role'] == 'edit')['token'] as String;
  final ids = <String, String>{};

  // 1. Festival board from the festival template + comments + a running vote
  final fest = ids['festival'] = await board('Sommerfest 2027 – Planung');
  await template(fest, 'festival');
  // 2. other boards for the list
  for (final (key, title, tpl) in [
    ('brainstorm', 'Brainstorming Sommerfest', 'brainstorm'),
    ('mindmap', 'Ideen Mindmap', 'mindmap'),
    ('kanban', 'Aufgaben Aufbau', 'kanban'),
    ('retro', 'Retro Sommerfest 2026', 'retro'),
    ('shifts', 'Helferschichten', 'shifts'),
    ('flow', 'Ablauf Einlass', 'flow'),
  ]) {
    ids[key] = await board(title);
    await template(ids[key]!, tpl);
  }
  ids['empty'] = await board('Neues Board');
  ids['plain'] = await board('Getränkestand');

  // favorites
  for (final k in ['festival', 'mindmap']) {
    await rest('PUT', '/api/boards/${ids[k]}/favorite');
  }

  // Festival: shared with edit (edit) and comment (comment); comments by the edit person on the first sticky, voting
  await rest(
    'POST',
    '/api/boards/$fest/share',
    body: {
      'emails': ['edit@sandbox.test'],
      'role': 'edit',
    },
  );
  await rest(
    'POST',
    '/api/boards/$fest/share',
    body: {
      'emails': ['comment@sandbox.test'],
      'role': 'comment',
    },
  );
  await rest('PUT', '/api/boards/$fest/link', body: {'role': 'view'}).catchError((Object e) {
    stderr.writeln('link: $e');
    return null;
  });
  final (fc, fw) = await Conn.open(fest);
  final objs = ((fw['snapshot'] as Map)['objects'] as List).cast<Map>();
  final sticky = objs.firstWhere((o) => o['type'] == 'sticky', orElse: () => objs.first);
  await fc.close();
  final (ec, _) = await Conn.open(fest, token: edit);
  await ec.ops([
    {
      'op': 'comment',
      'thread': 'ux-t1',
      'msg': 'ux-m1',
      'at': {'x': sticky['x'], 'y': sticky['y'], 'objectId': sticky['id'], 'dx': 20, 'dy': 20},
      'text': '@Olga Owner Passt das so mit den Zeiten?',
      'mentions': [people.firstWhere((p) => p['role'] == 'owner')['key']],
    },
  ]);
  await ec.close();
  final (oc, _) = await Conn.open(fest);
  await oc.ops([
    {'op': 'reply', 'thread': 'ux-t1', 'msg': 'ux-m2', 'text': 'Ja, aber Einlass eine Stunde früher.'},
    {
      'op': 'act',
      'name': 'collab.vote.start',
      'args': {'title': 'Welche Ideen zuerst?', 'perPerson': 3, 'minutes': 5, 'multi': false, 'anonymous': false},
      'key': 'uxvote',
    },
  ]);
  await oc.close();

  for (final e in ids.entries) {
    await save(e.value, '$out/${e.key}.welcome.json');
  }
  File(
    '$out/boards.json',
  ).writeAsStringSync(const JsonEncoder.withIndent(' ').convert(await rest('GET', '/api/boards')));
  File('$out/ids.json').writeAsStringSync(jsonEncode(ids));
  stdout.writeln(ids);
}
