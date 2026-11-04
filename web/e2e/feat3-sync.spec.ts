// Runde 3 (feat3) live mit zwei Browsern: Textmarker/Textfarbe/Durchgestrichen/Liste/Link im Rich-Text und der
// Textmarker-Strich kommen beim zweiten Browser an. Test-Sync-Server auf freiem Port (syncServer.ts).
import { expect, test, type Browser, type Page } from '@playwright/test';
import path from 'node:path';
import type { Server } from '@hocuspocus/server';
import { installFakeApi, sampleBoards, type FakeUser } from './fakeApi';
import { startSyncServer } from './syncServer';

const OUT = path.resolve(import.meta.dirname, '../test-results/feat3');
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

const bar = (p: Page) => p.getByTestId('richtext-bar');

async function selectWord(p: Page, word: string) {
  await p.locator('.rt.editing').evaluate((el, w) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf(w);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + w.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
      return;
    }
  }, word);
  await p.waitForFunction((w) => {
    const ed = (document.querySelector('.ProseMirror') as any)?.editor;
    const { from, to } = ed.state.selection;
    return ed.state.doc.textBetween(from, to) === w;
  }, word);
}

test('Markierung in mehreren Farben, Textfarbe, Durchgestrichen, Nummerierung und Link kommen live an', async ({ browser }) => {
  const a = await openAs(browser, MARA, 'sess-mara', 'b-plan');
  const b = await openAs(browser, JONAS, 'sess-jonas', 'b-plan');

  // Text-Objekt (Schriftgröße je Wort möglich)
  await a.keyboard.press('t');
  await a.mouse.click(520, 380);
  await expect(a.locator('.rt.editing')).toBeFocused();
  await a.keyboard.type('Bühne Bar Kasse Einlass');

  await selectWord(a, 'Bühne');
  await bar(a).getByRole('button', { name: 'Markierung', exact: true }).click();
  await bar(a).getByRole('button', { name: 'Markierung Grün' }).click();
  await selectWord(a, 'Bar');
  await bar(a).getByRole('button', { name: 'Markierung', exact: true }).click();
  await bar(a).getByRole('button', { name: 'Markierung Rosa' }).click();
  await selectWord(a, 'Kasse');
  await bar(a).getByRole('button', { name: 'Textfarbe' }).click();
  await bar(a).getByRole('button', { name: 'Textfarbe Pink' }).click();
  await bar(a).getByRole('button', { name: 'Durchgestrichen (Strg Umschalt S)' }).click();
  await selectWord(a, 'Einlass');
  await bar(a).getByTestId('richtext-size').click();
  await bar(a).getByRole('group', { name: 'Schriftgröße' }).getByRole('button', { name: '40', exact: true }).click();
  await selectWord(a, 'Einlass');
  await bar(a).getByRole('button', { name: 'Link (Strg K)' }).click();
  await a.getByRole('textbox', { name: 'Linkadresse' }).fill('example.org');
  await a.getByRole('textbox', { name: 'Linkadresse' }).press('Enter');
  await bar(a).getByRole('button', { name: 'Nummerierte Liste' }).click();

  // zweiter Browser sieht alles schon während der Bearbeitung
  const t = b.locator('[data-type="text"]');
  await expect(t.locator('mark', { hasText: 'Bühne' })).toHaveCSS('background-color', 'rgb(201, 225, 74)');
  await expect(t.locator('mark', { hasText: 'Bar' })).toHaveCSS('background-color', 'rgb(255, 179, 209)');
  await expect(t.locator('s', { hasText: 'Kasse' })).toBeVisible();
  await expect(t.locator('span[style*="color"]', { hasText: 'Kasse' }).first()).toHaveCSS('color', 'rgb(236, 78, 146)');
  await expect(t.locator('a.rt-link')).toHaveAttribute('href', /^https:\/\/example\.org\/?$/);
  await expect(t.locator('span[style*="font-size"]', { hasText: 'Einlass' }).first()).toBeVisible();
  await expect(t.locator('ol li')).toHaveCount(1);
  await a.keyboard.press('Escape');
  await b.screenshot({ path: path.join(OUT, 'sync-richtext-b.png') });

  // Markierung wieder entfernen kommt ebenso an
  await t.first().waitFor();
  const box = (await a.locator('[data-type="text"]').boundingBox())!;
  await a.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(a.locator('.rt.editing')).toBeFocused();
  await selectWord(a, 'Bar');
  await bar(a).getByRole('button', { name: 'Markierung', exact: true }).click();
  await bar(a).getByRole('button', { name: 'Ohne' }).click();
  await expect(t.locator('mark')).toHaveCount(1);
  await a.keyboard.press('Escape');

  await a.context().close();
  await b.context().close();
});

