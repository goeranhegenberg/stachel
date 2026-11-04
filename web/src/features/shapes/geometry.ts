// Geometrie der Formen-Bibliothek ohne React: SVG-Pfad (um `inset` eingerückt), Textfläche, Umriss zum Andocken
// und einfache Fläche für kleine Darstellung. Koordinaten in Objektkoordinaten (0..w, 0..h).
import type { ShapeKind } from '../../protocol';
import type { Point } from '../../board/geometry';

export interface KindGeometry {
  path: (w: number, h: number, inset: number) => string;
  insets?: (w: number, h: number) => [number, number, number, number];
  outline?: (w: number, h: number) => Point[];
  simpleClip?: string;
  simpleRadius?: string;
  /** nur Linie, keine Füllung (Klammern) */
  open?: boolean;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const P = (x: number, y: number) => `${r2(x)} ${r2(y)}`;

/** Polygon in Einheitskoordinaten (0..1) → Punkte im um `inset` eingerückten Rechteck. */
const scale = (unit: readonly (readonly [number, number])[], w: number, h: number, inset = 0): Point[] =>
  unit.map(([u, v]) => ({ x: inset + u * (w - 2 * inset), y: inset + v * (h - 2 * inset) }));

const polyPath = (pts: Point[]) => `M${pts.map((p) => P(p.x, p.y)).join('L')}Z`;

const clipOf = (unit: readonly (readonly [number, number])[]) => `polygon(${unit.map(([u, v]) => `${r2(u * 100)}% ${r2(v * 100)}%`).join(', ')})`;

/** Form aus einem festen Einheits-Polygon. */
function polygonKind(unit: readonly (readonly [number, number])[], insets?: KindGeometry['insets']): KindGeometry {
  return {
    path: (w, h, inset) => polyPath(scale(unit, w, h, inset)),
    outline: (w, h) => scale(unit, w, h),
    insets,
    simpleClip: clipOf(unit),
  };
}

/** Form aus einem Polygon, das von w/h abhängt (Pfeile, Kreuz). */
function dynamicPolygon(points: (w: number, h: number) => Point[], insets?: KindGeometry['insets'], simpleClip?: string): KindGeometry {
  return {
    path: (w, h, inset) => {
      const pts = points(w - 2 * inset, h - 2 * inset).map((p) => ({ x: p.x + inset, y: p.y + inset }));
      return polyPath(pts);
    },
    outline: points,
    insets,
    simpleClip,
  };
}

/** Punkte entlang einer Ellipse (für Umrisse runder Formen). */
function ellipsePoints(cx: number, cy: number, rx: number, ry: number, n = 32, a0 = 0, a1 = Math.PI * 2): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / (n - (a1 - a0 >= Math.PI * 2 - 1e-9 ? 0 : 1));
    out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return out;
}

/** Abgerundetes Rechteck als Pfad (Radius r) und als Umriss. */
function roundRectPath(x1: number, y1: number, x2: number, y2: number, r: number): string {
  const rr = Math.max(0, Math.min(r, (x2 - x1) / 2, (y2 - y1) / 2));
  return (
    `M${P(x1 + rr, y1)}H${r2(x2 - rr)}A${r2(rr)} ${r2(rr)} 0 0 1 ${P(x2, y1 + rr)}V${r2(y2 - rr)}` +
    `A${r2(rr)} ${r2(rr)} 0 0 1 ${P(x2 - rr, y2)}H${r2(x1 + rr)}A${r2(rr)} ${r2(rr)} 0 0 1 ${P(x1, y2 - rr)}V${r2(y1 + rr)}` +
    `A${r2(rr)} ${r2(rr)} 0 0 1 ${P(x1 + rr, y1)}Z`
  );
}

function roundRectOutline(w: number, h: number, r: number): Point[] {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const q = Math.PI / 2;
  return [
    ...ellipsePoints(w - rr, rr, rr, rr, 5, -q, 0),
    ...ellipsePoints(w - rr, h - rr, rr, rr, 5, 0, q),
    ...ellipsePoints(rr, h - rr, rr, rr, 5, q, 2 * q),
    ...ellipsePoints(rr, rr, rr, rr, 5, 2 * q, 3 * q),
  ];
}

