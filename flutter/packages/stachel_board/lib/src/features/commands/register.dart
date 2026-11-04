import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/registry.dart';
import '../../features/search/search_bar.dart' show openReplace;
import 'commands_model.dart';
import 'palette.dart';

/// Q3 „Bedienung“ (web `features/tools/organize.tsx`): Clustern ohne KI and Typ
/// wechseln in the object menu (server actions `tools.cluster`, `tools.convert` – the web code computes), Suchen &
/// Ersetzen (`tools.replace`, row in the search bar) and the command palette „Befehl suchen …“ in the board menu.
///
/// Web ids and orders: object menu `tools.cluster` · 78 (submenu Farbe/Tag/Autor:in), `tools.convert` · 79 (submenu
/// of the target types); board menu `tools.boardReplace` · 11, `tools.boardPalette` · 12.
void registerCommands(BoardRegistry r) {
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.cluster',
      on: MenuTarget.object,
      order: 78,
      entry: (ui, at) {
        final sel = ui.editor.selected;
        if (!ui.editor.editable || !canCluster(sel) || !ui.controller.canAct('tools.cluster')) return null;
        return MenuEntry(
          key: 'stachelMenuCluster',
          label: 'Clustern',
          icon: Icons.dashboard_customize_outlined,
          items: [
            for (final (by, label) in clusterModes)
              MenuEntry(key: 'stachelMenuCluster-$by', label: label, onSelect: (_, ui) => clusterSelection(ui, by)),
          ],
        );
      },
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.convert',
      on: MenuTarget.object,
      order: 79,
      entry: (ui, at) {
        final targets = convertTargets(ui.editor.selected);
        if (!ui.editor.editable || targets.isEmpty || !ui.controller.canAct('tools.convert')) return null;
        return MenuEntry(
          key: 'stachelMenuConvert',
          label: 'Typ wechseln',
          icon: Icons.swap_horiz,
          items: [
            for (final t in targets)
              MenuEntry(
                key: 'stachelMenuConvert-$t',
                label: convertLabels[t]!,
                onSelect: (_, ui) => convertSelection(ui, t),
              ),
          ],
        );
      },
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.boardReplace',
      on: MenuTarget.board,
      order: 11,
      section: MenuSection.view,
      entry: (ui, at) => !ui.controller.loaded || !ui.editor.editable || !ui.controller.canAct('tools.replace')
          ? null
          : MenuEntry(
              key: 'stachelBoardReplace',
              label: 'Suchen und ersetzen',
              icon: Icons.find_replace,
              onSelect: (_, ui) => openReplace(ui),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.boardPalette',
      on: MenuTarget.board,
      order: 12,
      section: MenuSection.quick,
      entry: (ui, at) => !ui.controller.loaded
          ? null
          : MenuEntry(
              key: paletteMenuKey,
              label: 'Befehl suchen …',
              short: 'Befehl',
              icon: Icons.manage_search,
              onSelect: (context, ui) => showCommandPalette(context, ui),
            ),
    ),
  );
}

/// Clusters the selection on the server (web `clusterSelection`); afterwards everything is selected (result).
Future<void> clusterSelection(BoardUi ui, String by) => ui.controller.act('tools.cluster', {
  'ids': [for (final o in ui.editor.selected) o.id],
  'by': by,
}, label: 'Clustern');

/// Changes the type of the selection on the server (web `convertSelection`); text objects take their height again.
Future<void> convertSelection(BoardUi ui, String to) => ui.controller.act('tools.convert', {
  'ids': [for (final o in ui.editor.selected) o.id],
  'to': to,
}, label: 'Typ wechseln');
