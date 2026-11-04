// Rechtstexte der Instanz (server/src/legal-pages.ts) gegen den ECHTEN Server mit Produktseite und Web-App unter /app:
// /impressum, /datenschutz, /nutzungsbedingungen aus DATA_DIR/legal (ohne Anmeldung, ohne Anfragen an fremde Server),
// Links in Produktseite und Web-App, /app/<seite> leitet weiter. Danach erneute Zustimmung zu geänderten
// Nutzungsbedingungen (STACHEL_TERMS_VERSION): Server mit Fassung v1, Konto anlegen, Neustart mit Fassung v2 → Dialog.
// Screenshots: docs/screenshots/legal-*.png.
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { solveCaptcha } from '../../server/src/captcha';
import { SHOTS } from '../support/paths';
import { StachelServer } from '../support/server';

test.describe.configure({ mode: 'serial' });

const PORT = Number(process.env.E2E_LEGAL_PORT ?? 8697);
const PW = 'Kaktusblüte-im-Mai';
let server: StachelServer;
let dataDir: string;
test.use({ baseURL: `http://127.0.0.1:${PORT}` });
const LOG = path.join(import.meta.dirname, '../test-results/server-legal.log');

const env = (version: string): Record<string, string> => ({
  STACHEL_AUTH: 'local',
  STACHEL_MAIL_MODE: 'log',
  STACHEL_REQUIRE_VERIFICATION: '0',
  STACHEL_BASE_PATH: '/app',
  STACHEL_LANDING: '1',
  STACHEL_TERMS_VERSION: version,
  STACHEL_CAPTCHA_MAX: '20000',
});

/** Alle Anfragen der Seite: keine darf den eigenen Server verlassen. */
function watchRequests(p: Page): string[] {
  const foreign: string[] = [];
  p.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol !== 'data:' && u.origin !== server.url) foreign.push(r.url());
  });
  return foreign;
}

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-e2e-legal-'));
  fs.mkdirSync(path.join(dataDir, 'legal'));
  fs.writeFileSync(path.join(dataDir, 'legal', 'impressum.html'), '<h1>Impressum</h1>\n<p>Betreiberin dieser {{BRAND}}-Instanz: Mara Beispiel, Musterweg 1, 12345 Musterstadt.</p>');
  fs.writeFileSync(path.join(dataDir, 'legal', 'datenschutz.html'), '<h1>Datenschutzerklärung</h1>\n<h2>1. Verantwortliche</h2><p>Mara Beispiel</p><div class="table"><table><tr><th>Daten</th><th>Frist</th></tr><tr><td>Konto</td><td>bis zur Löschung</td></tr></table></div>');
  fs.writeFileSync(path.join(dataDir, 'legal', 'nutzungsbedingungen.html'), '<h1>Nutzungsbedingungen</h1>\n<p class="stand">Fassung {{TERMS_VERSION}}</p><p>Seid nett zueinander.</p>');
  server = new StachelServer(PORT, dataDir, 'http://127.0.0.1:9', LOG, env('v1'));
  await server.start();
});

test.afterAll(async () => {
  await server?.stop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Rechtsseiten: statisch, ohne Anmeldung, nur eigene Quellen; Links in Produktseite und Web-App', async ({ page }) => {
  const foreign = watchRequests(page);
  for (const [slug, heading] of [
    ['impressum', 'Impressum'],
    ['datenschutz', 'Datenschutzerklärung'],
    ['nutzungsbedingungen', 'Nutzungsbedingungen'],
  ] as const) {
    const r = await page.goto(`/${slug}`);
    expect(r?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
  await expect(page.getByText('Fassung v1')).toBeVisible();
  // Fuß: die anderen Seiten, Konto löschen, zurück zur App
  const footer = page.locator('footer');
  await expect(footer.getByRole('link', { name: 'Impressum' })).toHaveAttribute('href', `${server.url}/impressum`);
  await expect(footer.getByRole('link', { name: 'Konto löschen' })).toHaveAttribute('href', '/konto-loeschen');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/datenschutz');
  await page.screenshot({ path: path.join(SHOTS, 'legal-datenschutz-handy.png'), animations: 'disabled' });
  // unter dem Pfad der Web-App
  await page.goto('/app/impressum');
  expect(new URL(page.url()).pathname).toBe('/impressum');
  // Produktseite verlinkt Impressum und Datenschutz (eigene Seiten, weil keine Adresse gesetzt ist)
  await page.goto('/');
  await expect(page.locator(`a[href="${server.url}/impressum"]`).first()).toBeVisible();
  await expect(page.locator(`a[href="${server.url}/datenschutz"]`).first()).toBeVisible();
  // Web-App: Fuß der Anmeldeseite
  await page.goto('/app/');
  const legal = page.getByTestId('legal-footer');
  await expect(legal.getByRole('link', { name: 'Nutzungsbedingungen' })).toHaveAttribute('href', `${server.url}/nutzungsbedingungen`);
  await expect(legal.getByRole('link', { name: 'Datenschutz' })).toHaveAttribute('href', `${server.url}/datenschutz`);
  expect(foreign).toEqual([]);
});

test('Geänderte Nutzungsbedingungen: Dialog bis zur Zustimmung, danach nicht mehr', async ({ page }) => {
  // Konto unter Fassung v1 (Registrierung speichert die Fassung)
  const c = await (await fetch(`${server.url}/api/auth/captcha`)).json();
  const r = await fetch(`${server.url}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Stachel': '1' },
    body: JSON.stringify({ name: 'Tara Test', email: 'tara@example.org', password: PW, terms: true, captcha: solveCaptcha(c) }),
  });
  expect(r.status).toBe(200);
  const login = async () => {
    await page.goto('/app/');
    await page.getByLabel('E-Mail-Adresse').fill('tara@example.org');
    await page.getByLabel('Passwort', { exact: true }).fill(PW);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).last().click();
    await expect(page.getByRole('button', { name: 'Neues Board' })).toBeVisible();
  };
  await login();
  await expect(page.getByTestId('terms-gate')).toHaveCount(0);

  // Neue Fassung v2
  await server.stop();
  server = new StachelServer(PORT, dataDir, 'http://127.0.0.1:9', LOG, env('v2'));
  await server.start();
  await page.reload();
  const gate = page.getByTestId('terms-gate');
  await expect(gate).toBeVisible();
  await expect(gate.getByRole('link', { name: /Nutzungsbedingungen lesen \(Fassung v2\)/ })).toHaveAttribute('href', `${server.url}/nutzungsbedingungen`);
  await page.screenshot({ path: path.join(SHOTS, 'legal-terms-gate.png'), animations: 'disabled' });
  // ohne Häkchen geht es nicht weiter
  await gate.getByTestId('terms-gate-accept').click();
  await expect(gate.getByRole('alert')).toContainText('Häkchen');
  await gate.getByTestId('terms-gate-check').check();
  await gate.getByTestId('terms-gate-accept').click();
  await expect(gate).toHaveCount(0);
  const state = await page.evaluate(() => fetch('/api/account/terms').then((x) => x.json()));
  expect(state).toMatchObject({ pending: false, acceptedVersion: 'v2' });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Neues Board' })).toBeVisible();
  await expect(page.getByTestId('terms-gate')).toHaveCount(0);
});
