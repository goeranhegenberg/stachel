// Laserpointer (ohne React): eigene Spur senden, fremde Spuren aus der Awareness zusammensetzen. Punkte verblassen.
import type { Point } from '../../board/geometry';

/** Lebensdauer eines Spurpunkts (ms) */
export const LASER_LIFE = 900;
/** so viele letzte Punkte stehen in der Awareness (Lücken beim Empfang füllen) */
export const LASER_SEND = 24;

export interface TrailPoint extends Point {
  t: number;
  /** Beginn eines neuen Strichs (nicht mit dem vorigen Punkt verbinden) */
  gap?: boolean;
}

/** Awareness-Nachricht: s = Nummer des letzten Punkts, p = letzte Punkte [x,y, …], g = Nummern, die einen Strich beginnen */
export interface LaserMsg {
  s: number;
  p: number[];
  g?: number[];
}

/** Eigene Spur: Punkte sammeln, Nachricht bauen. */
export class LaserSender {
  private seq = 0;
  private recent: { n: number; x: number; y: number; gap: boolean }[] = [];
  private nextGap = true;
  /** neuen Strich beginnen */
  begin() {
    this.nextGap = true;
  }
  add(p: Point): LaserMsg {
    this.seq++;
    this.recent.push({ n: this.seq, x: Math.round(p.x), y: Math.round(p.y), gap: this.nextGap });
    this.nextGap = false;
    if (this.recent.length > LASER_SEND) this.recent.shift();
    return this.msg();
  }
  msg(): LaserMsg {
    const g = this.recent.filter((r) => r.gap).map((r) => r.n);
    return { s: this.seq, p: this.recent.flatMap((r) => [r.x, r.y]), ...(g.length ? { g } : {}) };
  }
}

/** Fremde Spur: neue Punkte aus einer Nachricht übernehmen (mit Empfangszeit), alte verwerfen. */
export class LaserReceiver {
  private last = 0;
  points: TrailPoint[] = [];
  /** Nachricht übernehmen; true = neue Punkte */
  take(msg: unknown, now: number): boolean {
    if (!isMsg(msg)) return false;
    if (msg.s < this.last) this.last = 0; // Seite neu geladen: Zählung beginnt von vorn
    const count = msg.p.length / 2;
    const first = msg.s - count + 1;
    let added = false;
    for (let i = 0; i < count; i++) {
      const n = first + i;
      if (n <= this.last) continue;
      // Lücke (Punkte verpasst) oder markierter Neubeginn trennt den Strich
      const gap = (msg.g?.includes(n) ?? false) || (i === 0 && n !== this.last + 1);
      this.points.push({ x: msg.p[i * 2], y: msg.p[i * 2 + 1], t: now, gap });
      added = true;
    }
    this.last = Math.max(this.last, msg.s);
    this.prune(now);
    return added;
  }
  prune(now: number) {
    const cut = now - LASER_LIFE;
    let i = 0;
    while (i < this.points.length && this.points[i].t < cut) i++;
    if (i) this.points.splice(0, i);
  }
}

function isMsg(v: unknown): v is LaserMsg {
  if (!v || typeof v !== 'object') return false;
  const m = v as LaserMsg;
  return typeof m.s === 'number' && Array.isArray(m.p) && m.p.length % 2 === 0 && m.p.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Segmente einer Spur mit Deckkraft (0–1) nach Alter, für die Darstellung. */
export function trailSegments(points: readonly TrailPoint[], now: number): { a: Point; b: Point; alpha: number }[] {
  const out: { a: Point; b: Point; alpha: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (b.gap) continue;
    const alpha = 1 - (now - b.t) / LASER_LIFE;
    if (alpha > 0) out.push({ a: points[i - 1], b, alpha });
  }
  return out;
}
