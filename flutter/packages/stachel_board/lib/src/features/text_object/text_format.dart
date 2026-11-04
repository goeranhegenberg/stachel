import 'dart:math' as math;

import '../../mindmap/mind_measure.dart';
import '../../model/board_object.dart';
import '../../web/web_constants.dart';

// Object-wide text format like the web (`editor/core/contextActions.tsx` font size/format, `richtext/fonts.ts`,
// `editor/interaction/textWidth.ts`): the 16 font sizes and the A−/A+ step, the four fonts, the width of a text with
// `autoWidth` after a format change – measured with the Chromium font metrics (contract §8.13) like the server.

/// Font sizes of the context bar (web `FONT_SIZES`, 10 … 160).
List<double> get fontSizes {
  final l = WebConstants.instance.numbers('fontSizes.text');
  return l.isEmpty ? const [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80, 96, 128, 160] : l;
}

/// Next size from [size] one step smaller ([dir] −1) or larger (+1) – the web's A−/A+ (`step` in `core.font`).
double stepFontSize(double size, int dir) {
  final sizes = fontSizes;
  final s = (size + 0.5).floorToDouble();
  final idx = sizes.indexWhere((v) => v >= s);
  final base = idx < 0 ? sizes.length - 1 : (sizes[idx] > s && dir > 0 ? idx - 1 : idx);
  return sizes[(base + dir).clamp(0, sizes.length - 1)];
}

/// A font of the web (`FONTS`): key (`barlow` = field removed), German label, CSS family.
class BoardFont {
  const BoardFont(this.key, this.label, this.css);
  final String key;
  final String label;
  final String css;
}

List<BoardFont> get boardFonts => [
  for (final f in WebConstants.instance.maps('fonts'))
    BoardFont(f['key'] as String, f['label'] as String, (f['family'] as String).replaceAll('"', '')),
];

BoardFont fontOf(String? key) => boardFonts.where((f) => f.key == key).firstOrNull ?? boardFonts.first;

/// Placeholder of an empty text (web `TEXT_PLACEHOLDER`).
const textPlaceholder = 'Text eingeben';
const _maxAutoWidth = 2400.0;

/// Weight of text objects like the web's display: large text bolder, bold always 700+.
int textWeight(double fontSize, bool bold) {
  final base = fontSize >= 40 ? 700 : (fontSize >= 28 ? 600 : 500);
  return bold ? math.max(700, base + 200) : base;
}

/// Width of a text with `autoWidth` (web `autoTextWidth`): its longest line plus a little air.
double autoTextWidth(BoardObject o) {
  final fs = o.fontSize ?? 24;
  final text = o.text.isEmpty ? textPlaceholder : o.text;
  final family = fontOf(o.fontFamily).css;
  var widest = 0.0;
  for (final line in text.split('\n')) {
    widest = math.max(widest, TextMetrics.instance.measure(line, fs, textWeight(fs, o.bold), family, italic: o.italic));
  }
  return math.min(_maxAutoWidth, math.max((fs * 1.2 + 0.5).floorToDouble(), (widest + fs * 0.25 + 4).ceilToDouble()));
}

/// Web line height of board text.
const _lineHeight = 1.22;

/// [p] for [o] plus what follows from it (web `adjustTextPatch` + measuring): a text with `autoWidth` gets the width
/// of its content after a change of size, bold, italic or font; after a size change also the height of its lines.
Map<String, Object?> adjustTextPatch(BoardObject o, Map<String, Object?> p) {
  if (o.type != 'text' || p.containsKey('w')) return p;
  if (!const ['fontSize', 'bold', 'italic', 'fontFamily'].any(p.containsKey)) return p;
  final merged = BoardObject({...o.raw, ...p}..removeWhere((k, v) => v == null));
  final out = {...p};
  if (o.autoWidth) out['w'] = autoTextWidth(merged);
  if (p.containsKey('fontSize') && o.autoWidth) {
    final fs = merged.fontSize ?? 24;
    final lines = math.max(1, (o.text.isEmpty ? textPlaceholder : o.text).split('\n').length);
    out['h'] = math.max((lines * fs * _lineHeight).ceilToDouble(), (fs * 1.25 + 0.5).floorToDouble());
  }
  return out;
}
