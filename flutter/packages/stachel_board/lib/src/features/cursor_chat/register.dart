import 'package:flutter/material.dart';

import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import 'chat_layer.dart';

/// P5: Kurznachricht am Cursor (Presence `collab.chat`).
///
/// Owner: P5 (parity audit §4, rows L18–L19). Only this directory (`features/cursor_chat/`, tests
/// `test/features/cursor_chat/`) belongs to the package; core files change only through the registries and `act`.
///
/// Entries (web id · order):
/// - Overlay `collab.chat` · 25 (not while presenting)
/// - Board-Menü `collab.cursorChat` · 52 „Kurznachricht“ (web: key `/` at the mouse pointer)
void registerCursorChat(BoardRegistry r) {
  r.defineOverlay(
    OverlayDef(
      id: 'collab.chat',
      order: 25,
      build: (context, ui) => CursorChatLayer(ui: ui),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'collab.cursorChat',
      on: MenuTarget.board,
      order: 52,
      section: MenuSection.collab,
      entry: (ui, at) => !ui.controller.features.contains('extra') || !ui.controller.loaded
          ? null
          : MenuEntry(
              key: 'collabMenuChat',
              label: 'Kurznachricht',
              subtitle: 'Erscheint bei den anderen in der Mitte deines Ausschnitts',
              icon: Icons.chat_bubble_outline,
              onSelect: (_, ui) => CursorChatRuntime.of(ui).start(),
            ),
    ),
  );
}
