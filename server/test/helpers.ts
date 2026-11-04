import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { buildApp, type App } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { FakeOrg } from './fake-org.js';

export interface TestEnv {
  base: string;
  wsUrl: string;
  cfg: Config;
  srv: App;
  fake: FakeOrg;
  stop: () => Promise<void>;
}

/** Startet einen Fake-Identitätsdienst + echten Server (Modus org) auf zufälligem Port mit eigenem Datenverzeichnis. */
export async function startEnv(overrides: Partial<Config> = {}): Promise<TestEnv> {
  const fake = await new FakeOrg().start();
  fake.addAdmin('orga', 'geheim');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-test-'));
  const cfg = loadConfig(
    { STACHEL_AUTH: 'org' },
    {
      dataDir,
      orgIdentityUrl: fake.identityUrl,
      orgLoginUrl: fake.loginUrl,
      // App-Links einer Beispiel-App (ohne Env gäbe es keine)
      androidPackage: 'org.example.app',
      iosAppId: 'TEAMID1234.org.example.app',
      publicUrl: 'https://stachel.example.test',
      logLevel: 'silent',
      webDist: path.join(dataDir, 'no-web'),
      qrWaitMs: 1500,
      syncDebounceMs: 50,
      syncMaxDebounceMs: 200,
      orgTimeoutMs: 2000,
      // Rechtstexte der Instanz im Test-Datenordner (legal-pages.ts), nie aus dem Arbeitsverzeichnis
      legalDir: path.join(dataDir, 'legal'),
      ...overrides,
    },
  );
  const srv = await buildApp(cfg);
  await srv.app.listen({ port: 0, host: '127.0.0.1' });
  const port = (srv.app.server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/sync`,
    cfg,
    srv,
    fake,
    stop: async () => {
      await srv.close();
      await fake.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Headers;
  setCookies: string[];
}

/** Kleiner HTTP-Client mit Cookie-Jar (ein „Browser“). */
export class Browser {
  cookies = new Map<string, string>();

  constructor(private readonly base: string) {}

  cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async req<T = any>(
    method: string,
    p: string,
    opts: { json?: unknown; headers?: Record<string, string>; csrf?: boolean; body?: RequestInit['body'] } = {},
  ): Promise<Res<T>> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (this.cookies.size) headers.cookie = this.cookieHeader();
    if (opts.csrf !== false && method !== 'GET') headers['X-Stachel'] = '1';
    let body = opts.body;
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }
    const res = await fetch(this.base + p, { method, headers, body });
    const setCookies = res.headers.getSetCookie();
    for (const c of setCookies) {
      const [pair, ...attrs] = c.split(';');
      const i = pair!.indexOf('=');
      const name = pair!.slice(0, i).trim();
      const value = pair!.slice(i + 1).trim();
      const expired = attrs.some((a) => /max-age=0\b/i.test(a.trim())) || attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a.trim()));
      if (expired || !value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    let parsed: unknown = text;
    if ((res.headers.get('content-type') ?? '').includes('json')) parsed = JSON.parse(text);
    return { status: res.status, body: parsed as T, headers: res.headers, setCookies };
  }

  get<T = any>(p: string, opts?: { headers?: Record<string, string> }) {
    return this.req<T>('GET', p, opts);
  }
  post<T = any>(p: string, json?: unknown, opts: { headers?: Record<string, string>; csrf?: boolean } = {}) {
    return this.req<T>('POST', p, { ...opts, json });
  }
}

/** Meldet einen Browser per Admin-Passwort an. */
export async function loginAdmin(env: TestEnv, b = new Browser(env.base)): Promise<Browser> {
  const res = await b.post('/api/auth/password', { username: 'orga', password: 'geheim' });
  if (res.status !== 200) throw new Error(`Login fehlgeschlagen: ${res.status}`);
  return b;
}

/** Meldet einen Browser per QR-Ablauf mit einem Mitglieds-Token an. */
export async function loginMember(env: TestEnv, token: string, b = new Browser(env.base)): Promise<Browser> {
  const qr = await b.post('/api/auth/qr');
  const app = new Browser(env.base);
  const ok = await app.post('/api/auth/qr/approve', { code: qr.body.code }, { headers: { Authorization: `Bearer ${token}` }, csrf: false });
  if (ok.status !== 200) throw new Error(`approve fehlgeschlagen: ${ok.status} ${JSON.stringify(ok.body)}`);
  const w = await b.get(`/api/auth/qr/${qr.body.code}/wait`);
  if (w.body.status !== 'approved') throw new Error('nicht bestätigt');
  return b;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs = 5000, stepMs = 20): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await cond()) return;
    await sleep(stepMs);
  }
  throw new Error('Bedingung nicht erfüllt (Timeout)');
}
