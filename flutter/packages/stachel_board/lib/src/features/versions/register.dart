import 'package:flutter/material.dart';

import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/registry.dart';
import '../../editor/registry/sheet_def.dart';
import 'admin_host.dart';
import 'versions_session.dart';
import 'versions_sheet.dart';

/// P6: Versionsverlauf, schreibgeschützte Vorschau (zweite `BoardState`-Quelle).
///
/// Owner: P6 (parity audit §4, rows N01–N06). Only this directory (`features/versions/`, tests
/// `test/features/versions/`) belongs to the package; core files change only through the registries and `act`.
///
/// Entries (web id · order):
/// - Board-Menü `versions.history` · 36 („Versionsverlauf“, nur mit [BoardAdminHost], geladenem Board und Rolle
///   `edit`/`owner` – der Server gibt den Verlauf nur Bearbeitenden, `ROUTE_ROLES` in `server/src/access.ts`)
/// - Blatt `versions.list` (Liste nach Tagen, speichern, benennen, wiederherstellen, als Kopie öffnen; Antippen zeigt
///   die Version schreibgeschützt: `VersionPreviewScreen`)
void registerVersions(BoardRegistry r) {
  r.defineMenuItem(
    MenuItemDef(
      id: 'versions.history',
      on: MenuTarget.board,
      order: 36,
      section: MenuSection.board,
      entry: (ui, at) => adminHost(ui) == null || !ui.controller.loaded || !ui.controller.mayEdit
          ? null
          : MenuEntry(
              key: 'stachelBoardVersions',
              label: 'Versionsverlauf',
              icon: Icons.history,
              onSelect: (context, ui) => ui.openRegisteredSheet(context, versionsSheet),
            ),
    ),
  );
  r.defineSheet(
    SheetDef(
      id: versionsSheet,
      build: (context, ui, _) => VersionsSheet(ui: ui),
    ),
  );
}
