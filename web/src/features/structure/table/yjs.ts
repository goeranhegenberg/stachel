// Tabelleninhalt im Yjs-Dokument: Feld `table` = Y.Map { rows: Y.Array, cols: Y.Array, cells: Y.Map, widths: Y.Map }.
// Gleichzeitiges Schreiben in verschiedene Zellen, Zeilen und Spalten führt ohne Verlust zusammen. Eine Zelle ist ein
// `Y.Text` (gleichzeitiges Tippen in derselben Zelle wird zusammengeführt) oder – alte Tabellen, Kopien – ein String,
// der beim Bearbeiten zu Y.Text wird.
import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import { registerYField, type BoardStore } from '../../../board/store';
import type { BoardObject } from '../../../protocol';
import type { TableData } from '../model';
import { MIGRATE_ORIGIN, spliceOf, yTextCaret, type Splice, type TextSource } from '../ytext';
import { cellKey, colWidths, safeTable, tableHeight, type CellMeasure } from './model';

export const TABLE_FIELD = 'table';

export function tableToY(d: TableData): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  const rows = new Y.Array<string>();
  rows.push(d.rows);
  const cols = new Y.Array<string>();
  cols.push(d.cols);
  const cells = new Y.Map<CellValue>();
  for (const [k, v] of Object.entries(d.cells)) if (typeof v === 'string' && v) cells.set(k, v);
  const widths = new Y.Map<number>();
  for (const [k, v] of Object.entries(d.widths)) if (typeof v === 'number' && v > 0) widths.set(k, v);
  m.set('rows', rows);
  m.set('cols', cols);
  m.set('cells', cells);
  m.set('widths', widths);
  return m;
}

export function tableFromY(y: Y.AbstractType<any>): TableData {
  if (!(y instanceof Y.Map)) return safeTable(undefined);
  const arr = (k: string) => {
    const v = y.get(k);
    return v instanceof Y.Array ? (v.toArray() as string[]) : [];
  };
  const obj = (k: string) => {
    const v = y.get(k);
    return v instanceof Y.Map ? v.toJSON() : {};
  };
  return safeTable({ rows: arr('rows'), cols: arr('cols'), cells: obj('cells'), widths: obj('widths') });
}

// Lesekopie im Schnappschuss; Kopieren/Einfügen baut aus ihr eine neue Y-Struktur
registerYField(TABLE_FIELD, {
  toPlain: tableFromY,
  fromPlain: (v) => (v && typeof v === 'object' ? tableToY(safeTable(v)) : undefined),
});

/** Zellwert: Y.Text bzw. (alt) String */
type CellValue = string | Y.Text;

interface Live {
  y: Y.Map<unknown>;
  rows: Y.Array<string>;
  cols: Y.Array<string>;
  cells: Y.Map<CellValue>;
  widths: Y.Map<number>;
}

/** Lebende Struktur (legt sie bei alten/kaputten Daten an). */
function live(store: BoardStore, o: BoardObject): Live | null {
  const y = store.ensureYField<Y.Map<unknown>>(o.id, TABLE_FIELD, () => tableToY(safeTable(o.table)));
  if (!y) return null;
  const get = <T>(k: string, make: () => T) => {
    let v = y.get(k) as T | undefined;
    if (!v || !(v instanceof Y.AbstractType)) {
      v = make();
      y.set(k, v);
    }
    return v;
  };
  return {
    y,
    rows: get('rows', () => new Y.Array<string>()),
    cols: get('cols', () => new Y.Array<string>()),
    cells: get('cells', () => new Y.Map<CellValue>()),
    widths: get('widths', () => new Y.Map<number>()),
  };
}

export interface TableEnv {
  measure: CellMeasure;
  /** Kopfzeile fett */
  boldRow0: boolean;
}

/** Änderung an der Tabelle samt neuer Höhe (und ggf. Breite) als ein Schritt. */
export function editTable(store: BoardStore, o: BoardObject, env: TableEnv, fn: (t: Live, d: TableData) => { w?: number } | void) {
  store.transact(() => {
    const t = live(store, o);
    if (!t) return;
    const res = fn(t, tableFromY(t.y)) || {};
    const d = tableFromY(t.y);
    const w = Math.round(res.w ?? o.w);
    const h = tableHeight(d, w, env.measure, env.boldRow0);
    if (w !== o.w || h !== o.h) store.update(o.id, { w, h });
  });
}

const cellString = (v: unknown) => (v instanceof Y.Text ? v.toString() : typeof v === 'string' ? v : '');

/** Änderung in einer Zelle als Y.Text (alte String-Zelle wird dabei umgestellt). */
function spliceCell(t: Live, key: string, sp: Splice) {
  let v = t.cells.get(key);
  if (!(v instanceof Y.Text)) {
    v = new Y.Text(cellString(v));
    t.cells.set(key, v);
  }
  if (sp.del) v.delete(sp.index, sp.del);
  if (sp.ins) v.insert(sp.index, sp.ins);
}

/** Zelle auf `text` setzen (als kleinste Änderung, damit gleichzeitige Eingaben anderer erhalten bleiben). */
export function setCell(store: BoardStore, o: BoardObject, env: TableEnv, r: string, c: string, text: string) {
  editTable(store, o, env, (t) => {
    const key = cellKey(r, c);
    const v = t.cells.get(key);
    if (v instanceof Y.Text) {
      const cur = v.toString();
      if (cur !== text) spliceCell(t, key, spliceOf(cur, text));
    } else if (text) t.cells.set(key, text);
    else t.cells.delete(key);
  });
}

