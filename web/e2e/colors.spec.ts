// Notizfarben (Welle B): 36 Farben (zwölf Farbtöne × hell/kräftig/dunkel), Schrift nach WCAG (dunkle Notizen weiß), eigener Farbwähler mit Hex/Spektrum und
// „zuletzt benutzt“ – in der Kontextleiste und im Notiz-Werkzeug.
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { objects, openOffline, type Obj } from './helpers';

const colorOf = (o: Obj | undefined) => (o as (Obj & { color?: string }) | undefined)?.color;

/** Belegbilder nur auf Wunsch (COLOR_SHOTS=<Ordner>) */
const SHOTS = process.env.COLOR_SHOTS;

async function seed(page: import('@playwright/test').Page, color: string, text: string, x = 500, y = 300) {
  await page.evaluate(
    ({ color, text, x, y }) => (window as any).__stachel.store.createMany([{ type: 'sticky', x, y, w: 200, h: 200, color, text }]),
    { color, text, x, y },
  );
}

test.beforeEach(async ({ page }) => {
  await openOffline(page);
});

test('36 Notizfarben als Raster 12 × 3, dunkle mit weißer Schrift; alte Farben unverändert', async ({ page }) => {
  await seed(page, '#fff27a', 'Gelb wie immer', 300, 300);
  await seed(page, '#c62828', 'Rot dunkel', 540, 300);
  await seed(page, '#2b2b2b', 'Anthrazit', 780, 300);
  const ink = (text: string) => page.locator('[data-type="sticky"]', { hasText: text }).evaluate((e) => getComputedStyle(e).color);
  expect(await ink('Gelb wie immer')).toBe('rgb(10, 10, 10)');
  expect(await ink('Rot dunkel')).toBe('rgb(255, 255, 255)');
  expect(await ink('Anthrazit')).toBe('rgb(255, 255, 255)');
  await page.locator('[data-type="sticky"]', { hasText: 'Gelb wie immer' }).click();
  const bar = page.getByRole('toolbar', { name: 'Auswahl bearbeiten' });
  await bar.getByRole('button', { name: 'Farbe', exact: true }).click();
  const pop = page.locator('.ctx-pop--colors');
  await expect(pop.locator('.cp-grid--sticky .swatch')).toHaveCount(36);
  // drei Reihen: Gelb hell, kräftig, dunkel stehen untereinander
  const top = async (name: string) => (await pop.getByRole('button', { name: `Farbe ${name}`, exact: true }).boundingBox())!;
  const [g1, g2, g3] = [await top('Gelb'), await top('Sonnengelb'), await top('Ocker')];
  expect(Math.abs(g1.x - g2.x) + Math.abs(g2.x - g3.x)).toBeLessThan(2);
  expect(g3.y).toBeGreaterThan(g2.y);
  expect(g2.y).toBeGreaterThan(g1.y);
  await expect(pop.getByRole('button', { name: 'Farbe Waldgrün' })).toBeVisible();
  await expect(pop.getByRole('button', { name: 'Farbe Königsblau' })).toBeVisible();
  if (SHOTS) await page.waitForTimeout(400);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'farben-palette.png') });
  await pop.getByRole('button', { name: 'Farbe Königsblau' }).click();
  expect(colorOf((await objects(page)).find((o) => o.text === 'Gelb wie immer'))).toBe('#1565c0');
  expect(await ink('Gelb wie immer')).toBe('rgb(255, 255, 255)');
});

test('eigener Farbwähler: Hex, Übernehmen, „zuletzt benutzt“ – auch im Notiz-Werkzeug', async ({ page }) => {
  await seed(page, '#fff27a', 'Eigene Farbe', 300, 300);
  await page.locator('[data-type="sticky"]', { hasText: 'Eigene Farbe' }).click();
  const bar = page.getByRole('toolbar', { name: 'Auswahl bearbeiten' });
  await bar.getByRole('button', { name: 'Farbe', exact: true }).click();
  await page.getByTestId('cp-plus').click();
  await expect(page.getByTestId('cp-area')).toBeVisible();
  await page.getByTestId('cp-hex').fill('#3a5f0b');
  if (SHOTS) await page.waitForTimeout(400);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'farben-waehler.png') });
  await page.getByTestId('cp-ok').click();
  expect(colorOf((await objects(page)).find((o) => o.text === 'Eigene Farbe'))).toBe('#3a5f0b');
  // Spektrum: Klick oben rechts (innerhalb der runden Ecke) = fast volle Sättigung und Helligkeit
  await bar.getByRole('button', { name: 'Farbe', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Zuletzt benutzt' }).getByRole('button')).toHaveCount(1);
  await page.getByTestId('cp-plus').click();
  const area = (await page.getByTestId('cp-area').boundingBox())!;
  await page.mouse.click(area.x + area.width - 6, area.y + 6);
  await expect(page.getByTestId('cp-hex')).not.toHaveValue('#3a5f0b');
  await page.getByTestId('cp-ok').click();
  await bar.getByRole('button', { name: 'Farbe', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Zuletzt benutzt' }).getByRole('button')).toHaveCount(2);
  if (SHOTS) await page.waitForTimeout(400);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'farben-zuletzt.png') });
  // Notiz-Werkzeug: dieselbe Zeile; gewählte eigene Farbe gilt für neue Notizen
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  const recent = page.locator('.shapes-sticky-swatches').getByRole('group', { name: 'Zuletzt benutzt' }).getByRole('button');
  await expect(recent).toHaveCount(2);
  if (SHOTS) await page.waitForTimeout(400);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'farben-werkzeug.png') });
  await recent.last().click();
  await page.mouse.click(1000, 600);
  await page.keyboard.press('Escape');
  const created = (await objects(page)).filter((o) => o.type === 'sticky' && o.text !== 'Eigene Farbe');
  expect(colorOf(created.at(-1))).toBe('#3a5f0b');
});

test.describe('Handy', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('Raster bleibt drei Reihen hoch, sechs Spalten sichtbar, seitlich scrollbar', async ({ page }) => {
    await seed(page, '#fff27a', 'Handy', 60, 200);
    await page.locator('[data-type="sticky"]', { hasText: 'Handy' }).click();
    const bar = page.getByRole('toolbar', { name: 'Auswahl bearbeiten' });
    await bar.getByRole('button', { name: 'Farbe', exact: true }).click();
    const grid = page.locator('.ctx-pop--colors .cp-grid--sticky');
    await expect(grid.locator('.swatch')).toHaveCount(36);
    const m = await grid.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, h: e.getBoundingClientRect().height }));
    expect(m.sw).toBeGreaterThan(m.cw + 100);
    expect(m.h).toBeLessThan(3 * 24 + 2 * 5 + 12);
    await expect(page.locator('.ctx-pop--colors')).toBeInViewport({ ratio: 1 });
    if (SHOTS) await page.waitForTimeout(400);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'farben-handy.png') });
    await grid.evaluate((e) => (e.scrollLeft = e.scrollWidth));
    await grid.getByRole('button', { name: 'Farbe Anthrazit' }).click();
    expect(colorOf((await objects(page)).find((o) => o.text === 'Handy'))).toBe('#2b2b2b');
  });
});
