import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/registry.dart';
import '../../editor/registry/sheet_def.dart';
import '../versions/admin_host.dart';
import 'export_pages.dart';
import 'export_sheet.dart';

/// P6: Export PNG/PDF mit dem App-Painter, Bereiche, Qualität, Teilen.
///
/// Owner: P6 (parity audit §4, rows N05–N08). Stub from F2 – only this directory (`features/export/`, tests
/// `test/features/export/`) belongs to the package; core files change only through the registries and `act`.
///
/// Entries to define (web id · order):
/// - Board-Menü `tools.boardExport` · 20, `tools.boardDuplicate` · 32, `tools.boardTemplate` · 34
/// - Fläche `tools.canvasExport` · 50, Objekt-Menü `tools.exportSelection` · 86
void registerExport(BoardRegistry r) {
  r.defineSheet(
    SheetDef(
      id: exportSheet,
      build: (context, ui, args) => ExportSheet(
        ui: ui,
        area: args['area'] is ExportArea ? args['area'] as ExportArea : null,
        format: args['format'] is ExportFormat ? args['format'] as ExportFormat : null,
      ),
    ),
  );
  // ---- board menu (web `features/tools/register.tsx`) ----
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.boardExport',
      on: MenuTarget.board,
      order: 20,
      section: MenuSection.board,
      sectionOrder: 19,
      entry: (ui, at) => !_ready(ui)
          ? null
          : MenuEntry(
              key: 'stachelBoardExport',
              label: 'Exportieren …',
              icon: Icons.ios_share,
              onSelect: (context, ui) => openExportSheet(context, ui),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.boardDuplicate',
      on: MenuTarget.board,
      order: 32,
      section: MenuSection.board,
      entry: (ui, at) => !_ready(ui)
          ? null
          : MenuEntry(
              key: 'stachelBoardDuplicate',
              label: 'Board duplizieren',
              icon: Icons.copy_all_outlined,
              onSelect: (context, ui) => _copy(ui, template: false),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.boardTemplate',
      on: MenuTarget.board,
      order: 34,
      section: MenuSection.board,
      entry: (ui, at) => !_ready(ui)
          ? null
          : MenuEntry(
              key: 'stachelBoardTemplate',
              label: 'Als Vorlage speichern',
              icon: Icons.dashboard_customize_outlined,
              onSelect: (context, ui) => _copy(ui, template: true),
            ),
    ),
  );
  // ---- empty board (long press) ----
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.canvasExport',
      on: MenuTarget.canvas,
      order: 50,
      entry: (ui, at) => !_ready(ui)
          ? null
          : MenuEntry(
              key: 'stachelCanvasExport',
              label: 'Board exportieren …',
              icon: Icons.ios_share,
              onSelect: (context, ui) => openExportSheet(context, ui, area: const ExportBoardArea()),
            ),
    ),
  );
  // ---- object menu ----
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.exportSelection',
      on: MenuTarget.object,
      order: 86,
      entry: (ui, at) {
        if (!_ready(ui)) return null;
        final sel = ui.selected;
        final frame = sel.length == 1 && sel.first.type == 'frame' ? sel.first : null;
        return MenuEntry(
          key: 'stachelObjectExport',
          label: frame != null ? 'Rahmen exportieren …' : 'Als Bild exportieren …',
          icon: Icons.ios_share,
          onSelect: (context, ui) => openExportSheet(
            context,
            ui,
            area: frame != null ? ExportFrameArea(frame.id) : const ExportSelectionArea(),
          ),
        );
      },
    ),
  );
}

/// Id of the export sheet (args `area`: [ExportArea], `format`: [ExportFormat]).
const exportSheet = 'tools.export';

/// Opens the export sheet (web `openExport`).
Future<Object?>? openExportSheet(BuildContext context, BoardUi ui, {ExportArea? area, ExportFormat? format}) =>
    ui.openRegisteredSheet(context, exportSheet, args: {'area': ?area, 'format': ?format});

/// The app can share files and the board is there.
bool _ready(BoardUi ui) => adminHost(ui) != null && ui.controller.loaded;

/// „Board duplizieren“ (the host opens the copy) / „Als Vorlage speichern“ (web `copyBoard`).
Future<void> _copy(BoardUi ui, {required bool template}) async {
  final host = adminHost(ui);
  if (host == null) return;
  try {
    if (template) {
      await host.saveAsTemplate();
      ui.hints.show('Als Vorlage gespeichert. Du findest sie in der Board-Übersicht.');
    } else {
      await host.duplicateBoard();
    }
  } catch (e) {
    ui.hints.show(host.errorText(e));
  }
}
