import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardStore, LOCAL_ORIGIN, normalize } from './store';
import type { BoardObject } from '../protocol';

const sticky = (x = 0, y = 0) => ({ type: 'sticky' as const, x, y, w: 200, h: 200, color: '#fff27a', text: 'Hallo' });

function pair() {
  // zwei Clients, die sich gegenseitig Updates schicken (wie über den Sync-Server)
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(b, u, 'remote'));
  b.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(a, u, 'remote'));
  return { a: new BoardStore(a, 'm:1'), b: new BoardStore(b, 'm:2') };
}

describe('BoardStore', () => {
  it('legt Objekte nach Vertrag an (Felder, Y.Map je Objekt, z über allem)', () => {
    const store = new BoardStore(new Y.Doc(), 'm:1');
    const id1 = store.create(sticky());
    const id2 = store.create(sticky(10, 10));
    const o1 = store.get(id1)!;
    const o2 = store.get(id2)!;
    expect(o1).toMatchObject({ id: id1, type: 'sticky', x: 0, y: 0, w: 200, h: 200, createdBy: 'm:1' });
    expect(o1.updatedAt).toMatch(/Z$/);
    expect(o2.z > o1.z).toBe(true);
    const raw = store.doc.getMap('objects').get(id1);
    expect(raw).toBeInstanceOf(Y.Map);
    expect((raw as Y.Map<unknown>).get('text')).toBe('Hallo');
    expect(store.getSnapshot().ordered.map((o) => o.id)).toEqual([id1, id2]);
  });

  it('liefert unveränderte Objekte bei fremden Änderungen identisch zurück (für memo)', () => {
    const store = new BoardStore(new Y.Doc(), 'm:1');
    const [a, b] = store.createMany([sticky(), sticky(300, 0)]);
    const before = store.getSnapshot();
    store.update(a, { x: 50 });
    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.byId.get(b)).toBe(before.byId.get(b));
    expect(after.byId.get(a)).not.toBe(before.byId.get(a));
    expect(after.byId.get(a)!.x).toBe(50);
  });

  it('entfernt Felder bei undefined und ignoriert unveränderte Werte', () => {
    const store = new BoardStore(new Y.Doc(), 'm:1');
    const id = store.create({ ...sticky(), locked: true });
    let events = 0;
    store.subscribe(() => events++);
    store.update(id, { x: 0 });
    expect(events).toBe(0);
    store.update(id, { locked: undefined });
    expect(store.get(id)!.locked).toBeUndefined();
    expect(events).toBe(1);
  });

  it('löscht angedockte Verbinder mit', () => {
    const store = new BoardStore(new Y.Doc(), 'm:1');
    const [a, b, c] = store.createMany([sticky(), sticky(400, 0), sticky(800, 0)]);
    const conn = store.create({ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: a }, to: { objectId: b } });
    const free = store.create({ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: c }, to: { x: 0, y: 0 } });
    store.remove([a]);
    expect(store.get(conn)).toBeUndefined();
    expect(store.get(free)).toBeDefined();
    expect(store.get(b)).toBeDefined();
  });

  it('Ebenen: nach vorne / nach hinten, Rahmen immer unten', () => {
    const store = new BoardStore(new Y.Doc(), 'm:1');
    const [a, b, c] = store.createMany([sticky(), sticky(), sticky()]);
    const f = store.create({ type: 'frame', x: 0, y: 0, w: 900, h: 600, title: 'R' });
    store.bringToFront([a]);
    expect(store.getSnapshot().ordered.map((o) => o.id)).toEqual([f, b, c, a]);
    store.sendToBack([c]);
    expect(store.getSnapshot().ordered.map((o) => o.id)).toEqual([f, c, b, a]);
  });

  it('synchronisiert zwischen zwei Clients', () => {
    const { a, b } = pair();
    const id = a.create(sticky(5, 6));
    expect(b.get(id)).toMatchObject({ x: 5, y: 6, createdBy: 'm:1' });
    b.update(id, { text: 'von B' });
    expect(a.get(id)!.text).toBe('von B');
  });

  it('normalize verwirft unbekannte Typen und füllt Zahlen auf', () => {
    expect(normalize('x', { type: 'kaputt' })).toBeNull();
    const o = normalize('y', { type: 'sticky', x: 'a', w: -5 }) as BoardObject;
    expect(o).toMatchObject({ id: 'y', x: 0, y: 0, w: 1, h: 100 });
  });
});

