import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../features/clipboard/clipboard.dart';
import '../features/richtext/paste_html.dart';
import '../model/board_object.dart';
import '../model/rich_edit.dart';
import '../mindmap/mind_model.dart';
import '../mindmap/mind_render.dart';
import '../model/rich_text.dart';
import '../render/object_renderers.dart';
import '../render/paint_utils.dart';
import '../render/text_layout.dart';
import 'board_editor.dart';
import 'camera.dart';

/// One line of the text field: a text block of the document (with the prefix the board draws in front of it –
/// bullet, number, check box, quote bar, indentation) or a horizontal rule (shown, not editable).
class _Line {
  _Line({
    required this.start,
    required this.prefix,
    required this.docStart,
    required this.len,
    this.line,
    this.rule = -1,
  });

  /// Display offset where the line (its prefix) starts.
  final int start;
  final String prefix;

  /// Offset of the block in the document text (a rule: of the block after it).
  final int docStart;

  /// Characters of the block (a rule: 0).
  final int len;
  final RichLine? line;

  /// Number of the rule in document order (-1 = a text block).
  final int rule;

  int get contentStart => start + prefix.length;
  int get end => contentStart + len;
  bool get isRule => rule >= 0;
}

/// Prefix of a line like the board draws it (`richTextSpan` in `text_layout.dart`); [icon] = the check box glyph.
String linePrefix(RichLine l) {
  final indent = ' ' * l.depth; // em spaces like the board
  if (l.continuation) return '$indent ';
  return switch (l.kind) {
    RichBlockKind.bullet => '$indent• ',
    RichBlockKind.ordered => '$indent${l.index}. ',
    RichBlockKind.task =>
      '$indent${String.fromCharCode((l.checked ? Icons.check_box : Icons.check_box_outline_blank).codePoint)} ',
    RichBlockKind.quote => '$indent▎ ',
    _ => indent,
  };
}

/// The line of dashes of a horizontal rule (like the board).
const _ruleText = '——————';

/// Text field controller over a [RichEditDoc]: shows the formatting (marks, headings, code, quotes) of the rich text
/// and – like the board and the web's editor – bullets, numbers and check boxes in front of list items (P8, F04).
/// Those prefixes are part of the field's text but never of the document: offsets are mapped, the caret never
/// stands inside a prefix, Backspace at the start of a list item lifts it (Tiptap), Enter in an empty item ends the
/// list, and Markdown shortcuts (`- `, `1. `, `[ ] `, `# `, `> `, three backticks, `---`) turn the line into a list,
/// heading, quote, code block or rule (F11). Every text change goes to [onChanged] (document text, caret),
/// structure changes go through [onFormat] (the editor sends them like typing).
class RichTextEditingController extends TextEditingController {
  RichTextEditingController(
    this.doc, {
    required this.fonts,
    this.onChanged,
    this.onSelection,
    this.onFormat,
    this.rich = true,
  }) {
    _layout();
    super.value = TextEditingValue(text: _text);
  }

  RichEditDoc doc;
  final BoardFonts fonts;

  /// The document text changed (caret = offset in the document text).
  final void Function(String text, int? caret)? onChanged;

  /// The selection changed (start ≤ end, offsets in the document text): the format bar works on it.
  final void Function(int start, int end)? onSelection;

  /// A change of the structure without new text (lift a list item, Markdown shortcut): runs [change] on the edited
  /// document like the format bar does; returns whether something changed.
  final bool Function(bool Function(RichEditDoc doc) change)? onFormat;

  /// Rich text (false: a mind node's plain text – no prefixes, no shortcuts).
  final bool rich;

  final _lines = <_Line>[];
  String _text = '';
  bool _busy = false;

