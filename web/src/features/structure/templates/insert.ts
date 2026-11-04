// Objekte einfügen wie der Editor (`insertObjects` → `pasteObjects`) – ohne React, für die Web-Aktionen der App
// (native.ts: Vorlage einfügen, „Einfügen als …“): Mitte der Objekte auf die Einfüge-Stelle, Klone mit neuen IDs
// (Verbinder-Enden und Mindmap-Eltern umgeschrieben), ein Rückgängig-Schritt.
import type { BoardObject } from '../../../protocol';
import type { BoardStore, NewObject, Snapshot } from '../../../board/store';
import { cloneObjects } from '../../../board/clipboard';
import { connectorGeometry } from '../../../board/connector';
import { intersects, objRect, unionRects, type Point, type Rect } from '../../../board/geometry';
import { isInvisible } from '../../../board/types';

/** Versatz, der die Mitte der Objekte auf `at` legt (wie `pasteObjects` mit Einfüge-Stelle). */
export function offsetTo(objs: readonly BoardObject[], at: Point): Point {
  const b = unionRects(objs.map(objRect))!;
  return { x: Math.round(at.x - (b.x + b.w / 2)), y: Math.round(at.y - (b.y + b.h / 2)) };
}

/**
 * Klone von `objs` um `d` versetzt mit den IDs `newId(i)` (i = Stelle in `objs`) – wie `cloneObjects`, dazu der
 * Elternbezug von Mindmap-Knoten (im Browser über `remap` des Typs): ohne mitkopierten Elternknoten wird der Knoten
 * zur Wurzel.
 */
export function clonesWithIds(objs: readonly BoardObject[], d: Point, newId: (i: number) => string, snap: Snapshot): NewObject[] {
  const tmp = new Map<string, string>();
  const clones = cloneObjects(objs, d.x, d.y, (id) => snap.byId.get(id), tmp);
  const fixed = new Map<string, string>();
  objs.forEach((o, i) => {
    fixed.set(tmp.get(o.id)!, newId(i));
    fixed.set(o.id, newId(i));
  });
  const ren = (id: string) => fixed.get(id) ?? id;
  return clones.map((c) => {
    const out = { ...c, id: ren(c.id!) } as NewObject;
    for (const k of ['from', 'to'] as const) {
      const e = out[k] as { objectId?: string } | undefined;
      if (e?.objectId) (out as Record<string, unknown>)[k] = { ...e, objectId: ren(e.objectId) };
    }
    if (out.type === 'mindnode' && out.mind) {
      const p = out.mind.parent;
      const parent = p ? fixed.get(p) : undefined;
      const mind = { ...out.mind, parent };
      if (!parent) {
        delete mind.parent;
        delete mind.side;
        delete mind.hidden;
        mind.level = 0;
      }
      out.mind = mind;
    }
    return out;
  });
}

/** Objekte mit festen IDs an `at` einfügen (ein Rückgängig-Schritt); vorhandene IDs werden nicht noch einmal angelegt. */
export function insertAt(store: BoardStore, objs: readonly BoardObject[], at: Point, newId: (i: number) => string): string[] {
  if (!objs.length) return [];
  const clones = clonesWithIds(objs, offsetTo(objs, at), newId, store.getSnapshot());
  const fresh = clones.filter((c) => !store.objects.has(c.id!));
  store.stopCapturing();
  if (fresh.length) store.createMany(fresh);
  store.stopCapturing();
  return clones.map((c) => c.id!);
}

/** Liegt im Rechteck `r` schon etwas Sichtbares (wie `queryRect` des Editors; Verbinder über ihre Geometrie)? */
export function occupiedIn(snap: Snapshot): (r: Rect) => boolean {
  return (r) =>
    snap.ordered.some((o) => {
      if (isInvisible(o)) return false;
      let b: Rect | null = objRect(o);
      if (o.type === 'connector') {
        const g = connectorGeometry(o, (id) => snap.byId.get(id));
        b = g ? unionRects([g.a, g.b, ...g.pts].map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 }))) : null;
      }
      return !!b && intersects(b, r);
    });
}
