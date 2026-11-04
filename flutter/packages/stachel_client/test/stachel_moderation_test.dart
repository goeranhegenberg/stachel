// Melden und Blockieren (CR-2/CR-3, Google Play UGC, DSA Art. 16): Melden-Sheet (Grund, Pflichttext, Senden →
// Bestätigung, Fehlertext des Servers), Blockieren mit Rückfrage, Liste „Blockierte Personen“, „···“ an Personen im
// Teilen-Sheet, „Melden …“ an fremden Kommentaren und die Einträge im Objekt- und Board-Menü – gegen einen Fake der
// Routen aus server/src/reports.ts (`POST /api/reports`, `GET|PUT|DELETE /api/blocks`).

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_client/stachel_client.dart';

import 'support/fake_stachel.dart';

/// Fake der Moderations-Routen (die Teilen-Routen kommen aus [FakeStachelServer]).
class _ModServer {
  final share = FakeStachelServer();
  final reports = <Map<String, Object?>>[];
  final writes = <String>[];
  var blocked = <Map<String, Object?>>[
    {'key': 'u:jo', 'name': 'Jo', 'at': '2026-11-02T10:00:00.000Z'},
  ];
  int? reportStatus;

  late final http.Client client = MockClient((req) async {
    final path = req.url.path;
    if (req.headers['Authorization'] != 'Bearer sts_test') return json({'ok': false, 'error': 'invalid_token'}, 401);
    if (req.method != 'GET') writes.add('${req.method} $path ${req.headers['X-Stachel']}');
    if (path == '/api/reports' && req.method == 'POST') {
      if (reportStatus != null) {
        return json({'ok': false, 'error': 'rate_limited', 'message': 'Zu viele Meldungen. Bitte warte etwas.'}, 429);
      }
      reports.add((jsonDecode(req.body) as Map).cast<String, Object?>());
      return json({
        'ok': true,
        'report': {'id': 'R-ABC123', 'createdAt': '2026-11-02T10:00:00.000Z'},
        'mailed': true,
      }, 201);
    }
    if (path.startsWith('/api/blocks')) {
      final key = path.length > '/api/blocks/'.length
          ? Uri.decodeComponent(path.substring('/api/blocks/'.length))
          : null;
      if (req.method == 'PUT' && key != null) {
        blocked = [
          ...blocked.where((b) => b['key'] != key),
          {'key': key, 'name': key == 'u:mara' ? 'Mara' : key, 'at': '2026-11-02T11:00:00.000Z'},
        ];
      } else if (req.method == 'DELETE' && key != null) {
        blocked = [...blocked.where((b) => b['key'] != key)];
      }
      return json({'ok': true, 'blocked': blocked});
    }
    final copy = http.Request(req.method, req.url)..headers.addAll(req.headers);
    if (req.body.isNotEmpty) copy.body = req.body;
    return http.Response.fromStream(await share.client.send(copy));
  });
}

Future<StachelModerationApi> _api(_ModServer s) async {
  SharedPreferences.setMockInitialValues({});
  await StachelSession.clear();
  return StachelModerationApi(HttpStachelBoardsApi(TestStachelClient(s.client)));
}

Future<void> _pumpButton(WidgetTester tester, String label, void Function(BuildContext context) onTap) async {
  tester.view.physicalSize = const Size(700, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(onPressed: () => onTap(context), child: Text(label)),
        ),
      ),
    ),
  );
  await tester.tap(find.text(label));
  await tester.pumpAndSettle();
}

