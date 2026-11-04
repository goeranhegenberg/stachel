import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../render/paint_utils.dart';
import '../../mindmap/mind_render.dart' show webTextOn;
import '../cards/live_text.dart';
import '../cards/structure_state.dart';
import 'table_model.dart';

// Over a selected table (web `TableView` parts that depend on the selection, `TableAdd`): the active cell (blue frame),
// column borders to drag (total width stays), „+“ right/below (column/row at the end), and while writing the cell
// editor over the cell with a write bar above the keyboard: ← / → (Tab: the next cell, after the last one a new row) /
// ↓ (Enter: the cell below) / Fertig.

const _blue = Color(0xFF1763B5);

/// Screen rect of the box ([x],[y],[w],[h] in object coordinates) of [o].
Rect _screen(BoardUi ui, BoardObject o, double x, double y, double w, double h) {
  final cam = ui.editor.camera.value;
  final tl = cam.toScreen(Offset(o.x + x, o.y + y));
  return Rect.fromLTWH(tl.dx, tl.dy, w * cam.z, h * cam.z);
}

/// Adds row (`table.addRow`) or column (`table.addCol`) after [after] (null = at the end); returns the new id.
Future<String?> tableAdd(BoardUi ui, String id, {required bool row, String? after}) async {
  final name = row ? 'table.addRow' : 'table.addCol';
  if (!ui.controller.canAct(name)) return null;
  final done = await ui.controller.act(name, {
    'id': id,
    'after': ?after,
  }, label: row ? 'Zeile einfügen' : 'Spalte einfügen');
  final data = done.result?.data;
  final v = data is Map ? data[row ? 'row' : 'col'] : null;
  return v is String ? v : null;
}

/// Widgets of the tables package over the board for the current selection/editing.
List<Widget> tableDecorations(BuildContext context, BoardUi ui, StructureState st, TableDrag drag) {
  final sel = ui.editor.selection.value;
  if (sel.length != 1) return const [];
  final o = ui.controller.state[sel.single];
  if (o == null || o.type != 'table' || o.hidden) return const [];
  final g = TableGeometry(o);
  final edit = st.edit;
  final editing = edit != null && edit.id == o.id && edit.cell != null;
  final writable = ui.editor.editable && !o.locked;
  final out = <Widget>[];
  final act = st.activeCell(o);
  final box = g.boxOf(act);
  if (box != null && !editing) {
    final r = _screen(ui, o, box.x, box.y, box.w, box.h);
    out.add(
      Positioned.fromRect(
        rect: r,
        child: IgnorePointer(
          child: Container(
            key: const Key('stachelTableActive'),
            decoration: BoxDecoration(border: Border.all(color: _blue, width: 2)),
          ),
        ),
      ),
    );
  }
  if (!writable || o.rotation != 0) return out;
  final full = _screen(ui, o, 0, 0, o.w, o.h);
  if (!editing) {
    // column borders (all inner ones), dragged = new widths of the two neighbors
    var x = 0.0;
    for (var i = 0; i < g.widths.length - 1; i++) {
      x += g.widths[i];
      final sx = full.left + x * ui.editor.camera.value.z;
      out.add(
        Positioned(
          left: sx - 12,
          top: full.top,
          width: 24,
          height: full.height,
          child: GestureDetector(
            key: Key('stachelTableGrip-$i'),
            behavior: HitTestBehavior.translucent,
            onHorizontalDragStart: (_) => drag.start(o, i, g.widths),
            onHorizontalDragUpdate: (d) => drag.update(d.delta.dx / ui.editor.camera.value.z),
            onHorizontalDragEnd: (_) => drag.end(ui),
            onHorizontalDragCancel: drag.cancel,
          ),
        ),
      );
    }
    final p = drag.preview(o.id);
    if (p != null) {
      final sx = full.left + p * ui.editor.camera.value.z;
      out.add(
        Positioned(
          left: sx - 1,
          top: full.top,
          width: 2,
          height: full.height,
          child: const IgnorePointer(child: ColoredBox(color: _blue)),
        ),
      );
    }
    Widget plus(String key, String label, Offset c, VoidCallback onTap) => Positioned(
      left: c.dx - 16,
      top: c.dy - 16,
      width: 32,
      height: 32,
      child: Tooltip(
        message: label,
        child: InkResponse(
          key: Key(key),
          onTap: onTap,
          child: Center(
            child: Container(
              width: 24,
              height: 24,
              alignment: Alignment.center,
              decoration: const BoxDecoration(color: _blue, shape: BoxShape.circle),
              child: const Icon(Icons.add, size: 18, color: Colors.white),
            ),
          ),
        ),
      ),
    );
    if (ui.controller.canAct('table.addCol')) {
      out.add(
        plus(
          'stachelTableAddCol',
          'Spalte anhängen',
          Offset(full.right + 14, full.center.dy),
          () => tableAdd(ui, o.id, row: false),
        ),
      );
    }
    if (ui.controller.canAct('table.addRow')) {
      out.add(
        plus(
          'stachelTableAddRow',
          'Zeile anhängen',
          Offset(full.center.dx, full.bottom + 14),
          () => tableAdd(ui, o.id, row: true),
        ),
      );
    }
  }
  if (editing) {
    final cell = edit.cell!;
    final b = g.boxOf(cell);
    if (b != null) {
      out.add(
        Positioned.fromRect(
          rect: _screen(ui, o, b.x, b.y, b.w, b.h),
          child: CellEditor(key: ValueKey('cell-${o.id}-${cell.r}-${cell.c}'), ui: ui, table: o.id, cell: cell),
        ),
      );
      out.add(
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: CellWriteBar(ui: ui, table: o.id, cell: cell),
        ),
      );
    }
  }
  return out;
}

