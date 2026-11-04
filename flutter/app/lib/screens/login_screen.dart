import 'dart:async';

import 'package:flutter/material.dart';
import 'package:stachel_client/stachel_client.dart';

import '../app_session.dart';
import '../auth_api.dart';
import '../captcha.dart';
import '../config.dart';
import '../links.dart';
import '../theme.dart';
import 'org_login_screen.dart';
import 'widgets.dart';

/// Start page without a login (concept §3): own Stachel account (e-mail + password, „Konto anlegen“, „Passwort
/// vergessen“, link from the mail) on [base], or „Bei einer Organisation anmelden“ (instances in mode org).
class LoginScreen extends StatefulWidget {
  const LoginScreen({
    super.key,
    required this.session,
    this.base = StachelConfig.accountsBase,
    this.orgInstances = const [],
    this.email,
    this.ok,
    this.launcher = launchExternal,
  });

  final AppSession session;
  final String base;

  /// Known instances in mode org for „Bei einer Organisation anmelden“.
  final List<String> orgInstances;

  /// Prefilled address (after confirming / resetting).
  final String? email;

  /// Green hint at the start („E-Mail bestätigt – melde dich jetzt an.“).
  final String? ok;
  final ExternalLauncher launcher;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  late final _email = TextEditingController(text: widget.email ?? '');
  final _password = TextEditingController();
  bool _busy = false;
  StachelException? _error;
  late String? _ok = widget.ok;
  InstanceInfo? _instance;

  AuthApi get _api => widget.session.api(widget.base);

