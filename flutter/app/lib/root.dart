import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stachel_client/stachel_client.dart';

import 'app_session.dart';
import 'config.dart';
import 'links.dart';
import 'screens/account_screen.dart';
import 'screens/login_screen.dart';
import 'screens/terms_dialog.dart';
import 'theme.dart';

/// The Stachel app: login page without a session, else the board list of the shared package (`StachelHomeScreen`) with
/// an account button. App links (`/b/`, `/verify/`, `/reset/`) and shares from other apps land here; new @mentions
/// show as a hint when the app comes to the front.
class StachelApp extends StatefulWidget {
  const StachelApp({
    super.key,
    required this.session,
    required this.links,
    this.launcher = launchExternal,
    this.accountsBase = StachelConfig.accountsBase,
    this.orgInstances,
    this.boardScreen,
    this.checkInbox = true,
  });

  final AppSession session;
  final StachelAppLinks links;
  final ExternalLauncher launcher;
  final String accountsBase;

  /// Known instances in mode org for the login page; null = [StachelConfig.orgInstances].
  final List<String>? orgInstances;

  /// Board screen (tests); null = the live one.
  final StachelBoardScreenBuilder? boardScreen;

  /// New @mentions as a hint (tests switch it off).
  final bool checkInbox;

  @override
  State<StachelApp> createState() => _StachelAppState();
}

class _StachelAppState extends State<StachelApp> with WidgetsBindingObserver {
  final _nav = GlobalKey<NavigatorState>();
  final _messenger = GlobalKey<ScaffoldMessengerState>();
  String? _openBoard;
  String? _openObject;
  int _openSeq = 0;
  String? _loginEmail;
  String? _loginOk;

  /// A board link that came before the login: opened right after it.
  BoardAppLink? _afterLogin;
  String? _lastLogin;

  AppSession get _session => widget.session;

