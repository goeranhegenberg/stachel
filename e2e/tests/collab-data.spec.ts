// Ende-zu-Ende: Datenkorrektheit bei gleichzeitiger Arbeit gegen den ECHTEN Server. Drei Browser auf einem Board:
// gleichzeitig anlegen (alle sehen dieselbe Reihenfolge), Rückgängig nimmt nur eigene Schritte zurück, Bearbeiten
// während eines Server-Neustarts (Änderungen in der Pause kommen nach dem Wiederverbinden an und bleiben gespeichert).
import { expect, test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeOrg } from '../../server/test/fake-org';
import { E2E_PORT } from '../playwright.config';
import { StachelServer } from '../support/server';

test.describe.configure({ mode: 'serial' });

// eigener Port, damit die Datei parallel zu live.spec laufen kann
const PORT = E2E_PORT + 3;
const USERS = ['Anna', 'Ben', 'Cleo'];
let org: FakeOrg;
let server: StachelServer;
let dataDir: string;
let pages: Page[] = [];
let boardUrl = '';

const stickies = (p: Page) => p.locator('[data-type="sticky"]');
/** ids der Haftnotizen in DOM-Reihenfolge (= Ebenen-Reihenfolge, unten zuerst) */
const stickyIds = (p: Page) => stickies(p).evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));

async function login(browser: Browser, name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: server.url });
  const p = await ctx.newPage();
  await p.goto('/');
  await p.getByRole('textbox', { name: 'Benutzername' }).fill(name);
  await p.locator('#p').fill('kaktus-123');
  await p.getByRole('button', { name: 'Anmelden' }).click();
  await expect(p.getByRole('button', { name: 'Neues Board' })).toBeVisible();
  return p;
}

async function openBoard(p: Page) {
  await p.goto(boardUrl);
  await expect(p.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
}

/** Haftnotiz an (x, y) anlegen, Text tippen, Bearbeitung und Auswahl beenden. */
async function addSticky(p: Page, x: number, y: number, text: string) {
  await p.keyboard.press('Escape');
  await p.keyboard.press('n');
  await p.mouse.click(x, y);
  await expect(p.locator('.rt.editing')).toBeFocused();
  await p.keyboard.type(text);
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
}

test.beforeAll(async () => {
  org = await new FakeOrg().start();
  for (const u of USERS) org.addAdmin(u, 'kaktus-123');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-e2e-collab-'));
  server = new StachelServer(PORT, dataDir, org.url, path.join(import.meta.dirname, '../test-results/server-collab.log'));
  await server.start();
});

test.afterAll(async () => {
  for (const p of pages) await p.context().close();
  await server?.stop();
  await org?.stop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('drei Browser legen gleichzeitig an: alle sehen dieselben Notizen in derselben Reihenfolge', async ({ browser }) => {
  pages = await Promise.all(USERS.map((u) => login(browser, u)));
  const res = await pages[0].request.post('/api/boards', { data: { title: 'Gleichzeitig' }, headers: { 'X-Stachel': '1' } });
  const { board } = await res.json();
  boardUrl = `/?b=${board.id}`;
  await Promise.all(pages.map(openBoard));

  // je zwei Notizen pro Person, möglichst gleichzeitig
  for (let round = 0; round < 2; round++) {
    await Promise.all(pages.map((p, i) => addSticky(p, 260 + i * 260, 260 + round * 260, `${USERS[i]} ${round + 1}`)));
  }
  for (const p of pages) await expect(stickies(p)).toHaveCount(6);
  const order = await stickyIds(pages[0]);
  for (const p of pages.slice(1)) await expect.poll(() => stickyIds(p)).toEqual(order);
  for (const [i, u] of USERS.entries()) await expect(stickies(pages[(i + 1) % 3]).filter({ hasText: `${u} 2` })).toHaveCount(1);
});

test('Rückgängig nimmt nur eigene Schritte zurück', async () => {
  const [a, b, c] = pages;
  await addSticky(a, 1050, 260, 'Annas letzte');
  await expect(stickies(b).filter({ hasText: 'Annas letzte' })).toHaveCount(1);
  // Ben legt danach selbst etwas an; Anna drückt Strg Z, bis ihre Notiz ganz weg ist (Text und Anlegen sind eigene Schritte)
  await addSticky(b, 1050, 560, 'Bens letzte');
  await expect(stickies(a).filter({ hasText: 'Bens letzte' })).toHaveCount(1);
  await a.getByTestId('board').focus();
  let steps = 0;
  while ((await stickies(a).count()) > 7 && steps < 4) {
    await a.keyboard.press('Control+z');
    steps++;
    await a.waitForTimeout(200);
    // Bens Notiz bleibt bei jedem Schritt unberührt
    await expect(stickies(a).filter({ hasText: 'Bens letzte' })).toHaveCount(1);
  }
  await expect(stickies(a)).toHaveCount(7);
  for (const p of [b, c]) {
    await expect(stickies(p)).toHaveCount(7);
    await expect(stickies(p).filter({ hasText: 'Bens letzte' })).toHaveCount(1);
  }
  // Wiederholen bringt sie bei allen zurück
  for (let i = 0; i < steps; i++) await a.keyboard.press('Control+y');
  for (const p of pages) await expect(stickies(p).filter({ hasText: 'Annas letzte' })).toHaveCount(1);
  // Cleos Strg Z trifft nur Cleos eigene Notiz, nicht die von Anna oder Ben
  await c.getByTestId('board').focus();
  await c.keyboard.press('Control+z');
  await c.waitForTimeout(300);
  for (const p of pages) {
    await expect(stickies(p).filter({ hasText: 'Annas letzte' })).toHaveCount(1);
    await expect(stickies(p).filter({ hasText: 'Bens letzte' })).toHaveCount(1);
    await expect(stickies(p).filter({ hasText: 'Anna 2' })).toHaveCount(1);
  }
  await c.keyboard.press('Control+y');
  for (const p of pages) await expect(stickies(p)).toHaveCount(8);
});

test('Server-Neustart während der Bearbeitung: Änderungen aus der Pause gehen nicht verloren', async () => {
  const [a, b, c] = pages;
  await server.stop();
  await expect(a.getByTestId('status')).not.toHaveText('Live', { timeout: 20_000 });
  // Anna arbeitet weiter, während der Server weg ist
  await addSticky(a, 140, 600, 'Offline notiert');
  await expect(stickies(a)).toHaveCount(9);
  await server.start();
  for (const p of [a, b, c]) await expect(p.getByTestId('status')).toHaveText('Live', { timeout: 45_000 });
  for (const p of [b, c]) await expect(stickies(p).filter({ hasText: 'Offline notiert' })).toHaveCount(1, { timeout: 20_000 });
  // gespeichert: nach einem weiteren Neustart und Neuladen ist alles da, in derselben Reihenfolge
  const order = await stickyIds(a);
  await a.waitForTimeout(500);
  await server.restart();
  for (const p of pages) {
    await p.reload();
    await expect(p.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
    await expect(stickies(p)).toHaveCount(9);
    await expect.poll(() => stickyIds(p)).toEqual(order);
  }
});
