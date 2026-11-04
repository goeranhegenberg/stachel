// Private mode over REST (docs/features/private.md §4): `HttpStachelBoardsApi.privateMode` posts the action with the
// app session and `X-Stachel: 1`, returns `state`; errors keep the server's text, the app's text only when it sent none.
import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_client/stachel_client.dart';

class _Client extends StachelClient {
  _Client(this.httpClient);
  @override
  final http.Client httpClient;
  @override
  String get base => 'https://stachel.test';
  @override
  String get appName => 'Stachel-App';
  @override
  String? get loginKey => 'probe';
  @override
  Future<String> newSession(String base) async => 'sts_probe';
  @override
  void loginLost(BuildContext context, {String? message}) {}
  @override
  Future<void> openInBrowser({String? board, String? object, ExternalLauncher launcher = launchExternal}) async {}
  @override
  BoardRegistry get registry => stachelBoardRegistry;
}

void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await StachelSession.clear();
  });

  test('POST /api/boards/:id/private mit Bearer und X-Stachel, Antwort = state', () async {
    late http.Request seen;
    final api = HttpStachelBoardsApi(
      _Client(
        MockClient((req) async {
          seen = req;
          return http.Response(
            jsonEncode({
              'ok': true,
              'state': {'on': true, 'by': 'a:mara'},
            }),
            200,
          );
        }),
      ),
      release: false,
    );
    final state = await api.privateMode('b 1', {'action': 'start', 'anonymous': true, 'ownReveal': false});
    expect(state, {'on': true, 'by': 'a:mara'});
    expect((seen.method, seen.url.toString()), ('POST', 'https://stachel.test/api/boards/b%201/private'));
    expect(seen.headers['Authorization'], 'Bearer sts_probe');
    expect(seen.headers['X-Stachel'], '1');
    expect(jsonDecode(seen.body), {'action': 'start', 'anonymous': true, 'ownReveal': false});
  });

  test('Fehler: Text des Servers, sonst der App-Text zum Code', () async {
    Future<Object> error(int status, Map<String, Object?> body) async {
      final api = HttpStachelBoardsApi(
        _Client(MockClient((_) async => http.Response(jsonEncode(body), status))),
        release: false,
      );
      try {
        await api.privateMode('b1', {'action': 'reveal'});
      } catch (e) {
        return e;
      }
      throw StateError('kein Fehler');
    }

    final withText = await error(403, {'error': 'not_facilitator', 'message': 'Aufdecken kann nur Mara.'});
    expect(stachelPrivateErrorText(withText), 'Aufdecken kann nur Mara.');
    final bare = await error(409, {'error': 'not_running'});
    expect(stachelPrivateErrorText(bare), 'Der private Modus läuft nicht mehr.');
    expect(stachelPrivateErrorText(StateError('x')), 'Das hat nicht geklappt. Bitte versuch es noch einmal.');
  });
}
