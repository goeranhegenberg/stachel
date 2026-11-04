import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../editor/board_editor.dart';
import '../../editor/registry/board_ui.dart';
import '../../editor/registry/tool_def.dart';
import '../../geometry/shape_paths.dart';
import '../../geometry/svg_path.dart';
import '../../model/board_object.dart';
import '../../model/board_source.dart';
import '../../protocol/native_messages.dart';
import 'catalog.dart';
import 'library.dart';
import 'shape_state.dart';
import 'shape_widgets.dart';

// The note and shape tools of P2 (web `editor/core/tools.tsx` sticky/shape, `stickyShape.tsx` tool options,
// `library.tsx` `ShapeOptions`, `shapeType.tsx` `create`): options above the tool bar, new objects like the web,
// drawing a shape with the finger (C07).

// ---- new objects (registry `creates`, web `ObjectTypeDef.create`) --------------------------------------------------

/// A new note at [p]: the tool's color and shape (web `stickyShape.tsx` `create`).
Map<String, Object?> newSticky(BoardEditor editor, Offset p) {
  final size = stickySize(P2Tools.of(editor).stickyShape);
  return {
    'type': 'sticky',
    'x': jsRoundP2(p.dx - size.width / 2),
    'y': jsRoundP2(p.dy - size.height / 2),
    'w': size.width,
    'h': size.height,
    'color': editor.stickyColor,
    'text': '',
  };
}

/// A new shape of [kind] (default: the tool's) centered at [p] in its library size (web `shapeType.tsx` `create`).
Map<String, Object?> newShape(BoardEditor editor, Offset p, {String? kind, Size? size}) {
  final tools = P2Tools.of(editor);
  final k = kind ?? tools.shapeKind;
  final e = kind == null ? tools.currentEntry : entryOfKind(kind);
  final s = size ?? (e == null ? const Size(180, 120) : Size(e.w, e.h));
  return {
    'type': 'shape',
    'shape': k,
    'x': jsRoundP2(p.dx - s.width / 2),
    'y': jsRoundP2(p.dy - s.height / 2),
    'w': s.width,
    'h': s.height,
    'color': '#ffffff',
    'stroke': '#0a0a0a',
    'strokeWidth': 2,
    'text': '',
    'fontSize': 20,
  };
}

// ---- drawing a shape (C07, web `drawGesture`) ------------------------------------------------------------------------

/// The shape tool: a tap places the shape in its library size, dragging draws it (one finger; two still zoom).
final shapeToolBehavior = BoardToolBehavior(
  draws: true,
  onDrawStart: (e) {
    final t = P2Tools.of(e.editor);
    t
      ..drawFrom = e.world
      ..drawFromScreen = e.screen;
    t.drawRect.value = null;
  },
  onDrawUpdate: (e) {
    final t = P2Tools.of(e.editor);
    final from = t.drawFrom, fromScreen = t.drawFromScreen;
    if (from == null || fromScreen == null) return;
    if (t.drawRect.value == null && (e.screen - fromScreen).distance < 8) return;
    t.drawRect.value = Rect.fromPoints(from, e.world);
  },
  onDrawEnd: (e) {
    final t = P2Tools.of(e.editor);
    final from = t.drawFrom, fromScreen = t.drawFromScreen;
    t
      ..drawFrom = null
      ..drawFromScreen = null;
    t.drawRect.value = null;
    if (from == null || fromScreen == null || !e.editor.editable) return;
    // a short tap: the shape in its library size (web: < 8 px)
    final tap = !e.moved || (e.screen - fromScreen).distance < 8;
    final size = t.shapeSize;
    final r = tap
        ? Rect.fromCenter(center: from, width: size.width, height: size.height)
        : Rect.fromPoints(from, e.world);
    final x = jsRoundP2(r.left), y = jsRoundP2(r.top);
    final w = math.max(16.0, jsRoundP2(r.width)), h = math.max(16.0, jsRoundP2(r.height));
    final id = BoardController.newId();
    final o = {'id': id, ...newShape(e.editor, Offset(x + w / 2, y + h / 2)), 'x': x, 'y': y, 'w': w, 'h': h};
    e.editor.controller.apply([
      CreateOp([o]),
    ]);
    e.editor.select({id});
  },
  onDrawCancel: (editor) {
    final t = P2Tools.of(editor);
    t
      ..drawFrom = null
      ..drawFromScreen = null;
    t.drawRect.value = null;
  },
);

