import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../editor/board_editor.dart';
import '../../editor/registry/board_ui.dart';
import '../../editor/registry/context_action_def.dart';
import '../../model/board_object.dart';
import '../../model/rich_edit.dart';
import '../../protocol/native_messages.dart';
import '../../render/paint_utils.dart';
import '../../render/text_layout.dart';
import '../a11y/color_names.dart';
import 'format_bar.dart';

// P8, audit E08/F15: format for the whole object from the context bar like the web's `core.format`
// (`richtext/contextActions.tsx`): underline, text color (text objects: the object's color), highlight, list – plus the
// phone's counterpart of Strg K on a selected object („Link“ for the whole text). The server runs the web's code
// (act `richtext.whole`, `web/src/features/richtext/native.ts`); one undo step each.

/// Selected objects with text, not locked (web `textTargets`).
List<BoardObject> richTargets(CtxInfo c) => [
  for (final o in c.selected)
    if (textTypes.contains(o.type) && !o.locked) o,
];

/// The rich text of [o] as the server sees it (`content` if it matches `text`, else `text` as paragraphs).
Map<String, Object?> richJsonOf(BoardObject o) => effectivePmDoc(o.raw['content'], o.text);

/// First mark [type] in the document (with [attr] set), like the web's `firstMark`.
Map<String, Object?>? firstMarkOf(Map<String, Object?> doc, String type, {String? attr}) {
  Map<String, Object?>? found;
  void walk(Object? n) {
    if (found != null || n is! Map) return;
    for (final m in (n['marks'] is List ? n['marks'] as List : const [])) {
      if (m is Map<String, Object?> && m['type'] == type && (attr == null || (m['attrs'] as Map?)?[attr] != null)) {
        found = m;
        return;
      }
    }
    for (final k in (n['content'] is List ? n['content'] as List : const [])) {
      walk(k);
    }
  }

  walk(doc);
  return found;
}

/// The whole (not empty) text carries mark [type] – web `hasMarkAll` (code blocks do not count).
bool hasMarkAll(Map<String, Object?> doc, String type) {
  var seen = false, all = true;
  void walk(Object? n, bool code) {
    if (n is! Map) return;
    if (n['type'] == 'text' && n['text'] is String && (n['text'] as String).isNotEmpty && !code) {
      seen = true;
      if (!(n['marks'] is List && (n['marks'] as List).any((m) => m is Map && m['type'] == type))) all = false;
    }
    for (final k in (n['content'] is List ? n['content'] as List : const [])) {
      walk(k, code || n['type'] == 'codeBlock');
    }
  }

  walk(doc, false);
  return seen && all;
}

/// The whole document is one list of [kind] (web `isWholeList`).
bool isWholeList(Map<String, Object?> doc, String kind) {
  final c = doc['content'];
  return c is List && c.length == 1 && c.first is Map && (c.first as Map)['type'] == kind;
}

/// Text color of [o] as the context bar shows it (web `textColorOf`).
String textColorOf(BoardObject o) {
  final m = firstMarkOf(richJsonOf(o), 'textStyle', attr: 'color');
  final c = (m?['attrs'] as Map?)?['color'];
  return c is String ? c : (o.type == 'text' ? (o.color ?? '#0a0a0a') : '#0a0a0a');
}

/// Highlight of [o] (null = none; web `highlightOf`).
String? highlightOf(BoardObject o) {
  final m = firstMarkOf(richJsonOf(o), 'highlight');
  if (m == null) return null;
  final c = (m['attrs'] as Map?)?['color'];
  return c is String ? c : '#fff27a';
}

const _lists = [
  ('bulletList', 'Aufzählung', Icons.format_list_bulleted),
  ('orderedList', 'Nummerierte Liste', Icons.format_list_numbered),
  ('taskList', 'Checkliste', Icons.checklist),
];

