// Private mode live against the sandbox (docs/features/private.md §4, §5; `stachel/tools/sandbox.mts <port> --seed`):
// two app connections (Mara = orga, Jonas = member; sandbox team tokens) on one board, Mara starts the mode over REST
// (`HttpStachelBoardsApi.privateMode`, Bearer `sts_…` + `X-Stachel: 1`), writes a note → only she gets it (`private`
// before the `ack`), Jonas sees only the placeholder in `private.hidden` (no text on his connection), reveal → Jonas
// has the text, the mode is off. Plus the presentation handover fields over `presence.extra`.
// Run: flutter test test/live_private_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8864
@Tags(['live'])
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_client/stachel_client.dart';

const _sandbox = String.fromEnvironment('STACHEL_SANDBOX');
final liveSkip = _sandbox.isEmpty ? 'STACHEL_SANDBOX fehlt' : null;

/// A host-app-like client of the sandbox (mode org): the org token becomes an app session (`sandbox-mara` = admin/orga,
/// `sandbox-member-jonas` = member, not orga – so the facilitator rule applies to Jonas).
class _SandboxClient extends StachelClient {
  _SandboxClient(this.who);
  final String who;
  String get team => who == 'mara' ? 'sandbox-mara' : 'sandbox-member-$who';

  @override
  String get base => _sandbox;
  @override
  final http.Client httpClient = http.Client();
  @override
  String get appName => 'Stachel-App';
  @override
  String? get loginKey => team;
  @override
  Future<String> newSession(String base) async {
    final res = await httpClient.post(
      Uri.parse('$base/api/auth/app-session'),
      headers: {'Authorization': 'Bearer $team', 'Content-Type': 'application/json'},
      body: '{}',
    );
    return (jsonDecode(res.body) as Map)['token'] as String;
  }

  @override
  void loginLost(BuildContext context, {String? message}) {}
  @override
  Future<void> openInBrowser({String? board, String? object, ExternalLauncher launcher = launchExternal}) async {}
  @override
  BoardRegistry get registry => stachelBoardRegistry;
}

