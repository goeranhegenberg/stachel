import '../../editor/board_editor.dart';
import '../../editor/registry/context_action_def.dart';
import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import '../../editor/registry/type_behavior.dart';
import 'board_hits.dart';
import 'whole.dart';

/// P8: Rich-Text-Rest – format for the whole object in the context bar (act `richtext.whole`: underline, text color,
/// highlight, list, link), check boxes and links on the board (act `richtext.toggleTask`, „Link öffnen?“). The
/// format bar while writing is `format_bar.dart` (the app shows it in its edit bar), the editor itself
/// (`editor/rich_text_field.dart`: bullets/numbers/boxes, Markdown shortcuts, Backspace/Enter in lists) and its
/// model (`model/rich_edit.dart`: paragraph styles, quote, code block, indent/outdent) belong to P8 as well.
///
/// Owner: P8 (parity audit §4, rows E08, F04, F06–F08, F11–F17, F19). Web: `features/richtext/contextActions.tsx`
/// (`core.format` · 40 – P2 defines it in the app, P8 adds its items like the web module replaces it),
/// `RichView.tsx`, `LinkConfirm.tsx`, `FormatBar.tsx`, `RichEdit.tsx`, `extras.ts`.
void registerRichtext(BoardRegistry r) {
  // core.format: the web's richtext module owns it; in the app P2 registered B/I/S/alignment – P8 adds its items in
  // the web's order (Unterstrichen after Kursiv, Textfarbe/Markierung/Liste before the alignment)
  final base = r.contextActions['core.format'];
  r.defineContextAction(
    ContextActionDef(
      id: 'core.format',
      order: base?.order ?? 40,
      section: CtxSection.text,
      appliesTo:
          base?.appliesTo ??
          (c, ui) => ui.editor.editable && !c.locked && c.selected.isNotEmpty && c.types.every(textTypes.contains),
      items: (context, ui, c) => mergeIntoCoreFormat([...?base?.items(context, ui, c)], ui, c),
    ),
  );
  // taps on check boxes and links in the text (before the type's own behavior)
  for (final type in textTypes) {
    final old = r.types[type];
    r.defineType(
      TypeBehavior(
        type: type,
        label: old?.label ?? type,
        edit: old?.edit ?? 'text',
        handles: old?.handles,
        describe: old?.describe,
        resize: old?.resize,
        onTap: (e) => richTap(e) || (old?.onTap?.call(e) ?? false),
        onDoubleTap: (e) => richDoubleTap(e) || (old?.onDoubleTap?.call(e) ?? false),
      ),
    );
  }
  r.defineOverlay(
    OverlayDef(
      id: 'richtext.links',
      order: 80,
      build: (context, ui) => LinkConfirmLayer(ui: ui),
    ),
  );
}
