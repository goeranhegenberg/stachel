import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel_board/stachel_board.dart';
import 'package:stachel_client/stachel_client.dart';

import 'auth_api.dart';
import 'config.dart';

/// Who is logged in on this phone: the instance ([base]), its mode (`local` = own Stachel account, `org` = with the
/// login of an organisation, contract §1) and the person. The app session (`sts_…`) itself lives in [StachelSession]
/// (shared with the board list), bound to [loginKey].
@immutable
class StachelAccount {
  const StachelAccount({
    required this.base,
    required this.mode,
    required this.userKey,
    required this.name,
    this.email,
    this.org,
  });

  final String base;
  final String mode;
  final String userKey;
  final String name;
  final String? email;

  /// Mode org: the organisation's name at login time (`/api/instance` `orgName`); null = not named.
  final String? org;

  bool get local => mode == 'local';

  /// Binds stored data (session, kept list, offline boards) to this login.
  String get loginKey => '${stachelTrimBase(base)}|$userKey';

  Map<String, Object?> toJson() => {
    'base': base,
    'mode': mode,
    'user': userKey,
    'name': name,
    'email': ?email,
    'org': ?org,
  };

  /// Stored logins of older versions keep working: no mode = `local`, any other mode than `local` = `org`.
  static StachelAccount? fromJson(Object? j) {
    if (j is! Map || j['base'] is! String || j['user'] is! String) return null;
    return StachelAccount(
      base: j['base'] as String,
      mode: j['mode'] == null || j['mode'] == 'local' ? 'local' : 'org',
      userKey: j['user'] as String,
      name: j['name'] is String ? j['name'] as String : '',
      email: j['email'] is String ? j['email'] as String : null,
      org: j['org'] is String && (j['org'] as String).isNotEmpty ? j['org'] as String : null,
    );
  }

  StachelAccount withName(String n) =>
      StachelAccount(base: base, mode: mode, userKey: userKey, name: n, email: email, org: org);
}

/// The login of the app: kept across starts, ended by logout or a rejected session.
class AppSession extends ChangeNotifier {
  AppSession({http.Client? client}) : httpClient = client ?? http.Client();

  static const _key = 'stachel_app_account_v1';
  static const _instancesKey = 'stachel_app_org_instances_v1';

  final http.Client httpClient;
  StachelAccount? _account;
  bool _loaded = false;

  /// Text for the login page after the session ended by itself („Deine Anmeldung ist abgelaufen …“).
  String? notice;

  StachelAccount? get account => _account;
  bool get loaded => _loaded;

  Future<void> load() async {
    try {
      final raw = (await SharedPreferences.getInstance()).getString(_key);
      final a = StachelAccount.fromJson(raw == null ? null : jsonDecode(raw));
      // without its session token the account is of no use (e.g. data cleared halfway)
      if (a != null && await StachelSession.load(a.loginKey) != null) _setAccount(a);
    } catch (_) {}
    _loaded = true;
    notifyListeners();
  }

  /// The account, and the organisation's name in the shared texts (`stachelOrgName`).
  void _setAccount(StachelAccount? a) {
    _account = a;
    stachelOrgName = a == null || a.local ? null : a.org;
  }

  /// After a successful login on [base]; mode `org` also remembers the instance for the next login ([orgInstances]).
  Future<void> signedIn(String base, String mode, AppLogin login, {String? email, String? org}) async {
    final a = StachelAccount(base: base, mode: mode, userKey: login.userKey, name: login.name, email: email, org: org);
    await StachelSession.save(a.loginKey, login.token);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(a.toJson()));
    if (!a.local) {
      final b = stachelTrimBase(base);
      await prefs.setStringList(
        _instancesKey,
        [b, ...(prefs.getStringList(_instancesKey) ?? const []).where((x) => x != b)].take(5).toList(),
      );
    }
    _setAccount(a);
    notice = null;
    notifyListeners();
  }

  /// Instances in mode org logged in before (newest first, at most 5).
  Future<List<String>> orgInstances() async {
    try {
      return (await SharedPreferences.getInstance()).getStringList(_instancesKey) ?? const [];
    } catch (_) {
      return const [];
    }
  }

  Future<void> renamed(String name) async {
    final a = _account;
    if (a == null) return;
    _setAccount(a.withName(name));
    await (await SharedPreferences.getInstance()).setString(_key, jsonEncode(_account!.toJson()));
    notifyListeners();
  }

  /// The session token (null when logged out).
  Future<String?> token() async {
    final a = _account;
    return a == null ? null : StachelSession.load(a.loginKey);
  }

  /// Logout: ends the session on the server (best effort) and deletes what is kept on this phone.
  Future<void> signOut({String? notice}) async {
    final a = _account;
    _setAccount(null);
    this.notice = notice;
    notifyListeners();
    try {
      await (await SharedPreferences.getInstance()).remove(_key);
    } catch (_) {}
    if (a != null) await StachelSession.signedOut(httpClient, base: a.base);
  }

  AuthApi api(String base) => AuthApi(base, client: httpClient);
}

/// The Stachel app's side of the shared screens (`stachel_client`, concept §2): the session comes from the login
/// screen; when the server rejects it the app goes back to the login (no silent renewal – no password is stored).
class StachelAppClient extends StachelClient {
  StachelAppClient(this.session, this.account, {this.accountAction});

  final AppSession session;
  final StachelAccount account;

  /// The account button in the app bar of the board list.
  final Widget Function(BuildContext context)? accountAction;

  @override
  String get base => account.base;

  @override
  http.Client get httpClient => session.httpClient;

  @override
  String get appName => 'Stachel-App';

  @override
  String? get clientId => 'stachel';

  @override
  String? get loginKey => session.account?.loginKey == account.loginKey ? account.loginKey : null;

  @override
  Future<String> newSession(String base) async => throw StachelException.forCode('session_expired');

  @override
  void loginLost(BuildContext context, {String? message}) {
    // several requests may notice it at once; the first one ends the login
    if (session.account?.loginKey != account.loginKey) return;
    // own wording (not „Deine Anmeldung bei {Organisation} …“, also when logged in through an organisation)
    unawaited(session.signOut(notice: StachelException.forCode('session_expired').message));
    if (context.mounted) Navigator.of(context).popUntil((r) => r.isFirst);
  }

  /// „Im Browser öffnen“: the board's link (the browser has its own login).
  @override
  Future<void> openInBrowser({String? board, String? object, ExternalLauncher launcher = launchExternal}) async {
    final url = board == null
        ? Uri.parse(account.base)
        : Uri.parse(stachelBoardUrl(board, objectId: object, base: account.base));
    if (!await launcher(url)) throw StachelException.forCode('no_browser');
  }

  @override
  BoardRegistry get registry => stachelBoardRegistry;

  @override
  List<Widget> homeActions(BuildContext context) => [?accountAction?.call(context)];

  /// „Blockierte Personen“ lives on the account page (UX P15), not as its own button in the board list.
  @override
  bool get blockedPeopleInAccount => accountAction != null;

  @override
  bool get showsRoles => account.local;
}

/// The version shown on the account page.
const appVersionText = StachelConfig.appVersion;
