import 'package:flutter/material.dart';

import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import 'author.dart';
import 'collab_notices.dart';
import 'follow.dart';

/// P5: Folgen, Alle zu mir holen, Status (Presence `collab.status`/`collab.follow`/`collab.summon` über `presence.setExtra`).
///
/// Owner: P5 (parity audit §4, rows B03, L13–L16, L20; L02 comment pin drag). Only this directory (`features/follow/`,
/// tests `test/features/follow/`) belongs to the package; core files change only through the registries and `act`.
///
/// Entries (web id · order):
/// - Board-Menü `collab.summon` · 50
/// - Overlays `collab.authors` · 4 (Board-Einstellung „Autor:in an Haftnotizen zeigen“), `collab.author` · 5, `collab.follow` · 30 (presenting), `collab.notices` · 40 (presenting: vote bar,
///   following, timer – web `Notices`)
/// - Ziehbarer Kommentar-Pin (`overlayDrops['comment']` → act `collab.commentMove`)
/// - The avatars of the app bar: [CollabPresenceBar] (`presence_bar.dart`, the app puts it into its title bar)
void registerFollow(BoardRegistry r) {
  r.defineOverlay(
    OverlayDef(
      id: 'collab.author',
      order: 5,
      build: (context, ui) => AuthorLabel(ui: ui),
    ),
  );
  r.defineOverlay(
    OverlayDef(
      id: 'collab.authors',
      order: 4,
      build: (context, ui) => AuthorLabels(ui: ui),
    ),
  );
  r.defineOverlay(
    OverlayDef(
      id: 'collab.follow',
      order: 30,
      presenting: true,
      build: (context, ui) => FollowLayer(ui: ui),
    ),
  );
  r.defineOverlay(
    OverlayDef(
      id: 'collab.notices',
      order: 40,
      presenting: true,
      build: (context, ui) => CollabNotices(ui: ui),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'collab.summon',
      on: MenuTarget.board,
      order: 50,
      section: MenuSection.collab,
      entry: (ui, at) => !ui.controller.features.contains('extra')
          ? null
          : MenuEntry(
              key: 'collabMenuSummon',
              label: 'Alle zu mir holen',
              icon: Icons.group_add_outlined,
              disabled: ui.controller.peers.isEmpty,
              onSelect: (_, ui) => summonAll(ui),
            ),
    ),
  );
  // L02: hold a comment pin and drag it = re-pin it (web moveThread(anchorAt(…)), one undo step)
  r.overlayDrops['comment'] = (editor, ref, world, objectId) {
    final c = editor.controller;
    if (!c.canAct('collab.commentMove')) return null;
    return c
        .act('collab.commentMove', {
          'thread': ref,
          'x': world.dx,
          'y': world.dy,
          'objectId': ?objectId,
        }, label: 'Kommentar verschieben')
        .then((_) {});
  };
}
