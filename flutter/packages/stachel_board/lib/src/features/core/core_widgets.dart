import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../editor/board_editor.dart';
import '../../editor/editor_tools.dart';
import '../../editor/registry/board_ui.dart';
import '../../geometry/shape_paths.dart';
import '../../geometry/svg_path.dart';
import '../../model/collab.dart';
import '../a11y/color_names.dart';

// Widgets of the core entries (moved from the app's `stachel_board_tools.dart` in F2, keys unchanged): pen and
// connector options, the pickers of the context bar (color, font size, line style, caps, width), shape picker,
// reaction emojis.

Color hexColor(String c) => Color(int.parse('FF${c.substring(1)}', radix: 16));

/// German names of the basic shapes (tool and picker).
const shapeNames = {
  'rect': 'Rechteck',
  'roundrect': 'Abgerundet',
  'ellipse': 'Kreis',
  'triangle': 'Dreieck',
  'diamond': 'Raute',
  'star': 'Stern',
  'arrowRight': 'Pfeil',
  'cloud': 'Wolke',
  'callout': 'Sprechblase',
};

/// German names of the connector line styles (null = automatic).
const lineStyleNames = {null: 'Automatisch', 'straight': 'Gerade', 'elbow': 'Gewinkelt', 'curved': 'Geschwungen'};

const capNames = {
  'none': 'Keine',
  'arrow': 'Pfeil (offen)',
  'triangle': 'Dreieck',
  'triangleOpen': 'Dreieck (leer)',
  'circle': 'Punkt',
  'circleOpen': 'Kreis (leer)',
  'diamond': 'Raute',
  'diamondOpen': 'Raute (leer)',
  'bar': 'Strich',
};

/// Round color dot with an ink ring.
class ColorSwatchDot extends StatelessWidget {
  const ColorSwatchDot(this.color, {super.key, this.size = 22, this.ink = const Color(0xFF161118)});
  final String color;
  final double size;
  final Color ink;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(
      color: hexColor(color),
      shape: BoxShape.circle,
      border: Border.all(color: ink, width: 2),
    ),
  );
}

