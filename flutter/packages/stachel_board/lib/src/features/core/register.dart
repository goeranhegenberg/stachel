import 'dart:async';

import 'package:flutter/material.dart';

import '../../editor/board_editor.dart';
import '../../editor/editor_tools.dart';
import '../../editor/registry/board_ui.dart';
import '../../editor/registry/context_action_def.dart';
import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/registry.dart';
import '../../editor/registry/sheet_def.dart';
import '../../editor/registry/tool_def.dart';
import '../../editor/registry/type_behavior.dart';
import '../../mindmap/mind_model.dart';
import '../onboarding/gesture_onboarding.dart' show showGestureOnboarding;
import 'core_widgets.dart';

/// Core entries (F2, owner F2 – web `editor/core/*`): tools Auswahl · Notiz · Text · Form · Verbinder · Stift
/// (+ Radierer in the pen options) · Rahmen, the context bar's color/font/alignment/edit/connector/common entries, the
/// core menu entries (object, empty board, board) and the gestures sheet, behavior of the known types.
///
/// Orders like the web: tools 10–100, context entries 10–90 (packages put theirs in between), menus as in
/// `editor/core/menus.ts` / `features/tools/register.tsx`.
void registerCore(BoardRegistry r) {
  _tools(r);
  _contextActions(r);
  _menus(r);
  _objectLinks(r);
  _types(r);
  r.defineSheet(
    SheetDef(
      id: gesturesSheet,
      build: (context, ui, _) => GesturesHelp(ui: ui),
    ),
  );
}

/// Id of the gestures help sheet (B15, replaces the web's „Tastenkürzel“ on the phone).
const gesturesSheet = 'core.gestures';

String _where(String what) => 'Tippe auf das Board: dort kommt $what hin.';

// ---- tools (C01, C19) -------------------------------------------------------------------------------------------

void _tools(BoardRegistry r) {
  r.defineTool(
    const ToolDef(
      id: 'select',
      label: 'Auswählen',
      shortLabel: 'AUSWAHL',
      icon: Icons.near_me_outlined,
      order: 10,
      tool: BoardTool.select,
      keyName: 'stachelToolSelect',
      once: false,
    ),
  );
  r.defineTool(
    ToolDef(
      id: 'sticky',
      label: 'Haftnotiz',
      shortLabel: 'NOTIZ',
      icon: Icons.sticky_note_2_outlined,
      order: 30,
      tool: BoardTool.sticky,
      keyName: 'stachelToolSticky',
      hint: (_) => _where('die Haftnotiz'),
    ),
  );
  r.defineTool(
    ToolDef(
      id: 'text',
      label: 'Text',
      icon: Icons.title,
      order: 40,
      tool: BoardTool.text,
      keyName: 'stachelToolText',
      hint: (_) => _where('der Text'),
    ),
  );
  r.defineTool(
    ToolDef(
      id: 'shape',
      label: 'Form',
      icon: Icons.category_outlined,
      order: 50,
      tool: BoardTool.shape,
      keyName: 'stachelToolShape',
      hint: (ui) =>
          'Tippe auf das Board: dort kommt die Form hin (${shapeNames[ui.editor.shapeKind] ?? ui.editor.shapeKind}).',
      onPick: (context, ui) async {
        // the picker first (web: shape options), then the tool with that shape
        final k = await pickShape(context, ui);
        if (k == null) return;
        ui.editor
          ..shapeKind = k
          ..tool = BoardTool.shape;
      },
    ),
  );
  r.defineTool(
    ToolDef(
      id: 'connector',
      // UX-Review P9: one name for it everywhere (bar, context bar, options) – „Verbinder“ like the web
      label: 'Verbinder',
      icon: Icons.trending_flat,
      order: 60,
      tool: BoardTool.connector,
      keyName: 'stachelToolConnector',
      options: (context, ui) => ConnectorToolOptions(ui: ui),
    ),
  );
  r.defineTool(
    ToolDef(
      id: 'pen',
      label: 'Stift',
      icon: Icons.edit_outlined,
      order: 70,
      tool: BoardTool.pen,
      once: false,
      keyName: 'stachelToolPen',
      options: (context, ui) => PenToolOptions(ui: ui),
      active: (ui) => ui.editor.tool == BoardTool.pen || ui.editor.tool == BoardTool.eraser,
    ),
  );
  // the eraser lives in the pen options on the phone (one button less in the bar)
  r.defineTool(
    const ToolDef(
      id: 'eraser',
      label: 'Radierer',
      icon: Icons.auto_fix_normal,
      order: 75,
      tool: BoardTool.eraser,
      once: false,
      phone: ToolPlace.hide,
    ),
  );
  r.defineTool(
    ToolDef(
      id: 'frame',
      label: 'Rahmen',
      icon: Icons.crop_free,
      order: 80,
      tool: BoardTool.frame,
      keyName: 'stachelToolFrame',
      moreKey: 'stachelMoreFrame',
      subtitle: 'Tippe aufs Board: dort kommt der Rahmen hin',
      hint: (_) => _where('der Rahmen'),
    ),
  );
}

