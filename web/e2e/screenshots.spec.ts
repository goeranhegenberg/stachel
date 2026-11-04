// Erzeugt die Abnahme-Screenshots unter docs/screenshots (Desktop 1440×900, Handy 390×844).
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { installFakeApi, sampleBoards } from './fakeApi';

const OUT = path.resolve(import.meta.dirname, '../../docs/screenshots');
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

const VIEWS = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, mobile: false },
  { name: 'handy', viewport: { width: 390, height: 844 }, mobile: true },
] as const;

for (const v of VIEWS) {
  test.describe(v.name, () => {
    test.use({ viewport: v.viewport, isMobile: v.mobile, hasTouch: v.mobile, deviceScaleFactor: v.mobile ? 2 : 1 });

    test('Anmeldung', async ({ page }) => {
      await installFakeApi(page);
      await page.goto('/');
      if (v.mobile) {
        // Handy: zuerst das Passwortformular, der QR-Code erst auf Wunsch (Bereich C)
        await expect(page.getByRole('heading', { name: 'Benutzername & Passwort' })).toBeVisible();
        await page.waitForTimeout(700);
        await shot(page, `${v.name}-anmeldung-passwort`);
        await page.getByRole('button', { name: /Mit der Musterverein-App/ }).click();
        await page.getByRole('button', { name: 'QR-Code hier zeigen' }).click();
      }
      await expect(page.getByRole('img', { name: 'QR-Code zum Anmelden' })).toBeVisible();
      await page.waitForTimeout(700); // Einblend-Animation
      await shot(page, `${v.name}-anmeldung`);
    });

    test('Board-Übersicht', async ({ page }) => {
      await installFakeApi(page, { loggedIn: true, boards: sampleBoards() });
      await page.goto('/');
      await expect(page.locator('.board-card__title')).toHaveCount(5);
      await page.waitForTimeout(700);
      await shot(page, `${v.name}-boards`);
    });

    test('Board-Editor', async ({ page }) => {
      await page.goto('/?offline=1&demo=1');
      await expect(page.locator('[data-id="demo-s1"]')).toBeVisible();
      await page.waitForTimeout(400);
      await shot(page, `${v.name}-editor`);
      // Auswahl mit Kontextleiste
      const box = (await page.locator('[data-id="demo-s3"]').boundingBox())!;
      if (v.mobile) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page.getByRole('toolbar', { name: 'Auswahl bearbeiten' })).toBeVisible();
      if (!v.mobile) await page.getByRole('button', { name: 'Farbe', exact: true }).click();
      await page.waitForTimeout(200);
      await shot(page, `${v.name}-editor-auswahl`);
      if (!v.mobile) {
        // Werkzeug mit Optionen + Tooltip
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await page.keyboard.press('s');
        await page.locator('[data-tool="pen"]').hover();
        await page.waitForTimeout(500);
        await shot(page, `${v.name}-editor-werkzeuge`);
      }
    });
  });
}
