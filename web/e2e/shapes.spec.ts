// Modul „shapes“: Formen-Bibliothek, Füllung/Rand/Deckkraft, Verbinder (Spitzen, Beschriftung, Andockpunkte,
// Schnell-Verbinden am Plus), Sticker/Stempel und Icons. Start: PW_PORT=5192 npx playwright test shapes
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { drag, objects, openOffline, selection, type Obj } from './helpers';

const SHOTS = path.resolve(import.meta.dirname, '../../docs/screenshots');

/** Objekte direkt im Store anlegen (Weltkoordinaten; bei Kamera 100 % liegt (0,0) in der Bildmitte 720/450). */
const create = (page: Page, list: Record<string, unknown>[]): Promise<string[]> => page.evaluate((l) => (window as any).__stachel.store.createMany(l), list);
const setCam = (page: Page, c: { x: number; y: number; z: number }) => page.evaluate((c) => (window as any).__stachel.setCamera(c), c);
const S = (x: number, y: number) => ({ x: x + 720, y: y + 450 });
const get = async (page: Page, id: string) => (await objects(page)).find((o) => o.id === id) as (Obj & Record<string, any>) | undefined;
const shape = (x: number, y: number, extra: Record<string, unknown> = {}) => ({ type: 'shape', shape: 'rect', x, y, w: 180, h: 110, color: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2, text: '', fontSize: 20, ...extra });
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Auswahl bearbeiten' });

async function shot(page: Page, name: string) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `shapes-${name}.png`) });
}

/**
 * Aufwärmen: lädt einmal alle erst bei Bedarf geladenen Module (Icon-Bibliothek, Text-Bearbeitung), damit der
 * Vite-Dev-Server neu entdeckte Abhängigkeiten nicht mitten in einem Test vorbündelt und die Seite neu lädt.
 */
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  for (let i = 0; i < 4; i++) {
    await openOffline(page);
    const ok = await page.evaluate(async () => {
      try {
        await import('/src/features/shapes/iconSet.ts' as string);
        const st = (window as any).__stachel;
        const [id] = st.store.createMany([{ type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 60, text: '' }]);
        st.api().startEditing(st.store.get(id));
        return true;
      } catch {
        return false;
      }
    });
    const editing = ok && (await page.locator('.editing').first().waitFor({ timeout: 4000 }).then(() => true, () => false));
    if (editing) break;
    await page.waitForTimeout(1500);
  }
  await page.close();
});

test.beforeEach(async ({ page }) => {
  await openOffline(page);
  await page.evaluate(() => document.fonts.ready);
});

test('Alle Formen der Bibliothek werden gezeichnet', async ({ page }) => {
  const kinds = await page.evaluate(() => (window as any).__stachel.ext.shapeKinds.list().map((k: any) => k.kind));
  expect(kinds.length).toBeGreaterThanOrEqual(40);
  for (const k of ['roundrect', 'pentagon', 'hexagon', 'octagon', 'star', 'parallelogram', 'trapezoid', 'cylinder', 'cloud', 'callout', 'arrowLeft', 'arrowRight', 'arrowUp', 'arrowDown', 'cross', 'heart', 'braceLeft', 'terminator', 'document', 'multiDocument', 'display', 'or'])
    expect(kinds).toContain(k);
  const list = kinds.map((k: string, i: number) => shape((i % 9) * 190, Math.floor(i / 9) * 160, { shape: k, text: '', w: 150, h: 115, color: i % 3 === 0 ? '#c9e14a' : i % 3 === 1 ? '#ffffff' : '#9fd3ff' }));
  const ids = await create(page, list);
  await setCam(page, { x: 130, y: 115, z: 0.74 });
  for (const id of ids) {
    const d = await page.locator(`[data-id="${id}"] .shape-svg path`).getAttribute('d');
    expect(d, id).toMatch(/^M[\d.\- ]+/);
    expect(d).not.toContain('NaN');
  }
  // Klammer ohne Füllung
  await expect(page.locator('[data-shape="braceLeft"] .shape-svg path')).toHaveAttribute('fill', 'none');
  await shot(page, 'alle-formen');
});