describe('Undo/Redo (Y.UndoManager, nur eigene Änderungen)', () => {
  it('macht eigene Änderungen rückgängig und wiederholt sie', () => {
    const store = new BoardStore(new Y.Doc(), 'm:1');
    const id = store.create(sticky());
    store.stopCapturing();
    store.update(id, { x: 100 });
    store.stopCapturing();
    expect(store.getHistory()).toEqual({ canUndo: true, canRedo: false });
    store.undo();
    expect(store.get(id)!.x).toBe(0);
    store.undo();
    expect(store.get(id)).toBeUndefined();
    expect(store.getHistory().canRedo).toBe(true);
    store.redo();
    store.redo();
    expect(store.get(id)!.x).toBe(100);
  });

  it('fasst einen Ziehvorgang zu einem Schritt zusammen', () => {
    const store = new BoardStore(new Y.Doc(), 'm:1');
    const id = store.create(sticky());
    store.stopCapturing();
    for (let i = 1; i <= 20; i++) store.update(id, { x: i * 5 });
    store.stopCapturing();
    store.undo();
    expect(store.get(id)!.x).toBe(0);
  });

  it('macht fremde Änderungen nicht rückgängig', () => {
    const { a, b } = pair();
    const id = a.create(sticky());
    a.stopCapturing();
    b.update(id, { text: 'B war hier' });
    a.update(id, { x: 300 });
    a.stopCapturing();
    a.undo();
    expect(a.get(id)!.x).toBe(0);
    expect(a.get(id)!.text).toBe('B war hier');
    // B kann A's Anlegen nicht rückgängig machen
    expect(b.getHistory().canUndo).toBe(true);
    b.undo();
    expect(a.get(id)).toBeDefined();
    expect(a.get(id)!.text).toBe('Hallo');
  });

  it('verfolgt nur Transaktionen mit LOCAL_ORIGIN', () => {
    const store = new BoardStore(new Y.Doc(), 'm:1');
    store.doc.transact(() => {
      const m = new Y.Map<unknown>();
      m.set('type', 'text');
      store.objects.set('fremd', m);
    }, 'irgendwas');
    expect(store.getHistory().canUndo).toBe(false);
    store.doc.transact(() => store.objects.get('fremd')!.set('x', 5), LOCAL_ORIGIN);
    expect(store.getHistory().canUndo).toBe(true);
  });
  it('mit eigenem Origin (Server, Native-API): schreibt und verfolgt nur diesen', () => {
    const doc = new Y.Doc();
    const origin = { native: 'sitzung-1' };
    const app = new BoardStore(doc, 'm:2', { origin });
    const web = new BoardStore(doc, 'm:1');
    expect(app.origin).toBe(origin);
    expect(web.origin).toBe(LOCAL_ORIGIN);
    const seen: unknown[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => seen.push(tr.origin));
    const id = app.create(sticky());
    expect(seen).toEqual([origin]);
    web.update(id, { text: 'vom Web' });
    expect(seen.at(-1)).toBe(LOCAL_ORIGIN);
    expect(web.getHistory().canUndo).toBe(true);
    app.undo();
    expect(app.get(id)).toBeUndefined();
    expect(web.getHistory().canUndo).toBe(true);
  });
  it('verwirft eine abgebrochene Geste ohne Wiederholen-Schritt', () => {
    const store = new BoardStore(new Y.Doc(), 'm:1');
    const id = store.create(sticky());
    store.stopCapturing();
    const depth = store.undoDepth();
    store.update(id, { x: 100 });
    store.update(id, { x: 200, y: 50 });
    store.revertTo(depth);
    expect(store.get(id)).toMatchObject({ x: 0, y: 0 });
    expect(store.getHistory().canRedo).toBe(false);
    // ohne Änderung bleibt der vorherige Schritt (Anlegen) erhalten
    store.revertTo(store.undoDepth());
    expect(store.get(id)).toBeDefined();
  });
});

describe('BoardStore: Erweiterungen', () => {
  it('eigene Y-Strukturen (extMap) gehören zu Rückgängig/Wiederholen', () => {
    const store = new BoardStore(new Y.Doc(), 'm:1');
    const comments = store.extMap<string>('comments');
    expect(store.extMap('comments')).toBe(comments);
    store.transact(() => comments.set('c1', 'Hallo'));
    store.stopCapturing();
    expect(comments.get('c1')).toBe('Hallo');
    store.undo();
    expect(comments.has('c1')).toBe(false);
    store.redo();
    expect(comments.get('c1')).toBe('Hallo');
    // ohne Undo: fremde Origins/Zähler
    const meta = store.extMap('meta', { undo: false });
    store.transact(() => meta.set('timer', 1));
    store.undo();
    expect(meta.get('timer')).toBe(1);
    expect(() => store.extMap('objects')).toThrow();
  });

  it('Y-Feld content: Lesekopie im Schnappschuss, lebender Typ über yField, Kopie über den Codec', () => {
    const store = new BoardStore(new Y.Doc(), 'm:1');
    const id = store.create(sticky());
    const frag = store.ensureYField(id, 'content', () => new Y.XmlFragment())!;
    expect(store.yField(id, 'content')).toBe(frag);
    store.transact(() => {
      const p = new Y.XmlElement('paragraph');
      p.insert(0, [new Y.XmlText('Fett')]);
      frag.insert(0, [p]);
    });
    expect(store.get(id)!.content).toBe('<paragraph>Fett</paragraph>');
    // Standard-Codec: ohne Rich-Text-Modul wird die Lesekopie beim Anlegen weggelassen (Klartext bleibt)
    const copy = store.create({ ...sticky(), content: '<paragraph>Fett</paragraph>' });
    expect(store.yField(copy, 'content')).toBeUndefined();
    expect(store.get(copy)!.text).toBe('Hallo');
  });

  it('ändert die Reihenfolge nur bei z/Typ-Wechsel (Schnappschuss wird sonst an Ort und Stelle ersetzt)', () => {
    const store = new BoardStore(new Y.Doc(), 'm:1');
    const [a, b] = store.createMany([sticky(), sticky(300, 0)]);
    const s1 = store.getSnapshot();
    store.update(a, { x: 99 });
    const s2 = store.getSnapshot();
    expect(s2.rank).toBe(s1.rank);
    expect(s2.ordered.map((o) => o.id)).toEqual([a, b]);
    expect(s2.ordered[0].x).toBe(99);
    store.bringToFront([a]);
    const s3 = store.getSnapshot();
    expect(s3.ordered.map((o) => o.id)).toEqual([b, a]);
    expect(s3.rank.get(a)).toBe(1);
  });
});
