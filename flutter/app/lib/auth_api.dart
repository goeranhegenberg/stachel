import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:stachel_client/stachel_client.dart';

import 'captcha.dart';
import 'config.dart';

/// Answer of a login: the app session (`sts_…`, contract §8.1) and who it is.
class AppLogin {
  const AppLogin({required this.token, required this.userKey, required this.name, this.expiresAt});
  final String token;
  final String userKey;
  final String name;
  final String? expiresAt;

  static AppLogin? fromJson(Map<String, Object?> j) {
    final t = j['token'], u = j['user'];
    if (t is! String || !t.startsWith('sts_') || u is! Map || u['key'] is! String) return null;
    return AppLogin(
      token: t,
      userKey: u['key'] as String,
      name: u['name'] is String ? u['name'] as String : '',
      expiresAt: j['expiresAt'] is String ? j['expiresAt'] as String : null,
    );
  }
}

/// `GET /api/instance` (contract §6): mode, brand, legal links, registration (`open` / `invite`); in mode `org` the
/// organisation's name, its app's name, whether its password login is offered and its Android package.
class InstanceInfo {
  const InstanceInfo({
    required this.auth,
    this.brand,
    this.imprintUrl,
    this.privacyUrl,
    this.termsUrl,
    this.registration,
    this.orgName,
    this.orgAppName,
    this.orgPasswordLogin = false,
    this.orgAndroidPackage,
  });

  /// `local` (own Stachel accounts) or `org` (login through an organisation, contract §1).
  final String auth;
  final String? brand;
  final String? imprintUrl;
  final String? privacyUrl;

  /// Terms of use (`STACHEL_TERMS_URL`); null = the instance names none (the checkbox then has no link).
  final String? termsUrl;
  final String? registration;

  /// Mode org: the organisation (`STACHEL_ORG_NAME`) and its app (`STACHEL_ORG_APP_NAME`); null = not named.
  final String? orgName;
  final String? orgAppName;

  /// Mode org: „Benutzername + Passwort“ of the organisation is offered (`STACHEL_ORG_LOGIN_URL` set).
  final bool orgPasswordLogin;
  final String? orgAndroidPackage;

  bool get local => auth == 'local';

  /// Every mode but `local` logs in through an organisation.
  bool get org => !local;

  /// „Beispielverein“ or „deiner Organisation“ for texts.
  String get orgLabel => orgName ?? 'deiner Organisation';

  /// „Beispielverein-App“ (server default `{orgName}-App`) or „App deiner Organisation“.
  String get orgAppLabel => orgAppName ?? (orgName == null ? 'App deiner Organisation' : '$orgName-App');

  static InstanceInfo fromJson(Map<String, Object?> j) {
    String? s(String k) => j[k] is String && (j[k] as String).trim().isNotEmpty ? (j[k] as String).trim() : null;
    return InstanceInfo(
      auth: s('auth') ?? 'org',
      brand: s('brand'),
      imprintUrl: s('imprintUrl'),
      privacyUrl: s('privacyUrl'),
      termsUrl: s('termsUrl'),
      registration: s('registration'),
      orgName: s('orgName'),
      orgAppName: s('orgAppName'),
      orgPasswordLogin: j['orgPasswordLogin'] == true,
      orgAndroidPackage: s('orgAndroidPackage'),
    );
  }
}

/// Own board of the account, for „Konto löschen“ (delete or hand over to a person with access).
class OwnedBoard {
  const OwnedBoard({required this.id, required this.title, required this.people});
  final String id;
  final String title;
  final List<({String key, String name})> people;
}

/// Which version of the terms of use is in force and whether the person still has to accept it
/// (`GET /api/account/terms`, legal: Nutzungsbedingungen § 11).
class TermsState {
  const TermsState({this.url, this.version, this.acceptedVersion, required this.pending});
  final String? url;
  final String? version;
  final String? acceptedVersion;
  final bool pending;

  factory TermsState.fromJson(Map<String, Object?> j) {
    String? s(String k) => j[k] is String && (j[k] as String).isNotEmpty ? j[k] as String : null;
    return TermsState(
      url: s('url'),
      version: s('version'),
      acceptedVersion: s('acceptedVersion'),
      pending: j['pending'] == true,
    );
  }
}

/// The account (`GET /api/account`).
class AccountInfo {
  const AccountInfo({required this.key, required this.name, required this.email, required this.boards});
  final String key;
  final String name;
  final String email;
  final List<OwnedBoard> boards;
}

/// A started „Mit der App deiner Organisation bestätigen“ (QR pairing, contract §2 + §8.1): [url] (`<base>/qr/<code>`)
/// opens the organisation's app, [cookie] proves this phone started it.
class OrgPairing {
  const OrgPairing({required this.code, required this.url, required this.cookie});
  final String code;
  final Uri url;
  final String cookie;
}