test('Formen-Werkzeug: Untermenü, Bibliothek mit Suche, Klicken und Hineinziehen', async ({ page }) => {
  await page.keyboard.press('s');
  const fly = page.getByRole('group', { name: 'Werkzeug-Optionen' });
  await expect(fly.getByRole('button', { name: 'Stern' })).toBeVisible();
  await fly.getByRole('button', { name: 'Stern' }).click();
  await page.mouse.click(S(-300, -150).x, S(-300, -150).y);
  let list = await objects(page);
  expect(list.at(-1)).toMatchObject({ type: 'shape', shape: 'star', w: 160, h: 152 });

  // Bibliothek: Suche „daten“ findet Daten, Datenbank und Gespeicherte Daten
  await page.keyboard.press('Escape');
  await page.keyboard.press('s');
  await fly.getByRole('button', { name: 'Alle Formen' }).click();
  const side = page.getByRole('complementary', { name: 'Bibliothek' });
  await expect(side).toBeVisible();
  await expect(side.getByRole('heading', { name: 'Flussdiagramm' })).toBeVisible();
  await shot(page, 'bibliothek');
  await side.getByRole('searchbox', { name: 'Formen suchen' }).fill('daten');
  await expect(side.locator('.shapes-tile')).toHaveCount(3);
  await side.getByRole('button', { name: 'Datenbank' }).click();
  await expect(page.locator('[data-tool="shape"]')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(S(0, -150).x, S(0, -150).y);
  list = await objects(page);
  expect(list.at(-1)).toMatchObject({ shape: 'cylinder', w: 120, h: 140 });

  // Ziehen aus der Bibliothek legt an der Ablagestelle an
  await side.getByRole('searchbox', { name: 'Formen suchen' }).fill('sechs');
  const tile = (await side.getByRole('button', { name: 'Sechseck' }).boundingBox())!;
  await drag(page, { x: tile.x + tile.width / 2, y: tile.y + tile.height / 2 }, S(-250, 150), 16);
  const hex = (await objects(page)).at(-1)!;
  expect(hex).toMatchObject({ shape: 'hexagon', w: 170, h: 145 });
  expect(Math.round(hex.x + hex.w / 2)).toBeCloseTo(-250, -1);
  expect(Math.round(hex.y + hex.h / 2)).toBeCloseTo(150, -1);
  expect(await selection(page)).toEqual([hex.id]);

  // Kürzel: O = Kreis, R = Rechteck (Esc im Suchfeld: leeren, dann verlassen)
  await side.getByRole('searchbox', { name: 'Formen suchen' }).focus();
  await page.keyboard.press('Escape');
  await expect(side.getByRole('searchbox', { name: 'Formen suchen' })).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(side.getByRole('searchbox', { name: 'Formen suchen' })).not.toBeFocused();
  await page.mouse.click(S(450, 300).x, S(450, 300).y);
  await page.keyboard.press('o');
  await page.mouse.click(S(300, -150).x, S(300, -150).y);
  expect((await objects(page)).at(-1)).toMatchObject({ shape: 'ellipse', w: 140, h: 140 });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('r');
  await expect(page.locator('[data-tool="shape"]')).toHaveAttribute('aria-pressed', 'true');
});

test('Kontextleiste der Form: Form wechseln, Füllfarbe, Deckkraft, Rand gepunktet', async ({ page }) => {
  const [id] = await create(page, [shape(-90, -55, { text: 'Bühne' })]);
  await page.mouse.click(S(0, 0).x, S(0, 0).y);
  await bar(page).getByRole('button', { name: 'Form', exact: true }).click();
  await bar(page).getByRole('searchbox', { name: 'Form suchen' }).fill('wolke');
  await bar(page).getByRole('button', { name: 'Wolke' }).click();
  expect((await get(page, id))!.shape).toBe('cloud');

  await bar(page).getByRole('button', { name: 'Füllfarbe', exact: true }).click();
  await bar(page).getByRole('button', { name: 'Füllfarbe Mint' }).click();
  const slider = bar(page).getByRole('slider', { name: 'Deckkraft' });
  await slider.fill('40');
  expect(await get(page, id)).toMatchObject({ color: '#b9ecd8', fillOpacity: 0.4 });
  await expect(page.locator(`[data-id="${id}"] .shape-svg path`)).toHaveAttribute('fill-opacity', '0.4');
  await shot(page, 'fuellung');

  await bar(page).getByRole('button', { name: 'Rand', exact: true }).click();
  await bar(page).getByRole('button', { name: 'Randfarbe Blau' }).click();
  await bar(page).getByRole('button', { name: 'Randstärke 4' }).click();
  await bar(page).getByRole('button', { name: 'Gepunktet' }).click();
  expect(await get(page, id)).toMatchObject({ stroke: '#1763b5', strokeWidth: 4, dash: 'dotted' });
  await expect(page.locator(`[data-id="${id}"] .shape-svg path`)).toHaveAttribute('stroke-dasharray', /^0 /);
  await shot(page, 'rand');
  // ein Schritt zurück: Randart wieder durchgezogen
  await page.keyboard.press('Escape');
  await page.mouse.click(S(400, 300).x, S(400, 300).y);
  await page.keyboard.press('Control+z');
  expect((await get(page, id))!.dash).toBeUndefined();
});

test('Verbinder: Spitzen an beiden Enden, Richtung umkehren, Beschriftung verschieben', async ({ page }) => {
  const [a, b] = await create(page, [shape(-420, -55, { text: 'Einlass' }), shape(240, -55, { text: 'Bühne', shape: 'roundrect' })]);
  const [c] = await create(page, [{ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: a }, to: { objectId: b }, color: '#0a0a0a', strokeWidth: 2, arrowEnd: true, text: 'Weg' }]);
  await page.mouse.click(S(-100, 0).x, S(-100, 0).y);
  expect(await selection(page)).toEqual([c]);
  // Bedienung wie bisher (Kern-Kontextleiste): Linienart, Pfeil am Anfang, Linie, Stärke
  await bar(page).getByRole('button', { name: 'Linienart' }).click();
  await bar(page).getByRole('button', { name: 'Gewinkelt' }).click();
  await bar(page).getByRole('button', { name: 'Pfeil am Anfang' }).click();
  await bar(page).getByRole('button', { name: 'Linie', exact: true }).click();
  await bar(page).getByRole('button', { name: 'Gepunktet' }).click();
  await bar(page).getByRole('button', { name: 'Linienstärke' }).click();
  await bar(page).getByRole('button', { name: 'Linienstärke 4' }).click();
  expect(await get(page, c)).toMatchObject({ lineStyle: 'elbow', arrowStart: true, arrowEnd: true, dash: 'dotted', strokeWidth: 4 });
  await bar(page).getByRole('button', { name: 'Linie', exact: true }).click();
  await bar(page).getByRole('button', { name: 'Durchgezogen' }).click();
  await bar(page).getByRole('button', { name: 'Linienart' }).click();
  await bar(page).getByRole('button', { name: 'Gerade' }).click();
  await bar(page).getByRole('button', { name: 'Linienstärke' }).click();
  await bar(page).getByRole('button', { name: 'Linienstärke 2' }).click();
  // Spitzen-Arten
  await bar(page).getByRole('button', { name: 'Spitze am Ende wählen' }).click();
  await bar(page).getByRole('button', { name: 'Kreis leer' }).click();
  await bar(page).getByRole('button', { name: 'Spitze am Anfang wählen' }).click();
  await bar(page).getByRole('button', { name: 'Raute', exact: true }).click();
  expect(await get(page, c)).toMatchObject({ capEnd: 'circleOpen', arrowEnd: true, capStart: 'diamond', arrowStart: true });
  await expect(page.locator(`[data-id="${c}"] circle`)).toHaveCount(1);
  await expect(page.locator(`[data-id="${c}"] polygon`)).toHaveCount(1);
  await shot(page, 'spitzen');
  // Pfeil am Ende aus- und wieder einschalten behält die gewählte Form der anderen Seite bei
  await bar(page).getByRole('button', { name: 'Pfeil am Ende' }).click();
  expect(await get(page, c)).toMatchObject({ arrowEnd: false });
  await expect(page.locator(`[data-id="${c}"] circle`)).toHaveCount(0);

  // Richtung umkehren
  await bar(page).getByRole('button', { name: 'Richtung umkehren' }).click();
  const r = (await get(page, c))!;
  expect(r.from).toEqual({ objectId: b });
  expect(r.to).toEqual({ objectId: a });
  expect(r.capEnd).toBe('diamond');
  expect(r.arrowStart).toBeUndefined();

  // Beschriftung entlang der Linie ziehen
  const label = page.locator(`[data-id="${c}"] .conn-label`);
  const lb = (await label.boundingBox())!;
  await drag(page, { x: lb.x + lb.width / 2, y: lb.y + lb.height / 2 }, { x: lb.x + lb.width / 2 + 150, y: lb.y + 60 }, 10);
  // nach dem Umkehren läuft die Linie von rechts nach links: weiter rechts = kleineres t
  const pos = (await get(page, c))!.labelPos;
  expect(pos).toBeLessThan(0.4);
  const lb2 = (await label.boundingBox())!;
  expect(lb2.x).toBeGreaterThan(lb.x + 100);
  expect(Math.abs(lb2.y - lb.y)).toBeLessThan(4); // bleibt auf der Linie
  expect(await selection(page)).toEqual([c]);
  await shot(page, 'verbinder');
  // ein Undo-Schritt nimmt das Verschieben zurück
  await page.keyboard.press('Control+z');
  expect((await get(page, c))!.labelPos).toBeUndefined();
});