  /// Lines as shown (prefix + block text, rules), rebuilt after every change of the document.
  void _layout() {
    _lines.clear();
    final b = StringBuffer();
    final blocks = doc.blocks;
    final lines = rich ? doc.lines : const <RichLine>[];
    final gaps = rich ? doc.ruleGaps : List<int>.filled(blocks.length + 1, 0);
    var docAt = 0, rule = 0;
    void add(_Line l, String content) {
      if (_lines.isNotEmpty) b.write('\n');
      _lines.add(l);
      b
        ..write(l.prefix)
        ..write(content);
    }

    void rules(int n, int docStart) {
      for (var k = 0; k < n; k++) {
        add(
          _Line(
            start: b.length + (_lines.isEmpty ? 0 : 1),
            prefix: _ruleText,
            docStart: docStart,
            len: 0,
            rule: rule++,
          ),
          '',
        );
      }
    }

    for (var i = 0; i < blocks.length; i++) {
      rules(gaps[i], docAt);
      final items = blocks[i].items;
      final content = StringBuffer();
      for (final it in items) {
        content.write(it is RichChar ? it.ch : '\n');
      }
      final prefix = rich && i < lines.length ? linePrefix(lines[i]) : '';
      add(
        _Line(
          start: b.length + (_lines.isEmpty ? 0 : 1),
          prefix: prefix,
          docStart: docAt,
          len: items.length,
          line: rich && i < lines.length ? lines[i] : null,
        ),
        content.toString(),
      );
      docAt += items.length + 1;
    }
    rules(gaps.isEmpty ? 0 : gaps.last, doc.text.length);
    if (_lines.isEmpty) _lines.add(_Line(start: 0, prefix: '', docStart: 0, len: 0));
    _text = b.toString();
  }

  /// Line that holds display offset [d] (the line whose span [start, end] contains it).
  int _lineAt(int d) {
    for (var i = 0; i < _lines.length; i++) {
      if (d <= _lines[i].end) return i;
    }
    return _lines.length - 1;
  }

  /// Display offset of document offset [o].
  int toDisplay(int o) {
    for (final l in _lines) {
      if (l.isRule) continue;
      if (o <= l.docStart + l.len) return l.contentStart + (o - l.docStart).clamp(0, l.len);
    }
    final last = _lines.lastWhere((l) => !l.isRule, orElse: () => _lines.last);
    return last.end;
  }

  /// Document offset of display offset [d] (inside a prefix: the start of the line's text; on a rule: the start of
  /// the block after it).
  int toDoc(int d) {
    final l = _lines[_lineAt(d)];
    if (l.isRule) return l.docStart;
    return l.docStart + (d - l.contentStart).clamp(0, l.len);
  }

  /// [d] moved out of a prefix or rule (the caret stands only in text).
  int _clamp(int d) {
    final i = _lineAt(d);
    final l = _lines[i];
    if (!l.isRule) return d < l.contentStart ? l.contentStart : d;
    // a rule: to the text after it, else before it
    for (var k = i + 1; k < _lines.length; k++) {
      if (!_lines[k].isRule) return _lines[k].contentStart;
    }
    for (var k = i - 1; k >= 0; k--) {
      if (!_lines[k].isRule) return _lines[k].end;
    }
    return 0;
  }

  TextSelection _clampSel(TextSelection s) {
    if (!s.isValid) return s;
    final b = _clamp(s.baseOffset.clamp(0, _text.length)), e = _clamp(s.extentOffset.clamp(0, _text.length));
    return b == s.baseOffset && e == s.extentOffset ? s : s.copyWith(baseOffset: b, extentOffset: e);
  }

  /// Selection in document offsets (start ≤ end).
  ({int start, int end}) get docSelection {
    final s = selection;
    if (!s.isValid) return (start: doc.text.length, end: doc.text.length);
    return (start: toDoc(s.start), end: toDoc(s.end));
  }

  /// Sets the caret to document offset [o].
  void setDocCaret(int o) {
    super.value = TextEditingValue(
      text: _text,
      selection: TextSelection.collapsed(offset: toDisplay(o)),
    );
  }

  @override
  set value(TextEditingValue v) {
    if (_busy) {
      super.value = v;
      return;
    }
    final old = super.value.text;
    if (v.text == old) {
      final s = _clampSel(v.selection);
      super.value = s == v.selection ? v : v.copyWith(selection: s);
      _reportSelection();
      return;
    }
    if (old != _text) {
      // nothing mapped yet (first value): take it as plain text
      super.value = v;
      return;
    }
    _busy = true;
    try {
      _edit(old, v);
    } finally {
      _busy = false;
    }
    _reportSelection();
  }

  void _reportSelection() {
    final s = selection;
    if (s.isValid) onSelection?.call(toDoc(s.start), toDoc(s.end));
  }

