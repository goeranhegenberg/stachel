import 'package:flutter/material.dart';

import 'stachel_boards_api.dart';
import 'stachel_overview.dart';
import 'stachel_client_base.dart';
import 'stachel_style.dart';

/// „Papierkorb“ below the boards like the web (`pages/trash.tsx` `TrashSection`, audit A15): open/closed per device,
/// cards with preview image, „Gelöscht von X · vor …“, „Wird endgültig gelöscht in N Tagen“, „Wiederherstellen“,
/// „Endgültig löschen“ (with confirmation) and „Papierkorb leeren“ (three texts); actions only with `canManage`.
class StachelTrashSection extends StatefulWidget {
  const StachelTrashSection({
    super.key,
    required this.items,
    required this.open,
    required this.onToggle,
    required this.api,
    required this.onChanged,
    required this.onError,
  });

  final List<StachelTrashedBoard> items;
  final bool open;
  final VoidCallback onToggle;
  final StachelBoardAdminApi api;

  /// Reload list and trash.
  final VoidCallback onChanged;
  final void Function(StachelException error) onError;

  @override
  State<StachelTrashSection> createState() => _StachelTrashSectionState();
}

class _StachelTrashSectionState extends State<StachelTrashSection> {
  String? _busy;

  Future<void> _run(String key, Future<Object?> Function() fn) async {
    setState(() => _busy = key);
    try {
      await fn();
    } on StachelException catch (e) {
      widget.onError(e.code == 'forbidden' ? StachelException(e.code, stachelManageReason) : e);
    } finally {
      if (mounted) setState(() => _busy = null);
      widget.onChanged();
    }
  }

  Future<bool> _confirm(String title, String text) async =>
      await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(title),
          content: Text(text),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('ABBRECHEN')),
            FilledButton(
              key: const Key('stachelTrashConfirm'),
              style: FilledButton.styleFrom(backgroundColor: Sk.danger),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('ENDGÜLTIG LÖSCHEN'),
            ),
          ],
        ),
      ) ==
      true;

  Future<void> _purge(StachelTrashedBoard b) async {
    final ok = await _confirm(
      'Endgültig löschen?',
      '„${b.title}“ wird mit allen Inhalten und Bildern für alle gelöscht. Das lässt sich nicht rückgängig machen.',
    );
    if (ok && mounted) await _run('purge:${b.id}', () => widget.api.purgeBoard(b.id));
  }

  Future<void> _empty() async {
    final items = widget.items;
    final n = items.where((b) => b.canManage).length;
    final text = n == items.length
        ? '${items.length == 1 ? 'Das Board im Papierkorb wird' : 'Alle ${items.length} Boards im Papierkorb werden'} '
              'für alle endgültig gelöscht. Das lässt sich nicht rückgängig machen.'
        : '${n == 1 ? 'Ein Board' : '$n Boards'}, die du löschen darfst, ${n == 1 ? 'wird' : 'werden'} endgültig '
              'gelöscht. Die übrigen bleiben liegen. Das lässt sich nicht rückgängig machen.';
    final ok = await _confirm('Papierkorb leeren?', text);
    if (ok && mounted) await _run('all', widget.api.emptyTrash);
  }

  @override
  Widget build(BuildContext context) {
    final items = widget.items;
    final manageable = items.any((b) => b.canManage);
    return Column(
      key: const Key('stachelTrash'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Divider(height: 32),
        Row(
          children: [
            Expanded(
              child: InkWell(
                key: const Key('stachelTrashToggle'),
                onTap: widget.onToggle,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
                  child: Row(
                    children: [
                      const Icon(Icons.delete_outline, size: 22),
                      const SizedBox(width: 8),
                      Flexible(
                        child: Text(
                          'PAPIERKORB',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontFamily: Sk.cond, fontWeight: FontWeight.w800, fontSize: 16),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                        decoration: BoxDecoration(color: Sk.ink, borderRadius: BorderRadius.circular(10)),
                        child: Text(
                          '${items.length}',
                          key: const Key('stachelTrashCount'),
                          style: TextStyle(color: Sk.surface, fontSize: 12, fontWeight: FontWeight.w700),
                        ),
                      ),
                      Icon(widget.open ? Icons.expand_less : Icons.expand_more),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
          ],
        ),
        if (widget.open) ...[
          Padding(
            padding: EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Text(
              'Gelöschte Boards bleiben $stachelTrashDays Tage hier, danach werden sie endgültig gelöscht – samt Bildern.',
              style: TextStyle(color: Sk.grey, fontSize: 13),
            ),
          ),
          // own line (the phone is too narrow for heading and button side by side)
          if (manageable)
            Align(
              alignment: Alignment.centerRight,
              child: Padding(
                padding: const EdgeInsets.only(right: 8),
                child: TextButton(
                  key: const Key('stachelTrashEmpty'),
                  onPressed: _busy == null ? _empty : null,
                  child: const Text('PAPIERKORB LEEREN'),
                ),
              ),
            ),
          if (items.isEmpty)
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 4, 16, 8),
              child: Text('Der Papierkorb ist leer.', key: Key('stachelTrashNone')),
            ),
          for (final b in items) _card(b),
        ],
      ],
    );
  }

  Widget _card(StachelTrashedBoard b) {
    final img = widget.api.trashThumbnail(b);
    const blank = ColoredBox(color: Color(0xFFEDEBE4));
    return Padding(
      key: Key('stachelTrashCard-${b.id}'),
      padding: const EdgeInsets.fromLTRB(16, 6, 16, 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 60,
            height: 44,
            decoration: BoxDecoration(border: Border.all(color: Sk.grey, width: 2)),
            child: img == null ? blank : Image(image: img, fit: BoxFit.cover, errorBuilder: (_, _, _) => blank),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  b.title,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                Tooltip(
                  message: 'Gelöscht am ${fullDate(b.deletedAt)}',
                  child: Text(
                    'Gelöscht von ${b.deletedByName.isEmpty ? 'jemandem' : b.deletedByName} · ${relativeTime(b.deletedAt)}',
                    style: TextStyle(color: Sk.grey, fontSize: 13),
                  ),
                ),
                Tooltip(
                  message: 'Endgültig am ${fullDate(b.purgeAt)}',
                  child: Text(
                    trashPurgeText(b.purgeAt),
                    key: Key('stachelTrashPurgeText-${b.id}'),
                    style: TextStyle(color: Sk.danger, fontSize: 13, fontWeight: FontWeight.w600),
                  ),
                ),
                const SizedBox(height: 4),
                Wrap(
                  spacing: 8,
                  children: [
                    FilledButton.tonal(
                      key: Key('stachelTrashRestore-${b.id}'),
                      onPressed: !b.canManage || _busy != null
                          ? null
                          : () => _run(b.id, () => widget.api.restoreBoard(b.id)),
                      child: Text(_busy == b.id ? 'STELLE WIEDER HER …' : 'WIEDERHERSTELLEN'),
                    ),
                    TextButton(
                      key: Key('stachelTrashPurge-${b.id}'),
                      onPressed: !b.canManage || _busy != null ? null : () => _purge(b),
                      child: const Text('ENDGÜLTIG LÖSCHEN'),
                    ),
                  ],
                ),
                if (!b.canManage) Text(stachelManageReason, style: TextStyle(color: Sk.grey, fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