// ---- Sternpunkte (5 Zacken), auf das Rechteck gestreckt ----------------------------------------------------------
const STAR_UNIT: [number, number][] = (() => {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.4 : 1;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return pts.map(([x, y]) => [(x - x0) / (x1 - x0), (y - y0) / (y1 - y0)]);
})();

// ---- Pfeile -------------------------------------------------------------------------------------------------------
function arrowPoints(w: number, h: number, dir: 'right' | 'left' | 'both'): Point[] {
  const head = Math.min(w * (dir === 'both' ? 0.34 : 0.45), h * 0.9);
  const t = h * 0.22; // Abstand Schaft–Rand oben/unten
  if (dir === 'right')
    return [
      { x: 0, y: t },
      { x: w - head, y: t },
      { x: w - head, y: 0 },
      { x: w, y: h / 2 },
      { x: w - head, y: h },
      { x: w - head, y: h - t },
      { x: 0, y: h - t },
    ];
  if (dir === 'left') return arrowPoints(w, h, 'right').map((p) => ({ x: w - p.x, y: p.y }));
  return [
    { x: 0, y: h / 2 },
    { x: head, y: 0 },
    { x: head, y: t },
    { x: w - head, y: t },
    { x: w - head, y: 0 },
    { x: w, y: h / 2 },
    { x: w - head, y: h },
    { x: w - head, y: h - t },
    { x: head, y: h - t },
    { x: head, y: h },
  ];
}

function crossPoints(w: number, h: number): Point[] {
  const a = Math.min(w, h) * 0.34; // Balkenbreite
  const x1 = (w - a) / 2;
  const x2 = (w + a) / 2;
  const y1 = (h - a) / 2;
  const y2 = (h + a) / 2;
  return [
    { x: x1, y: 0 },
    { x: x2, y: 0 },
    { x: x2, y: y1 },
    { x: w, y: y1 },
    { x: w, y: y2 },
    { x: x2, y: y2 },
    { x: x2, y: h },
    { x: x1, y: h },
    { x: x1, y: y2 },
    { x: 0, y: y2 },
    { x: 0, y: y1 },
    { x: x1, y: y1 },
  ];
}

// ---- Wolke: Bögen um eine Ellipse -----------------------------------------------------------------------------------
function cloudPath(w: number, h: number, inset: number): string {
  const cx = w / 2;
  const cy = h / 2 + h * 0.03;
  const rx = w / 2 - inset - w * 0.08;
  const ry = h / 2 - inset - h * 0.14;
  const n = 9;
  const a0 = -Math.PI / 2 - 0.25;
  const pts = ellipsePoints(cx, cy, rx, ry, n, a0, a0 + Math.PI * 2);
  let d = `M${P(pts[0].x, pts[0].y)}`;
  for (let i = 1; i <= n; i++) {
    const a = pts[i - 1];
    const b = pts[i % n];
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    const r = chord * 0.62;
    d += `A${r2(r)} ${r2(r)} 0 0 1 ${P(b.x, b.y)}`;
  }
  return `${d}Z`;
}

// ---- Sprechblase --------------------------------------------------------------------------------------------------
function calloutPath(w: number, h: number, inset: number): string {
  const x1 = inset;
  const y1 = inset;
  const x2 = w - inset;
  const y2 = h * 0.78 - inset / 2;
  const r = Math.min(14, (x2 - x1) / 4, (y2 - y1) / 4);
  const t1 = x1 + w * 0.2;
  const t2 = x1 + w * 0.38;
  const tip = { x: x1 + w * 0.1, y: h - inset };
  return (
    `M${P(x1 + r, y1)}H${r2(x2 - r)}Q${P(x2, y1)} ${P(x2, y1 + r)}V${r2(y2 - r)}Q${P(x2, y2)} ${P(x2 - r, y2)}` +
    `H${r2(t2)}L${P(tip.x, tip.y)}L${P(t1, y2)}H${r2(x1 + r)}Q${P(x1, y2)} ${P(x1, y2 - r)}V${r2(y1 + r)}Q${P(x1, y1)} ${P(x1 + r, y1)}Z`
  );
}

