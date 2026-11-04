// Selbst-Hosting (docs/selfhosting.md): Standardwerte ohne Betreiber-Vorgaben, Instanz ohne Mailserver (Konten sofort
// aktiv bzw. Links im Log), erste Registrierung bei STACHEL_REGISTRATION=invite, Verwaltung mit `stachel-admin`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAdmin } from '../src/admin.js';
import { loadConfig } from '../src/config.js';
import { loadInstance } from '../src/instance.js';
import { LogMailer } from '../src/mailer.js';
import { Browser, startEnv, type TestEnv } from './helpers.js';
import { captcha, LOCAL, PW } from './local-helpers.js';

/** wie ein frisches `docker run` ohne SMTP: Modus local, Mails nur ins Log */
const NO_SMTP = { ...loadInstance({ STACHEL_AUTH: 'local' }), captchaMax: 3000 };

async function register(env: TestEnv, name: string, email: string) {
  const b = new Browser(env.base);
  const r = await b.post('/api/auth/register', { name, email, password: PW, terms: true, captcha: await captcha(b) });
  return { b, r };
}

function admin(env: TestEnv, ...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runAdmin(args, env.cfg, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('Standardwerte ohne Umgebung', () => {
  it('keine Betreiber-Adressen: lokale PUBLIC_URL, kein Identitätsdienst, Secure-Cookies nur bei https', () => {
    const c = loadConfig({ PORT: '8080' });
    expect(c.publicUrl).toBe('http://localhost:8080');
    expect(c.cookieSecure).toBe(false);
    expect(c.orgIdentityUrl).toBe('');
    expect(loadConfig({ PUBLIC_URL: 'https://board.example.org/' })).toMatchObject({ publicUrl: 'https://board.example.org', cookieSecure: true });
    expect(loadConfig({ PUBLIC_URL: 'https://board.example.org', COOKIE_SECURE: 'false' }).cookieSecure).toBe(false);
    // Modus local: keine App-Links fremder Apps
    expect(loadConfig({ STACHEL_AUTH: 'local' })).toMatchObject({ androidPackage: '', iosAppId: '' });
  });

  it('E-Mail-Bestätigung: Standard an, sobald Mails zugestellt werden; per Env übersteuerbar', () => {
    expect(loadInstance({ STACHEL_AUTH: 'local' }).requireVerification).toBe(false);
    expect(loadInstance({ STACHEL_AUTH: 'local', STACHEL_SMTP_HOST: 'smtp.example.org' }).requireVerification).toBe(true);
    expect(loadInstance({ STACHEL_AUTH: 'local', STACHEL_MAIL_MODE: 'log' }).requireVerification).toBe(true);
    expect(loadInstance({ STACHEL_AUTH: 'local', STACHEL_REQUIRE_VERIFICATION: '1' }).requireVerification).toBe(true);
    expect(loadInstance({ STACHEL_AUTH: 'local', STACHEL_SMTP_HOST: 'smtp.example.org', STACHEL_REQUIRE_VERIFICATION: '0' }).requireVerification).toBe(false);
  });

  it('Mail-Log ohne SMTP schreibt die Links ins Server-Log', async () => {
    const lines: string[] = [];
    const m = new LogMailer(null, (l) => lines.push(l), true);
    await m.send({ to: 'a@example.org', subject: 'Bestätigen', text: 'Hier klicken: https://x.example/verify/abc\nDanke', html: '' });
    expect(lines).toEqual(['[mail-log] an a***@example.org: Bestätigen – https://x.example/verify/abc']);
  });
});

describe('Instanz ohne Mailserver (Konten sofort aktiv)', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startEnv({ instance: NO_SMTP });
  });
  afterAll(async () => {
    await env?.stop();
  });

  it('/api/instance meldet verification: false', async () => {
    expect((await new Browser(env.base).get('/api/instance')).body).toMatchObject({ auth: 'local', verification: false });
  });

  it('registrieren → sofort anmelden, Board anlegen; dieselbe Adresse nochmal → 409', async () => {
    const { b, r } = await register(env, 'Ada', 'ada@example.org');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, verified: true });
    const l = await b.post('/api/auth/login', { email: 'ada@example.org', password: PW });
    expect(l.status).toBe(200);
    const created = await b.post('/api/boards', { title: 'Erstes Board' });
    expect(created.status).toBe(201);
    const again = await register(env, 'Ada 2', 'ada@example.org');
    expect(again.r.status).toBe(409);
    expect(again.r.body.error).toBe('email_taken');
  });
});

describe('Bestätigung an, kein Mailserver: stachel-admin', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startEnv({ instance: { ...NO_SMTP, requireVerification: true, registration: 'invite' } });
  });
  afterAll(async () => {
    await env?.stop();
  });

  it('invite: das erste Konto darf sich registrieren, danach nur mit Einladung', async () => {
    expect((await register(env, 'Erste', 'erste@example.org')).r.status).toBe(200);
    const second = await register(env, 'Zweite', 'zweite@example.org');
    expect(second.r.status).toBe(403);
    expect(second.r.body.error).toBe('registration_closed');
  });

  it('users / verify / reset-link', async () => {
    const b = new Browser(env.base);
    expect((await b.post('/api/auth/login', { email: 'erste@example.org', password: PW })).body.error).toBe('not_verified');
    expect(admin(env, 'users').out).toMatch(/^erste@example\.org\tErste\toffen\t/);
    const v = admin(env, 'verify', 'Erste@Example.org');
    expect(v).toMatchObject({ code: 0 });
    expect((await b.post('/api/auth/login', { email: 'erste@example.org', password: PW })).status).toBe(200);
    expect(admin(env, 'users').out).toMatch(/\tbestätigt\t/);

    const link = admin(env, 'reset-link', 'erste@example.org');
    expect(link.code).toBe(0);
    const token = /\/reset\/([A-Za-z0-9_-]+)$/.exec(link.out)?.[1];
    expect(link.out.startsWith(`${env.cfg.publicUrl}/reset/`)).toBe(true);
    const neu = 'Kaktusblüte-Neunzehn-7';
    expect((await new Browser(env.base).post('/api/auth/reset', { token, password: neu })).status).toBe(200);
    expect((await new Browser(env.base).post('/api/auth/login', { email: 'erste@example.org', password: neu })).status).toBe(200);
  });

  it('Fehlerfälle: unbekanntes Konto, unbekannter Befehl, Hilfe', () => {
    expect(admin(env, 'verify', 'niemand@example.org')).toMatchObject({ code: 1 });
    expect(admin(env, 'quatsch').code).toBe(1);
    expect(admin(env, 'help')).toMatchObject({ code: 0 });
    expect(admin(env).code).toBe(1);
  });
});

describe('stachel-admin im Modus org', () => {
  it('verweigert (es gibt keine eigenen Konten)', () => {
    const err: string[] = [];
    const code = runAdmin(['users'], loadConfig({ STACHEL_AUTH: 'org' }, { dataDir: 'unbenutzt' }), { out: () => {}, err: (l) => err.push(l) });
    expect(code).toBe(2);
    expect(err[0]).toMatch(/STACHEL_AUTH=local/);
  });
});

// LOCAL (Tests mit Mail-Log) behält die Bestätigung
it('Test-Instanz LOCAL verlangt weiter die Bestätigung', () => {
  expect(LOCAL.requireVerification).toBe(true);
});
