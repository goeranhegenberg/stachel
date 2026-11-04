import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let webDist: string;
beforeAll(async () => {
  webDist = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-web-'));
  fs.mkdirSync(path.join(webDist, 'assets'));
  fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><title>Stachel</title><div id="root"></div>');
  fs.writeFileSync(path.join(webDist, 'assets', 'app-abc123.js'), 'console.log(1)');
  fs.writeFileSync(path.join(webDist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  env = await startEnv({ webDist, publicUrl: 'https://stachel.example.org', cookieSecure: true });
});
afterAll(async () => {
  await env?.stop();
  fs.rmSync(webDist, { recursive: true, force: true });
});

describe('Web-App ausliefern', () => {
  it('/ liefert index.html mit Sicherheits-Headern', async () => {
    for (const p of ['/', '/?b=abc123']) {
      const res = await fetch(env.base + p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toContain('<div id="root">');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      const csp = res.headers.get('content-security-policy')!;
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain('connect-src \'self\' wss://stachel.example.org');
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain('upgrade-insecure-requests');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(res.headers.get('strict-transport-security')).toContain('max-age=31536000');
      expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
      expect(res.headers.get('permissions-policy')).toContain('camera=()');
    }
  });

  it('unbekannte Pfade → 404-Seite im Stachel-Look mit Weg zur Übersicht (statt stillschweigend der Übersicht)', async () => {
    for (const p of ['/board/abc123', '/login', '/irgendwas/pfad']) {
      const res = await fetch(env.base + p);
      expect(res.status, p).toBe(404);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('nicht gefunden');
      expect(html).toContain('href="/"');
      expect(html).not.toContain('<div id="root">');
      expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    }
  });

  it('gehashte Assets sind lange cachebar, fehlende Dateien → 404 statt index.html', async () => {
    const js = await fetch(env.base + '/assets/app-abc123.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect((await fetch(env.base + '/favicon.svg')).status).toBe(200);
    expect((await fetch(env.base + '/assets/fehlt.js')).status).toBe(404);
  });

  it('unbekannte API-Pfade → JSON-404, keine SPA', async () => {
    const res = await fetch(env.base + '/api/gibtsnicht');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('Cookies sind mit COOKIE_SECURE als Secure markiert', async () => {
    const res = await fetch(env.base + '/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Stachel': '1' },
      body: JSON.stringify({ username: 'orga', password: 'geheim' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()[0]).toMatch(/; Secure/);
    const qr = await fetch(env.base + '/api/auth/qr', { method: 'POST', headers: { 'X-Stachel': '1' } });
    expect(qr.headers.getSetCookie()[0]).toMatch(/stachel_pair=.*; Secure/);
    expect(((await qr.json()) as { url: string }).url).toMatch(/^https:\/\/stachel\.example\.org\/qr\//);
  });

  it('Health-Check', async () => {
    const res = await fetch(env.base + '/api/health');
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('ohne gebautes web/dist', () => {
  it('liefert einen verständlichen Hinweis statt Absturz', async () => {
    const other = await startEnv();
    try {
      const res = await fetch(other.base + '/');
      expect(res.status).toBe(503);
      expect(await res.text()).toContain('nicht gebaut');
    } finally {
      await other.stop();
    }
  });
});
