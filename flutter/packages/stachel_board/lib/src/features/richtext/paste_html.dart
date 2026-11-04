// F16: HTML (Word, Google Docs, browser) pasted while writing, like the web's rich text editor:
//  1. `cleanPastedHtml` = port of `web/src/features/richtext/paste.ts` (Word lists → lists, Word highlight → highlight,
//     font sizes in em relative to the source's base size (text/shape only), h4–h6 → h3, only known elements and
//     attributes, safe links),
//  2. `parsePastedHtml` = what ProseMirror's DOMParser makes of it with the editor's schema (Tiptap `richExtensions`:
//     parse rules of nodes and marks, whitespace collapsing, wrapping into paragraphs/lists),
//  3. `pasteHtmlInto` = ProseMirror's paste (`Slice.maxOpen` + `replaceSelection`): the first pasted text block
//     continues the one at the caret, the last takes the text after the caret, the rest goes where it fits.
// Checked against the real web editor in Chromium (`stachel/tools/native-paste-fixtures.mts` →
// `docs/native_fixtures/web/paste.json`).
import 'dart:math' as math;

import 'package:html/dom.dart' as dom;
import 'package:html/parser.dart' as html_parser;

import '../../model/rich_edit.dart';

// ---- 1. cleaning (paste.ts) -------------------------------------------------------------------------------------

/// Elements dropped with their content.
const _drop = {
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base', 'title', //
  'head', 'img', 'picture', 'video', 'audio', 'source', 'track', 'canvas', 'svg', 'math', 'noscript', 'template',
  'form', 'button', 'select', 'textarea', 'input', 'xml',
};

