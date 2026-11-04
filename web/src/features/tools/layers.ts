// Ebenen schrittweise: „Eine Ebene nach vorne/hinten“ (Strg ] / Strg [) – über das nächste überlappende Objekt
// derselben Schicht (Rahmen bleiben unter allem anderen). Neue z-Schlüssel nur für bewegte Objekte.
import type { BoardObject } from '../../protocol';
import { intersects, objRect } from '../../board/geometry';
import { keysBetween } from '../../board/fractional';
import { isBelow } from '../../board/types';

/** z-Patches für einen Schritt nach vorne (dir 1) bzw. hinten (-1); `ordered` von unten nach oben. */
export function layerStepPatches(ordered: readonly BoardObject[], selected: ReadonlySet<string>, dir: 1 | -1): Record<string, { z: string }> {
  const list = ordered.slice();
  const moved = new Set<string>();
  const sameLayer = (a: BoardObject, b: BoardObject) => isBelow(a) === isBelow(b);
  const indexOf = (id: string) => list.findIndex((o) => o.id === id);
  // oben zuerst nach vorne, unten zuerst nach hinten – so überholen sich ausgewählte Objekte nicht
  const order = list.filter((o) => selected.has(o.id) && !o.locked);
  if (dir > 0) order.reverse();
  for (const o of order) {
    const i = indexOf(o.id);
    const r = objRect(o);
    let j = i + dir;
    let target = -1;
    for (; j >= 0 && j < list.length; j += dir) {
      const n = list[j];
      if (!sameLayer(n, o)) break;
      if (selected.has(n.id)) continue;
      if (intersects(objRect(n), r)) {
        target = j;
        break;
      }
    }
    if (target < 0) continue;
    // nach vorne: nach dem Entfernen rückt das Ziel eine Stelle nach unten → Einfügen an `target` = direkt darüber;
    // nach hinten: Einfügen an `target` = direkt darunter
    list.splice(i, 1);
    list.splice(target, 0, o);
    moved.add(o.id);
  }
  if (!moved.size) return {};
  // Läufe bewegter Objekte zwischen unbewegten Nachbarn derselben Schicht neu nummerieren
  const out: Record<string, { z: string }> = {};
  let k = 0;
  while (k < list.length) {
    if (!moved.has(list[k].id)) {
      k++;
      continue;
    }
    let end = k;
    while (end + 1 < list.length && moved.has(list[end + 1].id)) end++;
    const ref = list[k];
    const below = k > 0 && sameLayer(list[k - 1], ref) ? list[k - 1].z : null;
    const above = end + 1 < list.length && sameLayer(list[end + 1], ref) ? list[end + 1].z : null;
    const keys = keysBetween(below || null, above || null, end - k + 1);
    for (let n = k; n <= end; n++) out[list[n].id] = { z: keys[n - k] };
    k = end + 1;
  }
  return out;
}
