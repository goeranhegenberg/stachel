// Paket Q2: Vorlagen-Katalog (neue Vorlagen, Suche mit Stichwörtern) und eigene Vorlagen aus einer Auswahl (own.ts).
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import '../../../editor/core';
import '../index';
import { BoardStore } from '../../../board/store';
import type { BoardObject } from '../../../protocol';
import { CATEGORIES, matchesSearch, TEMPLATES } from './catalog';
import { cleanTemplateName, cleanTemplateObjects, insertArgsSize, MAX_OWN_ARGS_JSON, MAX_OWN_OBJECTS, ownMatches, saveProblem, templateFromSelection } from './own';
import { insertAt } from './insert';
import { suggestName } from './saveTemplate';

const obj = (o: Partial<BoardObject>): BoardObject => ({ id: 'x', type: 'sticky', x: 0, y: 0, w: 100, h: 100, z: 'a0', createdBy: 'm:1', updatedAt: '', ...o }) as BoardObject;

const NEW = ['dayplan', 'buildshifts', 'awareness', 'stageplot', 'briefing', 'festretro', 'budget', 'startstop', 'cluster', 'backlog', 'eisenhower', 'tows', 'personas', 'journey', 'okr', 'decision'];

describe('Vorlagen-Katalog', () => {
  it('16 neue Vorlagen (7 für Veranstaltungen), IDs eindeutig, Kategorien bekannt', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of NEW) expect(ids).toContain(id);
    expect(TEMPLATES.length).toBe(11 + 16);
    expect(NEW.slice(0, 7).every((id) => TEMPLATES.find((t) => t.id === id)!.category === 'Events')).toBe(true);
    expect(TEMPLATES.every((t) => CATEGORIES.includes(t.category))).toBe(true);
  });

  it('Suche findet auch Stichwörter (Groß/klein egal), leer = alle', () => {
    const hits = (q: string) => TEMPLATES.filter((t) => matchesSearch(t, q)).map((t) => t.id);
    expect(hits('')).toHaveLength(TEMPLATES.length);
    expect(hits('Stage Plot')).toEqual(['stageplot']);
    expect(hits('nutzwertanalyse')).toEqual(['decision']);
    expect(hits('retro')).toEqual(expect.arrayContaining(['retro', 'startstop', 'festretro']));
    expect(hits('gibtsnicht')).toEqual([]);
  });
});

describe('Eigene Vorlagen aus der Auswahl', () => {
  it('nimmt Rahmen-Inhalt und Verbinder zwischen gewählten Objekten mit, in Zeichenreihenfolge', () => {
    const store = new BoardStore(new Y.Doc(), 'm:1');
    const f = store.create({ type: 'frame', x: 0, y: 0, w: 500, h: 400, title: 'Retro', color: '#ffffff' });
    const a = store.create({ type: 'sticky', x: 20, y: 20, w: 100, h: 100, color: '#fff27a', text: 'A' });
    const b = store.create({ type: 'sticky', x: 900, y: 20, w: 100, h: 100, color: '#fff27a', text: 'B' });
    const out = store.create({ type: 'sticky', x: 2000, y: 20, w: 100, h: 100, color: '#fff27a', text: 'draußen' });
    const ab = store.create({ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: a }, to: { objectId: b } });
    store.create({ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: a }, to: { objectId: out } });
    const snap = store.getSnapshot();
    const got = templateFromSelection(snap, [f, b]).map((o) => o.id);
    expect(new Set(got)).toEqual(new Set([f, a, b, ab]));
    expect(got).toEqual(snap.ordered.filter((o) => got.includes(o.id)).map((o) => o.id));
    expect(suggestName(templateFromSelection(snap, [f, b]))).toBe('Retro');
    expect(suggestName(templateFromSelection(snap, [b]))).toBe('B');
  });

  it('säubert gespeicherte Objekte: unbekannte Typen, kaputte Lage, fremde Felder und z fallen weg', () => {
    const raw = [
      { ...obj({ id: 'a', text: 'ok' }), locked: true, 'bad key': 1, content: { type: 'doc', content: [] } },
      { ...obj({ id: 'b' }), content: '<p>kein Dokument</p>' },
      { id: 'c', type: 'gibtsnicht', x: 0, y: 0, w: 1, h: 1 },
      { id: 'd', type: 'sticky', x: 'a', y: 0, w: 1, h: 1 },
      obj({ id: 'a' }),
      'kein Objekt',
    ];
    const clean = cleanTemplateObjects(raw);
    expect(clean.map((o) => o.id)).toEqual(['a', 'b']);
    expect(clean[0]).toMatchObject({ text: 'ok', z: '', createdBy: '', content: { type: 'doc' } });
    expect(clean[0]).not.toHaveProperty('locked');
    expect(clean[0]).not.toHaveProperty('bad key');
    expect(clean[1]).not.toHaveProperty('content');
    expect(cleanTemplateObjects('x')).toEqual([]);
  });

  it('Name, Größe, Suche', () => {
    expect(cleanTemplateName('  Meine   Retro ')).toBe('Meine Retro');
    expect(cleanTemplateName('   ')).toBeNull();
    expect(cleanTemplateName('x'.repeat(81))).toBeNull();
    expect(saveProblem([])).toMatch(/Wähle/);
    expect(saveProblem([obj({})])).toBeNull();
    expect(saveProblem(Array.from({ length: MAX_OWN_OBJECTS + 1 }, (_, i) => obj({ id: `n${i}` })))).toMatch(/höchstens/);
    const big = [obj({ text: '"'.repeat(MAX_OWN_ARGS_JSON / 2) })];
    expect(insertArgsSize(big)).toBeGreaterThan(MAX_OWN_ARGS_JSON);
    expect(saveProblem(big)).toMatch(/zu groß/);
    expect(ownMatches({ name: 'Sommerfest Retro' }, 'retro')).toBe(true);
    expect(ownMatches({ name: 'Sommerfest' }, 'meine')).toBe(true);
    expect(ownMatches({ name: 'Sommerfest' }, 'kanban')).toBe(false);
  });

  it('eingefügt auf einem anderen Board: neue IDs, Verbinder zeigen auf die Kopien', () => {
    const src = new BoardStore(new Y.Doc(), 'm:1');
    const a = src.create({ type: 'sticky', x: 0, y: 0, w: 100, h: 100, color: '#fff27a', text: 'A' });
    const b = src.create({ type: 'sticky', x: 300, y: 0, w: 100, h: 100, color: '#fff27a', text: 'B' });
    src.create({ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: a }, to: { objectId: b } });
    const saved = JSON.parse(JSON.stringify(templateFromSelection(src.getSnapshot(), [a, b])));
    const dst = new BoardStore(new Y.Doc(), 'm:2');
    const ids = insertAt(dst, cleanTemplateObjects(saved), { x: 1000, y: 1000 }, (i) => `t-${i}`);
    expect(ids).toEqual(['t-0', 't-1', 't-2']);
    const c = dst.get('t-2')!;
    expect(c.from).toMatchObject({ objectId: 't-0' });
    expect(c.to).toMatchObject({ objectId: 't-1' });
    expect(dst.get('t-0')!.createdBy).toBe('m:2');
  });
});
