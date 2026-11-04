// Modus local (STACHEL_AUTH=local): eigene Konten, Captcha, Bestätigung, Passwort vergessen, Konto löschen.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { solveCaptcha } from '../src/captcha.js';
import { passwordProblem } from '../src/passwords.js';
import { Browser, startEnv, waitFor, type TestEnv } from './helpers.js';
import { captcha, LOCAL, linkParam, mailsOf, PW, signUp, waitMail } from './local-helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv({ instance: LOCAL });
});
afterAll(async () => {
  await env?.stop();
});

describe('Passwort-Regeln', () => {
  it('lehnt kurze, häufige, Folgen und E-Mail im Passwort ab', () => {
    expect(passwordProblem('kurz')).toMatch(/mindestens/);
    expect(passwordProblem('passwort123')).toMatch(/verbreitet/);
    expect(passwordProblem('Passwort2024!')).toMatch(/verbreitet/);
    expect(passwordProblem('1234567890')).not.toBeNull();
    expect(passwordProblem('qwertzuiop')).not.toBeNull();
    expect(passwordProblem('aaaaaaaaaaaa')).not.toBeNull();
    expect(passwordProblem('mara.lindner-geheim', { email: 'mara.lindner@example.org' })).toMatch(/E-Mail/);
    expect(passwordProblem(PW, { email: 'x@example.org', name: 'Mara' })).toBeNull();
  });
});

describe('Modus local: Instanz und Org-Wege', () => {
  it('/api/instance meldet local, Org-Anmeldung und App-Links gibt es nicht', async () => {
    const b = new Browser(env.base);
    const i = await b.get('/api/instance');
    expect(i.body).toMatchObject({ ok: true, auth: 'local', brand: 'Stachel Test', registration: 'open' });
    expect((await b.post('/api/auth/password', { username: 'orga', password: 'geheim' })).status).toBe(404);
    expect((await b.post('/api/auth/qr')).status).toBe(404);
    // App-Links gibt es auch im Modus local (für die Stachel-App), aber ohne /qr/*
    const aasa = await b.get('/.well-known/apple-app-site-association');
    expect(aasa.body.applinks.details[0].components).toEqual([{ '/': '/b/*' }, { '/': '/verify/*' }, { '/': '/reset/*' }]);
    expect((await b.get('/qr/abc')).status).toBe(404);
  });
});

