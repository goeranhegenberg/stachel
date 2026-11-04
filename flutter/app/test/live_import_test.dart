// „Board importieren“ der App live gegen die Sandbox mit Fake-Miro (docs/features/import.md): Quellen, Token prüfen
// (falsch → miro_token_invalid mit deutschem Text), Board-Liste mit Suche, Import eines Boards bis „done“ mit Bericht,
// das neue Board in der Board-Liste, „Letzte Importe“; „Mit Miro verbinden“ wie im System-Browser (Freigabeseite →
// Bestätigung ohne Cookie → „Fertig – verbunden“), danach `connected`, Board-Liste über `oauth`, trennen.
//
//   server/node_modules/.bin/tsx tools/miro-fake.mts 8794
//   STACHEL_IMPORT_MIRO_API_BASE=http://127.0.0.1:8794 STACHEL_IMPORT_MIRO_AUTH_BASE=http://127.0.0.1:8794 \
//   MIRO_CLIENT_ID=fake-client MIRO_CLIENT_SECRET=fake-secret server/node_modules/.bin/tsx tools/sandbox.mts 8792 --local --seed
//   flutter test test/live_import_test.dart --dart-define=STACHEL_SANDBOX=http://127.0.0.1:8792
@Tags(['live'])
library;

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel/auth_api.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_client/stachel_client.dart';

const _sandbox = String.fromEnvironment('STACHEL_SANDBOX');
final _skip = _sandbox.isEmpty ? 'STACHEL_SANDBOX fehlt' : null;
const _password = 'Stachel-Probe-2026';

/// Die Stachel-App als owner@sandbox.test.
class _Client extends StachelClient {
  _Client(this.httpClient);
  @override
  final http.Client httpClient;
  @override
  String get base => _sandbox;
  @override
  String get appName => 'Stachel-App';
  @override
  String? get clientId => 'stachel';
  @override
  String? get loginKey => 'owner@sandbox.test';
  @override
  Future<String> newSession(String base) async =>
      (await AuthApi(base, client: httpClient, release: false).login('owner@sandbox.test', _password)).token;
  @override
  void loginLost(BuildContext context, {String? message}) {}
  @override
  Future<void> openInBrowser({String? board, String? object, ExternalLauncher launcher = launchExternal}) async {}
  @override
  BoardRegistry get registry => stachelBoardRegistry;
}

late http.Client _http;
late HttpStachelBoardsApi _boards;
late StachelImportApi _api;

Future<StachelImportJob> _until(String id, {Duration max = const Duration(seconds: 60)}) async {
  final end = DateTime.now().add(max);
  while (true) {
    final j = await _api.job(id);
    if (!j.active) return j;
    if (DateTime.now().isAfter(end)) throw StateError('Import $id läuft noch: ${j.progressText}');
    await Future<void>.delayed(stachelImportPoll);
  }
}

/// Der System-Browser ohne Stachel-Cookie: Freigabeseite von (Fake-)Miro → Rücksprung → Bestätigung → „Verbinden“.
Future<String> _browserConsent(Uri url) async {
  final browser = http.Client();
  try {
    final miro = await browser.send(http.Request('GET', url)..followRedirects = false);
    final back = miro.headers['location'];
    expect(miro.statusCode, 302, reason: 'Freigabeseite von Miro leitet zurück');
    final confirm = await browser.get(Uri.parse(back!));
    expect(confirm.statusCode, 200);
    expect(confirm.body, contains('verbinden?'));
    String field(String name) => RegExp('name="$name" value="([^"]+)"').firstMatch(confirm.body)!.group(1)!;
    final done = await browser.post(
      Uri.parse(back).replace(query: ''),
      body: {'state': field('state'), 'nonce': field('nonce'), 'confirm': '1'},
    );
    return done.body;
  } finally {
    browser.close();
  }
}

void main() {
  setUpAll(() async {
    SharedPreferences.setMockInitialValues({});
    await StachelSession.clear();
    _http = http.Client();
    _boards = HttpStachelBoardsApi(_Client(_http), release: false);
    _api = StachelImportApi(_boards);
  });
  tearDownAll(() => _http.close());

  test('Quellen: Import an, Token und OAuth möglich, noch nicht verbunden', () async {
    final s = await _api.sources();
    expect((s.enabled, s.token, s.oauth, s.connected, s.available), (true, true, true, false, true));
  }, skip: _skip);

  test('Token: falsches lehnt der Server mit deutschem Text ab, richtiges → Boards → Import → Bericht', () async {
    await expectLater(
      _api.connectToken('kein-gueltiges-token'),
      throwsA(
        isA<StachelException>()
            .having((e) => e.code, 'code', 'miro_token_invalid')
            .having((e) => e.message, 'message', contains('Token')),
      ),
    );
    final conn = await _api.connectToken('fake-token');
    expect(conn, isNot(stachelImportOauthConn));
    final all = await _api.remoteBoards(conn);
    expect(all.boards.map((b) => b.id), contains('demo1'));
    final hit = await _api.remoteBoards(conn, query: 'Beispiel');
    expect(hit.boards.map((b) => b.name), ['Beispiel-Board']);
    // unbekannte Verbindung → miro_conn_expired (ohne neue Stachel-Sitzung)
    await expectLater(
      _api.remoteBoards('gibt-es-nicht'),
      throwsA(isA<StachelException>().having((e) => e.code, 'code', 'miro_conn_expired')),
    );

    final jobs = await _api.startJobs(conn, ['demo1']);
    expect(jobs.single.sourceName, 'Beispiel-Board');
    final done = await _until(jobs.single.id);
    expect(done.status, 'done', reason: done.error);
    expect(done.boardId, isNotNull);
    final r = done.report!;
    for (final type in ['sticky', 'shape', 'frame', 'image', 'document', 'connector']) {
      expect(r.imported[type] ?? 0, greaterThan(0), reason: type);
    }
    expect(stachelImportReportSummary(r), startsWith('${r.importedTotal} Objekte übernommen'));
    expect(r.notes, isNotEmpty);

    final list = await _boards.boards();
    expect(list.where((b) => b.id == done.boardId).single.title, 'Beispiel-Board');
    final recent = await _api.jobs();
    expect(recent.first.id, done.id);
  }, skip: _skip);

  test('Mit Miro verbinden wie aus der App: Browser-Freigabe, connected, Boards über oauth, trennen', () async {
    final url = await _api.oauthStart();
    expect(url.queryParameters['scope'], 'boards:read');
    expect(url.queryParameters['code_challenge_method'], 'S256');
    final page = await _browserConsent(url);
    expect(page, contains('Fertig'));
    expect(page, contains('zur App zurückkehren'));
    expect((await _api.sources()).connected, isTrue);
    final boards = await _api.remoteBoards(stachelImportOauthConn);
    expect(boards.boards.map((b) => b.id), contains('demo1'));
    await _api.disconnect();
    expect((await _api.sources()).connected, isFalse);
    await expectLater(
      _api.remoteBoards(stachelImportOauthConn),
      throwsA(isA<StachelException>().having((e) => e.code, 'code', 'miro_conn_expired')),
    );
  }, skip: _skip);
}
