import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../editor/board_editor.dart';
import '../../editor/registry/board_ui.dart';
import '../../editor/registry/type_behavior.dart';
import '../../model/board_object.dart';
import '../../model/rich_edit.dart';
import '../../model/rich_text.dart';
import '../../protocol/native_messages.dart';
import '../../render/board_images.dart';
import '../../render/object_renderers.dart';
import '../../render/text_layout.dart';

// P8, audit F13/F14: check boxes and links in the text on the board (outside editing), like the web's `RichView.tsx`
// and `LinkConfirm.tsx`: a tap on a check box ticks it (no selection, no editing, one undo step – act
// `richtext.toggleTask`; not when locked), a tap on a link asks „Link öffnen?“ (shortened address, Abbrechen /
// Öffnen; only http/https/mailto/tel) and opens it in the system browser. Hit-testing lays out the text exactly like
// the renderer (`richTextSpan`, `editTextBox`).

/// Something tappable in an object's text: check box number [task] (document order) or link [href].
class RichHit {
  const RichHit({this.task, this.href});
  final int? task;
  final String? href;
}

/// Ranges of the tappable parts in the plain text of [richTextSpan] (same offsets): check box glyphs and links.
List<({int start, int end, int? task, String? href})> richTargetsOf(RichDoc doc) {
  final out = <({int start, int end, int? task, String? href})>[];
  var at = 0, task = 0;
  for (var i = 0; i < doc.blocks.length; i++) {
    final b = doc.blocks[i];
    if (i > 0) at += 1;
    final indent = ' ' * b.depth; // em spaces like `richTextSpan`
    final prefix = switch (b.kind) {
      _ when b.continuation => '$indent ',
      RichBlockKind.bullet => '$indent• ',
      RichBlockKind.ordered => '$indent${b.index}. ',
      RichBlockKind.task => indent,
      RichBlockKind.quote => '$indent▎ ',
      RichBlockKind.rule => '$indent——————',
      _ => indent,
    };
    at += prefix.length;
    if (b.kind == RichBlockKind.task && !b.continuation) {
      out.add((start: at, end: at + 1, task: task++, href: null));
      at += 2;
    }
    for (final r in b.runs) {
      final href = r.marks.link == null ? null : safeLink(r.marks.link!);
      if (href != null && r.text.isNotEmpty) out.add((start: at, end: at + r.text.length, task: null, href: href));
      at += r.text.length;
    }
  }
  return out;
}

/// A link target the board opens (web `safeHref`: a full URL with http/https/mailto/tel), else null.
String? safeLink(String href) {
  final s = href.trim();
  if (!RegExp(r'^[a-z][a-z0-9+.-]*:', caseSensitive: false).hasMatch(s)) return null;
  return normalizeHref(s);
}

/// Short display of a link (web `shortHref`): without `https://`/`mailto:`, without trailing slash, cut to [max].
String shortHref(String href, [int max = 48]) {
  final s = href
      .replaceFirst(RegExp(r'^https?://'), '')
      .replaceFirst(RegExp(r'^mailto:'), '')
      .replaceFirst(RegExp(r'/$'), '');
  return s.length > max ? '${s.substring(0, max - 1)}…' : s;
}

/// What is at [world] in [o]'s text (null = nothing tappable).
RichHit? richHitAt(BoardObject o, Offset world, RenderContext ctx) {
  if (!textTypes.contains(o.type)) return null;
  final rich = o.richText;
  if (rich == null) return null;
  final targets = richTargetsOf(rich);
  if (targets.isEmpty) return null;
  final box = editTextBox(o, ctx);
  if (box == null) return null;
  // into the object's own (unrotated) coordinates
  final c = Offset(o.x + o.w / 2, o.y + o.h / 2);
  final rad = -o.rotation * math.pi / 180;
  final d = world - c;
  final p =
      Offset(d.dx * math.cos(rad) - d.dy * math.sin(rad), d.dx * math.sin(rad) + d.dy * math.cos(rad)) +
      Offset(o.w / 2, o.h / 2);
  final isText = o.type == 'text';
  final maxW = isText ? (o.autoWidth ? double.infinity : math.max(1.0, o.w)) : math.max(1.0, box.box.width);
  final tp = TextPainter(
    text: objectTextSpan(o, fontSize: box.fontSize, color: box.color, fonts: ctx.fonts, weight: box.weight),
    textAlign: box.align,
    textDirection: TextDirection.ltr,
    textWidthBasis: TextWidthBasis.parent,
  )..layout(minWidth: box.align == TextAlign.left || !maxW.isFinite ? 0 : maxW, maxWidth: maxW);
  try {
    final area = isText ? Rect.fromLTWH(0, 0, math.max(o.w, tp.width), math.max(o.h, tp.height)) : box.box;
    final valign = isText ? 'top' : box.valign;
    final dy = switch (valign) {
      'middle' => (area.height - tp.height) / 2,
      'bottom' => area.height - tp.height,
      _ => 0.0,
    };
    final q = p - Offset(area.left, area.top + dy);
    for (final t in targets) {
      // check boxes get a bit more room for the finger
      final slop = t.task != null ? box.fontSize * 0.3 : 1.0;
      for (final b in tp.getBoxesForSelection(TextSelection(baseOffset: t.start, extentOffset: t.end))) {
        if (b.toRect().inflate(slop).contains(q)) return RichHit(task: t.task, href: t.href);
      }
    }
    return null;
  } finally {
    tp.dispose();
  }
}

