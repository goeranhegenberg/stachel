import 'package:flutter/material.dart';

import '../../editor/board_editor.dart';
import '../../editor/registry/board_ui.dart';
import '../../editor/registry/context_action_def.dart';
import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import '../../editor/registry/tool_def.dart';
import '../../editor/ui/board_overlays.dart';
import '../../render/board_scene.dart';
import '../core/core_widgets.dart';
import 'arrange.dart';
import 'arrange_widgets.dart';

/// P1: Ausrichten, Verteilen, Gruppieren, Ebenen, Sperren, Ausblenden, Link zu …, Format-Pinsel, Tags (audit C02,
/// D08–D12, D27–D31, E22) – the web's entries with their ids and orders (`editor/core/contextActions.tsx`,
/// `editor/core/menus.ts`, `features/tools/register.tsx`, `tags.tsx`, `linkTo.tsx`, `formatPainter.tsx`).
void registerArrange(BoardRegistry r) {
  _selectTool(r);
  _contextActions(r);
  _objectMenu(r);
  _boardMenus(r);
  r.defineOverlay(
    OverlayDef(
      id: 'tools.linkTo',
      order: 61,
      presenting: true,
      build: (context, ui) => ArrangeOverlay(ui: ui),
    ),
  );
}

bool _act(BoardUi ui, String name) => ui.controller.canAct(name);

// ---- select tool with its options (C02) ---------------------------------------------------------------------------

void _selectTool(BoardRegistry r) {
  r.defineTool(
    ToolDef(
      id: 'select',
      label: 'Auswählen',
      shortLabel: 'AUSWAHL',
      icon: Icons.near_me_outlined,
      order: 10,
      tool: BoardTool.select,
      keyName: 'stachelToolSelect',
      once: false,
      // like the web: the second tap on „Auswählen“ opens its options (rectangle / lasso)
      onPick: (context, ui) async {
        if (ui.editor.tool != BoardTool.select) {
          ui.editor.tool = BoardTool.select;
          return;
        }
        final lasso = await pickFromList<bool>(
          context,
          ui,
          const [(false, 'Rechteck-Auswahl'), (true, 'Lasso-Auswahl')],
          keyOf: (v) => v ? 'stachelSelectLasso' : 'stachelSelectRect',
          heading: 'AUSWÄHLEN (HALTEN UND ZIEHEN)',
        );
        if (lasso != null) ui.editor.lasso = lasso;
      },
    ),
  );
}

// ---- context bar --------------------------------------------------------------------------------------------------