/// The shape being drawn (screen space over the board).
class ShapeDraftLayer extends StatelessWidget {
  const ShapeDraftLayer({super.key, required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) {
    final t = P2Tools.of(ui.editor);
    return IgnorePointer(
      child: ListenableBuilder(
        listenable: Listenable.merge([t.drawRect, ui.editor.camera]),
        builder: (context, _) {
          final r = t.drawRect.value;
          if (r == null) return const SizedBox.shrink();
          return CustomPaint(
            key: const Key('stachelShapeDraft'),
            size: Size.infinite,
            painter: _DraftPainter(ui.editor.camera.value.rectToScreen(r), t.shapeKind, ui.theme.accent),
          );
        },
      ),
    );
  }
}

class _DraftPainter extends CustomPainter {
  _DraftPainter(this.r, this.kind, this.color);
  final Rect r;
  final String kind;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final path = parseSvgPath(shapePathData(kind, math.max(1, r.width), math.max(1, r.height), 0)).shift(r.topLeft);
    canvas
      ..drawPath(path, Paint()..color = color.withValues(alpha: 0.08))
      ..drawPath(
        path,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5
          ..color = color,
      );
  }

  @override
  bool shouldRepaint(covariant _DraftPainter old) => old.r != r || old.kind != kind;
}

// ---- tool options ----------------------------------------------------------------------------------------------------

/// Options of the note tool (C04): the 12 note colors and the shape square/rectangle for new notes.
class StickyToolOptions extends StatelessWidget {
  const StickyToolOptions({super.key, required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) {
    final t = P2Tools.of(ui.editor);
    return ListenableBuilder(
      listenable: t,
      builder: (context, _) => P2OptionStrip(
        key: const Key('stachelStickyOptions'),
        ui: ui,
        children: [
          // 12 colors in two rows of six (web: same grid in the tool's flyout), so the shapes stay on screen
          Column(
            key: const Key('stachelStickyColors'),
            mainAxisSize: MainAxisSize.min,
            children: [
              for (var row = 0; row < stickyColors.length; row += 6)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (final c in stickyColors.skip(row).take(6))
                      P2Swatch(
                        key: Key('stachelStickyColor-$c'),
                        color: c,
                        label: 'Notizfarbe ${colorNameOf(c)}',
                        active: ui.editor.stickyColor == c,
                        size: 26,
                        onTap: () => t.stickyColor = c,
                      ),
                  ],
                ),
            ],
          ),
          const SizedBox(width: 8),
          for (final (shape, label) in const [('square', 'Quadrat'), ('rect', 'Rechteck')])
            P2FlyButton(
              key: Key('stachelStickyShape-$shape'),
              label: 'Notizform $label',
              active: t.stickyShape == shape,
              onTap: () => t.stickyShape = shape,
              child: StickyShapeIcon(shape, color: ui.theme.ink),
            ),
        ],
      ),
    );
  }
}

/// Options of the shape tool (C06, web `ShapeOptions`): quick choice (a shape picked in the library in front) and
/// „Alle Formen“.
class ShapeToolOptions extends StatelessWidget {
  const ShapeToolOptions({super.key, required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) {
    final t = P2Tools.of(ui.editor);
    return ListenableBuilder(
      listenable: t,
      builder: (context, _) {
        final quick = [for (final id in quickShapeIds) ?entryById(id)];
        final kind = t.shapeKind;
        final extra = quick.any((e) => e.kind == kind) ? null : (entryById(t.shapeEntry) ?? entryOfKind(kind));
        final list = [?extra, ...quick];
        final activeId = list.any((x) => x.id == t.shapeEntry && x.kind == kind)
            ? t.shapeEntry
            : list.where((x) => x.kind == kind).firstOrNull?.id;
        return P2OptionStrip(
          key: const Key('stachelShapeOptions'),
          ui: ui,
          children: [
            for (final e in list)
              P2FlyButton(
                key: Key('stachelShape-${e.id}'),
                label: e.label,
                active: e.id == activeId,
                onTap: () => t.setShape(e.kind, e.id),
                child: ShapeKindIcon(e.kind, w: e.w, h: e.h, color: ui.theme.ink),
              ),
            P2FlyButton(
              key: const Key('stachelShapeAll'),
              label: 'Alle Formen',
              onTap: () => openLibrary(context, ui, 'shapes'),
              child: Icon(Icons.dashboard_customize_outlined, color: ui.theme.ink),
            ),
          ],
        );
      },
    );
  }
}

/// Hint over the board while the shape tool is active (the chosen shape is marked in the options above the bar).
String shapeToolHint(BoardUi ui) => 'Tippe auf das Board oder ziehe die Form mit dem Finger auf.';

/// The object [o] as an empty copy (same look, no text/tags/group/lock) – web `siblingFields`.
Map<String, Object?> emptyCopy(BoardObject o, String id, double x, double y) => <String, Object?>{...o.raw}
  ..remove('z')
  ..remove('createdBy')
  ..remove('updatedAt')
  ..remove('content')
  ..remove('locked')
  ..remove('groupId')
  ..remove('tags')
  ..remove('hidden')
  ..remove('linkTo')
  ..['id'] = id
  ..['text'] = ''
  ..['x'] = x
  ..['y'] = y;
