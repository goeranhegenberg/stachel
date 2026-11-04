import 'dart:async';

import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import 'admin_host.dart';
import 'format.dart';
import 'versions_session.dart';

/// Reload interval of the open list (web `REFRESH_MS`).
const versionsRefresh = Duration(seconds: 30);

/// The version history as a bottom sheet (web `VersionsPanel`, phone layout): „Version speichern“, „Aktueller Stand“,
/// the versions by day; tapping one shows it read-only (the sheet closes like the web frees the canvas on the phone);
/// the version shown has „Diese Version wiederherstellen“, „Als Kopie öffnen“ and „Umbenennen“.
class VersionsSheet extends StatefulWidget {
  const VersionsSheet({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<VersionsSheet> createState() => _VersionsSheetState();
}

class _VersionsSheetState extends State<VersionsSheet> {
  late final VersionsSession session = VersionsSession.of(widget.ui);
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    session.addListener(_changed);
    unawaited(session.reload());
    _timer = Timer.periodic(versionsRefresh, (_) => unawaited(session.reload()));
  }

  @override
  void dispose() {
    _timer?.cancel();
    session.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  BoardUiTheme get theme => widget.ui.theme;

  Future<void> _pick(BoardVersion v) async {
    if (session.preview.value?.version.id == v.id) return;
    final navigator = Navigator.of(context);
    await session.openPreview(
      navigator,
      v,
      onLoaded: () {
        if (mounted) Navigator.of(context).pop();
      },
    );
  }

  void _current() {
    if (session.preview.value == null) return;
    session.closePreview();
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final list = session.list;
    final selected = session.preview.value?.version.id;
    final groups = list == null ? const <VersionDayGroup>[] : groupByDay(list);
    final muted = TextStyle(color: theme.grey, fontSize: 14);
    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.85),
      child: SafeArea(
        top: false,
        child: ListView(
          key: const Key('stachelVersionsSheet'),
          shrinkWrap: true,
          padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
          children: [
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text('VERSIONSVERLAUF', style: theme.label(size: 16)),
            ),
            _SaveVersion(theme: theme, onSave: (name) async => await session.save(name) != null),
            const SizedBox(height: 6),
            _Item(
              key: const Key('stachelVersionCurrent'),
              theme: theme,
              active: selected == null,
              onTap: _current,
              title: Text('Aktueller Stand', style: theme.label(size: 18)),
              subtitle: 'Live – so sehen alle das Board gerade',
            ),
            if (session.error.isNotEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  session.error,
                  key: const Key('stachelVersionsError'),
                  style: TextStyle(color: theme.danger),
                ),
              ),
            if (list == null && session.error.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text('Lädt …', style: muted),
              ),
            if (list != null && list.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  'Noch keine Versionen. Stachel sichert automatisch alle paar Minuten, während ihr arbeitet, und wenn '
                  'alle das Board verlassen. Mit „Version speichern“ hältst du einen Stand mit Namen fest.',
                  key: const Key('stachelVersionsEmpty'),
                  style: muted,
                ),
              ),
            for (final g in groups) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 14, 4, 4),
                child: Text(g.label.toUpperCase(), style: theme.label(size: 12.5, color: theme.grey)),
              ),
              for (final v in g.items)
                _VersionEntry(
                  key: Key('stachelVersion-${v.id}'),
                  v: v,
                  theme: theme,
                  selected: selected == v.id,
                  busy: session.loadingId == v.id,
                  onPick: () => unawaited(_pick(v)),
                  onRestore: () => unawaited(confirmRestore(context, session, v)),
                  onCopy: () {
                    Navigator.of(context).pop();
                    unawaited(session.copy(v));
                  },
                  onRename: (name) => session.rename(v, name),
                ),
            ],
            if (list != null && list.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(
                  'Ältere Versionen werden ausgedünnt (nach einem Tag eine je Stunde, nach 30 Tagen eine je Tag). '
                  'Benannte Versionen bleiben.',
                  style: muted.copyWith(fontSize: 12.5),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// A row of the list (time/title + description).
class _Item extends StatelessWidget {
  const _Item({
    super.key,
    required this.theme,
    required this.active,
    required this.onTap,
    required this.title,
    required this.subtitle,
  });
  final BoardUiTheme theme;
  final bool active;
  final VoidCallback onTap;
  final Widget title;
  final String subtitle;

  @override
  Widget build(BuildContext context) => Material(
    color: active ? theme.accent.withValues(alpha: 0.12) : Colors.transparent,
    borderRadius: BorderRadius.circular(10),
    child: InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 44),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              title,
              const SizedBox(height: 3),
              Text(subtitle, style: TextStyle(color: theme.grey, fontSize: 13.5)),
            ],
          ),
        ),
      ),
    ),
  );
}

