import 'package:flutter/material.dart';

import '../../editor/board_editor.dart';
import '../../editor/registry/board_ui.dart';
import '../../editor/registry/context_action_def.dart';
import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import '../../editor/registry/tool_def.dart';
import '../../model/board_object.dart';
import '../../render/board_images.dart';
import '../../render/object_renderers.dart';
import '../../render/text_layout.dart';
import '../shapes/shape_state.dart';
import '../shapes/shape_widgets.dart';
import 'remeasure.dart';
import 'text_format.dart';

/// P2: text tool on an existing text (C05), object-wide format of notes/texts/shapes – font (E09), size A−/value/A+
/// (E06), bold/italic/strike (E07), alignment horizontal and vertical (E10); the new text's measured width; „Nächste
/// Notiz“ is in `next_note.dart` (D40).
///
/// Owner: P2 (parity audit §4, rows C05, D40, E06–E07, E09–E10). Web: `editor/core/tools.tsx` (text),
/// `editor/core/contextActions.tsx` (`core.font`, `core.format`), `features/richtext/contextActions.tsx`
/// (`richtext.family`; underline/colors/lists of `core.format` are P8's).
void registerTextObject(BoardRegistry r) {
  r.creates['text'] = (editor, p, _) => newText(p);
  r.defineTool(
    ToolDef(
      id: 'text',
      label: 'Text',
      icon: Icons.title,
      order: 40,
      keyName: 'stachelToolText',
      hint: (_) => 'Tippe auf das Board: dort kommt der Text hin.',
      behavior: BoardToolBehavior(onTap: _textTap),
    ),
  );
  _family(r);
  _font(r);
  _format(r);
  // web TextView `onMeasured`: selected texts follow their drawn height (Abnahme F18/D32)
  r.defineOverlay(
    OverlayDef(id: 'text.remeasure', order: 1, build: (context, ui) => IgnorePointer(child: TextRemeasure(ui: ui))),
  );
}

/// A new text at [p] (web text `create`: 28 px, width of the placeholder).
Map<String, Object?> newText(Offset p) => {
  'type': 'text',
  'x': jsRoundP2(p.dx - 8),
  'y': jsRoundP2(p.dy - 18),
  'w': autoTextWidth(BoardObject(const {'id': '', 'type': 'text', 'fontSize': 28})),
  'h': 36,
  'fontSize': 28,
  'text': '',
  'color': '#0a0a0a',
  'autoWidth': true,
};

/// Text tool: on an existing (unlocked) text that one is edited instead of a new one on top (web C05).
void _textTap(BoardToolEvent e) {
  final editor = e.editor;
  final hit = e.objectId == null ? null : editor.controller.state[e.objectId!];
  if (hit != null && hit.type == 'text' && !hit.locked) {
    editor.tool = BoardTool.select;
    editor.select({hit.id});
    editor.startEditing(hit.id);
    return;
  }
  editor.create('text', e.world);
}

bool _allTextual(CtxInfo c, BoardUi ui) =>
    ui.editor.editable && !c.locked && c.selected.isNotEmpty && c.types.every(textTypes.contains);

List<BoardObject> _targets(CtxInfo c) => [
  for (final o in c.selected)
    if (textTypes.contains(o.type)) o,
];

/// Patch of the selected text objects, a text with `autoWidth` follows with its width (web `adjust`).
void _patchText(BoardUi ui, Map<String, Object?>? Function(BoardObject o) fn) => patchSelection(ui, (o) {
  if (!textTypes.contains(o.type)) return null;
  final p = fn(o);
  return p == null ? null : adjustTextPatch(o, p);
});

// ---- font (E09, web `richtext.family` · 29) ------------------------------------------------------------------------

BoardFonts _fonts(BoardUi ui) => ui.view?.widget.fonts ?? const BoardFonts();

void _family(BoardRegistry r) {
  r.defineContextAction(
    ContextActionDef(
      id: 'richtext.family',
      order: 29,
      section: CtxSection.text,
      appliesTo: _allTextual,
      items: (context, ui, c) {
        final f = fontOf(_targets(c).first.fontFamily);
        return [
          CtxItem(
            key: 'stachelCtxFamily',
            label: 'Schriftart: ${f.label}',
            leading: (_) => Text(
              'Aa',
              style: TextStyle(fontFamily: _fonts(ui).family(f.key), fontSize: 18, color: ui.theme.ink),
            ),
            onTap: (context, ui) => _pickFamily(context, ui, f.key),
          ),
        ];
      },
    ),
  );
}

