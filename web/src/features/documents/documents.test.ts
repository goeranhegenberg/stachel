// Modul „documents“: Seitenlogik, Raster „Alle Seiten aufs Board“, Seiten im Y-Dokument (gleichzeitig, ohne Undo).
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import '../../editor/core';
import './index';
import { BoardStore } from '../../board/store';
import { cloneObjects } from '../../board/clipboard';
import { fileHandlers } from '../../editor/ext/registry';
import { cleanName, currentPage, docSize, expandLayout, isPdfFile, missingPages, pageImage, pageRatio, renderScale } from './pages';
import { DOC_ORIGIN, fillPage, repairMirror, setPage } from './yjs';

const fresh = (doc = new Y.Doc(), user = 'm:1') => new BoardStore(doc, user);
const newDoc = (store: BoardStore, pages: Record<string, string> = { '0': 'p0' }, count = 3) =>
  store.create({ type: 'document', x: 0, y: 0, w: 400, h: 566, docFile: 'f1', docName: 'Plan.pdf', docCount: count, docPage: 0, docPages: pages, docRatios: [0.707, 1.414, 0.707], imageId: pages['0'] });

describe('Seitenlogik', () => {
  it('begrenzt die Seite und vertragen kaputte Werte', () => {
    expect(currentPage({ docCount: 3, docPage: 7 })).toBe(2);
    expect(currentPage({ docCount: 3, docPage: -2 })).toBe(0);
    expect(currentPage({ docCount: 3, docPage: Number.NaN })).toBe(0);
    expect(currentPage({})).toBe(0);
  });
  it('fehlende Seiten: die aktuelle zuerst', () => {
    expect(missingPages({ docCount: 4, docPage: 2, docPages: { '0': 'a' } })).toEqual([2, 1, 3]);
    expect(missingPages({ docCount: 2, docPages: { '0': 'a', '1': 'b' } })).toEqual([]);
  });
  it('Seitenverhältnis mit Rückfall auf Seite 1 bzw. A4', () => {
    expect(pageRatio({ docRatios: [0.5, 2] }, 1)).toBe(2);
    expect(pageRatio({ docRatios: [0.5] }, 5)).toBe(0.5);
    expect(pageRatio({}, 0)).toBeCloseTo(595 / 842);
    expect(pageRatio({ docRatios: [-1] }, 0)).toBeCloseTo(595 / 842);
  });
  it('Größe beim Einfügen und Render-Maßstab', () => {
    expect(docSize(0.5)).toEqual({ w: 320, h: 640 });
    expect(docSize(2)).toEqual({ w: 640, h: 320 });
    // A4 hoch: längere Kante 1800 px
    expect(842 * renderScale(595, 842)).toBeCloseTo(1800);
    // sehr großer Plan: höchstens 4 Mio. Pixel
    const s = renderScale(3000, 3000);
    expect(3000 * s * 3000 * s).toBeLessThanOrEqual(4_000_001);
  });
  it('Raster rechts neben dem Dokument, oben bündig, ohne Überlappung', () => {
    const rects = expandLayout({ x: 100, y: 50, w: 200, docCount: 12, docRatios: Array(12).fill(0.5) });
    expect(rects).toHaveLength(12);
    expect(rects[0]).toMatchObject({ x: 100 + 200 + 16, y: 50, w: 200, h: 400 });
    const cols = new Set(rects.map((r) => r.x)).size;
    expect(cols).toBe(5); // ceil(sqrt(12 * 1.6))
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
      }
    expect(expandLayout({ x: 0, y: 0, w: 100, docCount: 3 }).map((r) => r.y)).toEqual([0, 0, 0]);
  });
  it('Dateinamen und PDF-Erkennung', () => {
    expect(cleanName('C:\\fakepath\\Lage plan.pdf')).toBe('Lage plan.pdf');
    expect(cleanName('')).toBe('Dokument.pdf');
    expect(isPdfFile({ name: 'a.PDF', type: '' })).toBe(true);
    expect(isPdfFile({ name: 'a', type: 'application/pdf' })).toBe(true);
    expect(isPdfFile({ name: 'a.png', type: 'image/png' })).toBe(false);
  });
  it('trägt sich als Datei-Handler für PDF ein', () => {
    const h = fileHandlers.get('documents.pdf')!;
    expect(h.accept).toContain('application/pdf');
    expect(h.match(new File(['x'], 'plan.pdf', { type: 'application/pdf' }))).toBe(true);
    expect(h.match(new File(['x'], 'bild.png', { type: 'image/png' }))).toBe(false);
  });
});

