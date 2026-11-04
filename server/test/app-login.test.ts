import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '../src/sessions.js';
import { Browser, startEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  await env?.stop();
});

const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` }, csrf: false });

/** Org-App: Einmal-Code holen. */
function appCode(e: TestEnv, token?: string) {
  return new Browser(e.base).post('/api/auth/app-code', undefined, token ? bearer(token) : { csrf: false });
}

/** WebView: Link öffnen, ohne Redirects zu folgen; Cookies landen im Browser-Jar. */
async function open(b: Browser, path: string) {
  const res = await fetch(env.base + path, {
    redirect: 'manual',
    headers: b.cookies.size ? { cookie: b.cookieHeader() } : {},
  });
  for (const c of res.headers.getSetCookie()) {
    const pair = c.split(';')[0]!;
    const i = pair.indexOf('=');
    b.cookies.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return { status: res.status, headers: res.headers, text: await res.text(), setCookies: res.headers.getSetCookie() };
}

const pathOf = (url: string) => url.replace(env.cfg.publicUrl, '');

describe('App-Login (Stachel im WebView der Org-App)', () => {
  it('Code holen → Link öffnen → angemeldet, Redirect auf /', async () => {
    const token = env.fake.addMember(70, 'Lina', 'active', true);
    const res = await appCode(env, token);
    expect(res.status).toBe(200);
    const { code, url, expires_at } = res.body;
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 Byte base64url
    expect(url).toBe(`https://stachel.example.test/auth/app?code=${code}`);
    const ttl = Date.parse(expires_at) - Date.now();
    expect(ttl).toBeGreaterThan(55_000);
    expect(ttl).toBeLessThanOrEqual(60_000);
    expect(expires_at).toMatch(/Z$/);
    expect(res.headers.get('cache-control')).toBe('no-store');

    // Nur der Hash liegt in der Datenbank.
    const rows = env.srv.db.prepare('SELECT code_hash FROM app_codes').all() as { code_hash: string }[];
    expect(rows.map((r) => r.code_hash)).toContain(sha256(code));
    expect(rows.map((r) => r.code_hash)).not.toContain(code);

    const webview = new Browser(env.base);
    const r = await open(webview, pathOf(url));
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/?app=1');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    const sessionCookie = r.setCookies.find((c) => c.startsWith('stachel_session='))!;
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/SameSite=Lax/i);

    const me = await webview.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toEqual({ key: 'm:70', name: 'Lina', isOrga: true });

    // Org-Token liegt für die Nachprüfung an der Sitzung, nicht mehr am Code.
    const s = env.srv.db
      .prepare('SELECT org_token FROM sessions WHERE id = ?')
      .get(sha256(webview.cookies.get('stachel_session')!)) as { org_token: string };
    expect(s.org_token).toBe(token);
    const c = env.srv.db.prepare('SELECT org_token, used_at FROM app_codes WHERE code_hash = ?').get(sha256(code)) as {
      org_token: string | null;
      used_at: string | null;
    };
    expect(c.org_token).toBeNull();
    expect(c.used_at).toBeTruthy();

    // Nachprüfung nutzt das gespeicherte Token: Token beim Identitätsdienst widerrufen → abgemeldet.
    env.srv.sessions.setVerifiedAt(webview.cookies.get('stachel_session')!, '2000-01-01T00:00:00.000Z');
    env.fake.revoke(token);
    expect((await webview.get('/api/auth/me')).status).toBe(401);
  });

  it('Admin-Token funktioniert auch', async () => {
    const login = await new Browser(env.base).post('/api/auth/password', { username: 'orga', password: 'geheim' });
    expect(login.status).toBe(200);
    const token = [...env.fake.tokens].find(([, v]) => v.kind === 'admin')![0];
    const res = await appCode(env, token);
    expect(res.status).toBe(200);
    const webview = new Browser(env.base);
    expect((await open(webview, pathOf(res.body.url))).status).toBe(302);
    expect((await webview.get('/api/auth/me')).body.user).toEqual({ key: 'a:orga', name: 'orga', isOrga: true });
  });

  it('zweites Einlösen → 410 mit deutscher Hinweisseite', async () => {
    const token = env.fake.addMember(71, 'Ben');
    const { url } = (await appCode(env, token)).body;
    expect((await open(new Browser(env.base), pathOf(url))).status).toBe(302);
    const other = new Browser(env.base);
    const again = await open(other, pathOf(url));
    expect(again.status).toBe(410);
    expect(again.headers.get('content-type')).toMatch(/text\/html/);
    expect(again.headers.get('cache-control')).toBe('no-store');
    expect(again.headers.get('referrer-policy')).toBe('no-referrer');
    expect(again.text).toContain('Link <em>abgelaufen</em>');
    expect(again.text).toContain('nochmal auf Stachel');
    expect(again.setCookies.some((c) => c.startsWith('stachel_session='))).toBe(false);
    expect((await other.get('/api/auth/me')).status).toBe(401);
  });

  it('abgelaufener Code (nach 60 s) → 410', async () => {
    const token = env.fake.addMember(72, 'Cem');
    const { code, url } = (await appCode(env, token)).body;
    env.srv.db
      .prepare('UPDATE app_codes SET expires_at = ? WHERE code_hash = ?')
      .run(new Date(Date.now() - 1).toISOString(), sha256(code));
    expect((await open(new Browser(env.base), pathOf(url))).status).toBe(410);
  });

  it('unbekannter, leerer oder überlanger Code → 410; HEAD verbraucht nichts', async () => {
    const b = new Browser(env.base);
    expect((await open(b, '/auth/app?code=gibtsnicht')).status).toBe(410);
    expect((await open(b, '/auth/app')).status).toBe(410);
    expect((await open(b, `/auth/app?code=${'x'.repeat(500)}`)).status).toBe(410);

    const token = env.fake.addMember(73, 'Dua');
    const { url } = (await appCode(env, token)).body;
    const head = await fetch(env.base + pathOf(url), { method: 'HEAD', redirect: 'manual' });
    expect(head.status).not.toBe(302);
    expect((await open(b, pathOf(url))).status).toBe(302);
  });

  it('Board-ID wird durchgereicht, alles andere nicht (kein Open Redirect)', async () => {
    const token = env.fake.addMember(74, 'Eva');
    const cases: [string, string][] = [
      ['AbC_12-xyz', '/?b=AbC_12-xyz&app=1'],
      ['https://evil.example', '/?app=1'],
      ['//evil.example', '/?app=1'],
      ['/\\evil.example', '/?app=1'],
      ['x%0d%0aSet-Cookie:a=b', '/?app=1'],
      ['a'.repeat(65), '/?app=1'],
    ];
    for (const [b, expected] of cases) {
      const { url } = (await appCode(env, token)).body;
      const r = await open(new Browser(env.base), `${pathOf(url)}&b=${encodeURIComponent(b)}`);
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toBe(expected);
    }
  });

  it('Objekt-ID (o) wird mit Board-ID durchgereicht, sonst verworfen', async () => {
    const token = env.fake.addMember(76, 'Ole');
    const cases: [string, string][] = [
      ['&b=AbC&o=obj_1-2&browser=1', '/?b=AbC&o=obj_1-2'],
      ['&b=AbC&o=obj_1&app=1', '/?b=AbC&o=obj_1&app=1'],
      ['&o=obj_1&browser=1', '/'],
      ['&b=AbC&o=%2F%2Fevil.example&browser=1', '/?b=AbC'],
    ];
    for (const [q, expected] of cases) {
      const { url } = (await appCode(env, token)).body;
      const r = await open(new Browser(env.base), `${pathOf(url)}${q}`);
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toBe(expected);
    }
  });

  it('alte Sitzung im WebView wird ersetzt', async () => {
    const token = env.fake.addMember(75, 'Finn');
    const webview = new Browser(env.base);
    await open(webview, pathOf((await appCode(env, token)).body.url));
    const first = webview.cookies.get('stachel_session')!;
    await open(webview, pathOf((await appCode(env, token)).body.url));
    const second = webview.cookies.get('stachel_session')!;
    expect(second).not.toBe(first);
    expect(env.srv.sessions.get(first)).toBeNull();
    expect(env.srv.sessions.get(second)).not.toBeNull();
  });

  it('Fehler: fehlendes/falsches Token → 401 invalid_token, gesperrt → 403 forbidden', async () => {
    const none = await appCode(env);
    expect(none.status).toBe(401);
    expect(none.body.error).toBe('invalid_token');
    const wrong = await appCode(env, 'falsch');
    expect(wrong.status).toBe(401);
    expect(wrong.body).toMatchObject({ ok: false, error: 'invalid_token' });
    const blocked = await appCode(env, env.fake.addMember(76, 'Gesperrt', 'blocked'));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('forbidden');
  });

  it('Fehler: Konto wartet auf Freigabe → 403 pending', async () => {
    const res = await appCode(env, env.fake.addMember(77, 'Neu', 'pending'));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('pending');
    expect(res.body.message).toMatch(/Freigabe/);
  });

  it('Fehler: Identitätsdienst nicht erreichbar → 502 org_unreachable', async () => {
    const token = env.fake.addMember(78, 'Hans');
    for (const mode of ['down', 'error'] as const) {
      env.fake.mode = mode;
      try {
        const res = await appCode(env, token);
        expect(res.status).toBe(502);
        expect(res.body.error).toBe('org_unreachable');
      } finally {
        env.fake.mode = 'ok';
      }
    }
  });

  it('braucht keinen CSRF-Header, andere POSTs weiterhin schon', async () => {
    const res = await appCode(env, env.fake.addMember(79, 'Ida'));
    expect(res.status).toBe(200);
    const other = await new Browser(env.base).post('/api/auth/logout', undefined, { csrf: false });
    expect(other.status).toBe(403);
  });
});

