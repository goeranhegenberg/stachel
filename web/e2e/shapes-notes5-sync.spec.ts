// Runde 5 live mit zwei Browsern: Notizform (Rechteck), gemeinsames Drehen mit Einrasten und ein gebogener Pfeil
// zwischen zwei Notizen kommen beim zweiten Browser an. Test-Sync-Server auf freiem Port (syncServer.ts).
import { expect, test, type Browser, type Page } from '@playwright/test';
import path from 'node:path';
import type { Server } from '@hocuspocus/server';
import { installFakeApi, sampleBoards, type FakeUser } from './fakeApi';
import { startSyncServer } from './syncServer';

const OUT = path.resolve(import.meta.dirname, '../test-results/notes5');
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

const bar = (p: Page) => p.getByRole('toolbar', { name: 'Auswahl bearbeiten' });

async function addNote(p: Page, x: number, y: number, text: string) {
  await p.keyboard.press('Escape');
  await p.keyboard.press('n');
  await p.mouse.click(x, y);
  await expect(p.locator('.editing').first()).toBeFocused();
  await p.keyboard.type(text);
  await p.keyboard.press('Escape');
}

test('Notizform, Drehen mit Einrasten und gebogener Pfeil kommen live an', async ({ browser }) => {
  const a = await openAs(browser, MARA, 'sess-mara', 'b-plan');
  const b = await openAs(browser, JONAS, 'sess-jonas', 'b-plan');

  await addNote(a, 400, 300, 'Einlass');
  await addNote(a, 800, 520, 'Bar');
  const notesB = b.locator('[data-type="sticky"]');
  await expect(notesB).toHaveCount(2);

  // erste Notiz rechteckig machen
  await a.mouse.click(400, 300);
  await bar(a).getByRole('button', { name: 'Form der Notiz' }).click();
  await a.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await expect.poll(async () => Math.round((await notesB.filter({ hasText: 'Einlass' }).boundingBox())!.width)).toBeGreaterThan(330);

  // Pfeil vom rechten Andockpunkt der Notiz zur zweiten Notiz: beim anderen geschwungen
  await a.keyboard.press('Escape');
  await a.mouse.move(400, 300, { steps: 3 });
  const anchor = (await a.locator('[data-handle="anchor-e"]').boundingBox())!;
  await a.mouse.move(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2, { steps: 3 });
  await a.mouse.down();
  await a.mouse.move(700, 450, { steps: 6 });
  await a.mouse.move(800, 520, { steps: 6 });
  await a.mouse.up();
  await expect(b.locator('.obj-connector svg path:not(.hit)').first()).toHaveAttribute('d', /C/);

  // beide Notizen gemeinsam drehen, nahe 90° loslassen → genau 90° beim anderen
  await a.keyboard.press('Escape');
  await a.mouse.click(1100, 700);
  await a.keyboard.press('Control+a');
  const box = (await a.getByTestId('selection-box').boundingBox())!;
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const g0 = (await a.locator('[data-handle="rotate"]').boundingBox())!;
  const g = { x: g0.x + g0.width / 2, y: g0.y + g0.height / 2 };
  const at = (t: number) => {
    const a0 = Math.atan2(g.y - c.y, g.x - c.x) + (t * Math.PI) / 180;
    const r = Math.hypot(g.x - c.x, g.y - c.y);
    return { x: c.x + r * Math.cos(a0), y: c.y + r * Math.sin(a0) };
  };
  await a.mouse.move(g.x, g.y);
  await a.mouse.down();
  for (const t of [20, 50, 86]) await a.mouse.move(at(t).x, at(t).y, { steps: 4 });
  await expect(a.getByTestId('rotate-angle')).toHaveText('90°');
  await a.mouse.up();
  await expect(notesB.first()).toHaveCSS('transform', /matrix\(0, 1, -1, 0|matrix\(6\.\d+e-17, 1, -1, 6\.\d+e-17/);
  await b.screenshot({ path: path.join(OUT, 'sync-b.png') });
  await a.context().close();
  await b.context().close();
});