/** Zelle als Y.Text bearbeiten (alte String-Zelle wird umgestellt), Tabellenhöhe im selben Schritt (Web-Aktionen der App). */
export function editCellText(store: BoardStore, o: BoardObject, env: TableEnv, r: string, c: string, fn: (t: Y.Text) => void) {
  editTable(store, o, env, (t) => {
    const key = cellKey(r, c);
    let v = t.cells.get(key);
    if (!(v instanceof Y.Text)) {
      v = new Y.Text(cellString(v));
      t.cells.set(key, v);
    }
    fn(v);
  });
}

/** Lebende Zellen-Map einer Tabelle (ohne anzulegen). */
function cellsOf(store: BoardStore, id: string): Y.Map<CellValue> | undefined {
  const t = store.yField<Y.Map<unknown>>(id, TABLE_FIELD);
  const cells = t?.get('cells');
  return cells instanceof Y.Map ? (cells as Y.Map<CellValue>) : undefined;
}

/** Live-Quelle für den Zelleneditor (ytext.ts): liest/schreibt die Zelle, Tabellenhöhe im selben Schritt. */
export function cellSource(store: BoardStore, id: string, r: string, c: string, env: (o: BoardObject) => TableEnv): TextSource {
  const key = cellKey(r, c);
  return {
    read: () => cellString(cellsOf(store, id)?.get(key)),
    ...yTextCaret(store.doc, () => {
      const v = cellsOf(store, id)?.get(key);
      return v instanceof Y.Text ? v : null;
    }),
    write: (sp) => {
      const o = store.get(id);
      if (o) editTable(store, o, env(o), (t) => spliceCell(t, key, sp));
    },
  };
}

/** Beim Start der Bearbeitung: alte String-Zelle zu Y.Text umstellen (nicht im Undo, der Text bleibt gleich). */
export function migrateCell(store: BoardStore, id: string, r: string, c: string) {
  const cells = cellsOf(store, id);
  const v = cells?.get(cellKey(r, c));
  if (!cells || typeof v !== 'string' || !v) return;
  store.doc.transact(() => cells.set(cellKey(r, c), new Y.Text(v)), MIGRATE_ORIGIN);
}

/** Zeile nach `after` (bzw. am Ende) einfügen; liefert die neue id (`id` = feste id, z. B. aus einer Web-Aktion). */
export function addRow(store: BoardStore, o: BoardObject, env: TableEnv, after?: string, id = nanoid(8)): string {
  editTable(store, o, env, (t, d) => {
    const i = after ? d.rows.indexOf(after) : -1;
    t.rows.insert(i < 0 ? t.rows.length : i + 1, [id]);
  });
  return id;
}

/** Spalte nach `after` (bzw. am Ende) einfügen; die Tabelle wird um eine durchschnittliche Spalte breiter. */
export function addCol(store: BoardStore, o: BoardObject, env: TableEnv, after?: string, id = nanoid(8)): string {
  editTable(store, o, env, (t, d) => {
    const ws = colWidths(d, o.w);
    const avg = ws.reduce((a, b) => a + b, 0) / Math.max(1, ws.length);
    const i = after ? d.cols.indexOf(after) : -1;
    t.cols.insert(i < 0 ? t.cols.length : i + 1, [id]);
    // Gewicht so wählen, dass die neue Spalte so breit ist wie der Durchschnitt (andere behalten ihre Breite)
    const sumW = d.cols.reduce((s, c) => s + (d.widths[c] ?? 1), 0);
    t.widths.set(id, (avg / o.w) * sumW);
    return { w: o.w + avg };
  });
  return id;
}

export function removeRow(store: BoardStore, o: BoardObject, env: TableEnv, r: string) {
  editTable(store, o, env, (t, d) => {
    if (d.rows.length <= 1) return;
    const i = d.rows.indexOf(r);
    if (i < 0) return;
    t.rows.delete(i, 1);
    for (const c of d.cols) t.cells.delete(cellKey(r, c));
  });
}

export function removeCol(store: BoardStore, o: BoardObject, env: TableEnv, c: string) {
  editTable(store, o, env, (t, d) => {
    if (d.cols.length <= 1) return;
    const i = d.cols.indexOf(c);
    if (i < 0) return;
    const colW = colWidths(d, o.w)[i];
    t.cols.delete(i, 1);
    t.widths.delete(c);
    for (const r of d.rows) t.cells.delete(cellKey(r, c));
    return { w: Math.max(80, o.w - colW) };
  });
}

/** Spaltengrenze nach Spalte `i` verschieben (Weltpunkte); Gesamtbreite bleibt. */
export function resizeCol(store: BoardStore, o: BoardObject, env: TableEnv, i: number, px: number[]) {
  editTable(store, o, env, (t, d) => {
    const sumW = d.cols.reduce((s, c) => s + (d.widths[c] ?? 1), 0);
    const total = px.reduce((a, b) => a + b, 0);
    d.cols.forEach((c, j) => {
      if (j === i || j === i + 1) t.widths.set(c, (px[j] / total) * sumW);
    });
  });
}
