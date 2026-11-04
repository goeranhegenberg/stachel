// Zeitleiste (Modul structure, timeline/): anlegen, Eintrag per Doppelklick, ziehen, Länge, Spur wechseln, Zeitskala,
// Zeitraum über den Rand, Spuren, Kontextmenü, Haftnotiz hineinziehen, Suche, Vorlage, Export, Handy (Touch) und zwei
// Personen gleichzeitig (Test-Sync-Server auf freiem Port).
import { expect, test, type Browser, type CDPSession, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { Server } from '@hocuspocus/server';
import { startSyncServer } from './syncServer';
import { installFakeApi, sampleBoards, type FakeUser } from './fakeApi';
import { addSticky, drag, objects, openOffline, selection } from './helpers';

const OUT = path.resolve(import.meta.dirname, '../../docs/screenshots');
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `timeline-${name}.png`) });

const LABEL_W = 168;
const DP: Record<string, number> = { day: 40, week: 18, month: 5 };
const DAY = 86_400_000;
const D = (s: string) => Math.round(Date.parse(`${s}T00:00:00Z`) / DAY);
const F = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

interface Item {
  lane: string;
  start: string;
  end: string;
  title: string;
  color?: string;
  ms?: boolean;
}
interface TL {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tlStart: string;
  tlEnd: string;
  tlUnit?: string;
  timeline: { lanes: string[]; names: Record<string, string>; items: Record<string, Item> };
}

const timelines = async (page: Page) => (await objects(page)).filter((o) => o.type === 'timeline') as unknown as TL[];
const tl = async (page: Page) => (await timelines(page))[0];

/** Bildschirm-Geometrie: x-Mitte eines Tages, Maßstab */
async function geo(page: Page, t: TL) {
  const r = (await page.locator(`[data-testid="board"] [data-id="${t.id}"]`).boundingBox())!;
  const dp = DP[t.tlUnit ?? 'week'];
  const start = D(t.tlStart);
  const days = D(t.tlEnd) - start + 1;
  const k = r.width / (LABEL_W + days * dp);
  return { r, k, dp, start, px: dp * k, dayX: (n: number) => r.x + (LABEL_W + (n - start + 0.5) * dp) * k };
}
async function laneY(page: Page, t: TL, lane: string) {
  const b = (await page.locator(`[data-id="${t.id}"] [data-tl-label="${lane}"]`).boundingBox())!;
  return b.y + b.height / 2;
}
const itemBox = async (page: Page, key: string, scope = '') => (await page.locator(`${scope} [data-tl-item="${key}"]`).boundingBox())!;
const mid = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

async function tool(page: Page, label: string) {
  await page.getByRole('navigation').getByRole('button', { name: label, exact: true }).click();
}
async function newTimelineAt(page: Page, x: number, y: number) {
  await tool(page, 'Karte, Tabelle, Mindmap');
  await page.getByRole('group', { name: 'Werkzeug-Optionen' }).getByRole('button', { name: 'Zeitleiste', exact: true }).click();
  await page.mouse.click(x, y);
  await expect(page.locator('.structure-tl')).toHaveCount((await timelines(page)).length);
  return (await timelines(page)).at(-1)!;
}

