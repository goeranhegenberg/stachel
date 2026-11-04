// Verbinder-Geometrie: Enden an Objekten andocken (Strahl oder Seitenmitte), gerade/gewinkelt/geschwungen.
import type { BoardObject, ConnectorEnd, LineStyle, Side } from '../protocol';
import { baseRect, center, rotatePoint, rotationOf, type Point, type Rect } from './geometry';

export type { Side };

/** Umriss einer Form zum Andocken: Polygon in Objektkoordinaten (0..w, 0..h). Kernformen sind fest eingebaut. */
export type ShapeOutline = (w: number, h: number) => Point[];
const OUTLINES = new Map<string, ShapeOutline>();
/** Umriss einer neuen Form bekannt machen (sonst dockt der Verbinder am Rechteck an). */
export function registerShapeOutline(kind: string, outline: ShapeOutline) {
  OUTLINES.set(kind, outline);
}

export const CONNECTOR_GAP = 6;
/** Mindestlänge des ersten/letzten Stücks eines gewinkelten Verbinders (senkrecht aus der Seite). */
export const ELBOW_STUB = 28;

export type ObjectLookup = (id: string) => BoardObject | undefined;

const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];
const DIR: Record<Side, Point> = { n: { x: 0, y: -1 }, e: { x: 1, y: 0 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 } };

export const isAttached = (e: ConnectorEnd | undefined): e is { objectId: string } =>
  !!e && typeof (e as { objectId?: unknown }).objectId === 'string';

/** Fest gewählte Seite eines angedockten Endes (optionales Feld `side`, sonst null). */
export function endSide(e: ConnectorEnd | undefined): Side | null {
  const s = (e as { side?: unknown } | undefined)?.side;
  return typeof s === 'string' && (SIDES as readonly string[]).includes(s) ? (s as Side) : null;
}

export function lineStyleOf(c: { lineStyle?: LineStyle | string }): LineStyle {
  return c.lineStyle === 'elbow' || c.lineStyle === 'curved' ? c.lineStyle : 'straight';
}

/** Bezugspunkt eines Endes (Mitte des Objekts oder freier Punkt); null wenn Objekt fehlt. */
export function endAnchor(end: ConnectorEnd | undefined, lookup: ObjectLookup): Point | null {
  if (!end) return null;
  if (isAttached(end)) {
    const o = lookup(end.objectId);
    return o ? center(baseRect(o)) : null;
  }
  return Number.isFinite(end.x) && Number.isFinite(end.y) ? { x: end.x, y: end.y } : null;
}

type Outline = Pick<BoardObject, 'x' | 'y' | 'w' | 'h' | 'type' | 'shape'> & { rotation?: number };

/** Schnittpunkt des Strahls von der Mitte von `o` in Richtung `toward` mit dem Umriss von `o` (auch gedreht). */
export function boundaryPoint(o: Outline, toward: Point): Point {
  const r: Rect = baseRect(o);
  const c = center(r);
  const deg = rotationOf(o);
  const t0 = deg ? rotatePoint(toward, c, -deg) : toward;
  const dx = t0.x - c.x;
  const dy = t0.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = r.w / 2;
  const hh = r.h / 2;
  let t: number;
  if (o.type === 'shape' && o.shape === 'ellipse') {
    t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  } else if (o.type === 'shape' && o.shape === 'diamond') {
    t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  } else if (o.type === 'shape' && o.shape === 'triangle') {
    t = rayPolygon(c, { x: dx, y: dy }, [
      { x: r.x + hw, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
    ]);
  } else if (o.type === 'shape' && o.shape && OUTLINES.has(o.shape)) {
    t = rayPolygon(c, { x: dx, y: dy }, OUTLINES.get(o.shape)!(r.w, r.h).map((q) => ({ x: r.x + q.x, y: r.y + q.y })));
  } else {
    t = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  }
  const p = { x: c.x + dx * t, y: c.y + dy * t };
  return deg ? rotatePoint(p, c, deg) : p;
}

/** Kleinstes t>0 mit origin + t*dir auf dem Polygonrand. */
function rayPolygon(origin: Point, dir: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dir.x * ey - dir.y * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - origin.x) * ey - (a.y - origin.y) * ex) / den;
    const u = ((a.x - origin.x) * dir.y - (a.y - origin.y) * dir.x) / den;
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return Number.isFinite(best) ? best : 1;
}