/// Elements that stay (with the attributes of [_attrs]); all others are replaced by their content.
const _keep = {
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'code', 'pre', 'a', 'span', 'mark', 'h1', 'h2', //
  'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'hr', 'div', 'sub', 'sup',
};
const _attrs = {
  'a': ['href'],
  'ol': ['start'],
  'ul': ['data-type'],
  'li': ['data-type', 'data-checked'],
  'mark': ['data-color'],
};
const _globalAttrs = ['data-pm-slice', 'style'];
const _styleKeep = ['font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'color', 'font-size'];

/// Word highlight colors → the format bar's highlight colors.
const _wordHighlight = {
  'yellow': '#fff27a', 'darkyellow': '#ffd08a', 'green': '#c9e14a', 'brightgreen': '#c9e14a', //
  'darkgreen': '#c9e14a', 'cyan': '#9fd3ff', 'turquoise': '#9fd3ff', 'blue': '#9fd3ff', 'darkblue': '#9fd3ff',
  'darkcyan': '#9fd3ff', 'magenta': '#ffb3d1', 'pink': '#ffb3d1', 'red': '#ffb3d1', 'darkred': '#ffb3d1',
  'darkmagenta': '#e2d5ff', 'violet': '#e2d5ff', 'gray': '#e2d5ff', 'lightgray': '#e2d5ff', 'gray25': '#e2d5ff',
  'gray50': '#e2d5ff',
};
const _highlights = ['#fff27a', '#c9e14a', '#ffb3d1', '#9fd3ff', '#ffd08a', '#e2d5ff'];

/// Cleans pasted HTML like the web (`cleanPastedHtml`); [sizes]: part font sizes allowed (text, shape). Returns the
/// cleaned body.
dom.Element cleanPastedHtml(String html, {required bool sizes}) {
  final doc = html_parser.parse(html);
  final base = _baseSize(doc, html);
  final body = doc.body ?? dom.Element.tag('body');
  _wordLists(body);
  // comments (Word conditions, StartFragment) go
  for (final c in _descendants(body).whereType<dom.Comment>().toList()) {
    c.remove();
  }
  void walk(dom.Element el) {
    for (final child in el.children.toList()) {
      walk(child);
    }
    if (identical(el, body)) return;
    final tag = (el.localName ?? '').toLowerCase();
    if (_drop.contains(tag)) {
      el.remove();
      return;
    }
    final allowed = {...?_attrs[tag], ..._globalAttrs};
    for (final a in el.attributes.keys.map((k) => '$k').toList()) {
      if (!allowed.contains(a.toLowerCase())) el.attributes.remove(a);
    }
    if (tag == 'a') {
      final href = webSafeHref(el.attributes['href']);
      if (href != null) {
        el.attributes['href'] = href;
      } else {
        el.attributes.remove('href');
      }
    }
    final st = _parseStyle(el.attributes['style']);
    String? highlight;
    final wordHl = st['mso-highlight']?.toLowerCase().replaceAll(RegExp(r'\s'), '');
    if (wordHl != null && wordHl.isNotEmpty && wordHl != 'none') {
      highlight = _wordHighlight[wordHl] ?? _nearestHighlight(normColor(wordHl) ?? '');
    } else if (tag != 'mark' &&
        !const {'p', 'div', 'li', 'ul', 'ol', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}.contains(tag)) {
      final bg = st['background-color'] ?? st['background'];
      final c = bg == null ? null : normColor(bg.split(RegExp(r'\s+')).first);
      if (c != null) highlight = _nearestHighlight(c);
    }
    if (tag == 'mark') {
      final c = normColor(el.attributes['data-color'] ?? st['background-color'] ?? st['background']);
      el.attributes.remove('data-color');
      if (c != null) el.attributes['data-color'] = _nearestHighlight(c) ?? _highlights.first;
    }
    final parts = <String>[];
    for (final k in _styleKeep) {
      final v = st[k];
      if (v == null || v.isEmpty) continue;
      if (k == 'color') {
        final c = normColor(v);
        if (c != null && c != '#000000') parts.add('color: $c');
      } else if (k == 'font-size') {
        if (!sizes) continue;
        final px = _toPx(v, base);
        if (px == null) continue;
        final em = (math.min(6, math.max(0.25, px / base)) * 100 + 0.5).floorToDouble() / 100;
        if ((em - 1).abs() >= 0.05) parts.add('font-size: ${_jsNum(em)}em');
      } else if (RegExp(r'^[\w\s-]+$').hasMatch(v)) {
        parts.add('$k: $v');
      }
    }
    if (parts.isNotEmpty) {
      el.attributes['style'] = parts.join('; ');
    } else {
      el.attributes.remove('style');
    }
    if (highlight != null) {
      final mark = dom.Element.tag('mark')..attributes['data-color'] = highlight;
      _moveChildren(el, mark);
      el.append(mark);
    }
    if (!_keep.contains(tag)) {
      if (RegExp(
        r'^(table|tbody|thead|tfoot|section|article|header|footer|main|aside|nav|figure|figcaption|address|dl|dd|dt|center)$',
      ).hasMatch(tag)) {
        final div = dom.Element.tag('div');
        _moveChildren(el, div);
        el.replaceWith(div);
      } else if (RegExp(r'^(tr|td|th|caption)$').hasMatch(tag)) {
        final p = dom.Element.tag(tag == 'tr' ? 'div' : 'span');
        _moveChildren(el, p);
        if (tag != 'tr') p.append(dom.Text(' '));
        el.replaceWith(p);
      } else {
        _unwrap(el);
      }
    } else if (tag == 'span' && el.attributes.isEmpty) {
      _unwrap(el);
    } else if (RegExp(r'^h[4-6]$').hasMatch(tag)) {
      // headings come in three levels (contract)
      final h = dom.Element.tag('h3');
      _moveChildren(el, h);
      el.replaceWith(h);
    }
  }

  walk(body);
  return body;
}

Iterable<dom.Node> _descendants(dom.Node n) sync* {
  for (final c in n.nodes.toList()) {
    yield c;
    yield* _descendants(c);
  }
}

void _moveChildren(dom.Node from, dom.Node to) {
  for (final c in from.nodes.toList()) {
    c.remove();
    to.append(c);
  }
}

void _unwrap(dom.Element el) {
  final parent = el.parentNode;
  if (parent == null) return;
  for (final c in el.nodes.toList()) {
    c.remove();
    parent.insertBefore(c, el);
  }
  el.remove();
}

dom.Node? _previousSibling(dom.Node n) {
  final p = n.parentNode;
  if (p == null) return null;
  final i = p.nodes.indexOf(n);
  return i > 0 ? p.nodes[i - 1] : null;
}

String _nodeText(dom.Node n) => n is dom.Comment ? (n.data ?? '') : (n.text ?? '');

/// A link target like the web's `safeHref`: an absolute `http:`/`https:`/`mailto:`/`tel:` URL (as `URL.href`), else
/// null (no scheme = no link here, unlike the link field).
String? webSafeHref(String? raw) {
  if (raw == null) return null;
  final s = raw.trim();
  if (s.isEmpty || RegExp(r'\s').hasMatch(s) || !RegExp(r'^[a-z][a-z0-9+.-]*:', caseSensitive: false).hasMatch(s)) {
    return null;
  }
  return normalizeHref(s);
}

/// Splits a style attribute into its declarations (without CSSOM, so `mso-*` stays).
Map<String, String> _parseStyle(String? s) {
  final out = <String, String>{};
  for (final part in (s ?? '').split(';')) {
    final i = part.indexOf(':');
    if (i < 0) continue;
    final k = part.substring(0, i).trim().toLowerCase();
    final v = part.substring(i + 1).trim();
    if (k.isNotEmpty && v.isNotEmpty) out[k] = v;
  }
  return out;
}

/// CSS size in px (pt, px, em/rem relative to 16 px, %); null for keywords.
double? _toPx(String v, double base) {
  final m = RegExp(r'^\s*(\d+(?:\.\d+)?)\s*(pt|px|em|rem|%)\s*$', caseSensitive: false).firstMatch(v);
  if (m == null) return null;
  final n = double.parse(m.group(1)!);
  return switch (m.group(2)!.toLowerCase()) {
    'pt' => n * 4 / 3,
    'px' => n,
    'em' => n * base,
    'rem' => n * 16,
    _ => n / 100 * base,
  };
}

/// Base font size of the source (px): Word `p.MsoNormal{font-size:…}` or 11 pt, else 16 px (browser).
double _baseSize(dom.Document doc, String html) {
  final css = [for (final s in doc.querySelectorAll('style')) s.text].join('\n');
  final m = RegExp(
    r'(?:p\.MsoNormal|body)[^{]*\{[^}]*font-size:\s*([\d.]+\s*(?:pt|px))',
    caseSensitive: false,
  ).firstMatch(css);
  if (m != null) return _toPx(m.group(1)!, 16) ?? 16;
  return RegExp(r'urn:schemas-microsoft-com:office|class="?Mso', caseSensitive: false).hasMatch(html) ? 11 * 4 / 3 : 16;
}

/// A number like JS prints it (no trailing `.0`).
String _jsNum(double v) => v == v.roundToDouble() ? '${v.toInt()}' : '$v';

class _WordItem {
  _WordItem(this.list, this.level, this.ordered);
  final String list;
  final int level;
  final bool ordered;
}

/// A Word list paragraph: removes its bullet/number and tells list, level and kind.
_WordItem? _wordListItem(dom.Element el) {
  final m = RegExp(r'mso-list:\s*(l\d+)\s+level(\d+)', caseSensitive: false).firstMatch(el.attributes['style'] ?? '');
  if (m == null) return null;
  var marker = '';
  var inside = false;
  for (final n in el.nodes.toList()) {
    if (n is dom.Comment) {
      final d = (n.data ?? '').trim().toLowerCase();
      if (d.startsWith('[if') && d.contains('supportlists')) {
        inside = true;
      } else if (d.startsWith('[endif')) {
        inside = false;
      }
      n.remove();
      continue;
    }
    if (inside) {
      marker += _nodeText(n);
      n.remove();
    }
  }
  for (final s in _descendants(el).whereType<dom.Element>().toList()) {
    final style = s.attributes['style'] ?? '';
    if (style.contains('mso-list') && RegExp(r'mso-list:\s*ignore', caseSensitive: false).hasMatch(style)) {
      marker += s.text;
      s.remove();
    }
  }
  final mk = marker.trim();
  final ordered = RegExp(r'^(\d+|[a-z]|[ivxlc]+)[.)]$', caseSensitive: false).hasMatch(mk);
  return _WordItem(m.group(1)!, math.max(1, int.parse(m.group(2)!)), ordered);
}

/// Consecutive Word list paragraphs → `<ul>`/`<ol>` with `<li>` (levels nested).
void _wordLists(dom.Element root) {
  final paras = [
    for (final e in _descendants(root).whereType<dom.Element>())
      if (const {'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div'}.contains(e.localName) &&
          RegExp(r'mso-list:\s*l\d+', caseSensitive: false).hasMatch(e.attributes['style'] ?? ''))
        e,
  ];
  dom.Element? top;
  var topId = '';
  var stack = <(int, dom.Element)>[];
  for (final p in paras) {
    final it = _wordListItem(p);
    if (it == null) continue;
    // part of the running list when the list stands right before it (nothing but whitespace/comments between)
    var sib = _previousSibling(p);
    while (sib != null && (sib is dom.Comment || (sib is dom.Text && sib.text.trim().isEmpty))) {
      sib = _previousSibling(sib);
    }
    if (top == null || !identical(sib, top) || it.list != topId) {
      top = null;
      topId = it.list;
      stack = [];
    }
    final li = dom.Element.tag('li');
    final para = dom.Element.tag('p');
    _moveChildren(p, para);
    li.append(para);
    while (stack.isNotEmpty && stack.last.$1 > it.level) {
      stack.removeLast();
    }
    var cur = stack.isEmpty ? null : stack.last;
    if (cur == null || cur.$1 < it.level) {
      final list = dom.Element.tag(it.ordered ? 'ol' : 'ul');
      if (cur != null) {
        final last = cur.$2.children.isEmpty ? null : cur.$2.children.last;
        (last ?? (cur.$2..append(dom.Element.tag('li'))).children.last).append(list);
      } else {
        p.parentNode!.insertBefore(list, p);
        top = list;
      }
      cur = (it.level, list);
      stack.add(cur);
    }
    cur.$2.append(li);
    p.remove();
  }
}

/// Nearest highlight of the format bar; white and very dark backgrounds are no highlight.
String? _nearestHighlight(String hex) {
  if (!RegExp(r'^#[0-9a-f]{6}$').hasMatch(hex)) return null;
  final (r, g, b) = _rgb(hex);
  final light = (r * 299 + g * 587 + b * 114) / 1000;
  if (light > 245 || light < 60) return null;
  var best = _highlights.first;
  var dist = double.infinity;
  for (final c in _highlights) {
    final (r2, g2, b2) = _rgb(c);
    final d = math.pow(r - r2, 2) + math.pow(g - g2, 2) + math.pow(b - b2, 2);
    if (d < dist) {
      dist = d.toDouble();
      best = c;
    }
  }
  return best;
}

(int, int, int) _rgb(String hex) {
  final h = hex.replaceAll('#', '');
  return (
    int.parse(h.substring(0, 2), radix: 16),
    int.parse(h.substring(2, 4), radix: 16),
    int.parse(h.substring(4, 6), radix: 16),
  );
}

/// CSS color → what a canvas `fillStyle` gives back (`#rrggbb`, or `rgba(r, g, b, a)` when translucent): named
/// colors, `#rgb[a]`/`#rrggbb[aa]`, `rgb()/rgba()`, `hsl()/hsla()`; null for unknown, transparent, `inherit` …
/// (web `normColor`).
String? normColor(String? v) {
  if (v == null) return null;
  final s = v.trim().toLowerCase();
  if (s.isEmpty || const {'transparent', 'inherit', 'initial', 'currentcolor'}.contains(s) || s.startsWith('var(')) {
    return null;
  }
  final c = _parseCssColor(s);
  if (c == null) return null;
  final (r, g, b, a) = c;
  if (a <= 0) return null; // rgba(…, 0): no color
  String h(int x) => x.toRadixString(16).padLeft(2, '0');
  if (a >= 1) return '#${h(r)}${h(g)}${h(b)}';
  return 'rgba($r, $g, $b, ${_alpha(a)})';
}

/// Alpha like Chrome serializes it (shortest of 2–6 decimals that reads back as the stored 8-bit value).
String _alpha(double a) {
  final byte = (a * 255).round();
  for (var d = 1; d <= 6; d++) {
    final s = a.toStringAsFixed(d);
    if ((double.parse(s) * 255).round() == byte) return _jsNum(double.parse(s));
  }
  return _jsNum(a);
}

(int, int, int, double)? _parseCssColor(String s) {
  final named = _namedColors[s];
  if (named != null) return (named >> 16 & 255, named >> 8 & 255, named & 255, 1);
  if (s.startsWith('#')) {
    final h = s.substring(1);
    if (!RegExp(r'^[0-9a-f]+$').hasMatch(h)) return null;
    int x(String t) => int.parse(t, radix: 16);
    switch (h.length) {
      case 3 || 4:
        final a = h.length == 4 ? x(h[3] * 2) / 255 : 1.0;
        return (x(h[0] * 2), x(h[1] * 2), x(h[2] * 2), a);
      case 6 || 8:
        final a = h.length == 8 ? x(h.substring(6, 8)) / 255 : 1.0;
        return (x(h.substring(0, 2)), x(h.substring(2, 4)), x(h.substring(4, 6)), a);
    }
    return null;
  }
  final m = RegExp(r'^(rgba?|hsla?)\((.*)\)$').firstMatch(s);
  if (m == null) return null;
  final args = m.group(2)!.trim().split(RegExp(r'\s*,\s*|\s*/\s*|\s+')).where((a) => a.isNotEmpty).toList();
  if (args.length < 3 || args.length > 4) return null;
  double? alpha = 1;
  if (args.length == 4) {
    final t = args[3];
    alpha = t.endsWith('%') ? double.tryParse(t.substring(0, t.length - 1))?.let((v) => v / 100) : double.tryParse(t);
    if (alpha == null) return null;
    alpha = alpha.clamp(0, 1).toDouble();
  }
  if (m.group(1)!.startsWith('rgb')) {
    int? ch(String t) {
      final p = t.endsWith('%');
      final n = double.tryParse(p ? t.substring(0, t.length - 1) : t);
      if (n == null) return null;
      return (p ? n * 2.55 : n).round().clamp(0, 255);
    }

    final r = ch(args[0]), g = ch(args[1]), b = ch(args[2]);
    if (r == null || g == null || b == null) return null;
    return (r, g, b, alpha);
  }
  final hue = double.tryParse(args[0].replaceAll('deg', ''));
  final sat = args[1].endsWith('%') ? double.tryParse(args[1].substring(0, args[1].length - 1)) : null;
  final lig = args[2].endsWith('%') ? double.tryParse(args[2].substring(0, args[2].length - 1)) : null;
  if (hue == null || sat == null || lig == null) return null;
  final hh = ((hue % 360) + 360) % 360 / 360, ss = sat.clamp(0, 100) / 100, ll = lig.clamp(0, 100) / 100;
  double f(double t) {
    final q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss, p = 2 * ll - q;
    var x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  }

  int to8(double v) => (v * 255).round().clamp(0, 255);
  return (to8(f(hh + 1 / 3)), to8(f(hh)), to8(f(hh - 1 / 3)), alpha);
}

extension<T> on T {
  R let<R>(R Function(T) f) => f(this);
}

const _namedColors = {
  'aliceblue': 0xf0f8ff, 'antiquewhite': 0xfaebd7, 'aqua': 0x00ffff, 'aquamarine': 0x7fffd4, 'azure': 0xf0ffff, //
  'beige': 0xf5f5dc, 'bisque': 0xffe4c4, 'black': 0x000000, 'blanchedalmond': 0xffebcd, 'blue': 0x0000ff,
  'blueviolet': 0x8a2be2, 'brown': 0xa52a2a, 'burlywood': 0xdeb887, 'cadetblue': 0x5f9ea0, 'chartreuse': 0x7fff00,
  'chocolate': 0xd2691e, 'coral': 0xff7f50, 'cornflowerblue': 0x6495ed, 'cornsilk': 0xfff8dc, 'crimson': 0xdc143c,
  'cyan': 0x00ffff, 'darkblue': 0x00008b, 'darkcyan': 0x008b8b, 'darkgoldenrod': 0xb8860b, 'darkgray': 0xa9a9a9,
  'darkgreen': 0x006400, 'darkgrey': 0xa9a9a9, 'darkkhaki': 0xbdb76b, 'darkmagenta': 0x8b008b,
  'darkolivegreen': 0x556b2f, 'darkorange': 0xff8c00, 'darkorchid': 0x9932cc, 'darkred': 0x8b0000,
  'darksalmon': 0xe9967a, 'darkseagreen': 0x8fbc8f, 'darkslateblue': 0x483d8b, 'darkslategray': 0x2f4f4f,
  'darkslategrey': 0x2f4f4f, 'darkturquoise': 0x00ced1, 'darkviolet': 0x9400d3, 'deeppink': 0xff1493,
  'deepskyblue': 0x00bfff, 'dimgray': 0x696969, 'dimgrey': 0x696969, 'dodgerblue': 0x1e90ff, 'firebrick': 0xb22222,
  'floralwhite': 0xfffaf0, 'forestgreen': 0x228b22, 'fuchsia': 0xff00ff, 'gainsboro': 0xdcdcdc,
  'ghostwhite': 0xf8f8ff, 'gold': 0xffd700, 'goldenrod': 0xdaa520, 'gray': 0x808080, 'green': 0x008000,
  'greenyellow': 0xadff2f, 'grey': 0x808080, 'honeydew': 0xf0fff0, 'hotpink': 0xff69b4, 'indianred': 0xcd5c5c,
  'indigo': 0x4b0082, 'ivory': 0xfffff0, 'khaki': 0xf0e68c, 'lavender': 0xe6e6fa, 'lavenderblush': 0xfff0f5,
  'lawngreen': 0x7cfc00, 'lemonchiffon': 0xfffacd, 'lightblue': 0xadd8e6, 'lightcoral': 0xf08080,
  'lightcyan': 0xe0ffff, 'lightgoldenrodyellow': 0xfafad2, 'lightgray': 0xd3d3d3, 'lightgreen': 0x90ee90,
  'lightgrey': 0xd3d3d3, 'lightpink': 0xffb6c1, 'lightsalmon': 0xffa07a, 'lightseagreen': 0x20b2aa,
  'lightskyblue': 0x87cefa, 'lightslategray': 0x778899, 'lightslategrey': 0x778899, 'lightsteelblue': 0xb0c4de,
  'lightyellow': 0xffffe0, 'lime': 0x00ff00, 'limegreen': 0x32cd32, 'linen': 0xfaf0e6, 'magenta': 0xff00ff,
  'maroon': 0x800000, 'mediumaquamarine': 0x66cdaa, 'mediumblue': 0x0000cd, 'mediumorchid': 0xba55d3,
  'mediumpurple': 0x9370db, 'mediumseagreen': 0x3cb371, 'mediumslateblue': 0x7b68ee, 'mediumspringgreen': 0x00fa9a,
  'mediumturquoise': 0x48d1cc, 'mediumvioletred': 0xc71585, 'midnightblue': 0x191970, 'mintcream': 0xf5fffa,
  'mistyrose': 0xffe4e1, 'moccasin': 0xffe4b5, 'navajowhite': 0xffdead, 'navy': 0x000080, 'oldlace': 0xfdf5e6,
  'olive': 0x808000, 'olivedrab': 0x6b8e23, 'orange': 0xffa500, 'orangered': 0xff4500, 'orchid': 0xda70d6,
  'palegoldenrod': 0xeee8aa, 'palegreen': 0x98fb98, 'paleturquoise': 0xafeeee, 'palevioletred': 0xdb7093,
  'papayawhip': 0xffefd5, 'peachpuff': 0xffdab9, 'peru': 0xcd853f, 'pink': 0xffc0cb, 'plum': 0xdda0dd,
  'powderblue': 0xb0e0e6, 'purple': 0x800080, 'rebeccapurple': 0x663399, 'red': 0xff0000, 'rosybrown': 0xbc8f8f,
  'royalblue': 0x4169e1, 'saddlebrown': 0x8b4513, 'salmon': 0xfa8072, 'sandybrown': 0xf4a460, 'seagreen': 0x2e8b57,
  'seashell': 0xfff5ee, 'sienna': 0xa0522d, 'silver': 0xc0c0c0, 'skyblue': 0x87ceeb, 'slateblue': 0x6a5acd,
  'slategray': 0x708090, 'slategrey': 0x708090, 'snow': 0xfffafa, 'springgreen': 0x00ff7f, 'steelblue': 0x4682b4,
  'tan': 0xd2b48c, 'teal': 0x008080, 'thistle': 0xd8bfd8, 'tomato': 0xff6347, 'turquoise': 0x40e0d0,
  'violet': 0xee82ee, 'wheat': 0xf5deb3, 'white': 0xffffff, 'whitesmoke': 0xf5f5f5, 'yellow': 0xffff00,
  'yellowgreen': 0x9acd32,
};

// ---- 2. parsing with the editor's schema (ProseMirror DOMParser + Tiptap rules) --------------------------------

/// Mark order of the schema (ProseMirror keeps marks sorted by it): link, textStyle, bold, code, italic, strike,
/// underline, highlight.
const _markRank = {
  'link': 0,
  'textStyle': 1,
  'bold': 2,
  'code': 3,
  'italic': 4,
  'strike': 5,
  'underline': 6,
  'highlight': 7,
};

const _textblocks = {'paragraph', 'heading', 'codeBlock'};
const _blockTypes = {
  'paragraph', 'heading', 'blockquote', 'codeBlock', 'horizontalRule', 'bulletList', 'orderedList', 'taskList', //
};
const _blockTags = {
  'address', 'article', 'aside', 'blockquote', 'canvas', 'dd', 'div', 'dl', 'fieldset', 'figcaption', 'figure', //
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li', 'noscript', 'ol', 'output',
  'p', 'pre', 'section', 'table', 'tfoot', 'ul',
};
const _inlineParents = {
  'a', 'abbr', 'acronym', 'b', 'cite', 'code', 'del', 'em', 'i', 'ins', 'kbd', 'label', 'output', 'q', 'ruby', 's', //
  'samp', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'tt', 'var',
};

typedef _Mark = Map<String, Object?>;

/// Adds [m] to [set] like ProseMirror's `Mark.addToSet` (one mark per type, `code` excludes all others, sorted).
List<_Mark> _addMark(List<_Mark> set, _Mark m) {
  final type = m['type'];
  if (set.any((e) => e['type'] == 'code') && type != 'code') return set;
  final out = <_Mark>[
    for (final e in set)
      if (e['type'] != type && type != 'code') e,
  ];
  out
    ..add(m)
    ..sort((a, b) => (_markRank[a['type']] ?? 99).compareTo(_markRank[b['type']] ?? 99));
  return out;
}

List<_Mark> _removeMark(List<_Mark> set, String type) => [
  for (final e in set)
    if (e['type'] != type) e,
];

/// What may go into a node of [container] type: [] = directly, a list of wrappers, or null.
List<String>? _wrapping(String container, String type) {
  final inline = type == 'text' || type == 'hardBreak';
  switch (container) {
    case 'paragraph' || 'heading':
      return inline ? const [] : null;
    case 'codeBlock':
      return type == 'text' ? const [] : null;
    case 'bulletList' || 'orderedList':
      if (type == 'listItem') return const [];
      if (type == 'paragraph') return const ['listItem'];
      return inline ? const ['listItem', 'paragraph'] : null;
    case 'taskList':
      if (type == 'taskItem') return const [];
      if (type == 'paragraph') return const ['taskItem'];
      return inline ? const ['taskItem', 'paragraph'] : null;
    case 'horizontalRule' || 'hardBreak' || 'text':
      return null;
    default: // doc/top, blockquote, listItem, taskItem, unknown containers: blocks
      if (_blockTypes.contains(type)) return const [];
      if (type == 'listItem') return const ['bulletList'];
      if (type == 'taskItem') return const ['taskList'];
      return inline ? const ['paragraph'] : null;
  }
}

/// Node types a node of [type] may start with (its content expression's first step).
Set<String> _firstTypes(String type) => switch (type) {
  'paragraph' || 'heading' => const {'text', 'hardBreak'},
  'codeBlock' => const {'text'},
  'listItem' || 'taskItem' => const {'paragraph'},
  'bulletList' || 'orderedList' => const {'listItem'},
  'taskList' => const {'taskItem'},
  'horizontalRule' || 'hardBreak' || 'text' => const {},
  _ => _blockTypes,
};

/// ProseMirror `NodeType.compatibleContent`: same type, or both may start with the same node type.
bool _compatible(String a, String b) => a == b || _firstTypes(a).any(_firstTypes(b).contains);

class _Ctx {
  _Ctx(this.type, this.attrs, {required this.solid, this.pre = false});
  final String type;
  final Map<String, Object?> attrs;
  final bool solid;
  final bool pre;
  final content = <Map<String, Object?>>[];

  bool get inlineContent => _textblocks.contains(type);

  /// The node (trailing whitespace stripped, neighbouring texts with the same marks merged, required content filled).
  Map<String, Object?> finish() {
    if (!pre && content.isNotEmpty && content.last['type'] == 'text') {
      final t = content.last['text'] as String;
      final s = t.replaceFirst(RegExp(r'[ \t\r\n\u000c]+$'), '');
      if (s.isEmpty) {
        content.removeLast();
      } else if (s != t) {
        content.last = {...content.last, 'text': s};
      }
    }
    final merged = <Map<String, Object?>>[];
    for (final n in content) {
      final last = merged.isEmpty ? null : merged.last;
      if (last != null &&
          last['type'] == 'text' &&
          n['type'] == 'text' &&
          canonicalJson(last['marks'] ?? const []) == canonicalJson(n['marks'] ?? const [])) {
        merged.last = {...last, 'text': '${last['text']}${n['text']}'};
      } else {
        merged.add(n);
      }
    }
    // ProseMirror fills what the content expression requires (`fillBefore`)
    if ((type == 'listItem' || type == 'taskItem') && (merged.isEmpty || merged.first['type'] != 'paragraph')) {
      merged.insert(0, {'type': 'paragraph'});
    }
    if ((type == 'bulletList' || type == 'orderedList') && merged.isEmpty) {
      merged.add({
        'type': 'listItem',
        'content': [
          {'type': 'paragraph'},
        ],
      });
    }
    return {'type': type, if (attrs.isNotEmpty) 'attrs': attrs, if (merged.isNotEmpty) 'content': merged};
  }
}

/// ProseMirror's `ParseContext` for the editor's schema, starting in a block container (the paste's context).
class _Parser {
  final _nodes = <_Ctx>[_Ctx('doc', const {}, solid: true)];

  _Ctx get _top => _nodes.last;

  List<Map<String, Object?>> parse(dom.Element body) {
    _addAll(body, const []);
    while (_nodes.length > 1) {
      _close();
    }
    return _nodes.first.finish()['content'] as List<Map<String, Object?>>? ?? const [];
  }

  void _close() {
    final c = _nodes.removeLast();
    _top.content.add(c.finish());
  }

  void _addAll(dom.Node parent, List<_Mark> marks) {
    for (final n in parent.nodes.toList()) {
      _addDom(n, marks);
    }
  }

  void _addDom(dom.Node n, List<_Mark> marks) {
    if (n is dom.Text) return _addText(n, marks);
    if (n is! dom.Element) return;
    final name = (n.localName ?? '').toLowerCase();
    if (const {'head', 'noscript', 'object', 'script', 'style', 'title'}.contains(name)) return;
    // the clipboard parser ignores a <br> that ends a block
    if (name == 'br') {
      final p = n.parentNode;
      final last = p != null && identical(p.nodes.last, n);
      if (last && p is dom.Element && !_inlineParents.contains((p.localName ?? '').toLowerCase())) return;
      return _insert({'type': 'hardBreak'}, marks);
    }
    final st = _parseStyle(n.attributes['style']);
    // style rules (bold/italic/strike/underline from CSS) first, like `readStyles`
    var inner = marks;
    final fw = st['font-weight'];
    if (fw != null) {
      if (fw == '400') {
        inner = _removeMark(inner, 'bold');
      } else if (RegExp(r'^(bold(er)?|[5-9]\d{2,})$').hasMatch(fw)) {
        inner = _addMark(inner, {'type': 'bold'});
      }
    }
    final fs = st['font-style'];
    if (fs == 'normal') inner = _removeMark(inner, 'italic');
    if (fs == 'italic') inner = _addMark(inner, {'type': 'italic'});
    final td = st['text-decoration'];
    if (td != null && td.contains('line-through')) inner = _addMark(inner, {'type': 'strike'});
    if (td != null && td.contains('underline')) inner = _addMark(inner, {'type': 'underline'});

    // node rules
    final node = _nodeRule(n, name);
    if (node != null) {
      final (type, attrs) = node;
      if (type == 'horizontalRule') return _insert({'type': type}, inner);
      if (!_findPlace(type)) return _addAll(n, inner);
      _nodes.add(_Ctx(type, attrs, solid: true, pre: type == 'codeBlock'));
      final depth = _nodes.length;
      _addAll(n, type == 'codeBlock' ? const [] : inner);
      while (_nodes.length >= depth) {
        _close();
      }
      return;
    }
    // mark rules
    final mark = _markRule(n, name, st);
    if (mark != null) inner = _addMark(inner, mark);
    if (_blockTags.contains(name)) {
      // an unknown block (div …): ends running inline content, its own content goes into new blocks
      if (_nodes.length > 1 &&
          _top.content.isNotEmpty &&
          const {'text', 'hardBreak'}.contains(_top.content.first['type'])) {
        _close();
      }
      final depth = _nodes.length;
      _addAll(n, inner);
      while (_nodes.length > depth) {
        _close();
      }
      return;
    }
    _addAll(n, inner);
  }

  (String, Map<String, Object?>)? _nodeRule(dom.Element n, String name) {
    switch (name) {
      case 'p':
        return ('paragraph', const {});
      case 'h1' || 'h2' || 'h3' || 'h4' || 'h5' || 'h6':
        return ('heading', {'level': int.parse(name.substring(1))});
      case 'blockquote':
        return ('blockquote', const {});
      case 'pre':
        return ('codeBlock', {'language': _language(n)});
      case 'hr':
        return ('horizontalRule', const {});
      case 'ul':
        return n.attributes['data-type'] == 'taskList' ? ('taskList', const {}) : ('bulletList', const {});
      case 'ol':
        final start = n.attributes['start'];
        final s = start == null ? 1 : int.tryParse(RegExp(r'^\s*-?\d+').stringMatch(start)?.trim() ?? '') ?? 1;
        return ('orderedList', {'start': s, 'type': n.attributes['type']});
      case 'li':
        if (n.attributes['data-type'] == 'taskItem') {
          final c = n.attributes['data-checked'];
          return ('taskItem', {'checked': c == '' || c == 'true'});
        }
        return ('listItem', const {});
    }
    return null;
  }

  static String? _language(dom.Element pre) {
    final code = pre.children.isEmpty ? null : pre.children.first;
    final cls = code?.attributes['class'] ?? '';
    for (final c in cls.split(RegExp(r'\s+'))) {
      if (c.startsWith('language-')) return c.substring('language-'.length);
    }
    return null;
  }

  _Mark? _markRule(dom.Element n, String name, Map<String, String> st) {
    switch (name) {
      case 'strong':
        return {'type': 'bold'};
      case 'b':
        return st['font-weight'] == 'normal' ? null : {'type': 'bold'};
      case 'em':
        return {'type': 'italic'};
      case 'i':
        return st['font-style'] == 'normal' ? null : {'type': 'italic'};
      case 'u':
        return {'type': 'underline'};
      case 's' || 'del' || 'strike':
        return {'type': 'strike'};
      case 'code':
        return {'type': 'code'};
      case 'a':
        final href = n.attributes['href'];
        if (href == null || webSafeHref(href) == null) return null;
        return {'type': 'link', 'attrs': linkMarkAttrs(href)};
      case 'mark':
        return {
          'type': 'highlight',
          'attrs': {'color': n.attributes['data-color'] ?? st['background-color'] ?? ''},
        };
      case 'span':
        if (!n.attributes.containsKey('style')) return null;
        return {
          'type': 'textStyle',
          'attrs': {'color': (st['color'] ?? '').replaceAll(RegExp('[\'"]+'), ''), 'fontSize': st['font-size'] ?? ''},
        };
    }
    return null;
  }

  /// Finds a place for a node of [type] (ProseMirror `findPlace`): the open node needing the fewest wrappers (the
  /// deepest on a tie), not past an explicit one; closes the nodes below it and opens the wrappers.
  bool _findPlace(String type) {
    List<String>? route;
    var at = -1;
    for (var d = _nodes.length - 1; d >= 0; d--) {
      final found = _wrapping(_nodes[d].type, type);
      if (found != null && (route == null || route.length > found.length)) {
        route = found;
        at = d;
        if (found.isEmpty) break;
      }
      if (_nodes[d].solid) break;
    }
    if (route == null) return false;
    while (_nodes.length - 1 > at) {
      _close();
    }
    for (final w in route) {
      _nodes.add(_Ctx(w, w == 'taskItem' ? const {'checked': false} : const {}, solid: false));
    }
    return true;
  }

  void _insert(Map<String, Object?> node, List<_Mark> marks) {
    if (!_findPlace(node['type'] as String)) return;
    final allowMarks = _top.type != 'codeBlock';
    _top.content.add({...node, if (allowMarks && marks.isNotEmpty && node['type'] != 'horizontalRule') 'marks': marks});
  }

  void _addText(dom.Text t, List<_Mark> marks) {
    var value = t.data;
    final top = _top;
    final pre = top.pre;
    final inlineContext =
        top.inlineContent ||
        (top.content.isNotEmpty
            ? const {'text', 'hardBreak'}.contains(top.content.first['type'])
            : (t.parentNode is dom.Element && !_blockTags.contains((t.parentNode as dom.Element).localName)));
    if (!(pre || inlineContext || RegExp(r'[^ \t\r\n\u000c]').hasMatch(value))) return;
    if (!pre) {
      value = value.replaceAll(RegExp(r'[ \t\r\n\u000c]+'), ' ');
      if (RegExp(r'^[ \t\r\n\u000c]').hasMatch(value)) {
        final before = top.content.isEmpty ? null : top.content.last;
        final domBefore = _previousSibling(t);
        if (before == null ||
            (domBefore is dom.Element && domBefore.localName == 'br') ||
            (before['type'] == 'text' && RegExp(r'[ \t\r\n\u000c]$').hasMatch(before['text'] as String))) {
          value = value.substring(1);
        }
      }
    } else {
      value = value.replaceAll(RegExp(r'\r\n?'), '\n');
    }
    if (value.isEmpty) return;
    _insert({'type': 'text', 'text': value}, marks);
  }
}

/// The pasted HTML as ProseMirror nodes of the editor's schema (after [cleanPastedHtml]).
List<Map<String, Object?>> parsePastedHtml(String html, {required bool sizes}) =>
    _Parser().parse(cleanPastedHtml(html, sizes: sizes));

// ---- 3. inserting (Slice.maxOpen + replaceSelection) -------------------------------------------------------------

bool _isTextblock(Map<String, Object?> n) => _textblocks.contains(n['type']);
List<Map<String, Object?>> _kids(Map<String, Object?> n) =>
    (n['content'] is List ? n['content'] as List : const []).cast<Map<String, Object?>>();

/// Length of a text block's content in editor characters (text + one per hard break).
int _inlineLength(List<Map<String, Object?>> inline) {
  var n = 0;
  for (final x in inline) {
    n += x['type'] == 'text' ? (x['text'] as String).length : 1;
  }
  return n;
}

/// Splits inline content at editor offset [at].
(List<Map<String, Object?>>, List<Map<String, Object?>>) _splitInline(List<Map<String, Object?>> inline, int at) {
  final left = <Map<String, Object?>>[], right = <Map<String, Object?>>[];
  var pos = 0;
  for (final x in inline) {
    final len = x['type'] == 'text' ? (x['text'] as String).length : 1;
    if (pos + len <= at) {
      left.add(x);
    } else if (pos >= at) {
      right.add(x);
    } else {
      final t = x['text'] as String;
      left.add({...x, 'text': t.substring(0, at - pos)});
      right.add({...x, 'text': t.substring(at - pos)});
    }
    pos += len;
  }
  return (left, right);
}

/// Inline nodes joined, neighbouring texts with the same marks merged.
List<Map<String, Object?>> _joinInline(List<Map<String, Object?>> a, List<Map<String, Object?>> b) {
  final out = [...a];
  for (final x in b) {
    final last = out.isEmpty ? null : out.last;
    if (last != null &&
        last['type'] == 'text' &&
        x['type'] == 'text' &&
        canonicalJson(last['marks'] ?? const []) == canonicalJson(x['marks'] ?? const [])) {
      out.last = {...last, 'text': '${last['text']}${x['text']}'};
    } else {
      out.add(x);
    }
  }
  return out;
}

/// Inline content as a code block takes it (no marks, no hard breaks).
List<Map<String, Object?>> _asCode(List<Map<String, Object?>> inline) => [
  for (final x in inline)
    if (x['type'] == 'text') {'type': 'text', 'text': x['text']},
];

void _setInline(Map<String, Object?> block, List<Map<String, Object?>> inline) {
  final content = block['type'] == 'codeBlock' ? _joinInline(const [], _asCode(inline)) : _joinInline(const [], inline);
  if (content.isEmpty) {
    block.remove('content');
  } else {
    block['content'] = content;
  }
}

/// An open node of the document while pasting: the container and where the next node goes.
class _Front {
  _Front(this.node, this.at);
  final Map<String, Object?> node;
  int at;
  String get type => node['type'] as String? ?? '';
}

/// Pastes [html] into [doc] over the text range [from, to) like the web editor; [sizes]: part font sizes allowed
/// (text, shape). Returns the caret (offset in the editor text) or null when there was nothing to paste.
int? pasteHtmlInto(RichEditDoc doc, int from, int to, String html, {required bool sizes}) {
  final slice = parsePastedHtml(html, sizes: sizes);
  if (slice.isEmpty) return null;
  final len = doc.text.length;
  var a = from.clamp(0, len), b = to.clamp(0, len);
  if (a > b) (a, b) = (b, a);
  if (b > a) doc.setText(doc.text.substring(0, a) + doc.text.substring(b), caret: a);
  final root = doc.toJson();

  // the text block at the caret with its ancestors
  final path = <(Map<String, Object?>, int)>[]; // (container, index of the child on the way)
  Map<String, Object?>? block;
  var offset = 0;
  var pos = 0;
  bool find(Map<String, Object?> node) {
    final kids = _kids(node);
    for (var i = 0; i < kids.length; i++) {
      final k = kids[i];
      if (_isTextblock(k)) {
        final l = _inlineLength(_kids(k));
        if (a <= pos + l) {
          path.add((node, i));
          block = k;
          offset = a - pos;
          return true;
        }
        pos += l + 1;
      } else if (k['content'] is List) {
        path.add((node, i));
        if (find(k)) return true;
        path.removeLast();
      }
    }
    return false;
  }

  if (!find(root)) {
    // no text block (empty document): one paragraph
    final p = <String, Object?>{'type': 'paragraph'};
    root['content'] = [...?(root['content'] as List?), p];
    path
      ..clear()
      ..add((root, (root['content'] as List).length - 1));
    block = p;
    offset = 0;
  }
  final t = block!;
  final (left, right) = _splitInline(_kids(t), offset);
  final (tParent, tIndex) = path.last;
  final tParentType = tParent['type'] as String? ?? 'doc';

  // open start/end of the slice (Slice.maxOpen: down the first/last children to the text block)
  List<Map<String, Object?>> openPath(bool start) {
    final out = <Map<String, Object?>>[];
    Map<String, Object?>? n = start ? slice.first : slice.last;
    while (n != null) {
      if (_isTextblock(n)) return out..add(n);
      final kids = _kids(n);
      if (kids.isEmpty) return const []; // a leaf (rule): closed
      out.add(n);
      n = start ? kids.first : kids.last;
    }
    return const [];
  }

  final startPath = openPath(true);
  final endPath = openPath(false);
  final endBlock = endPath.isEmpty ? null : endPath.last;
  // copies of open wrappers (rest of a list that fits higher up) → the slice's node they continue
  final origin = Map<Map<String, Object?>, Map<String, Object?>>.identity();
  bool onEnd(Map<String, Object?> n) => endPath.any((e) => identical(e, n) || identical(e, origin[n]));

  // an empty text block is replaced as a whole (ProseMirror: the range covers it) – not the first paragraph of a list
  // item, which the item needs
  final covered =
      left.isEmpty && right.isEmpty && !((tParentType == 'listItem' || tParentType == 'taskItem') && tIndex == 0);

  final frontier = <_Front>[for (final (n, i) in path) _Front(n, i + 1)];
  final trailing = <(int, List<Map<String, Object?>>)>[]; // content after the caret of closed nodes, by depth
  Map<String, Object?>? caretBlock;
  var caretAt = 0;

  void closeTo(int depth) {
    while (frontier.length - 1 > depth) {
      final f = frontier.removeLast();
      final kids = _kids(f.node);
      if (f.at < kids.length) {
        trailing.add((frontier.length, kids.sublist(f.at)));
        f.node['content'] = kids.sublist(0, f.at);
      }
    }
  }

  /// Opens [n] and its last children down to the end text block (it is open at the end of the slice).
  void openEnd(Map<String, Object?> n) {
    var cur = n;
    while (onEnd(cur) && !_isTextblock(cur)) {
      final kids = _kids(cur);
      if (kids.isEmpty) return;
      frontier.add(_Front(cur, kids.length));
      cur = kids.last;
    }
    if (identical(cur, endBlock)) {
      caretBlock = cur;
      caretAt = _inlineLength(_kids(cur));
    }
  }

  /// The last placed node was open at the end of the slice (its last children were opened).
  var lastOpened = false;
  Map<String, Object?>? lastPlaced;

  /// An emptied open slice node of [type]: the frontier closes down to the deepest open node with compatible content
  /// (stopping where [type] itself would fit); one of the same type is closed as well (ProseMirror Fitter).
  void align(String type) {
    for (var d = frontier.length - 1; d >= 0; d--) {
      if (_compatible(frontier[d].type, type)) {
        closeTo(d);
        if (frontier[d].type == type && frontier.length > 1) closeTo(d - 1);
        return;
      }
      if (_wrapping(frontier[d].type, type)?.isEmpty ?? false) return;
    }
  }

  /// Places [x] at the deepest open node that takes it; false (= defer to the wrapper) when an open node would take
  /// [parentType] instead.
  bool place(Map<String, Object?> x, String? parentType) {
    final type = x['type'] as String;
    lastOpened = onEnd(x);
    for (var d = frontier.length - 1; d >= 0; d--) {
      final w = _wrapping(frontier[d].type, type);
      if (w != null && w.isEmpty) {
        closeTo(d);
        final f = frontier[d];
        final kids = [..._kids(f.node)]..insert(f.at, x);
        f.node['content'] = kids;
        f.at++;
        lastPlaced = x;
        openEnd(x);
        return true;
      }
      if (parentType != null && (_wrapping(frontier[d].type, parentType)?.isEmpty ?? false)) return false;
    }
    // nowhere directly: wrap it (list items into a list, text into a paragraph) at the deepest node taking that
    for (var d = frontier.length - 1; d >= 0; d--) {
      final w = _wrapping(frontier[d].type, type);
      if (w == null) continue;
      var node = x;
      for (final wt in w.reversed) {
        node = {
          'type': wt,
          'content': [node],
        };
      }
      closeTo(d);
      final f = frontier[d];
      f.node['content'] = [..._kids(f.node)]..insert(f.at, node);
      f.at++;
      lastPlaced = node;
      if (onEnd(x)) {
        // the wrappers stay open around the open end
        for (var n = node; !identical(n, x); n = _kids(n).first) {
          frontier.add(_Front(n, 1));
        }
      }
      openEnd(x);
      return true;
    }
    return true; // does not fit anywhere: dropped like ProseMirror
  }

  void placeAll(
    List<Map<String, Object?>> items,
    Map<String, Object?>? parent,
    void Function(Map<String, Object?>) defer,
  ) {
    for (var i = 0; i < items.length; i++) {
      if (!place(items[i], parent?['type'] as String?)) {
        final copy = <String, Object?>{...parent!, 'content': items.sublist(i)};
        origin[copy] = origin[parent] ?? parent;
        defer(copy);
        return;
      }
    }
  }

  if (covered) {
    // the empty block goes, the slice takes its place as it is
    (tParent['content'] as List).removeAt(tIndex);
    frontier.last.at = tIndex;
    placeAll(slice, null, (_) {});
  } else {
    var restLeft = left;
    var startDone = false;
    if (startPath.isNotEmpty) {
      final first = startPath.last;
      if (identical(first, endBlock)) {
        // one text block: in place
        _setInline(t, _joinInline(_joinInline(left, _kids(first)), right));
        caretBlock = t;
        caretAt = _inlineLength(_joinInline(left, t['type'] == 'codeBlock' ? _asCode(_kids(first)) : _kids(first)));
        startDone = true;
      } else {
        restLeft = _joinInline(left, _kids(first));
      }
    }
    if (!startDone) {
      _setInline(t, restLeft);
      // remaining content of the open start nodes, deepest first; a wrapper that fits higher up keeps the rest
      Map<String, Object?>? deferred;
      for (var k = startPath.length - 2; k >= -1; k--) {
        final parent = k >= 0 ? startPath[k] : null;
        final siblings = k >= 0 ? _kids(parent!) : slice;
        final child = k + 1 < startPath.length ? startPath[k + 1] : null;
        final i = child == null ? -1 : siblings.indexWhere((s) => identical(s, child));
        final items = [?deferred, ...siblings.sublist(i + 1)];
        deferred = null;
        if (parent == null) {
          placeAll(items, null, (_) {});
          continue;
        }
        final type = parent['type'] as String;
        if (items.isEmpty) {
          // Fitter: the emptied open node lines up with the open node of the document that has compatible content
          // (a pasted list item with the list item at the caret) – the next content goes after it
          align(type);
          continue;
        }
        var all = true;
        placeAll(items, parent, (w) {
          deferred = w;
          all = false;
        });
        // all moved and not open: the document's node of the same type is done too (ProseMirror `placeNodes`)
        if (all && !lastOpened && frontier.length > 1 && frontier.last.type == type) closeTo(frontier.length - 2);
      }
      if (startPath.isEmpty) placeAll(slice, null, (_) {});
      if (caretBlock != null) {
        // the text after the caret continues the last pasted block
        final cb = caretBlock!;
        _setInline(cb, _joinInline(_kids(cb), right));
      } else if (right.isNotEmpty) {
        // closed at the end (a rule): the text after the caret stays a block of its own kind
        final rest = <String, Object?>{'type': t['type'], if (t['attrs'] != null) 'attrs': t['attrs']};
        _setInline(rest, right);
        place(rest, null);
        caretBlock = rest;
        caretAt = 0;
      }
    }
  }
  // content after the caret in closed nodes goes behind the pasted content again
  for (final (depth, nodes) in trailing.reversed) {
    final d = math.min(depth, frontier.length - 1);
    for (final n in nodes) {
      var placed = false;
      for (var k = d; k >= 0 && !placed; k--) {
        final w = _wrapping(frontier[k].type, n['type'] as String);
        if (w != null && w.isEmpty) {
          closeTo(k);
          final f = frontier[k];
          f.node['content'] = [..._kids(f.node)]..insert(f.at, n);
          f.at++;
          placed = true;
        }
      }
    }
  }
  doc.replaceWith(root);
  final cb = caretBlock;
  if (cb != null) return doc.offsetOf(cb, caretAt);
  // closed at the end (a rule): like `Selection.near` after the pasted content – the next text block, else the end
  final last = lastPlaced;
  if (last == null) return doc.text.length;
  var at = 0, passed = false;
  int? found;
  void walk(Map<String, Object?> n) {
    for (final k in _kids(n)) {
      if (found != null) return;
      if (_isTextblock(k)) {
        if (passed) {
          found = at;
          return;
        }
        at += _inlineLength(_kids(k)) + 1;
      } else {
        walk(k);
      }
      if (identical(k, last)) passed = true;
    }
  }

  walk(root);
  return found ?? doc.text.length;
}
