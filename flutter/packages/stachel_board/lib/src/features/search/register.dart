import 'package:flutter/material.dart';

import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import 'search_bar.dart';

/// P4: Suche auf dem Board (M13; port of `findMatch`/plain text per type, checked against the web's reference values).
///
/// Web ids and orders: board menu `tools.boardSearch` · 10, empty board `tools.canvasSearch` · 40; overlay
/// `tools.search` (bar at the top, hits highlighted).
void registerSearch(BoardRegistry r) {
  r.defineOverlay(
    OverlayDef(
      id: 'tools.search',
      order: 50,
      build: (context, ui) => BoardSearchLayer(ui: ui),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.boardSearch',
      on: MenuTarget.board,
      order: 10,
      section: MenuSection.quick,
      sectionOrder: 3,
      entry: (ui, at) => !ui.controller.loaded
          ? null
          : MenuEntry(
              key: 'stachelBoardSearch',
              label: 'Auf dem Board suchen',
              short: 'Suchen',
              icon: Icons.search,
              onSelect: (_, ui) => openSearch(ui),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.canvasSearch',
      on: MenuTarget.canvas,
      order: 40,
      entry: (ui, at) => MenuEntry(
        key: 'stachelCanvasSearch',
        label: 'Auf dem Board suchen',
        icon: Icons.search,
        sep: true,
        onSelect: (_, ui) => openSearch(ui),
      ),
    ),
  );
}
