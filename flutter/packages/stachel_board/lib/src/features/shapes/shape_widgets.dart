import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../editor/registry/board_ui.dart';
import '../../geometry/shape_paths.dart';
import '../../geometry/svg_path.dart';
import '../../web/web_constants.dart';
import '../core/core_widgets.dart' show hexColor;
import 'catalog.dart';

// Small widgets of P2 (web `ShapeIcon`, `StickyShapeIcon`, swatches, `CustomColor`): used by the tool options, the
// context bar sheets and the library.

/// A shape kind as an icon in the aspect ratio of its library entry (web `ShapeIcon`: 24 grid, box 19, fill 12 %).
class ShapeKindIcon extends StatelessWidget {
  const ShapeKindIcon(this.kind, {super.key, this.size = 24, this.w, this.h, this.color});
  final String kind;
  final double size;
  final double? w;
  final double? h;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final e = entryOfKind(kind);
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _ShapeKindPainter(
          kind,
          w ?? e?.w ?? 180,
          h ?? e?.h ?? 120,
          color ?? IconTheme.of(context).color ?? const Color(0xFF161118),
        ),
      ),
    );
  }
}

class _ShapeKindPainter extends CustomPainter {
  _ShapeKindPainter(this.kind, this.aw, this.ah, this.color);
  final String kind;
  final double aw;
  final double ah;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.shortestSide / 24;
    final k = 19 / math.max(aw, ah);
    final iw = aw * k, ih = ah * k;
    canvas
      ..save()
      ..scale(s)
      ..translate((24 - iw) / 2, (24 - ih) / 2);
    final path = parseSvgPath(shapePathData(kind, iw, ih, 0.9));
    if (!isOpenShapeKind(kind)) canvas.drawPath(path, Paint()..color = color.withValues(alpha: 0.12));
    canvas
      ..drawPath(
        path,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.7
          ..strokeJoin = StrokeJoin.round
          ..strokeCap = StrokeCap.round
          ..color = color,
      )
      ..restore();
  }

  @override
  bool shouldRepaint(covariant _ShapeKindPainter old) =>
      old.kind != kind || old.aw != aw || old.ah != ah || old.color != color;
}

/// A note in its shape: `square`, `rect` or `free` (dashed) – web `StickyShapeIcon`.
class StickyShapeIcon extends StatelessWidget {
  const StickyShapeIcon(this.shape, {super.key, this.size = 24, this.color});
  final String shape;
  final double size;
  final Color? color;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: size,
    height: size,
    child: CustomPaint(
      painter: _StickyShapePainter(shape, color ?? IconTheme.of(context).color ?? const Color(0xFF161118)),
    ),
  );
}

class _StickyShapePainter extends CustomPainter {
  _StickyShapePainter(this.shape, this.color);
  final String shape;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.shortestSide / 24;
    final w = shape == 'rect' ? 18.0 : (shape == 'free' ? 15.0 : 13.0);
    final h = shape == 'free' ? 9.0 : 13.0;
    final x = (24 - w) / 2, y = (24 - h) / 2;
    final path = parseSvgPath('M$x ${y}h${w}v${h - 4}l-4 4h-${w - 4}z');
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.6
      ..strokeJoin = StrokeJoin.round
      ..color = color;
    canvas
      ..save()
      ..scale(s);
    if (shape == 'free') {
      for (final m in path.computeMetrics()) {
        for (var d = 0.0; d < m.length; d += 4.5) {
          canvas.drawPath(m.extractPath(d, math.min(m.length, d + 2.5)), paint);
        }
      }
    } else {
      canvas.drawPath(path, paint);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _StickyShapePainter old) => old.shape != shape || old.color != color;
}

/// German name of a color (palette names of the web, else the hex value) – labels and screen readers.
String colorNameOf(String hex) {
  final h = hex.toLowerCase();
  for (final c in WebConstants.instance.maps('colors.shape')) {
    if ((c['hex'] as String).toLowerCase() == h) return c['name'] as String;
  }
  return const {
        '#0a0a0a': 'Schwarz',
        '#1763b5': 'Blau',
        '#ec4e92': 'Pink',
        '#7aa21b': 'Dunkelgrün',
        '#e8590c': 'Dunkelorange',
        '#7048e8': 'Violett',
        '#8a8a85': 'Grau',
        '#ffffff': 'Weiß',
        '#fff27a': 'Gelb',
        '#c9e14a': 'Grün',
        '#ffb3d1': 'Rosa',
        '#9fd3ff': 'Hellblau',
        '#ffd08a': 'Orange',
        '#e2d5ff': 'Lila',
      }[h] ??
      hex;
}

/// A color button (web `swatch`): square or round, ring when active.
class P2Swatch extends StatelessWidget {
  const P2Swatch({
    super.key,
    required this.color,
    required this.label,
    required this.onTap,
    this.active = false,
    this.round = false,
    this.size = 32,
  });
  final String color;
  final String label;
  final VoidCallback onTap;
  final bool active;
  final bool round;
  final double size;

  @override
  Widget build(BuildContext context) {
    final ui = BoardUiScope.maybeOf(context);
    final ink = ui?.theme.ink ?? const Color(0xFF161118);
    final accent = ui?.theme.accent ?? const Color(0xFFE5398B);
    return Semantics(
      button: true,
      selected: active,
      label: label,
      child: InkWell(
        onTap: onTap,
        customBorder: round ? const CircleBorder() : null,
        child: Padding(
          padding: const EdgeInsets.all(3),
          child: Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
              color: hexColor(color),
              shape: round ? BoxShape.circle : BoxShape.rectangle,
              borderRadius: round ? null : BorderRadius.circular(4),
              border: Border.all(color: active ? accent : ink.withValues(alpha: 0.45), width: active ? 3 : 1.5),
            ),
          ),
        ),
      ),
    );
  }
}

