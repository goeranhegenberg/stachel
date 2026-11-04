// Gleichzeitiges Arbeiten mehrerer Clients (je ein Y.Doc, Sync per Update-Austausch wie über den Server):
// z-Reihenfolge, Gruppen, Verbinder, Undo nur eigener Schritte, Rich-Text-Migration, Kopieren zwischen Boards.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardStore, LOCAL_ORIGIN } from './store';
import { compareKeys, keysBetween } from './fractional';
import { cloneObjects } from './clipboard';
import { endAnchor } from './connector';
import { generateKeyBetween } from 'fractional-indexing';

const sticky = (x = 0, y = 0, extra: Record<string, unknown> = {}) => ({ type: 'sticky' as const, x, y, w: 200, h: 200, text: 'Hallo', ...extra });

/**
 * n Clients mit Netz, das sich anhalten lässt (offline) und beim Wiederverbinden die fehlenden Updates austauscht
 * (wie der Hocuspocus-Provider per Sync-Schritt 1/2).
 */
function net(n: number) {
  const docs = Array.from({ length: n }, () => new Y.Doc());
  let online = true;
  docs.forEach((d, i) =>
    d.on('update', (u: Uint8Array, origin: unknown) => {
      if (!online || origin === 'remote') return;
      docs.forEach((o, j) => j !== i && Y.applyUpdate(o, u, 'remote'));
    }),
  );
  const stores = docs.map((d, i) => new BoardStore(d, `m:${i + 1}`));
  return {
    stores,
    offline: () => {
      online = false;
    },
    /** wieder verbinden: Zustandsvektoren austauschen */
    reconnect: () => {
      online = true;
      for (const a of docs) for (const b of docs) if (a !== b) Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), 'remote');
    },
  };
}

const order = (s: BoardStore) => s.getSnapshot().ordered.map((o) => o.id);

describe('Gleichzeitig: z-Reihenfolge (Fractional Index)', () => {
  it('gleichzeitig angelegte Objekte bekommen verschiedene z-Schlüssel, alle sehen dieselbe Reihenfolge', () => {
    const { stores, offline, reconnect } = net(3);
    stores[0].create(sticky());
    offline();
    const ids = stores.map((s, i) => s.create(sticky(i * 10, 0)));
    reconnect();
    const zs = ids.map((id) => stores[0].get(id)!.z);
    expect(new Set(zs).size).toBe(3);
    expect(order(stores[1])).toEqual(order(stores[0]));
    expect(order(stores[2])).toEqual(order(stores[0]));
    // neue Objekte bleiben gültige Schlüssel für fractional-indexing
    for (const z of zs) expect(() => generateKeyBetween(z, null)).not.toThrow();
  });

  it('gleichzeitiges „nach vorne“ zweier Clients endet bei allen gleich', () => {
    const { stores, offline, reconnect } = net(2);
    const [a, b, c] = stores[0].createMany([sticky(), sticky(), sticky()]);
    offline();
    stores[0].bringToFront([a]);
    stores[1].bringToFront([b]);
    reconnect();
    expect(order(stores[0])).toEqual(order(stores[1]));
    expect(order(stores[0])[0]).toBe(c);
  });

  it('Schlüssel zwischen zwei gleichen Nachbarn (Kollision) liegen knapp darüber statt ganz unten', () => {
    const k = keysBetween('a5', 'a5', 2);
    expect(k).toHaveLength(2);
    expect(k[0] > 'a5' && k[1] > k[0]).toBe(true);
    // nicht über den nächsthöheren normalen Schlüssel springen
    expect(k[1] < 'a6').toBe(true);
    for (const z of k) expect(() => generateKeyBetween(z, null)).not.toThrow();
    // vertauschte Grenzen ebenso
    const v = keysBetween('a7', 'a5', 1);
    expect(v[0] > 'a7').toBe(true);
  });

  it('viele gleichzeitige Anlagen in Folge: Schlüssel bleiben kurz', () => {
    const s = new BoardStore(new Y.Doc(), 'm:1');
    for (let i = 0; i < 500; i++) s.create(sticky());
    expect(s.getSnapshot().topZ!.length).toBeLessThan(10);
    expect(compareKeys(s.getSnapshot().bottomZ!, s.getSnapshot().topZ!)).toBe(-1);
  });
});

