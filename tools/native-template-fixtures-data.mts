// Inhalt von docs/native_fixtures/web/templates.json (tools/native-template-fixtures.mts): die Vorlagen der Galerie als
// Objekt-JSON mit festen IDs und festem Datum. Auch vom Server-Test benutzt (Datei passt noch zum Web-Code?).
import { metricsMeasure } from '../server/src/native/text-metrics';
import { setTextMeasure } from '../web/src/editor/measureText';
import { TEMPLATES } from '../web/src/features/structure/templates/catalog';
import { cardContentHeight } from '../web/src/features/structure/card/model';
import { pasteChoice } from '../web/src/features/structure/paste-model';
import { colWidths, rowHeights, tableHeight } from '../web/src/features/structure/table/model';
import { cellMeasure } from '../web/src/features/structure/table/measure';
import { measureText } from '../web/src/editor/measureText';
import type { BoardObject } from '../web/src/protocol';

// Textbreiten wie im Browser (Schriftmaße aus dem Chromium, wie der Server sie für die Web-Aktionen nimmt)
setTextMeasure(metricsMeasure);

/** fester Tag für Fälligkeiten und Zeitleisten (lokale Mittagszeit, damit keine Zeitzone den Tag verschiebt) */
export const FIXED_NOW = new Date(2026, 0, 5, 12, 0, 0).getTime();

/** `fn` mit fester Uhr ausführen (die Vorlagen rechnen Daten relativ zu heute). */
function withFixedNow<T>(fn: () => T): T {
  const Real = globalThis.Date;
  class Fixed extends Real {
    constructor(...args: unknown[]) {
      if (args.length) super(...(args as [number]));
      else super(FIXED_NOW);
    }
    static now() {
      return FIXED_NOW;
    }
  }
  globalThis.Date = Fixed as DateConstructor;
  try {
    return fn();
  } finally {
    globalThis.Date = Real;
  }
}

/** IDs der Objekte auf `<vorlage>-<n>` (n ab 1, Reihenfolge der Vorlage), Bezüge (Verbinder, Mindmap-Eltern) mit. */
function renumber(prefix: string, objs: BoardObject[]): Record<string, unknown>[] {
  const ids = new Map(objs.map((o, i) => [o.id, `${prefix}-${i + 1}`]));
  const ren = (id: string) => ids.get(id) ?? id;
  return objs.map((o) => {
    const { z: _z, createdBy: _c, updatedAt: _u, ...rest } = o;
    const out: Record<string, unknown> = { ...rest, id: ren(o.id) };
    for (const k of ['from', 'to'] as const) {
      const e = o[k] as { objectId?: string } | undefined;
      if (e?.objectId) out[k] = { ...e, objectId: ren(e.objectId) };
    }
    if (o.mind?.parent) out.mind = { ...o.mind, parent: ren(o.mind.parent) };
    // Tabellen: Zeilen/Spalten-IDs ebenfalls fest (r1…, c1…)
    if (o.table) {
      const rows = new Map(o.table.rows.map((r, i) => [r, `r${i + 1}`]));
      const cols = new Map(o.table.cols.map((c, i) => [c, `c${i + 1}`]));
      const cells: Record<string, string> = {};
      for (const [k, v] of Object.entries(o.table.cells)) {
        const [r, c] = k.split(':');
        cells[`${rows.get(r!)}:${cols.get(c!)}`] = v;
      }
      const widths: Record<string, number> = {};
      for (const [c, v] of Object.entries(o.table.widths)) widths[cols.get(c)!] = v;
      out.table = { rows: [...rows.values()], cols: [...cols.values()], cells, widths };
    }
    // Zeitleisten: Einträge fest nummeriert (i1…)
    if (o.timeline) {
      const items = Object.entries(o.timeline.items);
      out.timeline = { ...o.timeline, items: Object.fromEntries(items.map(([, v], i) => [`i${i + 1}`, v])) };
    }
    return out;
  });
}

/** `{version, now, templates: {<id>: Objekte}}` */
export function buildTemplateFixtures() {
  return withFixedNow(() => ({
    version: 1,
    now: '2026-01-05',
    templates: Object.fromEntries(TEMPLATES.map((t) => [t.id, renumber(t.id, t.build())])),
  }));
}

const TAB = String.fromCharCode(9);
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);

const obj = (o: Partial<BoardObject>) => ({ id: 'x', type: 'card', x: 0, y: 0, w: 300, h: 96, z: '', createdBy: '', updatedAt: '', ...o }) as BoardObject;

/**
 * Referenzwerte für die App (docs/native_fixtures/web/structure.json): Kartenhöhe (`cardContentHeight`), Tabellen-
 * Spalten/Zeilen (`colWidths`, `rowHeights`, `tableHeight`), „Einfügen als …“ (`pasteChoice`) – die App rechnet mit
 * denselben Schriftmaßen nach und vergleicht.
 */
export function buildStructureReferences() {
  return withFixedNow(() => {
    const m = (t: string, fs: number, w: number) => measureText(t, fs, w);
    const cards = [
      obj({ text: '' }),
      obj({ text: 'Bühne aufbauen und Strom für alle Stände verlegen' }),
      obj({ text: 'Kurz', desc: 'Reihenfolge der Bands mit der Technik abstimmen. '.repeat(6) }),
      obj({ text: 'Shuttle', desc: 'Zwei Kleinbusse anfragen.', status: 'doing', due: '2026-01-12', assignee: { key: 'm:7', name: 'Jonas Beispiel' } }),
      obj({ text: 'Viele Tags', tags: ['Programm', 'Bar', 'Social Media', 'Orga', 'Technik'].map((label, i) => ({ label, color: ['#ec4e92', '#ffd08a', '#9fd3ff', '#c9e14a', '#e2d5ff'][i]! })), due: '2027-03-01', status: 'blocked' }),
      obj({ text: 'Schmal mit einem sehr langen Wortungetüm Festivalgeländeabsperrung 🎸', w: 160, status: 'done' }),
    ].map((o) => ({ card: o, h: cardContentHeight(o, m) }));
    const tbl = (rows: string[][], w: number, head: boolean, widths: Record<string, number> = {}) => {
      const d = { rows: rows.map((_, i) => `r${i + 1}`), cols: rows[0]!.map((_, j) => `c${j + 1}`), cells: {} as Record<string, string>, widths };
      rows.forEach((r, i) => r.forEach((t, j) => t && (d.cells[`r${i + 1}:c${j + 1}`] = t)));
      const ws = colWidths(d, w);
      return { table: d, w, head, widths: ws, rows: rowHeights(d, ws, cellMeasure, head), h: tableHeight(d, w, cellMeasure, head) };
    };
    const tables = [
      tbl([['', '', ''], ['', '', ''], ['', '', '']], 480, true),
      tbl([['Bereich', 'Fr 14–18', 'Sa'], ['Bar', 'Lena, Tom und Mira übernehmen die Bar am Abend', ''], ['Einlass', 'Jonas', `Mara${NL}und Kim`]], 480, true),
      tbl([['Sehr lange Kopfzeile mit vielen Wörtern', 'B'], ['x', 'y']], 300, false, { c1: 1.4 }),
    ];
    const pastes = [
      `A${TAB}B${NL}1${TAB}2${NL}`,
      `eins${NL}zwei${NL}${NL}drei${CR}${NL}`,
      'nur eine Zeile',
      `a${TAB}"b${NL}c"${TAB}d${CR}${NL}e${TAB}f`,
      `x${TAB}y`,
    ].map((text) => ({ text, choice: pasteChoice(text) }));
    return { version: 1, now: '2026-01-05', cards, tables, pastes };
  });
}
