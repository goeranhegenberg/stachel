import 'dart:async';

import 'package:flutter/material.dart';
import 'package:stachel_client/stachel_client.dart';

import '../app_session.dart';
import '../auth_api.dart';
import '../config.dart';
import '../theme.dart';
import 'login_screen.dart';
import 'widgets.dart';

/// „Konto“: who is logged in where; own accounts can change the name and password and delete the account (Play Store
/// rule: deleting the account inside the app); logged in through an organisation (mode org), the person can delete what
/// Stachel keeps about them (the account at the organisation stays). Logout for everyone.
class AccountScreen extends StatefulWidget {
  const AccountScreen({
    super.key,
    required this.session,
    this.launcher = launchExternal,
    this.sharer = const StachelSharer(),
  });
  final AppSession session;
  final ExternalLauncher launcher;

  /// Hands the data export (ZIP) to the system share sheet (tests replace it).
  final StachelSharer sharer;

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  AccountInfo? _info;
  InstanceInfo? _instance;
  StachelException? _error;
  bool _exporting = false;

  /// The account (also while the page closes after logging out).
  late final StachelAccount _initial;
  StachelAccount get _account => widget.session.account ?? _initial;
  AuthApi get _api => widget.session.api(_account.base);

  /// Mode org: the organisation's name (from the instance, else from the login).
  String? get _org => _instance?.orgName ?? _account.org;

