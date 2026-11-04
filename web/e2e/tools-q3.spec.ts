// Q3 „Bedienung“ im Browser: Clustern über das Kontextmenü, Suchen & Ersetzen (Strg H) mit Vorschau und einem
// Rückgängig-Schritt, Befehlspalette (Strg K) führt „Typ wechseln › Form“ aus. Bildschirmfotos docs/screenshots/tools-q3-*.png.
//   PW_PORT=5296 npx playwright test tools-q3 --workers=1
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { centerOf, objects, openOffline } from './helpers';

const OUT = path.resolve(import.meta.dirname, '../../docs/screenshots');

test.beforeEach(async ({ page }) => {
  await openOffline(page);
  await page.evaluate(() => {
    const { store, api } = (window as any).__stachel;
    const n = (id: string, x: number, y: number, color: string, text: string) => ({ id, type: 'sticky', x, y, w: 160, h: 160, color, text });
    store.createMany([
      n('a', 0, 0, '#fff27a', 'Bühne aufbauen'),
      n('b', 200, 40, '#ffb3d1', 'Bar planen'),
      n('c', 400, 0, '#fff27a', 'Bühne abbauen'),
      n('d', 600, 60, '#9fd3ff', 'Strom für die Bühne'),
      n('e', 800, 0, '#ffb3d1', 'Kasse'),
    ]);
    api().fitAll();
  });
});

test('Clustern nach Farbe über das Kontextmenü: Gruppen mit Überschrift, ein Rückgängig-Schritt', async ({ page }) => {
  await page.evaluate(() => (window as any).__stachel.api().setSelection(['a', 'b', 'c', 'd', 'e']));
  await page.mouse.click(...Object.values(await centerOf(page, 'a')) as [number, number], { button: 'right' });
  await page.getByRole('menuitem', { name: 'Clustern' }).hover();
  await page.getByRole('menuitem', { name: 'Nach Farbe' }).click();
  await expect.poll(async () => (await objects(page)).filter((o) => o.type === 'text').map((o) => o.text)).toEqual(['Gelb', 'Rosa', 'Hellblau']);
  const byId = Object.fromEntries((await objects(page)).map((o) => [o.id, o]));
  // Gelb (a, c) eine Spalte untereinander, Rosa (b, e) daneben, Hellblau (d) rechts
  expect(byId.c.x).toBe(byId.a.x);
  expect(byId.c.y).toBe(byId.a.y + 160 + 24);
  expect(byId.b.x).toBe(byId.a.x + 160 + 120);
  expect(byId.d.x).toBeGreaterThan(byId.e.x);
  await page.evaluate(() => (window as any).__stachel.api().fitAll());
  await page.screenshot({ path: `${OUT}/tools-q3-cluster.png` });
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await objects(page)).filter((o) => o.type === 'text').length).toBe(0);
  expect((await objects(page)).find((o) => o.id === 'b')!.x).toBe(200);
});

test('Suchen & Ersetzen: Strg H, Vorschau, „Alle“, Strg Z nimmt alles in einem Schritt zurück', async ({ page }) => {
  await page.locator('[data-testid="board"]').click({ position: { x: 700, y: 820 } });
  await page.keyboard.press('Control+h');
  await page.getByLabel('Suchbegriff').fill('buehne');
  await page.getByTestId('replace-input').fill('Theke');
  await expect(page.getByTestId('replace-count')).toHaveText('3 Stellen in 3 Objekten');
  await page.screenshot({ path: `${OUT}/tools-q3-replace.png` });
  await page.getByTestId('replace-all').click();
  await expect.poll(async () => (await objects(page)).map((o) => o.text)).toEqual(['Theke aufbauen', 'Bar planen', 'Theke abbauen', 'Strom für die Theke', 'Kasse']);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await objects(page)).filter((o) => o.text?.includes('Bühne')).length).toBe(3);
});

test('Befehlspalette: Strg K (auf einer gewählten Notiz Strg Umschalt K – Strg K ist dort „Link einfügen“), Enter führt aus', async ({ page }) => {
  await page.locator('[data-testid="board"]').focus();
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await expect(page.getByTestId('palette-list')).not.toContainText('Typ wechseln');
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as any).__stachel.api().setSelection(['b']));
  await page.locator('[data-testid="board"]').focus();
  await page.keyboard.press('Control+Shift+k');
  const input = page.getByTestId('palette-input');
  await expect(input).toBeFocused();
  await expect(page.getByTestId('palette-list')).toContainText('Typ wechseln › Form');
  await expect(page.getByTestId('palette-list')).toContainText('Haftnotiz');
  await page.waitForTimeout(400); // Einblenden des Dialogs abwarten
  await page.screenshot({ path: `${OUT}/tools-q3-palette.png` });
  await input.fill('typ wechseln');
  await expect(page.getByRole('option').first()).toHaveText(/Typ wechseln › Form/);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await objects(page)).find((o) => o.id === 'b')!.type).toBe('shape');
  const b = (await objects(page)).find((o) => o.id === 'b') as unknown as Record<string, unknown>;
  expect([b.color, b.text, b.shape]).toEqual(['#ffb3d1', 'Bar planen', 'rect']);
});
