import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Browser, loginAdmin, loginMember, startEnv, waitFor, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  await env?.stop();
});

const open: Array<{ destroy: () => void }> = [];
afterEach(() => {
  while (open.length) open.pop()!.destroy();
});

/** Provider wie im Browser, nur mit Cookie-Header über ws (Node hat kein Cookie-Jar). */
function connect(boardId: string, cookie: string | null, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extraHeaders };
  if (cookie) headers.cookie = cookie;
  class CookieWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers });
    }
  }
  const socket = new HocuspocusProviderWebsocket({ url: env.wsUrl, WebSocketPolyfill: CookieWebSocket, maxAttempts: 1 });
  const doc = new Y.Doc();
  const state = { synced: false, failed: null as string | null };
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: `board:${boardId}`,
    document: doc,
    onSynced: () => {
      state.synced = true;
    },
    onAuthenticationFailed: ({ reason }) => {
      state.failed = reason;
    },
  });
  provider.attach();
  const handle = {
    doc,
    provider,
    state,
    destroy: () => {
      provider.destroy();
      socket.destroy();
    },
  };
  open.push(handle);
  return handle;
}

async function newBoard(b: Browser, title = 'Sync') {
  return (await b.post('/api/boards', { title })).body.board as { id: string; updatedAt: string };
}

