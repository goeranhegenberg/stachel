import 'dart:async';

import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../protocol/native_messages.dart';
import '../../render/board_scene.dart';
import '../view/minimap.dart';
import '../view/view_camera.dart';
import 'frames_model.dart';
import 'present.dart';

/// Sheet id of the frame list (web side bar „Rahmen“).
const framesListSheet = 'frames.list';

/// Frame list (H01, H02, H03; web editor/interaction/Frames.tsx FramesPanel): number, preview, title; tap = camera on
/// the frame (max 200 %), drag at the grip = new order for everyone (web action `frames.reorder`), „Ab hier
/// präsentieren“ per frame and „Präsentieren“.
class FramesListSheet extends StatefulWidget {
  const FramesListSheet({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<FramesListSheet> createState() => _FramesListSheetState();
}

class _FramesListSheetState extends State<FramesListSheet> {
  /// Order shown until the server answered a move (no jumping back).
  List<String>? _local;

  BoardUi get ui => widget.ui;

  bool get _canReorder => ui.controller.mayEdit && ui.editor.editable && ui.controller.canAct('frames.reorder');

  /// Speaker notes can be written (else only read when there are some).
  bool get _canNote => ui.controller.mayEdit && ui.editor.editable;

  List<BoardObject> _frames() {
    final list = framesInOrderWeb(ui.controller.state.ordered);
    final local = _local;
    if (local == null) return list;
    final byId = {for (final f in list) f.id: f};
    return [
      for (final id in local) ?byId[id],
      for (final f in list)
        if (!local.contains(f.id)) f,
    ];
  }

  Future<void> _move(List<BoardObject> frames, int from, int to) async {
    if (from == to) return;
    final id = frames[from].id;
    final next = [for (final f in frames) f.id]
      ..removeAt(from)
      ..insert(to, id);
    setState(() => _local = next);
    try {
      await ui.controller.act('frames.reorder', {'id': id, 'to': to}, label: 'Rahmen umsortieren');
    } finally {
      if (mounted) setState(() => _local = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = ui.theme;
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.75),
        child: ListenableBuilder(
          listenable: ui.controller,
          builder: (context, _) {
            final frames = _frames();
            final reorder = _canReorder;
            return Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  title: Row(
                    children: [
                      Text('RAHMEN', style: t.label(size: 15)),
                      if (frames.isNotEmpty) ...[
                        const SizedBox(width: 8),
                        Text(
                          '${frames.length}',
                          key: const Key('stachelFrameCount'),
                          style: TextStyle(color: t.grey),
                        ),
                      ],
                    ],
                  ),
                ),
                if (frames.isEmpty)
                  const ListTile(
                    key: Key('stachelFrameList'),
                    title: Text('Noch keine Rahmen. Mit dem Rahmen-Werkzeug einen Rahmen aufziehen.'),
                  )
                else
                  Flexible(
                    child: ReorderableListView.builder(
                      key: const Key('stachelFrameList'),
                      shrinkWrap: true,
                      buildDefaultDragHandles: false,
                      itemCount: frames.length,
                      onReorderItem: (from, to) => unawaited(_move(frames, from, to)),
                      itemBuilder: (context, i) {
                        final f = frames[i];
                        return ListTile(
                          key: Key('stachelFrameItem-${f.id}'),
                          contentPadding: const EdgeInsets.only(left: 4, right: 4),
                          leading: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (reorder)
                                ReorderableDragStartListener(
                                  index: i,
                                  child: Padding(
                                    key: Key('stachelFrameGrip-${f.id}'),
                                    padding: const EdgeInsets.all(8),
                                    child: Icon(Icons.drag_indicator, color: t.grey, semanticLabel: 'Verschieben'),
                                  ),
                                )
                              else
                                const SizedBox(width: 8),
                              SizedBox(width: 22, child: Text('${i + 1}', style: t.label(size: 13))),
                              FrameThumb(ui: ui, frame: f),
                            ],
                          ),
                          title: Text(frameTitle(f), maxLines: 1, overflow: TextOverflow.ellipsis),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (_canNote || frameNotes(f).isNotEmpty)
                                IconButton(
                                  key: Key('stachelFrameNotes-${f.id}'),
                                  tooltip: frameNotes(f).isEmpty ? 'Sprechernotizen' : 'Sprechernotizen bearbeiten',
                                  isSelected: frameNotes(f).isNotEmpty,
                                  icon: Icon(
                                    frameNotes(f).isEmpty ? Icons.speaker_notes_outlined : Icons.speaker_notes,
                                    color: frameNotes(f).isEmpty ? t.grey : t.accent,
                                  ),
                                  onPressed: () => unawaited(showFrameNotes(context, ui, f.id)),
                                ),
                              IconButton(
                                key: Key('stachelFramePresent-${f.id}'),
                                tooltip: 'Ab hier präsentieren',
                                icon: const Icon(Icons.play_arrow_rounded),
                                onPressed: () {
                                  Navigator.of(context).pop();
                                  Presentation.of(ui).start(i);
                                },
                              ),
                            ],
                          ),
                          onTap: () {
                            Navigator.of(context).pop();
                            fitTo(ui, objectRect(f));
                          },
                        );
                      },
                    ),
                  ),
                if (frames.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                    child: SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        key: const Key('stachelPresent'),
                        icon: const Icon(Icons.play_arrow_rounded),
                        label: const Text('PRÄSENTIEREN'),
                        onPressed: () {
                          Navigator.of(context).pop();
                          Presentation.of(ui).start(0);
                        },
                      ),
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Longest speaker notes (contract: plain text ≤ 20 000).
const frameNotesMax = 20000;

/// Sheet „Sprechernotizen“ of frame [id] (docs/features/private.md §7): plain text, „Speichern“ writes `notes`
/// (empty = removed); read only without edit rights.
Future<void> showFrameNotes(BuildContext context, BoardUi ui, String id) => ui.openSheet<void>(
  context,
  (ctx) => _FrameNotesSheet(ui: ui, id: id),
  closeOnSelectionChange: false,
  scrollControlled: true,
);

class _FrameNotesSheet extends StatefulWidget {
  const _FrameNotesSheet({required this.ui, required this.id});
  final BoardUi ui;
  final String id;

  @override
  State<_FrameNotesSheet> createState() => _FrameNotesSheetState();
}

class _FrameNotesSheetState extends State<_FrameNotesSheet> {
  late final BoardObject? _frame = widget.ui.controller.state[widget.id];
  late final _text = TextEditingController(text: _frame == null ? '' : (_frame.raw['notes'] as String? ?? ''));

  BoardUi get ui => widget.ui;
  bool get _editable => ui.controller.mayEdit && ui.editor.editable;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  void _save() {
    final f = ui.controller.state[widget.id];
    if (f != null) {
      final text = _text.text.trim().isEmpty ? null : _text.text;
      if (text != f.raw['notes']) {
        ui.controller.apply([
          UpdateOp({
            f.id: {'notes': text},
          }),
        ]);
      }
    }
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final t = ui.theme;
    final f = _frame;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: Padding(
          key: const Key('stachelFrameNotesSheet'),
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('SPRECHERNOTIZEN', style: t.label(size: 15)),
              if (f != null)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(frameTitle(f), style: TextStyle(color: t.grey)),
                ),
              const SizedBox(height: 10),
              TextField(
                key: const Key('stachelFrameNotesField'),
                controller: _text,
                readOnly: !_editable,
                autofocus: _editable && _text.text.isEmpty,
                minLines: 4,
                maxLines: 10,
                maxLength: frameNotesMax,
                buildCounter: (context, {required currentLength, required isFocused, maxLength}) => null,
                decoration: const InputDecoration(
                  hintText: 'Was du beim Präsentieren zu diesem Rahmen sagen willst – sieht nur, wer präsentiert.',
                  border: OutlineInputBorder(),
                ),
              ),
              if (_editable) ...[
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    key: const Key('stachelFrameNotesSave'),
                    onPressed: _save,
                    child: const Text('SPEICHERN'),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Small preview of a frame and what lies inside (web `FrameThumb` via `BoardPreview`; here drawn like the minimap).
class FrameThumb extends StatelessWidget {
  const FrameThumb({super.key, required this.ui, required this.frame});
  final BoardUi ui;
  final BoardObject frame;

  @override
  Widget build(BuildContext context) {
    final r = objectRect(frame);
    final inside = [
      for (final o in ui.controller.state.ordered)
        if (o.id != frame.id && o.type != 'frame' && o.type != 'connector' && _contains(r, objectRect(o))) o,
    ];
    const w = 56.0, h = 36.0;
    return Container(
      width: w,
      height: h,
      margin: const EdgeInsets.only(left: 4),
      decoration: BoxDecoration(border: Border.all(color: ui.theme.ink.withValues(alpha: 0.3))),
      child: CustomPaint(painter: _ThumbPainter(r, [frame, ...inside])),
    );
  }

  static bool _contains(Rect outer, Rect inner) =>
      inner.left >= outer.left && inner.top >= outer.top && inner.right <= outer.right && inner.bottom <= outer.bottom;
}

class _ThumbPainter extends CustomPainter {
  _ThumbPainter(this.view, this.objects);
  final Rect view;
  final List<BoardObject> objects;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.clipRect(Offset.zero & size);
    paintMiniObjects(canvas, objects, MapFrame.fit(view, size), titles: false);
  }

  @override
  bool shouldRepaint(_ThumbPainter old) => old.view != view || old.objects.length != objects.length;
}