/// Option strip above the tool bar (look of the core pen options).
class P2OptionStrip extends StatelessWidget {
  const P2OptionStrip({super.key, required this.ui, required this.children});
  final BoardUi ui;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(
      border: Border(bottom: BorderSide(color: ui.theme.ink.withValues(alpha: 0.15))),
    ),
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    child: SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(children: children),
    ),
  );
}

/// A square tool option button with an icon widget (web `fly-btn`).
class P2FlyButton extends StatelessWidget {
  const P2FlyButton({super.key, required this.label, required this.onTap, required this.child, this.active = false});
  final String label;
  final VoidCallback onTap;
  final Widget child;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final ui = BoardUiScope.maybeOf(context);
    final accent = ui?.theme.accent ?? const Color(0xFFE5398B);
    return Tooltip(
      message: label,
      child: Semantics(
        button: true,
        selected: active,
        label: label,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(6),
          child: Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: active ? accent.withValues(alpha: 0.18) : null,
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: active ? accent : Colors.transparent, width: 2),
            ),
            child: child,
          ),
        ),
      ),
    );
  }
}

/// A heading of a sheet (`FÜLLFARBE` …).
Widget p2SheetTitle(BoardUi ui, String text) => Padding(
  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
  child: Text(text, style: ui.theme.label(size: 14)),
);

/// The web's „Eigene Farbe“ (system color picker) on the phone: hue, saturation and brightness sliders with a
/// preview; returns `#rrggbb` (null = cancelled).
Future<String?> pickCustomColor(BuildContext context, BoardUi ui, {required String initial, required String title}) =>
    ui.openSheet<String>(
      context,
      (ctx) => _CustomColorSheet(ui: ui, initial: initial, title: title),
      closeOnSelectionChange: true,
      scrollControlled: true,
    );

class _CustomColorSheet extends StatefulWidget {
  const _CustomColorSheet({required this.ui, required this.initial, required this.title});
  final BoardUi ui;
  final String initial;
  final String title;

  @override
  State<_CustomColorSheet> createState() => _CustomColorSheetState();
}

class _CustomColorSheetState extends State<_CustomColorSheet> {
  late HSVColor hsv = HSVColor.fromColor(
    RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(widget.initial) ? hexColor(widget.initial) : const Color(0xFFFFFFFF),
  );

  String get hex {
    final c = hsv.toColor();
    String two(double v) => (v * 255).round().clamp(0, 255).toRadixString(16).padLeft(2, '0');
    return '#${two(c.r)}${two(c.g)}${two(c.b)}';
  }

  @override
  Widget build(BuildContext context) {
    final ui = widget.ui;
    Widget slider(String label, String key, double value, double max, ValueChanged<double> on, List<Color> track) =>
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
          child: Row(
            children: [
              SizedBox(width: 90, child: Text(label)),
              Expanded(
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    Container(
                      height: 10,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(5),
                        gradient: LinearGradient(colors: track),
                      ),
                    ),
                    SliderTheme(
                      data: SliderTheme.of(context).copyWith(
                        activeTrackColor: Colors.transparent,
                        inactiveTrackColor: Colors.transparent,
                        thumbColor: ui.theme.ink,
                      ),
                      child: Slider(key: Key(key), value: value, max: max, onChanged: (v) => setState(() => on(v))),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );

    return SafeArea(
      child: Column(
        key: const Key('stachelCustomColorSheet'),
        mainAxisSize: MainAxisSize.min,
        children: [
          p2SheetTitle(ui, widget.title.toUpperCase()),
          Container(
            key: const Key('stachelCustomColorPreview'),
            height: 44,
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            decoration: BoxDecoration(
              color: hsv.toColor(),
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: ui.theme.ink, width: 2),
            ),
            alignment: Alignment.center,
            child: Text(
              hex,
              style: TextStyle(color: hsv.value > 0.6 && hsv.saturation < 0.6 ? ui.theme.ink : Colors.white),
            ),
          ),
          slider('Farbton', 'stachelCustomHue', hsv.hue, 360, (v) => hsv = hsv.withHue(v), [
            for (var h = 0; h <= 360; h += 60) HSVColor.fromAHSV(1, h.toDouble(), 1, 1).toColor(),
          ]),
          slider('Sättigung', 'stachelCustomSat', hsv.saturation, 1, (v) => hsv = hsv.withSaturation(v), [
            hsv.withSaturation(0).toColor(),
            hsv.withSaturation(1).toColor(),
          ]),
          slider('Helligkeit', 'stachelCustomVal', hsv.value, 1, (v) => hsv = hsv.withValue(v), [
            hsv.withValue(0).toColor(),
            hsv.withValue(1).toColor(),
          ]),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('ABBRECHEN')),
                const SizedBox(width: 8),
                FilledButton(
                  key: const Key('stachelCustomColorOk'),
                  onPressed: () => Navigator.of(context).pop(hex),
                  child: const Text('ÜBERNEHMEN'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Rainbow button that opens [pickCustomColor] (web `CustomColor`).
class CustomColorButton extends StatelessWidget {
  const CustomColorButton({super.key, required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Tooltip(
    message: label,
    child: Semantics(
      button: true,
      label: label,
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: Padding(
          padding: const EdgeInsets.all(3),
          child: Container(
            width: 32,
            height: 32,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              gradient: SweepGradient(
                colors: [
                  Color(0xFFFF0000),
                  Color(0xFFFFFF00),
                  Color(0xFF00FF00),
                  Color(0xFF00FFFF),
                  Color(0xFF0000FF),
                  Color(0xFFFF00FF),
                  Color(0xFFFF0000),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
