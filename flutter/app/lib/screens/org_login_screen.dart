import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:stachel_client/stachel_client.dart';

import '../app_session.dart';
import '../auth_api.dart';
import '../config.dart';
import '../theme.dart';
import 'widgets.dart';

/// „Bei einer Organisation anmelden“ (mode `org`, contract §1, concept §3.2): first the instance – typed address or
/// one of [instances] / the ones used before –, the app reads `/api/instance`; for an instance in mode org then:
/// - **Mit der {Org-App} bestätigen**: a login code (`POST /api/auth/qr`), its link `<base>/qr/<code>` opens the
///   organisation's app on this phone (its App Link), which asks „Im Browser bei Stachel anmelden?“ and confirms with
///   its own login; meanwhile this page waits (`/api/auth/qr/<code>/wait` with `X-Stachel-App: 1` → `sts_…`).
/// - **Benutzername + Passwort** of the organisation – only when the instance offers it (`orgPasswordLogin`).
///
/// Texts use `orgName` / `orgAppName` of the instance. Instances with own accounts (mode local) are not logged in here.
class OrgLoginScreen extends StatefulWidget {
  const OrgLoginScreen({
    super.key,
    required this.session,
    this.instances = const [],
    this.accountsBase = StachelConfig.accountsBase,
    this.launcher = launchExternal,
    this.release = kReleaseMode,
  });

  final AppSession session;

  /// Known instances in mode org offered for a tap (config); the ones used before come from [AppSession.orgInstances].
  final List<String> instances;

  /// The instance with own accounts (its login is the start page).
  final String accountsBase;
  final ExternalLauncher launcher;

  /// Release builds accept only https addresses.
  final bool release;

  @override
  State<OrgLoginScreen> createState() => _OrgLoginScreenState();
}

class _OrgLoginScreenState extends State<OrgLoginScreen> {
  final _address = TextEditingController();
  final _user = TextEditingController();
  final _password = TextEditingController();
  List<String> _known = const [];
  bool _busy = false;
  bool _checking = false;
  bool _waiting = false;
  int _attempt = 0;
  StachelException? _error;

  /// The chosen instance in mode org and what it says about itself; null = still choosing.
  String? _base;
  InstanceInfo? _info;

  AuthApi get _api => widget.session.api(_base!);

  @override
  void initState() {
    super.initState();
    _known = _merge(widget.instances, const []);
    unawaited(_loadKnown());
  }

  @override
  void dispose() {
    _attempt++; // stops a running wait
    _address.dispose();
    _user.dispose();
    _password.dispose();
    super.dispose();
  }

  List<String> _merge(List<String> a, List<String> b) {
    final out = <String>[];
    for (final x in [...b, ...a]) {
      final n = normalizeInstance(x);
      if (n != null && !out.contains(n) && n != normalizeInstance(widget.accountsBase)) out.add(n);
    }
    return out;
  }

  Future<void> _loadKnown() async {
    final used = await widget.session.orgInstances();
    if (mounted) setState(() => _known = _merge(widget.instances, used));
  }

  // ---- choosing the instance -----------------------------------------------------------------------------------------

