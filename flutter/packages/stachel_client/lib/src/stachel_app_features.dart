import 'package:flutter/material.dart';
import 'package:stachel_board/stachel_board.dart';

import 'stachel_client_base.dart';
import 'stachel_moderation.dart';
import 'stachel_offline.dart';
import 'stachel_offline_sheet.dart';
import 'stachel_photos.dart';

// The app's own entries of the board registries (F2): what needs the app's services – image picker and
// upload, comments with @mentions, dialogs for titles and labels, the board's REST rename. The package's core and
// feature entries come from `standardBoardRegistry()`; these sit between them by `order` like the web's.

/// Services of the board screen for the app's entries (the screen's state implements it).
abstract class StachelAppHost extends BoardHost {
  const StachelAppHost();

  /// „Bild“: camera or gallery (asked when [source] is null), then upload (E3).
  Future<void> pickImage({StachelPhotoSource? source});

  /// Comment on the selected object (pinned at its top right corner).
  Future<void> commentOnSelection();

  /// A new comment at a board point (menu „Hier kommentieren“).
  Future<void> commentAt(Offset world);

  /// Label of the selected connector / title of the selected frame (dialogs).
  Future<void> editConnectorLabel();
  Future<void> renameFrame();

  /// Board menu: frames list, comment list, pins on/off, rename the board.
  Future<void> showFrames();
  Future<void> showComments();
  void togglePins();
  bool get pinsShown;
  int get openThreads;

  /// Unread mentions of me (web counter: „@“ / „@2“ instead of the number of open threads).
  int get unreadMentions => 0;
  Future<void> renameBoard();

  /// „Teilen …“ (instances with own accounts, [StachelClient.showsRoles]): the sharing sheet of this board.
  Future<void> shareBoard() async {}

  /// „Link öffnen?“ → Öffnen (P8): the link from a text on the board in the system browser.
  @override
  Future<void> openUrl(String url) async {
    final uri = Uri.tryParse(url);
    if (uri != null) await launchExternal(uri);
  }
}

StachelAppHost? _host(BoardUi ui) => ui.host is StachelAppHost ? ui.host as StachelAppHost : null;

/// Services of the board screen for an app's own extras (e.g. a host app's „Als Aufgabe anlegen“).
mixin StachelClientHost on BoardHost {
  /// The app around ([StachelClient.services] has the app's own services).
  StachelClient get client;

  /// Board title (e.g. for a back link text).
  String get boardTitle;

  /// Stachel origin for links (`/b/<id>?o=<obj>`).
  String get stachelBase;
}

/// The registry of a board screen without app extras: everything of `stachel_board` plus the shared app entries
/// (built once). An app with extras builds its own (`registerStachelAppFeatures(standardBoardRegistry())` plus its
/// entries) and returns it from [StachelClient.registry].
final BoardRegistry stachelBoardRegistry = registerStachelAppFeatures(standardBoardRegistry());