/// A link waiting for „Öffnen“ (screen point of the tap).
class LinkAsk {
  const LinkAsk(this.href, this.at);
  final String href;
  final Offset at;
}

final _asks = Expando<ValueNotifier<LinkAsk?>>('richLinkAsk');
final _uis = Expando<BoardUi>('richUi');

/// The pending „Link öffnen?“ of [editor].
ValueNotifier<LinkAsk?> linkAskOf(BoardEditor editor) => _asks[editor] ??= ValueNotifier<LinkAsk?>(null);

/// The board UI of [editor] (set by the overlay; the type taps need fonts and the host).
void rememberUi(BoardUi ui) => _uis[ui.editor] = ui;

RenderContext _ctxFor(BoardEditor editor) => RenderContext(
  scene: editor.scene,
  text: TextLayoutCache(maxEntries: 4),
  fonts: _uis[editor]?.view?.widget.fonts ?? const BoardFonts(),
  images: NoBoardImages(),
);

/// Ticks check box [index] of [o] (preview at once, the server runs the web's `toggleTask`).
void toggleTaskOnBoard(BoardEditor editor, BoardObject o, int index) {
  final doc = RichEditDoc.forObject(o.raw['content'], o.text);
  final preview = doc.toggleTaskAt(index);
  editor.controller.act(
    'richtext.toggleTask',
    {'id': o.id, 'index': index},
    label: 'Abhaken',
    predicted: [
      if (preview)
        UpdateOp({
          o.id: {'content': doc.toJson()},
        }),
    ],
  );
}

/// Tap on a sticky/text/shape (before the default): a check box ticks without selecting, a link asks to open.
bool richTap(TypeTapEvent e) {
  final o = e.object;
  final hit = richHitAt(o, e.world, _ctxFor(e.editor));
  if (hit == null) return false;
  if (hit.task != null) {
    if (o.locked || !e.editor.editable || !e.editor.controller.canAct('richtext.toggleTask')) return false;
    toggleTaskOnBoard(e.editor, o, hit.task!);
    return true;
  }
  final href = hit.href;
  if (href == null) return false;
  e.editor.select(e.editor.groupOf(o.id));
  linkAskOf(e.editor).value = LinkAsk(href, e.screen);
  return true;
}

/// Double tap: the second tap on a check box ticks again (two quick clicks in the web, no editing); on a link it
/// starts editing like the web's double click (the question goes away).
bool richDoubleTap(TypeTapEvent e) {
  linkAskOf(e.editor).value = null;
  final o = e.object;
  final hit = richHitAt(o, e.world, _ctxFor(e.editor));
  if (hit?.task == null || o.locked || !e.editor.editable || !e.editor.controller.canAct('richtext.toggleTask')) {
    return false;
  }
  toggleTaskOnBoard(e.editor, o, hit!.task!);
  return true;
}

/// Overlay „Link öffnen?“ (web `LinkConfirm`): near the tap, Abbrechen / Öffnen; any touch elsewhere closes it.
class LinkConfirmLayer extends StatelessWidget {
  const LinkConfirmLayer({super.key, required this.ui});
  final BoardUi ui;

  @override
  Widget build(BuildContext context) {
    rememberUi(ui);
    final ask = linkAskOf(ui.editor);
    return ValueListenableBuilder<LinkAsk?>(
      valueListenable: ask,
      builder: (context, a, _) {
        if (a == null) return const SizedBox.shrink();
        return LayoutBuilder(
          builder: (context, box) {
            const w = 280.0, h = 132.0;
            final left = (a.at.dx - w / 2).clamp(8.0, math.max(8.0, box.maxWidth - w - 8)).toDouble();
            final top = a.at.dy + 14 + h > box.maxHeight - 8 ? a.at.dy - h - 14 : a.at.dy + 14;
            return Stack(
              children: [
                Positioned.fill(
                  child: Listener(behavior: HitTestBehavior.translucent, onPointerDown: (_) => ask.value = null),
                ),
                Positioned(
                  left: left,
                  top: math.max(8.0, top),
                  width: w,
                  child: Semantics(
                    scopesRoute: true,
                    namesRoute: true,
                    explicitChildNodes: true,
                    label: 'Link öffnen?',
                    child: Material(
                      key: const Key('stachelLinkConfirm'),
                      elevation: 6,
                      color: ui.theme.surface,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                        side: BorderSide(color: ui.theme.ink, width: 2),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(14, 12, 8, 6),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Link öffnen?', style: ui.theme.label(size: 15)),
                            const SizedBox(height: 4),
                            Text(
                              shortHref(a.href, 56),
                              key: const Key('stachelLinkConfirmUrl'),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(color: ui.theme.grey),
                            ),
                            OverflowBar(
                              alignment: MainAxisAlignment.end,
                              children: [
                                TextButton(
                                  key: const Key('stachelLinkConfirmCancel'),
                                  onPressed: () => ask.value = null,
                                  child: const Text('ABBRECHEN'),
                                ),
                                FilledButton.icon(
                                  key: const Key('stachelLinkConfirmOpen'),
                                  icon: const Icon(Icons.open_in_new, size: 18),
                                  label: const Text('ÖFFNEN'),
                                  onPressed: () {
                                    ask.value = null;
                                    ui.host.openUrl(a.href);
                                  },
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            );
          },
        );
      },
    );
  }
}
