// Web-App unter einem Pfad (STACHEL_BASE_PATH) und Produktseite (STACHEL_LANDING), server/src/site.ts,
// docs/features/website.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, normalizeBasePath } from '../src/config.js';
import { fillLanding } from '../src/site.js';
import { appLinkPaths } from '../src/well-known.js';
import { startEnv, type TestEnv } from './helpers.js';
import { LOCAL, mailsOf, signUp, waitMail } from './local-helpers.js';

const LANDING_TPL = `<!doctype html><title>{{BRAND}}</title>
<a id="open" href="{{APP}}">Im Browser öffnen</a>
<link rel="canonical" href="{{ORIGIN}}/">
<!--#if repo--><a id="repo" href="{{REPO_URL}}">GitHub</a><!--#end repo--><!--#if !repo--><span id="norepo">Quellcode folgt</span><!--#end repo-->
<!--#if play--><a id="play" href="{{PLAY_URL}}">Play</a><!--#end play--><!--#if !play--><span id="soon">bald im Play Store</span><!--#end play-->
<!--#if imprint--><a id="imprint" href="{{IMPRINT_URL}}">Impressum</a><!--#end imprint-->
<!--#if privacy--><a id="privacy" href="{{PRIVACY_URL}}">Datenschutz</a><!--#end privacy-->
<link rel="stylesheet" href="/landing/landing.css">`;