// ---- Zylinder / Datenbank -----------------------------------------------------------------------------------------
const cylRy = (w: number, h: number) => Math.min(h * 0.14, w * 0.22);

function cylinderPath(w: number, h: number, inset: number): string {
  const x1 = inset;
  const x2 = w - inset;
  const rx = (x2 - x1) / 2;
  const ry = cylRy(w, h);
  const top = inset + ry;
  const bot = h - inset - ry;
  return (
    // Körper (unten halbe Ellipse), danach der obere Deckel als ganze Ellipse
    `M${P(x1, top)}V${r2(bot)}A${r2(rx)} ${r2(ry)} 0 0 0 ${P(x2, bot)}V${r2(top)}` +
    `A${r2(rx)} ${r2(ry)} 0 0 0 ${P(x1, top)}A${r2(rx)} ${r2(ry)} 0 0 0 ${P(x2, top)}`
  );
}

function cylinderOutline(w: number, h: number): Point[] {
  const ry = cylRy(w, h);
  return [...ellipsePoints(w / 2, ry, w / 2, ry, 12, Math.PI, Math.PI * 2), ...ellipsePoints(w / 2, h - ry, w / 2, ry, 12, 0, Math.PI)];
}

// ---- Flussdiagramm --------------------------------------------------------------------------------------------------
/** Blatt mit Wellenkante unten im Rechteck (x1,y1)–(x2,y2); `d` = Wellenhöhe. */
function sheetPath(x1: number, y1: number, x2: number, y2: number, d: number): string {
  const b = y2 - d;
  const mx = (x1 + x2) / 2;
  return `M${P(x1, y1)}H${r2(x2)}V${r2(b)}Q${P(x2 - (x2 - x1) / 4, b - d * 1.6)} ${P(mx, b)}T${P(x1, b)}Z`;
}

const documentPath = (w: number, h: number, inset: number) => sheetPath(inset, inset, w - inset, h - inset, h * 0.09);

function documentOutline(w: number, h: number): Point[] {
  const d = h * 0.09;
  const b = h - d;
  const out: Point[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
  ];
  for (let i = 0; i <= 16; i++) {
    const u = i / 16;
    out.push({ x: w * (1 - u), y: b - Math.sin(u * Math.PI * 2) * d * 0.8 });
  }
  return out;
}

function delayPath(w: number, h: number, inset: number): string {
  const r = Math.min((h - 2 * inset) / 2, (w - 2 * inset) / 2);
  const x2 = w - inset;
  return `M${P(inset, inset)}H${r2(x2 - r)}A${r2(r)} ${r2(h / 2 - inset)} 0 0 1 ${P(x2 - r, h - inset)}H${r2(inset)}Z`;
}

function bracePath(w: number, h: number, inset: number, side: 'left' | 'right'): string {
  const x1 = side === 'left' ? w - inset : inset; // offene Seite
  const x2 = side === 'left' ? inset : w - inset; // Spitze
  const xm = (x1 + x2) / 2;
  const y1 = inset;
  const y2 = h - inset;
  const ym = h / 2;
  const r = Math.min(Math.abs(x1 - x2) * 0.5, (y2 - y1) * 0.12);
  return `M${P(x1, y1)}Q${P(xm, y1)} ${P(xm, y1 + r)}V${r2(ym - r)}Q${P(xm, ym)} ${P(x2, ym)}Q${P(xm, ym)} ${P(xm, ym + r)}V${r2(y2 - r)}Q${P(xm, y2)} ${P(x1, y2)}`;
}

/** Pfeil nach oben/unten: der Rechtspfeil um 90° gedreht (Länge = h, Dicke = w). */
function arrowVertical(w: number, h: number, dir: 'up' | 'down'): Point[] {
  return arrowPoints(h, w, 'right').map((p) => ({ x: p.y, y: dir === 'down' ? p.x : h - p.x }));
}