test('Doppelklick auf die Linie setzt die Beschriftung an die Klickstelle', async ({ page }) => {
  const [a, b] = await create(page, [shape(-500, -55), shape(320, -55)]);
  const [c] = await create(page, [{ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: a }, to: { objectId: b }, color: '#0a0a0a', strokeWidth: 2, arrowEnd: true }]);
  await page.mouse.dblclick(S(-200, 0).x, S(-200, 0).y);
  // Eingabefeld der Text-Engine (Klartext bzw. Rich-Text)
  await expect(page.locator('.overlay .editing, .overlay [contenteditable="true"], .overlay textarea').first()).toBeFocused();
  await page.keyboard.type('Ja');
  await page.keyboard.press('Escape');
  const o = (await get(page, c))!;
  expect(o.text).toBe('Ja');
  expect(o.labelPos).toBeLessThan(0.4);
  const lb = (await page.locator(`[data-id="${c}"] .conn-label`).boundingBox())!;
  expect(Math.abs(lb.x + lb.width / 2 - S(-200, 0).x)).toBeLessThan(8);
});

test('Plus-Griff ziehen: Verbinder und gleiche Form an der Ablagestelle; Andockpunkte beim Ziehen', async ({ page }) => {
  const [a, target] = await create(page, [shape(-400, -55, { shape: 'hexagon', w: 170, h: 145, color: '#c9e14a', text: 'Idee' }), shape(250, 150)]);
  await page.mouse.click(S(-315, 0).x, S(-315, 0).y);
  const plus = (await page.locator('[data-handle="add-e"]').boundingBox())!;
  // ins Leere ziehen: Geister-Form und neue Form mit Verbinder
  await page.mouse.move(plus.x + plus.width / 2, plus.y + plus.height / 2);
  await page.mouse.down();
  await page.mouse.move(S(0, -150).x, S(0, -150).y, { steps: 10 });
  await expect(page.locator('.shapes-ghost')).toHaveCount(1);
  await shot(page, 'schnellverbinden');
  await page.mouse.up();
  let list = await objects(page);
  const made = list.find((o) => o.type === 'shape' && o.id !== a && o.id !== target)! as Obj & Record<string, any>;
  expect(made).toMatchObject({ shape: 'hexagon', w: 170, h: 145, color: '#c9e14a', text: '' });
  expect(made.x + made.w / 2).toBeCloseTo(0, -1);
  const conn = list.find((o) => o.type === 'connector')!;
  expect(conn.from).toEqual({ objectId: a, side: 'e' });
  expect(conn.to).toMatchObject({ objectId: made.id });
  await expect(page.locator('.shape-text.editing')).toBeFocused();
  await page.keyboard.type('Neu');
  await page.keyboard.press('Escape');
  expect((await get(page, made.id))!.text).toBe('Neu');

  // Ziehen zu einem anderen Objekt: dessen Andockpunkte erscheinen, Einrasten setzt die Seite
  await page.mouse.click(S(-315, 0).x, S(-315, 0).y);
  const plusS = (await page.locator('[data-handle="add-s"]').boundingBox())!;
  await page.mouse.move(plusS.x + plusS.width / 2, plusS.y + plusS.height / 2);
  await page.mouse.down();
  await page.mouse.move(S(330, 160).x, S(330, 160).y, { steps: 8 });
  await expect(page.locator('.shapes-dot')).not.toHaveCount(0);
  // linker Andockpunkt der Zielform (x=250, Mitte y=205)
  await page.mouse.move(S(252, 205).x, S(252, 205).y, { steps: 6 });
  await expect(page.locator('.shapes-dot.is-on')).toHaveCount(1);
  await page.mouse.up();
  list = await objects(page);
  const c2 = list.filter((o) => o.type === 'connector').at(-1)!;
  expect(c2.from).toEqual({ objectId: a, side: 's' });
  expect(c2.to).toEqual({ objectId: target, side: 'w' });
  expect(list.filter((o) => o.type === 'shape')).toHaveLength(3);
});

