// Referenzwerte aus dem Web-Code für die Ansicht der Flutter-App (Paritäts-Audit Paket P4): Suche auf dem Board
// (Faltung ohne Groß/Klein und Akzente, Fundstelle, Suchtext je Objekttyp, Lesereihenfolge), Rahmen-Liste und
// Rahmen-Formate, Zoom-Stufen und Einpassen, Board-Hintergrund. Führt die echten Web-Funktionen aus (ohne Browser) und
// schreibt docs/native_fixtures/web/view.json – die App vergleicht ihre Portierungen damit
// (packages/stachel_board/test/features/view/view_web_reference_test.dart; Faltungstabelle per
// `dart run tool/gen_view_fixtures.dart <stachel>` nach lib/src/features/search/fold_table.g.dart).
//   server/node_modules/.bin/tsx --tsconfig web/tsconfig.json tools/native-view-fixtures.mts [--out <dir>]
// Suchtext: die Typ-Module mit CSS (Karte, Tabelle, Zeitleiste, Mindmap, PDF) lassen sich ohne Browser nicht laden –
// ihr `plainText` wird hier mit denselben Funktionen aus ihren React-freien Modellen angemeldet (siehe TYPE_TEXT).
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoardObject } from '../web/src/protocol';

// Stylesheets einzelner Web-Module (z. B. frames/handover.css über frames.tsx) ohne Browser als leere Module laden
register(
  `data:text/javascript,${encodeURIComponent(
    "export async function load(url, ctx, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, ctx); }",
  )}`,
);
const { registerTypeInfo } = await import('../web/src/board/types');
const { fitRect, nextZoomStep, objRect } = await import('../web/src/board/geometry');
await import('../web/src/editor/core/objectTypes');
await import('../web/src/features/shapes/stickers');
const { matrix, safeTable } = await import('../web/src/features/structure/table/model');
const { safeTimeline, timelineText } = await import('../web/src/features/structure/timeline/model');
const { fold, findMatch } = await import('../web/src/ui/search');
const { findHits, readingOrder, searchText } = await import('../web/src/features/tools/search');
const { framesInOrder } = await import('../web/src/features/structure/frames/order');
const { FRAME_PRESETS, presetRect } = await import('../web/src/features/structure/frames/frames');
const { BG_COLORS, BG_NAMES, DEFAULT_SETTINGS, isDark, PATTERN_LABELS, PATTERNS } = await import('../web/src/features/tools/settingsModel');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1]! : path.join(ROOT, 'docs/native_fixtures/web'));

/** plainText der Typ-Module mit CSS (Quellen: card.tsx 130, table.tsx 250, timeline.tsx 414, mindmap.tsx 69, documents/index.tsx 71) */
const TYPE_TEXT: Record<string, (o: BoardObject) => string | undefined> = {
  card: (o) => [o.text, o.desc].filter(Boolean).join('\n'),
  table: (o) =>
    matrix(safeTable(o.table))
      .map((r) => r.join('\t'))
      .join('\n'),
  timeline: (o) => timelineText(safeTimeline(o.timeline)),
  mindnode: (o) => o.text,
  document: (o) => o.docName ?? 'PDF',
};
for (const [type, plainText] of Object.entries(TYPE_TEXT)) registerTypeInfo(type, { plainText });

// ---- Faltung: jedes Zeichen der BMP, bei dem die Web-Faltung von toLowerCase abweicht ----
// Hangul-Silben (U+AC00–U+D7A3) zerlegt NFD nach fester Formel in Jamo – die App rechnet das selbst (Fälle in `find`).
const foldMap: Record<string, string> = {};
for (let c = 0; c < 0x10000; c++) {
  if ((c >= 0xd800 && c <= 0xdfff) || (c >= 0xac00 && c <= 0xd7a3)) continue;
  const ch = String.fromCharCode(c);
  const f = fold(ch).text;
  if (f !== ch.toLowerCase()) foldMap[ch] = f;
}

const findCases: { text: string; query: string; match: [number, number] | null }[] = [];
const texts = ['Gelände', 'Bühne Süd', 'GELAENDE und Zelte', 'Straße', 'STRASSE', 'Crème brûlée', 'Ærø', 'Dvořák', 'İstanbul', 'Œuvre', 'Façade', 'Zoë', 'naïve café', 'Ueberlauf', 'Kasse  Nord\nEinlass', 'Emoji 🌵 Kaktus', 'aeoeue', 'Quelle', '한국어 사전', 'Ångström', 'Ḿ', '𐐀𐐁 Deseret'];
const queries = ['gelande', 'gelaende', 'GELÄNDE', 'buhne', 'buehne sud', 'süd', 'strasse', 'straße', 'creme brulee', 'aero', 'dvorak', 'istanbul', 'oeuvre', 'facade', 'zoe', 'naive cafe', 'überlauf', 'uberlauf', 'kasse nord', '  nord  ', 'kaktus', '🌵', 'äöü', 'aou', 'que', 'ue', 'e', '국어', 'ㄱ', '사', 'angstrom', 'ḿ', '𐐨'];
for (const text of texts) for (const query of queries) findCases.push({ text, query, match: findMatch(text, query) });