Future<void> _pickFamily(BuildContext context, BoardUi ui, String current) async {
  final v = await ui.openSheet<String>(
    context,
    (ctx) => SafeArea(
      child: Column(
        key: const Key('stachelFamilySheet'),
        mainAxisSize: MainAxisSize.min,
        children: [
          p2SheetTitle(ui, 'SCHRIFTART'),
          for (final f in boardFonts)
            ListTile(
              key: Key('stachelFamily-${f.key}'),
              selected: f.key == current,
              title: Text(f.label, style: TextStyle(fontFamily: _fonts(ui).family(f.key), fontSize: 18)),
              trailing: f.key == current ? const Icon(Icons.check) : null,
              onTap: () => Navigator.of(ctx).pop(f.key),
            ),
        ],
      ),
    ),
  );
  if (v != null) _patchText(ui, (o) => {'fontFamily': v == 'barlow' ? null : v});
}

// ---- size (E06, web `core.font` · 30) -------------------------------------------------------------------------------

final _autoFont = Expando<double>('stickyAutoFont');

/// Font size a note without one shows (its automatic size, like the renderer).
double stickyAutoFontSize(BoardUi ui, BoardObject o) => _autoFont[o] ??=
    editTextBox(
      o,
      RenderContext(
        scene: ui.editor.scene,
        text: TextLayoutCache(maxEntries: 8),
        fonts: _fonts(ui),
        images: NoBoardImages(),
      ),
    )?.fontSize ??
    24;

/// What the size entry shows (web `fontInfo`): automatic for notes without a size, else the size.
({bool auto, double size}) fontInfo(BoardUi ui, CtxInfo c, {bool measure = false}) {
  final first = _targets(c).first;
  final auto = first.type == 'sticky' && first.fontSize == null;
  final size =
      first.fontSize ??
      (first.type == 'sticky'
          ? (c.single != null && measure ? stickyAutoFontSize(ui, c.single!) : 24)
          : (first.type == 'shape' ? 20 : 24));
  return (auto: auto, size: size);
}

String _fmt(double v) => v == v.roundToDouble() ? '${v.round()}' : '$v';

void _font(BoardRegistry r) {
  r.defineContextAction(
    ContextActionDef(
      id: 'core.font',
      order: 30,
      section: CtxSection.text,
      appliesTo: _allTextual,
      items: (context, ui, c) {
        final info = fontInfo(ui, c);
        void step(int dir) {
          final next = stepFontSize(fontInfo(ui, c, measure: true).size, dir);
          _patchText(ui, (o) => {'fontSize': next});
        }

        return [
          CtxItem(
            key: 'stachelCtxFontDown',
            label: 'Schrift kleiner',
            width: 40,
            leading: (_) => Text(
              'A',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: ui.theme.ink),
            ),
            onTap: (context, ui) => step(-1),
          ),
          CtxItem(
            key: 'stachelCtxFont',
            label: 'Schriftgröße wählen',
            width: 52,
            leading: (_) => Text(
              info.auto ? 'Auto' : _fmt(info.size.roundToDouble()),
              key: const Key('stachelCtxFontValue'),
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: ui.theme.ink),
            ),
            onTap: (context, ui) => _pickSize(context, ui, c),
          ),
          CtxItem(
            key: 'stachelCtxFontUp',
            label: 'Schrift größer',
            width: 40,
            leading: (_) => Text(
              'A',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: ui.theme.ink),
            ),
            onTap: (context, ui) => step(1),
          ),
        ];
      },
    ),
  );
}