  @override
  void initState() {
    super.initState();
    unawaited(_loadInstance());
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _loadInstance() async {
    try {
      final i = await _api.instance();
      if (mounted) setState(() => _instance = i);
    } catch (_) {}
  }

  Future<void> _login() async {
    final email = _email.text.trim(), password = _password.text;
    if (email.isEmpty || password.isEmpty) {
      setState(() => _error = const StachelException('invalid_input', 'Bitte E-Mail-Adresse und Passwort eingeben.'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _ok = null;
    });
    try {
      final login = await _api.login(email, password);
      await widget.session.signedIn(widget.base, 'local', login, email: email);
    } on StachelException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resend() async {
    try {
      await _api.resend(_email.text);
      if (mounted) {
        setState(() {
          _error = null;
          _ok = 'Wir haben dir die Bestätigungsmail nochmal geschickt.';
        });
      }
    } on StachelException catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _push(Widget page) async {
    final email = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => page));
    if (email != null && mounted) {
      setState(() {
        _email.text = email;
        _ok = 'Fertig – melde dich jetzt an.';
        _error = null;
      });
    }
  }

  Future<void> _pasteLink() async {
    final text = await showDialog<String>(context: context, builder: (_) => const _PasteLinkDialog());
    if (text == null || !mounted) return;
    final link = appLinkFromText(text, widget.base);
    switch (link) {
      case VerifyAppLink(:final token):
        await _push(VerifyScreen(api: _api, token: token));
      case ResetAppLink(:final token):
        await _push(ResetScreen(api: _api, token: token));
      default:
        setState(() => _error = const StachelException('bad_link', 'Das ist kein Link aus einer Stachel-Mail.'));
    }
  }

  @override
  Widget build(BuildContext context) {
    final notice = widget.session.notice;
    final error = _error;
    final instance = _instance;
    return AuthPage(
      appBar: false,
      showLogo: true,
      title: 'Anmelden',
      text: 'Das gemeinsame Whiteboard – Boards, Notizen, Ideen, live mit allen.',
      children: [
        if (notice != null && error == null && _ok == null) Notice(notice),
        if (_ok != null) Notice(_ok!, kind: NoticeKind.ok, key: const Key('loginOk')),
        if (error != null)
          Notice(
            error.message,
            kind: NoticeKind.error,
            key: const Key('loginError'),
            action: error.code == 'not_verified'
                ? TextButton(
                    key: const Key('loginResend'),
                    onPressed: _resend,
                    child: const Text('MAIL NOCHMAL SENDEN'),
                  )
                : null,
          ),
        AutofillGroup(
          child: Column(
            children: [
              AuthField(
                key: const Key('loginEmail'),
                controller: _email,
                label: 'E-Mail-Adresse',
                email: true,
                autofill: const [AutofillHints.email, AutofillHints.username],
              ),
              AuthField(
                key: const Key('loginPassword'),
                controller: _password,
                label: 'Passwort',
                password: true,
                autofill: const [AutofillHints.password],
                action: TextInputAction.done,
                onSubmitted: (_) => _login(),
              ),
            ],
          ),
        ),
        BusyButton(key: const Key('loginSubmit'), label: 'ANMELDEN', busy: _busy, onPressed: _login),
        const SizedBox(height: 4),
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          children: [
            TextButton(
              key: const Key('loginForgot'),
              onPressed: () => _push(ForgotScreen(api: _api, email: _email.text)),
              child: const Text('Passwort vergessen?'),
            ),
            // UX P15 (B18): what the link is for – confirming the address or setting a new password
            TextButton(
              key: const Key('loginPasteLink'),
              onPressed: _pasteLink,
              child: const Text('Bestätigungslink einfügen'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          key: const Key('loginRegister'),
          onPressed: () => _push(
            RegisterScreen(
              api: _api,
              privacyUrl: instance?.privacyUrl,
              termsUrl: instance?.termsUrl,
              launcher: widget.launcher,
              email: _email.text,
            ),
          ),
          child: const Text('KONTO ANLEGEN'),
        ),
        const SizedBox(height: 28),
        const Row(
          children: [
            Expanded(child: Divider()),
            Padding(padding: EdgeInsets.symmetric(horizontal: 12), child: Text('oder')),
            Expanded(child: Divider()),
          ],
        ),
        const SizedBox(height: 20),
        OutlinedButton.icon(
          key: const Key('loginOrg'),
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => OrgLoginScreen(
                session: widget.session,
                instances: widget.orgInstances,
                accountsBase: widget.base,
                launcher: widget.launcher,
              ),
            ),
          ),
          icon: const Icon(Icons.groups_outlined),
          label: const Text('BEI EINER ORGANISATION ANMELDEN'),
        ),
        const SizedBox(height: 6),
        Text(
          'Deine Organisation betreibt Stachel mit eigener Anmeldung.',
          textAlign: TextAlign.center,
          style: TextStyle(color: StachelTheme.muted, fontSize: 13),
        ),
        const SizedBox(height: 28),
        LegalLinks(
          privacyUrl: instance?.privacyUrl ?? stachelPrivacyFallback,
          imprintUrl: instance?.imprintUrl ?? stachelImprintFallback,
          termsUrl: instance?.termsUrl,
          launcher: widget.launcher,
        ),
      ],
    );
  }
}

/// Legal pages of the app's publisher (INTSODE, stachel.intsode.com) when the instance names none or cannot be
/// reached (`GET /api/instance` → `imprintUrl`, `privacyUrl`): the privacy policy of the app itself.
const stachelImprintFallback = 'https://stachel.intsode.com/impressum';
const stachelPrivacyFallback = 'https://stachel.intsode.com/datenschutz';

/// Flutter's license page with the app's name, version and legalese (legal CR-4): Flutter's NOTICES plus what
/// `registerStachelLicenses` and `main` add (fonts, lucide, PDFium).
void showStachelLicenses(BuildContext context) => showLicensePage(
  context: context,
  applicationName: 'Stachel',
  applicationVersion: StachelConfig.appVersion,
  applicationLegalese: '© 2026 Göran Hegenberg (INTSODE) · Apache-2.0',
);

/// „Datenschutz · Impressum · Nutzungsbedingungen (if the instance names them) · Open-Source-Lizenzen“, on the account
/// page also „Daten löschen (Infos)“ – the server's page explaining how to delete the account or the data
/// (`/konto-loeschen`, Play Store's deletion link).
class LegalLinks extends StatelessWidget {
  const LegalLinks({
    super.key,
    required this.privacyUrl,
    required this.imprintUrl,
    this.termsUrl,
    this.deletionUrl,
    this.launcher = launchExternal,
  });
  final String privacyUrl;
  final String imprintUrl;
  final String? termsUrl;
  final String? deletionUrl;
  final ExternalLauncher launcher;

  @override
  Widget build(BuildContext context) => Wrap(
    alignment: WrapAlignment.center,
    children: [
      TextButton(onPressed: () => launcher(Uri.parse(privacyUrl)), child: const Text('Datenschutz')),
      TextButton(onPressed: () => launcher(Uri.parse(imprintUrl)), child: const Text('Impressum')),
      if (termsUrl != null)
        TextButton(
          key: const Key('legalTerms'),
          onPressed: () => launcher(Uri.parse(termsUrl!)),
          child: const Text('Nutzungsbedingungen'),
        ),
      if (deletionUrl != null)
        TextButton(
          key: const Key('legalDeletion'),
          onPressed: () => launcher(Uri.parse(deletionUrl!)),
          child: const Text('Daten löschen (Infos)'),
        ),
      TextButton(
        key: const Key('legalLicenses'),
        onPressed: () => showStachelLicenses(context),
        child: const Text('Open-Source-Lizenzen'),
      ),
    ],
  );
}

class _PasteLinkDialog extends StatefulWidget {
  const _PasteLinkDialog();
  @override
  State<_PasteLinkDialog> createState() => _PasteLinkDialogState();
}

class _PasteLinkDialogState extends State<_PasteLinkDialog> {
  final _c = TextEditingController();
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Bestätigungslink einfügen'),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Kopiere den Link aus der Bestätigungs- oder Passwort-Mail und füge ihn hier ein.'),
        const SizedBox(height: 12),
        TextField(
          key: const Key('pasteLinkField'),
          controller: _c,
          autofocus: true,
          minLines: 1,
          maxLines: 3,
          decoration: const InputDecoration(hintText: 'https://…'),
        ),
      ],
    ),
    actions: [
      TextButton(onPressed: () => Navigator.pop(context), child: const Text('ABBRECHEN')),
      FilledButton(
        key: const Key('pasteLinkOk'),
        onPressed: () => Navigator.pop(context, _c.text),
        child: const Text('WEITER'),
      ),
    ],
  );
}

