// Versionsverlauf (server/src/versions.ts, docs/contract.md §3 „Versionen“): Takt, Ausdünnen, Inhalt übernehmen,
// HTTP-API inkl. Wiederherstellen mit zwei verbundenen Clients.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db.js';
import { applyContent, BoardVersions, compactState, versionsToThin } from '../src/versions.js';
import { Browser, loginAdmin, loginMember, startEnv, waitFor, type TestEnv } from './helpers.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function sticky(doc: Y.Doc, id: string, text: string, extra: Record<string, unknown> = {}) {
  doc.transact(() => {
    const o = new Y.Map<unknown>();
    for (const [k, v] of Object.entries({ id, type: 'sticky', x: 0, y: 0, w: 200, h: 200, text, ...extra })) o.set(k, v);
    doc.getMap('objects').set(id, o);
  });
}
const objects = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('objects');
const textOf = (doc: Y.Doc, id: string) => objects(doc).get(id)?.get('text');

describe('Ausdünnen', () => {
  const now = Date.UTC(2026, 9, 30, 12, 0, 0);
  it('24 h alle, bis 30 Tage je Stunde, bis 1 Jahr je Tag, älter weg, benannte nie', () => {
    const v = (id: string, ago: number, named = false) => ({ id, at: now - ago, named });
    const list = [
      v('h1', 1 * MIN),
      v('h2', 2 * MIN),
      v('h3', 23 * HOUR),
      // vor 2 Tagen, alle in derselben Stunde → nur die jüngste bleibt
      v('d2a', 2 * DAY + 10 * MIN),
      v('d2b', 2 * DAY + 20 * MIN),
      v('d2c', 2 * DAY + 30 * MIN),
      v('d2-other-hour', 2 * DAY + 2 * HOUR),
      // vor 60 Tagen: eine je Tag
      v('m1', 60 * DAY + 1 * HOUR),
      v('m2', 60 * DAY + 3 * HOUR),
      v('m-named', 60 * DAY + 2 * HOUR, true),
      // älter als ein Jahr
      v('old', 400 * DAY),
      v('old-named', 400 * DAY, true),
    ];
    const drop = new Set(versionsToThin(list, now));
    expect([...drop].sort()).toEqual(['d2b', 'd2c', 'm2', 'old']);
    for (const keep of ['h1', 'h2', 'h3', 'd2-other-hour', 'm-named', 'old-named']) expect(drop.has(keep)).toBe(false);
    expect(drop.has('old')).toBe(true);
    // je Stunde bzw. Tag genau eine (die jüngste)
    expect(['d2a', 'd2b', 'd2c'].filter((id) => !drop.has(id))).toEqual(['d2a']);
    expect(['m1', 'm2'].filter((id) => !drop.has(id))).toHaveLength(1);
    expect(drop.has('m1')).toBe(false);
  });

  it('ist stabil: nochmal ausdünnen löscht nichts mehr', () => {
    const list = Array.from({ length: 200 }, (_, i) => ({ id: `v${i}`, at: now - i * 37 * MIN, named: false }));
    const first = new Set(versionsToThin(list, now));
    const rest = list.filter((v) => !first.has(v.id));
    expect(versionsToThin(rest, now)).toEqual([]);
    expect(rest.length).toBeLessThan(list.length);
  });
});

