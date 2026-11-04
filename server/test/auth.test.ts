import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Browser, loginAdmin, loginMember, startEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  await env?.stop();
});

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

describe('Passwort-Login', () => {
  it('meldet mit Passwort-Login der Organisation an und setzt das Session-Cookie', async () => {
    const b = new Browser(env.base);
    const res = await b.post('/api/auth/password', { username: 'orga', password: 'geheim' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, user: { key: 'a:orga', name: 'orga', isOrga: true } });
    const cookie = res.setCookies.find((c) => c.startsWith('stachel_session='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=2592000/);
    expect(cookie).not.toMatch(/Secure/);
    expect(b.cookies.get('stachel_session')).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const me = await b.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.key).toBe('a:orga');
    expect(me.headers.get('cache-control')).toBe('no-store');
  });

  it('lehnt falsches Passwort mit 401 invalid_credentials ab', async () => {
    const b = new Browser(env.base);
    const res = await b.post('/api/auth/password', { username: 'orga', password: 'falsch' });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ ok: false, error: 'invalid_credentials' });
    expect(typeof res.body.message).toBe('string');
    expect(b.cookies.size).toBe(0);
  });

  it('leere Eingaben → 400 invalid_input', async () => {
    const res = await new Browser(env.base).post('/api/auth/password', { username: '', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_input');
  });

  it('Identitätsdienst nicht erreichbar → 502 org_unreachable', async () => {
    env.fake.mode = 'down';
    try {
      const res = await new Browser(env.base).post('/api/auth/password', { username: 'orga', password: 'geheim' });
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('org_unreachable');
    } finally {
      env.fake.mode = 'ok';
    }
  });

  it('ohne Sitzung: /me → 401 not_logged_in', async () => {
    const res = await new Browser(env.base).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ ok: false, error: 'not_logged_in' });
  });

  it('Logout löscht Sitzung und Cookie', async () => {
    const b = await loginAdmin(env);
    const cookie = b.cookies.get('stachel_session')!;
    const out = await b.post('/api/auth/logout');
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true });
    expect(b.cookies.has('stachel_session')).toBe(false);
    // Auch mit dem alten Cookie-Wert ist die Sitzung weg.
    b.cookies.set('stachel_session', cookie);
    expect((await b.get('/api/auth/me')).status).toBe(401);
  });

  it('kaputtes JSON → 400 im Vertragsformat', async () => {
    const res = await new Browser(env.base).req('POST', '/api/auth/password', {
      body: '{kaputt',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, error: 'invalid_input' });
  });
});

describe('CSRF-Header X-Stachel', () => {
  it('POST ohne Header → 403 csrf', async () => {
    const b = await loginAdmin(env);
    const r1 = await b.req('POST', '/api/boards', { json: { title: 'x' }, csrf: false });
    expect(r1.status).toBe(403);
    expect(r1.body.error).toBe('csrf');
    const r2 = await b.req('POST', '/api/auth/logout', { csrf: false });
    expect(r2.status).toBe(403);
    const r3 = await new Browser(env.base).req('POST', '/api/auth/password', {
      json: { username: 'orga', password: 'geheim' },
      csrf: false,
    });
    expect(r3.status).toBe(403);
    // Sitzung lebt noch
    expect((await b.get('/api/auth/me')).status).toBe(200);
  });

  it('falscher Header-Wert → 403; GET braucht keinen Header', async () => {
    const b = await loginAdmin(env);
    const r = await b.req('DELETE', '/api/boards/abc', { csrf: false, headers: { 'X-Stachel': '0' } });
    expect(r.status).toBe(403);
    expect((await b.get('/api/boards')).status).toBe(200);
  });

  it('approve aus der App braucht keinen Header', async () => {
    const r = await new Browser(env.base).post('/api/auth/qr/approve', { code: 'x' }, { csrf: false });
    expect(r.status).toBe(401); // Token fehlt, aber kein csrf-Fehler
    expect(r.body.error).toBe('invalid_token');
  });
});

