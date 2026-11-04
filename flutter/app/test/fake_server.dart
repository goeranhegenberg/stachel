import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const accountsBase = 'https://stachel.test';
const orgBase = 'https://org-stachel.test';

http.Response json(Object body, [int status = 200, Map<String, String> headers = const {}]) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8', ...headers},
);

/// A Stachel server with own accounts ([accountsBase], mode local) and one of an organisation ([orgBase], mode org,
/// „Beispielverein“) as far as the app's login, account and board list need them (contract §1, §6, §8.1).
class FakeServer {
  final requests = <http.Request>[];
  bool offline = false;

  /// Accounts: e-mail → (password, name, verified).
  final accounts = <String, ({String password, String name, bool verified})>{
    'mara@example.org': (password: 'richtig-geheim', name: 'Mara', verified: true),
    'neu@example.org': (password: 'richtig-geheim', name: 'Neu', verified: false),
  };
  final registered = <Map<String, Object?>>[];
  final mails = <String>[];
  int sessions = 0;

  /// `GET /api/account/export`: the ZIP's bytes (PK header), or 429 when [exportLimited].
  List<int> exportZip = [0x50, 0x4b, 0x03, 0x04, 1, 2, 3];
  bool exportLimited = false;

  /// `GET /api/account/terms`: the terms in force (`termsVersion`) not yet accepted by the account.
  bool termsPending = false;
  String termsVersion = '2026-11-04';

  /// The next n board-list requests answer 401 (session ended on the server).
  int expire = 0;

  /// Mode org: „Benutzername + Passwort“ offered (`orgPasswordLogin`); without it `app-session` with a user name is 404.
  bool orgPasswordLogin = true;

  /// Mode org: the name of the organisation (null = not named).
  String? orgName = 'Beispielverein';

  /// Waits of the org pairing answered `pending` before `approved`.
  int pendingWaits = 1;
  String captchaSalt = 'salz?expires=9999999999';
  int captchaNumber = 1234;

  List<Map<String, Object?>> boards = [
    {
      'id': 'fest',
      'title': 'Sommerfest 2027',
      'createdBy': 'u:mara',
      'createdByName': 'Mara',
      'updatedAt': '2026-10-30T10:00:00Z',
      'role': 'owner',
    },
    {
      'id': 'geteilt',
      'title': 'Geteiltes Board',
      'createdBy': 'u:jonas',
      'createdByName': 'Jonas',
      'updatedAt': '2026-10-29T10:00:00Z',
      'role': 'comment',
    },
  ];

  Iterable<http.Request> calls(String method, String path) =>
      requests.where((r) => r.method == method && r.url.path == path);

  Map<String, Object?> body(http.Request r) => (jsonDecode(r.body) as Map).cast<String, Object?>();

  String get _challenge => sha256.convert(utf8.encode('$captchaSalt$captchaNumber')).toString();