// ---- Herz -----------------------------------------------------------------------------------------------------------
function heartPath(w: number, h: number, inset: number): string {
  const x1 = inset;
  const x2 = w - inset;
  const y1 = inset;
  const y2 = h - inset;
  const W = x2 - x1;
  const H = y2 - y1;
  const X = (u: number) => x1 + u * W;
  const Y = (v: number) => y1 + v * H;
  return (
    `M${P(X(0.5), Y(0.24))}C${P(X(0.62), Y(-0.04))} ${P(X(1.02), Y(0.0))} ${P(X(1), Y(0.32))}` +
    `C${P(X(0.98), Y(0.6))} ${P(X(0.66), Y(0.78))} ${P(X(0.5), Y(1))}` +
    `C${P(X(0.34), Y(0.78))} ${P(X(0.02), Y(0.6))} ${P(X(0), Y(0.32))}` +
    `C${P(X(-0.02), Y(0.0))} ${P(X(0.38), Y(-0.04))} ${P(X(0.5), Y(0.24))}Z`
  );
}

const HEART_UNIT: [number, number][] = [
  [0.5, 0.24],
  [0.62, 0.06],
  [0.8, 0.02],
  [0.96, 0.14],
  [1, 0.32],
  [0.92, 0.56],
  [0.72, 0.78],
  [0.5, 1],
  [0.28, 0.78],
  [0.08, 0.56],
  [0, 0.32],
  [0.04, 0.14],
  [0.2, 0.02],
  [0.38, 0.06],
];

// ---- weitere Flussdiagramm-Formen -------------------------------------------------------------------------------------

/** Mehrere Dokumente: vorne ein Dokument, dahinter zwei versetzte Blätter (gleicher Umlaufsinn, keine Löcher). */
function multiDocumentPath(w: number, h: number, inset: number): string {
  const off = Math.min(w, h) * 0.07;
  const fx2 = w - inset - 2 * off;
  const fy1 = inset + 2 * off;
  const fy2 = h - inset;
  const front = sheetPath(inset, fy1, fx2, fy2, h * 0.09);
  const sheet = (k: number) => `M${P(inset + k * off, fy1 - (k - 1) * off)}V${r2(fy1 - k * off)}H${r2(fx2 + k * off)}V${r2(fy2 - (h * 0.09 + k * off))}H${r2(fx2 + (k - 1) * off)}`;
  return sheet(2) + sheet(1) + front;
}

function displayPath(w: number, h: number, inset: number): string {
  const x1 = inset;
  const x2 = w - inset;
  const y1 = inset;
  const y2 = h - inset;
  const k = Math.min((x2 - x1) * 0.18, (y2 - y1) * 0.5);
  return `M${P(x1, h / 2)}L${P(x1 + k, y1)}H${r2(x2 - k)}A${r2(k)} ${r2((y2 - y1) / 2)} 0 0 1 ${P(x2 - k, y2)}H${r2(x1 + k)}Z`;
}

function storedDataPath(w: number, h: number, inset: number): string {
  const x1 = inset;
  const x2 = w - inset;
  const y1 = inset;
  const y2 = h - inset;
  const k = Math.min((x2 - x1) * 0.14, (y2 - y1) * 0.35);
  const ry = r2((y2 - y1) / 2);
  return `M${P(x1 + k, y1)}H${r2(x2)}A${r2(k)} ${ry} 0 0 0 ${P(x2, y2)}H${r2(x1 + k)}A${r2(k)} ${ry} 0 0 1 ${P(x1 + k, y1)}Z`;
}

function circleWith(w: number, h: number, inset: number, mark: 'x' | 'plus'): string {
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2 - inset;
  const ry = h / 2 - inset;
  const ring = `M${P(cx - rx, cy)}A${r2(rx)} ${r2(ry)} 0 1 1 ${P(cx + rx, cy)}A${r2(rx)} ${r2(ry)} 0 1 1 ${P(cx - rx, cy)}Z`;
  if (mark === 'plus') return `${ring}M${P(cx, cy - ry)}V${r2(cy + ry)}M${P(cx - rx, cy)}H${r2(cx + rx)}`;
  const k = Math.SQRT1_2;
  return `${ring}M${P(cx - rx * k, cy - ry * k)}L${P(cx + rx * k, cy + ry * k)}M${P(cx + rx * k, cy - ry * k)}L${P(cx - rx * k, cy + ry * k)}`;
}

