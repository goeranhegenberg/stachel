// Runde 4 (Eingabe) live mit zwei Browsern: Wird die gerade bearbeitete Notiz von jemand anderem gelöscht, endet die
// Bearbeitung sauber mit Hinweis, und weiter getippte Buchstaben schalten keine Werkzeuge um.
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Server } from '@hocuspocus/server';
import { installFakeApi, sampleBoards, type FakeUser } from './fakeApi';
import { startSyncServer } from './syncServer';

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
const LENA: FakeUser = { key: 'm:44', name: 'Lena Brandt', isOrga: false };

async function openAs(browser: Browser, user: FakeUser, session: string, board: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addCookies([{ name: 'stachel_session', value: session, domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();
  await installFakeApi(page, { loggedIn: true, user, boards: sampleBoards(), syncPort });
  await page.goto(`/?b=${board}`);
  await expect(page.getByTestId('status')).toHaveText('Live');
  return page;
}

test('gerade bearbeitete Notiz wird gelöscht: Hinweis „Von <Name> gelöscht“, Tippen löst keine Kürzel aus', async ({ browser }) => {
  const lena = await openAs(browser, LENA, 'sess-lena', 'b-ideen');
  const mara = await openAs(browser, MARA, 'sess-mara', 'b-ideen');

  // Lena legt eine Notiz an und schreibt
  await lena.keyboard.press('n');
  await lena.mouse.click(640, 400);
  await expect(lena.locator('.sticky-text.editing')).toBeFocused();
  await lena.keyboard.type('C lena tippt');

  // Mara wählt sie aus und löscht sie
  const note = mara.locator('[data-type="sticky"]');
  await expect(note).toContainText('C lena tippt');
  const b = (await note.boundingBox())!;
  await mara.mouse.click(b.x + 20, b.y + b.height - 20);
  await mara.keyboard.press('Delete');
  await expect(mara.locator('[data-type="sticky"]')).toHaveCount(0);

  // Lena tippt weiter: kein Werkzeug schaltet um, Hinweis erscheint, nichts wird angelegt
  await expect(lena.locator('[data-type="sticky"]')).toHaveCount(0);
  await lena.keyboard.type(' weiter', { delay: 30 });
  await expect(lena.getByRole('status').filter({ hasText: 'Von Mara Lindner gelöscht' })).toBeVisible();
  await expect(lena.locator('.tb-btn.is-active')).toHaveAttribute('data-tool', 'select');
  await expect(lena.getByRole('group', { name: 'Werkzeug-Optionen' })).toHaveCount(0);
  await lena.screenshot({ path: 'test-results/input4-sync-geloescht.png' });
  // nach der Sperrzeit wirken die Kürzel wieder
  await lena.waitForTimeout(1100);
  await lena.keyboard.press('n');
  await expect(lena.locator('.tb-btn.is-active')).toHaveAttribute('data-tool', 'sticky');
});
