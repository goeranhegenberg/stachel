// Referenzwerte aus dem Web-Code für die Zeitleiste der Flutter-App (Paritäts-Audit Paket P9): Datum (Tagnummern,
// KW, Beschriftungen), Layout (Spuren, Zeilen packen, Balken/Meilensteine, abgeschnitten, davor/danach), Kopf
// (Monate/KW/Tage), Treffer, Ziehen auf Tage, Zeitraum über die Seitengriffe, neue Zeitleiste und Einträge, Dialog-
// Tage, Meilenstein umschalten, Zeitraum erweitern, Größe nach einer Änderung. Führt die echten Web-Funktionen aus
// (model.ts, create.ts – ohne Browser) und schreibt docs/native_fixtures/web/timeline.json; die App vergleicht ihre
// Portierung damit (packages/stachel_board/test/features/timeline/timeline_web_reference_test.dart, Kopie unter
// docs/native_fixtures/web/timeline.json direkt).
//   server/node_modules/.bin/tsx --tsconfig web/tsconfig.json tools/native-timeline-fixtures.mts [--out <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dayAt,
  dayLabel,
  dayPatch,
  defaultRange,
  dragDays,
  extendRange,
  fmtDay,
  hitLocal,
  isoWeek,
  layoutOf,
  msLabelW,
  newItemSpan,
  parseDay,
  rangeOf,
  resizeRange,
  safeTimeline,
  scaleOf,
  sizeFor,
  snapDays,
  spanLabel,
  ticks,
  timelineText,
  toggleMsPatch,
  unitOf,
  type TimelineData,
  type TlUnit,
} from '../web/src/features/structure/timeline/model';
import { newTimeline } from '../web/src/features/structure/timeline/create';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1]! : path.join(ROOT, 'docs/native_fixtures/web'));

const TODAY = parseDay('2026-11-04')!; // Mittwoch
const d = (s: string) => parseDay(s)!;

// ---- Datum -------------------------------------------------------------------------------------------------------
const days = ['1970-01-01', '2024-02-29', '2026-01-01', '2026-11-02', '2026-12-28', '2027-01-03', '2027-01-04', '2020-12-31', '2021-01-03'];
const dates = days.map((s) => ({ s, n: d(s), iso: isoWeek(d(s)), label: dayLabel(d(s)), labelYear: dayLabel(d(s), true), fmt: fmtDay(d(s)) }));
const badDays = ['2026-02-31', '2026-13-01', '26-1-1', '', 'x', '2026-00-10'].map((s) => ({ s, n: parseDay(s) }));
const spans = [
  ['2026-11-03', '2026-11-03'],
  ['2026-11-03', '2026-11-09'],
  ['2026-12-28', '2027-01-05'],
].map(([a, b]) => ({ a: d(a!), b: d(b!), label: spanLabel(d(a!), d(b!)) }));
const msW = ['', 'Ein', 'Einlass', 'Einlass und Bändchen-Ausgabe am Haupttor mit sehr viel Text'].map((t) => ({ t, w: msLabelW(t) }));

