// Sicherheits-Review: adversariale Tests gegen Auth, CSRF, Pairing, Uploads, Header und Sync.
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Browser, loginAdmin, loginMember, sleep, startEnv, waitFor, type TestEnv } from './helpers.js';

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

function connect(boardId: string, cookie: string | null) {
  const headers: Record<string, string> = cookie ? { cookie } : {};
  class CookieWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers });
    }
  }
  const socket = new HocuspocusProviderWebsocket({ url: env.wsUrl, WebSocketPolyfill: CookieWebSocket, maxAttempts: 1 });
  const doc = new Y.Doc();
  const state = { synced: false, failed: null as string | null, closed: 0 };
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
    onClose: () => {
      state.closed++;
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

/** Angemeldeter Mensch per QR (schont das Passwort-Rate-Limit der gemeinsamen Umgebung). */
let nextId = 1000;
const user = () => {
  const id = nextId++;
  return loginMember(env, env.fake.addMember(id, `Person ${id}`));
};

const newBoard = async (b: Browser, title = 'Sicher') => (await b.post('/api/boards', { title })).body.board as { id: string };

/** Rohe POST-Anfrage ohne URL-Normalisierung durch fetch. */
function rawRequest(base: string, method: string, path: string, headers: Record<string, string>, body = ''): Promise<number> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    import('node:http').then(({ request }) => {
      const req = request({ host: u.hostname, port: u.port, method, path, headers: { ...headers, 'content-length': Buffer.byteLength(body) } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      });
      req.on('error', reject);
      req.end(body);
    });
  });
}

describe('CSRF lässt sich nicht über Pfad-Varianten umgehen', () => {
  it('kodierte, doppelte oder großgeschriebene Pfade legen ohne X-Stachel kein Board an', async () => {
    const admin = await user();
    const before = (await admin.get('/api/boards')).body.boards.length;
    const headers = { cookie: admin.cookieHeader(), 'content-type': 'application/json' };
    for (const p of ['/%61pi/boards', '/api%2Fboards', '//api/boards', '/api//boards', '/API/boards', '/api/./boards', '/x/../api/boards', '/api/boards?x=1']) {
      const status = await rawRequest(env.base, 'POST', p, headers, '{"title":"csrf"}');
      expect(status, p).not.toBe(201);
    }
    expect((await admin.get('/api/boards')).body.boards.length).toBe(before);
  });
});

describe('Session-Cookie', () => {
  it('HttpOnly, SameSite=Lax, Path=/, nur der Hash liegt in der DB', async () => {
    const b = new Browser(env.base);
    const res = await b.post('/api/auth/password', { username: 'orga', password: 'geheim' });
    const c = res.setCookies.find((x) => x.startsWith('stachel_session='))!;
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Lax/i);
    expect(c).toMatch(/Path=\//);
    const value = b.cookies.get('stachel_session')!;
    expect(value.length).toBeGreaterThanOrEqual(43);
    expect(env.srv.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(value)).toBeUndefined();
  });

  it('Logout ohne CSRF-Header geht nicht (kein Abmelden per Fremdseite)', async () => {
    const b = await loginAdmin(env);
    const r = await b.req('POST', '/api/auth/logout', { csrf: false });
    expect(r.status).toBe(403);
    expect((await b.get('/api/auth/me')).status).toBe(200);
  });
});

describe('Passwort-Login: Rate-Limit nicht per IP-Wechsel umgehbar', () => {
  it('je Benutzername höchstens 10 Fehlversuche / 15 min, auch von verschiedenen IPs', async () => {
    const own = await startEnv({ trustProxy: true });
    try {
      const b = new Browser(own.base);
      for (let i = 0; i < 10; i++) {
        const r = await b.post('/api/auth/password', { username: 'orga', password: 'falsch' }, { headers: { 'X-Forwarded-For': `203.0.113.${i + 1}` } });
        expect(r.status).toBe(401);
      }
      const r = await b.post('/api/auth/password', { username: 'ORGA ', password: 'geheim' }, { headers: { 'X-Forwarded-For': '198.51.100.7' } });
      expect(r.status).toBe(429);
      // anderer Benutzername von derselben neuen IP geht weiter
      const other = await b.post('/api/auth/password', { username: 'jemand', password: 'x' }, { headers: { 'X-Forwarded-For': '198.51.100.7' } });
      expect(other.status).toBe(401);
    } finally {
      await own.stop();
    }
  });

  it('IPv6: Adressen aus demselben /64 zählen gemeinsam', async () => {
    const own = await startEnv({ trustProxy: true });
    try {
      const b = new Browser(own.base);
      for (let i = 0; i < 10; i++) {
        const r = await b.post('/api/auth/password', { username: `u${i}`, password: 'x' }, { headers: { 'X-Forwarded-For': `2001:db8:1:2::${(i + 1).toString(16)}` } });
        expect(r.status).toBe(401);
      }
      const r = await b.post('/api/auth/password', { username: 'u99', password: 'x' }, { headers: { 'X-Forwarded-For': '2001:db8:1:2:ffff::1' } });
      expect(r.status).toBe(429);
    } finally {
      await own.stop();
    }
  });
});

