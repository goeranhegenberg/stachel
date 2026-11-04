// Drehen: magnetisches Einrasten auf 0°/90°/180°/270°, Umschalt in 15°-Schritten, mehrere Objekte um die
// gemeinsame Mitte (jedes dreht sich mit, Stiftstriche und freie Verbinder-Enden werden mitgedreht).
import type { BoardObject } from '../../protocol';
import type { Patch } from '../../board/store';
import { isAttached } from '../../board/connector';
import { center, rotatePoint, type Point } from '../../board/geometry';
import { penFromPoints } from '../../board/pen';

/** Fangbereich um die rechten Winkel in Grad (üblicher Einrastabstand). */
export const ROTATE_SNAP_DEG = 5;
/** Umschalt: feste Schritte in Grad. */
export const ROTATE_STEP_DEG = 15;

/** Winkel auf (-180, 180] normieren. */
export function normDeg(d: number): number {
  const n = ((((d + 180) % 360) + 360) % 360) - 180;
  return n === -180 ? 180 : n;
}

/**
 * Winkel beim Drehen: mit Umschalt in 15°-Schritten, sonst frei auf 0,1° gerundet und nahe an 0°/90°/180°/270°
 * eingerastet. `snapped`: der Winkel liegt genau auf einem rechten Winkel (Rückmeldung, Etikett).
 */
export function snapAngle(a: number, shift: boolean): { deg: number; snapped: boolean } {
  const d = normDeg(a);
  if (shift) {
    const s = normDeg(Math.round(d / ROTATE_STEP_DEG) * ROTATE_STEP_DEG);
    return { deg: s, snapped: s % 90 === 0 };
  }
  const right = Math.round(d / 90) * 90;
  if (Math.abs(d - right) <= ROTATE_SNAP_DEG) return { deg: normDeg(right), snapped: true };
  const r = Math.round(d * 10) / 10;
  return { deg: r === -180 ? 180 : r, snapped: false };
}

/** Anzeige des Winkels im Etikett: ganze Grad, nie „-0°“. */
export function angleLabel(deg: number): string {
  const r = Math.round(normDeg(deg));
  return `${r === 0 ? 0 : r}°`;
}

/** Drehung als Feld `rotation` (0 = Feld weglassen). */
export const rotationField = (deg: number): number | undefined => {
  const n = Math.round(normDeg(deg) * 10) / 10;
  return n === 0 ? undefined : n === -180 ? 180 : n;
};

/**
 * Lässt sich die Auswahl gemeinsam drehen? Alle müssen drehbar sein (`rotatable`), Stiftstriche oder abgeleitete
 * Typen wie Verbinder (die folgen ihren Enden); Gesperrtes, Rahmen, Tabellen, Karten u. Ä. verhindern das Drehen.
 */
export function canRotateAll(selected: readonly BoardObject[], info: (o: BoardObject) => { rotatable?: boolean; derive?: unknown }): boolean {
  if (selected.length < 2) return false;
  let solid = 0;
  for (const o of selected) {
    if (o.locked) return false;
    const d = info(o);
    if (d.derive) continue;
    if (!d.rotatable && o.type !== 'pen') return false;
    solid++;
  }
  return solid > 0;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Patches für das Drehen mehrerer Objekte um `c` um `delta` Grad, immer ausgehend vom Stand bei Gestenbeginn
 * (`origin`) – zurück auf 0° ergibt also genau die alte Lage. Drehbare Objekte: Mitte wandert, `rotation` wächst;
 * Stiftstriche: Punkte gedreht; Verbinder: nur freie Enden (angedockte folgen ihren Objekten).
 */
export function rotateMany(origin: ReadonlyMap<string, BoardObject>, c: Point, delta: number): Record<string, Patch> {
  const out: Record<string, Patch> = {};
  for (const [id, o] of origin) {
    if (!delta) {
      out[id] = o.type === 'pen' ? { x: o.x, y: o.y, w: o.w, h: o.h, points: o.points } : o.type === 'connector' ? { from: o.from, to: o.to } : { x: o.x, y: o.y, rotation: o.rotation };
      continue;
    }
    if (o.type === 'connector') {
      const p: Patch = {};
      for (const k of ['from', 'to'] as const) {
        const e = o[k];
        if (e && !isAttached(e)) {
          const q = rotatePoint({ x: e.x, y: e.y }, c, delta);
          p[k] = { x: Math.round(q.x), y: Math.round(q.y) };
        }
      }
      out[id] = p;
      continue;
    }
    if (o.type === 'pen') {
      const pts = o.points ?? [];
      const abs: Point[] = [];
      for (let i = 0; i + 1 < pts.length; i += 2) abs.push(rotatePoint({ x: o.x + pts[i], y: o.y + pts[i + 1] }, c, delta));
      if (abs.length) out[id] = penFromPoints(abs, o.strokeWidth ?? 4);
      continue;
    }
    const m = rotatePoint(center(o), c, delta);
    out[id] = { x: round1(m.x - o.w / 2), y: round1(m.y - o.h / 2), rotation: rotationField((o.rotation ?? 0) + delta) };
  }
  return out;
}