/// „Konto anlegen“: name, address, password, „Ich akzeptiere die Nutzungsbedingungen und bin mindestens 18 Jahre alt.“
/// (the privacy policy only as information, no consent – legal CR-1); the captcha is solved natively on submit. Afterwards:
/// „Schau in dein Postfach“ (the mail's link opens the app). Pops the address once confirmed via a pasted link.
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({
    super.key,
    required this.api,
    this.privacyUrl,
    this.termsUrl,
    this.launcher = launchExternal,
    this.email,
  });
  final AuthApi api;
  final String? privacyUrl;

  /// Terms of use of the instance; null = checkbox text without a link.
  final String? termsUrl;
  final ExternalLauncher launcher;
  final String? email;

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _name = TextEditingController();
  late final _email = TextEditingController(text: widget.email ?? '');
  final _password = TextEditingController();
  bool _terms = false;
  bool _busy = false;
  String? _step;
  StachelException? _error;
  String? _sentTo;
  String? _ok;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _name.text.trim(), email = _email.text.trim(), password = _password.text;
    String? problem;
    if (name.isEmpty) {
      problem = 'Bitte gib deinen Namen an.';
    } else if (!email.contains('@')) {
      problem = 'Bitte gib eine gültige E-Mail-Adresse an.';
    } else if (password.length < 10) {
      problem = 'Das Passwort braucht mindestens 10 Zeichen.';
    } else if (!_terms) {
      problem = 'Bitte akzeptiere die Nutzungsbedingungen und bestätige, dass du mindestens 18 Jahre alt bist.';
    }
    if (problem != null) {
      setState(() => _error = StachelException('invalid_input', problem!));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _step = 'Sicherheitsprüfung läuft …';
    });
    try {
      final c = await widget.api.captcha();
      final payload = await solveCaptcha(c);
      if (payload == null) {
        throw StachelException.forCode('captcha_invalid', 'Die Sicherheitsprüfung ist fehlgeschlagen.');
      }
      if (mounted) setState(() => _step = 'Konto wird angelegt …');
      await widget.api.register(name: name, email: email, password: password, captcha: payload);
      if (mounted) setState(() => _sentTo = email);
    } on StachelException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _step = null;
        });
      }
    }
  }

  Future<void> _resend() async {
    try {
      await widget.api.resend(_sentTo!);
      if (mounted) setState(() => _ok = 'Wir haben die Mail nochmal geschickt.');
    } on StachelException catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sent = _sentTo;
    if (sent != null) {
      return AuthPage(
        title: 'Fast geschafft',
        text:
            'Wir haben dir eine Mail an $sent geschickt. Tippe auf den Link darin – die Stachel-App öffnet sich dann '
            'von selbst und bestätigt dein Konto. Der Link gilt 24 Stunden.',
        children: [
          if (_ok != null) Notice(_ok!, kind: NoticeKind.ok),
          if (_error != null) Notice(_error!.message, kind: NoticeKind.error),
          OutlinedButton(
            key: const Key('registerResend'),
            onPressed: _resend,
            child: const Text('MAIL NOCHMAL SENDEN'),
          ),
          const SizedBox(height: 12),
          FilledButton(
            key: const Key('registerDone'),
            onPressed: () => Navigator.of(context).pop(sent),
            child: const Text('ZUR ANMELDUNG'),
          ),
        ],
      );
    }
    return AuthPage(
      title: 'Konto anlegen',
      text: 'Mit einem Konto legst du eigene Boards an und teilst sie mit anderen.',
      children: [
        if (_error != null) Notice(_error!.message, kind: NoticeKind.error, key: const Key('registerError')),
        AutofillGroup(
          child: Column(
            children: [
              AuthField(
                key: const Key('registerName'),
                controller: _name,
                label: 'Dein Name',
                autofill: const [AutofillHints.name],
              ),
              AuthField(
                key: const Key('registerEmail'),
                controller: _email,
                label: 'E-Mail-Adresse',
                email: true,
                autofill: const [AutofillHints.email],
              ),
              AuthField(
                key: const Key('registerPassword'),
                controller: _password,
                label: 'Passwort',
                password: true,
                helper: 'Mindestens 10 Zeichen.',
                autofill: const [AutofillHints.newPassword],
                action: TextInputAction.done,
              ),
            ],
          ),
        ),
        CheckboxListTile(
          key: const Key('registerTerms'),
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          value: _terms,
          onChanged: (v) => setState(() => _terms = v ?? false),
          title: const Text('Ich akzeptiere die Nutzungsbedingungen und bin mindestens 18 Jahre alt.'),
          subtitle: widget.termsUrl == null
              ? null
              : Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    key: const Key('registerTermsLink'),
                    style: TextButton.styleFrom(padding: EdgeInsets.zero),
                    onPressed: () => widget.launcher(Uri.parse(widget.termsUrl!)),
                    child: const Text('Nutzungsbedingungen lesen'),
                  ),
                ),
        ),
        // privacy policy: information only, no checkbox (Art. 13 DSGVO; consent is not the legal basis)
        Text(
          'Informationen zum Datenschutz findest du in der Datenschutzerklärung.',
          key: const Key('registerPrivacyInfo'),
          style: TextStyle(color: StachelTheme.muted, fontSize: 13),
        ),
        if (widget.privacyUrl != null)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              key: const Key('registerPrivacyLink'),
              style: TextButton.styleFrom(padding: EdgeInsets.zero),
              onPressed: () => widget.launcher(Uri.parse(widget.privacyUrl!)),
              child: const Text('Datenschutzerklärung lesen'),
            ),
          ),
        const SizedBox(height: 8),
        BusyButton(key: const Key('registerSubmit'), label: 'KONTO ANLEGEN', busy: _busy, onPressed: _submit),
        if (_step != null)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Text(_step!, textAlign: TextAlign.center, key: const Key('registerStep')),
          ),
      ],
    );
  }
}

