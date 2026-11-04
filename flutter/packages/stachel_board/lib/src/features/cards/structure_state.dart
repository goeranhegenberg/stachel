import 'package:flutter/widgets.dart';

import '../../editor/board_editor.dart';
import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../protocol/native_messages.dart';
import '../tables/table_model.dart';
import 'card_model.dart';

/// What is being written in a card or a table right now (package P3; the editor's own text editing is for notes, texts,
/// shapes and mind nodes): the card's title in place, or one table cell.
class StructureEdit {
  const StructureEdit.title(this.id) : cell = null;
  const StructureEdit.cell(this.id, Cell this.cell);
  final String id;

  /// Null = the card's title.
  final Cell? cell;
}

/// Local state of package P3 per board (web: module-level maps like `activeCells` and the `structure.blocks` tool
/// option): active cell per table, what is being written, the chosen kind of the structure tool, the board's size on
/// screen (for „Vorlage einfügen“ in the middle). One per [BoardEditor], found with [StructureState.of].
class StructureState extends ChangeNotifier {
  StructureState._(this.editor);

  static final _all = Expando<StructureState>('structure');

  /// The state of [editor]'s board (created on first use).
  static StructureState of(BoardEditor editor) => _all[editor] ??= StructureState._(editor);

  final BoardEditor editor;

  /// The board UI (set by the package's overlay when it is built).
  BoardUi? ui;

  /// Size of the board view on screen (set by the overlay).
  Size viewSize = Size.zero;

  /// Kind of the tool „Karte, Tabelle, Mindmap“ (web tool option `kind`): `card`, `table`, `mindmap`.
  String blocksKind = 'card';

  final _active = <String, Cell>{};

  StructureEdit? _edit;
  StructureEdit? get edit => _edit;

  /// Active cell of table [o] (web `activeCell`): invalid ones (deleted) fall back to the first cell.
  Cell activeCell(BoardObject o) {
    final d = safeTable(o);
    final a = _active[o.id];
    if (a != null && d.rows.contains(a.r) && d.cols.contains(a.c)) return a;
    return (r: d.rows.first, c: d.cols.first);
  }

  void setActiveCell(String id, Cell cell) {
    final a = _active[id];
    if (a == cell) return;
    _active[id] = cell;
    if (_edit?.id == id && _edit?.cell != null) _edit = StructureEdit.cell(id, cell);
    notifyListeners();
  }

  /// Starts writing the title of card [id] (selects it).
  bool startTitle(String id) {
    final o = editor.controller.state[id];
    if (o == null || o.type != 'card' || o.locked || !editor.editable) return false;
    if (editor.editingId != null) editor.stopEditing();
    editor.select({id});
    _edit = StructureEdit.title(id);
    notifyListeners();
    return true;
  }

  /// Starts writing in [cell] of table [id] (default: its active cell; selects the table).
  bool startCell(String id, [Cell? cell]) {
    final o = editor.controller.state[id];
    if (o == null || o.type != 'table' || o.locked || !editor.editable) return false;
    if (editor.editingId != null) editor.stopEditing();
    editor.select({id});
    final c = cell ?? activeCell(o);
    _active[id] = c;
    _edit = StructureEdit.cell(id, c);
    notifyListeners();
    return true;
  }

  void stopEdit() {
    if (_edit == null) return;
    _edit = null;
    notifyListeners();
  }

  // ---- writing cards ----------------------------------------------------------------------------------------------

  /// Changes fields of the cards [ids] (status, person, due date, tags, color …) as one step, each with its height from
  /// the new content (web `patchCard`: update + remeasure).
  void patchCards(Iterable<String> ids, Map<String, Object?> patch) {
    final c = editor.controller;
    final patches = <String, Map<String, Object?>>{};
    for (final id in ids) {
      final o = c.state[id];
      if (o == null || o.type != 'card' || o.locked) continue;
      final next = BoardObject(
        {
          ...o.raw,
          for (final e in patch.entries)
            if (e.value != null) e.key: e.value,
        }..removeWhere((k, _) => patch.containsKey(k) && patch[k] == null),
      );
      final h = cardContentHeight(next);
      patches[id] = {...patch, if (h != o.h) 'h': h};
    }
    if (patches.isEmpty || !editor.editable) return;
    c.apply([UpdateOp(patches)]);
  }
}