// ---- Suchtext je Typ ----
const objs: BoardObject[] = [
  { id: 's1', type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'Bühne aufbauen', tags: [{ label: 'Technik', color: '#1763b5' }, { label: 'Dringend', color: '#ec4e92' }] },
  { id: 't1', type: 'text', x: 300, y: 0, w: 200, h: 40, text: 'Überschrift' },
  { id: 'h1', type: 'shape', x: 600, y: 0, w: 180, h: 120, shape: 'rect', text: 'Kasse' },
  { id: 'f1', type: 'frame', x: 0, y: 400, w: 640, h: 420, title: 'Lageplan Gelände', text: 'egal' },
  { id: 'c1', type: 'card', x: 800, y: 0, w: 300, h: 96, text: 'Zelte bestellen', desc: 'Bei Firma Müller', assignee: { key: 'k:1', name: 'Mara Örtel' }, tags: [{ label: 'Einkauf', color: '#7aa21b' }] },
  { id: 'c2', type: 'card', x: 800, y: 200, w: 300, h: 96, text: '' },
  { id: 'tb', type: 'table', x: 0, y: 900, w: 480, h: 120, table: { rows: ['r1', 'r2'], cols: ['a', 'b', 'c'], cells: { 'r1:a': 'Name', 'r1:b': 'Schicht', 'r2:a': 'Jörg', 'r2:c': 'Bar' }, widths: {} } },
  { id: 'tb2', type: 'table', x: 0, y: 1100, w: 480, h: 120, table: { rows: [], cols: ['a'], cells: { 'r:c': 'Rest' } } },
  { id: 'tl', type: 'timeline', x: 600, y: 900, w: 900, h: 200, timeline: { lanes: ['l1', 'l2'], names: { l1: 'Aufbau', l2: '' }, items: { i1: { lane: 'l1', start: '2026-07-01', end: '2026-07-03', title: 'Bühne' }, i2: { lane: 'l1', start: '2026-06-28', end: '2026-06-28', title: '' }, i3: { lane: 'l2', start: '2026-12-30', end: '2027-01-02', title: 'Silvester' }, bad: { lane: 'l2', start: 'kaputt' } } } },
  { id: 'mn', type: 'mindnode', x: 0, y: 1300, w: 120, h: 40, text: 'Ideen' },
  { id: 'st', type: 'sticker', x: 300, y: 1300, w: 96, h: 96, emoji: '🌵' },
  { id: 'sp', type: 'sticker', x: 400, y: 1300, w: 72, h: 72, stamp: 'heart' },
  { id: 'sx', type: 'sticker', x: 500, y: 1300, w: 72, h: 72 },
  { id: 'ic', type: 'icon', x: 600, y: 1300, w: 64, h: 64, icon: 'tent' },
  { id: 'dc', type: 'document', x: 700, y: 1300, w: 400, h: 560, docName: 'Hygieneplan.pdf' },
  { id: 'dn', type: 'document', x: 1200, y: 1300, w: 400, h: 560 },
  { id: 'im', type: 'image', x: 0, y: 1500, w: 300, h: 200 },
  { id: 'cn', type: 'connector', x: 0, y: 0, w: 0, h: 0, text: 'führt zu', from: { objectId: 's1' }, to: { objectId: 't1' } },
  { id: 'hd', type: 'sticky', x: 0, y: 1800, w: 200, h: 200, text: 'Versteckte Notiz', hidden: true },
] as unknown as BoardObject[];
const searchTexts = objs.map((o) => ({ id: o.id, text: searchText(o) }));

// Treffer in Lesereihenfolge (mit/ohne Ausgeblendete) über demselben Board
const bounds = (o: BoardObject) => (o.type === 'connector' ? null : objRect(o));
const hitCases = ['e', 'bühne', 'notiz', 'mara', 'tent', 'pdf', 'xyz', ''].flatMap((q) =>
  [false, true].map((hidden) => ({ query: q, includeHidden: hidden, ids: findHits(objs, q, bounds, hidden).map((h) => h.o.id) })),
);

