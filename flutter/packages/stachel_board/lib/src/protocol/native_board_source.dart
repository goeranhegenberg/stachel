import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../model/board_source.dart';
import 'native_messages.dart';

/// Gets the app's Stachel token (`sts_…`, contract §8.1); [fresh] = the last one was rejected, fetch a new one.
typedef StachelTokenProvider = Future<String> Function({bool fresh});

/// Opens a WebSocket (tests pass an in-process server's URL; the default is `dart:io`).
typedef WebSocketConnector = Future<WebSocket> Function(Uri url, Map<String, String> headers);

Future<WebSocket> _connectIo(Uri url, Map<String, String> headers) =>
    WebSocket.connect(url.toString(), headers: headers, compression: CompressionOptions.compressionDefault);

/// Close codes after which reconnecting makes no sense (contract §8.4).
const _fatalCloses = {
  4404: 'unknown_board',
  4410: 'board_deleted',
  4403: 'no_access',
  4426: 'upgrade_required',
  4400: 'invalid_input',
};

/// [BoardSource] over the native API v1 (`wss://<origin>/native/v1`, contract §8.4).
///
/// - Connects with `Authorization: Bearer sts_…`, sends `hello` (with `resume` when it has seen a board before),
///   forwards every server message.
/// - Keeps the connection alive: `ping` every 10 s; 25 s without any message → reconnect with `resume`.
/// - Close 4401 `not_logged_in` → one new token ([StachelTokenProvider] with `fresh`) and reconnect; again 4401 →
///   closed (`not_logged_in`). Fatal closes (4404/4410/4403/4426/4400) → closed with that reason. Everything else
///   (network gone, 1001 server restart, 1013 too slow, 4000 access changed, 4429 rate limited) → `offline` and
///   reconnect with growing pause (1 s … 15 s; at least 5 s after 4429).
class NativeBoardSource implements BoardSource {
  NativeBoardSource({
    required this.base,
    required this.board,
    required this.token,
    required this.appVersion,
    this.client,
    WebSocketConnector? connect,
    this.pingEvery = const Duration(seconds: 10),
    this.silenceLimit = const Duration(seconds: 25),
    this.retryDelays = const [Duration(seconds: 1), Duration(seconds: 2), Duration(seconds: 5), Duration(seconds: 15)],
  }) : _connect = connect ?? _connectIo;

  /// Stachel origin, e.g. `https://stachel.example.org` (→ `wss://…/native/v1`).
  final Uri base;
  final String board;
  final StachelTokenProvider token;

  /// `x.y.z+build` of the app (server compares it with `minApp`).
  final String appVersion;

  /// Which app (`hello.client`, contract §8.4): null = field left out (a host app embedding the board), `stachel` = the Stachel app.
  final String? client;
  final WebSocketConnector _connect;
  final Duration pingEvery;
  final Duration silenceLimit;
  final List<Duration> retryDelays;

  final _messages = StreamController<ServerMessage>.broadcast();
  final _connection = ValueNotifier(BoardConnection.connecting);
  WebSocket? _ws;
  StreamSubscription<dynamic>? _sub;
  Timer? _ping;
  Timer? _silence;
  Timer? _retry;
  int _attempt = 0;
  bool _closed = false;
  bool _freshTokenTried = false;
  String? _closeReason;

  /// Last seen epoch/revision (for `hello.resume`).
  String? _epoch;
  int? _rev;

  @override
  Stream<ServerMessage> get messages => _messages.stream;

  @override
  ValueListenable<BoardConnection> get connection => _connection;

  @override
  String? get closeReason => _closeReason;

  /// The gateway URL: `wss://` for https, `ws://` for http (sandbox).
  Uri get url => base.replace(scheme: base.scheme == 'http' ? 'ws' : 'wss', path: nativeGatewayPath, query: null);

  @override
  Future<void> open({String? resumeEpoch, int? resumeRev}) async {
    _epoch ??= resumeEpoch;
    _rev ??= resumeRev;
    await _open(fresh: false);
  }

