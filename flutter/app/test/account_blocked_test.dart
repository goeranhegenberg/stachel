// Konto-Seite → „Blockierte Personen“ (CR-3): die Liste aus `GET /api/blocks` mit der App-Sitzung, „Blockierung
// aufheben“ schickt `DELETE /api/blocks/:key`.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel/app_session.dart';
import 'package:stachel/links.dart';
import 'package:stachel/root.dart';
import 'package:stachel_client/stachel_client.dart';

import 'fake_server.dart';

void main() {
  testWidgets('Konto: „Blockierte Personen“ zeigt die Liste, aufheben → DELETE', (tester) async {
    SharedPreferences.setMockInitialValues({
      'stachel_app_account_v1': jsonEncode({
        'base': accountsBase,
        'mode': 'local',
        'user': 'u:mara',
        'name': 'Mara',
        'email': 'mara@example.org',
      }),
      'stachel_app_session_v1': jsonEncode({
        'for': StachelSession.ownerOf('$accountsBase|u:mara'),
        'token': 'sts_gespeichert',
      }),
    });
    final server = FakeServer();
    var blocked = <Map<String, Object?>>[
      {'key': 'u:jonas', 'name': 'Jonas', 'at': '2026-11-02T10:00:00Z'},
    ];
    final blockCalls = <String>[];
    final client = MockClient((req) async {
      if (req.url.path.startsWith('/api/blocks')) {
        blockCalls.add('${req.method} ${req.url.path} ${req.headers['Authorization']}');
        if (req.method == 'DELETE') blocked = [];
        return http.Response(
          jsonEncode({'ok': true, 'blocked': blocked}),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }
      final copy = http.Request(req.method, req.url)..headers.addAll(req.headers);
      if (req.body.isNotEmpty) copy.body = req.body;
      return http.Response.fromStream(await server.client.send(copy));
    });
    tester.view.physicalSize = const Size(900, 2200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      StachelApp(
        session: AppSession(client: client),
        links: StachelAppLinks(accountsBase),
        accountsBase: accountsBase,
        checkInbox: false,
        launcher: (_) async => true,
        boardScreen: (id, title, object) => const SizedBox(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('stachelAccount')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('accountBlocked')));
    await tester.tap(find.byKey(const Key('accountBlocked')));
    await tester.pumpAndSettle();
    expect(find.text('BLOCKIERTE PERSONEN'), findsOneWidget);
    expect(find.byKey(const Key('stachelBlocked-u:jonas')), findsOneWidget);
    expect(blockCalls, ['GET /api/blocks Bearer sts_gespeichert']);
    await tester.tap(find.byKey(const Key('stachelUnblock-u:jonas')));
    await tester.pumpAndSettle();
    expect(blockCalls.last, startsWith('DELETE /api/blocks/u%3Ajonas'));
    expect(find.byKey(const Key('stachelBlockedEmpty')), findsOneWidget);
  });
}
