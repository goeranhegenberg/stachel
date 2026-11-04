// Referenzwerte aus dem Web-Code für Auswahl & Anordnen der Flutter-App (Paritäts-Audit Paket P1): Einrasten
// (snapping.ts: snapMove mit Kanten/Mitten/gleichen Abständen, snapResize, guideLines), Lasso (lasso.ts), Raster
// (grid.ts), Größe ändern (geometry.ts resizeRect/mapRect, resize.ts rotatedResize), Drehen (rotate.ts snapAngle,
// angleLabel, rotationField, rotateMany) und Stift-Punkte (pen.ts scalePoints). Führt die echten Web-Funktionen aus
// (ohne Browser) und schreibt docs/native_fixtures/web/arrange.json – die App vergleicht ihre Portierungen damit
// (packages/stachel_board/test/features/snapping/arrange_web_reference_test.dart, liest die Datei direkt).
//   server/node_modules/.bin/tsx --tsconfig web/tsconfig.json tools/native-arrange-fixtures.mts [--out <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoardObject } from '../web/src/protocol';
import { mapRect, resizeRect, type Handle, type Rect } from '../web/src/board/geometry';
import { scalePoints } from '../web/src/board/pen';
import { guideLines, snapMove, snapResize } from '../web/src/editor/interaction/snapping';
import { lassoBounds, rectInLasso } from '../web/src/editor/interaction/lasso';
import { rotatedResize } from '../web/src/editor/interaction/resize';
import { angleLabel, rotateMany, rotationField, snapAngle } from '../web/src/editor/interaction/rotate';
import { GRID, snapToGrid } from '../web/src/features/tools/grid';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1]! : path.join(ROOT, 'docs/native_fixtures/web'));

// fester Zufall (mulberry32), damit die Datei bei gleichem Web-Code gleich bleibt
let seed = 0x5eed_0001;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const rect = (): Rect => ({ x: int(-400, 400), y: int(-400, 400), w: int(20, 260), h: int(20, 260) });

// ---- Einrasten ----
const snapMoveCases: unknown[] = [];
// Reihen mit gleichen Abständen (Abstands-Einrasten) und zufällige Nachbarn
for (let i = 0; i < 60; i++) {
  const others: Rect[] = [];
  if (i % 3 === 0) {
    const y = int(-100, 100);
    const gap = int(20, 80);
    let x = int(-500, -200);
    for (let k = 0; k < 3; k++) {
      const w = int(60, 140);
      others.push({ x, y: y + int(-10, 10), w, h: int(60, 140) });
      x += w + gap + (k === 1 ? 200 : 0);
    }
  }
  const n = int(1, 6);
  for (let k = 0; k < n; k++) others.push(rect());
  const base = others[int(0, others.length - 1)]!;
  // nahe an einer Kante, damit oft eingerastet wird
  const box: Rect = { x: base.x + base.w + int(-8, 40) + rnd(), y: base.y + int(-8, 8) + rnd(), w: int(40, 200), h: int(40, 200) };
  const tol = [6, 3, 12, 1.5][i % 4]!;
  snapMoveCases.push({ box, others, tol, result: snapMove(box, others, tol) });
}
snapMoveCases.push({ box: { x: 0, y: 0, w: 10, h: 10 }, others: [], tol: 6, result: snapMove({ x: 0, y: 0, w: 10, h: 10 }, [], 6) });

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const snapResizeCases: unknown[] = [];
for (let i = 0; i < 40; i++) {
  const others = Array.from({ length: int(1, 5) }, rect);
  const nb = rect();
  const handle = HANDLES[i % 8]!;
  snapResizeCases.push({ nb, handle, others, tol: 6, result: snapResize(nb, handle, others, 6), lines: guideLines(nb, others) });
}

// ---- Lasso ----
const lassoCases: unknown[] = [];
for (let i = 0; i < 30; i++) {
  const cx = int(-200, 200);
  const cy = int(-200, 200);
  const pts = Array.from({ length: int(5, 14) }, (_, k, a = (k / 14) * Math.PI * 2) => ({
    x: Math.round(cx + Math.cos(a) * int(80, 260)),
    y: Math.round(cy + Math.sin(a) * int(80, 260)),
  }));
  const r = { x: cx + int(-150, 100), y: cy + int(-150, 100), w: int(10, 120), h: int(10, 120) };
  lassoCases.push({ poly: pts, rect: r, inside: rectInLasso(r, pts), bounds: lassoBounds(pts) });
}