/// Login, registration and account requests of the Stachel app against one Stachel instance ([base]). Errors are
/// [StachelException] with the server's German text where it has one.
class AuthApi {
  AuthApi(this.base, {http.Client? client, this.release = kReleaseMode})
    : client = client ?? http.Client(),
      _base = stachelTrimBase(base);

  final String base;
  final String _base;
  final http.Client client;
  final bool release;

  static const _timeout = Duration(seconds: 20);

  Uri _u(String path) => Uri.parse('$_base$path');

  Future<Map<String, Object?>> _send(
    String method,
    String path, {
    Object? body,
    String? token,
    Map<String, String> headers = const {},
    Duration timeout = _timeout,
  }) async {
    if (!stachelBaseMaySendToken(_base, release: release)) throw StachelException.forCode('error');
    final req = http.Request(method, _u(path))
      ..followRedirects = false
      ..headers.addAll({
        'Accept': 'application/json',
        // the organisation's app shows „Stachel-App auf Android“ before confirming a login (server parseUserAgent)
        'User-Agent': 'StachelApp/${StachelConfig.appVersion} (${Platform.operatingSystem})',
        if (method != 'GET') 'X-Stachel': '1',
        if (body != null) 'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
        ...headers,
      });
    if (body != null) req.body = jsonEncode(body);
    final http.Response res;
    try {
      res = await http.Response.fromStream(await client.send(req).timeout(timeout)).timeout(timeout);
    } catch (_) {
      throw StachelException.forCode('network');
    }
    Map<String, Object?> j = const {};
    try {
      final d = jsonDecode(utf8.decode(res.bodyBytes));
      if (d is Map) j = d.cast<String, Object?>();
    } catch (_) {}
    _last = res;
    if (res.statusCode >= 200 && res.statusCode < 300) return j;
    final code = j['error'] is String ? j['error'] as String : null;
    final message = j['message'] is String ? j['message'] as String : null;
    if (res.statusCode == 401 && token != null && code == 'not_logged_in') {
      throw StachelException.forCode('session_expired');
    }
    throw StachelException(
      code ?? stachelErrorFrom(status: res.statusCode).code,
      message ?? stachelErrorFrom(status: res.statusCode).message,
    );
  }

  http.Response? _last;

  /// What the instance says about itself; `not_stachel` when the answer is not one of Stachel (no `auth`).
  Future<InstanceInfo> instance() async {
    final j = await _send('GET', '/api/instance');
    if (j['auth'] is! String) throw const StachelException('not_stachel', 'Unter dieser Adresse läuft kein Stachel.');
    return InstanceInfo.fromJson(j);
  }

  AppLogin _login(Map<String, Object?> j) => AppLogin.fromJson(j) ?? (throw StachelException.forCode('error'));

  /// Own account (mode `local`): `POST /api/auth/app-session {email, password}`.
  Future<AppLogin> login(String email, String password) async =>
      _login(await _send('POST', '/api/auth/app-session', body: {'email': email.trim(), 'password': password}));

  /// Password login of the organisation (mode `org` with `orgPasswordLogin`): `POST /api/auth/app-session
  /// {username, password}`.
  Future<AppLogin> orgLogin(String username, String password) async =>
      _login(await _send('POST', '/api/auth/app-session', body: {'username': username.trim(), 'password': password}));

  /// A captcha task (`GET /api/auth/captcha`).
  Future<CaptchaChallenge> captcha() async =>
      CaptchaChallenge.fromJson(await _send('GET', '/api/auth/captcha')) ?? (throw StachelException.forCode('error'));

  /// Register (`POST /api/auth/register`); [captcha] = solved payload. The server answers `ok` also when the address
  /// exists (a mail tells the owner) – so the answer never reveals accounts. `terms`: the person accepted the terms
  /// of use and confirmed being 18 or older (the privacy policy is only information, no consent; legal CR-1).
  Future<void> register({
    required String name,
    required String email,
    required String password,
    required String captcha,
  }) async {
    await _send(
      'POST',
      '/api/auth/register',
      body: {
        'name': name.trim(),
        'email': email.trim(),
        'password': password,
        'terms': true,
        'captcha': captcha,
        'website': '',
      },
    );
  }

  /// Confirm the address with the token from the mail; returns the address.
  Future<String?> verify(String token) async {
    final j = await _send('POST', '/api/auth/verify', body: {'token': token});
    return j['email'] is String ? j['email'] as String : null;
  }

  Future<void> resend(String email) => _send('POST', '/api/auth/resend', body: {'email': email.trim()});

  Future<void> forgot(String email) => _send('POST', '/api/auth/forgot', body: {'email': email.trim()});

  /// New password with the token from the mail; returns the address.
  Future<String?> reset(String token, String password) async {
    final j = await _send('POST', '/api/auth/reset', body: {'token': token, 'password': password});
    return j['email'] is String ? j['email'] as String : null;
  }