void main() {
  group('Melden-Sheet', () {
    testWidgets('Grund fehlt, Pflichttext zu kurz, dann Senden → „Danke … (Nr. R-ABC123)“', (tester) async {
      final s = _ModServer();
      final api = await _api(s);
      await _pumpButton(
        tester,
        'MELDEN',
        (context) => showStachelReportSheet(
          context,
          api: api,
          target: const StachelReportTarget(boardId: 'b1', objectId: 'o1', label: 'Objekt'),
        ),
      );
      expect(find.text('MELDEN: OBJEKT'), findsOneWidget);
      expect(find.textContaining('Betreiber:innen von stachel.test'), findsOneWidget);
      for (final (value, _) in stachelReportReasons) {
        expect(find.byKey(Key('stachelReportReason-$value')), findsOneWidget);
      }
      await tester.tap(find.byKey(const Key('stachelReportSend')));
      await tester.pumpAndSettle();
      expect(find.text('Bitte wähle einen Grund.'), findsOneWidget);
      expect(s.reports, isEmpty);

      await tester.tap(find.byKey(const Key('stachelReportReason-illegal')));
      await tester.pumpAndSettle();
      expect(find.text('Was ist nicht in Ordnung? (Pflicht)'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('stachelReportText')), 'kurz');
      await tester.tap(find.byKey(const Key('stachelReportSend')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stachelReportError')), findsOneWidget);
      expect(s.reports, isEmpty);

      await tester.enterText(find.byKey(const Key('stachelReportText')), '  Volksverhetzung auf der Notiz  ');
      await tester.tap(find.byKey(const Key('stachelReportSend')));
      await tester.pumpAndSettle();
      expect(s.reports, [
        {'boardId': 'b1', 'objectId': 'o1', 'reason': 'illegal', 'text': 'Volksverhetzung auf der Notiz'},
      ]);
      expect(s.writes.single, 'POST /api/reports 1', reason: 'mit X-Stachel: 1');
      expect(find.byKey(const Key('stachelReportSheet')), findsNothing);
      expect(find.text('Danke, deine Meldung ist eingegangen (Nr. R-ABC123).'), findsOneWidget);
    });

    testWidgets('Spam ohne Text geht; Fehler des Servers steht im Sheet', (tester) async {
      final s = _ModServer()..reportStatus = 429;
      final api = await _api(s);
      await _pumpButton(
        tester,
        'MELDEN',
        (context) => showStachelReportSheet(
          context,
          api: api,
          target: const StachelReportTarget(boardId: 'b1', userKey: 'u:mara', label: 'Mara'),
        ),
      );
      expect(find.text('MELDEN: MARA'), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelReportReason-spam')));
      await tester.pumpAndSettle();
      expect(find.text('Was ist nicht in Ordnung? (freiwillig)'), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelReportSend')));
      await tester.pumpAndSettle();
      expect(find.text('Zu viele Meldungen. Bitte warte etwas.'), findsOneWidget);
      expect(find.byKey(const Key('stachelReportSheet')), findsOneWidget, reason: 'bleibt offen');
      s.reportStatus = null;
      await tester.tap(find.byKey(const Key('stachelReportSend')));
      await tester.pumpAndSettle();
      expect(s.reports.single, {'boardId': 'b1', 'userKey': 'u:mara', 'reason': 'spam'});
    });
  });

  group('Blockieren', () {
    testWidgets('Rückfrage „Mara blockieren?“ → PUT, Abbrechen schickt nichts', (tester) async {
      final s = _ModServer();
      final api = await _api(s);
      await _pumpButton(
        tester,
        'BLOCK',
        (context) => confirmStachelBlock(context, api: api, key: 'u:mara', name: 'Mara'),
      );
      expect(find.text('Mara blockieren?'), findsOneWidget);
      expect(find.textContaining('Mara erfährt davon nichts.'), findsOneWidget);
      await tester.tap(find.text('ABBRECHEN'));
      await tester.pumpAndSettle();
      expect(s.writes, isEmpty);

      await tester.tap(find.text('BLOCK'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('stachelBlockConfirm')));
      await tester.pumpAndSettle();
      expect(s.writes, ['PUT /api/blocks/u%3Amara 1']);
      expect(api.isBlocked('u:mara'), isTrue);
      expect(find.text('Mara ist blockiert.'), findsOneWidget);
    });

    testWidgets('Liste „Blockierte Personen“: aufheben → DELETE, dann leer', (tester) async {
      final s = _ModServer();
      final api = await _api(s);
      await _pumpButton(tester, 'LISTE', (context) => showStachelBlockedPeople(context, api));
      expect(find.text('BLOCKIERTE PERSONEN'), findsOneWidget);
      expect(find.byKey(const Key('stachelBlocked-u:jo')), findsOneWidget);
      await tester.tap(find.byKey(const Key('stachelUnblock-u:jo')));
      await tester.pumpAndSettle();
      expect(s.writes, ['DELETE /api/blocks/u%3Ajo 1']);
      expect(find.byKey(const Key('stachelBlockedEmpty')), findsOneWidget);
      expect(find.text('Blockierung von Jo aufgehoben.'), findsOneWidget);
    });

    test('Personen-Zeilen: melden + blockieren bzw. aufheben, je nach geladener Liste', () async {
      final s = _ModServer();
      final api = await _api(s);
      List<String> rows(String key) => [
        for (final a in stachelPersonActions(api, boardId: 'b1', key: key, name: key)) a.label,
      ];
      expect(rows('u:jo'), ['Person melden …', 'Person blockieren'], reason: 'Liste noch nicht da');
      await api.blocked();
      expect(rows('u:jo'), ['Person melden …', 'Blockierung aufheben']);
      expect(rows('u:mara'), ['Person melden …', 'Person blockieren']);
    });
  });

  testWidgets('Teilen-Sheet: „···“ an fremden Personen (nicht an mir) → blockieren', (tester) async {
    final s = _ModServer();
    final api = await _api(s);
    await _pumpButton(
      tester,
      'TEILEN',
      (context) => showStachelShareSheet(context, api: api.boards, boardId: 'b1', me: 'u:flo', moderation: api),
    );
    expect(find.byKey(const Key('stachelSharePerson-u:mara')), findsOneWidget);
    expect(find.byKey(const Key('stachelSharePersonMore-u:flo')), findsNothing);
    expect(find.byKey(const Key('stachelSharePersonMore-u:jo')), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelSharePersonMore-u:mara')));
    await tester.pumpAndSettle();
    expect(find.text('Person melden …'), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelPersonBlock')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelBlockConfirm')));
    await tester.pumpAndSettle();
    expect(s.writes, contains('PUT /api/blocks/u%3Amara 1'));
  });

  testWidgets('Kommentar-Thread: „Melden …“ an fremden Nachrichten, an eigenen nicht', (tester) async {
    tester.view.physicalSize = const Size(700, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final source = FixtureBoardSource(
      BoardSnapshot.fromJson({
        'objects': const [],
        'ext': {
          'collab.comments': {
            't1': {
              'x': 10,
              'y': 10,
              'createdBy': 'a:jonas',
              'createdAt': '2026-11-02T10:00:00.000Z',
              'messages': [
                {'id': 'm1', 'by': 'a:jonas', 'name': 'Jonas', 'text': 'Hallo', 'at': '2026-11-02T10:00:00.000Z'},
                {'id': 'm2', 'by': 'a:mara', 'name': 'Mara', 'text': 'Selbst', 'at': '2026-11-02T10:01:00.000Z'},
              ],
            },
          },
        },
      }),
      features: const ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'comments'],
    );
    final controller = BoardController(source, presenceInterval: Duration.zero);
    final editor = BoardEditor(controller: controller, scene: BoardScene(controller.state), camera: CameraController());
    addTearDown(() {
      editor.dispose();
      controller.dispose();
    });
    await controller.start();
    controller.user = const NativeUser(key: 'a:mara', name: 'Mara');
    final reported = <String>[];
    await _pumpButton(
      tester,
      'THREAD',
      (context) => showStachelThread(
        context,
        editor: editor,
        threadId: 't1',
        people: const [],
        onReport: (t, m) => reported.add('${t.id}/${m.id}'),
      ),
    );
    expect(find.byKey(const Key('stachelMsgMenu-m1')), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelMsgMenu-m2')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelMsgReport')), findsNothing, reason: 'eigene Nachricht: Bearbeiten/Löschen');
    await tester.tapAt(const Offset(5, 5));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelMsgMenu-m1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelMsgReport')));
    await tester.pumpAndSettle();
    expect(reported, ['t1/m1']);
  });

  test('Objekt-Menü „Melden …“ und Board-Menü „Board melden …“ stehen im Register beider Apps', () {
    final r = registerStachelAppFeatures(standardBoardRegistry());
    final report = r.menuItems['moderation.report']!;
    final board = r.menuItems['moderation.reportBoard']!;
    expect(report.on, MenuTarget.object);
    expect(board.on, MenuTarget.board);
    expect(stachelBoardRegistry.menuItems.contains('moderation.report'), isTrue);
    // am Ende der Menüs, nach den Kern-Einträgen
    expect(r.menuItems.list().where((m) => m.on == MenuTarget.board).last.id, 'moderation.reportBoard');
  });
}