describe('Gleichzeitig: Löschen, Verschieben, Verbinder', () => {
  it('Verschieben trifft auf Löschen: Objekt bleibt gelöscht, kein Absturz, Undo des Löschens holt die Verschiebung zurück', () => {
    const { stores, offline, reconnect } = net(2);
    const id = stores[0].create(sticky());
    stores[0].stopCapturing();
    offline();
    stores[0].remove([id]);
    stores[1].update(id, { x: 500 });
    reconnect();
    expect(stores[0].get(id)).toBeUndefined();
    expect(stores[1].get(id)).toBeUndefined();
    stores[0].undo();
    expect(stores[1].get(id)).toBeDefined();
  });

  it('Verbinder auf ein gleichzeitig gelöschtes Objekt: Ende hängt ins Leere und wird nicht gezeichnet', () => {
    const { stores, offline, reconnect } = net(2);
    const [x, y] = stores[0].createMany([sticky(), sticky(400, 0)]);
    stores[0].stopCapturing();
    offline();
    stores[0].remove([x]);
    const c = stores[1].create({ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: x }, to: { objectId: y } });
    reconnect();
    const conn = stores[0].get(c)!;
    expect(conn).toBeDefined();
    expect(endAnchor(conn.from, stores[0].get)).toBeNull();
    // Kopieren lässt solche Verbinder weg statt kaputte Bezüge mitzunehmen
    expect(cloneObjects([conn], 0, 0, stores[0].get)).toEqual([]);
    // Undo des Löschens: Verbinder ist wieder vollständig
    stores[0].undo();
    expect(endAnchor(stores[1].get(c)!.from, stores[1].get)).not.toBeNull();
  });
});

describe('Gruppen ohne Waisen', () => {
  it('Löschen eines Mitglieds einer Zweiergruppe löst die Gruppe auf (ein Undo-Schritt)', () => {
    const s = new BoardStore(new Y.Doc(), 'm:1');
    const [a, b, c] = s.createMany([sticky(0, 0, { groupId: 'g' }), sticky(300, 0, { groupId: 'g' }), sticky(600, 0, { groupId: 'h' })]);
    s.stopCapturing();
    s.remove([a]);
    expect(s.get(b)!.groupId).toBeUndefined();
    // Einzelobjekt mit eigener Gruppe (Altbestand) bleibt unberührt, solange es nicht betroffen ist
    expect(s.get(c)!.groupId).toBe('h');
    s.undo();
    expect(s.get(a)!.groupId).toBe('g');
    expect(s.get(b)!.groupId).toBe('g');
  });

  it('Lösen eines Mitglieds einer Zweiergruppe lässt kein Einzelmitglied zurück', () => {
    const s = new BoardStore(new Y.Doc(), 'm:1');
    const [a, b] = s.createMany([sticky(0, 0, { groupId: 'g' }), sticky(300, 0, { groupId: 'g' })]);
    s.update(a, { groupId: undefined });
    expect(s.get(b)!.groupId).toBeUndefined();
    // Dreiergruppe bleibt nach Lösen eines Mitglieds als Zweiergruppe bestehen
    const [c, d, e] = s.createMany([sticky(0, 0, { groupId: 'k' }), sticky(0, 0, { groupId: 'k' }), sticky(0, 0, { groupId: 'k' })]);
    s.update(c, { groupId: undefined });
    expect(s.get(d)!.groupId).toBe('k');
    expect(s.get(e)!.groupId).toBe('k');
  });

  it('Kopie eines einzelnen Gruppenmitglieds bekommt keine Gruppe', () => {
    const a = { id: 'a', type: 'sticky', x: 0, y: 0, w: 1, h: 1, z: 'a0', createdBy: '', updatedAt: '', groupId: 'g' } as const;
    const b = { ...a, id: 'b', groupId: 'g' };
    expect(cloneObjects([a], 10, 10, () => undefined)[0].groupId).toBeUndefined();
    const two = cloneObjects([a, b], 10, 10, () => undefined);
    expect(two[0].groupId).toBeTruthy();
    expect(two[0].groupId).toBe(two[1].groupId);
  });

  it('gleichzeitiges Gruppieren derselben Objekte: alle Clients sehen dieselbe Gruppe', () => {
    const { stores, offline, reconnect } = net(2);
    const [a, b, c] = stores[0].createMany([sticky(), sticky(), sticky()]);
    offline();
    stores[0].updateMany({ [a]: { groupId: 'g1' }, [b]: { groupId: 'g1' } });
    stores[1].updateMany({ [b]: { groupId: 'g2' }, [c]: { groupId: 'g2' } });
    reconnect();
    const g = (s: BoardStore) => [a, b, c].map((id) => s.get(id)!.groupId);
    expect(g(stores[0])).toEqual(g(stores[1]));
  });
});