test('Textmarker-Strich erscheint live halbtransparent beim zweiten Browser', async ({ browser }) => {
  const a = await openAs(browser, MARA, 'sess-mara', 'b-lage');
  const b = await openAs(browser, JONAS, 'sess-jonas', 'b-lage');
  await a.keyboard.press('p');
  const opts = a.getByRole('group', { name: 'Werkzeug-Optionen' });
  await opts.getByRole('button', { name: 'Textmarker', exact: true }).click();
  await opts.getByRole('button', { name: 'Textmarker Grün' }).click();
  await a.mouse.move(400, 400);
  await a.mouse.down();
  await a.mouse.move(700, 420, { steps: 10 });
  await a.mouse.up();
  const stroke = b.locator('[data-type="pen"][data-marker="true"]');
  await expect(stroke).toHaveCount(1);
  expect(await stroke.evaluate((e) => getComputedStyle(e).mixBlendMode)).toBe('multiply');
  await expect(stroke.locator('path:not(.hit)')).toHaveAttribute('stroke', '#c9e14a');
  await a.context().close();
  await b.context().close();
});

test('Notiz-Tags und Objekt-Link kommen live an', async ({ browser }) => {
  const a = await openAs(browser, MARA, 'sess-mara', 'b-ideen');
  const b = await openAs(browser, JONAS, 'sess-jonas', 'b-ideen');
  for (const [x, text] of [
    [420, 'Bar'],
    [760, 'Kasse'],
  ] as const) {
    await a.keyboard.press('Escape');
    await a.keyboard.press('n');
    await a.mouse.click(x, 380);
    await expect(a.locator('.rt.editing')).toBeFocused();
    await a.keyboard.type(text);
    await a.keyboard.press('Escape');
  }
  // Notiz „Bar“ auswählen (nach Esc ist die zuletzt bearbeitete ausgewählt → erst andere wählen)
  await a.keyboard.press('Escape');
  // B schreibt gerade in „Bar“, A vergibt dort einen Tag: B bleibt in der Bearbeitung
  const bb = (await b.locator('[data-type="sticky"]', { hasText: 'Bar' }).boundingBox())!;
  await b.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await expect(b.locator('.rt.editing')).toBeFocused();
  await a.locator('[data-type="sticky"]', { hasText: 'Bar' }).click();
  await a.locator('.ctxbar').getByRole('button', { name: 'Tags' }).click();
  await a.getByRole('textbox', { name: 'Neuer Tag' }).fill('Getränke');
  await a.getByRole('textbox', { name: 'Neuer Tag' }).press('Enter');
  await expect(b.locator('[data-tags-for] .tools-tag')).toHaveText(['Getränke']);
  await expect(b.locator('.rt.editing')).toBeFocused();
  await b.keyboard.press('Control+End');
  await b.keyboard.type('!');
  await b.keyboard.press('Escape');
  await expect(a.locator('[data-type="sticky"]', { hasText: 'Bar!' })).toHaveCount(1);

  await a.keyboard.press('Escape');
  await a.locator('[data-type="sticky"]', { hasText: 'Bar' }).click();
  await a.locator('.ctxbar').getByRole('button', { name: 'Link zu Rahmen oder Objekt' }).click();
  await a.getByRole('button', { name: 'Ziel auf dem Board wählen …' }).click();
  // Klick geht an die Fang-Ebene über dem Board (wie beim Format übertragen) → per Koordinaten
  const kb = (await a.locator('[data-type="sticky"]', { hasText: 'Kasse' }).boundingBox())!;
  await a.mouse.click(kb.x + kb.width / 2, kb.y + kb.height / 2);
  const badge = b.locator('.tools-linkto');
  await expect(badge).toHaveAttribute('aria-label', 'Gehe zu: Kasse');
  await badge.click();
  // B springt hin und hat die Ziel-Notiz ausgewählt
  await expect(b.getByTestId('selection-box')).toBeVisible();
  await expect
    .poll(async () => {
      const s = (await b.getByTestId('selection-box').boundingBox())!;
      const k = (await b.locator('[data-type="sticky"]', { hasText: 'Kasse' }).boundingBox())!;
      return Math.abs(s.x + s.width / 2 - (k.x + k.width / 2)) < 12 && Math.abs(s.y + s.height / 2 - (k.y + k.height / 2)) < 12;
    })
    .toBe(true);
  await a.context().close();
  await b.context().close();
});