function makeWebDist(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-site-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.mkdirSync(path.join(dir, 'landing'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Stachel</title><script type="module" src="./assets/app-abc123.js"></script><div id="root"></div>');
  fs.writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(path.join(dir, 'landing', 'index.html'), LANDING_TPL);
  fs.writeFileSync(path.join(dir, 'landing', 'landing.css'), 'body{color:#fff}');
  return dir;
}

const get = (base: string, p: string, init: RequestInit = {}) => fetch(base + p, { redirect: 'manual', ...init });

describe('STACHEL_BASE_PATH: Konfiguration', () => {
  it('normalisiert und lehnt Server-Pfade ab', () => {
    expect(normalizeBasePath(undefined)).toBe('');
    expect(normalizeBasePath('')).toBe('');
    expect(normalizeBasePath('/')).toBe('');
    expect(normalizeBasePath('app')).toBe('/app');
    expect(normalizeBasePath('/app/')).toBe('/app');
    expect(normalizeBasePath(' /team/board ')).toBe('/team/board');
    for (const bad of ['/api', '/sync', '/b', '/.well-known', '/mcp', '/a b', '/../x', '/app?x=1', '/qr']) {
      expect(() => normalizeBasePath(bad), bad).toThrow(/STACHEL_BASE_PATH/);
    }
    const cfg = loadConfig({ STACHEL_BASE_PATH: '/app/', STACHEL_LANDING: '1', STACHEL_REPO_URL: 'javascript:alert(1)', STACHEL_PLAY_URL: 'https://play.google.com/store/apps/details?id=com.intsode.stachel' });
    expect(cfg.basePath).toBe('/app');
    expect(cfg.landing).toEqual({ enabled: true, repoUrl: '', playUrl: 'https://play.google.com/store/apps/details?id=com.intsode.stachel' });
    expect(loadConfig({}).basePath).toBe('');
    expect(loadConfig({}).landing.enabled).toBe(false);
  });

  it('Vorlage der Produktseite: Platzhalter escaped, Blöcke je Schalter', () => {
    const html = fillLanding('<a href="{{A}}">{{B}}</a><!--#if x-->X<!--#end x--><!--#if !x-->nicht X<!--#end x-->{{UNBEKANNT}}', { A: '/app/', B: '<b>&"' }, { x: false });
    expect(html).toBe('<a href="/app/">&lt;b&gt;&amp;&quot;</a>nicht X{{UNBEKANNT}}');
  });

  it('App-Link-Pfade (iOS) mit und ohne Präfix, QR nur an der Wurzel', () => {
    expect(appLinkPaths('local')).toEqual(['/b/*', '/verify/*', '/reset/*']);
    expect(appLinkPaths('local', '/app')).toEqual(['/b/*', '/verify/*', '/reset/*', '/app/b/*', '/app/verify/*', '/app/reset/*']);
    expect(appLinkPaths('org', '/app')).toEqual(['/qr/*', '/b/*', '/app/b/*']);
  });
});

describe('Web-App unter /app mit Produktseite (Modus org)', () => {
  let env: TestEnv;
  let webDist: string;
  beforeAll(async () => {
    webDist = makeWebDist();
    env = await startEnv({
      webDist,
      publicUrl: 'https://stachel.example.test',
      basePath: '/app',
      landing: { enabled: true, repoUrl: 'https://github.com/example/stachel', playUrl: '' },
      instance: { ...loadConfig({ STACHEL_AUTH: 'org' }).instance, imprintUrl: 'https://example.test/impressum', privacyUrl: '' },
    });
  });
  afterAll(async () => {
    await env?.stop();
    fs.rmSync(webDist, { recursive: true, force: true });
  });

  it('/ liefert die Produktseite mit gefüllten Platzhaltern (komprimiert, mit Sicherheits-Headern)', async () => {
    const res = await get(env.base, '/', { headers: { 'accept-encoding': 'identity' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    const html = await res.text();
    expect(html).toContain('<a id="open" href="/app/">');
    expect(html).toContain('href="https://stachel.example.test/"');
    expect(html).toContain('<a id="repo" href="https://github.com/example/stachel">');
    expect(html).not.toContain('norepo');
    expect(html).toContain('bald im Play Store');
    expect(html).toContain('href="https://example.test/impressum"');
    expect(html).not.toContain('id="privacy"');
    expect(html).not.toMatch(/\{\{|<!--#/);

    const gz = await get(env.base, '/', { headers: { 'accept-encoding': 'gzip' } });
    expect(gz.headers.get('content-encoding')).toBe('gzip');
    expect(await gz.text()).toBe(html); // fetch entpackt selbst
    const br = await fetch(env.base + '/', { headers: { 'accept-encoding': 'br' } });
    expect(br.headers.get('content-encoding')).toBe('br');
    expect(await br.text()).toBe(html);
  });

  it('Bilder/CSS der Produktseite unter /landing/, die Vorlage selbst nie roh', async () => {
    const css = await get(env.base, '/landing/landing.css');
    expect(css.status).toBe(200);
    expect(css.headers.get('cache-control')).toBe('public, max-age=86400');
    fs.writeFileSync(path.join(webDist, 'landing', 'index.html.br'), 'x'); // legt der Vite-Build an
    for (const p of ['/landing/index.html', '/landing/index.html.br', '/landing/', '/app/landing/index.html', '/app/landing/landing.css']) {
      expect((await get(env.base, p)).status, p).toBe(404);
    }
  });

  it('Web-App und Assets unter /app/, /app → /app/', async () => {
    const res = await get(env.base, '/app/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const qs = await get(env.base, '/app/?b=abc123');
    expect(qs.status).toBe(200);
    const js = await get(env.base, '/app/assets/app-abc123.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect((await get(env.base, '/app/favicon.svg')).status).toBe(200);
    expect((await get(env.base, '/app/assets/fehlt.js')).status).toBe(404);
    // an der Wurzel gibt es die Web-App nicht mehr
    expect((await get(env.base, '/assets/app-abc123.js')).status).toBe(404);
    expect((await get(env.base, '/index.html')).status).toBe(404);

    const bare = await get(env.base, '/app?b=abc123');
    expect(bare.status).toBe(301);
    expect(bare.headers.get('location')).toBe('/app/?b=abc123');
  });

  it('alte Adressen leiten in die Web-App: /?b=, /?offline=1 (MCP-Renderer), /b/<id>, /app/b/<id>', async () => {
    const cases: [string, string][] = [
      ['/?b=abc123', '/app/?b=abc123'],
      ['/?b=abc123&o=n_1', '/app/?b=abc123&o=n_1'],
      ['/?offline=1', '/app/?offline=1'],
      ['/?konto=1', '/app/?konto=1'],
      ['/b/abc123', '/app/?b=abc123'],
      ['/b/abc123?o=n_1', '/app/?b=abc123&o=n_1'],
      ['/app/b/abc123', '/app/?b=abc123'],
      ['/app/b/abc123?o=n_1', '/app/?b=abc123&o=n_1'],
    ];
    for (const [from, to] of cases) {
      const res = await get(env.base, from);
      expect(res.status, from).toBe(302);
      expect(res.headers.get('location'), from).toBe(to);
    }
    // „/?“ ohne Inhalt ist die Produktseite
    expect((await get(env.base, '/?')).status).toBe(200);
    for (const p of ['/b/bad%20id', '/app/b/bad%20id']) {
      const res = await get(env.base, p);
      expect(res.status, p).toBe(404);
      expect(await res.text()).toContain('href="/app/"');
    }
  });

  it('unbekannte Seiten → 404-Seite mit Weg zur Übersicht unter /app/', async () => {
    for (const p of ['/login', '/app/login', '/app/irgendwas/pfad']) {
      const res = await get(env.base, p);
      expect(res.status, p).toBe(404);
      const html = await res.text();
      expect(html).toContain('nicht gefunden');
      expect(html).toContain('href="/app/"');
    }
  });

  it('API, Schriften, QR-Seite und App-Links bleiben an der Wurzel', async () => {
    expect(await (await get(env.base, '/api/health')).json()).toEqual({ ok: true });
    expect((await get(env.base, '/app/api/health')).status).toBe(404);
    expect((await get(env.base, '/qr-fonts/barlow-400.woff2')).status).toBe(200);
    const qr = await get(env.base, '/qr/abcdefghij?handy=1');
    expect(qr.status).toBe(200);
    expect(await qr.text()).toContain('href="/app/"');
    const qrStart = await fetch(env.base + '/api/auth/qr', { method: 'POST', headers: { 'X-Stachel': '1' } });
    expect(((await qrStart.json()) as { url: string }).url).toMatch(/^https:\/\/stachel\.example\.test\/qr\//);
    const aasa = (await (await get(env.base, '/.well-known/apple-app-site-association')).json()) as { applinks: { details: { components: { '/': string }[] }[] } };
    expect(aasa.applinks.details[0]!.components.map((c) => c['/'])).toEqual(['/qr/*', '/b/*', '/app/b/*']);
  });

  it('App-Login aus der Org-App (/auth/app) landet unter /app/', async () => {
    env.fake.tokens.set('tok-orga', { kind: 'admin', username: 'orga' });
    const code = (await (await fetch(env.base + '/api/auth/app-code', { method: 'POST', headers: { authorization: 'Bearer tok-orga' } })).json()) as { code: string };
    const res = await get(env.base, `/auth/app?code=${code.code}&b=abc123`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/app/?b=abc123&app=1');
  });
});

describe('Web-App unter /app ohne Produktseite', () => {
  let env: TestEnv;
  let webDist: string;
  beforeAll(async () => {
    webDist = makeWebDist();
    env = await startEnv({ webDist, basePath: '/app' });
  });
  afterAll(async () => {
    await env?.stop();
    fs.rmSync(webDist, { recursive: true, force: true });
  });

  it('/ leitet zur Web-App, /landing/ gibt es nicht', async () => {
    const res = await get(env.base, '/');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/app/');
    expect((await get(env.base, '/landing/landing.css')).status).toBe(404);
    expect((await get(env.base, '/app/')).status).toBe(200);
  });
});

describe('ohne STACHEL_BASE_PATH bleibt alles wie bisher (auch mit STACHEL_LANDING)', () => {
  let env: TestEnv;
  let webDist: string;
  beforeAll(async () => {
    webDist = makeWebDist();
    env = await startEnv({ webDist, landing: { enabled: true, repoUrl: '', playUrl: '' } });
  });
  afterAll(async () => {
    await env?.stop();
    fs.rmSync(webDist, { recursive: true, force: true });
  });

  it('/ ist die Web-App, /b/<id> → /?b=<id>, keine /app-Pfade', async () => {
    const root = await get(env.base, '/');
    expect(root.status).toBe(200);
    expect(await root.text()).toContain('<div id="root">');
    expect((await get(env.base, '/?b=abc123')).status).toBe(200);
    expect((await get(env.base, '/assets/app-abc123.js')).status).toBe(200);
    const b = await get(env.base, '/b/abc123?o=n_1');
    expect(b.headers.get('location')).toBe('/?b=abc123&o=n_1');
    expect((await get(env.base, '/app/')).status).toBe(404);
    expect((await get(env.base, '/app/b/abc123')).status).toBe(404);
    expect((await get(env.base, '/landing/landing.css')).status).toBe(404);
  });
});

describe('Modus local unter /app: Mail-Links und Teilen-Link mit Präfix, alte Links gültig', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startEnv({ instance: LOCAL, basePath: '/app', publicUrl: 'https://stachel.example.test' });
  });
  afterAll(async () => env?.stop());

  it('Bestätigungsmail zeigt auf /app/verify/<token>; /verify/ und /app/verify/ leiten auf /app/?verify=', async () => {
    const before = mailsOf(env).length;
    await signUp(env, 'Pia Pfad', 'pia@example.test');
    const m = (await waitMail(env, 'pia@example.test', /bestätigen/, before)).text;
    expect(m).toMatch(/https:\/\/stachel\.example\.test\/app\/verify\/[A-Za-z0-9_-]{20,}/);
    const token = 'A'.repeat(43);
    for (const purpose of ['verify', 'reset']) {
      for (const p of [`/${purpose}/${token}`, `/app/${purpose}/${token}`]) {
        const res = await get(env.base, p);
        expect(res.status, p).toBe(302);
        expect(res.headers.get('location'), p).toBe(`/app/?${purpose}=${token}`);
      }
      const bad = await get(env.base, `/app/${purpose}/kurz`);
      expect(bad.status).toBe(404);
      expect(await bad.text()).toContain('href="/app/"');
    }
  });

  it('Teilen-Dialog liefert den Kurzlink /app/b/<id>, Einladungsmail /app/?b=', async () => {
    const owner = await signUp(env, 'Olga Pfad', 'olga@example.test');
    const board = (await owner.post('/api/boards', { title: 'Pfad' })).body.board as { id: string };
    const share = await owner.get(`/api/boards/${board.id}/share`);
    expect(share.body.url).toBe(`https://stachel.example.test/app/b/${board.id}`);
    const before = mailsOf(env).length;
    await owner.post(`/api/boards/${board.id}/share`, { emails: ['neu@example.test'], role: 'view' });
    const invite = (await waitMail(env, 'neu@example.test', /eingeladen/, before)).text;
    expect(invite).toContain(`https://stachel.example.test/app/?b=${board.id}&register=1`);
    const aasa = (await (await get(env.base, '/.well-known/apple-app-site-association')).json()) as { applinks: { details: { components: { '/': string }[] }[] } };
    expect(aasa.applinks.details[0]!.components.map((c) => c['/'])).toEqual(['/b/*', '/verify/*', '/reset/*', '/app/b/*', '/app/verify/*', '/app/reset/*']);
  });
});
