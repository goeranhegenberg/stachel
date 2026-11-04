import 'package:flutter/material.dart';

import '../../editor/camera.dart';
import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import 'snapping.dart';

/// P1: Einrasten beim Ziehen/Größe ändern (Port `interaction/snapping.ts` in [snapMove]/[snapResize], used by the
/// editor), pink guides and gap marks ([SnapGuidesPainter]), „Am Raster einrasten“ (board menu, web
/// `tools.boardSnap` · 50); the edge pan lives in the view (D13–D16, D18).
void registerSnapping(BoardRegistry r) {
  r.defineOverlay(
    OverlayDef(
      id: 'snapping.guides',
      order: 5,
      build: (context, ui) => IgnorePointer(
        child: ListenableBuilder(
          listenable: Listenable.merge([ui.editor.guides, ui.editor.camera]),
          builder: (context, _) => CustomPaint(
            painter: SnapGuidesPainter(ui.editor.guides.value, ui.editor.camera.value),
            size: Size.infinite,
          ),
        ),
      ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'tools.boardSnap',
      on: MenuTarget.board,
      order: 50,
      section: MenuSection.view,
      entry: (ui, at) => MenuEntry(
        key: 'stachelBoardSnap',
        label: 'Am Raster einrasten',
        subtitle: SnapPrefs.gridOn ? 'An' : 'Aus',
        icon: Icons.grid_4x4,
        onSelect: (c, ui) => SnapPrefs.setGrid(!SnapPrefs.gridOn),
      ),
    ),
  );
}

/// Guides of the web (`ov-guide`: pink 1 px lines; gap marks with end ticks and their length in a pink label).
class SnapGuidesPainter extends CustomPainter {
  SnapGuidesPainter(this.guides, this.camera);
  final SnapGuides guides;
  final Camera camera;

  static const pink = Color(0xFFEC4E92);

  @override
  void paint(Canvas canvas, Size size) {
    if (guides.isEmpty) return;
    final line = Paint()
      ..color = pink
      ..strokeWidth = 1;
    for (final l in guides.lines) {
      canvas.drawLine(camera.toScreen(Offset(l.x1, l.y1)), camera.toScreen(Offset(l.x2, l.y2)), line);
    }
    for (final g in guides.gaps) {
      final a = camera.toScreen(Offset(g.x1, g.y1)), b = camera.toScreen(Offset(g.x2, g.y2));
      canvas.drawLine(a, b, line);
      final vertical = (a.dx - b.dx).abs() < 0.5;
      final tick = vertical ? const Offset(4, 0) : const Offset(0, 4);
      canvas
        ..drawLine(a - tick, a + tick, line)
        ..drawLine(b - tick, b + tick, line);
      final tp = TextPainter(
        text: TextSpan(
          text: '${g.len}',
          style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w700),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      final c = (a + b) / 2;
      final box = Rect.fromCenter(center: c, width: tp.width + 8, height: tp.height + 4);
      canvas.drawRRect(RRect.fromRectAndRadius(box, const Radius.circular(3)), Paint()..color = pink);
      tp.paint(canvas, box.topLeft + const Offset(4, 2));
    }
  }

  @override
  bool shouldRepaint(covariant SnapGuidesPainter old) => !identical(old.guides, guides) || old.camera != camera;
}
