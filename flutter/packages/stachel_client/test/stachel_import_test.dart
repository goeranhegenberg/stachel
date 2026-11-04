// „Board importieren“ (docs/features/import.md, `shared/import.ts`): Modelle, API (Fehlercodes, `miro_conn_expired`
// holt keine neue Stachel-Sitzung), der ganze Ablauf gegen einen Attrappen-Server über `MockClient` – Eintrag im
// Neues-Board-Blatt, Token → Boards → Fortschritt → Bericht → Board öffnen, „Mit Miro verbinden“ (Browser, Abfrage,
// Rückkehr in die App, trennen), Fehler, Grenze von 10 Boards, Dialog in großen Fenstern, letzte Importe.

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel_client/stachel_client.dart';

import 'support/fake_stachel.dart';

const _report = {
  'imported': {'sticky': 12, 'shape': 4, 'connector': 3, 'frame': 0},
  'adjusted': [
    {'code': 'sticky_color', 'text': 'Notizfarbe auf die Palette angepasst', 'count': 7},
  ],
  'skipped': [
    {'code': 'unsupported_type', 'text': 'Unbekannter Typ „poll“', 'count': 2},
  ],
  'notes': ['Tabellen, Kommentare und Freihand-Zeichnungen liefert die Miro-Schnittstelle nicht.'],
};

/// Stachel mit Import (Attrappe): Quellen, Token, OAuth, Board-Liste (55 Boards, Seiten zu 50), Aufträge, die bei jeder
/// Abfrage eine Phase weiterkommen. Alles andere beantwortet [base] (Board-Liste der App).
class FakeImport {
  FakeImport({this.enabled = true, this.token = true, this.oauth = false, this.connected = false});

  bool enabled, token, oauth, connected;
  final base = FakeStachelServer();
  final requests = <SeenRequest>[];
  final launched = <Uri>[];

  /// Fehler (Code, Status, Text) für die jeweilige Route.
  (String, int, String)? tokenError, boardsError, jobsError, oauthError, sourcesError;

  final remote = [
    for (var i = 0; i < 55; i++)
      {
        'id': 'm$i',
        'name': i == 0 ? 'Workshop Q4' : 'Board $i',
        if (i == 0) 'description': 'Planung fürs Quartal',
        'modifiedAt': '2026-11-03T10:00:00Z',
      },
  ];

  final jobs = <String, Map<String, Object?>>{};
  final recent = <Map<String, Object?>>[];
  var _n = 0;

  Iterable<SeenRequest> calls(String method, String path) =>
      requests.where((r) => r.method == method && r.path == path);

  http.Response _err((String, int, String) e) =>
      json({'ok': false, 'error': e.$1, if (e.$3.isNotEmpty) 'message': e.$3}, e.$2);

  /// Eine Phase weiter: wartet → Objekte lesen → Bilder laden → fertig.
  void _advance(Map<String, Object?> j) {
    if (j['status'] == 'canceled' || j['status'] == 'done') return;
    switch (j['phase']) {
      case 'queued':
        j.addAll({'status': 'running', 'phase': 'read', 'done': 10, 'total': 40});
      case 'read':
        j.addAll({'phase': 'images', 'done': 3, 'total': 5});
      default:
        j.addAll({
          'status': 'done',
          'phase': 'done',
          'boardId': 'imp-${j['id']}',
          'report': _report,
          'finishedAt': '2026-11-04T09:00:00Z',
        });
    }
  }

  late final http.Client client = MockClient((req) async {
    final path = req.url.path;
    if (!path.startsWith('/api/import')) {
      final copy = http.Request(req.method, req.url)
        ..headers.addAll(req.headers)
        ..bodyBytes = req.bodyBytes;
      return http.Response.fromStream(await base.client.send(copy));
    }
    final body = req.body.isEmpty ? null : jsonDecode(req.body);
    requests.add((
      method: req.method,
      path: req.url.toString().substring(req.url.origin.length),
      body: body,
      write: req.headers['X-Stachel'] == '1',
    ));
    if (req.headers['Authorization'] != 'Bearer sts_test') return json({'ok': false, 'error': 'invalid_token'}, 401);
    final m = req.method;
    if (path == '/api/import/sources') {
      if (sourcesError case final e?) return _err(e);
      return json({
        'ok': true,
        'miro': {'enabled': enabled, 'token': token, 'oauth': oauth, 'connected': connected},
      });
    }
    if (path == '/api/import/miro/token' && m == 'POST') {
      if (tokenError case final e?) return _err(e);
      return json({'ok': true, 'conn': 'c1', 'expiresAt': '2026-11-04T10:00:00Z'});
    }
    if (path == '/api/import/miro/oauth/start' && m == 'POST') {
      if (oauthError case final e?) return _err(e);
      return json({'ok': true, 'url': 'https://miro.com/oauth/authorize?state=abc'});
    }
    if (path == '/api/import/miro/oauth' && m == 'DELETE') {
      connected = false;
      return json({'ok': true});
    }
    if (path == '/api/import/miro/boards') {
      if (boardsError case final e?) return _err(e);
      final q = (req.url.queryParameters['query'] ?? '').toLowerCase();
      final offset = int.tryParse(req.url.queryParameters['offset'] ?? '') ?? 0;
      final hits = remote.where((b) => (b['name'] as String).toLowerCase().contains(q)).toList();
      final page = hits.skip(offset).take(50).toList();
      return json({'ok': true, 'boards': page, if (offset + 50 < hits.length) 'next': offset + 50});
    }
    if (path == '/api/import/miro/jobs' && m == 'POST') {
      if (jobsError case final e?) return _err(e);
      final ids = ((body as Map)['boards'] as List).cast<String>();
      final out = [
        for (final id in ids)
          {
            'id': 'j${++_n}',
            'source': 'miro',
            'sourceBoard': id,
            'sourceName': remote.firstWhere((b) => b['id'] == id)['name'],
            'status': 'queued',
            'phase': 'queued',
            'done': 0,
            'total': 0,
            'createdAt': '2026-11-04T08:59:00Z',
          },
      ];
      for (final j in out) {
        jobs[j['id'] as String] = j;
      }
      return json({'ok': true, 'jobs': out}, 202);
    }
    if (path == '/api/import/jobs' && m == 'GET') return json({'ok': true, 'jobs': recent});
    final jm = RegExp(r'^/api/import/jobs/([^/]+)$').firstMatch(path);
    if (jm != null) {
      final j = jobs[jm.group(1)];
      if (j == null) return json({'ok': false, 'error': 'not_found', 'message': 'Diesen Import gibt es nicht.'}, 404);
      if (m == 'DELETE') {
        j.addAll({'status': 'canceled'});
        return json({'ok': true});
      }
      _advance(j);
      return json({'ok': true, 'job': j});
    }
    return json({'ok': false, 'error': 'not_found', 'message': 'Gibt es nicht.'}, 404);
  });
}

