import 'package:flutter/material.dart';

import '../../editor/board_editor.dart';
import '../../editor/registry/board_ui.dart';
import '../../model/board_object.dart';
import '../../protocol/native_messages.dart';
import '../../model/rich_edit.dart';
import '../../render/paint_utils.dart';
import '../../render/text_layout.dart';
import '../../web/web_constants.dart';
import '../a11y/color_names.dart';
import '../text_object/register.dart' show stickyAutoFontSize;
import '../text_object/text_format.dart';

// P8: the format bar while writing like the web's `FormatBar.tsx` on the phone (< 700 px, docked over the keyboard):
// size, bold, italic, underline, text color, highlight, link and „Mehr“ (paragraph style, strike, lists, indent,
// alignment, font). Marks work on the selected text, without a selection on the whole text (E3, F09); the size of a
// selected part of a text/shape is a `textStyle.fontSize` in em (F08), without one the object's size.

/// Text sizes of the format bar (web `FONT_SIZES` of `FormatBar.tsx`).
List<double> get richTextSizes {
  final l = WebConstants.instance.numbers('fontSizes.richText');
  return l.isEmpty ? const [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80, 96, 128] : l;
}

/// Highlight colors (web `HIGHLIGHTS`).
const richHighlights = ['#fff27a', '#c9e14a', '#ffb3d1', '#9fd3ff', '#ffd08a', '#e2d5ff'];

/// Paragraph styles (web `BLOCKS`): key, label, short label.
const richBlocks = [
  ('p', 'Normaler Text', 'Aa'),
  ('h1', 'Überschrift 1', 'H1'),
  ('h2', 'Überschrift 2', 'H2'),
  ('h3', 'Überschrift 3', 'H3'),
  ('quote', 'Zitat', '❝'),
  ('code', 'Code-Block', '</>'),
];

/// Factor of a part size (`1.5em`); else 1.
double emOf(Object? v) {
  final m = v is String ? RegExp(r'^(\d+(?:\.\d+)?)em$').firstMatch(v) : null;
  return m == null ? 1 : double.parse(m.group(1)!);
}

/// The format bar for the text being edited in [editor] (null while nothing is edited).
class RichFormatBar extends StatelessWidget {
  const RichFormatBar({super.key, required this.editor});
  final BoardEditor editor;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: editor,
    builder: (context, _) {
      final f = RichFormat.of(editor);
      if (f == null) return const SizedBox.shrink();
      final ui = BoardUiScope.maybeOf(context);
      final ink = ui?.theme.ink ?? const Color(0xFF161118);
      return SizedBox(
        height: 44,
        child: ListView(
          key: const Key('stachelFormatBar'),
          scrollDirection: Axis.horizontal,
          children: [
            RichFmtButton(
              keyName: 'stachelFmt-size',
              label: 'Schriftgröße',
              width: 52,
              onTap: () => _sizeSheet(context, f),
              child: Text(
                f.auto ? 'Auto' : '${f.shownSize}',
                key: const Key('stachelFmtSizeValue'),
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: ink),
              ),
            ),
            RichFmtButton(
              keyName: 'stachelFmt-bold',
              label: 'Fett',
              active: f.markOn('bold'),
              onTap: () => f.mark((d, a, b) => d.toggleMark(a, b, 'bold')),
              child: Icon(Icons.format_bold, color: ink),
            ),
            RichFmtButton(
              keyName: 'stachelFmt-italic',
              label: 'Kursiv',
              active: f.markOn('italic'),
              onTap: () => f.mark((d, a, b) => d.toggleMark(a, b, 'italic')),
              child: Icon(Icons.format_italic, color: ink),
            ),
            RichFmtButton(
              keyName: 'stachelFmt-underline',
              label: 'Unterstrichen',
              active: f.markOn('underline'),
              onTap: () => f.mark((d, a, b) => d.toggleMark(a, b, 'underline')),
              child: Icon(Icons.format_underlined, color: ink),
            ),
            RichFmtButton(
              keyName: 'stachelFmt-color',
              label: 'Textfarbe',
              onTap: () => _colorSheet(context, f, highlight: false),
              // the letter in the bar's ink (readable on a dark bar too), the chosen color as the bar below it
              child: _ColorBelow(icon: Icons.format_color_text, ink: ink, color: parseColor(f.textColor, ink)),
            ),
            RichFmtButton(
              keyName: 'stachelFmt-highlight',
              label: 'Markierung',
              active: f.markOn('highlight'),
              onTap: () => _colorSheet(context, f, highlight: true),
              child: Icon(Icons.border_color, color: f.highlight == null ? ink : parseColor(f.highlight, ink)),
            ),
            RichFmtButton(
              keyName: 'stachelFmt-link',
              label: 'Link',
              active: f.markOn('link'),
              onTap: () => richLinkDialog(context, f),
              child: Icon(Icons.link, color: ink),
            ),
            RichFmtButton(
              keyName: 'stachelFmt-more',
              label: 'Mehr Formate',
              active: f.moreActive,
              onTap: () => _moreSheet(context, editor),
              child: Icon(Icons.more_horiz, color: ink),
            ),
          ],
        ),
      );
    },
  );
}

