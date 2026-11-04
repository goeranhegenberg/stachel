// Lasso-Auswahl: Freihand-Umriss, ausgewählt wird, was komplett darin liegt.
import type { Point, Rect } from '../../board/geometry';

/** Punkt im Polygon (Even-Odd-Regel; das Polygon gilt als geschlossen). */
export function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Liegt das Rechteck komplett im Lasso? Ecken, Kantenmitten und Mitte müssen drin sein, keine Lasso-Ecke im Rechteck. */
export function rectInLasso(r: Rect, poly: readonly Point[]): boolean {
  if (poly.length < 3) return false;
  const xs = [r.x, r.x + r.w / 2, r.x + r.w];
  const ys = [r.y, r.y + r.h / 2, r.y + r.h];
  for (const x of xs) for (const y of ys) if (!pointInPolygon({ x, y }, poly)) return false;
  // eine Einbuchtung des Lassos, die ins Rechteck ragt, schließt es aus
  for (const q of poly) if (q.x > r.x && q.x < r.x + r.w && q.y > r.y && q.y < r.y + r.h) return false;
  return true;
}

/** Umschließendes Rechteck der Lasso-Punkte. */
export function lassoBounds(poly: readonly Point[]): Rect {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const p of poly) {
    x1 = Math.min(x1, p.x);
    y1 = Math.min(y1, p.y);
    x2 = Math.max(x2, p.x);
    y2 = Math.max(y2, p.y);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
