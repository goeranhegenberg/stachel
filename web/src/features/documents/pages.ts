// Reine Logik des Moduls „documents“ (ohne React/pdf.js): Seiten lesen, Größen, Raster für „Alle Seiten aufs Board“.
import type { BoardObject } from '../../protocol';
import type { Rect } from '../../board/geometry';
import { PAGE_MAX_PIXELS, PAGE_PX } from './model';

/** Seitenzahl (mindestens 1). */
export const pageCount = (o: Pick<BoardObject, 'docCount'>) => Math.max(1, Math.floor(o.docCount ?? 1));

/** Aktuelle Seite, auf den gültigen Bereich begrenzt (fremde/kaputte Werte vertragen). */
export function currentPage(o: Pick<BoardObject, 'docCount' | 'docPage'>): number {
  const p = typeof o.docPage === 'number' && Number.isFinite(o.docPage) ? Math.floor(o.docPage) : 0;
  return Math.min(pageCount(o) - 1, Math.max(0, p));
}

/** Bild-ID einer Seite (undefined = noch nicht erzeugt). */
export function pageImage(o: Pick<BoardObject, 'docPages'>, i: number): string | undefined {
  const v = o.docPages?.[String(i)];
  return typeof v === 'string' && v ? v : undefined;
}

/** Seitenverhältnis Breite/Höhe einer Seite (Standard: das der ersten Seite bzw. A4 hoch). */
export function pageRatio(o: Pick<BoardObject, 'docRatios'>, i: number): number {
  const r = o.docRatios?.[i] ?? o.docRatios?.[0];
  return typeof r === 'number' && r > 0.05 && r < 20 ? r : 595 / 842;
}

/** Seiten ohne Bild, die aktuelle zuerst. */
export function missingPages(o: Pick<BoardObject, 'docCount' | 'docPage' | 'docPages'>): number[] {
  const n = pageCount(o);
  const cur = currentPage(o);
  const out: number[] = [];
  if (!pageImage(o, cur)) out.push(cur);
  for (let i = 0; i < n; i++) if (i !== cur && !pageImage(o, i)) out.push(i);
  return out;
}

/** „3 / 12“ */
export const pageLabel = (i: number, n: number) => `${i + 1} / ${n}`;

/** Objektgröße beim Einfügen: Seite passt in ein Quadrat von `box` Welteinheiten. */
export function docSize(ratio: number, box = 640): { w: number; h: number } {
  return ratio >= 1 ? { w: box, h: Math.round(box / ratio) } : { w: Math.round(box * ratio), h: box };
}

/** Maßstab fürs Rendern einer Seite (Punkte → Pixel): längere Kante PAGE_PX, höchstens PAGE_MAX_PIXELS. */
export function renderScale(wPt: number, hPt: number, longSide = PAGE_PX, maxPixels = PAGE_MAX_PIXELS): number {
  const w = Math.max(1, wPt);
  const h = Math.max(1, hPt);
  return Math.min(longSide / Math.max(w, h), Math.sqrt(maxPixels / (w * h)));
}

/**
 * Raster für „Alle Seiten aufs Board legen“: rechts neben dem Dokument, oben bündig, Seiten
 * so breit wie das Dokument, zeilenweise; etwa so viele Spalten wie Zeilen (breiter als hoch), höchstens 10.
 */
export function expandLayout(o: Pick<BoardObject, 'x' | 'y' | 'w' | 'docCount' | 'docRatios'>, n = pageCount(o)): Rect[] {
  const w = Math.max(40, o.w);
  const gap = Math.round(w * 0.08);
  const cols = Math.max(1, Math.min(10, n, Math.ceil(Math.sqrt(n * 1.6))));
  const out: Rect[] = [];
  let y = o.y;
  for (let row = 0; row * cols < n; row++) {
    let rowH = 0;
    for (let c = 0; c < cols && row * cols + c < n; c++) {
      const i = row * cols + c;
      const h = Math.round(w / pageRatio(o, i));
      out.push({ x: Math.round(o.x + o.w + gap + c * (w + gap)), y: Math.round(y), w: Math.round(w), h });
      rowH = Math.max(rowH, h);
    }
    y += rowH + gap;
  }
  return out;
}

/** Dateiname ohne Pfad, höchstens 120 Zeichen (Anzeige, Download). */
export function cleanName(name: string): string {
  const s = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  const base = s || 'Dokument.pdf';
  return base.length > 120 ? `${base.slice(0, 116)}.pdf` : base;
}

/** Ist das eine PDF? (Typ oder Endung; der Inhalt wird beim Öffnen und auf dem Server geprüft) */
export const isPdfFile = (f: Pick<File, 'type' | 'name'>) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