/// A format icon in [ink] with the chosen [color] as a bar under it (outlined, so black text shows on a dark bar).
class _ColorBelow extends StatelessWidget {
  const _ColorBelow({required this.icon, required this.ink, required this.color});
  final IconData icon;
  final Color ink;
  final Color color;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 24,
    height: 24,
    child: Stack(
      children: [
        Icon(icon, color: ink),
        Positioned(
          left: 2,
          right: 2,
          bottom: 0,
          height: 5,
          child: DecoratedBox(
            key: const Key('stachelFmtColorBar'),
            decoration: BoxDecoration(
              color: color,
              border: Border.all(color: ink.withValues(alpha: 0.6), width: 0.8),
            ),
          ),
        ),
      ],
    ),
  );
}

/// What the format bar knows about the edited text (web `FormatBar` state): the object, the document, the selection.
class RichFormat {
  RichFormat._(this.editor, this.o, this.doc, this.start, this.end);

  /// Null while nothing is edited (or a mind node: plain text).
  static RichFormat? of(BoardEditor editor) {
    final doc = editor.editingDoc;
    final id = editor.editingId;
    final o = id == null ? null : editor.controller.state[id];
    if (doc == null || o == null || o.type == 'mindnode') return null;
    final len = doc.text.length;
    final r = editor.textRange;
    return RichFormat._(editor, o, doc, r.start.clamp(0, len), r.end.clamp(0, len));
  }

  final BoardEditor editor;
  final BoardObject o;
  final RichEditDoc doc;
  final int start, end;

  bool markOn(String mark) => doc.hasMark(start, end, mark);

  /// Text color at the selection; a text object's own color, else ink (web).
  String get textColor {
    final c = doc.markAttr(start, end, 'textStyle', 'color');
    return c is String ? c : (o.type == 'text' ? (o.color ?? '#0a0a0a') : '#0a0a0a');
  }

  /// Highlight color at the selection (null = none).
  String? get highlight {
    if (!markOn('highlight')) return null;
    final c = doc.markAttr(start, end, 'highlight', 'color');
    return c is String ? c : '#fff27a';
  }

  String get block => doc.blockKind(start, end);
  String? get list => doc.listKind(start, end);

  /// Note without own size: automatic (web `autoFont`).
  bool get auto => o.type == 'sticky' && o.fontSize == null;

  /// A part (not all) of a text/shape is selected: the size is for that part (web `partSize`).
  bool get partSize =>
      (o.type == 'text' || o.type == 'shape') && start != end && !(start == 0 && end == doc.text.length);

  /// Size of the object (sticky without one: what it shows).
  double objectSize(BoardUi? ui) =>
      o.fontSize ??
      (o.type == 'sticky' ? (ui == null ? 24 : stickyAutoFontSize(ui, o)) : (o.type == 'shape' ? 20 : 24));

