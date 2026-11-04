// Eigenständige Stachel-App (docs/contract.md §6, §8.1, §8.2, §8.4): App-Sitzung mit Zugangsdaten (beide Modi),
// QR-Anmeldung mit sts_-Token, Konto- und Teilen-Endpunkte mit Bearer sts_, Rollen in der Native-API (Modus local),
// Mindestversion je App, App-Links und Mail-Links im Modus local.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redactUrl } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { Browser, startEnv, waitFor, sleep, type TestEnv } from './helpers.js';
import { captcha, LOCAL, linkParam, mailsOf, PW, signUp, waitMail } from './local-helpers.js';
import { NativeClient, type Msg } from './native-client.js';

const FP = 'F9:E7:0D:CC:CD:8E:55:68:88:F0:A6:8D:5B:24:D6:24:CE:B2:5B:4B:69:C3:76:EE:B6:8D:3A:BD:C0:ED:2F:97';

const bearer = (token: string, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${token}`, ...extra });
const json = { 'Content-Type': 'application/json' };

interface Call {
  status: number;
  body: any;
  headers: Headers;
}

async function call(env: TestEnv, method: string, p: string, opts: { token?: string; body?: unknown; csrf?: boolean; headers?: Record<string, string> } = {}): Promise<Call> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.csrf) headers['X-Stachel'] = '1';
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(env.base + p, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) : text, headers: res.headers };
}

/** POST /api/auth/app-session mit Zugangsdaten (ohne X-Stachel, wie die App). */
const appLogin = (env: TestEnv, body: Record<string, unknown>) => call(env, 'POST', '/api/auth/app-session', { body });

async function appToken(env: TestEnv, email: string, password = PW): Promise<string> {
  const r = await appLogin(env, { email, password });
  if (r.status !== 200) throw new Error(`app-session ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token as string;
}

// ---------------------------------------------------------------------------------------------------------------------
describe('Modus local: App-Sitzung mit E-Mail + Passwort', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startEnv({ instance: LOCAL });
    await signUp(env, 'Mara App', 'mara.app@example.org');
  });
  afterAll(async () => {
    await env?.stop();
  });

  it('liefert {ok, token: sts_…, user, expiresAt}, kein Cookie; Token gilt für /api und /api/auth/me', async () => {
    const r = await appLogin(env, { email: ' Mara.App@Example.org ', password: PW });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(r.body.ok).toBe(true);
    expect(r.body.token).toMatch(/^sts_[A-Za-z0-9_-]{43}$/);
    expect(r.body.user).toMatchObject({ name: 'Mara App', isOrga: false });
    expect(r.body.user.key).toMatch(/^u:/);
    expect(Date.parse(r.body.expiresAt) - Date.now()).toBeGreaterThan(29 * 24 * 3600_000);
    // gleiche Sitzungsart wie der Cookie-Login: org_token = local:<id>, nur der Hash gespeichert
    const row = env.srv.db.prepare('SELECT id, org_token FROM sessions WHERE user_key = ? ORDER BY created_at DESC').get(r.body.user.key) as { id: string; org_token: string };
    expect(row.org_token).toBe(`local:${r.body.user.key.slice(2)}`);
    expect(row.id).not.toContain(r.body.token);
    const token = r.body.token as string;
    expect((await call(env, 'GET', '/api/boards', { token })).status).toBe(200);
    // Nachprüfung nach 6 h über das Konto (accounts.verifier) verlängert die Sitzung
    env.srv.sessions.setVerifiedAt(token, new Date(Date.now() - 7 * 3600_000).toISOString());
    const me = await call(env, 'GET', '/api/auth/me', { token });
    expect(me.status).toBe(200);
    expect(me.body.user.key).toBe(r.body.user.key);
    expect(Date.parse(me.body.expiresAt) - Date.now()).toBeGreaterThan(29 * 24 * 3600_000);
  });

  it('Fehler wie /api/auth/login: invalid_input 400, wrong_login 401, not_verified 403', async () => {
    expect(await appLogin(env, { email: 'mara.app@example.org' })).toMatchObject({ status: 400, body: { error: 'invalid_input' } });
    expect(await appLogin(env, { email: '', password: 'x' })).toMatchObject({ status: 400, body: { error: 'invalid_input' } });
    expect(await appLogin(env, { email: 'mara.app@example.org', password: 'falsch-falsch-falsch' })).toMatchObject({ status: 401, body: { error: 'wrong_login' } });
    expect(await appLogin(env, { email: 'niemand@example.org', password: PW })).toMatchObject({ status: 401, body: { error: 'wrong_login' } });
    // unbestätigtes Konto: nur bei richtigem Passwort not_verified
    const b = new Browser(env.base);
    expect((await b.post('/api/auth/register', { name: 'Unbestätigt', email: 'offen@example.org', password: PW, terms: true, captcha: await captcha(b) })).status).toBe(200);
    expect(await appLogin(env, { email: 'offen@example.org', password: PW })).toMatchObject({ status: 403, body: { error: 'not_verified' } });
    expect(await appLogin(env, { email: 'offen@example.org', password: 'falsch-falsch-falsch' })).toMatchObject({ status: 401, body: { error: 'wrong_login' } });
  });

  it('ohne Zugangsdaten: 400 invalid_input; Org-Token (Bearer) gibt es im Modus local nicht → 404', async () => {
    expect(await call(env, 'POST', '/api/auth/app-session')).toMatchObject({ status: 400, body: { error: 'invalid_input' } });
    expect(await call(env, 'POST', '/api/auth/app-session', { token: env.fake.addMember(901, 'Org') })).toMatchObject({ status: 404, body: { error: 'not_found' } });
    // kein CSRF-Header nötig (wie app-code), Zugangsdaten mit Bearer: die Zugangsdaten zählen
    const r = await call(env, 'POST', '/api/auth/app-session', { token: 'egal', body: { email: 'mara.app@example.org', password: PW } });
    expect(r.status).toBe(200);
  });

  it('Org-Anmeldewege bleiben 404, /api/auth/login (Cookie) unverändert', async () => {
    expect((await call(env, 'POST', '/api/auth/password', { csrf: true, body: { username: 'orga', password: 'geheim' } })).status).toBe(404);
    expect((await call(env, 'POST', '/api/auth/qr', { csrf: true })).status).toBe(404);
    expect((await call(env, 'GET', '/qr/abcdef')).status).toBe(404);
    const b = new Browser(env.base);
    const l = await b.post('/api/auth/login', { email: 'mara.app@example.org', password: PW });
    expect(l.status).toBe(200);
    expect(b.cookies.has('stachel_session')).toBe(true);
  });
});

