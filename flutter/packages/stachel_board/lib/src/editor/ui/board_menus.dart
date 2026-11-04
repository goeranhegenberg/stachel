import 'package:flutter/material.dart';

import '../desktop.dart';
import '../registry/board_ui.dart';
import '../registry/menu_item_def.dart';
import 'board_context_bar.dart' show sectionHeading;

/// The rows of menu [on] at [at] from the registry, in order (entries that return null are left out).
List<MenuEntry> menuEntries(BoardUi ui, MenuTarget on, MenuAt at) => [
  for (final d in ui.registry.menuItems.list())
    if (d.on == on) ?d.entry(ui, at),
];

/// The board menu grouped for the phone (UX P7): every [MenuSection] with its rows, sorted by
/// [MenuItemDef.sectionOrder] (else the registry order); empty sections are left out. Same entries as [menuEntries].
List<(MenuSection, List<MenuEntry>)> menuSections(BoardUi ui, MenuAt at) {
  final groups = {for (final s in MenuSection.values) s: <(double, int, MenuEntry)>[]};
  for (final (i, d) in ui.registry.menuItems.list().indexed) {
    if (d.on != MenuTarget.board) continue;
    final e = d.entry(ui, at);
    if (e != null) groups[d.section ?? MenuSection.more]!.add((d.sectionOrder ?? d.order, i, e));
  }
  return [
    for (final MapEntry(key: s, value: l) in groups.entries)
      if (l.isNotEmpty)
        (
          s,
          [
            for (final (_, _, e)
                in l..sort((a, b) {
                  final c = a.$1.compareTo(b.$1);
                  return c != 0 ? c : a.$2.compareTo(b.$2);
                }))
              e,
          ],
        ),
  ];
}

/// Shows menu [on] as a sheet from the bottom (web context menu / board menu; submenus open in place like the web
/// below 700 px) and runs the chosen entry with the screen's [context] after the sheet closed. The board menu comes
/// grouped (tiles of [MenuSection.quick] on top, then the headed groups); the web keeps its flat list.
Future<void> showBoardMenu(BuildContext context, BoardUi ui, MenuTarget on, MenuAt at) async {
  // desktop (docs/features/desktop.md §1): a right click pops the menu up at the pointer; in the desktop app the board
  // menu pops up under its button
  final anchor =
      ui.view?.takeMenuAnchor() ?? (on == MenuTarget.board && BoardDesktop.enabled ? boardMenuAnchor(context) : null);
  if (anchor != null) return showBoardPopup(context, ui, on, at, anchor);
  final grouped = on == MenuTarget.board ? menuSections(ui, at) : null;
  final entries = menuEntries(ui, on, at);
  if (entries.isEmpty) return;
  final picked = await ui.openSheet<MenuEntry>(
    context,
    (ctx) => ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(ctx).height * 0.85),
      child: SafeArea(
        child: _MenuList(ui: ui, entries: entries, sections: grouped, sheetKey: _keys[on]!),
      ),
    ),
    // the object menu belongs to the selection (a new one closes it, like the web)
    closeOnSelectionChange: on == MenuTarget.object,
    scrollControlled: true,
  );
  if (picked != null && context.mounted) picked.onSelect?.call(context, ui);
}

const _keys = {
  MenuTarget.object: 'stachelObjectMenu',
  MenuTarget.canvas: 'stachelCanvasMenu',
  MenuTarget.board: 'stachelBoardMenuSheet',
};

/// Tile text: [MenuEntry.short], else the label without „ …“ and a trailing „(…)“.
String tileLabel(MenuEntry e) =>
    e.short ?? e.label.replaceAll(RegExp(r'\s*…$'), '').replaceAll(RegExp(r'\s*\([^)]*\)$'), '').trim();