describe('Registrieren', () => {
  it('ohne bzw. mit falschem Captcha → 400, gelöstes Captcha nur einmal gültig', async () => {
    const b = new Browser(env.base);
    const body = { name: 'Ida', email: 'ida@example.org', password: PW, terms: true };
    expect((await b.post('/api/auth/register', body)).body.error).toBe('captcha_invalid');
    const c = (await b.get('/api/auth/captcha')).body;
    const bad = Buffer.from(JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, number: -1, salt: c.salt, signature: c.signature })).toString('base64');
    expect((await b.post('/api/auth/register', { ...body, captcha: bad })).body.error).toBe('captcha_invalid');
    const forged = solveCaptcha({ ...c, signature: 'a'.repeat(64) })!;
    expect((await b.post('/api/auth/register', { ...body, captcha: forged })).body.error).toBe('captcha_invalid');
    const ok = solveCaptcha(c)!;
    expect((await b.post('/api/auth/register', { ...body, captcha: ok })).status).toBe(200);
    // dieselbe Lösung nochmal: verbraucht
    const again = await b.post('/api/auth/register', { ...body, email: 'ida2@example.org', captcha: ok });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('captcha_invalid');
  });

  it('Pflichtangaben: Nutzungsbedingungen + 18, gültige Adresse, starkes Passwort', async () => {
    const b = new Browser(env.base);
    const base = { name: 'Jo', email: 'jo@example.org', password: PW, terms: true };
    expect((await b.post('/api/auth/register', { ...base, terms: false, captcha: await captcha(b) })).body.error).toBe('terms_required');
    // alte Clients mit dem früheren Datenschutz-Häkchen reichen nicht mehr (CR-1: keine „Zustimmung“ zur Erklärung)
    expect((await b.post('/api/auth/register', { name: 'Jo', email: 'jo@example.org', password: PW, privacy: true, captcha: await captcha(b) })).body.error).toBe('terms_required');
    expect((await b.post('/api/auth/register', { ...base, email: 'kein-at', captcha: await captcha(b) })).body.error).toBe('invalid_email');
    expect((await b.post('/api/auth/register', { ...base, password: 'hallo12345', captcha: await captcha(b) })).body.error).toBe('weak_password');
  });

  it('Honigtopf-Feld gefüllt: Antwort wie Erfolg, aber kein Konto und keine Mail', async () => {
    const b = new Browser(env.base);
    const before = mailsOf(env).length;
    const r = await b.post('/api/auth/register', { name: 'Bot', email: 'bot@example.org', password: PW, terms: true, website: 'http://spam', captcha: await captcha(b) });
    expect(r.status).toBe(200);
    await new Promise((res) => setTimeout(res, 200));
    expect(mailsOf(env).slice(before).filter((m) => m.to === 'bot@example.org')).toHaveLength(0);
    expect(env.srv.db.prepare('SELECT 1 FROM accounts WHERE email = ?').get('bot@example.org')).toBeUndefined();
  });

  it('Bestätigung: vorher kein Login, Link genau einmal, Token nur gehasht gespeichert', async () => {
    const b = new Browser(env.base);
    const before = mailsOf(env).length;
    await b.post('/api/auth/register', { name: 'Lena Berg', email: 'Lena@Example.org', password: PW, terms: true, captcha: await captcha(b) });
    const m = await waitMail(env, 'lena@example.org', /bestätigen/, before);
    expect(m.text).toContain('Hallo Lena Berg');
    const token = linkParam(m, 'verify');
    expect(token.length).toBeGreaterThan(30);
    const stored = env.srv.db.prepare('SELECT hash FROM account_tokens').all() as { hash: string }[];
    expect(stored.some((r) => r.hash === token)).toBe(false);

    const early = await b.post('/api/auth/login', { email: 'lena@example.org', password: PW });
    expect(early.status).toBe(403);
    expect(early.body.error).toBe('not_verified');
    const wrong = await b.post('/api/auth/login', { email: 'lena@example.org', password: 'falsch-falsch-falsch' });
    expect(wrong.status).toBe(401);

    expect((await b.post('/api/auth/verify', { token })).body).toMatchObject({ ok: true, email: 'lena@example.org' });
    expect((await b.post('/api/auth/verify', { token })).status).toBe(410);
    const ok = await b.post('/api/auth/login', { email: 'LENA@example.org', password: PW });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ name: 'Lena Berg', isOrga: false });
    expect(ok.body.user.key).toMatch(/^u:/);
    expect((await b.get('/api/auth/me')).body.user.name).toBe('Lena Berg');
  });

  it('keine Konto-Aufzählung: zweite Registrierung antwortet gleich, die Mail sagt „schon ein Konto“', async () => {
    await signUp(env, 'Pia', 'pia@example.org');
    const b = new Browser(env.base);
    const before = mailsOf(env).length;
    const dup = await b.post('/api/auth/register', { name: 'Fremd', email: 'pia@example.org', password: 'Anderes-Passwort-99', terms: true, captcha: await captcha(b) });
    const fresh = await b.post('/api/auth/register', { name: 'Neu', email: 'neu@example.org', password: PW, terms: true, captcha: await captcha(b) });
    expect(dup.status).toBe(fresh.status);
    expect(dup.body).toEqual(fresh.body);
    const m = await waitMail(env, 'pia@example.org', /schon ein Konto/, before);
    expect(m.text).not.toContain('Anderes-Passwort');
    // altes Passwort gilt weiter
    expect((await b.post('/api/auth/login', { email: 'pia@example.org', password: PW })).status).toBe(200);
  });

  it('Bestätigungsmail erneut senden: gleiche Antwort für unbekannte Adressen', async () => {
    const b = new Browser(env.base);
    const before = mailsOf(env).length;
    await b.post('/api/auth/register', { name: 'Tom', email: 'tom@example.org', password: PW, terms: true, captcha: await captcha(b) });
    await waitMail(env, 'tom@example.org', /bestätigen/, before);
    const r1 = await b.post('/api/auth/resend', { email: 'tom@example.org' });
    const r2 = await b.post('/api/auth/resend', { email: 'gibtsnicht@example.org' });
    expect(r1.body).toEqual(r2.body);
    await waitFor(() => mailsOf(env).slice(before).filter((m) => m.to === 'tom@example.org').length === 2);
  });
});

