import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:stachel_board/stachel_board.dart';
import 'package:url_launcher/url_launcher.dart';

/// What the shared Stachel screens need from the app around them (concept `docs/stachel_app_konzept.md` §2).
///
/// - Stachel app: its own client (session from the login screen, back to it when the session is gone).
/// - Host app of an organisation (instance in mode `org`, contract §1): session from its own token
///   (`POST /api/auth/app-session`), its login when the session is gone, and its own extras through the extension
///   points below – see the package README („Erweiterungspunkte“).
///
/// Extension points for host apps:
/// - [registry]: own tools (e.g. a mind map template via `mindmapTemplateTool`), object actions (context bar
///   `defineContextAction`, object menu `defineMenuItem`, e.g. „Als Aufgabe anlegen“), board menu entries.
/// - [services]: the app's own services, reachable from those entries through [StachelClientHost.client].
/// - [homeActions]: buttons in the board list's app bar (e.g. „Am Computer anmelden“ = scan a login QR and approve it
///   with `POST /api/auth/qr/approve`).
/// - [stachelOrgName]: the organisation's name in the shared error texts.
abstract class StachelClient {
  /// Stachel origin, e.g. `https://stachel.example.org` (no trailing slash needed).
  String get base;

  /// HTTP client for every Stachel request (tests pass a fake).
  http.Client get httpClient;

  /// The app's name in texts („Bitte die Stachel-App aktualisieren.“).
  String get appName;

  /// `hello.client` of the native API (contract §8.4): null = field left out (the server takes it as `org`, a host
  /// app; `minApps.org`), `stachel` = Stachel app (`minApps.stachel`).
  String? get clientId => null;

  /// Identity of the current login (any string; only a hash of it is stored): binds the stored Stachel session, the
  /// kept board list and the inbox position to one login. Null = nobody logged in.
  String? get loginKey;

  /// A new Stachel session token (`sts_…`) for [base] after the old one was rejected (401, close 4401), or the first
  /// one. Throws [StachelException] (`needsLogin` → [loginLost]).
  Future<String> newSession(String base);

  /// The login is gone (session expired, account blocked): leave Stachel to the app's login with [message].
  void loginLost(BuildContext context, {String? message});

  /// „Im Browser öffnen“ for [board] (and [object]) or the overview. Throws [StachelException] (`no_browser`).
  Future<void> openInBrowser({String? board, String? object, ExternalLauncher launcher = launchExternal});

  /// Board features (the shared ones plus the app's extras).
  BoardRegistry get registry;

  /// Extra buttons for the app bar of the board list (before „Im Browser öffnen“).
  List<Widget> homeActions(BuildContext context) => const [];

  /// The app's account page lists „Blockierte Personen“ (UX P15): the board list then leaves out its own ⊘ button.
  bool get blockedPeopleInAccount => false;

  /// App services the app's own board extras need (e.g. the host app's API client), reachable from the board host.
  Object? get services => null;

  /// Whether the board list shows the role of each board (instances with own accounts, contract §6).
  bool get showsRoles => false;
}

/// Name of the organisation whose login the app uses (mode `org`), for the shared texts („Deine Anmeldung bei {name}
/// ist abgelaufen …“); null = neutral wording. Set by the app like [Sk.style] (a host app once at start, the Stachel
/// app from `/api/instance` `orgName` after an org login).
String? stachelOrgName;

/// Opens a URL outside the app; true if something took it.
typedef ExternalLauncher = Future<bool> Function(Uri uri);

/// The phone's system browser (no WebView, Göran 2026-11-01).
Future<bool> launchExternal(Uri uri) => launchUrl(uri, mode: LaunchMode.externalApplication);

/// [base] without a trailing slash.
String stachelTrimBase(String base) {
  final b = base.trim();
  return b.endsWith('/') ? b.substring(0, b.length - 1) : b;
}

/// True if [uri] is a page of exactly [base]: same scheme (http/https), host (case ignored) and port, no user info.
/// `stachel.example.org.evil.de`, `stachel.example.org@evil.de` or another scheme do not count.
bool stachelUrlMatches(Uri uri, String base) {
  final b = Uri.tryParse(base.trim());
  if (b == null || b.host.isEmpty) return false;
  return (uri.scheme == 'https' || uri.scheme == 'http') &&
      uri.scheme == b.scheme.toLowerCase() &&
      uri.userInfo.isEmpty &&
      uri.host.toLowerCase() == b.host.toLowerCase() &&
      uri.port == b.port;
}

/// True if a token may go to Stachel at [base]: only over https; plain http (dev server, sandbox) only outside release
/// builds, so a misconfigured release never sends a token in clear text.
bool stachelBaseMaySendToken(String base, {bool release = kReleaseMode}) {
  final b = Uri.tryParse(base.trim());
  if (b == null || b.host.isEmpty || b.userInfo.isNotEmpty) return false;
  final scheme = b.scheme.toLowerCase();
  return scheme == 'https' || (scheme == 'http' && !release);
}