// ---- context bar (E01–E02, E06, E10, E12, E22) ------------------------------------------------------------------

/// Palette of a selection of one type (web `typeDef(o).palette`); null = no color entry.
List<String>? paletteOf(CtxInfo c) {
  if (c.types.length != 1) return null;
  final objs = c.selected;
  return switch (c.types.single) {
    'sticky' => stickyColors,
    'shape' || 'frame' => shapeFills,
    'text' || 'connector' => inkColors,
    'pen' => objs.every((o) => o.marker) ? markerColors : (objs.any((o) => o.marker) ? null : penColors),
    'mindnode' => mindColors,
    _ => null,
  };
}

bool _canChange(CtxInfo c, BoardUi ui) => ui.editor.editable && !c.locked;

void _contextActions(BoardRegistry r) {
  r.defineContextAction(
    ContextActionDef(
      id: 'core.color',
      order: 10,
      section: CtxSection.style,
      appliesTo: (c, ui) => _canChange(c, ui) && paletteOf(c) != null,
      items: (context, ui, c) {
        final palette = paletteOf(c)!;
        return [
          CtxItem(
            key: 'stachelCtxColor',
            primary: true,
            label: 'Farbe',
            leading: (_) => ColorSwatchDot(c.first.color ?? palette.first, ink: ui.theme.ink),
            onTap: (context, ui) async {
              final v = await pickColor(context, ui, palette);
              if (v != null) ui.editor.setField('color', v);
            },
          ),
        ];
      },
    ),
  );
  r.defineContextAction(
    ContextActionDef(
      id: 'core.font',
      order: 30,
      section: CtxSection.text,
      appliesTo: (c, ui) => _canChange(c, ui) && c.types.every(textTypes.contains),
      items: (context, ui, c) => [
        CtxItem(
          key: 'stachelCtxFont',
          label: 'Schriftgröße',
          icon: Icons.format_size,
          onTap: (context, ui) async {
            final v = await pickFontSize(context, ui, c.types);
            // notes without a size fit their text themselves (web: automatic size)
            if (v != null) ui.editor.setField('fontSize', v < 0 ? null : v);
          },
        ),
      ],
    ),
  );
  r.defineContextAction(
    ContextActionDef(
      id: 'core.format',
      order: 40,
      section: CtxSection.text,
      appliesTo: (c, ui) => _canChange(c, ui) && c.types.every(textTypes.contains),
      items: (context, ui, c) {
        final cur = c.first.align ?? (c.first.type == 'text' ? 'left' : 'center');
        return [
          CtxItem(
            key: 'stachelCtxAlign',
            label: 'Ausrichtung',
            icon: switch (cur) {
              'left' => Icons.format_align_left,
              'right' => Icons.format_align_right,
              _ => Icons.format_align_center,
            },
            onTap: (context, ui) {
              const order = ['left', 'center', 'right'];
              ui.editor.setField('align', order[(order.indexOf(cur) + 1) % 3]);
            },
          ),
        ];
      },
    ),
  );
  r.defineContextAction(
    ContextActionDef(
      id: 'core.edit',
      order: 45,
      section: CtxSection.text,
      appliesTo: (c, ui) =>
          _canChange(c, ui) && c.single != null && (textTypes.contains(c.single!.type) || c.single!.type == 'mindnode'),
      items: (context, ui, c) => [
        CtxItem(
          key: 'stachelCtxEdit',
          primary: true,
          short: 'Text',
          label: 'Text bearbeiten',
          icon: Icons.edit_outlined,
          onTap: (context, ui) => ui.view?.editText(c.single!.id),
        ),
      ],
    ),
  );
  r.defineContextAction(
    ContextActionDef(
      id: 'core.connector',
      order: 50,
      section: CtxSection.style,
      appliesTo: (c, ui) => _canChange(c, ui) && c.only('connector'),
      items: (context, ui, c) => [
        CtxItem(
          key: 'stachelCtxLineStyle',
          label: 'Linienart',
          icon: Icons.turn_slight_right,
          onTap: (context, ui) async {
            final v = await pickFromList<String>(context, ui, [
              for (final s in connectorStyles) (s, lineStyleNames[s]!),
            ], keyOf: (s) => 'stachelLineStyle-$s');
            if (v != null) ui.editor.setConnectorFields({'lineStyle': v == 'straight' ? null : v});
          },
        ),
        for (final which in const ['start', 'end'])
          CtxItem(
            key: which == 'start' ? 'stachelCtxCapStart' : 'stachelCtxCapEnd',
            label: which == 'start' ? 'Anfang' : 'Ende',
            icon: which == 'start' ? Icons.west : Icons.east,
            onTap: (context, ui) async {
              final v = await pickFromList<String>(
                context,
                ui,
                [for (final cap in connectorCaps) (cap, capNames[cap] ?? cap)],
                keyOf: (cap) => 'stachelCap-$cap',
                heading: which == 'start' ? 'SPITZE AM ANFANG' : 'SPITZE AM ENDE',
              );
              if (v != null) ui.editor.setConnectorFields(capPatch(which, v));
            },
          ),
        CtxItem(
          key: 'stachelCtxDash',
          label: 'Strichart',
          icon: Icons.more_horiz,
          onTap: (context, ui) {
            const order = [null, 'dashed', 'dotted'];
            final cur = ui.editor.selected.first.dash;
            final i = order.indexOf(cur == 'solid' ? null : cur);
            ui.editor.setConnectorFields({'dash': order[(i + 1) % order.length]});
          },
        ),
        CtxItem(
          key: 'stachelCtxWidth',
          label: 'Strichstärke',
          icon: Icons.line_weight,
          onTap: (context, ui) async {
            final v = await pickFromList<double>(
              context,
              ui,
              [
                for (final w in const [1.0, 2.0, 4.0, 8.0]) (w, '${w.round()} px'),
              ],
              keyOf: (w) => 'stachelWidth-${w.round()}',
              leading: (w) => SizedBox(
                width: 40,
                child: Center(
                  child: Container(height: w, color: ui.theme.ink),
                ),
              ),
            );
            if (v != null) ui.editor.setConnectorFields({'strokeWidth': v});
          },
        ),
        CtxItem(
          key: 'stachelCtxReverse',
          label: 'Richtung umkehren',
          icon: Icons.swap_horiz,
          onTap: (context, ui) => ui.editor.reverseConnectors(),
        ),
      ],
    ),
  );
  // web core.pen (60): stroke width 2/4/8 (also for highlighter strokes, like the web)
  r.defineContextAction(
    ContextActionDef(
      id: 'core.pen',
      order: 60,
      section: CtxSection.style,
      appliesTo: (c, ui) => _canChange(c, ui) && c.only('pen'),
      items: (context, ui, c) => [
        CtxItem(
          key: 'stachelCtxPenWidth',
          label: 'Strichstärke',
          icon: Icons.line_weight,
          onTap: (context, ui) async {
            final v = await pickFromList<double>(
              context,
              ui,
              [for (final w in penWidths) (w, 'Strichstärke ${w.round()}')],
              keyOf: (w) => 'stachelPenWidth-${w.round()}',
              leading: (w) => SizedBox(
                width: 40,
                child: Center(
                  child: Container(
                    width: w + 4,
                    height: w + 4,
                    decoration: BoxDecoration(color: ui.theme.ink, shape: BoxShape.circle),
                  ),
                ),
              ),
            );
            if (v != null) ui.editor.setField('strokeWidth', v, where: (o) => o.type == 'pen');
          },
        ),
      ],
    ),
  );
  // web core.common (90): duplicate, layer, delete (lock: P1)
  r.defineContextAction(
    ContextActionDef(
      id: 'core.common',
      order: 90,
      section: CtxSection.arrange,
      appliesTo: (c, ui) => _canChange(c, ui),
      items: (context, ui, c) => [
        CtxItem(
          key: 'stachelCtxDuplicate',
          primary: true,
          label: 'Duplizieren',
          icon: Icons.copy_all_outlined,
          onTap: (context, ui) => ui.editor.duplicateSelection(),
        ),
        CtxItem(
          key: 'stachelCtxFront',
          label: 'Nach vorne',
          icon: Icons.flip_to_front,
          onTap: (context, ui) => ui.editor.order(toFront: true),
        ),
        CtxItem(
          key: 'stachelCtxBack',
          label: 'Nach hinten',
          icon: Icons.flip_to_back,
          onTap: (context, ui) => ui.editor.order(toFront: false),
        ),
        CtxItem(
          key: 'stachelCtxDelete',
          primary: true,
          label: 'Löschen',
          icon: Icons.delete_outline,
          danger: true,
          onTap: (context, ui) async {
            if (await confirmDelete(context, ui)) ui.editor.deleteSelection();
          },
        ),
      ],
    ),
  );
}