describe('Inhalt übernehmen (applyContent)', () => {
  /** Zwei Dokumente, die sich wie Server und verbundener Client gegenseitig aktualisieren. */
  function linked() {
    const server = new Y.Doc();
    const client = new Y.Doc();
    server.on('update', (u: Uint8Array, origin: unknown) => origin !== 'net' && Y.applyUpdate(client, u, 'net'));
    client.on('update', (u: Uint8Array, origin: unknown) => origin !== 'net' && Y.applyUpdate(server, u, 'net'));
    return { server, client };
  }

  it('bringt das Live-Dokument auf den alten Stand, verbundener Client sieht es; Unverändertes bleibt', () => {
    const { server, client } = linked();
    sticky(client, 'a', 'Bühne');
    sticky(client, 'b', 'Kasse');
    const rich = new Y.XmlFragment();
    client.transact(() => {
      objects(client).get('a')!.set('content', rich);
      const p = new Y.XmlElement('paragraph');
      p.insert(0, [new Y.XmlText('Bühne')]);
      rich.insert(0, [p]);
      client.getMap('collab.comments').set('c1', 'Kommentar');
      client.getArray('tools.list').push(['eins']);
    });
    const old = new Y.Doc();
    Y.applyUpdate(old, compactState(server).state);

    // danach geändert: Text, neues Objekt, gelöschtes Objekt, Kommentar, Liste, Rich-Text
    const aBefore = objects(client).get('a');
    client.transact(() => {
      objects(client).get('a')!.set('text', 'Bühne NEU');
      ((objects(client).get('a')!.get('content') as Y.XmlFragment).get(0) as Y.XmlElement).insert(1, [new Y.XmlText(' NEU')]);
      objects(client).delete('b');
      client.getMap('collab.comments').delete('c1');
      client.getArray('tools.list').push(['zwei']);
    });
    sticky(client, 'c', 'Neu dazu');
    // Server kennt die Strukturen der Module nicht (ungetypt), der Client schon
    server.transact(() => applyContent(server, old));

    expect(textOf(client, 'a')).toBe('Bühne');
    expect(textOf(client, 'b')).toBe('Kasse');
    expect(objects(client).has('c')).toBe(false);
    expect((objects(client).get('a')!.get('content') as Y.XmlFragment).toString()).toBe('<paragraph>Bühne</paragraph>');
    expect(client.getMap('collab.comments').get('c1')).toBe('Kommentar');
    expect(client.getArray('tools.list').toArray()).toEqual(['eins']);
    // geänderte Objekte werden feldweise zurückgesetzt, nicht ersetzt (gleiche Y.Map)
    expect(objects(client).get('a')).toBe(aBefore);
    // gleicher Inhalt wie die Version
    expect(objects(client).toJSON()).toEqual(objects(old).toJSON());
  });

  it('ändert nichts, wenn der Inhalt schon gleich ist', () => {
    const { server, client } = linked();
    sticky(client, 'a', 'x');
    const old = new Y.Doc();
    Y.applyUpdate(old, compactState(server).state);
    let updates = 0;
    client.on('update', () => updates++);
    server.transact(() => applyContent(server, old));
    expect(updates).toBe(0);
  });

  it('kompakter Stand ist kleiner als der volle Stand mit Verlauf', () => {
    const doc = new Y.Doc();
    sticky(doc, 'a', '');
    for (let i = 0; i < 300; i++) objects(doc).get('a')!.set('x', i);
    for (let i = 0; i < 50; i++) sticky(doc, `tmp${i}`, 'weg');
    for (let i = 0; i < 50; i++) objects(doc).delete(`tmp${i}`);
    const full = Y.encodeStateAsUpdate(doc).length;
    const { state, objects: n } = compactState(doc);
    expect(n).toBe(1);
    expect(state.length).toBeLessThan(full);
  });
});

