/// Editing rich text in the app (E2, concept §4.6) on the ProseMirror JSON the native API sends – without a
/// ProseMirror: the text field edits plain text, and every change is mapped back onto the JSON tree, so marks,
/// attributes, nodes and fields the app does not know survive untouched.
///
/// Model: the „text blocks“ of the document (the same nodes the web's `plainOf` turns into lines: nodes whose
/// content is only text/hard breaks, or empty paragraphs/headings/code blocks), joined with `\n` = the editor text
/// (equal to the plain-text mirror `text`). Every UTF-16 unit of that text is an item: a character with its marks, a
/// hard break, or the line separator between two blocks. An edit (common prefix/suffix of old and new text) removes
/// items and inserts new ones; a typed newline splits the block (a list item becomes two list items, a code block
/// keeps it as text), removing a separator joins two blocks. Everything outside the text blocks (rules, unknown
/// containers, list/quote structure) stays as it is.
library;

import 'dart:convert';
import 'dart:math' as math;

import 'rich_text.dart' show RichBlockKind;

/// A link target the web accepts (`http:`, `https:`, `mailto:`, `tel:`; without a scheme `https://` is added), else
/// null (docs/features/richtext.md).
String? safeHref(String input) {
  final s = input.trim();
  if (s.isEmpty || s.contains(RegExp(r'\s'))) return null;
  final scheme = RegExp(r'^([a-zA-Z][a-zA-Z0-9+.-]*):').firstMatch(s)?.group(1)?.toLowerCase();
  if (scheme == null) return 'https://$s';
  if (scheme == 'http' || scheme == 'https') return Uri.tryParse(s)?.host.isNotEmpty == true ? s : null;
  return scheme == 'mailto' || scheme == 'tel' ? s : null;
}

/// The link field's input like the web's `normalizeHref` (`richtext/links.ts`): an e-mail address becomes `mailto:`,
/// without a scheme `https://` is added, then only `http`, `https`, `mailto`, `tel` – serialized like the browser's
/// `URL.href` (lower-case scheme/host, `/` for an empty path). Null = „Das ist kein gültiger Link.“
String? normalizeHref(String input) {
  final s = input.trim();
  if (s.isEmpty) return null;
  if (RegExp(r'^[^\s@/:]+@[^\s@/]+\.[^\s@/]+$').hasMatch(s)) return _urlHref('mailto:$s');
  if (RegExp(r'^[a-z][a-z0-9+.-]*:', caseSensitive: false).hasMatch(s)) return _urlHref(s);
  return _urlHref('https://$s');
}

String? _urlHref(String raw) {
  final s = raw.trim();
  if (s.isEmpty || s.contains(RegExp(r'\s'))) return null;
  final u = Uri.tryParse(s);
  if (u == null) return null;
  final scheme = u.scheme.toLowerCase();
  if (scheme == 'http' || scheme == 'https') {
    if (u.host.isEmpty) return null;
    final b = StringBuffer('$scheme://');
    if (u.userInfo.isNotEmpty) b.write('${u.userInfo}@');
    b.write(u.host.toLowerCase());
    if (u.hasPort && u.port != (scheme == 'http' ? 80 : 443)) b.write(':${u.port}');
    b.write(u.path.isEmpty ? '/' : u.path);
    if (u.hasQuery) b.write('?${u.query}');
    if (u.hasFragment) b.write('#${u.fragment}');
    return b.toString();
  }
  if (scheme == 'mailto' || scheme == 'tel') return '$scheme:${s.substring(s.indexOf(':') + 1)}';
  return null;
}

/// Mark attributes of a link like Tiptap writes them (`richtext/extensions.ts`: the link extension's `HTMLAttributes`).
Map<String, Object?> linkMarkAttrs(String href) => {
  'href': href,
  'target': '_blank',
  'rel': 'noopener noreferrer nofollow',
  'class': 'rt-link',
  'title': null,
};

/// How a text block of the editor is shown (P8, F04): the same prefixes the board draws (`text_layout.dart`) –
/// bullets, numbers, check boxes, quote bar, indentation.
class RichLine {
  const RichLine(
    this.kind, {
    this.depth = 0,
    this.index = 0,
    this.level = 0,
    this.checked = false,
    this.continuation = false,
  });
  final RichBlockKind kind;
  final int depth;
  final int index;
  final int level;
  final bool checked;
  final bool continuation;

  bool get isList => kind == RichBlockKind.bullet || kind == RichBlockKind.ordered || kind == RichBlockKind.task;
}

/// Plain-text mirror of a ProseMirror document, exactly like the web's `plainOf` (contract §4 „Rich-Text“): text blocks
/// and list items separated by `\n`, hard breaks as `\n`.
String pmPlainText(Object? doc) {
  if (!isPmDoc(doc)) return '';
  final lines = <String>[];
  void walk(Object? n) {
    if (n is! Map) return;
    final kids = n['content'] is List ? n['content'] as List : const [];
    if (_isTextblock(n)) {
      lines.add(
        kids
            .map(
              (k) => k is Map && k['type'] == 'hardBreak'
                  ? '\n'
                  : (k is Map && k['text'] is String ? k['text'] as String : ''),
            )
            .join(),
      );
      return;
    }
    kids.forEach(walk);
  }

  ((doc as Map)['content'] as List).forEach(walk);
  return lines.join('\n');
}

bool isPmDoc(Object? v) => v is Map && v['type'] == 'doc' && v['content'] is List;

bool _isInline(Object? n) => n is Map && (n['type'] == 'text' || n['type'] == 'hardBreak');

bool _isTextblock(Map n) {
  final kids = n['content'] is List ? n['content'] as List : const [];
  if (kids.isNotEmpty) return kids.every(_isInline);
  return n['type'] == 'paragraph' || n['type'] == 'heading' || n['type'] == 'codeBlock';
}

/// Document from plain text: one paragraph per line (contract §4 „Migration“).
Map<String, Object?> textToPmDoc(String text) => {
  'type': 'doc',
  'content': [
    for (final line in text.split('\n'))
      if (line.isEmpty)
        {'type': 'paragraph'}
      else
        {
          'type': 'paragraph',
          'content': [
            {'type': 'text', 'text': line},
          ],
        },
  ],
};

/// The rich text that counts for an object (like the server, contract §4): `content` if its plain text equals
/// `text`, else `text` as paragraphs (an older client changed only `text`, or there is no `content` yet).
Map<String, Object?> effectivePmDoc(Object? content, String text) {
  if (isPmDoc(content) && pmPlainText(content) == text) return _deepCopy(content) as Map<String, Object?>;
  // a deep copy with loose types: editing puts other maps into these lists
  return text.isEmpty ? {'type': 'doc', 'content': <Object?>[]} : _deepCopy(textToPmDoc(text)) as Map<String, Object?>;
}

