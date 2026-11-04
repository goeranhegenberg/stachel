// Runde 4 gegen den ECHTEN Server: Board gelöscht bzw. umbenannt, während andere es offen haben (B1, B8),
// Live-Übersicht ohne Neuladen, Favoriten und „Zuletzt geöffnet“, 404-Seite, Kurzlink /b/<id>.
// Zwei Browser (Mara, Jonas) mit echter Bedienung. Screenshots: docs/screenshots/live-*.png.
import { expect, test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeOrg } from '../../server/test/fake-org';
import { E2E_PORT } from '../playwright.config';
import { SHOTS } from '../support/paths';
import { StachelServer } from '../support/server';

test.describe.configure({ mode: 'serial' });

let org: FakeOrg;
let server: StachelServer;
let dataDir: string;
const pages: Page[] = [];

const shot = (p: Page, name: string) => p.screenshot({ path: path.join(SHOTS, `live-${name}.png`) });

test.beforeAll(async () => {
  org = await new FakeOrg().start();
  org.addAdmin('Mara', 'kaktus-123');
  org.addAdmin('Jonas', 'kaktus-123');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-e2e4-'));
  server = new StachelServer(E2E_PORT, dataDir, org.url, path.join(import.meta.dirname, '../test-results/server-collab4.log'));
  await server.start();
});