test('Verbinder-Werkzeug: Voreinstellung gewinkelt mit offener Pfeilspitze', async ({ page }) => {
  await create(page, [shape(-400, -55), shape(250, 100)]);
  await page.keyboard.press('l');
  const fly = page.getByRole('group', { name: 'Werkzeug-Optionen' });
  await fly.getByRole('button', { name: 'Neue Verbinder: Gewinkelt' }).click();
  await fly.getByRole('button', { name: 'Spitze: Pfeil' }).click();
  await shot(page, 'verbinder-werkzeug');
  // Andockpunkte erscheinen schon beim Überfahren
  await page.mouse.move(S(-310, 0).x, S(-310, 0).y, { steps: 3 });
  await expect(page.locator('.shapes-layer .shapes-dot')).toHaveCount(4);
  await drag(page, S(-310, 0), S(340, 155));
  const c = (await objects(page)).find((o) => o.type === 'connector')! as Obj & Record<string, any>;
  expect(c).toMatchObject({ lineStyle: 'elbow', capEnd: 'arrow', arrowEnd: true });
  await expect(page.locator(`[data-id="${c.id}"] polyline`)).toHaveCount(1);
});

test('Sticker: Stempel mehrfach setzen, Emoji suchen und platzieren', async ({ page }) => {
  await page.locator('[data-tool="shapes.sticker"]').click();
  const fly = page.getByRole('group', { name: 'Werkzeug-Optionen' });
  await fly.getByRole('button', { name: 'Stempel Herz' }).click();
  await shot(page, 'sticker-werkzeug');
  await page.mouse.click(S(-200, -100).x, S(-200, -100).y);
  await page.mouse.click(S(-100, -100).x, S(-100, -100).y);
  let list = await objects(page);
  expect(list.filter((o) => o.type === 'sticker')).toHaveLength(2);
  expect(list[0]).toMatchObject({ type: 'sticker', stamp: 'heart', w: 72, h: 72, x: -236, y: -136 });
  // Werkzeug bleibt aktiv (mehrfach stempeln)
  await expect(page.locator('[data-tool="shapes.sticker"]')).toHaveAttribute('aria-pressed', 'true');

  await fly.getByRole('button', { name: 'Alle Sticker und Icons' }).click();
  const side = page.getByRole('complementary', { name: 'Bibliothek' });
  await expect(side.getByRole('tab', { name: 'Sticker' })).toHaveAttribute('aria-selected', 'true');
  await side.getByRole('searchbox').fill('kaktus');
  await side.getByRole('button', { name: 'Emoji 🌵' }).click();
  await page.mouse.click(S(100, -100).x, S(100, -100).y);
  list = await objects(page);
  expect(list.at(-1)).toMatchObject({ type: 'sticker', emoji: '🌵', w: 96, h: 96 });
  expect(await selection(page)).toEqual([list.at(-1)!.id]);
  await expect(page.locator(`[data-id="${list.at(-1)!.id}"]`)).toHaveText('🌵');
  // alle Stempel nebeneinander fürs Bild
  await page.evaluate(() => {
    const ids = ['like', 'heart', 'check', 'question', 'plusOne', 'star', 'exclaim', 'dislike'];
    (window as any).__stachel.store.createMany(ids.map((stamp, i) => ({ type: 'sticker', stamp, x: -330 + i * 86, y: 60, w: 72, h: 72 })));
  });
  await page.keyboard.press('Escape');
  await shot(page, 'sticker');
});

