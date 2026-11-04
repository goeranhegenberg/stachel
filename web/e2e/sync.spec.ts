// Echte Live-Kollaboration: zwei Browser über einen lokalen Hocuspocus-Testserver (Vite proxyt /sync dorthin).
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Server } from '@hocuspocus/server';
import { installFakeApi, sampleBoards, type FakeUser } from './fakeApi';
import { startSyncServer } from './syncServer';

let server: Server;
let syncPort = 0;
const authLog: string[] = [];

test.beforeAll(async () => {
  ({ server, port: syncPort } = await startSyncServer({
    // wie im Vertrag: Session-Cookie aus dem Upgrade-Request, unbekannte Boards ablehnen
    async onAuthenticate({ requestHeaders, documentName }) {
      const cookie = requestHeaders.get('cookie') ?? '';
      const m = cookie.match(/stachel_session=([^;]+)/);
      authLog.push(`${documentName}:${m?.[1] ?? '-'}`);
      // Gründe wie im Vertrag §4 (Hocuspocus schickt error.reason an den Provider)
      if (!m) throw Object.assign(new Error('not_logged_in'), { reason: 'not_logged_in' });
      if (documentName === 'board:b-lage') throw Object.assign(new Error('unknown_board'), { reason: 'unknown_board' });
      return { session: m[1] };
    },
  }));
});

test.afterAll(async () => {
  await server?.destroy();
});

async function openAs(browser: Browser, user: FakeUser, session: string | null, board = 'b-plan'): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (session) await ctx.addCookies([{ name: 'stachel_session', value: session, domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();
  await installFakeApi(page, { loggedIn: true, user, boards: sampleBoards(), syncPort });
  await page.goto(`/?b=${board}`);
  return page;
}

const MARA: FakeUser = { key: 'm:12', name: 'Mara Lindner', isOrga: true };
const JONAS: FakeUser = { key: 'm:31', name: 'Jonas Keller', isOrga: false };

test('zwei Personen arbeiten live auf demselben Board', async ({ browser }) => {
  const a = await openAs(browser, MARA, 'sess-mara');
  const b = await openAs(browser, JONAS, 'sess-jonas');
  await expect(a.getByTestId('status')).toHaveText('Live');
  await expect(b.getByTestId('status')).toHaveText('Live');
  await expect(a.getByTestId('board-title')).toHaveText('Festival · Ablauf');
  expect(authLog).toContain('board:b-plan:sess-mara');

  // A legt eine Notiz an → B sieht sie sofort
  await a.keyboard.press('n');
  await a.mouse.click(500, 400);
  await a.keyboard.type('Live aus Leipzig');
  await a.keyboard.press('Escape');
  const noteB = b.locator('[data-type="sticky"] .sticky-text');
  await expect(noteB).toHaveText('Live aus Leipzig');

  // Anwesenheit: Avatar + Live-Cursor mit Namen
  await expect(b.getByTestId('presence').getByTitle('Mara Lindner – hinspringen')).toBeVisible();
  await a.mouse.move(700, 300);
  await a.mouse.move(720, 320);
  await expect(b.locator('.ov-cursor', { hasText: 'Mara Lindner' })).toBeVisible();

  // B wählt die Notiz aus → A sieht B's Auswahl farbig umrandet
  const nb = (await b.locator('[data-type="sticky"]').boundingBox())!;
  await b.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await expect(a.locator('.ov-peer-sel')).toBeVisible();

  // B verschiebt, A sieht die neue Position
  await b.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await b.mouse.down();
  await b.mouse.move(nb.x + nb.width / 2 + 150, nb.y + nb.height / 2, { steps: 8 });
  await b.mouse.up();
  await expect.poll(async () => (await a.locator('[data-type="sticky"]').boundingBox())!.x).toBeGreaterThan(nb.x + 100);

  // Undo bei A macht nur A's Änderungen rückgängig: A's Text-/Anlege-Schritte, nicht B's Verschieben
  await a.mouse.click(1100, 700); // Fokus aufs Board
  // Text (bei langsamem Tippen evtl. mehrere Schritte, wortweise)
  for (let i = 0; i < 6 && (await noteB.textContent()) !== ''; i++) {
    await a.keyboard.press('Control+z');
    await a.waitForTimeout(150);
  }
  await expect(noteB).toHaveText('');
  await a.keyboard.press('Control+z'); // Anlegen
  await expect(b.locator('[data-type="sticky"]')).toHaveCount(0);
  await a.keyboard.press('Control+y');
  await expect(b.locator('[data-type="sticky"]')).toHaveCount(1);

  await a.context().close();
  await b.context().close();
});

test('ohne gültige Sitzung lehnt der Sync-Server ab', async ({ browser }) => {
  const p = await openAs(browser, MARA, null);
  await expect(p.getByRole('alertdialog')).toContainText('Kein Zugriff');
  await expect(p.getByRole('button', { name: 'Neu anmelden' })).toBeVisible();
  await expect(p.getByTestId('status')).toHaveText('Kein Zugriff');
  await p.context().close();
});

test('gelöschtes Board meldet der Sync-Server als unbekannt', async ({ browser }) => {
  const p = await openAs(browser, MARA, 'sess-mara', 'b-lage');
  await expect(p.getByRole('alertdialog')).toContainText('Dieses Board wurde gelöscht');
  await p.getByRole('alertdialog').getByRole('button', { name: 'Zur Übersicht' }).click();
  await expect(p.getByRole('heading', { name: 'Boards' })).toBeVisible();
  await p.context().close();
});