describe('Takt (BoardVersions mit eigener Uhr)', () => {
  let dir: string;
  let db: Db;
  let t = 0;
  let versions: BoardVersions;
  const docs = new Map<string, Y.Doc & { getConnectionsCount?: () => number }>();
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-versions-'));
    db = openDb(dir);
  });
  afterAll(() => {
    versions?.stop();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function setup(boardId: string) {
    db.prepare('INSERT INTO boards (id, title, created_by, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(boardId, 'T', 'a:x', 'X', 'x', 'x');
    t = Date.UTC(2026, 9, 30, 8, 0, 0);
    versions = new BoardVersions(db, { intervalMs: 10 * MIN, now: () => t });
    versions.attach({ documents: docs } as never);
    versions.stop(); // Takt hier von Hand
    const doc = Object.assign(new Y.Doc(), { getConnectionsCount: () => 0 });
    docs.set(`board:${boardId}`, doc);
    return doc;
  }
  const count = (boardId: string) => versions.list(boardId).length;

  it('höchstens alle 10 Minuten beim Bearbeiten, danach erst wieder nach Änderungen', () => {
    const doc = setup('takt1');
    const edit = (text: string, who = { key: 'm:1', name: 'Mara' }) => {
      sticky(doc, 'a', text);
      versions.changed('takt1', who);
    };
    edit('1');
    t += 5 * MIN;
    versions.tick();
    expect(count('takt1')).toBe(0);
    edit('2', { key: 'm:2', name: 'Jonas' });
    t += 5 * MIN; // 10 min nach der ersten Änderung
    versions.tick();
    expect(count('takt1')).toBe(1);
    const v1 = versions.list('takt1')[0]!;
    expect(v1.kind).toBe('auto');
    expect(v1.people.map((p) => p.name).sort()).toEqual(['Jonas', 'Mara']);
    expect(v1.objects).toBe(1);
    // ohne Änderung keine neue Version
    t += 30 * MIN;
    versions.tick();
    expect(count('takt1')).toBe(1);
    // Dauerbearbeitung: jede Minute eine Änderung → eine Version je 10 Minuten
    for (let i = 0; i < 30; i++) {
      edit(`d${i}`);
      t += MIN;
      versions.tick();
    }
    expect(count('takt1')).toBe(4);
    // nur noch Lena
    edit('lena', { key: 'm:3', name: 'Lena' });
    t += 10 * MIN;
    versions.tick();
    expect(versions.list('takt1')[0]!.people.map((p) => p.name)).toEqual(expect.arrayContaining(['Lena']));
  });

  it('wenn die letzte Person geht, sofort eine Version (falls geändert)', async () => {
    const doc = setup('takt2');
    sticky(doc, 'a', 'x');
    versions.changed('takt2', { key: 'm:1', name: 'Mara' });
    t += MIN;
    await versions.hooks.onDisconnect!({ documentName: 'board:takt2', document: doc } as never);
    expect(count('takt2')).toBe(1);
    // nochmal gehen ohne Änderung: keine weitere
    await versions.hooks.onDisconnect!({ documentName: 'board:takt2', document: doc } as never);
    expect(count('takt2')).toBe(1);
    // nur gelöscht (ändert den Zustandsvektor nicht): trotzdem eine neue Version
    objects(doc).delete('a');
    versions.changed('takt2');
    await versions.hooks.onDisconnect!({ documentName: 'board:takt2', document: doc } as never);
    expect(count('takt2')).toBe(2);
    expect(versions.list('takt2')[0]!.objects).toBe(0);
  });

  it('beim Laden: alter Stand ohne Version wird gesichert, leeres Board nicht', async () => {
    const doc = setup('takt3');
    await versions.hooks.afterLoadDocument!({ documentName: 'board:takt3', document: doc } as never);
    expect(count('takt3')).toBe(0); // leer
    sticky(doc, 'a', 'alt');
    await versions.hooks.afterLoadDocument!({ documentName: 'board:takt3', document: doc } as never);
    expect(count('takt3')).toBe(1);
    await versions.hooks.afterLoadDocument!({ documentName: 'board:takt3', document: doc } as never);
    expect(count('takt3')).toBe(1);
  });

  it('dünnt beim Speichern aus; benannte Versionen bleiben', () => {
    const doc = setup('takt4');
    for (let i = 0; i < 12; i++) {
      sticky(doc, 'a', `v${i}`);
      versions.changed('takt4');
      t += 10 * MIN;
      versions.tick();
    }
    expect(count('takt4')).toBe(12); // zwei Stunden, alle jünger als 24 h
    const named = versions.list('takt4')[5]!;
    versions.rename('takt4', named.id, 'Plan A');
    t += 3 * DAY;
    sticky(doc, 'a', 'später');
    versions.changed('takt4');
    t += 10 * MIN;
    versions.tick();
    const left = versions.list('takt4');
    // je Stunde eine (2–3 Stunden-Eimer), dazu die benannte und die neue
    expect(left.length).toBeLessThanOrEqual(5);
    expect(left.some((v) => v.name === 'Plan A')).toBe(true);
  });
});

// ---------- HTTP + Live ----------

let env: TestEnv;
const open: Array<{ destroy: () => void }> = [];

function connect(boardId: string, cookie: string) {
  class CookieWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: { cookie } });
    }
  }
  const socket = new HocuspocusProviderWebsocket({ url: env.wsUrl, WebSocketPolyfill: CookieWebSocket, maxAttempts: 1 });
  const doc = new Y.Doc();
  const state = { synced: false };
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `board:${boardId}`, document: doc, onSynced: () => (state.synced = true) });
  provider.attach();
  const handle = {
    doc,
    state,
    destroy: () => {
      provider.destroy();
      socket.destroy();
    },
  };
  open.push(handle);
  return handle;
}