describe('Undo nur eigene Schritte', () => {
  it('drei Clients: jeder nimmt nur seine eigenen Änderungen zurück', () => {
    const { stores } = net(3);
    const id = stores[0].create(sticky());
    stores.forEach((s) => s.stopCapturing());
    stores[1].update(id, { color: '#ff0000' });
    stores[2].update(id, { x: 999 });
    stores[1].stopCapturing();
    stores[2].stopCapturing();
    stores[1].undo();
    expect(stores[0].get(id)!.color).toBeUndefined();
    expect(stores[0].get(id)!.x).toBe(999);
    stores[2].undo();
    expect(stores[0].get(id)!.x).toBe(0);
    // 1 hat nichts mehr zurückzunehmen, 0 nur sein Anlegen
    expect(stores[1].getHistory().canUndo).toBe(false);
    stores[0].undo();
    expect(stores[2].get(id)).toBeUndefined();
  });

  it('Gruppieren, Ausrichten, Einfügen: je ein Schritt, Redo stellt wieder her', () => {
    const s = new BoardStore(new Y.Doc(), 'm:1');
    const [a, b] = s.createMany([sticky(0, 0), sticky(300, 50)]);
    s.stopCapturing();
    s.updateMany({ [a]: { groupId: 'g' }, [b]: { groupId: 'g' } });
    s.stopCapturing();
    s.updateMany({ [b]: { y: 0 } });
    s.stopCapturing();
    const pasted = s.createMany(cloneObjects([s.get(a)!, s.get(b)!], 20, 20, s.get));
    s.stopCapturing();
    expect(s.get(pasted[0])!.groupId).toBe(s.get(pasted[1])!.groupId);
    s.undo();
    expect(s.get(pasted[0])).toBeUndefined();
    s.undo();
    expect(s.get(b)!.y).toBe(50);
    s.undo();
    expect(s.get(a)!.groupId).toBeUndefined();
    s.redo();
    s.redo();
    s.redo();
    expect(s.get(a)!.groupId).toBe('g');
    expect(s.get(b)!.y).toBe(0);
    expect(s.get(pasted[1])).toBeDefined();
  });

  it('Rich-Text-Fragment: Undo des Löschens bringt den Inhalt zurück, auch beim anderen Client', () => {
    const { stores } = net(2);
    const id = stores[0].create(sticky());
    const f = stores[0].ensureYField(id, 'content', () => new Y.XmlFragment())!;
    stores[0].transact(() => {
      const p = new Y.XmlElement('paragraph');
      p.insert(0, [new Y.XmlText('Hallo')]);
      f.insert(0, [p]);
    });
    stores[0].stopCapturing();
    stores[0].remove([id]);
    stores[0].stopCapturing();
    stores[0].undo();
    expect(stores[1].get(id)!.content).toBe('<paragraph>Hallo</paragraph>');
    expect(stores[1].yField<Y.XmlFragment>(id, 'content')!.toString()).toBe('<paragraph>Hallo</paragraph>');
  });

  it('Text-Undo (fremder Origin per trackOrigin) und Objekt-Undo in einer Reihe', () => {
    const PM = { name: 'y-sync' };
    const s = new BoardStore(new Y.Doc(), 'm:1');
    s.trackOrigin(PM);
    const id = s.create(sticky());
    s.stopCapturing();
    const f = s.ensureYField(id, 'content', () => new Y.XmlFragment())!;
    s.stopCapturing();
    s.doc.transact(() => f.insert(0, [new Y.XmlText('abc')]), PM);
    s.stopCapturing();
    s.update(id, { x: 50 });
    s.stopCapturing();
    s.undo();
    expect(s.get(id)!.x).toBe(0);
    s.undo();
    expect(s.yField(id, 'content')!.toString()).toBe('');
    s.redo();
    expect(s.yField(id, 'content')!.toString()).toBe('abc');
    s.redo();
    expect(s.get(id)!.x).toBe(50);
  });
});