void _contextActions(BoardRegistry r) {
  // web core.arrange (70): „Ausrichten“ from two units, group / ungroup
  r.defineContextAction(
    ContextActionDef(
      id: 'core.arrange',
      order: 70,
      section: CtxSection.arrange,
      appliesTo: (c, ui) => ui.editor.editable && c.selected.length > 1,
      items: (context, ui, c) => [
        if (arrangeUnitCount(ui) >= 2 && _act(ui, 'core.align'))
          CtxItem(
            key: 'stachelCtxArrange',
            label: 'Ausrichten',
            icon: Icons.align_horizontal_left,
            onTap: (context, ui) => ui.openSheet<void>(context, (ctx) => AlignSheet(ui: ui)),
          ),
        if (ui.editor.isWholeGroup && _act(ui, 'core.ungroup'))
          CtxItem(
            key: 'stachelCtxUngroup',
            label: 'Gruppierung lösen',
            icon: Icons.workspaces_outlined,
            active: true,
            onTap: (context, ui) => ungroupSelection(ui),
          )
        else if (!ui.editor.isWholeGroup && _act(ui, 'core.group'))
          CtxItem(
            key: 'stachelCtxGroup',
            label: 'Gruppieren',
            icon: Icons.group_work_outlined,
            onTap: (context, ui) => groupSelection(ui),
          ),
      ],
    ),
  );
  // tools.tags (84): only sticky notes
  r.defineContextAction(
    ContextActionDef(
      id: 'tools.tags',
      order: 84,
      section: CtxSection.content,
      appliesTo: (c, ui) => ui.editor.editable && !c.locked && c.selected.every((o) => o.type == 'sticky'),
      items: (context, ui, c) => [
        CtxItem(
          key: 'stachelCtxTags',
          label: 'Tags',
          icon: Icons.sell_outlined,
          active: c.selected.any((o) => o.tags.isNotEmpty),
          onTap: (context, ui) => ui.openSheet<void>(context, (ctx) => TagsSheet(ui: ui), scrollControlled: true),
        ),
      ],
    ),
  );
  // tools.painter (85): one unlocked object
  r.defineContextAction(
    ContextActionDef(
      id: 'tools.painter',
      order: 85,
      section: CtxSection.style,
      appliesTo: (c, ui) =>
          ui.editor.editable &&
          c.single != null &&
          !c.locked &&
          _act(ui, 'tools.pasteStyle') &&
          _act(ui, 'tools.copyStyle'),
      items: (context, ui, c) {
        final modes = ArrangeModes.of(ui);
        return [
          CtxItem(
            key: 'stachelCtxPainter',
            label: 'Format übertragen',
            icon: Icons.format_paint_outlined,
            active: modes.painter.value != null,
            onTap: (context, ui) =>
                modes.painter.value != null ? modes.stopPainter() : modes.startPainter(c.single!.id),
          ),
        ];
      },
    ),
  );
  // tools.linkTo (88): not lines/strokes, not locked
  r.defineContextAction(
    ContextActionDef(
      id: 'tools.linkTo',
      order: 88,
      section: CtxSection.link,
      appliesTo: (c, ui) => ui.editor.editable && !c.locked && c.selected.every(linkable),
      items: (context, ui, c) => [
        CtxItem(
          key: 'stachelCtxLinkTo',
          label: 'Link zu Rahmen oder Objekt',
          icon: Icons.call_made,
          active: c.selected.any((o) => o.linkTo != null),
          onTap: (context, ui) => ui.openSheet<void>(context, (ctx) => LinkToSheet(ui: ui)),
        ),
      ],
    ),
  );
  // lock (web core.common 90 „Sperren/Entsperren“; all locked: only duplicate + unlock, D10/E22)
  r.defineContextAction(
    ContextActionDef(
      id: 'arrange.lock',
      order: 89.5,
      section: CtxSection.arrange,
      appliesTo: (c, ui) => ui.editor.editable,
      items: (context, ui, c) => [
        if (c.locked)
          CtxItem(
            key: 'stachelCtxDuplicate',
            primary: true,
            label: 'Duplizieren',
            icon: Icons.copy_all_outlined,
            onTap: (context, ui) => ui.editor.duplicateSelection(),
          ),
        CtxItem(
          key: c.locked ? 'stachelCtxUnlock' : 'stachelCtxLock',
          primary: c.locked,
          label: c.locked ? 'Entsperren' : 'Sperren',
          icon: c.locked ? Icons.lock_outline : Icons.lock_open_outlined,
          active: c.locked,
          onTap: (context, ui) => toggleLock(ui),
        ),
      ],
    ),
  );
}

// ---- object menu (D43) --------------------------------------------------------------------------------------------

MenuEntry? _alignMenu(BoardUi ui) {
  final units = arrangeUnitCount(ui);
  if (units < 2 || !_act(ui, 'core.align')) return null;
  return MenuEntry(
    key: 'stachelMenuArrange',
    label: 'Ausrichten',
    icon: Icons.align_horizontal_left,
    items: [
      for (final (i, (mode, label, _)) in alignModes.indexed)
        MenuEntry(
          key: 'stachelMenuAlign-$mode',
          label: label,
          sep: i == 3,
          onSelect: (c, ui) => alignSelection(ui, mode),
        ),
      MenuEntry(
        key: 'stachelMenuDistribute-x',
        label: 'Horizontal verteilen',
        sep: true,
        disabled: units < 3,
        onSelect: (c, ui) => distributeSelection(ui, 'x'),
      ),
      MenuEntry(
        key: 'stachelMenuDistribute-y',
        label: 'Vertikal verteilen',
        disabled: units < 3,
        onSelect: (c, ui) => distributeSelection(ui, 'y'),
      ),
    ],
  );
}

