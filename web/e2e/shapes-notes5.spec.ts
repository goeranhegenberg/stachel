// Runde 5: Haftnotizen ohne Stachel-Pin, Einrasten beim Drehen (Maus, Touch, mehrere Objekte), gebogene Pfeile zwischen
// Objekten, rechteckige Haftnotizen (Quadrat/Rechteck/frei). Start: PW_PORT=5196 npx playwright test shapes-notes5
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import path from 'node:path';
import { objects, openOffline, selection, type Obj } from './helpers';

const OUT = path.resolve(import.meta.dirname, '../test-results/notes5');
const SHOTS = path.resolve(import.meta.dirname, '../../docs/screenshots');

const create = (page: Page, list: Record<string, unknown>[]): Promise<string[]> => page.evaluate((l) => (window as any).__stachel.store.createMany(l), list);
const get = async (page: Page, id: string) => (await objects(page)).find((o) => o.id === id) as (Obj & Record<string, any>) | undefined;
const select = (page: Page, ids: string[]) => page.evaluate((ids) => (window as any).__stachel.api().setSelection(ids), ids);
const note = (x: number, y: number, extra: Record<string, unknown> = {}) => ({ type: 'sticky', x, y, w: 200, h: 200, color: '#fff27a', text: '', ...extra });
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Auswahl bearbeiten' });
/** Weltpunkt → Bildschirm (Kamera 100 %, (0,0) in der Mitte des Boards) */
const S = (page: Page, x: number, y: number) => {
  const v = page.viewportSize()!;
  return { x: x + v.width / 2, y: y + v.height / 2 };
};
const pause = (page: Page) => page.waitForTimeout(250);
/** Bildschirm-Mitte eines Objekts (auch gedreht: Mitte der Hülle = Drehpunkt) */
async function mid(page: Page, id: string) {
  const b = (await page.locator(`[data-id="${id}"]`).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await openOffline(page);
  await page.evaluate(() => document.fonts.ready);
});

// ---- 1. Pin weg ---------------------------------------------------------------------------------------------------

test('Haftnotizen haben keinen Stachel-Pin mehr (Board, Werkzeugleiste)', async ({ page }) => {
  const [a, b, c, d] = await create(page, [
    note(-420, -230, { text: 'Bühne' }),
    note(-80, -230, { text: 'Bar und Getränke', color: '#c9e14a', x: -110, w: 350 }),
    note(-420, 90, { text: 'Kasse', color: '#ff9ec7', rotation: -6 }),
    note(-80, 110, { text: 'Einlass und Bändchen ab 16 Uhr', color: '#9fd3ff', x: -110, w: 420, h: 160 }),
  ]);
  const line = (from: string, to: string) => ({ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: from }, to: { objectId: to }, color: '#0a0a0a', strokeWidth: 2, arrowEnd: true, lineStyle: 'curved' });
  await create(page, [line(a, b), line(b, d), line(c, d)]);
  const el = page.locator(`[data-id="${a}"]`);
  await expect(el).toBeVisible();
  expect(await el.evaluate((n) => getComputedStyle(n, '::before').content)).toBe('none');
  // Werkzeug-Symbol: kein Pin-Kopf mehr
  await expect(page.getByRole('navigation', { name: 'Werkzeuge' }).locator('[data-tool="sticky"] circle')).toHaveCount(0);
  await pause(page);
  await page.screenshot({ path: path.join(SHOTS, 'shapes-notizformen.png') });
});

// ---- 2. Drehen mit Einrasten --------------------------------------------------------------------------------------

/** Bildschirmpunkt, an dem der Drehgriff landet, wenn das Objekt `target`° gedreht ist (vom Griff bei `r0`° aus). */
function rotateTarget(grip: { x: number; y: number }, c: { x: number; y: number }, r0: number, target: number) {
  const a0 = Math.atan2(grip.y - c.y, grip.x - c.x);
  const r = Math.hypot(grip.x - c.x, grip.y - c.y);
  const a = a0 + ((target - r0) * Math.PI) / 180;
  return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
}

