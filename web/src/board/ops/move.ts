// Verschieben als Patch: freie Verbinder-Enden wandern mit, angedockte folgen von selbst (je Typ über board/types).
import type { BoardObject } from '../../protocol';
import { contains, objRect } from '../geometry';
import type { Patch } from '../store';
import { isDependent, typeInfo } from '../types';

export function movePatch(o: BoardObject, dx: number, dy: number): Patch {
  const move = typeInfo(o.type).move;
  return move ? move(o, dx, dy) : { x: o.x + dx, y: o.y + dy };
}

export function movePatches(objs: Iterable<BoardObject>, dx: number, dy: number): Record<string, Patch> {
  const out: Record<string, Patch> = {};
  for (const o of objs) out[o.id] = movePatch(o, dx, dy);
  return out;
}

/**
 * Zu bewegende Objekte: Auswahl `ids` (ohne gesperrte) + was ganz in ausgewählten Rahmen liegt (nicht gesperrt, keine
 * Verbinder/Rahmen). `isContainer` = der Typ nimmt seinen Inhalt mit (Editor: `typeDef(o).container`, Server: Rahmen).
 */
export function movableObjects(
  ids: readonly string[],
  snap: { readonly ordered: readonly BoardObject[]; readonly byId: ReadonlyMap<string, BoardObject> },
  isContainer: (o: BoardObject) => boolean,
): Map<string, BoardObject> {
  const out = new Map<string, BoardObject>();
  for (const id of ids) {
    const o = snap.byId.get(id);
    if (!o || o.locked) continue;
    out.set(id, o);
    if (isContainer(o)) {
      for (const c of snap.ordered) {
        if (isContainer(c) || isDependent(c) || c.locked || out.has(c.id)) continue;
        if (contains(objRect(o), objRect(c))) out.set(c.id, c);
      }
    }
  }
  return out;
}
