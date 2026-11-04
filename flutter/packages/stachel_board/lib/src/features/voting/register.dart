import 'dart:async';

import 'package:flutter/material.dart';

import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import '../follow/collab_common.dart';
import 'vote_model.dart';
import 'vote_views.dart';

/// P5: Abstimmung (act `collab.vote.*`).
///
/// Owner: P5 (parity audit §4, rows L07–L11). Only this directory (`features/voting/`, tests `test/features/voting/`)
/// belongs to the package; core files change only through the registries and `act`.
///
/// Entries (web id · order):
/// - Board-Menü `collab.vote` · 40 („Abstimmung starten“ / „Abstimmung läuft …“ / „Ergebnis der Abstimmung“),
///   `collab.voteHistory` · 41 („Frühere Abstimmungen“)
/// - Overlay `collab.votes` · 6 (targets, badges, totals; not while presenting); the bar sits in `collab.notices`
void registerVoting(BoardRegistry r) {
  r.defineOverlay(
    OverlayDef(
      id: 'collab.votes',
      order: 6,
      build: (context, ui) => VoteLayer(ui: ui),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'collab.vote',
      on: MenuTarget.board,
      // web 40 like „Raster anzeigen“; the web registers collab first, so it comes first (Abnahme B09)
      order: 39.9,
      section: MenuSection.collab,
      entry: (ui, at) {
        if (!ui.controller.canAct('collab.vote.start') || !ui.controller.loaded) return null;
        final s = readVoteSession(ui.controller.state.ext[extVote]);
        if (s != null && !s.ended) {
          return const MenuEntry(
            key: 'collabMenuVote',
            label: 'Abstimmung läuft …',
            icon: Icons.how_to_vote_outlined,
            disabled: true,
          );
        }
        return MenuEntry(
          key: 'collabMenuVote',
          label: s != null ? 'Ergebnis der Abstimmung' : 'Abstimmung starten',
          icon: Icons.how_to_vote_outlined,
          disabled: s == null && !ui.controller.mayEdit,
          onSelect: (context, ui) =>
              unawaited(s != null ? showVoteResults(context, ui, id: s.id) : showVoteStart(context, ui)),
        );
      },
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'collab.voteHistory',
      on: MenuTarget.board,
      order: 41,
      section: MenuSection.collab,
      entry: (ui, at) => readVoteHistory(ui.controller.state.ext[extVoteHistory]).isEmpty
          ? null
          : MenuEntry(
              key: 'collabMenuVoteHistory',
              label: 'Frühere Abstimmungen',
              icon: Icons.history,
              onSelect: (context, ui) => unawaited(showVoteResults(context, ui)),
            ),
    ),
  );
}