test.describe('offline', () => {
  test.beforeEach(async ({ page }) => {
    await openOffline(page);
  });

  test('Eintrag per Doppelklick anlegen, ziehen (rastet auf Tage), Länge ändern, Spur wechseln, Undo', async ({ page }) => {
    let t = await newTimelineAt(page, 720, 470);
    expect(await selection(page)).toEqual([t.id]);
    const lanes = t.timeline.lanes;
    let g = await geo(page, t);
    const day = g.start + 9;
    await page.mouse.dblclick(g.dayX(day), await laneY(page, t, lanes[0]));
    const input = page.getByLabel('Titel des Eintrags');
    await expect(input).toBeFocused();
    await page.keyboard.type('Bühne aufbauen');
    await page.keyboard.press('Enter');
    t = await tl(page);
    const [key] = Object.keys(t.timeline.items);
    expect(t.timeline.items[key]).toMatchObject({ lane: lanes[0], start: F(day), end: F(day + 6), title: 'Bühne aufbauen' });
    await expect(page.locator(`[data-tl-item="${key}"]`)).toContainText('Bühne aufbauen');
    await shot(page, 'eintrag');

    // verschieben: 3,3 Tage nach rechts → rastet auf 3 Tage
    let b = await itemBox(page, key);
    await drag(page, mid(b), { x: mid(b).x + 3.3 * g.px, y: mid(b).y });
    t = await tl(page);
    expect(t.timeline.items[key]).toMatchObject({ start: F(day + 3), end: F(day + 9) });

    // rechtes Ende 2 Tage weiter
    b = await itemBox(page, key);
    await drag(page, { x: b.x + b.width - 2, y: mid(b).y }, { x: b.x + b.width - 2 + 2 * g.px, y: mid(b).y });
    t = await tl(page);
    expect(t.timeline.items[key]).toMatchObject({ start: F(day + 3), end: F(day + 11) });
    // linkes Ende 1 Tag später
    b = await itemBox(page, key);
    await drag(page, { x: b.x + 2, y: mid(b).y }, { x: b.x + 2 + g.px, y: mid(b).y });
    t = await tl(page);
    expect(t.timeline.items[key]).toMatchObject({ start: F(day + 4), end: F(day + 11) });

    // in die zweite Spur ziehen (gleiche Tage)
    b = await itemBox(page, key);
    await drag(page, mid(b), { x: mid(b).x, y: await laneY(page, t, lanes[1]) });
    t = await tl(page);
    expect(t.timeline.items[key]).toMatchObject({ lane: lanes[1], start: F(day + 4), end: F(day + 11) });

    // ein Undo-Schritt je Ziehen
    await page.keyboard.press('Control+z');
    t = await tl(page);
    expect(t.timeline.items[key]).toMatchObject({ lane: lanes[0], start: F(day + 4) });
    await page.keyboard.press('Control+z');
    t = await tl(page);
    expect(t.timeline.items[key]).toMatchObject({ start: F(day + 3), end: F(day + 11) });
    await page.keyboard.press('Control+y');
    await page.keyboard.press('Control+y');
    t = await tl(page);
    expect(t.timeline.items[key].lane).toBe(lanes[1]);

    // Esc beim Ziehen bricht ab
    b = await itemBox(page, key);
    await page.mouse.move(mid(b).x, mid(b).y);
    await page.mouse.down();
    await page.mouse.move(mid(b).x + 5 * g.px, mid(b).y, { steps: 8 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    t = await tl(page);
    expect(t.timeline.items[key]).toMatchObject({ start: F(day + 4), end: F(day + 11) });

    // in der ausgewählten Zeitleiste aufziehen legt einen Eintrag über die gezogenen Tage an
    g = await geo(page, t);
    const y3 = await laneY(page, t, lanes[2]);
    await drag(page, { x: g.dayX(g.start + 1), y: y3 }, { x: g.dayX(g.start + 5), y: y3 });
    await expect(input).toBeFocused();
    await page.keyboard.type('Plakate');
    await page.keyboard.press('Escape');
    t = await tl(page);
    const drawn = Object.values(t.timeline.items).find((i) => i.title === 'Plakate')!;
    expect(drawn).toMatchObject({ lane: lanes[2], start: F(g.start + 1), end: F(g.start + 5) });

    // Tasten: Pfeil rechts = ein Tag, Entf löscht nur den aktiven Eintrag
    await page.locator(`[data-tl-item="${key}"]`).click();
    await page.keyboard.press('ArrowRight');
    t = await tl(page);
    expect(t.timeline.items[key].start).toBe(F(day + 5));
    await page.keyboard.press('Delete');
    t = await tl(page);
    expect(t?.timeline.items[key]).toBeUndefined();
    expect(Object.keys(t.timeline.items)).toHaveLength(1);
  });

  test('Zeitskala Tag/Woche/Monat, Zeitraum über den Rand, Spuren umbenennen/hinzufügen, Kontextmenü', async ({ page }) => {
    let t = await newTimelineAt(page, 720, 470);
    const w0 = t.w;
    // Zeitskala „Tag“: breiter, Tage im Kopf
    await page.getByRole('button', { name: 'Zeitskala' }).click();
    await page.getByRole('button', { name: 'Tag', exact: true }).click();
    t = await tl(page);
    expect(t.tlUnit).toBe('day');
    expect(t.w).toBe(w0 - 56 * 18 + 56 * 40);
    await page.evaluate(() => (window as any).__stachel.api().zoomToSelection());
    await page.waitForTimeout(400);
    await shot(page, 'tag');
    await page.getByRole('button', { name: 'Zeitskala' }).click();
    await page.getByRole('button', { name: 'Monat', exact: true }).click();
    t = await tl(page);
    expect(t.tlUnit).toBe('month');
    await page.getByRole('button', { name: 'Zeitskala' }).click();
    await page.getByRole('button', { name: 'Woche', exact: true }).click();
    t = await tl(page);
    expect(t.tlUnit).toBeUndefined();
    expect(t.w).toBe(w0);
    // halber Zoom, damit beide Ränder Platz zum Ziehen haben
    await page.evaluate((o) => (window as any).__stachel.setCamera({ x: 760 - (o.x + o.w / 2) * 0.5, y: 450 - (o.y + o.h / 2) * 0.5, z: 0.5 }), t);
    await page.waitForTimeout(300);

    // rechter Rand: 2 Wochen mehr; linker Rand: eine Woche früher
    let g = await geo(page, t);
    const end0 = D(t.tlEnd);
    let h = (await page.locator('[data-handle="e"]').boundingBox())!;
    await drag(page, mid(h), { x: mid(h).x + 14 * g.px, y: mid(h).y });
    t = await tl(page);
    expect(D(t.tlEnd)).toBe(end0 + 14);
    expect(t.w).toBe(w0 + 14 * 18);
    const start0 = D(t.tlStart);
    g = await geo(page, t);
    h = (await page.locator('[data-handle="w"]').boundingBox())!;
    await drag(page, mid(h), { x: mid(h).x - 7 * g.px, y: mid(h).y });
    t = await tl(page);
    expect(D(t.tlStart)).toBe(start0 - 7);
    expect(D(t.tlEnd)).toBe(end0 + 14);

    // Ecke skaliert (Seitenverhältnis bleibt, Zeitraum bleibt)
    h = (await page.locator('[data-handle="se"]').boundingBox())!;
    await drag(page, mid(h), { x: mid(h).x - 200, y: mid(h).y - 200 * (t.h / t.w) });
    const t2 = await tl(page);
    expect(t2.tlStart).toBe(t.tlStart);
    expect(t2.w).toBeLessThan(t.w - 150);
    expect(t2.w / t2.h).toBeCloseTo(t.w / t.h, 1);
    t = t2;

    // Spur umbenennen per Doppelklick auf den Namen
    const lanes = t.timeline.lanes;
    const lb = (await page.locator(`[data-id="${t.id}"] [data-tl-label="${lanes[1]}"]`).boundingBox())!;
    await page.mouse.dblclick(lb.x + lb.width / 2, lb.y + lb.height / 2);
    const name = page.getByLabel('Name der Spur');
    await expect(name).toBeFocused();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Technik');
    await page.keyboard.press('Enter');
    t = await tl(page);
    expect(t.timeline.names[lanes[1]]).toBe('Technik');
    await expect(page.locator(`[data-id="${t.id}"] [data-tl-label="${lanes[1]}"]`)).toHaveText(/TECHNIK/i);

    // „+ Spur“ unter der Zeitleiste: neue Spur, Name gleich schreiben
    await page.getByRole('button', { name: 'Spur hinzufügen' }).first().click();
    await expect(name).toBeFocused();
    await page.keyboard.type('Bar');
    await page.keyboard.press('Enter');
    t = await tl(page);
    expect(t.timeline.lanes).toHaveLength(4);
    expect(Object.values(t.timeline.names)).toContain('Bar');

    // Spur per Griff nach oben ziehen
    const barLane = t.timeline.lanes.find((l) => t.timeline.names[l] === 'Bar')!;
    const grip = (await page.locator(`[data-id="${t.id}"] [data-tl-label="${barLane}"] [data-tl-lanegrip]`).boundingBox())!;
    await drag(page, mid(grip), { x: mid(grip).x, y: (await laneY(page, t, lanes[0])) - 10 });
    t = await tl(page);
    expect(t.timeline.lanes[0]).toBe(barLane);

    // Kontextmenü: Eintrag hier anlegen, Farbe, Meilenstein, löschen
    g = await geo(page, t);
    await page.mouse.click(g.dayX(g.start + 10), await laneY(page, t, lanes[0]), { button: 'right' });
    await page.getByRole('menuitem', { name: 'Eintrag hier anlegen' }).click();
    await page.keyboard.type('Probe');
    await page.keyboard.press('Enter');
    t = await tl(page);
    const [key] = Object.keys(t.timeline.items);
    expect(t.timeline.items[key]).toMatchObject({ lane: lanes[0], start: F(g.start + 10), title: 'Probe' });
    let b = await itemBox(page, key);
    await page.mouse.click(mid(b).x, mid(b).y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Farbe' }).hover();
    await page.getByRole('menuitem', { name: 'Pink' }).click();
    t = await tl(page);
    expect(t.timeline.items[key].color).toBe('#ec4e92');
    b = await itemBox(page, key);
    await page.mouse.click(mid(b).x, mid(b).y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Als Meilenstein' }).click();
    t = await tl(page);
    expect(t.timeline.items[key]).toMatchObject({ ms: true, end: t.timeline.items[key].start });
    await expect(page.locator(`[data-tl-item="${key}"] .structure-tl__diamond`)).toBeVisible();
    await shot(page, 'meilenstein');
    // Datum per Eingabe (Dialog)
    b = await itemBox(page, key);
    await page.mouse.click(b.x + 8, mid(b).y, { button: 'right' });
    await page.getByRole('menuitem', { name: /Titel, Datum und Spur/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Meilenstein' });
    await expect(dlg).toBeVisible();
    await dlg.getByLabel('Meilenstein (ein Tag)').uncheck();
    await expect(page.getByRole('dialog', { name: 'Eintrag' })).toBeVisible();
    const ed = page.getByRole('dialog', { name: 'Eintrag' });
    await ed.getByLabel('Ende').fill(F(g.start + 20));
    await ed.getByLabel('Titel').fill('Generalprobe');
    await ed.getByRole('button', { name: 'Fertig' }).click();
    t = await tl(page);
    expect(t.timeline.items[key]).toMatchObject({ title: 'Generalprobe', end: F(g.start + 20) });
    expect(t.timeline.items[key].ms).toBeUndefined();
    b = await itemBox(page, key);
    await page.mouse.click(mid(b).x, mid(b).y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Eintrag löschen' }).click();
    t = await tl(page);
    expect(t.timeline.items[key]).toBeUndefined();
  });

  test('Haftnotiz auf eine Spur ziehen wird zum Eintrag; Suche, Vorlage, Export, Detailstufe', async ({ page }) => {
    let t = await newTimelineAt(page, 720, 560);
    await page.keyboard.press('Escape');
    const note = await addSticky(page, { x: 700, y: 200 }, 'Getränke bestellen');
    const g = await geo(page, t);
    const target = { x: g.dayX(g.start + 15), y: await laneY(page, t, t.timeline.lanes[1]) };
    const c = { x: 700, y: 200 };
    await page.mouse.click(c.x, c.y);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 15 });
    await expect(page.locator('.structure-tl-dropzone')).toBeVisible();
    // Markierung liegt auf der Spur unter der Notiz
    const zone = (await page.locator('.structure-tl-dropzone').boundingBox())!;
    expect(Math.abs(mid(zone).y - target.y)).toBeLessThan(6);
    await shot(page, 'notiz-ziehen');
    await page.mouse.up();
    await expect.poll(async () => (await objects(page)).some((o) => o.id === note.id)).toBe(false);
    t = await tl(page);
    const it = Object.values(t.timeline.items)[0];
    expect(it).toMatchObject({ lane: t.timeline.lanes[1], title: 'Getränke bestellen', color: '#fff27a' });
    expect(Math.abs(D(it.start) - (g.start + 15))).toBeLessThanOrEqual(1);
    await expect(page.getByText('Als Eintrag in die Zeitleiste übernommen')).toBeVisible();
    // Undo holt die Notiz zurück
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await objects(page)).some((o) => o.type === 'sticky')).toBe(true);
    expect(Object.keys((await tl(page)).timeline.items)).toHaveLength(0);
    await page.keyboard.press('Control+y');

    // Suche findet Titel in der Zeitleiste
    await page.keyboard.press('Control+f');
    await page.getByLabel('Suchbegriff').fill('Getränke');
    await expect(page.getByTestId('search-count')).toHaveText(/1/);
    await page.keyboard.press('Escape');

    // Vorlage „Eventplanung-Zeitleiste“
    await page.evaluate(() => (window as any).__stachel.api().openModal('structure.templates'));
    await page.locator('[data-template="eventplan"]').click();
    await page.waitForTimeout(200);
    await shot(page, 'vorlage-galerie');
    await page.locator('[data-template="eventplan"]').dblclick();
    await expect(page.getByRole('dialog', { name: 'Vorlagen' })).toBeHidden();
    expect(await timelines(page)).toHaveLength(2);
    const ev = (await timelines(page)).find((x) => x.timeline.lanes.length === 5)!;
    expect(Object.keys(ev.timeline.items).length).toBe(15);
    await page.evaluate((id) => (window as any).__stachel.api().setSelection([id]), ev.id);
    await page.evaluate(() => (window as any).__stachel.api().zoomToSelection());
    await page.waitForTimeout(400);
    await shot(page, 'vorlage');

    // Export der Auswahl als PNG
    await page.getByRole('button', { name: 'Board-Menü' }).click();
    await page.getByRole('menuitem', { name: 'Exportieren …' }).click();
    const dialog = page.getByTestId('export-dialog');
    await expect(dialog.getByRole('radio', { name: /Auswahl/ })).toBeChecked();
    const [png] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Exportieren' }).click()]);
    const buf = fs.readFileSync((await png.path())!);
    expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG');
    fs.writeFileSync(path.join(OUT, 'timeline-export.png'), buf);
    // gezeichnet: schwarzer Kopf oben, pinke Programm-Balken
    const colors = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const ctx = cv.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      let pink = 0;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4 * 7) {
        if (d[i] > 220 && d[i + 1] < 110 && d[i + 2] > 120 && d[i + 2] < 170) pink++;
        if (d[i] < 30 && d[i + 1] < 30 && d[i + 2] < 30 && d[i + 3] > 200) dark++;
      }
      return { pink, dark, total: d.length / 28 };
    }, buf.toString('base64'));
    expect(colors.pink).toBeGreaterThan(50);
    // schwarzer Kopf: ein guter Teil der Fläche
    expect(colors.dark / colors.total).toBeGreaterThan(0.08);

    // weit herausgezoomt: einfache Fläche statt Einzelheiten
    await page.evaluate(() => (window as any).__stachel.setCamera({ x: 700, y: 400, z: 0.02 }));
    await page.waitForTimeout(200);
    await expect(page.locator('.structure-tl')).toHaveCount(0);
    await page.evaluate(() => (window as any).__stachel.setCamera({ x: 300, y: 300, z: 0.2 }));
    await page.waitForTimeout(200);
    await expect(page.locator('.structure-tl.is-far').first()).toBeVisible();
    await expect(page.locator('.structure-tl__title')).toHaveCount(0);
  });

  test('Kopieren und Einfügen einer Zeitleiste (eigene Struktur)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const t = await newTimelineAt(page, 720, 300);
    const g = await geo(page, t);
    await page.mouse.dblclick(g.dayX(g.start + 3), await laneY(page, t, t.timeline.lanes[0]));
    await page.keyboard.type('Kopie mich');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    // am Kopf anklicken wählt die Zeitleiste
    await page.mouse.click(g.r.x + g.r.width / 2, g.r.y + 12);
    await expect.poll(() => selection(page)).toEqual([t.id]);
    await page.keyboard.press('Control+c');
    await page.mouse.move(720, 700);
    await page.keyboard.press('Control+v');
    await expect.poll(async () => (await timelines(page)).length).toBe(2);
    const [a, b] = await timelines(page);
    expect(Object.values(b.timeline.items)[0].title).toBe('Kopie mich');
    // eigene Struktur: Änderung an der Kopie lässt das Original stehen
    const key = Object.keys(b.timeline.items)[0];
    expect(Object.keys(a.timeline.items)[0]).toBe(key);
    const kb = await itemBox(page, key, `[data-id="${b.id}"]`);
    await drag(page, mid(kb), { x: mid(kb).x + 3 * g.px, y: mid(kb).y });
    const [a2, b2] = await timelines(page);
    expect(Object.values(a2.timeline.items)[0].start).toBe(Object.values(a.timeline.items)[0].start);
    expect(Object.values(b2.timeline.items)[0].start).not.toBe(Object.values(a.timeline.items)[0].start);
  });
});

