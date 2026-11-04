/// Rich text of sticky/text/shape/connector label: the ProseMirror JSON (`{type: 'doc', content: […]}`) the native
/// API sends for the `content` Y.XmlFragment (contract §4 „Rich-Text“, Tiptap StarterKit names). Read-only model:
/// a flat list of blocks (paragraph-like lines) with styled runs. Unknown nodes/marks are skipped, their text kept.
library;

/// Inline marks of a run.
class RichMarks {
  const RichMarks({
    this.bold = false,
    this.italic = false,
    this.strike = false,
    this.underline = false,
    this.code = false,
    this.link,
    this.highlight,
    this.color,
    this.fontSize,
    this.fontScale,
  });

  final bool bold;
  final bool italic;
  final bool strike;
  final bool underline;
  final bool code;

  /// `href` of a link mark.
  final String? link;

  /// Background color of a highlight mark (`#rrggbb`; empty string = default yellow).
  final String? highlight;

  /// Text color (`textStyle.color`).
  final String? color;

  /// Absolute font size (`textStyle.fontSize`, e.g. `"24px"`, `"18pt"` or 24).
  final double? fontSize;

  /// Size relative to the surrounding text (`textStyle.fontSize` in `em` or `%`: the web's part size, P8 F08).
  final double? fontScale;

  static const none = RichMarks();

