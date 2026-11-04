// Ausrichtungshilfen: Kanten und Mitten einrasten, gleiche Abstände zu Nachbarn.
import type { Handle, Rect } from '../../board/geometry';

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
/** Abstandsmarke: waagerechte oder senkrechte Strecke mit Länge in Weltpunkten. */
export interface GapMark extends Line {
  len: number;
}
export interface SnapResult {
  dx: number;
  dy: number;
  lines: Line[];
  gaps: GapMark[];
}

type Axis = 'x' | 'y';
const pos = (r: Rect, a: Axis) => (a === 'x' ? r.x : r.y);
const len = (r: Rect, a: Axis) => (a === 'x' ? r.w : r.h);
const edges = (r: Rect, a: Axis) => [pos(r, a), pos(r, a) + len(r, a) / 2, pos(r, a) + len(r, a)];
const other = (a: Axis): Axis => (a === 'x' ? 'y' : 'x');
const overlaps = (a: Rect, b: Rect, ax: Axis) => pos(a, ax) < pos(b, ax) + len(b, ax) && pos(b, ax) < pos(a, ax) + len(a, ax);

/** Kleinste Korrektur, mit der eine der `mine`-Kanten auf eine `theirs`-Kante fällt (oder null). */
function bestEdge(mine: number[], theirs: number[], tol: number): number | null {
  let best: number | null = null;
  for (const m of mine)
    for (const t of theirs) {
      const d = t - m;
      if (Math.abs(d) <= tol && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  return best;
}

interface GapSnap {
  d: number;
  marks: (r: Rect) => GapMark[];
}

function mark(a: Rect, b: Rect, axis: Axis): GapMark | null {
  // Strecke zwischen rechter/unterer Kante von a und linker/oberer von b, mittig im Überlappungsbereich
  const o = other(axis);
  const lo = Math.max(pos(a, o), pos(b, o));
  const hi = Math.min(pos(a, o) + len(a, o), pos(b, o) + len(b, o));
  const c = lo <= hi ? (lo + hi) / 2 : (pos(a, o) + len(a, o) / 2 + pos(b, o) + len(b, o) / 2) / 2;
  const s = pos(a, axis) + len(a, axis);
  const e = pos(b, axis);
  if (e - s < 1) return null;
  return axis === 'x' ? { x1: s, y1: c, x2: e, y2: c, len: Math.round(e - s) } : { x1: c, y1: s, x2: c, y2: e, len: Math.round(e - s) };
}

function gapSnap(box: Rect, others: readonly Rect[], axis: Axis, tol: number): GapSnap | null {
  const o = other(axis);
  const row = others.filter((r) => overlaps(r, box, o));
  const end = (r: Rect) => pos(r, axis) + len(r, axis);
  const bs = pos(box, axis);
  const be = bs + len(box, axis);
  let left: Rect | null = null;
  let right: Rect | null = null;
  for (const r of row) {
    if (end(r) <= bs + tol && (!left || end(r) > end(left))) left = r;
    if (pos(r, axis) >= be - tol && (!right || pos(r, axis) < pos(right, axis))) right = r;
  }
  const options: GapSnap[] = [];
  if (left && right && pos(right, axis) - end(left) > len(box, axis)) {
    const L = left;
    const R = right;
    const target = (end(L) + pos(R, axis) - len(box, axis)) / 2;
    options.push({ d: target - bs, marks: (r) => [mark(L, r, axis), mark(r, R, axis)].filter((m): m is GapMark => !!m) });
  }
  if (left) {
    const L = left;
    let LL: Rect | null = null;
    for (const r of row) if (r !== L && end(r) <= pos(L, axis) && (!LL || end(r) > end(LL))) LL = r;
    if (LL) {
      const P = LL;
      const g = pos(L, axis) - end(P);
      options.push({ d: end(L) + g - bs, marks: (r) => [mark(P, L, axis), mark(L, r, axis)].filter((m): m is GapMark => !!m) });
    }
  }
  if (right) {
    const R = right;
    let RR: Rect | null = null;
    for (const r of row) if (r !== R && pos(r, axis) >= end(R) && (!RR || pos(r, axis) < pos(RR, axis))) RR = r;
    if (RR) {
      const N = RR;
      const g = pos(N, axis) - end(R);
      options.push({ d: pos(R, axis) - g - be, marks: (r) => [mark(r, R, axis), mark(R, N, axis)].filter((m): m is GapMark => !!m) });
    }
  }
  let best: GapSnap | null = null;
  for (const opt of options) if (Math.abs(opt.d) <= tol && (!best || Math.abs(opt.d) < Math.abs(best.d))) best = opt;
  return best;
}

/** Hilfslinien für alle Kanten von `r`, die mit Kanten anderer Objekte fluchten. */
export function guideLines(r: Rect, others: readonly Rect[], eps = 0.5): Line[] {
  const lines: Line[] = [];
  for (const axis of ['x', 'y'] as const) {
    const o = other(axis);
    for (const v of edges(r, axis)) {
      let lo = pos(r, o);
      let hi = pos(r, o) + len(r, o);
      let hit = false;
      for (const q of others) {
        if (!edges(q, axis).some((e) => Math.abs(e - v) <= eps)) continue;
        hit = true;
        lo = Math.min(lo, pos(q, o));
        hi = Math.max(hi, pos(q, o) + len(q, o));
      }
      if (hit) lines.push(axis === 'x' ? { x1: v, y1: lo, x2: v, y2: hi } : { x1: lo, y1: v, x2: hi, y2: v });
    }
  }
  return lines;
}

/** Verschobene Auswahl (`box` = schon um den Rohversatz bewegt) einrasten. */
export function snapMove(box: Rect, others: readonly Rect[], tol: number): SnapResult {
  const res: SnapResult = { dx: 0, dy: 0, lines: [], gaps: [] };
  if (!others.length) return res;
  const gapsFor: ((r: Rect) => GapMark[])[] = [];
  for (const axis of ['x', 'y'] as const) {
    const e = bestEdge(edges(box, axis), others.flatMap((r) => edges(r, axis)), tol);
    const g = gapSnap(box, others, axis, tol);
    let d = 0;
    if (g && (e === null || Math.abs(g.d) < Math.abs(e) - 0.01)) {
      d = g.d;
      gapsFor.push(g.marks);
    } else if (e !== null) d = e;
    if (axis === 'x') res.dx = d;
    else res.dy = d;
  }
  const r = { ...box, x: box.x + res.dx, y: box.y + res.dy };
  res.lines = guideLines(r, others);
  res.gaps = gapsFor.flatMap((f) => f(r));
  return res;
}

/** Beim Größe-Ändern nur die gezogenen Kanten einrasten. Liefert die Korrektur für den Zeigerversatz. */
export function snapResize(nb: Rect, handle: Handle, others: readonly Rect[], tol: number): { dx: number; dy: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  if (handle.includes('w')) xs.push(nb.x);
  if (handle.includes('e')) xs.push(nb.x + nb.w);
  if (handle.includes('n')) ys.push(nb.y);
  if (handle.includes('s')) ys.push(nb.y + nb.h);
  const dx = xs.length ? bestEdge(xs, others.flatMap((r) => edges(r, 'x')), tol) : null;
  const dy = ys.length ? bestEdge(ys, others.flatMap((r) => edges(r, 'y')), tol) : null;
  return { dx: dx ?? 0, dy: dy ?? 0 };
}