/// A column border being dragged (local preview; the server gets `table.resizeCol` at the end like the web's last move).
class TableDrag extends ChangeNotifier {
  String? _id;
  int _i = 0;
  List<double> _base = const [];
  double _dx = 0;

  void start(BoardObject o, int i, List<double> widths) {
    _id = o.id;
    _i = i;
    _base = List.of(widths);
    _dx = 0;
    notifyListeners();
  }

  void update(double dx) {
    if (_id == null) return;
    _dx += dx;
    notifyListeners();
  }

  /// Widths after the drag (web `ColGrips`: both neighbors ≥ 48, the sum of the two stays).
  List<double> get widths {
    final px = List.of(_base);
    final i = _i;
    final a = math.max(tableMinColPx, math.min(_base[i] + _base[i + 1] - tableMinColPx, _base[i] + _dx));
    px[i] = a;
    px[i + 1] = _base[i] + _base[i + 1] - a;
    return px;
  }

  /// x of the dragged border in object coordinates while table [id] is dragged.
  double? preview(String id) => _id == id ? widths.take(_i + 1).fold<double>(0, (a, b) => a + b) : null;

  void end(BoardUi ui) {
    final id = _id;
    if (id == null) return;
    final px = widths;
    final i = _i;
    _id = null;
    notifyListeners();
    if (_dx.abs() < 0.5 || !ui.controller.canAct('table.resizeCol')) return;
    ui.controller.act('table.resizeCol', {'id': id, 'i': i, 'px': px}, label: 'Spaltenbreite');
  }

  void cancel() {
    _id = null;
    notifyListeners();
  }
}

/// The text field over a cell (web `CellEditor`): live like the web (`table.setCell` with the base it started from),
/// font and padding of the cell at the current zoom, head row/column bold.
class CellEditor extends StatefulWidget {
  const CellEditor({super.key, required this.ui, required this.table, required this.cell});
  final BoardUi ui;
  final String table;
  final Cell cell;

  @override
  State<CellEditor> createState() => _CellEditorState();
}

class _CellEditorState extends State<CellEditor> {
  late final LiveText _live;
  final _focus = FocusNode();

  BoardUi get ui => widget.ui;

  String _read() {
    final o = ui.controller.state[widget.table];
    return o == null ? '' : safeTable(o).cell(widget.cell.r, widget.cell.c);
  }