const DIAMOND_UNIT: [number, number][] = [
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
  [0, 0.5],
];

const SQUARE: [number, number, number, number] = [0, 0, 0, 0];
const pad = (t: number, r: number, b: number, l: number) => (w: number, h: number) => [h * t, w * r, h * b, w * l] as [number, number, number, number];

/** Geometrie aller Formen dieses Moduls (Kernformen rect/ellipse/diamond/triangle bleiben im Kern). */
export const KIND_GEOMETRY: Partial<Record<ShapeKind, KindGeometry>> = {
  roundrect: {
    path: (w, h, inset) => roundRectPath(inset, inset, w - inset, h - inset, Math.min(w, h) * 0.18),
    outline: (w, h) => roundRectOutline(w, h, Math.min(w, h) * 0.18),
    simpleRadius: '18%',
  },
  pentagon: polygonKind(
    [
      [0.5, 0],
      [1, 0.38],
      [0.81, 1],
      [0.19, 1],
      [0, 0.38],
    ],
    pad(0.3, 0.2, 0.08, 0.2),
  ),
  hexagon: polygonKind(
    [
      [0.25, 0],
      [0.75, 0],
      [1, 0.5],
      [0.75, 1],
      [0.25, 1],
      [0, 0.5],
    ],
    pad(0.08, 0.2, 0.08, 0.2),
  ),
  octagon: polygonKind(
    [
      [0.29, 0],
      [0.71, 0],
      [1, 0.29],
      [1, 0.71],
      [0.71, 1],
      [0.29, 1],
      [0, 0.71],
      [0, 0.29],
    ],
    pad(0.12, 0.12, 0.12, 0.12),
  ),
  star: polygonKind(STAR_UNIT, pad(0.38, 0.3, 0.26, 0.3)),
  parallelogram: polygonKind(
    [
      [0.2, 0],
      [1, 0],
      [0.8, 1],
      [0, 1],
    ],
    pad(0.08, 0.18, 0.08, 0.18),
  ),
  trapezoid: polygonKind(
    [
      [0.2, 0],
      [0.8, 0],
      [1, 1],
      [0, 1],
    ],
    pad(0.1, 0.16, 0.08, 0.16),
  ),
  manualInput: polygonKind(
    [
      [0, 0.28],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    pad(0.3, 0.06, 0.06, 0.06),
  ),
  chevron: polygonKind(
    [
      [0, 0],
      [0.72, 0],
      [1, 0.5],
      [0.72, 1],
      [0, 1],
      [0.28, 0.5],
    ],
    pad(0.08, 0.22, 0.08, 0.26),
  ),
  arrowRight: dynamicPolygon((w, h) => arrowPoints(w, h, 'right'), (w, h) => [h * 0.24, Math.min(w * 0.3, h * 0.5), h * 0.24, w * 0.04], 'polygon(0 22%, 55% 22%, 55% 0, 100% 50%, 55% 100%, 55% 78%, 0 78%)'),
  arrowLeft: dynamicPolygon((w, h) => arrowPoints(w, h, 'left'), (w, h) => [h * 0.24, w * 0.04, h * 0.24, Math.min(w * 0.3, h * 0.5)], 'polygon(100% 22%, 45% 22%, 45% 0, 0 50%, 45% 100%, 45% 78%, 100% 78%)'),
  arrowDouble: dynamicPolygon(
    (w, h) => arrowPoints(w, h, 'both'),
    (w, h) => [h * 0.24, Math.min(w * 0.22, h * 0.45), h * 0.24, Math.min(w * 0.22, h * 0.45)],
    'polygon(0 50%, 30% 0, 30% 22%, 70% 22%, 70% 0, 100% 50%, 70% 100%, 70% 78%, 30% 78%, 30% 100%)',
  ),
  cross: dynamicPolygon(crossPoints, (w, h) => [h * 0.36, w * 0.36, h * 0.36, w * 0.36], 'polygon(33% 0, 67% 0, 67% 33%, 100% 33%, 100% 67%, 67% 67%, 67% 100%, 33% 100%, 33% 67%, 0 67%, 0 33%, 33% 33%)'),
  cylinder: {
    path: cylinderPath,
    outline: cylinderOutline,
    insets: (w, h) => [cylRy(w, h) * 2 + 4, w * 0.08, cylRy(w, h) + 4, w * 0.08],
    simpleRadius: '50% / 14%',
  },
  cloud: {
    path: cloudPath,
    outline: (w, h) => ellipsePoints(w / 2, h / 2, w / 2 - w * 0.02, h / 2 - h * 0.04, 24),
    insets: pad(0.24, 0.2, 0.2, 0.2),
    simpleRadius: '50%',
  },
  callout: {
    path: calloutPath,
    outline: (w, h) => [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h * 0.78 },
      { x: w * 0.38, y: h * 0.78 },
      { x: w * 0.1, y: h },
      { x: w * 0.2, y: h * 0.78 },
      { x: 0, y: h * 0.78 },
    ],
    insets: (_w, h) => [10, 12, h * 0.22 + 10, 12],
    simpleClip: 'polygon(0 0, 100% 0, 100% 78%, 38% 78%, 10% 100%, 20% 78%, 0 78%)',
  },
  terminator: {
    path: (w, h, inset) => roundRectPath(inset, inset, w - inset, h - inset, h / 2),
    outline: (w, h) => roundRectOutline(w, h, h / 2),
    insets: (w, h) => [8, Math.min(w * 0.2, h * 0.4), 8, Math.min(w * 0.2, h * 0.4)],
    simpleRadius: '999px',
  },
  document: {
    path: documentPath,
    outline: documentOutline,
    insets: (_w, h) => [10, 12, h * 0.18 + 6, 12],
  },
  predefined: {
    path: (w, h, inset) => {
      const k = Math.min(w * 0.1, 22);
      return `M${P(inset, inset)}H${r2(w - inset)}V${r2(h - inset)}H${r2(inset)}Z` + `M${P(inset + k, inset)}V${r2(h - inset)}M${P(w - inset - k, inset)}V${r2(h - inset)}`;
    },
    insets: (w) => [10, Math.min(w * 0.1, 22) + 8, 10, Math.min(w * 0.1, 22) + 8],
  },
  delay: {
    path: delayPath,
    outline: (w, h) => {
      const r = Math.min(h / 2, w / 2);
      return [{ x: 0, y: 0 }, ...ellipsePoints(w - r, h / 2, r, h / 2, 13, -Math.PI / 2, Math.PI / 2), { x: 0, y: h }];
    },
    insets: (w, h) => [10, Math.min(h / 2, w / 2) * 0.45 + 8, 10, 12],
    simpleRadius: '0 50% 50% 0',
  },
  braceLeft: { path: (w, h, inset) => bracePath(w, h, inset, 'left'), insets: () => SQUARE, open: true },
  braceRight: { path: (w, h, inset) => bracePath(w, h, inset, 'right'), insets: () => SQUARE, open: true },
  arrowUp: dynamicPolygon((w, h) => arrowVertical(w, h, 'up'), (w, h) => [Math.min(h * 0.3, w * 0.5), w * 0.24, h * 0.04, w * 0.24], 'polygon(22% 100%, 22% 45%, 0 45%, 50% 0, 100% 45%, 78% 45%, 78% 100%)'),
  arrowDown: dynamicPolygon((w, h) => arrowVertical(w, h, 'down'), (w, h) => [h * 0.04, w * 0.24, Math.min(h * 0.3, w * 0.5), w * 0.24], 'polygon(22% 0, 78% 0, 78% 55%, 100% 55%, 50% 100%, 0 55%, 22% 55%)'),
  pentagonArrow: polygonKind(
    [
      [0, 0],
      [0.76, 0],
      [1, 0.5],
      [0.76, 1],
      [0, 1],
    ],
    pad(0.08, 0.24, 0.08, 0.06),
  ),
  heart: {
    path: heartPath,
    outline: (w, h) => HEART_UNIT.map(([u, v]) => ({ x: u * w, y: v * h })),
    insets: pad(0.26, 0.2, 0.3, 0.2),
    simpleClip: clipOf(HEART_UNIT),
  },
  manualOperation: polygonKind(
    [
      [0, 0],
      [1, 0],
      [0.8, 1],
      [0.2, 1],
    ],
    pad(0.08, 0.18, 0.08, 0.18),
  ),
  offPage: polygonKind(
    [
      [0, 0],
      [1, 0],
      [1, 0.62],
      [0.5, 1],
      [0, 0.62],
    ],
    pad(0.08, 0.08, 0.36, 0.08),
  ),
  merge: polygonKind(
    [
      [0, 0],
      [1, 0],
      [0.5, 1],
    ],
    pad(0.06, 0.28, 0.5, 0.28),
  ),
  card: polygonKind(
    [
      [0.18, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0.28],
    ],
    pad(0.12, 0.08, 0.08, 0.1),
  ),
  sort: {
    path: (w, h, inset) => `${polyPath(scale(DIAMOND_UNIT, w, h, inset))}M${P(inset, h / 2)}H${r2(w - inset)}`,
    outline: (w, h) => scale(DIAMOND_UNIT, w, h),
    insets: pad(0.22, 0.25, 0.22, 0.25),
    simpleClip: clipOf(DIAMOND_UNIT),
  },
  multiDocument: {
    path: multiDocumentPath,
    outline: (w, h) => [
      { x: 0, y: Math.min(w, h) * 0.14 },
      { x: Math.min(w, h) * 0.14, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h * 0.8 },
      { x: w * 0.5, y: h },
      { x: 0, y: h * 0.92 },
    ],
    insets: (w, h) => [Math.min(w, h) * 0.14 + 10, Math.min(w, h) * 0.14 + 10, h * 0.2 + 4, 12],
  },
  display: {
    path: displayPath,
    outline: (w, h) => {
      const k = Math.min(w * 0.18, h * 0.5);
      return [{ x: 0, y: h / 2 }, { x: k, y: 0 }, ...ellipsePoints(w - k, h / 2, k, h / 2, 9, -Math.PI / 2, Math.PI / 2), { x: k, y: h }];
    },
    insets: (w, h) => [8, Math.min(w * 0.18, h * 0.5) * 0.6 + 8, 8, Math.min(w * 0.18, h * 0.5) + 6],
  },
  storedData: {
    path: storedDataPath,
    insets: (w, h) => [8, Math.min(w * 0.14, h * 0.35) + 6, 8, Math.min(w * 0.14, h * 0.35) + 6],
  },
  internalStorage: {
    path: (w, h, inset) => {
      const k = Math.min(w, h) * 0.16;
      return `M${P(inset, inset)}H${r2(w - inset)}V${r2(h - inset)}H${r2(inset)}Z` + `M${P(inset + k, inset)}V${r2(h - inset)}M${P(inset, inset + k)}H${r2(w - inset)}`;
    },
    insets: (w, h) => [Math.min(w, h) * 0.16 + 6, 10, 8, Math.min(w, h) * 0.16 + 6],
  },
  summing: { path: (w, h, inset) => circleWith(w, h, inset, 'x'), outline: (w, h) => ellipsePoints(w / 2, h / 2, w / 2, h / 2, 24), insets: pad(0.3, 0.3, 0.3, 0.3), simpleRadius: '50%' },
  or: { path: (w, h, inset) => circleWith(w, h, inset, 'plus'), outline: (w, h) => ellipsePoints(w / 2, h / 2, w / 2, h / 2, 24), insets: pad(0.3, 0.3, 0.3, 0.3), simpleRadius: '50%' },
};

/** Formen ohne Füllung (nur Linie). */
export const isOpenKind = (kind: string | undefined) => !!kind && !!KIND_GEOMETRY[kind as ShapeKind]?.open;