describe('Echtzeit-Sync (Hocuspocus)', () => {
  it('zwei Clients sehen Änderungen des anderen live, Persistenz in SQLite, updated_at gesetzt', async () => {
    const anna = await loginMember(env, env.fake.addMember(301, 'Anna'));
    const ben = await loginAdmin(env);
    const board = await newBoard(anna);

    const a = connect(board.id, anna.cookieHeader());
    const b = connect(board.id, ben.cookieHeader());
    await waitFor(() => a.state.synced && b.state.synced);

    const objectsB = b.doc.getMap<Y.Map<unknown>>('objects');
    a.doc.transact(() => {
      const o = new Y.Map<unknown>();
      o.set('id', 'n1');
      o.set('type', 'sticky');
      o.set('x', 10);
      o.set('y', 20);
      o.set('text', 'Bühne aufbauen');
      a.doc.getMap('objects').set('n1', o);
    });
    await waitFor(() => objectsB.has('n1'));
    expect(objectsB.get('n1')!.get('text')).toBe('Bühne aufbauen');

    // Gegenrichtung
    objectsB.get('n1')!.set('text', 'Bühne abbauen');
    await waitFor(() => a.doc.getMap<Y.Map<unknown>>('objects').get('n1')?.get('text') === 'Bühne abbauen');

    // Gespeichert (debounced) + updated_at des Boards gesetzt
    await waitFor(() => Boolean(env.srv.db.prepare('SELECT 1 FROM documents WHERE name = ?').get(`board:${board.id}`)));
    await waitFor(() => {
      const row = env.srv.db.prepare('SELECT updated_at FROM boards WHERE id = ?').get(board.id) as { updated_at: string };
      return row.updated_at > board.updatedAt;
    });
    const listed = (await anna.get('/api/boards')).body.boards[0];
    expect(listed.id).toBe(board.id);

    // Nach Trennen aller Clients: neuer Client lädt den Stand aus der DB
    a.destroy();
    b.destroy();
    await waitFor(() => !hasDoc(board.id));
    const c = connect(board.id, anna.cookieHeader());
    await waitFor(() => c.state.synced);
    await waitFor(() => c.doc.getMap<Y.Map<unknown>>('objects').get('n1')?.get('text') === 'Bühne abbauen');
  });

  it('Awareness (Live-Cursor) kommt beim anderen Client an', async () => {
    const u1 = await loginAdmin(env);
    const u2 = await loginMember(env, env.fake.addMember(302, 'Cleo'));
    const board = await newBoard(u1, 'Cursor');
    const a = connect(board.id, u1.cookieHeader());
    const b = connect(board.id, u2.cookieHeader());
    await waitFor(() => a.state.synced && b.state.synced);
    a.provider.setAwarenessField('user', { key: 'a:orga', name: 'orga', color: '#ec4e92' });
    a.provider.setAwarenessField('cursor', { x: 5, y: 6 });
    await waitFor(() =>
      [...b.provider.awareness!.getStates().values()].some((s) => (s as { cursor?: { x: number } }).cursor?.x === 5),
    );
  });

  it('ohne Sitzung → Verbindung abgelehnt (not_logged_in), keine Daten', async () => {
    const admin = await loginAdmin(env);
    const board = await newBoard(admin, 'Geheim');
    const writer = connect(board.id, admin.cookieHeader());
    await waitFor(() => writer.state.synced);
    writer.doc.getMap('objects').set('x', new Y.Map());

    const anon = connect(board.id, null);
    await waitFor(() => anon.state.failed !== null);
    expect(anon.state.failed).toBe('not_logged_in');
    expect(anon.state.synced).toBe(false);
    expect(anon.doc.getMap('objects').size).toBe(0);

    const forged = connect(board.id, 'stachel_session=erfunden');
    await waitFor(() => forged.state.failed !== null);
    expect(forged.state.failed).toBe('not_logged_in');
  });

  it('unbekanntes Board → abgelehnt (unknown_board)', async () => {
    const admin = await loginAdmin(env);
    const c = connect('gibtsnicht', admin.cookieHeader());
    await waitFor(() => c.state.failed !== null);
    expect(c.state.failed).toBe('unknown_board');
  });

  it('Nachprüfung beim Connect: widerrufenes Token → abgelehnt', async () => {
    const token = env.fake.addMember(303, 'Dora');
    const dora = await loginMember(env, token);
    const board = await newBoard(dora, 'Dora');
    env.srv.sessions.setVerifiedAt(dora.cookies.get('stachel_session')!, new Date(Date.now() - 7 * 3600_000).toISOString());
    env.fake.revoke(token);
    const c = connect(board.id, dora.cookieHeader());
    await waitFor(() => c.state.failed !== null);
    expect(c.state.failed).toBe('not_logged_in');
  });

  it('Board gelöscht → verbundene Clients werden getrennt und nicht wieder zugelassen', async () => {
    const admin = await loginAdmin(env);
    const board = await newBoard(admin, 'Kurzlebig');
    const c = connect(board.id, admin.cookieHeader());
    await waitFor(() => c.state.synced);
    expect((await admin.req('DELETE', `/api/boards/${board.id}`)).status).toBe(200);
    await waitFor(() => !hasDoc(board.id));
    expect(env.srv.db.prepare('SELECT 1 FROM documents WHERE name = ?').get(`board:${board.id}`)).toBeUndefined();
  });

  it('fremder Origin → Upgrade 403; falscher Pfad → 404', async () => {
    const admin = await loginAdmin(env);
    const status = (url: string, headers: Record<string, string>) =>
      new Promise<number>((resolve) => {
        const ws = new WebSocket(url, { headers });
        ws.on('unexpected-response', (_req, res) => {
          resolve(res.statusCode ?? 0);
          ws.terminate();
        });
        ws.on('open', () => {
          resolve(101);
          ws.close();
        });
        ws.on('error', () => resolve(-1));
      });
    expect(await status(env.wsUrl, { cookie: admin.cookieHeader(), origin: 'https://evil.example' })).toBe(403);
    expect(await status(env.wsUrl, { cookie: admin.cookieHeader(), origin: 'https://stachel.example.test' })).toBe(101);
    expect(await status(env.wsUrl.replace('/sync', '/anders'), { cookie: admin.cookieHeader() })).toBe(404);
  });
});

function hasDoc(boardId: string): boolean {
  return env.srv.hocuspocus.documents.has(`board:${boardId}`);
}