test('Icons: Bibliothek lädt bei Bedarf, Suche, Platzieren, Farbe und Strich', async ({ page }) => {
  await page.locator('[data-tool="shapes.sticker"]').click();
  await page.getByRole('group', { name: 'Werkzeug-Optionen' }).getByRole('button', { name: 'Alle Sticker und Icons' }).click();
  const side = page.getByRole('complementary', { name: 'Bibliothek' });
  await side.getByRole('tab', { name: 'Icons' }).click();
  await expect(side.getByRole('heading', { name: 'Festival & Kultur' })).toBeVisible();
  await side.getByRole('searchbox', { name: 'Icons suchen' }).fill('zelt');
  const tile = (await side.getByRole('button', { name: 'Icon Zelt' }).boundingBox())!;
  await drag(page, { x: tile.x + tile.width / 2, y: tile.y + tile.height / 2 }, S(0, 0), 14);
  const icon = (await objects(page)).at(-1)! as Obj & Record<string, any>;
  expect(icon).toMatchObject({ type: 'icon', icon: 'tent', w: 64, h: 64, x: -32, y: -32 });
  expect(Array.isArray(icon.iconNode)).toBe(true);
  await expect(page.locator(`[data-id="${icon.id}"] svg path`).first()).toBeVisible();
  // Farbe über die normale Farbwahl, Strichstärke eigene Gruppe
  await bar(page).getByRole('button', { name: 'Farbe', exact: true }).click();
  await bar(page).getByRole('button', { name: 'Farbe Pink' }).click();
  await bar(page).getByRole('button', { name: 'Strichstärke 3' }).click();
  expect(await get(page, icon.id)).toMatchObject({ color: '#ec4e92', strokeWidth: 3 });
  await side.getByRole('searchbox', { name: 'Icons suchen' }).fill('');
  // ein paar Icons in Stachel-Farben fürs Bild
  await page.evaluate(() => {
    const st = (window as any).__stachel;
    const tent = st.store.getSnapshot().ordered.find((o: any) => o.type === 'icon');
    const colors = ['#1763b5', '#7aa21b', '#0a0a0a', '#e8590c'];
    st.store.createMany(colors.map((color, i) => ({ ...tent, id: undefined, z: undefined, x: -300 + i * 90, y: 120, color, strokeWidth: undefined })));
  });
  await page.mouse.click(S(-200, -250).x, S(-200, -250).y);
  await shot(page, 'icons');
});

