import 'dart:ui';

/// Stachel colors used by the renderer.
abstract final class BoardColors {
  static const ink = Color(0xFF0A0A0A);
  static const blue = Color(0xFF1763B5);
  static const pink = Color(0xFFEC4E92);
  static const green = Color(0xFFC9E14A);
  static const background = Color(0xFFF3F3EF);
  static const grid = Color(0xFFD9D9D2);
  static const frameBorder = Color(0xFFCFCFC8);
  static const muted = Color(0xFF6B6B6B);
  static const placeholder = Color(0xFFE6E6E1);
  static const selection = Color(0xFF1763B5);
}

final _colorCache = <String, Color?>{};

/// `#rrggbb`, `#rgb`, `#rrggbbaa` → [Color]; anything else → [fallback]. Cached (boards reuse few colors).
Color parseColor(String? s, Color fallback) {
  if (s == null) return fallback;
  final c = _colorCache.putIfAbsent(s, () => _parse(s));
  return c ?? fallback;
}

Color? _parse(String s) {
  var h = s.trim();
  if (!h.startsWith('#')) return null;
  h = h.substring(1);
  if (h.length == 3) h = h.split('').map((c) => '$c$c').join();
  if (h.length == 6) h = '${h}ff';
  if (h.length != 8) return null;
  final v = int.tryParse(h, radix: 16);
  if (v == null) return null;
  // rrggbbaa → aarrggbb
  return Color(((v & 0xff) << 24) | (v >> 8));
}

/// Readable text color on [fill]: ink on light fills, white on dark ones (like the web's `textOn`).
Color textOn(Color fill) => fill.computeLuminance() > 0.36 ? BoardColors.ink : const Color(0xFFFFFFFF);

/// WCAG 2.x contrast ratio of two colors (1 … 21).
double contrastRatio(Color a, Color b) {
  final la = a.computeLuminance(), lb = b.computeLuminance();
  final hi = la > lb ? la : lb, lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

/// Text on a sticky note (and any freely chosen note color) like the web's `readableInk` (`board/colors.ts`): black
/// ([BoardColors.ink]) or white, whichever has the higher WCAG contrast; a tie stays black. All light note colors (the
/// old twelve) keep black text, the dark ones get white.
Color readableInk(Color fill) {
  final opaque = fill.withValues(alpha: 1);
  return contrastRatio(opaque, const Color(0xFFFFFFFF)) > contrastRatio(opaque, BoardColors.ink)
      ? const Color(0xFFFFFFFF)
      : BoardColors.ink;
}

/// Dashes [source] with alternating on/off [pattern] lengths. An on-length of 0 (dotted) draws a dot when the
/// paint has a round cap.
Path dashPath(Path source, List<double> pattern) {
  final out = Path();
  if (pattern.isEmpty || pattern.every((v) => v <= 0)) return source;
  for (final metric in source.computeMetrics()) {
    var d = 0.0;
    var i = 0;
    var on = true;
    while (d < metric.length) {
      final len = pattern[i % pattern.length];
      if (on) {
        final end = (d + (len <= 0 ? 0.01 : len)).clamp(0.0, metric.length);
        out.addPath(metric.extractPath(d, end), Offset.zero);
      }
      d += len <= 0 ? 0.01 : len;
      on = !on;
      i++;
    }
  }
  return out;
}
