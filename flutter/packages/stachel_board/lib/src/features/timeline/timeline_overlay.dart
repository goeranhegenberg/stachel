import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show HapticFeedback, LengthLimitingTextInputFormatter;

import '../../editor/board_editor.dart';
import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart' show BoardObject;
import '../../model/board_state.dart';
import '../../render/text_layout.dart';
import '../../render/types/timeline_renderer.dart';
import '../cards/live_text.dart';
import 'timeline_actions.dart';
import 'timeline_dialog.dart';
import 'timeline_model.dart';
import 'timeline_state.dart';

// The overlay of package P9 over the board (web: `TimelineView`'s interactive parts and the slots
// `structure.timelineHandles` / `structure.timelineDrop`). On a selected, unlocked timeline: items are dragged (days,
// the lane follows), held (dialog), double tapped (title); the active bar has grips at both ends (44 px), the lane
// names a grip ⋮⋮ to reorder, „+ Spur“ below; titles and lane names are written in place (live). While notes or cards
// are dragged over a lane, the lane is marked; dropped there, they become items (`timeline.adopt`).

const _blue = Color(0xFF1763B5);
const _green = Color(0xFFC9E14A);
const _greenDeep = Color(0xFFA9C22A);

/// Sticky notes and cards can be dropped on a lane (web `DROP_TYPES`).
const tlDropTypes = {'sticky', 'card'};

/// Topmost unlocked timeline and lane under the world point [p] (not header or name column) – web `dropTarget`.
({BoardObject t, TlLayout l, String lane, int day})? tlDropTarget(BoardState s, Offset p, Set<String> skip, int today) {
  BoardObject? t;
  for (final o in s.ordered) {
    if (o.type != 'timeline' || o.locked || o.hidden || skip.contains(o.id)) continue;
    if (p.dx >= o.x && p.dx <= o.x + o.w && p.dy >= o.y && p.dy <= o.y + o.h) t = o;
  }
  if (t == null) return null;
  final l = tlLayoutFor(t.raw, today);
  final q = tlToLocal(t, l, p.dx, p.dy);
  final hit = tlHitLocal(l, q.lx, q.ly);
  if (hit == null || (hit.kind != 'lane' && hit.kind != 'item')) return null;
  return (t: t, l: l, lane: hit.lane!, day: hit.day!);
}

