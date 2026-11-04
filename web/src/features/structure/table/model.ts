// Tabellen ohne React/Yjs: Inhalt anlegen, Spaltenbreiten (relativ), Zeilenhöhen aus dem umbrochenen Text.
import { nanoid } from 'nanoid';
import type { TableData } from '../model';
import { wrapText } from '../text';

export const TABLE_FS = 15;
export const TABLE_LH = 1.35;
export const TABLE_PAD_X = 12;
export const TABLE_PAD_Y = 10;
export const MIN_ROW = 42;
export const MIN_COL_PX = 48;

export type CellMeasure = (s: string, bold: boolean) => number;

export const cellKey = (r: string, c: string) => `${r}:${c}`;
const newId = () => nanoid(8);

/** Tabelle aus Zeilen von Zelltexten (erste Zeile = Kopf, wenn so dargestellt). */
export function tableFrom(rows: string[][], widths?: number[]): TableData {
  const nCols = Math.max(1, ...rows.map((r) => r.length));
  const cols = Array.from({ length: nCols }, newId);
  const rowIds = rows.map(newId);
  const cells: Record<string, string> = {};
  rows.forEach((r, i) => r.forEach((t, j) => t && (cells[cellKey(rowIds[i], cols[j])] = t)));
  const w: Record<string, number> = {};
  if (widths) cols.forEach((c, i) => widths[i] !== undefined && widths[i] !== 1 && (w[c] = widths[i]));
  return { rows: rowIds, cols, cells, widths: w };
}

export const emptyTable = (rows = 3, cols = 3) => tableFrom(Array.from({ length: rows }, () => Array.from({ length: cols }, () => '')));

/** Gültige Lesekopie (fehlende/kaputte Daten → leere 1×1-Tabelle). */
export function safeTable(d: unknown): TableData {
  const t = d as Partial<TableData> | undefined;
  const rows = Array.isArray(t?.rows) ? t.rows.filter((x): x is string => typeof x === 'string') : [];
  const cols = Array.isArray(t?.cols) ? t.cols.filter((x): x is string => typeof x === 'string') : [];
  if (!rows.length || !cols.length) return { rows: rows.length ? rows : ['r'], cols: cols.length ? cols : ['c'], cells: (t?.cells as Record<string, string>) ?? {}, widths: {} };
  return { rows, cols, cells: t?.cells && typeof t.cells === 'object' ? t.cells : {}, widths: t?.widths && typeof t.widths === 'object' ? t.widths : {} };
}

export const cellText = (d: TableData, r: string, c: string) => d.cells[cellKey(r, c)] ?? '';

/** Text als Zeilen × Spalten. */
export const matrix = (d: TableData): string[][] => d.rows.map((r) => d.cols.map((c) => cellText(d, r, c)));

const weight = (d: TableData, c: string) => {
  const v = d.widths[c];
  return typeof v === 'number' && v > 0 ? v : 1;
};

/** Spaltenbreiten in Weltpunkten bei Gesamtbreite `w`. */
export function colWidths(d: TableData, w: number): number[] {
  const ws = d.cols.map((c) => weight(d, c));
  const sum = ws.reduce((a, b) => a + b, 0) || 1;
  return ws.map((x) => (x / sum) * w);
}

/** Zeilenhöhen: höchste Zelle der Zeile (umbrochen), mindestens MIN_ROW. `boldRow0`: Kopfzeile fett. */
export function rowHeights(d: TableData, widths: number[], measure: CellMeasure, boldRow0 = true): number[] {
  return d.rows.map((r, i) => {
    let lines = 1;
    d.cols.forEach((c, j) => {
      const t = cellText(d, r, c);
      if (!t) return;
      const bold = boldRow0 && i === 0;
      lines = Math.max(lines, wrapText(t, Math.max(8, widths[j] - 2 * TABLE_PAD_X), (s) => measure(s, bold)).length);
    });
    return Math.max(MIN_ROW, Math.ceil(lines * TABLE_FS * TABLE_LH + 2 * TABLE_PAD_Y));
  });
}

export const tableHeight = (d: TableData, w: number, measure: CellMeasure, boldRow0 = true) => rowHeights(d, colWidths(d, w), measure, boldRow0).reduce((a, b) => a + b, 0);

/** Nachbarzelle (Tab, Umschalt+Tab, Enter); null am Rand. */
export function nextCell(d: TableData, r: string, c: string, dir: 'next' | 'prev' | 'down' | 'up'): { r: string; c: string } | null {
  let ri = d.rows.indexOf(r);
  let ci = d.cols.indexOf(c);
  if (ri < 0 || ci < 0) return null;
  if (dir === 'down' || dir === 'up') {
    ri += dir === 'down' ? 1 : -1;
  } else {
    ci += dir === 'next' ? 1 : -1;
    if (ci >= d.cols.length) {
      ci = 0;
      ri++;
    } else if (ci < 0) {
      ci = d.cols.length - 1;
      ri--;
    }
  }
  if (ri < 0 || ri >= d.rows.length) return null;
  return { r: d.rows[ri], c: d.cols[ci] };
}
