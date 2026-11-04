import 'dart:math' as math;

import 'package:flutter/painting.dart';

import '../mindmap/mind_measure.dart';
import '../model/board_object.dart';
import '../model/rich_edit.dart';

// Port of the web's automatic font size (F19): `web/src/board/textfit.ts` (word wrap like the browser, largest size
// that fits) and `stickyFontSize`/`shapeFontSize` from `web/src/editor/textMeasure.ts`. Widths come from the Chromium
// font metrics ([TextMetrics], same file as the server) instead of a canvas, so the app picks the same size as the
// browser (reference values: `stachel/tools/native-textfit-fixtures.mts` → `docs/native_fixtures/web/textfit.json`).

/// Width of [text] at [fontSize] (web `MeasureFn`).
typedef TextWidthFn = double Function(String text, double fontSize);

/// Line height of the fit (web `LINE_HEIGHT`).
const textFitLineHeight = 1.22;

final _spaces = RegExp(r'\s+');
final _afterHyphen = RegExp(r'(?<=-)(?=.)');

/// Lines of [text] wrapped into [maxWidth] like the browser (web `wrapLines`): by words, also after hyphens, overlong
/// words broken hard.
List<String> wrapTextLines(String text, double fontSize, double maxWidth, TextWidthFn measure) =>
    _wrap(text, fontSize, maxWidth, measure).$1;

(List<String>, bool) _wrap(String text, double fontSize, double maxWidth, TextWidthFn measure) {
  final lines = <String>[];
  var broke = false;
  for (final para in text.split('\n')) {
    final tokens = <(String, bool)>[];
    for (final word in para.split(_spaces).where((w) => w.isNotEmpty)) {
      final segs = word.split(_afterHyphen);
      for (var i = 0; i < segs.length; i++) {
        tokens.add((segs[i], i == 0));
      }
    }
    if (tokens.isEmpty) {
      lines.add('');
      continue;
    }
    var line = '';
    for (final (tok, space) in tokens) {
      var t = tok;
      final cand = line.isNotEmpty ? '$line${space ? ' ' : ''}$t' : t;
      if (measure(cand, fontSize) <= maxWidth) {
        line = cand;
        continue;
      }
      if (line.isNotEmpty) lines.add(line);
      // overlong word: break it hard
      while (measure(t, fontSize) > maxWidth && t.length > 1) {
        broke = true;
        var cut = t.length - 1;
        while (cut > 1 && measure(t.substring(0, cut), fontSize) > maxWidth) {
          cut--;
        }
        lines.add(t.substring(0, cut));
        t = t.substring(cut);
      }
      line = t;
    }
    lines.add(line);
  }
  return (lines, broke);
}

