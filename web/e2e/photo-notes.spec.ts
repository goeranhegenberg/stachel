// Zettel abfotografieren (P10, Welle B): Board-Menü → Foto → Auswahl/Korrektur → Haftnotizen wie auf dem Foto.
// Die Auswertung (Server, Tesseract) ist hier eine feste Antwort; der Server-Teil hat eigene Tests (photo-notes.test.ts).
import { expect, test } from '@playwright/test';
import type { Server } from '@hocuspocus/server';
import path from 'node:path';
import { startSyncServer } from './syncServer';
import { installFakeApi, sampleBoards } from './fakeApi';

/** Belegbilder nur auf Wunsch (PHOTO_SHOTS=<Ordner>) */
const SHOTS = process.env.PHOTO_SHOTS;

// kleines JPEG als „Foto“ (der Browser schickt es nur an die gefälschte Route)
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#e8e6e0"/>' +
  '<rect x="40" y="40" width="200" height="200" fill="#ffd23f"/><rect x="280" y="40" width="200" height="200" fill="#ff8c42"/>' +
  '<rect x="40" y="280" width="200" height="200" fill="#7bc950"/></svg>';
const PREVIEW = `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`;
const RESULT = {
  ok: true,
  width: 800,
  height: 500,
  ocr: true,
  preview: PREVIEW,
  notes: [
    { x: 40, y: 40, w: 200, h: 200, color: '#ffd23f', rgb: '#f0c840', text: 'Bühne aufbauen', conf: 88 },
    { x: 280, y: 40, w: 200, h: 200, color: '#ff8c42', rgb: '#f08a40', text: 'Bierwagn', conf: 61 },
    { x: 40, y: 280, w: 200, h: 200, color: '#7bc950', rgb: '#70c050', text: 'Müll', conf: 75 },
  ],
};


