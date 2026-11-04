import 'package:flutter/material.dart';

import '../../editor/board_editor.dart';
import '../../editor/registry/board_ui.dart';
import '../../editor/registry/context_action_def.dart';
import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/registry.dart';
import '../../editor/registry/tool_def.dart';
import '../../mindmap/mind_plan.dart';

// Mind maps on the phone (like the web's `structure/mindmap`, owner: mind map package, moved from the app in F2):
// tool behind „Weitere Werkzeuge“ (empty map; mind map templates come from the host app via [mindmapTemplateTool]),
// context entries of a selected node,
// long press „Mindmap hier“, „Zweig ein-/ausklappen“ in the object menu, delete with subtopics after asking. The
// structure tool of P3 („Karte, Tabelle, Mindmap“) may take these tool entries over.

String _mindHint(BoardUi ui) => ui.editor.mindTemplate == null
    ? 'Tippe auf das Board: dort kommt die Mindmap hin.'
    : 'Tippe auf das Board: dort kommt die Vorlage „${ui.editor.mindTemplate!.text}“ hin.';

/// Extension point for host apps: a tool behind „Weitere Werkzeuge“ that places the mind map [template] (a whole tree,
/// contract §8.6 `mind` `tree`) where the person taps – e.g. an organisation's own planning map. The package ships no
/// such template; the app adds the tool to its registry (`r.defineTool(mindmapTemplateTool(...))`).
///
/// [id] must be unique in the registry (use a prefix of the app, e.g. `myorg.mindmapPlan`); [available] limits it
/// (default: always); [moreKey] is the widget key of its row in the „Weitere Werkzeuge“ sheet.
ToolDef mindmapTemplateTool({
  required String id,
  required MindTreeSpec template,
  String? label,
  String? subtitle,
  String moreKey = 'stachelMindTemplate',
  double order = 84.1,
  bool Function(BoardUi ui)? available,
}) => ToolDef(
  id: id,
  label: label ?? 'Mindmap-Vorlage „${template.text}“',
  shortLabel: 'VORLAGE',
  icon: Icons.auto_awesome_mosaic_outlined,
  order: order,
  phone: ToolPlace.more,
  tool: BoardTool.mindmap,
  moreKey: moreKey,
  subtitle: subtitle,
  available: available,
  hint: _mindHint,
  active: (ui) => ui.editor.tool == BoardTool.mindmap && identical(ui.editor.mindTemplate, template),
  onPick: (context, ui) async => ui.editor
    ..mindTemplate = template
    ..tool = BoardTool.mindmap,
);