  @override
  void initState() {
    super.initState();
    Sk.style = StachelTheme.style;
    Sk.darkStyle = StachelTheme.darkStyle;
    WidgetsBinding.instance.addObserver(this);
    _session.addListener(_sessionChanged);
    widget.links.pending.addListener(_link);
    StachelShareTarget.instance.pending.addListener(_shared);
    if (!_session.loaded) unawaited(_session.load());
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _link();
      _shared();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _session.removeListener(_sessionChanged);
    widget.links.pending.removeListener(_link);
    StachelShareTarget.instance.pending.removeListener(_shared);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_inbox());
      unawaited(_terms());
    }
  }

  void _sessionChanged() {
    if (!mounted) return;
    final login = _session.account?.loginKey;
    setState(() {});
    if (login != null && login != _lastLogin) {
      _lastLogin = login;
      _openBoard = _openObject = null;
      final pending = _afterLogin;
      _afterLogin = null;
      if (pending != null) WidgetsBinding.instance.addPostFrameCallback((_) => _openBoardLink(pending));
      unawaited(_inbox());
      unawaited(_terms());
    }
    if (login == null) _lastLogin = null;
  }

  StachelAppClient? _clientCache;
  StachelAppClient? get _client {
    final a = _session.account;
    if (a == null) return _clientCache = null;
    final c = _clientCache;
    if (c != null && c.account.loginKey == a.loginKey && c.account.name == a.name) return c;
    return _clientCache = StachelAppClient(_session, a, accountAction: _accountButton);
  }

  Widget _accountButton(BuildContext context) => IconButton(
    key: const Key('stachelAccount'),
    tooltip: 'Konto',
    icon: const Icon(Icons.account_circle_outlined),
    onPressed: () => _nav.currentState?.push(
      MaterialPageRoute<void>(
        builder: (_) => AccountScreen(session: _session, launcher: widget.launcher),
      ),
    ),
  );

  void _snack(String text, {SnackBarAction? action}) => _messenger.currentState
    ?..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text), action: action, duration: const Duration(seconds: 6)));

  // ---- links -------------------------------------------------------------------------------------------------------

  void _link() {
    if (!mounted || widget.links.pending.value == null || _nav.currentState == null) return;
    final link = widget.links.take()!;
    final api = _session.api(widget.accountsBase);
    switch (link) {
      case BoardAppLink():
        final a = _session.account;
        if (a == null) {
          _afterLogin = link;
          _snack('Melde dich an – danach öffnet sich das Board.');
        } else {
          _openBoardLink(link);
        }
      case VerifyAppLink(:final token):
        unawaited(_toLogin(VerifyScreen(api: api, token: token), 'E-Mail bestätigt – melde dich jetzt an.'));
      case ResetAppLink(:final token):
        unawaited(_toLogin(ResetScreen(api: api, token: token), 'Neues Passwort gespeichert – melde dich jetzt an.'));
    }
  }

  /// Verify / reset page; afterwards the login with the address (when logged out).
  Future<void> _toLogin(Widget page, String ok) async {
    _nav.currentState?.popUntil((r) => r.isFirst);
    final email = await _nav.currentState?.push<String>(MaterialPageRoute(builder: (_) => page));
    if (!mounted || email == null) return;
    if (_session.account == null) {
      setState(() {
        _loginEmail = email;
        _loginOk = email.isEmpty ? null : ok;
      });
    } else {
      _snack('Erledigt.');
    }
  }

  /// Opens [link]'s board. App links belong to [StachelApp.accountsBase]; [own] = a board of the logged-in instance
  /// (e.g. from its inbox, also in mode org).
  void _openBoardLink(BoardAppLink link, {bool own = false}) {
    final a = _session.account;
    if (a == null) return;
    if (!own && stachelTrimBase(a.base) != stachelTrimBase(widget.accountsBase)) {
      _snack(
        'Dieser Link gehört zu ${Uri.parse(widget.accountsBase).host} – du bist bei ${Uri.parse(a.base).host} angemeldet.',
      );
      return;
    }
    _nav.currentState?.popUntil((r) => r.isFirst);
    setState(() {
      _openSeq++;
      _openBoard = link.boardId;
      _openObject = link.objectId;
    });
  }

  // ---- shares from other apps --------------------------------------------------------------------------------------

  void _shared() {
    if (!mounted || StachelShareTarget.instance.pending.value == null) return;
    final ctx = _nav.currentContext;
    if (ctx == null) return;
    final share = StachelShareTarget.instance.take()!;
    final client = _client;
    if (client == null) {
      unawaited(StachelShareTarget.discard(share));
      _snack('Melde dich zuerst an und teile dann nochmal.');
      return;
    }
    _nav.currentState?.popUntil((r) => r.isFirst);
    unawaited(startStachelShare(ctx, client, share));
  }

  // ---- @mentions ---------------------------------------------------------------------------------------------------

  static const _sinceKey = 'stachel_app_inbox_since_v1';

  /// New @mentions / assigned cards since the last look: the newest as a hint with „ÖFFNEN“. First run = baseline.
  Future<void> _inbox() async {
    final client = _client;
    if (!widget.checkInbox || client == null) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      final owner = StachelSession.ownerOf(client.account.loginKey);
      String? since;
      try {
        final j = jsonDecode(prefs.getString(_sinceKey) ?? 'null');
        if (j is Map && j['for'] == owner && j['since'] is String) since = j['since'] as String;
      } catch (_) {}
      final page = await HttpStachelBoardsApi(client).inbox(since: since, onlyStored: true);
      if (page == null || !mounted) return;
      await prefs.setString(_sinceKey, jsonEncode({'for': owner, 'since': page.now}));
      if (since == null || page.items.isEmpty) return;
      final i = page.items.last;
      final who = i.by?.trim().isNotEmpty == true ? i.by!.trim() : 'Jemand';
      final more = page.items.length > 1 ? ' (+${page.items.length - 1} weitere)' : '';
      _snack(
        i.type == 'assign'
            ? '$who hat dir in „${i.boardTitle}“ eine Karte zugewiesen$more.'
            : '$who hat dich in „${i.boardTitle}“ erwähnt$more.',
        action: SnackBarAction(
          label: 'ÖFFNEN',
          onPressed: () => _openBoardLink(BoardAppLink(i.boardId, i.objectId), own: true),
        ),
      );
    } catch (_) {
      // offline, session gone: next time
    }
  }

  // ---- terms of use -------------------------------------------------------------------------------------------------

  bool _termsOpen = false;

  /// Mode local: the terms in force (`STACHEL_TERMS_VERSION`) not accepted yet → a dialog that only closes by
  /// accepting or logging out (legal: Nutzungsbedingungen § 11, consent to changed terms is explicit).
  Future<void> _terms() async {
    final a = _session.account;
    if (a == null || !a.local || _termsOpen) return;
    final api = _session.api(a.base);
    try {
      final token = await _session.token();
      if (token == null) return;
      final state = await api.terms(token);
      if (state == null || !state.pending || !mounted || _session.account?.loginKey != a.loginKey) return;
      final ctx = _nav.currentContext;
      if (ctx == null || !ctx.mounted) return;
      _termsOpen = true;
      final accepted = await showDialog<bool>(
        context: ctx,
        barrierDismissible: false,
        builder: (_) =>
            TermsDialog(state: state, launcher: widget.launcher, accept: (v) async => api.acceptTerms(token, v)),
      );
      _termsOpen = false;
      if (accepted != true && mounted) {
        await _session.signOut(notice: 'Ohne Zustimmung zu den Nutzungsbedingungen kannst du Stachel nicht nutzen.');
      }
    } catch (_) {
      _termsOpen = false; // offline, session gone: next time
    }
  }

  // ---- UI ----------------------------------------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Stachel',
    debugShowCheckedModeBanner: false,
    theme: StachelTheme.theme(),
    // UX-Review P14: dark mode follows the system; screens and bars dark, the board itself stays light
    darkTheme: StachelTheme.darkTheme(),
    themeMode: ThemeMode.system,
    builder: (context, child) {
      Sk.follow(context);
      return child ?? const SizedBox.shrink();
    },
    navigatorKey: _nav,
    scaffoldMessengerKey: _messenger,
    home: _home(),
  );

  Widget _home() {
    if (!_session.loaded) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final client = _client;
    if (client == null) {
      return LoginScreen(
        key: ValueKey('login:${_loginEmail ?? ''}:${_loginOk ?? ''}:${_session.notice ?? ''}'),
        session: _session,
        base: widget.accountsBase,
        orgInstances: widget.orgInstances ?? StachelConfig.orgInstances,
        email: _loginEmail,
        ok: _loginOk,
        launcher: widget.launcher,
      );
    }
    return StachelHomeScreen(
      key: ValueKey('home:${client.account.loginKey}:$_openSeq'),
      client: client,
      openBoard: _openBoard,
      openObject: _openObject,
      launcher: widget.launcher,
      boardScreen: widget.boardScreen,
      showNativePreview: false,
    );
  }
}