test.afterAll(async () => {
  for (const p of pages) await p.context().close();
  await server?.stop();
  await org?.stop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

async function login(browser: Browser, name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  pages.push(p);
  await p.goto('/');
  await p.getByRole('textbox', { name: 'Benutzername' }).fill(name);
  await p.locator('#p').fill('kaktus-123');
  await p.getByRole('button', { name: 'Anmelden' }).click();
  await expect(p.getByRole('button', { name: 'Neues Board' })).toBeVisible();
  return p;
}

async function newBoard(p: Page, title: string): Promise<string> {
  await p.getByRole('button', { name: 'Neues Board' }).click();
  await p.getByRole('dialog', { name: 'Neues Board' }).getByLabel('Name').fill(title);
  await p.getByRole('dialog', { name: 'Neues Board' }).getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(p).toHaveURL(/\?b=[\w-]+$/);
  await expect(p.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
  return new URL(p.url()).searchParams.get('b')!;
}

const card = (p: Page, title: string) => p.locator('.board-card', { has: p.locator('.board-card__title', { hasText: title }) });

let mara: Page;
let maraList: Page;
let jonas: Page;
let boardId = '';

test('Live-Übersicht: neue und umbenannte Boards erscheinen ohne Neuladen; Titel live im Editor (B8)', async ({ browser }) => {
  mara = await login(browser, 'Mara');
  maraList = await mara.context().newPage();
  await maraList.goto('/');
  await expect(maraList.getByRole('button', { name: 'Neues Board' })).toBeVisible();
  jonas = await login(browser, 'Jonas');

  boardId = await newBoard(jonas, 'Bühnenplan');
  // Maras Übersicht (ohne Fokus, ohne Neuladen) zeigt das neue Board
  await expect(card(maraList, 'Bühnenplan')).toBeVisible({ timeout: 10_000 });

  await mara.goto(`/?b=${boardId}`);
  await expect(mara.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
  await expect(mara.getByTestId('board-title')).toHaveText('Bühnenplan');

  // Jonas benennt im Editor um → Mara sieht es im Editor, im Tab-Titel und in der Übersicht
  await jonas.getByTestId('board-title').click();
  await jonas.keyboard.press('Control+a');
  await jonas.keyboard.type('Bühnenplan Nord');
  await jonas.keyboard.press('Enter');
  await expect(mara.getByTestId('board-title')).toHaveText('Bühnenplan Nord');
  await expect(mara).toHaveTitle('Bühnenplan Nord · Stachel');
  await expect(card(maraList, 'Bühnenplan Nord')).toBeVisible();

  // gleichzeitig umbenennen: am Ende zeigen beide denselben Titel wie der Server
  await Promise.all([
    (async () => {
      await mara.getByTestId('board-title').click();
      await mara.keyboard.press('Control+a');
      await mara.keyboard.type('Name von Mara');
      await mara.keyboard.press('Enter');
    })(),
    (async () => {
      await jonas.getByTestId('board-title').click();
      await jonas.keyboard.press('Control+a');
      await jonas.keyboard.type('Name von Jonas');
      await jonas.keyboard.press('Enter');
    })(),
  ]);
  const serverTitle = async () => {
    const r = await mara.request.get('/api/boards');
    return ((await r.json()).boards as { id: string; title: string }[]).find((b) => b.id === boardId)!.title;
  };
  await expect.poll(async () => [await mara.getByTestId('board-title').textContent(), await jonas.getByTestId('board-title').textContent()]).toEqual([await serverTitle(), await serverTitle()]);
});

test('Favoriten und „Zuletzt geöffnet“ in der Übersicht', async () => {
  await jonas.goto('/');
  await newBoard(jonas, 'Helferliste');
  await jonas.goto('/');
  await expect(card(maraList, 'Helferliste')).toBeVisible({ timeout: 10_000 });
  // Mara markiert das ältere Board als Favorit → steht oben, auch nach dem Neuladen
  const fav = card(maraList, 'Name von').getByTestId('board-fav');
  await card(maraList, 'Name von').hover();
  await fav.click();
  await expect(fav).toHaveAttribute('aria-pressed', 'true');
  await expect(maraList.locator('.board-grid .board-card__title').first()).toContainText('Name von');
  await maraList.reload();
  await expect(maraList.locator('.board-grid .board-card__title').first()).toContainText('Name von');
  await expect(card(maraList, 'Name von').getByTestId('board-fav')).toHaveAttribute('aria-pressed', 'true');
  // Jonas hat keinen Stern
  await expect(card(jonas, 'Name von').getByTestId('board-fav')).toHaveAttribute('aria-pressed', 'false');
  // Zuletzt geöffnet: Jonas hat beide geöffnet, „Helferliste“ zuletzt
  await jonas.getByRole('radio', { name: 'Zuletzt geöffnet' }).click();
  await expect(jonas.locator('.board-grid .board-card__title').first()).toContainText('Helferliste');
  await expect(jonas.locator('.board-grid .board-card__meta').first()).toContainText('Geöffnet');
  await shot(maraList, 'favoriten');
});

test('Board gelöscht, während Jonas es offen hat (B1): klarer Hinweis, nichts mehr editierbar, zur Übersicht', async () => {
  await jonas.goto(`/?b=${boardId}`);
  await expect(jonas.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
  // Mara löscht es in ihrer Übersicht
  await maraList.bringToFront();
  const c = card(maraList, 'Name von');
  await c.getByRole('button', { name: 'Board-Aktionen' }).click();
  await maraList.getByRole('menuitem', { name: 'Löschen' }).click();
  await maraList.getByRole('button', { name: 'In den Papierkorb' }).click();
  await expect(c).toHaveCount(0);

  const dlg = jonas.getByRole('alertdialog');
  await expect(dlg).toBeVisible({ timeout: 5000 });
  await expect(dlg.getByRole('heading')).toHaveText('Board wurde von Mara in den Papierkorb verschoben');
  await expect(jonas.getByTestId('status')).not.toHaveText('Live');
  await shot(jonas, 'board-geloescht');
  // nichts mehr editierbar: Tastenkürzel und Doppelklick legen nichts an
  const notes = jonas.locator('[data-type="sticky"]');
  const before = await notes.count();
  await jonas.keyboard.press('n');
  await jonas.mouse.dblclick(300, 400);
  await expect(notes).toHaveCount(before);
  // Maras eigener Editor-Tab auf dem Board sagt „Du hast …“
  await expect(mara.getByRole('alertdialog').getByRole('heading')).toHaveText('Du hast dieses Board in den Papierkorb verschoben');
  // Zur Übersicht
  await dlg.getByRole('button', { name: 'Zur Übersicht' }).click();
  await expect(jonas.getByRole('button', { name: 'Neues Board' })).toBeVisible();
  await expect(card(jonas, 'Name von')).toHaveCount(0);
  // neu laden auf der alten Adresse: Board nicht verfügbar
  await jonas.goto(`/?b=${boardId}`);
  await expect(jonas.getByRole('alertdialog')).toContainText(/gelöscht|gibt es nicht/);
});

test('Kurzlink /b/<id> öffnet das Board; unbekannte Pfade zeigen eine 404-Seite', async () => {
  await jonas.goto('/');
  const id = await newBoard(jonas, 'Kurzlink');
  await mara.goto(`/b/${id}`);
  await expect(mara).toHaveURL(new RegExp(`\\?b=${id}$`));
  await expect(mara.getByTestId('board-title')).toHaveText('Kurzlink');
  const res = await mara.goto('/irgendwas/pfad');
  expect(res!.status()).toBe(404);
  await expect(mara.getByRole('heading')).toContainText('nicht gefunden');
  await mara.getByRole('link', { name: 'Zur Board-Übersicht' }).click();
  await expect(mara.getByRole('button', { name: 'Neues Board' })).toBeVisible();
});
