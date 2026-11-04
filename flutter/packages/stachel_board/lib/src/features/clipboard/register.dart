import 'package:flutter/material.dart';

import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/registry.dart';
import 'clipboard.dart';

/// P1: Kopieren/Ausschneiden/Einfügen (audit D20–D22, web `editor/core/menus.ts` and `features/tools/register.tsx`):
/// object menu `object.copy` · 10, `tools.cut` · 15, `object.paste` · 20, empty board `canvas.paste` · 10.
void registerClipboard(BoardRegistry r) {
  r.defineMenuItem(
    MenuItemDef(
      id: 'object.copy',
      on: MenuTarget.object,
      order: 10,
      entry: (ui, at) => MenuEntry(
        key: 'stachelMenuCopy',
        label: 'Kopieren',
        icon: Icons.copy,
        onSelect: (c, ui) => copySelection(ui),
      ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.cut',
      on: MenuTarget.object,
      order: 15,
      entry: (ui, at) => !ui.editor.editable
          ? null
          : MenuEntry(
              key: 'stachelMenuCut',
              label: 'Ausschneiden',
              icon: Icons.content_cut,
              disabled: ui.editor.selected.isNotEmpty && ui.editor.selected.every((o) => o.locked),
              onSelect: (c, ui) => cutSelection(ui),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'object.paste',
      on: MenuTarget.object,
      order: 20,
      entry: (ui, at) => !ui.editor.editable
          ? null
          : MenuEntry(
              key: 'stachelMenuPaste',
              label: 'Einfügen',
              icon: Icons.content_paste,
              onSelect: (c, ui) => pasteAt(ui, at.world, context: c),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'canvas.paste',
      on: MenuTarget.canvas,
      order: 10,
      entry: (ui, at) => !ui.editor.editable
          ? null
          : MenuEntry(
              key: 'stachelPaste',
              label: 'Einfügen',
              icon: Icons.content_paste,
              onSelect: (c, ui) => pasteAt(ui, at.world, context: c),
            ),
    ),
  );
}