// ---- Zeitleisten ----------------------------------------------------------------------------------------------------
const base: TimelineData = { lanes: ['l1', 'l2', 'l3'], names: { l1: 'Aufbau', l2: 'Programm', l3: '' }, items: {} };
const cases: { name: string; o: Record<string, unknown> }[] = [
  { name: 'leer', o: { x: 0, y: 0, w: 1176, h: 220, timeline: base, tlStart: '2026-11-02', tlEnd: '2026-12-27' } },
  {
    name: 'woche',
    o: {
      x: 10,
      y: 20,
      w: 1176 * 0.5,
      h: 300,
      tlStart: '2026-11-02',
      tlEnd: '2026-12-27',
      timeline: {
        lanes: ['l1', 'l2', 'l3', 'l1'],
        names: { l1: 'Aufbau', l2: 'Programm' },
        items: {
          a: { lane: 'l1', start: '2026-11-03', end: '2026-11-09', title: 'Bühne' },
          b: { lane: 'l1', start: '2026-11-05', end: '2026-11-06', title: 'Licht', color: '#ec4e92' },
          c: { lane: 'l1', start: '2026-11-10', end: '2026-11-12', title: '' },
          m: { lane: 'l2', start: '2026-11-04', end: '2026-11-20', title: 'Einlass und Bändchen-Ausgabe', ms: true },
          m2: { lane: 'l2', start: '2026-11-06', end: '2026-11-06', title: 'Probe' },
          cutL: { lane: 'l3', start: '2026-10-20', end: '2026-11-04', title: 'vorher' },
          cutR: { lane: 'l3', start: '2026-12-20', end: '2027-01-10', title: 'nachher' },
          before: { lane: 'l3', start: '2026-09-01', end: '2026-09-02', title: 'alt' },
          after1: { lane: 'l2', start: '2027-02-01', end: '2027-02-01', title: 'neu' },
          after2: { lane: 'gone', start: '2027-03-01', end: '2027-02-01', title: 'getauscht' },
          broken: { lane: 'l1', start: 'kaputt', end: '2026-11-01', title: 'weg' },
          swap: { lane: 'gone', start: '2026-11-25', end: '2026-11-23', title: 'Spur weg' },
        },
      },
    },
  },
  {
    name: 'tag',
    o: {
      x: 0,
      y: 0,
      w: 1008,
      h: 200,
      tlUnit: 'day',
      tlStart: '2026-11-02',
      tlEnd: '2026-11-22',
      timeline: { lanes: ['x'], names: { x: 'Team' }, items: { i: { lane: 'x', start: '2026-11-04', end: '2026-11-04', title: 'Heute' }, j: { lane: 'x', start: '2026-11-07', end: '2026-11-08', title: 'WE', ms: true } } },
    },
  },
  {
    name: 'monat',
    o: {
      x: 0,
      y: 0,
      w: 1000,
      h: 160,
      tlUnit: 'month',
      tlStart: '2026-11-01',
      tlEnd: '2027-04-30',
      timeline: { lanes: ['x', 'y'], names: { x: 'A', y: 'B' }, items: { i: { lane: 'y', start: '2026-12-24', end: '2027-01-06', title: 'Ferien' } } },
    },
  },
  { name: 'ohneZeitraum', o: { x: 0, y: 0, w: 100, h: 100, timeline: { lanes: [], items: { z: { start: '2026-11-05' } } } } },
  { name: 'nurEnde', o: { x: 0, y: 0, w: 100, h: 100, tlEnd: '2026-12-31', tlUnit: 'year', timeline: null } },
  { name: 'langerZeitraum', o: { x: 0, y: 0, w: 100, h: 100, tlStart: '2026-01-01', tlEnd: '2030-12-31', tlUnit: 'month', timeline: base } },
];

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const layouts = cases.map(({ name, o }) => {
  const data = safeTimeline(o.timeline);
  const r = rangeOf(o, TODAY);
  const unit = unitOf(o);
  const L = layoutOf(data, r, unit);
  const T = ticks(L, unit, TODAY);
  // Treffer an einem Raster innerer Punkte (und knapp außerhalb)
  const hits: { lx: number; ly: number; hit: unknown }[] = [];
  for (let lx = -10; lx <= L.W0 + 10; lx += Math.max(7, Math.round(L.W0 / 37))) for (let ly = -10; ly <= L.H0 + 10; ly += 13) hits.push({ lx, ly, hit: hitLocal(L, lx, ly) });
  return {
    name,
    o,
    data,
    range: r,
    unit,
    layout: {
      dayPx: L.dayPx,
      W0: L.W0,
      H0: L.H0,
      before: L.before,
      after: L.after,
      lanes: L.lanes,
      items: L.items.map((b) => ({ id: b.id, a: b.a, b: b.b, lane: b.lane, row: b.row, x: round(b.x), y: b.y, w: round(b.w), h: b.h, cutL: b.cutL, cutR: b.cutR })),
    },
    ticks: T,
    hits,
    scale: scaleOf(o as { w: number }, L),
    text: timelineText(data),
    dayAt: [-50, 0, 168, 169, 200, 500, L.W0, L.W0 + 100].map((lx) => ({ lx, day: dayAt(L, lx) })),
    newItemSpan: [null, r.start, r.end, r.start + 3].map((day) => ({ day, today: TODAY, span: newItemSpan(L, day, TODAY) })).concat([{ day: null, today: TODAY + 1000, span: newItemSpan(L, null, TODAY + 1000) }]),
    extend: (['before', 'after'] as const).map((side) => ({ side, r: extendRange(o, side, TODAY) })),
  };
});

