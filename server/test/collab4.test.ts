// Runde 4 (Zusammenarbeit): Board gelöscht/umbenannt live an offene Editoren, Live-Übersicht (SSE), Favoriten und
// „zuletzt geöffnet“, Login-Limit nur für Fehlversuche, App-Links.
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Browser, loginAdmin, loginMember, startEnv, waitFor, type TestEnv } from './helpers.js';
import { assetLinksJson } from '../src/well-known.js';
import { loadConfig } from '../src/config.js';

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

function connect(boardId: string, cookie: string) {
  class CookieWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: { cookie } });
    }
  }
  const socket = new HocuspocusProviderWebsocket({ url: env.wsUrl, WebSocketPolyfill: CookieWebSocket, maxAttempts: 3, delay: 50, minDelay: 50 });
  const state = { synced: false, failed: null as string | null, stateless: [] as any[], closed: [] as number[] };
  socket.on('close', ({ event }: { event: { code: number } }) => state.closed.push(event.code));
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: `board:${boardId}`,
    document: new Y.Doc(),
    onSynced: () => {
      state.synced = true;
    },
    onAuthenticationFailed: ({ reason }) => {
      state.failed = reason;
    },
    onStateless: ({ payload }) => {
      state.stateless.push(JSON.parse(payload));
    },
  });
  provider.attach();
  const handle = {
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

const newBoard = async (b: Browser, title = 'Board') => (await b.post('/api/boards', { title })).body.board as { id: string; title: string };

/** Liest Server-Sent Events von /api/boards/events mit (bis `stop`). */
async function listen(b: Browser) {
  const ctrl = new AbortController();
  const res = await fetch(`${env.base}/api/boards/events`, { headers: { cookie: b.cookieHeader() }, signal: ctrl.signal });
  const events: any[] = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const line of chunk.split('\n')) if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
        }
      }
    } catch {
      // abgebrochen
    }
  })();
  return { res, events, stop: () => ctrl.abort() };
}

describe('Board gelöscht, während andere es offen haben (B1)', () => {
  it('offene Editoren bekommen board.deleted mit Namen, werden getrennt und beim Wiederverbinden mit board_deleted abgelehnt', async () => {
    const admin = await loginAdmin(env);
    const jonas = await loginMember(env, env.fake.addMember(401, 'Jonas'));
    const board = await newBoard(admin, 'Weg damit');
    const c = connect(board.id, jonas.cookieHeader());
    await waitFor(() => c.state.synced);

    expect((await admin.req('DELETE', `/api/boards/${board.id}`)).status).toBe(200);
    await waitFor(() => c.state.stateless.length > 0);
    expect(c.state.stateless[0]).toEqual({ type: 'board.deleted', by: 'orga', byKey: 'a:orga' });
    // Socket wirklich zu (nicht nur das Dokument), danach verbindet der Provider neu und wird abgelehnt
    await waitFor(() => c.state.closed.includes(4404));
    await waitFor(() => c.state.failed !== null);
    expect(c.state.failed).toBe('board_deleted');
    expect(env.srv.trash.isTrashed(board.id)).toBe(true);
  });

  it('nie existierendes Board bleibt unknown_board', async () => {
    const admin = await loginAdmin(env);
    const c = connect('gibtsnicht42', admin.cookieHeader());
    await waitFor(() => c.state.failed !== null);
    expect(c.state.failed).toBe('unknown_board');
  });
});

describe('Verbindungsprüfung (B4)', () => {
  it('Stateless-ping wird nur dem Fragenden mit pong beantwortet', async () => {
    const admin = await loginAdmin(env);
    const board = await newBoard(admin, 'Ping');
    const a = connect(board.id, admin.cookieHeader());
    const b = connect(board.id, admin.cookieHeader());
    await waitFor(() => a.state.synced && b.state.synced);
    a.provider.sendStateless(JSON.stringify({ type: 'ping' }));
    a.provider.sendStateless('kein json "ping"');
    await waitFor(() => a.state.stateless.length > 0);
    await new Promise((r) => setTimeout(r, 150));
    expect(a.state.stateless).toEqual([{ type: 'pong' }]);
    expect(b.state.stateless).toEqual([]);
  });
});

describe('Board-Titel live (B8)', () => {
  it('Umbenennen erreicht offene Editoren; gleichzeitiges Umbenennen: höchste titleSeq = Stand des Servers', async () => {
    const admin = await loginAdmin(env);
    const board = await newBoard(admin, 'Alt');
    const c = connect(board.id, admin.cookieHeader());
    await waitFor(() => c.state.synced);
    const [r1, r2] = await Promise.all([
      admin.req('PATCH', `/api/boards/${board.id}`, { json: { title: 'Von Mara' } }),
      admin.req('PATCH', `/api/boards/${board.id}`, { json: { title: 'Von Jonas' } }),
    ]);
    expect(r1.body.board.titleSeq).toBeTypeOf('number');
    expect(r2.body.board.titleSeq).not.toBe(r1.body.board.titleSeq);
    await waitFor(() => c.state.stateless.length === 2);
    const winner = [r1.body.board, r2.body.board].sort((a, b) => b.titleSeq - a.titleSeq)[0];
    const last = [...c.state.stateless].sort((a, b) => b.titleSeq - a.titleSeq)[0];
    expect(last).toEqual({ type: 'board.renamed', title: winner.title, titleSeq: winner.titleSeq });
    const list = (await admin.get('/api/boards')).body.boards as { id: string; title: string }[];
    expect(list.find((b) => b.id === board.id)!.title).toBe(winner.title);
  });
});