Object? _deepCopy(Object? v) => switch (v) {
  Map() => <String, Object?>{for (final e in v.entries) '${e.key}': _deepCopy(e.value)},
  List() => <Object?>[for (final x in v) _deepCopy(x)],
  _ => v,
};

/// Canonical JSON (sorted keys) for comparing documents.
String canonicalJson(Object? v) => jsonEncode(_canon(v));

Object? _canon(Object? v) => switch (v) {
  Map() => {for (final k in (v.keys.map((k) => '$k').toList()..sort())) k: _canon(v[k])},
  List() => [for (final x in v) _canon(x)],
  _ => v,
};

/// One unit of the editor text.
sealed class RichItem {
  const RichItem();
}

/// A UTF-16 unit of text with its marks (raw mark JSON, unknown marks included).
class RichChar extends RichItem {
  const RichChar(this.ch, this.marks);
  final String ch;
  final List<Map<String, Object?>> marks;
}

/// A hard break (`hardBreak`, shown as `\n` inside a block).
class RichBreak extends RichItem {
  const RichBreak(this.node);
  final Map<String, Object?> node;
}

class _Block {
  _Block(this.node, this.items);
  final Map<String, Object?> node;
  List<RichItem> items;
  String get type => node['type'] as String? ?? '';
}

/// Text blocks of [root] in document order (keeps the items of known nodes; new nodes start empty).
void _walkBlocks(Map<String, Object?> node, Map<Map<String, Object?>, _Block> known, List<_Block> out) {
  final kids = node['content'];
  if (kids is! List) return;
  for (final k in kids) {
    if (k is! Map<String, Object?>) continue;
    if (_isTextblock(k) || known.containsKey(k)) {
      out.add(known[k] ?? _Block(k, RichEditDoc._itemsOf(k)));
    } else {
      _walkBlocks(k, known, out);
    }
  }
}

/// Editable rich text of one object (see library comment). Mutable; [text] is what the text field shows.
class RichEditDoc {
  RichEditDoc._(this._root) {
    _walkBlocks(_root, Map.identity(), _blocks);
  }

  /// Starts from [doc] (a ProseMirror document; copied, the original stays untouched).
  factory RichEditDoc(Map<String, Object?> doc) =>
      RichEditDoc._(_deepCopy(isPmDoc(doc) ? doc : {'type': 'doc', 'content': []}) as Map<String, Object?>);

  /// The rich text of an object (`content`/`text`, [effectivePmDoc]).
  factory RichEditDoc.forObject(Object? content, String text) => RichEditDoc._(effectivePmDoc(content, text));

  final Map<String, Object?> _root;
  final _blocks = <_Block>[];

  static List<RichItem> _itemsOf(Map<String, Object?> block) {
    final out = <RichItem>[];
    for (final n in (block['content'] is List ? block['content'] as List : const [])) {
      if (n is! Map<String, Object?>) continue;
      if (n['type'] == 'hardBreak') {
        out.add(RichBreak(n));
      } else {
        final t = n['text'] is String ? n['text'] as String : '';
        final marks = [
          for (final m in (n['marks'] is List ? n['marks'] as List : const []))
            if (m is Map<String, Object?>) m,
        ];
        for (var i = 0; i < t.length; i++) {
          out.add(RichChar(t[i], marks));
        }
      }
    }
    return out;
  }

  /// The editor text (equals the plain-text mirror of [toJson]).
  String get text {
    final b = StringBuffer();
    for (var i = 0; i < _blocks.length; i++) {
      if (i > 0) b.write('\n');
      for (final it in _blocks[i].items) {
        b.write(it is RichChar ? it.ch : '\n');
      }
    }
    return b.toString();
  }

  /// Blocks with their items, for display (type, attrs, items).
  List<({String type, Map<String, Object?> attrs, List<RichItem> items})> get blocks => [
    for (final b in _blocks)
      (
        type: b.type,
        attrs: b.node['attrs'] is Map<String, Object?> ? b.node['attrs'] as Map<String, Object?> : const {},
        items: b.items,
      ),
  ];

  /// The document as ProseMirror JSON (a fresh copy).
  Map<String, Object?> toJson() {
    for (final b in _blocks) {
      final content = <Object?>[];
      for (final it in b.items) {
        if (it is RichBreak) {
          content.add(it.node);
          continue;
        }
        final c = it as RichChar;
        final last = content.isEmpty ? null : content.last;
        if (last is Map<String, Object?> && last['type'] == 'text' && identical(last['_marks'], c.marks)) {
          last['text'] = '${last['text']}${c.ch}';
        } else if (last is Map<String, Object?> &&
            last['type'] == 'text' &&
            _sameMarks(last['_marks'] as List<Map<String, Object?>>, c.marks)) {
          last['text'] = '${last['text']}${c.ch}';
        } else {
          content.add(<String, Object?>{'type': 'text', 'text': c.ch, '_marks': c.marks});
        }
      }
      for (final n in content) {
        if (n is Map<String, Object?> && n.containsKey('_marks')) {
          final marks = n.remove('_marks') as List<Map<String, Object?>>;
          if (marks.isNotEmpty) n['marks'] = marks;
        }
      }
      if (content.isEmpty) {
        b.node.remove('content');
      } else {
        b.node['content'] = content;
      }
    }
    return _deepCopy(_root) as Map<String, Object?>;
  }

  static bool _sameMarks(List<Map<String, Object?>> a, List<Map<String, Object?>> b) =>
      identical(a, b) || canonicalJson(a) == canonicalJson(b);

  /// Takes the text field's new text: maps the change (common prefix/suffix) onto the blocks. [caret] (offset in
  /// the new text) tells where an ambiguous change happened (typing the same character twice). Returns false if
  /// nothing changed.
  bool setText(String next, {int? caret}) {
    final old = text;
    if (old == next) return false;
    var p = 0;
    final maxP = old.length < next.length ? old.length : next.length;
    while (p < maxP && old.codeUnitAt(p) == next.codeUnitAt(p)) {
      p++;
    }
    var s = 0;
    while (s < old.length - p &&
        s < next.length - p &&
        old.codeUnitAt(old.length - 1 - s) == next.codeUnitAt(next.length - 1 - s)) {
      s++;
    }
    // the caret marks the end of the insertion: prefer the change right before it
    if (caret != null && next.length > old.length) {
      final insEnd = next.length - s;
      if (caret < insEnd && caret >= next.length - old.length) {
        final shift = insEnd - caret;
        if (shift <= p) {
          p -= shift;
          s += shift;
        }
      }
    }
    // never split a surrogate pair
    if (p > 0 && _isHigh(old.codeUnitAt(p - 1))) p--;
    if (s > 0 && old.length - s < old.length && _isLow(old.codeUnitAt(old.length - s))) s--;
    _replace(p, old.length - s, next.substring(p, next.length - s));
    return true;
  }

