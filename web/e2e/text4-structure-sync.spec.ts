// Runde 4 (x-text B2, B4) live mit zwei Browsern: Karten-Dialog und Tabellenzelle verlieren beim gleichzeitigen
// Bearbeiten keinen Text mehr. Test-Sync-Server auf freiem Port (syncServer.ts).
import { expect, test, type Browser, type Page } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import type { Server } from '@hocuspocus/server';
import { installFakeApi, sampleBoards, type FakeUser } from './fakeApi';
import { startSyncServer } from './syncServer';

// Belegbilder im Temp-Ordner (test-results leert jeder Playwright-Lauf, auch die parallelen)
const OUT = path.join(os.tmpdir(), 'stachel-text4');
let server: Server;
let syncPort = 0;

test.beforeAll(async () => {
  ({ server, port: syncPort } = await startSyncServer({
    async onAuthenticate({ requestHeaders }) {
      const m = (requestHeaders.get('cookie') ?? '').match(/stachel_session=([^;]+)/);
      if (!m) throw Object.assign(new Error('not_logged_in'), { reason: 'not_logged_in' });
      return { session: m[1] };
    },
  }));
});

test.afterAll(async () => {
  await server?.destroy();
});

const MARA: FakeUser = { key: 'm:12', name: 'Mara Lindner', isOrga: true };
const JONAS: FakeUser = { key: 'm:31', name: 'Jonas Keller', isOrga: false };

