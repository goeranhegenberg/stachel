// Freien Platz finden: neben vorhandenem Inhalt (wie die Vorlagen, web/.../templates/place.ts) bzw. in einem Rahmen.
import { freeSpot, FREE_MARGIN } from '../../../web/src/features/structure/templates/place';
import { boundsOf, overlaps, unionOf, type Point, type Rect } from '../board/geometry';
import type { Obj } from '../board/model';
import type { Snap } from './read';
import { ToolError } from '../kinds/common';

/** Abstand zwischen Objekten in einem Block (Notizen im Raster, Standard-Abstand) */
export const GAP = 24;
/** Innenabstand im Rahmen */
export const FRAME_PAD = 48;

export interface Sized {
  w: number;
  h: number;
}

/** Hindernisse: alle Objekte außer Verbindern (und außer den genannten). Rahmen zählen als belegt. */
export function obstacles(s: Snap, extra: Rect[] = [], skip?: ReadonlySet<string>): Rect[] {
  return [...s.all.filter((o) => o.type !== 'connector' && !skip?.has(o.id)).map((o) => boundsOf(o, s.byId)), ...extra];
}

/** Linke obere Ecke für einen Block der Größe `size`: möglichst nah an `near`, sonst rechts neben dem Inhalt. */
export function freeOrigin(s: Snap, size: Sized, opts: { near?: Point; extra?: Rect[]; skip?: ReadonlySet<string> } = {}): Point {
  const obs = obstacles(s, opts.extra, opts.skip);
  if (!obs.length) return opts.near ? { x: Math.round(opts.near.x - size.w / 2), y: Math.round(opts.near.y - size.h / 2) } : { x: 0, y: 0 };
  const all = obs.reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) }));
  // Standard: rechts neben allem, oben bündig (Lesereihenfolge)
  const center = opts.near ?? { x: all.x + all.w + 160 + size.w / 2, y: all.y + size.h / 2 };
  const occupied = (r: Rect) => obs.some((o) => overlaps(o, r));
  const c = freeSpot(size, center, occupied, FREE_MARGIN, 60);
  return { x: Math.round(c.x - size.w / 2), y: Math.round(c.y - size.h / 2) };
}

