// „Teilen“ like the web's ShareDialog (instances with own accounts, docs/features/accounts.md): people with roles,
// open invitations, invite by e-mail, share link, transfer – the requests of `server/src/access-routes.ts` and what the
// sheet shows; who may not manage only sees, copies the link and can leave.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel_client/stachel_client.dart';

import 'support/fake_stachel.dart';

class _Sharer extends StachelSharer {
  final texts = <String>[];
  @override
  Future<void> shareText(String text, {String? subject}) async => texts.add(text);
}

/// Opens the sheet for `b1` from a button; returns what the callbacks saw.
Future<({List<String> events, _Sharer sharer})> _open(WidgetTester tester, FakeStachelServer server) async {
  SharedPreferences.setMockInitialValues({});
  await StachelSession.clear();
  tester.view.physicalSize = const Size(700, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final events = <String>[];
  final sharer = _Sharer();
  final api = HttpStachelBoardsApi(TestStachelClient(server.client));
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () => showStachelShareSheet(
              context,
              api: api,
              boardId: 'b1',
              title: 'Festival',
              me: 'u:flo',
              sharer: sharer,
              onChanged: () => events.add('changed'),
              onLeft: () => events.add('left'),
            ),
            child: const Text('TEILEN'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('TEILEN'));
  await tester.pumpAndSettle();
  return (events: events, sharer: sharer);
}

/// Picks [value] in the role menu [key].
Future<void> _choose(WidgetTester tester, String key, String value) async {
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(Key('stachelShareChoice-$value')).last);
  await tester.pumpAndSettle();
}

String _roleText(WidgetTester tester, String key) => tester
    .widgetList<Text>(find.descendant(of: find.byKey(Key(key)), matching: find.byType(Text), matchRoot: true))
    .map((t) => t.data)
    .join();