describe('Seiten im Y-Dokument', () => {
  it('Seitenwechsel ist geteilt, spiegelt imageId und ist kein Undo-Schritt', () => {
    const store = fresh();
    const id = newDoc(store, { '0': 'p0', '1': 'p1' });
    store.stopCapturing();
    setPage(store, id, 1);
    expect(store.get(id)).toMatchObject({ docPage: 1, imageId: 'p1' });
    // fehlende Seite: imageId fällt weg (Platzhalter)
    setPage(store, id, 2);
    expect(store.get(id)!.docPage).toBe(2);
    expect(store.get(id)!.imageId).toBeUndefined();
    // Strg Z nimmt das Anlegen zurück, nicht das Blättern
    expect(store.undoManager.undoStack).toHaveLength(1);
    setPage(store, id, 99);
    expect(store.get(id)!.docPage).toBe(2);
  });

  it('Nachladen: aktuelle Seite setzt imageId; schon vorhandene Seite gewinnt', () => {
    const store = fresh();
    const id = newDoc(store);
    setPage(store, id, 1);
    expect(fillPage(store, id, 1, 'neu1')).toBe('neu1');
    expect(store.get(id)).toMatchObject({ imageId: 'neu1', docPages: { '0': 'p0', '1': 'neu1' } });
    expect(fillPage(store, id, 1, 'spaet')).toBe('neu1');
    expect(fillPage(store, id, 2, 'p2')).toBe('p2');
    expect(store.get(id)!.imageId).toBe('neu1');
    expect(fillPage(store, 'gibtsnicht', 0, 'x')).toBeUndefined();
  });

  it('zwei Clients tragen gleichzeitig verschiedene Seiten nach, ohne Verlust', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const sa = fresh(a, 'm:1');
    const id = newDoc(sa, { '0': 'p0' }, 3);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const sb = fresh(b, 'm:2');
    fillPage(sa, id, 1, 'von-a');
    fillPage(sb, id, 2, 'von-b');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    for (const s of [sa, sb]) expect(s.get(id)!.docPages).toEqual({ '0': 'p0', '1': 'von-a', '2': 'von-b' });
    // Blättern bei a kommt bei b an
    setPage(sa, id, 2);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(sb.get(id)).toMatchObject({ docPage: 2, imageId: 'von-b' });
  });

  it('Spiegel reparieren, wenn Blättern und Nachladen sich kreuzen', () => {
    const store = fresh();
    const id = newDoc(store);
    // Seite 1 wird eingetragen, während (anderswo) noch Seite 0 aktuell war, danach wird geblättert ohne imageId
    store.doc.transact(() => {
      const m = store.objects.get(id)!;
      (m.get('docPages') as Y.Map<string>).set('1', 'p1');
      m.set('docPage', 1);
      m.delete('imageId');
    }, DOC_ORIGIN);
    repairMirror(store, id);
    expect(store.get(id)!.imageId).toBe('p1');
  });

  it('Kopieren/Einfügen baut die Seiten als neue Y.Map', () => {
    const store = fresh();
    const id = newDoc(store, { '0': 'p0', '1': 'p1' });
    const snap = store.getSnapshot();
    const [clone] = cloneObjects([store.get(id)!], 20, 20, (k) => snap.byId.get(k), new Map());
    const nid = store.create(clone);
    expect(store.get(nid)!.docPages).toEqual({ '0': 'p0', '1': 'p1' });
    expect(store.objects.get(nid)!.get('docPages')).toBeInstanceOf(Y.Map);
    expect(store.objects.get(nid)!.get('docPages')).not.toBe(store.objects.get(id)!.get('docPages'));
    expect(pageImage(store.get(nid)!, 1)).toBe('p1');
  });
});