  static bool _isHigh(int c) => c >= 0xd800 && c <= 0xdbff;
  static bool _isLow(int c) => c >= 0xdc00 && c <= 0xdfff;

  // ---- formatting (E3: format bar for selected text, like the web's FormatBar) -----------------------------------

  /// Text range [from, to) normalized; an empty range means the whole text (the web formats everything then).
  (int, int) _range(int from, int to) {
    final len = text.length;
    var a = from.clamp(0, len), b = to.clamp(0, len);
    if (a > b) (a, b) = (b, a);
    if (a == b) return (0, len);
    return (a, b);
  }

  /// Every character in [from, to) as (block, item index).
  Iterable<(_Block, int)> _charsIn(int from, int to) sync* {
    var start = 0;
    for (final b in _blocks) {
      final end = start + b.items.length;
      if (end > from && start < to) {
        for (var i = math.max(0, from - start); i < math.min(b.items.length, to - start); i++) {
          if (b.items[i] is RichChar) yield (b, i);
        }
      }
      start = end + 1;
    }
  }

  /// Blocks the range [from, to] touches (the block with the caret for an empty range).
  List<_Block> _blocksIn(int from, int to) {
    final out = <_Block>[];
    var start = 0;
    for (final b in _blocks) {
      final end = start + b.items.length;
      if (end >= from && start <= to) out.add(b);
      start = end + 1;
    }
    return out;
  }

  /// All characters in the range carry a mark of [type] (an empty range: the whole text).
  bool hasMark(int from, int to, String type) {
    final (a, b) = _range(from, to);
    var any = false;
    for (final (blk, i) in _charsIn(a, b)) {
      any = true;
      if (!(blk.items[i] as RichChar).marks.any((m) => m['type'] == type)) return false;
    }
    return any;
  }

  /// Value of [attr] of mark [type] if all characters in the range agree (null = none or mixed).
  Object? markAttr(int from, int to, String type, String attr) {
    final (a, b) = _range(from, to);
    Object? value;
    var first = true;
    for (final (blk, i) in _charsIn(a, b)) {
      final m = (blk.items[i] as RichChar).marks.where((m) => m['type'] == type).firstOrNull;
      final v = m?['attrs'] is Map ? (m!['attrs'] as Map)[attr] : null;
      if (first) {
        value = v;
        first = false;
      } else if (v != value) {
        return null;
      }
    }
    return value;
  }

  /// Changes the marks of every character in the range with [change] (gets a copy, returns the new list).
  bool _editMarks(int from, int to, List<Map<String, Object?>> Function(List<Map<String, Object?>> marks) change) {
    final (a, b) = _range(from, to);
    var changed = false;
    // characters with the same marks keep sharing one list (runs stay runs)
    final memo = Map<List<Map<String, Object?>>, List<Map<String, Object?>>>.identity();
    for (final (blk, i) in _charsIn(a, b)) {
      final c = blk.items[i] as RichChar;
      final next = memo[c.marks] ??= change([...c.marks]);
      if (_sameMarks(next, c.marks)) continue;
      blk.items = [...blk.items]..[i] = RichChar(c.ch, next);
      changed = true;
    }
    return changed;
  }

  /// Bold, italic, underline, strike, code: on for the range unless all of it has it already (then off).
  bool toggleMark(int from, int to, String type) {
    final on = !hasMark(from, to, type);
    return _editMarks(from, to, (marks) {
      marks.removeWhere((m) => m['type'] == type);
      if (on) marks.add({'type': type});
      return marks;
    });
  }

  /// Sets attribute [attr] of mark [type] ([value] null removes the attribute; a mark without attributes left goes):
  /// text color = `textStyle.color` (other `textStyle` attributes like `fontSize` stay), highlight = `highlight.color`.
  bool setMarkAttr(int from, int to, String type, String attr, Object? value) => _editMarks(from, to, (marks) {
    final i = marks.indexWhere((m) => m['type'] == type);
    final old = i < 0 ? null : marks[i];
    final attrs = <String, Object?>{...?(old?['attrs'] as Map?)?.cast<String, Object?>()};
    if (value == null) {
      attrs.remove(attr);
    } else {
      attrs[attr] = value;
    }
    final keepEmpty = type == 'highlight' && value != null;
    final next = attrs.isEmpty && !keepEmpty ? null : <String, Object?>{...?old, 'type': type, 'attrs': attrs};
    if (i >= 0) marks.removeAt(i);
    if (next != null) marks.insert(i < 0 ? marks.length : i, next);
    return marks;
  });

  /// Removes mark [type] in the range (highlight off, link off).
  bool removeMark(int from, int to, String type) =>
      _editMarks(from, to, (marks) => marks..removeWhere((m) => m['type'] == type));

  /// Link on the range (input like the web's link field, [normalizeHref]; mark attributes like Tiptap). Returns false
  /// for an unsafe target.
  bool setLink(int from, int to, String href) {
    final h = normalizeHref(href);
    if (h == null) return false;
    _editMarks(from, to, (marks) {
      marks.removeWhere((m) => m['type'] == 'link');
      marks.add({'type': 'link', 'attrs': linkMarkAttrs(h)});
      return marks;
    });
    return true;
  }

  /// Paragraph style of the first block in the range like the web's `blockOf` (FormatBar): `h1`–`h3`, `code`, `quote`
  /// (inside a blockquote) or `p`.
  String blockKind(int from, int to) {
    final blocks = _blocksIn(from, to);
    if (blocks.isEmpty) return 'p';
    final b = blocks.first;
    if (b.type == 'heading') {
      final l = b.node['attrs'] is Map && (b.node['attrs'] as Map)['level'] is num
          ? ((b.node['attrs'] as Map)['level'] as num).toInt()
          : 1;
      if (l >= 1 && l <= 3) return 'h$l';
    }
    if (b.type == 'codeBlock') return 'code';
    if (_quoteOf(b.node) != null) return 'quote';
    return 'p';
  }