describe('Modus local: Rate-Limit der App-Anmeldung (gemeinsam mit /api/auth/login)', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startEnv({ instance: LOCAL });
    await signUp(env, 'Rita Rate', 'rita@example.org');
  });
  afterAll(async () => {
    await env?.stop();
  });

  it('10 Fehlversuche je Adresse → 429 rate_limited, auch für den Browser-Login', async () => {
    for (let i = 0; i < 10; i++) expect((await appLogin(env, { email: 'rita@example.org', password: `falsch-${i}-xyz` })).status).toBe(401);
    expect(await appLogin(env, { email: 'rita@example.org', password: PW })).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
    const b = new Browser(env.base);
    expect((await b.post('/api/auth/login', { email: 'rita@example.org', password: PW })).status).toBe(429);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('Modus org: App-Sitzung mit Benutzername + Passwort, QR mit X-Stachel-App', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startEnv();
  });
  afterAll(async () => {
    await env?.stop();
  });

  it('{username, password} wie /api/auth/password → sts_-Token (Passwort-Login der Organisation)', async () => {
    const r = await appLogin(env, { username: 'orga', password: 'geheim' });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(r.body).toMatchObject({ ok: true, user: { key: 'a:orga', name: 'orga', isOrga: true } });
    expect(r.body.token).toMatch(/^sts_/);
    expect((await call(env, 'GET', '/api/auth/me', { token: r.body.token })).body.user.key).toBe('a:orga');
    expect(await appLogin(env, { username: 'orga', password: 'falsch' })).toMatchObject({ status: 401, body: { error: 'invalid_credentials' } });
    expect(await appLogin(env, { username: 'orga' })).toMatchObject({ status: 400, body: { error: 'invalid_input' } });
    env.fake.mode = 'down';
    try {
      expect(await appLogin(env, { username: 'orga', password: 'geheim' })).toMatchObject({ status: 502, body: { error: 'org_unreachable' } });
    } finally {
      env.fake.mode = 'ok';
    }
    // Bearer-Org-Token (Org-App) unverändert
    const kt = env.fake.addMember(777, 'Team');
    const t = await call(env, 'POST', '/api/auth/app-session', { token: kt });
    expect(t).toMatchObject({ status: 200, body: { user: { key: 'm:777' } } });
  });

  it('QR ohne Browser: POST /api/auth/qr (X-Stachel), Cookie stachel_pair von Hand zurück, wait mit X-Stachel-App: 1 → sts_-Token', async () => {
    const qr = await fetch(`${env.base}/api/auth/qr`, { method: 'POST', headers: { 'X-Stachel': '1' } });
    expect(qr.status).toBe(200);
    const { code, url } = (await qr.json()) as { code: string; url: string };
    expect(url).toBe(`https://stachel.example.test/qr/${code}`);
    const pair = qr.headers.getSetCookie().map((c) => c.split(';')[0]!).find((c) => c.startsWith('stachel_pair='));
    expect(pair).toBeDefined();
    expect(qr.headers.getSetCookie().join(';')).toContain('Path=/api/auth/qr');

    // ohne Cookie: wrong_browser (der Code gehört dem Gerät mit dem Cookie)
    const kt = env.fake.addMember(778, 'Scannerin');
    expect((await fetch(`${env.base}/api/auth/qr/approve`, { method: 'POST', headers: { ...bearer(kt), ...json }, body: JSON.stringify({ code }) })).status).toBe(200);
    const foreign = await fetch(`${env.base}/api/auth/qr/${code}/wait`, { headers: { 'X-Stachel-App': '1' } });
    expect(foreign.status).toBe(403);

    const wait = await fetch(`${env.base}/api/auth/qr/${code}/wait`, { headers: { Cookie: pair!, 'X-Stachel-App': '1' } });
    expect(wait.status).toBe(200);
    const body = (await wait.json()) as { ok: boolean; status: string; user: { key: string }; token: string; expiresAt: string };
    expect(body).toMatchObject({ ok: true, status: 'approved', user: { key: 'm:778', name: 'Scannerin', isOrga: false } });
    expect(body.token).toMatch(/^sts_[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
    // kein Sitzungs-Cookie, nur das Pair-Cookie wird gelöscht
    const cookies = wait.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith('stachel_session='))).toBe(false);
    expect(cookies.some((c) => c.startsWith('stachel_pair=;'))).toBe(true);
    expect((await call(env, 'GET', '/api/auth/me', { token: body.token })).body.user.key).toBe('m:778');
    // einmal einlösbar
    expect((await fetch(`${env.base}/api/auth/qr/${code}/wait`, { headers: { Cookie: pair!, 'X-Stachel-App': '1' } })).status).toBe(410);
  });

  it('QR im Browser (ohne X-Stachel-App) setzt weiter das Sitzungs-Cookie', async () => {
    const b = new Browser(env.base);
    const qr = await b.post('/api/auth/qr');
    await fetch(`${env.base}/api/auth/qr/approve`, { method: 'POST', headers: { ...bearer(env.fake.addMember(779, 'Web')), ...json }, body: JSON.stringify({ code: qr.body.code }) });
    const w = await b.get(`/api/auth/qr/${qr.body.code}/wait`);
    expect(w.body).toEqual({ ok: true, status: 'approved', user: { key: 'm:779', name: 'Web', isOrga: false } });
    expect(b.cookies.has('stachel_session')).toBe(true);
  });

  it('Kontoseiten gibt es im Modus org nicht; App-Links unverändert (Org-App, /qr/* und /b/*)', async () => {
    const { token } = (await appLogin(env, { username: 'orga', password: 'geheim' })).body as { token: string };
    expect((await call(env, 'GET', '/api/account', { token })).status).toBe(404);
    expect((await call(env, 'GET', '/verify/abcdefghijklmnopqrstuvwxyz')).status).toBe(404);
    const aasa = await call(env, 'GET', '/.well-known/apple-app-site-association');
    expect(aasa.body.applinks.details[0]).toEqual({ appIDs: ['TEAMID1234.org.example.app'], components: [{ '/': '/qr/*' }, { '/': '/b/*' }] });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('Mindestversion je App (hello.client, /api/native/info minApps)', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startEnv({ nativeMinApp: '1.22.0', nativeMinStachelApp: '0.3.0' });
  });
  afterAll(async () => {
    await env?.stop();
  });

  it('info liefert minApp (Org-App) und minApps je App', async () => {
    const info = await call(env, 'GET', '/api/native/info');
    expect(info.body.minApp).toBe('1.22.0');
    expect(info.body.minApps).toEqual({ org: '1.22.0', stachel: '0.3.0' });
  });

  it('Env STACHEL_NATIVE_MIN_STACHEL_APP', () => {
    expect(loadConfig({ STACHEL_NATIVE_MIN_STACHEL_APP: ' 0.4.1 ' }).nativeMinStachelApp).toBe('0.4.1');
    expect(loadConfig({}).nativeMinStachelApp).toBeNull();
  });

  it('client stachel prüft gegen die Stachel-Mindestversion, ohne client (bzw. unbekannt) gegen die Org-App', async () => {
    const { token } = (await appLogin(env, { username: 'orga', password: 'geheim' })).body as { token: string };
    const board = (await call(env, 'POST', '/api/boards', { token, csrf: true, body: { title: 'Version' } })).body.board.id as string;
    const ws = env.base.replace('http', 'ws');
    const tryHello = async (extra: Record<string, unknown>) => {
      const c = new NativeClient(ws, token);
      try {
        return await c.hello(board, extra);
      } finally {
        c.close();
      }
    };
    // Stachel-App 0.3.0 reicht, 0.2.9 nicht – auch wenn sie unter der Org-Mindestversion liegt
    expect((await tryHello({ client: 'stachel', app: '0.3.0+5' })).t).toBe('welcome');
    const old = await tryHello({ client: 'stachel', app: '0.2.9' });
    expect(old).toMatchObject({ t: 'error', error: 'upgrade_required', message: 'Bitte die Stachel-App aktualisieren.' });
    // Org-App (Standard)
    expect((await tryHello({ app: '1.22.0' })).t).toBe('welcome');
    expect(await tryHello({ app: '0.3.0' })).toMatchObject({ t: 'error', error: 'upgrade_required', message: 'Bitte die Organisation-App aktualisieren.' });
    expect(await tryHello({ client: 'unbekannt', app: '0.3.0' })).toMatchObject({ error: 'upgrade_required' });
    expect((await tryHello({ client: 'org', app: '1.30.0' })).t).toBe('welcome');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('Modus local: Konto, Teilen und Rollen mit der Stachel-App', () => {
  let env: TestEnv;
  const t: Record<'owner' | 'edit' | 'comment' | 'view', string> = { owner: '', edit: '', comment: '', view: '' };
  const keys: Record<string, string> = {};
  let boardId = '';
  const ws = () => env.base.replace('http', 'ws');

  beforeAll(async () => {
    env = await startEnv({ instance: LOCAL });
    for (const role of ['owner', 'edit', 'comment', 'view'] as const) {
      await signUp(env, `App ${role}`, `${role}@sandbox.test`);
      t[role] = await appToken(env, `${role}@sandbox.test`);
      keys[role] = (await call(env, 'GET', '/api/auth/me', { token: t[role] })).body.user.key;
    }
    const created = await call(env, 'POST', '/api/boards', { token: t.owner, csrf: true, body: { title: 'App-Board' } });
    boardId = created.body.board.id;
  });
  afterAll(async () => {
    await env?.stop();
  });

  it('GET /api/instance ohne Sitzung', async () => {
    const i = await call(env, 'GET', '/api/instance');
    expect(i.body).toMatchObject({ ok: true, auth: 'local', registration: 'open' });
  });

  it('Teilen-Endpunkte mit Bearer sts_ (share, members, invites, link, people, owner)', async () => {
    // schreiben ohne X-Stachel → csrf
    expect((await call(env, 'POST', `/api/boards/${boardId}/share`, { token: t.owner, body: { emails: ['edit@sandbox.test'], role: 'edit' } })).body.error).toBe('csrf');
    for (const role of ['edit', 'comment', 'view'] as const) {
      const r = await call(env, 'POST', `/api/boards/${boardId}/share`, { token: t.owner, csrf: true, body: { emails: [`${role}@sandbox.test`], role } });
      expect(r.status).toBe(200);
    }
    const share = await call(env, 'GET', `/api/boards/${boardId}/share`, { token: t.owner });
    expect(share.body).toMatchObject({ ok: true, role: 'owner', canManage: true });
    expect(Object.fromEntries((share.body.people as { key: string; role: string }[]).map((p) => [p.key, p.role]))).toEqual({
      [keys.owner!]: 'owner',
      [keys.edit!]: 'edit',
      [keys.comment!]: 'comment',
      [keys.view!]: 'view',
    });
    // Einladung ohne Konto und zurückziehen
    const inv = await call(env, 'POST', `/api/boards/${boardId}/share`, { token: t.owner, csrf: true, body: { emails: 'neu@sandbox.test', role: 'view' } });
    expect(inv.body.invites.map((i: { email: string }) => i.email)).toContain('neu@sandbox.test');
    const del = await call(env, 'DELETE', `/api/boards/${boardId}/invites/${encodeURIComponent('neu@sandbox.test')}`, { token: t.owner, csrf: true });
    expect(del.body.invites).toEqual([]);
    // Rolle ändern und zurück
    expect((await call(env, 'PATCH', `/api/boards/${boardId}/members/${keys.view}`, { token: t.owner, csrf: true, body: { role: 'comment' } })).status).toBe(200);
    expect((await call(env, 'PATCH', `/api/boards/${boardId}/members/${keys.view}`, { token: t.owner, csrf: true, body: { role: 'view' } })).status).toBe(200);
    // Freigabelink an/aus
    const link = await call(env, 'PUT', `/api/boards/${boardId}/link`, { token: t.owner, csrf: true, body: { role: 'view' } });
    expect(link.body.link).toBe('view');
    expect((await call(env, 'PUT', `/api/boards/${boardId}/link`, { token: t.owner, csrf: true, body: { role: null } })).body.link).toBeNull();
    // Personen (für Erwähnungen) auch für view
    const people = await call(env, 'GET', `/api/boards/${boardId}/people`, { token: t.view });
    expect(people.body.users.map((u: { key: string }) => u.key).sort()).toEqual([keys.owner, keys.edit, keys.comment, keys.view].sort());
    // view darf nicht teilen
    expect(await call(env, 'POST', `/api/boards/${boardId}/share`, { token: t.view, csrf: true, body: { emails: ['x@sandbox.test'], role: 'view' } })).toMatchObject({ status: 403, body: { error: 'no_permission' } });
    // Board-Liste mit Rolle
    const list = await call(env, 'GET', '/api/boards', { token: t.comment });
    expect(list.body.boards.find((b: { id: string }) => b.id === boardId)?.role).toBe('comment');
    // Besitz übertragen und zurück (der neue Besitz überträgt zurück)
    const tr = await call(env, 'POST', `/api/boards/${boardId}/owner`, { token: t.owner, csrf: true, body: { key: keys.edit } });
    expect(tr.status).toBe(200);
    expect((await call(env, 'POST', `/api/boards/${boardId}/owner`, { token: t.edit, csrf: true, body: { key: keys.owner } })).status).toBe(200);
    const after = await call(env, 'GET', `/api/boards/${boardId}/share`, { token: t.owner });
    expect(after.body.role).toBe('owner');
  });

  describe('Native-API: Rollen', () => {
    const ops = (c: NativeClient, req: number, list: unknown[]) => {
      const from = c.messages.length;
      c.send({ t: 'ops', req, ops: list });
      return c.next((m) => (m.t === 'ack' || m.t === 'nack') && m.req === req, 5000, from);
    };
    const live = () => env.srv.hocuspocus.documents.get(`board:${boardId}`);
    const at = { x: 10, y: 20 };

    it('welcome meldet die Rolle', async () => {
      for (const role of ['owner', 'edit', 'comment', 'view'] as const) {
        const c = new NativeClient(ws(), t[role]);
        expect((await c.hello(boardId, { client: 'stachel', app: '0.1.0' })).role).toBe(role);
        c.close();
      }
    });

    it('view: alle Ops, undo/redo und act → nack forbidden „nur ansehen“', async () => {
      const c = new NativeClient(ws(), t.view);
      await c.hello(boardId, { client: 'stachel' });
      const nope = { error: 'forbidden', message: 'Du darfst dieses Board nur ansehen.' };
      expect(await ops(c, 1, [{ op: 'create', objects: [{ id: 'v_1', type: 'sticky', x: 0, y: 0, w: 10, h: 10 }] }])).toMatchObject({ t: 'nack', ...nope });
      expect(await ops(c, 2, [{ op: 'comment', thread: 'tv', msg: 'mv', at, text: 'Hallo', mentions: [] }])).toMatchObject({ t: 'nack', ...nope });
      expect(await ops(c, 3, [{ op: 'mentionsRead' }])).toMatchObject({ t: 'nack', ...nope });
      c.send({ t: 'undo', req: 4 });
      expect(await c.next((m) => m.req === 4)).toMatchObject({ t: 'nack', ...nope });
      c.send({ t: 'redo', req: 5 });
      expect(await c.next((m) => m.req === 5)).toMatchObject({ t: 'nack', ...nope });
      expect(live()?.getMap('collab.comments').has('tv')).toBe(false);
      c.close();
    });

    it('comment: Kommentar-Ops gehen (nur collab.comments/collab.reads), alles andere → nack forbidden „nur kommentieren“', async () => {
      const c = new NativeClient(ws(), t.comment);
      const welcome = await c.hello(boardId, { client: 'stachel' });
      const objectsBefore = JSON.stringify(welcome.snapshot.objects);
      const nope = { t: 'nack', error: 'forbidden', message: 'Du darfst hier nur kommentieren.' };

      const from = c.messages.length;
      expect(await ops(c, 1, [{ op: 'comment', thread: 'tc', msg: 'mc1', at, text: 'Strom klären', mentions: [keys.owner] }])).toMatchObject({ t: 'ack' });
      const patch = await c.next((m) => m.t === 'patch' && !!m.ext?.['collab.comments'], 5000, from);
      expect(patch.changes).toEqual([]);
      expect(patch.by).toBe(keys.comment);
      expect(await ops(c, 2, [{ op: 'reply', thread: 'tc', msg: 'mc2', text: 'Mach ich', mentions: [] }])).toMatchObject({ t: 'ack' });
      expect(await ops(c, 3, [{ op: 'commentEdit', thread: 'tc', msg: 'mc2', text: 'Mach ich morgen', mentions: [] }])).toMatchObject({ t: 'ack' });
      expect(await ops(c, 4, [{ op: 'resolve', thread: 'tc', resolved: true }])).toMatchObject({ t: 'ack' });
      expect(await ops(c, 5, [{ op: 'commentDelete', thread: 'tc', msg: 'mc2' }])).toMatchObject({ t: 'ack' });
      expect(await ops(c, 6, [{ op: 'mentionsRead', at: new Date().toISOString() }])).toMatchObject({ t: 'ack' });
      const thread = live()!.getMap('collab.comments').get('tc') as { toJSON?: () => unknown } | undefined;
      expect(thread).toBeDefined();
      expect(live()!.getMap('collab.reads').has(keys.comment!)).toBe(true);

      // nicht erlaubt: Objekte, Reaktionen, Mindmap, Web-Aktionen, Undo/Redo
      expect(await ops(c, 7, [{ op: 'create', objects: [{ id: 'c_1', type: 'sticky', x: 0, y: 0, w: 10, h: 10 }] }])).toMatchObject({ ...nope, index: 0 });
      expect(await ops(c, 8, [{ op: 'react', ids: ['x'], emoji: '👍', on: true }])).toMatchObject(nope);
      expect(await ops(c, 9, [{ op: 'act', name: 'dev.note', args: {} }])).toMatchObject(nope);
      expect(await ops(c, 10, [{ op: 'mind', do: 'root', new: 'm0', x: 0, y: 0, text: '' }])).toMatchObject(nope);
      // gemischt: nichts geschrieben, Index der ersten verbotenen Op
      expect(await ops(c, 11, [{ op: 'comment', thread: 'tmix', msg: 'mm', at, text: 'x', mentions: [] }, { op: 'remove', ids: ['a'] }])).toMatchObject({ ...nope, index: 1 });
      expect(live()!.getMap('collab.comments').has('tmix')).toBe(false);
      c.send({ t: 'undo', req: 12 });
      expect(await c.next((m) => m.req === 12)).toMatchObject(nope);
      c.send({ t: 'redo', req: 13 });
      expect(await c.next((m) => m.req === 13)).toMatchObject(nope);
      // Objekte unverändert
      c.close();
      const check = new NativeClient(ws(), t.owner);
      const again = await check.hello(boardId, { client: 'stachel' });
      expect(JSON.stringify(again.snapshot.objects)).toBe(objectsBefore);
      expect(again.snapshot.ext['collab.comments'].tc.messages).toHaveLength(1);
      check.close();
    });

    it('edit: Objekte anlegen, Undo', async () => {
      const c = new NativeClient(ws(), t.edit);
      await c.hello(boardId, { client: 'stachel' });
      expect(await ops(c, 1, [{ op: 'create', objects: [{ id: 'e_1', type: 'sticky', x: 0, y: 0, w: 100, h: 100, text: 'Hallo' }] }])).toMatchObject({ t: 'ack' });
      expect(live()!.getMap('objects').has('e_1')).toBe(true);
      expect(await ops(c, 2, [{ op: 'react', ids: ['e_1'], emoji: '👍', on: true }])).toMatchObject({ t: 'ack' });
      c.send({ t: 'undo', req: 3 });
      expect(await c.next((m: Msg) => m.req === 3)).toMatchObject({ t: 'ack' });
      c.close();
    });
  });

  it('Konto mit Bearer sts_: GET/PATCH /api/account (PATCH braucht X-Stachel)', async () => {
    const acc = await call(env, 'GET', '/api/account', { token: t.view });
    expect(acc.body).toMatchObject({ ok: true, account: { key: keys.view, name: 'App view', email: 'view@sandbox.test' } });
    expect((await call(env, 'PATCH', '/api/account', { token: t.view, body: { name: 'Vera' } })).body.error).toBe('csrf');
    const p = await call(env, 'PATCH', '/api/account', { token: t.view, csrf: true, body: { name: 'Vera App' } });
    expect(p.body).toEqual({ ok: true, user: { key: keys.view, name: 'Vera App', isOrga: false } });
    expect((await call(env, 'GET', '/api/auth/me', { token: t.view })).body.user.name).toBe('Vera App');
    // ohne gültiges Token
    expect((await call(env, 'GET', '/api/account', { token: 'sts_' + 'x'.repeat(43) })).status).toBe(401);
    expect((await call(env, 'GET', '/api/account')).status).toBe(401);
  });

  it('Passwort ändern mit App-Token: andere Sitzungen (Cookie, andere App) enden und werden getrennt, die eigene bleibt', async () => {
    const browser = new Browser(env.base);
    expect((await browser.post('/api/auth/login', { email: 'edit@sandbox.test', password: PW })).status).toBe(200);
    const other = await appToken(env, 'edit@sandbox.test');
    const mine = t.edit;
    const cOther = new NativeClient(ws(), other);
    const cMine = new NativeClient(ws(), mine);
    expect((await cOther.hello(boardId, { client: 'stachel' })).t).toBe('welcome');
    expect((await cMine.hello(boardId, { client: 'stachel' })).t).toBe('welcome');

    expect(await call(env, 'POST', '/api/account/password', { token: mine, csrf: true, body: { current: 'falsch', password: 'Neues-Passwort-77' } })).toMatchObject({ status: 403, body: { error: 'wrong_password' } });
    expect(await call(env, 'POST', '/api/account/password', { token: mine, csrf: true, body: { current: PW, password: 'kurz' } })).toMatchObject({ status: 400, body: { error: 'weak_password' } });
    const ok = await call(env, 'POST', '/api/account/password', { token: mine, csrf: true, body: { current: PW, password: 'Neues-Passwort-77' } });
    expect(ok.body).toEqual({ ok: true });

    expect((await cOther.waitClosed()).code).toBe(4401);
    await sleep(150);
    expect(cMine.closed).toBeNull();
    cMine.send({ t: 'ping' });
    expect((await cMine.next((m) => m.t === 'pong')).t).toBe('pong');
    expect((await call(env, 'GET', '/api/auth/me', { token: mine })).status).toBe(200);
    expect((await call(env, 'GET', '/api/auth/me', { token: other })).status).toBe(401);
    expect((await browser.get('/api/auth/me')).status).toBe(401);
    expect(await appLogin(env, { email: 'edit@sandbox.test', password: PW })).toMatchObject({ status: 401, body: { error: 'wrong_login' } });
    expect((await appLogin(env, { email: 'edit@sandbox.test', password: 'Neues-Passwort-77' })).status).toBe(200);
    cMine.close();
  });

  it('Konto löschen mit App-Token (Play-Store-Pflicht): falsches Passwort 403, sonst weg samt Sitzungen', async () => {
    await signUp(env, 'Weg Damit', 'weg@sandbox.test');
    const token = await appToken(env, 'weg@sandbox.test');
    const own = (await call(env, 'POST', '/api/boards', { token, csrf: true, body: { title: 'Eigenes' } })).body.board.id as string;
    const c = new NativeClient(ws(), token);
    expect((await c.hello(own, { client: 'stachel' })).t).toBe('welcome');
    expect((await call(env, 'GET', '/api/account', { token })).body.boards.map((b: { id: string }) => b.id)).toEqual([own]);
    expect(await call(env, 'POST', '/api/account/delete', { token, csrf: true, body: { password: 'falsch' } })).toMatchObject({ status: 403, body: { error: 'wrong_password' } });
    const del = await call(env, 'POST', '/api/account/delete', { token, csrf: true, body: { password: PW, boards: { [own]: 'delete' } } });
    expect(del.body).toEqual({ ok: true });
    expect((await c.waitClosed()).code).toBeGreaterThanOrEqual(4000);
    expect((await call(env, 'GET', '/api/auth/me', { token })).status).toBe(401);
    expect(await appLogin(env, { email: 'weg@sandbox.test', password: PW })).toMatchObject({ status: 401, body: { error: 'wrong_login' } });
    await waitFor(() => mailsOf(env).some((m) => m.to === 'weg@sandbox.test' && /gelöscht/i.test(m.subject)));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('Modus local: App-Links und Mail-Links', () => {
  let env: TestEnv;
  beforeAll(async () => {
    // wie die .env von stachel.intsode.com (ohne Env hat der Modus local keine App-Links, Selbst-Hosting)
    const cfg = loadConfig({
      STACHEL_AUTH: 'local',
      STACHEL_ANDROID_CERT_SHA256: FP,
      STACHEL_ANDROID_PACKAGE: 'com.intsode.stachel',
      STACHEL_IOS_APP_ID: 'Z3LV5686R8.com.intsode.stachel',
    });
    expect(cfg.androidPackage).toBe('com.intsode.stachel');
    expect(cfg.iosAppId).toBe('Z3LV5686R8.com.intsode.stachel');
    env = await startEnv({ instance: LOCAL, androidPackage: cfg.androidPackage, androidSha256: cfg.androidSha256, iosAppId: cfg.iosAppId });
  });
  afterAll(async () => {
    await env?.stop();
  });

  it('App-Links ohne Standard-Paket in beiden Modi (nur per Env); Env geht vor', () => {
    expect(loadConfig({ STACHEL_AUTH: 'org' })).toMatchObject({ androidPackage: '', iosAppId: '' });
    expect(loadConfig({ STACHEL_AUTH: 'local' })).toMatchObject({ androidPackage: '', iosAppId: '' });
    expect(loadConfig({ STACHEL_AUTH: 'local', STACHEL_ANDROID_PACKAGE: 'x.y', STACHEL_IOS_APP_ID: 'T.x.y' })).toMatchObject({ androidPackage: 'x.y', iosAppId: 'T.x.y' });
  });

  it('assetlinks.json und apple-app-site-association im Modus local (Stachel-App, /b/*, /verify/*, /reset/*)', async () => {
    const al = await call(env, 'GET', '/.well-known/assetlinks.json');
    expect(al.status).toBe(200);
    expect(al.headers.get('cache-control')).toBe('public, max-age=300');
    expect(al.body).toEqual([
      { relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'com.intsode.stachel', sha256_cert_fingerprints: [FP] } },
    ]);
    const aasa = await call(env, 'GET', '/.well-known/apple-app-site-association');
    expect(aasa.status).toBe(200);
    expect(aasa.body).toEqual({
      applinks: { details: [{ appIDs: ['Z3LV5686R8.com.intsode.stachel'], components: [{ '/': '/b/*' }, { '/': '/verify/*' }, { '/': '/reset/*' }] }] },
    });
    // /qr/:code gibt es im Modus local weiter nicht
    expect((await call(env, 'GET', '/qr/abc')).status).toBe(404);
  });

  it('Bestätigungs-Mail: {PUBLIC_URL}/verify/<token> → 302 /?verify=<token>; ungültig → 404-Seite', async () => {
    const b = new Browser(env.base);
    const before = mailsOf(env).length;
    await b.post('/api/auth/register', { name: 'Lia Link', email: 'lia@example.org', password: PW, terms: true, captcha: await captcha(b) });
    const m = await waitMail(env, 'lia@example.org', /bestätigen/, before);
    const token = /https:\/\/stachel\.example\.test\/verify\/([A-Za-z0-9_-]{43})/.exec(m.text)?.[1];
    expect(token).toBeDefined();
    expect(m.text).not.toContain('?verify=');
    expect(linkParam(m, 'verify')).toBe(token);
    const r = await call(env, 'GET', `/verify/${token}`);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(`/?verify=${token}`);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    // Umleiten verbraucht nichts: die Web-App bestätigt danach
    expect((await b.post('/api/auth/verify', { token })).body).toEqual({ ok: true, email: 'lia@example.org' });
    const bad = await call(env, 'GET', `/verify/${encodeURIComponent('kurz<x>')}`);
    expect(bad.status).toBe(404);
    expect(String(bad.body)).toContain('nicht gefunden');
  });

  it('Passwort-vergessen-Mail: {PUBLIC_URL}/reset/<token> → 302 /?reset=<token>, Reset per App-API', async () => {
    const before = mailsOf(env).length;
    expect((await call(env, 'POST', '/api/auth/forgot', { csrf: true, body: { email: 'lia@example.org' } })).status).toBe(200);
    const m = await waitMail(env, 'lia@example.org', /Passwort/, before);
    const token = /\/reset\/([A-Za-z0-9_-]{43})/.exec(m.text)?.[1];
    expect(token).toBeDefined();
    const r = await call(env, 'GET', `/reset/${token}`);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(`/?reset=${token}`);
    expect((await call(env, 'POST', '/api/auth/reset', { csrf: true, body: { token, password: 'Ganz-Neu-Und-Lang-9' } })).body).toEqual({ ok: true, email: 'lia@example.org' });
    expect((await appLogin(env, { email: 'lia@example.org', password: 'Ganz-Neu-Und-Lang-9' })).status).toBe(200);
  });

  it('/b/<id>?o=<objekt> behält das Objekt auch im Modus local', async () => {
    const r = await call(env, 'GET', '/b/abc123?o=n_8f');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/?b=abc123&o=n_8f');
  });

  it('Link-Tokens landen nicht im Log', () => {
    expect(redactUrl('/verify/abcdefghijklmnopqrstuvwxyz')).toBe('/verify/***');
    expect(redactUrl('/reset/abcdefghijklmnopqrstuvwxyz?x=1')).toBe('/reset/***?x=1');
    expect(redactUrl('/?verify=geheim&b=1')).toBe('/?verify=***&b=1');
    expect(redactUrl('/?reset=geheim')).toBe('/?reset=***');
    expect(redactUrl('/?b=abc')).toBe('/?b=abc');
  });
});