// ---- Handy (Touch) --------------------------------------------------------------------------------------------------------

test.describe('Handy', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  type TP = { x: number; y: number };
  const sessions = new WeakMap<Page, Promise<CDPSession>>();
  const cdpOf = (page: Page) => {
    if (!sessions.has(page)) sessions.set(page, page.context().newCDPSession(page));
    return sessions.get(page)!;
  };
  const touch = async (page: Page, type: 'touchStart' | 'touchMove' | 'touchEnd', pts: TP[]) => {
    await (await cdpOf(page)).send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
  };
  const fingerDrag = async (page: Page, a: TP, b: TP, steps = 10) => {
    await touch(page, 'touchStart', [a]);
    for (let i = 1; i <= steps; i++) await touch(page, 'touchMove', [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }]);
    await touch(page, 'touchEnd', []);
  };

  test('antippen, Eintrag mit dem Finger ziehen, Griffe mit 44 px, langes Drücken öffnet den Dialog', async ({ page }) => {
    await openOffline(page);
    await page.evaluate(() => (window as any).__stachel.api().openModal('structure.templates'));
    await page.locator('[data-template="eventplan"]').click();
    await page.getByRole('button', { name: 'Einfügen', exact: true }).click();
    let t = await tl(page);
    // auf die Programm-Spur zoomen
    await page.evaluate(
      ({ x, y, w }) => {
        const api = (window as any).__stachel.api();
        api.setSelection([]);
        api.fitTo({ x, y, w: w * 0.45, h: 300 }, 2);
      },
      { x: t.x, y: t.y, w: t.w },
    );
    await page.waitForTimeout(500);
    const key = Object.entries(t.timeline.items).find(([, i]) => i.title === 'Bands anfragen')![0];
    let b = await itemBox(page, key);
    // erst antippen wählt die Zeitleiste (Finger auf nicht ausgewählter Zeitleiste verschiebt die Ansicht)
    await page.touchscreen.tap(mid(b).x, mid(b).y);
    await expect.poll(() => selection(page)).toEqual([t.id]);
    await expect(page.locator(`[data-tl-item="${key}"]`)).toHaveClass(/is-active/);
    // Kontextleiste unten: Zeitskala passt in die Leiste, die Eintrags-Knöpfe liegen notfalls hinter „···“
    await expect(page.getByRole('button', { name: 'Zeitskala' })).toBeVisible();
    // Griffe: mindestens 44 px Trefferfläche
    const grip = page.locator('[data-tl-handle="end"]');
    await expect(grip).toBeVisible();
    const gb = (await grip.boundingBox())!;
    const hitsGrip = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-tl-handle]'), { x: mid(gb).x + 20, y: mid(gb).y + 18 });
    expect(hitsGrip).toBe(true);
    await shot(page, 'handy');

    // Finger zieht den Eintrag eine Woche weiter
    const g = await geo(page, t);
    const it0 = t.timeline.items[key];
    b = await itemBox(page, key);
    await fingerDrag(page, mid(b), { x: mid(b).x + 7 * g.px, y: mid(b).y });
    t = await tl(page);
    expect(t.timeline.items[key]).toMatchObject({ start: F(D(it0.start) + 7), end: F(D(it0.end) + 7), lane: it0.lane });
    // Griff am Ende: 3 Tage länger
    const gb2 = (await page.locator('[data-tl-handle="end"]').boundingBox())!;
    await fingerDrag(page, mid(gb2), { x: mid(gb2).x + 3 * g.px, y: mid(gb2).y });
    t = await tl(page);
    expect(t.timeline.items[key].end).toBe(F(D(it0.end) + 10));

    // langes Drücken öffnet „Eintrag“
    b = await itemBox(page, key);
    await touch(page, 'touchStart', [mid(b)]);
    await page.waitForTimeout(700);
    await touch(page, 'touchEnd', []);
    const dlg = page.getByRole('dialog', { name: 'Eintrag' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel('Titel')).toHaveValue('Bands anfragen');
    await shot(page, 'handy-dialog');
    await dlg.getByRole('button', { name: 'Fertig' }).click();
  });
});