  /// Paragraph style for the blocks in the range like the web's `setBlock` (P8, F06): `p`, `h1`–`h6` (the same heading
  /// again = paragraph; a code block becomes a paragraph first, `p` also leaves a quote), `quote` (wrap in / lift out
  /// of a blockquote), `code` (code block on/off; marks go, hard breaks become line breaks). Blocks that start a list
  /// item stay paragraphs (Tiptap's schema).
  bool setBlockKind(int from, int to, String kind) {
    if (kind == 'quote') return _toggleQuote(from, to);
    if (kind == 'code') return _setCode(from, to, blockKind(from, to) != 'code');
    final level = kind.length == 2 && kind.startsWith('h') ? (int.tryParse(kind.substring(1)) ?? 0).clamp(0, 6) : 0;
    final cur = blockKind(from, to);
    var changed = false;
    if (cur == 'code') changed = _setCode(from, to, false);
    if (level == 0 && _blocksIn(from, to).any((b) => _quoteOf(b.node) != null)) {
      changed = _liftQuote(from, to) || changed;
    }
    final toggleOff = level > 0 && cur == kind;
    for (final b in _blocksIn(from, to)) {
      if (b.type != 'paragraph' && b.type != 'heading') continue;
      if (_startsItem(b)) continue;
      final attrs = <String, Object?>{...?(b.node['attrs'] as Map?)?.cast<String, Object?>()};
      if (level == 0 || toggleOff) {
        if (b.type == 'paragraph') continue;
        b.node['type'] = 'paragraph';
        attrs.remove('level');
      } else {
        if (b.type == 'heading' && attrs['level'] == level) continue;
        b.node['type'] = 'heading';
        attrs['level'] = level;
      }
      if (attrs.isEmpty) {
        b.node.remove('attrs');
      } else {
        b.node['attrs'] = attrs;
      }
      changed = true;
    }
    return changed;
  }

  /// First block of a list item (must stay a paragraph).
  bool _startsItem(_Block b) {
    final (parent, index) = _parentOf(b.node);
    final pt = parent?['type'];
    return index == 0 && (pt == 'listItem' || pt == 'taskItem');
  }

  /// Nearest blockquote around [node] (null = none).
  Map<String, Object?>? _quoteOf(Map<String, Object?> node) {
    var n = node;
    for (;;) {
      final (parent, _) = _parentOf(n);
      if (parent == null || identical(parent, _root)) return null;
      if (parent['type'] == 'blockquote') return parent;
      n = parent;
    }
  }

  /// Code block on (paragraphs/headings, not the first block of a list item) or off (back to paragraphs) – Tiptap's
  /// `toggleCodeBlock`.
  bool _setCode(int from, int to, bool on, {String? language}) {
    var changed = false;
    for (final b in _blocksIn(from, to)) {
      if (on) {
        if ((b.type != 'paragraph' && b.type != 'heading') || _startsItem(b)) continue;
        b.node['type'] = 'codeBlock';
        b.node.remove('attrs');
        if (language != null) b.node['attrs'] = <String, Object?>{'language': language};
        // code has no marks; hard breaks are line breaks in the text (ProseMirror `linebreakReplacement`)
        b.items = [for (final it in b.items) it is RichChar ? RichChar(it.ch, const []) : const RichChar('\n', [])];
      } else {
        if (b.type != 'codeBlock') continue;
        b.node['type'] = 'paragraph';
        b.node.remove('attrs');
        b.items = [
          for (final it in b.items)
            if (it is RichChar && it.ch == '\n') RichBreak(<String, Object?>{'type': 'hardBreak'}) else it,
        ];
      }
      changed = true;
    }
    return changed;
  }

  /// Blockquote on (wraps the top-level blocks of the range) or off (lifts the blocks out) – Tiptap's
  /// `toggleBlockquote`.
  bool _toggleQuote(int from, int to) {
    final blocks = _blocksIn(from, to);
    if (blocks.isEmpty) return false;
    if (_quoteOf(blocks.first.node) != null) return _liftQuote(from, to);
    final top = <int>{};
    for (final b in blocks) {
      var n = b.node;
      for (;;) {
        final (parent, index) = _parentOf(n);
        if (parent == null) break;
        if (identical(parent, _root)) {
          top.add(index);
          break;
        }
        n = parent;
      }
    }
    if (top.isEmpty) return false;
    final first = top.reduce(math.min), last = top.reduce(math.max);
    final kids = _root['content'] as List;
    final wrapped = kids.sublist(first, last + 1);
    kids.replaceRange(first, last + 1, [
      <String, Object?>{'type': 'blockquote', 'content': wrapped},
    ]);
    _rewalk();
    return true;
  }

  /// Moves the blocks of the range out of their blockquote (the quote splits around them).
  bool _liftQuote(int from, int to) {
    var changed = false;
    for (final b in _blocksIn(from, to)) {
      final q = _quoteOf(b.node);
      if (q == null) continue;
      // the quote's child that holds the block
      var child = b.node;
      for (;;) {
        final (parent, _) = _parentOf(child);
        if (parent == null || identical(parent, q)) break;
        child = parent;
      }
      final (outer, qi) = _parentOf(q);
      if (outer == null) continue;
      final items = q['content'] as List;
      final ci = items.indexOf(child);
      final before = items.sublist(0, ci), after = items.sublist(ci + 1);
      (outer['content'] as List).replaceRange(qi, qi + 1, [
        if (before.isNotEmpty) <String, Object?>{...q, 'content': before},
        child,
        if (after.isNotEmpty) <String, Object?>{...q, 'content': after},
      ]);
      changed = true;
    }
    if (changed) _rewalk();
    return changed;
  }

  /// Replaces the whole document with [doc] (taken as it is, not copied: [offsetOf] finds its nodes) – pasting HTML
  /// (F16) builds the new tree outside.
  void replaceWith(Map<String, Object?> doc) {
    _root
      ..clear()
      ..addAll(doc);
    _blocks.clear();
    _walkBlocks(_root, Map.identity(), _blocks);
  }

  /// Offset in [text] of position [inner] inside the text block [node] (a node of the tree given to [replaceWith]);
  /// null if it is not a text block of this document.
  int? offsetOf(Map<String, Object?> node, int inner) {
    var start = 0;
    for (final b in _blocks) {
      if (identical(b.node, node)) return start + inner.clamp(0, b.items.length);
      start += b.items.length + 1;
    }
    return null;
  }

  /// Rebuilds the block list after a structural change (blocks keep their items).
  void _rewalk() {
    final known = Map<Map<String, Object?>, _Block>.identity();
    for (final blk in _blocks) {
      known[blk.node] = blk;
    }
    _blocks.clear();
    _walkBlocks(_root, known, _blocks);
  }

  // ---- P8: lines of the editor, indent/outdent, Backspace/Enter at a list item, Markdown shortcuts, links ----------

