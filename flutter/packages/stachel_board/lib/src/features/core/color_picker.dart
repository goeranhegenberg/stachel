// Own color picker (web `ui/ColorPicker.tsx`, Welle B): spectrum (saturation × brightness) with a hue slider, hex field,
// a preview in the text color the color would get (WCAG, `readableInk`) and „zuletzt benutzt“ (per device, BoardPrefs
// key `stachel:recentColors` like the web's localStorage, newest first, at most eight).
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../editor/registry/board_ui.dart';
import '../../render/paint_utils.dart';
import '../a11y/color_names.dart';
import '../view/board_prefs.dart';

final _hex6 = RegExp(r'^#[0-9a-f]{6}$');

/// `#abc`, `abc`, `#aabbcc`, `aabbcc` → `#aabbcc` (lower case); otherwise null (web `parseHex`).
String? parseHexColor(String input) {
  final s = input.trim().replaceFirst('#', '').toLowerCase();
  if (RegExp(r'^[0-9a-f]{3}$').hasMatch(s)) return '#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}';
  if (RegExp(r'^[0-9a-f]{6}$').hasMatch(s)) return '#$s';
  return null;
}

/// `#rrggbb` of an opaque [c].
String hexOfColor(Color c) {
  String two(double v) => (v * 255).round().clamp(0, 255).toRadixString(16).padLeft(2, '0');
  return '#${two(c.r)}${two(c.g)}${two(c.b)}';
}

Color _colorOf(String hex) => Color(int.parse('FF${hex.substring(1)}', radix: 16));

/// The recently used own colors (web `ui/recentColors.ts`).
abstract final class RecentColors {
  static const key = 'stachel:recentColors';
  static const max = 8;

  static List<String> get list {
    try {
      final v = jsonDecode(BoardPrefs.get(key) ?? '[]');
      if (v is! List) return const [];
      return [
        for (final x in v)
          if (x is String && _hex6.hasMatch(x.toLowerCase())) x.toLowerCase(),
      ].take(max).toList();
    } catch (_) {
      return const [];
    }
  }

  /// Puts [hex] in front (duplicates go).
  static void add(String hex) {
    final c = hex.toLowerCase();
    if (!_hex6.hasMatch(c)) return;
    BoardPrefs.set(key, jsonEncode([c, ...list.where((x) => x != c)].take(max).toList()));
  }
}

/// Opens the own color picker as a sheet; returns `#rrggbb` (null = cancelled) and remembers it in [RecentColors].
Future<String?> pickOwnColor(BuildContext context, BoardUi ui, {required String initial, String title = 'Eigene Farbe'}) =>
    ui.openSheet<String>(
      context,
      (ctx) => ColorPickerSheet(ui: ui, initial: initial, title: title),
      closeOnSelectionChange: true,
      scrollControlled: true,
    );

/// The picker (spectrum, hue, hex, preview, ÜBERNEHMEN).
class ColorPickerSheet extends StatefulWidget {
  const ColorPickerSheet({super.key, required this.ui, required this.initial, required this.title});
  final BoardUi ui;
  final String initial;
  final String title;

  @override
  State<ColorPickerSheet> createState() => _ColorPickerSheetState();
}

class _ColorPickerSheetState extends State<ColorPickerSheet> {
  late HSVColor hsv = HSVColor.fromColor(_colorOf(parseHexColor(widget.initial) ?? '#fff27a'));
  late final TextEditingController hexCtl = TextEditingController(text: hex);
  final FocusNode hexFocus = FocusNode();

  String get hex => hexOfColor(hsv.toColor());

  void _set(HSVColor v) {
    setState(() => hsv = v);
    if (!hexFocus.hasFocus) hexCtl.text = hex;
  }

  @override
  void dispose() {
    hexCtl.dispose();
    hexFocus.dispose();
    super.dispose();
  }

  void _apply() {
    final c = hex;
    RecentColors.add(c);
    Navigator.of(context).pop(c);
  }