  /// Maps a change of the field's text onto the document.
  void _edit(String old, TextEditingValue v) {
    final next = v.text;
    // common prefix/suffix; the caret marks the end of an insertion (typing the same character twice)
    var p = 0;
    final maxP = math.min(old.length, next.length);
    while (p < maxP && old.codeUnitAt(p) == next.codeUnitAt(p)) {
      p++;
    }
    var s = 0;
    while (s < old.length - p &&
        s < next.length - p &&
        old.codeUnitAt(old.length - 1 - s) == next.codeUnitAt(next.length - 1 - s)) {
      s++;
    }
    final caret = v.selection.isValid ? v.selection.extentOffset : null;
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
    final delA = p, delB = old.length - s;
    // pasted text from Windows programs (Excel, Word): line ends like the web's `transformPastedText` (F16)
    final ins = next.substring(p, next.length - s).replaceAll(RegExp(r'\r\n?'), '\n');
    final docText = doc.text;

    void place(int docCaret, {TextEditingValue? typed}) {
      _layout();
      if (typed != null && typed.text == _text) {
        super.value = typed.copyWith(selection: _clampSel(typed.selection));
      } else {
        super.value = TextEditingValue(
          text: _text,
          selection: TextSelection.collapsed(offset: toDisplay(docCaret)),
        );
      }
    }

    bool format(bool Function(RichEditDoc d) change) => rich && onFormat != null && onFormat!(change);

    // Backspace onto a prefix or a rule
    if (ins.isEmpty && delB - delA == 1 && rich) {
      final i = _lineAt(delA);
      final l = _lines[i];
      final atSeparator = delA == l.end && i + 1 < _lines.length;
      if (!l.isRule && delA >= l.start && delA < l.contentStart) {
        // the bullet/number/box: lift the item (list/quote), else join with the line before
        final ln = l.line;
        if (ln != null && !ln.continuation && (ln.isList || ln.kind == RichBlockKind.quote)) {
          format((d) => d.liftAt(l.docStart));
          return place(l.docStart);
        }
        if (l.docStart > 0) {
          onChanged?.call(docText.substring(0, l.docStart - 1) + docText.substring(l.docStart), l.docStart - 1);
          return place(l.docStart - 1);
        }
        return place(l.docStart);
      }
      if (l.isRule || (atSeparator && _lines[i + 1].isRule)) {
        final r = l.isRule ? l : _lines[i + 1];
        format((d) => d.removeRule(r.rule));
        return place(l.isRule ? l.docStart : l.docStart + l.len);
      }
    }
    final docFrom = toDoc(delA);
    final docTo = math.max(docFrom, toDoc(delB));
    // Enter in an empty list item ends the list there; a Markdown shortcut replaces the typed character
    if (rich && delA == delB && ins.length == 1) {
      final l = _lines[_lineAt(delA)];
      if (ins == '\n' && !l.isRule && l.len == 0 && (l.line?.isList ?? false)) {
        format((d) => d.liftAt(l.docStart));
        return place(l.docStart);
      }
      int? ruleCaret;
      if (format((d) => (ruleCaret = d.inputRule(docFrom, ins)) != null)) return place(ruleCaret ?? docFrom);
    }
    if (docFrom == docTo && ins.isEmpty) return place(docFrom);
    final newDoc = docText.substring(0, docFrom) + ins + docText.substring(docTo);
    final docCaret = docFrom + ins.length;
    onChanged?.call(newDoc, docCaret);
    place(docCaret, typed: ins.length == next.length - s - p ? v : null);
  }

  /// Takes a document from outside (merged server state, format bar); the caret stays where it was relative to the
  /// text.
  void replaceDoc(RichEditDoc next) {
    if (_busy) {
      doc = next;
      return;
    }
    final old = _text;
    final sel = selection;
    doc = next;
    _layout();
    final t = _text;
    final base = sel.isValid ? mapCaret(old, t, sel.baseOffset) : t.length;
    final ext = sel.isValid ? mapCaret(old, t, sel.extentOffset) : t.length;
    super.value = TextEditingValue(
      text: t,
      selection: _clampSel(TextSelection(baseOffset: base, extentOffset: ext)),
    );
  }