/// Options of the pen tool: Stift / Textmarker / Radierer, colors and widths (web pen and marker options).
class PenToolOptions extends StatefulWidget {
  const PenToolOptions({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<PenToolOptions> createState() => _PenToolOptionsState();
}

class _PenToolOptionsState extends State<PenToolOptions> {
  @override
  Widget build(BuildContext context) {
    final editor = widget.ui.editor;
    final theme = widget.ui.theme;
    final erasing = editor.tool == BoardTool.eraser;
    final marker = editor.penMarker && !erasing;
    final colors = marker ? markerColors : penColors;
    final widths = erasing ? eraserSizes : (marker ? markerWidths : penWidths);
    final color = marker ? editor.markerColor : editor.penColor;
    final width = erasing ? editor.eraserSize : (marker ? editor.markerWidth : editor.penWidth);
    void mode(String m) {
      editor.penMarker = m == 'marker';
      editor.tool = m == 'eraser' ? BoardTool.eraser : BoardTool.pen;
      setState(() {});
    }

    return Container(
      key: const Key('stachelPenOptions'),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: theme.ink.withValues(alpha: 0.15))),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            SegmentedButton<String>(
              style: const ButtonStyle(visualDensity: VisualDensity.compact),
              showSelectedIcon: false,
              segments: const [
                ButtonSegment(
                  value: 'pen',
                  icon: Icon(Icons.edit, key: Key('stachelPenMode-pen')),
                  tooltip: 'Stift',
                ),
                ButtonSegment(
                  value: 'marker',
                  icon: Icon(Icons.border_color, key: Key('stachelPenMode-marker')),
                  tooltip: 'Textmarker',
                ),
                ButtonSegment(
                  value: 'eraser',
                  icon: Icon(Icons.auto_fix_normal, key: Key('stachelPenMode-eraser')),
                  tooltip: 'Radierer',
                ),
              ],
              selected: {erasing ? 'eraser' : (marker ? 'marker' : 'pen')},
              onSelectionChanged: (s) => mode(s.first),
            ),
            const SizedBox(width: 8),
            if (!erasing)
              for (final c in colors)
                // P8 (audit P03): German color name like the web („Stiftfarbe Gelb“)
                Semantics(
                  button: true,
                  selected: c == color,
                  label: '${marker ? 'Textmarkerfarbe' : 'Stiftfarbe'} ${colorName(c)}',
                  excludeSemantics: true,
                  child: InkWell(
                    key: Key('stachelPenColor-$c'),
                    customBorder: const CircleBorder(),
                    onTap: () {
                      if (marker) {
                        editor.markerColor = c;
                      } else {
                        editor.penColor = c;
                      }
                      editor.tool = BoardTool.pen;
                      setState(() {});
                    },
                    child: Padding(
                      padding: const EdgeInsets.all(3),
                      child: Container(
                        width: 24,
                        height: 24,
                        decoration: BoxDecoration(
                          color: hexColor(c),
                          shape: BoxShape.circle,
                          border: Border.all(color: c == color ? theme.accent : theme.ink, width: c == color ? 3 : 1.5),
                        ),
                      ),
                    ),
                  ),
                ),
            const SizedBox(width: 6),
            for (final w in widths)
              InkWell(
                key: Key('stachelPenWidth-${w.round()}'),
                customBorder: const CircleBorder(),
                onTap: () {
                  if (erasing) {
                    editor.eraserSize = w;
                  } else if (marker) {
                    editor.markerWidth = w;
                  } else {
                    editor.penWidth = w;
                  }
                  setState(() {});
                },
                child: Container(
                  width: 32,
                  height: 32,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: w == width ? theme.accent : Colors.transparent, width: 2),
                  ),
                  child: Container(
                    width: 4 + w / (erasing ? 3 : (marker ? 2 : 1)),
                    height: 4 + w / (erasing ? 3 : (marker ? 2 : 1)),
                    decoration: BoxDecoration(color: erasing ? theme.grey : hexColor(color), shape: BoxShape.circle),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Options of the connector tool: line style of new connectors („Automatisch“ = curved between two objects).
class ConnectorToolOptions extends StatefulWidget {
  const ConnectorToolOptions({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<ConnectorToolOptions> createState() => _ConnectorToolOptionsState();
}

class _ConnectorToolOptionsState extends State<ConnectorToolOptions> {
  BoardEditor get editor => widget.ui.editor;

  @override
  Widget build(BuildContext context) => Container(
    key: const Key('stachelConnectorOptions'),
    decoration: BoxDecoration(
      border: Border(bottom: BorderSide(color: widget.ui.theme.ink.withValues(alpha: 0.15))),
    ),
    padding: const EdgeInsets.fromLTRB(12, 4, 8, 4),
    child: Row(
      children: [
        Expanded(
          child: Text(
            'Ziehe von einem Objekt zum anderen.',
            style: TextStyle(fontSize: 13, color: widget.ui.theme.grey),
          ),
        ),
        DropdownButton<String?>(
          key: const Key('stachelConnectorStyle'),
          value: editor.connectorStyle,
          underline: const SizedBox.shrink(),
          items: [for (final e in lineStyleNames.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
          onChanged: (v) {
            editor.connectorStyle = v;
            setState(() {});
          },
        ),
        // web ConnectorOptions: „Spitze: Dreieck / Pfeil / Keine“ for new connectors
        for (final cap in toolCaps)
          IconButton(
            key: Key('stachelConnectorCap-$cap'),
            tooltip: 'Spitze: ${capNames[cap]}',
            isSelected: editor.connectorCap == cap,
            color: editor.connectorCap == cap ? widget.ui.theme.accent : widget.ui.theme.ink,
            icon: Icon(switch (cap) {
              'triangle' => Icons.play_arrow,
              'arrow' => Icons.arrow_forward_ios,
              _ => Icons.remove,
            }, size: 20),
            onPressed: () => setState(() => editor.connectorCap = cap),
          ),
      ],
    ),
  );
}

/// Shape picker: recently used first, then the basic shapes.
Future<String?> pickShape(BuildContext context, BoardUi ui) => ui.openSheet<String>(context, (ctx) {
  final editor = ui.editor;
  final kinds = [...editor.recentShapes, ...basicShapes.where((k) => !editor.recentShapes.contains(k))];
  return SafeArea(
    child: Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final k in kinds)
            InkWell(
              key: Key('stachelShape-$k'),
              onTap: () => Navigator.of(ctx).pop(k),
              child: SizedBox(
                width: 76,
                child: Column(
                  children: [
                    SizedBox(
                      width: 56,
                      height: 40,
                      child: CustomPaint(painter: ShapeIconPainter(k, ink: ui.theme.ink)),
                    ),
                    const SizedBox(height: 4),
                    Text(shapeNames[k] ?? k, style: const TextStyle(fontSize: 12)),
                  ],
                ),
              ),
            ),
        ],
      ),
    ),
  );
}, closeOnSelectionChange: false);

/// A shape as a small icon (picker).
class ShapeIconPainter extends CustomPainter {
  ShapeIconPainter(this.kind, {this.ink = const Color(0xFF161118)});
  final String kind;
  final Color ink;

  @override
  void paint(Canvas canvas, Size size) {
    final path = parseSvgPath(shapePathData(kind, size.width, size.height, 1));
    canvas.drawPath(path, Paint()..color = Colors.white);
    canvas.drawPath(
      path,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = ink,
    );
  }

  @override
  bool shouldRepaint(covariant ShapeIconPainter old) => old.kind != kind;
}

/// Color picker sheet over [palette] (context bar „Farbe“).
Future<String?> pickColor(
  BuildContext context,
  BoardUi ui,
  List<String> palette, {
  String keyPrefix = 'stachelColor',
}) => ui.openSheet<String>(
  context,
  (ctx) => SafeArea(
    child: Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Wrap(
        spacing: 12,
        runSpacing: 12,
        children: [
          for (final p in palette)
            // P8 (audit P03): German color name for screen readers like the web („Farbe Gelb“)
            Semantics(
              button: true,
              label: 'Farbe ${colorName(p)}',
              excludeSemantics: true,
              child: InkWell(
                key: Key('$keyPrefix-$p'),
                customBorder: const CircleBorder(),
                onTap: () => Navigator.of(ctx).pop(p),
                child: ColorSwatchDot(p, size: 44, ink: ui.theme.ink),
              ),
            ),
        ],
      ),
    ),
  ),
);

/// Font size sheet (notes also „Automatisch“, returned as -1).
Future<double?> pickFontSize(BuildContext context, BoardUi ui, Set<String> types) {
  final auto = types.every((t) => t == 'sticky');
  final sizes = types.contains('text') ? const [14, 18, 24, 36, 48, 64] : const [12, 16, 20, 28, 36, 48];
  return ui.openSheet<double>(
    context,
    (ctx) => SafeArea(
      child: Wrap(
        children: [
          if (auto)
            ListTile(
              key: const Key('stachelFont-auto'),
              title: const Text('Automatisch (passt sich an)'),
              onTap: () => Navigator.of(ctx).pop(-1.0),
            ),
          for (final s in sizes)
            ListTile(
              key: Key('stachelFont-$s'),
              title: Text('$s', style: TextStyle(fontSize: math.min(28, s.toDouble()))),
              onTap: () => Navigator.of(ctx).pop(s.toDouble()),
            ),
        ],
      ),
    ),
  );
}

/// One of a list of labelled values as a sheet ([keyOf] gives each row's key).
Future<T?> pickFromList<T>(
  BuildContext context,
  BoardUi ui,
  List<(T, String)> values, {
  required String Function(T v) keyOf,
  String? heading,
  Widget Function(T v)? leading,
}) => ui.openSheet<T>(
  context,
  (ctx) => SafeArea(
    child: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (heading != null) ListTile(title: Text(heading)),
          for (final (v, label) in values)
            ListTile(
              key: Key(keyOf(v)),
              leading: leading?.call(v),
              title: Text(label),
              onTap: () => Navigator.of(ctx).pop(v),
            ),
        ],
      ),
    ),
  ),
  scrollControlled: true,
);

/// Emoji picker for reactions (like the web's `EMOJIS`).
Future<String?> pickReactionEmoji(BuildContext context, BoardUi ui) => ui.openSheet<String>(
  context,
  (ctx) => SafeArea(
    child: Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final e in reactionEmojis)
            InkWell(
              key: Key('stachelReact-$e'),
              borderRadius: BorderRadius.circular(24),
              onTap: () => Navigator.of(ctx).pop(e),
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Text(e, style: const TextStyle(fontSize: 28)),
              ),
            ),
        ],
      ),
    ),
  ),
);
