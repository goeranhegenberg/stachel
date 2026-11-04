import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../editor/registry/context_action_def.dart';
import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import '../../editor/registry/sheet_def.dart';
import '../../editor/registry/tool_def.dart';
import '../../model/board_object.dart';
import '../../protocol/native_messages.dart';
import '../core/core_widgets.dart';
import 'frame_tool.dart';
import 'frames_list.dart';
import 'frames_model.dart';
import 'present.dart';

/// P4: Rahmen-Formate, Raster, Liste umsortieren (act `frames.reorder`), Präsentation + Folgen (parity audit §4, rows
/// C12, E15, H02–H05, H08).
///
/// Web ids and orders: tool `frame` · 80 (replaced: formats as options, drawing in the aspect ratio), context bar
/// `structure.frameFormat` · 22, `structure.frameGrid` · 23, overlays `frames.present` (`presenting`),
/// `structure.follow`, `frames.draft`; sheet `frames.list` (the app's „Rahmen“ entry opens it).
void registerFrames(BoardRegistry r) {
  final core = r.tools['frame'];
  r.defineTool(
    ToolDef(
      id: 'frame',
      label: core?.label ?? 'Rahmen',
      icon: core?.icon ?? Icons.crop_free,
      order: core?.order ?? 80,
      keyName: core?.keyName ?? 'stachelToolFrame',
      moreKey: core?.moreKey ?? 'stachelMoreFrame',
      phone: core?.phone ?? ToolPlace.bar,
      subtitle: 'Format wählen, dann tippen oder aufziehen',
      hint: (_) => 'Tippe auf das Board oder zieh den Rahmen auf (${framePreset(framePresetOption.value).label}).',
      behavior: frameToolBehavior,
      options: (context, ui) => FrameToolOptions(ui: ui),
    ),
  );
  r.defineSheet(
    SheetDef(
      id: framesListSheet,
      build: (context, ui, _) => FramesListSheet(ui: ui),
      side: true, // large windows: panel at the right (UX-Review P12)
    ),
  );
  r.defineOverlay(
    OverlayDef(
      id: 'frames.draft',
      order: 5,
      build: (context, ui) => FrameDraftLayer(ui: ui),
    ),
  );
  r.defineOverlay(
    OverlayDef(
      id: 'structure.follow',
      order: 30,
      build: (context, ui) => FollowPresenterLayer(ui: ui),
    ),
  );
  // „Mara möchte dir die Präsentation übergeben“ (docs/features/private.md §7)
  r.defineOverlay(
    OverlayDef(
      id: 'structure.handover',
      // above the view layer (90): its buttons must win
      order: 95,
      presenting: true,
      build: (context, ui) => HandoverNotice(ui: ui),
    ),
  );
  r.defineOverlay(
    OverlayDef(
      id: 'frames.present',
      order: 100,
      presenting: true,
      build: (context, ui) => PresentLayer(ui: ui),
    ),
  );

  bool frames(CtxInfo c, BoardUi ui) => ui.editor.editable && !c.locked && c.selected.isNotEmpty && c.only('frame');

  // „Format“ of one frame (web: Formate ohne „Frei“, aktiv bei gleicher Größe)
  r.defineContextAction(
    ContextActionDef(
      id: 'structure.frameFormat',
      order: 22,
      section: CtxSection.style,
      appliesTo: (c, ui) => frames(c, ui) && c.single != null,
      items: (context, ui, c) => [
        CtxItem(
          key: 'stachelCtxFrameFormat',
          label: 'Format',
          icon: Icons.aspect_ratio,
          onTap: (context, ui) async {
            final f = c.single!;
            final list = [
              for (final p in framePresets)
                if (!p.free) p,
            ];
            final picked = await pickFromList<FramePreset>(
              context,
              ui,
              // the format of the frame is marked (web: `is-active` at the same size)
              [for (final p in list) (p, p.w == f.w && p.h == f.h ? '${p.label}  ✓' : p.label)],
              keyOf: (p) => 'stachelFrameFormatPick-${p.id}',
              heading: 'FORMAT',
              leading: (p) => PresetIcon(preset: p, color: ui.theme.ink),
            );
            if (picked != null) _patchFrames(ui, (o) => {'w': picked.w, 'h': picked.h});
          },
        ),
      ],
    ),
  );
  // „Raster“: Ohne / 50 / 100 / 140 / 200 and „A1 B2“ (labels only with a grid)
  r.defineContextAction(
    ContextActionDef(
      id: 'structure.frameGrid',
      order: 23,
      section: CtxSection.style,
      appliesTo: frames,
      items: (context, ui, c) => [
        CtxItem(
          key: 'stachelCtxFrameGrid',
          label: 'Raster',
          icon: Icons.grid_4x4,
          active: c.first.frameGrid != null,
          onTap: (context, ui) => ui.openSheet<void>(context, (ctx) => _FrameGridSheet(ui: ui)),
        ),
      ],
    ),
  );
}

/// Patches every selected (unlocked) frame (one undo step).
void _patchFrames(BoardUi ui, Map<String, Object?> Function(BoardObject o) patch) {
  final ps = <String, Map<String, Object?>>{
    for (final o in ui.editor.selected)
      if (o.type == 'frame' && !o.locked) o.id: patch(o),
  };
  if (ps.isNotEmpty) ui.controller.apply([UpdateOp(ps)]);
}

class _FrameGridSheet extends StatelessWidget {
  const _FrameGridSheet({required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) => SafeArea(
    child: ListenableBuilder(
      listenable: ui.controller,
      builder: (context, _) {
        final sel = ui.editor.selected.where((o) => o.type == 'frame').toList();
        if (sel.isEmpty) return const SizedBox.shrink();
        final first = sel.first;
        final grid = first.frameGrid;
        Widget chip(String key, String label, bool active, VoidCallback? onTap) => ChoiceChip(
          key: Key(key),
          label: Text(label),
          selected: active,
          onSelected: onTap == null ? null : (_) => onTap(),
        );
        return Padding(
          key: const Key('stachelFrameGridSheet'),
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('RASTER', style: ui.theme.label(size: 15)),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  chip(
                    'stachelFrameGrid-0',
                    'Ohne',
                    grid == null,
                    () => _patchFrames(ui, (o) => {'frameGrid': null, 'frameGridLabels': null}),
                  ),
                  for (final g in frameGridSizes)
                    chip(
                      'stachelFrameGrid-${g.round()}',
                      '${g.round()}',
                      grid == g,
                      () => _patchFrames(ui, (o) => {'frameGrid': g}),
                    ),
                  chip(
                    'stachelFrameGridLabels',
                    'A1 B2',
                    first.frameGridLabels,
                    grid == null
                        ? null
                        : () => _patchFrames(ui, (o) => {'frameGridLabels': o.frameGridLabels ? null : true}),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    ),
  );
}
