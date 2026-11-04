// Persistenz des Sync-Servers: Herunterfahren mit offenem Speichern (SIGTERM), Neustart mit Wiederverbinden,
// Offline-Änderungen, sehr große Boards.
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/app.js';
import { loginAdmin, startEnv, waitFor, type TestEnv } from './helpers.js';

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

function connect(wsUrl: string, boardId: string, cookie: string, doc = new Y.Doc()) {
  class CookieWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: { cookie } });
    }
  }
  const socket = new HocuspocusProviderWebsocket({ url: wsUrl, WebSocketPolyfill: CookieWebSocket, maxAttempts: 1 });
  const state = { synced: false };
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `board:${boardId}`, document: doc, onSynced: () => (state.synced = true) });
  provider.attach();
  const destroy = () => {
    provider.destroy();
    socket.destroy();
  };
  cleanup.push(destroy);
  return { doc, provider, state, destroy };
}

function addSticky(doc: Y.Doc, id: string, text: string) {
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    for (const [k, v] of Object.entries({ id, type: 'sticky', x: 0, y: 0, w: 200, h: 200, z: 'a0', text })) m.set(k, v);
    doc.getMap('objects').set(id, m);
  });
}

const objectsOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('objects');

/** Gespeicherten Stand eines Boards direkt aus SQLite lesen. */
function stored(srv: App, boardId: string): Y.Doc | null {
  const row = srv.db.prepare('SELECT state FROM documents WHERE name = ?').get(`board:${boardId}`) as { state: Uint8Array } | undefined;
  if (!row) return null;
  const d = new Y.Doc();
  Y.applyUpdate(d, row.state);
  return d;
}

async function setup(debounce: number) {
  const env: TestEnv = await startEnv({ syncDebounceMs: debounce, syncMaxDebounceMs: debounce * 2 });
  cleanup.push(() => env.stop());
  const admin = await loginAdmin(env);
  const board = (await admin.post('/api/boards', { title: 'Persistenz' })).body.board as { id: string };
  return { env, admin, board };
}

/** Zweiter Server auf demselben Datenverzeichnis (= Neustart). */
async function restart(env: TestEnv) {
  await env.srv.close();
  const srv = await buildApp(env.cfg);
  await srv.app.listen({ port: 0, host: '127.0.0.1' });
  cleanup.push(() => srv.close());
  return { srv, wsUrl: `ws://127.0.0.1:${(srv.app.server.address() as AddressInfo).port}/sync` };
}

describe('Persistenz', () => {
  it('Herunterfahren (SIGTERM) speichert Änderungen, deren Speichern noch aussteht', async () => {
    // langer Debounce: ohne Herunterfahren würde vor Testende nichts gespeichert
    const { env, admin, board } = await setup(60_000);
    const c = connect(env.wsUrl, board.id, admin.cookieHeader());
    await waitFor(() => c.state.synced);
    addSticky(c.doc, 'n1', 'kurz vor dem Neustart');
    await waitFor(() => objectsOf(env.srv.hocuspocus.documents.get(`board:${board.id}`)!).has('n1'));
    expect(stored(env.srv, board.id)?.getMap('objects').has('n1') ?? false).toBe(false);
    await env.srv.close();
    // DB ist zu: Datei direkt lesen (wie der nächste Start)
    const db = new DatabaseSync(path.join(env.cfg.dataDir, 'stachel.sqlite'), { readOnly: true });
    const row = db.prepare('SELECT state FROM documents WHERE name = ?').get(`board:${board.id}`) as { state: Uint8Array } | undefined;
    db.close();
    expect(row).toBeDefined();
    const d = new Y.Doc();
    Y.applyUpdate(d, row!.state);
    expect(objectsOf(d).get('n1')?.get('text')).toBe('kurz vor dem Neustart');
  });

  it('während des Herunterfahrens werden neue Verbindungen abgelehnt', async () => {
    const { env, admin } = await setup(50);
    const closing = env.srv.close();
    const status = await new Promise<number | string>((resolve) => {
      const ws = new WebSocket(env.wsUrl, { headers: { cookie: admin.cookieHeader() } });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => resolve('offen'));
      ws.on('error', (e) => resolve(String(e.message)));
    });
    await closing;
    expect(status === 503 || /ECONNREFUSED|socket hang up|ECONNRESET/.test(String(status))).toBe(true);
  });

  it('Neustart während der Bearbeitung: Offline-Änderungen kommen nach dem Wiederverbinden an, nichts geht verloren', async () => {
    const { env, admin, board } = await setup(50);
    const a = connect(env.wsUrl, board.id, admin.cookieHeader());
    await waitFor(() => a.state.synced);
    addSticky(a.doc, 'vorher', 'vor dem Neustart');
    await waitFor(() => objectsOf(env.srv.hocuspocus.documents.get(`board:${board.id}`)!).has('vorher'));
    // Server weg, Client arbeitet offline weiter (gleiches Y.Doc)
    const { srv, wsUrl } = await restart(env);
    a.destroy();
    addSticky(a.doc, 'offline', 'offline geschrieben');
    objectsOf(a.doc).get('vorher')!.set('x', 77);
    // Wiederverbinden mit demselben Doc (wie der Provider nach Reconnect)
    const a2 = connect(wsUrl, board.id, admin.cookieHeader(), a.doc);
    const b = connect(wsUrl, board.id, admin.cookieHeader());
    await waitFor(() => a2.state.synced && b.state.synced);
    await waitFor(() => objectsOf(b.doc).has('offline') && objectsOf(b.doc).get('vorher')?.get('x') === 77);
    // und gespeichert
    await waitFor(() => objectsOf(stored(srv, board.id)!).has('offline'));
  });

  it('sehr großes Board (5000 Objekte) wird gespeichert und von einem neuen Client vollständig geladen', async () => {
    const { env, admin, board } = await setup(50);
    const a = connect(env.wsUrl, board.id, admin.cookieHeader());
    await waitFor(() => a.state.synced);
    a.doc.transact(() => {
      for (let i = 0; i < 5000; i++) {
        const m = new Y.Map<unknown>();
        for (const [k, v] of Object.entries({ id: `o${i}`, type: 'sticky', x: i * 3, y: i, w: 200, h: 200, z: `a${i}`, text: `Notiz ${i} `.repeat(8) })) m.set(k, v);
        objectsOf(a.doc).set(`o${i}`, m);
      }
    });
    await waitFor(() => (stored(env.srv, board.id)?.getMap('objects').size ?? 0) === 5000, 15_000);
    a.destroy();
    await waitFor(() => !env.srv.hocuspocus.documents.has(`board:${board.id}`));
    const b = connect(env.wsUrl, board.id, admin.cookieHeader());
    await waitFor(() => b.state.synced, 15_000);
    expect(objectsOf(b.doc).size).toBe(5000);
    expect(objectsOf(b.doc).get('o4999')?.get('text')).toContain('Notiz 4999');
  }, 30_000);
});