/// „Passwort vergessen“: the server sends a link (the same answer whether the account exists or not).
class ForgotScreen extends StatefulWidget {
  const ForgotScreen({super.key, required this.api, this.email});
  final AuthApi api;
  final String? email;
  @override
  State<ForgotScreen> createState() => _ForgotScreenState();
}

class _ForgotScreenState extends State<ForgotScreen> {
  late final _email = TextEditingController(text: widget.email ?? '');
  bool _busy = false;
  bool _sent = false;
  StachelException? _error;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.forgot(_email.text);
      if (mounted) setState(() => _sent = true);
    } on StachelException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AuthPage(
    title: 'Passwort vergessen',
    text: 'Wir schicken dir einen Link, mit dem du ein neues Passwort setzt. Er öffnet die Stachel-App.',
    children: [
      if (_sent)
        Notice(
          'Wenn es zu ${_email.text.trim()} ein Konto gibt, kommt gleich eine Mail. Der Link gilt eine Stunde.',
          kind: NoticeKind.ok,
          key: const Key('forgotSent'),
        ),
      if (_error != null) Notice(_error!.message, kind: NoticeKind.error),
      AuthField(
        key: const Key('forgotEmail'),
        controller: _email,
        label: 'E-Mail-Adresse',
        email: true,
        autofill: const [AutofillHints.email],
        action: TextInputAction.done,
        onSubmitted: (_) => _send(),
      ),
      BusyButton(key: const Key('forgotSubmit'), label: 'LINK SCHICKEN', busy: _busy, onPressed: _send),
    ],
  );
}

