// Store-Ebene des Moduls: Mindmap-Operationen, Tabellen im Y-Dokument, Kopieren, Vorlagen, Karten-Hilfen.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import '../../editor/core';
import './index';
import { BoardStore } from '../../board/store';
import { cloneObjects } from '../../board/clipboard';
import type { BoardObject } from '../../protocol';
import { addChild, addSibling, commitMind, dropNodes, mindNodes, newRoot, toggleCollapse, withDescendants } from './mindmap/ops';
import { H_GAP } from './mindmap/layout';
import { cellKey, colWidths, matrix, nextCell, rowHeights, tableFrom } from './table/model';
import { addCol, addRow, removeCol, removeRow, setCell, TABLE_FIELD } from './table/yjs';
import { newTable, tableEnv } from './table/table';
import { TEMPLATES } from './templates/catalog';
import { formatDue, isOverdue } from './card/card';

const fresh = () => new BoardStore(new Y.Doc(), 'm:1');

describe('Mindmap im Store', () => {
  it('Kind, Geschwister, Einklappen und Löschen samt Layout (je ein Undo-Schritt)', () => {
    const store = fresh();
    const root = store.create(newRoot({ x: 0, y: 0 }, 'Thema'));
    const a = addChild(store, store.get(root)!);
    const b = addSibling(store, store.get(a)!)!;
    const a1 = addChild(store, store.get(a)!);
    const r = store.get(root)!;
    expect(store.get(a)!.x).toBe(r.x + r.w + H_GAP);
    expect(store.get(b)!.y).toBeGreaterThan(store.get(a)!.y);
    expect(store.get(a1)!.mind).toMatchObject({ parent: a, level: 2, side: 'r' });
    // Zweigfarben: Hauptzweige verschieden, Unterzweige erben
    expect(store.get(a)!.color).not.toBe(store.get(b)!.color);
    expect(store.get(a1)!.color).toBe(store.get(a)!.color);
    expect(addSibling(store, store.get(root)!)).toBeNull();

    toggleCollapse(store, store.get(a)!);
    expect(store.get(a1)!.mind?.hidden).toBe(true);
    toggleCollapse(store, store.get(a)!);
    expect(store.get(a1)!.mind?.hidden).toBeUndefined();

    const before = store.undoDepth();
    commitMind(store, { remove: withDescendants(store.getSnapshot(), [a]) });
    expect(store.get(a)).toBeUndefined();
    expect(store.get(a1)).toBeUndefined();
    expect(store.undoDepth()).toBe(before + 1);
    store.undo();
    expect(store.get(a1)).toBeDefined();
  });

  it('Ziehen auf einen anderen Knoten hängt um; Kopie ohne Eltern wird Wurzel', () => {
    const store = fresh();
    const root = store.create(newRoot({ x: 0, y: 0 }, 'Thema'));
    const a = addChild(store, store.get(root)!);
    const b = addChild(store, store.get(root)!);
    const tb = store.get(b)!;
    // a über b loslassen
    store.update(a, { x: tb.x + 4, y: tb.y + 2 });
    dropNodes(store, [a]);
    expect(store.get(a)!.mind?.parent).toBe(b);
    expect(store.get(a)!.mind?.level).toBe(2);

    const [clone] = cloneObjects([store.get(a)!], 10, 10, (id) => store.get(id));
    expect(clone.mind?.parent).toBeUndefined();
    expect(clone.mind?.level).toBe(0);
    expect(mindNodes(store.getSnapshot()).length).toBe(3);
  });
});