  Future<void> _choose(String input) async {
    final base = normalizeInstance(input);
    if (base == null) {
      setState(
        () => _error = const StachelException(
          'invalid_input',
          'Bitte gib die Adresse von Stachel bei deiner Organisation an, z. B. board.example.org.',
        ),
      );
      return;
    }
    if (!stachelBaseMaySendToken(base, release: widget.release)) {
      setState(() => _error = const StachelException('invalid_input', 'Die Adresse muss mit https:// beginnen.'));
      return;
    }
    setState(() {
      _checking = true;
      _error = null;
    });
    try {
      final info = await widget.session.api(base).instance();
      if (!mounted) return;
      if (info.local) {
        setState(
          () => _error = StachelException(
            'not_org',
            normalizeInstance(widget.accountsBase) == base
                ? 'Hier meldest du dich mit deinem Stachel-Konto an – auf der Startseite mit E-Mail und Passwort.'
                : 'Stachel unter ${Uri.parse(base).host} hat eigene Konten statt der Anmeldung einer Organisation. '
                      'Melde dich dort im Browser an.',
          ),
        );
        return;
      }
      setState(() {
        _base = base;
        _info = info;
      });
    } on StachelException catch (e) {
      if (mounted) {
        setState(
          () => _error = StachelException(
            e.code,
            e.code == 'network'
                ? 'Unter ${Uri.parse(base).host} ist gerade kein Stachel erreichbar. Prüf die Adresse und dein Internet.'
                : 'Unter ${Uri.parse(base).host} läuft kein Stachel. Prüf die Adresse.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  void _change() => setState(() {
    _attempt++;
    _waiting = false;
    _base = null;
    _info = null;
    _error = null;
  });

  // ---- logging in --------------------------------------------------------------------------------------------------

  Future<void> _done(AppLogin login) async {
    await widget.session.signedIn(_base!, 'org', login, org: _info?.orgName);
    if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
  }

  Future<void> _withApp() async {
    final attempt = ++_attempt;
    setState(() {
      _waiting = true;
      _error = null;
    });
    try {
      final pairing = await _api.startPairing();
      if (!await widget.launcher(pairing.url)) throw StachelException.forCode('no_browser');
      // the organisation's app confirms; each wait is a long poll (server ~25 s) – again until confirmed, expired or
      // left
      while (mounted && attempt == _attempt) {
        final login = await _api.waitPairing(pairing);
        if (attempt != _attempt) return;
        if (login != null) {
          await _done(login);
          return;
        }
      }
    } on StachelException catch (e) {
      if (!mounted || attempt != _attempt) return;
      setState(
        () => _error = e.code == 'expired'
            ? const StachelException('expired', 'Die Anmeldung ist abgelaufen. Bitte noch einmal tippen.')
            : e,
      );
    } finally {
      if (mounted && attempt == _attempt) setState(() => _waiting = false);
    }
  }

  void _cancelWait() => setState(() {
    _attempt++;
    _waiting = false;
  });

  Future<void> _withPassword() async {
    if (_user.text.trim().isEmpty || _password.text.isEmpty) {
      setState(() => _error = const StachelException('invalid_input', 'Bitte Benutzername und Passwort eingeben.'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _done(await _api.orgLogin(_user.text, _password.text));
    } on StachelException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ---- UI ----------------------------------------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final info = _info;
    return info == null ? _chooser() : _login(info);
  }

  Widget _chooser() => AuthPage(
    title: 'Bei einer Organisation anmelden',
    text:
        'Deine Organisation – Verein, Firma, Veranstaltung – betreibt Stachel und meldet dich mit ihrem eigenen Login an? '
        'Dann gib hier die Adresse ihres Stachel an.',
    children: [
      if (_error != null) Notice(_error!.message, kind: NoticeKind.error, key: const Key('orgError')),
      if (_known.isNotEmpty) ...[
        Text('ZULETZT BENUTZT', style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 6),
        for (final b in _known)
          Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              key: Key('orgInstance-${Uri.parse(b).host}'),
              leading: const Icon(Icons.dns_outlined),
              title: Text(Uri.parse(b).host),
              trailing: const Icon(Icons.chevron_right),
              enabled: !_checking,
              onTap: () => _choose(b),
            ),
          ),
        const SizedBox(height: 16),
      ],
      AuthField(
        key: const Key('orgAddress'),
        controller: _address,
        label: 'Adresse',
        helper: 'z. B. board.example.org',
        url: true,
        action: TextInputAction.go,
        onSubmitted: _checking ? null : _choose,
      ),
      BusyButton(key: const Key('orgNext'), label: 'WEITER', busy: _checking, onPressed: () => _choose(_address.text)),
    ],
  );

  Widget _login(InstanceInfo info) {
    final t = Theme.of(context).textTheme;
    final host = Uri.parse(_base!).host;
    final app = info.orgAppLabel;
    return AuthPage(
      title: info.orgName == null ? 'Bei deiner Organisation anmelden' : 'Mit ${info.orgName} anmelden',
      text: 'Stachel unter $host mit deiner Anmeldung bei ${info.orgLabel}.',
      children: [
        if (_error != null) Notice(_error!.message, kind: NoticeKind.error, key: const Key('orgError')),
        if (_waiting)
          Notice(
            'Bestätige die Anmeldung in der $app („Im Browser bei Stachel anmelden?“ → ANMELDEN) und komm dann '
            'hierher zurück.',
            key: const Key('orgWaiting'),
            action: TextButton(onPressed: _cancelWait, child: const Text('ABBRECHEN')),
          ),
        FilledButton.icon(
          key: const Key('orgWithApp'),
          onPressed: _waiting ? null : _withApp,
          icon: _waiting
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.phone_android),
          label: Text('MIT DER ${app.toUpperCase()} BESTÄTIGEN'),
        ),
        const SizedBox(height: 8),
        Text(
          'Die $app muss auf diesem Handy installiert und angemeldet sein.',
          textAlign: TextAlign.center,
          style: TextStyle(color: StachelTheme.muted, fontSize: 13),
        ),
        if (info.orgPasswordLogin) ...[
          const SizedBox(height: 32),
          Text('ODER MIT BENUTZERNAME', style: t.titleLarge),
          const SizedBox(height: 4),
          Text('Die Anmeldung von ${info.orgLabel}, wie im Web.', style: TextStyle(color: StachelTheme.muted)),
          const SizedBox(height: 14),
          AutofillGroup(
            child: Column(
              children: [
                AuthField(
                  key: const Key('orgUser'),
                  controller: _user,
                  label: 'Benutzername',
                  autofill: const [AutofillHints.username],
                ),
                AuthField(
                  key: const Key('orgPassword'),
                  controller: _password,
                  label: 'Passwort',
                  password: true,
                  autofill: const [AutofillHints.password],
                  action: TextInputAction.done,
                  onSubmitted: (_) => _withPassword(),
                ),
              ],
            ),
          ),
          BusyButton(
            key: const Key('orgSubmit'),
            label: 'ANMELDEN',
            busy: _busy,
            outlined: true,
            onPressed: _withPassword,
          ),
        ],
        const SizedBox(height: 16),
        TextButton(key: const Key('orgChange'), onPressed: _change, child: Text('Andere Adresse als $host')),
      ],
    );
  }
}
