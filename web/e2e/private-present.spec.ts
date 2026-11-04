// Präsentation: Sprechernotizen (nur die präsentierende Person sieht sie) und Übergabe an eine andere Person
// (docs/features/private.md §7) – zwei Browser über einen Test-Sync-Server.
import { expect, test, type Browser, type Page } from '@playwright/test';
import path from 'node:path';
import type { Server } from '@hocuspocus/server';
import { startSyncServer } from './syncServer';
import { installFakeApi, sampleBoards, type FakeUser } from './fakeApi';

const OUT = path.resolve(import.meta.dirname, '../../docs/screenshots');

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

async function openAs(browser: Browser, user: FakeUser, session: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addCookies([{ name: 'stachel_session', value: session, domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();
  await installFakeApi(page, { loggedIn: true, user, boards: sampleBoards(), syncPort });
  await page.goto('/?b=b-plan');
  await expect(page.getByTestId('status')).toHaveText('Live');
  return page;
}

const tool = (page: Page, label: string) => page.getByRole('navigation').getByRole('button', { name: label, exact: true }).click();

test('Sprechernotizen nur bei der präsentierenden Person; Übergabe an Jonas, Mara folgt danach', async ({ browser }) => {
  const a = await openAs(browser, { key: 'm:12', name: 'Mara Lindner', isOrga: true }, 'sess-mara');
  const b = await openAs(browser, { key: 'm:31', name: 'Jonas Keller', isOrga: false }, 'sess-jonas');
  await tool(a, 'Rahmen');
  await a.mouse.click(330, 300);
  await a.keyboard.press('Escape');
  await tool(a, 'Rahmen');
  await a.mouse.click(1040, 600);
  await a.keyboard.press('Escape');
  await expect(b.locator('[data-type="frame"]')).toHaveCount(2);

  // Notizen zum ersten Rahmen schreiben
  await a.getByRole('button', { name: 'Rahmen-Liste' }).click();
  const panel = a.getByRole('dialog', { name: 'Rahmen' });
  await panel.getByRole('button', { name: /^Sprechernotizen zu/ }).first().click();
  await panel.getByTestId('frame-notes').fill('Begrüßung, dann Lageplan zeigen');
  await panel.getByRole('button', { name: 'Präsentieren', exact: true }).click();
  await expect(a.getByTestId('present-notes')).toContainText('Begrüßung, dann Lageplan zeigen');
  const banner = b.locator('.structure-follow');
  await expect(banner).toContainText('Mara Lindner');
  await banner.getByRole('button', { name: 'Folgen' }).click();
  await expect(b.getByTestId('present-notes')).toHaveCount(0);
  await a.screenshot({ path: path.join(OUT, 'present-notizen.png') });

  // Übergabe an Jonas
  await a.getByRole('button', { name: 'Übergeben an …' }).click();
  await a.getByRole('button', { name: 'Jonas Keller' }).click();
  const offer = b.getByTestId('present-offer');
  await expect(offer).toContainText('Mara Lindner möchte dir die Präsentation übergeben');
  await b.screenshot({ path: path.join(OUT, 'present-uebergabe.png') });
  await offer.getByRole('button', { name: 'Übernehmen' }).click();
  // Jonas präsentiert ab demselben Rahmen und sieht die Notizen; Mara ist raus und folgt Jonas
  await expect(b.getByTestId('present-pos')).toHaveText('1 / 2');
  await expect(b.getByTestId('present-notes')).toContainText('Begrüßung');
  await expect(a.getByTestId('present-pos')).toHaveCount(0);
  const follow = a.locator('.structure-follow');
  await expect(follow).toContainText('Jonas Keller');
  await expect(follow.getByRole('button', { name: 'Nicht mehr folgen' })).toBeVisible();
  await b.keyboard.press('ArrowRight');
  await expect(follow).toContainText('2/2');
  await a.context().close();
  await b.context().close();
});
