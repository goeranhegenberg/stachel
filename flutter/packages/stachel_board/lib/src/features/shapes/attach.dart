import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../model/board_source.dart';
import '../../protocol/native_messages.dart';
import '../core/core_widgets.dart' show hexColor;
import 'catalog.dart';
import 'shape_state.dart';
import 'shape_tools.dart';
import 'shape_widgets.dart';

// „Form anhängen“ (D39, web `quickConnect.tsx` AttachPicker/attachAt): a connector drawn from an object into the empty
// board gets a small picker at its free end – the same shape, rectangle, rounded, circle, diamond, start/end or a
// note; the new object sits at the end, the line docks to it and becomes curved.

/// Choices of the picker (web `ATTACH`).
const attachChoices = [
  ('same', 'Gleiche Form'),
  ('rect', 'Rechteck'),
  ('roundrect', 'Abgerundetes Rechteck'),
  ('circle', 'Kreis'),
  ('decision', 'Raute'),
  ('terminator', 'Start/Ende'),
  ('sticky', 'Haftnotiz'),
];

/// The pending picker for the selection: one connector, new (not confirmed by the server yet), from an object, free
/// end – null otherwise.
AttachPending? attachFor(BoardUi ui) {
  final sel = ui.editor.selection.value;
  if (sel.length != 1) return null;
  final c = ui.controller.state[sel.single];
  if (c == null || c.type != 'connector' || c.locked || ui.controller.confirmed[c.id] != null) return null;
  final from = c.raw['from'], to = c.raw['to'];
  if (from is! Map || from['objectId'] is! String || to is! Map || to['objectId'] != null) return null;
  if (to['x'] is! num || to['y'] is! num) return null;
  final fromId = from['objectId'] as String;
  if (ui.controller.state[fromId] == null) return null;
  return AttachPending(c.id, fromId, Offset((to['x'] as num).toDouble(), (to['y'] as num).toDouble()));
}

/// Creates [choice] at the connector's free end and docks the connector to it (one undo step), selects it and starts
/// writing in it (web `attachAt`).
String? attachAt(BoardUi ui, AttachPending p, String choice) {
  final editor = ui.editor;
  final c = ui.controller.state[p.id], src = ui.controller.state[p.fromId];
  if (c == null || src == null || !editor.editable) return null;
  final nid = BoardController.newId();
  Map<String, Object?> obj;
  if (choice == 'same') {
    obj = emptyCopy(src, nid, 0, 0);
  } else if (choice == 'sticky') {
    final s = stickySize(P2Tools.of(editor).stickyShape);
    obj = {
      'id': nid,
      'type': 'sticky',
      'w': s.width,
      'h': s.height,
      'color': src.type == 'sticky' ? (src.color ?? '#fff27a') : '#fff27a',
      'text': '',
    };
  } else {
    final e = entryById(choice)!;
    obj = {'id': nid, ...newShape(editor, Offset.zero, kind: e.kind, size: Size(e.w, e.h))};
  }
  final w = (obj['w'] as num).toDouble(), h = (obj['h'] as num).toDouble();
  // center: from the line's end a bit further in the direction of the drag
  final from = Offset(src.x + src.w / 2, src.y + src.h / 2);
  final len = (p.at - from).distance == 0 ? 1.0 : (p.at - from).distance;
  final d = (p.at - from) / len;
  double nz(double v) => v == 0 ? 1 : v.abs();
  final side = d.dx.abs() * h >= d.dy.abs() * w ? w / 2 / nz(d.dx) : h / 2 / nz(d.dy);
  final reach = math.min(side, math.sqrt(w * w + h * h) / 2);
  final cx = p.at.dx + d.dx * reach, cy = p.at.dy + d.dy * reach;
  obj['x'] = jsRoundP2(cx - w / 2);
  obj['y'] = jsRoundP2(cy - h / 2);
  // now the line hangs at two objects: curved like connecting directly (unless the tool says otherwise)
  final chosen = editor.connectorStyle;
  final style = c.raw['lineStyle'] ?? (chosen != null ? (chosen == 'straight' ? null : chosen) : 'curved');
  ui.controller.apply([
    CreateOp([obj]),
    UpdateOp({
      c.id: {
        'to': {'objectId': nid},
        'lineStyle': style,
      },
    }),
  ]);
  P2Tools.of(editor).attach.value = null;
  editor.select({nid});
  if (obj['type'] == 'sticky' || obj['type'] == 'shape') editor.startEditing(nid);
  return nid;
}

/// The picker at the free end (overlay `shapes.attach`).
class AttachPicker extends StatefulWidget {
  const AttachPicker({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<AttachPicker> createState() => _AttachPickerState();
}

class _AttachPickerState extends State<AttachPicker> {
  BoardUi get ui => widget.ui;
  P2Tools get tools => P2Tools.of(ui.editor);

  @override
  void initState() {
    super.initState();
    tools.ui = ui;
    ui.editor.selection.addListener(_selection);
  }

  @override
  void dispose() {
    ui.editor.selection.removeListener(_selection);
    super.dispose();
  }

  /// A new selection: open for a fresh connector into the empty board, close for anything else.
  void _selection() {
    final p = attachFor(ui);
    final cur = tools.attach.value;
    if (p != null && cur?.id != p.id) {
      tools.attach.value = p;
    } else if (p == null && cur != null) {
      tools.attach.value = null;
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([tools.attach, ui.editor.camera, ui.controller]),
    builder: (context, _) {
      final p = tools.attach.value;
      final c = p == null ? null : ui.controller.state[p.id];
      final src = p == null ? null : ui.controller.state[p.fromId];
      if (p == null || c == null || src == null || ui.editor.selection.value.length != 1) {
        return const SizedBox.shrink();
      }
      final s = ui.editor.camera.value.toScreen(p.at);
      return LayoutBuilder(
        builder: (context, box) {
          final choices = [
            for (final (id, label) in attachChoices)
              if (id != 'same' || src.type == 'shape' || src.type == 'sticky') (id, label),
          ];
          final w = choices.length * 44.0 + 12;
          final left = (s.dx + 14).clamp(4.0, math.max(4.0, box.maxWidth - w - 4)).toDouble();
          final top = (s.dy + 14).clamp(4.0, math.max(4.0, box.maxHeight - 60)).toDouble();
          return Stack(
            children: [
              Positioned(
                left: left,
                top: top,
                child: ui.theme.panelOf(
                  key: const Key('stachelAttachPicker'),
                  padding: const EdgeInsets.all(4),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      for (final (id, label) in choices)
                        Padding(
                          padding: const EdgeInsets.all(2),
                          child: P2FlyButton(
                            key: Key('stachelAttach-$id'),
                            label: label,
                            onTap: () => attachAt(ui, p, id),
                            child: _icon(id, src),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      );
    },
  );

  Widget _icon(String id, BoardObject src) {
    final ink = ui.theme.ink;
    Widget note(String color) => Container(
      width: 18,
      height: 18,
      decoration: BoxDecoration(
        color: hexColor(color),
        border: Border.all(color: ink.withValues(alpha: 0.5)),
      ),
    );
    if (id == 'same') {
      return src.type == 'shape' ? ShapeKindIcon(src.shape ?? 'rect', color: ink) : note(src.color ?? '#fff27a');
    }
    if (id == 'sticky') return note('#fff27a');
    final e = entryById(id);
    return e == null ? const SizedBox.shrink() : ShapeKindIcon(e.kind, w: e.w, h: e.h, color: ink);
  }
}