/// The items P8 adds to `core.format` (web order: B I **U** S · **Textfarbe Markierung Liste** Ausrichtung) – merged into
/// P2's entry by [mergeIntoCoreFormat]; „Link“ (Strg K on the board) follows the list.
List<CtxItem> wholeFormatItems(BoardUi ui, CtxInfo c, {required String where}) {
  final targets = richTargets(c);
  if (targets.isEmpty || !ui.controller.canAct('richtext.whole')) return const [];
  final ink = ui.theme.ink;
  if (where == 'underline') {
    final on = targets.every((o) => hasMarkAll(richJsonOf(o), 'underline'));
    return [
      CtxItem(
        key: 'stachelCtxUnderline',
        label: 'Unterstrichen',
        width: 40,
        active: on,
        leading: (_) => Text(
          'U',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w600,
            decoration: TextDecoration.underline,
            color: on ? ui.theme.accentDark : ink,
          ),
        ),
        onTap: (context, ui) => wholeAct(ui, targets, {'op': 'underline', 'value': !on}),
      ),
    ];
  }
  final first = targets.first;
  final hl = highlightOf(first);
  final list = _lists.where((l) => targets.every((o) => isWholeList(richJsonOf(o), l.$1))).firstOrNull;
  return [
    CtxItem(
      key: 'stachelCtxTextColor',
      label: 'Textfarbe',
      icon: Icons.format_color_text,
      leading: (_) => Icon(Icons.format_color_text, color: parseColor(textColorOf(first), ink)),
      onTap: (context, ui) => _colorSheet(context, ui, c, highlight: false),
    ),
    CtxItem(
      key: 'stachelCtxHighlight',
      label: 'Markierung',
      icon: Icons.border_color,
      leading: (_) => Icon(Icons.border_color, color: hl == null ? ink : parseColor(hl, ink)),
      onTap: (context, ui) => _colorSheet(context, ui, c, highlight: true),
    ),
    CtxItem(
      key: 'stachelCtxList',
      label: 'Liste',
      icon: (list ?? _lists.first).$3,
      active: list != null,
      onTap: (context, ui) => _listSheet(context, ui, c),
    ),
    CtxItem(
      key: 'stachelCtxRichLink',
      label: 'Link für den Text',
      icon: Icons.add_link,
      onTap: (context, ui) => _link(context, ui, c),
    ),
  ];
}

/// Runs `richtext.whole` on [targets]; after a list change, text objects take their new height (the web measures
/// them in the DOM).
Future<void> wholeAct(BoardUi ui, List<BoardObject> targets, Map<String, Object?> args) async {
  final done = await ui.controller.act('richtext.whole', {
    'ids': [for (final o in targets) o.id],
    ...args,
  }, label: 'Format');
  final data = done.result?.data;
  final changed = data is Map ? data['changed'] : null;
  if (changed is List) remeasureTexts(ui, [for (final id in changed) '$id']);
}

/// Size of a text object's text as drawn (world units) – like the text field measures it when writing ends.
Size measureTextObject(BoardObject o, BoardFonts fonts) {
  final fs = o.fontSize ?? 24;
  final tp = TextPainter(
    text: objectTextSpan(o, fontSize: fs, color: parseColor(o.color, BoardColors.ink), fonts: fonts),
    textDirection: TextDirection.ltr,
    textAlign: TextAlign.left,
  )..layout(maxWidth: o.autoWidth ? double.infinity : math.max(1, o.w));
  final s = Size(tp.width + 2, tp.height);
  tp.dispose();
  return s;
}

/// Text objects [ids] follow their content again (height; width with `autoWidth`).
void remeasureTexts(BoardUi ui, List<String> ids) {
  final fonts = ui.view?.widget.fonts ?? const BoardFonts();
  final patches = <String, Map<String, Object?>>{};
  for (final id in ids) {
    final o = ui.controller.state[id];
    if (o == null || o.type != 'text' || o.locked) continue;
    final m = measureTextObject(o, fonts);
    final p = <String, Object?>{
      if (o.autoWidth && (m.width - o.w).abs() > 1) 'w': m.width.ceilToDouble(),
      if ((m.height - o.h).abs() > 1) 'h': m.height.ceilToDouble(),
    };
    if (p.isNotEmpty) patches[id] = p;
  }
  if (patches.isNotEmpty) ui.controller.apply([UpdateOp(patches)]);
}