/** Seite von `o`, die `toward` am ehesten zugewandt ist (relativ zur Objektgröße). */
export function nearestSide(o: Outline, toward: Point): Side {
  const r = baseRect(o);
  const c = center(r);
  const deg = rotationOf(o);
  const p = deg ? rotatePoint(toward, c, -deg) : toward;
  const dx = (p.x - c.x) / Math.max(1, r.w);
  const dy = (p.y - c.y) / Math.max(1, r.h);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'e' : 'w';
  return dy >= 0 ? 's' : 'n';
}

/** Mitte einer Seite (auf dem Umriss der Form) und die Richtung nach außen – beides ggf. gedreht. */
export function sidePoint(o: Outline, side: Side): { p: Point; dir: Point } {
  const r = baseRect(o);
  const c = center(r);
  const d = DIR[side];
  // Ellipse/Raute/Dreieck: Strahl aus der Mitte trifft die Kante genau in der Seitenmitte bzw. am Umriss
  const raw = boundaryPoint({ ...o, rotation: 0 }, { x: c.x + d.x * r.w, y: c.y + d.y * r.h });
  const deg = rotationOf(o);
  if (!deg) return { p: raw, dir: d };
  const p = rotatePoint(raw, c, deg);
  const q = rotatePoint({ x: c.x + d.x, y: c.y + d.y }, c, deg);
  return { p, dir: { x: q.x - c.x, y: q.y - c.y } };
}

export interface ConnectorGeometry {
  /** Start- und Endpunkt (mit Abstand zur Objektkante). */
  a: Point;
  b: Point;
  style: LineStyle;
  /** straight: [a, b] · elbow: Knickpunkte a … b · curved: [a, c1, c2, b] (kubische Bézierkurve) */
  pts: Point[];
  /** Mitte des Pfads (Beschriftung). */
  mid: Point;
  /** Richtung, in die die Linie am Anfang bzw. Ende zeigt (für Pfeilspitzen, jeweils vom Pfad weg). */
  dirA: Point;
  dirB: Point;
}

function pullBack(p: Point, toward: Point, by: number): Point {
  const dx = toward.x - p.x;
  const dy = toward.y - p.y;
  const len = Math.hypot(dx, dy);
  if (len < by * 2 || len === 0) return p;
  return { x: p.x + (dx / len) * by, y: p.y + (dy / len) * by };
}

const add = (p: Point, d: Point, k: number): Point => ({ x: p.x + d.x * k, y: p.y + d.y * k });
const unit = (d: Point): Point => {
  const l = Math.hypot(d.x, d.y);
  return l === 0 ? { x: 1, y: 0 } : { x: d.x / l, y: d.y / l };
};

/** Achsenrichtung, die von `from` nach `to` am stärksten zeigt. */
function axisToward(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: dx >= 0 ? 1 : -1, y: 0 };
  return { x: 0, y: dy >= 0 ? 1 : -1 };
}

interface EndInfo {
  p: Point;
  dir: Point | null; // Richtung nach außen (nur bei Seiten-Andocken)
}

function resolveEnd(end: ConnectorEnd | undefined, other: Point, style: LineStyle, lookup: ObjectLookup): EndInfo | null {
  if (!end) return null;
  if (!isAttached(end)) {
    const p = endAnchor(end, lookup);
    return p ? { p, dir: null } : null;
  }
  const o = lookup(end.objectId);
  if (!o) return null;
  const side = endSide(end) ?? (style === 'straight' ? null : nearestSide(o, other));
  if (!side) return { p: pullBack(boundaryPoint(o, other), other, CONNECTOR_GAP), dir: null };
  const { p, dir } = sidePoint(o, side);
  const u = unit(dir);
  return { p: add(p, u, CONNECTOR_GAP), dir: u };
}

