import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Browser, startEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  await env?.stop();
});

const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });

async function newPairing(b: Browser) {
  const res = await b.post('/api/auth/qr');
  expect(res.status).toBe(200);
  return res;
}

describe('QR-Login wie WhatsApp Web', () => {
  it('kompletter Ablauf: Pairing → Long-Poll → App bestätigt → Browser angemeldet', async () => {
    const browser = new Browser(env.base);
    const res = await newPairing(browser);
    const { code, url, expires_at } = res.body;
    expect(code).toMatch(/^[A-Za-z0-9_-]{32}$/); // 24 Byte base64url
    expect(url).toBe(`https://stachel.example.test/qr/${code}`);
    const ttl = Date.parse(expires_at) - Date.now();
    expect(ttl).toBeGreaterThan(110_000);
    expect(ttl).toBeLessThanOrEqual(120_000);
    expect(expires_at).toMatch(/Z$/);
    const pair = res.setCookies.find((c) => c.startsWith('stachel_pair='))!;
    expect(pair).toMatch(/HttpOnly/i);
    expect(pair).toMatch(/Max-Age=300/);
    expect(browser.cookies.get('stachel_pair')).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Long-Poll läuft, währenddessen bestätigt die App.
    const t0 = Date.now();
    const waiting = browser.get(`/api/auth/qr/${code}/wait`);
    await new Promise((r) => setTimeout(r, 150));
    const token = env.fake.addMember(42, 'Mia', 'active', false);
    const app = new Browser(env.base);
    const ok = await app.post('/api/auth/qr/approve', { code }, { ...bearer(token), csrf: false });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, name: 'Mia' });

    const w = await waiting;
    expect(Date.now() - t0).toBeLessThan(1400); // vor Ablauf des Long-Polls beantwortet
    expect(w.status).toBe(200);
    expect(w.body).toEqual({ ok: true, status: 'approved', user: { key: 'm:42', name: 'Mia', isOrga: false } });
    expect(browser.cookies.has('stachel_session')).toBe(true);
    expect(browser.cookies.has('stachel_pair')).toBe(false);
    expect(app.cookies.has('stachel_session')).toBe(false);

    const me = await browser.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.key).toBe('m:42');

    // Genau einmal einlösbar
    const again = await app.post('/api/auth/qr/approve', { code }, bearer(token));
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already_used');
  });

  it('Pairing ist nur einmal einlösbar (zweiter Wait → 410)', async () => {
    const browser = new Browser(env.base);
    const { code } = (await newPairing(browser)).body;
    const pairCookie = browser.cookies.get('stachel_pair')!;
    const token = env.fake.addMember(43, 'Ole');
    expect((await new Browser(env.base).post('/api/auth/qr/approve', { code }, bearer(token))).status).toBe(200);
    expect((await browser.get(`/api/auth/qr/${code}/wait`)).body.status).toBe('approved');
    browser.cookies.set('stachel_pair', pairCookie);
    const second = await browser.get(`/api/auth/qr/${code}/wait`);
    expect(second.status).toBe(410);
    expect(second.body.error).toBe('expired');
  });

  it('Long-Poll ohne Bestätigung → pending nach Wartezeit', async () => {
    const browser = new Browser(env.base);
    const { code } = (await newPairing(browser)).body;
    const t0 = Date.now();
    const w = await browser.get(`/api/auth/qr/${code}/wait`);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1400);
    expect(w.status).toBe(200);
    expect(w.body).toEqual({ ok: true, status: 'pending' });
  });

  it('wrong_browser: anderer Browser ohne passendes Pair-Cookie bekommt 403 und kann nicht einlösen', async () => {
    const owner = new Browser(env.base);
    const { code } = (await newPairing(owner)).body;
    const thief = new Browser(env.base);
    await newPairing(thief); // hat ein eigenes, aber falsches Pair-Cookie
    const token = env.fake.addMember(44, 'Paul');
    expect((await new Browser(env.base).post('/api/auth/qr/approve', { code }, bearer(token))).status).toBe(200);

    const stolen = await thief.get(`/api/auth/qr/${code}/wait`);
    expect(stolen.status).toBe(403);
    expect(stolen.body.error).toBe('wrong_browser');
    expect(thief.cookies.has('stachel_session')).toBe(false);

    const noCookie = await new Browser(env.base).get(`/api/auth/qr/${code}/wait`);
    expect(noCookie.status).toBe(403);

    // Der richtige Browser kann danach noch einlösen.
    const w = await owner.get(`/api/auth/qr/${code}/wait`);
    expect(w.body.status).toBe('approved');
  });

  it('expired: abgelaufenes Pairing → approve 410, wait 410', async () => {
    const browser = new Browser(env.base);
    const { code } = (await newPairing(browser)).body;
    env.srv.db
      .prepare('UPDATE pairings SET expires_at = ? WHERE code = ?')
      .run(new Date(Date.now() - 1000).toISOString(), code);
    const token = env.fake.addMember(45, 'Ina');
    const a = await new Browser(env.base).post('/api/auth/qr/approve', { code }, bearer(token));
    expect(a.status).toBe(410);
    expect(a.body.error).toBe('expired');
    const w = await browser.get(`/api/auth/qr/${code}/wait`);
    expect(w.status).toBe(410);
    expect(w.body.error).toBe('expired');
  });

  it('Long-Poll endet beim Ablauf des Codes mit 410', async () => {
    const own = await startEnv({ qrWaitMs: 5000 });
    try {
      const browser = new Browser(own.base);
      const { code } = (await newPairing(browser)).body;
      own.srv.db
        .prepare('UPDATE pairings SET expires_at = ? WHERE code = ?')
        .run(new Date(Date.now() + 300).toISOString(), code);
      const t0 = Date.now();
      const w = await browser.get(`/api/auth/qr/${code}/wait`);
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(w.status).toBe(410);
    } finally {
      await own.stop();
    }
  });

  it('neuer QR im selben Browser: alter Code verfällt', async () => {
    const browser = new Browser(env.base);
    const oldCode = (await newPairing(browser)).body.code;
    const newCode = (await newPairing(browser)).body.code;
    expect(newCode).not.toBe(oldCode);
    const token = env.fake.addMember(51, 'Tom');
    const app = new Browser(env.base);
    expect((await app.post('/api/auth/qr/approve', { code: oldCode }, bearer(token))).status).toBe(404);
    expect((await app.post('/api/auth/qr/approve', { code: newCode }, bearer(token))).status).toBe(200);
  });

  it('unbekannter Code → 404 unknown_code', async () => {
    const token = env.fake.addMember(46, 'Udo');
    const r = await new Browser(env.base).post('/api/auth/qr/approve', { code: 'gibtsnicht' }, bearer(token));
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('unknown_code');
  });

  it('ungültiges Token → 401 invalid_token; wartendes Konto → 403 pending; gesperrt → 403 forbidden', async () => {
    const browser = new Browser(env.base);
    const { code } = (await newPairing(browser)).body;
    const app = new Browser(env.base);

    const r1 = await app.post('/api/auth/qr/approve', { code }, bearer('falsch'));
    expect(r1.status).toBe(401);
    expect(r1.body.error).toBe('invalid_token');

    const r2 = await app.post('/api/auth/qr/approve', { code });
    expect(r2.status).toBe(401);

    const pending = env.fake.addMember(47, 'Neu', 'pending');
    const r3 = await app.post('/api/auth/qr/approve', { code }, bearer(pending));
    expect(r3.status).toBe(403);
    expect(r3.body.error).toBe('pending');
    expect(r3.body.message).toContain('Freigabe');

    const blocked = env.fake.addMember(48, 'Weg', 'blocked');
    const r4 = await app.post('/api/auth/qr/approve', { code }, bearer(blocked));
    expect(r4.status).toBe(403);
    expect(r4.body.error).toBe('forbidden');

    // Code ist durch die Fehlversuche nicht verbraucht.
    const good = env.fake.addMember(49, 'Gut');
    expect((await app.post('/api/auth/qr/approve', { code }, bearer(good))).status).toBe(200);
  });

  it('Admin-Token der App wird auch akzeptiert', async () => {
    const browser = new Browser(env.base);
    const { code } = (await newPairing(browser)).body;
    const login = await fetch(env.fake.loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'orga', password: 'geheim' }),
    });
    const { token } = (await login.json()) as { token: string };
    expect((await new Browser(env.base).post('/api/auth/qr/approve', { code }, bearer(token))).status).toBe(200);
    const w = await browser.get(`/api/auth/qr/${code}/wait`);
    expect(w.body.user).toEqual({ key: 'a:orga', name: 'orga', isOrga: true });
  });

  it('Identitätsdienst nicht erreichbar beim approve → 502, Code bleibt nutzbar', async () => {
    const browser = new Browser(env.base);
    const { code } = (await newPairing(browser)).body;
    const token = env.fake.addMember(50, 'Lea');
    env.fake.mode = 'down';
    try {
      const r = await new Browser(env.base).post('/api/auth/qr/approve', { code }, bearer(token));
      expect(r.status).toBe(502);
    } finally {
      env.fake.mode = 'ok';
    }
    expect((await new Browser(env.base).post('/api/auth/qr/approve', { code }, bearer(token))).status).toBe(200);
  });

  it('GET /qr/:code liefert die deutsche Hinweisseite', async () => {
    const res = await new Browser(env.base).get('/qr/irgendwas');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.body).toContain('Organisation-App');
    expect(res.body).toContain('Gehe dort zu Stachel');
    expect(res.body).toContain('lang="de"');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    const font = await fetch(`${env.base}/qr-fonts/barlow-400.woff2`);
    expect(font.status).toBe(200);
    expect(font.headers.get('content-type')).toBe('font/woff2');
    expect((await font.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    expect((await fetch(`${env.base}/qr-fonts/..%2Fpackage.json`)).status).toBe(404);
  });
});
