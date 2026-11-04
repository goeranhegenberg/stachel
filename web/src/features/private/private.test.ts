// Privater Modus im Store: Privat-Ablage als zweite Quelle (docs/features/private.md §3).
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardStore } from '../../board/store';
import { PRIVATE_HIDDEN, PRIVATE_MODE } from '../../protocol';
import { ensureContent } from '../richtext/doc';
import { countdownLeft } from './model';
import { privateRoute, readHidden, readMode } from './route';

function setup(on = true) {
  const main = new Y.Doc();
  const pdoc = new Y.Doc();
  if (on) main.getMap(PRIVATE_MODE).set('on', true);
  const store = new BoardStore(main, 'm:1');
  store.attachPrivate(pdoc);
  store.setCreateRoute(privateRoute(main));
  return { main, pdoc, store, objects: main.getMap<Y.Map<unknown>>('objects'), pobjects: pdoc.getMap<Y.Map<unknown>>('objects') };
}

describe('Privat-Ablage im BoardStore', () => {
  it('neue Notizen, Texte, Formen gehen im Modus in die Ablage, Rahmen bleiben öffentlich', () => {
    const { store, objects, pobjects } = setup();
    const [n, t, s, f] = store.createMany([
      { type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'geheim' },
      { type: 'text', x: 0, y: 0, w: 100, h: 30, text: 't' },
      { type: 'shape', x: 0, y: 0, w: 100, h: 100 },
      { type: 'frame', x: 0, y: 0, w: 800, h: 600 },
    ]);
    expect([n, t, s].every((id) => pobjects.has(id) && !objects.has(id))).toBe(true);
    expect(objects.has(f)).toBe(true);
    expect(store.isPrivate(n)).toBe(true);
    expect(store.isPrivate(f)).toBe(false);
    // Schnappschuss zeigt beides, in Ebenen-Reihenfolge
    expect(store.getSnapshot().ordered.map((o) => o.id)).toEqual([f, n, t, s]);
    expect(store.get(n)?.text).toBe('geheim');
  });

  it('Verbinder an einer privaten Notiz ist privat, zwischen öffentlichen nicht', () => {
    const { store, objects, pobjects } = setup();
    const pub = store.createMany([{ type: 'frame', x: 0, y: 0, w: 10, h: 10 }])[0];
    const [n, c] = store.createMany([
      { id: 'n1', type: 'sticky', x: 0, y: 0, w: 200, h: 200 },
      { type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: 'n1' }, to: { x: 500, y: 0 } },
    ]);
    expect(pobjects.has(n) && pobjects.has(c)).toBe(true);
    const c2 = store.create({ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: pub }, to: { x: 1, y: 1 } });
    expect(objects.has(c2)).toBe(true);
  });

  it('ohne laufenden Modus geht alles ins Board', () => {
    const { store, objects, pobjects } = setup(false);
    const id = store.create({ type: 'sticky', x: 0, y: 0, w: 200, h: 200 });
    expect(objects.has(id)).toBe(true);
    expect(pobjects.size).toBe(0);
  });

  it('Ändern, Löschen und Gruppen wirken im Dokument des Objekts', () => {
    const { store, main, pdoc, pobjects } = setup();
    const [a, b] = store.createMany([
      { type: 'sticky', x: 0, y: 0, w: 200, h: 200, groupId: 'g' },
      { type: 'sticky', x: 0, y: 0, w: 200, h: 200, groupId: 'g' },
    ]);
    let mainUpdates = 0;
    main.on('update', () => mainUpdates++);
    store.updateMany({ [a]: { x: 40, color: '#1763b5' } });
    expect(pobjects.get(a)!.get('x')).toBe(40);
    expect(store.get(a)?.color).toBe('#1763b5');
    expect(mainUpdates).toBe(0);
    store.remove([b]);
    expect(pobjects.has(b)).toBe(false);
    expect(pobjects.get(a)!.has('groupId')).toBe(false); // Gruppe mit nur einem Mitglied aufgelöst
    expect(store.docOf(a)).toBe(pdoc);
    expect(store.mapOf(a)).toBe(pobjects.get(a));
  });

  it('Rückgängig nimmt über beide Dokumente den jüngsten Schritt zuerst', () => {
    const { store, objects, pobjects } = setup();
    const f = store.create({ type: 'frame', x: 0, y: 0, w: 10, h: 10 });
    store.stopCapturing();
    const n = store.create({ type: 'sticky', x: 0, y: 0, w: 200, h: 200 });
    store.stopCapturing();
    store.update(f, { x: 99 });
    store.stopCapturing();
    expect(store.getHistory().canUndo).toBe(true);
    store.undo(); // Rahmen zurück
    expect(objects.get(f)!.get('x')).toBe(0);
    expect(pobjects.has(n)).toBe(true);
    store.undo(); // Notiz weg
    expect(pobjects.has(n)).toBe(false);
    expect(objects.has(f)).toBe(true);
    store.redo(); // Notiz wieder
    expect(pobjects.has(n)).toBe(true);
    expect(store.undoDepth()).toBe(2);
  });

  it('Rich-Text einer privaten Notiz liegt in der Ablage', () => {
    const { store, pdoc, main } = setup();
    const n = store.create({ type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'Hallo' });
    const frag = ensureContent(store, n);
    expect(frag?.doc).toBe(pdoc);
    expect(JSON.stringify(main.toJSON())).not.toContain('Hallo');
  });

  it('gleiche ID in Board und Ablage: Board gewinnt (Aufdecken)', () => {
    const { store, main, pdoc, objects, pobjects } = setup();
    const n = store.create({ type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'a' });
    main.transact(() => objects.set(n, (pobjects.get(n) as Y.Map<unknown>).clone()));
    expect(store.isPrivate(n)).toBe(false);
    pdoc.transact(() => pobjects.delete(n));
    expect(store.get(n)?.text).toBe('a');
    expect(store.isPrivate(n)).toBe(false);
  });
});

describe('Zustand lesen', () => {
  it('readMode/readHidden/countdownLeft', () => {
    const doc = new Y.Doc();
    expect(readMode(doc)).toEqual({ on: false });
    const m = doc.getMap(PRIVATE_MODE);
    m.set('on', true);
    m.set('by', 'm:1');
    m.set('revealAt', 10_500);
    expect(readMode(doc)).toMatchObject({ on: true, by: 'm:1', anonymous: false, revealAt: 10_500 });
    expect(countdownLeft(readMode(doc), 8_000)).toBe(3);
    doc.getMap(PRIVATE_HIDDEN).set('p1', { x: 1, y: 2, w: 3, h: 4, type: 'sticky', o: 'x' });
    doc.getMap(PRIVATE_HIDDEN).set('bad', { x: 'a' });
    expect(readHidden(doc)).toEqual([{ id: 'p1', x: 1, y: 2, w: 3, h: 4, type: 'sticky', o: 'x' }]);
  });
});
