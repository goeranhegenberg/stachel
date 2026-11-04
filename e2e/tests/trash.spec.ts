// Papierkorb gegen den ECHTEN Server mit zwei Browsern (Mara, Jonas), echte Bedienung:
// Mara löscht ein Board, das Jonas offen hat → Jonas sieht „von Mara in den Papierkorb verschoben“, seine Übersicht
// aktualisiert sich live (Board weg, im Papierkorb); Mara stellt im Papierkorb wieder her → Jonas „Board ist wieder da“,
// Inhalt vollständig. Rückgängig-Hinweis, Link auf ein Board im Papierkorb (mit Wiederherstellen), endgültig löschen,
// Papierkorb leeren, Handy 390×844. Screenshots: docs/screenshots/trash-*.png.
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

const shot = (p: Page, name: string) => p.screenshot({ path: path.join(SHOTS, `trash-${name}.png`), animations: 'disabled' });

test.beforeAll(async () => {
  org = await new FakeOrg().start();
  org.addAdmin('Mara', 'kaktus-123');
  org.addAdmin('Jonas', 'kaktus-123');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-e2e-trash-'));
  server = new StachelServer(E2E_PORT, dataDir, org.url, path.join(import.meta.dirname, '../test-results/server-trash.log'));
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

async function newBoard(p: Page, title: string): Promise<string> {
  await p.getByRole('button', { name: 'Neues Board' }).click();
  await p.getByRole('dialog', { name: 'Neues Board' }).getByLabel('Name').fill(title);
  await p.getByRole('dialog', { name: 'Neues Board' }).getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(p).toHaveURL(/\?b=[\w-]+$/);
  await expect(p.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
  return new URL(p.url()).searchParams.get('b')!;
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
}

const card = (p: Page, title: string) => p.locator('.board-card', { has: p.locator('.board-card__title', { hasText: title }) });
const trashCard = (p: Page, title: string) => p.getByTestId('trash-card').filter({ hasText: title });

/** Board über das Karten-Menü löschen (Bestätigung „In den Papierkorb“). */
async function deleteViaMenu(p: Page, title: string) {
  const c = card(p, title);
  await c.hover();
  await c.getByRole('button', { name: 'Board-Aktionen' }).click();
  await p.getByRole('menuitem', { name: 'Löschen' }).click();
  const dlg = p.getByRole('dialog', { name: 'Board löschen?' });
  await expect(dlg).toContainText('Papierkorb');
  await expect(dlg).toContainText('30 Tage');
  await dlg.getByRole('button', { name: 'In den Papierkorb' }).click();
  await expect(c).toHaveCount(0);
}

async function openTrash(p: Page) {
  const toggle = p.locator('.trash__toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

let mara: Page;
let jonas: Page;
let jonasList: Page;
let boardId = '';

test('A löscht, B hat das Board offen: Hinweis „in den Papierkorb verschoben“, Übersicht live; A stellt wieder her', async ({ browser }) => {
  mara = await login(browser, 'Mara');
  jonas = await login(browser, 'Jonas');
  jonasList = await jonas.context().newPage();
  await jonasList.goto('/');
  await openTrash(jonasList);
  await expect(jonasList.getByText('Der Papierkorb ist leer.')).toBeVisible();

  boardId = await newBoard(mara, 'Bühnenplan');
  await addSticky(mara, 520, 380, 'Bühne links');
  await expect(mara.locator('[data-type="sticky"]')).toHaveCount(1);
  // Stern und Vorschaubild sollen das Wiederherstellen überstehen
  await mara.goto('/');
  await card(mara, 'Bühnenplan').hover();
  await card(mara, 'Bühnenplan').getByTestId('board-fav').click();
  await expect(card(mara, 'Bühnenplan').getByTestId('board-fav')).toHaveAttribute('aria-pressed', 'true');

  await jonas.goto(`/?b=${boardId}`);
  await expect(jonas.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
  await expect(jonas.locator('[data-type="sticky"]')).toContainText('Bühne links');
  await expect(card(jonasList, 'Bühnenplan')).toBeVisible();

  // Mara löscht in ihrer Übersicht
  await mara.bringToFront();
  await deleteViaMenu(mara, 'Bühnenplan');
  await expect(mara.getByTestId('undo-toast')).toContainText('Board gelöscht');
  await expect(mara.getByTestId('undo-toast').getByRole('button', { name: 'Rückgängig' })).toBeVisible();
  // eigenes Löschen meldet die Live-Übersicht nicht noch einmal als Fehler-Hinweis
  await expect(mara.locator('.boards-error')).toHaveCount(0);
  await shot(mara, 'rueckgaengig');

  // Jonas im Editor: klarer Hinweis mit Namen, Frist und Wiederherstellen (er ist Orga)
  const dlg = jonas.getByRole('alertdialog');
  await expect(dlg.getByRole('heading')).toHaveText('Board wurde von Mara in den Papierkorb verschoben');
  await expect(dlg).toContainText('Wird endgültig gelöscht in 30 Tagen');
  await expect(dlg.getByRole('button', { name: 'Wiederherstellen' })).toBeVisible();
  await expect(jonas.getByTestId('status')).toHaveText('Gelöscht');
  await shot(jonas, 'editor-hinweis');
  // nichts mehr editierbar
  await jonas.keyboard.press('n');
  await jonas.mouse.dblclick(300, 420);
  await expect(jonas.locator('[data-type="sticky"]')).toHaveCount(1);

  // Jonas' Übersicht (anderer Tab, ohne Neuladen): Board weg, im Papierkorb mit Namen und Frist
  await expect(card(jonasList, 'Bühnenplan')).toHaveCount(0);
  await expect(jonasList.getByTestId('trash-count')).toHaveText('1');
  const tc = trashCard(jonasList, 'Bühnenplan');
  await expect(tc).toContainText('Gelöscht von Mara');
  await expect(tc.getByTestId('trash-purge')).toHaveText('Wird endgültig gelöscht in 30 Tagen');
  await jonasList.bringToFront();
  await shot(jonasList, 'uebersicht');

  // Mara stellt im Papierkorb wieder her (Hinweis vorher schließen)
  // (der Rückgängig-Hinweis verschwindet nach 8 s von selbst; steht er noch, schließt Mara ihn)
  const toast = mara.getByTestId('undo-toast');
  if (await toast.count()) await toast.getByRole('button', { name: 'Hinweis schließen' }).click({ timeout: 2000 }).catch(() => {});
  await expect(toast).toHaveCount(0, { timeout: 10_000 });
  await openTrash(mara);
  await trashCard(mara, 'Bühnenplan').getByRole('button', { name: '„Bühnenplan“ wiederherstellen' }).click();
  await expect(card(mara, 'Bühnenplan')).toBeVisible();
  await expect(trashCard(mara, 'Bühnenplan')).toHaveCount(0);
  await expect(card(mara, 'Bühnenplan').getByTestId('board-fav')).toHaveAttribute('aria-pressed', 'true');

  // Jonas: Übersicht live wieder da, Editor-Hinweis wird zu „Board ist wieder da“ → öffnen, Inhalt vollständig
  await expect(card(jonasList, 'Bühnenplan')).toBeVisible();
  await expect(jonasList.getByTestId('trash-count')).toHaveText('0');
  await expect(dlg.getByRole('heading')).toHaveText('Board ist wieder da');
  await expect(dlg).toContainText('Mara hat das Board wiederhergestellt.');
  await dlg.getByRole('button', { name: 'Board öffnen' }).click();
  await expect(jonas.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
  await expect(jonas.locator('[data-type="sticky"]')).toContainText('Bühne links');
  await expect(jonas.getByTestId('board-title')).toHaveText('Bühnenplan');
});

test('Rückgängig direkt nach dem Löschen holt das Board zurück', async () => {
  await mara.goto('/');
  await deleteViaMenu(mara, 'Bühnenplan');
  await expect(card(jonasList, 'Bühnenplan')).toHaveCount(0);
  await mara.getByTestId('undo-toast').getByRole('button', { name: 'Rückgängig' }).click();
  await expect(card(mara, 'Bühnenplan')).toBeVisible();
  await expect(mara.getByTestId('undo-toast')).toHaveCount(0);
  await expect(card(jonasList, 'Bühnenplan')).toBeVisible();
});

test('Link auf ein Board im Papierkorb: Hinweis mit Wiederherstellen; Übersicht und „Zuletzt geöffnet“ listen es nicht', async () => {
  await deleteViaMenu(mara, 'Bühnenplan');
  // Kurzlink wie aus dem Chat
  await jonas.goto(`/b/${boardId}`);
  const dlg = jonas.getByRole('alertdialog');
  await expect(dlg.getByRole('heading')).toHaveText('Dieses Board liegt im Papierkorb');
  await expect(dlg).toContainText('„Bühnenplan“ wurde am');
  await expect(dlg).toContainText('von Mara gelöscht');
  await shot(jonas, 'link');
  // Zur Übersicht: nicht in der Liste, auch nicht unter „Zuletzt geöffnet“
  await dlg.getByRole('button', { name: 'Zur Übersicht' }).click();
  await expect(jonas.getByRole('button', { name: 'Neues Board' })).toBeVisible();
  await expect(card(jonas, 'Bühnenplan')).toHaveCount(0);
  await expect(jonas.getByTestId('trash-count')).toHaveText('1');
  // die Liste (auch mit openedAt für „Zuletzt geöffnet“) enthält es nicht – Jonas hatte es geöffnet
  const listed = ((await (await jonas.request.get('/api/boards')).json()).boards as { id: string }[]).map((b) => b.id);
  expect(listed).not.toContain(boardId);
  // zurück (Browser-Verlauf) und dort wiederherstellen
  await jonas.goBack();
  await expect(dlg.getByRole('heading')).toHaveText('Dieses Board liegt im Papierkorb');
  await dlg.getByRole('button', { name: 'Wiederherstellen' }).click();
  await expect(jonas.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
  await expect(jonas.locator('[data-type="sticky"]')).toContainText('Bühne links');
  await expect(card(mara, 'Bühnenplan')).toBeVisible();
});

test('Endgültig löschen mit Bestätigung; danach „Board nicht verfügbar“; Papierkorb leeren', async () => {
  await mara.bringToFront();
  await deleteViaMenu(mara, 'Bühnenplan');
  await openTrash(mara);
  await trashCard(mara, 'Bühnenplan').getByRole('button', { name: '„Bühnenplan“ endgültig löschen' }).click();
  const confirm = mara.getByRole('dialog', { name: 'Endgültig löschen?' });
  await expect(confirm).toContainText('lässt sich nicht rückgängig machen');
  await shot(mara, 'endgueltig');
  // erst abbrechen: bleibt liegen
  await confirm.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(trashCard(mara, 'Bühnenplan')).toBeVisible();
  await trashCard(mara, 'Bühnenplan').getByRole('button', { name: '„Bühnenplan“ endgültig löschen' }).click();
  await confirm.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(trashCard(mara, 'Bühnenplan')).toHaveCount(0);
  await expect(trashCard(jonasList, 'Bühnenplan')).toHaveCount(0);
  await jonas.goto(`/?b=${boardId}`);
  await expect(jonas.getByRole('alertdialog').getByRole('heading')).toHaveText('Board nicht verfügbar');

  // Papierkorb leeren
  await mara.goto('/');
  for (const t of ['Probe A', 'Probe B']) {
    await newBoard(mara, t);
    await mara.goto('/');
  }
  await deleteViaMenu(mara, 'Probe A');
  await deleteViaMenu(mara, 'Probe B');
  await openTrash(mara);
  await expect(mara.getByTestId('trash-card')).toHaveCount(2);
  await mara.getByRole('button', { name: 'Papierkorb leeren' }).click();
  const empty = mara.getByRole('dialog', { name: 'Papierkorb leeren?' });
  await expect(empty).toContainText('Alle 2 Boards');
  await empty.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(mara.getByText('Der Papierkorb ist leer.')).toBeVisible();
  await expect(jonasList.getByTestId('trash-count')).toHaveText('0');
});

test('Handy 390×844: Löschen, Rückgängig-Hinweis, Papierkorb und Hinweis im Editor', async ({ browser }) => {
  const phone = await login(browser, 'Mara', { width: 390, height: 844 });
  const id = await newBoard(phone, 'Helferliste Handy');
  await phone.goto('/');
  await deleteViaMenu(phone, 'Helferliste Handy');
  await expect(phone.getByTestId('undo-toast')).toBeVisible();
  const box = (await phone.getByTestId('undo-toast').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await shot(phone, 'handy-rueckgaengig');
  await openTrash(phone);
  await trashCard(phone, 'Helferliste Handy').scrollIntoViewIfNeeded();
  await expect(trashCard(phone, 'Helferliste Handy').getByRole('button', { name: /wiederherstellen/ })).toBeInViewport();
  await shot(phone, 'handy-papierkorb');
  await phone.goto(`/?b=${id}`);
  await expect(phone.getByRole('alertdialog').getByRole('heading')).toHaveText('Dieses Board liegt im Papierkorb');
  await shot(phone, 'handy-editor');
  await phone.getByRole('alertdialog').getByRole('button', { name: 'Wiederherstellen' }).tap();
  await expect(phone.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
});