void main() {
  testWidgets('Besitzer:in: Personen mit Rollen, Einladung, Link; Rolle ändern, entfernen, einladen, zurückziehen', (
    tester,
  ) async {
    final server = FakeStachelServer();
    final seen = await _open(tester, server);
    expect(server.calls('GET', '/api/boards/b1/share'), hasLength(1));
    expect(find.text('„Festival“ teilen'), findsOneWidget);
    // people like the web: owner as text, others with a role menu; e-mail and „über den Link“
    expect(find.text('Flo (du)'), findsOneWidget);
    expect(_roleText(tester, 'stachelShareRole-u:flo'), 'Besitzer:in');
    expect(_roleText(tester, 'stachelShareRole-u:mara'), 'Kann bearbeiten');
    expect(find.text('jo@test.de · über den Link'), findsOneWidget);
    expect(find.text('neu@test.de'), findsOneWidget);
    expect(find.text('eingeladen, noch nicht registriert'), findsOneWidget);
    expect(_roleText(tester, 'stachelShareLink'), 'Jeder mit dem Link (angemeldet) kann ansehen');

    // Mara: „Kann kommentieren“ → PATCH members/:key {role}
    await _choose(tester, 'stachelShareRole-u:mara', 'comment');
    final patch = server.calls('PATCH', '/api/boards/b1/members/u%3Amara').single;
    expect(patch.body, {'role': 'comment'});
    expect(patch.write, isTrue, reason: 'X-Stachel: 1 beim Schreiben');
    expect(_roleText(tester, 'stachelShareRole-u:mara'), 'Kann kommentieren');

    // Jo (über den Link): remove → DELETE, notice like the web; „Zur Besitzer:in machen“ not offered for link people
    await tester.tap(find.byKey(const Key('stachelShareRole-u:jo')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelShareChoice-owner')), findsNothing);
    expect(find.text('Zugriff entfernen'), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelShareChoice-remove')).last);
    await tester.pumpAndSettle();
    expect(server.calls('DELETE', '/api/boards/b1/members/u%3Ajo'), hasLength(1));
    expect(find.text('Jo hat keinen Zugriff mehr.'), findsOneWidget);
    expect(find.byKey(const Key('stachelSharePerson-u:jo')), findsNothing);

    // invite two (one with an account, one without) as „Kann ansehen“
    await _choose(tester, 'stachelShareInviteRole', 'view');
    await tester.enterText(find.byKey(const Key('stachelShareEmails')), 'lena@test.de, gast@test.de');
    await tester.tap(find.byKey(const Key('stachelShareInvite')));
    await tester.pumpAndSettle();
    final post = server.calls('POST', '/api/boards/b1/share').single;
    expect(post.body, {
      'emails': ['lena@test.de', 'gast@test.de'],
      'role': 'view',
    });
    expect(post.write, isTrue);
    expect(find.text('2 Personen sind eingeladen.'), findsOneWidget);
    expect(find.text('Lena'), findsOneWidget);
    expect(find.text('gast@test.de'), findsOneWidget);
    expect(tester.widget<TextField>(find.byKey(const Key('stachelShareEmails'))).controller!.text, isEmpty);

    // change an invitation's role (POST again), withdraw one (DELETE invites/:email)
    await _choose(tester, 'stachelShareInviteMenu-neu@test.de', 'edit');
    expect(server.calls('POST', '/api/boards/b1/share').last.body, {
      'emails': ['neu@test.de'],
      'role': 'edit',
    });
    await _choose(tester, 'stachelShareInviteMenu-gast@test.de', 'remove');
    expect(server.calls('DELETE', '/api/boards/b1/invites/gast%40test.de'), hasLength(1));
    expect(find.text('gast@test.de'), findsNothing);

    // closing after changes: the list reloads
    await tester.tap(find.byKey(const Key('stachelShareDone')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelShareSheet')), findsNothing);
    expect(seen.events, ['changed']);
  });

  testWidgets('Freigabelink an/aus mit Rolle, kopieren und teilen', (tester) async {
    final copied = <String>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') copied.add((call.arguments as Map)['text'] as String);
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
    final server = FakeStachelServer();
    final seen = await _open(tester, server);
    await _choose(tester, 'stachelShareLink', 'off');
    expect(server.calls('PUT', '/api/boards/b1/link').single.body, {'role': null});
    expect(_roleText(tester, 'stachelShareLink'), 'Aus – nur eingeladene Personen');
    expect(find.text('Der Link funktioniert nur für Personen, die oben eingetragen sind.'), findsOneWidget);
    await _choose(tester, 'stachelShareLink', 'comment');
    expect(server.calls('PUT', '/api/boards/b1/link').last.body, {'role': 'comment'});
    expect(_roleText(tester, 'stachelShareLink'), 'Jeder mit dem Link (angemeldet) kann kommentieren');
    await tester.tap(find.byKey(const Key('stachelShareCopy')));
    await tester.pumpAndSettle();
    expect(copied, ['https://stachel.test/b/b1']);
    expect(find.text('Link kopiert.'), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelShareSend')));
    await tester.pumpAndSettle();
    expect(seen.sharer.texts, ['https://stachel.test/b/b1']);
  });

  testWidgets('Besitz übertragen: Rückfrage, POST owner, danach bin ich „Kann bearbeiten“', (tester) async {
    final server = FakeStachelServer();
    await _open(tester, server);
    await _choose(tester, 'stachelShareRole-u:mara', 'owner');
    expect(find.text('Board an Mara übertragen?'), findsOneWidget);
    expect(server.calls('POST', '/api/boards/b1/owner'), isEmpty, reason: 'erst nach der Rückfrage');
    await tester.tap(find.byKey(const Key('stachelShareTransferConfirm')));
    await tester.pumpAndSettle();
    expect(server.calls('POST', '/api/boards/b1/owner').single.body, {'key': 'u:mara'});
    expect(find.text('Mara ist jetzt Besitzer:in.'), findsOneWidget);
    expect(_roleText(tester, 'stachelShareRole-u:mara'), 'Besitzer:in');
    expect(_roleText(tester, 'stachelShareRole-u:flo'), 'Kann bearbeiten');
    // no longer owner: no transfer offered
    await tester.tap(find.byKey(const Key('stachelShareRole-u:jo')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelShareChoice-owner')), findsNothing);
  });

  testWidgets('Fehler deutsch: leere Eingabe ohne Anfrage, Server-Meldung bei falscher Adresse', (tester) async {
    final server = FakeStachelServer();
    await _open(tester, server);
    await tester.tap(find.byKey(const Key('stachelShareInvite')));
    await tester.pumpAndSettle();
    expect(find.text('Bitte mindestens eine E-Mail-Adresse eingeben.'), findsOneWidget);
    expect(server.calls('POST', '/api/boards/b1/share'), isEmpty);
    await tester.enterText(find.byKey(const Key('stachelShareEmails')), 'kaputt');
    await tester.tap(find.byKey(const Key('stachelShareInvite')));
    await tester.pumpAndSettle();
    expect(find.text('Diese Adresse stimmt nicht: kaputt'), findsOneWidget);
    expect(tester.widget<TextField>(find.byKey(const Key('stachelShareEmails'))).controller!.text, 'kaputt');
  });

  testWidgets('ohne Verwalten (Kann ansehen): nur sehen, Link kopieren, Board verlassen', (tester) async {
    final server = FakeStachelServer(myRole: 'view')
      ..people = [
        {'key': 'u:mara', 'name': 'Mara', 'email': 'mara@test.de', 'role': 'owner', 'via': 'owner'},
        {'key': 'u:flo', 'name': 'Flo', 'email': 'flo@test.de', 'role': 'view', 'via': 'member'},
        {'key': 'u:jo', 'name': 'Jo', 'email': 'jo@test.de', 'role': 'edit', 'via': 'member'},
      ];
    final seen = await _open(tester, server);
    expect(find.byKey(const Key('stachelShareEmails')), findsNothing);
    expect(find.byKey(const Key('stachelShareLink')), findsNothing);
    expect(find.text('Jeder mit dem Link (angemeldet) kann ansehen'), findsOneWidget);
    expect(find.text('mara@test.de'), findsNothing, reason: 'E-Mail-Adressen nur für Verwaltende');
    expect(find.text('neu@test.de'), findsNothing);
    // others: role as text; me: only my role and „Board verlassen“
    expect(tester.widget(find.byKey(const Key('stachelShareRole-u:jo'))), isA<Text>());
    await tester.tap(find.byKey(const Key('stachelShareRole-u:flo')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('stachelShareChoice-edit')), findsNothing);
    expect(find.byKey(const Key('stachelShareChoice-view')), findsOneWidget);
    expect(find.text('Board verlassen'), findsOneWidget);
    await tester.tap(find.byKey(const Key('stachelShareChoice-remove')));
    await tester.pumpAndSettle();
    expect(server.calls('DELETE', '/api/boards/b1/members/u%3Aflo'), hasLength(1));
    expect(find.byKey(const Key('stachelShareSheet')), findsNothing);
    expect(seen.events, ['left']);
  });
}