/// New password from the mail link (`/reset/<token>`). Pops the address when done.
class ResetScreen extends StatefulWidget {
  const ResetScreen({super.key, required this.api, required this.token});
  final AuthApi api;
  final String token;
  @override
  State<ResetScreen> createState() => _ResetScreenState();
}

class _ResetScreenState extends State<ResetScreen> {
  final _password = TextEditingController();
  final _repeat = TextEditingController();
  bool _busy = false;
  StachelException? _error;

  @override
  void dispose() {
    _password.dispose();
    _repeat.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_password.text != _repeat.text) {
      setState(() => _error = const StachelException('mismatch', 'Die beiden Passwörter sind nicht gleich.'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final email = await widget.api.reset(widget.token, _password.text);
      if (mounted) Navigator.of(context).pop(email ?? '');
    } on StachelException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AuthPage(
    title: 'Neues Passwort',
    text: 'Danach meldest du dich mit dem neuen Passwort an. Angemeldete Geräte werden abgemeldet.',
    children: [
      if (_error != null) Notice(_error!.message, kind: NoticeKind.error, key: const Key('resetError')),
      AuthField(
        key: const Key('resetPassword'),
        controller: _password,
        label: 'Neues Passwort',
        password: true,
        helper: 'Mindestens 10 Zeichen.',
        autofill: const [AutofillHints.newPassword],
      ),
      AuthField(
        key: const Key('resetRepeat'),
        controller: _repeat,
        label: 'Noch einmal',
        password: true,
        action: TextInputAction.done,
        onSubmitted: (_) => _save(),
      ),
      BusyButton(key: const Key('resetSubmit'), label: 'PASSWORT SPEICHERN', busy: _busy, onPressed: _save),
    ],
  );
}

/// Confirms the address from the mail link (`/verify/<token>`) right away. Pops the address („jetzt anmelden“).
class VerifyScreen extends StatefulWidget {
  const VerifyScreen({super.key, required this.api, required this.token});
  final AuthApi api;
  final String token;
  @override
  State<VerifyScreen> createState() => _VerifyScreenState();
}

class _VerifyScreenState extends State<VerifyScreen> {
  StachelException? _error;
  String? _email;

  @override
  void initState() {
    super.initState();
    unawaited(_verify());
  }

  Future<void> _verify() async {
    try {
      final email = await widget.api.verify(widget.token);
      if (mounted) setState(() => _email = email ?? '');
    } on StachelException catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final error = _error, email = _email;
    return AuthPage(
      title: error != null ? 'Link gilt nicht mehr' : (email == null ? 'Einen Moment …' : 'E-Mail bestätigt'),
      children: [
        if (error != null) Notice(error.message, kind: NoticeKind.error, key: const Key('verifyError')),
        if (email != null)
          Notice(
            'Dein Konto${email.isEmpty ? '' : ' ($email)'} ist bestätigt. Melde dich jetzt an.',
            kind: NoticeKind.ok,
            key: const Key('verifyOk'),
          ),
        if (error == null && email == null) const Center(child: CircularProgressIndicator()),
        if (error != null || email != null)
          FilledButton(
            key: const Key('verifyDone'),
            onPressed: () => Navigator.of(context).pop(email),
            child: const Text('ZUR ANMELDUNG'),
          ),
      ],
    );
  }
}