  late final MockClient client = MockClient((req) async {
    requests.add(req);
    if (offline) throw http.ClientException('offline');
    final origin = '${req.url.scheme}://${req.url.host}';
    final local = origin == accountsBase;
    if (!local && origin != orgBase) return json({'ok': false}, 404);
    final path = req.url.path;
    final m = req.method;
    final auth = req.headers['Authorization'] ?? '';
    final authed = auth.startsWith('Bearer sts_');
    if (m != 'GET' && path != '/api/auth/app-session' && req.headers['X-Stachel'] != '1') {
      return json({'ok': false, 'error': 'csrf', 'message': 'csrf'}, 403);
    }

    if (path == '/api/instance') {
      return json({
        'ok': true,
        'auth': local ? 'local' : 'org',
        'brand': 'Stachel',
        'orgName': local ? null : orgName,
        'orgAppName': local || orgName == null ? null : '$orgName-App',
        'orgPasswordLogin': !local && orgPasswordLogin,
        'orgAndroidPackage': null,
        'imprintUrl': 'https://example.org/impressum',
        'privacyUrl': 'https://example.org/datenschutz',
        'termsUrl': local ? 'https://example.org/nutzungsbedingungen' : null,
        'registration': local ? 'open' : null,
      });
    }
    if (path == '/api/auth/app-session' && m == 'POST') {
      final b = body(req);
      if (local) {
        final a = accounts[b['email']];
        if (a == null || a.password != b['password']) {
          return json({
            'ok': false,
            'error': 'wrong_login',
            'message': 'E-Mail-Adresse oder Passwort ist falsch.',
          }, 401);
        }
        if (!a.verified) {
          return json({
            'ok': false,
            'error': 'not_verified',
            'message': 'Bitte bestätige zuerst deine E-Mail-Adresse. Den Link haben wir dir geschickt.',
          }, 403);
        }
        sessions++;
        return json({
          'ok': true,
          'token': 'sts_local_$sessions',
          'user': {'key': 'u:mara', 'name': a.name, 'isOrga': false},
          'expiresAt': '2026-12-02T10:00:00Z',
        });
      }
      if (!orgPasswordLogin) return json({'ok': false, 'error': 'not_found', 'message': 'Nicht gefunden.'}, 404);
      if (b['username'] == 'flo' && b['password'] == 'geheim-org') {
        sessions++;
        return json({
          'ok': true,
          'token': 'sts_org_$sessions',
          'user': {'key': 'a:flo', 'name': 'Flo', 'isOrga': true},
        });
      }
      return json({
        'ok': false,
        'error': 'invalid_credentials',
        'message': 'Benutzername oder Passwort ist falsch.',
      }, 401);
    }
    if (path == '/api/auth/app-session' && m == 'DELETE') return json({'ok': true});
    if (path == '/api/auth/captcha') {
      return json({
        'ok': true,
        'algorithm': 'SHA-256',
        'challenge': _challenge,
        'maxnumber': 5000,
        'salt': captchaSalt,
        'signature': 'a' * 64,
      });
    }
    if (path == '/api/auth/register') {
      final b = body(req);
      registered.add(b);
      if (b['terms'] != true) {
        return json({
          'ok': false,
          'error': 'terms_required',
          'message': 'Bitte akzeptiere die Nutzungsbedingungen und bestätige, dass du mindestens 18 Jahre alt bist.',
        }, 400);
      }
      final c = jsonDecode(utf8.decode(base64.decode(b['captcha'] as String))) as Map;
      if (c['number'] != captchaNumber || c['challenge'] != _challenge) {
        return json({
          'ok': false,
          'error': 'captcha_invalid',
          'message': 'Die Sicherheitsprüfung ist fehlgeschlagen.',
        }, 400);
      }
      mails.add('verify:${b['email']}');
      return json({'ok': true});
    }
    if (path == '/api/auth/verify') {
      final t = body(req)['token'];
      if (t == 'gueltiger-bestaetigungs-token') return json({'ok': true, 'email': 'neu@example.org'});
      return json({'ok': false, 'error': 'link_expired', 'message': 'Dieser Bestätigungslink ist abgelaufen.'}, 410);
    }
    if (path == '/api/auth/resend' || path == '/api/auth/forgot') {
      mails.add('${path.split('/').last}:${body(req)['email']}');
      return json({'ok': true});
    }
    if (path == '/api/auth/reset') {
      final b = body(req);
      if ((b['password'] as String).length < 10) {
        return json({
          'ok': false,
          'error': 'weak_password',
          'message': 'Das Passwort braucht mindestens 10 Zeichen.',
        }, 400);
      }
      return json({'ok': true, 'email': 'mara@example.org'});
    }
    if (path == '/api/auth/qr' && m == 'POST' && !local) {
      return json(
        {'ok': true, 'code': 'paarungscode-123', 'url': '$orgBase/qr/paarungscode-123', 'expires_at': 'x'},
        200,
        {'set-cookie': 'stachel_pair=geheim-paar; Path=/api/auth/qr; HttpOnly; Max-Age=300'},
      );
    }
    if (path == '/api/auth/qr/paarungscode-123/wait') {
      if (req.headers['Cookie'] != 'stachel_pair=geheim-paar' || req.headers['X-Stachel-App'] != '1') {
        return json({'ok': false, 'error': 'wrong_browser', 'message': 'anderer Browser'}, 403);
      }
      if (pendingWaits > 0) {
        pendingWaits--;
        return json({'ok': true, 'status': 'pending'});
      }
      sessions++;
      return json({
        'ok': true,
        'status': 'approved',
        'token': 'sts_qr_$sessions',
        'user': {'key': 'm:7', 'name': 'Lena'},
      });
    }

    // ---- with session ----
    if (!authed) return json({'ok': false, 'error': 'not_logged_in', 'message': 'Bitte anmelden.'}, 401);
    if (path == '/api/boards' && m == 'GET') {
      if (expire > 0) {
        expire--;
        return json({'ok': false, 'error': 'not_logged_in', 'message': 'Bitte anmelden.'}, 401);
      }
      return json({'ok': true, 'boards': boards});
    }
    if (path == '/api/trash') return json({'ok': true, 'boards': []});
    if (path == '/api/auth/me') {
      return json({
        'ok': true,
        'user': local ? {'key': 'u:mara', 'name': 'Mara'} : {'key': 'a:flo', 'name': 'Flo'},
      });
    }
    if (path == '/api/native/v1/inbox') return json({'ok': true, 'now': '2026-11-02T10:00:00Z', 'items': []});
    if (path == '/api/account' && m == 'GET') {
      return json({
        'ok': true,
        'account': {'key': 'u:mara', 'name': 'Mara', 'email': 'mara@example.org', 'createdAt': '2026-10-30T10:00:00Z'},
        'boards': [
          {
            'id': 'fest',
            'title': 'Sommerfest 2027',
            'inTrash': false,
            'people': [
              {'key': 'u:jonas', 'name': 'Jonas', 'role': 'edit'},
            ],
          },
        ],
      });
    }
    if (path == '/api/account' && m == 'PATCH') return json({'ok': true});
    if (path == '/api/account/terms') {
      if (m == 'POST') {
        final b = body(req);
        if (b['accept'] != true) {
          return json({'ok': false, 'error': 'terms_required', 'message': 'Bitte akzeptiere.'}, 400);
        }
        if (b['version'] != termsVersion) {
          return json({
            'ok': false,
            'error': 'terms_changed',
            'message': 'Die Nutzungsbedingungen wurden gerade geändert.',
          }, 409);
        }
        termsPending = false;
      }
      return json({
        'ok': true,
        'url': 'https://example.org/nutzungsbedingungen',
        'version': termsVersion,
        'acceptedVersion': termsPending ? null : termsVersion,
        'acceptedAt': null,
        'pending': termsPending,
      });
    }
    if (path == '/api/account/password') {
      return body(req)['current'] == 'richtig-geheim'
          ? json({'ok': true})
          : json({'ok': false, 'error': 'wrong_password', 'message': 'Das bisherige Passwort stimmt nicht.'}, 403);
    }
    if (path == '/api/account/delete') return json({'ok': true});
    if (path == '/api/account/export' && m == 'GET') {
      if (exportLimited) {
        return json({'ok': false, 'error': 'rate_limited', 'message': 'Zu viele Versuche. Bitte warte kurz.'}, 429);
      }
      return http.Response.bytes(
        exportZip,
        200,
        headers: {
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="stachel-daten-2026-11-02.zip"',
        },
      );
    }
    return json({'ok': false, 'error': 'not_found', 'message': 'unbekannt'}, 404);
  });
}
