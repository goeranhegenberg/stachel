import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../editor/board_editor.dart';
import '../../editor/registry/board_ui.dart';
import '../../editor/registry/context_action_def.dart';
import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import '../../editor/registry/tool_def.dart';
import '../../editor/registry/type_behavior.dart';
import '../../model/board_object.dart';
import '../../model/board_source.dart';
import '../../protocol/native_messages.dart';
import '../../render/paint_utils.dart';
import '../core/core_widgets.dart' show ColorSwatchDot, pickColor;
import '../tables/table_model.dart';
import '../timeline/timeline_model.dart' show tlNewTimeline, tlToday;
import 'card_model.dart';
import 'card_widgets.dart';
import 'structure_overlay.dart';
import 'structure_state.dart';

/// P3: Karten (Status, Zuständig, Fällig, Details), Struktur-Werkzeug „Karte, Tabelle, Mindmap“.
///
/// Owner: P3 (parity audit §4, rows C15, E16, I02–I09). Only this directory (`features/cards/`, tests
/// `test/features/cards/`) belongs to the package; core files change only through the registries and `act`.
///
/// Entries (web id · order): tool `structure.blocks` · 84 (behind „Weitere Werkzeuge“, options Karte/Tabelle/Mindmap),
/// context bar `structure.color` · 10 (card/table palette), `structure.card` · 76, object menu `structure.toCard` · 77
/// (act `structure.toCard`), type `card` (title in place, handles e/w, height from the content), overlay
/// `structure.edit` (title editor, table parts, measuring, my name for „Zuständig“).
void registerCards(BoardRegistry r) {
  r.defineTool(blocksTool('card'));
  r.defineOverlay(
    OverlayDef(
      id: 'structure.edit',
      order: 40,
      build: (context, ui) => StructureOverlay(ui: ui),
    ),
  );
  r.defineContextAction(
    ContextActionDef(
      id: 'structure.color',
      order: 10,
      section: CtxSection.style,
      appliesTo: (c, ui) => ui.editor.editable && !c.locked && (c.only('card') || c.only('table')),
      items: (context, ui, c) {
        final palette = c.only('card') ? cardColors : tableHeadColors;
        return [
          CtxItem(
            key: 'stachelCtxColor',
            primary: true,
            label: c.only('card') ? 'Farbe' : 'Kopffarbe',
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
      id: 'structure.card',
      order: 76,
      section: CtxSection.content,
      appliesTo: (c, ui) => ui.editor.editable && !c.locked && c.only('card'),
      items: (context, ui, c) {
        final st = statusOf(c.first.status);
        final person = assigneeOf(c.first);
        return [
          CtxItem(
            key: 'stachelCardStatus',
            label: 'Status',
            leading: (_) =>
                Icon(Icons.flag_outlined, color: st == null ? ui.theme.ink : parseColor(st.color, ui.theme.ink)),
            onTap: (context, ui) async {
              final v = await pickCardStatus(context, ui, c.first.status);
              if (v != null) setCardField(ui, 'status', v.isEmpty ? null : v);
            },
          ),
          CtxItem(
            key: 'stachelCardWho',
            label: 'Zuständig',
            leading: (_) => person == null ? const Icon(Icons.person_outline) : CardAvatar(person: person, size: 24),
            onTap: (context, ui) async {
              final p = await pickCardPerson(context, ui, person?.key);
              if (p != null) setCardField(ui, 'assignee', p.key.isEmpty ? null : p.toJson());
            },
          ),
          CtxItem(
            key: 'stachelCardDue',
            label: 'Fällig am',
            icon: Icons.event,
            active: c.first.due != null,
            onTap: (context, ui) async {
              final v = await pickCardDue(context, ui, c.first.due);
              if (v != null) setCardField(ui, 'due', v.isEmpty ? null : v);
            },
          ),
          if (c.single != null)
            CtxItem(
              key: 'stachelCardDetails',
              primary: true,
              short: 'Öffnen',
              label: 'Karte öffnen',
              icon: Icons.open_in_full,
              onTap: (context, ui) => openCardDetails(context, ui, c.single!.id),
            ),
        ];
      },
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'structure.toCard',
      on: MenuTarget.object,
      order: 77,
      entry: (ui, at) {
        final sel = ui.editor.selected;
        final notes = [
          for (final o in sel)
            if (o.type == 'sticky' && !o.locked) o,
        ];
        if (!ui.editor.editable ||
            notes.isEmpty ||
            notes.length != sel.length ||
            !ui.controller.canAct('structure.toCard')) {
          return null;
        }
        return MenuEntry(
          key: 'stachelMenuToCard',
          label: notes.length > 1 ? 'In Karten umwandeln' : 'In Karte umwandeln',
          icon: Icons.view_agenda_outlined,
          onSelect: (context, ui) => ui.controller.act('structure.toCard', {
            'ids': [for (final n in notes) n.id],
          }, label: 'In Karte umwandeln'),
        );
      },
    ),
  );
  r.defineType(
    TypeBehavior(
      type: 'card',
      label: 'Karte',
      // handles from the editor's table (P1, web `handles` e/w + `addHandles`: plus on four sides)
      resize: cardResize,
      onTap: (e) {
        if (!e.selected || e.editor.selection.value.length != 1) return false;
        return StructureState.of(e.editor).startTitle(e.object.id);
      },
      onDoubleTap: (e) => StructureState.of(e.editor).startTitle(e.object.id),
    ),
  );
}

/// Width at the side handles ≥ 160 (web `resize` with `widthOnly`), height from the content.
Map<String, Object?> cardResize(BoardObject o, Map<String, Object?> box, String handle) {
  // corner handle = a scaled selection with the card in it: the box as it is (web `resize` without `widthOnly`)
  if (handle.length == 2) return box;
  final w0 = (box['w'] as num?)?.toDouble() ?? o.w;
  final w = math.max(cardMinWidth, w0);
  final out = {...box, 'w': w};
  if (w != w0 && handle.contains('w') && box['x'] is num) out['x'] = (box['x'] as num).toDouble() + w0 - w;
  out['h'] = cardContentHeight(BoardObject({...o.raw, 'w': w}));
  out.remove('y');
  return out;
}

// ---- tool „Karte, Tabelle, Mindmap“ (web `structure.blocks`) --------------------------------------------------------

// UX-Review P9: no Mindmap here on the phone – „Weitere Werkzeuge“ has its own entry „Mindmap“ (one way to it);
// [placeBlock] still places one for a kind kept from before
const _blocks = [
  ('card', 'Karte', 'Aufgabe mit Person, Datum und Status', Icons.view_agenda_outlined),
  ('table', 'Tabelle', 'Zellen antippen und schreiben', Icons.table_chart_outlined),
  // P9: fourth kind (web BLOCKS `timeline`)
  ('timeline', 'Zeitleiste', 'Spuren mit Terminen, Doppeltippen legt einen Eintrag an', Icons.view_timeline_outlined),
];

/// The tool with the icon of [kind] (web: the icon follows the last kind).
ToolDef blocksTool(String kind) {
  final b = _blocks.firstWhere((x) => x.$1 == kind, orElse: () => _blocks.first);
  return ToolDef(
    id: 'structure.blocks',
    label: 'Karte, Tabelle, Zeitleiste',
    shortLabel: b.$2.toUpperCase(),
    icon: b.$4,
    order: 84,
    phone: ToolPlace.more,
    keyName: 'stachelToolBlocks',
    moreKey: 'stachelMoreBlocks',
    subtitle: 'Aufgabenkarte, Tabelle oder Zeitleiste mit Spuren',
    hint: (ui) {
      final k = StructureState.of(ui.editor).blocksKind;
      final what = switch (k) {
        'table' => 'die Tabelle',
        'mindmap' => 'die Mindmap',
        'timeline' => 'die Zeitleiste',
        _ => 'die Karte',
      };
      return 'Tippe auf das Board: dort kommt $what hin.';
    },
    options: (context, ui) => BlocksOptions(ui: ui),
    behavior: BoardToolBehavior(onTap: (e) => placeBlock(e.editor, StructureState.of(e.editor).blocksKind, e.world)),
  );
}

/// Places a card / table / mind map centered at [p] (web `placeAt` / `newRoot`) and starts writing in it.
String? placeBlock(BoardEditor editor, String kind, Offset p) {
  if (!editor.editable) return null;
  final st = StructureState.of(editor);
  switch (kind) {
    case 'mindmap':
      return editor.createMindMap(p);
    case 'timeline':
      // P9 (web `newTimeline`, selected afterwards): lanes „Spur 1–3“, 8 weeks from this Monday
      final id = BoardController.newId();
      editor.controller.apply([
        CreateOp([
          {'id': id, ...tlNewTimeline(p.dx, p.dy, tlToday())},
        ]),
      ]);
      editor.select({id});
      return id;
    case 'table':
      final id = BoardController.newId();
      String sub() => BoardController.newId().substring(0, 8);
      final rows = [sub(), sub(), sub()], cols = [sub(), sub(), sub()];
      final data = TableData(rows: rows, cols: cols, cells: const {}, widths: const {});
      final w = tableWidth;
      final h = tableHeight(data, w);
      editor.controller.apply([
        CreateOp([
          {
            'id': id,
            'type': 'table',
            'x': (p.dx - w / 2).roundToDouble(),
            'y': (p.dy - h / 2).roundToDouble(),
            'w': w,
            'h': h,
            'table': {'rows': rows, 'cols': cols, 'cells': <String, String>{}, 'widths': <String, double>{}},
            'color': tableHeadColors.isEmpty ? '#0a0a0a' : tableHeadColors.first,
          },
        ]),
      ]);
      st.startCell(id, (r: rows.first, c: cols.first));
      return id;
    default:
      final id = BoardController.newId();
      final w = cardWidth;
      editor.controller.apply([
        CreateOp([
          {
            'id': id,
            'type': 'card',
            'x': (p.dx - w / 2).roundToDouble(),
            'y': (p.dy - 48).roundToDouble(),
            'w': w,
            'h': 96,
            'text': '',
            'color': cardColors.isEmpty ? '#1763b5' : cardColors.first,
          },
        ]),
      ]);
      st.startTitle(id);
      return id;
  }
}

/// Option strip of the tool: Karte · Tabelle · Zeitleiste (web `BlockOptions` without the mind map, which has its own
/// tool on the phone; the choice stays for the next time).
class BlocksOptions extends StatefulWidget {
  const BlocksOptions({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<BlocksOptions> createState() => _BlocksOptionsState();
}

class _BlocksOptionsState extends State<BlocksOptions> {
  @override
  Widget build(BuildContext context) {
    final st = StructureState.of(widget.ui.editor);
    return Wrap(
      spacing: 8,
      children: [
        for (final (kind, label, hint, icon) in _blocks)
          Tooltip(
            message: hint,
            child: ChoiceChip(
              key: Key('stachelBlocks-$kind'),
              avatar: Icon(icon, size: 18),
              label: Text(label),
              selected: st.blocksKind == kind,
              onSelected: (_) {
                setState(() => st.blocksKind = kind);
                // the tool's icon follows the kind (web `BlockIcon`)
                widget.ui.registry.defineTool(blocksTool(kind));
              },
            ),
          ),
      ],
    );
  }
}
