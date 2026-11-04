import 'dart:async';

import 'package:flutter/material.dart';

import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/registry.dart';
import '../follow/collab_common.dart';
import 'timer_model.dart';
import 'timer_views.dart';

/// P5: Timer für alle (act `collab.timer.*`), Ton/Vibration.
///
/// Owner: P5 (parity audit §4, row L12). Only this directory (`features/timer/`, tests `test/features/timer/`) belongs
/// to the package; core files change only through the registries and `act`.
///
/// Entries (web id · order):
/// - Board-Menü `collab.timer` · 45 („Timer für alle: 5 Min.“ / „Timer beenden“), `collab.timerSet` · 45.5 „Timer
///   einstellen …“ (the web's popover at the timer button, which a phone has no room for)
/// - The chip and „Zeit ist um!“ sit in the overlay `collab.notices` (features/follow).
void registerTimer(BoardRegistry r) {
  r.defineMenuItem(
    MenuItemDef(
      id: 'collab.timer',
      on: MenuTarget.board,
      order: 45,
      section: MenuSection.collab,
      entry: (ui, at) {
        // role view/comment: the timer writes to the board – hidden like the web's collab bar (ReadOnlyGuard)
        if (!ui.controller.canAct('collab.timer.start') || !ui.controller.loaded || !ui.controller.mayEdit) return null;
        final rt = TimerRuntime.of(ui);
        if (timerView(rt.timer, CollabSession.of(ui).now) != TimerView.idle) {
          return MenuEntry(
            key: 'collabMenuTimer',
            label: 'Timer beenden',
            icon: Icons.timer_off_outlined,
            onSelect: (_, ui) => unawaited(TimerRuntime.of(ui).act('stop')),
          );
        }
        return MenuEntry(
          key: 'collabMenuTimer',
          label: 'Timer für alle: 5 Min.',
          icon: Icons.timer_outlined,
          onSelect: (_, ui) => unawaited(TimerRuntime.of(ui).act('start', {'ms': 5 * 60000})),
        );
      },
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'collab.timerSet',
      on: MenuTarget.board,
      order: 45.5,
      section: MenuSection.collab,
      entry: (ui, at) => !ui.controller.canAct('collab.timer.start') || !ui.controller.loaded || !ui.controller.mayEdit
          ? null
          : MenuEntry(
              key: 'collabMenuTimerSet',
              label: 'Timer einstellen …',
              icon: Icons.more_time,
              onSelect: (context, ui) => unawaited(showTimerSheet(context, ui)),
            ),
    ),
  );
}