BoardRegistry registerStachelAppFeatures(BoardRegistry r) {
  // ---- tools ----------------------------------------------------------------------------------------------------
  r.defineTool(
    ToolDef(
      id: 'image',
      // P7: like the web's core tool after `documents` replaced its label – the file choice takes PDFs too
      label: 'Bild einfügen (auch PDF)',
      shortLabel: 'BILD',
      icon: Icons.add_photo_alternate_outlined,
      order: 100,
      keyName: 'stachelToolImage',
      available: (ui) => _host(ui) != null,
      onPick: pickStachelMedia,
    ),
  );
  r.defineTool(
    ToolDef(
      id: 'collab.comment',
      label: 'Kommentar',
      icon: Icons.add_comment_outlined,
      order: 110,
      tool: BoardTool.comment,
      keyName: 'stachelToolComment',
      moreKey: 'stachelMoreComment',
      subtitle: 'Tippe auf ein Objekt oder eine freie Stelle',
      hint: (_) => 'Tippe auf ein Objekt oder eine freie Stelle für den Kommentar.',
      available: (ui) => _host(ui) != null,
    ),
  );

  // ---- context bar ----------------------------------------------------------------------------------------------
  r.defineContextAction(
    ContextActionDef(
      id: 'app.frameTitle',
      order: 22.5,
      section: CtxSection.content,
      appliesTo: (c, ui) => _host(ui) != null && ui.editor.editable && !c.locked && c.single?.type == 'frame',
      items: (context, ui, c) => [
        CtxItem(
          key: 'stachelCtxFrameTitle',
          primary: true,
          short: 'Titel',
          label: 'Rahmen benennen',
          icon: Icons.title,
          onTap: (_, ui) => _host(ui)!.renameFrame(),
        ),
      ],
    ),
  );
  r.defineContextAction(
    ContextActionDef(
      id: 'app.connectorLabel',
      order: 50.5,
      section: CtxSection.text,
      appliesTo: (c, ui) => _host(ui) != null && ui.editor.editable && !c.locked && c.single?.type == 'connector',
      items: (context, ui, c) => [
        CtxItem(
          key: 'stachelCtxLabel',
          primary: true,
          short: 'Text',
          label: 'Beschriftung',
          icon: Icons.label_outline,
          onTap: (_, ui) => _host(ui)!.editConnectorLabel(),
        ),
      ],
    ),
  );
  // E3: react (several objects too) and comment, also on locked objects (like the web)
  r.defineContextAction(
    ContextActionDef(
      id: 'collab.react',
      order: 85,
      section: CtxSection.collab,
      appliesTo: (c, ui) => ui.editor.editable && c.selected.isNotEmpty, // web: every selection, connectors too
      items: (context, ui, c) => [
        CtxItem(
          key: 'stachelCtxReact',
          label: 'Reagieren',
          icon: Icons.add_reaction_outlined,
          onTap: (context, ui) async {
            final e = await pickReactionEmoji(context, ui);
            if (e != null) ui.editor.toggleReaction([for (final o in c.selected) o.id], e);
          },
        ),
      ],
    ),
  );
  r.defineContextAction(
    ContextActionDef(
      id: 'collab.comment',
      order: 86,
      section: CtxSection.collab,
      appliesTo: (c, ui) =>
          _host(ui) != null &&
          ui.editor.commentable &&
          c.single != null &&
          c.single!.type != 'connector' &&
          c.single!.type != 'pen',
      items: (context, ui, c) => [
        CtxItem(
          key: 'stachelCtxComment',
          primary: true,
          short: 'Kommentar',
          label: 'Kommentieren',
          icon: Icons.add_comment_outlined,
          onTap: (_, ui) => _host(ui)!.commentOnSelection(),
        ),
      ],
    ),
  );

  // ---- menus ----------------------------------------------------------------------------------------------------
  r.defineMenuItem(
    MenuItemDef(
      id: 'collab.comment',
      on: MenuTarget.object,
      order: 75,
      entry: (ui, at) {
        final o = ui.editor.single;
        // also with the role `comment` (web: comment tool on an object)
        if (_host(ui) == null || !ui.editor.commentable || o == null || o.type == 'connector' || o.type == 'pen') {
          return null;
        }
        return MenuEntry(
          key: 'stachelMenuComment',
          label: 'Kommentieren',
          icon: Icons.add_comment_outlined,
          onSelect: (_, ui) => _host(ui)!.commentOnSelection(),
        );
      },
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'collab.commentHere',
      on: MenuTarget.canvas,
      // web 40 like „Auf dem Board suchen“; the web registers collab first (Abnahme D42)
      order: 39.9,
      entry: (ui, at) => _host(ui) == null || !ui.editor.commentable
          ? null
          : MenuEntry(
              key: 'stachelCommentHere',
              label: 'Hier kommentieren',
              icon: Icons.add_comment_outlined,
              onSelect: (_, ui) => _host(ui)!.commentAt(at.world),
            ),
    ),
  );
  // web ShareBar „Teilen“ (mode local): everyone with access; managing only owner and `edit` (the sheet asks the server)
  r.defineMenuItem(
    MenuItemDef(
      id: 'sharing.share',
      on: MenuTarget.board,
      order: 29,
      section: MenuSection.quick,
      sectionOrder: 1,
      entry: (ui, at) {
        final h = ui.host;
        if (h is! StachelClientHost || !h.client.showsRoles || _host(ui) == null) return null;
        return MenuEntry(
          key: 'stachelBoardShare',
          label: 'Teilen …',
          icon: Icons.person_add_alt_1_outlined,
          onSelect: (_, ui) => _host(ui)!.shareBoard(),
        );
      },
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'app.rename',
      on: MenuTarget.board,
      order: 33,
      section: MenuSection.board,
      sectionOrder: 18,
      entry: (ui, at) => _host(ui) == null || !ui.controller.mayEdit || !ui.controller.loaded
          ? null
          : MenuEntry(
              key: 'stachelBoardRename',
              label: 'Umbenennen',
              icon: Icons.drive_file_rename_outline,
              onSelect: (_, ui) => _host(ui)!.renameBoard(),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'collab.toggleComments',
      on: MenuTarget.board,
      order: 55,
      section: MenuSection.view,
      entry: (ui, at) {
        final h = _host(ui);
        if (h == null || !ui.controller.loaded) return null;
        return MenuEntry(
          key: 'stachelBoardPins',
          label: h.pinsShown ? 'Kommentar-Pins ausblenden' : 'Kommentar-Pins zeigen',
          icon: h.pinsShown ? Icons.comments_disabled_outlined : Icons.comment_outlined,
          onSelect: (_, ui) => _host(ui)!.togglePins(),
        );
      },
    ),
  );
  // „Seitenleisten“ of the web at the end (frames, comments)
  r.defineMenuItem(
    MenuItemDef(
      id: 'app.frames',
      on: MenuTarget.board,
      order: 92,
      section: MenuSection.quick,
      sectionOrder: 4,
      entry: (ui, at) => _host(ui) == null || !ui.controller.loaded
          ? null
          : MenuEntry(
              key: 'stachelBoardFrames',
              label: 'Rahmen',
              // phone tile (UX P7): the frame list is where presenting starts („Präsentieren“, „Ab hier …“)
              short: 'Präsentieren',
              icon: Icons.slideshow_outlined,
              sep: true,
              onSelect: (_, ui) => _host(ui)!.showFrames(),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'collab.comments',
      on: MenuTarget.board,
      order: 93,
      section: MenuSection.quick,
      sectionOrder: 2,
      entry: (ui, at) {
        final h = _host(ui);
        if (h == null || !ui.controller.loaded) return null;
        return MenuEntry(
          key: 'stachelBoardComments',
          // web CommentCount: „@“/„@n“ with unread mentions, else open threads („99+“)
          label: h.unreadMentions > 0
              ? 'Kommentare (@${h.unreadMentions > 1 ? h.unreadMentions : ''})'
              : 'Kommentare (${h.openThreads > 99 ? '99+' : h.openThreads} offen)',
          // phone tile (UX P7): „Kommentare“ with the same counter as a badge
          short: 'Kommentare',
          badge: h.unreadMentions > 0
              ? '@${h.unreadMentions > 1 ? h.unreadMentions : ''}'
              : (h.openThreads > 0 ? (h.openThreads > 99 ? '99+' : '${h.openThreads}') : null),
          icon: Icons.mode_comment_outlined,
          onSelect: (_, ui) => _host(ui)!.showComments(),
        );
      },
    ),
  );
  // ---- N10 (E4c): „Offline verfügbar“ in the board menu (app extra without web counterpart, Göran: it stays) ------
  r.defineMenuItem(
    MenuItemDef(
      id: 'app.offline',
      on: MenuTarget.board,
      order: 56,
      section: MenuSection.board,
      entry: (ui, at) {
        final host = ui.host;
        if (host is! StachelClientHost) return null;
        final e = StachelOffline.instance.entry(host.boardId);
        return MenuEntry(
          key: 'stachelBoardOffline',
          label: 'Offline verfügbar',
          subtitle: e == null ? 'Aus' : 'An · ${stachelBytes(e.bytes)} auf dem Handy',
          icon: e == null ? Icons.download_for_offline_outlined : Icons.offline_pin,
          onSelect: (context, ui) => showStachelOfflineSheet(context, boardId: host.boardId, title: host.boardTitle),
        );
      },
    ),
  );
  // Melden und Blockieren (CR-2/CR-3, Google Play UGC, DSA Art. 16)
  registerStachelModeration(r);
  return r;
}

/// Tool „Bild einfügen (auch PDF)“ (P7): camera, gallery or a PDF file (the web's file input takes images and PDFs).
Future<void> pickStachelMedia(BuildContext context, BoardUi ui) async {
  final host = _host(ui);
  if (host == null) return;
  final pdf = documentHost(ui) != null && ui.controller.canAct('documents.page');
  final choice = await showModalBottomSheet<String>(
    context: context,
    showDragHandle: true,
    builder: (ctx) => SafeArea(
      child: Wrap(
        children: [
          ListTile(
            key: const Key('stachelPhotoCamera'),
            leading: const Icon(Icons.photo_camera_outlined),
            title: const Text('Foto aufnehmen'),
            onTap: () => Navigator.of(ctx).pop('camera'),
          ),
          ListTile(
            key: const Key('stachelPhotoGallery'),
            leading: const Icon(Icons.photo_library_outlined),
            title: const Text('Bild aus der Galerie'),
            onTap: () => Navigator.of(ctx).pop('gallery'),
          ),
          if (pdf)
            ListTile(
              key: const Key('stachelPdfFile'),
              leading: const Icon(Icons.picture_as_pdf_outlined),
              title: const Text('PDF-Datei'),
              subtitle: const Text('Bis 15 MB, Seiten zum Blättern'),
              onTap: () => Navigator.of(ctx).pop('pdf'),
            ),
        ],
      ),
    ),
  );
  switch (choice) {
    case 'camera':
      await host.pickImage(source: StachelPhotoSource.camera);
    case 'gallery':
      await host.pickImage(source: StachelPhotoSource.gallery);
    case 'pdf':
      await Documents.of(ui).pickAndAdd();
  }
}