describe('Versionen über HTTP und live', () => {
  beforeAll(async () => {
    env = await startEnv({ versionIntervalMs: 200 });
  });
  afterAll(async () => {
    await env?.stop();
  });
  afterEach(() => {
    while (open.length) open.pop()!.destroy();
  });

  const hasDoc = (id: string) => env.srv.hocuspocus.documents.has(`board:${id}`);

  it('automatische Version, Vorschau-Inhalt, Wiederherstellen: zweiter Client sieht den alten Stand sofort', async () => {
    const mara = await loginMember(env, env.fake.addMember(501, 'Mara'));
    const jonas = await loginAdmin(env);
    const board = (await mara.post('/api/boards', { title: 'Lageplan' })).body.board as { id: string };
    const a = connect(board.id, mara.cookieHeader());
    const b = connect(board.id, jonas.cookieHeader());
    await waitFor(() => a.state.synced && b.state.synced);

    sticky(a.doc, 'bar', 'Bar links');
    await waitFor(async () => (await mara.get(`/api/boards/${board.id}/versions`)).body.versions.length >= 1);
    const [v1] = (await mara.get(`/api/boards/${board.id}/versions`)).body.versions;
    expect(v1.kind).toBe('auto');
    expect(v1.people).toEqual([{ key: 'm:501', name: 'Mara' }]);
    expect(v1.objects).toBe(1);

    // Vorschau: Yjs-Update der Version
    const raw = await fetch(`${env.base}/api/boards/${board.id}/versions/${v1.id}`, { headers: { cookie: mara.cookieHeader(), 'accept-encoding': 'br' } });
    expect(raw.status).toBe(200);
    expect(raw.headers.get('content-encoding')).toBe('br');
    expect(raw.headers.get('cache-control')).toContain('immutable');
    const preview = new Y.Doc();
    Y.applyUpdate(preview, new Uint8Array(await raw.arrayBuffer()));
    expect(textOf(preview, 'bar')).toBe('Bar links');
    const plain = await fetch(`${env.base}/api/boards/${board.id}/versions/${v1.id}`, { headers: { cookie: mara.cookieHeader(), 'accept-encoding': 'identity' } });
    expect(plain.headers.get('content-encoding')).toBeNull();
    const preview2 = new Y.Doc();
    Y.applyUpdate(preview2, new Uint8Array(await plain.arrayBuffer()));
    expect(textOf(preview2, 'bar')).toBe('Bar links');

    // Mara ändert weiter
    a.doc.transact(() => objects(a.doc).get('bar')!.set('text', 'Bar rechts'));
    sticky(a.doc, 'buehne', 'Bühne');
    await waitFor(() => textOf(b.doc, 'bar') === 'Bar rechts' && objects(b.doc).has('buehne'));

    // Jonas stellt Version 1 wieder her → beide sehen den alten Stand
    const res = await jonas.post(`/api/boards/${board.id}/versions/${v1.id}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
    expect(res.body.restored.kind).toBe('restored');
    expect(res.body.restored.by).toEqual({ key: 'a:orga', name: 'orga' });
    expect(res.body.restored.restoredFrom).toBe(v1.createdAt);
    await waitFor(() => textOf(a.doc, 'bar') === 'Bar links' && !objects(a.doc).has('buehne'));
    await waitFor(() => textOf(b.doc, 'bar') === 'Bar links' && !objects(b.doc).has('buehne'));

    // Vorher-Stand gesichert (entweder eigene Sicherung oder die letzte automatische Version)
    const list = (await mara.get(`/api/boards/${board.id}/versions`)).body.versions as { id: string; kind: string; objects: number }[];
    const beforeRestore = res.body.backup ?? list.find((v) => v.kind === 'auto' && v.objects === 2);
    expect(beforeRestore).toBeTruthy();
    const raw2 = await jonas.get(`/api/boards/${board.id}/versions/${(beforeRestore as { id: string }).id}`, { headers: { 'accept-encoding': 'identity' } });
    expect(raw2.status).toBe(200);

    // Marias Client kann normal weiterarbeiten, Änderungen kommen bei Jonas an
    sticky(a.doc, 'kasse', 'Kasse');
    await waitFor(() => objects(b.doc).has('kasse'));

    // gespeichert: neuer Client nach Neuladen sieht den wiederhergestellten Stand
    a.destroy();
    b.destroy();
    await waitFor(() => !hasDoc(board.id));
    const c = connect(board.id, mara.cookieHeader());
    await waitFor(() => c.state.synced && textOf(c.doc, 'bar') === 'Bar links' && objects(c.doc).has('kasse') && !objects(c.doc).has('buehne'));
  });

  it('Version speichern (benannt), umbenennen, Name entfernen; Fehlerfälle', async () => {
    const lena = await loginMember(env, env.fake.addMember(502, 'Lena'));
    const board = (await lena.post('/api/boards', { title: 'Plan' })).body.board as { id: string };
    const a = connect(board.id, lena.cookieHeader());
    await waitFor(() => a.state.synced);
    sticky(a.doc, 'x', 'Erster Entwurf');
    await waitFor(() => env.srv.hocuspocus.documents.get(`board:${board.id}`)?.getMap('objects').size === 1);

    const saved = await lena.post(`/api/boards/${board.id}/versions`, { name: '  Entwurf   1 ' });
    expect(saved.status).toBe(201);
    expect(saved.body.version.name).toBe('Entwurf 1');
    expect(saved.body.version.by).toEqual({ key: 'm:502', name: 'Lena' });

    // gleich nochmal ohne Änderung: benennt die vorhandene unbenannte Version bzw. legt eine neue an – nie doppelt unbenannt
    const renamed = await lena.req('PATCH', `/api/boards/${board.id}/versions/${saved.body.version.id}`, { json: { name: 'Endfassung' } });
    expect(renamed.status).toBe(200);
    expect(renamed.body.version.name).toBe('Endfassung');
    const cleared = await lena.req('PATCH', `/api/boards/${board.id}/versions/${saved.body.version.id}`, { json: { name: '' } });
    expect(cleared.body.version.name).toBeNull();

    expect((await lena.post(`/api/boards/${board.id}/versions`, { name: '' })).status).toBe(400);
    expect((await lena.post(`/api/boards/${board.id}/versions`, { name: 'x'.repeat(121) })).status).toBe(400);
    expect((await lena.req('PATCH', `/api/boards/${board.id}/versions/${saved.body.version.id}`, { json: { name: 5 } })).status).toBe(400);
    expect((await lena.get(`/api/boards/${board.id}/versions/gibtsnicht`)).status).toBe(404);
    expect((await lena.post(`/api/boards/${board.id}/versions/gibtsnicht/restore`)).status).toBe(404);
    expect((await lena.get(`/api/boards/unbekannt/versions`)).status).toBe(404);
    expect((await lena.post(`/api/boards/${board.id}/versions`, { name: 'x' }, { csrf: false })).status).toBe(403);
    const anon = new Browser(env.base);
    expect((await anon.get(`/api/boards/${board.id}/versions`)).status).toBe(401);
    // Versionen eines anderen Boards nicht über dieses Board erreichbar
    const other = (await lena.post('/api/boards', { title: 'Anderes' })).body.board as { id: string };
    expect((await lena.get(`/api/boards/${other.id}/versions/${saved.body.version.id}`)).status).toBe(404);
  });

  it('Wiederherstellen ohne offene Verbindung und Kopie als neues Board', async () => {
    const mara = await loginMember(env, env.fake.addMember(503, 'Mara B'));
    const board = (await mara.post('/api/boards', { title: 'Ablauf' })).body.board as { id: string };
    const a = connect(board.id, mara.cookieHeader());
    await waitFor(() => a.state.synced);
    sticky(a.doc, 'p1', 'Punkt 1');
    await waitFor(() => env.srv.hocuspocus.documents.get(`board:${board.id}`)?.getMap('objects').size === 1);
    const v1 = (await mara.post(`/api/boards/${board.id}/versions`, { name: 'Start' })).body.version as { id: string };
    sticky(a.doc, 'p2', 'Punkt 2');
    await waitFor(() => env.srv.hocuspocus.documents.get(`board:${board.id}`)?.getMap('objects').size === 2);
    a.destroy();
    await waitFor(() => !hasDoc(board.id));
    // beim Verlassen gesichert
    const afterLeave = (await mara.get(`/api/boards/${board.id}/versions`)).body.versions as { objects: number; kind: string }[];
    expect(afterLeave[0]).toMatchObject({ kind: 'auto', objects: 2 });

    // Kopie aus Version 1
    const copy = await mara.post(`/api/boards/${board.id}/versions/${v1.id}/copy`, { title: 'Ablauf (Start)' });
    expect(copy.status).toBe(201);
    expect(copy.body.board.title).toBe('Ablauf (Start)');
    const cc = connect(copy.body.board.id, mara.cookieHeader());
    await waitFor(() => cc.state.synced && objects(cc.doc).size === 1 && textOf(cc.doc, 'p1') === 'Punkt 1');
    cc.destroy();

    // Wiederherstellen, während niemand das Board offen hat
    const res = await mara.post(`/api/boards/${board.id}/versions/${v1.id}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
    await waitFor(() => !hasDoc(board.id));
    const b = connect(board.id, mara.cookieHeader());
    await waitFor(() => b.state.synced && objects(b.doc).size === 1 && textOf(b.doc, 'p1') === 'Punkt 1');
  });
});