// ---- Ziehen, Größe -------------------------------------------------------------------------------------------------
const R = { start: d('2026-11-02'), end: d('2026-12-27'), days: 56 };
const drags: { a: number; b: number; mode: 'move' | 'start' | 'end'; dd: number; out: [number, number] }[] = [];
for (const [a, b] of [
  [R.start + 3, R.start + 9],
  [R.start, R.start],
  [R.end - 2, R.end + 5],
  [R.start - 4, R.start + 1],
] as [number, number][])
  for (const mode of ['move', 'start', 'end'] as const) for (const dd of [-100, -7, -1, 0, 2, 10, 100]) drags.push({ a, b, mode, dd, out: dragDays(a, b, mode, dd, R) });
const snaps = [-30, -9.1, -8.9, -0.4, 0, 0.5, 8.99, 9, 27, 100].flatMap((dx) => [18, 40, 5].map((dayPx) => ({ dx, dayPx, dd: snapDays(dx, dayPx) })));

/** wie `resize` im Browser (timeline.tsx) für die Seitengriffe: Zeitraum, x, Größe */
const resizes: unknown[] = [];
for (const c of cases.slice(0, 4)) {
  const o = c.o as { x: number; y: number; w: number; h: number; timeline?: unknown; tlStart?: unknown; tlEnd?: unknown; tlUnit?: unknown };
  const L = layoutOf(safeTimeline(o.timeline), rangeOf(o, TODAY), unitOf(o));
  const k = scaleOf(o, L);
  for (const west of [false, true])
    for (const dw of [-2000, -100, -9, 0, 9, 50, 400, 100000]) {
      const newW = o.w + dw;
      const r = resizeRange(L, k, L.unit, newW, west);
      const L2 = layoutOf(safeTimeline(o.timeline), r, L.unit);
      const size = sizeFor(k, L2);
      resizes.push({ name: c.name, west, newW, out: { x: west ? Math.round(o.x + o.w - size.w) : o.x, y: o.y, ...size, tlStart: fmtDay(r.start), tlEnd: fmtDay(r.end) } });
    }
}

const defaults = (['day', 'week', 'month'] as TlUnit[]).flatMap((unit) => [TODAY, d('2026-11-30'), d('2027-01-01')].map((today) => ({ unit, today, r: defaultRange(unit, today) })));
const created = (['day', 'week', 'month'] as TlUnit[]).map((unit) => {
  const r = defaultRange(unit, TODAY);
  return { unit, start: r.start, end: r.end, o: newTimeline({ x: 500, y: 300 }, { unit, start: r.start, end: r.end }) };
});

const it = { lane: 'l1', start: '2026-11-03', end: '2026-11-09', title: 'x' };
const ms = { ...it, end: '2026-11-03', ms: true as const };
const toggles = (['day', 'week', 'month'] as TlUnit[]).flatMap((unit) => [{ unit, it, out: toggleMsPatch(it, unit) }, { unit, it: ms, out: toggleMsPatch(ms, unit) }]);
const dayPatches = [it, ms].flatMap((x) => (['start', 'end'] as const).flatMap((which) => ['2026-11-01', '2026-11-05', '2026-11-20'].map((v) => ({ it: x, which, day: v, out: dayPatch(x, which, d(v)) }))));

const out = { today: TODAY, dates, badDays, spans, msW, layouts, drags, snaps, resizes, defaults, created, toggles, dayPatches };
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify(out) + '\n');
console.log(`timeline.json: ${layouts.length} Layouts, ${layouts.reduce((s, l) => s + l.hits.length, 0)} Treffer, ${drags.length} Ziehen, ${resizes.length} Seitengriffe`);