  /// How each text block is shown (same order as [blocks]): kind, depth, number, check box – like the board's
  /// `RichDoc` (`rich_text.dart`), so the editor shows the same bullets, numbers and boxes as the drawing.
  List<RichLine> get lines {
    final idx = Map<Map<String, Object?>, int>.identity();
    for (var i = 0; i < _blocks.length; i++) {
      idx[_blocks[i].node] = i;
    }
    final out = List<RichLine?>.filled(_blocks.length, null);
    void put(Object? n, RichLine l) {
      final i = n is Map<String, Object?> ? idx[n] : null;
      if (i != null) out[i] = l;
    }

    void walk(Object? content, RichBlockKind? list, int depth, bool quote) {
      if (content is! List) return;
      for (final node in content) {
        if (node is! Map<String, Object?>) continue;
        final attrs = node['attrs'] is Map ? node['attrs'] as Map : const {};
        switch (node['type']) {
          case 'paragraph':
            put(node, RichLine(quote ? RichBlockKind.quote : RichBlockKind.paragraph, depth: depth));
          case 'heading':
            final l = attrs['level'];
            put(node, RichLine(RichBlockKind.heading, depth: depth, level: l is num ? l.toInt().clamp(1, 3) : 1));
          case 'codeBlock':
            put(node, RichLine(RichBlockKind.code, depth: depth));
          case 'horizontalRule':
            break;
          case 'blockquote':
            walk(node['content'], list, depth, true);
          case 'bulletList' || 'orderedList' || 'taskList':
            final kind = switch (node['type']) {
              'bulletList' => RichBlockKind.bullet,
              'orderedList' => RichBlockKind.ordered,
              _ => RichBlockKind.task,
            };
            var n = attrs['start'] is num ? (attrs['start'] as num).toInt() : 1;
            final d = list == null ? depth : depth + 1;
            for (final item in (node['content'] is List ? node['content'] as List : const [])) {
              if (item is! Map) continue;
              final checked = (item['attrs'] is Map ? item['attrs'] as Map : const {})['checked'] == true;
              var first = true;
              for (final child in (item['content'] is List ? item['content'] as List : const [])) {
                if (child is! Map) continue;
                if (child['type'] == 'paragraph' || child['type'] == 'heading') {
                  put(child, RichLine(kind, depth: d, index: n, checked: checked, continuation: !first));
                  first = false;
                } else {
                  walk([child], kind, d, quote);
                }
              }
              n++;
            }
          default:
            if (idx.containsKey(node)) {
              put(node, RichLine(RichBlockKind.paragraph, depth: depth));
            } else {
              walk(node['content'], list, depth, quote);
            }
        }
      }
    }

    walk(_root['content'], null, 0, false);
    return [for (final l in out) l ?? const RichLine(RichBlockKind.paragraph)];
  }

  /// Start offset of block [i] in [text].
  int blockStart(int i) {
    var start = 0;
    for (var k = 0; k < i && k < _blocks.length; k++) {
      start += _blocks[k].items.length + 1;
    }
    return start;
  }

  /// Index of the block that holds text offset [pos].
  int blockAt(int pos) => _blocks.isEmpty ? 0 : _locate(pos).$1;

  /// Is [list] nested in another list item?
  bool _nested(Map<String, Object?> list) {
    final (parent, _) = _parentOf(list);
    return parent != null && (parent['type'] == 'listItem' || parent['type'] == 'taskItem');
  }

  /// List items of the range (in order, each once).
  List<(Map<String, Object?>, Map<String, Object?>)> _itemsIn(int from, int to) {
    final out = <(Map<String, Object?>, Map<String, Object?>)>[];
    for (final b in _blocksIn(from, to)) {
      final l = _listOf(b);
      if (l != null && !out.any((e) => identical(e.$2, l.$2))) out.add(l);
    }
    return out;
  }

  /// Indent the list items of the range one level (Tab, Tiptap `sinkListItem`): they move into a list of the same
  /// kind at the end of the item before them. False if the first one has no item before it.
  bool indent(int from, int to) {
    final items = _itemsIn(from, to);
    if (items.isEmpty) return false;
    final list = items.first.$1;
    final kids = list['content'] as List;
    if (kids.indexOf(items.first.$2) <= 0) return false;
    for (final (l, item) in items) {
      if (!identical(l, list)) continue;
      final k = kids.indexOf(item);
      if (k <= 0) continue;
      final prev = kids[k - 1] as Map<String, Object?>;
      kids.removeAt(k);
      final pc = (prev['content'] ??= <Object?>[]) as List;
      final last = pc.isEmpty ? null : pc.last;
      if (last is Map<String, Object?> && last['type'] == list['type']) {
        (last['content'] as List).add(item);
      } else {
        pc.add(<String, Object?>{
          'type': list['type'],
          'content': <Object?>[item],
        });
      }
    }
    _rewalk();
    return true;
  }

  /// Outdent the list items of the range one level (Umschalt-Tab, Tiptap `liftListItem`): a nested item moves behind
  /// its parent item (the items after it come along as its sub-list); a top-level item becomes a paragraph.
  bool outdent(int from, int to) {
    final items = _itemsIn(from, to);
    if (items.isEmpty) return false;
    for (final (list, item) in items.reversed) {
      if (!_nested(list)) {
        final first = (item['content'] as List?)?.firstOrNull;
        final i = _blocks.indexWhere((b) => identical(b.node, first));
        if (i >= 0) {
          final at = blockStart(i);
          toggleList(at, at, list['type'] as String);
        }
        continue;
      }
      final kids = list['content'] as List;
      final k = kids.indexOf(item);
      if (k < 0) continue;
      final rest = kids.sublist(k + 1);
      kids.removeRange(k, kids.length);
      if (rest.isNotEmpty) {
        final ic = (item['content'] ??= <Object?>[]) as List;
        final last = ic.isEmpty ? null : ic.last;
        if (last is Map<String, Object?> && last['type'] == list['type']) {
          (last['content'] as List).addAll(rest);
        } else {
          ic.add(<String, Object?>{'type': list['type'], 'content': rest});
        }
      }
      final (parentItem, pi) = _parentOf(list);
      if (parentItem == null) continue;
      if (kids.isEmpty) (parentItem['content'] as List).removeAt(pi);
      final (outer, oi) = _parentOf(parentItem);
      if (outer == null) continue;
      // the item takes the kind of the outer list
      final itemType = outer['type'] == 'taskList' ? 'taskItem' : 'listItem';
      if (item['type'] != itemType) {
        item['type'] = itemType;
        if (itemType == 'taskItem') {
          item['attrs'] = <String, Object?>{'checked': false};
        } else {
          item.remove('attrs');
        }
      }
      (outer['content'] as List).insert(oi + 1, item);
    }
    _rewalk();
    return true;
  }

