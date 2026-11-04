// Freihand: Punkte ausdünnen (Ramer-Douglas-Peucker) und als geglätteten SVG-Pfad ausgeben.
import { distToSegment, type Point } from './geometry';

export function simplify(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(points[i], points[s], points[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > epsilon) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Quadratische Glättung über Mittelpunkte – ergibt weiche Kurven ohne Überschwinger. */
export function smoothPath(flat: readonly number[]): string {
  const n = Math.floor(flat.length / 2);
  if (n === 0) return '';
  const r = (v: number) => Math.round(v * 100) / 100;
  if (n === 1) return `M${r(flat[0])} ${r(flat[1])}l0.01 0`;
  if (n === 2) return `M${r(flat[0])} ${r(flat[1])}L${r(flat[2])} ${r(flat[3])}`;
  let d = `M${r(flat[0])} ${r(flat[1])}`;
  for (let i = 1; i < n - 1; i++) {
    const x = flat[i * 2];
    const y = flat[i * 2 + 1];
    const mx = (x + flat[i * 2 + 2]) / 2;
    const my = (y + flat[i * 2 + 3]) / 2;
    d += `Q${r(x)} ${r(y)} ${r(mx)} ${r(my)}`;
  }
  d += `L${r(flat[(n - 1) * 2])} ${r(flat[(n - 1) * 2 + 1])}`;
  return d;
}

/** Weltpunkte → Stift-Objekt-Felder (Bounding Box + relative Punkte). */
export function penFromPoints(points: Point[], strokeWidth: number) {
  const pad = strokeWidth / 2;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const p of points) {
    x1 = Math.min(x1, p.x);
    y1 = Math.min(y1, p.y);
    x2 = Math.max(x2, p.x);
    y2 = Math.max(y2, p.y);
  }
  const x = x1 - pad;
  const y = y1 - pad;
  const flat: number[] = [];
  for (const p of points) flat.push(Math.round((p.x - x) * 10) / 10, Math.round((p.y - y) * 10) / 10);
  return { x, y, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2, points: flat };
}

/** Punkte beim Skalieren eines Strichs mitskalieren. */
export function scalePoints(points: readonly number[], sx: number, sy: number): number[] {
  return points.map((v, i) => Math.round((i % 2 === 0 ? v * sx : v * sy) * 10) / 10);
}