test('Icon-Zeichnung aus dem Dokument wird abgesichert', async ({ page }) => {
  const [id] = await create(page, [
    {
      type: 'icon',
      icon: 'boese',
      x: -32,
      y: -32,
      w: 64,
      h: 64,
      iconNode: [
        ['path', { d: 'M4 4L20 20', onload: 'alert(1)' }],
        ['script', { src: 'x' }],
        ['image', { href: 'javascript:alert(1)' }],
        ['circle', { cx: 12, cy: 12, r: 'url(javascript:1)' }],
      ],
    },
  ]);
  const el = page.locator(`[data-id="${id}"] svg`);
  await expect(el.locator('path')).toHaveCount(1);
  expect(await el.locator('path').getAttribute('onload')).toBeNull();
  await expect(el.locator('script, image')).toHaveCount(0);
  expect(await el.locator('circle').getAttribute('r')).toBeNull();
});

test('Handy: Bibliothek als Blatt von unten, Antippen wählt, Tippen aufs Board legt an', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await openOffline(page);
  await page.evaluate(() => (window as any).__stachel.api().openSidebar('shapes.library'));
  const side = page.getByRole('complementary', { name: 'Bibliothek' });
  await expect(side).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, 'shapes-handy-bibliothek.png') });
  const box = (await side.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await side.getByRole('button', { name: 'Sprechblase' }).tap();
  // am Handy schließt das Blatt, das Formen-Werkzeug ist aktiv
  await expect(side).toHaveCount(0);
  await page.touchscreen.tap(195, 300);
  const list = await objects(page);
  expect(list.at(-1)).toMatchObject({ type: 'shape', shape: 'callout' });
  await ctx.close();
});

