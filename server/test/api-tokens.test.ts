// Persönliche API-Tokens für KI-Assistenten (api-tokens.ts): anlegen, nutzen (HTTP + Sync), widerrufen, Nachprüfung.
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Browser, loginMember, startEnv, waitFor, type TestEnv } from './helpers.js';

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

function connect(boardId: string, headers: Record<string, string>) {
  class HeaderWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers });
    }
  }
  const socket = new HocuspocusProviderWebsocket({ url: env.wsUrl, WebSocketPolyfill: HeaderWebSocket, maxAttempts: 1 });
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const state = { synced: false, failed: null as string | null, closed: false };
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: `board:${boardId}`,
    document: doc,
    awareness,
    onSynced: () => {
      state.synced = true;
    },
    onAuthenticationFailed: ({ reason }) => {
      state.failed = reason;
    },
    onClose: () => {
      state.closed = true;
    },
  });
  provider.attach();
  const h = {
    doc,
    provider,
    awareness,
    state,
    destroy: () => {
      provider.destroy();
      socket.destroy();
    },
  };
  open.push(h);
  return h;
}

const bearer = (secret: string) => ({ Authorization: `Bearer ${secret}` });

async function newToken(b: Browser, label = 'Claude Code') {
  const res = await b.post('/api/tokens', { label });
  expect(res.status).toBe(201);
  return res.body as { token: { id: string; label: string; hint: string }; secret: string; mcpUrl: string };
}