  int get shownSize =>
      ((o.fontSize ?? (o.type == 'shape' ? 20 : 24)) *
              (partSize ? emOf(doc.markAttr(start, end, 'textStyle', 'fontSize')) : 1))
          .round();

  /// „Mehr“ shows something active (web `moreActive`).
  bool get moreActive => block != 'p' || markOn('strike') || list != null;

  /// A mark command on the selection (none: the whole text).
  void mark(bool Function(RichEditDoc d, int a, int b) fn) => editor.formatText(fn);

  /// Patch of the edited object (size, font, alignment); a text with `autoWidth` follows with its width.
  void patch(Map<String, Object?> p) {
    if (!editor.editable || o.locked) return;
    editor.controller.apply([
      UpdateOp({o.id: adjustTextPatch(o, p)}),
    ]);
  }

  /// Size [s] (web `setSize`): for a selected part as em of the object size; for everything the object's size (part
  /// sizes go).
  void setSize(double s, BoardUi? ui) {
    if (!partSize) {
      if (doc.hasInlineSize) {
        editor.formatText((d, a, b) => d.setMarkAttr(0, d.text.length, 'textStyle', 'fontSize', null));
      }
      patch({'fontSize': s});
      return;
    }
    final size = objectSize(ui);
    final k = (s / size * 1000).round() / 1000;
    editor.formatText(
      (d, a, b) => d.setMarkAttr(a, b, 'textStyle', 'fontSize', (k - 1).abs() < 0.01 ? null : '${_num(k)}em'),
    );
  }
}

String _num(double v) => v == v.roundToDouble() ? '${v.round()}' : '$v';

/// A button of the format bar (≥ 40 px, label for screen readers, state „aktiv“).
class RichFmtButton extends StatelessWidget {
  const RichFmtButton({
    super.key,
    required this.keyName,
    required this.label,
    required this.onTap,
    required this.child,
    this.active = false,
    this.width = 44,
  });
  final String keyName;
  final String label;
  final VoidCallback? onTap;
  final Widget child;
  final bool active;
  final double width;

  @override
  Widget build(BuildContext context) {
    final ui = BoardUiScope.maybeOf(context);
    final accent = ui?.theme.accent ?? const Color(0xFFE5398B);
    return Tooltip(
      message: label,
      excludeFromSemantics: true,
      child: Semantics(
        button: true,
        toggled: null,
        selected: active,
        enabled: onTap != null,
        label: label,
        excludeSemantics: true,
        child: InkWell(
          key: Key(keyName),
          onTap: onTap,
          borderRadius: BorderRadius.circular(6),
          child: Container(
            width: width,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: active ? accent.withValues(alpha: 0.18) : null,
              borderRadius: BorderRadius.circular(6),
            ),
            child: Opacity(opacity: onTap == null ? 0.35 : 1, child: child),
          ),
        ),
      ),
    );
  }
}

Future<T?> _sheet<T>(BuildContext context, WidgetBuilder builder) {
  final ui = BoardUiScope.maybeOf(context);
  if (ui != null) return ui.openSheet<T>(context, builder, closeOnSelectionChange: false);
  return showModalBottomSheet<T>(context: context, showDragHandle: true, builder: builder);
}

Widget _title(BuildContext context, String text) => Padding(
  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
  child: Text(text, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, letterSpacing: 0.6)),
);

