import 'package:flutter/material.dart';
import 'package:stachel_client/stachel_client.dart';

import '../auth_api.dart';
import '../theme.dart';

/// Changed terms of use (mode `local`, `STACHEL_TERMS_VERSION`): read, tick, accept – or log out. Pops `true` once the
/// server stored the consent, `false` for „Abmelden“. Same texts as the web (`web/src/pages/account/TermsGate.tsx`).
class TermsDialog extends StatefulWidget {
  const TermsDialog({super.key, required this.state, required this.accept, this.launcher = launchExternal});

  final TermsState state;

  /// Stores the consent for the given version (`POST /api/account/terms`).
  final Future<TermsState> Function(String? version) accept;
  final ExternalLauncher launcher;

  @override
  State<TermsDialog> createState() => _TermsDialogState();
}

class _TermsDialogState extends State<TermsDialog> {
  bool _checked = false;
  bool _busy = false;
  String? _error;

  Future<void> _accept() async {
    if (!_checked) return setState(() => _error = 'Bitte setze das Häkchen, um zuzustimmen.');
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.accept(widget.state.version);
      if (mounted) Navigator.of(context).pop(true);
    } on StachelException catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e.message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.state;
    final first = s.acceptedVersion == null;
    return PopScope(
      canPop: false,
      child: AlertDialog(
        key: const Key('termsDialog'),
        title: Text(first ? 'Nutzungsbedingungen' : 'Neue Nutzungsbedingungen'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                first
                    ? 'Für die Nutzung gelten Nutzungsbedingungen. Bitte lies sie und stimme zu, um weiterzuarbeiten.'
                    : 'Wir haben die Nutzungsbedingungen geändert. Bitte lies die neue Fassung und stimme zu, um weiterzuarbeiten.',
              ),
              if (s.url != null)
                TextButton(
                  key: const Key('termsDialogLink'),
                  style: TextButton.styleFrom(padding: EdgeInsets.zero),
                  onPressed: () => widget.launcher(Uri.parse(s.url!)),
                  child: Text('Nutzungsbedingungen lesen${s.version != null ? ' (Fassung ${s.version})' : ''}'),
                ),
              CheckboxListTile(
                key: const Key('termsDialogCheck'),
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                value: _checked,
                onChanged: (v) => setState(() => _checked = v ?? false),
                title: const Text('Ich akzeptiere die Nutzungsbedingungen und bin mindestens 18 Jahre alt.'),
              ),
              Text(
                'Du möchtest nicht zustimmen? Dann melde dich ab; dein Konto kannst du danach auch ohne App löschen.',
                style: TextStyle(color: StachelTheme.muted, fontSize: 13),
              ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Text(
                    _error!,
                    key: const Key('termsDialogError'),
                    style: TextStyle(color: StachelTheme.danger),
                  ),
                ),
            ],
          ),
        ),
        actions: [
          TextButton(
            key: const Key('termsDialogLogout'),
            onPressed: _busy ? null : () => Navigator.of(context).pop(false),
            child: const Text('ABMELDEN'),
          ),
          FilledButton(
            key: const Key('termsDialogAccept'),
            onPressed: _busy ? null : _accept,
            child: Text(_busy ? 'SPEICHERE …' : 'ZUSTIMMEN'),
          ),
        ],
      ),
    );
  }
}