  /// Backspace at the start of a list item or quote line (the editor shows its bullet there): lifts the block out
  /// one level like Tiptap (nested item → outdent, top-level item → paragraph, quote → out of the quote).
  bool liftAt(int pos) {
    if (_blocks.isEmpty) return false;
    final b = _blocks[blockAt(pos)];
    if (_listOf(b) != null) return outdent(pos, pos);
    if (_quoteOf(b.node) != null) return _liftQuote(pos, pos);
    return false;
  }

  /// The block at [pos] is an empty list item (Enter there ends the list, Tiptap `splitListItem`).
  bool isEmptyListItem(int pos) {
    if (_blocks.isEmpty) return false;
    final b = _blocks[blockAt(pos)];
    return b.items.isEmpty && _listOf(b) != null;
  }

  /// Markdown shortcuts while typing (P8, F11; Tiptap's input rules): after [inserted] (`' '`, `'\n'`, `'-'`) at
  /// [caret], the text from the start of a plain paragraph up to the caret becomes `- `/`* `/`+ ` bullet list,
  /// `1. ` numbered list (start number), `[ ] `/`[x] ` checklist, `# `…`###### ` heading, `> ` quote, three backticks
  /// code block (also with a language), `---` rule. Returns the caret afterwards (null = no rule).
  ///
  /// Like Tiptap, the rule runs instead of typing [inserted]: the typed character never lands in the text.
  int? inputRule(int caret, String inserted) {
    if (_blocks.isEmpty || caret < 0) return null;
    final (bi, off) = _locate(caret);
    final b = _blocks[bi];
    if (b.type != 'paragraph') return null;
    final before = StringBuffer();
    for (var k = 0; k < off; k++) {
      final it = b.items[k];
      if (it is! RichChar) return null;
      before.write(it.ch);
    }
    final t = '$before$inserted';
    final start = caret - off;
    final inList = _listOf(b) != null;
    final inQuote = _quoteOf(b.node) != null;
    void clear() => _replace(start, caret, '');
    if (inserted == ' ' && !inList) {
      if (RegExp(r'^\s*([-+*])\s$').hasMatch(t)) {
        clear();
        toggleList(start, start, 'bulletList');
        return start;
      }
      final ol = RegExp(r'^(\d+)\.\s$').firstMatch(t);
      if (ol != null) {
        clear();
        toggleList(start, start, 'orderedList');
        final n = int.tryParse(ol.group(1)!) ?? 1;
        final l = _listOf(_blocks[blockAt(start)]);
        if (l != null && n != 1) {
          l.$1['attrs'] = <String, Object?>{...?(l.$1['attrs'] as Map?)?.cast<String, Object?>(), 'start': n};
        }
        return start;
      }
      final task = RegExp(r'^\s*(\[([( |x])?\])\s$').firstMatch(t);
      if (task != null) {
        clear();
        toggleList(start, start, 'taskList');
        final l = _listOf(_blocks[blockAt(start)]);
        if (l != null) l.$2['attrs'] = <String, Object?>{'checked': task.group(2) == 'x'};
        return start;
      }
      final h = RegExp(r'^(#{1,6})\s$').firstMatch(t);
      if (h != null && !inQuote) {
        clear();
        setBlockKind(start, start, 'h${h.group(1)!.length}');
        return start;
      }
      if (RegExp(r'^\s*>\s$').hasMatch(t) && !inQuote) {
        clear();
        _toggleQuote(start, start);
        return start;
      }
    }
    if (inList || inQuote) return null;
    if (inserted == ' ' || inserted == '\n') {
      final code = RegExp(r'^```([a-z]+)?[\s\n]$').firstMatch(t);
      if (code != null) {
        clear();
        _setCode(start, start, true, language: code.group(1));
        return start;
      }
    }
    if (off == b.items.length && RegExp(r'^(?:---|—-|___\s|\*\*\*\s)$').hasMatch(t)) {
      // the paragraph becomes a rule with an empty paragraph after it (caret there)
      clear();
      final (parent, index) = _parentOf(b.node);
      if (parent == null) return null;
      (parent['content'] as List).insert(index, <String, Object?>{'type': 'horizontalRule'});
      _rewalk();
      return start;
    }
    return null;
  }

  /// Range of the link around [pos] (the character before or at it), null = no link there.
  (int, int)? linkRangeAt(int pos) {
    if (_blocks.isEmpty) return null;
    final (bi, off) = _locate(pos);
    final items = _blocks[bi].items;
    String? hrefAt(int k) {
      if (k < 0 || k >= items.length || items[k] is! RichChar) return null;
      final m = (items[k] as RichChar).marks.where((m) => m['type'] == 'link').firstOrNull;
      final h = m?['attrs'] is Map ? (m!['attrs'] as Map)['href'] : null;
      return h is String ? h : null;
    }

    final k = hrefAt(off - 1) != null ? off - 1 : off;
    final href = hrefAt(k);
    if (href == null) return null;
    var a = k, b = k + 1;
    while (hrefAt(a - 1) == href) {
      a--;
    }
    while (hrefAt(b) == href) {
      b++;
    }
    final s = blockStart(bi);
    return (s + a, s + b);
  }

  /// Inserts [label] as a link to [href] at [pos] (the web's link field without selected text); text typed after it
  /// is no link. Returns the end of the inserted text, null for an unsafe target.
  int? insertLink(int pos, String label, String href) {
    final h = normalizeHref(href);
    final text = label.trim().replaceAll('\n', ' ');
    if (h == null || text.isEmpty) return null;
    _replace(pos, pos, text);
    _editMarks(pos, pos + text.length, (marks) {
      marks.removeWhere((m) => m['type'] == 'link');
      marks.add({'type': 'link', 'attrs': linkMarkAttrs(h)});
      return marks;
    });
    return pos + text.length;
  }

  /// Horizontal rules between the text blocks (document order): `[i]` = rules right before block `i`, the last entry
  /// = rules after the last block. The editor shows them like the board (a line of dashes) without making them text.
  List<int> get ruleGaps {
    final idx = Map<Map<String, Object?>, int>.identity();
    for (var i = 0; i < _blocks.length; i++) {
      idx[_blocks[i].node] = i;
    }
    final gaps = List<int>.filled(_blocks.length + 1, 0);
    var next = 0;
    void walk(Object? n) {
      if (n is! Map<String, Object?>) return;
      if (idx.containsKey(n)) {
        next = idx[n]! + 1;
        return;
      }
      if (n['type'] == 'horizontalRule') {
        gaps[next]++;
        return;
      }
      for (final k in (n['content'] is List ? n['content'] as List : const [])) {
        walk(k);
      }
    }

    for (final k in (_root['content'] is List ? _root['content'] as List : const [])) {
      walk(k);
    }
    return gaps;
  }