Future<void> _settle(WidgetTester t, [int rounds = 6]) async {
  for (var i = 0; i < rounds; i++) {
    await t.pump(const Duration(milliseconds: 50));
  }
}

Future<void> _tap(WidgetTester t, String key) async {
  final f = find.byKey(Key(key));
  if (f.evaluate().isEmpty) await _scrollTo(t, key);
  // ensureVisible schiebt das Ziel immer an den oberen Rand – nur wenn es nicht schon zu sehen ist
  if (f.hitTestable().evaluate().isEmpty) {
    await t.ensureVisible(f);
    await t.pump();
  }
  await t.tap(f);
  await _settle(t);
}

/// Scrollt im Import-Bildschirm, bis [key] gebaut und sichtbar ist.
Future<void> _scrollTo(WidgetTester t, String key, {double delta = 300}) async {
  final list = find.descendant(of: find.byKey(const Key('stachelImportScreen')), matching: find.byType(Scrollable));
  await t.scrollUntilVisible(find.byKey(Key(key)), delta, scrollable: list.first);
  await t.pump();
}

/// Ein Knopf, der den Import öffnet; [opened] = Ergebnis („Board öffnen“), [imported] = fertige Importe gemeldet.
class _Host {
  StachelImportedBoard? opened;
  var imported = 0;
  final lost = <StachelException>[];
}

Future<_Host> _open(WidgetTester t, FakeImport f, {Size size = const Size(390, 844)}) async {
  SharedPreferences.setMockInitialValues({});
  await StachelSession.clear();
  t.view.physicalSize = size;
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
  final host = _Host();
  final client = TestStachelClient(f.client);
  final api = StachelImportApi(TestBoardsApi(client));
  await t.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (ctx) => Scaffold(
          body: Center(
            child: TextButton(
              key: const Key('go'),
              onPressed: () async {
                host.opened = await showStachelImport(
                  ctx,
                  api: api,
                  launcher: (u) async {
                    f.launched.add(u);
                    return true;
                  },
                  onImported: () => host.imported++,
                  onLoginLost: host.lost.add,
                );
              },
              child: const Text('go'),
            ),
          ),
        ),
      ),
    ),
  );
  await t.tap(find.byKey(const Key('go')));
  await _settle(t);
  return host;
}

/// Zwischenablage mit [text] (für „Einfügen“).
void _clipboard(WidgetTester t, String text) {
  final messenger = t.binding.defaultBinaryMessenger;
  messenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
    if (call.method == 'Clipboard.getData') return {'text': text};
    return null;
  });
  addTearDown(() => messenger.setMockMethodCallHandler(SystemChannels.platform, null));
}

String _text(WidgetTester t, String key) => t.widget<Text>(find.byKey(Key(key))).data!;

/// Mit Token verbinden (Schritt „Zugang zu Miro“ → „Welche Boards?“).
Future<void> _connectWithToken(WidgetTester t) async {
  await _tap(t, 'stachelImportSourceMiro');
  await t.enterText(find.byKey(const Key('stachelImportToken')), 'tok');
  await _tap(t, 'stachelImportTokenConnect');
}

Future<void> _pollOnce(WidgetTester t) async {
  await t.pump(stachelImportPoll);
  await _settle(t);
}

