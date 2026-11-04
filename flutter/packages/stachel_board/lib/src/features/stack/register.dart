import 'package:flutter/material.dart';

import '../../editor/registry/context_action_def.dart';
import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import 'stack_model.dart';
import 'stack_widgets.dart';

/// Q2 Notiz-Stapel (web `features/shapes/stack/`): drop a note in the middle of another → stack (act
/// `shapes.stackDrop` after the move, only when it can change something), count badge with ‹ › and swipe (overlay),
/// context bar for a whole stack (Vorige/Nächste Notiz, Auffächern, Oberste abnehmen) or one note of it (Vom Stapel
/// nehmen). Owner: Q2; only this directory (`features/stack/`, tests `test/features/stack/`).
///
/// Entries (web id · order): context action `shapes.stack` · 22, overlay `shapes.stacks` · 40, an [BoardRegistry.afterMoves]
/// hook.
void registerStack(BoardRegistry r) {
  r.afterMoves.add((editor, ids, grabbed) {
    final c = editor.controller;
    if (!editor.editable || !c.canAct('shapes.stackDrop') || ids.isEmpty || ids.length > stackMax) return;
    final moved = [for (final id in ids) ?c.state[id]];
    if (!dropMatters(moved, c.state, grabbed)) return;
    c.act('shapes.stackDrop', {'ids': ids, 'grabbed': ?grabbed}, label: 'Stapel');
  });
  r.defineOverlay(OverlayDef(id: 'shapes.stacks', order: 40, build: (context, ui) => StackBadges(ui: ui)));
  r.defineContextAction(
    ContextActionDef(
      id: 'shapes.stack',
      order: 22,
      section: CtxSection.arrange,
      appliesTo: (c, ui) => !c.locked && c.only('sticky') && canStack(ui) && c.selected.any(inStack),
      items: (context, ui, c) {
        final s = stackSelection(ui, c.selected);
        final whole = s.whole;
        final id = (whole?.first ?? s.one)?.id;
        if (id == null) return const [];
        return [
          if (whole != null) ...[
            CtxItem(
              key: 'stachelCtxStackPrev',
              label: 'Vorige Notiz',
              short: 'Vorige',
              icon: Icons.chevron_left,
              onTap: (context, ui) => cycleStack(ui, id, -1),
            ),
            CtxItem(
              key: 'stachelCtxStackNext',
              label: 'Nächste Notiz (${whole.length} im Stapel)',
              short: 'Nächste',
              icon: Icons.chevron_right,
              onTap: (context, ui) => cycleStack(ui, id, 1),
            ),
            CtxItem(
              key: 'stachelCtxStackSpread',
              label: 'Stapel auffächern',
              short: 'Auffächern',
              icon: Icons.grid_view,
              onTap: (context, ui) => spreadStack(ui, id),
            ),
          ],
          CtxItem(
            key: 'stachelCtxStackTake',
            label: whole != null ? 'Oberste Notiz abnehmen' : 'Vom Stapel nehmen',
            short: 'Abnehmen',
            icon: Icons.move_up,
            onTap: (context, ui) => takeFromStack(ui, id, which: s.one?.id),
          ),
        ];
      },
    ),
  );
}
