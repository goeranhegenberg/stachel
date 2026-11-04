import 'dart:async';

import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../versions/admin_host.dart';
import 'mcp_config.dart';

/// Id of the sheet „KI-Zugang (MCP)“.
const mcpSheet = 'mcp.tokens';

/// Shown above „TOKEN ANLEGEN“ (same text as the web's `McpAccess.tsx`).
const mcpPrivacyNote =
    'Bitte beachten: Ein verbundener KI-Assistent sieht alle Boards, auf die du Zugriff hast – auch Namen und '
    'Kommentare anderer. Diese Daten gehen an den Anbieter des Assistenten. Tokens, die 12 Monate nicht benutzt '
    'werden, verfallen automatisch.';

/// „KI-Zugang (MCP)“ like the web (`features/mcp/McpAccess.tsx`, audit B13): personal tokens for AI assistants –
/// create one (label), show it once with the ready setup (Claude Code / Claude Desktop / other clients), list with
/// „zuletzt benutzt“, revoke with a question. Phone: „TEILEN“ hands token and setup to the system share sheet (e.g.
/// to the laptop), „KOPIEREN“ stays.
class McpSheet extends StatefulWidget {
  const McpSheet({super.key, required this.ui, required this.host});
  final BoardUi ui;
  final BoardAdminHost host;

  @override
  State<McpSheet> createState() => _McpSheetState();
}

class _McpSheetState extends State<McpSheet> {
  List<McpToken>? _tokens;
  String _mcpUrl = '';
  McpNewToken? _fresh;
  String? _error;
  bool _busy = false;
  String _tab = 'claude-code';
  final _label = TextEditingController();