void _objectMenu(BoardRegistry r) {
  // „Ebene ▸“ like the web (replaces the core's front/back)
  r.defineMenuItem(
    MenuItemDef(
      id: 'object.front',
      on: MenuTarget.object,
      order: 40,
      entry: (ui, at) {
        if (!ui.editor.editable) return null;
        final step = _act(ui, 'tools.layerStep');
        return MenuEntry(
          key: 'stachelMenuLayer',
          label: 'Ebene',
          icon: Icons.layers_outlined,
          sep: true,
          disabled: allLocked(ui),
          items: [
            MenuEntry(
              key: 'stachelMenuFront',
              label: 'Ganz nach vorne',
              onSelect: (c, ui) => ui.editor.order(toFront: true),
            ),
            if (step)
              MenuEntry(
                key: 'stachelMenuForward',
                label: 'Eine Ebene nach vorne',
                onSelect: (c, ui) => layerStep(ui, 1),
              ),
            if (step)
              MenuEntry(
                key: 'stachelMenuBackward',
                label: 'Eine Ebene nach hinten',
                onSelect: (c, ui) => layerStep(ui, -1),
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
      id: 'object.lock',
      on: MenuTarget.object,
      order: 60,
      entry: (ui, at) => !ui.editor.editable
          ? null
          : MenuEntry(
              key: 'stachelMenuLock',
              label: allLocked(ui) ? 'Entsperren' : 'Sperren',
              icon: allLocked(ui) ? Icons.lock_open_outlined : Icons.lock_outline,
              onSelect: (c, ui) => toggleLock(ui),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.hide',
      on: MenuTarget.object,
      order: 62,
      entry: (ui, at) {
        if (!ui.editor.editable) return null;
        final any = ui.editor.selected.any((o) => o.hidden);
        return MenuEntry(
          key: 'stachelMenuHide',
          label: any ? 'Einblenden' : 'Ausblenden',
          icon: any ? Icons.visibility_outlined : Icons.visibility_off_outlined,
          disabled: allLocked(ui),
          onSelect: (c, ui) => toggleHidden(ui),
        );
      },
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'object.group',
      on: MenuTarget.object,
      order: 70,
      entry: (ui, at) {
        if (!ui.editor.editable) return null;
        if (ui.editor.isWholeGroup) {
          return !_act(ui, 'core.ungroup')
              ? null
              : MenuEntry(
                  key: 'stachelMenuUngroup',
                  label: 'Gruppierung lösen',
                  icon: Icons.workspaces_outlined,
                  onSelect: (c, ui) => ungroupSelection(ui),
                );
        }
        return !_act(ui, 'core.group')
            ? null
            : MenuEntry(
                key: 'stachelMenuGroup',
                label: 'Gruppieren',
                icon: Icons.group_work_outlined,
                disabled: !canGroup(ui),
                onSelect: (c, ui) => groupSelection(ui),
              );
      },
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.copyStyle',
      on: MenuTarget.object,
      order: 72,
      entry: (ui, at) => !ui.editor.editable || !_act(ui, 'tools.copyStyle') || ui.editor.selected.isEmpty
          ? null
          : MenuEntry(
              key: 'stachelMenuCopyStyle',
              label: 'Format kopieren',
              icon: Icons.format_paint_outlined,
              sep: true,
              onSelect: (c, ui) => ArrangeModes.of(ui).copyStyle(ui.editor.selected.first.id),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.pasteStyle',
      on: MenuTarget.object,
      order: 73,
      entry: (ui, at) => !ui.editor.editable || !_act(ui, 'tools.pasteStyle')
          ? null
          : MenuEntry(
              key: 'stachelMenuPasteStyle',
              label: 'Format einfügen',
              icon: Icons.format_color_fill,
              disabled: copiedStyle == null || allLocked(ui),
              onSelect: (c, ui) => ArrangeModes.of(ui).pasteStyle(),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'object.arrange',
      on: MenuTarget.object,
      order: 75,
      entry: (ui, at) => ui.editor.editable ? _alignMenu(ui) : null,
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.linkTo',
      on: MenuTarget.object,
      // web 77 like „In Karte umwandeln“, which the web registers first (Abnahme D43)
      order: 77.1,
      entry: (ui, at) {
        if (!ui.editor.editable) return null;
        final sel = ui.editor.selected;
        final linked = sel.where((o) => o.linkTo != null).firstOrNull;
        return MenuEntry(
          key: 'stachelMenuLinkTo',
          label: 'Link zu …',
          icon: Icons.call_made,
          disabled: sel.isEmpty || !sel.every(linkable) || sel.every((o) => o.locked),
          items: [
            MenuEntry(
              key: 'stachelMenuLinkPick',
              label: 'Ziel auf dem Board wählen',
              onSelect: (c, ui) => ArrangeModes.of(ui).startPicking(),
            ),
            if (linked != null)
              MenuEntry(
                key: 'stachelMenuLinkJump',
                label: 'Zum Ziel springen',
                onSelect: (c, ui) => followLink(ui, linked),
              ),
            if (linked != null)
              MenuEntry(
                key: 'stachelMenuLinkRemove',
                label: 'Link entfernen',
                onSelect: (c, ui) => setLink(ui, [for (final o in ui.editor.selected) o.id], null),
              ),
          ],
        );
      },
    ),
  );
}

// ---- board menu and empty board (B09, D42) ------------------------------------------------------------------------

String _onOff(bool on) => on ? 'An' : 'Aus';

void _boardMenus(BoardRegistry r) {
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.boardShowHidden',
      on: MenuTarget.board,
      order: 60,
      section: MenuSection.view,
      entry: (ui, at) {
        final n = hiddenIds(ui).length;
        if (n == 0 && !showHiddenObjects) return null;
        return MenuEntry(
          key: 'stachelBoardShowHidden',
          label: 'Ausgeblendete zeigen ($n)',
          subtitle: _onOff(showHiddenObjects),
          icon: Icons.visibility_outlined,
          onSelect: (c, ui) => ui.editor.setShowHidden(!showHiddenObjects),
        );
      },
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.boardShowAll',
      on: MenuTarget.board,
      order: 65,
      section: MenuSection.view,
      entry: (ui, at) => hiddenIds(ui).isEmpty || !ui.editor.editable
          ? null
          : MenuEntry(
              key: 'stachelBoardShowAll',
              label: 'Alle einblenden',
              icon: Icons.visibility,
              onSelect: (c, ui) => showAllHidden(ui),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.canvasShowHidden',
      on: MenuTarget.canvas,
      order: 66,
      entry: (ui, at) => hiddenIds(ui).isEmpty && !showHiddenObjects
          ? null
          : MenuEntry(
              key: 'stachelMenuShowHidden',
              label: 'Ausgeblendete zeigen',
              subtitle: _onOff(showHiddenObjects),
              icon: Icons.visibility_outlined,
              onSelect: (c, ui) => ui.editor.setShowHidden(!showHiddenObjects),
            ),
    ),
  );
}

/// Pills of the pick modes and the link buttons as one overlay (web `PainterLayer`, `LinkLayer`, `HiddenObjects`).
class ArrangeOverlay extends StatelessWidget {
  const ArrangeOverlay({super.key, required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) {
    final modes = ArrangeModes.of(ui);
    return Stack(
      fit: StackFit.expand,
      children: [
        LinkBadges(ui: ui),
        Positioned(
          top: 8,
          left: 0,
          right: 0,
          child: ListenableBuilder(
            listenable: Listenable.merge([modes.painter, modes.picking]),
            builder: (context, _) {
              if (modes.painter.value != null) {
                return _ModePill(
                  key: const Key('stachelPainterPill'),
                  icon: Icons.format_paint_outlined,
                  text: ArrangeTexts.painterPill,
                  action: 'FERTIG',
                  actionKey: 'stachelPainterDone',
                  onAction: modes.stopPainter,
                );
              }
              if (modes.picking.value != null) {
                return _ModePill(
                  key: const Key('stachelPickPill'),
                  icon: Icons.call_made,
                  text: ArrangeTexts.pickPill,
                  action: 'ABBRECHEN',
                  actionKey: 'stachelPickCancel',
                  onAction: modes.stopPicking,
                );
              }
              return const SizedBox.shrink();
            },
          ),
        ),
      ],
    );
  }
}

class _ModePill extends StatelessWidget {
  const _ModePill({
    super.key,
    required this.icon,
    required this.text,
    required this.action,
    required this.actionKey,
    required this.onAction,
  });
  final IconData icon;
  final String text;
  final String action;
  final String actionKey;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) => Center(
    child: Material(
      color: Colors.transparent,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(
            child: BoardHintPill(text: text, icon: icon),
          ),
          const SizedBox(width: 6),
          FilledButton(key: Key(actionKey), onPressed: onAction, child: Text(action)),
        ],
      ),
    ),
  );
}