Future<void> _pickSize(BuildContext context, BoardUi ui, CtxInfo c) async {
  final info = fontInfo(ui, c);
  final autoOk = _targets(c).every((o) => o.type == 'sticky');
  final v = await ui.openSheet<double>(
    context,
    (ctx) => SafeArea(
      child: Column(
        key: const Key('stachelFontSheet'),
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          p2SheetTitle(ui, 'SCHRIFTGRÖSSE'),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                if (autoOk)
                  ChoiceChip(
                    key: const Key('stachelFont-auto'),
                    label: const Text('Auto'),
                    selected: info.auto,
                    onSelected: (_) => Navigator.of(ctx).pop(-1.0),
                  ),
                for (final s in fontSizes)
                  ChoiceChip(
                    key: Key('stachelFont-${s.round()}'),
                    label: Text(_fmt(s)),
                    selected: !info.auto && info.size.round() == s.round(),
                    onSelected: (_) => Navigator.of(ctx).pop(s),
                  ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
  // notes without a size fit their text themselves (web „Auto“ = field removed)
  if (v != null) _patchText(ui, (o) => {'fontSize': v < 0 ? null : v});
}

// ---- bold / italic / strike, alignment (E07, E10, web `core.format` · 40) ----------------------------------------------

const _valignTypes = {'sticky', 'shape'};

void _format(BoardRegistry r) {
  r.defineContextAction(
    ContextActionDef(
      id: 'core.format',
      order: 40,
      section: CtxSection.text,
      appliesTo: _allTextual,
      items: (context, ui, c) {
        final targets = _targets(c);
        bool allOn(String k) => targets.every((o) => o.raw[k] == true);
        CtxItem toggle(String k, String key, String label, TextStyle style, String glyph) {
          final on = allOn(k);
          return CtxItem(
            key: key,
            label: label,
            width: 40,
            active: on,
            leading: (_) =>
                Text(glyph, style: style.copyWith(fontSize: 18, color: on ? ui.theme.accentDark : ui.theme.ink)),
            // on, unless all have it already (web: `on || undefined`)
            onTap: (context, ui) => _patchText(ui, (o) => {k: on ? null : true}),
          );
        }

        final first = targets.first;
        final align = first.align ?? (first.type == 'text' ? 'left' : 'center');
        return [
          toggle('bold', 'stachelCtxBold', 'Fett', const TextStyle(fontWeight: FontWeight.w800), 'B'),
          toggle(
            'italic',
            'stachelCtxItalic',
            'Kursiv',
            const TextStyle(fontStyle: FontStyle.italic, fontWeight: FontWeight.w600),
            'I',
          ),
          toggle(
            'strike',
            'stachelCtxStrike',
            'Durchgestrichen',
            const TextStyle(decoration: TextDecoration.lineThrough, fontWeight: FontWeight.w600),
            'S',
          ),
          CtxItem(
            key: 'stachelCtxAlign',
            label: 'Textausrichtung',
            icon: _alignIcons[align],
            onTap: (context, ui) => showAlignSheet(context, ui),
          ),
        ];
      },
    ),
  );
}

const _alignIcons = {
  'left': Icons.format_align_left,
  'center': Icons.format_align_center,
  'right': Icons.format_align_right,
};
const _valignIcons = {
  'top': Icons.vertical_align_top,
  'middle': Icons.vertical_align_center,
  'bottom': Icons.vertical_align_bottom,
};

/// Alignment sheet (web popover `talign`): left/center/right, and top/middle/bottom for notes and shapes; it stays
/// open like the web's (a new selection closes it).
Future<void> showAlignSheet(BuildContext context, BoardUi ui) => ui.openSheet<void>(
  context,
  (ctx) => SafeArea(
    child: ListenableBuilder(
      listenable: ui.controller,
      builder: (context, _) {
        final targets = [
          for (final o in ui.editor.selected)
            if (textTypes.contains(o.type)) o,
        ];
        if (targets.isEmpty) return const SizedBox.shrink();
        final first = targets.first;
        final align = first.align ?? (first.type == 'text' ? 'left' : 'center');
        final valign = first.valign ?? 'middle';
        return Column(
          key: const Key('stachelAlignSheet'),
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            p2SheetTitle(ui, 'TEXTAUSRICHTUNG'),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: Row(
                children: [
                  for (final (a, label) in const [
                    ('left', 'Linksbündig'),
                    ('center', 'Zentriert'),
                    ('right', 'Rechtsbündig'),
                  ])
                    P2FlyButton(
                      key: Key('stachelAlign-$a'),
                      label: label,
                      active: align == a,
                      onTap: () => patchSelection(ui, (o) => textTypes.contains(o.type) ? {'align': a} : null),
                      child: Icon(_alignIcons[a], color: ui.theme.ink),
                    ),
                  if (targets.every((o) => _valignTypes.contains(o.type))) ...[
                    const SizedBox(width: 16),
                    for (final (v, label) in const [('top', 'Oben'), ('middle', 'Mitte'), ('bottom', 'Unten')])
                      P2FlyButton(
                        key: Key('stachelVAlign-$v'),
                        label: label,
                        active: valign == v,
                        onTap: () => patchSelection(ui, (o) => _valignTypes.contains(o.type) ? {'valign': v} : null),
                        child: Icon(_valignIcons[v], color: ui.theme.ink),
                      ),
                  ],
                ],
              ),
            ),
          ],
        );
      },
    ),
  ),
);