  Future<void> _open({required bool fresh}) async {
    if (_closed) return;
    _connection.value = _epoch == null ? BoardConnection.connecting : BoardConnection.offline;
    final WebSocket ws;
    try {
      final t = await token(fresh: fresh);
      ws = await _connect(url, {'Authorization': 'Bearer $t'});
    } catch (e) {
      if (e is _Fatal) return _finish(e.reason);
      return _scheduleRetry();
    }
    if (_closed) {
      await ws.close();
      return;
    }
    _ws = ws;
    _sub = ws.listen(_onData, onDone: () => _onDone(ws), onError: (_) {}, cancelOnError: false);
    send(
      helloMessage(
        board: board,
        app: appVersion,
        client: client,
        resumeEpoch: _epoch,
        resumeRev: _rev,
        want: const ['objects', 'ext'],
      ),
    );
    _ping?.cancel();
    _ping = Timer.periodic(pingEvery, (_) => send(pingMessage()));
    _touch();
  }

  void _touch() {
    _silence?.cancel();
    _silence = Timer(silenceLimit, () => _ws?.close(4001, 'silent'));
  }

  void _onData(dynamic data) {
    _touch();
    if (data is! String) return;
    final Object? json;
    try {
      json = jsonDecode(data);
    } catch (_) {
      return;
    }
    final m = ServerMessage.parse(json);
    switch (m) {
      case WelcomeMessage():
        _epoch = m.epoch;
        _rev = m.rev;
        _live();
      case ResumedMessage():
        if (m.info.epoch.isNotEmpty) _epoch = m.info.epoch;
        _rev = m.rev;
        _live();
      case PatchMessage():
        if (m.rev > (_rev ?? 0)) _rev = m.rev;
      case ErrorMessage():
        if (_fatalCloses.containsValue(m.error)) _closeReason = m.error;
      default:
        break;
    }
    if (!_messages.isClosed) _messages.add(m);
  }

  void _live() {
    _attempt = 0;
    _freshTokenTried = false;
    _connection.value = BoardConnection.live;
  }

  void _onDone(WebSocket ws) {
    if (!identical(ws, _ws)) return;
    _ping?.cancel();
    _silence?.cancel();
    _sub = null;
    _ws = null;
    if (_closed) return;
    final code = ws.closeCode;
    final fatal = _fatalCloses[code];
    if (fatal != null) return _finish(fatal);
    if (code == 4401) {
      if (_freshTokenTried) return _finish('not_logged_in');
      _freshTokenTried = true;
      _connection.value = BoardConnection.offline;
      unawaited(_open(fresh: true));
      return;
    }
    _scheduleRetry(min: code == 4429 ? const Duration(seconds: 5) : Duration.zero);
  }

  void _scheduleRetry({Duration min = Duration.zero}) {
    if (_closed) return;
    _connection.value = BoardConnection.offline;
    var d = retryDelays[_attempt.clamp(0, retryDelays.length - 1)];
    if (d < min) d = min;
    _attempt++;
    _retry?.cancel();
    _retry = Timer(d, () => _open(fresh: false));
  }

  void _finish(String reason) {
    _closeReason = reason;
    _closed = true;
    _ping?.cancel();
    _silence?.cancel();
    _retry?.cancel();
    _connection.value = BoardConnection.closed;
  }

  /// Reconnect right away (e.g. the phone is online again).
  void reconnectNow() {
    if (_closed || _ws != null) return;
    _retry?.cancel();
    unawaited(_open(fresh: false));
  }

  @override
  void send(Map<String, Object?> message) {
    final ws = _ws;
    if (ws == null || ws.readyState != WebSocket.open) return;
    ws.add(jsonEncode(message));
  }

  @override
  Future<void> close() async {
    _closed = true;
    _ping?.cancel();
    _silence?.cancel();
    _retry?.cancel();
    final ws = _ws;
    _ws = null;
    await _sub?.cancel();
    await ws?.close(1000, 'bye');
    _connection.value = BoardConnection.closed;
    await _messages.close();
  }
}

/// Throw from a [StachelTokenProvider] when there is no way to get a token (e.g. `invalid_token`): the source closes
/// with [reason] instead of retrying.
class _Fatal implements Exception {
  const _Fatal(this.reason);
  final String reason;
}

/// Ends the source for good from inside a [StachelTokenProvider] (e.g. the host app's login is gone).
Never stopNativeSource(String reason) => throw _Fatal(reason);
