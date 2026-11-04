// Modus org (docs/contract.md §1/§6): Vertrag mit dem Identitätsdienst einer Organisation, Konfiguration,
// /api/instance-Felder und die Umbenennung der Token-Spalte in Bestandsdatenbanken.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { loadInstance } from '../src/instance.js';
import { OrgIdentityClient, orgUserKey } from '../src/org-identity.js';
import { Browser, startEnv, type TestEnv } from './helpers.js';

describe('Identitätsdienst: Antwort {id, name, admin, status}', () => {
  let srv: http.Server;
  let reply: { status: number; body: unknown } = { status: 200, body: {} };
  let seen: { auth?: string; url?: string } = {};
  let client: OrgIdentityClient;
  beforeAll(async () => {
    srv = http.createServer((req, res) => {
      seen = { auth: req.headers.authorization, url: req.url };
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    client = new OrgIdentityClient({ identityUrl: `${base}/api/stachel/me?v=1`, loginUrl: '', timeoutMs: 2000, name: 'Verein' });
  });
  afterAll(() => {
    srv.close();
  });

  it('active → Identität mit id als user_key; Pfad und Query der Adresse bleiben, Bearer-Token geht mit', async () => {
    reply = { status: 200, body: { id: 'm:12', name: ' Mara ', admin: false, status: 'active' } };
    expect(await client.verifyToken('tok')).toEqual({ kind: 'ok', identity: { userKey: 'm:12', name: 'Mara', isOrga: false } });
    expect(seen).toEqual({ auth: 'Bearer tok', url: '/api/stachel/me?v=1' });
    reply = { status: 200, body: { id: 7, name: '', admin: true, status: 'active' } };
    expect(await client.verifyToken('tok')).toEqual({ kind: 'ok', identity: { userKey: '7', name: 'Team-Mitglied 7', isOrga: true } });
    // admin nur bei echtem true
    reply = { status: 200, body: { id: 'a:orga', name: 'orga', admin: 'yes', status: 'active' } };
    expect(await client.verifyToken('tok')).toMatchObject({ kind: 'ok', identity: { isOrga: false } });
  });

  it('pending/blocked/401/403 und kaputte Antworten', async () => {
    const cases: [number, unknown, string][] = [
      [200, { id: 'm:1', name: 'x', admin: false, status: 'pending' }, 'pending'],
      [200, { id: 'm:1', name: 'x', admin: true, status: 'blocked' }, 'forbidden'],
      [200, { id: 'm:1', name: 'x', admin: false }, 'forbidden'],
      [401, { error: 'invalid_token' }, 'invalid'],
      [403, { status: 'pending' }, 'pending'],
      [403, {}, 'forbidden'],
      [500, { error: 'boom' }, 'unreachable'],
      [200, 'kein json', 'unreachable'],
      [200, { name: 'ohne id', status: 'active' }, 'unreachable'],
      [200, { id: 'u:5', name: 'reserviert', status: 'active' }, 'unreachable'],
      [200, { id: 'ai:m:1', name: 'reserviert', status: 'active' }, 'unreachable'],
      [200, { id: 'mit leerzeichen', name: 'x', status: 'active' }, 'unreachable'],
    ];
    for (const [status, body, kind] of cases) {
      reply = { status, body };
      expect((await client.verifyToken('t')).kind, JSON.stringify(body)).toBe(kind);
    }
  });

  it('Fehlertexte nennen die Organisation, Codes nach Vertrag', () => {
    expect(client.verifyError({ kind: 'unreachable' })).toEqual({ status: 502, error: 'org_unreachable', message: 'Verein ist gerade nicht erreichbar. Bitte versuch es gleich nochmal.' });
    expect(client.verifyError({ kind: 'pending' })).toMatchObject({ status: 403, error: 'pending', message: 'Dein Konto bei Verein wartet noch auf Freigabe.' });
    expect(client.verifyError({ kind: 'forbidden' })).toMatchObject({ status: 403, error: 'forbidden' });
    expect(client.verifyError({ kind: 'invalid' })).toMatchObject({ status: 401, error: 'invalid_token' });
    expect(client.verifyError({ kind: 'ok', identity: { userKey: 'm:1', name: 'x', isOrga: false } })).toBeNull();
  });

  it('orgUserKey: Länge, Steuerzeichen, reservierte Präfixe', () => {
    expect(orgUserKey('m:1')).toBe('m:1');
    expect(orgUserKey(42)).toBe('42');
    expect(orgUserKey('x'.repeat(200))).toBe('x'.repeat(200));
    expect(orgUserKey('x'.repeat(201))).toBeNull();
    expect(orgUserKey('a\u0007b')).toBeNull();
    expect(orgUserKey('')).toBeNull();
    expect(orgUserKey(null)).toBeNull();
    expect(orgUserKey(Number.NaN)).toBeNull();
  });
});

describe('Konfiguration', () => {
  it('STACHEL_AUTH: Standard local, unbekannte Werte brechen den Start ab', () => {
    expect(loadInstance({}).auth).toBe('local');
    expect(loadInstance({ STACHEL_AUTH: 'ORG' }).auth).toBe('org');
    expect(() => loadInstance({ STACHEL_AUTH: 'irgendwas' })).toThrow(/STACHEL_AUTH="irgendwas" ist unbekannt/);
  });

  it('STACHEL_ORG_*: Name, App-Name (Standard „{Name}-App“), Adressen nur http(s), Zeitlimit', () => {
    expect(loadInstance({ STACHEL_AUTH: 'org' })).toMatchObject({ orgName: 'Organisation', orgAppName: 'Organisation-App' });
    expect(loadInstance({ STACHEL_AUTH: 'org', STACHEL_ORG_NAME: 'Sportverein' })).toMatchObject({ orgName: 'Sportverein', orgAppName: 'Sportverein-App' });
    expect(loadInstance({ STACHEL_ORG_NAME: 'X', STACHEL_ORG_APP_NAME: 'Vereinsapp' }).orgAppName).toBe('Vereinsapp');
    const c = loadConfig({
      STACHEL_AUTH: 'org',
      STACHEL_ORG_IDENTITY_URL: ' https://id.example.org/api/me/ ',
      STACHEL_ORG_LOGIN_URL: 'javascript:alert(1)',
      STACHEL_ORG_TIMEOUT_MS: '3000',
    });
    expect(c).toMatchObject({ orgIdentityUrl: 'https://id.example.org/api/me/', orgLoginUrl: '', orgTimeoutMs: 3000 });
    expect(loadConfig({}).orgTimeoutMs).toBe(8000);
  });

  it('Modus org ohne STACHEL_ORG_IDENTITY_URL startet nicht', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-org-'));
    try {
      await expect(buildApp(loadConfig({ STACHEL_AUTH: 'org' }, { dataDir, logLevel: 'silent' }))).rejects.toThrow(/STACHEL_ORG_IDENTITY_URL/);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('/api/instance und Passwort-Anmeldung im Modus org', () => {
  let env: TestEnv;
  let noLogin: TestEnv;
  beforeAll(async () => {
    env = await startEnv({ instance: { ...loadInstance({ STACHEL_AUTH: 'org', STACHEL_ORG_NAME: 'Sportverein' }) }, androidPackage: 'org.example.verein' });
    noLogin = await startEnv({ orgLoginUrl: '', androidPackage: '' });
  });
  afterAll(async () => {
    await env?.stop();
    await noLogin?.stop();
  });

  it('meldet Name, App-Name, Passwort-Anmeldung und Android-Paket', async () => {
    const r = await new Browser(env.base).get('/api/instance');
    expect(r.body).toMatchObject({ auth: 'org', orgName: 'Sportverein', orgAppName: 'Sportverein-App', orgPasswordLogin: true, orgAndroidPackage: 'org.example.verein' });
    const n = await new Browser(noLogin.base).get('/api/instance');
    expect(n.body).toMatchObject({ auth: 'org', orgName: 'Organisation', orgPasswordLogin: false, orgAndroidPackage: null });
  });

  it('ohne STACHEL_ORG_LOGIN_URL: Passwort-Anmeldung 404, Org-Token geht weiter', async () => {
    const b = new Browser(noLogin.base);
    expect((await b.post('/api/auth/password', { username: 'orga', password: 'geheim' })).status).toBe(404);
    const app = await fetch(`${noLogin.base}/api/auth/app-session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'orga', password: 'geheim' }) });
    expect(app.status).toBe(404);
    const token = noLogin.fake.addMember(77, 'Mara');
    const ok = await fetch(`${noLogin.base}/api/auth/app-session`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    expect(await ok.json()).toMatchObject({ ok: true, user: { key: 'm:77', name: 'Mara' } });
  });

  it('Fehlertexte mit dem Namen der Organisation, Identitätsdienst weg → 502 org_unreachable', async () => {
    env.fake.mode = 'down';
    try {
      const r = await fetch(`${env.base}/api/auth/app-code`, { method: 'POST', headers: { Authorization: 'Bearer x' } });
      expect(r.status).toBe(502);
      expect(await r.json()).toMatchObject({ error: 'org_unreachable', message: 'Sportverein ist gerade nicht erreichbar. Bitte versuch es gleich nochmal.' });
    } finally {
      env.fake.mode = 'ok';
    }
  });

  it('QR-Hinweisseite nennt die App der Organisation', async () => {
    const html = await (await fetch(`${env.base}/qr/abc`)).text();
    expect(html).toContain('in der Sportverein-App');
  });
});

describe('Bestandsdatenbank: Token-Spalte mit altem Namen', () => {
  it('wird beim Start in org_token umbenannt, Inhalt bleibt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-mig-'));
    try {
      const raw = new DatabaseSync(path.join(dir, 'stachel.sqlite'));
      const old = 'altbetreiber_token';
      raw.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, user_key TEXT NOT NULL, name TEXT NOT NULL, is_orga INTEGER NOT NULL,
        ${old} TEXT NOT NULL, created_at TEXT NOT NULL, verified_at TEXT NOT NULL, expires_at TEXT NOT NULL)`);
      raw.exec(`CREATE TABLE api_tokens (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, ${old} TEXT NOT NULL)`);
      raw.prepare(`INSERT INTO sessions VALUES ('s1', 'm:1', 'Mara', 0, 'geheim', 'x', 'x', 'x')`).run();
      raw.prepare(`INSERT INTO api_tokens VALUES ('t1', 'h', 'geheim2')`).run();
      raw.close();
      const db = openDb(dir);
      expect(db.prepare('SELECT org_token AS t FROM sessions').get()).toEqual({ t: 'geheim' });
      expect(db.prepare('SELECT org_token AS t, token_hash AS h FROM api_tokens').get()).toEqual({ t: 'geheim2', h: 'h' });
      db.close();
      // zweiter Start: nichts mehr zu tun
      openDb(dir).close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