describe('API-Tokens (KI-Zugang)', () => {
  it('anlegen, auflisten (ohne Geheimnis), mit Bearer Boards lesen und anlegen', async () => {
    const mara = await loginMember(env, env.fake.addMember(501, 'Mara'));
    const created = await newToken(mara);
    expect(created.secret).toMatch(/^stk_[A-Za-z0-9_-]{40,}$/);
    expect(created.token.hint).toBe(created.secret.slice(-4));
    expect(created.mcpUrl).toBe('https://stachel.example.test/mcp');

    const list = await mara.get('/api/tokens');
    expect(list.body.tokens).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(created.secret);

    // Token-Nutzung ohne Cookie
    const bot = new Browser(env.base);
    const me = await bot.get('/api/tokens/me', { headers: bearer(created.secret) });
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ key: 'm:501', name: 'Mara' });
    expect(me.body.ai).toMatchObject({ key: 'ai:m:501', name: 'KI (für Mara)' });
    const made = await bot.req('POST', '/api/boards', { json: { title: 'Von der KI' }, headers: bearer(created.secret) });
    expect(made.status).toBe(201);
    expect(made.body.board.createdBy).toBe('m:501');
    const boards = await bot.get('/api/boards', { headers: bearer(created.secret) });
    expect(boards.body.boards.some((b: { id: string }) => b.id === made.body.board.id)).toBe(true);

    // falsches Token / fremdes Schema
    expect((await bot.get('/api/boards', { headers: bearer('stk_falschfalschfalschfalsch') })).status).toBe(401);
    expect((await bot.get('/api/boards', { headers: { Authorization: 'Bearer member-1-xyz' } })).status).toBe(401);

    // Ein Token kann keine Tokens verwalten
    const viaToken = await bot.req('POST', '/api/tokens', { json: { label: 'x' }, headers: bearer(created.secret) });
    expect(viaToken.status).toBe(403);
    expect((await bot.get('/api/tokens', { headers: bearer(created.secret) })).status).toBe(403);
    // /me nur mit Token
    expect((await mara.get('/api/tokens/me')).status).toBe(400);
  });

  it('Eingaben prüfen: Name zu lang, kein Text', async () => {
    const lena = await loginMember(env, env.fake.addMember(502, 'Lena'));
    expect((await lena.post('/api/tokens', { label: 'x'.repeat(61) })).status).toBe(400);
    expect((await lena.post('/api/tokens', { label: 42 })).status).toBe(400);
    const ok = await lena.post('/api/tokens', {});
    expect(ok.body.token.label).toBe('KI-Assistent');
  });

  it('Sync mit Token: Assistent erscheint als „KI (für …)“, Änderungen live; Widerrufen trennt und sperrt', async () => {
    const tokenOfJonas = env.fake.addMember(503, 'Jonas');
    const jonas = await loginMember(env, tokenOfJonas);
    const board = (await jonas.post('/api/boards', { title: 'KI-Board' })).body.board as { id: string };
    const { token, secret } = await newToken(jonas);

    const human = connect(board.id, { cookie: jonas.cookieHeader() });
    const ai = connect(board.id, bearer(secret));
    await waitFor(() => human.state.synced && ai.state.synced);

    // Awareness mit KI-Identität wird angenommen und verteilt
    ai.awareness.setLocalStateField('user', { key: 'ai:m:503', name: 'KI (für Jonas)', color: '#7048e8' });
    await waitFor(() => [...human.awareness.getStates().values()].some((s) => (s as { user?: { name?: string } }).user?.name === 'KI (für Jonas)'));

    ai.doc.transact(() => {
      const o = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({ id: 'k1', type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'Von der KI' })) o.set(k, v);
      ai.doc.getMap('objects').set('k1', o);
    });
    await waitFor(() => human.doc.getMap<Y.Map<unknown>>('objects').get('k1')?.get('text') === 'Von der KI');

    // Widerrufen: offene Verbindung wird getrennt, neue Anmeldung scheitert
    expect((await jonas.req('DELETE', `/api/tokens/${token.id}`)).status).toBe(200);
    expect((await jonas.get('/api/tokens')).body.tokens).toHaveLength(0);
    const again = connect(board.id, bearer(secret));
    await waitFor(() => again.state.failed !== null);
    expect(again.state.failed).toBe('not_logged_in');
    expect((await new Browser(env.base).get('/api/boards', { headers: bearer(secret) })).status).toBe(401);
    // fremdes Token widerrufen geht nicht
    expect((await jonas.req('DELETE', '/api/tokens/gibtsnicht')).status).toBe(404);
  });

  it('KI darf sich in der Awareness nicht als die Person selbst ausgeben', async () => {
    const t = env.fake.addMember(504, 'Pia');
    const pia = await loginMember(env, t);
    const board = (await pia.post('/api/boards', { title: 'Echt?' })).body.board as { id: string };
    const { secret } = await newToken(pia);
    const human = connect(board.id, { cookie: pia.cookieHeader() });
    const ai = connect(board.id, bearer(secret));
    await waitFor(() => human.state.synced && ai.state.synced);
    ai.awareness.setLocalStateField('user', { key: 'm:504', name: 'Pia', color: '#000' });
    await new Promise((r) => setTimeout(r, 400));
    expect(human.awareness.getStates().has(ai.doc.clientID)).toBe(false);
  });

  it('Identitätsdienst sperrt das Konto → Token wird bei der Nachprüfung ungültig', async () => {
    const t = env.fake.addMember(505, 'Tom');
    const tom = await loginMember(env, t);
    const { token, secret } = await newToken(tom);
    const bot = new Browser(env.base);
    expect((await bot.get('/api/boards', { headers: bearer(secret) })).status).toBe(200);
    env.fake.revoke(t);
    env.srv.apiTokens.setVerifiedAt(token.id, '2000-01-01T00:00:00.000Z');
    expect((await bot.get('/api/boards', { headers: bearer(secret) })).status).toBe(401);
  });

  it('höchstens 20 Tokens je Person', async () => {
    const zoe = await loginMember(env, env.fake.addMember(506, 'Zoe'));
    for (let i = 0; i < 20; i++) await newToken(zoe, `t${i}`);
    const res = await zoe.post('/api/tokens', { label: 'zu viel' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('too_many');
  });
});
