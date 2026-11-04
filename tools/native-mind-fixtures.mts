// Referenzwerte des Mindmap-Codes für die Dart-Tests der Flutter-App (Konzept §6.2): führt die echten Web-Funktionen
// (web/src/features/structure/mindmap/ops.ts, layout.ts, style.ts) mit den Schriftmaßen des Servers
// (server/src/native/text-metrics.json) auf einem lokalen Y.Doc aus – genau das, was die Native-Op `mind` im Server
// tut – und schreibt je Fall Ausgangsstand, Ops (wie die App sie sendet) und Ergebnis. Die App rechnet ihre Vorschau
// (packages/stachel_board/lib/src/mindmap/) damit nach: gleiche Lage, Größe, Farbe und `mind` aufs Komma.
// Aufruf (im Stachel-Repo): server/node_modules/.bin/tsx --tsconfig web/tsconfig.json tools/native-mind-fixtures.mts
//   [--out docs/native_fixtures/web]   (flutter/packages/stachel_board liest die Datei direkt)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// dieselbe Yjs-Instanz wie der Web-Code (tools/ hat kein eigenes node_modules)
import * as Y from '../web/node_modules/yjs/dist/yjs.mjs';
import { BoardStore, type NewObject } from '../web/src/board/store';
import type { BoardObject } from '../web/src/protocol';
import { setTextMeasure } from '../web/src/editor/measureText';
import { registerTypeInfo } from '../web/src/board/types';
import * as ops from '../web/src/features/structure/mindmap/ops';
import { MIND_COLORS, mindSize } from '../web/src/features/structure/mindmap/style';
import { metricsMeasure } from '../server/src/native/text-metrics';

setTextMeasure(metricsMeasure);
// ohne Editor kennt der Store den Typ nicht (sonst blendet er die Knoten aus)
registerTypeInfo('mindnode');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1]! : path.join(ROOT, 'docs/native_fixtures/web'));

function store(objects: BoardObject[]): BoardStore {
  const s = new BoardStore(new Y.Doc(), 'a:ref');
  if (objects.length) s.createMany(objects.map(({ createdBy: _c, updatedAt: _u, ...o }) => o as NewObject));
  return s;
}

/** Knoten wie im Objekt-JSON der Native-API (ohne createdBy/updatedAt; z bleibt für die Reihenfolge). */
const dump = (s: BoardStore) => s.getSnapshot().ordered.filter(ops.isMind).map(({ createdBy: _c, updatedAt: _u, ...o }) => JSON.parse(JSON.stringify(o)));
const result = (s: BoardStore) => Object.fromEntries(dump(s).map((o) => [o.id, { x: o.x, y: o.y, w: o.w, h: o.h, text: o.text ?? '', color: o.color ?? null, mind: o.mind ?? {} }]));

/** Mindmap wie im Web angelegt: Sommerfest → Programm (Bands und Musik, Workshops), Orga, links Technik (Strom). */
function sample(): BoardStore {
  const s = store([]);
  ops.commitMind(s, { add: [ops.newRoot({ x: 400, y: 300 }, 'Sommerfest', 'root')] });
  const g = (id: string) => s.get(id)!;
  const add = (fn: () => void, id: string, text: string) => {
    fn();
    ops.commitMind(s, { patch: { [id]: { text } } });
  };
  add(() => ops.addChild(s, g('root'), 'r', 'prog'), 'prog', 'Programm');
  add(() => ops.addSibling(s, g('prog'), 'orga'), 'orga', 'Orga');
  add(() => ops.addChild(s, g('prog'), undefined, 'bands'), 'bands', 'Bands und Musik');
  add(() => ops.addSibling(s, g('bands'), 'work'), 'work', 'Workshops');
  add(() => ops.addChild(s, g('root'), 'l', 'tech'), 'tech', 'Technik');
  add(() => ops.addChild(s, g('tech'), undefined, 'strom'), 'strom', 'Strom');
  return s;
}

type Op = Record<string, unknown>;
interface Case {
  name: string;
  start: BoardObject[];
  ops: Op[];
  result: Record<string, unknown>;
}
const cases: Case[] = [];

/** Fall: `run` wendet auf dem Web-Store dasselbe an wie der Server für `list`. */
function scenario(name: string, start: BoardStore, list: Op[], run: (s: BoardStore, g: (id: string) => BoardObject) => void) {
  const before = dump(start);
  const s = store(before);
  run(s, (id) => s.get(id)!);
  cases.push({ name, start: before, ops: list, result: result(s) });
}

const base = sample();
const g0 = (id: string) => base.get(id)!;
const long = 'Bands, Musik und alles, was auf der großen Bühne passiert – mit Zeilenumbruch';