describe('Nachprüfen alle 6 h', () => {
  it('innerhalb von 6 h wird der Identitätsdienst nicht gefragt', async () => {
    const b = await loginAdmin(env);
    const before = env.fake.calls.me;
    await b.get('/api/auth/me');
    await b.get('/api/auth/me');
    expect(env.fake.calls.me).toBe(before);
  });

  it('Token ungültig (401) → Sitzung gelöscht, abgemeldet', async () => {
    const token = env.fake.addMember(11, 'Rike');
    const b = await loginMember(env, token);
    const cookie = b.cookies.get('stachel_session')!;
    env.srv.sessions.setVerifiedAt(cookie, hoursAgo(7));
    env.fake.revoke(token);
    const before = env.fake.calls.me;
    const me = await b.get('/api/auth/me');
    expect(env.fake.calls.me).toBe(before + 1);
    expect(me.status).toBe(401);
    expect(me.body.error).toBe('not_logged_in');
    expect(b.cookies.has('stachel_session')).toBe(false);
    b.cookies.set('stachel_session', cookie);
    expect((await b.get('/api/boards')).status).toBe(401);
  });

  it('gesperrtes Mitglied → abgemeldet', async () => {
    const token = env.fake.addMember(12, 'Gesperrt');
    const b = await loginMember(env, token);
    env.srv.sessions.setVerifiedAt(b.cookies.get('stachel_session')!, hoursAgo(7));
    env.fake.tokens.set(token, { kind: 'member', id: 12, name: 'Gesperrt', status: 'blocked' });
    expect((await b.get('/api/auth/me')).status).toBe(401);
  });

  it('Netzfehler → Sitzung bleibt gültig', async () => {
    const b = await loginAdmin(env);
    const cookie = b.cookies.get('stachel_session')!;
    const old = hoursAgo(7);
    env.srv.sessions.setVerifiedAt(cookie, old);
    env.fake.mode = 'down';
    try {
      const me = await b.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(env.srv.sessions.get(cookie)!.verifiedAt).toBe(old);
    } finally {
      env.fake.mode = 'ok';
    }
  });

  it('HTTP 500 vom Identitätsdienst → Sitzung bleibt gültig', async () => {
    const b = await loginAdmin(env);
    env.srv.sessions.setVerifiedAt(b.cookies.get('stachel_session')!, hoursAgo(7));
    env.fake.mode = 'error';
    try {
      expect((await b.get('/api/auth/me')).status).toBe(200);
    } finally {
      env.fake.mode = 'ok';
    }
  });

  it('erfolgreiche Nachprüfung aktualisiert verified_at und Name', async () => {
    const token = env.fake.addMember(13, 'Alt');
    const b = await loginMember(env, token);
    const cookie = b.cookies.get('stachel_session')!;
    env.srv.sessions.setVerifiedAt(cookie, hoursAgo(7));
    env.fake.tokens.set(token, { kind: 'member', id: 13, name: 'Neu', status: 'active', orga: true });
    const me = await b.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toEqual({ key: 'm:13', name: 'Neu', isOrga: true });
    const s = env.srv.sessions.get(cookie)!;
    expect(Date.now() - Date.parse(s.verifiedAt)).toBeLessThan(10_000);
  });
});

describe('Rate-Limit', () => {
  it('Passwort-Login: 10 Fehlversuche / 5 min pro IP, dann 429 (auch mit richtigem Passwort)', async () => {
    const own = await startEnv();
    try {
      const b = new Browser(own.base);
      for (let i = 0; i < 10; i++) {
        const r = await b.post('/api/auth/password', { username: 'orga', password: 'falsch' });
        expect(r.status).toBe(401);
      }
      const r = await b.post('/api/auth/password', { username: 'orga', password: 'geheim' });
      expect(r.status).toBe(429);
      expect(r.body).toMatchObject({ ok: false, error: 'rate_limited' });
      expect(own.fake.calls.login).toBe(10);
    } finally {
      await own.stop();
    }
  });

  it('approve: 30 Versuche / 5 min pro IP, dann 429', async () => {
    const own = await startEnv();
    try {
      const app = new Browser(own.base);
      for (let i = 0; i < 30; i++) {
        const r = await app.post('/api/auth/qr/approve', { code: 'x' }, { headers: { Authorization: 'Bearer kaputt' } });
        expect(r.status).toBe(401);
      }
      const r = await app.post('/api/auth/qr/approve', { code: 'x' }, { headers: { Authorization: 'Bearer kaputt' } });
      expect(r.status).toBe(429);
      expect(r.body.error).toBe('rate_limited');
    } finally {
      await own.stop();
    }
  });
});
