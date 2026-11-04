import 'dart:async';

import 'package:flutter/material.dart';

import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import 'gesture_onboarding.dart';

/// UX P5 (B5): gesture introduction on the first board of the device (overlay that opens it) and „Gesten-Einführung“
/// in the board menu right after „Gesten“ (section „MEHR“ in the grouped phone menu, UX P7). Phone only – the
/// web has mouse and keyboard and its shortcut overview.
///
/// Owner: UX-A2 (Welle UX+Q).
void registerOnboarding(BoardRegistry r) {
  r.defineOverlay(
    OverlayDef(
      id: 'onboarding.gestures',
      order: 1000,
      build: (context, ui) => GestureOnboardingTrigger(ui: ui),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'onboarding.gestures',
      on: MenuTarget.board,
      order: 90.5,
      section: MenuSection.more,
      entry: (ui, at) => MenuEntry(
        key: 'stachelBoardOnboarding',
        label: 'Gesten-Einführung',
        icon: Icons.school_outlined,
        onSelect: (context, ui) => unawaited(showGestureOnboarding(context, ui)),
      ),
    ),
  );
}
