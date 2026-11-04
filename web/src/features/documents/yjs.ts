// Seitenbilder (`docPages` als Y.Map) und Seitenwechsel im Yjs-Dokument. Beides ist geteilter Zustand, aber kein
// Rückgängig-Schritt (Blättern und nachgeladene Seiten nimmt Strg Z nicht zurück) → eigener Origin.
import * as Y from 'yjs';
import { registerYField, type BoardStore } from '../../board/store';
import { DOC_PAGES_FIELD } from './model';
import { currentPage, pageCount, pageImage } from './pages';

/** Origin der Schreibvorgänge dieses Moduls (nicht im UndoManager) */
export const DOC_ORIGIN = 'documents';

const pagesToY = (v: unknown): Y.Map<string> | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const m = new Y.Map<string>();
  for (const [k, id] of Object.entries(v as Record<string, unknown>)) if (/^\d{1,4}$/.test(k) && typeof id === 'string' && id) m.set(k, id);
  return m;
};

// Lesekopie im Schnappschuss: { "0": id, … }; Kopieren/Einfügen baut daraus eine neue Y.Map
registerYField(DOC_PAGES_FIELD, {
  toPlain: (v) => (v instanceof Y.Map ? (v.toJSON() as Record<string, string>) : {}),
  fromPlain: pagesToY,
});

function objectMap(store: BoardStore, id: string): Y.Map<unknown> | undefined {
  const m = store.objects.get(id);
  return m instanceof Y.Map ? m : undefined;
}

/** Seite wechseln (für alle); `imageId` spiegelt das Bild der aktuellen Seite (Export, Vorschaubild, Server). */
export function setPage(store: BoardStore, id: string, page: number) {
  const o = store.get(id);
  const m = objectMap(store, id);
  if (!o || !m) return;
  const p = currentPage({ ...o, docPage: page });
  if (p === currentPage(o) && o.docPage === p) return;
  const img = pageImage(o, p);
  store.doc.transact(() => {
    m.set('docPage', p);
    if (img) m.set('imageId', img);
    else m.delete('imageId');
    m.set('updatedAt', new Date().toISOString());
  }, DOC_ORIGIN);
}

/**
 * Bild einer Seite eintragen (nachgeladen). Nur wenn die Seite noch fehlt; ist sie die aktuelle, auch `imageId`.
 * Liefert die gültige Bild-ID (ggf. die eines anderen Clients, der schneller war).
 */
export function fillPage(store: BoardStore, id: string, page: number, imageId: string): string | undefined {
  const m = objectMap(store, id);
  if (!m) return undefined;
  let pages = m.get(DOC_PAGES_FIELD);
  let result = imageId;
  store.doc.transact(() => {
    if (!(pages instanceof Y.Map)) {
      pages = new Y.Map<string>();
      m.set(DOC_PAGES_FIELD, pages);
    }
    const ys = pages as Y.Map<string>;
    const have = ys.get(String(page));
    if (typeof have === 'string' && have) result = have;
    else ys.set(String(page), imageId);
    const o = store.get(id);
    if (o && currentPage(o) === page && m.get('imageId') !== result) m.set('imageId', result);
  }, DOC_ORIGIN);
  return result;
}

/** `imageId` passt nicht zur aktuellen Seite (gleichzeitiges Blättern und Nachladen) → richtigstellen. */
export function repairMirror(store: BoardStore, id: string) {
  const o = store.get(id);
  const m = objectMap(store, id);
  if (!o || !m) return;
  const img = pageImage(o, currentPage(o));
  if (!img || o.imageId === img) return;
  store.doc.transact(() => m.set('imageId', img), DOC_ORIGIN);
}

/** Alle Seiten haben ein Bild? */
export const complete = (o: Parameters<typeof pageCount>[0] & Parameters<typeof pageImage>[0]) => {
  for (let i = 0; i < pageCount(o); i++) if (!pageImage(o, i)) return false;
  return true;
};
