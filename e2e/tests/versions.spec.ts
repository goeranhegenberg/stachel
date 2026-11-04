// Versionsverlauf gegen den ECHTEN Server mit zwei Browsern, echte Bedienung:
// Mara speichert eine Version und arbeitet weiter; Jonas öffnet den Verlauf (Strg Alt H), sieht die alte Version
// schreibgeschützt auf der Leinwand (Live-Board und Mara unverändert), stellt sie wieder her → Mara sieht den alten Stand
// sofort. Sicherung vor dem Wiederherstellen, Version benennen, als Kopie öffnen, Handy 390×844.
// Screenshots: docs/screenshots/versions-*.png.
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
let mara: Page;
let jonas: Page;
let boardUrl = '';
const pages: Page[] = [];

const shot = (p: Page, name: string) => p.screenshot({ path: path.join(SHOTS, `versions-${name}.png`) });
const sticky = (p: Page, text: string) => p.locator('[data-type="sticky"]', { hasText: text });

test.beforeAll(async () => {
  org = await new FakeOrg().start();
  org.addAdmin('Mara', 'kaktus-123');
  org.addAdmin('Jonas', 'kaktus-123');
  org.addAdmin('Lena', 'kaktus-123');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-e2e-versions-'));
  server = new StachelServer(E2E_PORT, dataDir, org.url, path.join(import.meta.dirname, '../test-results/server-versions.log'));
  await server.start();
});