/// Largest font size in [min, max] at which [text] fits into [w]×[h] (web `fitFontSize`): first without breaking
/// words, only if that fails even at [min] with hard breaks; binary search, rounded down to 0.5.
double webFitFontSize(String text, double w, double h, TextWidthFn measure, {double min = 6, double? max}) {
  final hi0 = math.max(min, max ?? math.min(64, w / 5));
  if (text.trim().isEmpty) return _jsRound(hi0 * 0.75);
  var allowBreak = false;
  bool fits(double fs) {
    final (lines, broke) = _wrap(text, fs, w, measure);
    return (allowBreak || !broke) && lines.length * fs * textFitLineHeight <= h;
  }

  if (fits(hi0)) return hi0;
  if (!fits(min)) allowBreak = true;
  var lo = min, hi = hi0;
  for (var i = 0; i < 14; i++) {
    final mid = (lo + hi) / 2;
    if (fits(mid)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo * 2).floorToDouble() / 2;
}

/// JS `Math.round` (halves up).
double _jsRound(double v) => (v + 0.5).floorToDouble();

/// Text width in Barlow (the web measures auto sizes in Barlow whatever the font of the object).
TextWidthFn barlowWidth({required int weight, bool italic = false}) =>
    (text, fs) => TextMetrics.instance.measure(text, fs, weight, 'Barlow', italic: italic);

/// Inner padding of a sticky note (web `stickyPadding`: by the shorter side).
double stickyPadding(double w, double h) => _jsRound(math.min(w, h) * 0.09);

/// Largest automatic font of a sticky note (web `stickyMaxFont`).
double stickyMaxFont(double w, double h) => math.max(8, math.min(w, h) * 0.82 / 4.6);

final _fitCache = <(String, double, double, double, bool, bool), double>{};

double _cached((String, double, double, double, bool, bool) key, double Function() compute) {
  final hit = _fitCache[key];
  if (hit != null) return hit;
  if (_fitCache.length > 4000) _fitCache.clear();
  return _fitCache[key] = compute();
}

/// Automatic font size of a sticky note with plain text [text] (web `stickyFontSize`; bold = 700, else 500).
double stickyAutoFontSize(String text, double w, double h, {bool bold = false, bool italic = false}) =>
    _cached(('s$text', w, h, 0, bold, italic), () {
      final pad = stickyPadding(w, h);
      final innerW = math.max(10.0, w - pad * 2), innerH = math.max(10.0, h - pad * 2);
      return webFitFontSize(
        text,
        innerW * 0.96,
        innerH,
        barlowWidth(weight: bold ? 700 : 500, italic: italic),
        min: 5,
        max: stickyMaxFont(w, h),
      );
    });

/// Font size of a shape: at most [wanted], smaller if the text does not fit (web `shapeFontSize`; bold = 700, else
/// 600).
double shapeAutoFontSize(
  String text,
  double wanted,
  double innerW,
  double innerH, {
  bool bold = false,
  bool italic = false,
}) {
  if (text.trim().isEmpty) return wanted;
  final iw = _jsRound(innerW), ih = _jsRound(innerH);
  return _cached(('f$text', wanted, iw, ih, bold, italic), () {
    return webFitFontSize(
      text,
      innerW * 0.96,
      innerH,
      barlowWidth(weight: bold ? 700 : 600, italic: italic),
      min: 5,
      max: wanted,
    );
  });
}

// ---- rich text: measured in the layout (web `features/richtext/fit.ts`) ------------------------------------------

const _wideMarks = {'bold', 'italic', 'code'};

/// The text differs from plain Barlow so much that the canvas measurement no longer fits (web `needsDomFit`): another
/// font, or rich text with lists, headings, quotes …, bold/italic/code marks or part font sizes.
bool needsLayoutFit(BoardObject o) {
  final f = o.fontFamily;
  if (f != null && f != 'barlow') return true;
  final content = o.raw['content'];
  if (content is! Map) return false;
  final doc = effectivePmDoc(content, o.text);
  bool odd(Object? n) {
    if (n is! Map) return false;
    if (n['type'] == 'text') {
      final marks = n['marks'] is List ? n['marks'] as List : const [];
      return marks.any(
        (m) =>
            m is Map &&
            (_wideMarks.contains(m['type']) ||
                (m['type'] == 'textStyle' && m['attrs'] is Map && ((m['attrs'] as Map)['fontSize'] ?? '') != '')),
      );
    }
    if (n['type'] != 'paragraph' && n['type'] != 'hardBreak') return true;
    return n['content'] is List && (n['content'] as List).any(odd);
  }

  return doc['content'] is List && (doc['content'] as List).any(odd);
}

final _layoutCache = <Object, double>{};

/// Largest font size in [min, max] (0.5 steps) at which the laid-out [span] fits into [availW]×[availH] – the web's
/// `domFit` (text breaks anywhere, the height decides; nine halvings, then one 0.5 step up if that fits too).
/// [key] caches the result.
double layoutFitFontSize(
  Object key,
  TextSpan Function(double fontSize) span, {
  required double availW,
  required double availH,
  required double min,
  required double max,
}) {
  final hit = _layoutCache[key];
  if (hit != null) return hit;
  bool fits(double fs) {
    final tp = TextPainter(text: span(fs), textDirection: TextDirection.ltr)..layout(maxWidth: math.max(1, availW));
    final ok = tp.height <= availH + 1 && tp.width <= availW + 1;
    tp.dispose();
    return ok;
  }

  double step(double v) => (v * 2).floorToDouble() / 2;
  var result = max;
  if (!fits(max)) {
    var lo = min, hi = max;
    for (var i = 0; i < 9; i++) {
      final mid = (lo + hi) / 2;
      if (fits(mid)) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    result = step(lo);
    if (result + 0.5 <= max && fits(result + 0.5)) result += 0.5;
  }
  if (_layoutCache.length > 3000) _layoutCache.clear();
  return _layoutCache[key] = result;
}

/// Font size of a sticky note as the web shows it: its own size, else rich text measured in the layout
/// ([layoutFitFontSize] on the padded note), else [stickyAutoFontSize]. [span] lays out the note's text at a size.
double stickyFontSizeOf(BoardObject o, TextSpan Function(double fontSize) span) {
  final own = o.fontSize;
  if (own != null) return own;
  if (!needsLayoutFit(o)) return stickyAutoFontSize(o.text, o.w, o.h, bold: o.bold, italic: o.italic);
  final pad = stickyPadding(o.w, o.h);
  return layoutFitFontSize(
    ('s', o.raw['content'], o.text, o.w, o.h, o.fontFamily, o.bold, o.italic),
    span,
    availW: o.w - 2 * pad,
    availH: o.h - 2 * pad,
    min: 5,
    max: stickyMaxFont(o.w, o.h),
  );
}

/// Font size of a shape's text as the web shows it: rich text measured in the layout, else [shapeAutoFontSize].
double shapeFontSizeOf(BoardObject o, double innerW, double innerH, TextSpan Function(double fontSize) span) {
  final wanted = o.fontSize ?? 20;
  if (!needsLayoutFit(o)) return shapeAutoFontSize(o.text, wanted, innerW, innerH, bold: o.bold, italic: o.italic);
  return layoutFitFontSize(
    ('f', o.raw['content'], o.text, innerW, innerH, wanted, o.fontFamily, o.bold, o.italic, o.shape),
    span,
    availW: innerW,
    availH: innerH,
    min: 5,
    max: wanted,
  );
}