test('Flussdiagramm: Formen, gewinkelte Verbinder mit runden Ecken, Beschriftungen und Spitzen', async ({ page }) => {
  const f = (id: string, kind: string, x: number, y: number, w: number, h: number, text: string, extra: Record<string, unknown> = {}) => ({ id, ...shape(x, y, { shape: kind, w, h, text, ...extra }) });
  const c = (id: string, from: string, to: string, extra: Record<string, unknown> = {}) => ({ id, type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: from }, to: { objectId: to }, color: '#0a0a0a', strokeWidth: 2, arrowEnd: true, lineStyle: 'elbow', ...extra });
  await create(page, [
    f('start', 'terminator', -560, -250, 180, 70, 'Anfrage', { color: '#c9e14a' }),
    f('doc', 'document', -560, -110, 180, 110, 'Antrag'),
    f('dec', 'diamond', -200, -135, 200, 150, 'Platz frei?', { color: '#fff27a' }),
    f('db', 'cylinder', 160, -280, 130, 150, 'Standplan', { color: '#9fd3ff' }),
    f('ok', 'roundrect', 140, 30, 200, 100, 'Zusagen', { color: '#ffffff', fillOpacity: 1 }),
    f('no', 'callout', -230, 120, 220, 130, 'Warteliste', { color: '#ffb3d1' }),
    f('end', 'terminator', 430, 45, 170, 70, 'Fertig', { color: '#0a0a0a' }),
    f('idea', 'cloud', 380, -270, 200, 130, 'Ideen', { color: '#e2d5ff', dash: 'dotted' }),
    c('c1', 'start', 'doc', { lineStyle: undefined }),
    c('c2', 'doc', 'dec'),
    c('c3', 'dec', 'ok', { text: 'ja' }),
    c('c4', 'dec', 'no', { text: 'nein', color: '#ec4e92', capEnd: 'circle' }),
    c('c5', 'ok', 'end', { lineStyle: 'curved', capEnd: 'arrow' }),
    c('c6', 'db', 'ok', { dash: 'dashed', capStart: 'diamondOpen', arrowStart: true, capEnd: 'triangleOpen', color: '#1763b5' }),
    c('c7', 'idea', 'db', { lineStyle: 'curved', dash: 'dotted', capEnd: 'bar', color: '#7048e8' }),
  ]);
  await setCam(page, { x: 720, y: 470, z: 1 });
  // runde Ecken im gezeichneten Pfad, Trefferpfad bleibt eckig
  expect(await page.locator('[data-id="c3"] path:not(.hit)').getAttribute('d')).toContain('Q');
  expect(await page.locator('[data-id="c3"] path.hit').getAttribute('d')).not.toContain('Q');
  await expect(page.locator('[data-id="c7"] line')).toHaveCount(1);
  await shot(page, 'flussdiagramm');
});

test('Aus dem Andockpunkt ins Leere gezogen: Form am Linienende anhängen', async ({ page }) => {
  const [a] = await create(page, [shape(-400, -55, { text: 'Kasse', color: '#9fd3ff' })]);
  await page.mouse.move(S(-310, 0).x, S(-310, 0).y, { steps: 3 });
  const anchor = (await page.locator('[data-handle="anchor-e"]').boundingBox())!;
  await drag(page, { x: anchor.x + 6, y: anchor.y + 6 }, S(60, 0));
  const picker = page.getByRole('group', { name: 'Form anhängen' });
  await expect(picker).toBeVisible();
  await shot(page, 'anhaengen');
  await picker.getByRole('button', { name: 'Raute' }).click();
  const list = await objects(page);
  const made = list.find((o) => o.type === 'shape' && o.id !== a)! as Obj & Record<string, any>;
  expect(made).toMatchObject({ shape: 'diamond', w: 180, h: 130 });
  // Linienende sitzt an der linken Kante der neuen Form
  expect(made.x).toBeGreaterThan(40);
  expect(made.x).toBeLessThan(80);
  const conn = list.find((o) => o.type === 'connector')!;
  expect(conn.from).toEqual({ objectId: a, side: 'e' });
  expect(conn.to).toEqual({ objectId: made.id });
  await expect(picker).toHaveCount(0);
  await page.keyboard.press('Escape');
  // ein Undo-Schritt nimmt Form und Umhängen zurück
  await page.mouse.click(S(400, 300).x, S(400, 300).y);
  await page.keyboard.press('Control+z');
  const after = await objects(page);
  expect(after.find((o) => o.id === made.id)).toBeUndefined();
  expect(after.find((o) => o.type === 'connector')!.to).toEqual({ x: 60, y: 0 });
});