void main() {
  group('Modelle', () {
    test('Quellen: verfügbar nur mit enabled und einem Weg', () {
      expect(StachelImportSources.fromJson({'ok': true}).available, isFalse);
      final s = StachelImportSources.fromJson({
        'ok': true,
        'miro': {'enabled': true, 'token': false, 'oauth': true, 'connected': true},
      });
      expect((s.enabled, s.token, s.oauth, s.connected, s.available), (true, false, true, true, true));
      expect(
        StachelImportSources.fromJson({
          'miro': {'enabled': true, 'token': false, 'oauth': false},
        }).available,
        isFalse,
      );
      expect(
        StachelImportSources.fromJson({
          'miro': {'enabled': false, 'token': true, 'oauth': true},
        }).available,
        isFalse,
      );
    });

    test('Board-Liste: Einträge ohne id fallen weg, next als Zahl', () {
      final p = StachelImportRemoteBoards.fromJson({
        'ok': true,
        'boards': [
          {'id': 'a', 'name': 'Eins', 'description': 'Text', 'modifiedAt': '2026-11-01T10:00:00Z'},
          {'id': 'b', 'name': '  '},
          {'name': 'ohne id'},
        ],
        'next': 50,
      });
      expect(p.boards.map((b) => b.name), ['Eins', 'Unbenanntes Board']);
      expect(p.boards.first.modifiedAt, DateTime.utc(2026, 11, 1, 10));
      expect(p.next, 50);
      expect(StachelImportRemoteBoards.fromJson({'boards': []}).next, isNull);
      expect(() => StachelImportRemoteBoards.fromJson({'ok': true}), throwsA(isA<StachelException>()));
    });

    test('Auftrag: Phasen und Fortschritt wie im Web (phaseLabel, progressText, statusChip)', () {
      StachelImportJob job(Map<String, Object?> j) =>
          StachelImportJob.fromJson({'id': 'j1', 'sourceName': 'X', 'status': 'running', ...j})!;
      expect(job({'status': 'queued', 'phase': 'queued'}).progressText, 'Wartet auf den Start');
      final read = job({'phase': 'read', 'done': 10, 'total': 40});
      expect(read.progressText, 'Objekte lesen · 10 von 40');
      expect(read.progress, 0.25);
      expect(read.chipText, 'Objekte lesen 25 %');
      expect(job({'phase': 'images', 'done': 7, 'total': 5}).progressText, 'Bilder laden · 5 von 5');
      expect(job({'phase': 'build'}).progressText, 'Board anlegen');
      expect(job({'phase': 'build'}).progress, isNull);
      expect(job({'phase': 'irgendwas'}).phaseLabel, 'Läuft');
      expect(job({'status': 'failed', 'phase': 'read', 'done': 1, 'total': 2}).progressText, 'Fehlgeschlagen');
      expect(job({'status': 'canceled'}).active, isFalse);
      expect(job({'status': 'canceled'}).chipText, 'Abgebrochen');
      final done = job({'status': 'done', 'phase': 'done', 'boardId': 'b9', 'report': _report});
      expect(done.progress, 1);
      final r = done.report!;
      expect(r.imported, {'sticky': 12, 'shape': 4, 'connector': 3}); // 0 fällt weg
      expect(r.importedTotal, 19);
      expect(r.adjusted.single.text, 'Notizfarbe auf die Palette angepasst');
      expect(r.adjusted.single.count, 7);
      expect(r.skipped.single.code, 'unsupported_type');
      expect(r.notes, hasLength(1));
      expect(StachelImportJob.fromJson({'sourceName': 'ohne id'}), isNull);
      expect(StachelImportJob.fromJson({'id': 'x', 'status': 'done'})!.sourceName, 'Unbenanntes Board');
    });

    test('Bericht: Zählung, Zusammenfassung, Einträge, Überschrift wie im Web', () {
      expect(stachelImportTypeCount('sticky', 1), '1 Notiz');
      expect(stachelImportTypeCount('sticky', 12), '12 Notizen');
      expect(stachelImportTypeCount('poll', 3), '3 × poll');
      final r = StachelImportReport.fromJson({
        ..._report,
        'imported': {'frame': 4, 'sticky': 12, 'shape': 4, 'card': 1},
      });
      expect(stachelImportedList(r), ['12 Notizen', '4 Formen', '4 Rahmen', '1 Karte']);
      expect(stachelImportReportSummary(r), '21 Objekte übernommen · 7 angepasst · 2 nicht übernommen');
      expect(stachelImportReportSummary(const StachelImportReport(imported: {'text': 1})), '1 Objekt übernommen');
      expect(stachelImportReportSummary(null), '');
      expect(
        stachelImportEntryText(const StachelImportReportEntry('a', 'Notizfarbe angepasst', 7)),
        '7 × Notizfarbe angepasst',
      );
      expect(
        stachelImportEntryText(const StachelImportReportEntry('a', '3 Bilder über der Quote', 3)),
        '3 Bilder über der Quote',
      );
      expect(
        stachelImportEntryText(const StachelImportReportEntry('a', 'Mindmap neu angeordnet', 1)),
        'Mindmap neu angeordnet',
      );
      StachelImportJob j(String status) => StachelImportJob(id: status, sourceName: 'X', status: status);
      expect(stachelImportJobsHeading([j('running')]), 'Board wird übernommen');
      expect(stachelImportJobsHeading([j('queued'), j('done')]), 'Boards werden übernommen');
      expect(stachelImportJobsHeading([j('done'), j('done')]), 'Import fertig');
      expect(stachelImportJobsHeading([j('failed')]), 'Import fehlgeschlagen');
      expect(stachelImportJobsHeading([j('canceled')]), 'Import abgebrochen');
      expect(stachelImportJobsHeading([j('done'), j('failed')]), 'Import beendet');
    });

    test('Optionen', () {
      expect(const StachelImportOptions().toJson(), {'keepColors': false, 'description': true});
    });
  });

  group('API', () {
    late FakeImport f;
    late StachelImportApi api;
    setUp(() async {
      SharedPreferences.setMockInitialValues({});
      await StachelSession.clear();
      f = FakeImport();
      api = StachelImportApi(TestBoardsApi(TestStachelClient(f.client)));
    });

    test('miro_conn_expired (401) holt keine neue Sitzung und bringt den Text des Servers', () async {
      f.boardsError = ('miro_conn_expired', 401, 'Die Verbindung zu Miro ist abgelaufen (Server).');
      await expectLater(
        api.remoteBoards('c1'),
        throwsA(
          isA<StachelException>()
              .having((e) => e.code, 'code', 'miro_conn_expired')
              .having((e) => e.message, 'message', 'Die Verbindung zu Miro ist abgelaufen (Server).')
              .having((e) => e.needsLogin, 'needsLogin', isFalse),
        ),
      );
      expect(f.requests.where((r) => r.path.startsWith('/api/import/miro/boards')), hasLength(1));
    });

    test('ohne Text des Servers: eigener deutscher Text; fremde Codes wie überall', () async {
      f.jobsError = ('import_limit', 429, '');
      await expectLater(
        api.startJobs('c1', ['m0']),
        throwsA(isA<StachelException>().having((e) => e.message, 'message', stachelImportErrorText('import_limit'))),
      );
      f.tokenError = ('rate_limited', 429, 'Zu viele Versuche (Server).');
      await expectLater(
        api.connectToken('x'),
        throwsA(
          isA<StachelException>()
              .having((e) => e.code, 'code', 'rate_limited')
              .having((e) => e.message, 'message', 'Zu viele Versuche (Server).'),
        ),
      );
      expect(stachelImportErrorText('import_limit'), contains('morgen'));
      expect(stachelImportErrorText('network'), stachelErrorText('network', null));
    });

    test('Anfragen: schreibend mit X-Stachel, Token nur im Körper, Suche und Seite in der Adresse', () async {
      expect(await api.connectToken('  tok_1 '), 'c1');
      final post = f.calls('POST', '/api/import/miro/token').single;
      expect(post.body, {'token': 'tok_1'});
      expect(post.write, isTrue);
      final page = await api.remoteBoards('c1', query: 'board 1', offset: 0);
      expect(page.boards.first.name, 'Board 1');
      expect(f.requests.last.path, '/api/import/miro/boards?conn=c1&query=board+1');
      expect(f.requests.last.write, isFalse);
      final more = await api.remoteBoards('c1', offset: 50);
      expect(more.boards, hasLength(5));
      expect(more.next, isNull);
      final jobs = await api.startJobs('c1', ['m0'], options: const StachelImportOptions(keepColors: true));
      expect(jobs.single.sourceName, 'Workshop Q4');
      expect(f.calls('POST', '/api/import/miro/jobs').single.body, {
        'conn': 'c1',
        'boards': ['m0'],
        'options': {'keepColors': true, 'description': true},
      });
      expect((await api.job(jobs.single.id)).phase, 'read');
      await api.cancelJob(jobs.single.id);
      expect(f.calls('DELETE', '/api/import/jobs/${jobs.single.id}').single.write, isTrue);
      expect((await api.oauthStart()).host, 'miro.com');
      expect(f.calls('POST', '/api/import/miro/oauth/start').single.body, {'client': 'app'});
      await api.disconnect();
      expect(f.calls('DELETE', '/api/import/miro/oauth').single.write, isTrue);
    });
  });

  group('Ablauf', () {
    testWidgets('Board-Liste: „Board importieren“ im Neues-Board-Blatt, Token → Boards → Fortschritt → Bericht → '
        'Board öffnen', (t) async {
      SharedPreferences.setMockInitialValues({});
      await StachelSession.clear();
      final f = FakeImport();
      _clipboard(t, ' tok_aus_miro ');
      final client = TestStachelClient(f.client);
      t.view.physicalSize = const Size(390, 844);
      t.view.devicePixelRatio = 1;
      addTearDown(t.view.reset);
      await t.pumpWidget(
        MaterialApp(
          home: StachelHomeScreen(
            client: client,
            boardsApi: TestBoardsApi(client),
            boardScreen: (id, title, object) => Scaffold(body: Text('Board $id · $title')),
            showNativePreview: false,
          ),
        ),
      );
      await t.pumpAndSettle();
      await t.tap(find.byKey(const Key('stachelNewBoard')));
      await t.pumpAndSettle();
      await _tap(t, 'stachelImportBoard');
      expect(find.byKey(const Key('stachelNewBoardSheet')), findsNothing);
      expect(find.text('BOARD IMPORTIEREN'), findsOneWidget);
      expect(find.text('Woher?'), findsOneWidget);
      expect(find.text(stachelMiroTrademark), findsOneWidget);
      expect(find.text('Letzte Importe'), findsNothing); // keine

      // Verbinden mit Token
      await _tap(t, 'stachelImportSourceMiro');
      expect(find.byKey(const Key('stachelImportSteps')), findsOneWidget);
      expect(find.text('Zugang zu Miro'), findsOneWidget);
      expect(find.byKey(const Key('stachelImportOauth')), findsNothing); // Instanz ohne Miro-App
      await _tap(t, 'stachelImportTokenConnect');
      expect(_text(t, 'stachelImportConnectError'), 'Bitte füge zuerst das Token aus Miro ein.');
      await _tap(t, 'stachelImportTokenHelp');
      expect(find.textContaining('boards:read'), findsWidgets);
      expect(find.textContaining('Install app and get OAuth token'), findsOneWidget);
      await _tap(t, 'stachelImportTokenPaste');
      final field = t.widget<TextField>(find.byKey(const Key('stachelImportToken')));
      expect(field.controller!.text, 'tok_aus_miro');
      expect(field.obscureText, isTrue);
      await _tap(t, 'stachelImportTokenConnect');
      expect(f.calls('POST', '/api/import/miro/token').single.body, {'token': 'tok_aus_miro'});
      expect(find.byKey(const Key('stachelImportToken')), findsNothing);

      // Boards wählen
      expect(find.text('Welche Boards?'), findsOneWidget);
      expect(find.text('Mit deinem Token verbunden'), findsOneWidget);
      expect(find.byKey(const Key('stachelImportDisconnect')), findsNothing); // Token: nichts zu trennen
      expect(find.byKey(const Key('stachelImportOtherToken')), findsOneWidget);
      expect(_text(t, 'stachelImportCount'), 'Wähle bis zu 10 Boards.');
      expect(t.widget<FilledButton>(find.byKey(const Key('stachelImportStart'))).onPressed, isNull);
      await _tap(t, 'stachelImportBoard-m0');
      expect(find.text('IMPORTIEREN'), findsOneWidget);
      await _tap(t, 'stachelImportBoard-m1');
      expect(_text(t, 'stachelImportCount'), '2 ausgewählt');
      expect(find.text('2 BOARDS IMPORTIEREN'), findsOneWidget);
      await _scrollTo(t, 'stachelImportMore');
      await _tap(t, 'stachelImportMore');
      expect(f.requests.last.path, '/api/import/miro/boards?conn=c1&offset=50');
      await _scrollTo(t, 'stachelImportKeepColors');
      expect(t.widget<SwitchListTile>(find.byKey(const Key('stachelImportKeepColors'))).value, isFalse);
      expect(t.widget<SwitchListTile>(find.byKey(const Key('stachelImportDescription'))).value, isTrue);
      await _tap(t, 'stachelImportKeepColors');
      await _tap(t, 'stachelImportStart');
      expect(f.calls('POST', '/api/import/miro/jobs').single.body, {
        'conn': 'c1',
        'boards': ['m0', 'm1'],
        'options': {'keepColors': true, 'description': true},
      });

      // Fortschritt (Abfrage alle 1,5 s)
      expect(find.text('Boards werden übernommen'), findsOneWidget);
      expect(find.textContaining('läuft im Hintergrund weiter'), findsOneWidget);
      expect(_text(t, 'stachelImportPhase-j1'), 'Wartet auf den Start');
      await _pollOnce(t);
      expect(_text(t, 'stachelImportPhase-j1'), 'Objekte lesen · 10 von 40');
      expect(_text(t, 'stachelImportPhase-j2'), 'Objekte lesen · 10 von 40');
      await _pollOnce(t);
      expect(_text(t, 'stachelImportPhase-j1'), 'Bilder laden · 3 von 5');
      final listLoads = f.base.calls('GET', '/api/boards').length;
      await _pollOnce(t);
      expect(find.byKey(const Key('stachelImportPhase-j1')), findsNothing);
      expect(find.text('Import fertig'), findsOneWidget);
      expect(find.text('Fertig'), findsNWidgets(2));
      await t.pump(const Duration(milliseconds: 500));
      expect(f.base.calls('GET', '/api/boards').length, greaterThan(listLoads)); // Board-Liste neu geladen
      final polls = f.requests.where((r) => r.path == '/api/import/jobs/j1').length;
      await t.pump(stachelImportPoll * 3);
      expect(f.requests.where((r) => r.path == '/api/import/jobs/j1').length, polls); // fertig: keine Abfrage mehr

      // Bericht (zwei Boards: zugeklappt)
      expect(find.byKey(const Key('stachelImportReportView')), findsNothing);
      expect(find.text('19 Objekte übernommen · 7 angepasst · 2 nicht übernommen'), findsNWidgets(2));
      await _tap(t, 'stachelImportReport-j2');
      expect(find.byKey(const Key('stachelImportReportView')), findsOneWidget);
      expect(find.text('12 Notizen'), findsOneWidget);
      expect(find.text('3 Verbinder'), findsOneWidget);
      expect(find.text('7 × Notizfarbe auf die Palette angepasst'), findsOneWidget);
      expect(find.text('NICHT ÜBERNOMMEN'), findsOneWidget);
      expect(find.text('2 × Unbekannter Typ „poll“'), findsOneWidget);
      expect(find.text('GUT ZU WISSEN'), findsOneWidget);
      expect(find.textContaining('Tabellen, Kommentare'), findsOneWidget);
      await _tap(t, 'stachelImportOpen-j2');
      await t.pumpAndSettle();
      expect(find.text('Board imp-j2 · Board 1'), findsOneWidget);
    });

    testWidgets('Ohne Import auf der Instanz kein Eintrag im Neues-Board-Blatt', (t) async {
      SharedPreferences.setMockInitialValues({});
      await StachelSession.clear();
      final f = FakeImport(enabled: false);
      final client = TestStachelClient(f.client);
      await t.pumpWidget(
        MaterialApp(
          home: StachelHomeScreen(client: client, boardsApi: TestBoardsApi(client), showNativePreview: false),
        ),
      );
      await t.pumpAndSettle();
      expect(f.calls('GET', '/api/import/sources'), hasLength(1));
      await t.tap(find.byKey(const Key('stachelNewBoard')));
      await t.pumpAndSettle();
      expect(find.byKey(const Key('stachelNewBoardSheet')), findsOneWidget);
      expect(find.byKey(const Key('stachelImportBoard')), findsNothing);
    });

    testWidgets('Ein Board: Bericht gleich offen, onImported; Abbrechen; Im Hintergrund weiter', (t) async {
      final f = FakeImport();
      final host = await _open(t, f);
      await _connectWithToken(t);
      await _tap(t, 'stachelImportBoard-m0');
      await _tap(t, 'stachelImportStart');
      expect(find.text('Board wird übernommen'), findsOneWidget);
      for (var i = 0; i < 3; i++) {
        await _pollOnce(t);
      }
      expect(host.imported, 1);
      expect(find.text('Import fertig'), findsOneWidget);
      expect(find.byKey(const Key('stachelImportReportView')), findsOneWidget);
      expect(find.text('19 Objekte übernommen · 7 angepasst · 2 nicht übernommen'), findsOneWidget);
      await _tap(t, 'stachelImportOpen-j1');
      expect(host.opened, (id: 'imp-j1', title: 'Workshop Q4'));

      // zweiter Durchgang: abbrechen
      await t.pumpAndSettle();
      await t.tap(find.byKey(const Key('go')));
      await _settle(t);
      await _connectWithToken(t);
      await _tap(t, 'stachelImportBoard-m3');
      await _tap(t, 'stachelImportStart');
      await _tap(t, 'stachelImportCancel-j2');
      expect(f.calls('DELETE', '/api/import/jobs/j2'), hasLength(1));
      expect(find.text('Import abgebrochen'), findsOneWidget);
      expect(find.byKey(const Key('stachelImportCanceled-j2')), findsOneWidget);
      expect(find.byKey(const Key('stachelImportCancel-j2')), findsNothing);
      // „Weitere importieren“ führt mit derselben Verbindung zur Auswahl
      await _tap(t, 'stachelImportMoreBoards');
      expect(find.text('Welche Boards?'), findsOneWidget);
      await _tap(t, 'stachelImportBoard-m4');
      await _tap(t, 'stachelImportStart');
      expect(f.calls('POST', '/api/import/miro/jobs').last.body, containsPair('conn', 'c1'));
      // verlassen ist erlaubt, der Import läuft weiter
      await _tap(t, 'stachelImportBackground');
      await t.pumpAndSettle();
      expect(find.byKey(const Key('stachelImportScreen')), findsNothing);
      expect(host.opened, isNull);
    });

    testWidgets('Höchstens 10 Boards; Suche fragt den Server', (t) async {
      final f = FakeImport();
      await _open(t, f, size: const Size(390, 2400));
      await _connectWithToken(t);
      for (var i = 0; i < 10; i++) {
        await _tap(t, 'stachelImportBoard-m$i');
      }
      expect(_text(t, 'stachelImportCount'), '10 ausgewählt – mehr als 10 gehen nicht auf einmal');
      expect(t.widget<CheckboxListTile>(find.byKey(const Key('stachelImportBoard-m10'))).enabled, isFalse);
      await _tap(t, 'stachelImportBoard-m10');
      expect(_text(t, 'stachelImportCount'), '10 ausgewählt – mehr als 10 gehen nicht auf einmal');
      await _tap(t, 'stachelImportBoard-m0'); // abwählen geht
      expect(_text(t, 'stachelImportCount'), '9 ausgewählt');
      expect(t.widget<CheckboxListTile>(find.byKey(const Key('stachelImportBoard-m10'))).enabled, isTrue);

      await t.enterText(find.byKey(const Key('stachelImportSearch')), 'workshop');
      await t.pump(const Duration(milliseconds: 350));
      await _settle(t);
      expect(f.requests.last.path, '/api/import/miro/boards?conn=c1&query=workshop');
      expect(find.byKey(const Key('stachelImportBoard-m0')), findsOneWidget);
      expect(find.byKey(const Key('stachelImportBoard-m1')), findsNothing);
      await t.enterText(find.byKey(const Key('stachelImportSearch')), 'gibtsnicht');
      await t.pump(const Duration(milliseconds: 350));
      await _settle(t);
      expect(_text(t, 'stachelImportNoBoards'), 'Kein Board in Miro passt zu „gibtsnicht“.');
    });

    testWidgets('Mit Miro verbinden: Browser auf, warten, Rückkehr in die App, Board-Auswahl, trennen', (t) async {
      final f = FakeImport(oauth: true);
      await _open(t, f);
      await _tap(t, 'stachelImportSourceMiro');
      expect(find.text('oder'), findsOneWidget);
      await _tap(t, 'stachelImportOauth');
      expect(f.calls('POST', '/api/import/miro/oauth/start').single.body, {'client': 'app'});
      expect(f.launched.single.toString(), 'https://miro.com/oauth/authorize?state=abc');
      expect(find.byKey(const Key('stachelImportOauthWaiting')), findsOneWidget);
      await _tap(t, 'stachelImportOauthReopen');
      expect(f.launched, hasLength(2));

      // noch nicht freigegeben: weiter warten
      await t.pump(const Duration(seconds: 2));
      await _settle(t);
      expect(find.byKey(const Key('stachelImportOauthWaiting')), findsOneWidget);

      // freigegeben, zurück in der App: sofort weiter (ohne auf die nächste Abfrage zu warten)
      f.connected = true;
      final before = f.calls('GET', '/api/import/sources').length;
      for (final s in const [
        AppLifecycleState.inactive,
        AppLifecycleState.hidden,
        AppLifecycleState.paused,
        AppLifecycleState.hidden,
        AppLifecycleState.inactive,
        AppLifecycleState.resumed,
      ]) {
        t.binding.handleAppLifecycleStateChanged(s);
      }
      await _settle(t, 4);
      expect(f.calls('GET', '/api/import/sources').length, before + 1);
      expect(find.text('Welche Boards?'), findsOneWidget);
      expect(find.text('Mit Miro verbunden'), findsOneWidget);
      expect(f.requests.last.path, '/api/import/miro/boards?conn=oauth');

      await _tap(t, 'stachelImportDisconnect');
      expect(f.calls('DELETE', '/api/import/miro/oauth'), hasLength(1));
      expect(f.connected, isFalse);
      expect(find.byKey(const Key('stachelImportOauth')), findsOneWidget);
      // keine Abfrage mehr im Hintergrund
      final n = f.requests.length;
      await t.pump(const Duration(seconds: 5));
      expect(f.requests.length, n);
    });

    testWidgets('Schon verbunden: direkt zur Board-Auswahl; Abfrage im Takt bis connected', (t) async {
      final f = FakeImport(oauth: true, token: false, connected: true);
      await _open(t, f);
      await _tap(t, 'stachelImportSourceMiro');
      expect(find.text('Welche Boards?'), findsOneWidget);
      expect(find.byKey(const Key('stachelImportDisconnect')), findsOneWidget);
      await _tap(t, 'stachelImportBack');
      expect(find.text('Woher?'), findsOneWidget);

      f.connected = false;
      await _tap(t, 'stachelImportBack');
      await t.pumpAndSettle();
      await t.tap(find.byKey(const Key('go')));
      await _settle(t);
      await _tap(t, 'stachelImportSourceMiro');
      expect(find.byKey(const Key('stachelImportToken')), findsNothing); // Instanz ohne Token-Weg
      expect(find.byKey(const Key('stachelImportBackText')), findsOneWidget);
      await _tap(t, 'stachelImportOauth');
      f.connected = true;
      await t.pump(const Duration(seconds: 2));
      await _settle(t);
      expect(find.text('Welche Boards?'), findsOneWidget);
    });

    testWidgets('Fehler: Token abgelehnt, Miro nicht erreichbar, OAuth aus', (t) async {
      final f = FakeImport(oauth: true);
      f.tokenError = ('miro_token_invalid', 400, 'Miro hat das Token abgelehnt (Server).');
      f.oauthError = ('oauth_disabled', 404, '„Mit Miro verbinden“ ist hier nicht eingerichtet (Server).');
      await _open(t, f);
      await _tap(t, 'stachelImportSourceMiro');
      await t.enterText(find.byKey(const Key('stachelImportToken')), 'falsch');
      await _tap(t, 'stachelImportTokenConnect');
      expect(_text(t, 'stachelImportConnectError'), 'Miro hat das Token abgelehnt (Server).');
      expect(find.byKey(const Key('stachelImportToken')), findsOneWidget);
      f.tokenError = ('miro_unavailable', 502, 'Miro antwortet gerade nicht (Server).');
      await _tap(t, 'stachelImportTokenConnect');
      expect(_text(t, 'stachelImportConnectError'), 'Miro antwortet gerade nicht (Server).');
      await _tap(t, 'stachelImportOauth');
      expect(_text(t, 'stachelImportConnectError'), '„Mit Miro verbinden“ ist hier nicht eingerichtet (Server).');
      expect(find.byKey(const Key('stachelImportOauth')), findsNothing);
      expect(f.launched, isEmpty);
    });

    testWidgets('Fehler: Verbindung abgelaufen → zurück zum Verbinden; Tageslimit und Board-Grenze', (t) async {
      final f = FakeImport();
      await _open(t, f);
      await _connectWithToken(t);
      await _tap(t, 'stachelImportBoard-m0');
      f.jobsError = ('import_limit', 429, 'Für heute sind genug Boards importiert (Server).');
      await _tap(t, 'stachelImportStart');
      expect(_text(t, 'stachelImportBoardsError'), 'Für heute sind genug Boards importiert (Server).');
      f.jobsError = ('board_limit', 403, 'Du hast zu viele Boards (Server).');
      await _tap(t, 'stachelImportStart');
      expect(_text(t, 'stachelImportBoardsError'), 'Du hast zu viele Boards (Server).');
      expect(find.text('Welche Boards?'), findsOneWidget);
      f.jobsError = ('miro_conn_expired', 401, 'Die Verbindung zu Miro ist abgelaufen (Server).');
      await _tap(t, 'stachelImportStart');
      expect(find.byKey(const Key('stachelImportToken')), findsOneWidget);
      expect(_text(t, 'stachelImportConnectError'), 'Die Verbindung zu Miro ist abgelaufen (Server).');

      // auch beim Laden der Liste
      f.jobsError = null;
      await t.enterText(find.byKey(const Key('stachelImportToken')), 'tok');
      await _tap(t, 'stachelImportTokenConnect');
      expect(find.text('Welche Boards?'), findsOneWidget);
      f.boardsError = ('miro_conn_expired', 401, 'Abgelaufen (Server).');
      await t.enterText(find.byKey(const Key('stachelImportSearch')), 'x');
      await t.pump(const Duration(milliseconds: 350));
      await _settle(t);
      expect(_text(t, 'stachelImportConnectError'), 'Abgelaufen (Server).');
    });

    testWidgets('Import auf der Instanz aus: Quelle gesperrt mit Hinweis', (t) async {
      final f = FakeImport(enabled: false);
      await _open(t, f);
      final tile = find.descendant(
        of: find.byKey(const Key('stachelImportSourceMiro')),
        matching: find.byType(ListTile),
      );
      expect(t.widget<ListTile>(tile).enabled, isFalse);
      expect(_text(t, 'stachelImportUnavailable'), stachelImportErrorText('import_disabled'));
    });

    testWidgets('Stachel-Anmeldung weg: Import schließt sich, die App meldet neu an', (t) async {
      final f = FakeImport();
      f.sourcesError = ('invalid_token', 401, 'Deine Anmeldung ist abgelaufen.');
      final host = await _open(t, f);
      await t.pumpAndSettle();
      expect(host.lost, isNotEmpty);
      expect(host.lost.first.needsLogin, isTrue);
      expect(find.byKey(const Key('stachelImportScreen')), findsNothing);
    });

    testWidgets('Letzte Importe: läuft einer, gleich sein Fortschritt; fertig → Bericht und Board öffnen', (t) async {
      final f = FakeImport();
      f.recent.addAll([
        {
          'id': 'r1',
          'sourceName': 'Retro Oktober',
          'status': 'done',
          'phase': 'done',
          'boardId': 'b-r1',
          'report': _report,
          'createdAt': '2026-11-01T10:00:00Z',
          'finishedAt': '2026-11-01T10:01:00Z',
        },
        {'id': 'r2', 'sourceName': 'Kaputt', 'status': 'failed', 'phase': 'read', 'error': 'Miro-Board nicht lesbar.'},
      ]);
      f.jobs['r3'] = {'id': 'r3', 'sourceName': 'Läuft', 'status': 'running', 'phase': 'read', 'done': 1, 'total': 4};
      f.recent.insert(0, Map.of(f.jobs['r3']!));
      final host = await _open(t, f);
      // wie der Web-Knopf „läuft“: gleich der Fortschritt
      expect(find.text('Board wird übernommen'), findsOneWidget);
      expect(_text(t, 'stachelImportPhase-r3'), 'Objekte lesen · 1 von 4');
      await _tap(t, 'stachelImportBack');
      expect(find.text('Letzte Importe'), findsOneWidget);
      expect(_text(t, 'stachelImportChip-r3'), startsWith('Objekte lesen'));
      expect(_text(t, 'stachelImportChip-r2'), 'Fehlgeschlagen');
      expect(_text(t, 'stachelImportChip-r1'), 'Fertig');
      await _tap(t, 'stachelImportRecent-r2');
      expect(find.text('Import fehlgeschlagen'), findsOneWidget);
      expect(_text(t, 'stachelImportJobError-r2'), 'Miro-Board nicht lesbar.');
      expect(find.byKey(const Key('stachelImportOpen-r2')), findsNothing);
      await _tap(t, 'stachelImportBack');
      await _tap(t, 'stachelImportRecent-r1');
      expect(find.text('Import fertig'), findsOneWidget);
      expect(find.byKey(const Key('stachelImportReportView')), findsOneWidget);
      await _tap(t, 'stachelImportOpen-r1');
      expect(host.opened, (id: 'b-r1', title: 'Retro Oktober'));
    });

    testWidgets('Großes Fenster: Dialog statt Vollbild, Schließen', (t) async {
      final f = FakeImport();
      await _open(t, f, size: const Size(1280, 800));
      expect(find.byType(Dialog), findsOneWidget);
      expect(find.byType(AppBar), findsNothing);
      expect(t.getSize(find.byKey(const Key('stachelImportScreen'))).width, lessThanOrEqualTo(640));
      expect(find.byKey(const Key('stachelImportBack')), findsNothing);
      await _tap(t, 'stachelImportSourceMiro');
      expect(find.byKey(const Key('stachelImportBack')), findsOneWidget);
      await _tap(t, 'stachelImportClose');
      expect(find.byType(Dialog), findsNothing);
    });

    testWidgets('Dunkelmodus: Flächen in Sk.surface', (t) async {
      Sk.darkStyle = const StachelStyle(ink: Color(0xFFF1F1EC), paper: Color(0xFF1B1B1E));
      Sk.brightness = Brightness.dark;
      addTearDown(() {
        Sk.darkStyle = null;
        Sk.brightness = Brightness.light;
      });
      final f = FakeImport();
      await _open(t, f, size: const Size(1280, 800));
      expect(t.widget<Dialog>(find.byType(Dialog)).backgroundColor, const Color(0xFF1B1B1E));
      final tile = t.widget<Material>(
        find.descendant(of: find.byKey(const Key('stachelImportSourceMiro')), matching: find.byType(Material)).first,
      );
      expect(tile.color, const Color(0xFF1B1B1E));
    });
  });
}