describe('Tabellen', () => {
  const measure = (s: string) => s.length * 8;

  it('Breiten relativ, Höhen aus umbrochenem Text, Nachbarzellen', () => {
    const d = tableFrom(
      [
        ['A', 'B'],
        ['kurz', 'ein sehr langer Text der umbricht'],
      ],
      [1, 3],
    );
    expect(colWidths(d, 400)).toEqual([100, 300]);
    const hs = rowHeights(d, [100, 160], measure);
    expect(hs[1]).toBeGreaterThan(hs[0]);
    expect(nextCell(d, d.rows[0], d.cols[1], 'next')).toEqual({ r: d.rows[1], c: d.cols[0] });
    expect(nextCell(d, d.rows[1], d.cols[1], 'next')).toBeNull();
    expect(nextCell(d, d.rows[0], d.cols[0], 'down')).toEqual({ r: d.rows[1], c: d.cols[0] });
  });

  it('liegt als Y.Map im Dokument; Zellen, Zeilen und Spalten ändern; Kopie ist unabhängig', () => {
    const store = fresh();
    const id = store.create(newTable({ x: 0, y: 0 }, tableFrom([['Bereich', 'Fr'], ['Bar', '']])));
    expect(store.yField(id, TABLE_FIELD)).toBeInstanceOf(Y.Map);
    let o = store.get(id)!;
    expect(matrix(o.table!)).toEqual([
      ['Bereich', 'Fr'],
      ['Bar', ''],
    ]);
    const env = tableEnv(o);
    setCell(store, o, env, o.table!.rows[1], o.table!.cols[1], 'Lena');
    o = store.get(id)!;
    expect(o.table!.cells[cellKey(o.table!.rows[1], o.table!.cols[1])]).toBe('Lena');
    const r = addRow(store, o, env, o.table!.rows[0]);
    o = store.get(id)!;
    expect(o.table!.rows[1]).toBe(r);
    const w0 = o.w;
    addCol(store, o, env);
    o = store.get(id)!;
    expect(o.table!.cols.length).toBe(3);
    expect(o.w).toBeGreaterThan(w0);
    removeCol(store, o, env, o.table!.cols[2]);
    removeRow(store, store.get(id)!, env, r);
    o = store.get(id)!;
    expect(o.w).toBe(w0);
    expect(matrix(o.table!)[1]).toEqual(['Bar', 'Lena']);

    // Kopieren: neue Y-Struktur, Änderungen am Original wirken nicht auf die Kopie
    const [clone] = cloneObjects([o], 0, 0, (x) => store.get(x));
    const cid = store.createMany([clone])[0];
    setCell(store, store.get(id)!, env, o.table!.rows[0], o.table!.cols[0], 'Geändert');
    expect(matrix(store.get(cid)!.table!)[0][0]).toBe('Bereich');
    expect(store.yField(cid, TABLE_FIELD)).not.toBe(store.yField(id, TABLE_FIELD));
  });

  it('gleichzeitige Zellen auf zwei Geräten gehen nicht verloren', () => {
    const a = fresh();
    const id = a.create(newTable({ x: 0, y: 0 }));
    const b = new BoardStore(new Y.Doc(), 'm:2');
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    const oa = a.get(id)!;
    const ob = b.get(id)!;
    setCell(a, oa, tableEnv(oa), oa.table!.rows[0], oa.table!.cols[0], 'von A');
    setCell(b, ob, tableEnv(ob), ob.table!.rows[1], ob.table!.cols[1], 'von B');
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));
    const m = matrix(a.get(id)!.table!);
    expect(m[0][0]).toBe('von A');
    expect(m[1][1]).toBe('von B');
  });
});

describe('Vorlagen', () => {
  it.each(TEMPLATES.map((t) => [t.name, t] as const))('%s: gültige Objekte, Bezüge stimmen, Einfügen klappt', (_n, t) => {
    const objs = t.build();
    expect(objs.length).toBeGreaterThan(0);
    const ids = new Set(objs.map((o) => o.id));
    expect(ids.size).toBe(objs.length);
    for (const o of objs) {
      expect(Number.isFinite(o.x + o.y + o.w + o.h)).toBe(true);
      if (o.type === 'connector') for (const e of [o.from, o.to]) if (e && 'objectId' in e) expect(ids.has(e.objectId)).toBe(true);
      if (o.mind?.parent) expect(ids.has(o.mind.parent)).toBe(true);
    }
    const store = fresh();
    const lookup = (id: string) => objs.find((o) => o.id === id) as BoardObject | undefined;
    const created = store.createMany(cloneObjects(objs, 0, 0, lookup));
    // alle Typen sind bekannt (sonst blendet der Store sie aus)
    expect(store.getSnapshot().ordered.length).toBe(created.length);
    expect(created.length).toBe(objs.length);
  });
});

describe('Karten', () => {
  it('Fälligkeit formatieren und Überfälligkeit erkennen', () => {
    const now = new Date(2026, 9, 23);
    expect(formatDue('2026-06-12', now)).toMatch(/12\.?\s*Juni?/);
    expect(formatDue('2027-01-05', now)).toMatch(/2027/);
    expect(isOverdue({ due: '2026-10-22' }, now)).toBe(true);
    expect(isOverdue({ due: '2026-10-22', status: 'done' }, now)).toBe(false);
    expect(isOverdue({ due: '2026-10-23' }, now)).toBe(false);
  });
});