describe('QR-Pairing', () => {
  it('Code und Pair-Secret sind lang und zufällig, Pair-Cookie ist HttpOnly und auf /api/auth/qr beschränkt', async () => {
    const b = new Browser(env.base);
    const qr = await b.post('/api/auth/qr');
    expect(qr.body.code).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const c = qr.setCookies.find((x) => x.startsWith('stachel_pair='))!;
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/Path=\/api\/auth\/qr/);
    expect(c).toMatch(/SameSite=Lax/i);
    const qr2 = await new Browser(env.base).post('/api/auth/qr');
    expect(qr2.body.code).not.toBe(qr.body.code);
  });

  it('fremder Browser mit gestohlenem Code kann nach Freigabe nicht einlösen; der echte schon', async () => {
    const victim = new Browser(env.base);
    const qr = await victim.post('/api/auth/qr');
    const attacker = new Browser(env.base);
    attacker.cookies.set('stachel_pair', 'geraten');
    const app = new Browser(env.base);
    const token = env.fake.addMember(901, 'Opfer');
    expect((await app.post('/api/auth/qr/approve', { code: qr.body.code }, { headers: { Authorization: `Bearer ${token}` }, csrf: false })).status).toBe(200);
    const stolen = await attacker.get(`/api/auth/qr/${qr.body.code}/wait`);
    expect(stolen.status).toBe(403);
    expect(attacker.cookies.has('stachel_session')).toBe(false);
    const ok = await victim.get(`/api/auth/qr/${qr.body.code}/wait`);
    expect(ok.body.status).toBe('approved');
  });

  it('ein bestätigter Code lässt sich nicht von einem zweiten Konto überschreiben', async () => {
    const b = new Browser(env.base);
    const qr = await b.post('/api/auth/qr');
    const app = new Browser(env.base);
    const t1 = env.fake.addMember(902, 'Erste');
    const t2 = env.fake.addMember(903, 'Zweite');
    expect((await app.post('/api/auth/qr/approve', { code: qr.body.code }, { headers: { Authorization: `Bearer ${t1}` }, csrf: false })).status).toBe(200);
    expect((await app.post('/api/auth/qr/approve', { code: qr.body.code }, { headers: { Authorization: `Bearer ${t2}` }, csrf: false })).status).toBe(409);
    const w = await b.get(`/api/auth/qr/${qr.body.code}/wait`);
    expect(w.body.user.name).toBe('Erste');
  });

  it('Long-Poll: höchstens 3 gleichzeitige Wartende je Code, weitere → 429', async () => {
    const b = new Browser(env.base);
    const qr = await b.post('/api/auth/qr');
    const waits = Array.from({ length: 5 }, () => b.get(`/api/auth/qr/${qr.body.code}/wait`));
    const res = await Promise.all(waits);
    const statuses = res.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200).length).toBe(3);
    expect(statuses.filter((s) => s === 429).length).toBe(2);
    // danach wieder möglich
    expect((await b.get(`/api/auth/qr/${qr.body.code}/wait`)).status).toBe(200);
  });
});