describe('Live-Übersicht (SSE /api/boards/events)', () => {
  it('ohne Sitzung 401', async () => {
    const res = await fetch(`${env.base}/api/boards/events`);
    expect(res.status).toBe(401);
  });

  it('meldet Anlegen, Umbenennen, Duplizieren, Speichern (gedrosselt) und Löschen', async () => {
    const admin = await loginAdmin(env);
    const l = await listen(admin);
    try {
      expect(l.res.status).toBe(200);
      expect(l.res.headers.get('content-type')).toContain('text/event-stream');
      expect(l.res.headers.get('x-accel-buffering')).toBe('no');
      const b = await newBoard(admin, 'Live');
      await admin.req('PATCH', `/api/boards/${b.id}`, { json: { title: 'Live 2' } });
      const copy = (await admin.post(`/api/boards/${b.id}/duplicate`, {})).body.board;
      // Inhalt speichern → updated
      const c = connect(b.id, admin.cookieHeader());
      await waitFor(() => c.state.synced);
      (c.provider.document as Y.Doc).getMap('objects').set('x', new Y.Map());
      await waitFor(() => l.events.some((e) => e.type === 'updated' && e.id === b.id));
      await admin.req('DELETE', `/api/boards/${b.id}`);
      await waitFor(() => l.events.some((e) => e.type === 'deleted'));
      const types = l.events.map((e) => `${e.type}:${e.id === b.id ? 'b' : e.id === copy.id ? 'copy' : '?'}`);
      expect(types).toEqual(['created:b', 'renamed:b', 'created:copy', 'updated:b', 'deleted:b']);
      expect(l.events.find((e) => e.type === 'renamed')).toMatchObject({ title: 'Live 2' });
      expect(l.events.find((e) => e.type === 'deleted')).toMatchObject({ by: 'orga', byKey: 'a:orga' });
    } finally {
      l.stop();
    }
  });
});

describe('Favoriten und zuletzt geöffnet', () => {
  it('je Person: Stern setzen/entfernen, openedAt nach dem Öffnen im Editor; verschwindet mit dem Board', async () => {
    const admin = await loginAdmin(env);
    const eva = await loginMember(env, env.fake.addMember(402, 'Eva'));
    const b = await newBoard(admin, 'Fav');
    const find = async (who: Browser) => ((await who.get('/api/boards')).body.boards as any[]).find((x) => x.id === b.id);
    expect(await find(admin)).not.toHaveProperty('favorite');
    expect((await admin.req('PUT', `/api/boards/${b.id}/favorite`)).body).toEqual({ ok: true, favorite: true });
    expect((await admin.req('PUT', `/api/boards/${b.id}/favorite`)).status).toBe(200); // doppelt ist harmlos
    expect((await find(admin)).favorite).toBe(true);
    expect(await find(eva)).not.toHaveProperty('favorite');
    // CSRF wie alle Änderungen
    expect((await admin.req('DELETE', `/api/boards/${b.id}/favorite`, { csrf: false })).status).toBe(403);
    expect((await admin.req('DELETE', `/api/boards/${b.id}/favorite`)).body.favorite).toBe(false);
    expect(await find(admin)).not.toHaveProperty('favorite');
    expect((await admin.req('PUT', '/api/boards/gibtsnicht/favorite')).status).toBe(404);

    expect(await find(eva)).not.toHaveProperty('openedAt');
    const c = connect(b.id, eva.cookieHeader());
    await waitFor(() => c.state.synced);
    const opened = (await find(eva)).openedAt;
    expect(Date.now() - Date.parse(opened)).toBeLessThan(10_000);
    expect(await find(admin)).not.toHaveProperty('openedAt');

    await admin.req('PUT', `/api/boards/${b.id}/favorite`);
    await admin.req('DELETE', `/api/boards/${b.id}`);
    // im Papierkorb bleiben Stern und Besuch (Wiederherstellen ist vollständig), endgültig gelöscht verschwinden sie
    expect(env.srv.db.prepare('SELECT COUNT(*) AS n FROM board_favorites WHERE board_id = ?').get(b.id)).toEqual({ n: 1 });
    await admin.req('DELETE', `/api/trash/${b.id}`);
    expect(env.srv.db.prepare('SELECT COUNT(*) AS n FROM board_favorites WHERE board_id = ?').get(b.id)).toEqual({ n: 0 });
    expect(env.srv.db.prepare('SELECT COUNT(*) AS n FROM board_visits WHERE board_id = ?').get(b.id)).toEqual({ n: 0 });
  });
});

