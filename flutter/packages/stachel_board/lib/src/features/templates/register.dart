import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/registry.dart';
import '../../editor/registry/sheet_def.dart';
import '../../editor/registry/tool_def.dart';
import 'own_templates.dart' show OwnTemplatesHost;
import 'template_widgets.dart';

/// P3: Vorlagen-Galerie, Vorlage einfügen (act `structure.template`), „Einfügen als …“ (act `structure.paste`).
///
/// Owner: P3 (parity audit §4, rows C14, D23, I29–I30). Only this directory (`features/templates/`, tests
/// `test/features/templates/`) belongs to the package; core files change only through the registries and `act`.
///
/// Entries (web id · order): tool `structure.templates` · 101 (action → sheet), board menu `structure.templates` · 20,
/// empty board `structure.templatesCanvas` · 35, object menu `structure.saveTemplate` · 80 (Q2, own templates), sheets `structure.templates` and `structure.paste` (the clipboard
/// package opens the latter with [showPasteAs] for table data / several lines).
void registerTemplates(BoardRegistry r) {
  bool can(BoardUi ui) => ui.editor.editable && ui.controller.canAct('structure.template');
  r.defineTool(
    ToolDef(
      id: 'structure.templates',
      label: 'Vorlagen',
      icon: Icons.dashboard_customize_outlined,
      order: 101,
      keyName: 'stachelToolTemplates',
      moreKey: 'stachelMoreTemplates',
      subtitle: 'Kanban, Retro, Mindmap, Schichtplan …',
      available: can,
      onPick: (context, ui) async => ui.openRegisteredSheet(context, templatesSheet),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'structure.templates',
      on: MenuTarget.board,
      order: 20,
      section: MenuSection.board,
      entry: (ui, at) => !can(ui)
          ? null
          : MenuEntry(
              key: 'stachelBoardTemplates',
              label: 'Vorlage einfügen …',
              icon: Icons.dashboard_customize_outlined,
              onSelect: (context, ui) => ui.openRegisteredSheet(context, templatesSheet),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'structure.templatesCanvas',
      on: MenuTarget.canvas,
      order: 35,
      entry: (ui, at) => !can(ui)
          ? null
          : MenuEntry(
              key: 'stachelCanvasTemplates',
              label: 'Vorlage einfügen …',
              icon: Icons.dashboard_customize_outlined,
              sep: true,
              onSelect: (context, ui) => ui.openRegisteredSheet(context, templatesSheet),
            ),
    ),
  );
  // Q2: „Auswahl als Vorlage speichern …“ (web `structure.saveTemplate`, object menu · 80) – needs the host's REST
  // access to own templates; viewing is enough (it copies, like the web)
  r.defineMenuItem(
    MenuItemDef(
      id: 'structure.saveTemplate',
      on: MenuTarget.object,
      order: 80,
      entry: (ui, at) => ui.host is! OwnTemplatesHost || ui.editor.selection.value.isEmpty
          ? null
          : MenuEntry(
              key: 'stachelSaveSelectionTemplate',
              label: 'Auswahl als Vorlage speichern …',
              icon: Icons.bookmark_add_outlined,
              onSelect: saveSelectionAsTemplate,
            ),
    ),
  );
  r.defineSheet(SheetDef(id: templatesSheet, build: buildTemplatesSheet, closeOnSelectionChange: false));
  r.defineSheet(
    SheetDef(id: pasteSheet, build: buildPasteSheet, closeOnSelectionChange: false, scrollControlled: false),
  );
}
