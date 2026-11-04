// Referenzwerte aus dem Web-Code für die Dart-Tests der Flutter-App (Konzept §6.2): führt die echten Web-Funktionen
// aus (ohne Server, ohne Browser) und schreibt JSON – die App vergleicht ihre Portierungen damit. Ändert jemand die
// Web-Geometrie, fällt die Abweichung in der App beim nächsten Lauf auf.
//   shapes.json      alle registrierten Formen: SVG-Pfad (mehrere Größen/Insets) und Textfläche (shapeInsets)
//   connectors.json  Verbinder-Geometrie (gerade/gewinkelt/geschwungen, Seiten, gedrehte Objekte, Umrisse, frei)
//   order.json       Zeichenreihenfolge (Rahmen zuerst, z byteweise, dann id) mit kaputten/gleichen Schlüsseln
// Nicht dabei: Auto-Schriftgrößen (brauchen Canvas-Textmessung im Browser).
// Aufruf (im Stachel-Repo): server/node_modules/.bin/tsx --tsconfig web/tsconfig.json tools/native-web-fixtures.mts
//   [--out docs/native_fixtures/web]   (flutter/packages/stachel_board liest die Datei direkt)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shapeInsets, shapePath } from '../web/src/editor/core/shapeKinds';
import '../web/src/features/shapes/kinds';
import { shapeKinds } from '../web/src/editor/ext/registry';
import { connectorGeometry } from '../web/src/board/connector';
import { compareKeys } from '../web/src/board/fractional';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1]! : path.join(ROOT, 'docs/native_fixtures/web'));

const write = (name: string, value: unknown) => {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);
  console.log(`geschrieben: ${path.relative(ROOT, file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
};

// ---- Formen ----
const kinds = shapeKinds.list().map((d) => d.kind as string);
const sizes: [number, number][] = [[100, 100], [180, 120], [240, 90], [57.5, 133.25], [400, 40]];
const insets = [0, 1, 2.5];
const shapeCases = kinds.flatMap((kind) =>
  sizes.flatMap(([w, h]) =>
    insets.map((inset) => ({ kind, w, h, inset, path: shapePath(kind as never, w, h, inset), insets: shapeInsets(kind as never, w, h) })),
  ),
);
write('shapes.json', { kinds, cases: shapeCases });

// ---- Verbinder ----
type Obj = Record<string, unknown> & { id: string };
const objects: Obj[] = [
  { id: 'r1', type: 'shape', shape: 'rect', x: 0, y: 0, w: 200, h: 120 },
  { id: 'r2', type: 'shape', shape: 'rect', x: 500, y: 300, w: 160, h: 100 },
  { id: 'rot', type: 'shape', shape: 'rect', x: 520, y: -260, w: 180, h: 90, rotation: 30 },
  { id: 'ell', type: 'shape', shape: 'ellipse', x: -420, y: 260, w: 200, h: 120 },
  { id: 'dia', type: 'shape', shape: 'diamond', x: -380, y: -300, w: 160, h: 160 },
  { id: 'hex', type: 'shape', shape: 'hexagon', x: 260, y: 520, w: 180, h: 110, rotation: -15 },
  { id: 'n1', type: 'sticky', x: 900, y: 40, w: 200, h: 200 },
  { id: 'n2', type: 'sticky', x: 120, y: 160, w: 120, h: 120 },
];
const lookup = (id: string) => objects.find((o) => o.id === id) as never;
const sides = [undefined, 'top', 'right', 'bottom', 'left'] as const;
const pairs: [string, string][] = [['r1', 'r2'], ['r1', 'rot'], ['ell', 'dia'], ['hex', 'n1'], ['r1', 'n2'], ['dia', 'hex'], ['n1', 'rot']];
const connectorCases: { from: unknown; to: unknown; lineStyle: string; geometry: unknown }[] = [];
for (const lineStyle of ['straight', 'elbow', 'curved']) {
  for (const [a, b] of pairs) {
    for (const sa of sides) {
      for (const sb of [undefined, 'left', 'top'] as const) {
        const from = sa ? { objectId: a, side: sa } : { objectId: a };
        const to = sb ? { objectId: b, side: sb } : { objectId: b };
        connectorCases.push({ from, to, lineStyle, geometry: connectorGeometry({ from, to, lineStyle } as never, lookup) });
      }
    }
  }
  // freie Enden und gemischt
  for (const [from, to] of [
    [{ x: -100, y: -50 }, { x: 300, y: 250 }],
    [{ x: 50, y: 400 }, { objectId: 'r2' }],
    [{ objectId: 'rot', side: 'bottom' }, { x: 1000, y: -200 }],
    [{ x: 10, y: 10 }, { x: 10, y: 10 }],
  ] as [unknown, unknown][]) {
    connectorCases.push({ from, to, lineStyle, geometry: connectorGeometry({ from, to, lineStyle } as never, lookup) });
  }
}
connectorCases.push({ from: { objectId: 'fehlt' }, to: { objectId: 'r1' }, lineStyle: 'straight', geometry: null });
write('connectors.json', { objects, cases: connectorCases });

// ---- Reihenfolge ----
const orderObjects: Obj[] = [
  { id: 'b', type: 'sticky', z: 'a1' },
  { id: 'a', type: 'sticky', z: 'a1' },
  { id: 'f1', type: 'frame', z: 'zz' },
  { id: 'c', type: 'shape', z: '' },
  { id: 'd', type: 'text', z: 'Z' },
  { id: 'e', type: 'sticky', z: 'a' },
  { id: 'f0', type: 'frame', z: 'a0' },
  { id: 'g', type: 'sticky', z: 'a0V' },
  { id: 'h', type: 'sticky', z: '~' },
  { id: 'i', type: 'sticky', z: 'a0' },
  { id: 'B', type: 'sticky', z: 'a1' },
  { id: '_', type: 'sticky', z: 'a1' },
  { id: '-', type: 'sticky', z: 'a1' },
];
const below = (o: Obj) => (o.type === 'frame' ? 0 : 1);
const sorted = [...orderObjects].sort((x, y) => below(x) - below(y) || compareKeys(String(x.z), String(y.z)) || compareKeys(x.id, y.id));
write('order.json', { objects: orderObjects, expected: sorted.map((o) => o.id) });