class TimelineOverlay extends StatefulWidget {
  const TimelineOverlay({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<TimelineOverlay> createState() => _TimelineOverlayState();
}

class _TimelineOverlayState extends State<TimelineOverlay> {
  late final TimelineState st = TimelineState.of(widget.ui.editor);
  final _stack = GlobalKey();

  /// Positions of the selected notes/cards before a move (web: snapshot at pointer down).
  Map<String, Offset> _before = const {};
  bool _dragSeen = false;

  /// Start of an item/lane drag (overlay coordinates) and the item at that moment.
  Offset _down = Offset.zero;
  TlItemBox? _dragBox;

  BoardUi get ui => widget.ui;
  BoardEditor get editor => ui.editor;

  @override
  void initState() {
    super.initState();
    st.ui = ui;
    editor.selection.addListener(_selection);
    editor.guides.addListener(_guides);
    ui.controller.addListener(_remember);
    _remember();
  }

  @override
  void dispose() {
    editor.selection.removeListener(_selection);
    editor.guides.removeListener(_guides);
    ui.controller.removeListener(_remember);
    super.dispose();
  }

  /// Deselected: active item and writing end (web: `setFocus(null)` when no longer selected).
  void _selection() {
    final sel = editor.selection.value;
    final e = st.edit;
    if (e != null && !sel.contains(e.timeline)) st.stopEdit();
    _remember();
  }

  /// Positions of the selected notes/cards while nothing is dragged.
  void _remember() {
    if (editor.dragging) return;
    _before = {
      for (final o in editor.selected)
        if (tlDropTypes.contains(o.type)) o.id: Offset(o.x, o.y),
    };
  }

  /// The editor's guides change on every move and at its end: a finished move of notes/cards onto a lane adopts them.
  void _guides() {
    if (editor.dragging) {
      _dragSeen = true;
      return;
    }
    if (!_dragSeen) return;
    _dragSeen = false;
    _adopt();
    _remember();
  }

  /// Moved notes/cards whose center lies on a lane → items (web `dropInto`; the server computes the same).
  void _adopt() {
    if (!ui.controller.canAct('timeline.adopt') || !editor.editable) return;
    final moved = [
      for (final o in editor.selected)
        if (tlDropTypes.contains(o.type) && !o.locked && _before[o.id] != null && _before[o.id] != Offset(o.x, o.y)) o,
    ];
    if (moved.isEmpty) return;
    final skip = {for (final o in moved) o.id};
    final today = tlToday();
    final hits = [
      for (final o in moved)
        if (tlDropTarget(ui.controller.state, Offset(o.x + o.w / 2, o.y + o.h / 2), skip, today) != null) o.id,
    ];
    if (hits.isEmpty) return;
    ui.controller.act('timeline.adopt', {'ids': hits}, label: 'In die Zeitleiste übernehmen').then((d) {
      final data = d.result?.data;
      if (data is Map && data['timeline'] is String && data['key'] is String) {
        st.setFocus(data['timeline'] as String, TlFocus.item(data['key'] as String));
      }
    });
  }

  Offset _local(Offset global) {
    final box = _stack.currentContext?.findRenderObject() as RenderBox?;
    return box == null ? global : box.globalToLocal(global);
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: Listenable.merge([st, editor.camera, editor.selection, ui.controller, editor]),
    builder: (context, _) {
      final children = <Widget>[..._dropZone()];
      final sel = editor.selection.value;
      final o = sel.length == 1 ? ui.controller.state[sel.single] : null;
      if (o != null &&
          o.type == 'timeline' &&
          !o.hidden &&
          editor.tool == BoardTool.select &&
          editor.editingId == null) {
        children.addAll(_selected(context, o));
      }
      return Stack(key: _stack, clipBehavior: Clip.none, children: children);
    },
  );

  /// Lane under the first dragged note/card (web `TimelineDrop`).
  List<Widget> _dropZone() {
    if (!editor.dragging) return const [];
    final moved = [
      for (final o in editor.selected)
        if (tlDropTypes.contains(o.type) && !o.locked) o,
    ];
    if (moved.isEmpty) return const [];
    final f = moved.first;
    final tgt = tlDropTarget(ui.controller.state, Offset(f.x + f.w / 2, f.y + f.h / 2), {
      for (final o in moved) o.id,
    }, tlToday());
    if (tgt == null) return const [];
    final lane = tgt.l.lanes.firstWhere((x) => x.id == tgt.lane);
    final r = tlToWorldRect(tgt.t, tgt.l, tlLabelW, lane.y, tgt.l.w0 - tlLabelW, lane.h);
    final s = editor.camera.value.rectToScreen(Rect.fromLTWH(r.x, r.y, r.w, r.h));
    return [
      Positioned.fromRect(
        rect: s,
        child: IgnorePointer(
          child: Container(
            key: const Key('stachelTlDropZone'),
            decoration: BoxDecoration(
              color: _green.withValues(alpha: 0.18),
              border: Border.all(color: _greenDeep, width: 2.5),
              borderRadius: BorderRadius.circular(8),
            ),
          ),
        ),
      ),
    ];
  }

  List<Widget> _selected(BuildContext context, BoardObject o) {
    final today = tlToday();
    final l = tlLayoutFor(o.raw, today);
    final cam = editor.camera.value;
    final kx = o.w / l.w0, ky = o.h / l.h0;
    final sx = cam.z * kx, sy = cam.z * ky;
    Offset scr(double lx, double ly) => cam.toScreen(Offset(o.x + lx * kx, o.y + ly * ky));
    Rect rect(double x, double y, double w, double h) => Rect.fromPoints(scr(x, y), scr(x + w, y + h));
    final out = <Widget>[];
    final focus = st.focusOf(o.id);
    final writable = editor.editable && !o.locked;
    final edit = st.edit?.timeline == o.id ? st.edit : null;
    // active lane / item (web `is-focus` / `is-active`)
    if (focus?.kind == 'lane') {
      final lane = l.lanes.where((x) => x.id == focus!.id).firstOrNull;
      if (lane != null) {
        out.add(
          Positioned.fromRect(
            rect: rect(tlLabelW, lane.y, l.w0 - tlLabelW, lane.h),
            child: IgnorePointer(
              child: ColoredBox(key: const Key('stachelTlLaneFocus'), color: _blue.withValues(alpha: 0.05)),
            ),
          ),
        );
      }
    }
    final active = focus?.kind == 'item' ? l.items.where((b) => b.id == focus!.id).firstOrNull : null;
    if (active != null && edit == null) {
      final r = active.it.ms
          ? rect(active.x, active.y + (tlBarH - tlDiamond) / 2, tlDiamond, tlDiamond)
          : rect(active.x, active.y, active.w, active.h);
      out.add(
        Positioned.fromRect(
          rect: r.inflate(2 + 1.25 * math.min(sx, 1)),
          child: IgnorePointer(
            child: Container(
              key: const Key('stachelTlActive'),
              decoration: BoxDecoration(
                border: Border.all(color: _blue, width: 2.5),
                borderRadius: BorderRadius.circular(active.it.ms ? 4 : 7 * sx + 3),
              ),
            ),
          ),
        ),
      );
    }
    if (writable && edit == null) {
      // items: drag, hold = dialog, double tap = title
      for (final b in l.items) {
        final r = rect(b.x, b.y, b.w, b.h);
        out.add(
          Positioned.fromRect(
            rect: r.height < 24 ? Rect.fromCenter(center: r.center, width: r.width, height: 24) : r,
            child: GestureDetector(
              key: Key('stachelTlItem-${b.id}'),
              behavior: HitTestBehavior.opaque,
              dragStartBehavior: DragStartBehavior.down,
              onTap: () => st.setFocus(o.id, TlFocus.item(b.id)),
              onDoubleTap: () => st.startEdit(o.id, TlFocus.item(b.id)),
              onLongPress: () {
                HapticFeedback.selectionClick();
                st.setFocus(o.id, TlFocus.item(b.id));
                openTimelineItemDialog(context, ui, o.id, b.id);
              },
              onPanStart: (d) => _itemStart(o, b, 'move', d.globalPosition),
              onPanUpdate: (d) => _itemUpdate(o, l, d.globalPosition),
              onPanEnd: (_) => _itemEnd(),
              onPanCancel: () => st.itemDrag = null,
            ),
          ),
        );
      }
      // grips of the active bar (web `TimelineHandles`, 44 px on the phone)
      if (active != null && !active.it.ms) {
        for (final (side, show, lx) in [
          ('start', !active.cutL, active.x),
          ('end', !active.cutR, active.x + active.w),
        ]) {
          if (!show) continue;
          final c = scr(lx, active.y + active.h / 2);
          out.add(
            Positioned(
              left: c.dx - 22,
              top: c.dy - 22,
              width: 44,
              height: 44,
              child: GestureDetector(
                key: Key('stachelTlGrip-$side'),
                behavior: HitTestBehavior.opaque,
                dragStartBehavior: DragStartBehavior.down,
                onPanStart: (d) => _itemStart(o, active, side, d.globalPosition),
                onPanUpdate: (d) => _itemUpdate(o, l, d.globalPosition),
                onPanEnd: (_) => _itemEnd(),
                onPanCancel: () => st.itemDrag = null,
                child: Center(
                  child: Container(
                    width: 14,
                    height: 26,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      border: Border.all(color: _blue, width: 2),
                      borderRadius: BorderRadius.circular(7),
                      boxShadow: const [BoxShadow(color: Color(0x40000000), blurRadius: 6, offset: Offset(0, 2))],
                    ),
                  ),
                ),
              ),
            ),
          );
        }
      }
      // lane grips ⋮⋮ (more than one lane)
      if (l.lanes.length > 1) {
        for (final lane in l.lanes) {
          final c = scr(6, lane.y + lane.h / 2);
          out.add(
            Positioned(
              left: c.dx - 14,
              top: c.dy - 22,
              width: 28,
              height: 44,
              child: GestureDetector(
                key: Key('stachelTlLaneGrip-${lane.id}'),
                behavior: HitTestBehavior.opaque,
                dragStartBehavior: DragStartBehavior.down,
                onVerticalDragStart: (d) {
                  _down = _local(d.globalPosition);
                  st.laneDrag = TlLaneDrag(timeline: o.id, lane: lane.id);
                },
                onVerticalDragUpdate: (d) => _laneUpdate(o, l, d.globalPosition),
                onVerticalDragEnd: (_) => _laneEnd(),
                onVerticalDragCancel: () => st.laneDrag = null,
                child: const Center(
                  child: Text(
                    '⋮⋮',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -3,
                      color: Color(0xFFA3A39C),
                    ),
                  ),
                ),
              ),
            ),
          );
        }
      }
      // „+ Spur“ under the timeline
      if (ui.controller.canAct('timeline.addLane')) {
        final bl = cam.toScreen(Offset(o.x, o.y + o.h));
        out.add(
          Positioned(
            left: bl.dx,
            top: bl.dy + 10,
            height: 44,
            child: Material(
              color: const Color(0xFF0A0A0A),
              shape: const StadiumBorder(),
              elevation: 2,
              child: InkWell(
                key: const Key('stachelTlAddLane'),
                customBorder: const StadiumBorder(),
                onTap: () {
                  final f = st.focusOf(o.id);
                  tlAddLane(ui, o.id, after: f?.kind == 'lane' ? f!.id : null);
                },
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(10, 0, 14, 0),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text(
                        '+',
                        style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: _green),
                      ),
                      const SizedBox(width: 6),
                      Text('SPUR', style: ui.theme.label(size: 14, color: Colors.white)),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      }
    }
    // previews: dragged item, lane drop line
    final drag = st.itemDrag?.timeline == o.id ? st.itemDrag : null;
    final ld = st.laneDrag?.timeline == o.id ? st.laneDrag : null;
    if (drag != null || (ld != null && ld.to >= 0)) {
      out.add(
        Positioned.fill(
          child: IgnorePointer(
            child: CustomPaint(
              key: const Key('stachelTlPreview'),
              painter: _PreviewPainter(o: o, l: l, origin: scr(0, 0), sx: sx, sy: sy, drag: drag, lane: ld),
            ),
          ),
        ),
      );
    }
    // writing a title / lane name in place
    if (edit != null && writable) {
      final f = edit.focus;
      final b = f.kind == 'item' ? l.items.where((x) => x.id == f.id).firstOrNull : null;
      final lane = f.kind == 'lane' ? l.lanes.where((x) => x.id == f.id).firstOrNull : null;
      final Rect? r = b != null
          ? (b.it.ms
                ? rect(b.x + tlDiamond + 2, b.y, math.max(160, b.w - tlDiamond), b.h)
                : rect(b.x, b.y, math.max(b.w, 120), b.h))
          : lane != null
          ? rect(0, lane.y + lane.h / 2 - 16, tlLabelW, 32)
          : null;
      if (r != null) {
        out.add(
          Positioned.fromRect(
            rect: r,
            child: TlInlineEditor(
              key: ValueKey('tl-edit-${o.id}-${f.kind}-${f.id}'),
              ui: ui,
              timeline: o.id,
              focus: f,
              scale: sx,
            ),
          ),
        );
      } else {
        // gone (deleted meanwhile): stop after this frame
        WidgetsBinding.instance.addPostFrameCallback((_) => st.stopEdit());
      }
    }
    return out;
  }

  void _itemStart(BoardObject o, TlItemBox b, String mode, Offset global) {
    st.setFocus(o.id, TlFocus.item(b.id));
    _down = _local(global);
    _dragBox = b;
    st.itemDrag = TlItemDrag(timeline: o.id, key: b.id, mode: mode, a: b.a, b: b.b, lane: b.lane);
  }

  /// Web `dragItem`: snapped to days, `move` lets the lane follow the finger, milestones only move.
  void _itemUpdate(BoardObject o, TlLayout l, Offset global) {
    final d = st.itemDrag, b0 = _dragBox;
    if (d == null || b0 == null) return;
    final p = _local(global);
    final cam = editor.camera.value;
    final dx = (p.dx - _down.dx) / (cam.z * o.w / l.w0);
    final dd = tlSnapDays(dx, l.dayPx);
    final (a, b) = tlDragDays(b0.a, b0.b, b0.it.ms ? 'move' : d.mode, dd, l.range);
    final w = cam.toWorld(p);
    final lane = d.mode == 'move' ? tlLaneAt(l, tlToLocal(o, l, w.dx, w.dy).ly).id : b0.lane;
    if (a == d.a && b == d.b && lane == d.lane) return;
    d
      ..a = a
      ..b = b
      ..lane = lane;
    st.touch();
  }

  void _itemEnd() {
    final d = st.itemDrag, b0 = _dragBox;
    st.itemDrag = null;
    _dragBox = null;
    if (d == null || b0 == null || (d.a == b0.a && d.b == b0.b && d.lane == b0.lane)) return;
    tlPatchItem(
      ui,
      d.timeline,
      d.key,
      a: d.a,
      b: d.b,
      lane: d.lane != b0.lane ? d.lane : null,
      label: 'Eintrag verschieben',
    );
  }

  /// Web `dragLane`: target = number of other lanes whose middle is above the finger.
  void _laneUpdate(BoardObject o, TlLayout l, Offset global) {
    final d = st.laneDrag;
    if (d == null) return;
    final w = editor.camera.value.toWorld(_local(global));
    final ly = tlToLocal(o, l, w.dx, w.dy).ly;
    final others = l.lanes.where((x) => x.id != d.lane).toList();
    d.to = others.where((x) => x.y + x.h / 2 < ly).length;
    d.y = d.to < others.length ? others[d.to].y : (others.isNotEmpty ? others.last.y + others.last.h : l.lanes.first.y);
    st.touch();
  }

  void _laneEnd() {
    final d = st.laneDrag;
    st.laneDrag = null;
    if (d == null || d.to < 0) return;
    tlMoveLane(ui, d.timeline, d.lane, d.to);
  }
}

/// The dragged item at its new place (with a veil over the old one) and the lane drop line.
class _PreviewPainter extends CustomPainter {
  _PreviewPainter({
    required this.o,
    required this.l,
    required this.origin,
    required this.sx,
    required this.sy,
    this.drag,
    this.lane,
  });
  final BoardObject o;
  final TlLayout l;
  final Offset origin;
  final double sx;
  final double sy;
  final TlItemDrag? drag;
  final TlLaneDrag? lane;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.translate(origin.dx, origin.dy);
    canvas.scale(sx, sy);
    final d = drag;
    if (d != null) {
      final old = l.items.where((b) => b.id == d.key).firstOrNull;
      final data = safeTimeline(o.raw['timeline']);
      final it = data.items[d.key];
      if (old != null && it != null) {
        canvas.drawRRect(
          RRect.fromRectAndRadius(Rect.fromLTWH(old.x, old.y, old.w, old.h).inflate(1), const Radius.circular(7)),
          Paint()..color = const Color(0xB3FFFFFF),
        );
        data.items[d.key] = it.copyWith(start: tlFmtDay(d.a), end: tlFmtDay(d.b), lane: d.lane);
        final nl = tlLayoutOf(data, l.range, l.unit);
        final nb = nl.items.where((b) => b.id == d.key).firstOrNull;
        if (nb != null) {
          paintTimelineItem(canvas, nb, const BoardFonts().regular, opacity: 0.92);
          canvas.drawRRect(
            RRect.fromRectAndRadius(
              Rect.fromLTWH(nb.x, nb.y, nb.it.ms ? tlDiamond : nb.w, nb.h).inflate(3),
              const Radius.circular(9),
            ),
            Paint()
              ..style = PaintingStyle.stroke
              ..strokeWidth = 2.5
              ..color = _blue,
          );
        }
      }
    }
    final ld = lane;
    if (ld != null && ld.to >= 0) {
      canvas.drawRRect(
        RRect.fromRectAndRadius(Rect.fromLTWH(0, ld.y - 2, l.w0, 4), const Radius.circular(2)),
        Paint()..color = _blue,
      );
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _PreviewPainter old) => true;
}

/// Title of an item or name of a lane written in place (web `InlineEdit`): live (`timeline.setTitle` /
/// `timeline.setLaneName` with the state it started from), Enter/„Fertig“ ends writing.
class TlInlineEditor extends StatefulWidget {
  const TlInlineEditor({super.key, required this.ui, required this.timeline, required this.focus, required this.scale});
  final BoardUi ui;
  final String timeline;
  final TlFocus focus;
  final double scale;

  @override
  State<TlInlineEditor> createState() => _TlInlineEditorState();
}

class _TlInlineEditorState extends State<TlInlineEditor> {
  late final LiveText _live;
  final _node = FocusNode();

  BoardUi get ui => widget.ui;
  bool get _item => widget.focus.kind == 'item';

  String _read() {
    final o = ui.controller.state[widget.timeline];
    if (o == null) return '';
    final d = safeTimeline(o.raw['timeline']);
    return _item ? (d.items[widget.focus.id]?.title ?? '') : (d.names[widget.focus.id] ?? '');
  }

  @override
  void initState() {
    super.initState();
    _live = LiveText(read: _read, send: (base, text) => tlSendText(ui, widget.timeline, widget.focus, base, text));
    ui.controller.addListener(_live.pull);
    _node.addListener(() {
      if (!_node.hasFocus && mounted) TimelineState.of(ui.editor).stopEdit();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _node.requestFocus();
    });
  }

  @override
  void dispose() {
    ui.controller.removeListener(_live.pull);
    _live.dispose();
    _live.controller.dispose();
    _node.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.scale;
    final lane = !_item;
    return Material(
      color: Colors.white,
      elevation: 4,
      shape: RoundedRectangleBorder(
        side: const BorderSide(color: _blue, width: 2.5),
        borderRadius: BorderRadius.circular(lane ? 0 : 7),
      ),
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: math.max(4, 10 * s)),
        child: Center(
          child: TextField(
            key: Key(lane ? 'stachelTlLaneName' : 'stachelTlTitleInline'),
            controller: _live.controller,
            focusNode: _node,
            maxLines: 1,
            inputFormatters: [LengthLimitingTextInputFormatter(200)],
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => TimelineState.of(ui.editor).stopEdit(),
            style: TextStyle(
              fontSize: math.max(11, (lane ? 17 : 14) * s),
              fontWeight: lane ? FontWeight.w700 : FontWeight.w600,
              color: const Color(0xFF1C1C1A),
            ),
            cursorColor: _blue,
            decoration: InputDecoration.collapsed(
              hintText: lane ? 'Name der Spur' : 'Titel',
              hintStyle: TextStyle(fontSize: math.max(11, (lane ? 17 : 14) * s), color: const Color(0x590A0A0A)),
            ),
          ),
        ),
      ),
    );
  }
}

/// Sends a title / lane name (base = what the field started from), with the new text as preview.
void tlSendText(BoardUi ui, String id, TlFocus f, String base, String text) {
  if (f.kind == 'item') {
    tlAct(
      ui,
      id,
      'timeline.setTitle',
      {'id': id, 'key': f.id, 'base': base, 'text': text},
      next: (d) {
        final it = d.items[f.id];
        if (it != null) d.items[f.id] = it.copyWith(title: text);
        return d;
      },
    );
  } else {
    tlAct(ui, id, 'timeline.setLaneName', {
      'id': id,
      'lane': f.id,
      'base': base,
      'text': text,
    }, next: (d) => d..names[f.id] = text);
  }
}
