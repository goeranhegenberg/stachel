import 'package:flutter/material.dart';

import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/registry.dart';
import '../../editor/registry/sheet_def.dart';
import '../versions/admin_host.dart';
import 'mcp_sheet.dart';

/// P6: KI-Zugang (MCP): Tokens anlegen/teilen/widerrufen (Göran 2026-11-02: wie im Web auch in der App).
///
/// Owner: P6 (parity audit §4, rows B13). Only this directory (`features/mcp/`, tests `test/features/mcp/`) belongs
/// to the package; core files change only through the registries and `act`.
///
/// Entries (web id · order):
/// - Board-Menü `mcp.tokens` · 85 „KI-Zugang (MCP) …“
/// - Blatt `mcp.tokens`
void registerMcp(BoardRegistry r) {
  r.defineSheet(
    SheetDef(
      id: mcpSheet,
      build: (context, ui, args) {
        final host = adminHost(ui);
        return host == null ? const SizedBox.shrink() : McpSheet(ui: ui, host: host);
      },
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'mcp.tokens',
      on: MenuTarget.board,
      order: 85,
      section: MenuSection.more,
      entry: (ui, at) => adminHost(ui) == null
          ? null
          : MenuEntry(
              key: 'stachelBoardMcp',
              label: 'KI-Zugang (MCP) …',
              icon: Icons.smart_toy_outlined,
              onSelect: (context, ui) => ui.openRegisteredSheet(context, mcpSheet),
            ),
    ),
  );
}