// Lesereihenfolge beliebiger Rechtecke (pseudo-zufällig, reproduzierbar)
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const orderCases = Array.from({ length: 40 }, () => {
  const items = Array.from({ length: 2 + Math.floor(rnd() * 9) }, (_, i) => ({ id: `r${i}`, r: { x: Math.round(rnd() * 1500), y: Math.round(rnd() * 900), w: 40 + Math.round(rnd() * 400), h: 40 + Math.round(rnd() * 300) } }));
  return { items, order: readingOrder(items).map((it) => it.id) };
});

// Rahmen-Liste: Lesereihenfolge, slide-Schlüssel (auch gleiche), ausgeblendete bleiben drin
const keys = ['a0', 'a1', 'a1', 'Zz', 'a0V', 'b'];
const frameCases = Array.from({ length: 40 }, () => {
  const frames = Array.from({ length: 1 + Math.floor(rnd() * 8) }, (_, i) => ({
    id: `f${i}`,
    type: 'frame',
    x: Math.round(rnd() * 3000),
    y: Math.round(rnd() * 1200),
    w: 200 + Math.round(rnd() * 900),
    h: 150 + Math.round(rnd() * 700),
    ...(rnd() < 0.4 ? { slide: keys[Math.floor(rnd() * keys.length)] } : {}),
    ...(rnd() < 0.1 ? { hidden: true } : {}),
  }));
  return { frames, order: framesInOrder(frames as unknown as BoardObject[]).map((f) => f.id) };
});

// Rahmen-Formate beim Aufziehen
const presetCases = FRAME_PRESETS.flatMap((p) =>
  [
    [{ x: 0, y: 0 }, { x: 300, y: 200 }],
    [{ x: 100, y: 100 }, { x: -200, y: 40 }],
    [{ x: 0, y: 0 }, { x: 50, y: 900 }],
    [{ x: 10, y: 10 }, { x: 10, y: 10 }],
  ].flatMap(([a, b]) => [false, true].map((square) => ({ preset: p.id, start: a, end: b, square, rect: presetRect(a, b, p, square) }))),
);

// Zoom-Stufen und Einpassen
const zooms = [0.05, 0.07, 0.1, 0.149, 0.15, 0.2, 0.33, 0.333, 0.5, 0.66, 0.67, 0.999, 1, 1.0005, 1.25, 1.7, 2, 3, 3.99, 4];
const zoomCases = zooms.map((z) => ({ z, up: nextZoomStep(z, 1), down: nextZoomStep(z, -1) }));
const fitCases = [
  { r: { x: 0, y: 0, w: 640, h: 420 }, w: 390, h: 700, pad: { top: 40, right: 24, bottom: 84, left: 24 }, max: 4 },
  { r: { x: -100, y: 50, w: 1280, h: 720 }, w: 800, h: 360, pad: { top: 40, right: 24, bottom: 84, left: 24 }, max: 4 },
  { r: { x: 10, y: 10, w: 20, h: 20 }, w: 390, h: 700, pad: { top: 40, right: 24, bottom: 84, left: 24 }, max: 4 },
  { r: { x: 0, y: 0, w: 5000, h: 3000 }, w: 390, h: 700, pad: { top: 64, right: 14, bottom: 70, left: 64 }, max: 1 },
  { r: { x: 0, y: 0, w: 1, h: 1 }, w: 390, h: 700, pad: { top: 64, right: 14, bottom: 70, left: 64 }, max: 2 },
].map((c) => ({ ...c, cam: fitRect(c.r, c.w, c.h, c.pad, c.max) }));

const view = {
  version: 1,
  fold: foldMap,
  find: findCases,
  searchText: { objects: objs, texts: searchTexts, hits: hitCases },
  readingOrder: orderCases,
  frames: { order: frameCases, presets: presetCases },
  zoom: { steps: zoomCases, fit: fitCases },
  settings: {
    colors: BG_COLORS,
    names: BG_NAMES,
    patterns: PATTERNS,
    patternLabels: PATTERN_LABELS,
    default: DEFAULT_SETTINGS,
    dark: ['#000000', '#0a0a0a', '#1763b5', '#ec4e92', '#7aa21b', '#808080', '#f3f3ef', '#ffffff', 'kaputt'].map((c) => ({ color: c, dark: isDark(c) })),
  },
};

fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, 'view.json');
fs.writeFileSync(file, `${JSON.stringify(view, null, 1)}\n`);
console.log(`geschrieben: ${path.relative(ROOT, file)} (${Math.round(fs.statSync(file).size / 1024)} KB, Faltung ${Object.keys(foldMap).length} Zeichen)`);
