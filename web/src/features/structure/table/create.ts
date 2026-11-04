// Tabellen ohne React: Kopfbereich, Messung, neue Tabelle (Werkzeug, Vorlagen, Einfügen, Web-Aktionen der App).
import type { BoardObject } from '../../../protocol';
import type { TableData, TableHead } from '../model';
import { emptyTable, MIN_COL_PX, safeTable, tableHeight } from './model';
import { cellMeasure } from './measure';
import type { TableEnv } from './yjs';

export const TABLE_HEAD_COLORS = ['#0a0a0a', '#1763b5', '#ec4e92', '#c9e14a', '#7aa21b', '#e9e9e4', '#fff27a', '#ffffff'];
export const TABLE_W = 480;

/** Auswahl „Kopfbereich“ (Kontextleiste) */
export const TABLE_HEADS: { head: TableHead; label: string }[] = [
  { head: 'row', label: 'Kopfzeile' },
  { head: 'col', label: 'Kopfspalte' },
  { head: 'both', label: 'Beides' },
  { head: 'none', label: 'Ohne' },
];

export const headOf = (o: BoardObject): TableHead => o.tableHead ?? 'row';
export const hasHeadRow = (o: BoardObject) => ['row', 'both'].includes(headOf(o));
export const hasHeadCol = (o: BoardObject) => ['col', 'both'].includes(headOf(o));
export const tableEnv = (o: BoardObject): TableEnv => ({ measure: cellMeasure, boldRow0: hasHeadRow(o) });

/** Neue Tabelle (Werkzeug, Vorlagen) an `p` zentriert. */
export function newTable(p: { x: number; y: number }, d: TableData = emptyTable(3, 3), w = TABLE_W, head: TableHead = 'row') {
  const h = tableHeight(d, w, cellMeasure, head === 'row' || head === 'both');
  return { type: 'table' as const, x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), w, h, table: d, color: '#0a0a0a', ...(head !== 'row' ? { tableHead: head } : {}) };
}

/** Kopfbereich ändern: Feld + Höhe (die Kopfzeile ist fett und kann anders umbrechen). */
export function headPatch(o: BoardObject, head: TableHead) {
  return { tableHead: head === 'row' ? undefined : head, h: tableHeight(safeTable(o.table), o.w, cellMeasure, head === 'row' || head === 'both') };
}

/** Größe beim Ziehen an den Seitengriffen: Breite ≥ 48 je Spalte, Höhe aus dem Inhalt. */
export function tableResize(o: BoardObject, w: number) {
  const d = safeTable(o.table);
  const ww = Math.max(d.cols.length * MIN_COL_PX, w);
  return { w: ww, h: tableHeight(d, ww, cellMeasure, hasHeadRow(o)) };
}
