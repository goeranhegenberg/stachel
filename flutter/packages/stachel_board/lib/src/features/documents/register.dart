import 'package:flutter/material.dart';

import '../../editor/registry/context_action_def.dart';
import '../../editor/registry/menu_item_def.dart';
import '../../editor/registry/overlay_def.dart';
import '../../editor/registry/registry.dart';
import '../../editor/registry/board_ui.dart';
import '../../editor/registry/type_behavior.dart';
import '../../model/board_object.dart';
import 'doc_pages.dart';
import 'document_viewer.dart';
import 'document_widgets.dart';
import 'documents.dart';

/// P7: PDF-Dokumente (audit C13, D24, E20, K05–K11, K13) – the web's entries of `features/documents/index.tsx` with
/// their ids and orders: context bar `documents.doc` · 45 (‹ Seite ›, Vollbild, Herunterladen, Alle Seiten aufs Board),
/// object menu `documents.viewer` · 5, `documents.download` · 6, `documents.expand` · 7, world slot
/// `documents.controls` · 12 (name, page bar, upload placeholders, missing pages), type `document` („PDF“, name in the
/// selection panel). Upload: the app's tool `image` („Bild einfügen (auch PDF)“) calls [Documents.pickAndAdd]; the
/// app's share target calls [Documents.addPdfs]. PDF engine and REST come from the app ([DocumentHost]).
void registerDocuments(BoardRegistry r) {
  r.defineType(TypeBehavior(type: docType, label: 'PDF', describe: (o) => 'PDF: ${o.docName ?? 'Dokument.pdf'}'));
  r.defineContextAction(
    ContextActionDef(
      id: 'documents.doc',
      order: 45,
      section: CtxSection.content,
      appliesTo: (c, ui) => isDoc(c.single),
      items: (context, ui, c) => documentBarItems(ui, c.single!),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'documents.viewer',
      on: MenuTarget.object,
      order: 5,
      entry: (ui, at) => _selectedDoc(ui) == null
          ? null
          : MenuEntry(
              key: 'stachelMenuDocViewer',
              label: DocumentTexts.viewer,
              icon: Icons.fullscreen,
              onSelect: (context, ui) => openDocumentViewer(context, ui, _selectedDoc(ui)!.id),
            ),
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'documents.download',
      on: MenuTarget.object,
      order: 6,
      entry: (ui, at) {
        final o = _selectedDoc(ui);
        return o == null || Documents.of(ui).host == null
            ? null
            : MenuEntry(
                key: 'stachelMenuDocDownload',
                label: DocumentTexts.download,
                icon: Icons.download_outlined,
                onSelect: (_, ui) => Documents.of(ui).download(o),
              );
      },
    ),
  );
  r.defineMenuItem(
    MenuItemDef(
      id: 'documents.expand',
      on: MenuTarget.object,
      order: 7,
      entry: (ui, at) {
        final o = _selectedDoc(ui);
        return o == null || !Documents.of(ui).canExpand(o)
            ? null
            : MenuEntry(
                key: 'stachelMenuDocExpand',
                label: DocumentTexts.expand,
                icon: Icons.auto_awesome_mosaic_outlined,
                onSelect: (_, ui) => Documents.of(ui).expand(o.id),
              );
      },
    ),
  );
  r.defineOverlay(
    OverlayDef(
      id: 'documents.controls',
      order: 12,
      presenting: true,
      build: (context, ui) => DocumentLayer(ui: ui),
    ),
  );
}

/// Exactly one document selected?
BoardObject? _selectedDoc(BoardUi ui) {
  final sel = ui.editor.selected;
  return sel.length == 1 && isDoc(sel.single) ? sel.single : null;
}

/// The web's `DocBar`: ‹ n / N › (more than one page), „Vollbild ansehen“, „PDF herunterladen“, „Alle Seiten aufs Board
/// legen“ (not when locked).
List<CtxItem> documentBarItems(BoardUi ui, BoardObject o) {
  final docs = Documents.of(ui);
  final n = pageCount(o);
  final p = currentPage(o);
  return [
    if (n > 1 && docs.canPage) ...[
      CtxItem(
        key: 'stachelCtxDocPrev',
        label: DocumentTexts.prev,
        icon: Icons.chevron_left,
        onTap: (_, ui) => Documents.of(ui).stepPage(o.id, -1),
      ),
      CtxItem(
        key: 'stachelCtxDocPage',
        label: 'Seite ${pageLabel(p, n)}',
        width: 60,
        leading: (context) => Text(
          pageLabel(p, n),
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w700,
            fontFeatures: [FontFeature.tabularFigures()],
          ),
        ),
        onTap: (context, ui) => openDocumentViewer(context, ui, o.id),
      ),
      CtxItem(
        key: 'stachelCtxDocNext',
        label: DocumentTexts.next,
        icon: Icons.chevron_right,
        onTap: (_, ui) => Documents.of(ui).stepPage(o.id, 1),
      ),
    ],
    CtxItem(
      key: 'stachelCtxDocViewer',
      primary: true,
      short: 'Ansehen',
      label: DocumentTexts.viewer,
      icon: Icons.fullscreen,
      onTap: (context, ui) => openDocumentViewer(context, ui, o.id),
    ),
    if (docs.host != null)
      CtxItem(
        key: 'stachelCtxDocDownload',
        label: DocumentTexts.download,
        icon: Icons.download_outlined,
        onTap: (_, ui) => Documents.of(ui).download(o),
      ),
    if (docs.canExpand(o))
      CtxItem(
        key: 'stachelCtxDocExpand',
        label: DocumentTexts.expand,
        icon: Icons.auto_awesome_mosaic_outlined,
        onTap: (_, ui) => Documents.of(ui).expand(o.id),
      ),
  ];
}
