// Runde 4 (x-text): Format übertragen (B1), Mindmap ohne leere Knoten (B11), Vorlagen an freiem Platz (B13),
// Tag-Menü (B14), Suche nach Tags/Personen, Einfügen von Tabellendaten und mehreren Zeilen.
import { expect, test, type Page } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import { centerOf, objects, openOffline, selection, type Obj } from './helpers';

// Belegbilder im Temp-Ordner (test-results leert jeder Playwright-Lauf, auch die parallelen)
const OUT = path.join(os.tmpdir(), 'stachel-text4');
type Full = Obj & { desc?: string; status?: string; due?: string; color?: string; tags?: { label: string }[]; assignee?: { name: string }; table?: { rows: string[]; cols: string[]; cells: Record<string, string> }; mind?: { parent?: string } };
const all = (page: Page) => objects(page) as Promise<Full[]>;
const matrix = (t: Full['table']) => t!.rows.map((r) => t!.cols.map((c) => t!.cells[`${r}:${c}`] ?? ''));
const create = (page: Page, o: Record<string, unknown>) => page.evaluate((x) => (window as any).__stachel.store.create(x), o) as Promise<string>;

test.beforeEach(async ({ page }) => {
  await openOffline(page);
});

test('Format übertragen ändert bei Karten nur die Farbe, nicht Beschreibung, Person, Datum, Status, Tags (B1)', async ({ page }) => {
  const a = await create(page, { type: 'card', x: -400, y: -100, w: 300, h: 140, text: 'A', color: '#ec4e92', desc: 'Beschreibung A', assignee: { key: 'm:1', name: 'Mara' }, due: '2026-11-01', status: 'doing', tags: [{ label: 'Bühne', color: '#c9e14a' }] });
  const b = await create(page, { type: 'card', x: 100, y: -100, w: 300, h: 140, text: 'B', color: '#1763b5', desc: 'Beschreibung B', assignee: { key: 'm:2', name: 'Jonas' }, due: '2026-12-24', status: 'todo', tags: [{ label: 'Später', color: '#1763b5' }] });
  await page.mouse.click(...(Object.values(await centerOf(page, a)) as [number, number]));
  await page.keyboard.press('Control+Alt+c');
  await page.mouse.click(...(Object.values(await centerOf(page, b)) as [number, number]));
  await page.keyboard.press('Control+Alt+v');
  const nb = (await all(page)).find((o) => o.id === b)!;
  expect(nb.color).toBe('#ec4e92');
  expect(nb.desc).toBe('Beschreibung B');
  expect(nb.assignee?.name).toBe('Jonas');
  expect(nb.due).toBe('2026-12-24');
  expect(nb.status).toBe('todo');
  expect(nb.tags?.map((t) => t.label)).toEqual(['Später']);
});

test('Mindmap: per Leiste angelegter, leer gebliebener Knoten verschwindet wieder (B11)', async ({ page }) => {
  await create(page, { type: 'mindnode', x: -60, y: -25, w: 120, h: 50, text: 'Wurzel', color: '#0a0a0a', mind: { level: 0 } });
  const [root] = await all(page);
  await page.locator(`[data-id="${root.id}"]`).click();
  // versehentlich „Unterthema anlegen“ in der Leiste getroffen
  await page.getByRole('button', { name: 'Unterthema anlegen' }).first().click();
  await expect.poll(async () => (await all(page)).length).toBe(2);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await all(page)).length).toBe(1);
  expect(await selection(page)).toEqual([root.id]);
  // mit Text bleibt er
  await page.keyboard.press('Tab');
  await page.keyboard.type('Bühne');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await all(page)).map((o) => o.text).sort()).toEqual(['Bühne', 'Wurzel']);
  // Rückgängig nimmt nur „Bühne“ zurück, der verschwundene leere Knoten kommt nicht wieder
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await all(page)).length).toBe(1);
});

