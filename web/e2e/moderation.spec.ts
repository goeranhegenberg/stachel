// Feature-Modul moderation (Smoke): Objekt per Rechtsklick melden, Board über „···“ melden, Hinweis bei gesperrtem
// Board, blockierte Personen im Board-Menü. Server-Endpunkte (POST /api/reports, /api/blocks, …/moderation) gefälscht.
import { expect, test, type Page } from '@playwright/test';
import type { Server } from '@hocuspocus/server';
import { startSyncServer } from './syncServer';
import { installFakeApi, sampleBoards } from './fakeApi';
import path from 'node:path';
import { centerOf } from './helpers';

const OUT = path.resolve(import.meta.dirname, '../../docs/screenshots');
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `moderation-${name}.png`) });

let server: Server;
let syncPort = 0;
test.beforeAll(async () => {
  ({ server, port: syncPort } = await startSyncServer());
});
test.afterAll(async () => {
  await server?.destroy();
});

async function fakeModeration(page: Page, opts: { lock?: { mode: 'readonly'; reason: string } } = {}) {
  const reports: any[] = [];
  let blocked = [{ key: 'u:7', name: 'Tom Troll', at: '2026-11-02T10:00:00Z' }];
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/reports', (route) => {
    reports.push(route.request().postDataJSON());
    return route.fulfill(json({ ok: true, report: { id: 'R-ABCD2345', createdAt: new Date().toISOString() }, mailed: false }, 201));
  });
  await page.route('**/api/blocks**', (route) => {
    const req = route.request();
    if (req.method() === 'DELETE') blocked = blocked.filter((b) => !req.url().endsWith(encodeURIComponent(b.key)));
    return route.fulfill(json({ ok: true, blocked }));
  });
  await page.route('**/api/boards/*/moderation', (route) => route.fulfill(json({ ok: true, lock: opts.lock ?? null })));
  return { reports };
}

async function openBoard(page: Page) {
  await page.context().addCookies([{ name: 'stachel_session', value: 'sess', domain: 'localhost', path: '/' }]);
  await installFakeApi(page, { loggedIn: true, boards: sampleBoards(), syncPort });
}

test('Objekt melden: Grund wählen, Beschreibung nötig bei „anderes“, Eingangsbestätigung', async ({ page }) => {
  await openBoard(page);
  const { reports } = await fakeModeration(page);
  await page.goto('/?b=b-plan');
  await expect(page.getByTestId('status')).toHaveText('Live');
  // Notiz anlegen (Werkzeug), dann Rechtsklick darauf
  await page.keyboard.press('n');
  await page.mouse.click(700, 400);
  await page.keyboard.type('Spam-Notiz');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const note = page.locator('[data-id]', { hasText: 'Spam-Notiz' }).first();
  const id = await note.getAttribute('data-id');
  const at = await centerOf(page, id!);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Melden …' }).click();
  const dialog = page.getByTestId('report-dialog');
  await expect(dialog).toBeVisible();
  const send = page.getByTestId('report-send');
  await expect(send).toBeDisabled();
  await dialog.getByLabel('Etwas anderes').check();
  await expect(send).toBeDisabled(); // Beschreibung nötig
  await dialog.getByLabel('Beschreibung (nötig)').fill('Werbung für einen fremden Shop');
  await shot(page, 'melden');
  await send.click();
  await expect(page.getByTestId('report-done')).toContainText('R-ABCD2345');
  expect(reports).toEqual([{ boardId: 'b-plan', objectId: id, reason: 'other', text: 'Werbung für einen fremden Shop' }]);
  await page.getByRole('button', { name: 'Schließen' }).click();

  // Board melden über „···“
  await page.getByRole('button', { name: 'Board-Menü' }).click();
  await page.getByRole('menuitem', { name: 'Board melden …' }).click();
  await page.getByTestId('report-dialog').getByLabel('Spam oder Betrug').check();
  await page.getByTestId('report-send').click();
  await expect(page.getByTestId('report-done')).toBeVisible();
  expect(reports[1]).toEqual({ boardId: 'b-plan', reason: 'spam' });
});

test('gesperrtes Board zeigt den Hinweis; blockierte Personen aufheben', async ({ page }) => {
  await openBoard(page);
  await fakeModeration(page, { lock: { mode: 'readonly', reason: 'Prüfung einer Meldung' } });
  await page.goto('/?b=b-plan');
  await expect(page.getByTestId('moderation-lock')).toContainText('Prüfung einer Meldung');
  await shot(page, 'gesperrt');
  await page.getByRole('button', { name: 'Board-Menü' }).click();
  await page.getByRole('menuitem', { name: 'Blockierte Personen …' }).click();
  const list = page.getByTestId('blocked-list');
  await expect(list).toContainText('Tom Troll');
  await list.getByRole('button', { name: 'Blockierung von Tom Troll aufheben' }).click();
  await expect(list).toContainText('Du hast niemanden blockiert.');
});
