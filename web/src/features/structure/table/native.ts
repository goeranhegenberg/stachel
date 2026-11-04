// Web-Aktionen für die native App (docs/contract.md §8.12) – Paket P3 des Paritäts-Audits
// (docs/native_paritaet_audit.md §4): Tabellen wie im Browser (table/yjs.ts) – Zelle live (Y.Text, gleichzeitiges Tippen
// zusammengeführt), Zeilen/Spalten einfügen und löschen, Spaltenbreite, Kopfbereich; Höhe jeweils aus den umbrochenen
// Zellen (Schriftmaße des Servers).
// Test: server/test/native-act-table.test.ts, Doku: Abschnitt „Native-Aktionen“ in docs/features/structure.md.
// Wird von web/src/native/actions.ts importiert (Sammel-Import, nicht ändern).
import type { BoardObject } from '../../../protocol';
import type { BoardStore } from '../../../board/store';
import { A, parseArgs } from '../../../native/args';
import { defineNativeAction, textMerge } from '../../../native/registry';
import type { TableHead } from '../model';
import { headPatch, tableEnv } from './create';
import { safeTable } from './model';
import { addCol, addRow, editCellText, removeCol, removeRow, resizeCol } from './yjs';

/** Ungesperrte Tabelle (sonst nichts zu tun). */
const tableOf = (store: BoardStore, id: string): BoardObject | null => {
  const o = store.get(id);
  return o && o.type === 'table' && !o.locked ? o : null;
};

/** Wie `withTable` der Kontextleiste: eigener Rückgängig-Schritt. */
function step<T>(store: BoardStore, fn: () => T): T {
  store.stopCapturing();
  const r = fn();
  store.stopCapturing();
  return r;
}

/** Zelle bearbeiten (Zelleneditor): Eingabe der App (`text`, ausgehend von `base`) mit dem aktuellen Stand zusammenführen. */
defineNativeAction<{ id: string; r: string; c: string; base?: string; text: string }>('table.setCell', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, r: A.id, c: A.id, base: A.opt(A.str()), text: A.str() }),
  run(store, { id, r, c, base, text }, ctx) {
    const o = tableOf(store, id);
    const d = o && safeTable(o.table);
    if (!o || !d || !d.rows.includes(r) || !d.cols.includes(c)) return { skipped: true };
    let conflict = false;
    editCellText(store, o, tableEnv(o), r, c, (t) => {
      const cur = t.toString();
      const m = base === undefined ? { text, conflict: cur !== text && cur !== '' } : textMerge(ctx).merge(base, text, cur);
      conflict = m.conflict;
      textMerge(ctx).apply(t, m.text);
    });
    return { data: { conflict } };
  },
});

/** Zeile darunter (`after` = aktive Zeile) bzw. am Ende; neue Zeile = `<key>-1`. */
defineNativeAction<{ id: string; after?: string }>('table.addRow', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, after: A.opt(A.id) }),
  run(store, { id, after }, ctx) {
    const o = tableOf(store, id);
    const row = ctx.id(1);
    if (!o || safeTable(o.table).rows.includes(row)) return { skipped: true, data: { row } };
    step(store, () => addRow(store, o, tableEnv(o), after, row));
    return { data: { row } };
  },
});

/** Spalte rechts (`after` = aktive Spalte) bzw. am Ende, so breit wie der Durchschnitt; neue Spalte = `<key>-1`. */
defineNativeAction<{ id: string; after?: string }>('table.addCol', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, after: A.opt(A.id) }),
  run(store, { id, after }, ctx) {
    const o = tableOf(store, id);
    const col = ctx.id(1);
    if (!o || safeTable(o.table).cols.includes(col)) return { skipped: true, data: { col } };
    step(store, () => addCol(store, o, tableEnv(o), after, col));
    return { data: { col } };
  },
});

/** Zeile löschen (die letzte bleibt). */
defineNativeAction<{ id: string; row: string }>('table.removeRow', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, row: A.id }),
  run(store, { id, row }) {
    const o = tableOf(store, id);
    const d = o && safeTable(o.table);
    if (!o || !d || !d.rows.includes(row) || d.rows.length <= 1) return { skipped: true };
    step(store, () => removeRow(store, o, tableEnv(o), row));
  },
});

/** Spalte löschen (die letzte bleibt); die Tabelle wird um die Spalte schmaler. */
defineNativeAction<{ id: string; col: string }>('table.removeCol', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, col: A.id }),
  run(store, { id, col }) {
    const o = tableOf(store, id);
    const d = o && safeTable(o.table);
    if (!o || !d || !d.cols.includes(col) || d.cols.length <= 1) return { skipped: true };
    step(store, () => removeCol(store, o, tableEnv(o), col));
  },
});

/**
 * Spaltengrenze nach Spalte `i` ziehen: `px` = Breiten aller Spalten in Weltpunkten nach dem Ziehen (wie die Geste im
 * Browser; Gesamtbreite bleibt, nur die Spalten `i` und `i + 1` ändern ihr Gewicht).
 */
defineNativeAction<{ id: string; i: number; px: number[] }>('table.resizeCol', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, i: A.int(0, 1000), px: A.arrayOf(1000, A.num(0, 1_000_000)) }),
  run(store, { id, i, px }) {
    const o = tableOf(store, id);
    const d = o && safeTable(o.table);
    if (!o || !d || px.length !== d.cols.length || i >= d.cols.length - 1 || !(px.reduce((a, b) => a + b, 0) > 0)) return { skipped: true };
    step(store, () => resizeCol(store, o, tableEnv(o), i, px));
  },
});

/** Kopfbereich Kopfzeile/Kopfspalte/Beides/Ohne; Höhe neu (die Kopfzeile ist fett). */
defineNativeAction<{ id: string; head: TableHead }>('table.setHead', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, head: A.oneOf('row', 'col', 'both', 'none') }),
  run(store, { id, head }) {
    const o = tableOf(store, id);
    if (!o) return { skipped: true };
    step(store, () => store.update(id, headPatch(o, head)));
  },
});
