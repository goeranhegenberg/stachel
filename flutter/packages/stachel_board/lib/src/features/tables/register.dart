import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../editor/registry/context_action_def.dart';
import '../../editor/registry/registry.dart';
import '../../editor/registry/type_behavior.dart';
import '../cards/structure_state.dart';
import 'table_model.dart';
import 'table_overlay.dart';

/// P3: Tabellen (Zelle bearbeiten über der Zelle, Zeilen/Spalten, Kopfbereich) mit act `table.*`.
///
/// Owner: P3 (parity audit §4, rows E17, I10–I15). Only this directory (`features/tables/`, tests `test/features/tables/`)
/// belongs to the package; core files change only through the registries and `act`.
///
/// Entries (web id · order): context bar `structure.table` · 74 (Zeile darunter, Spalte rechts, Zeile/Spalte löschen,
/// Kopfbereich), type `table` (tap = active cell, tap on the selected table = write in the cell, handles e/w, height
/// from the cells). The cell editor, borders and „+“ are part of the overlay `structure.edit` (features/cards).
void registerTables(BoardRegistry r) {
  r.defineContextAction(
    ContextActionDef(
      id: 'structure.table',
      order: 74,
      section: CtxSection.content,
      appliesTo: (c, ui) => ui.editor.editable && !c.locked && c.single?.type == 'table',
      items: (context, ui, c) {
        final o = c.single!;
        final d = safeTable(o);
        final st = StructureState.of(ui.editor);
        final cell = st.activeCell(o);
        return [
          if (ui.controller.canAct('table.addRow'))
            CtxItem(
              key: 'stachelTableRowAdd',
              label: 'Zeile darunter einfügen',
              icon: Icons.table_rows_outlined,
              onTap: (context, ui) async {
                final row = await tableAdd(ui, o.id, row: true, after: cell.r);
                if (row != null) st.setActiveCell(o.id, (r: row, c: cell.c));
              },
            ),
          if (ui.controller.canAct('table.addCol'))
            CtxItem(
              key: 'stachelTableColAdd',
              label: 'Spalte rechts einfügen',
              icon: Icons.view_column_outlined,
              onTap: (context, ui) async {
                final col = await tableAdd(ui, o.id, row: false, after: cell.c);
                if (col != null) st.setActiveCell(o.id, (r: cell.r, c: col));
              },
            ),
          if (d.rows.length > 1 && ui.controller.canAct('table.removeRow'))
            CtxItem(
              key: 'stachelTableRowDel',
              label: 'Zeile löschen',
              icon: Icons.playlist_remove,
              onTap: (context, ui) =>
                  ui.controller.act('table.removeRow', {'id': o.id, 'row': cell.r}, label: 'Zeile löschen'),
            ),
          if (d.cols.length > 1 && ui.controller.canAct('table.removeCol'))
            CtxItem(
              key: 'stachelTableColDel',
              label: 'Spalte löschen',
              icon: Icons.view_week_outlined,
              onTap: (context, ui) =>
                  ui.controller.act('table.removeCol', {'id': o.id, 'col': cell.c}, label: 'Spalte löschen'),
            ),
          if (ui.controller.canAct('table.setHead'))
            CtxItem(
              key: 'stachelTableHead',
              label: 'Kopfbereich',
              icon: Icons.border_top,
              onTap: (context, ui) async {
                final v = await _pickHead(context, ui, o.tableHead);
                if (v != null && v != o.tableHead) {
                  ui.controller.act('table.setHead', {'id': o.id, 'head': v}, label: 'Kopfbereich');
                }
              },
            ),
        ];
      },
    ),
  );
  r.defineType(
    TypeBehavior(
      type: 'table',
      label: 'Tabelle',
      handles: (o) => const ['e', 'w', 'anchor-e', 'anchor-s', 'anchor-w'],
      resize: (o, box, handle) => tableResize(o, box),
      // web: pointer down on a cell makes it the active one; on the selected table it is written in
      onTap: (e) {
        final st = StructureState.of(e.editor);
        final cell = _cellAt(e);
        st.setActiveCell(e.object.id, cell);
        if (!e.selected || e.editor.selection.value.length != 1) return false;
        return st.startCell(e.object.id, cell);
      },
      onDoubleTap: (e) => StructureState.of(e.editor).startCell(e.object.id, _cellAt(e)),
    ),
  );
}

Cell _cellAt(TypeTapEvent e) => TableGeometry(e.object).cellAt(e.world.dx - e.object.x, e.world.dy - e.object.y);

Future<String?> _pickHead(BuildContext context, BoardUi ui, String current) => ui.openSheet<String>(
  context,
  (ctx) => SafeArea(
    child: Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final (head, label) in tableHeads)
            ChoiceChip(
              key: Key('stachelTableHead-$head'),
              label: Text(label),
              selected: current == head,
              onSelected: (_) => Navigator.of(ctx).pop(head),
            ),
        ],
      ),
    ),
  ),
);
