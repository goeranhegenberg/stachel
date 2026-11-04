import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/tool_def.dart';
import '../../editor/ui/board_menus.dart';
import '../../editor/ui/board_toolbar.dart' show pickTool;
import '../../render/board_scene.dart' show objectRect;
import 'commands_model.dart';

// Q3 Befehlspalette (web `features/tools/palette.tsx`, Strg K): every command of the registry in one searchable list –
// menu of the selection, tools, board menu, menu of the empty board; submenus flat („Ausrichten › Links“). Opens from
// the board menu („Befehl suchen …“).

/// Widget key of the board menu entry „Befehl suchen …“ (not listed in the palette itself).
const paletteMenuKey = 'stachelBoardPalette';

/// One command of the palette.
class PaletteCommand {
  const PaletteCommand({required this.id, required this.label, required this.group, required this.run, this.icon});
  final String id;
  final String label;

  /// Auswahl · Werkzeuge · Board · Fläche (web `COMMAND_GROUPS` without the keyboard groups).
  final String group;
  final IconData? icon;

  /// Runs with the context of the board screen (after the sheet closed).
  final Future<void> Function(BuildContext context, BoardUi ui) run;
}

String _norm(String s) => s.replaceAll(RegExp(r'\s*…$'), '').trim().toLowerCase();

/// Menu rows flat: submenus as „Eltern › Kind“ (with the parent's icon), disabled ones left out (web `flattenMenu`).
List<(String, MenuEntry, IconData?)> flattenMenu(List<MenuEntry> items, [String prefix = '', IconData? icon]) => [
  for (final e in items)
    if (!e.disabled)
      if (e.items case final sub? when sub.isNotEmpty)
        ...flattenMenu(sub, prefix.isEmpty ? e.label : '$prefix › ${e.label}', e.icon ?? icon)
      else if (e.onSelect != null)
        (prefix.isEmpty ? e.label : '$prefix › ${e.label}', e, e.icon ?? icon),
];

/// The middle of the view (world).
Offset _viewCenter(BoardUi ui) {
  final size = ui.editor.viewSize;
  return ui.editor.camera.value.toWorld((size == Size.zero ? const Size(400, 600) : size).center(Offset.zero));
}

/// All commands right now (web `collectCommands`): same label only once, the first wins.
List<PaletteCommand> collectCommands(BoardUi ui) {
  final out = <PaletteCommand>[];
  final seen = <String>{};
  void add(PaletteCommand c) {
    final k = _norm(c.label);
    if (k.isEmpty || !seen.add(k)) return;
    out.add(c);
  }

  void menu(MenuTarget on, MenuAt at, String group) {
    for (final (label, e, icon) in flattenMenu(
      menuEntries(ui, on, at).where((e) => e.key != paletteMenuKey).toList(),
    )) {
      add(
        PaletteCommand(
          id: '${on.name}:$label',
          label: label,
          group: group,
          icon: icon,
          run: (context, ui) async => e.onSelect?.call(context, ui),
        ),
      );
    }
  }

  final sel = ui.editor.selected;
  if (sel.isNotEmpty) {
    Rect? r;
    for (final o in sel) {
      final b = objectRect(o);
      r = r == null ? b : r.expandToInclude(b);
    }
    menu(MenuTarget.object, MenuAt(r?.center ?? _viewCenter(ui), objectId: sel.first.id), 'Auswahl');
  }
  if (ui.editor.editable) {
    for (final ToolDef t in ui.registry.tools.list()) {
      if (t.available?.call(ui) == false || t.phone == ToolPlace.hide) continue;
      add(
        PaletteCommand(
          id: 'tool:${t.id}',
          label: t.label,
          group: 'Werkzeuge',
          icon: t.icon,
          run: (context, ui) => pickTool(context, ui, t),
        ),
      );
    }
  }
  menu(MenuTarget.board, MenuAt(_viewCenter(ui)), 'Board');
  menu(MenuTarget.canvas, MenuAt(_viewCenter(ui)), 'Fläche');
  return out;
}

/// Matches for [query] (web `filterCommands`): word start first, otherwise in order.
List<PaletteCommand> filterCommands(List<PaletteCommand> list, String query) {
  final scored = <(int, int, PaletteCommand)>[];
  for (final (i, c) in list.indexed) {
    final s = commandScore(c.label, c.group, query);
    if (s != null) scored.add((s, i, c));
  }
  scored.sort((a, b) => a.$1 != b.$1 ? a.$1.compareTo(b.$1) : a.$2.compareTo(b.$2));
  return [for (final s in scored) s.$3];
}

/// Opens the palette as a sheet and runs the picked command with the screen's [context].
Future<void> showCommandPalette(BuildContext context, BoardUi ui) async {
  final all = collectCommands(ui);
  final picked = await ui.openSheet<PaletteCommand>(
    context,
    (ctx) => ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(ctx).height * 0.85),
      child: SafeArea(
        child: _Palette(ui: ui, all: all),
      ),
    ),
    closeOnSelectionChange: false,
    scrollControlled: true,
  );
  if (picked != null && context.mounted) await picked.run(context, ui);
}

class _Palette extends StatefulWidget {
  const _Palette({required this.ui, required this.all});
  final BoardUi ui;
  final List<PaletteCommand> all;

  @override
  State<_Palette> createState() => _PaletteState();
}

class _PaletteState extends State<_Palette> {
  final _text = TextEditingController();

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.ui.theme;
    final q = _text.text;
    final list = filterCommands(widget.all, q);
    final rows = <Widget>[];
    String? group;
    for (final c in list) {
      if (q.trim().isEmpty && c.group != group) {
        group = c.group;
        rows.add(
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Text(c.group.toUpperCase(), style: t.label(size: 12, color: t.grey)),
          ),
        );
      }
      rows.add(
        ListTile(
          key: Key('stachelPalette-${c.id}'),
          dense: true,
          visualDensity: const VisualDensity(vertical: -1),
          leading: Icon(c.icon ?? Icons.chevron_right, color: t.ink),
          title: Text(c.label, style: TextStyle(color: t.ink, fontSize: 15)),
          trailing: q.trim().isEmpty ? null : Text(c.group, style: TextStyle(color: t.grey, fontSize: 12)),
          onTap: () => Navigator.of(context).pop(c),
        ),
      );
    }
    if (list.isEmpty) {
      rows.add(
        Padding(
          padding: const EdgeInsets.all(16),
          child: Text('Kein Befehl passt zu „${q.trim()}“.', style: TextStyle(color: t.grey)),
        ),
      );
    }
    return Column(
      key: const Key('stachelPaletteSheet'),
      mainAxisSize: MainAxisSize.min,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: TextField(
            key: const Key('stachelPaletteField'),
            controller: _text,
            autofocus: true,
            autocorrect: false,
            enableSuggestions: false,
            textInputAction: TextInputAction.go,
            decoration: const InputDecoration(
              hintText: 'Befehl suchen …',
              prefixIcon: Icon(Icons.search),
              isDense: true,
              border: OutlineInputBorder(),
            ),
            onChanged: (_) => setState(() {}),
            onSubmitted: (_) {
              if (list.isNotEmpty) Navigator.of(context).pop(list.first);
            },
          ),
        ),
        Flexible(
          child: ListView(key: const Key('stachelPaletteList'), shrinkWrap: true, children: rows),
        ),
      ],
    );
  }
}
