import 'dart:async';

import 'package:flutter/material.dart';

import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import 'private_model.dart';
import 'private_views.dart';

/// Privater Modus (docs/features/private.md §1, §5; web module `private`).
///
/// Only this directory (`features/private/`, tests `test/features/private/`) belongs to the module; the core knows
/// the own private objects ([BoardController.privateObjects], native message `private`).
///
/// Entries (id · order):
/// - Board-Menü `private.mode` · 42 (Zusammenarbeit): „Privater Modus …“ (sheet) / „Privaten Modus aufdecken“
/// - Overlays `private.placeholders` · 4 (presenting), `private.lock` · 4.5, `private.banner` · 41,
///   `private.countdown` · 120 (presenting)
void registerPrivate(BoardRegistry r) {
  r.defineOverlay(
    OverlayDef(
      id: 'private.placeholders',
      order: 4,
      presenting: true,
      build: (context, ui) => PrivatePlaceholderLayer(ui: ui),
    ),
  );
  r.defineOverlay(
    OverlayDef(
      id: 'private.lock',
      order: 4.5,
      build: (context, ui) => PrivateLockChips(ui: ui),
    ),
  );
  r.defineOverlay(
    OverlayDef(
      id: 'private.banner',
      order: 41,
      build: (context, ui) => PrivateBanner(ui: ui),
    ),
  );
  r.defineOverlay(
    OverlayDef(
      id: 'private.countdown',
      order: 120,
      presenting: true,
      build: (context, ui) => PrivateCountdown(ui: ui),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'private.mode',
      on: MenuTarget.board,
      order: 42,
      section: MenuSection.collab,
      entry: (ui, at) {
        final c = ui.controller;
        if (!c.privateFeature || !c.loaded || privateHost(ui) == null || !c.mayEdit) return null;
        final m = privateModeOf(ui);
        if (!m.on) {
          return MenuEntry(
            key: 'privateMenuStart',
            label: 'Privater Modus …',
            short: 'Privat',
            icon: Icons.lock_outline,
            onSelect: (context, ui) => unawaited(showPrivateStart(context, ui)),
          );
        }
        if (!canRevealAll(ui, m)) {
          final who = m.byName;
          return MenuEntry(
            key: 'privateMenuReveal',
            label: 'Privater Modus läuft',
            subtitle: who == null ? null : 'Aufdecken kann $who',
            icon: Icons.lock_outline,
            disabled: true,
          );
        }
        final session = PrivateSession.of(ui);
        return MenuEntry(
          key: 'privateMenuReveal',
          label: 'Privaten Modus aufdecken',
          short: 'Aufdecken',
          icon: Icons.lock_open_outlined,
          items: [
            MenuEntry(
              key: 'privateMenuRevealCountdown',
              label: 'Mit Countdown ($privateRevealCountdown s)',
              icon: Icons.timer_outlined,
              onSelect: (_, _) => unawaited(session.run('reveal', {'countdown': privateRevealCountdown})),
            ),
            MenuEntry(
              key: 'privateMenuRevealNow',
              label: 'Sofort aufdecken',
              icon: Icons.lock_open_outlined,
              onSelect: (_, _) => unawaited(session.run('reveal', {'countdown': 0})),
            ),
          ],
        );
      },
    ),
  );
}
