import 'dart:convert';
import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel/app_session.dart';
import 'package:stachel/links.dart';
import 'package:stachel/main.dart' show registerAppLicenses;
import 'package:stachel/root.dart';
import 'package:stachel/screens/account_screen.dart';
import 'package:stachel/screens/login_screen.dart';
import 'package:stachel/screens/widgets.dart';
import 'package:stachel_client/stachel_client.dart';

import 'fake_server.dart';

const _token = 'gueltiger-bestaetigungs-token';

class _App {
  _App(this.server) : session = AppSession(client: server.client), links = StachelAppLinks(accountsBase);
  final FakeServer server;
  final AppSession session;
  final StachelAppLinks links;
  final launched = <Uri>[];
  final opened = <(String, String?, String?)>[];
}

Future<_App> _pump(
  WidgetTester tester, {
  FakeServer? server,
  Map<String, Object> prefs = const {},
  List<String> orgInstances = const [],
}) async {
  SharedPreferences.setMockInitialValues(prefs);
  final a = _App(server ?? FakeServer());
  tester.view.physicalSize = const Size(900, 2200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    StachelApp(
      session: a.session,
      links: a.links,
      accountsBase: accountsBase,
      orgInstances: orgInstances,
      checkInbox: false,
      launcher: (u) async {
        a.launched.add(u);
        return true;
      },
      boardScreen: (id, title, object) {
        a.opened.add((id, title, object));
        return Scaffold(
          appBar: AppBar(title: Text('Board $id')),
          body: const SizedBox(key: Key('fakeBoard')),
        );
      },
    ),
  );
  await tester.pumpAndSettle();
  return a;
}

Future<void> _login(WidgetTester tester, String email, String password) async {
  await tester.enterText(find.byKey(const Key('loginEmail')), email);
  await tester.enterText(find.byKey(const Key('loginPassword')), password);
  await tester.tap(find.byKey(const Key('loginSubmit')));
  await tester.pumpAndSettle();
}

/// „Bei einer Organisation anmelden“ → address of [orgBase] → Benutzername + Passwort of the organisation.
Future<void> _orgLogin(WidgetTester tester, {String password = 'geheim-org'}) async {
  await tester.tap(find.byKey(const Key('loginOrg')));
  await tester.pumpAndSettle();
  await tester.enterText(find.byKey(const Key('orgAddress')), 'org-stachel.test');
  await tester.tap(find.byKey(const Key('orgNext')));
  await tester.pumpAndSettle();
  await tester.enterText(find.byKey(const Key('orgUser')), 'flo');
  await tester.enterText(find.byKey(const Key('orgPassword')), password);
  await tester.tap(find.byKey(const Key('orgSubmit')));
  await tester.pumpAndSettle();
}

/// Stored login of Mara (as after an earlier start).
Map<String, Object> get _loggedIn => {
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
};

/// Taps „Open-Source-Lizenzen“: Flutter's license page with the app's name, version and legalese (no pumpAndSettle –
/// the page's progress indicator spins while it loads the texts).
Future<void> _openLicenses(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('legalLicenses')));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
  final page = tester.widget<LicensePage>(find.byType(LicensePage));
  expect(page.applicationName, 'Stachel');
  expect(page.applicationLegalese, '© 2026 Göran Hegenberg (INTSODE) · Apache-2.0');
}

/// Records the shared files instead of the system share sheet.
class _Sharer extends StachelSharer {
  _Sharer();
  final files = <(String, String, List<int>)>[];
  @override
  Future<void> shareFile(Uint8List bytes, String fileName, String mimeType) async =>
      files.add((fileName, mimeType, bytes.toList()));
}

