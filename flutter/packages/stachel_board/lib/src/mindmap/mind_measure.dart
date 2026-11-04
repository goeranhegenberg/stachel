import 'dart:convert';

import 'text_metrics.g.dart';

/// Text width without a canvas, from the font metrics measured in Chromium (`text_metrics.g.dart`): character widths
/// + kerning per pair + ligatures per triple – the same numbers and the same order of additions as the Stachel
/// server (`server/src/native/text-metrics.ts`), so mind map nodes get the same size in app, server and browser.
class TextMetrics {
  TextMetrics._(this._size, this._index, this._fonts, this._aliases);

  static TextMetrics? _instance;

  /// The bundled metrics (parsed on first use).
  static TextMetrics get instance =>
      _instance ??= TextMetrics.fromJson(jsonDecode(textMetricsJson) as Map<String, Object?>);

  factory TextMetrics.fromJson(Map<String, Object?> j) {
    final chars = j['chars'] as String;
    final index = <String, int>{};
    var i = 0;
    for (final r in chars.runes) {
      index[String.fromCharCode(r)] = i++;
    }
    final fonts = <String, _FontTable>{};
    (j['fonts'] as Map<String, Object?>).forEach((k, v) {
      final t = v as Map<String, Object?>;
      fonts[k] = _FontTable(
        [for (final w in t['widths'] as List) (w as num).toDouble()],
        {for (final e in (t['pairs'] as Map<String, Object?>).entries) e.key: (e.value as num).toDouble()},
        {for (final e in (t['triples'] as Map<String, Object?>).entries) e.key: (e.value as num).toDouble()},
      );
    });
    final aliases = <String, String>{
      if (j['aliases'] is Map)
        for (final e in (j['aliases'] as Map).entries)
          if (e.value is String) '${e.key}': e.value as String,
    };
    return TextMetrics._((j['size'] as num).toDouble(), index, fonts, aliases);
  }

  final double _size;
  final Map<String, int> _index;
  final Map<String, _FontTable> _fonts;
  final Map<String, String> _aliases;

  /// Width of [text] in world units (like the web's `measureText(text, fs, weight, italic, family)`); [family] is a
  /// CSS font name (contract §8.13: `condensed` → Barlow Condensed, `serif` → Source Serif 4, `mono` → JetBrains
  /// Mono, else Barlow).
  double measure(String text, double fs, int weight, String family, {bool italic = false}) {
    final t = _table(family, weight, italic: italic);
    var sum = 0.0;
    var prev = '', prev2 = '';
    for (final r in text.runes) {
      final ch = String.fromCharCode(r);
      final i = _index[ch];
      sum += i != null ? t.widths[i] : _fallback(r) * _size;
      if (prev.isNotEmpty) sum += t.pairs[prev + ch] ?? 0;
      if (prev2.isNotEmpty) sum += t.triples[prev2 + prev + ch] ?? 0;
      prev2 = prev;
      prev = ch;
    }
    return sum / _size * fs;
  }

  /// Font family of the metrics for a CSS font name (first name of the list).
  static String familyOf(String css) {
    final first = css.split(',').first.replaceAll('"', '').replaceAll("'", '').trim().toLowerCase();
    if (first.contains('condensed')) return 'Barlow Condensed';
    if (first.contains('serif')) return 'Source Serif 4';
    if (first.contains('mono')) return 'JetBrains Mono';
    return 'Barlow';
  }

  _FontTable _table(String family, int weight, {bool italic = false}) {
    final base = familyOf(family);
    final fam = italic ? '$base Italic' : base;
    final w = ((weight / 100).round() * 100).clamp(400, 900);
    final key = '$fam|$w';
    final exact = _fonts[key] ?? _fonts[_aliases[key]];
    if (exact != null) return exact;
    _FontTable? best;
    var dist = double.infinity;
    _fonts.forEach((k, t) {
      final parts = k.split('|');
      final d = (int.parse(parts[1]) - weight).abs().toDouble();
      if (parts[0] == fam && d < dist) {
        best = t;
        dist = d;
      }
    });
    return best ?? _fonts['Barlow|500']!;
  }

  /// Width of a character without table entry (emoji, CJK, symbols) in em – like the server.
  static double _fallback(int cp) {
    if (cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf)) return 1.25;
    if (cp >= 0x2e80 && cp <= 0xffef) return 1;
    return 0.56;
  }
}

class _FontTable {
  const _FontTable(this.widths, this.pairs, this.triples);
  final List<double> widths;
  final Map<String, double> pairs;
  final Map<String, double> triples;
}