  /// Removes horizontal rule number [k] (document order) – Backspace right after it, like ProseMirror.
  bool removeRule(int k) {
    var seen = 0;
    bool walk(Map<String, Object?> parent) {
      final kids = parent['content'];
      if (kids is! List) return false;
      for (var i = 0; i < kids.length; i++) {
        final n = kids[i];
        if (n is! Map<String, Object?>) continue;
        if (n['type'] == 'horizontalRule') {
          if (seen++ == k) {
            kids.removeAt(i);
            return true;
          }
          continue;
        }
        if (walk(n)) return true;
      }
      return false;
    }

    if (!walk(_root)) return false;
    _rewalk();
    return true;
  }

  /// Task item number [index] (document order, like the board's check boxes) done or open again (web `toggleTask`);
  /// false if there is none.
  bool toggleTaskAt(int index) {
    final items = <Map<String, Object?>>[];
    void walk(Object? n) {
      if (n is! Map<String, Object?>) return;
      if (n['type'] == 'taskItem') items.add(n);
      for (final k in (n['content'] is List ? n['content'] as List : const [])) {
        walk(k);
      }
    }

    walk(_root);
    if (index < 0 || index >= items.length) return false;
    final it = items[index];
    it['attrs'] = {
      ...?(it['attrs'] as Map?)?.cast<String, Object?>(),
      'checked': (it['attrs'] as Map?)?['checked'] != true,
    };
    return true;
  }

  /// Does any character carry its own size (`textStyle.fontSize`)?
  bool get hasInlineSize => _blocks.any(
    (b) => b.items.any(
      (it) =>
          it is RichChar &&
          it.marks.any((m) => m['type'] == 'textStyle' && m['attrs'] is Map && (m['attrs'] as Map)['fontSize'] != null),
    ),
  );

  /// List the range is in (`bulletList`, `orderedList`, `taskList`; null = none or mixed).
  String? listKind(int from, int to) {
    String? kind;
    for (final b in _blocksIn(from, to)) {
      final k = _listOf(b)?.$1['type'] as String?;
      if (k == null || (kind != null && k != kind)) return null;
      kind = k;
    }
    return kind;
  }

  /// (list node, list item node) of a block directly in a list item (first child), else null.
  (Map<String, Object?>, Map<String, Object?>)? _listOf(_Block b) {
    final (item, index) = _parentOf(b.node);
    if (item == null || index != 0 || (item['type'] != 'listItem' && item['type'] != 'taskItem')) return null;
    final (list, _) = _parentOf(item);
    if (list == null) return null;
    return (list, item);
  }

  /// Bullet, numbered or task list for the blocks in the range: already this kind → back to paragraphs; another
  /// list → that list becomes this kind; plain blocks → wrapped into one new list (headings become paragraphs).
  bool toggleList(int from, int to, String kind) {
    final itemType = kind == 'taskList' ? 'taskItem' : 'listItem';
    final blocks = _blocksIn(from, to);
    if (blocks.isEmpty) return false;
    final known = Map<Map<String, Object?>, _Block>.identity();
    for (final blk in _blocks) {
      known[blk.node] = blk;
    }
    if (listKind(from, to) == kind) {
      // lift the items out: each list item's content goes where the item was (the list splits around them)
      for (final b in blocks) {
        final l = _listOf(b);
        if (l == null) continue;
        final (list, item) = l;
        final (parent, li) = _parentOf(list);
        if (parent == null) continue;
        final items = list['content'] as List;
        final ii = items.indexOf(item);
        final before = items.sublist(0, ii), after = items.sublist(ii + 1);
        final lifted = [...(item['content'] as List)];
        final kids = parent['content'] as List;
        kids.removeAt(li);
        final insert = <Object?>[
          if (before.isNotEmpty) {...list, 'content': before},
          ...lifted,
          if (after.isNotEmpty) <String, Object?>{...list, 'content': after},
        ];
        kids.insertAll(li, insert);
      }
    } else {
      final lists = <Map<String, Object?>>{};
      final plain = <_Block>[];
      for (final b in blocks) {
        final l = _listOf(b);
        if (l != null) {
          lists.add(l.$1);
        } else {
          plain.add(b);
        }
      }
      for (final list in lists) {
        list['type'] = kind;
        if (kind != 'orderedList') (list['attrs'] as Map?)?.remove('start');
        for (final it in (list['content'] as List)) {
          if (it is! Map<String, Object?>) continue;
          it['type'] = itemType;
          if (itemType == 'taskItem') {
            it['attrs'] = {
              ...?(it['attrs'] as Map?)?.cast<String, Object?>(),
              'checked': (it['attrs'] as Map?)?['checked'] == true,
            };
          } else {
            (it['attrs'] as Map?)?.remove('checked');
            if ((it['attrs'] as Map?)?.isEmpty ?? false) it.remove('attrs');
          }
        }
      }
      // plain blocks with the same parent, one after another, go into one list
      Map<String, Object?>? openList;
      Map<String, Object?>? openParent;
      var lastIndex = -2;
      for (final b in plain) {
        final (parent, index) = _parentOf(b.node);
        if (parent == null) continue;
        if (b.type == 'heading') {
          b.node['type'] = 'paragraph';
          (b.node['attrs'] as Map?)?.remove('level');
          if ((b.node['attrs'] as Map?)?.isEmpty ?? false) b.node.remove('attrs');
        }
        final item = <String, Object?>{
          'type': itemType,
          if (itemType == 'taskItem') 'attrs': <String, Object?>{'checked': false},
          'content': <Object?>[b.node],
        };
        final kids = parent['content'] as List;
        if (openList != null && identical(openParent, parent) && index == lastIndex + 1) {
          kids.removeAt(index);
          (openList['content'] as List).add(item);
          lastIndex = index - 1;
        } else {
          final list = <String, Object?>{
            'type': kind,
            'content': <Object?>[item],
          };
          kids[index] = list;
          openList = list;
          openParent = parent;
          lastIndex = index;
        }
      }
    }
    _blocks.clear();
    _walkBlocks(_root, known, _blocks);
    return true;
  }

  /// Task items in the range: done unless all are done already (then open again). Returns false outside tasks.
  bool toggleTaskDone(int from, int to) {
    final items = [
      for (final b in _blocksIn(from, to))
        if (_listOf(b) case (_, final item) when item['type'] == 'taskItem') item,
    ];
    if (items.isEmpty) return false;
    final done = items.every((i) => (i['attrs'] as Map?)?['checked'] == true);
    for (final i in items) {
      i['attrs'] = {...?(i['attrs'] as Map?)?.cast<String, Object?>(), 'checked': !done};
    }
    return true;
  }

