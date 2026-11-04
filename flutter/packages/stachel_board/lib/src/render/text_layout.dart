import 'dart:math' as math;

import 'package:flutter/material.dart' show Icons;
import 'package:flutter/painting.dart';

import '../model/board_object.dart';
import '../model/rich_text.dart';
import 'paint_utils.dart';

/// Fonts of the board (the app bundles Barlow and Barlow Condensed).
class BoardFonts {
  const BoardFonts({
    this.regular = 'Barlow',
    this.condensed = 'BarlowCondensed',
    this.serif = serifFamily,
    this.mono = monoFamily,
    this.emoji,
    this.icons = 'MaterialIcons',
  });

  /// Source Serif 4 and JetBrains Mono like the web's `fontFamily: serif/mono` (bundled in this package, P2).
  static const serifFamily = 'packages/stachel_board/SourceSerif4';
  static const monoFamily = 'packages/stachel_board/JetBrainsMono';

  final String regular;
  final String condensed;
  final String serif;
  final String mono;

  /// Font for emoji stickers (null = system fallback).
  final String? emoji;

  /// Icon font for check boxes and stamps (the app bundles Material Icons).
  final String icons;

  /// Family for an object's `fontFamily` (`default`, `condensed`, `serif`, `mono`).
  String family(String? fontFamily) => switch (fontFamily) {
    'condensed' => condensed,
    'serif' => serif,
    'mono' => mono,
    _ => regular,
  };
}

/// Web line height of board text (`LINE_HEIGHT` in textfit.ts).
const boardLineHeight = 1.22;

/// Builds the span of an object's text: rich text if present, else plain text, in base [fontSize].
/// Object-wide format (`bold`, `italic`, `strike`, color) is the base; marks apply on top (contract §4).
TextSpan objectTextSpan(
  BoardObject o, {
  required double fontSize,
  required Color color,
  required BoardFonts fonts,
  int weight = 500,
}) {
  final base = TextStyle(
    fontFamily: fonts.family(o.fontFamily),
    fontSize: fontSize,
    height: boardLineHeight,
    color: color,
    fontWeight: _weight(o.bold ? 700 : weight),
    fontStyle: o.italic ? FontStyle.italic : FontStyle.normal,
    decoration: o.strike ? TextDecoration.lineThrough : TextDecoration.none,
    decorationColor: color,
  );
  final rich = o.richText;
  if (rich == null) return TextSpan(text: o.text, style: base);
  return richTextSpan(rich, base: base, fonts: fonts);
}

FontWeight _weight(int w) => FontWeight.values[(w ~/ 100 - 1).clamp(0, 8)];

/// Rich text → one [TextSpan] (blocks separated by `\n`): headings larger and bold, list bullets/numbers/check
/// boxes as prefix with indentation, quotes in grey italics, code in mono on a light background.
TextSpan richTextSpan(RichDoc doc, {required TextStyle base, required BoardFonts fonts}) {
  final children = <InlineSpan>[];
  final fs = base.fontSize ?? 16;
  for (var i = 0; i < doc.blocks.length; i++) {
    final b = doc.blocks[i];
    if (i > 0) children.add(TextSpan(text: '\n', style: base));
    var style = base;
    switch (b.kind) {
      case RichBlockKind.heading:
        style = base.copyWith(fontSize: fs * const [1.6, 1.35, 1.15][b.level - 1], fontWeight: FontWeight.w700);
      case RichBlockKind.quote:
        style = base.copyWith(color: BoardColors.muted, fontStyle: FontStyle.italic);
      case RichBlockKind.rule:
        style = base.copyWith(color: const Color(0x55000000));
      case RichBlockKind.code:
        style = base.copyWith(fontFamily: fonts.mono, fontSize: fs * 0.9, backgroundColor: const Color(0x14000000));
      default:
        break;
    }
    final indent = ' ' * b.depth;
    final prefix = switch (b.kind) {
      _ when b.continuation => '$indent ',
      RichBlockKind.bullet => '$indent• ',
      RichBlockKind.ordered => '$indent${b.index}. ',
      RichBlockKind.task => indent,
      RichBlockKind.quote => '$indent▎ ',
      RichBlockKind.rule => '$indent——————',
      _ => indent,
    };
    if (prefix.isNotEmpty) children.add(TextSpan(text: prefix, style: style));
    if (b.kind == RichBlockKind.task && !b.continuation) {
      // Material Icons (bundled with the app) instead of ☑/☐, which Barlow lacks
      children.add(
        TextSpan(
          text: String.fromCharCode((b.checked ? Icons.check_box : Icons.check_box_outline_blank).codePoint),
          style: style.copyWith(fontFamily: fonts.icons, fontWeight: FontWeight.w400, decoration: TextDecoration.none),
        ),
      );
      children.add(TextSpan(text: ' ', style: style));
    }
    for (final r in b.runs) {
      children.add(TextSpan(text: r.text, style: markedStyle(style, r.marks, fonts)));
    }
    if (b.kind == RichBlockKind.task && b.checked) {
      // done tasks: like the web, struck through and muted
      final last = children.length;
      for (var k = last - b.runs.length; k < last; k++) {
        final s = children[k] as TextSpan;
        children[k] = TextSpan(
          text: s.text,
          style: s.style?.copyWith(decoration: TextDecoration.lineThrough, color: BoardColors.muted),
        );
      }
    }
  }
  return TextSpan(style: base, children: children);
}

