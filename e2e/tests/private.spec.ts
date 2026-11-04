// Privater Modus Ende-zu-Ende (docs/features/private.md): echter Server, zwei Browser. Mara startet über das Board-Menü,
// Jonas schreibt verdeckt – Mara sieht nur einen Platzhalter, und der Text steht in keiner Sync-Nachricht, die Maras
// Browser bekommt. Nach dem Aufdecken (Countdown) sehen beide die Notiz. Screenshots: docs/screenshots/private-*.png.
import { expect, test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeOrg } from '../../server/test/fake-org';
import { E2E_PORT } from '../playwright.config';
import { SHOTS } from '../support/paths';
import { StachelServer } from '../support/server';

test.describe.configure({ mode: 'serial' });

const SECRET = 'Geheimer Vorschlag 42';
let org: FakeOrg;
let server: StachelServer;
let dataDir: string;
let jonasToken: string;
let a: Page; // Mara (moderiert)
let b: Page; // Jonas
let boardUrl = '';
/** alle WebSocket-Rahmen, die Maras Browser vom Server bekommt (Text als latin1, Suche nach UTF-8-Bytes) */
const received: Buffer[] = [];

const shot = (p: Page, name: string) => p.screenshot({ path: path.join(SHOTS, `private-${name}.png`) });

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  return ctx.newPage();
}

test.beforeAll(async () => {
  org = await new FakeOrg().start();
  org.addAdmin('Mara', 'kaktus-123');
  jonasToken = org.addMember(41, 'Jonas Keller');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-e2e-private-'));
  server = new StachelServer(E2E_PORT, dataDir, org.url, path.join(import.meta.dirname, '../test-results/server-private.log'));
  await server.start();
});

test.afterAll(async () => {
  await a?.context().close();
  await b?.context().close();
  await server?.stop();
  await org?.stop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Mara startet den privaten Modus, Jonas ist auf dem Board', async ({ browser }) => {
  a = await newPage(browser);
  a.on('websocket', (ws) => ws.on('framereceived', (f) => received.push(typeof f.payload === 'string' ? Buffer.from(f.payload) : Buffer.from(f.payload))));
  await a.goto('/');
  await a.getByRole('textbox', { name: 'Benutzername' }).fill('Mara');
  await a.locator('#p').fill('kaktus-123');
  await a.getByRole('button', { name: 'Anmelden' }).click();
  await a.getByRole('button', { name: 'Neues Board' }).click();
  await a.getByRole('dialog', { name: 'Neues Board' }).getByLabel('Name').fill('Retro');
  await a.getByRole('dialog', { name: 'Neues Board' }).getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(a).toHaveURL(/\?b=[\w-]+$/);
  boardUrl = new URL(a.url()).pathname + new URL(a.url()).search;
  await expect(a.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });

  b = await newPage(browser);
  const qr = b.waitForResponse((r) => r.url().endsWith('/api/auth/qr') && r.request().method() === 'POST');
  await b.goto('/');
  const { code } = await (await qr).json();
  const res = await fetch(`${server.url}/api/auth/qr/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jonasToken}` },
    body: JSON.stringify({ code }),
  });
  expect(res.status).toBe(200);
  await expect(b.getByRole('button', { name: 'Neues Board' })).toBeVisible({ timeout: 30_000 });
  await b.goto(boardUrl);
  await expect(b.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });

  await a.getByRole('button', { name: 'Board-Menü' }).click();
  await a.getByRole('menuitem', { name: 'Privater Modus …' }).click();
  const dlg = a.getByRole('dialog', { name: 'Privater Modus' });
  await dlg.getByLabel('Jede:r darf eigene Notizen vorher aufdecken').check();
  await shot(a, 'start');
  await dlg.getByTestId('private-start').click();
  await expect(a.getByTestId('private-bar')).toContainText('Du moderierst');
  await expect(b.getByTestId('private-bar')).toContainText('Mara moderiert');
});

test('Jonas schreibt verdeckt: Mara sieht nur den Platzhalter, der Text kommt nie bei ihr an', async () => {
  await b.keyboard.press('n');
  await b.mouse.click(560, 380);
  await expect(b.locator('.rt.editing')).toBeFocused();
  await b.keyboard.type(SECRET);
  await b.keyboard.press('Escape');
  await b.keyboard.press('Escape');
  await expect(b.locator('[data-type="sticky"]')).toContainText(SECRET);
  await expect(b.getByTestId('private-mine')).toHaveText('🔒 Nur für dich');
  await expect(a.getByTestId('private-placeholder')).toHaveCount(1);
  await expect(a.getByTestId('private-placeholder')).toContainText('Jonas');
  await expect(a.getByTestId('private-bar')).toContainText('1 verdeckt');
  await expect(a.locator('[data-type="sticky"]')).toHaveCount(0);
  await a.waitForTimeout(500);
  expect(await a.content()).not.toContain(SECRET);
  expect(received.some((f) => f.includes(Buffer.from(SECRET, 'utf8')))).toBe(false);
  await shot(a, 'platzhalter');
  await shot(b, 'eigene');
});

test('Aufdecken mit Countdown: beide sehen die Notiz, der Modus endet', async () => {
  await a.getByTestId('private-reveal').click();
  await expect(b.getByTestId('private-countdown')).toBeVisible();
  await shot(b, 'countdown');
  await expect(a.locator('[data-type="sticky"]')).toContainText(SECRET, { timeout: 8000 });
  await expect(a.getByTestId('private-placeholder')).toHaveCount(0);
  await expect(a.getByTestId('private-bar')).toHaveCount(0);
  await expect(b.getByTestId('private-mine')).toHaveCount(0);
  await expect(b.locator('[data-type="sticky"]')).toHaveCount(1);
  // nach dem Aufdecken ist es eine ganz normale Notiz: Mara kann sie bearbeiten, Jonas sieht es
  await a.locator('[data-type="sticky"]').dblclick();
  await expect(a.locator('.rt.editing')).toBeFocused();
  await a.keyboard.press('Control+End');
  await a.keyboard.type('!');
  await a.keyboard.press('Escape');
  await expect(b.locator('[data-type="sticky"]')).toContainText(`${SECRET}!`);
  await shot(a, 'aufgedeckt');
});