test('Vorlage landet neben vorhandenem Inhalt statt darüber (B13)', async ({ page }) => {
  // Notizen in der Bildmitte
  const center = await page.evaluate(() => (window as any).__stachel.api().viewCenter());
  for (const [dx, dy] of [
    [-150, -120],
    [80, -120],
    [-150, 100],
    [80, 100],
  ])
    await create(page, { type: 'sticky', x: center.x + dx, y: center.y + dy, w: 200, h: 200, text: 'Notiz', color: '#fff27a' });
  await page.getByRole('navigation').getByRole('button', { name: 'Vorlagen', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Vorlagen' });
  await dlg.locator('[data-template="kanban"]').click();
  await dlg.getByRole('button', { name: 'Einfügen' }).click();
  const objs = await all(page);
  const notes = objs.filter((o) => o.type === 'sticky' && o.text === 'Notiz');
  const frame = objs.find((o) => o.type === 'frame')!;
  const overlaps = (a: Obj, b: Obj) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const n of notes) expect(overlaps(n, frame)).toBe(false);
  // die eingefügte Vorlage ist ganz im Bild
  const vp = page.viewportSize()!;
  await expect
    .poll(async () => {
      const box = (await page.locator(`.obj[data-id="${frame.id}"]`).boundingBox())!;
      return box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height;
    })
    .toBe(true);
  await page.screenshot({ path: path.join(OUT, 'vorlage-frei.png') });
});

test('Tag-Menü: Chips mit Abstand, alle Farben in einer Reihe (B14)', async ({ page }) => {
  const id = await create(page, { type: 'sticky', x: -100, y: -100, w: 200, h: 200, text: 'Bühne', color: '#fff27a', tags: [{ label: 'Dringend', color: '#c9e14a' }, { label: 'Technik', color: '#ec4e92' }] });
  await page.locator(`[data-id="${id}"]`).click();
  await page.getByRole('button', { name: 'Tags' }).click();
  const list = page.getByRole('group', { name: 'Tags des Boards' });
  const chips = list.getByRole('button');
  await expect(chips).toHaveCount(2);
  const [c1, c2] = [(await chips.nth(0).boundingBox())!, (await chips.nth(1).boundingBox())!];
  const lb = (await list.boundingBox())!;
  // Ring (3,5 px) passt neben die Chips und in die Liste
  expect(c2.x - (c1.x + c1.width)).toBeGreaterThanOrEqual(8);
  expect(c1.x - lb.x).toBeGreaterThanOrEqual(4);
  const sw = page.getByRole('group', { name: 'Farbe des neuen Tags' }).getByRole('button');
  await expect(sw).toHaveCount(8);
  const ys = await sw.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().y)));
  expect(new Set(ys).size).toBe(1);
  await page.locator('.tools-tags-popwrap').screenshot({ path: path.join(OUT, 'tags-pop.png') });
});

test('Strg F findet Tags und zuständige Personen', async ({ page }) => {
  await create(page, { type: 'sticky', x: -400, y: -100, w: 200, h: 200, text: 'Getränke', color: '#fff27a', tags: [{ label: 'Dringend', color: '#ec4e92' }] });
  await create(page, { type: 'card', x: 100, y: -100, w: 300, h: 100, text: 'Bühnenplan', assignee: { key: 'm:1', name: 'Mara Lindner' } });
  await page.mouse.click(700, 700);
  await page.keyboard.press('Control+f');
  const box = page.getByPlaceholder('Auf dem Board suchen');
  await box.fill('dringend');
  await expect(page.getByText(/1 von 1/)).toBeVisible();
  await box.fill('mara');
  await expect(page.getByText(/1 von 1/)).toBeVisible();
});

test('Einfügen: Tabellendaten → Tabelle, mehrere Zeilen → Haftnotizen, eine Zeile wie bisher', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.mouse.move(700, 450);
  // Excel/TSV
  await page.evaluate(() => navigator.clipboard.writeText('Name\tSchicht\r\nMara\tFrüh\r\nJonas\tSpät\r\n'));
  await page.keyboard.press('Control+v');
  const dlg = page.getByRole('dialog', { name: 'Einfügen als …' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('button', { name: 'Tabelle' })).toBeFocused();
  await page.waitForTimeout(100);
  await dlg.screenshot({ path: path.join(OUT, 'einfuegen-abfrage.png') });
  await page.keyboard.press('Enter');
  await expect(dlg).toBeHidden();
  let objs = await all(page);
  expect(objs.map((o) => o.type)).toEqual(['table']);
  expect(matrix(objs[0].table)).toEqual([
    ['Name', 'Schicht'],
    ['Mara', 'Früh'],
    ['Jonas', 'Spät'],
  ]);
  expect(await selection(page)).toEqual([objs[0].id]);
  await page.keyboard.press('Delete');

  // mehrere Zeilen → eine Haftnotiz je Zeile
  await page.evaluate(() => navigator.clipboard.writeText('Bühne aufbauen\nGetränke bestellen\n\nHelfer einteilen\n'));
  await page.keyboard.press('Control+v');
  await expect(dlg.getByRole('button', { name: '3 Haftnotizen' })).toBeFocused();
  await page.keyboard.press('Enter');
  objs = await all(page);
  expect(objs.map((o) => o.text)).toEqual(['Bühne aufbauen', 'Getränke bestellen', 'Helfer einteilen']);
  expect(new Set(objs.map((o) => `${o.x},${o.y}`)).size).toBe(3);
  await page.keyboard.press('Delete');

  // dieselben Zeilen als eine Notiz; Esc fügt nichts ein
  await page.keyboard.press('Control+v');
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  expect(await all(page)).toHaveLength(0);
  await page.keyboard.press('Control+v');
  await dlg.getByRole('button', { name: 'Eine Haftnotiz' }).click();
  objs = await all(page);
  expect(objs).toHaveLength(1);
  expect(objs[0].text).toBe('Bühne aufbauen\nGetränke bestellen\n\nHelfer einteilen');
  await page.keyboard.press('Delete');

  // eine Zeile: ohne Abfrage wie bisher
  await page.evaluate(() => navigator.clipboard.writeText('Nur eine Idee'));
  await page.keyboard.press('Control+v');
  await expect(dlg).toBeHidden();
  objs = await all(page);
  expect(objs.map((o) => o.text)).toEqual(['Nur eine Idee']);
});
