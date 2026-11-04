// Feature-Modul „documents“: PDF aufs Board (Hochladen, Ablegen, Einfügen), Seiten blättern (für alle), Vollbild,
// Original herunterladen, alle Seiten als Bilder aufs Board. Registriert sich beim Import (Vertrag: docs/features/documents.md).
import './model';
import './yjs';
import './documents.css';
import { defineFileHandler, defineMenuItem, defineModal, defineObjectType, defineSlot, defineTool, tools } from '../../editor/ext/registry';
import type { CtxProps, EditorApi } from '../../editor/ext/types';
import type { Handle } from '../../board/geometry';
import { DOC_TYPE } from './model';
import { currentPage, pageCount, pageLabel } from './pages';
import { pdfHandler } from './files';
import { downloadPdf, expandPages, isDoc, openViewer, stepPage, VIEWER_MODAL } from './actions';
import { DocumentView } from './view';
import { DocumentControls } from './controls';
import { DocumentViewer } from './viewer';
import { IconDownload, IconFullscreen, IconNext, IconPages, IconPrev } from './icons';

const CORNERS: Handle[] = ['nw', 'ne', 'se', 'sw'];

// ---- Kontextleiste: blättern, Vollbild, Herunterladen, alle Seiten aufs Board -----------------------------------------

function DocBar({ api, single }: CtxProps) {
  if (!single) return null;
  const n = pageCount(single);
  const p = currentPage(single);
  return (
    <>
      {n > 1 && (
        <div className="ctx-group documents-ctx-pages">
          <button className="ctx-btn" aria-label="Vorige Seite" title="Vorige Seite" disabled={p <= 0} onClick={() => stepPage(api, single.id, -1)}>
            <IconPrev />
          </button>
          <span className="documents-ctx-n" aria-live="polite">
            {pageLabel(p, n)}
          </span>
          <button className="ctx-btn" aria-label="Nächste Seite" title="Nächste Seite" disabled={p >= n - 1} onClick={() => stepPage(api, single.id, 1)}>
            <IconNext />
          </button>
        </div>
      )}
      <div className="ctx-group">
        <button className="ctx-btn" aria-label="Vollbild ansehen" title="Vollbild ansehen" onClick={() => openViewer(api, single.id)}>
          <IconFullscreen />
        </button>
        <button className="ctx-btn" aria-label="PDF herunterladen" title="PDF herunterladen" onClick={() => downloadPdf(single)}>
          <IconDownload />
        </button>
        {!single.locked && (
          <button className="ctx-btn" aria-label="Alle Seiten aufs Board legen" title="Alle Seiten aufs Board legen" onClick={() => void expandPages(api, single.id)}>
            <IconPages />
          </button>
        )}
      </div>
    </>
  );
}

// ---- Objekttyp ----------------------------------------------------------------------------------------------------------

defineObjectType({
  type: DOC_TYPE,
  label: 'PDF',
  View: DocumentView,
  simpleStyle: () => ({ background: '#ffffff', boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.14)' }),
  lodPx: 80,
  colorable: false,
  rotatable: true,
  anchorable: true,
  handles: () => CORNERS,
  keepAspect: true,
  plainText: (o) => o.docName ?? 'PDF',
  actions: [{ id: 'documents.doc', order: 45, when: (c) => !!c.single && isDoc(c.single), Bar: DocBar }],
});

// ---- Hochladen: Dateiauswahl, Ablegen, Strg V ---------------------------------------------------------------------------

defineFileHandler({ id: 'documents.pdf', accept: 'application/pdf,.pdf', ...pdfHandler });

// Upload-Knopf der Werkzeugleiste nimmt jetzt auch PDFs (Dateiauswahl des Kerns, accept kommt vom Handler)
const coreImage = tools.get('image');
if (coreImage) defineTool({ ...coreImage, label: 'Bild einfügen (auch PDF)' });

// ---- Welt-Slot, Vollbild, Menüs ----------------------------------------------------------------------------------------

defineSlot({ id: 'documents.controls', slot: 'world', order: 12, Component: DocumentControls, presenting: true });
defineModal({ id: VIEWER_MODAL, Component: DocumentViewer });

/** genau ein Dokument ausgewählt? */
const selectedDoc = (api: EditorApi) => {
  const sel = api.selected();
  return sel.length === 1 && isDoc(sel[0]) ? sel[0] : null;
};

defineMenuItem({
  id: 'documents.viewer',
  on: 'object',
  order: 5,
  item: (api) => {
    const o = selectedDoc(api);
    return o && { label: 'Vollbild ansehen', onSelect: () => openViewer(api, o.id) };
  },
});
defineMenuItem({
  id: 'documents.download',
  on: 'object',
  order: 6,
  item: (api) => {
    const o = selectedDoc(api);
    return o && { label: 'PDF herunterladen', onSelect: () => downloadPdf(o) };
  },
});
defineMenuItem({
  id: 'documents.expand',
  on: 'object',
  order: 7,
  item: (api) => {
    const o = selectedDoc(api);
    return o && !o.locked ? { label: 'Alle Seiten aufs Board legen', onSelect: () => void expandPages(api, o.id) } : null;
  },
});