/** Kästen zeilenweise anordnen (Breite höchstens maxW), liefert relative Lagen und die Blockgröße. */
export function flow(boxes: Sized[], maxW: number, gap = GAP): { pos: Point[]; w: number; h: number } {
  const pos: Point[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let w = 0;
  for (const b of boxes) {
    if (x > 0 && x + b.w > maxW) {
      x = 0;
      y += rowH + gap;
      rowH = 0;
    }
    pos.push({ x, y });
    x += b.w + gap;
    rowH = Math.max(rowH, b.h);
    w = Math.max(w, x - gap);
  }
  return { pos, w, h: y + rowH };
}

/** Raster mit festen Spalten; Zeilenhöhe = höchster Kasten der Zeile, Spaltenbreite = breitester der Spalte. */
export function grid(boxes: Sized[], columns: number, gap = GAP): { pos: Point[]; w: number; h: number } {
  const cols = Math.max(1, Math.min(columns, boxes.length || 1));
  const colW = Array.from({ length: cols }, (_, c) => Math.max(0, ...boxes.filter((_, i) => i % cols === c).map((b) => b.w)));
  const rows = Math.ceil(boxes.length / cols);
  const rowH = Array.from({ length: rows }, (_, r) => Math.max(0, ...boxes.slice(r * cols, r * cols + cols).map((b) => b.h)));
  const colX = colW.map((_, c) => colW.slice(0, c).reduce((a, b) => a + b + gap, 0));
  const rowY = rowH.map((_, r) => rowH.slice(0, r).reduce((a, b) => a + b + gap, 0));
  const pos = boxes.map((_, i) => ({ x: colX[i % cols]!, y: rowY[Math.floor(i / cols)]! }));
  return { pos, w: colX[cols - 1]! + colW[cols - 1]!, h: rows ? rowY[rows - 1]! + rowH[rows - 1]! : 0 };
}

/**
 * Platz für einen Block in einem Rahmen: erste freie Stelle in Lesereihenfolge; passt nichts, unter den vorhandenen
 * Inhalt – der Rahmen wächst dann mit (Patch zurück).
 */
export function placeInFrame(frame: Obj | { x: number; y: number; w: number; h: number; id: string }, size: Sized, s: Snap, extra: Rect[] = []): { origin: Point; framePatch?: { w?: number; h?: number } } {
  const inner: Rect = { x: frame.x + FRAME_PAD, y: frame.y + FRAME_PAD, w: frame.w - 2 * FRAME_PAD, h: frame.h - 2 * FRAME_PAD };
  const kids = [
    ...s.all.filter((o) => o.type !== 'connector' && o.id !== frame.id && o.type !== 'frame').map((o) => boundsOf(o, s.byId)).filter((r) => overlaps(r, frame)),
    ...extra.filter((r) => overlaps(r, frame)),
  ];
  const step = 24;
  if (size.w <= inner.w && size.h <= inner.h) {
    for (let y = inner.y; y + size.h <= inner.y + inner.h; y += step) {
      for (let x = inner.x; x + size.w <= inner.x + inner.w; x += step) {
        const r = { x, y, w: size.w, h: size.h };
        if (!kids.some((k) => overlaps(k, r, GAP))) return { origin: { x, y } };
      }
    }
  }
  const bottom = kids.length ? Math.max(...kids.map((k) => k.y + k.h)) + GAP * 2 : inner.y;
  const origin = { x: inner.x, y: bottom };
  const needW = origin.x + size.w + FRAME_PAD - frame.x;
  const needH = origin.y + size.h + FRAME_PAD - frame.y;
  const patch: { w?: number; h?: number } = {};
  if (needW > frame.w) patch.w = Math.ceil(needW);
  if (needH > frame.h) patch.h = Math.ceil(needH);
  return { origin, framePatch: Object.keys(patch).length ? patch : undefined };
}

/** Neue Objekte, die vorhandene (außer Rahmen) überdecken – als Hinweis an den Assistenten. */
export function overlapWarnings(s: Snap, createdIds: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const existing = s.all.filter((o) => o.type !== 'frame' && o.type !== 'connector' && !createdIds.has(o.id));
  for (const id of createdIds) {
    const o = s.byId.get(id);
    if (!o || o.type === 'frame' || o.type === 'connector') continue;
    const r = boundsOf(o, s.byId);
    const hit = existing.filter((e) => overlaps(boundsOf(e, s.byId), r));
    if (hit.length) out.push(`${id} überdeckt ${hit.slice(0, 3).map((h) => h.id).join(', ')}${hit.length > 3 ? ` (+${hit.length - 3})` : ''}`);
  }
  return out;
}

export const blockBounds = (objs: Obj[], s: Snap) => unionOf(objs, s.byId);

/**
 * Rahmen dürfen sich nach einer Änderung nicht teilweise überdecken: Inhalte gehören geometrisch zum Rahmen, sonst
 * nimmt beim nächsten Verschieben der falsche Rahmen fremde Objekte mit. Ganz ineinander (verschachtelt) ist erlaubt.
 * Wirft einen Fehler mit freiem Platz als Vorschlag.
 */
export function assertNoFrameClash(s: Snap, patches: Record<string, Partial<Obj>>, added: readonly (Partial<Obj> & { id: string; type: string; x: number; y: number; w: number; h: number })[] = []): void {
  const after = (f: Obj): Rect => ({ x: Number(patches[f.id]?.x ?? f.x), y: Number(patches[f.id]?.y ?? f.y), w: Number(patches[f.id]?.w ?? f.w), h: Number(patches[f.id]?.h ?? f.h) });
  const inside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  const fresh = added.filter((o) => o.type === 'frame') as Obj[];
  const frames = [...s.frames, ...fresh];
  const changed = new Set([...Object.keys(patches), ...fresh.map((f) => f.id)]);
  for (const f of frames) {
    if (!changed.has(f.id)) continue;
    const r = after(f);
    for (const g of frames) {
      if (g.id === f.id) continue;
      const q = after(g);
      if (!overlaps(r, q) || inside(r, q) || inside(q, r)) continue;
      const spot = freeOrigin(s, { w: r.w, h: r.h }, { skip: changed });
      throw new ToolError(
        `Rahmen „${f.title ?? f.id}“ würde Rahmen „${g.title ?? g.id}“ teilweise überdecken – dann vermischen sich ihre Inhalte. Nichts geändert. Freie Stelle für diese Größe z. B. x=${spot.x}, y=${spot.y}; oder erst den anderen Rahmen verschieben.`,
      );
    }
  }
}
