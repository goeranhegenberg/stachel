// Textformat: ein einzelnes Wort per Doppelklick markieren, Strg B / Strg U – nur dieses Wort, live beim zweiten Browser.
// Eigener Hocuspocus-Testserver (eigener freier Port pro Worker, s. syncServer.ts).
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Server } from '@hocuspocus/server';
import { startSyncServer } from './syncServer';
import { installFakeApi, sampleBoards, type FakeUser } from './fakeApi';

let server: Server;
let syncPort = 0;

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.beforeAll(async () => {
  test.setTimeout(180_000);
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

/** Bildschirmmitte eines Worts im bearbeiteten Text. */
const wordCenter = (p: Page, word: string) =>
  p.evaluate((w) => {
    const root = document.querySelector('.rt.editing')!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf(w);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + w.length);
      const b = r.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
    throw new Error(`Wort ${w} nicht gefunden`);
  }, word);

test('Doppelklick auf ein Wort, Strg B und Strg U formatieren nur dieses Wort – live beim zweiten Browser', async ({ browser }) => {
  const a = await openAs(browser, { key: 'm:12', name: 'Mara Lindner', isOrga: true }, 'sess-mara');
  const b = await openAs(browser, { key: 'm:31', name: 'Jonas Keller', isOrga: false }, 'sess-jonas');

  await a.keyboard.press('n');
  await a.mouse.click(640, 400);
  await expect(a.locator('.rt.editing')).toBeFocused();
  await a.keyboard.type('Hallo Welt heute');
  await a.keyboard.press('Escape');
  await expect(b.locator('[data-type="sticky"] .sticky-text')).toHaveText('Hallo Welt heute');

  // erneut bearbeiten, Wort per Doppelklick markieren
  const box = (await a.locator('[data-type="sticky"]').boundingBox())!;
  await a.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(a.locator('.rt.editing')).toBeFocused();
  // Schriftgröße passt sich nach dem Öffnen noch an (fit) – Wortposition erst danach nehmen, notfalls neu klicken
  await expect(async () => {
    const w = await wordCenter(a, 'Welt');
    await a.mouse.dblclick(w.x, w.y);
    expect(await a.evaluate(() => String(getSelection()).trim())).toBe('Welt');
  }).toPass({ timeout: 10_000 });
  // ProseMirror übernimmt die Browser-Auswahl asynchron (selectionchange) – erst dann formatieren
  await a.waitForFunction(() => {
    const ed = (document.querySelector('.rt.editing.ProseMirror, .rt.editing .ProseMirror, .ProseMirror') as any)?.editor;
    if (!ed) return false;
    const { from, to } = ed.state.selection;
    return ed.state.doc.textBetween(from, to).trim() === 'Welt';
  });
  await a.keyboard.press('Control+b');
  await a.keyboard.press('Control+u');
  await expect(a.locator('.rt.editing strong')).toHaveText('Welt');
  await expect(a.locator('.rt.editing u')).toHaveText('Welt');

  // zweiter Browser: nur „Welt“ fett und unterstrichen
  const noteB = b.locator('[data-type="sticky"] .sticky-text');
  await expect(noteB.locator('strong')).toHaveText('Welt');
  await expect(noteB.locator('u')).toHaveText('Welt');
  await expect(noteB).toHaveText('Hallo Welt heute');

  // nach dem Beenden bleibt es so (auch im ersten Browser)
  await a.keyboard.press('Escape');
  await expect(a.locator('[data-type="sticky"] .sticky-text strong')).toHaveText('Welt');

  await a.context().close();
  await b.context().close();
});