  @override
  Widget build(BuildContext context) {
    final ui = widget.ui;
    final color = hsv.toColor();
    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: Column(
          key: const Key('stachelCustomColorSheet'),
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text(widget.title.toUpperCase(), style: ui.theme.label(size: 14)),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: SizedBox(
                height: 150,
                child: Semantics(
                  label: 'Sättigung und Helligkeit',
                  value: 'Sättigung ${(hsv.saturation * 100).round()} %, Helligkeit ${(hsv.value * 100).round()} %',
                  child: LayoutBuilder(
                    builder: (context, box) {
                      void at(Offset p) => _set(
                        hsv
                            .withSaturation((p.dx / box.maxWidth).clamp(0.0, 1.0))
                            .withValue((1 - p.dy / box.maxHeight).clamp(0.0, 1.0)),
                      );
                      return GestureDetector(
                        key: const Key('stachelCustomSpectrum'),
                        behavior: HitTestBehavior.opaque,
                        onTapDown: (d) => at(d.localPosition),
                        onPanStart: (d) => at(d.localPosition),
                        onPanUpdate: (d) => at(d.localPosition),
                        child: CustomPaint(painter: _SpectrumPainter(hsv), size: Size(box.maxWidth, box.maxHeight)),
                      );
                    },
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Container(
                    height: 12,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(6),
                      gradient: LinearGradient(
                        colors: [for (var h = 0; h <= 360; h += 60) HSVColor.fromAHSV(1, h.toDouble(), 1, 1).toColor()],
                      ),
                    ),
                  ),
                  SliderTheme(
                    data: SliderTheme.of(context).copyWith(
                      activeTrackColor: Colors.transparent,
                      inactiveTrackColor: Colors.transparent,
                      thumbColor: ui.theme.ink,
                      overlayShape: SliderComponentShape.noOverlay,
                    ),
                    child: Slider(
                      key: const Key('stachelCustomHue'),
                      value: hsv.hue,
                      max: 360,
                      label: 'Farbton',
                      onChanged: (v) {
                        var n = hsv.withHue(v);
                        // grau/schwarz: am Farbton ziehen soll eine Farbe zeigen (wie im Web)
                        if (n.saturation == 0) n = n.withSaturation(0.6);
                        if (n.value == 0) n = n.withValue(0.9);
                        _set(n);
                      },
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
              child: Row(
                children: [
                  Container(
                    key: const Key('stachelCustomColorPreview'),
                    width: 44,
                    height: 44,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: color,
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(color: ui.theme.ink.withValues(alpha: 0.5)),
                    ),
                    child: Text('Aa', style: TextStyle(color: readableInk(color), fontWeight: FontWeight.w600, fontSize: 16)),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      key: const Key('stachelCustomHex'),
                      controller: hexCtl,
                      focusNode: hexFocus,
                      maxLength: 7,
                      autocorrect: false,
                      inputFormatters: [FilteringTextInputFormatter.allow(RegExp('[#0-9a-fA-F]'))],
                      decoration: const InputDecoration(labelText: 'Hex', counterText: '', isDense: true),
                      onChanged: (v) {
                        final p = parseHexColor(v);
                        if (p != null) setState(() => hsv = HSVColor.fromColor(_colorOf(p)));
                      },
                      onSubmitted: (_) => _apply(),
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('ABBRECHEN')),
                  const SizedBox(width: 8),
                  FilledButton(key: const Key('stachelCustomColorOk'), onPressed: _apply, child: const Text('ÜBERNEHMEN')),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SpectrumPainter extends CustomPainter {
  _SpectrumPainter(this.hsv);
  final HSVColor hsv;

  @override
  void paint(Canvas canvas, Size size) {
    final r = Offset.zero & size;
    final rr = RRect.fromRectAndRadius(r, const Radius.circular(6));
    canvas.save();
    canvas.clipRRect(rr);
    canvas.drawRect(r, Paint()..color = HSVColor.fromAHSV(1, hsv.hue, 1, 1).toColor());
    canvas.drawRect(
      r,
      Paint()..shader = const LinearGradient(colors: [Color(0xFFFFFFFF), Color(0x00FFFFFF)]).createShader(r),
    );
    canvas.drawRect(
      r,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.bottomCenter,
          end: Alignment.topCenter,
          colors: [Color(0xFF000000), Color(0x00000000)],
        ).createShader(r),
    );
    canvas.restore();
    final p = Offset(hsv.saturation * size.width, (1 - hsv.value) * size.height);
    canvas.drawCircle(p, 9, Paint()..color = hsv.toColor());
    canvas.drawCircle(
      p,
      9,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.5
        ..color = const Color(0xFFFFFFFF),
    );
    canvas.drawCircle(
      p,
      10.5,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1
        ..color = const Color(0x80000000),
    );
  }

  @override
  bool shouldRepaint(covariant _SpectrumPainter old) => old.hsv != hsv;
}

/// „Zuletzt benutzt“ + „+ Eigene Farbe“ under a palette (web `cp-line`): [onPick] gets a recent color, [onCustom]
/// opens the picker.
class RecentColorsRow extends StatelessWidget {
  const RecentColorsRow({super.key, required this.onPick, required this.onCustom, this.current, this.size = 32});
  final ValueChanged<String> onPick;
  final VoidCallback onCustom;
  final String? current;
  final double size;

  @override
  Widget build(BuildContext context) {
    final ui = BoardUiScope.maybeOf(context);
    final ink = ui?.theme.ink ?? const Color(0xFF161118);
    final accent = ui?.theme.accent ?? const Color(0xFFE5398B);
    return ValueListenableBuilder<int>(
      valueListenable: BoardPrefs.changes,
      builder: (context, _, _) {
        final recent = RecentColors.list;
        return Row(
          key: const Key('stachelRecentColors'),
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final c in recent)
              Semantics(
                button: true,
                label: 'Zuletzt benutzt: ${colorName(c)}',
                excludeSemantics: true,
                child: InkWell(
                  key: Key('stachelRecentColor-$c'),
                  customBorder: const CircleBorder(),
                  onTap: () => onPick(c),
                  child: Padding(
                    padding: const EdgeInsets.all(3),
                    child: Container(
                      width: size,
                      height: size,
                      decoration: BoxDecoration(
                        color: _colorOf(c),
                        shape: BoxShape.circle,
                        border: Border.all(color: c == current ? accent : ink.withValues(alpha: 0.45), width: c == current ? 3 : 1.5),
                      ),
                    ),
                  ),
                ),
              ),
            Tooltip(
              message: 'Eigene Farbe',
              child: Semantics(
                button: true,
                label: 'Eigene Farbe wählen',
                excludeSemantics: true,
                child: InkWell(
                  key: const Key('stachelCustomColorPlus'),
                  customBorder: const CircleBorder(),
                  onTap: onCustom,
                  child: Padding(
                    padding: const EdgeInsets.all(3),
                    child: Container(
                      width: size,
                      height: size,
                      alignment: Alignment.center,
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
                      child: Container(
                        width: size - 10,
                        height: size - 10,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(shape: BoxShape.circle, color: ui?.theme.surface ?? Colors.white),
                        child: Icon(Icons.add, size: size * 0.55, color: ink),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}
