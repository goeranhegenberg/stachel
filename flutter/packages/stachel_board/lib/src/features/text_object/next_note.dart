import 'package:flutter/material.dart';

import '../../editor/board_editor.dart';
import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../model/board_source.dart';
import '../../protocol/native_messages.dart';
import '../../render/board_scene.dart';
import '../shapes/shape_tools.dart' show emptyCopy;

// „Nächste Notiz“ (D40): the web's Tab while writing – end writing, the same note (empty) right next to it at the next
// free spot, and write on there. On the phone a button in the edit bar (the app puts [NextNoteButton] there).

/// Free spot for an object as large as [o] next to it towards [side] (web `freeSpot`): if something lies there, one
/// object width (or height) further. Frames and connectors do not count.
Offset freeSpot(BoardEditor editor, BoardObject o, String side) {
  final (dx, dy) = handleSigns(side);
  for (var i = 1; i <= 50; i++) {
    final r = Rect.fromLTWH(o.x + dx * i * (o.w + siblingGap), o.y + dy * i * (o.h + siblingGap), o.w, o.h);
    final inner = r.deflate(2);
    final taken = editor.scene.grid.query(inner).any((id) {
      final q = editor.controller.state[id];
      return q != null && q.id != o.id && q.type != 'connector' && q.type != 'frame' && objectRect(q).overlaps(inner);
    });
    if (!taken) return r.topLeft;
  }
  return Offset(o.x + dx * (o.w + siblingGap), o.y + dy * (o.h + siblingGap));
}

/// Writing in a note or shape: ends it, puts an empty copy right of it ([back]: left) and writes on there. Returns
/// the new ID (null when not writing in a note or shape).
String? editNext(BoardUi ui, {bool back = false}) {
  final editor = ui.editor;
  final id = editor.editingId;
  final o = id == null ? null : ui.controller.state[id];
  if (o == null || !addHandleTypes.contains(o.type) || !editor.editable) return null;
  final view = ui.view;
  if (view != null) {
    view.finishEditing();
  } else {
    editor.stopEditing();
  }
  final at = freeSpot(editor, ui.controller.state[o.id] ?? o, back ? 'w' : 'e');
  final nid = BoardController.newId();
  ui.controller.apply([
    CreateOp([emptyCopy(ui.controller.state[o.id] ?? o, nid, at.dx, at.dy)]),
  ]);
  editor.select({nid});
  if (view != null) {
    view.editText(nid);
  } else {
    editor.startEditing(nid);
  }
  return nid;
}

/// Button „NÄCHSTE“ of the edit bar while writing in a note or shape (nothing otherwise); [compact] = only the icon
/// (UX P11: one row with the format bar).
class NextNoteButton extends StatelessWidget {
  const NextNoteButton({super.key, required this.ui, this.compact = false});
  final BoardUi ui;
  final bool compact;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: ui.editor,
    builder: (context, _) {
      final id = ui.editor.editingId;
      final o = id == null ? null : ui.controller.state[id];
      if (o == null || !addHandleTypes.contains(o.type)) return const SizedBox.shrink();
      if (compact) {
        return IconButton(
          key: const Key('stachelEditNext'),
          tooltip: o.type == 'sticky' ? 'Nächste Notiz' : 'Nächste',
          onPressed: () => editNext(ui),
          icon: Icon(Icons.keyboard_tab, color: ui.theme.ink),
        );
      }
      return TextButton.icon(
        key: const Key('stachelEditNext'),
        onPressed: () => editNext(ui),
        icon: const Icon(Icons.keyboard_tab, size: 18),
        label: Text(o.type == 'sticky' ? 'NÄCHSTE NOTIZ' : 'NÄCHSTE'),
      );
    },
  );
}