describe('App-Login Rate-Limit', () => {
  let own: TestEnv;
  beforeAll(async () => {
    own = await startEnv();
  });
  afterAll(async () => {
    await own?.stop();
  });

  it('app-code: 60 Versuche je 5 min und IP, danach 429 ohne Anfrage beim Identitätsdienst', async () => {
    for (let i = 0; i < 60; i++) expect((await appCode(own, 'falsch')).status).toBe(401);
    const before = own.fake.calls.me;
    const res = await appCode(own, own.fake.addMember(80, 'Jo'));
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('rate_limited');
    expect(own.fake.calls.me).toBe(before);
  });

  it('Einlösen: nach 120 Fehlversuchen je IP ist auch ein gültiger Code gesperrt (410)', async () => {
    for (let i = 0; i < 120; i++) {
      const r = await fetch(`${own.base}/auth/app?code=raten${i}`, { redirect: 'manual' });
      expect(r.status).toBe(410);
    }
    own.srv.db.prepare('DELETE FROM app_codes').run();
    // Gültigen Code direkt anlegen (app-code ist in diesem Env schon gesperrt).
    const { AppCodeStore } = await import('../src/app-login.js');
    const { code } = new AppCodeStore(own.srv.db).create({ userKey: 'm:81', name: 'Kai', isOrga: false }, 't');
    const r = await fetch(`${own.base}/auth/app?code=${code}`, { redirect: 'manual' });
    expect(r.status).toBe(410);
  });
});