class _MenuList extends StatefulWidget {
  const _MenuList({required this.ui, required this.entries, required this.sheetKey, this.sections});
  final BoardUi ui;
  final List<MenuEntry> entries;
  final List<(MenuSection, List<MenuEntry>)>? sections;
  final String sheetKey;

  @override
  State<_MenuList> createState() => _MenuListState();
}

class _MenuListState extends State<_MenuList> {
  final _open = <MenuEntry>{};

  BoardUiTheme get theme => widget.ui.theme;

  Iterable<Widget> _rows(List<MenuEntry> list, int depth, {bool seps = true}) sync* {
    for (final (i, e) in list.indexed) {
      if (seps && e.sep && (i > 0 || depth > 0)) yield Divider(height: 1, indent: 16.0 + depth * 24, endIndent: 16);
      final sub = e.items;
      final open = _open.contains(e);
      final color = e.disabled ? theme.grey.withValues(alpha: 0.6) : (e.danger ? theme.danger : theme.ink);
      final badge = e.badge;
      yield ListTile(
        key: e.key == null ? null : Key(e.key!),
        dense: true,
        visualDensity: const VisualDensity(vertical: -1),
        contentPadding: EdgeInsets.only(left: 16.0 + depth * 24, right: 16),
        leading: e.icon == null ? (depth == 0 ? const SizedBox(width: 24) : null) : Icon(e.icon, color: color),
        title: Text(e.label, style: TextStyle(color: color, fontSize: 15)),
        subtitle: e.subtitle == null ? null : Text(e.subtitle!),
        trailing: sub != null
            ? Icon(open ? Icons.expand_less : Icons.chevron_right, color: color)
            : (badge == null ? null : _Badge(text: badge, theme: theme)),
        enabled: !e.disabled,
        onTap: sub != null
            ? () => setState(() => open ? _open.remove(e) : _open.add(e))
            : () => Navigator.of(context).pop(e),
      );
      if (sub != null && open) yield* _rows(sub, depth + 1);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sections = widget.sections;
    if (sections == null) {
      return ListView(key: Key(widget.sheetKey), shrinkWrap: true, children: [..._rows(widget.entries, 0)]);
    }
    return ListView(
      key: Key(widget.sheetKey),
      shrinkWrap: true,
      padding: const EdgeInsets.only(bottom: 8),
      children: [
        for (final (s, list) in sections)
          if (s == MenuSection.quick)
            _QuickTiles(entries: list, theme: theme, onTap: (e) => Navigator.of(context).pop(e))
          else ...[
            sectionHeading(widget.ui, s.title, key: 'stachelMenuSection-${s.name}'),
            // the headings group now; the web's separator lines would only add noise
            ..._rows(list, 0, seps: false),
          ],
      ],
    );
  }
}

/// Big tiles in the thumb's reach (Teilen, Kommentare with counter, Suchen, Präsentieren …), four per row.
class _QuickTiles extends StatelessWidget {
  const _QuickTiles({required this.entries, required this.theme, required this.onTap});
  final List<MenuEntry> entries;
  final BoardUiTheme theme;
  final void Function(MenuEntry e) onTap;

  static const perRow = 4;