Future<void> _sizeSheet(BuildContext context, RichFormat f) async {
  final ui = BoardUiScope.maybeOf(context);
  final v = await _sheet<double>(
    context,
    (ctx) => SafeArea(
      child: Column(
        key: const Key('stachelFmtSizeSheet'),
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _title(ctx, f.partSize ? 'SCHRIFTGRÖSSE (AUSWAHL)' : 'SCHRIFTGRÖSSE'),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                if (f.o.type == 'sticky')
                  ChoiceChip(
                    key: const Key('stachelFmtSize-auto'),
                    label: const Text('Auto'),
                    selected: f.auto,
                    onSelected: (_) => Navigator.of(ctx).pop(-1.0),
                  ),
                for (final s in richTextSizes)
                  ChoiceChip(
                    key: Key('stachelFmtSize-${s.round()}'),
                    label: Text(_num(s)),
                    selected: !f.auto && f.shownSize == s.round(),
                    onSelected: (_) => Navigator.of(ctx).pop(s),
                  ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
  if (v == null) return;
  final now = RichFormat.of(f.editor);
  if (now == null) return;
  if (v < 0) {
    now.patch({'fontSize': null});
  } else {
    now.setSize(v, ui);
  }
}

Future<void> _colorSheet(BuildContext context, RichFormat f, {required bool highlight}) async {
  final colors = highlight ? richHighlights : inkColors;
  final current = highlight ? f.highlight : f.textColor;
  final v = await _sheet<String>(
    context,
    (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _title(ctx, highlight ? 'MARKIERUNG' : 'TEXTFARBE'),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                for (final c in colors)
                  RichSwatch(
                    keyName: 'stachelFmtColor-$c',
                    color: c,
                    label: '${highlight ? 'Markierung' : 'Textfarbe'} ${colorName(c)}',
                    active: c == current,
                    round: !highlight,
                    onTap: () => Navigator.of(ctx).pop(c),
                  ),
                TextButton(
                  key: const Key('stachelFmtColor-none'),
                  onPressed: () => Navigator.of(ctx).pop(''),
                  child: Text(highlight ? 'OHNE' : 'AUTOMATISCH'),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
  if (v == null) return;
  final now = RichFormat.of(f.editor);
  if (now == null) return;
  if (highlight) {
    now.mark((d, a, b) => v.isEmpty ? d.removeMark(a, b, 'highlight') : d.setMarkAttr(a, b, 'highlight', 'color', v));
  } else {
    now.mark((d, a, b) => d.setMarkAttr(a, b, 'textStyle', 'color', v.isEmpty ? null : v));
  }
}

/// A color button (≥ 44 px touch target, German color name for screen readers – P03).
class RichSwatch extends StatelessWidget {
  const RichSwatch({
    super.key,
    required this.keyName,
    required this.color,
    required this.label,
    required this.onTap,
    this.active = false,
    this.round = true,
  });
  final String keyName;
  final String color;
  final String label;
  final VoidCallback onTap;
  final bool active;
  final bool round;

  @override
  Widget build(BuildContext context) {
    final ui = BoardUiScope.maybeOf(context);
    final ink = ui?.theme.ink ?? const Color(0xFF161118);
    final accent = ui?.theme.accent ?? const Color(0xFFE5398B);
    return Semantics(
      button: true,
      selected: active,
      label: label,
      excludeSemantics: true,
      child: InkWell(
        key: Key(keyName),
        onTap: onTap,
        customBorder: round ? const CircleBorder() : null,
        child: SizedBox(
          width: 44,
          height: 44,
          child: Center(
            child: Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: parseColor(color, ink),
                shape: round ? BoxShape.circle : BoxShape.rectangle,
                borderRadius: round ? null : BorderRadius.circular(6),
                border: Border.all(color: active ? accent : ink, width: active ? 3 : 2),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Link field of the format bar (web `LinkPop`): with selected text the link goes on it, inside a link it replaces
/// that link, else the input is inserted as linked text; „Link entfernen“ inside a link. Invalid input:
/// „Das ist kein gültiger Link.“
Future<void> richLinkDialog(BuildContext context, RichFormat f) async {
  final range = f.start != f.end ? (f.start, f.end) : f.doc.linkRangeAt(f.start);
  final current = range == null ? null : f.doc.markAttr(range.$1, range.$2, 'link', 'href');
  final v = await askLink(context, current: current is String ? current : '');
  if (v == null) return;
  final now = RichFormat.of(f.editor);
  if (now == null) return;
  if (v.isEmpty) {
    if (range != null) now.editor.formatText((d, a, b) => d.removeMark(range.$1, range.$2, 'link'));
    return;
  }
  if (range != null) {
    now.editor.formatText((d, a, b) => d.setLink(range.$1, range.$2, v));
  } else {
    now.editor.formatText((d, a, b) => d.insertLink(f.start, v, v) != null);
  }
}

/// Dialog „Link“ with the web's input rules ([normalizeHref]); returns the input, '' = remove, null = cancelled.
Future<String?> askLink(BuildContext context, {String current = ''}) => showDialog<String>(
  context: context,
  builder: (ctx) => _LinkDialog(current: current),
);

class _LinkDialog extends StatefulWidget {
  const _LinkDialog({required this.current});
  final String current;

  @override
  State<_LinkDialog> createState() => _LinkDialogState();
}

class _LinkDialogState extends State<_LinkDialog> {
  late final _c = TextEditingController(text: widget.current);
  bool _error = false;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  void _apply() {
    if (normalizeHref(_c.text) == null) {
      setState(() => _error = true);
      return;
    }
    Navigator.of(context).pop(_c.text.trim());
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Link'),
    content: TextField(
      key: const Key('stachelFmtLinkField'),
      controller: _c,
      autofocus: true,
      autocorrect: false,
      keyboardType: TextInputType.url,
      onChanged: (_) => _error ? setState(() => _error = false) : null,
      onSubmitted: (_) => _apply(),
      decoration: InputDecoration(
        hintText: 'Link einfügen, z. B. example.org',
        labelText: 'Linkadresse',
        errorText: _error ? 'Das ist kein gültiger Link.' : null,
      ),
    ),
    actions: [
      if (widget.current.isNotEmpty)
        TextButton(
          key: const Key('stachelFmtLinkRemove'),
          onPressed: () => Navigator.of(context).pop(''),
          child: const Text('LINK ENTFERNEN'),
        ),
      TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('ABBRECHEN')),
      FilledButton(key: const Key('stachelFmtLinkSave'), onPressed: _apply, child: const Text('ÜBERNEHMEN')),
    ],
  );
}

/// „Mehr Formate“ (web, phone): paragraph style, strike + lists (+ done, indent/outdent – the phone's Tab), alignment,
/// font. Stays open for lists and alignment like the web's popover; a paragraph style, strike or font closes it.
Future<void> _moreSheet(BuildContext context, BoardEditor editor) => _sheet<void>(
  context,
  (ctx) => SafeArea(
    child: ListenableBuilder(
      listenable: editor,
      builder: (ctx, _) {
        final f = RichFormat.of(editor);
        if (f == null) return const SizedBox.shrink();
        final ui = BoardUiScope.maybeOf(ctx);
        final ink = ui?.theme.ink ?? const Color(0xFF161118);
        final fonts = ui?.view?.widget.fonts ?? const BoardFonts();
        final list = f.list;
        final align = f.o.align ?? (f.o.type == 'text' ? 'left' : 'center');
        final valign = f.o.valign ?? 'middle';
        void close() => Navigator.of(ctx).pop();
        Widget row(String label, List<Widget> children) => Semantics(
          container: true,
          label: label,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
            child: Wrap(spacing: 4, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: children),
          ),
        );
        return SingleChildScrollView(
          child: Column(
            key: const Key('stachelFmtMoreSheet'),
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _title(ctx, 'MEHR FORMATE'),
              row('Absatz', [
                for (final (k, label, short) in richBlocks)
                  Semantics(
                    label: label,
                    selected: f.block == k,
                    button: true,
                    excludeSemantics: true,
                    child: ChoiceChip(
                      key: Key('stachelFmtBlock-$k'),
                      label: Text(short),
                      tooltip: label,
                      selected: f.block == k,
                      onSelected: (_) {
                        editor.formatText((d, a, b) => d.setBlockKind(a, b, k));
                        close();
                      },
                    ),
                  ),
              ]),
              row('Format und Listen', [
                RichFmtButton(
                  keyName: 'stachelFmt-strike',
                  label: 'Durchgestrichen',
                  active: f.markOn('strike'),
                  onTap: () {
                    f.mark((d, a, b) => d.toggleMark(a, b, 'strike'));
                    close();
                  },
                  child: Icon(Icons.format_strikethrough, color: ink),
                ),
                const SizedBox(width: 8),
                RichFmtButton(
                  keyName: 'stachelFmt-bullets',
                  label: 'Aufzählung',
                  active: list == 'bulletList',
                  onTap: () => editor.formatText((d, a, b) => d.toggleList(a, b, 'bulletList')),
                  child: Icon(Icons.format_list_bulleted, color: ink),
                ),
                RichFmtButton(
                  keyName: 'stachelFmt-numbers',
                  label: 'Nummerierte Liste',
                  active: list == 'orderedList',
                  onTap: () => editor.formatText((d, a, b) => d.toggleList(a, b, 'orderedList')),
                  child: Icon(Icons.format_list_numbered, color: ink),
                ),
                RichFmtButton(
                  keyName: 'stachelFmt-tasks',
                  label: 'Checkliste',
                  active: list == 'taskList',
                  onTap: () => editor.formatText((d, a, b) => d.toggleList(a, b, 'taskList')),
                  child: Icon(Icons.checklist, color: ink),
                ),
                if (list == 'taskList')
                  RichFmtButton(
                    keyName: 'stachelFmt-done',
                    label: 'Abhaken',
                    onTap: () => editor.formatText((d, a, b) => d.toggleTaskDone(a, b)),
                    child: Icon(Icons.check_box_outlined, color: ink),
                  ),
                RichFmtButton(
                  keyName: 'stachelFmt-indent',
                  label: 'Einrücken',
                  onTap: list == null ? null : () => editor.formatText((d, a, b) => d.indent(a, b)),
                  child: Icon(Icons.format_indent_increase, color: ink),
                ),
                RichFmtButton(
                  keyName: 'stachelFmt-outdent',
                  label: 'Ausrücken',
                  onTap: list == null ? null : () => editor.formatText((d, a, b) => d.outdent(a, b)),
                  child: Icon(Icons.format_indent_decrease, color: ink),
                ),
              ]),
              row('Ausrichtung', [
                for (final (a, label, icon) in const [
                  ('left', 'Linksbündig', Icons.format_align_left),
                  ('center', 'Zentriert', Icons.format_align_center),
                  ('right', 'Rechtsbündig', Icons.format_align_right),
                ])
                  RichFmtButton(
                    keyName: 'stachelFmtAlign-$a',
                    label: label,
                    active: align == a,
                    onTap: () => f.patch({'align': a}),
                    child: Icon(icon, color: ink),
                  ),
                if (f.o.type == 'sticky' || f.o.type == 'shape') ...[
                  const SizedBox(width: 8),
                  for (final (v, label, icon) in const [
                    ('top', 'Oben', Icons.vertical_align_top),
                    ('middle', 'Mitte', Icons.vertical_align_center),
                    ('bottom', 'Unten', Icons.vertical_align_bottom),
                  ])
                    RichFmtButton(
                      keyName: 'stachelFmtVAlign-$v',
                      label: label,
                      active: valign == v,
                      onTap: () => f.patch({'valign': v}),
                      child: Icon(icon, color: ink),
                    ),
                ],
              ]),
              row('Schriftart', [
                for (final font in boardFonts)
                  ChoiceChip(
                    key: Key('stachelFmtFont-${font.key}'),
                    label: Text(font.label, style: TextStyle(fontFamily: fonts.family(font.key))),
                    selected: fontOf(f.o.fontFamily).key == font.key,
                    onSelected: (_) {
                      f.patch({'fontFamily': font.key == 'barlow' ? null : font.key});
                      close();
                    },
                  ),
              ]),
            ],
          ),
        );
      },
    ),
  ),
);