test('Verbinder-Ende umhängen: Andockpunkte erscheinen, Einrasten setzt die Seite, Esc bricht ab', async ({ page }) => {
  const [a, b, c2] = await create(page, [shape(-460, -55, { text: 'Kasse' }), shape(200, -260, { text: 'Bar' }), shape(200, 150, { text: 'Bühne' })]);
  const [c] = await create(page, [{ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: a }, to: { objectId: b }, color: '#0a0a0a', strokeWidth: 2, arrowEnd: true }]);
  // Verbinder auswählen (Linienmitte)
  const conn = await page.evaluate((id) => (window as any).__stachel.api().bounds((window as any).__stachel.store.get(id)), c);
  await page.mouse.click(S(conn.x + conn.w / 2, conn.y + conn.h / 2).x, S(conn.x + conn.w / 2, conn.y + conn.h / 2).y);
  expect(await selection(page)).toEqual([c]);
  const end = (await page.locator('[data-handle="to"]').boundingBox())!;
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
  await page.mouse.down();
  // zur Bühne: deren Andockpunkte erscheinen, der obere rastet ein
  await page.mouse.move(S(290, 120).x, S(290, 120).y, { steps: 8 });
  await expect(page.locator('.shapes-dot')).not.toHaveCount(0);
  await page.mouse.move(S(291, 152).x, S(291, 152).y, { steps: 4 });
  await expect(page.locator('.shapes-dot.is-on')).toHaveCount(1);
  await shot(page, 'ende-umhaengen');
  await page.mouse.up();
  expect((await get(page, c))!.to).toEqual({ objectId: c2, side: 'n' });
  await expect(page.locator('.shapes-dot')).toHaveCount(0);
  // ein Undo-Schritt
  await page.keyboard.press('Control+z');
  expect((await get(page, c))!.to).toEqual({ objectId: b });
  // ins Leere ziehen: freies Ende; Esc mitten im Ziehen nimmt alles zurück
  await page.keyboard.press('Control+y');
  const end2 = (await page.locator('[data-handle="to"]').boundingBox())!;
  await page.mouse.move(end2.x + end2.width / 2, end2.y + end2.height / 2);
  await page.mouse.down();
  await page.mouse.move(S(0, 330).x, S(0, 330).y, { steps: 6 });
  expect((await get(page, c))!.to).toEqual({ x: 0, y: 330 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await get(page, c))!.to).toEqual({ objectId: c2, side: 'n' });
  expect(await selection(page)).toEqual([c]);
});

test('Neue Formen aus der Bibliothek: Suche findet Flussdiagramm-Formen', async ({ page }) => {
  await page.keyboard.press('s');
  await page.getByRole('group', { name: 'Werkzeug-Optionen' }).getByRole('button', { name: 'Alle Formen' }).click();
  const side = page.getByRole('complementary', { name: 'Bibliothek' });
  const search = side.getByRole('searchbox', { name: 'Formen suchen' });
  await search.fill('dokument');
  await expect(side.getByRole('button', { name: 'Mehrere Dokumente' })).toBeVisible();
  await search.fill('');
  await side.getByRole('heading', { name: 'Flussdiagramm' }).scrollIntoViewIfNeeded();
  await shot(page, 'flussdiagramm-formen');
  await search.fill('pfeil');
  await expect(side.getByRole('button', { name: 'Pfeil oben' })).toBeVisible();
  await side.getByRole('button', { name: 'Pfeil oben' }).click();
  await page.mouse.click(S(0, 0).x, S(0, 0).y);
  expect((await objects(page)).at(-1)).toMatchObject({ type: 'shape', shape: 'arrowUp', w: 100, h: 190 });
});