  @override
  TextSpan buildTextSpan({required BuildContext context, TextStyle? style, required bool withComposing}) {
    final base = style ?? const TextStyle();
    final fs = base.fontSize ?? 16;
    // the field's text and the document agree except while the platform is still composing
    if (_text != text) return TextSpan(style: base, text: text);
    final children = <InlineSpan>[];
    final blocks = doc.blocks;
    var bi = 0;
    for (var i = 0; i < _lines.length; i++) {
      final l = _lines[i];
      if (i > 0) children.add(TextSpan(text: '\n', style: base));
      if (l.isRule) {
        children.add(
          TextSpan(
            text: l.prefix,
            style: base.copyWith(color: const Color(0x55000000)),
          ),
        );
        continue;
      }
      if (bi >= blocks.length) continue; // empty document: one empty line
      final b = blocks[bi++];
      final ln = l.line;
      var s = base;
      final kind =
          ln?.kind ??
          (b.type == 'heading'
              ? RichBlockKind.heading
              : (b.type == 'codeBlock' ? RichBlockKind.code : RichBlockKind.paragraph));
      switch (kind) {
        case RichBlockKind.heading:
          final level = ln?.level ?? (b.attrs['level'] is num ? (b.attrs['level'] as num).toInt() : 1).clamp(1, 3);
          s = base.copyWith(fontSize: fs * const [1.6, 1.35, 1.15][level.clamp(1, 3) - 1], fontWeight: FontWeight.w700);
        case RichBlockKind.quote:
          s = base.copyWith(color: BoardColors.muted, fontStyle: FontStyle.italic);
        case RichBlockKind.code:
          s = base.copyWith(fontFamily: fonts.mono, fontSize: fs * 0.9, backgroundColor: const Color(0x14000000));
        default:
          break;
      }
      if (l.prefix.isNotEmpty) {
        if (ln != null && ln.kind == RichBlockKind.task && !ln.continuation) {
          final indent = l.prefix.substring(0, l.prefix.length - 2);
          if (indent.isNotEmpty) children.add(TextSpan(text: indent, style: s));
          children.add(
            TextSpan(
              text: l.prefix.substring(l.prefix.length - 2, l.prefix.length - 1),
              style: s.copyWith(fontFamily: fonts.icons, fontWeight: FontWeight.w400, decoration: TextDecoration.none),
            ),
          );
          children.add(TextSpan(text: ' ', style: s));
        } else {
          children.add(TextSpan(text: l.prefix, style: s));
        }
      }
      // done tasks: struck through and muted like the board
      if (ln != null && ln.kind == RichBlockKind.task && ln.checked) {
        s = s.copyWith(decoration: TextDecoration.lineThrough, color: BoardColors.muted);
      }
      final run = StringBuffer();
      List<Map<String, Object?>>? marks;
      void flush() {
        if (run.isEmpty) return;
        children.add(
          TextSpan(text: run.toString(), style: marks == null ? s : markedStyle(s, RichMarks.fromJson(marks), fonts)),
        );
        run.clear();
      }

      for (final it in b.items) {
        if (it is RichBreak) {
          flush();
          marks = null;
          children.add(TextSpan(text: '\n', style: s));
          continue;
        }
        final c = it as RichChar;
        if (!identical(c.marks, marks)) {
          flush();
          marks = c.marks;
        }
        run.write(c.ch);
      }
      flush();
    }
    return TextSpan(style: base, children: children);
  }
}

/// The text field over an object while its text is edited: same box, font size, alignment and color as the
/// drawing (the painter leaves the text out), follows camera and rotation. Changes go to [editor]
/// ([BoardEditor.textChanged]); text from outside (merged server state) is taken over when [BoardEditor.docVersion]
/// changes.
class BoardTextEditor extends StatefulWidget {
  const BoardTextEditor({super.key, required this.editor, required this.camera, required this.ctx, this.onSize});

  final BoardEditor editor;
  final CameraController camera;
  final RenderContext ctx;

  /// Laid-out size of the text (world units), for text objects that follow their content.
  final ValueChanged<Size>? onSize;

  @override
  State<BoardTextEditor> createState() => BoardTextEditorState();
}

class BoardTextEditorState extends State<BoardTextEditor> {
  late RichTextEditingController _text;
  final _focus = FocusNode();
  late int _version;
  String? _id;

  BoardEditor get _e => widget.editor;

