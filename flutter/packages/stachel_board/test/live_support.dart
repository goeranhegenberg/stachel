// Shared helpers of the live tests against the Stachel sandbox (E3 on): sandbox URL, HTTP, waiting, the web peer
// (`stachel/tools/web-peer.mts`, a browser-like Yjs client). Same as in native_e2_live_test.dart.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';


const sandbox = String.fromEnvironment('STACHEL_SANDBOX');
const _repoDefine = String.fromEnvironment('STACHEL_REPO', defaultValue: '../../../stachel');

final _repo = Directory(_repoDefine).absolute.path;
final _haveRepo = File('$_repo/tools/web-peer.mts').existsSync();
final liveSkip = sandbox.isEmpty
    ? 'STACHEL_SANDBOX fehlt'
    : !_haveRepo
    ? 'Stachel-Repo nicht gefunden ($_repo)'
    : null;

Future<Object?> liveHttp(String method, String url, {String? bearer, Object? body, bool write = false}) async {
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

Future<Duration> until(bool Function() cond, {Duration timeout = const Duration(seconds: 10)}) async {
  final sw = Stopwatch()..start();
  while (!cond()) {
    if (sw.elapsed > timeout) throw TimeoutException('Bedingung nicht erfüllt nach $timeout');
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
  return sw.elapsed;
}

Future<void> untilAsync(Future<bool> Function() cond, {Duration timeout = const Duration(seconds: 10)}) async {
  final sw = Stopwatch()..start();
  while (!await cond()) {
    if (sw.elapsed > timeout) throw TimeoutException('Bedingung nicht erfüllt nach $timeout');
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
}

/// `tools/web-peer.mts`: a browser-like Yjs client, one JSON command per line.
class WebPeer {
  WebPeer._(this._process, this._lines);

  final Process _process;
  final Stream<Map<String, Object?>> _lines;
  var _id = 0;

  static Future<WebPeer> start({String login = 'jonas'}) async {
    final tsx = Platform.isWindows ? '$_repo\\server\\node_modules\\.bin\\tsx.cmd' : '$_repo/server/node_modules/.bin/tsx';
    final p = await Process.start(tsx, ['tools/web-peer.mts', sandbox, login], workingDirectory: _repo, runInShell: Platform.isWindows);
    p.stderr.transform(utf8.decoder).listen((e) => stderr.write('[web-peer] $e'));
    final lines = p.stdout
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .where((l) => l.startsWith('{'))
        .map((l) => (jsonDecode(l) as Map).cast<String, Object?>())
        .asBroadcastStream();
    await lines.firstWhere((m) => m['ready'] == true).timeout(const Duration(seconds: 30));
    return WebPeer._(p, lines);
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