describe('Offline und Wiederverbinden', () => {
  it('beide arbeiten offline weiter, nach dem Verbinden haben alle denselben Stand', () => {
    const { stores, offline, reconnect } = net(2);
    const id = stores[0].create(sticky());
    offline();
    stores[0].update(id, { x: 10 });
    stores[1].update(id, { text: 'offline B' });
    const n0 = stores[0].create(sticky(1, 1));
    const n1 = stores[1].create(sticky(2, 2));
    reconnect();
    for (const s of stores) {
      expect(s.get(id)).toMatchObject({ x: 10, text: 'offline B' });
      expect(s.get(n0)).toBeDefined();
      expect(s.get(n1)).toBeDefined();
    }
    expect(order(stores[0])).toEqual(order(stores[1]));
  });
});

describe('Kopieren zwischen Boards', () => {
  it('neue ids, Verbinder und Gruppen auf die Kopien umgeschrieben, nichts zeigt aufs Quell-Board', () => {
    const src = new BoardStore(new Y.Doc(), 'm:1');
    const [a, b, lone] = src.createMany([sticky(0, 0, { groupId: 'g' }), sticky(300, 0, { groupId: 'g' }), sticky(600, 0)]);
    const c1 = src.create({ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: a, side: 'e' }, to: { objectId: b } });
    const c2 = src.create({ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: a }, to: { objectId: lone } });
    const objs = [a, b, c1, c2].map((id) => src.get(id)!);
    // Einfügen auf einem anderen Board: dort gibt es die Quell-Objekte nicht
    const dst = new BoardStore(new Y.Doc(), 'm:2');
    const idMap = new Map<string, string>();
    const ids = dst.createMany(cloneObjects(objs, 0, 0, dst.get, idMap));
    const srcIds = new Set([a, b, lone, c1, c2]);
    for (const id of ids) {
      const o = dst.get(id)!;
      expect(srcIds.has(o.id)).toBe(false);
      expect(o.createdBy).toBe('m:2');
      for (const end of [o.from, o.to]) if (end && 'objectId' in end) expect(ids).toContain(end.objectId);
    }
    const ca = dst.get(idMap.get(c1)!)!;
    expect(ca.from).toEqual({ objectId: idMap.get(a), side: 'e' });
    expect(dst.get(idMap.get(a)!)!.groupId).toBe(dst.get(idMap.get(b)!)!.groupId);
    expect(dst.get(idMap.get(a)!)!.groupId).not.toBe('g');
  });
});

describe('Alte Boards (Welle 1)', () => {
  it('lädt Objekte mit nur `text`, fehlenden Feldern und unbekannten Typen', () => {
    const doc = new Y.Doc();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    doc.transact(() => {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({ id: 'alt', type: 'sticky', x: 1, y: 2, w: 200, h: 200, z: 'a0', text: 'Zeile 1\nZeile 2' })) m.set(k, v);
      objects.set('alt', m);
      const u = new Y.Map<unknown>();
      u.set('type', 'zukunft');
      objects.set('neu', u);
      const k = new Y.Map<unknown>();
      k.set('type', 'shape');
      objects.set('kaputt', k);
    });
    const s = new BoardStore(doc, 'm:1');
    expect(s.get('alt')).toMatchObject({ text: 'Zeile 1\nZeile 2' });
    expect(s.get('alt')!.content).toBeUndefined();
    expect(s.get('neu')).toBeUndefined();
    expect(s.get('kaputt')).toMatchObject({ x: 0, y: 0, w: 100, h: 100, z: '' });
    // unbekannte Typen bleiben im Dokument (Vertrag)
    s.remove(['alt']);
    expect(objects.has('neu')).toBe(true);
    // neue Objekte sortieren über Altbestand mit leerem z
    const n = s.create(sticky());
    expect(order(s)).toEqual(['kaputt', n]);
    expect(s.doc.transact).toBeDefined();
    expect(LOCAL_ORIGIN).toBe('stachel:local');
  });
});