/** Start/Ende und Pfad eines Verbinders; null, wenn ein angedocktes Objekt fehlt. */
export function connectorGeometry(
  c: Pick<BoardObject, 'from' | 'to'> & { lineStyle?: LineStyle | string },
  lookup: ObjectLookup,
): ConnectorGeometry | null {
  const fa = endAnchor(c.from, lookup);
  const ta = endAnchor(c.to, lookup);
  if (!fa || !ta) return null;
  const style = lineStyleOf(c);
  // Gegenpunkt für die Seitenwahl: Mitte bzw. freier Punkt des anderen Endes
  const A = resolveEnd(c.from, ta, style, lookup);
  const B = resolveEnd(c.to, fa, style, lookup);
  if (!A || !B) return null;
  const a = A.p;
  const b = B.p;

  if (style === 'straight') {
    const d = unit({ x: b.x - a.x, y: b.y - a.y });
    return { a, b, style, pts: [a, b], mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dirA: { x: -d.x, y: -d.y }, dirB: d };
  }

  // freie Enden: Richtung zeigt auf das andere Ende
  const da = A.dir ?? axisToward(a, b);
  const db = B.dir ?? axisToward(b, a);

  if (style === 'curved') {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const k = Math.max(40, Math.min(dist * 0.45, 260));
    const c1 = add(a, A.dir ?? unit({ x: b.x - a.x, y: b.y - a.y }), A.dir ? k : 0);
    const c2 = add(b, B.dir ?? unit({ x: a.x - b.x, y: a.y - b.y }), B.dir ? k : 0);
    const pts = [a, c1, c2, b];
    return { a, b, style, pts, mid: bezierAt(pts, 0.5), dirA: unit(sub(a, bezierAt(pts, 0.04))), dirB: unit(sub(b, bezierAt(pts, 0.96))) };
  }

  const pts = simplifyOrtho(elbowRoute(a, axisDir(da), b, axisDir(db)));
  const n = pts.length;
  return {
    a,
    b,
    style,
    pts,
    mid: polylineAt(pts, 0.5),
    dirA: unit(sub(pts[0], pts[1])),
    dirB: unit(sub(pts[n - 1], pts[n - 2])),
  };
}

const sub = (p: Point, q: Point): Point => ({ x: p.x - q.x, y: p.y - q.y });

/** Gedrehte Richtungen auf die nächste Achse runden (Knick-Verbinder bleiben achsenparallel). */
function axisDir(d: Point): Point {
  return Math.abs(d.x) >= Math.abs(d.y) ? { x: Math.sign(d.x) || 1, y: 0 } : { x: 0, y: Math.sign(d.y) || 1 };
}

/** Orthogonaler Weg von a (Ausgang da) nach b (Eingang von außen, Richtung db) mit möglichst wenigen Knicken. */
export function elbowRoute(a: Point, da: Point, b: Point, db: Point): Point[] {
  const S = ELBOW_STUB;
  const ha = da.x !== 0;
  const hb = db.x !== 0;
  const pa = add(a, da, S);
  const pb = add(b, db, S);
  if (ha && hb) {
    if (da.x === -db.x) {
      // gegenüberliegende Seiten (→ ←): Z-Form über die Mitte, wenn b in Ausgangsrichtung liegt
      if ((b.x - a.x) * da.x >= 2 * S) {
        const mx = (a.x + b.x) / 2;
        return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
      }
      const my = (a.y + b.y) / 2;
      return [a, pa, { x: pa.x, y: my }, { x: pb.x, y: my }, pb, b];
    }
    // gleiche Seite (→ →): außen herum
    const x = da.x > 0 ? Math.max(pa.x, pb.x) : Math.min(pa.x, pb.x);
    return [a, { x, y: a.y }, { x, y: b.y }, b];
  }
  if (!ha && !hb) {
    if (da.y === -db.y) {
      if ((b.y - a.y) * da.y >= 2 * S) {
        const my = (a.y + b.y) / 2;
        return [a, { x: a.x, y: my }, { x: b.x, y: my }, b];
      }
      const mx = (a.x + b.x) / 2;
      return [a, pa, { x: mx, y: pa.y }, { x: mx, y: pb.y }, pb, b];
    }
    const y = da.y > 0 ? Math.max(pa.y, pb.y) : Math.min(pa.y, pb.y);
    return [a, { x: a.x, y }, { x: b.x, y }, b];
  }
  if (ha) {
    // waagerecht raus, senkrecht rein: ein Knick bei (b.x, a.y), wenn beide Richtungen passen
    if ((b.x - a.x) * da.x > 0 && (a.y - b.y) * db.y > 0) return [a, { x: b.x, y: a.y }, b];
    return [a, pa, { x: pa.x, y: pb.y }, pb, b];
  }
  if ((b.y - a.y) * da.y > 0 && (a.x - b.x) * db.x > 0) return [a, { x: a.x, y: b.y }, b];
  return [a, pa, { x: pb.x, y: pa.y }, pb, b];
}

