// Runde 4 (Zusammenarbeit): Bugs aus der Erkundung x-collab mit echter Bedienung (Maus, Tastatur, zwei Browser).
// Offline-Teil mit eingespielten Anwesenden, Live-Teil über einen Hocuspocus-Testserver (e2e/syncServer.ts).
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Server } from '@hocuspocus/server';
import { centerOf, openOffline } from './helpers';
import { installFakeApi, sampleBoards, type FakeUser } from './fakeApi';
import { startSyncServer } from './syncServer';

const MARA = { key: 'm:12', name: 'Mara Lindner', color: '#ec4e92' };
const JONAS = { key: 'm:31', name: 'Jonas Keller', color: '#1763b5' };

type PeerIn = { user: typeof MARA; cursor?: { x: number; y: number } | null; selection?: string[]; extra?: Record<string, unknown>; clientId?: number };
async function setPeers(page: Page, peers: PeerIn[]) {
  await page.evaluate((list) => {
    const s = (window as any).__stachel.session;
    s.setPeers(list.map((p, i) => ({ clientId: p.clientId ?? 100 + i, user: p.user, cursor: p.cursor ?? null, selection: p.selection ?? [], extra: p.extra ?? {} })));
  }, peers);
}

async function seed(page: Page) {
  await page.evaluate(() => {
    const { store } = (window as any).__stachel;
    store.createMany([
      { id: 's1', type: 'sticky', x: -380, y: -140, w: 200, h: 200, color: '#fff27a', text: 'Bühne am See' },
      { id: 's2', type: 'sticky', x: -120, y: -140, w: 200, h: 200, color: '#c9e14a', text: 'Kinderzelt' },
    ]);
    store.stopCapturing();
  });
}

const ydump = (page: Page, name: string) => page.evaluate((n) => (window as any).__stachel.store.doc.getMap(n).toJSON(), name);