scenario('Unterthema an der Wurzel (rechts)', base, [{ op: 'mind', do: 'child', id: 'root', new: 'n1' }], (s, g) => ops.addChild(s, g('root'), undefined, 'n1'));
scenario('Unterthema an der Wurzel links', base, [{ op: 'mind', do: 'child', id: 'root', new: 'n1', side: 'l' }], (s, g) => ops.addChild(s, g('root'), 'l', 'n1'));
scenario('Unterthema an einem Hauptthema', base, [{ op: 'mind', do: 'child', id: 'orga', new: 'n1' }], (s, g) => ops.addChild(s, g('orga'), undefined, 'n1'));
scenario('Unterthema an einem Unterthema (links)', base, [{ op: 'mind', do: 'child', id: 'strom', new: 'n1' }], (s, g) => ops.addChild(s, g('strom'), undefined, 'n1'));
scenario('gleiche Ebene unter einem Unterthema', base, [{ op: 'mind', do: 'sibling', id: 'bands', new: 'n1' }], (s, g) => ops.addSibling(s, g('bands'), 'n1'));
scenario('gleiche Ebene unter einem Hauptthema', base, [{ op: 'mind', do: 'sibling', id: 'prog', new: 'n1' }], (s, g) => ops.addSibling(s, g('prog'), 'n1'));
scenario('gleiche Ebene an der Wurzel: nichts', base, [{ op: 'mind', do: 'sibling', id: 'root', new: 'n1' }], () => {});
scenario('langer Text am Unterthema (Umbruch)', base, [{ op: 'mind', do: 'text', id: 'bands', text: long }], (s) => ops.commitMind(s, { patch: { bands: { text: long } } }));
scenario('langer Text an der Wurzel', base, [{ op: 'mind', do: 'text', id: 'root', text: 'Sommerfest im Stadtpark – alles Wichtige auf einen Blick' }], (s) =>
  ops.commitMind(s, { patch: { root: { text: 'Sommerfest im Stadtpark – alles Wichtige auf einen Blick' } } }),
);
scenario('leerer Text (Platzhalter bestimmt die Größe)', base, [{ op: 'mind', do: 'text', id: 'orga', text: '' }], (s) => ops.commitMind(s, { patch: { orga: { text: '' } } }));
scenario('Zeilenumbruch im Text, Umlaute, Ligaturen', base, [{ op: 'mind', do: 'text', id: 'work', text: 'Effizienz-Workshops\nfür Öffentlichkeit & Café' }], (s) =>
  ops.commitMind(s, { patch: { work: { text: 'Effizienz-Workshops\nfür Öffentlichkeit & Café' } } }),
);
scenario('Zweig einklappen', base, [{ op: 'mind', do: 'collapse', id: 'prog', collapsed: true }], (s, g) => ops.toggleCollapse(s, g('prog')));
scenario('Wurzel einklappen', base, [{ op: 'mind', do: 'collapse', id: 'root', collapsed: true }], (s, g) => ops.toggleCollapse(s, g('root')));
const folded = store(dump(base));
ops.toggleCollapse(folded, folded.get('prog')!);
scenario('Zweig ausklappen', folded, [{ op: 'mind', do: 'collapse', id: 'prog', collapsed: false }], (s, g) => ops.toggleCollapse(s, g('prog')));
scenario('Unterthema an eingeklapptem Zweig klappt auf', folded, [{ op: 'mind', do: 'child', id: 'prog', new: 'n1' }], (s, g) => ops.addChild(s, g('prog'), undefined, 'n1'));
scenario('Hauptthema samt Unterthemen löschen', base, [{ op: 'mind', do: 'remove', ids: ['prog'] }], (s) => ops.commitMind(s, { remove: ops.withDescendants(s.getSnapshot(), ['prog']) }));
scenario('Unterthema löschen', base, [{ op: 'mind', do: 'remove', ids: ['bands'] }], (s) => ops.commitMind(s, { remove: ops.withDescendants(s.getSnapshot(), ['bands']) }));
const onOrga = { x: g0('orga').x + 10, y: g0('orga').y + 2 };
scenario('auf anderen Knoten ziehen hängt um (Farbe des Zweigs)', base, [{ op: 'update', patches: { bands: onOrga } }, { op: 'mind', do: 'drop', ids: ['bands'] }], (s) => {
  s.updateMany({ bands: onOrga });
  ops.dropNodes(s, ['bands']);
  ops.commitMind(s, { patch: { bands: {} } });
});
const onRoot = { x: g0('root').x + 5, y: g0('root').y + 5 };
scenario('auf die Wurzel ziehen (Seite nach Lage)', base, [{ op: 'update', patches: { strom: onRoot } }, { op: 'mind', do: 'drop', ids: ['strom'] }], (s) => {
  s.updateMany({ strom: onRoot });
  ops.dropNodes(s, ['strom']);
  ops.commitMind(s, { patch: { strom: {} } });
});
const leftOf = { x: g0('root').x - 300, y: g0('root').y - 200 };
scenario('Hauptthema auf die andere Seite ziehen', base, [{ op: 'update', patches: { prog: leftOf } }, { op: 'mind', do: 'drop', ids: ['prog'] }], (s) => {
  s.updateMany({ prog: leftOf });
  ops.dropNodes(s, ['prog']);
  ops.commitMind(s, { patch: { prog: {} } });
});
const above = { x: g0('work').x, y: g0('bands').y - 40 };
scenario('Unterthema nach oben einsortieren', base, [{ op: 'update', patches: { work: above } }, { op: 'mind', do: 'drop', ids: ['work'] }], (s) => {
  s.updateMany({ work: above });
  ops.dropNodes(s, ['work']);
  ops.commitMind(s, { patch: { work: {} } });
});
const moved = { x: g0('root').x + 137.4, y: g0('root').y - 61.2 };
scenario('Wurzel verschieben nimmt die Mindmap mit', base, [{ op: 'update', patches: { root: moved } }, { op: 'mind', do: 'layout', ids: ['root'] }], (s) => {
  s.updateMany({ root: moved });
  ops.commitMind(s, { patch: { root: {} } });
});
scenario('neue Mindmap', store([]), [{ op: 'mind', do: 'root', new: 'r1', x: 120.5, y: -40, text: '' }], (s) => ops.commitMind(s, { add: [ops.newRoot({ x: 120.5, y: -40 }, '', 'r1')] }));
const tree = {
  text: 'Sommerfest',
  children: [
    { text: 'Programm', children: [{ text: 'Bands' }, { text: 'Workshops' }, { text: 'Kinderprogramm' }] },
    { text: 'Orga', children: [{ text: 'Helfer:innen' }, { text: 'Schichten' }, { text: 'Finanzen' }] },
    { text: 'Technik', side: 'l', children: [{ text: 'Strom' }, { text: 'Licht & Ton' }] },
    { text: 'Werbung', side: 'l', children: [{ text: 'Plakate' }, { text: 'Social Media' }, { text: 'Presse' }] },
  ],
};
scenario('Vorlage (tree) wie die Galerie-Vorlage „Mindmap“', store([]), [{ op: 'mind', do: 'tree', new: 't', x: 0, y: 0, tree }], (s) => {
  // wie server/src/native/web-impl.ts `tree` (TemplateBuilder.mind, Wurzel-Mitte bei x/y)
  const nodes: BoardObject[] = [];
  let n = 0;
  const walk = (t: typeof tree, parent: string | undefined, level: number, color: string, order: number) => {
    const id = parent ? `t-${++n}` : 't';
    const mind = { ...(parent ? { parent, order } : { level: 0 }), ...(level === 1 ? { side: (t as { side?: 'l' | 'r' }).side ?? 'r' } : {}) };
    nodes.push({ id, type: 'mindnode', x: 0, y: 0, ...mindSize(t.text, level), z: '', createdBy: '', updatedAt: '', text: t.text, color, mind } as BoardObject);
    ((t as { children?: (typeof tree)[] }).children ?? []).forEach((k, i) => walk(k, id, level + 1, level === 0 ? MIND_COLORS[i % MIND_COLORS.length]! : color, i));
  };
  walk(tree, undefined, 0, '#0a0a0a', 0);
  const at = { x: Math.round(0 - nodes[0]!.w / 2), y: Math.round(0 - nodes[0]!.h / 2) };
  const placed = nodes.map((o) => ({ ...o, ...at }));
  const lay = ops.layoutPatches(placed);
  s.createMany(placed.map(({ createdBy: _c, updatedAt: _u, z: _z, ...o }) => ({ ...o, ...lay[o.id] }) as NewObject));
});

// Größen je Text und Ebene (Messung wie im Browser)
const texts = ['', 'A', 'Sommerfest', 'Wählt Größe', 'office fiflo', 'AVATAR Tower', long, 'Ein sehr langesWortohneLeerzeichenDasUmbrechenMussWeilEsZuBreitIst', 'Zeile 1\nZeile 2', '🎉 Party', 'Helfer:innen & Co.', '  Leerzeichen  '];
const sizes = texts.flatMap((text) => [0, 1, 2, 3].map((level) => ({ text, level, ...mindSize(text, level) })));
const measures = texts.flatMap((text) =>
  [
    ['Barlow Condensed', 700, 28],
    ['Barlow', 600, 18],
    ['Barlow', 500, 16],
  ].map(([family, weight, fs]) => ({ text, family, weight, fs, width: metricsMeasure(text, fs as number, weight as number, false, family as string) })),
);

fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, 'mindmap.json');
fs.writeFileSync(file, `${JSON.stringify({ cases, sizes, measures }, null, 1)}\n`);
console.log(`geschrieben: ${path.relative(ROOT, file)} (${cases.length} Fälle, ${sizes.length} Größen, ${Math.round(fs.statSync(file).size / 1024)} KB)`);