/// Avatars of a version: up to 3 plus „+n“ (web `Avatars`).
class VersionAvatars extends StatelessWidget {
  const VersionAvatars({super.key, required this.v});
  final BoardVersion v;

  @override
  Widget build(BuildContext context) {
    final people = peopleOf(v);
    if (people.isEmpty) return const SizedBox.shrink();
    final shown = people.take(3).toList();
    Widget dot(Color c, String text, {String? tip}) {
      final d = Container(
        width: 22,
        height: 22,
        margin: const EdgeInsets.only(left: 2),
        alignment: Alignment.center,
        decoration: BoxDecoration(color: c, shape: BoxShape.circle),
        child: Text(
          text,
          style: const TextStyle(color: Colors.white, fontSize: 9.5, fontWeight: FontWeight.w700),
        ),
      );
      return tip == null ? d : Tooltip(message: tip, child: d);
    }

    return Semantics(
      label: people.map((p) => p.name).join(', '),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final p in shown) dot(userColor(p.key), initials(p.name), tip: p.name),
          if (people.length > shown.length) dot(const Color(0xFF8A8A85), '+${people.length - shown.length}'),
        ],
      ),
    );
  }
}

class _VersionEntry extends StatefulWidget {
  const _VersionEntry({
    super.key,
    required this.v,
    required this.theme,
    required this.selected,
    required this.busy,
    required this.onPick,
    required this.onRestore,
    required this.onCopy,
    required this.onRename,
  });

  final BoardVersion v;
  final BoardUiTheme theme;
  final bool selected;
  final bool busy;
  final VoidCallback onPick;
  final VoidCallback onRestore;
  final VoidCallback onCopy;
  final Future<bool> Function(String name) onRename;

  @override
  State<_VersionEntry> createState() => _VersionEntryState();
}

class _VersionEntryState extends State<_VersionEntry> {
  bool _naming = false;
  late final _name = TextEditingController(text: widget.v.name ?? '');

  @override
  void didUpdateWidget(_VersionEntry old) {
    super.didUpdateWidget(old);
    if (old.v.name != widget.v.name) _name.text = widget.v.name ?? '';
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (await widget.onRename(_name.text.trim()) && mounted) setState(() => _naming = false);
  }

  @override
  Widget build(BuildContext context) {
    final v = widget.v;
    final theme = widget.theme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Item(
          theme: theme,
          active: widget.selected,
          onTap: widget.onPick,
          title: Row(
            children: [
              Text(timeLabel(v.createdAt), style: theme.label(size: 18)),
              const SizedBox(width: 8),
              Expanded(
                child: v.name == null
                    ? const SizedBox.shrink()
                    : Text(
                        v.name!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: theme.ink, fontWeight: FontWeight.w700),
                      ),
              ),
              VersionAvatars(v: v),
            ],
          ),
          subtitle: '${describeVersion(v)} · ${objectsLabel(v.objects)}${widget.busy ? ' · lädt …' : ''}',
        ),
        if (widget.selected)
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 4, 10, 8),
            child: _naming
                ? _NameForm(
                    theme: theme,
                    controller: _name,
                    hint: 'Name der Version',
                    submitLabel: (t) => t.trim().isEmpty ? 'Name entfernen' : 'Benennen',
                    submitKey: 'stachelVersionRenameSubmit',
                    allowEmpty: true,
                    onCancel: () => setState(() => _naming = false),
                    onSubmit: _submit,
                  )
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      FilledButton(
                        key: const Key('stachelVersionRestore'),
                        style: FilledButton.styleFrom(backgroundColor: theme.accent),
                        onPressed: widget.onRestore,
                        child: const Text('Diese Version wiederherstellen'),
                      ),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 8,
                        runSpacing: 6,
                        children: [
                          OutlinedButton(
                            key: const Key('stachelVersionCopy'),
                            onPressed: widget.onCopy,
                            child: const Text('Als Kopie öffnen'),
                          ),
                          OutlinedButton(
                            key: const Key('stachelVersionRename'),
                            onPressed: () => setState(() => _naming = true),
                            child: Text(v.name != null ? 'Umbenennen' : 'Version benennen'),
                          ),
                        ],
                      ),
                    ],
                  ),
          ),
      ],
    );
  }
}