  @override
  void initState() {
    super.initState();
    _id = _e.editingId;
    _version = _e.docVersion;
    _text = _newController();
    _e.addListener(_editorChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focus.requestFocus();
    });
  }

  RichTextEditingController _newController() {
    final c = RichTextEditingController(
      _e.editingDoc ?? RichEditDoc.forObject(null, ''),
      fonts: widget.ctx.fonts,
      rich: _e.controller.state[_e.editingId ?? '']?.type != 'mindnode',
      onChanged: (t, caret) => _e.textChanged(t, caret: caret),
      onSelection: (a, b) => _e.textRange = (start: a, end: b),
      onFormat: (change) => _e.formatText((d, a, b) => change(d)),
    );
    c.selection = TextSelection.collapsed(offset: c.text.length);
    return c;
  }

  void _editorChanged() {
    if (!mounted) return;
    if (_e.editingId != _id) {
      _id = _e.editingId;
      _version = _e.docVersion;
      _text.dispose();
      _text = _newController();
      setState(() {});
      return;
    }
    if (_e.docVersion != _version && _e.editingDoc != null) {
      _version = _e.docVersion;
      _text.replaceDoc(_e.editingDoc!);
    }
    setState(() {});
  }

  /// Size of the edited text as laid out (world units).
  Size measure(BoardObject o, EditTextBox box) {
    final tp = TextPainter(
      text: _text.buildTextSpan(context: context, style: _style(o, box), withComposing: false),
      textDirection: TextDirection.ltr,
      textAlign: box.align,
    )..layout(maxWidth: o.autoWidth ? double.infinity : math.max(1, box.box.width));
    final s = Size(tp.width + 2, tp.height);
    tp.dispose();
    return s;
  }

  TextStyle _style(BoardObject o, EditTextBox box) => o.type == 'mindnode'
      ? mindTextStyle(o, widget.ctx, color: box.color)
      : TextStyle(
          fontFamily: widget.ctx.fonts.family(o.fontFamily),
          fontSize: box.fontSize,
          height: boardLineHeight,
          color: box.color,
          fontWeight: FontWeight.values[((o.bold ? 700 : box.weight) ~/ 100 - 1).clamp(0, 8)],
          fontStyle: o.italic ? FontStyle.italic : FontStyle.normal,
          decoration: o.strike ? TextDecoration.lineThrough : TextDecoration.none,
        );

  /// „Einfügen“ while writing (F16): HTML from the clipboard (Android, [BoardClipboard.readHtml]) is cleaned and
  /// inserted like the web's editor does ([pasteHtmlInto]); without HTML (iOS, plain text, mind node) the field pastes
  /// the plain text as before.
  Future<void> paste([EditableTextState? state, SelectionChangedCause cause = SelectionChangedCause.keyboard]) async {
    final read = BoardClipboard.readHtml;
    String? html;
    if (read != null && _text.rich) {
      try {
        html = await read();
      } catch (_) {}
    }
    if (!mounted) return;
    final editable = state ?? _focus.context?.findAncestorStateOfType<EditableTextState>();
    if (html != null && html.trim().isNotEmpty) {
      final type = _e.controller.state[_e.editingId ?? '']?.type;
      int? caret;
      final ok = _e.formatText((d, a, b) {
        caret = pasteHtmlInto(d, a, b, html!, sizes: type == 'text' || type == 'shape');
        return caret != null;
      });
      if (ok && caret != null) {
        _text.setDocCaret(caret!);
        editable?.hideToolbar();
        return;
      }
    }
    editable?.pasteText(cause);
  }

  /// The field's menu with „Einfügen“ going through [paste].
  Widget _contextMenu(BuildContext context, EditableTextState state) => AdaptiveTextSelectionToolbar.buttonItems(
    anchors: state.contextMenuAnchors,
    buttonItems: [
      for (final item in state.contextMenuButtonItems)
        item.type == ContextMenuButtonType.paste
            ? item.copyWith(onPressed: () => paste(state, SelectionChangedCause.toolbar))
            : item,
    ],
  );

  /// Ends editing with the measured size (text objects follow their content).
  void finish() {
    final id = _e.editingId;
    final shown = id == null ? null : _e.controller.state[id];
    final doc = _e.editingDoc;
    final o = shown == null || doc == null ? shown : shown.patched(set: {'content': doc.toJson(), 'text': doc.text});
    final box = o == null ? null : editTextBox(o, widget.ctx);
    _e.stopEditing(measured: o != null && box != null && o.type == 'text' ? measure(o, box) : null);
  }

  @override
  void dispose() {
    _e.removeListener(_editorChanged);
    _text.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final id = _e.editingId;
    final shown = id == null ? null : _e.controller.state[id];
    final doc = _e.editingDoc;
    if (shown == null || doc == null) return const SizedBox.shrink();
    // with the text as typed: the font size follows it like on the board (ops go out debounced)
    final o = shown.patched(set: {'content': doc.toJson(), 'text': doc.text});
    final box = editTextBox(o, widget.ctx);
    if (box == null) return const SizedBox.shrink();
    return ValueListenableBuilder<Camera>(
      valueListenable: widget.camera,
      builder: (context, cam, _) {
        final origin = cam.toScreen(Offset(o.x, o.y));
        final rad = o.rotation * math.pi / 180;
        final m = Matrix4.identity()
          ..translateByDouble(origin.dx, origin.dy, 0, 1)
          ..scaleByDouble(cam.z, cam.z, 1, 1)
          ..translateByDouble(o.w / 2, o.h / 2, 0, 1)
          ..rotateZ(rad)
          ..translateByDouble(-o.w / 2, -o.h / 2, 0, 1);
        final wide = o.type == 'text' && o.autoWidth;
        final mind = o.type == 'mindnode';
        // mind nodes are just as wide as their text: room for the caret so the last word does not wrap
        final slack = mind ? 8.0 : 0.0;
        final left = box.align == TextAlign.center ? box.box.left - slack / 2 : box.box.left;
        final field = TextField(
          key: const Key('boardTextField'),
          controller: _text,
          contextMenuBuilder: _contextMenu,
          focusNode: _focus,
          maxLines: null,
          // mind node: Enter = topic on the same level (web), the keyboard shows „next“
          keyboardType: mind ? TextInputType.text : TextInputType.multiline,
          textInputAction: mind ? TextInputAction.next : null,
          onSubmitted: mind ? (_) => _e.mindEnter() : null,
          onEditingComplete: mind ? () {} : null,
          textAlign: box.align,
          style: _style(o, box),
          cursorColor: const Color(0xFFEC4E92),
          cursorWidth: 2 / cam.z.clamp(0.25, 4),
          // UX P11: text in place – no frame or fill from the app's input theme (its focused border drew a black box
          // inside the note)
          decoration:
              InputDecoration.collapsed(
                hintText: o.type == 'text' ? 'Text eingeben' : (mind ? mindPlaceholders[mindLevel(o).clamp(0, 2)] : ''),
                hintStyle: _style(o, box).copyWith(color: box.color.withValues(alpha: 0.4)),
                filled: false,
              ).copyWith(
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                disabledBorder: InputBorder.none,
                errorBorder: InputBorder.none,
                focusedErrorBorder: InputBorder.none,
              ),
          onTapOutside: (_) {},
        );
        return Positioned(
          left: 0,
          top: 0,
          child: Transform(
            transform: m,
            alignment: Alignment.topLeft,
            child: SizedBox(
              width: wide ? math.max(o.w, 4000) : o.w,
              height: o.h,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Positioned(
                    left: left,
                    top: box.box.top,
                    width: wide ? 4000 : box.box.width + slack,
                    height: o.type == 'text' ? null : box.box.height,
                    child: Align(
                      alignment: switch (box.valign) {
                        'top' => Alignment.topCenter,
                        'bottom' => Alignment.bottomCenter,
                        _ => Alignment.center,
                      },
                      child: Material(
                        type: MaterialType.transparency,
                        // Strg/Cmd+V like „Einfügen“ in the menu (HTML first)
                        child: Shortcuts(
                          shortcuts: const {
                            SingleActivator(LogicalKeyboardKey.keyV, control: true): _PasteIntent(),
                            SingleActivator(LogicalKeyboardKey.keyV, meta: true): _PasteIntent(),
                          },
                          child: Actions(
                            actions: {_PasteIntent: CallbackAction<_PasteIntent>(onInvoke: (_) => paste())},
                            child: field,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _PasteIntent extends Intent {
  const _PasteIntent();
}
