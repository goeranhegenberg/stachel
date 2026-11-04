// Rechtstexte der Instanz (legal-pages.ts) und Fassung der Nutzungsbedingungen (accounts.ts, STACHEL_TERMS_VERSION).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { loadInstance } from '../src/instance.js';
import { applyLegalDefaults, fillLegal, legalDirOf, titleOf } from '../src/legal-pages.js';
import { Browser, startEnv, type TestEnv } from './helpers.js';
import { captcha, LOCAL, PW, signUp } from './local-helpers.js';

const get = (base: string, p: string) => fetch(base + p, { redirect: 'manual' });

describe('legal-pages: Konfiguration', () => {
  it('Ordner: STACHEL_LEGAL_DIR oder <DATA_DIR>/legal', () => {
    expect(legalDirOf({}, path.resolve('/srv/data'))).toBe(path.join(path.resolve('/srv/data'), 'legal'));
    expect(legalDirOf({ STACHEL_LEGAL_DIR: '/etc/stachel-legal' }, '/x')).toBe(path.resolve('/etc/stachel-legal'));
  });

  it('ohne Dateien keine Links (Selbst-Hoster bekommen keine fremden Texte); mit Datei verlinkt die Instanz ihre eigene Seite, gesetzte Adressen haben Vorrang', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-legal-'));
    try {
      const inst = loadInstance({});
      expect(applyLegalDefaults(inst, 'https://w.example', dir)).toMatchObject({ imprintUrl: '', privacyUrl: '', termsUrl: '' });
      fs.writeFileSync(path.join(dir, 'impressum.html'), '<h1>Impressum</h1>');
      fs.writeFileSync(path.join(dir, 'datenschutz.html'), '<h1>Datenschutz</h1>');
      const withPrivacy = loadInstance({ STACHEL_PRIVACY_URL: 'https://other.example/privacy' });
      expect(applyLegalDefaults(withPrivacy, 'https://w.example', dir)).toMatchObject({
        imprintUrl: 'https://w.example/impressum',
        privacyUrl: 'https://other.example/privacy',
        termsUrl: '',
      });
      // loadConfig: DATA_DIR/legal wird beim Start gelesen
      const dataDir = path.dirname(dir);
      const cfg = loadConfig({ DATA_DIR: dataDir, STACHEL_LEGAL_DIR: dir, PUBLIC_URL: 'https://w.example/' });
      expect(cfg.legalDir).toBe(path.resolve(dir));
      expect(cfg.instance.imprintUrl).toBe('https://w.example/impressum');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Pfad der Web-App darf keine Rechtsseite verdecken', () => {
    expect(() => loadConfig({ STACHEL_BASE_PATH: '/impressum' })).toThrow(/kollidiert/);
    expect(() => loadConfig({ STACHEL_BASE_PATH: '/konto-loeschen' })).toThrow(/kollidiert/);
  });

  it('Platzhalter werden HTML-escaped ersetzt, Titel aus der ersten Überschrift', () => {
    expect(fillLegal('<p>{{BRAND}} {{X}}</p>', { BRAND: 'A&B' })).toBe('<p>A&#38;B {{X}}</p>');
    expect(titleOf('<h1>Daten<em>schutz</em></h1>', 'x')).toBe('Datenschutz');
    expect(titleOf('<h1>Daten&shy;schutz&shy;erklärung &amp; mehr</h1>', 'x')).toBe('Datenschutzerklärung & mehr');
    expect(titleOf('<p>ohne</p>', 'Impressum')).toBe('Impressum');
  });

  it('STACHEL_TERMS_VERSION: nur einfache Kennungen', () => {
    expect(loadInstance({ STACHEL_TERMS_VERSION: ' 2026-11-04 ' }).termsVersion).toBe('2026-11-04');
    expect(loadInstance({}).termsVersion).toBe('');
    expect(() => loadInstance({ STACHEL_TERMS_VERSION: '<script>' })).toThrow(/STACHEL_TERMS_VERSION/);
  });
});

