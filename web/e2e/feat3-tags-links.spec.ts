// Runde 3 (feat3): Notiz-Tags und Objekt-Links („Link zu Rahmen oder Objekt“).
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { camera, openOffline, selection } from './helpers';

const OUT = path.resolve(import.meta.dirname, '../test-results/feat3');
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

const add = (page: Page, obj: Record<string, unknown>): Promise<string> => page.evaluate((o) => (window as any).__stachel.store.create(o), obj);
const get = (page: Page, id: string) => page.evaluate((i) => (window as any).__stachel.store.get(i), id);
const select = (page: Page, ids: string[]) => page.evaluate((i) => (window as any).__stachel.api().setSelection(i), ids);
const ctx = (page: Page) => page.locator('.ctxbar');
const tool = (page: Page) => page.evaluate(() => (window as any).__stachel.api().tool());

test.beforeEach(async ({ page }) => {
  await openOffline(page);
});

test.describe('Notiz-Tags', () => {
  test('Tags anlegen, auf anderen Notizen wiederverwenden, für mehrere entfernen, Rückgängig', async ({ page }) => {
    const a = await add(page, { type: 'sticky', x: 0, y: 0, w: 220, h: 220, text: 'Bühne aufbauen', color: '#fff27a' });
    const b = await add(page, { type: 'sticky', x: 260, y: 0, w: 220, h: 220, text: 'Kabel prüfen', color: '#9fd3ff' });
    await page.evaluate(() => (window as any).__stachel.api().fitAll());
    await select(page, [a]);
    await ctx(page).getByRole('button', { name: 'Tags' }).click();
    const input = page.getByRole('textbox', { name: 'Neuer Tag' });
    await expect(input).toBeFocused();
    // Tippen gehört dem Feld: „n“, „e“, „t“ wechseln nicht das Werkzeug
    await input.pressSequentially('Bühne');
    await input.press('Enter');
    expect(await tool(page)).toBe('select');
    expect((await get(page, a)).tags).toEqual([{ label: 'Bühne', color: '#c9e14a' }]);
    await page.getByRole('button', { name: 'Tagfarbe Pink' }).click();
    await input.fill('Technik');
    await page.getByRole('button', { name: 'Hinzufügen' }).click();
    expect((await get(page, a)).tags).toEqual([
      { label: 'Bühne', color: '#c9e14a' },
      { label: 'Technik', color: '#ec4e92' },
    ]);
    await expect(page.locator(`[data-tags-for="${a}"] .tools-tag`)).toHaveText(['Bühne', 'Technik']);

    // zweite Notiz: vorhandene Tags zum Anklicken; gleicher Name (andere Schreibweise) übernimmt die Farbe
    await page.keyboard.press('Escape');
    await select(page, [b]);
    await ctx(page).getByRole('button', { name: 'Tags' }).click();
    const list = page.getByRole('group', { name: 'Tags des Boards' });
    await expect(list.getByRole('button')).toHaveText(['Bühne', 'Technik']);
    await list.getByRole('button', { name: 'Technik' }).click();
    await page.getByRole('textbox', { name: 'Neuer Tag' }).fill('bühne');
    await page.getByRole('textbox', { name: 'Neuer Tag' }).press('Enter');
    expect((await get(page, b)).tags).toEqual([
      { label: 'Technik', color: '#ec4e92' },
      { label: 'Bühne', color: '#c9e14a' },
    ]);
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 450);
    await shot(page, 'tags-notizen');

    // beide ausgewählt: „Technik“ ist an beiden → Klick entfernt von beiden (ein Undo-Schritt)
    await select(page, [a, b]);
    await ctx(page).getByRole('button', { name: 'Tags' }).click();
    const both = page.getByRole('group', { name: 'Tags des Boards' }).getByRole('button', { name: /Technik/ });
    await expect(both).toHaveAttribute('aria-pressed', 'true');
    await both.click();
    expect((await get(page, a)).tags).toEqual([{ label: 'Bühne', color: '#c9e14a' }]);
    expect((await get(page, b)).tags).toEqual([{ label: 'Bühne', color: '#c9e14a' }]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    expect((await get(page, a)).tags).toHaveLength(2);
    expect((await get(page, b)).tags).toHaveLength(2);
  });

  test('Tags-Knopf nur bei Notizen; Kopie behält Tags, Plus-Griff-Notiz ohne Tags', async ({ page }) => {
    const n = await add(page, { type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'Einlass', tags: [{ label: 'Orga', color: '#1763b5' }] });
    const s = await add(page, { type: 'shape', shape: 'rect', x: 300, y: 0, w: 200, h: 120, text: 'Form' });
    await page.evaluate(() => (window as any).__stachel.api().fitAll());
    await select(page, [s]);
    await expect(ctx(page)).toBeVisible();
    await expect(ctx(page).getByRole('button', { name: 'Tags' })).toHaveCount(0);
    await select(page, [n]);
    await expect(ctx(page).getByRole('button', { name: 'Tags' })).toBeVisible();
    await page.keyboard.press('Control+d');
    await expect
      .poll(async () => (await page.evaluate(() => (window as any).__stachel.store.getSnapshot().ordered.filter((o: any) => o.type === 'sticky').map((o: any) => o.tags?.length ?? 0))))
      .toEqual([1, 1]);
    // Kopie daneben (wie Plus-Griff) ohne Tags
    const typeDef = await page.evaluate((id) => {
      const s = (window as any).__stachel;
      const def = s.ext.objectTypes.get('sticky');
      return def.sibling(s.store.get(id));
    }, n);
    expect(typeDef).toHaveProperty('tags', undefined);
  });
});