/// [s] with the marks [m] of a run (bold, italic, strike, underline, code, link, highlight, color, size).
TextStyle markedStyle(TextStyle s, RichMarks m, BoardFonts fonts) {
  if (m == RichMarks.none) return s;
  final deco = <TextDecoration>[
    if (s.decoration != null && s.decoration != TextDecoration.none) s.decoration!,
    if (m.strike) TextDecoration.lineThrough,
    if (m.underline || m.link != null) TextDecoration.underline,
  ];
  final color = m.link != null ? BoardColors.blue : (m.color != null ? parseColor(m.color, s.color!) : s.color);
  return s.copyWith(
    fontWeight: m.bold ? FontWeight.w700 : null,
    fontStyle: m.italic ? FontStyle.italic : null,
    fontFamily: m.code ? fonts.mono : null,
    fontSize: m.fontScale != null ? (s.fontSize ?? 16) * m.fontScale! : m.fontSize,
    color: color,
    decoration: deco.isEmpty ? TextDecoration.none : TextDecoration.combine(deco),
    decorationColor: color,
    backgroundColor: m.highlight != null
        ? parseColor(m.highlight!.isEmpty ? '#fff27a' : m.highlight, const Color(0xFFFFF27A))
        : (m.code ? const Color(0x14000000) : null),
  );
}

/// Laid-out text of one object, cached by content and box (pan/zoom never re-lays out, the picture scales).
class TextLayoutCache {
  TextLayoutCache({this.maxEntries = 4000});
  final int maxEntries;
  final _cache = <Object, TextPainter>{};

  int get length => _cache.length;

  /// [fill]: centered/right text takes the whole [maxWidth] (paint at the box's left edge); otherwise the painter is
  /// as wide as its longest line (labels in pills). With [ellipsis] one line, cut with it (CSS `text-overflow`).
  TextPainter layout(
    Object key,
    TextSpan Function() span, {
    required double maxWidth,
    required TextAlign align,
    bool fill = true,
    String? ellipsis,
  }) {
    final hit = _cache.remove(key);
    if (hit != null) {
      _cache[key] = hit; // LRU: most recent last
      return hit;
    }
    // Centered/right text fills the box width, so painting at the box's left edge aligns it like the web.
    final w = math.max(1.0, maxWidth);
    final tp = TextPainter(
      text: span(),
      textAlign: align,
      textDirection: TextDirection.ltr,
      textWidthBasis: fill ? TextWidthBasis.parent : TextWidthBasis.longestLine,
      maxLines: ellipsis == null ? null : 1,
      ellipsis: ellipsis,
    )..layout(minWidth: !fill || align == TextAlign.left || !w.isFinite ? 0 : w, maxWidth: w);
    _cache[key] = tp;
    if (_cache.length > maxEntries) {
      final old = _cache.keys.first;
      _cache.remove(old)?.dispose();
    }
    return tp;
  }

  void clear() {
    for (final tp in _cache.values) {
      tp.dispose();
    }
    _cache.clear();
  }
}
