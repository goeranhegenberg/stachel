// The Stachel app live against the sandbox with own accounts (`stachel/tools/sandbox.mts <port> --local --seed`):
// register with the native captcha → confirmation mail → verify → login (app session) → board list → native API with
// `hello.client = stachel` and the roles (owner edits, comment only comments, view nothing) → forgot/reset → account.
// Run: flutter test test/live_sandbox_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8690
//   --dart-define=STACHEL_SANDBOX_MAILS=<data dir>/mail.log
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel/app_session.dart';
import 'package:stachel/auth_api.dart';
import 'package:stachel/captcha.dart';
import 'package:stachel/links.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_client/stachel_client.dart';

const _sandbox = String.fromEnvironment('STACHEL_SANDBOX');
const _mails = String.fromEnvironment('STACHEL_SANDBOX_MAILS');
final _skip = _sandbox.isEmpty || _mails.isEmpty ? 'STACHEL_SANDBOX / STACHEL_SANDBOX_MAILS fehlen' : null;
const _password = 'Stachel-Probe-2026';

AuthApi get _api => AuthApi(_sandbox, client: http.Client(), release: false);

/// The newest mail link to [email] of [kind] (`verify` / `reset`).
Future<AppLink> _mailLink(String email, String kind) async {
  for (var i = 0; i < 50; i++) {
    final lines = File(_mails).existsSync() ? File(_mails).readAsLinesSync() : const <String>[];
    for (final l in lines.reversed) {
      final j = jsonDecode(l) as Map;
      if (j['to'] != email) continue;
      final link = appLinkFromText('${j['text']}', _sandbox);
      if (kind == 'verify' && link is VerifyAppLink) return link;
      if (kind == 'reset' && link is ResetAppLink) return link;
    }
    await Future<void>.delayed(const Duration(milliseconds: 100));
  }
  throw StateError('keine $kind-Mail an $email');
}

/// Native connection as [login] to [board]: the welcome, then the answer to [op] (if given).
Future<(WelcomeMessage, ServerMessage?)> _native(AppLogin login, String board, {BoardOp? op}) async {
  final src = NativeBoardSource(
    base: Uri.parse(_sandbox),
    board: board,
    appVersion: '1.0.0+1',
    client: 'stachel',
    token: ({bool fresh = false}) async => login.token,
  );
  final welcome = Completer<WelcomeMessage>();
  final answer = Completer<ServerMessage>();
  final sub = src.messages.listen((m) {
    if (m is WelcomeMessage && !welcome.isCompleted) welcome.complete(m);
    if ((m is AckMessage || m is NackMessage) && !answer.isCompleted) answer.complete(m);
  });
  try {
    await src.open();
    final w = await welcome.future.timeout(const Duration(seconds: 10));
    if (op == null) return (w, null);
    src.send(opsMessage(1, [op]));
    return (w, await answer.future.timeout(const Duration(seconds: 10)));
  } finally {
    await sub.cancel();
    await src.close();
  }
}

void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await StachelSession.clear();
  });

  test('Instanz: eigene Konten, offene Registrierung', () async {
    final i = await _api.instance();
    expect(i.local, isTrue);
    expect(i.registration, 'open');
  }, skip: _skip);

  test(
    'Konto anlegen (Captcha nativ) → Mail → bestätigen → anmelden → Konto → Passwort vergessen',
    () async {
      final email = 'app-${DateTime.now().millisecondsSinceEpoch}@sandbox.test';
      final c = await _api.captcha();
      final watch = Stopwatch()..start();
      final payload = await solveCaptcha(c);
      expect(payload, isNotNull);
      // ignore: avoid_print
      print('Captcha (maxnumber ${c.maxNumber}) in ${watch.elapsedMilliseconds} ms gelöst');
      await _api.register(name: 'App Test', email: email, password: _password, captcha: payload!);
      await expectLater(
        _api.login(email, _password),
        throwsA(isA<StachelException>().having((e) => e.code, 'code', 'not_verified')),
      );
      final verify = await _mailLink(email, 'verify') as VerifyAppLink;
      expect(await _api.verify(verify.token), email);
      final login = await _api.login(email, _password);
      expect(login.token, startsWith('sts_'));
      expect(login.name, 'App Test');

      // board list over the shared package with the app's client
      final session = AppSession(client: http.Client());
      await session.signedIn(_sandbox, 'local', login, email: email);
      final client = StachelAppClient(session, session.account!);
      final boards = HttpStachelBoardsApi(client, release: false);
      final made = await boards.createBoard('Aus der App');
      expect((await boards.boards()).map((b) => b.id), contains(made.id));

      // account with the app session
      final acc = await _api.account(login.token);
      expect((acc.email, acc.name), (email, 'App Test'));
      await _api.rename(login.token, 'App Test 2');
      expect((await _api.account(login.token)).name, 'App Test 2');

      // forgot → reset link → new password works, the old one not
      await _api.forgot(email);
      final reset = await _mailLink(email, 'reset') as ResetAppLink;
      expect(await _api.reset(reset.token, 'Neues-Probe-2026'), email);
      await expectLater(
        _api.login(email, _password),
        throwsA(isA<StachelException>().having((e) => e.code, 'code', 'wrong_login')),
      );
      final again = await _api.login(email, 'Neues-Probe-2026');
      // reset ended the old sessions: the first app session is gone
      await expectLater(
        _api.account(login.token),
        throwsA(isA<StachelException>().having((e) => e.code, 'code', 'session_expired')),
      );

      // delete the account inside the app (Play rule)
      await _api.deleteAccount(again.token, 'Neues-Probe-2026', {made.id: 'delete'});
      await expectLater(
        _api.login(email, 'Neues-Probe-2026'),
        throwsA(isA<StachelException>().having((e) => e.code, 'code', 'wrong_login')),
      );
    },
    skip: _skip,
    timeout: const Timeout(Duration(minutes: 2)),
  );

  test(
    'Native-API als Stachel-App: Rollen owner / comment / view wie im Web',
    () async {
      final owner = await _api.login('owner@sandbox.test', _password);
      final session = AppSession(client: http.Client());
      await session.signedIn(_sandbox, 'local', owner);
      final boards = await HttpStachelBoardsApi(StachelAppClient(session, session.account!), release: false).boards();
      final shared = boards.firstWhere((b) => b.title == 'Geteiltes Board');

      final note = CreateOp([
        {'id': BoardController.newId(), 'type': 'sticky', 'x': 0, 'y': 0, 'w': 200, 'h': 200, 'text': 'App'},
      ]);
      final comment = CommentOp(
        BoardController.newId(),
        BoardController.newId(),
        const CommentAnchor(10, 10),
        'Kommentar aus der Stachel-App',
      );

      final (w1, a1) = await _native(owner, shared.id, op: note);
      expect(w1.info.role, 'owner');
      expect(a1, isA<AckMessage>());

      final commenter = await _api.login('comment@sandbox.test', _password);
      final (w2, a2) = await _native(commenter, shared.id, op: comment);
      expect(w2.info.role, 'comment');
      expect(a2, isA<AckMessage>());
      final (_, n2) = await _native(commenter, shared.id, op: note);
      expect((n2 as NackMessage).error, 'forbidden');

      final viewer = await _api.login('view@sandbox.test', _password);
      final (w3, n3) = await _native(viewer, shared.id, op: comment);
      expect(w3.info.role, 'view');
      expect((n3 as NackMessage).error, 'forbidden');
    },
    skip: _skip,
    timeout: const Timeout(Duration(minutes: 1)),
  );
}
