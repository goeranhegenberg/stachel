// Verbinder-Geometrie des Moduls (ohne React): Punkt entlang der Linie, Projektion (Beschriftung verschieben)
// und die Spitzen-Formen an beiden Enden.
import { arrowHeadAt, bezierAt, polylineAt, type ConnectorGeometry } from '../../board/connector';
import type { Point } from '../../board/geometry';
import type { CapStyle } from './model';

/** Punkt bei Anteil `t` (0…1) entlang des Pfads (geschwungen: Kurvenparameter). */
export function pathPointAt(g: Pick<ConnectorGeometry, 'style' | 'pts'>, t: number): Point {
  if (g.style === 'curved' && g.pts.length === 4) return bezierAt(g.pts, t);
  return polylineAt(g.pts, t);
}

/** Anteil `t` des Pfadpunkts, der `p` am nächsten liegt. */
export function projectOnPath(g: Pick<ConnectorGeometry, 'style' | 'pts'>, p: Point, steps = 160): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= steps; i++) {
    const q = pathPointAt(g, i / steps);
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i / steps;
    }
  }
  // fein nachsuchen
  const lo = Math.max(0, best - 1 / steps);
  const hi = Math.min(1, best + 1 / steps);
  for (let i = 0; i <= 20; i++) {
    const t = lo + ((hi - lo) * i) / 20;
    const q = pathPointAt(g, t);
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return Math.round(best * 1000) / 1000;
}

export const capSize = (sw: number) => 8 + sw * 3;

/** Wie weit die Linie vor der Spitze endet. */
export function capTrim(cap: CapStyle, sw: number): number {
  const s = capSize(sw);
  switch (cap) {
    case 'triangle':
      return s * 0.7;
    case 'triangleOpen':
      return s * 0.9;
    case 'circle':
    case 'circleOpen':
      return s * 0.84;
    case 'diamond':
    case 'diamondOpen':
      return s * 1.2;
    case 'arrow':
      return sw * 0.5;
    default:
      return 0;
  }
}

export type CapGeom =
  | { kind: 'polygon'; pts: Point[]; filled: boolean }
  | { kind: 'polyline'; pts: Point[] }
  | { kind: 'circle'; c: Point; r: number; filled: boolean }
  | { kind: 'line'; a: Point; b: Point };

/** Form der Spitze an `tip`; `dir` zeigt von der Linie weg (zur Spitze hin). */
export function capGeom(cap: CapStyle, tip: Point, dir: Point, sw: number): CapGeom | null {
  const s = capSize(sw);
  const len = Math.hypot(dir.x, dir.y) || 1;
  const d = { x: dir.x / len, y: dir.y / len };
  const n = { x: -d.y, y: d.x };
  const at = (k: number, m = 0): Point => ({ x: tip.x - d.x * k + n.x * m, y: tip.y - d.y * k + n.y * m });
  switch (cap) {
    case 'triangle':
    case 'triangleOpen':
      return { kind: 'polygon', pts: arrowHeadAt(tip, d, s), filled: cap === 'triangle' };
    case 'arrow': {
      const h = arrowHeadAt(tip, d, s * 1.05);
      return { kind: 'polyline', pts: [h[1], tip, h[2]] };
    }
    case 'circle':
    case 'circleOpen': {
      const r = s * 0.42;
      return { kind: 'circle', c: at(r), r, filled: cap === 'circle' };
    }
    case 'diamond':
    case 'diamondOpen': {
      const L = s * 1.2;
      const W = s * 0.42;
      return { kind: 'polygon', pts: [tip, at(L / 2, W), at(L), at(L / 2, -W)], filled: cap === 'diamond' };
    }
    case 'bar':
      return { kind: 'line', a: at(0, s * 0.55), b: at(0, -s * 0.55) };
    default:
      return null;
  }
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Gewinkelter Pfad mit runden Ecken, verschoben um (-ox, -oy); `trimA`/`trimB` kürzen die Enden
 * entlang der Endrichtungen (Platz für Spitzen) – wie connectorPath im Kern.
 */
export function roundedElbowPath(g: Pick<ConnectorGeometry, 'pts' | 'a' | 'b' | 'dirA' | 'dirB'>, ox: number, oy: number, trimA: number, trimB: number, radius = 12): string {
  const pts = g.pts.map((p) => ({ x: p.x - ox, y: p.y - oy }));
  const n = pts.length;
  const total = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y);
  if (total > trimA + trimB) {
    pts[0] = { x: pts[0].x - g.dirA.x * trimA, y: pts[0].y - g.dirA.y * trimA };
    pts[n - 1] = { x: pts[n - 1].x - g.dirB.x * trimB, y: pts[n - 1].y - g.dirB.y * trimB };
  }
  let d = `M${r2(pts[0].x)} ${r2(pts[0].y)}`;
  for (let i = 1; i < n - 1; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    const nx = pts[i + 1];
    const l1 = Math.hypot(q.x - p.x, q.y - p.y);
    const l2 = Math.hypot(nx.x - q.x, nx.y - q.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    if (r < 0.5) {
      d += `L${r2(q.x)} ${r2(q.y)}`;
      continue;
    }
    const a = { x: q.x - ((q.x - p.x) / l1) * r, y: q.y - ((q.y - p.y) / l1) * r };
    const b = { x: q.x + ((nx.x - q.x) / l2) * r, y: q.y + ((nx.y - q.y) / l2) * r };
    d += `L${r2(a.x)} ${r2(a.y)}Q${r2(q.x)} ${r2(q.y)} ${r2(b.x)} ${r2(b.y)}`;
  }
  return d + `L${r2(pts[n - 1].x)} ${r2(pts[n - 1].y)}`;
}
