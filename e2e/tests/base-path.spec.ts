// Web-App unter einem Pfad (STACHEL_BASE_PATH=/app) mit Produktseite unter / (STACHEL_LANDING=1), wie stachel.intsode.com
// (server/src/site.ts, docs/features/website.md), gegen den ECHTEN Server im Modus local: Produktseite → „Im Browser
// öffnen“ → Bestätigungslink aus der Mail (/app/verify/<token>) → anmelden → Board anlegen → Teilen-Link (/app/b/<id>)
// und alte Links (/b/<id>, /?b=<id>, /verify/<token>, /?offline=1) landen in der Web-App unter /app/. Kein Abruf darf
// an der Wurzel scheitern (Assets, Chunks, Worker liegen relativ unter /app/).
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { solveCaptcha } from '../../server/src/captcha';
import { StachelServer } from '../support/server';

test.describe.configure({ mode: 'serial' });

const PORT = Number(process.env.E2E_BASE_PATH_PORT ?? 8698);
const PW = 'Kaktusblüte-im-Mai';
let server: StachelServer;
let dataDir: string;
let page: Page;
let boardId = '';
const failed: string[] = [];

const mailText = (to: string, subject: RegExp) => {
  const f = path.join(dataDir, 'mail.log');
  const all = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { to: string; subject: string; text: string }) : [];
  return all.find((m) => m.to === to && subject.test(m.subject))?.text;
};
async function mailLink(to: string, subject: RegExp, re: RegExp): Promise<string> {
  await expect.poll(() => mailText(to, subject) !== undefined, { timeout: 10_000 }).toBe(true);
  return re.exec(mailText(to, subject)!)![0];
}
const api = (p: string, body: unknown) =>
  fetch(`${server.url}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Stachel': '1' }, body: JSON.stringify(body) });

test.beforeAll(async ({ browser }) => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-e2e-basepath-'));
  server = new StachelServer(PORT, dataDir, 'http://127.0.0.1:9', path.join(import.meta.dirname, '../test-results/server-base-path.log'), {
    STACHEL_AUTH: 'local',
    STACHEL_MAIL_MODE: 'log',
    STACHEL_CAPTCHA_MAX: '20000',
    STACHEL_IMPRINT_URL: 'https://example.org/impressum',
    STACHEL_PRIVACY_URL: 'https://example.org/datenschutz',
    STACHEL_BASE_PATH: '/app',
    STACHEL_LANDING: '1',
    STACHEL_REPO_URL: 'https://github.com/example/stachel',
  });
  await server.start();
  // Konto über die API anlegen (Registrieren im Browser prüft accounts.spec.ts)
  const c = await (await fetch(`${server.url}/api/auth/captcha`)).json();
  expect((await api('/api/auth/register', { name: 'Pia Pfad', email: 'pia@example.org', password: PW, terms: true, captcha: solveCaptcha(c) })).status).toBe(200);
  const ctx = await browser.newContext({ baseURL: server.url, viewport: { width: 1280, height: 800 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url });
  page = await ctx.newPage();
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
});

test.afterAll(async () => {
  await page?.context().close();
  await server?.stop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Produktseite unter / mit Weg in die Web-App', async () => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Das Whiteboard');
  await expect(page.getByText('bald im Play Store').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Quellcode auf GitHub' })).toHaveAttribute('href', 'https://github.com/example/stachel');
  await expect(page.locator('footer').getByRole('link', { name: 'Impressum' })).toHaveAttribute('href', 'https://example.org/impressum');
  // alle Bilder geladen
  for (const img of await page.locator('main img').all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0)).toBe(true);
  }
  await page.getByRole('link', { name: 'Im Browser öffnen' }).first().click();
  await expect(page).toHaveURL(/\/app\/$/);
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
});

test('Bestätigungslink aus der Mail (/app/verify/<token>) → anmelden unter /app/', async () => {
  const link = await mailLink('pia@example.org', /bestätigen/, /http:\/\/127\.0\.0\.1:\d+\/\S+/);
  expect(link).toMatch(/\/app\/verify\/[\w-]{20,}$/);
  await page.goto(link);
  await expect(page.getByTestId('login-info')).toContainText('E-Mail-Adresse bestätigt');
  // Token ist aus der Adresszeile entfernt, die App bleibt unter /app/
  expect(new URL(page.url()).pathname).toBe('/app/');
  expect(page.url()).not.toContain('verify=');
  await page.getByLabel('E-Mail-Adresse').fill('pia@example.org');
  await page.getByLabel('Passwort', { exact: true }).fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Neues Board' })).toBeVisible();
  await expect(page.getByTestId('account-link')).toHaveAttribute('href', '/app/?konto=1');
});

test('Board anlegen, bearbeiten, Teilen-Link /app/b/<id>', async () => {
  await page.getByRole('button', { name: 'Neues Board' }).click();
  await page.getByRole('dialog', { name: 'Neues Board' }).getByLabel('Name').fill('Pfad-Board');
  await page.getByRole('dialog', { name: 'Neues Board' }).getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/\?b=[\w-]+$/);
  boardId = new URL(page.url()).searchParams.get('b')!;
  await expect(page.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
  await page.keyboard.press('n');
  await page.mouse.click(520, 380);
  await expect(page.locator('.rt.editing')).toBeFocused();
  await page.keyboard.type('Unter /app');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-type="sticky"]')).toHaveCount(1);

  await page.getByTestId('share-open').click();
  const dlg = page.getByTestId('share-dialog');
  await dlg.getByRole('button', { name: 'Link kopieren' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${server.url}/app/b/${boardId}`);
  await dlg.getByRole('button', { name: 'Fertig' }).click();

  // zurück zur Übersicht bleibt unter /app/
  await page.getByRole('button', { name: 'Zur Übersicht' }).click();
  await expect(page).toHaveURL(/\/app\/$/);
  await expect(page.locator('.board-card', { hasText: 'Pfad-Board' })).toBeVisible();
});

test('Teilen-Link und alte Links öffnen das Board unter /app/', async () => {
  for (const from of [`/app/b/${boardId}`, `/b/${boardId}`, `/?b=${boardId}`]) {
    await page.goto(from);
    await expect(page, from).toHaveURL(new RegExp(`/app/\\?b=${boardId}$`));
    await expect(page.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
    await expect(page.locator('[data-type="sticky"]')).toContainText('Unter /app');
  }
  // alter Mail-Link ohne Präfix
  await page.goto(`/verify/${'A'.repeat(43)}`);
  await expect(page).toHaveURL(/\/app\/$/);
  // Offline-Modus (MCP-Renderer ruft /?offline=1 auf)
  await page.goto('/?offline=1');
  await expect(page).toHaveURL(/\/app\/\?offline=1$/);
  await expect(page.locator('.toolbar')).toBeVisible();
});

test('kein Abruf scheitert (Assets, Chunks, Schriften, Worker relativ unter /app/)', async () => {
  // erwartet: 401 von /api/auth/me vor der Anmeldung, 4xx von /api/auth/verify für den ungültigen Token
  expect(failed.filter((f) => !/ \/api\/auth\/(?:me|verify)$/.test(f))).toEqual([]);
});