  static RichMarks fromJson(Object? marks) {
    if (marks is! List) return none;
    var bold = false, italic = false, strike = false, underline = false, code = false;
    String? link, highlight, color;
    double? fontSize, fontScale;
    for (final m in marks) {
      if (m is! Map) continue;
      final attrs = m['attrs'] is Map ? m['attrs'] as Map : const {};
      switch (m['type']) {
        case 'bold':
          bold = true;
        case 'italic':
          italic = true;
        case 'strike':
          strike = true;
        case 'underline':
          underline = true;
        case 'code':
          code = true;
        case 'link':
          link = attrs['href'] is String ? attrs['href'] as String : '';
        case 'highlight':
          highlight = attrs['color'] is String ? attrs['color'] as String : '';
        case 'textStyle':
          if (attrs['color'] is String) color = attrs['color'] as String;
          final fs = attrs['fontSize'];
          if (fs is num && fs > 0) {
            fontSize = fs.toDouble();
          } else if (fs is String) {
            // like the web's `cssSize`: em/% relative, px/pt/rem absolute
            final m = RegExp(r'^\s*(\d+(?:\.\d+)?)\s*(px|pt|em|rem|%)?\s*$', caseSensitive: false).firstMatch(fs);
            final n = m == null ? null : double.tryParse(m.group(1)!);
            if (n != null && n > 0) {
              switch (m!.group(2)?.toLowerCase()) {
                case 'em':
                  fontScale = n;
                case '%':
                  fontScale = n / 100;
                case 'pt':
                  fontSize = n * 4 / 3;
                case 'rem':
                  fontSize = n * 16;
                default:
                  fontSize = n;
              }
            }
          }
      }
    }
    return RichMarks(
      bold: bold,
      italic: italic,
      strike: strike,
      underline: underline,
      code: code,
      link: link,
      highlight: highlight,
      color: color,
      fontSize: fontSize,
      fontScale: fontScale,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is RichMarks &&
      other.bold == bold &&
      other.italic == italic &&
      other.strike == strike &&
      other.underline == underline &&
      other.code == code &&
      other.link == link &&
      other.highlight == highlight &&
      other.color == color &&
      other.fontSize == fontSize &&
      other.fontScale == fontScale;

  @override
  int get hashCode => Object.hash(bold, italic, strike, underline, code, link, highlight, color, fontSize, fontScale);
}

/// A piece of text with one set of marks (`\n` = hard break).
class RichRun {
  const RichRun(this.text, [this.marks = RichMarks.none]);
  final String text;
  final RichMarks marks;
}

/// Kind of a block line.
/// `rule` = horizontal rule (no text, not part of the plain text mirror).
enum RichBlockKind { paragraph, heading, bullet, ordered, task, quote, code, rule }

/// One line-level block: a paragraph, heading, list item paragraph, quote line or code block.
class RichBlock {
  const RichBlock({
    required this.kind,
    required this.runs,
    this.level = 0,
    this.depth = 0,
    this.index = 0,
    this.checked = false,
    this.continuation = false,
  });

  final RichBlockKind kind;
  final List<RichRun> runs;

  /// Heading level 1–3.
  final int level;

  /// List nesting depth (0 = top level), quotes count as one level.
  final int depth;

  /// Number of an ordered list item (1-based).
  final int index;

  /// Task item done.
  final bool checked;

  /// Second+ paragraph of the same list item (no bullet).
  final bool continuation;

  String get plainText => runs.map((r) => r.text).join();
}

/// A parsed rich text document.
class RichDoc {
  const RichDoc(this.blocks);

  final List<RichBlock> blocks;

  /// Plain text like the web's `text` mirror: blocks/list items separated by `\n`.
  String get plainText => blocks.where((b) => b.kind != RichBlockKind.rule).map((b) => b.plainText).join('\n');

  bool get isEmpty => blocks.every((b) => b.plainText.isEmpty);

  /// Null if [json] is no ProseMirror doc (e.g. an XML string of a client without the rich text module).
  static RichDoc? fromJson(Object? json) {
    if (json is! Map || json['type'] != 'doc') return null;
    final out = <RichBlock>[];
    _blocks(json['content'], out, const _Ctx());
    return RichDoc(out);
  }

  /// Plain text in paragraphs (one per line) — the migration the web does when a note has only `text`.
  factory RichDoc.plain(String text) => RichDoc([
    for (final line in text.split('\n')) RichBlock(kind: RichBlockKind.paragraph, runs: [RichRun(line)]),
  ]);
}

class _Ctx {
  const _Ctx({this.list, this.depth = 0, this.quote = false});
  final RichBlockKind? list;
  final int depth;
  final bool quote;
}

void _blocks(Object? content, List<RichBlock> out, _Ctx ctx) {
  if (content is! List) return;
  for (final node in content) {
    if (node is! Map) continue;
    final type = node['type'];
    final attrs = node['attrs'] is Map ? node['attrs'] as Map : const {};
    switch (type) {
      case 'paragraph':
        out.add(
          RichBlock(
            kind: ctx.quote ? RichBlockKind.quote : RichBlockKind.paragraph,
            runs: _inline(node['content']),
            depth: ctx.depth,
          ),
        );
      case 'heading':
        final l = attrs['level'];
        out.add(
          RichBlock(
            kind: RichBlockKind.heading,
            runs: _inline(node['content']),
            level: l is num ? l.toInt().clamp(1, 3) : 1,
            depth: ctx.depth,
          ),
        );
      case 'horizontalRule':
        out.add(RichBlock(kind: RichBlockKind.rule, runs: const [], depth: ctx.depth));
      case 'codeBlock':
        out.add(RichBlock(kind: RichBlockKind.code, runs: _inline(node['content']), depth: ctx.depth));
      case 'blockquote':
        _blocks(node['content'], out, _Ctx(list: ctx.list, depth: ctx.depth, quote: true));
      case 'bulletList' || 'orderedList' || 'taskList':
        final kind = switch (type) {
          'bulletList' => RichBlockKind.bullet,
          'orderedList' => RichBlockKind.ordered,
          _ => RichBlockKind.task,
        };
        final start = attrs['start'] is num ? (attrs['start'] as num).toInt() : 1;
        final items = node['content'];
        if (items is! List) continue;
        var n = start;
        final depth = ctx.list == null ? ctx.depth : ctx.depth + 1;
        for (final item in items) {
          if (item is! Map) continue;
          final itemAttrs = item['attrs'] is Map ? item['attrs'] as Map : const {};
          final checked = itemAttrs['checked'] == true;
          final children = item['content'] is List ? item['content'] as List : const [];
          var first = true;
          for (final child in children) {
            if (child is! Map) continue;
            if (child['type'] == 'paragraph' || child['type'] == 'heading') {
              out.add(
                RichBlock(
                  kind: kind,
                  runs: _inline(child['content']),
                  depth: depth,
                  index: n,
                  checked: checked,
                  continuation: !first,
                ),
              );
              first = false;
            } else {
              _blocks([child], out, _Ctx(list: kind, depth: depth, quote: ctx.quote));
            }
          }
          if (first) {
            out.add(RichBlock(kind: kind, runs: const [], depth: depth, index: n, checked: checked));
          }
          n++;
        }
      default:
        // Unknown block: keep its text (inline or nested blocks).
        final c = node['content'];
        if (c is List && c.isNotEmpty && c.first is Map && (c.first as Map)['type'] == 'text') {
          out.add(RichBlock(kind: RichBlockKind.paragraph, runs: _inline(c), depth: ctx.depth));
        } else if (node['text'] is String) {
          out.add(RichBlock(kind: RichBlockKind.paragraph, runs: [RichRun(node['text'] as String)], depth: ctx.depth));
        } else {
          _blocks(c, out, ctx);
        }
    }
  }
}

List<RichRun> _inline(Object? content) {
  if (content is! List) return const [];
  final runs = <RichRun>[];
  for (final n in content) {
    if (n is! Map) continue;
    if (n['type'] == 'text' && n['text'] is String) {
      runs.add(RichRun(n['text'] as String, RichMarks.fromJson(n['marks'])));
    } else if (n['type'] == 'hardBreak') {
      runs.add(const RichRun('\n'));
    } else if (n['text'] is String) {
      runs.add(RichRun(n['text'] as String));
    } else if (n['content'] is List) {
      runs.addAll(_inline(n['content']));
    }
  }
  return runs;
}