/// Board ID format of the contract (§2 App-Login, `&b=`).
final stachelBoardIdPattern = RegExp(r'^[A-Za-z0-9_-]{1,64}$');

/// Link to a board (and one object on it) that opens the app on phones with it and the board in the browser
/// elsewhere: `<base>/b/<board>[?o=<object>]` (the server redirects `/b/` to `/?b=…&o=…`).
String stachelBoardUrl(String boardId, {String? objectId, required String base}) {
  final o = objectId == null ? '' : '?o=${Uri.encodeQueryComponent(objectId)}';
  return '${stachelTrimBase(base)}/b/${Uri.encodeComponent(boardId)}$o';
}

/// Error of a Stachel request with a German text for people. [code] is the contract's error code (`invalid_token`,
/// `network`, `forbidden` …) or the server's `error`.
class StachelException implements Exception {
  const StachelException(this.code, this.message);
  final String code;
  final String message;

  /// The German text of the app for [code]; [serverMessage] where the server's text is better.
  factory StachelException.forCode(String code, [String? serverMessage]) =>
      StachelException(code, stachelErrorText(code, serverMessage));

  /// The login was rejected → log in again (`invalid_token`: the host app's org token; `session_expired`: the Stachel
  /// app's own session).
  bool get needsLogin => code == 'invalid_token' || code == 'session_expired';

  /// Scanning a fresh code from the browser can help.
  bool get canRescan => const {
    'unknown_code',
    'expired',
    'already_used',
    'network',
    'org_unreachable',
    'rate_limited',
    'auth_failed',
  }.contains(code);

  @override
  String toString() => message;
}

/// The [StachelException] for an answer with HTTP [status] (null = no answer / network) and the server's JSON
/// `error` [code] and `message`. Only a real Stachel answer (JSON with `error`) brings the server's text.
StachelException stachelErrorFrom({int? status, String? code, String? message}) {
  if (status == null) return StachelException.forCode('network');
  // Only Stachel's explicit `invalid_token` ends the app session; a bare 401 (proxy, misconfiguration) must not log out.
  final c =
      code ??
      switch (status) {
        401 => 'auth_failed',
        403 => 'forbidden',
        404 => 'unknown_code',
        409 => 'already_used',
        410 => 'expired',
        429 => 'rate_limited',
        >= 500 => 'network', // proxy/server down without a JSON answer
        _ => 'error',
      };
  return StachelException.forCode(c, code == null ? null : message);
}

/// German texts of the error codes (the server's text only where noted).
/// [org]: name of the organisation (default [stachelOrgName]).
String stachelErrorText(String code, String? serverMessage, {String? org}) =>
    _errorText(code, serverMessage, org ?? stachelOrgName);

String _errorText(String code, String? serverMessage, String? org) => switch (code) {
  'invalid_token' =>
    org == null
        ? 'Deine Anmeldung ist abgelaufen – bitte melde dich neu an.'
        : 'Deine Anmeldung bei $org ist abgelaufen – bitte melde dich neu an.',
  'session_expired' => 'Deine Anmeldung ist abgelaufen – bitte melde dich neu an.',
  'pending' =>
    org == null
        ? 'Dein Konto wartet noch auf Freigabe – danach klappt auch Stachel.'
        : 'Dein Konto bei $org wartet noch auf Freigabe – danach klappt auch Stachel.',
  'forbidden' => 'Dein Konto hat keinen Zugriff auf Stachel. Frag bei der Orga nach, wenn das nicht stimmt.',
  'unknown_code' => 'Diesen Code kennt Stachel nicht. Lade die Seite im Browser neu und scanne den neuen Code.',
  'expired' => 'Code abgelaufen, im Browser neu laden.',
  'already_used' => 'Dieser Code wurde schon benutzt. Lade die Seite im Browser neu und scanne den neuen Code.',
  'network' => 'Stachel ist gerade nicht erreichbar – prüf dein Internet und versuch es nochmal.',
  'org_unreachable' =>
    serverMessage ?? '${org ?? 'Deine Organisation'} ist gerade nicht erreichbar. Bitte versuch es gleich nochmal.',
  'rate_limited' => serverMessage ?? 'Zu viele Versuche. Bitte warte ein paar Minuten.',
  'auth_failed' => 'Stachel konnte deine Anmeldung gerade nicht prüfen. Bitte versuch es gleich nochmal.',
  'not_available' => 'Die Board-Liste kommt mit dem nächsten Stachel-Update. Bis dahin öffnest du Stachel im Browser.',
  'no_browser' => 'Auf diesem Handy ist kein Browser eingerichtet, der Stachel öffnen kann.',
  _ => serverMessage ?? 'Die Anmeldung bei Stachel hat nicht geklappt.',
};