test.afterAll(async () => {
  for (const p of pages) await p.context().close();
  await server?.stop();
  await org?.stop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

async function login(browser: Browser, name: string, viewport = { width: 1280, height: 800 }): Promise<Page> {
  const ctx = await browser.newContext({ viewport, ...(viewport.width < 500 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const p = await ctx.newPage();
  pages.push(p);
  await p.goto('/');
  await p.getByRole('textbox', { name: 'Benutzername' }).fill(name);
  await p.locator('#p').fill('kaktus-123');
  await p.getByRole('button', { name: 'Anmelden' }).click();
  await expect(p.getByRole('button', { name: 'Neues Board' })).toBeVisible();
  return p;
}

/** Haftnotiz anlegen und beschriften (wie ein Mensch: N, Klick, tippen, Esc). */
async function addSticky(p: Page, x: number, y: number, text: string) {
  await p.keyboard.press('Escape');
  await p.keyboard.press('n');
  await p.mouse.click(x, y);
  await expect(p.locator('.rt.editing')).toBeFocused();
  await p.keyboard.type(text);
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  await expect(sticky(p, text)).toBeVisible();
}

async function openVersions(p: Page) {
  await p.getByRole('button', { name: 'Board-Menü' }).click();
  await p.getByRole('menuitem', { name: /Versionsverlauf/ }).click();
  await expect(p.getByTestId('versions-panel')).toBeVisible();
}

test('Mara legt an und speichert eine benannte Version', async ({ browser }) => {
  mara = await login(browser, 'Mara');
  await mara.getByRole('button', { name: 'Neues Board' }).click();
  await mara.getByRole('dialog', { name: 'Neues Board' }).getByLabel('Name').fill('Festival-Ablauf');
  await mara.getByRole('dialog', { name: 'Neues Board' }).getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(mara).toHaveURL(/\?b=[\w-]+$/);
  boardUrl = new URL(mara.url()).pathname + new URL(mara.url()).search;
  await expect(mara.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });

  await addSticky(mara, 420, 330, 'Bühne Nord');
  await addSticky(mara, 640, 330, 'Kasse am Eingang');

  await openVersions(mara);
  await expect(mara.getByText('Noch keine Versionen.', { exact: false })).toBeVisible();
  await mara.getByRole('button', { name: 'Version speichern' }).click();
  await mara.getByRole('textbox', { name: 'Name der Version' }).fill('Erster Entwurf');
  await mara.keyboard.press('Enter');
  await expect(mara.getByText('Version „Erster Entwurf“ gespeichert.')).toBeVisible();
  const entry = mara.getByTestId('version').filter({ hasText: 'Erster Entwurf' });
  await expect(entry).toBeVisible();
  await expect(entry).toContainText('Gespeichert von Mara');
  await expect(entry).toContainText('2 Objekte');
  await shot(mara, 'list');
  // Seitenleiste zu, weiterarbeiten
  await mara.getByRole('button', { name: 'Seitenleiste schließen' }).click();
});

test('Mara arbeitet weiter, Jonas sieht es live', async ({ browser }) => {
  jonas = await login(browser, 'Jonas');
  await jonas.goto(boardUrl);
  await expect(jonas.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
  await expect(sticky(jonas, 'Kasse am Eingang')).toBeVisible();

  await addSticky(mara, 420, 520, 'Bar');
  // „Kasse“ auswählen und löschen
  await sticky(mara, 'Kasse am Eingang').click();
  await mara.keyboard.press('Delete');
  await expect(sticky(mara, 'Kasse am Eingang')).toHaveCount(0);
  await expect(sticky(jonas, 'Bar')).toBeVisible();
  await expect(sticky(jonas, 'Kasse am Eingang')).toHaveCount(0);
});

test('Jonas sieht die alte Version schreibgeschützt; das Live-Board bleibt, wie es ist', async () => {
  await jonas.locator('[data-testid="board"]').click({ position: { x: 900, y: 650 } });
  await jonas.keyboard.press('Control+Alt+h');
  await expect(jonas.getByTestId('versions-panel')).toBeVisible();
  const entry = jonas.getByTestId('version').filter({ hasText: 'Erster Entwurf' });
  await entry.getByRole('button').first().click();

  const bar = jonas.getByTestId('versions-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('Vorschau: Stand von heute');
  await expect(sticky(jonas, 'Kasse am Eingang')).toBeVisible();
  await expect(sticky(jonas, 'Bar')).toHaveCount(0);
  // Werkzeuge weg, nur ansehen
  await expect(jonas.locator('.toolbar')).toBeHidden();
  await shot(jonas, 'preview');

  // Versuche zu bearbeiten ändern nichts: Taste N + Klick, Doppelklick, Entf
  await jonas.keyboard.press('n');
  await jonas.mouse.click(250, 620);
  const kasse = (await sticky(jonas, 'Kasse am Eingang').boundingBox())!;
  await jonas.mouse.dblclick(kasse.x + kasse.width / 2, kasse.y + kasse.height / 2);
  await jonas.keyboard.press('Delete');
  await expect(jonas.locator('[data-type="sticky"]')).toHaveCount(2);
  await expect(jonas.locator('.rt.editing')).toHaveCount(0);
  // Ziehen verschiebt die Ansicht, nicht die Notiz
  await expect(jonas.getByTestId('board')).toHaveClass(/tool-hand/);
  const before = (await sticky(jonas, 'Bühne Nord').boundingBox())!;
  await jonas.mouse.move(before.x + 40, before.y + 40);
  await jonas.mouse.down();
  for (let i = 1; i <= 6; i++) await jonas.mouse.move(before.x + 40 + i * 15, before.y + 40 + i * 10);
  await jonas.mouse.up();
  await expect.poll(async () => Math.round((await sticky(jonas, 'Bühne Nord').boundingBox())!.x - before.x)).toBe(90);

  // Mara (live) ist unberührt
  await expect(sticky(mara, 'Bar')).toBeVisible();
  await expect(sticky(mara, 'Kasse am Eingang')).toHaveCount(0);
});

test('Jonas stellt die Version wieder her → Mara sieht den alten Stand sofort', async () => {
  await jonas.getByTestId('version').filter({ hasText: 'Erster Entwurf' }).getByRole('button', { name: 'Diese Version wiederherstellen' }).click();
  const dialog = jonas.getByRole('dialog', { name: /wiederherstellen\?/ });
  await expect(dialog).toContainText('Der aktuelle Stand wird vorher als Version gesichert');
  await shot(jonas, 'confirm');
  await dialog.getByRole('button', { name: 'Wiederherstellen' }).click();

  await expect(jonas.getByTestId('versions-bar')).toHaveCount(0);
  await expect(jonas.getByText(/wiederhergestellt – alle sehen ihn jetzt/)).toBeVisible();
  // Live: beide sehen den alten Stand
  await expect(sticky(mara, 'Kasse am Eingang')).toBeVisible();
  await expect(sticky(mara, 'Bar')).toHaveCount(0);
  await expect(sticky(jonas, 'Kasse am Eingang')).toBeVisible();
  await expect(sticky(jonas, 'Bar')).toHaveCount(0);
  await expect(jonas.locator('.toolbar')).toBeVisible();
  await shot(mara, 'restored-other-user');

  // Liste: Sicherung des vorigen Stands und der Wiederherstellungs-Eintrag
  const panel = jonas.getByTestId('versions-panel');
  await expect(panel.getByTestId('version').filter({ hasText: 'Sicherung vor dem Wiederherstellen' })).toBeVisible();
  await expect(panel.getByTestId('version').filter({ hasText: 'Jonas hat den Stand von heute' })).toBeVisible();
  await shot(jonas, 'after-restore');

  // Jonas arbeitet normal weiter, Mara sieht es
  await jonas.getByRole('button', { name: 'Seitenleiste schließen' }).click();
  await addSticky(jonas, 900, 520, 'Sanitäter');
  await expect(sticky(mara, 'Sanitäter')).toBeVisible();
});

test('Mara benennt die Sicherung und öffnet sie als Kopie', async () => {
  await openVersions(mara);
  const backup = mara.getByTestId('version').filter({ hasText: 'Sicherung vor dem Wiederherstellen' });
  await backup.getByRole('button').first().click();
  await expect(mara.getByTestId('versions-bar')).toBeVisible();
  await expect(sticky(mara, 'Bar')).toBeVisible();
  await backup.getByRole('button', { name: 'Version benennen' }).click();
  await mara.getByRole('textbox', { name: 'Name der Version' }).fill('Mit Bar');
  await mara.keyboard.press('Enter');
  await expect(backup).toContainText('Mit Bar');
  await expect(mara.getByTestId('versions-bar')).toContainText('„Mit Bar“');

  // Esc: zurück zum aktuellen Stand
  await mara.keyboard.press('Escape');
  await expect(mara.getByTestId('versions-bar')).toHaveCount(0);
  await expect(sticky(mara, 'Bar')).toHaveCount(0);
  await expect(sticky(mara, 'Sanitäter')).toBeVisible();

  // Als Kopie öffnen → neues Board mit dem Stand der Sicherung
  await mara.getByTestId('version').filter({ hasText: 'Mit Bar' }).getByRole('button').first().click();
  await expect(mara.getByTestId('versions-bar')).toBeVisible();
  await mara.getByTestId('version').filter({ hasText: 'Mit Bar' }).getByRole('button', { name: 'Als Kopie öffnen' }).click();
  await expect(mara.getByTestId('board-title')).toHaveText(/Festival-Ablauf \(Stand /);
  await expect(mara.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
  await expect(sticky(mara, 'Bar')).toBeVisible();
  await expect(sticky(mara, 'Kasse am Eingang')).toHaveCount(0);
  await expect(mara.getByTestId('versions-bar')).toHaveCount(0);
  await expect(mara.locator('.toolbar')).toBeVisible();
});

test('Handy: Liste, Vorschau mit Balken, zurück', async ({ browser }) => {
  const lena = await login(browser, 'Lena', { width: 390, height: 844 });
  await lena.goto(boardUrl);
  await expect(lena.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
  await openVersions(lena);
  await lena.waitForTimeout(300); // Einblenden der Seitenleiste abwarten
  await shot(lena, 'phone-list');
  await lena.getByTestId('version').filter({ hasText: 'Erster Entwurf' }).getByRole('button').first().tap();
  const bar = lena.getByTestId('versions-bar');
  await expect(bar).toBeVisible();
  await expect(lena.getByTestId('versions-panel')).toHaveCount(0); // Liste gibt die Leinwand frei
  await expect(sticky(lena, 'Sanitäter')).toHaveCount(0);
  await shot(lena, 'phone-preview');
  await bar.getByRole('button', { name: 'Versionen' }).tap();
  await expect(lena.getByTestId('versions-panel')).toBeVisible();
  await lena.getByTestId('versions-current').tap();
  await expect(lena.getByTestId('versions-bar')).toHaveCount(0);
  await expect(sticky(lena, 'Sanitäter')).toBeVisible();
});
