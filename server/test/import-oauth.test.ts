// „Mit Miro verbinden“ (OAuth, PKCE, state, Bestätigungsseite) und gespeicherte Verbindungen (verschlüsselt, an die
// Person gebunden, Widerruf, Konto löschen): server/src/import/miro/oauth.ts, links.ts, connections.ts, routes.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { importKey, IMPORT_SECRET_FILE, ImportLinks } from '../src/import/links.js';
import { authorizeUrl, OauthStates, pkcePair, sha256, STATE_TTL_MS } from '../src/import/miro/oauth.js';
import { redactUrl } from '../src/app.js';
import { Browser, loginAdmin, loginMember } from './helpers.js';
import { PUBLIC_URL, sampleBoard, startImportEnv, type ImportEnv } from './import-helpers.js';

let env: ImportEnv | null = null;
afterEach(async () => {
  await env?.stop();
  env = null;
});

/** Freigabe bei Miro „durchklicken“: authorize-Adresse aufrufen, Rückruf-Adresse (unter PUBLIC_URL) auf den Testserver umbiegen */
async function authorize(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'manual' });
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.get('location')!);
  expect(loc.origin).toBe(PUBLIC_URL);
  return `${loc.pathname}${loc.search}`;
}

/** GET ohne Weiterleitungen zu folgen (die Web-App liegt unter PUBLIC_URL), mit den Cookies des Browsers */
async function visit(b: Browser, p: string): Promise<{ status: number; location: string | null; body: string; headers: Headers }> {
  const res = await fetch(`${(b as unknown as { base: string }).base}${p}`, {
    redirect: 'manual',
    headers: b.cookies.size ? { cookie: b.cookieHeader() } : {},
  });
  return { status: res.status, location: res.headers.get('location'), body: await res.text(), headers: res.headers };
}

describe('state und PKCE', () => {
  it('state einmalig, nach 10 min abgelaufen, nonce nur mit Code', () => {
    let now = 1000;
    const s = new OauthStates(() => now);
    const { state, challenge } = s.create({ userKey: 'u1', userName: 'U', client: 'web', sessionHash: 'h' });
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const p = s.peek(state)!;
    expect(sha256(p.verifier)).toBe(challenge);
    expect(s.consume(state)?.userKey).toBe('u1');
    expect(s.consume(state)).toBeNull();

    const b = s.create({ userKey: 'u1', userName: 'U', client: 'app', sessionHash: 'h' });
    now += STATE_TTL_MS + 1;
    expect(s.peek(b.state)).toBeNull();

    now = 0;
    const c = s.create({ userKey: 'u2', userName: 'U2', client: 'app', sessionHash: 'h' });
    expect(s.confirm(c.state, 'x')).toBeNull(); // noch kein Code
    const nonce = s.attachCode(c.state, 'code-1')!;
    expect(s.attachCode(c.state, 'code-2')).toBeNull(); // anderer Code: nicht überschreiben
    expect(s.confirm(c.state, `${nonce}x`)).toBeNull();
    expect(s.confirm(c.state, nonce)?.code).toBe('code-1');
    expect(s.confirm(c.state, nonce)).toBeNull();
  });

  it('PKCE S256 und Freigabe-Adresse mit boards:read', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(sha256(verifier));
    const u = new URL(authorizeUrl({ clientId: 'cid', clientSecret: 's', redirectUri: 'https://x.test/cb', apiBase: 'https://api.miro.com', authBase: 'https://miro.com' }, 'st', challenge));
    expect(u.origin + u.pathname).toBe('https://miro.com/oauth/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'cid',
      redirect_uri: 'https://x.test/cb',
      scope: 'boards:read',
      state: 'st',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    expect(u.toString()).not.toContain('s=');
  });

  it('Log-Adressen ohne code, state und conn', () => {
    expect(redactUrl('/api/import/miro/callback?code=abc&state=def')).toBe('/api/import/miro/callback?code=***&state=***');
    expect(redactUrl('/api/import/miro/boards?conn=mc_123&offset=0')).toBe('/api/import/miro/boards?conn=***&offset=0');
  });
});

