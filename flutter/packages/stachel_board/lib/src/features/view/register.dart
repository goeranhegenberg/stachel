import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import '../../editor/registry/sheet_def.dart';
import 'board_background.dart';
import 'view_camera.dart';
import 'view_layers.dart';
import 'view_state.dart';

/// P4: Zoom-Leiste/-Menü, Auf Auswahl zoomen, Minimap, Hintergrund (act `tools.settings`) + Einstellungs-Blatt, Raster,
/// Oberfläche ausblenden, immersiv, Start-Zoom 35 % (parity audit §4, rows M02–M03, M05–M06, M08, M10–M15).
///
/// Web ids and orders: board menu `tools.boardGrid` · 40, `view.hideUi` · 56, `view.fullscreen` · 57,
/// `tools.boardSettings` · 80; empty board `tools.canvasGrid` · 60, `tools.canvasSettings` · 65; object menu
/// `object.zoom` · 80 (replaced: animated, max 200 %); overlay `view.layer` (zoom bar, minimap, eye, background).
void registerView(BoardRegistry r) {
  r.startCamera = phoneStartCamera;
  // also while presenting (it hides itself then) – leaving the tree would end the fullscreen
  r.defineOverlay(
    OverlayDef(
      id: 'view.layer',
      order: 90,
      presenting: true,
      build: (context, ui) => ViewLayer(ui: ui),
    ),
  );
  r.defineSheet(
    SheetDef(
      id: boardSettingsSheet,
      build: (context, ui, _) => BoardSettingsSheet(ui: ui),
    ),
  );

  // grid on/off (web: „Raster anzeigen“ An/Aus, toggles between „Leer“ and the last pattern)
  MenuEntry? grid(BoardUi ui, {required bool board}) {
    if (!canWriteSettings(ui)) return null;
    final on = boardSettingsOf(ui).pattern != 'none';
    return MenuEntry(
      key: board ? 'stachelBoardGrid' : 'stachelCanvasGrid',
      label: board ? 'Raster anzeigen' : (on ? 'Raster ausblenden' : 'Raster einblenden'),
      subtitle: board ? (on ? 'An' : 'Aus') : null,
      icon: on ? Icons.grid_on : Icons.grid_off,
      sep: board,
      onSelect: (_, ui) => writeBoardSettings(ui, toggleGrid: true),
    );
  }

  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.boardGrid',
      on: MenuTarget.board,
      order: 40,
      section: MenuSection.view,
      entry: (ui, at) => grid(ui, board: true),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(id: 'tools.canvasGrid', on: MenuTarget.canvas, order: 60, entry: (ui, at) => grid(ui, board: false)),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'view.hideUi',
      on: MenuTarget.board,
      order: 56,
      section: MenuSection.view,
      entry: (ui, at) => !ui.controller.loaded
          ? null
          : MenuEntry(
              key: 'stachelBoardHideUi',
              label: 'Oberfläche ausblenden',
              icon: Icons.visibility_off_outlined,
              onSelect: (_, ui) => toggleUi(ui),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'view.fullscreen',
      on: MenuTarget.board,
      order: 57,
      section: MenuSection.view,
      entry: (ui, at) {
        final s = BoardViewPrefs.of(ui);
        final on = s.immersive.value;
        return MenuEntry(
          key: 'stachelBoardFullscreen',
          label: on ? 'Vollbild beenden' : 'Vollbild',
          icon: on ? Icons.fullscreen_exit : Icons.fullscreen,
          onSelect: (_, ui) => BoardViewPrefs.of(ui).setImmersive(!on),
        );
      },
    ),
  );
  MenuEntry? settings(BoardUi ui, {required bool board}) => !ui.controller.loaded
      ? null
      : MenuEntry(
          key: board ? 'stachelBoardSettings' : 'stachelCanvasSettings',
          label: board ? 'Board-Einstellungen …' : 'Hintergrund & Raster …',
          icon: Icons.tune,
          sep: board,
          onSelect: (context, ui) => ui.openRegisteredSheet(context, boardSettingsSheet),
        );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.boardSettings',
      on: MenuTarget.board,
      order: 80,
      section: MenuSection.board,
      entry: (ui, at) => settings(ui, board: true),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.canvasSettings',
      on: MenuTarget.canvas,
      order: 65,
      entry: (ui, at) => settings(ui, board: false),
    ),
  );
  // „Auf Auswahl zoomen“: animated, at most 200 % (web `zoomToSelection` → `fitTo(b, 2)`)
  r.defineMenuItem(
    MenuItemDef(
      id: 'object.zoom',
      on: MenuTarget.object,
      order: 80,
      entry: (ui, at) => MenuEntry(
        key: 'stachelMenuZoom',
        label: 'Auf Auswahl zoomen',
        icon: Icons.zoom_in_map,
        onSelect: (c, ui) => zoomToSelection(ui),
      ),
    ),
  );
}
