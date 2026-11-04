// Ausrichten und Verteilen: liefert je Einheit (Objekt oder Gruppe) eine Verschiebung.
import type { BoardObject } from '../../protocol';
import { isAttached } from '../connector';
import { objRect, unionRects, type Rect } from '../geometry';
import type { Patch } from '../store';
import { isDependent } from '../types';
import { movableObjects, movePatch } from './move';

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export interface Unit {
  key: string;
  rect: Rect;
}

export type Offsets = Map<string, { dx: number; dy: number }>;

export function align(units: readonly Unit[], mode: AlignMode): Offsets {
  const out: Offsets = new Map();
  if (units.length < 2) return out;
  const x1 = Math.min(...units.map((u) => u.rect.x));
  const y1 = Math.min(...units.map((u) => u.rect.y));
  const x2 = Math.max(...units.map((u) => u.rect.x + u.rect.w));
  const y2 = Math.max(...units.map((u) => u.rect.y + u.rect.h));
  for (const { key, rect: r } of units) {
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = x1 - r.x;
    else if (mode === 'right') dx = x2 - (r.x + r.w);
    else if (mode === 'hcenter') dx = (x1 + x2) / 2 - (r.x + r.w / 2);
    else if (mode === 'top') dy = y1 - r.y;
    else if (mode === 'bottom') dy = y2 - (r.y + r.h);
    else dy = (y1 + y2) / 2 - (r.y + r.h / 2);
    dx = Math.round(dx);
    dy = Math.round(dy);
    if (dx || dy) out.set(key, { dx, dy });
  }
  return out;
}

/** Gleiche Abstände zwischen den Einheiten; die äußeren bleiben stehen. */
export function distribute(units: readonly Unit[], axis: 'x' | 'y'): Offsets {
  const out: Offsets = new Map();
  if (units.length < 3) return out;
  const pos = (r: Rect) => (axis === 'x' ? r.x : r.y);
  const len = (r: Rect) => (axis === 'x' ? r.w : r.h);
  const sorted = [...units].sort((a, b) => pos(a.rect) + len(a.rect) / 2 - (pos(b.rect) + len(b.rect) / 2));
  const first = sorted[0].rect;
  const last = sorted[sorted.length - 1].rect;
  const span = pos(last) + len(last) - pos(first);
  const total = sorted.reduce((s, u) => s + len(u.rect), 0);
  const gap = (span - total) / (sorted.length - 1);
  let cursor = pos(first) + len(first) + gap;
  for (let i = 1; i < sorted.length - 1; i++) {
    const r = sorted[i].rect;
    const d = Math.round(cursor - pos(r));
    if (d) out.set(sorted[i].key, axis === 'x' ? { dx: d, dy: 0 } : { dx: 0, dy: d });
    cursor += len(r) + gap;
  }
  return out;
}

/** Einheiten fürs Ausrichten: Gruppen zusammen, sonst einzelne Objekte (ohne Verbinder/gesperrte). */
export function arrangeUnits(selected: readonly BoardObject[]): Map<string, BoardObject[]> {
  const units = new Map<string, BoardObject[]>();
  for (const o of selected) {
    if (isDependent(o) || o.locked) continue;
    const k = o.groupId ? `g:${o.groupId}` : o.id;
    units.set(k, [...(units.get(k) ?? []), o]);
  }
  return units;
}

/**
 * Patches fürs Ausrichten/Verteilen der Auswahl (`fn` = `align`/`distribute`): je Einheit verschoben, Rahmen nehmen
 * ihren Inhalt mit, ausgewählte Verbinder mit freien Enden wandern mit ihrem angedockten Objekt. Leer = nichts zu tun.
 */
export function arrangePatches(
  selected: readonly BoardObject[],
  snap: { readonly ordered: readonly BoardObject[]; readonly byId: ReadonlyMap<string, BoardObject> },
  fn: (units: Unit[]) => Offsets,
  isContainer: (o: BoardObject) => boolean,
): Record<string, Patch> {
  const units = arrangeUnits(selected);
  const list: Unit[] = [...units].map(([key, objs]) => ({ key, rect: unionRects(objs.map(objRect))! }));
  const offsets = fn(list);
  const patches: Record<string, Patch> = {};
  if (!offsets.size) return patches;
  const shifted = new Map<string, { dx: number; dy: number }>();
  for (const [key, d] of offsets) {
    // Rahmen nehmen ihren Inhalt mit
    for (const o of movableObjects(units.get(key)!.map((m) => m.id), snap, isContainer).values()) {
      if (patches[o.id]) continue;
      patches[o.id] = movePatch(o, d.dx, d.dy);
      shifted.set(o.id, d);
    }
  }
  // ausgewählte Verbinder: freie Enden wandern mit dem angedockten Objekt
  for (const c of selected) {
    if (c.type !== 'connector' || c.locked) continue;
    const anchor = [c.from, c.to].find((e) => isAttached(e) && shifted.has(e.objectId)) as { objectId: string } | undefined;
    const d = anchor ? shifted.get(anchor.objectId)! : null;
    if (!d) continue;
    const p = movePatch(c, d.dx, d.dy);
    delete p.x;
    delete p.y;
    patches[c.id] = p;
  }
  return patches;
}