describe('import_links', () => {
  it('verschlüsselt, an die Person gebunden, Schlüssel aus Datei (0600) bzw. STACHEL_TOKEN_KEY', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-links-'));
    const db = openDb(dir);
    try {
      const links = new ImportLinks(db, importKey('', dir));
      const file = path.join(dir, IMPORT_SECRET_FILE);
      expect(fs.existsSync(file)).toBe(true);
      if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      links.save('alice', 'miro', 'refresh-geheim-1');
      const row = db.prepare("SELECT refresh_token FROM import_links WHERE user_key = 'alice'").get() as { refresh_token: string };
      expect(row.refresh_token.startsWith('imp1:')).toBe(true);
      expect(row.refresh_token).not.toContain('refresh-geheim-1');
      expect(links.load('alice', 'miro')).toBe('refresh-geheim-1');
      // gleicher Schlüssel aus derselben Datei
      expect(new ImportLinks(db, importKey('', dir)).load('alice', 'miro')).toBe('refresh-geheim-1');
      // Zeile einer anderen Person unterschieben: nicht lesbar (AAD), Zeile wird verworfen
      db.prepare("INSERT INTO import_links (user_key, provider, refresh_token, created_at, used_at) VALUES ('mallory', 'miro', ?, 'x', 'x')").run(row.refresh_token);
      expect(links.load('mallory', 'miro')).toBeNull();
      expect(links.has('mallory', 'miro')).toBe(false);
      // anderer Schlüssel (STACHEL_TOKEN_KEY): alte Zeile nicht lesbar
      expect(new ImportLinks(db, importKey('ein-anderer-schluessel', dir)).load('alice', 'miro')).toBeNull();
      // Löschfrist 60 Tage
      links.save('bob', 'miro', 'r2');
      db.prepare("UPDATE import_links SET used_at = '2000-01-01T00:00:00.000Z' WHERE user_key = 'bob'").run();
      expect(links.purgeUnused()).toBe(1);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Mit Miro verbinden (Server + Fake-Miro)', () => {
  it('Rückruf im selben Browser: verbinden, zur Web-App, Boards lesen, erneuern, trennen mit Widerruf', async () => {
    env = await startImportEnv({ oauth: true });
    env.miro.addBoard(await sampleBoard('b1'));
    const b = await loginAdmin(env);
    expect((await b.get('/api/import/sources')).body.miro).toMatchObject({ oauth: true, connected: false });
    const start = await b.post('/api/import/miro/oauth/start', { client: 'web' });
    expect(start.status).toBe(200);
    const u = new URL(start.body.url);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')).toBe('boards:read');
    const cb = await authorize(start.body.url);
    const res = await visit(b, cb);
    expect(res.status).toBe(302);
    expect(res.location).toBe(`${PUBLIC_URL}/?import=miro`);
    expect((await b.get('/api/import/sources')).body.miro.connected).toBe(true);
    // Code ist verbraucht
    expect((await visit(b, cb)).location).toBe(`${PUBLIC_URL}/?import=miro&error=state_expired`);

    // gespeichert: nur verschlüsselt, ohne Access-Token
    const row = env.srv.db.prepare('SELECT * FROM import_links').get() as Record<string, string>;
    expect(row.refresh_token).toMatch(/^imp1:/);
    expect(JSON.stringify(row)).not.toMatch(/fake_(rt|at)_/);

    const list = await b.get('/api/import/miro/boards?conn=oauth');
    expect(list.body.boards.map((x: { id: string }) => x.id)).toEqual(['b1']);

    // Access-Token läuft ab → einmal erneuern (neues Refresh-Token gespeichert)
    for (const t of [...env.miro.tokens]) env.miro.tokens.delete(t);
    const again = await b.get('/api/import/miro/boards?conn=oauth');
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    const row2 = env.srv.db.prepare('SELECT refresh_token FROM import_links').get() as { refresh_token: string };
    expect(row2.refresh_token).not.toBe(row.refresh_token);

    // fremde Person: oauth gilt nur für die eigene Verbindung
    const lena = await loginMember(env, env.fake.addMember(88, 'Lena'));
    expect((await lena.get('/api/import/miro/boards?conn=oauth')).status).toBe(401);

    expect((await b.req('DELETE', '/api/import/miro/oauth')).body.ok).toBe(true);
    expect(env.miro.revoked.length).toBe(1);
    expect((await b.get('/api/import/sources')).body.miro.connected).toBe(false);
    expect(env.srv.db.prepare('SELECT COUNT(*) AS n FROM import_links').get()).toEqual({ n: 0 });
  });

  it('Rückruf ohne passende Sitzung → Bestätigungsseite mit maskiertem Konto; POST mit nonce verbindet', async () => {
    env = await startImportEnv({ oauth: true });
    const b = await loginAdmin(env);
    const start = await b.post('/api/import/miro/oauth/start', { client: 'app' });
    const cb = await authorize(start.body.url);

    // System-Browser ohne Cookie
    const sys = new Browser(env.base);
    const page = await visit(sys, cb);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.body).toContain('Miro-Zugang mit dem Stachel-Konto');
    expect(page.body).toContain('orga'); // Modus org: Name der Person
    expect(page.body).not.toMatch(/<script/i);
    expect(page.body).not.toContain(new URL(`${PUBLIC_URL}${cb}`).searchParams.get('code')!); // Code nicht in der Seite
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    const state = /name="state" value="([^"]+)"/.exec(page.body)![1]!;
    const nonce = /name="nonce" value="([^"]+)"/.exec(page.body)![1]!;
    expect((await b.get('/api/import/sources')).body.miro.connected).toBe(false);

    const post = (body: string) => fetch(`${env!.base}/api/import/miro/callback`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual' });
    // falsche nonce
    expect((await post(`state=${state}&nonce=falsch&confirm=1`)).status).toBe(400);
    const ok = await post(`state=${state}&nonce=${nonce}&confirm=1`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('du kannst zur App zurückkehren'.replace('du', 'Du'));
    expect((await b.get('/api/import/sources')).body.miro.connected).toBe(true);
    // einmalig
    expect((await post(`state=${state}&nonce=${nonce}&confirm=1`)).status).toBe(400);

    // Ohne X-Stachel geht nur genau diese Route (CSRF-Ausnahme)
    expect((await fetch(`${env.base}/api/import/miro/oauth/start`, { method: 'POST', headers: { cookie: b.cookieHeader() } })).status).toBe(403);
  });

  it('fremde Sitzung bekommt die Bestätigungsseite; Abbrechen verbindet nichts; access_denied → Web-App mit Fehler', async () => {
    env = await startImportEnv({ oauth: true });
    const alice = await loginAdmin(env);
    const mallory = await loginMember(env, env.fake.addMember(66, 'Mallory'));
    const start = await alice.post('/api/import/miro/oauth/start', {});
    const cb = await authorize(start.body.url);
    const page = await visit(mallory, cb);
    expect(page.status).toBe(200);
    expect(page.body).toContain('Verbinden');
    const state = /name="state" value="([^"]+)"/.exec(page.body)![1]!;
    const nonce = /name="nonce" value="([^"]+)"/.exec(page.body)![1]!;
    const cancel = await fetch(`${env.base}/api/import/miro/callback`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `state=${state}&nonce=${nonce}&confirm=0` });
    expect(await cancel.text()).toContain('Abgebrochen');
    expect((await alice.get('/api/import/sources')).body.miro.connected).toBe(false);

    env.miro.deny = true;
    const s2 = await alice.post('/api/import/miro/oauth/start', { client: 'web' });
    const denied = await visit(alice, await authorize(s2.body.url));
    expect(denied.status).toBe(302);
    expect(denied.location).toBe(`${PUBLIC_URL}/?import=miro&error=access_denied`);
    // unbekannter state ohne Sitzung: Fehlerseite
    const anon = await visit(new Browser(env.base), '/api/import/miro/callback?code=x&state=unbekannt');
    expect(anon.status).toBe(400);
    expect(anon.body).toContain('abgelaufen');
  });

  it('Konto löschen widerruft bei Miro und löscht Verbindungen und Import-Berichte', async () => {
    env = await startImportEnv({ oauth: true });
    env.miro.addBoard(await sampleBoard('b1'));
    const lena = await loginMember(env, env.fake.addMember(55, 'Lena'));
    const start = await lena.post('/api/import/miro/oauth/start', {});
    expect((await visit(lena, await authorize(start.body.url))).status).toBe(302);
    const job = await lena.post('/api/import/miro/jobs', { conn: 'oauth', boards: ['b1'] });
    expect(job.status).toBe(202);
    await env.srv.imports.jobs.idle();
    const key = (await lena.get('/api/auth/me')).body.user.key as string;
    expect(env.srv.db.prepare('SELECT COUNT(*) AS n FROM import_jobs WHERE user_key = ?').get(key)).toEqual({ n: 1 });

    const del = await lena.post('/api/account/delete', { confirm: true });
    expect(del.status).toBe(200);
    expect(env.miro.revoked.length).toBe(1);
    expect(env.srv.db.prepare('SELECT COUNT(*) AS n FROM import_jobs WHERE user_key = ?').get(key)).toEqual({ n: 0 });
    expect(env.srv.db.prepare('SELECT COUNT(*) AS n FROM import_links WHERE user_key = ?').get(key)).toEqual({ n: 0 });
  });
});
