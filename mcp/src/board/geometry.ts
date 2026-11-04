// Geometrie für den Assistenten: Grenzen (auch Verbinder), Rahmen-Zugehörigkeit, Überlappungen.
// Rechnet mit denselben Funktionen wie die Web-App (web/src/board/geometry.ts, connector.ts).
import type { BoardObject } from '../../../shared/protocol';
import { connectorBounds, connectorGeometry } from '../../../web/src/board/connector';
import { contains, intersects, objRect, unionRects, type Point, type Rect } from '../../../web/src/board/geometry';
import type { Obj } from './model';

export type { Point, Rect };
export { contains, intersects, unionRects };

const asBO = (o: Obj) => o as unknown as BoardObject;

/** Weltgrenzen eines Objekts (gedreht: umschließendes Rechteck; Verbinder: aus den Enden). */
export function boundsOf(o: Obj, byId: ReadonlyMap<string, Obj>): Rect {
  if (o.type === 'connector') {
    try {
      const g = connectorGeometry(asBO(o), (id) => byId.get(id) as unknown as BoardObject | undefined);
      if (g) return roundRect(connectorBounds(g, 0));
    } catch {
      // kaputte Enden: Feldwerte nehmen
    }
    return { x: o.x, y: o.y, w: o.w, h: o.h };
  }
  return roundRect(objRect(asBO(o)));
}

export const roundRect = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });

export function unionOf(objs: Obj[], byId: ReadonlyMap<string, Obj>): Rect | null {
  const r = unionRects(objs.map((o) => boundsOf(o, byId)));
  return r ? roundRect(r) : null;
}

/** Innerster Rahmen, der das Objekt ganz enthält (Objekte gehören geometrisch zum Rahmen). */
export function frameOf(o: Obj, frames: readonly Obj[], byId: ReadonlyMap<string, Obj>): Obj | null {
  if (o.type === 'connector') return null;
  const r = boundsOf(o, byId);
  let best: Obj | null = null;
  for (const f of frames) {
    if (f.id === o.id) continue;
    if (contains(boundsOf(f, byId), r) && (!best || f.w * f.h < best.w * best.h)) best = f;
  }
  return best;
}

/** Objekte im Rahmen (ganz enthalten), ohne den Rahmen selbst. */
export function frameChildren(frame: Obj, all: readonly Obj[], byId: ReadonlyMap<string, Obj>): Obj[] {
  const fr = boundsOf(frame, byId);
  return all.filter((o) => o.id !== frame.id && o.type !== 'connector' && contains(fr, boundsOf(o, byId)));
}

/** Echte Überlappung (Berühren zählt nicht). */
export function overlaps(a: Rect, b: Rect, margin = 0): boolean {
  return a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;
}

export const centerOf = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