  BoardAdminHost get _host => widget.host;
  BoardUiTheme get _theme => widget.ui.theme;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _label.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await _host.listTokens();
      if (!mounted) return;
      setState(() {
        _tokens = r.tokens;
        if (r.mcpUrl.isNotEmpty) _mcpUrl = r.mcpUrl;
      });
    } catch (e) {
      if (mounted) setState(() => _error = _host.errorText(e));
    }
  }

  Future<void> _create() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final label = _label.text.trim();
      final r = await _host.createToken(label.isEmpty ? 'KI-Assistent' : label);
      if (!mounted) return;
      setState(() {
        _fresh = r;
        if (r.mcpUrl.isNotEmpty) _mcpUrl = r.mcpUrl;
        _label.clear();
      });
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = _host.errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _revoke(McpToken t) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Token widerrufen?'),
        content: Text(
          '„${t.label}“ funktioniert danach sofort nicht mehr; ein verbundener Assistent verliert den Zugriff.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('ABBRECHEN')),
          FilledButton(
            key: const Key('stachelMcpRevokeConfirm'),
            style: FilledButton.styleFrom(backgroundColor: _theme.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('WIDERRUFEN'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await _host.revokeToken(t.id);
      if (!mounted) return;
      if (_fresh?.token.id == t.id) setState(() => _fresh = null);
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = _host.errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final muted = TextStyle(color: _theme.grey, fontSize: 13.5);
    final tokens = _tokens;
    final fresh = _fresh;
    final setups = fresh == null ? const <McpSetup>[] : mcpSetups(_mcpUrl, fresh.secret);
    final active = setups.where((s) => s.id == _tab).firstOrNull ?? setups.firstOrNull;
    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.9),
      child: SafeArea(
        top: false,
        child: ListView(
          key: const Key('stachelMcpSheet'),
          shrinkWrap: true,
          padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
          children: [
            Text('KI-ZUGANG (MCP)', style: _theme.label(size: 18)),
            const SizedBox(height: 8),
            const Text(
              'Mit einem persönlichen Token kann ein KI-Assistent (z. B. Claude) deine Boards lesen, gestalten und als '
              'Bild ansehen – live für alle sichtbar als „KI (für dich)“. Das Token hat deine Rechte: gib es nicht '
              'weiter.',
            ),
            if (fresh != null && active != null) ...[
              const SizedBox(height: 14),
              Container(
                key: const Key('stachelMcpFresh'),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(border: Border.all(color: _theme.accent, width: 2)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Token „${fresh.token.label}“ ist angelegt', style: _theme.label(size: 15)),
                    const SizedBox(height: 4),
                    Text('Jetzt teilen oder kopieren – es wird nur dieses eine Mal angezeigt.', style: muted),
                    _CodeBlock(
                      code: fresh.secret,
                      keyName: 'stachelMcpSecret',
                      host: _host,
                      subject: 'Stachel-Token „${fresh.token.label}“',
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      children: [
                        for (final s in setups)
                          ChoiceChip(
                            key: Key('stachelMcpTab-${s.id}'),
                            label: Text(s.title),
                            selected: s.id == active.id,
                            onSelected: (_) => setState(() => _tab = s.id),
                          ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(active.hint, style: muted),
                    _CodeBlock(
                      code: active.code,
                      keyName: 'stachelMcpSetup',
                      host: _host,
                      subject: 'Stachel für ${active.title} einrichten',
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 14),
            // legal CR-9 (docs/legal/datenschutz.md §8): data of others goes to the assistant's provider
            Container(
              key: const Key('stachelMcpPrivacyNote'),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(border: Border(left: BorderSide(color: _theme.accent, width: 4))),
              child: const Text(mcpPrivacyNote),
            ),
            const SizedBox(height: 8),
            TextField(
              key: const Key('stachelMcpLabel'),
              controller: _label,
              maxLength: 60,
              decoration: const InputDecoration(labelText: 'Neues Token', hintText: 'z. B. Claude Code am Laptop'),
              onSubmitted: (_) => _busy ? null : _create(),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton(
                key: const Key('stachelMcpCreate'),
                onPressed: _busy ? null : _create,
                child: const Text('TOKEN ANLEGEN'),
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _error!,
                  key: const Key('stachelMcpError'),
                  style: TextStyle(color: _theme.danger),
                ),
              ),
            const SizedBox(height: 16),
            Text('DEINE TOKENS', style: _theme.label(size: 15)),
            const SizedBox(height: 6),
            if (tokens == null)
              Text('Lade …', style: muted)
            else if (tokens.isEmpty)
              Text('Noch keine. Lege oben eins an.', style: muted)
            else
              for (final t in tokens)
                Padding(
                  key: Key('stachelMcpToken-${t.id}'),
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(t.label, style: const TextStyle(fontWeight: FontWeight.w700)),
                            Text(
                              [
                                '…${t.hint}',
                                if (t.createdAt != null) 'angelegt ${shortDate(t.createdAt!)}',
                                agoText(t.lastUsedAt),
                                if (t.expiresAt != null) 'verfällt am ${shortDate(t.expiresAt!)}',
                              ].join(' · '),
                              style: muted,
                            ),
                          ],
                        ),
                      ),
                      TextButton(
                        key: Key('stachelMcpRevoke-${t.id}'),
                        onPressed: _busy ? null : () => _revoke(t),
                        child: Text('WIDERRUFEN', semanticsLabel: 'Token „${t.label}“ widerrufen'),
                      ),
                    ],
                  ),
                ),
          ],
        ),
      ),
    );
  }
}

/// Code with „TEILEN“ (system share sheet) and „KOPIEREN“ (web `CopyBlock`: „Kopiert“ for 2 s).
class _CodeBlock extends StatefulWidget {
  const _CodeBlock({required this.code, required this.keyName, required this.host, required this.subject});
  final String code;
  final String keyName;
  final BoardAdminHost host;
  final String subject;

  @override
  State<_CodeBlock> createState() => _CodeBlockState();
}

class _CodeBlockState extends State<_CodeBlock> {
  bool _copied = false;
  Timer? _reset;

  @override
  void dispose() {
    _reset?.cancel();
    super.dispose();
  }

  Future<void> _copy() async {
    try {
      await widget.host.copyText(widget.code);
      if (!mounted) return;
      setState(() => _copied = true);
      _reset?.cancel();
      _reset = Timer(const Duration(seconds: 2), () {
        if (mounted) setState(() => _copied = false);
      });
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      const SizedBox(height: 6),
      Container(
        padding: const EdgeInsets.all(10),
        color: const Color(0xFFF3F1EC),
        child: SelectableText(
          widget.code,
          key: Key(widget.keyName),
          style: const TextStyle(fontFamily: 'monospace', fontSize: 12.5),
        ),
      ),
      Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          TextButton.icon(
            key: Key('${widget.keyName}Copy'),
            onPressed: _copy,
            icon: const Icon(Icons.copy, size: 18),
            label: Text(_copied ? 'KOPIERT' : 'KOPIEREN'),
          ),
          FilledButton.tonalIcon(
            key: Key('${widget.keyName}Share'),
            onPressed: () => widget.host.shareText(widget.code, subject: widget.subject),
            icon: const Icon(Icons.ios_share, size: 18),
            label: const Text('TEILEN'),
          ),
        ],
      ),
    ],
  );
}