/// Link and browser for one object (also read only): `/b/<id>?o=<obj>` and the web opened on it (E23).
void _objectLinks(BoardRegistry r) {
  r.defineContextAction(
    ContextActionDef(
      id: 'tools.copyLink',
      order: 95,
      section: CtxSection.link,
      appliesTo: (c, ui) => c.single != null,
      items: (context, ui, c) => [
        CtxItem(
          key: 'stachelObjectLink',
          label: 'Link kopieren',
          icon: Icons.link,
          onTap: (_, ui) => ui.host.copyLink(objectId: c.single!.id),
        ),
        CtxItem(
          key: 'stachelObjectBrowser',
          label: 'Im Browser öffnen',
          icon: Icons.open_in_browser,
          onTap: (_, ui) => ui.host.openInBrowser(objectId: c.single!.id),
        ),
      ],
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.copyLink',
      on: MenuTarget.object,
      order: 85,
      entry: (ui, at) {
        final o = ui.editor.single;
        if (o == null) return null;
        return MenuEntry(
          key: 'stachelMenuLink',
          label: 'Link kopieren',
          icon: Icons.link,
          onSelect: (_, ui) => ui.host.copyLink(objectId: o.id),
        );
      },
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'app.objectBrowser',
      on: MenuTarget.object,
      order: 87,
      entry: (ui, at) {
        final o = ui.editor.single;
        if (o == null) return null;
        return MenuEntry(
          key: 'stachelMenuBrowser',
          label: 'Im Browser öffnen',
          icon: Icons.open_in_browser,
          onSelect: (_, ui) => ui.host.openInBrowser(objectId: o.id),
        );
      },
    ),
  );
}