Future<void> _colorSheet(BuildContext context, BoardUi ui, CtxInfo c, {required bool highlight}) async {
  final targets = richTargets(c);
  if (targets.isEmpty) return;
  final colors = highlight ? richHighlights : inkColors;
  final current = highlight ? highlightOf(targets.first) : textColorOf(targets.first);
  final name = highlight ? 'Markierung' : 'Textfarbe';
  final v = await ui.openSheet<String>(
    context,
    (ctx) => SafeArea(
      child: Column(
        key: Key(highlight ? 'stachelCtxHighlightSheet' : 'stachelCtxTextColorSheet'),
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Text(name.toUpperCase(), style: ui.theme.label(size: 14)),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                for (final col in colors)
                  RichSwatch(
                    keyName: '${highlight ? 'stachelCtxHighlight' : 'stachelCtxTextColor'}-$col',
                    color: col,
                    label: '$name ${colorName(col)}',
                    active: col == current,
                    round: !highlight,
                    onTap: () => Navigator.of(ctx).pop(col),
                  ),
                TextButton(
                  key: Key('${highlight ? 'stachelCtxHighlight' : 'stachelCtxTextColor'}-none'),
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
  await wholeAct(ui, targets, {'op': highlight ? 'highlight' : 'color', 'value': v.isEmpty ? null : v});
}

Future<void> _listSheet(BuildContext context, BoardUi ui, CtxInfo c) async {
  final targets = richTargets(c);
  if (targets.isEmpty) return;
  final v = await ui.openSheet<String>(
    context,
    (ctx) => SafeArea(
      child: Column(
        key: const Key('stachelCtxListSheet'),
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Text('LISTE', style: ui.theme.label(size: 14)),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            child: Row(
              children: [
                for (final (kind, label, icon) in _lists)
                  RichFmtButton(
                    keyName: 'stachelCtxList-$kind',
                    label: label,
                    active: targets.every((o) => isWholeList(richJsonOf(o), kind)),
                    onTap: () => Navigator.of(ctx).pop(kind),
                    child: Icon(icon, color: ui.theme.ink),
                  ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
  if (v != null) await wholeAct(ui, targets, {'op': 'list', 'value': v});
}

/// „Link für den Text“ (web: Strg K on the selected object = the link field with all text selected).
Future<void> _link(BuildContext context, BoardUi ui, CtxInfo c) async {
  final targets = richTargets(c);
  if (targets.isEmpty) return;
  final m = firstMarkOf(richJsonOf(targets.first), 'link');
  final href = (m?['attrs'] as Map?)?['href'];
  final v = await askLink(context, current: href is String ? href : '');
  if (v == null) return;
  await wholeAct(ui, targets, {'op': 'link', 'value': v.isEmpty ? null : v});
}

/// Puts [extra]'s items into P2's `core.format` the web's way: Unterstrichen after Kursiv, Textfarbe/Markierung/Liste/
/// Link before the alignment (or at the end).
List<CtxItem> mergeIntoCoreFormat(List<CtxItem> items, BoardUi ui, CtxInfo c) {
  final out = [...items];
  final underline = wholeFormatItems(ui, c, where: 'underline');
  if (underline.isEmpty) return out;
  final italic = out.indexWhere((i) => i.key == 'stachelCtxItalic');
  out.insertAll(italic < 0 ? out.length : italic + 1, underline);
  final align = out.indexWhere((i) => i.key == 'stachelCtxAlign');
  out.insertAll(align < 0 ? out.length : align, wholeFormatItems(ui, c, where: 'rest'));
  return out;
}
