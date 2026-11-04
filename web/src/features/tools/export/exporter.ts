// Export als PNG oder PDF: ganzes Board, Auswahl, ein Rahmen oder alle Rahmen (PDF: eine Seite je Rahmen).
import type { BoardObject } from '../../../protocol';
import type { Snapshot } from '../../../board/store';
import { contains, expand, objRect, unionRects, intersects, type Rect } from '../../../board/geometry';
import { isAttached } from '../../../board/connector';
import { typeDef } from '../../../editor/ext/registry';
import { framesInOrder } from '../../../editor/interaction/Frames';
import type { EditorApi } from '../../../editor/ext/types';
import { getSettings } from '../settings';
import { currentBoardTitle, fileName } from '../util';
import { buildPdf, canvasToPdfImage, type PdfPage } from './pdf';
import { canvasToBlob, clampScale, renderToCanvas } from './render';

export type ExportArea = { kind: 'board' } | { kind: 'selection' } | { kind: 'frame'; id: string } | { kind: 'frames' };
export type ExportFormat = 'png' | 'pdf';

export interface ExportOptions {
  format: ExportFormat;
  area: ExportArea;
  /** Pixel je Welteinheit (1 = 100 %, 2 = scharf, 3 = Druck) */
  quality: number;
  /** PNG ohne Hintergrund */
  transparent?: boolean;
}

export interface ExportPage {
  rect: Rect;
  objects: BoardObject[];
  /** Name (Rahmentitel) */
  label?: string;
}

const PAD = 40;

const visible = (snap: Snapshot) => snap.ordered.filter((o) => !o.hidden);

/** Verbinder, deren beide angedockten Enden in `ids` liegen, gehören zu einer Auswahl dazu. */
function withConnectors(objs: BoardObject[], snap: Snapshot): BoardObject[] {
  const ids = new Set(objs.map((o) => o.id));
  for (const c of snap.ordered) {
    if (ids.has(c.id) || c.hidden || c.type !== 'connector') continue;
    const ends = [c.from, c.to];
    if (ends.every((e) => !e || (isAttached(e) ? ids.has(e.objectId) : false)) && ends.some((e) => isAttached(e))) ids.add(c.id);
  }
  return snap.ordered.filter((o) => ids.has(o.id));
}

/** Seiten (Ausschnitte mit Objekten) für einen Bereich; leer = nichts zu exportieren. */
export function exportPages(snap: Snapshot, selection: readonly string[], area: ExportArea, bounds: (o: BoardObject) => Rect | null): ExportPage[] {
  const all = visible(snap);
  const frame = (f: BoardObject): ExportPage => {
    const rect = objRect(f);
    return { rect, objects: all.filter((o) => o.id === f.id || (bounds(o) && intersects(bounds(o)!, rect))), label: f.title || 'Rahmen' };
  };
  const around = (objs: BoardObject[]): ExportPage[] => {
    const r = unionRects(objs.map(bounds).filter((b): b is Rect => !!b));
    return r && objs.length ? [{ rect: expand(r, PAD), objects: objs }] : [];
  };
  switch (area.kind) {
    case 'board':
      return around(all);
    case 'selection': {
      const sel = new Set(selection);
      const picked = all.filter((o) => sel.has(o.id));
      // ausgewählte Rahmen bringen ihren Inhalt mit
      for (const f of picked.filter((o) => typeDef(o).container)) {
        const r = objRect(f);
        for (const o of all) if (!sel.has(o.id) && !typeDef(o).container && contains(r, objRect(o))) sel.add(o.id);
      }
      if (picked.length === 1 && typeDef(picked[0]).container) return [frame(picked[0])];
      return around(withConnectors(all.filter((o) => sel.has(o.id)), snap));
    }
    case 'frame': {
      const f = snap.byId.get(area.id);
      return f ? [frame(f)] : [];
    }
    case 'frames':
      return framesInOrder(all).map(frame);
  }
}

/** Seitengröße in Punkt: Bildschirm-Pixel bei 96 dpi, längste Seite zwischen A5 und A2. */
export function pageSizePt(rect: Rect): { widthPt: number; heightPt: number } {
  const w = rect.w * 0.75;
  const h = rect.h * 0.75;
  const longest = Math.max(w, h, 1);
  const f = longest > 1684 ? 1684 / longest : longest < 420 ? 420 / longest : 1;
  return { widthPt: w * f, heightPt: h * f };
}

const RGB = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

export interface ExportResult {
  blob: Blob;
  name: string;
  pages: number;
}

/** Export erzeugen (läuft im Browser, kann bei großen Boards ein paar Sekunden dauern). */
export async function runExport(api: EditorApi, opts: ExportOptions, onProgress?: (done: number, total: number) => void): Promise<ExportResult | null> {
  const snap = api.snapshot();
  const pages = exportPages(snap, api.selection(), opts.area, (o) => api.bounds(o));
  if (!pages.length) return null;
  const bg = getSettings(api).color;
  const title = currentBoardTitle();
  const imageSrc = (id: string) => api.session.imageSrc(id);
  const render = (p: ExportPage, background: string | null) =>
    renderToCanvas({ objects: p.objects, byId: snap.byId, rect: p.rect, scale: clampScale(p.rect, opts.quality), background, imageSrc });
  const suffix = opts.area.kind === 'frame' || (opts.area.kind === 'selection' && pages.length === 1 && pages[0].label) ? ` – ${pages[0].label}` : '';

  if (opts.format === 'png') {
    onProgress?.(0, 1);
    const canvas = await render(pages[0], opts.transparent ? null : bg);
    onProgress?.(1, 1);
    return { blob: await canvasToBlob(canvas), name: fileName(title + suffix, 'png'), pages: 1 };
  }
  const out: PdfPage[] = [];
  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i, pages.length);
    const canvas = await render(pages[i], bg);
    out.push({ ...pageSizePt(pages[i].rect), image: await canvasToPdfImage(canvas, RGB(bg)) });
  }
  onProgress?.(pages.length, pages.length);
  const bytes = buildPdf(out, { title });
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), name: fileName(title + suffix, 'pdf'), pages: out.length };
}
