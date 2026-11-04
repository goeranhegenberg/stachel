// Reihenfolge der Rahmen (Rahmen-Liste, Präsentation, Bild ↑/↓): eigene Reihenfolge über das Feld `slide`
// (Fractional-Index), Rahmen ohne `slide` danach in Lesereihenfolge.
import type { BoardObject } from '../../../protocol';
import type { Patch } from '../../../board/store';
import { keyBetween, keysBetween } from '../../../board/fractional';

/** Lesereihenfolge: Zeilen von oben nach unten, in der Zeile von links nach rechts. */
export function readingOrder(frames: readonly BoardObject[]): BoardObject[] {
  const sorted = [...frames].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: BoardObject[][] = [];
  for (const f of sorted) {
    const row = rows[rows.length - 1];
    // gleiche Zeile, wenn der Rahmen oben innerhalb der halben Höhe des Zeilenanfangs liegt
    if (row && f.y < row[0].y + Math.min(row[0].h, f.h) / 2) row.push(f);
    else rows.push([f]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x - b.x));
}

export function framesInOrder(ordered: readonly BoardObject[]): BoardObject[] {
  const reading = readingOrder(ordered.filter((o) => o.type === 'frame'));
  const pos = new Map(reading.map((f, i) => [f.id, i]));
  const keyed = reading.filter((f) => typeof f.slide === 'string').sort((a, b) => (a.slide! < b.slide! ? -1 : a.slide! > b.slide! ? 1 : pos.get(a.id)! - pos.get(b.id)!));
  return [...keyed, ...reading.filter((f) => typeof f.slide !== 'string')];
}

/** Patches, die Rahmen `from` an Position `to` der (geordneten) Liste verschieben. */
export function movePatches(frames: readonly BoardObject[], from: number, to: number): Record<string, Patch> {
  if (from === to || from < 0 || from >= frames.length) return {};
  const list = frames.slice();
  const [f] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(list.length, to)), 0, f);
  // Haben alle (außer dem verschobenen) schon einen Schlüssel und passt einer dazwischen: nur diesen setzen
  const others = list.filter((x) => x.id !== f.id);
  const i = list.indexOf(f);
  if (others.every((x) => typeof x.slide === 'string')) {
    const a = list[i - 1]?.slide ?? null;
    const b = list[i + 1]?.slide ?? null;
    if (a === null || b === null || a < b) return { [f.id]: { slide: keyBetween(a, b) } };
  }
  const keys = keysBetween(null, null, list.length);
  return Object.fromEntries(list.map((x, j) => [x.id, { slide: keys[j] }]));
}