async function openAs(browser: Browser, user: FakeUser, session: string, board: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addCookies([{ name: 'stachel_session', value: session, domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();
  await installFakeApi(page, { loggedIn: true, user, boards: sampleBoards(), syncPort });
  await page.goto(`/?b=${board}`);
  await expect(page.getByTestId('status')).toHaveText('Live');
  return page;
}

async function block(page: Page, label: 'Karte' | 'Tabelle') {
  await page.getByRole('navigation').getByRole('button', { name: 'Karte, Tabelle, Mindmap', exact: true }).click();
  await page.getByRole('group', { name: 'Werkzeug-Optionen' }).getByRole('button', { name: label, exact: true }).click();
}

/** Karten-Dialog öffnen (Karte anklicken, „Karte öffnen“) */
async function openCard(p: Page) {
  await p.locator('.structure-card').first().click();
  await p.getByRole('button', { name: 'Karte öffnen' }).click();
  return p.getByRole('dialog', { name: 'Karte' });
}

test('Karten-Dialog: Beschreibung und Titel live, gleichzeitiges Tippen verliert nichts (B2)', async ({ browser }) => {
  const a = await openAs(browser, MARA, 'sess-mara', 'b-plan');
  const b = await openAs(browser, JONAS, 'sess-jonas', 'b-plan');

  await block(a, 'Karte');
  await a.mouse.click(640, 400);
  await a.keyboard.type('Bühnenplan');
  await a.keyboard.press('Escape');
  await expect(b.locator('.structure-card__title')).toHaveText('Bühnenplan');

  const da = await openCard(a);
  const db = await openCard(b);
  const descA = da.getByLabel('Beschreibung');
  const descB = db.getByLabel('Beschreibung');

  // nacheinander: Mara schreibt, Jonas ergänzt am Ende, Mara schreibt weiter
  await descA.click();
  await a.keyboard.type('Mara schreibt hier.');
  await expect(descB).toHaveValue('Mara schreibt hier.');
  await descB.click();
  await b.keyboard.press('Control+End');
  await b.keyboard.type(' Jonas ergänzt.');
  await expect(descA).toHaveValue('Mara schreibt hier. Jonas ergänzt.');
  // Maras Schreibmarke steht noch hinter „hier.“ – fremder Text davor/dahinter verschiebt sie nicht
  await a.keyboard.type(' Mara noch was.');
  await expect(descA).toHaveValue('Mara schreibt hier. Mara noch was. Jonas ergänzt.');
  await expect(descB).toHaveValue('Mara schreibt hier. Mara noch was. Jonas ergänzt.');

  // gleichzeitig: beide tippen Zeichen für Zeichen, Mara vorn, Jonas hinten
  await a.keyboard.press('Control+Home');
  await b.keyboard.press('Control+End');
  await Promise.all([a.keyboard.type('Vorn A. ', { delay: 25 }), b.keyboard.type(' Hinten B.', { delay: 25 })]);
  const want = 'Vorn A. Mara schreibt hier. Mara noch was. Jonas ergänzt. Hinten B.';
  await expect(descA).toHaveValue(want);
  await expect(descB).toHaveValue(want);

  // Titel: Jonas ergänzt, Mara sieht es im offenen Dialog sofort
  const titleA = da.getByLabel('Titel');
  const titleB = db.getByLabel('Titel');
  await titleB.click();
  await b.keyboard.press('End');
  await b.keyboard.type(' Nord');
  await expect(titleA).toHaveValue('Bühnenplan Nord');
  await titleA.click();
  await a.keyboard.press('Home');
  await a.keyboard.type('Neuer ');
  await expect(titleB).toHaveValue('Neuer Bühnenplan Nord');
  await a.screenshot({ path: path.join(OUT, 'karte-live-a.png') });

  await da.getByRole('button', { name: 'Fertig' }).click();
  await db.getByRole('button', { name: 'Fertig' }).click();
  await expect(a.locator('.structure-card__desc')).toHaveText(want);
  await expect(b.locator('.structure-card__desc')).toHaveText(want);
  await expect(b.locator('.structure-card__title')).toHaveText('Neuer Bühnenplan Nord');
});

test('Tabellenzelle: gleichzeitiges Tippen in derselben Zelle wird zusammengeführt (B4)', async ({ browser }) => {
  const a = await openAs(browser, MARA, 'sess-mara', 'b-lage');
  const b = await openAs(browser, JONAS, 'sess-jonas', 'b-lage');

  await block(a, 'Tabelle');
  await a.mouse.click(640, 400);
  await expect(a.locator('.structure-table__editor')).toBeFocused();
  await a.keyboard.type('Mara');
  await a.keyboard.press('Escape');
  await expect(b.locator('[data-cell="0:0"]')).toHaveText('Mara');

  // beide bearbeiten dieselbe Zelle
  await a.locator('[data-cell="0:0"]').dblclick();
  await expect(a.locator('.structure-table__editor')).toBeFocused();
  await b.locator('[data-cell="0:0"]').dblclick();
  await expect(b.locator('.structure-table__editor')).toBeFocused();
  await a.keyboard.press('Control+End');
  await b.keyboard.press('Control+End');
  await Promise.all([a.keyboard.type(' A1 A2 A3', { delay: 30 }), b.keyboard.type(' B1 B2 B3', { delay: 30 })]);
  // Zwischenstand ist live in beiden Editoren
  await expect
    .poll(async () => (await a.locator('.structure-table__editor').inputValue()) === (await b.locator('.structure-table__editor').inputValue()))
    .toBe(true);
  const v = await a.locator('.structure-table__editor').inputValue();
  // jede Eingabe bleibt am Stück (Schreibmarke haftet an den eigenen Zeichen), nichts geht verloren
  expect(v.startsWith('Mara')).toBe(true);
  for (const w of [' A1 A2 A3', ' B1 B2 B3']) expect(v).toContain(w);
  expect(v.length).toBe('Mara A1 A2 A3 B1 B2 B3'.length);
  await a.screenshot({ path: path.join(OUT, 'tabelle-live-a.png') });
  await a.keyboard.press('Escape');
  await b.keyboard.press('Escape');
  await expect(a.locator('[data-cell="0:0"]')).toHaveText(v);
  await expect(b.locator('[data-cell="0:0"]')).toHaveText(v);
});