/// „Version speichern“ (web `SaveVersion`): a button, then a name field with „Abbrechen“/„Speichern“.
class _SaveVersion extends StatefulWidget {
  const _SaveVersion({required this.theme, required this.onSave});
  final BoardUiTheme theme;
  final Future<bool> Function(String name) onSave;

  @override
  State<_SaveVersion> createState() => _SaveVersionState();
}

class _SaveVersionState extends State<_SaveVersion> {
  bool _open = false;
  bool _busy = false;
  final _name = TextEditingController();

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final n = _name.text.trim();
    if (n.isEmpty || _busy) return;
    setState(() => _busy = true);
    final ok = await widget.onSave(n);
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (ok) {
        _open = false;
        _name.clear();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!_open) {
      return FilledButton(
        key: const Key('stachelVersionSave'),
        style: FilledButton.styleFrom(backgroundColor: widget.theme.accent),
        onPressed: () => setState(() => _open = true),
        child: const Text('Version speichern'),
      );
    }
    return _NameForm(
      theme: widget.theme,
      controller: _name,
      hint: 'Name, z. B. Stand vor dem Orga-Treffen',
      submitLabel: (_) => 'Speichern',
      submitKey: 'stachelVersionSaveSubmit',
      busy: _busy,
      onCancel: () => setState(() => _open = false),
      onSubmit: _submit,
    );
  }
}

/// Name field with „Abbrechen“ and a submit button (max. 120 characters like the web).
class _NameForm extends StatefulWidget {
  const _NameForm({
    required this.theme,
    required this.controller,
    required this.hint,
    required this.submitLabel,
    required this.submitKey,
    required this.onCancel,
    required this.onSubmit,
    this.allowEmpty = false,
    this.busy = false,
  });

  final BoardUiTheme theme;
  final TextEditingController controller;
  final String hint;
  final String Function(String text) submitLabel;
  final String submitKey;
  final VoidCallback onCancel;
  final Future<void> Function() onSubmit;
  final bool allowEmpty;
  final bool busy;

  @override
  State<_NameForm> createState() => _NameFormState();
}

class _NameFormState extends State<_NameForm> {
  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_changed);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final text = widget.controller.text;
    final enabled = !widget.busy && (widget.allowEmpty || text.trim().isNotEmpty);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          key: const Key('stachelVersionName'),
          controller: widget.controller,
          autofocus: true,
          maxLength: 120,
          textInputAction: TextInputAction.done,
          decoration: InputDecoration(hintText: widget.hint, counterText: '', labelText: 'Name der Version'),
          onSubmitted: (_) => enabled ? widget.onSubmit() : null,
        ),
        const SizedBox(height: 8),
        Wrap(
          alignment: WrapAlignment.end,
          spacing: 8,
          runSpacing: 6,
          children: [
            TextButton(onPressed: widget.onCancel, child: const Text('Abbrechen')),
            FilledButton(
              key: Key(widget.submitKey),
              style: FilledButton.styleFrom(backgroundColor: widget.theme.accent),
              onPressed: enabled ? widget.onSubmit : null,
              child: Text(widget.submitLabel(text)),
            ),
          ],
        ),
      ],
    );
  }
}