async function gripCenter(page: Page) {
  const b = (await page.locator('[data-handle="rotate"]').boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test('Drehen: rastet beim Zurückdrehen magnetisch auf 0° ein, Etikett zeigt den Winkel', async ({ page }) => {
  const [a] = await create(page, [note(-100, -100, { text: 'Drehen' })]);
  const c = await mid(page, a);
  await page.mouse.click(c.x, c.y);
  const g = await gripCenter(page);
  // in einem Zug auf 30°, dann zurück auf 3° → genau 0
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  for (const t of [10, 20, 30]) {
    const p = rotateTarget(g, c, 0, t);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  }
  await expect(page.getByTestId('rotate-angle')).toHaveText('30°');
  await expect(page.getByTestId('rotate-angle')).not.toHaveClass(/is-snapped/);
  expect((await get(page, a))!.rotation).toBe(30);
  await page.screenshot({ path: path.join(OUT, 'drehen-30.png') });
  for (const t of [20, 10, 3]) {
    const p = rotateTarget(g, c, 0, t);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  }
  await expect(page.getByTestId('rotate-angle')).toHaveText('0°');
  await expect(page.getByTestId('rotate-angle')).toHaveClass(/is-snapped/);
  // Etikett sitzt neben dem Drehgriff (auch während der Einrast-Rückmeldung)
  const lb = (await page.getByTestId('rotate-angle').boundingBox())!;
  const gNow = await gripCenter(page);
  expect(Math.hypot(lb.x - gNow.x, lb.y + lb.height - gNow.y)).toBeLessThan(60);
  await page.screenshot({ path: path.join(OUT, 'drehen-eingerastet.png') });
  await page.mouse.up();
  await expect(page.getByTestId('rotate-angle')).toHaveCount(0);
  expect((await get(page, a))!.rotation).toBeUndefined();

  // gedreht loslassen, dann in einer neuen Geste von 30° auf 2° zurück
  let p = rotateTarget(g, c, 0, 30);
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  await page.mouse.move(p.x, p.y, { steps: 10 });
  await page.mouse.up();
  expect((await get(page, a))!.rotation).toBe(30);
  const g2 = await gripCenter(page);
  await page.mouse.move(g2.x, g2.y);
  await page.mouse.down();
  for (const t of [20, 10, 2]) {
    p = rotateTarget(g2, c, 30, t);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  }
  await page.mouse.up();
  expect((await get(page, a))!.rotation).toBeUndefined();

  // nahe 90° rastet ebenfalls ein, knapp außerhalb nicht
  const g3 = await gripCenter(page);
  await page.mouse.move(g3.x, g3.y);
  await page.mouse.down();
  p = rotateTarget(g3, c, 0, 86.5);
  await page.mouse.move(p.x, p.y, { steps: 10 });
  await expect(page.getByTestId('rotate-angle')).toHaveText('90°');
  p = rotateTarget(g3, c, 0, 80);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await expect(page.getByTestId('rotate-angle')).toHaveText('80°');
  p = rotateTarget(g3, c, 0, 92);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.up();
  expect((await get(page, a))!.rotation).toBe(90);
  // Umschalt: 15°-Schritte bleiben (37° → 30°, kein Einrasten auf 0)
  const g4 = await gripCenter(page);
  await page.mouse.move(g4.x, g4.y);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  p = rotateTarget(g4, c, 90, 97);
  await page.mouse.move(p.x, p.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  expect((await get(page, a))!.rotation).toBe(90);
  // Undo: jeder Dreh-Zug ein Schritt
  await page.keyboard.press('Control+z');
  expect((await get(page, a))!.rotation).toBeUndefined();
});

test('Drehen mehrerer Objekte: gemeinsame Mitte, Einrasten, Esc und Undo', async ({ page }) => {
  const ids = await create(page, [note(-260, -100, { text: 'A' }), note(60, -100, { text: 'B', color: '#c9e14a', rotation: 10 })]);
  const [cid] = await create(page, [{ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: ids[0] }, to: { objectId: ids[1] }, color: '#0a0a0a', strokeWidth: 2, arrowEnd: true }]);
  const before = await objects(page);
  await page.mouse.click(S(page, 0, 300).x, S(page, 0, 300).y);
  await page.keyboard.press('Control+a');
  expect((await selection(page)).sort()).toEqual([...ids, cid].sort());
  await expect(page.locator('[data-handle="rotate"]')).toHaveCount(1);
  const box = (await page.getByTestId('selection-box').boundingBox())!;
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const g = await gripCenter(page);
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  for (const t of [30, 60, 87]) {
    const p = rotateTarget(g, c, 0, t);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  }
  await expect(page.getByTestId('rotate-angle')).toHaveText('90°');
  await expect(page.getByTestId('rotate-angle')).toHaveClass(/is-snapped/);
  await pause(page);
  await page.screenshot({ path: path.join(OUT, 'drehen-mehrere.png') });
  await page.mouse.up();
  const A = (await get(page, ids[0]))!;
  const B = (await get(page, ids[1]))!;
  expect(A.rotation).toBe(90);
  expect(B.rotation).toBe(100);
  // A lag links, liegt jetzt oben (Mitte um 90° um die gemeinsame Mitte gedreht)
  expect(Math.round(A.x + 100)).toBe(Math.round(B.x + 100));
  expect(A.y).toBeLessThan(B.y);
  // Undo: ein Schritt zurück in die alte Lage
  await page.keyboard.press('Control+z');
  for (const o of before.filter((o) => o.type === 'sticky')) expect(await get(page, o.id)).toMatchObject({ x: o.x, y: o.y });
  // Esc mitten im Drehen: nichts geändert
  const g2 = await gripCenter(page);
  await page.mouse.move(g2.x, g2.y);
  await page.mouse.down();
  await page.mouse.move(g2.x + 40, g2.y + 120, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  for (const o of before.filter((o) => o.type === 'sticky')) expect(await get(page, o.id)).toMatchObject({ x: o.x, y: o.y });
});

test.describe('Touch', () => {
  test.use({ viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const sessions = new WeakMap<Page, Promise<CDPSession>>();
  const touch = async (page: Page, type: 'touchStart' | 'touchMove' | 'touchEnd', pts: { x: number; y: number }[]) => {
    if (!sessions.has(page)) sessions.set(page, page.context().newCDPSession(page));
    await (await sessions.get(page)!).send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
  };

  test('Drehen mit dem Finger rastet ebenfalls auf 0° ein', async ({ page }) => {
    const [a] = await create(page, [note(-100, -100, { text: 'Finger', rotation: 25 })]);
    await select(page, [a]);
    const c = await mid(page, a);
    const g = await gripCenter(page);
    await touch(page, 'touchStart', [g]);
    for (const t of [20, 15, 10, 4]) await touch(page, 'touchMove', [rotateTarget(g, c, 25, t)]);
    await expect(page.getByTestId('rotate-angle')).toHaveText('0°');
    await page.screenshot({ path: path.join(OUT, 'drehen-touch.png') });
    await touch(page, 'touchEnd', []);
    await expect.poll(async () => (await get(page, a))!.rotation).toBeUndefined();
    // frei drehen geht weiterhin
    const g2 = await gripCenter(page);
    await touch(page, 'touchStart', [g2]);
    for (const t of [10, 20, 33]) await touch(page, 'touchMove', [rotateTarget(g2, c, 0, t)]);
    await touch(page, 'touchEnd', []);
    await expect.poll(async () => (await get(page, a))!.rotation).toBe(33);
  });
});

// ---- 3. Gebogene Pfeile -------------------------------------------------------------------------------------------

test('Pfeile zwischen zwei Notizen sind standardmäßig gebogen, freie Linien gerade, Werkzeug-Wahl gilt', async ({ page }) => {
  const [a, b] = await create(page, [note(-360, -220, { text: 'Idee' }), note(140, 20, { text: 'Umsetzung', color: '#c9e14a' })]);
  // 1) Verbindungspunkt der Notiz ziehen (Andockpunkt rechts) bis auf die andere Notiz
  await page.mouse.move(S(page, -260, -120).x, S(page, -260, -120).y, { steps: 3 });
  const anchor = (await page.locator('[data-handle="anchor-e"]').boundingBox())!;
  await page.mouse.move(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2, { steps: 3 });
  await page.mouse.down();
  for (const [x, y] of [[-60, -100], [100, 40], [240, 120]]) await page.mouse.move(S(page, x, y).x, S(page, x, y).y, { steps: 4 });
  await page.mouse.up();
  let conns = (await objects(page)).filter((o) => o.type === 'connector') as (Obj & Record<string, any>)[];
  expect(conns).toHaveLength(1);
  expect(conns[0]).toMatchObject({ from: { objectId: a }, to: { objectId: b }, lineStyle: 'curved' });
  const pathOf = (id: string) => page.locator(`[data-id="${id}"] svg path:not(.hit)`).first().getAttribute('d');
  expect(await pathOf(conns[0].id)).toContain('C');
  await page.mouse.click(S(page, 0, 330).x, S(page, 0, 330).y);
  await pause(page);
  await page.screenshot({ path: path.join(OUT, 'pfeil-gebogen.png') });

  // Notiz verschieben: Kurve folgt (anderer Pfad, weiter gebogen)
  const d0 = await pathOf(conns[0].id);
  await page.mouse.move(S(page, 240, 120).x, S(page, 240, 120).y);
  await page.mouse.down();
  for (const [x, y] of [[200, 200], [120, 260], [60, 300]]) await page.mouse.move(S(page, x, y).x, S(page, x, y).y, { steps: 4 });
  await page.mouse.up();
  const d1 = await pathOf(conns[0].id);
  expect(d1).not.toBe(d0);
  expect(d1).toContain('C');
  await page.mouse.click(S(page, 300, -300).x, S(page, 300, -300).y);
  await pause(page);
  await page.screenshot({ path: path.join(OUT, 'pfeil-nachgefuehrt.png') });

  // 2) Verbinder-Werkzeug ins Leere: freie Linie bleibt gerade
  await page.keyboard.press('l');
  await page.mouse.move(S(page, 300, -300).x, S(page, 300, -300).y);
  await page.mouse.down();
  await page.mouse.move(S(page, 450, -250).x, S(page, 450, -250).y, { steps: 6 });
  await page.mouse.up();
  conns = (await objects(page)).filter((o) => o.type === 'connector') as (Obj & Record<string, any>)[];
  expect(conns).toHaveLength(2);
  expect(conns[1].lineStyle).toBeUndefined();

  // 3) ausdrücklich „Gerade“ im Werkzeug gewählt → auch zwischen Notizen gerade
  await page.keyboard.press('l');
  await page.getByRole('button', { name: 'Neue Verbinder: Gerade' }).click();
  await expect(page.getByRole('button', { name: 'Neue Verbinder: Gerade' })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(S(page, -260, -120).x, S(page, -260, -120).y);
  await page.mouse.down();
  await page.mouse.move(S(page, 60, 300).x, S(page, 60, 300).y, { steps: 8 });
  await page.mouse.up();
  conns = (await objects(page)).filter((o) => o.type === 'connector') as (Obj & Record<string, any>)[];
  expect(conns).toHaveLength(3);
  expect(conns[2].lineStyle).toBeUndefined();
  // nochmal klicken = wieder automatisch
  await page.keyboard.press('l');
  await page.getByRole('button', { name: 'Neue Verbinder: Gerade' }).click();
  await expect(page.getByRole('button', { name: 'Neue Verbinder: Gerade' })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('v');

  // 4) Plus-Griff: verbundene Kopie, Verbinder geschwungen
  await select(page, [a]);
  await page.locator('[data-handle="add-n"]').click();
  conns = (await objects(page)).filter((o) => o.type === 'connector') as (Obj & Record<string, any>)[];
  expect(conns.at(-1)!.lineStyle).toBe('curved');
});

test('Gebogener Pfeil sieht im Export gleich aus', async ({ page }) => {
  const [a, b] = await create(page, [note(-360, -220, { text: 'Idee' }), note(140, 20, { text: 'Umsetzung' })]);
  await create(page, [{ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: a }, to: { objectId: b }, color: '#0a0a0a', strokeWidth: 2, arrowEnd: true, lineStyle: 'curved' }]);
  await expect.poll(() => page.evaluate(() => !!(window as any).__stachelTools)).toBe(true);
  const svg: string = await page.evaluate(async () => {
    const st = (window as any).__stachel.store.getSnapshot();
    const r = await (window as any).__stachelTools.renderToSvg({ objects: st.ordered, byId: st.byId, rect: { x: -400, y: -260, w: 600, h: 520 }, scale: 1, background: '#ffffff', imageSrc: () => '' });
    return r.svg;
  });
  // derselbe Kurvenpfad wie im Editor
  const live = await page.locator('.obj-connector svg path:not(.hit)').first().getAttribute('d');
  expect(svg).toContain(live!);
  // und kein Pin
  expect(svg).not.toContain("cy='25.6'");
});

// ---- 4. Rechteckige Haftnotizen -----------------------------------------------------------------------------------

test('Rechteckige Notizen: Kontextleiste, Mehrfachauswahl, Werkzeug merkt Form, Tab/Plus/Strg D übernehmen sie', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const [a, b] = await create(page, [note(-300, -200, { text: 'Getränkestand am Eingang mit Kühlwagen' }), note(0, -200, { text: 'Kasse' })]);
  await select(page, [a]);
  await bar(page).getByRole('button', { name: 'Form der Notiz' }).click();
  await pause(page);
  await page.screenshot({ path: path.join(OUT, 'form-menue.png') });
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  // Höhe und Mitte bleiben, Breite im Verhältnis 1,75 : 1
  expect(await get(page, a)).toMatchObject({ x: -375, y: -200, w: 350, h: 200 });
  // Text passt weiterhin in die Notiz (Autofit)
  const fits = (id: string) => page.locator(`[data-id="${id}"] .sticky-text`).evaluate((el) => el.scrollHeight <= el.parentElement!.clientHeight + 1);
  expect(await fits(a)).toBe(true);
  await pause(page);
  await page.screenshot({ path: path.join(OUT, 'rechteck.png') });
  // Undo
  await page.keyboard.press('Control+z');
  expect(await get(page, a)).toMatchObject({ x: -300, w: 200 });
  await page.keyboard.press('Control+y');
  expect(await get(page, a)).toMatchObject({ w: 350 });

  // Mehrfachauswahl: beide quadratisch, dann beide rechteckig
  await select(page, [a, b]);
  await bar(page).getByRole('button', { name: 'Form der Notiz' }).click();
  await page.getByRole('button', { name: 'Quadrat', exact: true }).click();
  expect(await get(page, a)).toMatchObject({ w: 200, h: 200 });
  expect(await get(page, b)).toMatchObject({ w: 200, h: 200 });
  await bar(page).getByRole('button', { name: 'Form der Notiz' }).click();
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  expect(await get(page, b)).toMatchObject({ w: 350, h: 200 });

  // Werkzeug merkt die zuletzt gewählte Form
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  await expect(page.getByRole('button', { name: 'Notizform Rechteck' })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: path.join(OUT, 'werkzeug.png') });
  await page.mouse.click(S(page, 0, 200).x, S(page, 0, 200).y);
  await expect(page.locator('.sticky-text.editing')).toBeFocused();
  await page.keyboard.type('Neu');
  let list = (await objects(page)).filter((o) => o.type === 'sticky');
  expect(list.at(-1)).toMatchObject({ w: 350, h: 200 });
  // Tab beim Schreiben: nächste Notiz daneben, gleiche Form
  await page.keyboard.press('Tab');
  await page.keyboard.type('Weiter');
  await page.keyboard.press('Escape');
  list = (await objects(page)).filter((o) => o.type === 'sticky');
  expect(list).toHaveLength(4);
  expect(list.at(-1)).toMatchObject({ w: 350, h: 200, text: 'Weiter' });
  // Plus-Griff und Strg D
  await select(page, [list.at(-1)!.id]);
  await page.locator('[data-handle="add-s"]').click();
  await page.keyboard.press('Escape');
  list = (await objects(page)).filter((o) => o.type === 'sticky');
  expect(list.at(-1)).toMatchObject({ w: 350, h: 200 });
  const ma = await mid(page, a);
  await page.mouse.click(ma.x, ma.y);
  await page.keyboard.press('Control+d');
  await expect.poll(async () => (await objects(page)).filter((o) => o.type === 'sticky' && o.text?.startsWith('Getränkestand') && o.w === 350).length).toBe(2);
  // Kopieren/Einfügen behält die Form
  const mb = await mid(page, b);
  await page.mouse.click(mb.x, mb.y);
  await page.keyboard.press('Control+c');
  await page.mouse.move(S(page, 300, 300).x, S(page, 300, 300).y);
  await page.keyboard.press('Control+v');
  await expect.poll(async () => (await objects(page)).filter((o) => o.type === 'sticky' && o.text === 'Kasse' && o.w === 350 && o.h === 200).length).toBe(2);
  // Werkzeugleiste: Form wieder auf Quadrat (Esc: sonst tippt „n“ in die eingefügte Notiz)
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  await page.getByRole('button', { name: 'Notizform Quadrat' }).click();
  await page.mouse.click(S(page, -400, 300).x, S(page, -400, 300).y);
  await page.keyboard.press('Escape');
  list = (await objects(page)).filter((o) => o.type === 'sticky');
  expect(list.at(-1)).toMatchObject({ w: 200, h: 200 });
});

test('Seitengriffe ziehen die Notiz frei, Eckgriffe skalieren proportional; Autofit passt sich an', async ({ page }) => {
  const [a] = await create(page, [note(-100, -100, { text: 'Lageplan für Bühne, Bar und Kasse abstimmen' })]);
  await select(page, [a]);
  for (const h of ['n', 'e', 's', 'w', 'nw', 'ne', 'se', 'sw']) await expect(page.locator(`[data-handle="${h}"]`)).toHaveCount(1);
  const fs = () => page.locator(`[data-id="${a}"] .sticky-text`).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const fs0 = await fs();
  // rechter Seitengriff: nur breiter
  const e = (await page.locator('[data-handle="e"]').boundingBox())!;
  await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
  await page.mouse.down();
  await page.mouse.move(e.x + 100, e.y + e.height / 2, { steps: 5 });
  await page.mouse.move(e.x + 200, e.y + e.height / 2, { steps: 5 });
  await page.mouse.up();
  let o = (await get(page, a))!;
  expect(o.h).toBe(200);
  expect(o.w).toBeGreaterThan(380);
  await expect(bar(page).getByRole('button', { name: 'Form der Notiz' })).toBeVisible();
  // unterer Seitengriff: nur höher
  const s = (await page.locator('[data-handle="s"]').boundingBox())!;
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width / 2, s.y + 120, { steps: 6 });
  await page.mouse.up();
  o = (await get(page, a))!;
  expect(o.h).toBeGreaterThan(300);
  const fits = await page.locator(`[data-id="${a}"] .sticky-text`).evaluate((el) => el.scrollHeight <= el.parentElement!.clientHeight + 1);
  expect(fits).toBe(true);
  // Eckgriff: proportional
  const ratio = o.w / o.h;
  const se = (await page.locator('[data-handle="se"]').boundingBox())!;
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(se.x - 60, se.y - 20, { steps: 6 });
  await page.mouse.up();
  const o2 = (await get(page, a))!;
  expect(Math.abs(o2.w / o2.h - ratio)).toBeLessThan(0.03);
  expect(await fs()).toBeGreaterThan(0);
  expect(fs0).toBeGreaterThan(0);
  await pause(page);
  await page.screenshot({ path: path.join(OUT, 'frei.png') });
  // frei → Quadrat über die Kontextleiste: Höhe bleibt
  await bar(page).getByRole('button', { name: 'Form der Notiz' }).click();
  await page.getByRole('button', { name: 'Quadrat', exact: true }).click();
  const o3 = (await get(page, a))!;
  expect(o3.w).toBe(o3.h);
});
