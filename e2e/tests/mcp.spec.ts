// KI-Zugang (MCP) gegen den echten Server: Token im Board-Menü anlegen, fertige Einrichtung sehen, mit dem Token die
// API nutzen, widerrufen. Eigener Server auf freiem Port (unabhängig von E2E_PORT). Screenshot: docs/screenshots/mcp-*.png
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { FakeOrg } from '../../server/test/fake-org';
import { SHOTS } from '../support/paths';
import { StachelServer } from '../support/server';

test.describe.configure({ mode: 'serial' });

let org: FakeOrg;
let server: StachelServer;
let dataDir: string;
let page: Page;
let boardId = '';
let secret = '';

const freePort = () =>
  new Promise<number>((r) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => r(p));
    });
  });

test.beforeAll(async ({ browser }) => {
  org = await new FakeOrg().start();
  org.addAdmin('Mara', 'kaktus-123');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-e2e-mcp-'));
  server = new StachelServer(await freePort(), dataDir, org.url, path.join(import.meta.dirname, '../test-results/server-mcp.log'));
  await server.start();
  page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
});

test.afterAll(async () => {
  await page?.context().close();
  await server?.stop();
  await org?.stop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Anmelden und Board öffnen', async () => {
  await page.goto(server.url);
  await page.getByRole('textbox', { name: 'Benutzername' }).fill('Mara');
  await page.locator('#p').fill('kaktus-123');
  await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/auth/password') && r.ok()), page.getByRole('button', { name: 'Anmelden' }).click()]);
  const res = await page.request.post(`${server.url}/api/boards`, { data: { title: 'KI-Test' }, headers: { 'X-Stachel': '1' } });
  boardId = (await res.json()).board.id;
  await page.goto(`${server.url}/?b=${boardId}`);
  await expect(page.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
});

test('KI-Zugang: Token anlegen zeigt Token und fertige Einrichtung', async () => {
  await page.locator('.tl-menu').click();
  await page.getByRole('menuitem', { name: 'KI-Zugang (MCP) …' }).click();
  const dlg = page.getByRole('dialog', { name: 'KI-Zugang (MCP)' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByText('Noch keine. Lege oben eins an.')).toBeVisible();
  await dlg.getByLabel('Neues Token').fill('Claude Code am Laptop');
  await dlg.getByRole('button', { name: 'Token anlegen' }).click();
  const fresh = dlg.getByTestId('mcp-fresh');
  await expect(fresh).toBeVisible();
  secret = (await fresh.getByLabel('API-Token').textContent())!.trim();
  expect(secret).toMatch(/^stk_[A-Za-z0-9_-]{40,}$/);
  // Claude Code: fertiger Befehl mit MCP-Adresse dieser Instanz und Token
  await expect(fresh.getByLabel('Einrichtung Claude Code')).toHaveText(`claude mcp add --transport http stachel ${server.url}/mcp --header "Authorization: Bearer ${secret}"`);
  await fresh.getByRole('tab', { name: 'Claude Desktop' }).click();
  await expect(fresh.getByLabel('Einrichtung Claude Desktop')).toContainText(`"${server.url}/mcp/stachel-mcp.tgz"`);
  await expect(dlg.getByTestId('mcp-token')).toHaveCount(1);
  await expect(dlg.getByTestId('mcp-token')).toContainText('Claude Code am Laptop');
  await expect(dlg.getByTestId('mcp-token')).toContainText(`…${secret.slice(-4)}`);
  await fresh.getByRole('tab', { name: 'Claude Code' }).click();
  await page.screenshot({ path: path.join(SHOTS, 'mcp-ki-zugang.png') });
});

test('mit dem Token: API als die Person, Assistent heißt „KI (für Mara)“', async () => {
  const me = await page.request.get(`${server.url}/api/tokens/me`, { headers: { Authorization: `Bearer ${secret}`, cookie: '' } });
  expect(me.status()).toBe(200);
  expect((await me.json()).ai.name).toBe('KI (für Mara)');
});

test('Widerrufen mit Rückfrage: Token gilt sofort nicht mehr', async () => {
  const dlg = page.getByRole('dialog', { name: 'KI-Zugang (MCP)' });
  await dlg.getByRole('button', { name: 'Token „Claude Code am Laptop“ widerrufen' }).click();
  await page.getByRole('dialog', { name: 'Token widerrufen?' }).getByRole('button', { name: 'Widerrufen' }).click();
  await expect(dlg.getByText('Noch keine. Lege oben eins an.')).toBeVisible();
  await expect(dlg.getByTestId('mcp-fresh')).toHaveCount(0);
  const res = await fetch(`${server.url}/api/boards`, { headers: { Authorization: `Bearer ${secret}` } });
  expect(res.status).toBe(401);
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
});