describe('Rich-Text-Migration (`text` → `content`) bei zwei gleichzeitigen Clients', () => {
  it('beide bauen `content` gleichzeitig: alle landen beim selben Fragment, `text` bleibt erhalten', async () => {
    const { ensureContent, fragmentToJson, plainOf } = await import('../features/richtext/doc');
    const { stores, offline, reconnect } = net(2);
    const id = stores[0].create(sticky(0, 0, { text: 'Alt\nZeile 2' }));
    offline();
    const fa = ensureContent(stores[0], id)!;
    const fb = ensureContent(stores[1], id)!;
    expect(fa).not.toBe(fb);
    reconnect();
    const win = stores[0].yField<Y.XmlFragment>(id, 'content')!;
    expect(stores[1].yField<Y.XmlFragment>(id, 'content')!.toString()).toBe(win.toString());
    expect(plainOf(fragmentToJson(win))).toBe('Alt\nZeile 2');
    // Migration läuft nicht ein zweites Mal: das vorhandene Fragment wird wiederverwendet
    expect(ensureContent(stores[0], id)).toBe(win);
    expect(ensureContent(stores[1], id)).toBe(stores[1].yField(id, 'content'));
    // Bekannte Grenze (Bericht an richtext): Der Verlierer hält ein abgehängtes Fragment. Was ein dort noch
    // gebundener Editor hineinschreibt, kommt bei niemandem an – RichEdit muss bei neuem `content` neu binden.
    const aWon = stores[0].yField(id, 'content') === fa;
    const lost = aWon ? fb : fa;
    const other = aWon ? stores[0] : stores[1];
    expect(lost._item?.deleted).toBe(true);
    lost.doc!.transact(() => lost.insert(0, [new Y.XmlText('verloren')]), LOCAL_ORIGIN);
    expect(other.yField<Y.XmlFragment>(id, 'content')!.toString()).not.toContain('verloren');
  });
});

describe('Awareness fremder Clients (readPeers)', () => {
  it('verwirft Peers mit ungültigem Nutzer, säubert Cursor, Auswahl und Farbe', async () => {
    const { readPeers } = await import('./session');
    const states = new Map<number, Record<string, any>>([
      [1, { user: { key: 'm:1', name: 'Eigene', color: '#fff' } }],
      [2, { user: { key: 'm:2', name: 'Ben', color: 'red;background:url(x)' }, cursor: { x: 1, y: Infinity }, selection: ['a', 5, null] }],
      [3, { user: { key: 7, name: 'Kaputt' } }],
      [4, { user: { key: 'm:4', name: { toString: 1 } } }],
      [5, { user: 'quatsch', cursor: { x: 1, y: 2 } }],
      [6, { user: { key: 'm:6', name: 'Cleo', color: '#1763b5' }, cursor: { x: 3, y: 4 }, 'collab.follow': 'm:2' }],
      [7, null as unknown as Record<string, any>],
    ]);
    const peers = readPeers(states, 1);
    expect(peers.map((p) => p.clientId)).toEqual([2, 6]);
    expect(peers[0].cursor).toBeNull();
    expect(peers[0].selection).toEqual(['a']);
    expect(peers[0].user.color).toMatch(/^#/);
    expect(peers[1]).toMatchObject({ cursor: { x: 3, y: 4 }, user: { color: '#1763b5' }, extra: { 'collab.follow': 'm:2' } });
  });
});
