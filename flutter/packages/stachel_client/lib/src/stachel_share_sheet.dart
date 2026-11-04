import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'stachel_board_admin.dart';
import 'stachel_board_widgets.dart';
import 'stachel_boards_api.dart';
import 'stachel_client_base.dart';
import 'stachel_moderation.dart';
import 'stachel_style.dart';

/// The share link's choices (web `LINK_TEXT`).
const stachelLinkTexts = {
  'edit': 'Jeder mit dem Link (angemeldet) kann bearbeiten',
  'comment': 'Jeder mit dem Link (angemeldet) kann kommentieren',
  'view': 'Jeder mit dem Link (angemeldet) kann ansehen',
};

/// „Teilen“ of a board in instances with own accounts, like the web's `ShareDialog`
/// (`web/src/features/sharing/ShareDialog.tsx`, `docs/features/accounts.md`): invite people by e-mail with a role,
/// change roles and remove people, withdraw open invitations, the share link on/off with its role, copy or share the
/// link, transfer the board (owner only). Who may not manage (`comment`/`view`) sees the people and the link, can copy
/// it and leave the board. [me] is the own user key („(du)“, „Board verlassen“); [onLeft] runs after leaving (the
/// board is gone for this person), [onChanged] when the sheet closed after a change (reload the list).
Future<void> showStachelShareSheet(
  BuildContext context, {
  required StachelSharingApi api,
  required String boardId,
  String? title,
  String? me,
  VoidCallback? onLeft,
  VoidCallback? onChanged,
  StachelSharer sharer = const StachelSharer(),
  void Function(StachelException e)? onLoginLost,
  StachelModerationApi? moderation,
}) async {
  var changed = false;
  var left = false;
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => StachelShareSheet(
      api: api,
      boardId: boardId,
      title: title,
      me: me,
      sharer: sharer,
      moderation: moderation,
      onChanged: () => changed = true,
      onLeft: () => left = true,
      onLoginLost: onLoginLost,
    ),
  );
  if (left) {
    onLeft?.call();
  } else if (changed) {
    onChanged?.call();
  }
}

/// The content of [showStachelShareSheet].
class StachelShareSheet extends StatefulWidget {
  const StachelShareSheet({
    super.key,
    required this.api,
    required this.boardId,
    this.title,
    this.me,
    this.sharer = const StachelSharer(),
    this.onChanged,
    this.onLeft,
    this.onLoginLost,
    this.moderation,
  });

  /// „Person melden …“ / „Person blockieren“ an fremden Personen (Moderation); null = nicht angeboten.
  final StachelModerationApi? moderation;

  final StachelSharingApi api;
  final String boardId;
  final String? title;
  final String? me;
  final StachelSharer sharer;
  final VoidCallback? onChanged;

  /// The person left the board (the sheet closes itself).
  final VoidCallback? onLeft;

  /// The login is gone (session expired): the app's login takes over.
  final void Function(StachelException e)? onLoginLost;

  @override
  State<StachelShareSheet> createState() => _StachelShareSheetState();
}