  @override
  void initState() {
    super.initState();
    _initial = widget.session.account!;
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final i = await _api.instance();
      if (mounted) setState(() => _instance = i);
    } catch (_) {}
    if (!_account.local) return;
    try {
      final token = await widget.session.token();
      if (token == null) return;
      final info = await _api.account(token);
      if (mounted) setState(() => _info = info);
    } on StachelException catch (e) {
      if (!mounted) return;
      if (e.needsLogin) return _lost(e);
      setState(() => _error = e);
    }
  }

  void _lost(StachelException e) {
    unawaited(widget.session.signOut(notice: e.message));
    Navigator.of(context).popUntil((r) => r.isFirst);
  }

  void _snack(String text) => skShowMsg(context, text);

  Future<void> _run(Future<void> Function(String token) action, String done) async {
    try {
      final token = await widget.session.token();
      if (token == null) return;
      await action(token);
      if (mounted) _snack(done);
    } on StachelException catch (e) {
      if (!mounted) return;
      if (e.needsLogin) return _lost(e);
      _snack(e.message);
    }
  }

  Future<void> _rename() async {
    final name = await _ask('Name ändern', [
      _Field('Dein Name', initial: _account.name),
    ], action: 'SPEICHERN').then((v) => v?.first.trim());
    if (name == null || name.isEmpty || name == _account.name) return;
    await _run((t) async {
      await _api.rename(t, name);
      await widget.session.renamed(name);
      if (mounted) setState(() {});
    }, 'Name geändert.');
  }

  Future<void> _password() async {
    final v = await _ask('Passwort ändern', [
      const _Field('Bisheriges Passwort', password: true),
      const _Field('Neues Passwort (mind. 10 Zeichen)', password: true),
    ], action: 'ÄNDERN');
    if (v == null) return;
    await _run((t) => _api.changePassword(t, v[0], v[1]), 'Passwort geändert. Andere Geräte sind jetzt abgemeldet.');
  }

  Future<void> _delete() async {
    final res = await showDialog<(String, Map<String, String>)>(
      context: context,
      builder: (_) => _DeleteDialog(boards: _info?.boards ?? const []),
    );
    if (res == null || !mounted) return;
    try {
      final token = await widget.session.token();
      if (token == null) return;
      await _api.deleteAccount(token, res.$1, res.$2);
      if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
      await widget.session.signOut(notice: 'Dein Konto wurde gelöscht.');
    } on StachelException catch (e) {
      if (mounted) _snack(e.message);
    }
  }

  /// „Meine Daten herunterladen“ (Art. 20 DSGVO, legal CR-8): the server's ZIP to the share sheet (save to files,
  /// send to the computer …).
  Future<void> _export() async {
    if (_exporting) return;
    setState(() => _exporting = true);
    try {
      final token = await widget.session.token();
      if (token == null) return;
      final zip = await _api.exportData(token);
      await widget.sharer.shareFile(zip.bytes, zip.fileName, 'application/zip');
    } on StachelException catch (e) {
      if (!mounted) return;
      if (e.needsLogin) return _lost(e);
      _snack(e.message);
    } catch (_) {
      if (mounted) _snack('Die Datei ließ sich nicht weitergeben. Bitte versuche es noch einmal.');
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  /// Mode org: „Meine Daten bei Stachel löschen“.
  Future<void> _deleteStachelData() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => _ForgetDialog(org: _org),
    );
    if (ok != true || !mounted) return;
    try {
      final token = await widget.session.token();
      if (token == null) return;
      await _api.deleteStachelData(token);
      if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
      await widget.session.signOut(notice: 'Deine Daten bei Stachel wurden gelöscht.');
    } on StachelException catch (e) {
      if (mounted) _snack(e.message);
    }
  }

  Future<void> _logout() async {
    Navigator.of(context).popUntil((r) => r.isFirst);
    await widget.session.signOut();
  }

  Future<List<String>?> _ask(String title, List<_Field> fields, {required String action}) => showDialog<List<String>>(
    context: context,
    builder: (_) => _AskDialog(title: title, fields: fields, action: action),
  );

  @override
  Widget build(BuildContext context) {
    final a = _account;
    final instance = _instance;
    final host = Uri.parse(a.base).host;
    final org = _org;
    return Scaffold(
      appBar: skAppBar('Konto'),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: [
          ListTile(
            leading: const Icon(Icons.person_outline),
            title: Text(a.name.isEmpty ? 'Ohne Namen' : a.name, key: const Key('accountName')),
            subtitle: Text(
              a.local ? (_info?.email ?? a.email ?? '') : 'Angemeldet über ${org ?? 'deine Organisation'}',
            ),
          ),
          ListTile(leading: const Icon(Icons.dns_outlined), title: Text(host), subtitle: const Text('Stachel-Server')),
          if (_error != null) Padding(padding: const EdgeInsets.all(16), child: Notice(_error!.message)),
          const Divider(),
          if (a.local) ...[
            ListTile(
              key: const Key('accountRename'),
              leading: const Icon(Icons.edit_outlined),
              title: const Text('Name ändern'),
              onTap: _rename,
            ),
            ListTile(
              key: const Key('accountPassword'),
              leading: const Icon(Icons.password),
              title: const Text('Passwort ändern'),
              onTap: _password,
            ),
          ],
          if (a.local)
            ListTile(
              key: const Key('accountExport'),
              leading: _exporting
                  ? const SizedBox.square(dimension: 24, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.download_outlined),
              title: const Text('Meine Daten herunterladen'),
              subtitle: const Text(
                'Lädt eine ZIP-Datei mit deinen Kontodaten und deinen eigenen Boards (JSON) samt hochgeladenen Dateien.',
              ),
              onTap: _exporting ? null : _export,
            ),
          // Melden und Blockieren (CR-3): wen ich blockiert habe, wieder aufheben
          ListTile(
            key: const Key('accountBlocked'),
            leading: const Icon(Icons.block),
            title: const Text('Blockierte Personen'),
            onTap: () => showStachelBlockedPeople(
              context,
              StachelModerationApi(HttpStachelBoardsApi(StachelAppClient(widget.session, _account))),
            ),
          ),
          ListTile(
            key: const Key('accountLogout'),
            leading: const Icon(Icons.logout),
            title: const Text('Abmelden'),
            onTap: _logout,
          ),
          if (a.local)
            ListTile(
              key: const Key('accountDelete'),
              leading: Icon(Icons.delete_forever_outlined, color: StachelTheme.danger),
              title: Text('Konto löschen', style: TextStyle(color: StachelTheme.danger)),
              onTap: _delete,
            )
          else
            ListTile(
              key: const Key('accountForget'),
              leading: Icon(Icons.delete_forever_outlined, color: StachelTheme.danger),
              title: Text('Meine Daten bei Stachel löschen', style: TextStyle(color: StachelTheme.danger)),
              subtitle: Text('Dein Konto bei ${org ?? 'deiner Organisation'} bleibt bestehen.'),
              onTap: _deleteStachelData,
            ),
          const Divider(),
          LegalLinks(
            privacyUrl: instance?.privacyUrl ?? stachelPrivacyFallback,
            imprintUrl: instance?.imprintUrl ?? stachelImprintFallback,
            termsUrl: instance?.termsUrl,
            deletionUrl: '${stachelTrimBase(a.base)}/konto-loeschen',
            launcher: widget.launcher,
          ),
          Center(
            child: Text('Stachel-App ${StachelConfig.appVersion}', style: TextStyle(color: StachelTheme.muted)),
          ),
        ],
      ),
    );
  }
}

class _Field {
  const _Field(this.label, {this.password = false, this.initial});
  final String label;
  final bool password;
  final String? initial;
}