describe('Anmelden und Passwort', () => {
  it('Sperre nach 10 Fehlversuchen je E-Mail', async () => {
    await signUp(env, 'Max', 'max@example.org');
    const b = new Browser(env.base);
    // jedes Mal eine andere Herkunft (X-Forwarded-For, 127.0.0.1 ist vertrauenswürdiger Proxy): nur die Sperre je E-Mail greift
    for (let i = 0; i < 10; i++) {
      const r = await b.post('/api/auth/login', { email: 'max@example.org', password: `falsch-${i}-xxxxx` }, { headers: { 'X-Forwarded-For': `198.51.100.${i + 1}` } });
      expect(r.status).toBe(401);
    }
    const blocked = await b.post('/api/auth/login', { email: 'max@example.org', password: PW }, { headers: { 'X-Forwarded-For': '198.51.100.99' } });
    expect(blocked.status).toBe(429);
    // andere Konten sind nicht betroffen
    await signUp(env, 'Mia', 'mia@example.org');
  });

  it('Passwort vergessen: gleiche Antwort für alle, Link setzt neues Passwort und beendet Sitzungen', async () => {
    // eigene Umgebung: die Login-Sperre des vorigen Tests gilt je IP
    const e2 = await startEnv({ instance: LOCAL });
    try {
      const old = await signUp(e2, 'Ronja', 'ronja@example.org');
      const b = new Browser(e2.base);
      const before = mailsOf(e2).length;
      const r1 = await b.post('/api/auth/forgot', { email: 'ronja@example.org' });
      const r2 = await b.post('/api/auth/forgot', { email: 'niemand@example.org' });
      expect(r1.status).toBe(200);
      expect(r1.body).toEqual(r2.body);
      const m = await waitMail(e2, 'ronja@example.org', /zurücksetzen/, before);
      expect(mailsOf(e2).some((x) => x.to === 'niemand@example.org')).toBe(false);
      const token = linkParam(m, 'reset');
      expect((await b.post('/api/auth/reset', { token, password: 'kurz' })).body.error).toBe('weak_password');
      expect((await b.post('/api/auth/reset', { token, password: 'Neues-Kaktus-Passwort' })).status).toBe(200);
      expect((await b.post('/api/auth/reset', { token, password: 'Noch-Ein-Passwort-1' })).status).toBe(410);
      expect((await old.get('/api/auth/me')).status).toBe(401);
      expect((await b.post('/api/auth/login', { email: 'ronja@example.org', password: PW })).status).toBe(401);
      expect((await b.post('/api/auth/login', { email: 'ronja@example.org', password: 'Neues-Kaktus-Passwort' })).status).toBe(200);
    } finally {
      await e2.stop();
    }
  });

  it('Konto: Name ändern, Passwort ändern (andere Sitzungen enden), CSRF-Header nötig', async () => {
    const e2 = await startEnv({ instance: LOCAL });
    try {
      const a = await signUp(e2, 'Ella', 'ella@example.org');
      const other = new Browser(e2.base);
      await other.post('/api/auth/login', { email: 'ella@example.org', password: PW });
      expect((await a.req('PATCH', '/api/account', { json: { name: 'Ella M.' }, csrf: false })).status).toBe(403);
      expect((await a.req('PATCH', '/api/account', { json: { name: 'Ella M.' } })).body.user.name).toBe('Ella M.');
      expect((await a.get('/api/auth/me')).body.user.name).toBe('Ella M.');
      expect((await a.post('/api/account/password', { current: 'falsch', password: 'Ganz-Neues-Passwort' })).status).toBe(403);
      expect((await a.post('/api/account/password', { current: PW, password: 'Ganz-Neues-Passwort' })).status).toBe(200);
      expect((await a.get('/api/auth/me')).status).toBe(200);
      expect((await other.get('/api/auth/me')).status).toBe(401);
    } finally {
      await e2.stop();
    }
  });
});