Future<void> _until(bool Function() cond, {Duration timeout = const Duration(seconds: 10), String? what}) async {
  final sw = Stopwatch()..start();
  while (!cond()) {
    if (sw.elapsed > timeout) throw TimeoutException('${what ?? 'Bedingung'} nicht erfüllt nach $timeout');
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}

void main() {
  late String boardId;
  final apis = <String, HttpStachelBoardsApi>{};
  HttpStachelBoardsApi api(String who) => apis[who] ??= HttpStachelBoardsApi(_SandboxClient(who), release: false);

  setUpAll(() async {
    if (liveSkip != null) return;
    SharedPreferences.setMockInitialValues({});
    await StachelSession.clear();
    final b = await api('mara').createBoard('Privat live ${DateTime.now().toIso8601String()}');
    boardId = b.id;
  });

  /// A connection of [who] with every server message recorded raw (to prove what reached it).
  Future<(BoardController, List<String>)> connect(String who) async {
    final raw = <String>[];
    final source = NativeBoardSource(
      base: Uri.parse(_sandbox),
      board: boardId,
      token: ({bool fresh = false}) => api(who).sessionToken(fresh: fresh),
      appVersion: '1.1.0+3',
      client: 'stachel',
      retryDelays: const [Duration(milliseconds: 100)],
    );
    final c = BoardController(source, presenceInterval: const Duration(milliseconds: 30));
    final sub = source.messages.listen((m) => raw.add(_describe(m)));
    addTearDown(() async {
      await sub.cancel();
      c.dispose();
    });
    await c.start();
    await _until(() => c.loaded && c.canEdit, what: '$who verbunden');
    return (c, raw);
  }

  test(
    'Privater Modus: nur Platzhalter beim anderen, private Ablage vor dem ack, Aufdecken zeigt den Text',
    () async {
      final (mara, _) = await connect('mara');
      final (jonas, jonasRaw) = await connect('jonas');
      expect(mara.features, contains('private'));
      expect(mara.privateFeature, isTrue);

      final started = await api('mara').privateMode(boardId, {'action': 'start', 'anonymous': false});
      expect(started['on'], isTrue);
      PrivateMode mode(BoardController c) => PrivateMode.fromJson(c.state.ext[privateModeExt]);
      await _until(() => mode(mara).on && mode(jonas).on, what: 'Modus bei beiden an');
      expect(mode(jonas).by, mara.user!.key);

      // a second start is refused with the server's text
      await expectLater(
        api('jonas').privateMode(boardId, {'action': 'start'}),
        throwsA(isA<StachelException>().having((e) => e.code, 'code', 'already_running')),
      );

      // Mara writes a note: it lands in her store
      final id = BoardController.newId();
      const secret = 'Geheime Idee 4711';
      mara.apply([
        CreateOp([
          {'id': id, 'type': 'sticky', 'x': 100, 'y': 100, 'w': 200, 'h': 200, 'color': '#fff27a', 'text': secret},
        ]),
      ]);
      await _until(() => mara.pendingCount == 0, what: 'ack');
      expect(mara.privateObjects.keys, contains(id), reason: '`private` kam vor dem ack');
      expect(mara.isPrivate(id), isTrue);
      expect(mara.state[id]?.text, secret);
      expect(mara.confirmed[id], isNull, reason: 'nicht im Board-Dokument');

      // Jonas: only the placeholder (where and how big), never the text
      await _until(() => readHidden(jonas.state.ext[privateHiddenExt]).any((h) => h.id == id), what: 'Platzhalter');
      final h = readHidden(jonas.state.ext[privateHiddenExt]).firstWhere((h) => h.id == id);
      expect((h.rect.left, h.rect.top, h.rect.width, h.rect.height, h.type), (100.0, 100.0, 200.0, 200.0, 'sticky'));
      expect(h.by, mara.user!.key);
      expect(jonas.state[id], isNull);
      expect(jonas.privateObjects, isEmpty);

      // Mara edits it (update on an ID of her store) – still hidden for Jonas
      mara.apply([
        UpdateOp({
          id: {'x': 140, 'text': '$secret – Nachtrag'},
        }),
      ]);
      await _until(() => mara.pendingCount == 0, what: 'ack update');
      await _until(() => mara.privateObjects[id]?.x == 140, what: 'Ablage geändert');
      await _until(
        () => readHidden(jonas.state.ext[privateHiddenExt]).any((h) => h.id == id && h.rect.left == 140),
        what: 'Platzhalter wandert mit',
      );
      expect(jonasRaw.where((m) => m.contains('Geheime Idee')), isEmpty, reason: 'kein Klartext auf Jonas’ Leitung');

      // Jonas may not reveal while Mara (the facilitator) is here
      await expectLater(
        api('jonas').privateMode(boardId, {'action': 'reveal', 'countdown': 0}),
        throwsA(isA<StachelException>().having((e) => e.code, 'code', 'not_facilitator')),
      );

      // reveal at once: everything on the board, the mode ends
      final revealed = await api('mara').privateMode(boardId, {'action': 'reveal', 'countdown': 0});
      expect(revealed['on'], isNot(isTrue));
      await _until(() => jonas.state[id]?.text == '$secret – Nachtrag', what: 'Jonas sieht den Text');
      await _until(() => !mode(jonas).on && !mode(mara).on, what: 'Modus aus');
      expect(readHidden(jonas.state.ext[privateHiddenExt]).where((h) => h.id == id), isEmpty);
      await _until(() => !mara.isPrivate(id), what: 'bei Mara nicht mehr privat');
      expect(mara.state[id]?.text, '$secret – Nachtrag');
      expect(jonas.state[id]?.x, 140);
    },
    skip: liveSkip,
    timeout: const Timeout(Duration(minutes: 2)),
  );

  test(
    'Countdown: revealAt bei beiden, danach aufgedeckt; „Meine aufdecken“ mit ownReveal',
    () async {
      final (mara, _) = await connect('mara');
      final (jonas, _) = await connect('jonas');
      PrivateMode mode(BoardController c) => PrivateMode.fromJson(c.state.ext[privateModeExt]);
      await api('mara').privateMode(boardId, {'action': 'start', 'ownReveal': true});
      await _until(() => mode(jonas).on && mode(jonas).ownReveal, what: 'Modus an');

      // Jonas writes and reveals his own early
      final own = BoardController.newId();
      jonas.apply([
        CreateOp([
          {'id': own, 'type': 'sticky', 'x': 0, 'y': 400, 'w': 200, 'h': 200, 'color': '#fff27a', 'text': 'Von Jonas'},
        ]),
      ]);
      await _until(() => jonas.pendingCount == 0 && jonas.isPrivate(own), what: 'Jonas privat');
      await _until(() => readHidden(mara.state.ext[privateHiddenExt]).any((h) => h.id == own), what: 'Platzhalter');
      await api('jonas').privateMode(boardId, {'action': 'revealOwn'});
      await _until(() => mara.state[own]?.text == 'Von Jonas', what: 'eigene aufgedeckt');
      expect(mode(mara).on, isTrue, reason: 'der Modus läuft weiter');

      // Mara writes, then reveals with a countdown of 1 s
      final note = BoardController.newId();
      mara.apply([
        CreateOp([
          {'id': note, 'type': 'sticky', 'x': 300, 'y': 400, 'w': 200, 'h': 200, 'color': '#fff27a', 'text': 'Später'},
        ]),
      ]);
      await _until(() => mara.pendingCount == 0 && mara.isPrivate(note), what: 'Mara privat');
      await api('mara').privateMode(boardId, {'action': 'reveal', 'countdown': 1});
      await _until(() => mode(jonas).revealAt != null, what: 'revealAt bei Jonas');
      expect(jonas.state[note], isNull);
      await _until(
        () => jonas.state[note]?.text == 'Später',
        timeout: const Duration(seconds: 8),
        what: 'nach Countdown',
      );
      await _until(() => !mode(jonas).on, what: 'Modus aus');
    },
    skip: liveSkip,
    timeout: const Timeout(Duration(minutes: 2)),
  );

  test(
    'Präsentation übergeben: structure.handover und structure.present.from kommen beim anderen an',
    () async {
      final (mara, _) = await connect('mara');
      final (jonas, _) = await connect('jonas');
      mara.presence.setExtra('structure.present', {
        'frameId': 'f1',
        'index': 0,
        'total': 1,
        'title': 'Start',
      }, immediate: true);
      mara.presence.setExtra('structure.handover', {
        'to': jonas.user!.key,
        'id': 'h_live_1',
        'index': 0,
        'frameId': 'f1',
      }, immediate: true);
      Map? extra(BoardController c, String key, String field) {
        for (final p in c.peers) {
          if (p.key == key && p.extra[field] is Map) return p.extra[field] as Map;
        }
        return null;
      }

      await _until(() => extra(jonas, mara.user!.key, 'structure.handover')?['id'] == 'h_live_1', what: 'Angebot');
      jonas.presence.setExtra('structure.present', {
        'frameId': 'f1',
        'index': 0,
        'total': 1,
        'title': 'Start',
        'from': mara.clientId,
      }, immediate: true);
      await _until(
        () => extra(mara, jonas.user!.key, 'structure.present')?['from'] == mara.clientId,
        what: 'present.from bei Mara',
      );
      mara.presence.setExtra('structure.handover', null, immediate: true);
      await _until(() => extra(jonas, mara.user!.key, 'structure.handover') == null, what: 'zurückgezogen');
    },
    skip: liveSkip,
    timeout: const Timeout(Duration(minutes: 1)),
  );
}

/// What a message carried (objects and ext as JSON) for the check that no private text reached a connection.
String _describe(ServerMessage m) => switch (m) {
  WelcomeMessage(:final snapshot) => jsonEncode(snapshot.toJson()),
  ResumedMessage(:final patches) => jsonEncode([for (final p in patches) _patch(p)]),
  PatchMessage() => jsonEncode(_patch(m)),
  PrivateMessage(:final objects) => jsonEncode([for (final o in objects) o.raw]),
  PresenceMessage(:final peers) => jsonEncode([for (final p in peers) p.extra]),
  _ => m.runtimeType.toString(),
};

Map<String, Object?> _patch(PatchMessage p) => {
  'changes': [
    for (final c in p.changes)
      switch (c) {
        ObjectCreated(:final object) => object.raw,
        ObjectUpdated(:final set) => set,
        ObjectRemoved() => c.id,
      },
  ],
  'ext': p.ext,
};