describe('QR-Info für die App (gegen QR-Phishing)', () => {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

  it('liefert Browser, System, Zeitpunkt und grobe IP; verbraucht den Code nicht', async () => {
    const own = await startEnv({ trustProxy: true });
    try {
      const b = new Browser(own.base);
      const qr = await b.post('/api/auth/qr', undefined, { headers: { 'User-Agent': UA, 'X-Forwarded-For': '203.0.113.45' } });
      const app = new Browser(own.base);
      const token = own.fake.addMember(910, 'Info');
      const auth = { headers: { Authorization: `Bearer ${token}` } };
      const info = await app.get(`/api/auth/qr/${qr.body.code}/info`, auth);
      expect(info.status).toBe(200);
      expect(info.body).toMatchObject({ ok: true, browser: 'Chrome', os: 'Windows', ip_hint: '203.0.x.x' });
      expect(info.body.created_at).toMatch(/Z$/);
      expect(JSON.stringify(info.body)).not.toContain('203.0.113.45');
      expect((await app.get(`/api/auth/qr/${qr.body.code}/info`, auth)).status).toBe(200);
      expect((await app.post('/api/auth/qr/approve', { code: qr.body.code }, { ...auth, csrf: false })).status).toBe(200);
      expect((await app.get(`/api/auth/qr/${qr.body.code}/info`, auth)).status).toBe(409);
    } finally {
      await own.stop();
    }
  });

  it('ohne gültiges Token → 401, unbekannter Code → 404', async () => {
    const b = new Browser(env.base);
    const qr = await b.post('/api/auth/qr');
    const app = new Browser(env.base);
    expect((await app.get(`/api/auth/qr/${qr.body.code}/info`)).status).toBe(401);
    expect((await app.get(`/api/auth/qr/${qr.body.code}/info`, { headers: { Authorization: 'Bearer kaputt' } })).status).toBe(401);
    const token = env.fake.addMember(911, 'Info2');
    const r = await app.get('/api/auth/qr/gibtsnicht/info', { headers: { Authorization: `Bearer ${token}` } });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('unknown_code');
  });

  it('User-Agent-Erkennung', async () => {
    const { parseUserAgent, ipHint } = await import('../src/pairings.js');
    expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toEqual({ browser: 'Safari', os: 'iOS' });
    expect(parseUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toEqual({ browser: 'Firefox', os: 'Linux' });
    expect(parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0')).toEqual({ browser: 'Edge', os: 'macOS' });
    expect(parseUserAgent(undefined)).toEqual({ browser: null, os: null });
    expect(ipHint('2001:db8:1:2::5')).toBe('2001:db8:…');
    expect(ipHint('::ffff:10.1.2.3')).toBe('10.1.x.x');
  });
});

describe('Gesperrte bzw. nicht berechtigte Konten → 403 forbidden (nicht invalid_token)', () => {
  it('Identitätsdienst antwortet 403 ohne pending bzw. Mitglied inaktiv → forbidden; Sitzung wird bei Nachprüfung gelöscht', async () => {
    const { OrgIdentityClient } = await import('../src/org-identity.js');
    const http = await import('node:http');
    let reply: { status: number; body: unknown } = { status: 403, body: { error: 'forbidden' } };
    const srv = http.createServer((_req, res) => {
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const identityUrl = `http://127.0.0.1:${(srv.address() as { port: number }).port}/me`;
      const client = new OrgIdentityClient({ identityUrl, loginUrl: '', timeoutMs: 2000, name: 'Verein' });
      expect(await client.verifyToken('t')).toEqual({ kind: 'forbidden' });
      reply = { status: 403, body: { error: 'pending' } };
      expect(await client.verifyToken('t')).toEqual({ kind: 'pending' });
      reply = { status: 200, body: { id: 'm:1', name: 'x', admin: false, status: 'blocked' } };
      expect(await client.verifyToken('t')).toEqual({ kind: 'forbidden' });
      reply = { status: 200, body: { id: 'm:1', name: 'x', admin: true, status: 'inactive' } };
      expect(await client.verifyToken('t')).toEqual({ kind: 'forbidden' });
      reply = { status: 401, body: { error: 'invalid_token' } };
      expect(await client.verifyToken('t')).toEqual({ kind: 'invalid' });
    } finally {
      srv.close();
    }
  });

  it('approve und app-code melden forbidden mit 403', async () => {
    const own = await startEnv();
    try {
      const origFetch = globalThis.fetch;
      const fakeUrl = own.fake.url;
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).startsWith(`${fakeUrl}/me`)) {
          return new Response(JSON.stringify({ ok: false, error: 'forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        return origFetch(input, init);
      }) as typeof fetch;
      try {
        const b = new Browser(own.base);
        const qr = await b.post('/api/auth/qr');
        const app = new Browser(own.base);
        const auth = { headers: { Authorization: 'Bearer egal' }, csrf: false };
        const a1 = await app.post('/api/auth/qr/approve', { code: qr.body.code }, auth);
        expect(a1.status).toBe(403);
        expect(a1.body.error).toBe('forbidden');
        const a2 = await app.post('/api/auth/app-code', undefined, auth);
        expect(a2.status).toBe(403);
        expect(a2.body.error).toBe('forbidden');
      } finally {
        globalThis.fetch = origFetch;
      }
    } finally {
      await own.stop();
    }
  });
});

describe('App-Code-Login: Code landet nicht im Log', () => {
  it('Request-Serializer schwärzt code-Parameter', async () => {
    const { redactUrl } = await import('../src/app.js');
    expect(redactUrl('/auth/app?code=geheim123&b=abc')).toBe('/auth/app?code=***&b=abc');
    expect(redactUrl('/api/auth/qr/abcdef/wait')).toBe('/api/auth/qr/***/wait');
    expect(redactUrl('/qr/abcdef')).toBe('/qr/***');
    expect(redactUrl('/api/boards')).toBe('/api/boards');
    expect(redactUrl('/api/auth/qr/approve')).toBe('/api/auth/qr/approve');
  });

  it('Redirect nach Einlösen trägt den Code nicht weiter', async () => {
    const app = new Browser(env.base);
    const token = env.fake.addMember(904, 'App');
    const code = await app.post('/api/auth/app-code', undefined, { headers: { Authorization: `Bearer ${token}` }, csrf: false });
    const res = await fetch(`${env.base}/auth/app?code=${code.body.code}&b=//evil.example`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?app=1');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('Bilder', () => {
  const upload = (b: Browser, boardId: string, data: Buffer, type = 'image/png', name = 'x.png') => {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(data)], { type }), name);
    return b.req('POST', `/api/boards/${boardId}/images`, { body: fd });
  };

  it('SVG, HTML und Polyglot ohne Bild-Signatur → 415', async () => {
    const admin = await user();
    const board = await newBoard(admin);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await upload(admin, board.id, svg, 'image/svg+xml', 'x.svg')).status).toBe(415);
    expect((await upload(admin, board.id, Buffer.from('<html><script>alert(1)</script>'), 'image/png')).status).toBe(415);
  });

  it('Pixel-Bombe (riesige Abmessungen bei kleiner Datei) → 413', async () => {
    const admin = await user();
    const board = await newBoard(admin);
    const png = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.writeUInt32BE(13, 8);
    png.write('IHDR', 12, 'latin1');
    png.writeUInt32BE(15_000, 16);
    png.writeUInt32BE(15_000, 20);
    expect((await upload(admin, board.id, png)).status).toBe(413);
  });

  it('Auslieferung mit festem Bild-Typ, nosniff, CSP sandbox; Pfad-Traversal → 404', async () => {
    const admin = await user();
    const board = await newBoard(admin);
    const png = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.writeUInt32BE(13, 8);
    png.write('IHDR', 12, 'latin1');
    png.writeUInt32BE(2, 16);
    png.writeUInt32BE(2, 20);
    const polyglot = Buffer.concat([png, Buffer.from('<html><script>alert(1)</script></html>')]);
    const up = await upload(admin, board.id, polyglot, 'text/html', 'x.html');
    expect(up.status).toBe(201);
    const img = await admin.get(up.body.image.url);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(img.headers.get('x-content-type-options')).toBe('nosniff');
    expect(img.headers.get('content-security-policy')).toMatch(/sandbox/);
    for (const p of ['/api/images/..%2F..%2Fstachel.sqlite', '/api/images/%2e%2e', '/api/images/..']) {
      const status = await rawRequest(env.base, 'GET', p, { cookie: admin.cookieHeader() });
      expect(status, p).toBe(404);
    }
  });
});

describe('Sicherheits-Header', () => {
  it('HTML-Seiten: CSP ohne Inline-Skripte, frame-ancestors none, nosniff, Referrer-Policy', async () => {
    for (const p of ['/qr/abc', '/auth/app?code=x']) {
      const res = await fetch(env.base + p);
      const csp = res.headers.get('content-security-policy') ?? '';
      // nur eigene Dateien; 'wasm-unsafe-eval' erlaubt allein WebAssembly (pdf.js), kein eval und kein Inline-Skript
      expect(csp, p).toMatch(/script-src 'self'( 'wasm-unsafe-eval')?(;|$)/);
      expect(csp, p).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
      expect(csp, p).toMatch(/frame-ancestors 'none'/);
      expect(csp, p).toMatch(/object-src 'none'/);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBeTruthy();
      expect(res.headers.get('x-frame-options')).toBeTruthy();
    }
  });
});

describe('SQL-Injection', () => {
  it('Titel mit SQL bleibt reiner Text', async () => {
    const admin = await user();
    const evil = "x'); DROP TABLE boards; --";
    const b = await admin.post('/api/boards', { title: evil });
    expect(b.status).toBe(201);
    const list = (await admin.get('/api/boards')).body.boards as { title: string }[];
    expect(list.some((x) => x.title === evil)).toBe(true);
    const r = await admin.req('PATCH', `/api/boards/${encodeURIComponent("' OR 1=1 --")}`, { json: { title: 'y' } });
    expect(r.status).toBe(404);
  });
});

describe('WebSocket /sync', () => {
  function rawWs(cookie: string | null): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(env.wsUrl, cookie ? { headers: { cookie } } : {});
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }
  const closed = (ws: WebSocket) => new Promise<number>((r) => ws.on('close', (code) => r(code)));

  it('ohne gültige Sitzung: große Nachricht vor der Anmeldung → Verbindung sofort zu (kein 32-MB-Puffer)', async () => {
    const ws = await rawWs(null);
    const done = closed(ws);
    ws.send(Buffer.alloc(256 * 1024, 1));
    expect(await done).toBe(1009);
  });

  it('mit Sitzung: normale Updates gehen weiter (Limit nur gegen Missbrauch)', async () => {
    const admin = await user();
    const board = await newBoard(admin);
    const a = connect(board.id, admin.cookieHeader());
    await waitFor(() => a.state.synced);
    a.doc.getMap('objects').set('big', new Y.Map([['text', 'x'.repeat(512 * 1024)]] as [string, unknown][]));
    const b = connect(board.id, admin.cookieHeader());
    await waitFor(() => b.state.synced);
    await waitFor(() => b.doc.getMap('objects').has('big'));
  });

  it('Awareness mit fremder Identität wird nicht verteilt, Verbindung geschlossen', async () => {
    const mallory = await loginMember(env, env.fake.addMember(905, 'Mallory'));
    const viewer = await user();
    const board = await newBoard(viewer);
    const v = connect(board.id, viewer.cookieHeader());
    const m = connect(board.id, mallory.cookieHeader());
    await waitFor(() => v.state.synced && m.state.synced);
    m.provider.setAwarenessField('user', { key: 'a:orga', name: 'orga', color: '#000' });
    await sleep(400);
    const spoofed = [...v.provider.awareness!.getStates().entries()].filter(
      ([id, s]) => id !== v.doc.clientID && (s as { user?: { key?: string } }).user?.key === 'a:orga',
    );
    expect(spoofed).toEqual([]);
  });

  it('Awareness mit kaputtem Namen (kein String) wird nicht verteilt', async () => {
    const mallory = await loginMember(env, env.fake.addMember(906, 'Mallory2'));
    const viewer = await user();
    const board = await newBoard(viewer);
    const v = connect(board.id, viewer.cookieHeader());
    const m = connect(board.id, mallory.cookieHeader());
    await waitFor(() => v.state.synced && m.state.synced);
    m.provider.setAwarenessField('user', { key: 'm:906', name: { toString: 1 }, color: '#000' });
    await sleep(400);
    const broken = [...v.provider.awareness!.getStates().values()].filter(
      (s) => typeof (s as { user?: { name?: unknown } }).user?.name === 'object',
    );
    expect(broken).toEqual([]);
  });

  it('eigene Awareness mit passender Identität kommt an', async () => {
    const anna = await loginMember(env, env.fake.addMember(907, 'Anna'));
    const viewer = await user();
    const board = await newBoard(viewer);
    const v = connect(board.id, viewer.cookieHeader());
    const a = connect(board.id, anna.cookieHeader());
    await waitFor(() => v.state.synced && a.state.synced);
    a.provider.setAwarenessField('user', { key: 'm:907', name: 'Anna', color: '#ec4e92' });
    await waitFor(() => [...v.provider.awareness!.getStates().values()].some((s) => (s as { user?: { key?: string } }).user?.key === 'm:907'));
  });

  it('Logout trennt offene Sync-Verbindungen dieser Sitzung', async () => {
    const admin = await user();
    const board = await newBoard(admin);
    const c = connect(board.id, admin.cookieHeader());
    await waitFor(() => c.state.synced);
    expect((await admin.post('/api/auth/logout')).status).toBe(200);
    await waitFor(() => c.state.closed > 0);
  });

  it('abgelaufene/gelöschte Sitzung: offene Verbindung wird bei der Nachprüfung getrennt', async () => {
    const own = await startEnv({ syncRecheckMs: 200 });
    try {
      const token = own.fake.addMember(908, 'Gesperrt');
      const b = await loginMember(own, token);
      const board = (await b.post('/api/boards', { title: 'x' })).body.board as { id: string };
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const s = new WebSocket(own.wsUrl, { headers: { cookie: b.cookieHeader() } });
        s.on('open', () => resolve(s));
        s.on('error', reject);
      });
      void board;
      const done = closed(ws);
      own.srv.db.prepare('DELETE FROM sessions').run();
      expect(await done).toBeGreaterThan(0);
    } finally {
      await own.stop();
    }
  });
});
