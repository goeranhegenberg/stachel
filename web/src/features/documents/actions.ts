// Aktionen am Dokument: blättern (für alle), Original herunterladen, Vollbild, alle Seiten als Bilder aufs Board.
import type { BoardObject } from '../../protocol';
import type { EditorApi } from '../../editor/ext/types';
import { DOC_TYPE } from './model';
import { currentPage, expandLayout, pageCount, pageImage, missingPages } from './pages';
import { ensurePage, fileUrl, fillMissing } from './files';
import { setPage } from './yjs';

export const VIEWER_MODAL = 'documents.viewer';

export const isDoc = (o: BoardObject | undefined | null): o is BoardObject => !!o && o.type === DOC_TYPE;

/** Seite um `d` weiter (begrenzt); fehlt ihr Bild, wird es erzeugt. */
export function stepPage(api: EditorApi, id: string, d: number) {
  const o = api.store.get(id);
  if (!isDoc(o)) return;
  goToPage(api, id, currentPage(o) + d);
}

export function goToPage(api: EditorApi, id: string, page: number) {
  const o = api.store.get(id);
  if (!isDoc(o)) return;
  setPage(api.store, id, page);
  const now = api.store.get(id);
  if (now && !pageImage(now, currentPage(now))) void ensurePage(api, id, currentPage(now)).catch(() => {});
}

/** Original-PDF herunterladen. */
export function downloadPdf(o: BoardObject) {
  if (!o.docFile) return;
  const name = o.docName ?? 'Dokument.pdf';
  const a = document.createElement('a');
  a.href = fileUrl(o.docFile, name);
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
}

export const openViewer = (api: EditorApi, id: string) => api.openModal(VIEWER_MODAL, { id });

/** läuft gerade „Alle Seiten aufs Board“ für dieses Dokument? */
const expanding = new Set<string>();

/**
 * Alle Seiten als einzelne Bilder rechts neben das Dokument legen („Seiten ausklappen“). Fehlende Seiten werden vorher
 * erzeugt. Ein Undo-Schritt; die neuen Bilder sind danach ausgewählt.
 */
export async function expandPages(api: EditorApi, id: string) {
  const o = api.store.get(id);
  if (!isDoc(o) || expanding.has(id)) return;
  expanding.add(id);
  try {
    const n = pageCount(o);
    if (missingPages(o).length) {
      api.toast(`Seiten werden vorbereitet (${n - missingPages(o).length} von ${n}) …`);
      const ok = await fillMissing(api, id);
      if (!ok) {
        if (api.store.get(id)) api.toast('Nicht alle Seiten konnten vorbereitet werden.');
        return;
      }
    }
    const doc = api.store.get(id);
    if (!doc) return;
    const rects = expandLayout(doc);
    api.store.stopCapturing();
    const ids = api.store.createMany(
      rects.map((r, i) => ({ type: 'image' as const, ...r, imageId: pageImage(doc, i)!, color: '#ffffff' })),
    );
    api.store.stopCapturing();
    api.setSelection(ids);
    const all = rects.reduce((b, r) => ({ x: Math.min(b.x, r.x), y: Math.min(b.y, r.y), r: Math.max(b.r, r.x + r.w), btm: Math.max(b.btm, r.y + r.h) }), {
      x: doc.x,
      y: doc.y,
      r: doc.x + doc.w,
      btm: doc.y + doc.h,
    });
    api.fitTo({ x: all.x, y: all.y, w: all.r - all.x, h: all.btm - all.y }, 1);
    api.toast(n === 1 ? 'Seite liegt als Bild auf dem Board.' : `${n} Seiten liegen als Bilder auf dem Board.`);
  } catch (e) {
    api.toast((e as Error)?.message || 'Die Seiten konnten nicht aufs Board gelegt werden.');
  } finally {
    expanding.delete(id);
  }
}