void registerMindmap(BoardRegistry r) {
  const hint = _mindHint;
  r.defineTool(
    ToolDef(
      id: 'structure.mindmap',
      label: 'Mindmap',
      icon: Icons.account_tree_outlined,
      order: 84,
      phone: ToolPlace.more,
      tool: BoardTool.mindmap,
      moreKey: 'stachelMindEmpty',
      subtitle: 'Zentrales Thema schreiben, dann Unterthemen mit +',
      hint: hint,
      active: (ui) => ui.editor.tool == BoardTool.mindmap && ui.editor.mindTemplate == null,
      onPick: (context, ui) async => ui.editor
        ..mindTemplate = null
        ..tool = BoardTool.mindmap,
    ),
  );
  r.defineContextAction(
    ContextActionDef(
      id: 'structure.mind',
      order: 75,
      section: CtxSection.content,
      appliesTo: (c, ui) => ui.editor.editable && !c.locked && c.single?.type == 'mindnode',
      items: (context, ui, c) {
        final node = c.single!;
        final editor = ui.editor;
        final collapsed = node.mind.collapsed;
        return [
          CtxItem(
            key: 'stachelMindChild',
            label: 'Unterthema',
            icon: Icons.subdirectory_arrow_right,
            onTap: (_, ui) => ui.editor.mindChild(node.id),
          ),
          if (!editor.isMindRootNode(node.id))
            CtxItem(
              key: 'stachelMindSibling',
              label: 'Gleiche Ebene',
              icon: Icons.playlist_add,
              onTap: (_, ui) => ui.editor.mindSibling(node.id),
            ),
          if (editor.mindChildren(node.id).isNotEmpty)
            CtxItem(
              key: 'stachelMindCollapse',
              label: collapsed ? 'Zweig ausklappen' : 'Zweig einklappen',
              icon: collapsed ? Icons.unfold_more : Icons.unfold_less,
              onTap: (_, ui) => ui.editor.mindCollapse(node.id, !collapsed),
            ),
        ];
      },
    ),
  );

  r.defineMenuItem(
    MenuItemDef(
      id: 'canvas.mindmap',
      on: MenuTarget.canvas,
      order: 3,
      entry: (ui, at) => !ui.editor.editable
          ? null
          : MenuEntry(
              key: 'stachelHereMindmap',
              label: 'Mindmap hier',
              icon: Icons.account_tree_outlined,
              onSelect: (c, ui) => ui.editor.createMindMap(at.world),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'structure.mindCollapse',
      on: MenuTarget.object,
      order: 76,
      entry: (ui, at) {
        final o = ui.editor.single;
        if (o == null || o.type != 'mindnode' || !ui.editor.editable || ui.editor.mindChildren(o.id).isEmpty) {
          return null;
        }
        final collapsed = o.mind.collapsed;
        return MenuEntry(
          key: 'stachelMenuMindCollapse',
          label: collapsed ? 'Zweig ausklappen' : 'Zweig einklappen',
          icon: collapsed ? Icons.unfold_more : Icons.unfold_less,
          onSelect: (c, ui) => ui.editor.mindCollapse(o.id, !collapsed),
        );
      },
    ),
  );
  r.deleteGuards.add(confirmMindDelete);
}

/// Deleting mind nodes with subtopics asks first („Programm samt 3 Unterthemen löschen?“); true = go ahead.
Future<bool> confirmMindDelete(BuildContext context, BoardUi ui) async {
  final editor = ui.editor;
  final minds = [
    for (final o in editor.selected)
      if (o.type == 'mindnode' && !o.locked) o,
  ];
  if (minds.isEmpty) return true;
  final n = editor.mindDescendantCount(minds.map((o) => o.id));
  if (n == 0) return true;
  final what = minds.length == 1 && minds.single.text.trim().isNotEmpty
      ? '„${minds.single.text.trim().split('\n').first}“'
      : 'Das Thema';
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Mit Unterthemen löschen?'),
      content: Text(
        '$what wird samt ${n == 1 ? 'einem Unterthema' : '$n Unterthemen'} gelöscht. Rückgängig geht danach.',
      ),
      actions: [
        TextButton(
          key: const Key('stachelMindDeleteCancel'),
          onPressed: () => Navigator.of(ctx).pop(false),
          child: const Text('ABBRECHEN'),
        ),
        FilledButton(
          key: const Key('stachelMindDeleteOk'),
          style: FilledButton.styleFrom(backgroundColor: ui.theme.danger),
          onPressed: () => Navigator.of(ctx).pop(true),
          child: const Text('LÖSCHEN'),
        ),
      ],
    ),
  );
  return ok == true;
}

/// Buttons of the edit bar while writing in a mind node (Unterthema = Tab, Gleiche Ebene = Enter).
class MindEditActions extends StatelessWidget {
  const MindEditActions({super.key, required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) {
    final editor = ui.editor;
    final id = editor.editingId;
    final root = id != null && editor.isMindRootNode(id);
    final style = TextStyle(fontFamily: ui.theme.condensedFont, fontWeight: FontWeight.w700, letterSpacing: 0.3);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        TextButton.icon(
          key: const Key('stachelMindEditChild'),
          onPressed: editor.mindTab,
          icon: const Icon(Icons.subdirectory_arrow_right, size: 18),
          label: Text('UNTERTHEMA', style: style),
        ),
        if (!root)
          TextButton.icon(
            key: const Key('stachelMindEditSibling'),
            onPressed: editor.mindEnter,
            icon: const Icon(Icons.playlist_add, size: 18),
            label: Text('GLEICHE EBENE', style: style),
          ),
      ],
    );
  }
}
