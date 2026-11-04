import 'package:flutter/material.dart';

import '../../editor/board_editor.dart';
import '../../editor/registry/board_ui.dart';
import '../../editor/registry/context_action_def.dart';
import '../../editor/registry/registry.dart';
import '../../editor/registry/tool_def.dart';
import '../../model/board_source.dart';
import '../../protocol/native_messages.dart';
import '../shapes/library.dart';
import '../shapes/shape_state.dart';
import '../shapes/shape_widgets.dart';
import 'sticker_data.dart';
import 'sticker_widgets.dart';

/// P2: sticker tool (stamps stay active for stamping several times; emoji/icon once and selected), its options (8
/// stamps, 4 recent emoji, the picked icon, „Alle Sticker und Icons“), the icon's line width.
///
/// Owner: P2 (parity audit §4, rows C16, E14, J03–J05; the library sheet with the emoji and icons is in
/// `features/shapes/library.dart`). Web: `features/shapes/stickers.tsx`, `stamps.tsx`, `emoji.ts`, `iconSet.ts`.
void registerStickers(BoardRegistry r) {
  r.defineTool(
    ToolDef(
      id: 'shapes.sticker',
      label: 'Sticker',
      icon: Icons.emoji_emotions_outlined,
      order: 85,
      phone: ToolPlace.more,
      once: false,
      moreKey: 'stachelMoreSticker',
      subtitle: 'Sticker, Stempel und Icons',
      hint: (ui) => switch (P2Tools.of(ui.editor).sticker) {
        StampItem() => 'Tippe aufs Board, um zu stempeln.',
        _ => 'Tippe auf das Board: dort kommt der Sticker hin.',
      },
      behavior: BoardToolBehavior(onTap: (e) => _place(e)),
      options: (context, ui) => StickerToolOptions(ui: ui),
    ),
  );
  r.defineContextAction(
    ContextActionDef(
      id: 'shapes.iconStroke',
      order: 55,
      section: CtxSection.style,
      appliesTo: (c, ui) => ui.editor.editable && !c.locked && c.only('icon'),
      items: (context, ui, c) => [
        for (final w in iconWidths)
          CtxItem(
            key: 'stachelIconStroke-${_label(w)}',
            label: 'Strichstärke ${_label(w)}',
            width: 40,
            active: (c.first.strokeWidth ?? 2) == w,
            leading: (_) => Container(
              width: w * 3 + 2,
              height: w * 3 + 2,
              decoration: BoxDecoration(color: ui.theme.ink, shape: BoxShape.circle),
            ),
            onTap: (context, ui) =>
                patchSelection(ui, (o) => o.type == 'icon' ? {'strokeWidth': w == 2 ? null : w} : null),
          ),
      ],
    ),
  );
}

/// Line widths of icons (web `ICON_WIDTHS`).
const iconWidths = [1.0, 1.5, 2.0, 2.5, 3.0];

String _label(double w) => w == w.roundToDouble() ? '${w.round()}' : '$w'.replaceAll('.', ',');

/// Places the sticker tool's item at the tap (web `place`): a stamp keeps the tool (stamping several times, nothing
/// selected), emoji and icons are selected and the tool goes back to Auswahl. Emoji are remembered as recently used.
void _place(BoardToolEvent e) {
  final editor = e.editor;
  if (!editor.editable) return;
  final ui = P2Tools.of(editor).ui;
  final item = P2Tools.of(editor).sticker;
  if (item is EmojiItem) RecentEmoji.remember(item.ch, ui?.host.writeSetting ?? (_, _) async {});
  final id = BoardController.newId();
  editor.controller.apply([
    CreateOp([
      {'id': id, ...stickerObjectFor(item, e.world.dx, e.world.dy)},
    ]),
  ]);
  if (item is StampItem) return;
  editor.tool = BoardTool.select;
  editor.select({id});
}

/// Options of the sticker tool (web `StickerOptions`).
class StickerToolOptions extends StatefulWidget {
  const StickerToolOptions({super.key, required this.ui});
  final BoardUi ui;

  @override
  State<StickerToolOptions> createState() => _StickerToolOptionsState();
}

class _StickerToolOptionsState extends State<StickerToolOptions> {
  BoardUi get ui => widget.ui;

  @override
  void initState() {
    super.initState();
    P2Tools.of(ui.editor).ui = ui;
    RecentEmoji.load(ui.host.readSetting).then((_) {
      if (mounted) setState(() {});
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = P2Tools.of(ui.editor);
    return ListenableBuilder(
      listenable: t,
      builder: (context, _) {
        final item = t.sticker;
        Widget button(PlaceItem i, String label, {double size = 26}) => P2FlyButton(
          key: Key('stachelSticker-${i.key}'),
          label: label,
          active: item == i,
          onTap: () => t.sticker = i,
          child: StickerItemPreview(i, size: size, color: ui.theme.ink),
        );
        return P2OptionStrip(
          key: const Key('stachelStickerOptions'),
          ui: ui,
          children: [
            for (final s in stamps) button(StampItem(s.id), 'Stempel ${s.label}'),
            for (final ch in RecentEmoji.list.take(4)) button(EmojiItem(ch), 'Emoji $ch', size: 24),
            if (item case final IconItem i) button(i, 'Icon ${i.icon.label}', size: 22),
            P2FlyButton(
              key: const Key('stachelStickerAll'),
              label: 'Alle Sticker und Icons',
              onTap: () => openLibrary(context, ui, 'stickers'),
              child: Icon(Icons.search, color: ui.theme.ink),
            ),
          ],
        );
      },
    );
  }
}