test.describe('Objekt-Links', () => {
  test('Link zu Rahmen aus der Liste, Knopf springt hin; Ziel per Klick wählen; Ziel weg → Hinweis', async ({ page }) => {
    const a = await add(page, { type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'Zum Lageplan' });
    const b = await add(page, { type: 'shape', shape: 'rect', x: 260, y: 0, w: 200, h: 120, text: 'Siehe Notiz' });
    const f = await add(page, { type: 'frame', x: 4000, y: 3000, w: 800, h: 450, title: 'Lageplan Nord' });
    await page.evaluate(() => (window as any).__stachel.api().fitTo({ x: -50, y: -50, w: 600, h: 320 }));
    await select(page, [a]);
    await ctx(page).getByRole('button', { name: 'Link zu Rahmen oder Objekt' }).click();
    await page.getByRole('group', { name: 'Rahmen' }).getByRole('button', { name: 'Lageplan Nord' }).click();
    expect((await get(page, a)).linkTo).toBe(f);
    const badge = page.locator(`[data-link-for="${a}"]`);
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('aria-label', 'Gehe zu: Lageplan Nord');
    await page.keyboard.press('Escape');
    await page.mouse.click(700, 700);
    await shot(page, 'link-knopf');

    // Knopf: fährt zum Rahmen und wählt ihn aus
    await badge.click();
    await expect.poll(() => selection(page)).toEqual([f]);
    const vp = page.viewportSize()!;
    await expect
      .poll(async () => {
        const fb = (await page.locator(`.obj[data-id="${f}"]`).boundingBox())!;
        return fb.x >= 0 && fb.y >= 0 && fb.x + fb.width <= vp.width && fb.y + fb.height <= vp.height && fb.width > vp.width * 0.4;
      })
      .toBe(true);

    // zurück, Form verlinkt per Klick auf die Notiz
    await page.evaluate(() => (window as any).__stachel.api().fitTo({ x: -50, y: -50, w: 600, h: 320 }));
    await select(page, [b]);
    await ctx(page).getByRole('button', { name: 'Link zu Rahmen oder Objekt' }).click();
    await page.getByRole('button', { name: 'Ziel auf dem Board wählen …' }).click();
    await expect(page.getByTestId('linkto-catch')).toBeVisible();
    await expect(page.getByText('Link-Ziel anklicken (Objekt oder Rahmen)')).toBeVisible();
    await shot(page, 'link-waehlen');
    const ab = (await page.locator(`[data-id="${a}"]`).boundingBox())!;
    await page.mouse.click(ab.x + ab.width / 2, ab.y + ab.height / 2);
    expect((await get(page, b)).linkTo).toBe(a);
    await expect(page.getByTestId('linkto-catch')).toHaveCount(0);
    await page.locator(`[data-link-for="${b}"]`).click();
    await expect.poll(() => selection(page)).toEqual([a]);

    // Esc bricht das Wählen ab, nichts ändert sich
    await select(page, [b]);
    await ctx(page).getByRole('button', { name: 'Link zu Rahmen oder Objekt' }).click();
    await page.getByRole('button', { name: 'Ziel auf dem Board wählen …' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('linkto-catch')).toHaveCount(0);
    expect((await get(page, b)).linkTo).toBe(a);

    // Ziel gelöscht → Knopf zeigt es, Klick gibt Hinweis
    await page.evaluate((id) => (window as any).__stachel.store.remove([id]), f);
    await expect(page.locator(`[data-link-for="${a}"]`)).toHaveClass(/is-broken/);
    const cam0 = await camera(page);
    await page.locator(`[data-link-for="${a}"]`).click();
    await expect(page.getByText('Das verlinkte Ziel gibt es nicht mehr.')).toBeVisible();
    expect(await camera(page)).toEqual(cam0);

    // Link entfernen, Rückgängig stellt ihn wieder her
    await select(page, [b]);
    await ctx(page).getByRole('button', { name: 'Link zu Rahmen oder Objekt' }).click();
    await page.getByRole('button', { name: 'Link entfernen' }).click();
    expect((await get(page, b)).linkTo).toBeUndefined();
    await expect(page.locator(`[data-link-for="${b}"]`)).toHaveCount(0);
    await page.keyboard.press('Control+z');
    expect((await get(page, b)).linkTo).toBe(a);
  });

  test('Rechtsklick „Link zu …“ und kein Link auf sich selbst; Verbinder/Striche ohne Link', async ({ page }) => {
    const a = await add(page, { type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'A' });
    const c = await add(page, { type: 'connector', x: 0, y: 0, w: 100, h: 0, from: { x: 300, y: 300 }, to: { x: 500, y: 300 } });
    await page.evaluate(() => (window as any).__stachel.api().fitTo({ x: -50, y: -50, w: 700, h: 500 }));
    await select(page, [a]);
    const box = (await page.locator(`[data-id="${a}"]`).boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await page.getByRole('menuitem', { name: /Link zu/ }).click();
    const pick = page.getByRole('menuitem', { name: 'Ziel auf dem Board wählen' });
    await pick.click();
    await expect(page.getByTestId('linkto-catch')).toBeVisible();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByText('Ein Objekt kann nicht auf sich selbst verlinken.')).toBeVisible();
    expect((await get(page, a)).linkTo).toBeUndefined();
    await select(page, [c]);
    await expect(ctx(page)).toBeVisible();
    await expect(ctx(page).getByRole('button', { name: 'Link zu Rahmen oder Objekt' })).toHaveCount(0);
  });
});

test.describe('Handy', () => {
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  test('Tags und Link in der angedockten Kontextleiste erreichbar, Popover im Bild', async ({ page }) => {
    const a = await add(page, { type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'Einlass', tags: [{ label: 'Orga', color: '#1763b5' }] });
    await add(page, { type: 'frame', x: 600, y: 0, w: 400, h: 300, title: 'Bühne' });
    await page.evaluate(() => (window as any).__stachel.api().fitTo({ x: -40, y: -40, w: 280, h: 280 }));
    await select(page, [a]);
    // am Handy passt nicht alles in die Leiste: der Rest steht hinter „Weitere Aktionen“
    const reach = async (name: string) => {
      const btn = ctx(page).getByRole('button', { name });
      if (!(await btn.isVisible())) await ctx(page).getByRole('button', { name: 'Weitere Aktionen' }).click();
      return btn;
    };
    for (const name of ['Tags', 'Link zu Rahmen oder Objekt']) {
      const bb = (await (await reach(name)).boundingBox())!;
      expect(bb.x).toBeGreaterThanOrEqual(0);
      expect(bb.x + bb.width).toBeLessThanOrEqual(390);
    }
    await (await reach('Tags')).click();
    const pop = page.getByRole('group', { name: 'Tags', exact: true });
    await expect(pop).toBeVisible();
    const pb = (await pop.boundingBox())!;
    expect(pb.x).toBeGreaterThanOrEqual(0);
    expect(pb.x + pb.width).toBeLessThanOrEqual(390);
    expect(pb.y).toBeGreaterThanOrEqual(0);
    await page.waitForTimeout(300); // Einblend-Animation
    await shot(page, 'tags-handy');
    await (await reach('Link zu Rahmen oder Objekt')).click();
    const lp = page.getByRole('group', { name: 'Link zu Rahmen oder Objekt' });
    await expect(lp.getByRole('button', { name: 'Bühne' })).toBeVisible();
    const lb = (await lp.boundingBox())!;
    expect(lb.x + lb.width).toBeLessThanOrEqual(390);
  });
});