  @override
  Widget build(BuildContext context) {
    final rows = [
      for (var i = 0; i < entries.length; i += perRow) entries.sublist(i, (i + perRow).clamp(0, entries.length)),
    ];
    return Padding(
      key: const Key('stachelMenuQuick'),
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Column(
        children: [
          for (final row in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  for (var i = 0; i < perRow; i++)
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        child: i < row.length ? _tile(row[i]) : const SizedBox.shrink(),
                      ),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _tile(MenuEntry e) {
    final color = e.disabled ? theme.grey.withValues(alpha: 0.6) : theme.ink;
    final badge = e.badge;
    return Tooltip(
      message: e.label,
      child: Material(
        color: theme.accent.withValues(alpha: 0.08),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
          side: BorderSide(color: theme.ink.withValues(alpha: 0.18)),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          key: e.key == null ? null : Key(e.key!),
          onTap: e.disabled ? null : () => onTap(e),
          child: SizedBox(
            height: 68,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Icon(e.icon ?? Icons.circle_outlined, size: 26, color: color),
                    if (badge != null)
                      Positioned(
                        right: -14,
                        top: -6,
                        child: _Badge(text: badge, theme: theme),
                      ),
                  ],
                ),
                const SizedBox(height: 6),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      tileLabel(e),
                      maxLines: 1,
                      style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: color),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Counter pill (open comments …).
class _Badge extends StatelessWidget {
  const _Badge({required this.text, required this.theme});
  final String text;
  final BoardUiTheme theme;

  @override
  Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(minWidth: 20),
    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
    decoration: BoxDecoration(color: theme.accent, borderRadius: BorderRadius.circular(10)),
    child: Text(
      text,
      textAlign: TextAlign.center,
      style: const TextStyle(color: Colors.white, fontSize: 11.5, fontWeight: FontWeight.w700),
    ),
  );
}

// ---- desktop: menus as popups (docs/features/desktop.md §1) ---------------------------------------------------------

/// Key hint at the right of a popup row (web `MenuItem.shortcut`), by the entry's key; the keys themselves are handled
/// by the board's keyboard handling.
const menuShortcuts = <String, String>{
  'stachelMenuCopy': 'Strg C',
  'stachelMenuCut': 'Strg X',
  'stachelMenuPaste': 'Strg V',
  'stachelPaste': 'Strg V',
  'stachelMenuDuplicate': 'Strg D',
  'stachelMenuDelete': 'Entf',
  'stachelMenuEdit': 'Enter',
  'stachelMenuGroup': 'Strg G',
  'stachelMenuUngroup': 'Strg Umschalt G',
  'stachelMenuLock': 'Strg Umschalt L',
  'stachelMenuHide': 'Strg Umschalt H',
  'stachelMenuForward': 'Strg ]',
  'stachelMenuBackward': 'Strg [',
  'stachelMenuFront': 'Strg Umschalt ]',
  'stachelMenuBack': 'Strg Umschalt [',
  'stachelMenuCopyStyle': 'Strg Alt C',
  'stachelMenuPasteStyle': 'Strg Alt V',
  'stachelMenuZoom': 'Umschalt 2',
  'stachelMenuUndo': 'Strg Z',
  'stachelMenuRedo': 'Strg Y',
  'stachelMenuMindCollapse': 'Strg .',
  'stachelSelectAll': 'Strg A',
  'stachelFitAll': 'Umschalt 1',
  'stachelBoardSearch': 'Strg F',
  'stachelCanvasSearch': 'Strg F',
  'stachelBoardReplace': 'Strg H',
  'stachelBoardPalette': 'Strg K',
  'stachelBoardVersions': 'Strg Alt H',
  'stachelBoardFullscreen': 'F11',
  'stachelBoardGrid': "Strg '",
  'stachelCanvasGrid': "Strg '",
};

/// Where the board menu pops up when it has no pointer position: under its button at the top right.
Offset boardMenuAnchor(BuildContext context) {
  final size = MediaQuery.sizeOf(context);
  return Offset(size.width - 8, MediaQuery.paddingOf(context).top + kToolbarHeight);
}

/// Menu [on] as a popup at [anchor] (global position, web context menu): the board menu with its group headings, a
/// submenu opens as a popup of its own at the same place (its rows only), the chosen entry runs with [context] after
/// the popup closed.
Future<void> showBoardPopup(BuildContext context, BoardUi ui, MenuTarget on, MenuAt at, Offset anchor) async {
  var groups = <(String, List<MenuEntry>)>[
    if (on == MenuTarget.board)
      for (final (s, l) in menuSections(ui, at)) (s.title, l)
    else
      ('', menuEntries(ui, on, at)),
  ];
  if (groups.every((g) => g.$2.isEmpty)) return;
  var pos = anchor;
  for (;;) {
    final picked = await _popup(context, ui, groups, pos, _keys[on]!);
    if (picked == null || !context.mounted) return;
    final sub = picked.items;
    if (sub == null) {
      picked.onSelect?.call(context, ui);
      return;
    }
    groups = [(picked.label.toUpperCase(), sub)];
    pos += const Offset(16, 8);
  }
}

Future<MenuEntry?> _popup(
  BuildContext context,
  BoardUi ui,
  List<(String, List<MenuEntry>)> groups,
  Offset at,
  String key,
) {
  final overlay = Overlay.of(context).context.findRenderObject()! as RenderBox;
  final p = overlay.globalToLocal(at);
  final theme = ui.theme;
  final items = <PopupMenuEntry<MenuEntry>>[];
  for (final (title, list) in groups) {
    if (list.isEmpty) continue;
    if (title.isNotEmpty) {
      if (items.isNotEmpty) items.add(const PopupMenuDivider(height: 9));
      items.add(
        PopupMenuItem<MenuEntry>(
          enabled: false,
          height: 26,
          child: Text(title, style: theme.label(size: 11.5, color: theme.grey)),
        ),
      );
    }
    for (final (i, e) in list.indexed) {
      if (e.sep && i > 0 && title.isEmpty) items.add(const PopupMenuDivider(height: 9));
      items.add(
        PopupMenuItem<MenuEntry>(
          key: e.key == null ? null : Key(e.key!),
          value: e,
          enabled: !e.disabled,
          height: 36,
          child: _PopupRow(entry: e, theme: theme),
        ),
      );
    }
  }
  // the first row carries the menu's key (tests, like the sheet's list)
  items.insert(
    0,
    PopupMenuItem<MenuEntry>(key: Key('${key}Popup'), enabled: false, height: 0, child: const SizedBox()),
  );
  return showMenu<MenuEntry>(
    context: context,
    position: RelativeRect.fromRect(Rect.fromLTWH(p.dx, p.dy, 0, 0), Offset.zero & overlay.size),
    items: items,
    color: theme.surface,
    constraints: const BoxConstraints(minWidth: 230, maxWidth: 360),
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(8),
      side: BorderSide(color: theme.ink.withValues(alpha: 0.2)),
    ),
  );
}

/// One row of a popup: icon, label (red when dangerous), the value/subtitle, the key hint, a counter, ›.
class _PopupRow extends StatelessWidget {
  const _PopupRow({required this.entry, required this.theme});
  final MenuEntry entry;
  final BoardUiTheme theme;

  @override
  Widget build(BuildContext context) {
    final e = entry;
    final color = e.disabled ? theme.grey.withValues(alpha: 0.6) : (e.danger ? theme.danger : theme.ink);
    final hint = menuShortcuts[e.key];
    final dim = TextStyle(color: theme.grey, fontSize: 12.5);
    return Row(
      children: [
        SizedBox(width: 26, child: e.icon == null ? null : Icon(e.icon, size: 19, color: color)),
        const SizedBox(width: 8),
        Expanded(
          flex: 3,
          child: Text(
            e.label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: color, fontSize: 14),
          ),
        ),
        if (e.subtitle != null)
          Flexible(
            child: Padding(
              padding: const EdgeInsets.only(left: 12),
              child: Text(e.subtitle!, maxLines: 1, overflow: TextOverflow.ellipsis, style: dim),
            ),
          ),
        if (hint != null)
          Padding(
            padding: const EdgeInsets.only(left: 16),
            child: Text(hint, maxLines: 1, style: dim),
          ),
        if (e.badge != null)
          Padding(
            padding: const EdgeInsets.only(left: 8),
            child: _Badge(text: e.badge!, theme: theme),
          ),
        if (e.items != null) Icon(Icons.chevron_right, size: 18, color: color),
      ],
    );
  }
}