  /// (block, offset) of a position in [text].
  (int, int) _locate(int pos) {
    var start = 0;
    for (var i = 0; i < _blocks.length; i++) {
      final len = _blocks[i].items.length;
      if (pos <= start + len) return (i, pos - start);
      start += len + 1;
    }
    return (_blocks.length - 1, _blocks.isEmpty ? 0 : _blocks.last.items.length);
  }

  /// Replaces text positions [from, to) with [insert].
  void _replace(int from, int to, String insert) {
    if (_blocks.isEmpty) _ensureBlock();
    final (i, a) = _locate(from);
    final (j, b) = _locate(to);
    final bi = _blocks[i], bj = _blocks[j];
    final marks = _marksAt(bi.items, a, bj.items, b);
    final head = bi.items.sublist(0, a);
    final tail = bj.items.sublist(b);
    // a code block keeps typed newlines as text
    final parts = bi.type == 'codeBlock' && i == j ? [insert] : insert.split('\n');
    List<RichItem> chars(String s) => [for (var k = 0; k < s.length; k++) RichChar(s[k], marks)];
    final known = Map<Map<String, Object?>, _Block>.identity();
    for (final blk in _blocks) {
      known[blk.node] = blk;
    }
    if (parts.length == 1 && j > i && a == 0 && b == 0) {
      // whole blocks deleted (with the separator after them): they go, the next block keeps its kind
      bj.items = [...chars(parts.single), ...tail];
      for (final r in _blocks.sublist(i, j)) {
        _detach(r);
        known.remove(r.node);
      }
      _blocks.clear();
      _walkBlocks(_root, known, _blocks);
      return;
    }
    final between = _blocks.sublist(i + 1, j + 1);
    if (parts.length == 1) {
      bi.items = [...head, ...chars(parts.single), ...tail];
      for (final r in between) {
        _detach(r);
        known.remove(r.node);
      }
    } else {
      bi.items = [...head, ...chars(parts.first)];
      final last = parts.last;
      var after = bi;
      for (final m in parts.sublist(1, parts.length - 1)) {
        after = _split(after, chars(m), atEnd: true);
        known[after.node] = after;
      }
      if (j > i) {
        // the last part goes into the block that ended the deletion (keeps its kind); blocks between go away
        bj.items = [...chars(last), ...tail];
        for (final r in between.sublist(0, between.length - 1)) {
          _detach(r);
          known.remove(r.node);
        }
      } else {
        final lb = _split(after, [...chars(last), ...tail], atEnd: tail.isEmpty && last.isEmpty && head.isNotEmpty);
        known[lb.node] = lb;
      }
    }
    _blocks.clear();
    _walkBlocks(_root, known, _blocks);
  }

  /// Marks for inserted text: those of the character before (links end at their end, like the web), else after.
  static List<Map<String, Object?>> _marksAt(List<RichItem> before, int a, List<RichItem> after, int b) {
    if (a > 0 && before[a - 1] is RichChar) {
      return [
        for (final m in (before[a - 1] as RichChar).marks)
          if (m['type'] != 'link') m,
      ];
    }
    if (b < after.length && after[b] is RichChar) {
      return [
        for (final m in (after[b] as RichChar).marks)
          if (m['type'] != 'link') m,
      ];
    }
    return const [];
  }

  /// New block after [block] with [items] (Enter): a list item becomes a new list item, a heading split at its end
  /// continues as paragraph, everything else keeps its kind.
  _Block _split(_Block block, List<RichItem> items, {required bool atEnd}) {
    final (parent, index) = _parentOf(block.node);
    if (parent == null) return _Block(block.node, items);
    final pType = parent['type'];
    if ((pType == 'listItem' || pType == 'taskItem') && index == 0) {
      final (list, li) = _parentOf(parent);
      if (list != null) {
        final para = <String, Object?>{'type': 'paragraph'};
        final item = <String, Object?>{
          'type': pType,
          if (pType == 'taskItem') 'attrs': <String, Object?>{'checked': false},
          if (pType == 'listItem' && parent['attrs'] is Map) 'attrs': _deepCopy(parent['attrs']),
          'content': <Object?>[para],
        };
        (list['content'] as List).insert(li + 1, item);
        return _Block(para, items);
      }
    }
    final type = block.type == 'heading' && atEnd ? 'paragraph' : block.type;
    final node = <String, Object?>{
      'type': type,
      if (type == block.type && block.node['attrs'] is Map) 'attrs': _deepCopy(block.node['attrs']),
    };
    (parent['content'] as List).insert(index + 1, node);
    return _Block(node, items);
  }

  /// Removes a block's node; containers left empty go too, a list item that no longer starts with text gets an
  /// empty paragraph (Tiptap's schema).
  void _detach(_Block block) {
    var node = block.node;
    for (;;) {
      final (parent, index) = _parentOf(node);
      if (parent == null) return;
      (parent['content'] as List).removeAt(index);
      final rest = parent['content'] as List;
      if (identical(parent, _root)) return;
      if (rest.isEmpty) {
        node = parent;
        continue;
      }
      if ((parent['type'] == 'listItem' || parent['type'] == 'taskItem') &&
          !(rest.first is Map && _isTextblock(rest.first as Map))) {
        rest.insert(0, <String, Object?>{'type': 'paragraph'});
      }
      return;
    }
  }

  void _ensureBlock() {
    final para = <String, Object?>{'type': 'paragraph'};
    ((_root['content'] ??= <Object?>[]) as List).add(para);
    _blocks.add(_Block(para, []));
  }

  /// Parent node of [node] and its index there (null if not found).
  (Map<String, Object?>?, int) _parentOf(Map<String, Object?> node) {
    (Map<String, Object?>?, int)? find(Map<String, Object?> at) {
      final kids = at['content'];
      if (kids is! List) return null;
      for (var i = 0; i < kids.length; i++) {
        if (identical(kids[i], node)) return (at, i);
        final k = kids[i];
        if (k is Map<String, Object?>) {
          final r = find(k);
          if (r != null) return r;
        }
      }
      return null;
    }

    return find(_root) ?? (null, -1);
  }
}

/// Where a caret at [offset] in [oldText] ends up in [newText] (a remote change replaced the editor's content).
int mapCaret(String oldText, String newText, int offset) {
  var p = 0;
  final maxP = oldText.length < newText.length ? oldText.length : newText.length;
  while (p < maxP && oldText.codeUnitAt(p) == newText.codeUnitAt(p)) {
    p++;
  }
  var s = 0;
  while (s < oldText.length - p &&
      s < newText.length - p &&
      oldText.codeUnitAt(oldText.length - 1 - s) == newText.codeUnitAt(newText.length - 1 - s)) {
    s++;
  }
  if (offset <= p) return offset;
  if (offset >= oldText.length - s) return (offset + newText.length - oldText.length).clamp(0, newText.length);
  return newText.length - s;
}