  @override
  void initState() {
    super.initState();
    _live = LiveText(
      read: _read,
      send: (base, text) {
        if (!ui.controller.canAct('table.setCell')) return;
        ui.controller.act('table.setCell', {
          'id': widget.table,
          'r': widget.cell.r,
          'c': widget.cell.c,
          'base': base,
          'text': text,
        });
      },
    );
    ui.controller.addListener(_live.pull);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focus.requestFocus();
    });
  }

  @override
  void dispose() {
    ui.controller.removeListener(_live.pull);
    _live.dispose();
    _live.controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final o = ui.controller.state[widget.table];
    final z = ui.editor.camera.value.z;
    final d = o == null ? null : safeTable(o);
    final ri = d?.rows.indexOf(widget.cell.r) ?? -1, ci = d?.cols.indexOf(widget.cell.c) ?? -1;
    final head = o != null && hasHeadRow(o) && ri == 0;
    final headCol = o != null && hasHeadCol(o) && ci == 0 && !head;
    final bg = head ? parseColor(o.color, const Color(0xFF0A0A0A)) : (headCol ? const Color(0xFFF3F3EE) : Colors.white);
    final ink = head ? webTextOn(o.color ?? '#0a0a0a') : const Color(0xFF1C1C1A);
    return Material(
      color: bg,
      child: Container(
        decoration: BoxDecoration(border: Border.all(color: _blue, width: 2)),
        padding: EdgeInsets.symmetric(
          horizontal: math.max(0, tablePadX * z - 2),
          vertical: math.max(0, tablePadY * z - 2),
        ),
        child: TextField(
          key: const Key('stachelCellEditor'),
          controller: _live.controller,
          focusNode: _focus,
          maxLines: null,
          expands: true,
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => cellGo(ui, widget.table, widget.cell, 'down'),
          style: TextStyle(
            fontSize: tableFs * z,
            height: tableLh,
            color: ink,
            fontWeight: head || headCol ? FontWeight.w700 : FontWeight.w500,
          ),
          decoration: const InputDecoration.collapsed(hintText: ''),
          cursorColor: _blue,
        ),
      ),
    );
  }
}

/// Moves the editor to the next/previous/lower cell (Tab/Shift-Tab/Enter of the web); Tab after the last cell appends a
/// row (like spreadsheets), Enter in the last row ends writing.
Future<void> cellGo(BoardUi ui, String id, Cell cell, String dir) async {
  final st = StructureState.of(ui.editor);
  final o = ui.controller.state[id];
  if (o == null) return st.stopEdit();
  final d = safeTable(o);
  var next = nextCell(d, cell, dir);
  if (next == null && dir == 'next') {
    final row = await tableAdd(ui, id, row: true);
    if (row != null) next = (r: row, c: d.cols.first);
  }
  if (next == null) return st.stopEdit();
  st.startCell(id, next);
}

/// Bar above the keyboard while writing in a cell (phone counterpart of Tab / Shift-Tab / Enter).
class CellWriteBar extends StatelessWidget {
  const CellWriteBar({super.key, required this.ui, required this.table, required this.cell});
  final BoardUi ui;
  final String table;
  final Cell cell;

  @override
  Widget build(BuildContext context) {
    Widget btn(String key, IconData icon, String label, VoidCallback onTap) => Tooltip(
      message: label,
      child: IconButton(key: Key(key), icon: Icon(icon), onPressed: onTap),
    );
    return Material(
      elevation: 8,
      color: Colors.white,
      child: SafeArea(
        top: false,
        child: Row(
          children: [
            btn('stachelCellPrev', Icons.arrow_back, 'Vorige Zelle', () => cellGo(ui, table, cell, 'prev')),
            btn('stachelCellNext', Icons.arrow_forward, 'Nächste Zelle', () => cellGo(ui, table, cell, 'next')),
            btn('stachelCellDown', Icons.arrow_downward, 'Zelle darunter', () => cellGo(ui, table, cell, 'down')),
            const Spacer(),
            TextButton(
              key: const Key('stachelCellDone'),
              onPressed: () => StructureState.of(ui.editor).stopEdit(),
              child: const Text('FERTIG'),
            ),
          ],
        ),
      ),
    );
  }
}