/// A dialog with text fields; pops their values (controllers live as long as the dialog).
class _AskDialog extends StatefulWidget {
  const _AskDialog({required this.title, required this.fields, required this.action});
  final String title;
  final List<_Field> fields;
  final String action;

  @override
  State<_AskDialog> createState() => _AskDialogState();
}

class _AskDialogState extends State<_AskDialog> {
  late final _cs = [for (final f in widget.fields) TextEditingController(text: f.initial)];

  @override
  void dispose() {
    for (final c in _cs) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.title),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < widget.fields.length; i++)
          TextField(
            key: Key('accountField$i'),
            controller: _cs[i],
            obscureText: widget.fields[i].password,
            autofocus: i == 0,
            decoration: InputDecoration(labelText: widget.fields[i].label),
          ),
      ],
    ),
    actions: [
      TextButton(onPressed: () => Navigator.pop(context), child: const Text('ABBRECHEN')),
      FilledButton(
        key: const Key('accountFieldOk'),
        onPressed: () => Navigator.pop(context, [for (final c in _cs) c.text]),
        child: Text(widget.action),
      ),
    ],
  );
}

/// „Konto löschen?“: per own board delete or hand over, the password; pops (password, board choices).
class _DeleteDialog extends StatefulWidget {
  const _DeleteDialog({required this.boards});
  final List<OwnedBoard> boards;

  @override
  State<_DeleteDialog> createState() => _DeleteDialogState();
}

class _DeleteDialogState extends State<_DeleteDialog> {
  final _password = TextEditingController();
  late final _choice = <String, String>{for (final b in widget.boards) b.id: 'delete'};

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Konto löschen?'),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Dein Konto und deine Anmeldung werden endgültig gelöscht. Boards, die dir gehören, werden gelöscht '
            'oder an eine Person mit Zugriff übergeben.',
          ),
          for (final b in widget.boards) ...[
            const SizedBox(height: 12),
            Text(b.title.isEmpty ? 'Ohne Titel' : b.title, style: const TextStyle(fontWeight: FontWeight.w600)),
            DropdownButton<String>(
              key: Key('deleteBoard-${b.id}'),
              isExpanded: true,
              value: _choice[b.id],
              items: [
                const DropdownMenuItem(value: 'delete', child: Text('Löschen')),
                for (final p in b.people) DropdownMenuItem(value: p.key, child: Text('An ${p.name} übergeben')),
              ],
              onChanged: (v) => setState(() => _choice[b.id] = v ?? 'delete'),
            ),
          ],
          const SizedBox(height: 12),
          TextField(
            key: const Key('deletePassword'),
            controller: _password,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'Zur Sicherheit: dein Passwort'),
          ),
        ],
      ),
    ),
    actions: [
      TextButton(onPressed: () => Navigator.pop(context), child: const Text('ABBRECHEN')),
      FilledButton(
        key: const Key('deleteConfirm'),
        style: FilledButton.styleFrom(backgroundColor: StachelTheme.danger),
        onPressed: () => Navigator.pop(context, (_password.text, Map.of(_choice))),
        child: const Text('ENDGÜLTIG LÖSCHEN'),
      ),
    ],
  );
}

/// „Meine Daten bei Stachel löschen?“ (mode org): what goes, what stays; pops true to delete.
class _ForgetDialog extends StatelessWidget {
  const _ForgetDialog({this.org});

  /// The organisation's name; null = „deiner Organisation“.
  final String? org;

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Meine Daten bei Stachel löschen?'),
    content: SingleChildScrollView(
      child: Text(
        'Stachel löscht, was es über dich speichert: deine Anmeldungen (auch hier in der App), KI-Zugänge, Favoriten, '
        '„Zuletzt geöffnet“ und Hinweise auf Erwähnungen. In Kommentaren, Reaktionen und Abstimmungen auf den Boards '
        'steht statt deines Namens dann „Gelöschtes Konto“.\n\n'
        'Die Boards selbst gehören dem Team und bleiben. Dein Konto bei ${org ?? 'deiner Organisation'} bleibt '
        'bestehen – das verwaltet ${org ?? 'deine Organisation'}. Meldest du dich später wieder an, legt Stachel neue '
        'Daten an.',
      ),
    ),
    actions: [
      TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('ABBRECHEN')),
      FilledButton(
        key: const Key('forgetConfirm'),
        style: FilledButton.styleFrom(backgroundColor: StachelTheme.danger),
        onPressed: () => Navigator.pop(context, true),
        child: const Text('DATEN LÖSCHEN'),
      ),
    ],
  );
}