// ---- zwei Personen gleichzeitig ---------------------------------------------------------------------------------------------

let server: Server;
let syncPort = 0;
const MARA: FakeUser = { key: 'm:12', name: 'Mara Lindner', isOrga: true };
const JONAS: FakeUser = { key: 'm:31', name: 'Jonas Keller', isOrga: false };

async function openAs(browser: Browser, user: FakeUser, session: string, board: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'stachel_session', value: session, domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();
  await installFakeApi(page, { loggedIn: true, user, boards: sampleBoards(), syncPort });
  await page.goto(`/?b=${board}`);
  await expect(page.getByTestId('status')).toHaveText('Live');
  return page;
}

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

  test('zwei Personen ziehen gleichzeitig verschiedene Einträge und schreiben Titel – nichts geht verloren', async ({ browser }) => {
    const a = await openAs(browser, MARA, 'sess-mara', 'b-plan');
    const b = await openAs(browser, JONAS, 'sess-jonas', 'b-plan');
    await a.evaluate(() => (window as any).__stachel?.api?.());
    // Mara legt die Vorlage an
    await a.getByRole('navigation').getByRole('button', { name: 'Vorlagen', exact: true }).click();
    await a.locator('[data-template="eventplan"]').dblclick();
    await expect(b.locator('.structure-tl')).toHaveCount(1);
    const item = (p: Page, title: string) => p.locator('[data-tl-item]', { hasText: title });
    await expect(item(b, 'Bands anfragen')).toBeVisible();
    // beide zoomen gleich (Kamera ist je Person), Zeitleiste anwählen
    for (const p of [a, b]) {
      await p.keyboard.press('Escape');
      await p.keyboard.press('Shift+Digit1');
      await p.waitForTimeout(500);
    }
    const label = async (p: Page, title: string) => (await item(p, title).getAttribute('aria-label')) ?? '';
    const bandsBefore = await label(b, 'Bands anfragen');
    const flyerBefore = await label(a, 'Plakate gestalten');

    // gleichzeitig: Mara zieht „Bands anfragen“, Jonas „Plakate gestalten“ (Zeiger abwechselnd bewegt)
    const ba = (await item(a, 'Bands anfragen').boundingBox())!;
    const bb = (await item(b, 'Plakate gestalten').boundingBox())!;
    const dayA = await a.evaluate(() => {
      const el = document.querySelector('.structure-tl') as HTMLElement;
      const days = el.querySelectorAll('.structure-tl__tick').length; // Wochen
      return { w: el.getBoundingClientRect().width, days };
    });
    // 12 Wochen = 84 Tage, Zeitleisten-Breite in Bildschirm-px je Tag
    const px = (dayA.w * (84 * 18)) / (168 + 84 * 18) / 84;
    await a.mouse.move(mid(ba).x, mid(ba).y);
    await b.mouse.move(mid(bb).x, mid(bb).y);
    await a.mouse.down();
    await b.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await a.mouse.move(mid(ba).x + (i * 7 * px) / 10, mid(ba).y);
      await b.mouse.move(mid(bb).x - (i * 4 * px) / 10, mid(bb).y);
    }
    await a.mouse.up();
    await b.mouse.up();
    for (const p of [a, b]) {
      await expect.poll(() => label(p, 'Bands anfragen')).not.toBe(bandsBefore);
      await expect.poll(() => label(p, 'Plakate gestalten')).not.toBe(flyerBefore);
    }
    expect(await label(a, 'Bands anfragen')).toBe(await label(b, 'Bands anfragen'));
    expect(await label(a, 'Plakate gestalten')).toBe(await label(b, 'Plakate gestalten'));

    // gleichzeitig Titel schreiben: Mara in „Finanzplan“, Jonas in „Aufbau“
    const fa = (await item(a, 'Finanzplan').boundingBox())!;
    const fb = (await item(b, 'Aufbau').first().boundingBox())!;
    await a.mouse.dblclick(mid(fa).x, mid(fa).y);
    await b.mouse.dblclick(mid(fb).x, mid(fb).y);
    await expect(a.getByLabel('Titel des Eintrags')).toBeFocused();
    await expect(b.getByLabel('Titel des Eintrags')).toBeFocused();
    await a.keyboard.type(' 2027');
    await b.keyboard.type(' (Mi–Do)');
    await a.keyboard.press('Enter');
    await b.keyboard.press('Enter');
    for (const p of [a, b]) {
      await expect(item(p, 'Finanzplan 2027')).toBeVisible();
      await expect(item(p, 'Aufbau (Mi–Do)')).toBeVisible();
    }
    await a.screenshot({ path: path.join(OUT, 'timeline-live.png') });
    await a.context().close();
    await b.context().close();
  });
});