  // ---- „Mit der App deiner Organisation bestätigen“ (mode org) ------------------------------------------------------

  /// Starts a pairing (`POST /api/auth/qr`): the code, its link (App Link of the organisation's app) and the pairing
  /// cookie.
  Future<OrgPairing> startPairing() async {
    final j = await _send('POST', '/api/auth/qr');
    final code = j['code'], url = Uri.tryParse(j['url'] is String ? j['url'] as String : '');
    final setCookie = _last?.headers['set-cookie'] ?? '';
    final m = RegExp(r'stachel_pair=([^;,\s]+)').firstMatch(setCookie);
    if (code is! String || url == null || m == null || !stachelUrlMatches(url, _base)) {
      throw StachelException.forCode('error');
    }
    return OrgPairing(code: code, url: url, cookie: 'stachel_pair=${m.group(1)}');
  }

  /// Waits (long poll) for the organisation's app to confirm [p]: the login, or null while still waiting. `expired`
  /// when the code ran out (start a new one).
  Future<AppLogin?> waitPairing(OrgPairing p) async {
    final j = await _send(
      'GET',
      '/api/auth/qr/${Uri.encodeComponent(p.code)}/wait',
      headers: {'Cookie': p.cookie, 'X-Stachel-App': '1'},
      timeout: const Duration(seconds: 70),
    );
    if (j['status'] == 'approved') return _login(j);
    return null;
  }

  // ---- account (with the app session) ------------------------------------------------------------------------------

  Future<AccountInfo> account(String token) async {
    final j = await _send('GET', '/api/account', token: token);
    final a = j['account'];
    if (a is! Map || a['key'] is! String) throw StachelException.forCode('error');
    final boards = <OwnedBoard>[
      for (final b in (j['boards'] is List ? j['boards'] as List : const []))
        if (b is Map && b['id'] is String)
          OwnedBoard(
            id: b['id'] as String,
            title: b['title'] is String ? b['title'] as String : '',
            people: [
              for (final p in (b['people'] is List ? b['people'] as List : const []))
                if (p is Map && p['key'] is String) (key: p['key'] as String, name: '${p['name'] ?? ''}'),
            ],
          ),
    ];
    return AccountInfo(
      key: a['key'] as String,
      name: '${a['name'] ?? ''}',
      email: '${a['email'] ?? ''}',
      boards: boards,
    );
  }

  /// Terms of use (mode `local`, `STACHEL_TERMS_VERSION`): `GET /api/account/terms`; null when the answer is no
  /// state (older server without the route, offline) – then the app does not ask.
  Future<TermsState?> terms(String token) async {
    try {
      return TermsState.fromJson(await _send('GET', '/api/account/terms', token: token));
    } on StachelException catch (e) {
      if (e.code == 'session_expired') rethrow;
      return null;
    }
  }

  /// Accepts the terms in force ([version] from [terms]); 409 `terms_changed` when they changed meanwhile.
  Future<TermsState> acceptTerms(String token, String? version) async => TermsState.fromJson(
    await _send('POST', '/api/account/terms', token: token, body: {'accept': true, 'version': version}),
  );

  /// „Meine Daten herunterladen“ (Art. 20 DSGVO, legal CR-8): `GET /api/account/export` → the ZIP (konto.json, own
  /// boards as JSON with their files) and its file name from `Content-Disposition`.
  Future<({Uint8List bytes, String fileName})> exportData(String token) async {
    await _send(
      'GET',
      '/api/account/export',
      token: token,
      headers: {'Accept': 'application/zip'},
      timeout: _exportTimeout,
    );
    final res = _last!;
    final m = RegExp(r'filename="?([^";]+)"?').firstMatch(res.headers['content-disposition'] ?? '');
    final name = m?.group(1)?.trim();
    return (bytes: res.bodyBytes, fileName: name != null && name.endsWith('.zip') ? name : 'stachel-daten.zip');
  }

  static const _exportTimeout = Duration(minutes: 3);

  Future<void> rename(String token, String name) =>
      _send('PATCH', '/api/account', token: token, body: {'name': name.trim()});

  Future<void> changePassword(String token, String current, String password) =>
      _send('POST', '/api/account/password', token: token, body: {'current': current, 'password': password});

  /// Deletes the account; [boards]: per own board `delete` or the key of the person who gets it.
  Future<void> deleteAccount(String token, String password, Map<String, String> boards) =>
      _send('POST', '/api/account/delete', token: token, body: {'password': password, 'boards': boards});

  /// Mode org: „Meine Daten bei Stachel löschen“ (contract §6) – removes what Stachel keeps about the person
  /// (sessions incl. this one, AI tokens, favorites, inbox; names on boards become „Gelöschtes Konto“). The account at
  /// the organisation itself stays.
  Future<void> deleteStachelData(String token) =>
      _send('POST', '/api/account/delete', token: token, body: {'confirm': true});
}
