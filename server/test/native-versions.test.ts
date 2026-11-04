// Versions-Vorschau der Org-App (docs/contract.md §8.14, Audit N03): `GET /api/native/v1/boards/:id/versions/:vid/snapshot`
// liefert den Inhalt einer Version als Objekt-JSON wie `welcome.snapshot` – dieselben Objekte und Feature-Strukturen, die
// eine App beim Verbinden mit genau diesem Stand bekommen hätte. Das Live-Board bleibt unverändert.
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loginMember, startEnv, waitFor, type TestEnv } from './helpers.js';
import { appSession, NativeClient, webClient } from './native-client.js';
import { versionSnapshot } from '../src/native/version-snapshot.js';

let env: TestEnv;
let ws: string;
beforeAll(async () => {
  // Sandbox-Schalter: der Seed schreibt einen Kommentar von „Jonas“ über Maras Verbindung (sync.ts, SEC-06)
  env = await startEnv({ nativeIdleMs: 300, nativeBufferMax: 50, nativeDevActions: true });
  ws = env.base.replace('http', 'ws');
});
afterAll(async () => {
  await env?.stop();
});
const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

let memberId = 2600;
async function person(name: string) {
  const kt = env.fake.addMember(++memberId, name);
  const browser = await loginMember(env, kt);
  const { token, user } = await appSession(env.base, kt);
  return { kt, browser, token, user };
}

const snapshotPath = (board: string, vid: string) => `/api/native/v1/boards/${board}/versions/${vid}/snapshot`;

