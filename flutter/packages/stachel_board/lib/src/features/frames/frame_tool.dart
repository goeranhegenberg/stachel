import 'package:flutter/material.dart';

import '../../editor/board_editor.dart';
import '../../editor/camera.dart';
import '../../editor/registry/board_ui.dart';
import '../../editor/registry/tool_def.dart';
import '../../model/board_source.dart';
import '../../protocol/native_messages.dart';
import 'frames_model.dart';

// Frame tool with formats (C12, web features/structure/frames/frames.tsx): the options pick a format (per session,
// like the web's tool options); dragging draws the frame in its aspect ratio, a tap puts a frame of the format centered
// at the finger.

/// Chosen format of the frame tool (web `useToolOption('frame', 'preset', 'free')`, in memory per session).
final framePresetOption = ValueNotifier<String>('free');

/// Frame being drawn (world rectangle), shown by [FrameDraftLayer].
final frameDraft = ValueNotifier<Rect?>(null);

Offset? _start;
Offset? _startScreen;

/// Creates a frame at [r] (rounded, at least 16 × 16) with the next number as title and selects it.
String? createFrameAt(BoardEditor editor, Rect r) {
  if (!editor.editable) return null;
  final n = editor.controller.state.objects.values.where((o) => o.type == 'frame').length + 1;
  final id = BoardController.newId();
  editor.controller.apply([
    CreateOp([
      {
        'id': id,
        'type': 'frame',
        'x': r.left.roundToDouble(),
        'y': r.top.roundToDouble(),
        'w': r.width.round().clamp(16, 1 << 30).toDouble(),
        'h': r.height.round().clamp(16, 1 << 30).toDouble(),
        'title': 'Rahmen $n',
        'color': '#ffffff',
      },
    ]),
  ]);
  editor.select({id});
  return id;
}

/// A tap with the tool: the format centered at [world] (web: click < 8 px).
String? framePresetAt(BoardEditor editor, Offset world) {
  final p = framePreset(framePresetOption.value);
  return createFrameAt(editor, Rect.fromLTWH(world.dx - p.w / 2, world.dy - p.h / 2, p.w, p.h));
}

final frameToolBehavior = BoardToolBehavior(
  draws: true,
  onTap: (e) => framePresetAt(e.editor, e.world),
  onDrawStart: (e) {
    _start = e.world;
    _startScreen = e.screen;
    frameDraft.value = null;
  },
  onDrawUpdate: (e) {
    final s = _start;
    if (s == null) return;
    frameDraft.value = presetRect(s, e.world, framePreset(framePresetOption.value));
  },
  onDrawEnd: (e) {
    final s = _start, ss = _startScreen;
    final r = frameDraft.value;
    _start = null;
    frameDraft.value = null;
    if (s == null) return;
    if (!e.moved || ss == null || (e.screen - ss).distance < 8 || r == null) {
      framePresetAt(e.editor, s);
    } else {
      createFrameAt(e.editor, r);
    }
  },
  onDrawCancel: (_) {
    _start = null;
    frameDraft.value = null;
  },
);

/// Format chips above the tool bar while the frame tool is active.
class FrameToolOptions extends StatelessWidget {
  const FrameToolOptions({super.key, required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<String>(
    valueListenable: framePresetOption,
    builder: (context, cur, _) => SingleChildScrollView(
      key: const Key('stachelFrameFormats'),
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Row(
        children: [
          for (final p in framePresets)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: ChoiceChip(
                key: Key('stachelFrameFormat-${p.id}'),
                avatar: PresetIcon(preset: p, color: ui.theme.ink),
                label: Text(p.label),
                selected: cur == p.id,
                onSelected: (_) => framePresetOption.value = p.id,
              ),
            ),
        ],
      ),
    ),
  );
}

/// Small aspect ratio symbol of a format (web `PresetIcon`; „Frei“ = dashed square).
class PresetIcon extends StatelessWidget {
  const PresetIcon({super.key, required this.preset, required this.color});
  final FramePreset preset;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final k = 16 / (preset.w > preset.h ? preset.w : preset.h);
    final w = preset.free ? 14.0 : (preset.w * k).roundToDouble(),
        h = preset.free ? 14.0 : (preset.h * k).roundToDouble();
    return SizedBox(
      width: 18,
      height: 18,
      child: Center(
        child: Container(
          width: w,
          height: h,
          decoration: BoxDecoration(
            border: Border.all(color: color.withValues(alpha: preset.free ? 0.5 : 1), width: 1.5),
          ),
        ),
      ),
    );
  }
}

/// The frame being drawn (blue outline, size label) over the board.
class FrameDraftLayer extends StatelessWidget {
  const FrameDraftLayer({super.key, required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) => IgnorePointer(
    child: ValueListenableBuilder<Rect?>(
      valueListenable: frameDraft,
      builder: (context, r, _) {
        final view = ui.view;
        if (r == null || view == null) return const SizedBox.shrink();
        return CustomPaint(painter: _DraftPainter(r, view.camera), size: Size.infinite);
      },
    ),
  );
}

class _DraftPainter extends CustomPainter {
  _DraftPainter(this.r, this.cam) : super(repaint: cam);
  final Rect r;
  final CameraController cam;

  @override
  void paint(Canvas canvas, Size size) {
    final s = cam.value.rectToScreen(r);
    canvas.drawRect(s, Paint()..color = const Color(0x141763B5));
    canvas.drawRect(
      s,
      Paint()
        ..color = const Color(0xFF1763B5)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5,
    );
  }

  @override
  bool shouldRepaint(_DraftPainter old) => old.r != r;
}