/** Doppelte und auf einer Linie liegende Zwischenpunkte entfernen. */
function simplifyOrtho(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const p = out[i - 1];
    const q = out[i];
    const r = out[i + 1];
    const cross = (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
    if (Math.abs(cross) < 0.01) out.splice(i, 1);
  }
  return out.length >= 2 ? out : [pts[0], pts[pts.length - 1]];
}

export function bezierAt(p: Point[], t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x, y: a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y };
}

/** Punkt bei Anteil `f` (0…1) der Gesamtlänge einer Polylinie. */
export function polylineAt(pts: Point[], f: number): Point {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let rest = total * f;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (rest <= l && l > 0) return { x: pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * rest) / l, y: pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * rest) / l };
    rest -= l;
  }
  return pts[pts.length - 1];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * SVG-Pfad des Verbinders, verschoben um (-ox, -oy). `trimA`/`trimB` kürzen Anfang/Ende (Platz für Pfeilspitzen).
 */
export function connectorPath(g: ConnectorGeometry, ox = 0, oy = 0, trimA = 0, trimB = 0): string {
  const pts = g.pts.map((p) => ({ x: p.x - ox, y: p.y - oy }));
  const n = pts.length;
  const total = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y);
  if (trimA && total > trimA + trimB) pts[0] = add(pts[0], g.dirA, -trimA);
  if (trimB && total > trimA + trimB) pts[n - 1] = add(pts[n - 1], g.dirB, -trimB);
  const P = (p: Point) => `${r2(p.x)} ${r2(p.y)}`;
  if (g.style === 'curved') return `M${P(pts[0])}C${P(pts[1])} ${P(pts[2])} ${P(pts[3])}`;
  return `M${P(pts[0])}` + pts.slice(1).map((p) => `L${P(p)}`).join('');
}

export function connectorBounds(g: Pick<ConnectorGeometry, 'a' | 'b'> & { pts?: Point[]; style?: LineStyle }, pad = 12): Rect {
  const pts = g.pts ?? [g.a, g.b];
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  // Bézierkurve: Stützpunkte abtasten statt Kontrollpunkte (die liegen weit außerhalb)
  const sample = g.style === 'curved' && pts.length === 4 ? Array.from({ length: 17 }, (_, i) => bezierAt(pts, i / 16)) : pts;
  for (const p of sample) {
    x1 = Math.min(x1, p.x);
    y1 = Math.min(y1, p.y);
    x2 = Math.max(x2, p.x);
    y2 = Math.max(y2, p.y);
  }
  return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
}

/** Pfeilspitze als Dreieck an der Spitze `tip`, die Linie kommt aus Richtung `-dir`. */
export function arrowHeadAt(tip: Point, dir: Point, size: number): Point[] {
  const ang = Math.atan2(dir.y, dir.x);
  const spread = 0.45;
  return [
    tip,
    { x: tip.x - size * Math.cos(ang - spread), y: tip.y - size * Math.sin(ang - spread) },
    { x: tip.x - size * Math.cos(ang + spread), y: tip.y - size * Math.sin(ang + spread) },
  ];
}

/** Pfeilspitze als Dreieck (Punkte im Weltkoordinatensystem). */
export function arrowHead(a: Point, b: Point, size: number): Point[] {
  return arrowHeadAt(b, { x: b.x - a.x, y: b.y - a.y }, size);
}

/** Strichmuster für `dash` (skaliert mit der Strichstärke). */
export function dashArray(dash: string | undefined, strokeWidth: number): string | undefined {
  const sw = Math.max(1, strokeWidth);
  if (dash === 'dashed') return `${r2(sw * 4 + 2)} ${r2(sw * 2.5 + 3)}`;
  if (dash === 'dotted') return `0 ${r2(sw * 2 + 2)}`;
  return undefined;
}

/** IDs aller Verbinder, die an eines der Objekte angedockt sind. */
export function attachedConnectors(objects: Iterable<BoardObject>, ids: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const o of objects) {
    if (o.type !== 'connector') continue;
    if ((isAttached(o.from) && ids.has(o.from.objectId)) || (isAttached(o.to) && ids.has(o.to.objectId))) out.push(o.id);
  }
  return out;
}