/// Runs the registry's delete guards (mind nodes with subtopics ask first); true = delete.
Future<bool> confirmDelete(BuildContext context, BoardUi ui) async {
  for (final g in ui.registry.deleteGuards) {
    if (!context.mounted || !await g(context, ui)) return false;
  }
  return true;
}

// ---- menus (D42, D43, B09) --------------------------------------------------------------------------------------

void _menus(BoardRegistry r) {
  // object (long press 500 ms)
  r.defineMenuItem(
    MenuItemDef(
      id: 'core.addToSelection',
      on: MenuTarget.object,
      order: 5,
      entry: (ui, at) {
        final before = ui.view?.selectionBeforeMenu ?? const <String>{};
        final id = at.objectId;
        if (id == null || before.isEmpty || before.contains(id)) return null;
        return MenuEntry(
          key: 'stachelMenuAddToSelection',
          label: 'Zur Auswahl hinzufügen',
          icon: Icons.library_add_outlined,
          onSelect: (context, ui) {
            ui.editor.select({...before, ...ui.editor.groupOf(id)});
            ui.editor.multiSelect = true;
          },
        );
      },
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'object.duplicate',
      on: MenuTarget.object,
      order: 30,
      entry: (ui, at) => !ui.editor.editable
          ? null
          : MenuEntry(
              key: 'stachelMenuDuplicate',
              label: 'Duplizieren',
              icon: Icons.copy_all_outlined,
              onSelect: (c, ui) => ui.editor.duplicateSelection(),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'object.front',
      on: MenuTarget.object,
      order: 40,
      entry: (ui, at) {
        if (!ui.editor.editable) return null;
        final locked = ui.editor.selected.every((o) => o.locked);
        return MenuEntry(
          key: 'stachelMenuLayer',
          label: 'Ebene',
          icon: Icons.layers_outlined,
          sep: true,
          disabled: locked,
          items: [
            MenuEntry(
              key: 'stachelMenuFront',
              label: 'Ganz nach vorne',
              onSelect: (c, ui) => ui.editor.order(toFront: true),
            ),
            MenuEntry(
              key: 'stachelMenuBack',
              label: 'Ganz nach hinten',
              onSelect: (c, ui) => ui.editor.order(toFront: false),
            ),
          ],
        );
      },
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'object.edit',
      on: MenuTarget.object,
      order: 45,
      entry: (ui, at) {
        final o = ui.editor.single;
        if (o == null || !ui.editor.editable || o.locked || !(textTypes.contains(o.type) || o.type == 'mindnode')) {
          return null;
        }
        return MenuEntry(
          key: 'stachelMenuEdit',
          label: 'Text bearbeiten',
          icon: Icons.edit_outlined,
          onSelect: (c, ui) => ui.view?.editText(o.id),
        );
      },
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'object.zoom',
      on: MenuTarget.object,
      order: 80,
      entry: (ui, at) => MenuEntry(
        key: 'stachelMenuZoom',
        label: 'Auf Auswahl zoomen',
        icon: Icons.zoom_in_map,
        onSelect: (c, ui) => ui.view?.zoomToSelection(),
      ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'object.delete',
      on: MenuTarget.object,
      order: 100,
      entry: (ui, at) => !ui.editor.editable
          ? null
          : MenuEntry(
              key: 'stachelMenuDelete',
              label: 'Löschen',
              icon: Icons.delete_outline,
              danger: true,
              sep: true,
              disabled: ui.editor.selected.every((o) => o.locked),
              onSelect: (context, ui) async {
                if (await confirmDelete(context, ui)) ui.editor.deleteSelection();
              },
            ),
    ),
  );

  // empty board (long press); app extras „… hier“ first (they were there before the web entries)
  MenuItemDef here(String id, double order, String key, String label, IconData icon, String type) => MenuItemDef(
    id: id,
    on: MenuTarget.canvas,
    order: order,
    entry: (ui, at) => !ui.editor.editable
        ? null
        : MenuEntry(
            key: key,
            label: label,
            icon: icon,
            onSelect: (c, ui) {
              final nid = ui.editor.create(type, at.world);
              if (nid != null) ui.view?.editText(nid);
            },
          ),
  );
  r.defineMenuItem(
    here('canvas.sticky', 1, 'stachelHereSticky', 'Haftnotiz hier', Icons.sticky_note_2_outlined, 'sticky'),
  );
  r.defineMenuItem(here('canvas.text', 2, 'stachelHereText', 'Text hier', Icons.title, 'text'));
  r.defineMenuItem(
    MenuItemDef(
      id: 'canvas.selectAll',
      on: MenuTarget.canvas,
      order: 20,
      entry: (ui, at) => MenuEntry(
        key: 'stachelSelectAll',
        label: 'Alles auswählen',
        icon: Icons.select_all,
        sep: true,
        onSelect: (c, ui) => ui.editor.selectAll(),
      ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'canvas.fit',
      on: MenuTarget.canvas,
      order: 30,
      entry: (ui, at) => MenuEntry(
        key: 'stachelFitAll',
        label: 'Alles einpassen',
        icon: Icons.fit_screen_outlined,
        onSelect: (c, ui) => ui.view?.fitAll(),
      ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.canvasUndo',
      on: MenuTarget.canvas,
      order: 70,
      entry: (ui, at) => !ui.controller.mayEdit
          ? null
          : MenuEntry(
              key: 'stachelMenuUndo',
              label: 'Rückgängig',
              icon: Icons.undo,
              sep: true,
              disabled: !ui.controller.canUndo || !ui.editor.editable,
              onSelect: (c, ui) => ui.controller.undo(),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.canvasRedo',
      on: MenuTarget.canvas,
      order: 71,
      entry: (ui, at) => !ui.controller.mayEdit
          ? null
          : MenuEntry(
              key: 'stachelMenuRedo',
              label: 'Wiederholen',
              icon: Icons.redo,
              disabled: !ui.controller.canRedo || !ui.editor.editable,
              onSelect: (c, ui) => ui.controller.redo(),
            ),
    ),
  );

  // board menu „···“ (B09, web order; app extras: browser, 100 %, gestures)
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.boardLink',
      on: MenuTarget.board,
      order: 30,
      section: MenuSection.more,
      entry: (ui, at) => MenuEntry(
        key: 'stachelBoardCopyLink',
        label: 'Link zum Board kopieren',
        icon: Icons.link,
        onSelect: (c, ui) => ui.host.copyLink(),
      ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'app.browser',
      on: MenuTarget.board,
      order: 31,
      section: MenuSection.more,
      entry: (ui, at) => MenuEntry(
        key: 'stachelBoardBrowser',
        label: 'Im Browser öffnen',
        icon: Icons.open_in_browser,
        onSelect: (c, ui) => ui.host.openInBrowser(),
      ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'view.zoom100',
      on: MenuTarget.board,
      order: 58,
      section: MenuSection.view,
      entry: (ui, at) => !ui.controller.loaded
          ? null
          : MenuEntry(
              key: 'stachelBoardZoom100',
              label: 'Auf 100 % zoomen',
              icon: Icons.center_focus_strong_outlined,
              onSelect: (c, ui) => ui.view?.zoomTo100(),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'core.gestures',
      on: MenuTarget.board,
      order: 90,
      section: MenuSection.more,
      entry: (ui, at) => MenuEntry(
        key: 'stachelBoardGestures',
        label: 'Gesten',
        icon: Icons.touch_app_outlined,
        onSelect: (context, ui) => ui.openRegisteredSheet(context, gesturesSheet),
      ),
    ),
  );
}

// ---- types --------------------------------------------------------------------------------------------------------

void _types(BoardRegistry r) {
  const labels = {
    'sticky': ('Haftnotiz', 'text'),
    'text': ('Text', 'text'),
    'shape': ('Form', 'text'),
    'connector': ('Verbinder', 'label'),
    'pen': ('Stiftstrich', null),
    'frame': ('Rahmen', 'title'),
    'image': ('Bild', null),
    'card': ('Karte', null),
    'table': ('Tabelle', null),
    'mindnode': ('Mindmap', 'text'),
    'timeline': ('Zeitleiste', null),
    'sticker': ('Sticker', null),
    'icon': ('Icon', null),
    'document': ('PDF', null),
  };
  for (final e in labels.entries) {
    r.defineType(TypeBehavior(type: e.key, label: e.value.$1, edit: e.value.$2));
  }
}

// ---- gestures help (B15) ------------------------------------------------------------------------------------------

/// What the fingers do on the board (phone counterpart of the web's shortcut overview, B14/B15).
class GesturesHelp extends StatelessWidget {
  const GesturesHelp({super.key, required this.ui});
  final BoardUi ui;

  static const rows = [
    (
      Icons.touch_app_outlined,
      'Tippen',
      'Objekt auswählen (samt Gruppe); nochmal tippen schreibt in Notiz, Text oder Form',
    ),
    (Icons.ads_click, 'Doppeltippen auf leere Fläche', 'Neue Haftnotiz an dieser Stelle'),
    (Icons.group_work_outlined, 'Doppeltippen in eine gewählte Gruppe', 'Nur dieses Objekt auswählen'),
    (Icons.pan_tool_outlined, 'Ein Finger ziehen', 'Ansicht verschieben; ein ausgewähltes Objekt verschiebt sich'),
    (Icons.back_hand_outlined, 'Kurz halten und ziehen', 'Objekt greifen und verschieben (auch nicht ausgewählt)'),
    (Icons.menu_open, 'Lange drücken (still halten)', 'Menü des Objekts bzw. der freien Stelle'),
    (Icons.highlight_alt, 'Auf leerer Fläche halten und ziehen', 'Rechteck-Auswahl'),
    (
      Icons.library_add_check_outlined,
      '„Mehrere wählen“ (Leiste)',
      'Weitere Objekte antippen, um sie hinzuzufügen oder herauszunehmen; endet nach dem Verschieben',
    ),
    (Icons.pinch_outlined, 'Zwei Finger', 'Zoomen und verschieben'),
    (Icons.undo, 'Mit zwei Fingern tippen', 'Rückgängig'), // UX P13
    (Icons.redo, 'Mit drei Fingern tippen', 'Wiederholen'), // UX P13
    (Icons.filter_2_outlined, 'Doppeltippen mit zwei Fingern', 'Auf 100 % zoomen'),
  ];

  @override
  Widget build(BuildContext context) => SafeArea(
    child: ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.8),
      child: ListView(
        key: const Key('stachelGesturesSheet'),
        shrinkWrap: true,
        children: [
          ListTile(title: Text('GESTEN', style: ui.theme.label(size: 15))),
          for (final (icon, title, text) in rows)
            ListTile(
              dense: true,
              leading: Icon(icon, color: ui.theme.ink),
              title: Text(title),
              subtitle: Text(text),
            ),
          // UX P5: the introduction with pictures again
          ListTile(
            key: const Key('stachelGesturesOnboarding'),
            leading: Icon(Icons.school_outlined, color: ui.theme.accentDark),
            title: Text('Einführung mit Bildern ansehen', style: TextStyle(color: ui.theme.accentDark)),
            onTap: () {
              final nav = Navigator.of(context);
              nav.pop();
              unawaited(showGestureOnboarding(nav.context, ui));
            },
          ),
        ],
      ),
    ),
  );
}