// ---- Größe ändern ----
const resizeCases: unknown[] = [];
for (let i = 0; i < 64; i++) {
  const start = rect();
  const handle = HANDLES[i % 8]!;
  const dx = int(-300, 300) + rnd();
  const dy = int(-300, 300) + rnd();
  const keep = i % 3 === 0;
  const min = i % 2 ? 12 : 8;
  resizeCases.push({ start, handle, dx, dy, keep, min, result: resizeRect(start, handle, dx, dy, keep, min) });
}
const rotatedCases: unknown[] = [];
for (let i = 0; i < 48; i++) {
  const box = rect();
  const handle = HANDLES[i % 8]!;
  const dx = int(-200, 200);
  const dy = int(-200, 200);
  const rot = [30, -45, 90, 135, 180, -170.5, 12.3][i % 7]!;
  const keep = i % 4 === 0;
  const widthOnly = i % 5 === 0 && (handle === 'e' || handle === 'w');
  rotatedCases.push({ box, handle, dx, dy, rot, keep, widthOnly, result: rotatedResize(box, handle, dx, dy, rot, keep, widthOnly) });
}
const mapCases: unknown[] = [];
for (let i = 0; i < 20; i++) {
  const r = rect();
  const from = rect();
  const to = i === 0 ? { ...rect(), w: 0 } : rect();
  if (i === 1) from.w = 0;
  mapCases.push({ r, from, to, result: mapRect(r, from, to) });
}

// ---- Drehen ----
const angles = [0, 3, -3, 4.99, 5.01, 87, 93, 178, -178, 180, -180, 181, 359, 370, 30.04, -0.4, -44.95, 225, 720.5, -95.06];
const angleCases = angles.map((a) => ({ a, snap: snapAngle(a, false), label: angleLabel(a), field: rotationField(a) ?? null }));
const objs: BoardObject[] = [
  { id: 's', type: 'sticky', x: 10, y: 20, w: 200, h: 200, z: 'a', createdBy: '', updatedAt: '', rotation: 15 },
  { id: 't', type: 'text', x: 300, y: -40, w: 120, h: 36, z: 'b', createdBy: '', updatedAt: '' },
  { id: 'p', type: 'pen', x: -50, y: 100, w: 64, h: 44, z: 'c', createdBy: '', updatedAt: '', strokeWidth: 4, points: [2, 2, 30.5, 10, 62, 42] },
  { id: 'c', type: 'connector', x: 0, y: 0, w: 1, h: 1, z: 'd', createdBy: '', updatedAt: '', from: { objectId: 's' }, to: { x: 400, y: 300 } },
] as BoardObject[];
const origin = new Map(objs.map((o) => [o.id, o]));
const rotateCases = [0, 37, 90, -120.5, 180].map((d) => ({ delta: d, c: { x: 150, y: 120 }, result: rotateMany(origin, { x: 150, y: 120 }, d) }));

// ---- Raster, Stift ----
const gridCases = [-37, -12, -11.9, 0, 11.9, 12, 13, 35.99, 36, 100.4, 1000].map((v) => ({ v, result: snapToGrid(v) }));
const scaleCases = [
  [1.5, 0.5],
  [0.333, 2],
  [1, 1],
].map(([sx, sy]) => ({ points: [2, 2, 30.5, 10, 62, 42.25], sx, sy, result: scalePoints([2, 2, 30.5, 10, 62, 42.25], sx!, sy!) }));

const out = {
  generatedBy: 'tools/native-arrange-fixtures.mts',
  grid: GRID,
  snapMove: snapMoveCases,
  snapResize: snapResizeCases,
  lasso: lassoCases,
  resizeRect: resizeCases,
  rotatedResize: rotatedCases,
  mapRect: mapCases,
  angles: angleCases,
  rotateMany: { objects: objs, cases: rotateCases },
  snapToGrid: gridCases,
  scalePoints: scaleCases,
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'arrange.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`arrange.json: ${snapMoveCases.length} snapMove, ${resizeCases.length} resizeRect, ${rotatedCases.length} rotatedResize, ${lassoCases.length} Lasso`);
