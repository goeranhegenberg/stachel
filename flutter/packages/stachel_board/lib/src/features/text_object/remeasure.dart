import 'dart:math' as math;

import 'package:flutter/widgets.dart';

import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../protocol/native_messages.dart';
import '../../render/text_layout.dart';
import '../richtext/whole.dart';

/// Web `TextView` + `onMeasured`: a selected text object (not being written in, no gesture running) whose drawn height
/// differs from `h` by more than 2 px gets its height again – after a side handle fixed the width, a font change of a
/// wrapping text, or a change by someone else. Only once per look of the text (text, width, font …), so two clients
/// with slightly different font metrics never write against each other.
class TextRemeasure extends StatefulWidget {
  const TextRemeasure({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<TextRemeasure> createState() => _TextRemeasureState();
}

class _TextRemeasureState extends State<TextRemeasure> {
  final _done = <String, String>{};
  bool _scheduled = false;

  @override
  void initState() {
    super.initState();
    widget.ui.controller.addListener(_schedule);
    widget.ui.editor.selection.addListener(_schedule);
    widget.ui.editor.addListener(_schedule);
  }

  @override
  void dispose() {
    widget.ui.controller.removeListener(_schedule);
    widget.ui.editor.selection.removeListener(_schedule);
    widget.ui.editor.removeListener(_schedule);
    super.dispose();
  }

  void _schedule() {
    if (_scheduled) return;
    _scheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _scheduled = false;
      if (mounted) _check();
    });
  }

  /// What the height depends on (not `h` itself).
  static String _look(BoardObject o) => [
    o.w,
    o.fontSize,
    o.fontFamily,
    o.bold,
    o.italic,
    o.autoWidth,
    o.raw['text'],
    o.raw['content'],
  ].join('|');

  void _check() {
    final ui = widget.ui, e = ui.editor, c = ui.controller;
    if (!e.editable || e.dragging || e.handling) return;
    final fonts = ui.view?.widget.fonts ?? const BoardFonts();
    final patches = <String, Map<String, Object?>>{};
    for (final id in e.selection.value) {
      final o = c.state[id];
      if (o == null || o.type != 'text' || o.locked || e.editingId == id || c.hasPending(id)) continue;
      final look = _look(o);
      if (_done[id] == look) continue;
      _done[id] = look;
      final fs = o.fontSize ?? 24;
      final h = math.max(measureTextObject(o, fonts).height.ceilToDouble(), (fs * 1.25).roundToDouble());
      if ((h - o.h).abs() > 2) patches[id] = {'h': h};
    }
    if (patches.isNotEmpty) c.apply([UpdateOp(patches)]);
  }

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
