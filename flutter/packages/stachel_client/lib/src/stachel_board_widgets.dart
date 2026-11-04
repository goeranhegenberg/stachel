import 'package:flutter/material.dart';
import 'stachel_style.dart';

/// „heute, 14:32“, „gestern, 9:05“, „1.11., 14:32“ (other year: „1.11.2025, 14:32“) – for „Stand von …“.
String stachelWhen(DateTime t, {DateTime? now}) {
  final l = t.toLocal();
  final n = now ?? DateTime.now();
  final today = DateTime(n.year, n.month, n.day);
  final day = DateTime(l.year, l.month, l.day);
  final hm = '${l.hour}:${l.minute.toString().padLeft(2, '0')}';
  if (day == today) return 'heute, $hm';
  if (day == DateTime(today.year, today.month, today.day - 1)) return 'gestern, $hm';
  final year = l.year == n.year ? '' : '${l.year}';
  return '${l.day}.${l.month}.$year, $hm';
}

/// Initials of a name (at most two letters).
String peerInitials(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  final first = parts.first.characters.first;
  final second = parts.length > 1 ? parts.last.characters.first : '';
  return (first + second).toUpperCase();
}

/// Status strip under the app bar (offline, cached state, board gone …): icon, bold line, optional detail.
class StachelStatusBanner extends StatelessWidget {
  const StachelStatusBanner({super.key, required this.icon, required this.text, this.detail, this.color, this.action});

  final IconData icon;
  final String text;
  final String? detail;

  /// Background; null = the highlight color ([Sk.yellow]).
  final Color? color;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final color = this.color ?? Sk.yellow;
    // light background (yellow, white): the dark ink also in the dark look
    final fg = color.computeLuminance() > 0.4 ? Sk.canvasInk : Colors.white;
    return Material(
      color: color,
      child: Container(
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: Sk.ink, width: 2)),
        ),
        padding: const EdgeInsets.fromLTRB(14, 8, 8, 8),
        child: Row(
          children: [
            Icon(icon, color: fg, size: 22),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    text,
                    style: TextStyle(fontWeight: FontWeight.w700, color: fg),
                  ),
                  if (detail != null) Text(detail!, style: TextStyle(color: fg, fontSize: 13)),
                ],
              ),
            ),
            ?action,
          ],
        ),
      ),
    );
  }
}

/// Own role as a small pill next to a board title (web `RoleTag`: „Kann ansehen“ …).
class StachelRoleTag extends StatelessWidget {
  const StachelRoleTag(this.label, {super.key});
  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
    decoration: BoxDecoration(
      color: Sk.paper,
      borderRadius: BorderRadius.circular(999),
      border: Border.all(color: Sk.grey.withValues(alpha: 0.5)),
    ),
    child: Text(
      label,
      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Sk.ink),
    ),
  );
}

/// Hint on a board the own role does not allow editing (web `ShareBar` badge): „Nur ansehen“ or „Kommentieren“, the
/// web's explanation as tooltip. Nothing for `edit`/`owner`.
class StachelRoleBadge extends StatelessWidget {
  const StachelRoleBadge({super.key, required this.role, this.compact = false});
  final String role;

  /// Only the symbol (eye / speech bubble) – the board's app bar on a phone (UX-Review P1); the text is the tooltip.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final view = role == 'view';
    if (!view && role != 'comment') return const SizedBox.shrink();
    final tip = view ? 'Du kannst dieses Board nur ansehen.' : 'Du kannst dieses Board ansehen und kommentieren.';
    if (compact) {
      return Tooltip(
        message: tip,
        child: Semantics(
          label: view ? 'Nur ansehen' : 'Kommentieren',
          child: Container(
            key: const Key('stachelRoleBadge'),
            margin: const EdgeInsets.symmetric(horizontal: 2),
            padding: const EdgeInsets.all(3),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: Sk.ink, width: 1.5),
            ),
            child: Icon(view ? Icons.visibility_outlined : Icons.mode_comment_outlined, size: 16, color: Sk.ink),
          ),
        ),
      );
    }
    return Tooltip(
      message: tip,
      child: Container(
        key: const Key('stachelRoleBadge'),
        margin: const EdgeInsets.symmetric(horizontal: 4),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: Sk.surface,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: Sk.ink, width: 1.5),
        ),
        child: Text(
          view ? 'Nur ansehen' : 'Kommentieren',
          style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Sk.ink),
        ),
      ),
    );
  }
}

/// Whole-screen state when there is no board to show (no connection and nothing cached, board gone …).
class StachelStatePage extends StatelessWidget {
  const StachelStatePage({
    super.key,
    required this.icon,
    required this.title,
    required this.text,
    this.actions = const [],
  });

  final IconData icon;
  final String title;
  final String text;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) => Center(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: SkPanel(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: Sk.pink),
            const SizedBox(height: 10),
            Text(
              title.toUpperCase(),
              textAlign: TextAlign.center,
              style: TextStyle(fontFamily: Sk.cond, fontWeight: FontWeight.w900, fontSize: 24, color: Sk.ink),
            ),
            const SizedBox(height: 8),
            Text(text, textAlign: TextAlign.center),
            if (actions.isNotEmpty) ...[
              const SizedBox(height: 16),
              Wrap(alignment: WrapAlignment.center, spacing: 10, runSpacing: 10, children: actions),
            ],
          ],
        ),
      ),
    ),
  );
}

/// Asks for a board title (new board, rename); null = cancelled. Empty is allowed for a new board only (the server
/// names it „Unbenanntes Board“).
Future<String?> askStachelBoardTitle(
  BuildContext context, {
  required String heading,
  required String action,
  String initial = '',
}) async {
  final text = TextEditingController(text: initial)
    ..selection = TextSelection(baseOffset: 0, extentOffset: initial.length);
  final renaming = initial.isNotEmpty;
  final result = await showDialog<String>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) {
        final value = text.text.trim();
        final ok = value.length <= 120 && (!renaming || value.isNotEmpty);
        return AlertDialog(
          title: Text(heading),
          content: TextField(
            key: const Key('stachelBoardTitle'),
            controller: text,
            autofocus: true,
            maxLength: 120,
            textInputAction: TextInputAction.done,
            decoration: const InputDecoration(hintText: 'Titel des Boards'),
            onChanged: (_) => setState(() {}),
            onSubmitted: (_) => ok ? Navigator.of(ctx).pop(text.text.trim()) : null,
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('ABBRECHEN')),
            FilledButton(
              key: const Key('stachelBoardTitleOk'),
              onPressed: ok ? () => Navigator.of(ctx).pop(text.text.trim()) : null,
              child: Text(action),
            ),
          ],
        );
      },
    ),
  );
  // the controller goes with the dialog (it may still animate out)
  return result;
}