test.describe('Zettel abfotografieren', () => {
  let server: Server;
  let syncPort = 0;
  test.beforeAll(async () => {
    ({ server, port: syncPort } = await startSyncServer());
  });
  test.afterAll(async () => {
    await server?.destroy();
  });

  for (const vp of [
    { name: 'desktop', width: 1280, height: 800, touch: false },
    { name: 'handy', width: 390, height: 844, touch: true },
  ]) {
    test(`${vp.name}: Foto → Vorschau → abwählen, korrigieren → Notizen in Fotoanordnung`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch });
      await context.addCookies([{ name: 'stachel_session', value: 'sess', domain: 'localhost', path: '/' }]);
      const page = await context.newPage();
      await installFakeApi(page, { loggedIn: true, boards: sampleBoards(), syncPort, instance: { photoNotes: true } as never });
      const posts: { type: string; size: number; csrf: boolean }[] = [];
      await page.route('**/api/boards/*/photo-notes', async (route) => {
        const req = route.request();
        posts.push({ type: req.headers()['content-type'] ?? '', size: req.postDataBuffer()?.length ?? 0, csrf: Object.keys(req.headers()).some((h) => h.startsWith('x-stachel')) });
        await new Promise((r) => setTimeout(r, 300));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RESULT) });
      });
      await page.goto('/?b=b-plan');
      await expect(page.getByTestId('status')).toHaveText('Live');
      await page.getByRole('button', { name: 'Board-Menü' }).click();
      await page.getByRole('menuitem', { name: 'Zettel abfotografieren …' }).click();
      await expect(page.getByTestId('photo-notes-pick')).toBeVisible();
      await expect(page.getByRole('button', { name: vp.touch ? 'Foto aufnehmen' : 'Foto auswählen' })).toBeVisible();
      if (vp.touch) await expect(page.getByTestId('photo-camera')).toHaveAttribute('capture', 'environment');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `photo-${vp.name}-1-waehlen.png`) });
      await page.getByTestId(vp.touch ? 'photo-camera' : 'photo-file').setInputFiles({ name: 'wand.jpg', mimeType: 'image/jpeg', buffer: JPEG });
      await expect(page.getByTestId('photo-notes-review')).toBeVisible();
      expect(posts).toEqual([{ type: 'image/jpeg', size: JPEG.length, csrf: true }]);
      await expect(page.getByRole('textbox', { name: 'Text von Zettel 2' })).toHaveValue('Bierwagn');
      await page.getByRole('textbox', { name: 'Text von Zettel 2' }).fill('Bierwagen');
      await page.getByRole('checkbox', { name: 'Zettel 3 übernehmen' }).uncheck();
      await page.getByRole('combobox', { name: 'Farbe von Zettel 1' }).selectOption({ label: 'Anthrazit' });
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `photo-${vp.name}-2-vorschau.png`) });
      await page.getByTestId('photo-create').click();
      await expect(page.getByText('2 Notizen angelegt.')).toBeVisible();
      // die neuen Notizen im Editor (echter Sync): Farbe, Schrift, Lage wie auf dem Foto
      const noteA = page.locator('[data-type="sticky"]', { hasText: 'Bühne aufbauen' });
      const noteB = page.locator('[data-type="sticky"]', { hasText: 'Bierwagen' });
      await expect(noteA).toHaveCount(1);
      await expect(noteB).toHaveCount(1);
      await expect(page.locator('[data-type="sticky"]', { hasText: 'Müll' })).toHaveCount(0);
      const look = (l: typeof noteA) => l.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, ink: getComputedStyle(e).color }));
      expect(await look(noteA)).toEqual({ bg: 'rgb(43, 43, 43)', ink: 'rgb(255, 255, 255)' });
      expect(await look(noteB)).toEqual({ bg: 'rgb(255, 140, 66)', ink: 'rgb(10, 10, 10)' });
      const ba = (await noteA.boundingBox())!;
      const bb = (await noteB.boundingBox())!;
      expect(bb.x).toBeGreaterThan(ba.x + ba.width * 0.9);
      expect(Math.abs(bb.y - ba.y)).toBeLessThan(5);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `photo-${vp.name}-3-board.png`) });
      // ein Rückgängig-Schritt nimmt beide zurück
      await page.getByRole('button', { name: 'Rückgängig' }).first().click();
      await expect(noteA).toHaveCount(0);
      await expect(noteB).toHaveCount(0);
      await context.close();
    });
  }

  test('Fehler des Servers erscheinen im Dialog; ohne Freischaltung kein Menüeintrag', async ({ page, context }) => {
    await context.addCookies([{ name: 'stachel_session', value: 'sess', domain: 'localhost', path: '/' }]);
    await installFakeApi(page, { loggedIn: true, boards: sampleBoards(), syncPort, instance: { photoNotes: true } as never });
    await page.route('**/api/boards/*/photo-notes', (route) =>
      route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'rate_limited', message: 'Gerade wurden viele Fotos ausgewertet. Bitte versuch es später noch einmal.' }) }),
    );
    await page.goto('/?b=b-plan');
    await expect(page.getByTestId('status')).toHaveText('Live');
    await page.getByRole('button', { name: 'Board-Menü' }).click();
    await page.getByRole('menuitem', { name: 'Zettel abfotografieren …' }).click();
    await page.getByTestId('photo-file').setInputFiles({ name: 'wand.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await expect(page.getByRole('alert')).toHaveText(/viele Fotos/);

    const p2 = await context.newPage();
    await installFakeApi(p2, { loggedIn: true, boards: sampleBoards(), syncPort, instance: { photoNotes: false } as never });
    await p2.goto('/?b=b-plan');
    await expect(p2.getByTestId('status')).toHaveText('Live');
    await p2.getByRole('button', { name: 'Board-Menü' }).click();
    await expect(p2.getByRole('menuitem', { name: 'Exportieren …' })).toBeVisible();
    await expect(p2.getByRole('menuitem', { name: 'Zettel abfotografieren …' })).toHaveCount(0);
  });
});