async function get(token: string | null, path: string) {
  const res = await fetch(`${env.base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, body: (await res.json()) as any };
}

function addObject(w: ReturnType<typeof webClient>, id: string, fields: Record<string, unknown>) {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(fields)) m.set(k, v);
  w.objects.set(id, m);
}

async function setup() {
  const mara = await person('Mara');
  const board = (await mara.browser.post('/api/boards', { title: 'Versionen' })).body.board as { id: string; title: string };
  const w = webClient(ws, board.id, { cookie: mara.browser.cookieHeader() });
  cleanup.push(() => w.destroy());
  await w.synced();
  return { mara, board, w };
}

describe('Versions-Vorschau für die App', () => {
  it('liefert die Objekte und Feature-Strukturen der Version wie welcome.snapshot; das Live-Board bleibt', async () => {
    const { mara, board, w } = await setup();
    w.doc.transact(() => {
      addObject(w, 'f1', { type: 'frame', x: 0, y: 0, w: 640, h: 420, z: 'a0', title: 'Rahmen 1' });
      addObject(w, 'n1', { type: 'sticky', x: 100, y: 50, w: 200, h: 200, z: 'a1', text: 'Bühne', color: '#fff27a' });
      addObject(w, 'n2', { type: 'sticky', x: 400, y: 50, w: 200, h: 200, z: 'a2', text: 'Strom' });
      const desc = new Y.Text('Kabel ziehen');
      const card = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({ type: 'card', x: 0, y: 300, w: 300, h: 96, z: 'a3', text: 'Aufbau' })) card.set(k, v);
      card.set('desc', desc);
      w.objects.set('c1', card);
      const thread = new Y.Map<unknown>();
      thread.set('x', 10);
      thread.set('y', 20);
      w.doc.getMap('collab.comments').set('t1', thread);
    });
    await w.flushed();
    const saved = await mara.browser.post(`/api/boards/${board.id}/versions`, { name: 'Vor dem Treffen' });
    expect(saved.status).toBe(201);
    const vid = saved.body.version.id as string;

    // danach ändert sich das Live-Board
    w.doc.transact(() => {
      w.objects.delete('n2');
      (w.objects.get('n1') as Y.Map<unknown>).set('text', 'Bühne neu');
      addObject(w, 'n3', { type: 'sticky', x: 800, y: 50, w: 200, h: 200, z: 'a4', text: 'Neu' });
    });
    await w.flushed();

    const res = await get(mara.token, snapshotPath(board.id, vid));
    expect(res.status).toBe(200);
    expect(res.body.board).toEqual({ id: board.id, title: 'Versionen' });
    expect(res.body.version).toMatchObject({ id: vid, kind: 'manual', name: 'Vor dem Treffen', objects: 4 });
    expect(res.body.below).toEqual(['frame']);
    const objects = res.body.snapshot.objects as { id: string; text?: string; desc?: unknown }[];
    // Zeichenreihenfolge: Rahmen zuerst, dann z
    expect(objects.map((o) => o.id)).toEqual(['f1', 'n1', 'n2', 'c1']);
    expect(objects[1]).toMatchObject({ type: 'sticky', text: 'Bühne', color: '#fff27a', x: 100 });
    // Y-Felder über die Codecs (Y.Text → String)
    expect(objects[3]!.desc).toBe('Kabel ziehen');
    expect(res.body.snapshot.ext['collab.comments']).toEqual({ t1: { x: 10, y: 20 } });

    // gleich dem, was eine App beim Verbinden mit diesem Stand bekäme
    const a = new NativeClient(ws, mara.token);
    cleanup.push(() => a.close());
    const welcome = await a.hello(board.id, { want: ['ext'] });
    const live = welcome.snapshot.objects as { id: string; text?: string }[];
    expect(live.map((o) => o.id)).toEqual(['f1', 'n1', 'c1', 'n3']);
    expect(live[1]!.text).toBe('Bühne neu');
    // Live-Board unverändert durch die Vorschau
    expect(w.objects.has('n2')).toBe(false);
  });

  it('Serialisierung = Spiegel: gleiches Dokument → gleiche Objekte wie der Schnappschuss der App', async () => {
    const doc = new Y.Doc();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    doc.transact(() => {
      for (const [id, z] of [['b', 'a1'], ['a', 'a1'], ['f', 'zz']] as const) {
        const m = new Y.Map<unknown>();
        m.set('type', id === 'f' ? 'frame' : 'sticky');
        m.set('z', z);
        objects.set(id, m);
      }
      const broken = new Y.Map<unknown>();
      broken.set('x', 1); // ohne type: weglassen wie das Web
      objects.set('x', broken);
    });
    const snap = versionSnapshot(Y.encodeStateAsUpdate(doc));
    expect(snap.objects.map((o) => o.id)).toEqual(['f', 'a', 'b']);
    expect(snap.ext).toEqual({});
    doc.destroy();
  });

  it('Fehler: ohne Sitzung 401, unbekannte Version/Board 404, Board im Papierkorb 404', async () => {
    const { mara, board, w } = await setup();
    addObject(w, 'n1', { type: 'sticky', x: 0, y: 0, z: 'a0', text: 'x' });
    await w.flushed();
    const vid = (await mara.browser.post(`/api/boards/${board.id}/versions`, { name: 'Eins' })).body.version.id as string;
    expect((await get(null, snapshotPath(board.id, vid))).status).toBe(401);
    expect((await get(mara.token, snapshotPath(board.id, 'gibtsnicht'))).body.error).toBe('not_found');
    expect((await get(mara.token, snapshotPath(board.id, '../x'))).status).toBe(404);
    expect((await get(mara.token, snapshotPath('nichtda', vid))).status).toBe(404);
    // Version eines anderen Boards zählt nicht
    const other = (await mara.browser.post('/api/boards', { title: 'Anderes' })).body.board as { id: string };
    expect((await get(mara.token, snapshotPath(other.id, vid))).status).toBe(404);
    // Cookie-Sitzung geht auch
    expect((await mara.browser.get(snapshotPath(board.id, vid))).status).toBe(200);
    expect((await mara.browser.req('DELETE', `/api/boards/${board.id}`)).status).toBe(200);
    await waitFor(async () => (await get(mara.token, snapshotPath(board.id, vid))).status === 404);
  });

  it('KI-Zugang aus der App (Audit B13): die App-Sitzung darf Tokens anlegen, auflisten und widerrufen', async () => {
    const mara = await person('Mara');
    const call = (method: string, path: string, body?: unknown) =>
      fetch(`${env.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${mara.token}`, 'X-Stachel': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));
    const made = await call('POST', '/api/tokens', { label: 'Claude am Laptop' });
    expect(made.status).toBe(201);
    expect(made.body.secret).toMatch(/^stk_/);
    expect(made.body.mcpUrl).toMatch(/\/mcp$/);
    const list = await call('GET', '/api/tokens');
    expect(list.body.tokens.map((t: { label: string }) => t.label)).toEqual(['Claude am Laptop']);
    expect((await call('DELETE', `/api/tokens/${made.body.token.id}`)).status).toBe(200);
    expect((await call('GET', '/api/tokens')).body.tokens).toEqual([]);
  });
});