describe('legal-pages: Auslieferung (Modus local, Web-App unter /app)', () => {
  let env: TestEnv;
  let dir: string;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-legal-'));
    env = await startEnv({
      instance: { ...LOCAL, brand: 'Stachel', imprintUrl: 'https://stachel.example.test/impressum', privacyUrl: 'https://stachel.example.test/datenschutz' },
      basePath: '/app',
      legalDir: dir,
    });
  });
  afterAll(async () => {
    await env?.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ohne Datei 404, mit Datei die Seite im Rahmen – statisch, ohne Skripte und fremde Quellen, Änderungen ohne Neustart', async () => {
    expect((await get(env.base, '/impressum')).status).toBe(404);
    fs.writeFileSync(path.join(dir, 'impressum.html'), '﻿<h1>Impressum</h1>\n<p>Betreiber von {{BRAND}}: Mara <strong>Beispiel</strong>, Konto löschen: {{DELETE_URL}}</p>');
    const r = await get(env.base, '/impressum');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/html/);
    const html = await r.text();
    expect(html).toContain('<title>Impressum – Stachel</title>');
    expect(html).toContain('Betreiber von Stachel: Mara <strong>Beispiel</strong>');
    expect(html).toContain('https://stachel.example.test/konto-loeschen');
    expect(html).not.toContain('﻿');
    expect(html).not.toMatch(/<script/i);
    // alle Adressen in src/href: eigene Pfade oder Links (keine Ressourcen von fremden Servern)
    for (const m of html.matchAll(/src="?([^"\s)>]+)/g)) expect(m[1]!.startsWith('/')).toBe(true);
    expect(html).toMatch(/url\(\/qr-fonts\//);
    // Fuß: die anderen Rechtsseiten und Konto löschen, nicht die eigene Seite
    expect(html).toContain('href="https://stachel.example.test/datenschutz"');
    expect(html).toContain('href="/konto-loeschen"');
    expect(html).not.toContain('href="https://stachel.example.test/impressum"');
    // Datei geändert → neue Fassung
    await new Promise((res) => setTimeout(res, 20));
    fs.writeFileSync(path.join(dir, 'impressum.html'), '<h1>Impressum neu</h1><p>Stand heute, länger als vorher</p>');
    expect(await (await get(env.base, '/impressum')).text()).toContain('Impressum neu');
  });

  it('unter dem Pfad der Web-App: Weiterleitung zur Seite an der Wurzel', async () => {
    const r = await get(env.base, '/app/datenschutz');
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe('/datenschutz');
    fs.writeFileSync(path.join(dir, 'datenschutz.html'), '<h1>Datenschutzerklärung</h1>');
    expect((await get(env.base, '/datenschutz')).status).toBe(200);
  });

  it('Konto löschen nutzt denselben Rahmen und verlinkt Impressum und Datenschutz', async () => {
    const html = await (await get(env.base, '/konto-loeschen')).text();
    expect(html).toContain('<title>Konto löschen – Stachel</title>');
    expect(html).toContain('href="https://stachel.example.test/impressum"');
    expect(html).toContain('href="https://stachel.example.test/datenschutz"');
    expect(html).not.toContain('href="/konto-loeschen"');
  });
});

describe('Nutzungsbedingungen: Fassung speichern und erneut zustimmen', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startEnv({ instance: { ...LOCAL, termsUrl: 'https://stachel.example.test/nutzungsbedingungen', termsVersion: '2026-11-04' } });
  });
  afterAll(async () => {
    await env?.stop();
  });

  it('Registrierung speichert die geltende Fassung; nichts offen', async () => {
    const b = await signUp(env, 'Tara Test', 'tara@example.org');
    const row = env.srv.db.prepare('SELECT terms_version, terms_accepted_at FROM accounts WHERE email = ?').get('tara@example.org') as { terms_version: string; terms_accepted_at: string };
    expect(row.terms_version).toBe('2026-11-04');
    const t = await b.get('/api/account/terms');
    expect(t.status).toBe(200);
    expect(t.body).toMatchObject({ version: '2026-11-04', acceptedVersion: '2026-11-04', pending: false, url: 'https://stachel.example.test/nutzungsbedingungen' });
  });

  it('ältere Fassung (bzw. Konto von vor den Bedingungen) → pending; Zustimmung nur zur geltenden Fassung und nur mit Häkchen', async () => {
    const b = await signUp(env, 'Olaf Alt', 'olaf@example.org');
    env.srv.db.prepare('UPDATE accounts SET terms_version = NULL, terms_accepted_at = NULL WHERE email = ?').run('olaf@example.org');
    expect((await b.get('/api/account/terms')).body).toMatchObject({ pending: true, acceptedVersion: null });
    expect((await b.post('/api/account/terms', { version: '2026-11-04' })).body.error).toBe('terms_required');
    const old = await b.post('/api/account/terms', { accept: true, version: '2025-01-01' });
    expect(old.status).toBe(409);
    expect(old.body.error).toBe('terms_changed');
    const ok = await b.post('/api/account/terms', { accept: true, version: '2026-11-04' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ pending: false, acceptedVersion: '2026-11-04' });
    expect(Date.parse(ok.body.acceptedAt)).toBeGreaterThan(Date.now() - 60_000);
  });

  it('ohne Sitzung 401; Registrierung ohne Häkchen weiter abgelehnt', async () => {
    const anon = new Browser(env.base);
    expect((await anon.get('/api/account/terms')).status).toBe(401);
    const r = await anon.post('/api/auth/register', { name: 'X', email: 'x@example.org', password: PW, captcha: await captcha(anon) });
    expect(r.body.error).toBe('terms_required');
  });
});