test.describe('offline', () => {
  test.beforeEach(async ({ page }) => {
    await openOffline(page);
    await seed(page);
    await setPeers(page, [{ user: MARA, cursor: { x: 420, y: 60 } }]);
  });

  test('B2: @Erwähnung als letztes Wort – erstes Enter übernimmt, zweites Enter sendet', async ({ page }) => {
    await page.keyboard.press('c');
    const c = await centerOf(page, 's1');
    await page.mouse.click(c.x, c.y);
    const input = page.getByRole('textbox', { name: 'Kommentar', exact: true });
    await expect(input).toBeFocused();
    await input.pressSequentially('Bitte übernehmen @Ma');
    const list = page.getByRole('listbox', { name: 'Personen erwähnen' });
    await expect(list).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('Bitte übernehmen @Mara Lindner ');
    await expect(list).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Kommentar' }).locator('.collab-mention')).toHaveText('@Mara Lindner');
    const threads = Object.values((await ydump(page, 'collab.comments')) as Record<string, any>);
    expect(threads).toHaveLength(1);
    expect(threads[0].messages[0]).toMatchObject({ text: 'Bitte übernehmen @Mara Lindner', mentions: ['m:12'] });
  });

  test('B3: Esc in der Vorschlagsliste schließt nur die Liste, der Entwurf bleibt', async ({ page }) => {
    await page.keyboard.press('c');
    const c = await centerOf(page, 's2');
    await page.mouse.click(c.x, c.y);
    const input = page.getByRole('textbox', { name: 'Kommentar', exact: true });
    await input.pressSequentially('Ein langer Gedanke zur Bühne, fragen wir @Ma');
    await expect(page.getByRole('listbox', { name: 'Personen erwähnen' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Personen erwähnen' })).toHaveCount(0);
    await expect(input).toHaveValue('Ein langer Gedanke zur Bühne, fragen wir @Ma');
    await expect(input).toBeFocused();
    // zweites Esc verwirft wie bisher
    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
  });

  test('B5: Abstimmung ohne Zeitlimit – ist die startende Person weg, kann jede:r beenden und schließen', async ({ page }) => {
    await page.evaluate(() => {
      const { store } = (window as any).__stachel;
      store.doc.getMap('collab.vote').set('session', { id: 'v1', title: 'Bühne?', perPerson: 3, multi: false, endsAt: null, startedBy: 'm:31', startedByName: 'Jonas Keller', startedAt: Date.now(), ended: false });
    });
    const bar = page.getByRole('region', { name: 'Abstimmung' });
    await expect(bar).toContainText('Bühne?');
    // Jonas ist da → nur er beendet
    await setPeers(page, [{ user: MARA }, { user: JONAS }]);
    await expect(bar.getByRole('button', { name: 'Beenden' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Abstimmung läuft' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Jonas Keller beendet sie' })).toBeVisible();
    // Jonas geht → Übernehmen
    await setPeers(page, [{ user: MARA }]);
    const end = bar.getByRole('button', { name: 'Beenden' });
    await expect(end).toHaveAttribute('title', /Jonas Keller ist nicht mehr auf dem Board/);
    await end.click();
    await expect(page.getByRole('dialog', { name: 'Ergebnis' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Ergebnis' }).getByRole('button', { name: 'Abstimmung schließen' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Ergebnis' }).getByRole('button', { name: 'Abstimmung schließen' }).click();
    await expect(bar).toHaveCount(0);
  });

  test('anonyme Abstimmung: keine Namen im Dokument und im Ergebnis; sonst Namen je Objekt', async ({ page }) => {
    await page.getByRole('button', { name: 'Abstimmung starten' }).click();
    const dlg = page.getByRole('dialog', { name: 'Abstimmung starten' });
    await dlg.getByLabel('Worum geht es?').fill('Geheim');
    await dlg.getByLabel('Anonym (im Ergebnis stehen keine Namen)').check();
    await dlg.getByRole('button', { name: 'Abstimmung starten' }).click();
    const bar = page.getByRole('region', { name: 'Abstimmung' });
    await expect(bar).toContainText('anonym');
    await page.locator('[data-vote="s1"]').click();
    await expect(page.locator('[data-vote="s1"] .collab-vote-badge')).toHaveText('1');
    const votes = JSON.stringify(await ydump(page, 'collab.votes'));
    expect(votes).not.toContain('a:offline');
    expect(votes).not.toContain('offline)');
    await bar.getByRole('button', { name: 'Beenden' }).click();
    const res = page.getByRole('dialog', { name: 'Ergebnis' });
    await expect(res.locator('.collab-rank li')).toHaveCount(1);
    await expect(res.locator('.collab-rank__who')).toHaveCount(0);
    await res.getByRole('button', { name: 'Abstimmung schließen' }).click();

    // nicht anonym: Namen am Ergebnis
    await page.getByRole('button', { name: 'Abstimmung starten' }).click();
    await page.getByRole('dialog', { name: 'Abstimmung starten' }).getByRole('button', { name: 'Abstimmung starten' }).click();
    await page.locator('[data-vote="s2"]').click();
    await bar.getByRole('button', { name: 'Beenden' }).click();
    await expect(page.getByRole('dialog', { name: 'Ergebnis' }).locator('.collab-rank__who')).toHaveText('Du (offline)');
  });

  test('Autor beim Überfahren einer Haftnotiz', async ({ page }) => {
    await page.evaluate(() => (window as any).__stachel.store.doc.getMap('objects').get('s1').set('createdBy', 'm:12'));
    const c = await centerOf(page, 's1');
    await page.mouse.move(c.x - 40, c.y - 300);
    await page.mouse.move(c.x, c.y, { steps: 5 });
    const tag = page.getByTestId('note-author');
    await expect(tag).toHaveText('von Mara Lindner');
    const box = (await tag.boundingBox())!;
    const note = (await page.locator('[data-id="s1"]').boundingBox())!;
    // unten rechts in der Notiz
    expect(box.x + box.width).toBeLessThanOrEqual(note.x + note.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(note.y + note.height + 1);
    expect(box.y).toBeGreaterThan(note.y + note.height / 2);
    await page.screenshot({ path: test.info().outputPath('autor.png') });
    // eigene Notiz, dann weg von der Notiz → verschwindet
    const c2 = await centerOf(page, 's2');
    await page.mouse.move(c2.x, c2.y, { steps: 5 });
    await expect(tag).toHaveText('von dir');
    await page.mouse.move(c2.x, c2.y + 400, { steps: 5 });
    await expect(tag).toHaveCount(0);
    // beim Drücken (Ziehen) nicht
    await page.mouse.move(c.x, c.y, { steps: 3 });
    await page.mouse.down();
    await expect(tag).toHaveCount(0);
    await page.waitForTimeout(800);
    await expect(tag).toHaveCount(0);
    await page.mouse.up();
  });

  test('B12: Upload-Platzhalter der anderen sichtbar, kein „Leeres Board“ darüber', async ({ page }) => {
    await page.evaluate(() => (window as any).__stachel.store.remove(new Set(['s1', 's2'])));
    await expect(page.locator('.empty-hint')).toBeVisible();
    await setPeers(page, [{ user: MARA, extra: { 'collab.uploads': [{ x: -150, y: -100, w: 300, h: 200, color: '#cfd8dc' }] } }]);
    const ph = page.locator('.collab-upload-ph');
    await expect(ph).toHaveText('Mara lädt hoch …');
    await expect(page.locator('.empty-hint')).toBeHidden();
    const b = (await ph.boundingBox())!;
    expect(Math.round(b.width)).toBe(300);
    await setPeers(page, [{ user: MARA }]);
    await expect(ph).toHaveCount(0);
  });

  test('B16: fremde Auswahl mit Namen, Laser ohne zweites Namensschild', async ({ page }) => {
    await setPeers(page, [{ user: MARA, cursor: { x: -280, y: -40 }, selection: ['s1'] }]);
    await expect(page.locator('.ov-peer-sel span')).toHaveText('Mara Lindner');
    await setPeers(page, [{ user: MARA, cursor: { x: -280, y: -40 }, selection: [], extra: { 'collab.laser': { s: 2, p: [-300, -60, -280, -40] } } }]);
    await expect(page.locator('.collab-laser [data-laser]')).toHaveCount(1);
    await expect(page.locator('.collab-laser text')).toHaveCount(0);
    await expect(page.locator('.ov-cursor', { hasText: 'Mara Lindner' })).toHaveCount(1);
  });
});

// ---- live über einen Hocuspocus-Testserver -----------------------------------------------------------------------

let server: Server;
let syncPort = 0;

test.describe('live', () => {
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

  const U_MARA: FakeUser = { key: 'm:12', name: 'Mara Lindner', isOrga: true };
  const U_JONAS: FakeUser = { key: 'm:31', name: 'Jonas Keller', isOrga: false };
  const U_LENA: FakeUser = { key: 'm:7', name: 'Lena Berg', isOrga: false };

  async function openAs(browser: Browser, user: FakeUser, board: string): Promise<Page> {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addCookies([{ name: 'stachel_session', value: `s-${user.key}-${Math.random()}`, domain: 'localhost', path: '/' }]);
    const page = await ctx.newPage();
    await installFakeApi(page, { loggedIn: true, user, boards: sampleBoards(), syncPort });
    await page.goto(`/?b=${board}`);
    await expect(page.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
    return page;
  }
  const meColor = (p: Page) => p.locator('.presence__me').evaluate((el) => getComputedStyle(el).backgroundColor);

  test('B4: WLAN weg → sofort „Offline“, wieder da → „Live“, offline Angelegtes kommt an', async ({ browser }) => {
    const a = await openAs(browser, U_MARA, 'b-plan');
    const b = await openAs(browser, U_JONAS, 'b-plan');
    const t0 = Date.now();
    await b.context().setOffline(true);
    await expect(b.getByTestId('status')).toHaveText('Offline', { timeout: 3000 });
    expect(Date.now() - t0).toBeLessThan(3000);
    // offline weiterarbeiten
    await b.evaluate(() => (window as any).document.querySelector('[data-testid="board"]')?.focus());
    const box = (await b.getByTestId('board').boundingBox())!;
    await b.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await b.keyboard.type('offline notiert');
    await b.keyboard.press('Escape');
    await b.context().setOffline(false);
    await expect(b.getByTestId('status')).toHaveText('Live', { timeout: 8000 });
    await expect(a.locator('[data-type="sticky"]', { hasText: 'offline notiert' })).toHaveCount(1);
    await a.context().close();
    await b.context().close();
  });

  test('B6: Folgen übersteht einen kurzen Aussetzer der geführten Person', async ({ browser }) => {
    const a = await openAs(browser, U_MARA, 'b-ideen');
    const b = await openAs(browser, U_JONAS, 'b-ideen');
    await a.locator('.collab-presence__av', { hasText: 'JK' }).click();
    await expect(a.getByText('Du folgst')).toBeVisible();
    await b.context().setOffline(true);
    await expect(a.getByText('kurz weg – Folgen geht gleich weiter')).toBeVisible({ timeout: 15_000 });
    await b.context().setOffline(false);
    await expect(a.getByText('Du folgst')).toBeVisible({ timeout: 10_000 });
    await expect(a.getByText('Folgen beendet')).toHaveCount(0);
    await expect(a.getByText('hat das Board verlassen')).toHaveCount(0);
    await expect(a.locator('.collab-follow-frame')).toBeVisible();
    await a.context().close();
    await b.context().close();
  });

  test('B9: drei Personen, drei verschiedene Farben – bei allen gleich', async ({ browser }) => {
    const pages = [await openAs(browser, U_MARA, 'b-helfer'), await openAs(browser, U_JONAS, 'b-helfer'), await openAs(browser, U_LENA, 'b-helfer')];
    await expect(pages[0].locator('.collab-presence__av:not(.presence__me)')).toHaveCount(2);
    await expect
      .poll(async () => new Set(await Promise.all(pages.map(meColor))).size, { timeout: 8000 })
      .toBe(3);
    // Mara sieht Jonas in Jonas' eigener Farbe
    const jonasOwn = await meColor(pages[1]);
    await expect.poll(() => pages[0].locator('.collab-presence__av', { hasText: 'JK' }).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(jonasOwn);
    for (const p of pages) await p.context().close();
  });

  test('B16: eigener zweiter Tab erscheint nicht als fremder Cursor', async ({ browser }) => {
    const a = await openAs(browser, U_MARA, 'b-retro');
    const ctx = a.context();
    const a2 = await ctx.newPage();
    await installFakeApi(a2, { loggedIn: true, user: U_MARA, boards: sampleBoards(), syncPort });
    await a2.goto('/?b=b-retro');
    await expect(a2.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
    const b = await openAs(browser, U_JONAS, 'b-retro');
    const box = (await a2.getByTestId('board').boundingBox())!;
    await a2.mouse.move(box.x + 500, box.y + 300);
    await a2.mouse.move(box.x + 520, box.y + 320, { steps: 4 });
    // Jonas sieht Maras Cursor, Maras erster Tab nicht
    await expect(b.locator('.ov-cursor', { hasText: 'Mara Lindner' })).toBeVisible();
    await a.waitForTimeout(500);
    await expect(a.locator('.ov-cursor')).toHaveCount(0);
    await ctx.close();
    await b.context().close();
  });

  test('Kommentar-Entwurf überlebt das Löschen des Threads durch andere', async ({ browser }) => {
    const a = await openAs(browser, U_MARA, 'b-lage');
    const b = await openAs(browser, U_JONAS, 'b-lage');
    const box = (await a.getByTestId('board').boundingBox())!;
    await a.keyboard.press('c');
    await a.mouse.click(box.x + 500, box.y + 300);
    await a.getByRole('textbox', { name: 'Kommentar', exact: true }).pressSequentially('Wer macht das?');
    await a.keyboard.press('Enter');
    const pin = b.locator('.collab-pin[data-thread]');
    await expect(pin).toHaveCount(1);
    await pin.click();
    const reply = b.getByRole('dialog', { name: 'Kommentar' }).getByRole('textbox', { name: 'Antwort' });
    await reply.pressSequentially('Ich übernehme das, aber erst');
    // Mara löscht den Thread
    await a.getByRole('dialog', { name: 'Kommentar' }).getByRole('button', { name: 'Weitere Aktionen' }).click();
    await a.getByRole('menuitem', { name: 'Thread löschen' }).click();
    await expect(b.getByRole('status').filter({ hasText: 'Der Kommentar wurde gelöscht' })).toBeVisible();
    const composer = b.getByRole('textbox', { name: 'Kommentar', exact: true });
    await expect(composer).toHaveValue('Ich übernehme das, aber erst');
    await b.screenshot({ path: test.info().outputPath('entwurf.png') });
    await a.context().close();
    await b.context().close();
  });
});

// ---- Anmeldung am Handy: „In der App öffnen“ (App-Link, Modus org) ------------------------------------------------

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

test.describe('Anmeldung am Android-Handy', () => {
  test.use({ ...PHONE, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' });
  test('Knopf öffnet die App der Organisation per intent:// (ohne App: Erklärseite), Passwort steht oben', async ({ page }) => {
    await installFakeApi(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Benutzername & Passwort' })).toBeInViewport();
    await page.getByRole('button', { name: /Mit der Musterverein-App/ }).click();
    const open = page.getByTestId('open-app');
    const href = await open.getAttribute('href');
    expect(href).toMatch(/^intent:\/\/board\.example\.org\/qr\/code-1-[\w-]+#Intent;scheme=https;package=org\.example\.verein;S\.browser_fallback_url=/);
    expect(decodeURIComponent(href!.split('S.browser_fallback_url=')[1].replace(/;end$/, ''))).toMatch(/^https:\/\/board\.example\.org\/qr\/code-1-[\w-]+\?handy=1$/);
    await open.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('android.png') });
  });
});

test.describe('Anmeldung am iPhone', () => {
  test.use({ ...PHONE, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  test('kein App-Knopf (Safari übernimmt ihn nicht), Passwort oben, QR nur für ein anderes Handy', async ({ page }) => {
    const state = await installFakeApi(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Benutzername & Passwort' })).toBeInViewport();
    await expect(page.getByRole('button', { name: /Mit der Musterverein-App/ })).toHaveCount(0);
    await expect(page.getByTestId('open-app')).toHaveCount(0);
    await expect(page.getByTestId('ios-login-hint')).toContainText('mit Benutzername & Passwort anmelden');
    await page.waitForTimeout(400);
    expect(state.qrStarts).toBe(0);
    await page.getByTestId('ios-login-hint').scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('iphone.png') });
    await page.getByRole('button', { name: 'QR-Code für ein anderes Handy zeigen' }).click();
    await expect(page.getByRole('img', { name: 'QR-Code zum Anmelden' })).toBeVisible();
  });
});