class _StachelShareSheetState extends State<StachelShareSheet> {
  final _emails = TextEditingController();
  StachelShareInfo? _info;
  String _inviteRole = 'edit';
  String? _error;
  String? _notice;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _emails.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final info = await widget.api.shareInfo(widget.boardId);
      if (mounted) setState(() => _info = info);
    } on StachelException catch (e) {
      _failed(e);
    }
  }

  void _failed(StachelException e) {
    if (!mounted) return;
    if (e.needsLogin && widget.onLoginLost != null) {
      Navigator.of(context).pop();
      widget.onLoginLost!(e);
      return;
    }
    setState(() => _error = e.message);
  }

  /// Runs a change (web `act`): busy, then the new state – or the person left the board (null) and the sheet closes.
  Future<void> _act(Future<StachelShareInfo?> Function() fn, {String? done}) async {
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final info = await fn();
      if (!mounted) return;
      widget.onChanged?.call();
      if (info == null) {
        widget.onLeft?.call();
        Navigator.of(context).pop();
        return;
      }
      setState(() {
        _info = info;
        _notice = done;
      });
    } on StachelException catch (e) {
      _failed(e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _invite() {
    final list = [
      for (final s in _emails.text.split(RegExp(r'[\s,;]+')))
        if (s.trim().isNotEmpty) s.trim(),
    ];
    if (list.isEmpty) {
      setState(() {
        _error = 'Bitte mindestens eine E-Mail-Adresse eingeben.';
        _notice = null;
      });
      return;
    }
    final role = _inviteRole;
    unawaited(
      _act(() async {
        final r = await widget.api.invite(widget.boardId, list, role);
        _emails.clear();
        return r;
      }, done: list.length == 1 ? '${list.first} ist eingeladen.' : '${list.length} Personen sind eingeladen.'),
    );
  }

  void _personChange(StachelSharePerson p, String v) {
    if (v == 'remove') {
      unawaited(
        _act(
          () => widget.api.removeMember(widget.boardId, p.key),
          done: p.key == widget.me ? null : '${p.name} hat keinen Zugriff mehr.',
        ),
      );
    } else if (v == 'owner') {
      unawaited(_confirmTransfer(p));
    } else if (v != p.role) {
      unawaited(_act(() => widget.api.setMemberRole(widget.boardId, p.key, v)));
    }
  }

  Future<void> _confirmTransfer(StachelSharePerson p) async {
    final title = _title;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Board an ${p.name} übertragen?'),
        content: Text(
          '${p.name} wird Besitzer:in von „$title“ und kann es dann auch löschen. Du bleibst mit „Kann bearbeiten“ '
          'dabei.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('ABBRECHEN')),
          FilledButton(
            key: const Key('stachelShareTransferConfirm'),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('ÜBERTRAGEN'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    await _act(() => widget.api.transferOwner(widget.boardId, p.key), done: '${p.name} ist jetzt Besitzer:in.');
  }

  void _inviteChange(StachelShareInvite i, String v) {
    if (v == 'remove') {
      unawaited(_act(() => widget.api.removeInvite(widget.boardId, i.email)));
    } else if (v != i.role) {
      unawaited(_act(() => widget.api.invite(widget.boardId, [i.email], v)));
    }
  }

  Future<void> _copyLink() async {
    final url = _info?.url;
    if (url == null || url.isEmpty) return;
    var ok = true;
    try {
      await Clipboard.setData(ClipboardData(text: url));
    } catch (_) {
      ok = false;
    }
    if (mounted) setState(() => _notice = ok ? 'Link kopiert.' : 'Link: $url');
  }

  Future<void> _shareLink() async {
    final url = _info?.url;
    if (url == null || url.isEmpty) return;
    try {
      await widget.sharer.shareText(url, subject: _title);
    } catch (_) {
      if (mounted) setState(() => _notice = 'Link: $url');
    }
  }

  String get _title => _info?.title ?? widget.title ?? 'Board';

  @override
  Widget build(BuildContext context) {
    final info = _info;
    final error = _error, notice = _notice;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.9),
        child: ListView(
          key: const Key('stachelShareSheet'),
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          children: [
            Text(
              '„$_title“ teilen',
              style: TextStyle(fontFamily: Sk.cond, fontWeight: FontWeight.w700, fontSize: 18),
            ),
            const SizedBox(height: 10),
            if (info != null && info.canManage) ..._inviteForm(),
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  error,
                  key: const Key('stachelShareError'),
                  style: TextStyle(color: Sk.danger, fontWeight: FontWeight.w600),
                ),
              ),
            if (notice != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  notice,
                  key: const Key('stachelShareNotice'),
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
            if (info == null && error == null)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              ),
            if (info != null) ...[
              const SizedBox(height: 14),
              const SkHeading('Personen mit Zugriff'),
              for (final p in info.people) _person(info, p),
              for (final i in info.invites) _invitation(i),
              const SizedBox(height: 14),
              const SkHeading('Freigabelink'),
              const SizedBox(height: 6),
              _linkRow(info),
              const SizedBox(height: 6),
              Text(
                info.link != null
                    ? 'Wer den Link hat und angemeldet ist, kommt rein. Ausschalten sperrt alle wieder aus, die nur '
                          'über den Link dabei sind.'
                    : 'Der Link funktioniert nur für Personen, die oben eingetragen sind.',
                style: TextStyle(color: Sk.grey, fontSize: 13),
              ),
            ],
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton(
                key: const Key('stachelShareDone'),
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('FERTIG'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _inviteForm() => [
    Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: TextField(
            key: const Key('stachelShareEmails'),
            controller: _emails,
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            decoration: const InputDecoration(
              labelText: 'E-Mail-Adressen',
              hintText: 'mit Komma getrennt',
              isDense: true,
            ),
            onSubmitted: (_) => _busy ? null : _invite(),
          ),
        ),
        const SizedBox(width: 8),
        _RoleButton(
          key: const Key('stachelShareInviteRole'),
          label: stachelRoleNames[_inviteRole]!,
          tooltip: 'Rolle für die Einladung',
          enabled: !_busy,
          items: [for (final r in stachelShareRoles) (r, stachelRoleNames[r]!)],
          onSelected: (r) => setState(() => _inviteRole = r),
        ),
      ],
    ),
    const SizedBox(height: 8),
    Row(
      children: [
        Expanded(
          child: Text(
            'Personen ohne Konto bekommen eine Einladung per E-Mail und sehen das Board, sobald sie sich registriert '
            'haben.',
            style: TextStyle(color: Sk.grey, fontSize: 13),
          ),
        ),
        const SizedBox(width: 8),
        FilledButton(
          key: const Key('stachelShareInvite'),
          onPressed: _busy ? null : _invite,
          child: const Text('EINLADEN'),
        ),
      ],
    ),
  ];

  Widget _person(StachelShareInfo info, StachelSharePerson p) {
    final mine = p.key == widget.me;
    final detail = [?p.email, if (p.via == 'link') 'über den Link'].join(' · ');
    final Widget trailing;
    if (p.role == 'owner') {
      trailing = Text(stachelRoleNames['owner']!, key: Key('stachelShareRole-${p.key}'));
    } else if (info.canManage || mine) {
      trailing = _RoleButton(
        key: Key('stachelShareRole-${p.key}'),
        label: stachelRoleNames[p.role] ?? p.role,
        tooltip: 'Rolle von ${p.name}',
        enabled: !_busy,
        items: [
          for (final r in info.canManage ? stachelShareRoles : [p.role]) (r, stachelRoleNames[r] ?? r),
          if (info.role == 'owner' && p.via != 'link') ('owner', 'Zur Besitzer:in machen'),
          ('remove', mine ? 'Board verlassen' : 'Zugriff entfernen'),
        ],
        onSelected: (v) => _personChange(p, v),
      );
    } else {
      trailing = Text(stachelRoleNames[p.role] ?? p.role, key: Key('stachelShareRole-${p.key}'));
    }
    return ListTile(
      key: Key('stachelSharePerson-${p.key}'),
      contentPadding: EdgeInsets.zero,
      leading: CircleAvatar(
        radius: 17,
        backgroundColor: mine ? Sk.pink : Sk.blue,
        child: Text(peerInitials(p.name), style: const TextStyle(fontSize: 12, color: Colors.white)),
      ),
      title: Text(
        '${p.name}${mine ? ' (du)' : ''}',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontWeight: FontWeight.w700),
      ),
      subtitle: detail.isEmpty ? null : Text(detail, maxLines: 1, overflow: TextOverflow.ellipsis),
      trailing: _withMore(p, trailing, mine),
    );
  }

  /// Rolle plus „···“ mit „Person melden …“ / „Person blockieren“ (fremde Personen, mit Moderation).
  Widget _withMore(StachelSharePerson p, Widget trailing, bool mine) {
    final mod = widget.moderation;
    if (mod == null || mine) return trailing;
    final entries = stachelPersonActions(mod, boardId: widget.boardId, key: p.key, name: p.name);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        trailing,
        PopupMenuButton<int>(
          key: Key('stachelSharePersonMore-${p.key}'),
          tooltip: 'Mehr zu ${p.name}',
          icon: const Icon(Icons.more_vert),
          onSelected: (i) => entries[i].run(context),
          itemBuilder: (_) => [
            for (final (i, e) in entries.indexed)
              PopupMenuItem(
                key: Key(e.key),
                value: i,
                child: Text(e.label, style: TextStyle(color: e.danger ? Sk.danger : null)),
              ),
          ],
        ),
      ],
    );
  }

  Widget _invitation(StachelShareInvite i) => ListTile(
    key: Key('stachelShareInvited-${i.email}'),
    contentPadding: EdgeInsets.zero,
    leading: CircleAvatar(
      radius: 17,
      backgroundColor: Sk.paper,
      child: Text(
        '@',
        style: TextStyle(color: Sk.ink, fontWeight: FontWeight.w700),
      ),
    ),
    title: Text(i.email, maxLines: 1, overflow: TextOverflow.ellipsis),
    subtitle: const Text('eingeladen, noch nicht registriert'),
    trailing: _RoleButton(
      key: Key('stachelShareInviteMenu-${i.email}'),
      label: stachelRoleNames[i.role] ?? i.role,
      tooltip: 'Einladung an ${i.email}',
      enabled: !_busy,
      items: [for (final r in stachelShareRoles) (r, stachelRoleNames[r]!), ('remove', 'Einladung zurückziehen')],
      onSelected: (v) => _inviteChange(i, v),
    ),
  );

  Widget _linkRow(StachelShareInfo info) {
    final text = info.link == null ? null : stachelLinkTexts[info.link];
    return Wrap(
      spacing: 8,
      runSpacing: 6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        if (info.canManage)
          _RoleButton(
            key: const Key('stachelShareLink'),
            label: text ?? 'Aus – nur eingeladene Personen',
            tooltip: 'Freigabelink',
            enabled: !_busy,
            items: [
              ('off', 'Aus – nur eingeladene Personen'),
              for (final r in stachelShareRoles) (r, stachelLinkTexts[r]!),
            ],
            onSelected: (v) {
              final role = v == 'off' ? null : v;
              if (role != info.link) unawaited(_act(() => widget.api.setLink(widget.boardId, role)));
            },
          )
        else
          Text(text ?? 'Nur eingeladene Personen', key: const Key('stachelShareLinkText')),
        OutlinedButton.icon(
          key: const Key('stachelShareCopy'),
          onPressed: _copyLink,
          icon: const Icon(Icons.link, size: 18),
          label: const Text('LINK KOPIEREN'),
        ),
        IconButton(
          key: const Key('stachelShareSend'),
          tooltip: 'Link teilen',
          onPressed: _shareLink,
          icon: const Icon(Icons.share_outlined),
        ),
      ],
    );
  }
}

/// A role choice like the web's `<select>`: the current [label] with an arrow, a menu of [items] (value, text).
class _RoleButton extends StatelessWidget {
  const _RoleButton({
    super.key,
    required this.label,
    required this.tooltip,
    required this.items,
    required this.onSelected,
    this.enabled = true,
  });

  final String label;
  final String tooltip;
  final List<(String, String)> items;
  final ValueChanged<String> onSelected;
  final bool enabled;

  @override
  Widget build(BuildContext context) => PopupMenuButton<String>(
    tooltip: tooltip,
    enabled: enabled,
    onSelected: onSelected,
    itemBuilder: (_) => [
      for (final (value, text) in items)
        PopupMenuItem(
          key: Key('stachelShareChoice-$value'),
          value: value,
          child: Text(text, style: TextStyle(color: value == 'remove' ? Sk.danger : null)),
        ),
    ],
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 200),
            child: Text(
              label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontWeight: FontWeight.w600, color: enabled ? Sk.ink : Sk.grey),
            ),
          ),
          Icon(Icons.arrow_drop_down, color: enabled ? Sk.ink : Sk.grey),
        ],
      ),
    ),
  );
}
