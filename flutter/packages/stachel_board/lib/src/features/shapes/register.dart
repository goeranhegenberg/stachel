import 'package:flutter/material.dart';

import '../../editor/board_editor.dart';
import '../../editor/registry/context_action_def.dart';
import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import '../../editor/registry/sheet_def.dart';
import '../../editor/registry/tool_def.dart';
import '../core/core_widgets.dart' show ColorSwatchDot, pickColor;
import '../core/register.dart' show paletteOf;
import 'attach.dart';
import 'library.dart';
import 'shape_sheets.dart';
import 'shape_tools.dart';
import 'shape_widgets.dart';

/// P2: shape library (sheet, all 41 shapes), shape tool with quick choice and drawing, fill/opacity/border, „Form
/// ändern“, note tool options and note shape, „Form anhängen“.
///
/// Owner: P2 (parity audit §4, rows C04, C06–C07, D39, E03–E05, E11, J01). Web: `features/shapes/library.tsx`,
/// `shapeType.tsx` (`core.shape`), `stickyShape.tsx`, `quickConnect.tsx` (AttachPicker), `editor/core/tools.tsx`
/// (`drawGesture`, sticky/shape tools).
void registerShapes(BoardRegistry r) {
  r.creates['sticky'] = (editor, p, _) => newSticky(editor, p);
  r.creates['shape'] = (editor, p, shape) => newShape(editor, p, kind: shape);
  r.defineTool(
    ToolDef(
      id: 'sticky',
      label: 'Haftnotiz',
      shortLabel: 'NOTIZ',
      icon: Icons.sticky_note_2_outlined,
      order: 30,
      tool: BoardTool.sticky,
      keyName: 'stachelToolSticky',
      hint: (_) => 'Tippe auf das Board: dort kommt die Haftnotiz hin.',
      options: (context, ui) => StickyToolOptions(ui: ui),
    ),
  );
  r.defineTool(
    ToolDef(
      id: 'shape',
      label: 'Form',
      icon: Icons.category_outlined,
      order: 50,
      keyName: 'stachelToolShape',
      behavior: shapeToolBehavior,
      hint: shapeToolHint,
      options: (context, ui) => ShapeToolOptions(ui: ui),
    ),
  );
  r.defineSheet(
    SheetDef(
      id: librarySheet,
      build: (context, ui, args) => ShapeLibrary(ui: ui, tab: args['tab'] as String?),
    ),
  );
  r.defineOverlay(
    OverlayDef(
      id: 'shapes.draft',
      order: 49,
      build: (context, ui) => ShapeDraftLayer(ui: ui),
    ),
  );
  r.defineOverlay(
    OverlayDef(
      id: 'shapes.attach',
      order: 51,
      build: (context, ui) => AttachPicker(ui: ui),
    ),
  );
  _color(r);
  _shape(r);
  _stickyShape(r);
}

// ---- color (web `core.color`: shapes have their own fill below, icons take the ink colors) -------------------------

/// Palette of the color entry: like the core's, but none for shapes (web `colorable: false`, fill is in `core.shape`)
/// and the ink colors for icons (E14).
List<String>? colorPaletteOf(CtxInfo c) {
  if (c.types.length == 1 && c.types.single == 'shape') return null;
  if (c.types.length == 1 && c.types.single == 'icon') return inkColors;
  return paletteOf(c);
}

void _color(BoardRegistry r) {
  r.defineContextAction(
    ContextActionDef(
      id: 'core.color',
      order: 10,
      section: CtxSection.style,
      appliesTo: (c, ui) => ui.editor.editable && !c.locked && colorPaletteOf(c) != null,
      items: (context, ui, c) {
        final palette = colorPaletteOf(c)!;
        return [
          CtxItem(
            key: 'stachelCtxColor',
            primary: true,
            label: 'Farbe',
            leading: (_) => ColorSwatchDot(c.first.color ?? palette.first, ink: ui.theme.ink),
            onTap: (context, ui) async {
              final v = await pickColor(context, ui, palette);
              if (v != null) ui.editor.setField('color', v);
            },
          ),
        ];
      },
    ),
  );
}

// ---- shape: kind, fill, border (E03–E05, web `core.shape` · 10 of `shapeType.tsx`) ---------------------------------

void _shape(BoardRegistry r) {
  r.defineContextAction(
    ContextActionDef(
      id: 'core.shape',
      order: 10,
      section: CtxSection.style,
      appliesTo: (c, ui) => ui.editor.editable && !c.locked && c.only('shape'),
      items: (context, ui, c) => [
        CtxItem(
          key: 'stachelCtxShapeKind',
          label: 'Form ändern',
          leading: (_) => ShapeKindIcon(c.first.shape ?? 'rect', color: ui.theme.ink),
          onTap: (context, ui) => showKindSheet(context, ui),
        ),
        CtxItem(
          key: 'stachelCtxFill',
          label: 'Füllfarbe',
          // UX P4: the shape's „Farbe“ in the phone bar
          primary: true,
          short: 'Farbe',
          leading: (_) => FillDot(c.first, ink: ui.theme.ink),
          onTap: (context, ui) => showFillSheet(context, ui),
        ),
        CtxItem(
          key: 'stachelCtxBorder',
          label: 'Rand',
          leading: (_) => BorderIcon(c.first, ink: ui.theme.ink),
          onTap: (context, ui) => showBorderSheet(context, ui),
        ),
      ],
    ),
  );
}

// ---- note shape (E11, web `shapes.stickyShape` · 21) ---------------------------------------------------------------

void _stickyShape(BoardRegistry r) {
  r.defineContextAction(
    ContextActionDef(
      id: 'shapes.stickyShape',
      order: 21,
      section: CtxSection.style,
      appliesTo: (c, ui) => ui.editor.editable && !c.locked && c.only('sticky'),
      items: (context, ui, c) => [
        CtxItem(
          key: 'stachelCtxNoteShape',
          label: 'Form der Notiz',
          leading: (_) => StickyShapeIcon(stickyShapeOfAll(c.selected), color: ui.theme.ink),
          onTap: (context, ui) => showStickyShapeSheet(context, ui),
        ),
      ],
    ),
  );
}