describe('Passwort-Login: Limit je IP zählt nur Fehlversuche', () => {
  it('9 Fehlversuche + viele erfolgreiche Anmeldungen (Orga-WLAN) → niemand ausgesperrt; 10. Fehlversuch sperrt', async () => {
    const own = await startEnv();
    try {
      const b = new Browser(own.base);
      for (let i = 0; i < 9; i++) expect((await b.post('/api/auth/password', { username: `u${i}`, password: 'falsch' })).status).toBe(401);
      for (let i = 0; i < 15; i++) expect((await new Browser(own.base).post('/api/auth/password', { username: 'orga', password: 'geheim' })).status).toBe(200);
      expect((await b.post('/api/auth/password', { username: 'u9', password: 'falsch' })).status).toBe(401);
      const r = await new Browser(own.base).post('/api/auth/password', { username: 'orga', password: 'geheim' });
      expect(r.status).toBe(429);
    } finally {
      await own.stop();
    }
  });

  it('Flutbremse: mehr als 60 Anmeldungen je 5 min und IP → 429, auch mit richtigem Passwort', async () => {
    const own = await startEnv();
    try {
      for (let i = 0; i < 60; i++) expect((await new Browser(own.base).post('/api/auth/password', { username: 'orga', password: 'geheim' })).status).toBe(200);
      const r = await new Browser(own.base).post('/api/auth/password', { username: 'orga', password: 'geheim' });
      expect(r.status).toBe(429);
      expect(own.fake.calls.login).toBe(60);
    } finally {
      await own.stop();
    }
  });
});

describe('App-Links der Org-App (/.well-known)', () => {
  const FP = 'BC:50:0A:DC:D5:59:8F:CA:24:07:80:D5:5A:7B:2A:00:98:4F:72:B4:3B:23:7D:B1:C7:AB:FC:BD:94:81:44:AC';

  it('assetlinks.json: ohne STACHEL_ANDROID_CERT_SHA256 404', async () => {
    expect((await fetch(`${env.base}/.well-known/assetlinks.json`)).status).toBe(404);
  });

  it('assetlinks.json aus der Umgebung: Paket der Org-App, gültige Fingerabdrücke, ohne Sitzung/Weiterleitung', async () => {
    const cfg = loadConfig({ STACHEL_ANDROID_PACKAGE: 'org.example.app', STACHEL_ANDROID_CERT_SHA256: ` ${FP.toLowerCase()}, kaputt ,${FP}` });
    expect(cfg.androidPackage).toBe('org.example.app');
    const own = await startEnv({ androidPackage: cfg.androidPackage, androidSha256: cfg.androidSha256 });
    try {
      const res = await fetch(`${own.base}/.well-known/assetlinks.json`, { redirect: 'manual' });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('cache-control')).toBe('public, max-age=300');
      expect(await res.json()).toEqual([
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: { namespace: 'android_app', package_name: 'org.example.app', sha256_cert_fingerprints: [FP] },
        },
      ]);
    } finally {
      await own.stop();
    }
  });

  it('nur ungültige Fingerabdrücke → keine App-Links', () => {
    expect(assetLinksJson({ androidPackage: 'a.b', androidSha256: ['AB:CD'] })).toBeNull();
  });

  it('apple-app-site-association: Universal Links für /qr/* und /b/*', async () => {
    const res = await fetch(`${env.base}/.well-known/apple-app-site-association`, { redirect: 'manual' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      applinks: { details: [{ appIDs: ['TEAMID1234.org.example.app'], components: [{ '/': '/qr/*' }, { '/': '/b/*' }] }] },
    });
  });

  it('/b/<id> leitet auf /?b=<id> um; ungültige IDs → 404-Seite', async () => {
    const res = await fetch(`${env.base}/b/abc_DEF-12`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?b=abc_DEF-12');
    // Objekt-Link der App: o bleibt, nur im ID-Format
    const obj = await fetch(`${env.base}/b/abc?o=n_8f-1`, { redirect: 'manual' });
    expect(obj.headers.get('location')).toBe('/?b=abc&o=n_8f-1');
    const badObj = await fetch(`${env.base}/b/abc?o=${encodeURIComponent('x"><y')}`, { redirect: 'manual' });
    expect(badObj.headers.get('location')).toBe('/?b=abc');
    const bad = await fetch(`${env.base}/b/${encodeURIComponent('a b<x>')}`, { redirect: 'manual' });
    expect(bad.status).toBe(404);
    expect(await bad.text()).toContain('nicht gefunden');
  });
});

describe('QR-Hinweisseite', () => {
  it('?handy=1 erklärt, dass die App sich nicht geöffnet hat, und führt zur Anmeldung im Browser', async () => {
    const html = await (await fetch(`${env.base}/qr/abc?handy=1`)).text();
    expect(html).toContain('nicht geöffnet');
    expect(html).toContain('href="/"');
    expect(html).toContain('Im Browser anmelden');
    const plain = await (await fetch(`${env.base}/qr/abc`)).text();
    expect(plain).toContain('in der Organisation-App');
  });
});