void main() {
  setUp(() async {
    StachelCache.rootOverride = Directory.systemTemp.createTempSync('stachel_app_test');
    SharedPreferences.setMockInitialValues({});
    await StachelSession.clear();
  });

  group('Anmelden (eigenes Konto)', () {
    testWidgets('ohne Anmeldung: Anmeldeseite mit Konto, Organisation und Rechtlichem', (tester) async {
      final a = await _pump(tester);
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.text('ANMELDEN'), findsOneWidget);
      expect(find.text('KONTO ANLEGEN'), findsOneWidget);
      expect(find.text('BEI EINER ORGANISATION ANMELDEN'), findsOneWidget);
      await tester.tap(find.text('Datenschutz'));
      await tester.pumpAndSettle();
      expect(a.launched.last.toString(), 'https://example.org/datenschutz');
    });

    testWidgets('falsches Passwort → Server-Meldung; richtig → Board-Liste mit Konto-Knopf', (tester) async {
      final a = await _pump(tester);
      await _login(tester, 'mara@example.org', 'falsch');
      expect(find.text('E-Mail-Adresse oder Passwort ist falsch.'), findsOneWidget);
      await _login(tester, 'mara@example.org', 'richtig-geheim');
      expect(find.byType(StachelHomeScreen), findsOneWidget);
      expect(find.text('Sommerfest 2027'), findsOneWidget);
      expect(find.byKey(const Key('stachelAccount')), findsOneWidget);
      final login = a.server.calls('POST', '/api/auth/app-session').last;
      expect(a.server.body(login), {'email': 'mara@example.org', 'password': 'richtig-geheim'});
      final boards = a.server.calls('GET', '/api/boards').last;
      expect(boards.headers['Authorization'], 'Bearer sts_local_1');
      expect(a.session.account!.local, isTrue);
    });

    testWidgets('nicht bestätigt → Hinweis mit „Mail nochmal senden“', (tester) async {
      final a = await _pump(tester);
      await _login(tester, 'neu@example.org', 'richtig-geheim');
      expect(find.textContaining('Bitte bestätige zuerst'), findsOneWidget);
      await tester.tap(find.byKey(const Key('loginResend')));
      await tester.pumpAndSettle();
      expect(a.server.mails, ['resend:neu@example.org']);
      expect(find.byKey(const Key('loginOk')), findsOneWidget);
    });

    testWidgets('gespeicherte Anmeldung: direkt die Board-Liste', (tester) async {
      final a = await _pump(tester, prefs: _loggedIn);
      expect(find.byType(StachelHomeScreen), findsOneWidget);
      expect(a.server.calls('GET', '/api/boards').last.headers['Authorization'], 'Bearer sts_gespeichert');
      expect(a.server.calls('POST', '/api/auth/app-session'), isEmpty);
    });

    testWidgets('Sitzung abgelaufen (401) → zurück zur Anmeldung mit Hinweis', (tester) async {
      final server = FakeServer()..expire = 5;
      await _pump(tester, server: server, prefs: _loggedIn);
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.text('Deine Anmeldung ist abgelaufen – bitte melde dich neu an.'), findsOneWidget);
      // no silent renewal with a stored password: no new app session
      expect(server.calls('POST', '/api/auth/app-session'), isEmpty);
    });
  });

  group('Konto anlegen, bestätigen, Passwort', () {
    testWidgets('Registrieren: Nutzungsbedingungen + 18 Pflicht, Captcha nativ gelöst, dann „Fast geschafft“', (
      tester,
    ) async {
      final a = await _pump(tester);
      await tester.tap(find.byKey(const Key('loginRegister')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('registerName')), 'Neu Ling');
      await tester.enterText(find.byKey(const Key('registerEmail')), 'neu2@example.org');
      await tester.enterText(find.byKey(const Key('registerPassword')), 'ganz-langes-pw');
      await tester.tap(find.byKey(const Key('registerSubmit')));
      await tester.pumpAndSettle();
      expect(
        find.text('Bitte akzeptiere die Nutzungsbedingungen und bestätige, dass du mindestens 18 Jahre alt bist.'),
        findsOneWidget,
      );
      expect(a.server.registered, isEmpty);
      // legal CR-1: one checkbox (terms + 18), the privacy policy only as information with a link
      expect(find.text('Ich akzeptiere die Nutzungsbedingungen und bin mindestens 18 Jahre alt.'), findsOneWidget);
      expect(find.byType(Checkbox), findsOneWidget);
      expect(find.byKey(const Key('registerPrivacyInfo')), findsOneWidget);
      await tester.tap(find.byKey(const Key('registerTermsLink')));
      await tester.tap(find.byKey(const Key('registerPrivacyLink')));
      expect(a.launched.map((u) => u.toString()), [
        'https://example.org/nutzungsbedingungen',
        'https://example.org/datenschutz',
      ]);
      await tester.tap(find.byKey(const Key('registerTerms')));
      await tester.runAsync(() async {
        await tester.tap(find.byKey(const Key('registerSubmit')));
        for (var i = 0; i < 100 && a.server.registered.isEmpty; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 50));
          await tester.pump();
        }
      });
      await tester.pumpAndSettle();
      expect(a.server.registered, hasLength(1));
      expect(a.server.registered.single['terms'], isTrue);
      expect(a.server.registered.single.containsKey('privacy'), isFalse);
      expect(a.server.registered.single['name'], 'Neu Ling');
      expect(find.text('Fast geschafft'), findsOneWidget);
      await tester.tap(find.byKey(const Key('registerDone')));
      await tester.pumpAndSettle();
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.text('neu2@example.org'), findsOneWidget); // prefilled
    });

    testWidgets('Bestätigungs-Link öffnet die App: bestätigt, dann Anmeldung mit der Adresse', (tester) async {
      final a = await _pump(tester);
      a.links.handle(Uri.parse('$accountsBase/verify/$_token'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('verifyOk')), findsOneWidget);
      await tester.tap(find.byKey(const Key('verifyDone')));
      await tester.pumpAndSettle();
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.text('neu@example.org'), findsOneWidget);
      // an old link: the server's text
      a.links.handle(Uri.parse('$accountsBase/verify/${'x' * 43}'));
      await tester.pumpAndSettle();
      expect(find.text('Dieser Bestätigungslink ist abgelaufen.'), findsOneWidget);
    });

    testWidgets('Link aus der Mail einfügen (ohne App-Link)', (tester) async {
      await _pump(tester);
      await tester.tap(find.byKey(const Key('loginPasteLink')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pasteLinkField')), 'Link: $accountsBase/verify/$_token');
      await tester.tap(find.byKey(const Key('pasteLinkOk')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('verifyOk')), findsOneWidget);
    });

    testWidgets('Passwort vergessen → Mail; Reset-Link → neues Passwort (gleich, stark) → Anmeldung', (tester) async {
      final a = await _pump(tester);
      await tester.enterText(find.byKey(const Key('loginEmail')), 'mara@example.org');
      await tester.tap(find.byKey(const Key('loginForgot')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('forgotSubmit')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('forgotSent')), findsOneWidget);
      expect(a.server.mails, ['forgot:mara@example.org']);
      a.links.handle(Uri.parse('$accountsBase/reset/$_token'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('resetPassword')), 'neues-langes-pw');
      await tester.enterText(find.byKey(const Key('resetRepeat')), 'anderes-pw');
      await tester.tap(find.byKey(const Key('resetSubmit')));
      await tester.pumpAndSettle();
      expect(find.text('Die beiden Passwörter sind nicht gleich.'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('resetRepeat')), 'neues-langes-pw');
      await tester.tap(find.byKey(const Key('resetSubmit')));
      await tester.pumpAndSettle();
      expect(a.server.body(a.server.calls('POST', '/api/auth/reset').single), {
        'token': _token,
        'password': 'neues-langes-pw',
      });
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.byKey(const Key('loginOk')), findsOneWidget);
    });
  });

  group('Bei einer Organisation anmelden', () {
    testWidgets('Adresse eingeben → /api/instance → Benutzername + Passwort → Stachel der Organisation', (tester) async {
      final a = await _pump(tester);
      addTearDown(() => stachelOrgName = null);
      await tester.tap(find.byKey(const Key('loginOrg')));
      await tester.pumpAndSettle();
      expect(find.text('Bei einer Organisation anmelden'), findsWidgets);
      await tester.enterText(find.byKey(const Key('orgAddress')), ' https://Org-Stachel.test/app/?b=x ');
      await tester.tap(find.byKey(const Key('orgNext')));
      await tester.pumpAndSettle();
      expect(a.server.calls('GET', '/api/instance').last.url.toString(), '$orgBase/api/instance');
      expect(find.text('Mit Beispielverein anmelden'), findsOneWidget);
      expect(find.text('MIT DER BEISPIELVEREIN-APP BESTÄTIGEN'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('orgUser')), 'flo');
      await tester.enterText(find.byKey(const Key('orgPassword')), 'falsch');
      await tester.tap(find.byKey(const Key('orgSubmit')));
      await tester.pumpAndSettle();
      expect(find.text('Benutzername oder Passwort ist falsch.'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('orgPassword')), 'geheim-org');
      await tester.tap(find.byKey(const Key('orgSubmit')));
      await tester.pumpAndSettle();
      expect(find.byType(StachelHomeScreen), findsOneWidget);
      expect(a.server.body(a.server.calls('POST', '/api/auth/app-session').last), {
        'username': 'flo',
        'password': 'geheim-org',
      });
      final account = a.session.account!;
      expect((account.base, account.mode, account.local, account.org), (orgBase, 'org', false, 'Beispielverein'));
      expect(stachelOrgName, 'Beispielverein', reason: 'Fehlertexte nennen die Organisation');
      expect(a.server.calls('GET', '/api/boards').last.url.host, Uri.parse(orgBase).host);
      expect(await a.session.orgInstances(), [orgBase], reason: 'für die nächste Anmeldung gemerkt');
    });

    testWidgets('Mit der App der Organisation bestätigen: bekannte Instanz, Link /qr/<code>, warten → angemeldet', (
      tester,
    ) async {
      final a = await _pump(tester, orgInstances: [orgBase]);
      addTearDown(() => stachelOrgName = null);
      await tester.tap(find.byKey(const Key('loginOrg')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('orgInstance-org-stachel.test')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('orgWithApp')));
      await tester.pumpAndSettle();
      expect(a.launched.single.toString(), '$orgBase/qr/paarungscode-123');
      expect(find.byType(StachelHomeScreen), findsOneWidget);
      final waits = a.server.calls('GET', '/api/auth/qr/paarungscode-123/wait').toList();
      expect(waits, hasLength(2)); // pending, then approved
      expect(waits.first.headers['Cookie'], 'stachel_pair=geheim-paar');
      expect(a.session.account!.userKey, 'm:7');
    });

    testWidgets('ohne Passwort-Anmeldung und ohne Namen: nur „Mit der App deiner Organisation bestätigen“', (
      tester,
    ) async {
      final server = FakeServer()
        ..orgPasswordLogin = false
        ..orgName = null;
      await _pump(tester, server: server, orgInstances: [orgBase]);
      await tester.tap(find.byKey(const Key('loginOrg')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('orgInstance-org-stachel.test')));
      await tester.pumpAndSettle();
      expect(find.text('Bei deiner Organisation anmelden'), findsOneWidget);
      expect(find.text('MIT DER APP DEINER ORGANISATION BESTÄTIGEN'), findsOneWidget);
      expect(find.byKey(const Key('orgUser')), findsNothing);
      expect(find.byKey(const Key('orgSubmit')), findsNothing);
      // another address
      await tester.tap(find.byKey(const Key('orgChange')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('orgAddress')), findsOneWidget);
    });

    testWidgets('falsche Adressen: leer, kein Stachel, Instanz mit eigenen Konten', (tester) async {
      final a = await _pump(tester);
      await tester.tap(find.byKey(const Key('loginOrg')));
      await tester.pumpAndSettle();
      Future<String> next(String address) async {
        await tester.enterText(find.byKey(const Key('orgAddress')), address);
        await tester.tap(find.byKey(const Key('orgNext')));
        await tester.pumpAndSettle();
        return tester.widget<Notice>(find.byKey(const Key('orgError'))).text;
      }

      expect(await next('  '), startsWith('Bitte gib die Adresse'));
      expect(await next('nirgends.test'), 'Unter nirgends.test läuft kein Stachel. Prüf die Adresse.');
      expect(await next('stachel.test'), startsWith('Hier meldest du dich mit deinem Stachel-Konto an'));
      a.server.offline = true;
      expect(await next('org-stachel.test'), startsWith('Unter org-stachel.test ist gerade kein Stachel erreichbar.'));
      expect(a.session.account, isNull);
    });

    testWidgets('gespeicherte Anmeldung älterer Versionen (anderer Modus) gilt als Organisation', (tester) async {
      final a = await _pump(
        tester,
        prefs: {
          'stachel_app_account_v1': jsonEncode({'base': orgBase, 'mode': 'betreiber', 'user': 'a:flo', 'name': 'Flo'}),
          'stachel_app_session_v1': jsonEncode({
            'for': StachelSession.ownerOf('$orgBase|a:flo'),
            'token': 'sts_alt',
          }),
        },
      );
      expect(find.byType(StachelHomeScreen), findsOneWidget);
      expect(a.session.account!.mode, 'org');
      expect(a.session.account!.local, isFalse);
    });
  });

  group('Konto', () {
    testWidgets('Name ändern, Passwort ändern (falsch → Meldung), abmelden', (tester) async {
      final a = await _pump(tester, prefs: _loggedIn);
      await tester.tap(find.byKey(const Key('stachelAccount')));
      await tester.pumpAndSettle();
      expect(find.byType(AccountScreen), findsOneWidget);
      expect(find.text('mara@example.org'), findsOneWidget);
      await tester.tap(find.byKey(const Key('accountRename')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('accountField0')), 'Mara M.');
      await tester.tap(find.byKey(const Key('accountFieldOk')));
      await tester.pumpAndSettle();
      expect(a.server.body(a.server.calls('PATCH', '/api/account').single), {'name': 'Mara M.'});
      expect(find.text('Mara M.'), findsOneWidget);
      await tester.tap(find.byKey(const Key('accountPassword')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('accountField0')), 'falsch');
      await tester.enterText(find.byKey(const Key('accountField1')), 'neues-langes-pw');
      await tester.tap(find.byKey(const Key('accountFieldOk')));
      await tester.pumpAndSettle();
      expect(find.text('Das bisherige Passwort stimmt nicht.'), findsOneWidget);
      await tester.runAsync(() async {
        await tester.tap(find.byKey(const Key('accountLogout')));
        for (var i = 0; i < 40 && a.server.calls('DELETE', '/api/auth/app-session').isEmpty; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 25));
        }
      });
      await tester.pumpAndSettle();
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(
        a.server.calls('DELETE', '/api/auth/app-session').single.headers['Authorization'],
        'Bearer sts_gespeichert',
      );
      expect(await StachelSession.load('$accountsBase|u:mara'), isNull);
    });

    testWidgets('Konto löschen: eigene Boards löschen oder übergeben, mit Passwort', (tester) async {
      final a = await _pump(tester, prefs: _loggedIn);
      await tester.tap(find.byKey(const Key('stachelAccount')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('accountDelete')));
      await tester.pumpAndSettle();
      expect(find.text('Sommerfest 2027'), findsOneWidget);
      await tester.tap(find.text('Löschen').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('An Jonas übergeben').last);
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('deletePassword')), 'richtig-geheim');
      await tester.tap(find.byKey(const Key('deleteConfirm')));
      await tester.pumpAndSettle();
      expect(a.server.body(a.server.calls('POST', '/api/account/delete').single), {
        'password': 'richtig-geheim',
        'boards': {'fest': 'u:jonas'},
      });
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.text('Dein Konto wurde gelöscht.'), findsOneWidget);
    });

    testWidgets('über eine Organisation angemeldet: kein Löschen, kein Passwort', (tester) async {
      await _pump(tester);
      await _orgLogin(tester);
      await tester.tap(find.byKey(const Key('stachelAccount')));
      await tester.pumpAndSettle();
      expect(find.text('Angemeldet über Beispielverein'), findsOneWidget);
      expect(find.text('Dein Konto bei Beispielverein bleibt bestehen.'), findsOneWidget);
      expect(find.byKey(const Key('accountDelete')), findsNothing);
      expect(find.byKey(const Key('accountPassword')), findsNothing);
      expect(find.byKey(const Key('accountForget')), findsOneWidget);
    });

    testWidgets('über eine Organisation angemeldet: Meine Daten bei Stachel löschen (Abbrechen, dann Löschen)', (
      tester,
    ) async {
      final a = await _pump(tester);
      await _orgLogin(tester);
      await tester.tap(find.byKey(const Key('stachelAccount')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('accountForget')));
      await tester.pumpAndSettle();
      expect(find.textContaining('das verwaltet Beispielverein'), findsOneWidget);
      await tester.tap(find.text('ABBRECHEN'));
      await tester.pumpAndSettle();
      expect(a.server.calls('POST', '/api/account/delete'), isEmpty);
      await tester.tap(find.byKey(const Key('accountForget')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('forgetConfirm')));
      await tester.pumpAndSettle();
      final call = a.server.calls('POST', '/api/account/delete').single;
      expect(call.url.host, Uri.parse(orgBase).host);
      expect(a.server.body(call), {'confirm': true});
      expect(call.headers['Authorization'], startsWith('Bearer sts_'));
      expect(call.headers['X-Stachel'], '1');
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.text('Deine Daten bei Stachel wurden gelöscht.'), findsOneWidget);
      expect(a.session.account, isNull);
    });

    testWidgets('Rechtliches auf der Konto-Seite: Impressum der Instanz, Löschen-Seite des Servers', (tester) async {
      final a = await _pump(tester, prefs: _loggedIn);
      await tester.tap(find.byKey(const Key('stachelAccount')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Impressum'));
      await tester.tap(find.byKey(const Key('legalDeletion')));
      expect(a.launched.map((u) => u.toString()), ['https://example.org/impressum', '$accountsBase/konto-loeschen']);
    });

    testWidgets('Meine Daten herunterladen: ZIP vom Server an das Teilen-Blatt; 429 → Meldung', (tester) async {
      final a = await _pump(tester, prefs: _loggedIn);
      final sharer = _Sharer();
      await tester.tap(find.byKey(const Key('stachelAccount')));
      await tester.pumpAndSettle();
      // the real screen has the entry; for the share sheet the same screen with a fake sharer on top
      expect(find.byKey(const Key('accountExport')), findsOneWidget);
      expect(find.textContaining('eigenen Boards (JSON) samt hochgeladenen Dateien'), findsOneWidget);
      unawaited(
        tester
            .state<NavigatorState>(find.byType(Navigator).first)
            .push(MaterialPageRoute<void>(builder: (_) => AccountScreen(session: a.session, sharer: sharer))),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('accountExport')).last);
      await tester.pumpAndSettle();
      final call = a.server.calls('GET', '/api/account/export').single;
      expect(call.headers['Authorization'], 'Bearer sts_gespeichert');
      final file = sharer.files.single;
      expect((file.$1, file.$2), ('stachel-daten-2026-11-02.zip', 'application/zip'));
      expect(file.$3, a.server.exportZip);

      a.server.exportLimited = true;
      await tester.tap(find.byKey(const Key('accountExport')).last);
      await tester.pumpAndSettle();
      expect(find.text('Zu viele Versuche. Bitte warte kurz.'), findsOneWidget);
      expect(sharer.files, hasLength(1));
    });

    testWidgets('über eine Organisation angemeldet: kein Datenexport (nur bei eigenen Konten)', (tester) async {
      await _pump(tester);
      await _orgLogin(tester);
      await tester.tap(find.byKey(const Key('stachelAccount')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('accountExport')), findsNothing);
      expect(find.byKey(const Key('legalTerms')), findsNothing); // the organisation's instance names no terms
    });

    testWidgets('Open-Source-Lizenzen auf der Konto-Seite öffnen die Lizenzseite der App', (tester) async {
      final a = await _pump(tester, prefs: _loggedIn);
      await tester.tap(find.byKey(const Key('stachelAccount')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('legalTerms')));
      expect(a.launched.last.toString(), 'https://example.org/nutzungsbedingungen');
      await _openLicenses(tester);
    });

    testWidgets('Anmeldeseite: Lizenzen und Nutzungsbedingungen bei den Rechtslinks', (tester) async {
      await _pump(tester);
      expect(find.byKey(const Key('legalTerms')), findsOneWidget);
      await _openLicenses(tester);
    });

    test('Lizenzen: Barlow (App) plus Schriften, lucide und PDFium der Pakete', () async {
      registerAppLicenses();
      registerAppLicenses(); // idempotent
      final entries = await LicenseRegistry.licenses.toList();
      final packages = entries.expand((e) => e.packages).toSet();
      expect(
        packages,
        containsAll(['Barlow', 'Barlow Condensed', 'Source Serif 4', 'JetBrains Mono', 'PDFium', 'lucide']),
      );
      final barlow = entries.where((e) => e.packages.contains('Barlow')).toList();
      expect(barlow, hasLength(1));
      final text = barlow.single.paragraphs.map((p) => p.text).join(' ');
      expect(text, contains('The Barlow Project Authors'));
      expect(text, contains('SIL OPEN FONT LICENSE Version 1.1'));
    });

    test('ohne Angabe der Instanz: Impressum und Datenschutz der App (stachel.intsode.com)', () {
      expect(stachelImprintFallback, 'https://stachel.intsode.com/impressum');
      expect(stachelPrivacyFallback, 'https://stachel.intsode.com/datenschutz');
    });
  });

  group('Board-Links', () {
    testWidgets('angemeldet: Link öffnet das Board über der Liste', (tester) async {
      final a = await _pump(tester, prefs: _loggedIn);
      a.links.handle(Uri.parse('$accountsBase/b/geteilt?o=n_1'));
      await tester.pumpAndSettle();
      // the title comes from the board itself (the list may not be loaded yet)
      expect((a.opened.last.$1, a.opened.last.$3), ('geteilt', 'n_1'));
      expect(find.byKey(const Key('fakeBoard')), findsOneWidget);
    });

    testWidgets('abgemeldet: erst anmelden, dann öffnet sich das Board', (tester) async {
      final a = await _pump(tester);
      a.links.handle(Uri.parse('$accountsBase/b/fest'));
      await tester.pumpAndSettle();
      expect(find.text('Melde dich an – danach öffnet sich das Board.'), findsOneWidget);
      await _login(tester, 'mara@example.org', 'richtig-geheim');
      expect(a.opened.last.$1, 'fest');
    });
  });

  group('Nutzungsbedingungen (erneute Zustimmung, STACHEL_TERMS_VERSION)', () {
    testWidgets('nichts offen: kein Dialog', (tester) async {
      final a = await _pump(tester, prefs: _loggedIn);
      expect(find.byKey(const Key('termsDialog')), findsNothing);
      expect(a.server.calls('GET', '/api/account/terms'), isNotEmpty);
    });

    testWidgets('neue Fassung: Dialog bis zur Zustimmung, nur mit Häkchen', (tester) async {
      final server = FakeServer()..termsPending = true;
      final a = await _pump(tester, server: server, prefs: _loggedIn);
      expect(find.byKey(const Key('termsDialog')), findsOneWidget);
      expect(find.text('Nutzungsbedingungen lesen (Fassung 2026-11-04)'), findsOneWidget);
      await tester.tap(find.byKey(const Key('termsDialogLink')));
      await tester.pumpAndSettle();
      expect(a.launched.last.toString(), 'https://example.org/nutzungsbedingungen');
      await tester.tap(find.byKey(const Key('termsDialogAccept')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('termsDialogError')), findsOneWidget);
      expect(server.calls('POST', '/api/account/terms'), isEmpty);
      await tester.tap(find.byKey(const Key('termsDialogCheck')));
      await tester.tap(find.byKey(const Key('termsDialogAccept')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('termsDialog')), findsNothing);
      expect(server.body(server.calls('POST', '/api/account/terms').single), {'accept': true, 'version': '2026-11-04'});
      expect(server.termsPending, isFalse);
      expect(a.session.account, isNotNull);
    });

    testWidgets('Abmelden statt zustimmen: zurück zur Anmeldung', (tester) async {
      final a = await _pump(tester, server: FakeServer()..termsPending = true, prefs: _loggedIn);
      await tester.tap(find.byKey(const Key('termsDialogLogout')));
      await tester.pumpAndSettle();
      expect(a.session.account, isNull);
      expect(find.byKey(const Key('loginSubmit')), findsOneWidget);
      expect(find.textContaining('Ohne Zustimmung zu den Nutzungsbedingungen'), findsOneWidget);
    });
  });
}
