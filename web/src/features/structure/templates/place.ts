// Freien Platz für eingefügte Vorlagen (und eingefügte Notizen/Tabellen) suchen: in der Bildmitte, wenn
// dort nichts liegt, sonst am nächstgelegenen freien Platz daneben. Ohne React, testbar.
import type { Point, Rect } from '../../../board/geometry';

/** Abstand zu vorhandenem Inhalt (Weltpunkte) */
export const FREE_MARGIN = 60;

/**
 * Mittelpunkt für ein Rechteck der Größe `size`, möglichst nah an `center`, das mit Rand `margin` nichts überdeckt.
 * `occupied(r)` meldet, ob im Rechteck `r` schon etwas liegt. Sucht in Ringen um die Mitte; findet sich nichts, bleibt
 * es bei der Mitte.
 */
export function freeSpot(size: { w: number; h: number }, center: Point, occupied: (r: Rect) => boolean, margin = FREE_MARGIN, maxRings = 40): Point {
  const rectAt = (p: Point): Rect => ({ x: p.x - size.w / 2 - margin, y: p.y - size.h / 2 - margin, w: size.w + 2 * margin, h: size.h + 2 * margin });
  if (!occupied(rectAt(center))) return center;
  const step = Math.max(80, Math.min(size.w, size.h) / 3);
  for (let ring = 1; ring <= maxRings; ring++) {
    const cands: Point[] = [];
    for (let i = -ring; i <= ring; i++) {
      cands.push({ x: center.x + i * step, y: center.y - ring * step }, { x: center.x + i * step, y: center.y + ring * step });
      if (Math.abs(i) !== ring) cands.push({ x: center.x - ring * step, y: center.y + i * step }, { x: center.x + ring * step, y: center.y + i * step });
    }
    // nächstgelegene zuerst; bei Gleichstand rechts vor unten vor links vor oben (Lesereihenfolge)
    cands.sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y) || b.x - a.x || b.y - a.y);
    const hit = cands.find((p) => !occupied(rectAt(p)));
    if (hit) return { x: Math.round(hit.x), y: Math.round(hit.y) };
  }
  return center;
}
