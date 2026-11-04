// Darstellung: Formate, Drehung, Verbinder-Arten, Detailstufen, Bilder, Rahmen, gleichzeitiges Bearbeiten.
// Erzeugt die Screenshots docs/screenshots/rendering-*.png.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { camera, openOffline } from './helpers';

const OUT = path.resolve(import.meta.dirname, '../../docs/screenshots');
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `rendering-${name}.png`) });

/** Objekte direkt über den Store anlegen (wie ein fremder Client), IDs bleiben lesbar. */
const create = (page: Page, list: Record<string, unknown>[]) => page.evaluate((l) => (window as any).__stachel.store.createMany(l), list);
const setCam = (page: Page, c: { x: number; y: number; z: number }) => page.evaluate((c) => (window as any).__stachel.setCamera(c), c);
const css = (page: Page, sel: string, prop: string) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test.beforeEach(async ({ page }) => {
  await openOffline(page);
  await page.evaluate(() => document.fonts.ready);
});

test('Formate und Drehung bei Haftnotiz, Text und Form', async ({ page }) => {
  await create(page, [
    { id: 's1', type: 'sticky', x: 0, y: 0, w: 200, h: 200, color: '#fff27a', text: 'Fett und oben links', bold: true, align: 'left', valign: 'top' },
    { id: 's2', type: 'sticky', x: 240, y: 0, w: 200, h: 200, color: '#ffb3d1', text: 'Kursiv unten', italic: true, valign: 'bottom' },
    { id: 's3', type: 'sticky', x: 480, y: 0, w: 200, h: 200, color: '#9fd3ff', text: 'Schräg gepinnt', rotation: -6 },
    { id: 't1', type: 'text', x: 0, y: 250, w: 520, h: 40, fontSize: 28, text: 'Erledigt: Bühnenplan', strike: true, italic: true, color: '#0a0a0a' },
    { id: 't2', type: 'text', x: 0, y: 300, w: 520, h: 40, fontSize: 28, text: 'Rechtsbündig fett', bold: true, align: 'right', color: '#1763b5' },
    { id: 'f1', type: 'shape', shape: 'rect', x: 0, y: 380, w: 220, h: 120, color: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2, dash: 'dashed', text: 'Gestrichelt', fontSize: 20 },
    { id: 'f2', type: 'shape', shape: 'ellipse', x: 260, y: 380, w: 200, h: 120, color: '#c9e14a', stroke: '#0a0a0a', strokeWidth: 0, text: 'Ohne Rand, oben', fontSize: 20, valign: 'top' },
    { id: 'f3', type: 'shape', shape: 'diamond', x: 500, y: 360, w: 180, h: 160, color: '#ffffff', stroke: '#ec4e92', strokeWidth: 3, text: 'Gedreht', fontSize: 20, rotation: 20, bold: true },
  ]);
  await setCam(page, { x: 380, y: 170, z: 1 });

  // Text-Format
  expect(await css(page, '[data-id="s1"] .sticky-text', 'font-weight')).toBe('700');
  expect(await css(page, '[data-id="s1"] .sticky-text', 'text-align')).toBe('left');
  expect(await css(page, '[data-id="s1"] .sticky-body', 'align-items')).toBe('flex-start');
  expect(await css(page, '[data-id="s2"] .sticky-text', 'font-style')).toBe('italic');
  expect(await css(page, '[data-id="s2"] .sticky-body', 'align-items')).toBe('flex-end');
  expect(await css(page, '[data-id="t1"] .text-content', 'text-decoration-line')).toBe('line-through');
  expect(await css(page, '[data-id="t2"] .text-content', 'text-align')).toBe('right');
  expect(await css(page, '[data-id="f2"] .shape-text-wrap', 'align-items')).toBe('flex-start');
  // Fett gemessen: Text passt in die Notiz
  const fits = await page.locator('[data-id="s1"] .sticky-text').evaluate((el) => el.scrollHeight <= el.parentElement!.clientHeight + 1);
  expect(fits).toBe(true);
  // Rand gestrichelt bzw. ohne Rand
  await expect(page.locator('[data-id="f1"] path')).toHaveAttribute('stroke-dasharray', /\d/);
  await expect(page.locator('[data-id="f2"] path')).toHaveAttribute('stroke', 'none');
  // Drehung um die Mitte: Mittelpunkt bleibt, Box wird größer
  const box = (await page.locator('[data-id="f3"]').boundingBox())!;
  expect(box.x + box.width / 2).toBeCloseTo(380 + 590, 0);
  expect(box.y + box.height / 2).toBeCloseTo(170 + 440, 0);
  expect(box.width).toBeGreaterThan(190);
  await shot(page, 'formate');
});

test('Verbinder: gerade, gewinkelt, geschwungen mit Beschriftung', async ({ page }) => {
  const shape = (id: string, x: number, y: number, text: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'shape',
    shape: 'rect',
    x,
    y,
    w: 180,
    h: 90,
    color: '#ffffff',
    stroke: '#0a0a0a',
    strokeWidth: 2,
    text,
    fontSize: 20,
    ...extra,
  });
  const conn = (id: string, from: string, to: string, extra: Record<string, unknown>) => ({
    id,
    type: 'connector',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    from: { objectId: from },
    to: { objectId: to },
    color: '#0a0a0a',
    strokeWidth: 2,
    arrowEnd: true,
    ...extra,
  });
  await create(page, [
    shape('a', 0, 0, 'Anfrage'),
    shape('b', 320, 0, 'Prüfen', { shape: 'diamond', color: '#c9e14a', h: 110, y: -10 }),
    shape('c', 680, 180, 'Zusage'),
    shape('d', 320, 260, 'Absage', { color: '#ffb3d1' }),
    shape('e', 0, 300, 'Archiv', { shape: 'ellipse' }),
    conn('c1', 'a', 'b', { lineStyle: 'straight' }),
    conn('c2', 'b', 'c', { lineStyle: 'elbow', text: 'ja' }),
    conn('c3', 'b', 'd', { lineStyle: 'elbow', text: 'nein', color: '#ec4e92' }),
    conn('c4', 'd', 'e', { lineStyle: 'curved', dash: 'dashed', arrowStart: true, color: '#1763b5' }),
    conn('c5', 'e', 'a', { lineStyle: 'curved', dash: 'dotted', strokeWidth: 3 }),
  ]);
  await setCam(page, { x: 300, y: 260, z: 1 });

  const d = (id: string) => page.locator(`[data-id="${id}"] path:not(.hit)`).getAttribute('d');
  const hit = (id: string) => page.locator(`[data-id="${id}"] path.hit`).getAttribute('d');
  // gewinkelt: nur waagerechte/senkrechte Stücke
  const elbow = (await hit('c2'))!;
  const pts = [...elbow.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  expect(pts.length).toBeGreaterThanOrEqual(3);
  for (let i = 1; i < pts.length; i++) expect(pts[i][0] === pts[i - 1][0] || pts[i][1] === pts[i - 1][1]).toBe(true);
  // geschwungen: Bézierkurve, gestrichelt, Pfeil an beiden Enden
  expect(await d('c4')).toMatch(/C/);
  await expect(page.locator('[data-id="c4"] path:not(.hit)')).toHaveAttribute('stroke-dasharray', /\d/);
  await expect(page.locator('[data-id="c4"] polygon')).toHaveCount(2);
  await expect(page.locator('[data-id="c5"] path.is-dotted')).toHaveCount(1);
  // Trefferpfad folgt dem gezeichneten Pfad (gleicher Typ)
  expect((await hit('c4'))!.includes('C')).toBe(true);
  // Beschriftung mit weißem Hintergrund in der Mitte
  const label = page.locator('[data-id="c2"] .conn-label');
  await expect(label).toHaveText('ja');
  expect(await label.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
  // Klick auf die gewinkelte Linie wählt den Verbinder
  const box = (await page.locator('[data-id="c3"] .conn-label').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => page.evaluate(() => (window as any).__stachel.getSelection())).toEqual(['c3']);
  await page.keyboard.press('Escape');
  await shot(page, 'verbinder');
});

test('Detailstufen: weit herausgezoomt nur Flächen, Rahmen mit großem Titel', async ({ page }) => {
  await create(page, [
    { id: 'fr1', type: 'frame', x: -200, y: -200, w: 4000, h: 2400, title: 'Lageplan', color: '#ffffff' },
    { id: 'fr2', type: 'frame', x: 4100, y: -200, w: 2600, h: 2400, title: 'Ideen', color: '#ffffff' },
  ]);
  await page.evaluate(() => (window as any).__stachel.seedMany(400));
  await page.getByRole('button', { name: 'Alles einpassen' }).click();
  const z = (await camera(page)).z;
  expect(z).toBeLessThan(0.25);
  // alle Notizen als einfache Flächen: kein Text
  await expect(page.locator('.obj-lod--sticky')).toHaveCount(400);
  await expect(page.locator('.obj-sticky')).toHaveCount(0);
  await expect(page.locator('.sticky-text')).toHaveCount(0);
  // Rahmen: großer Titel mittig, kleine Titel der Overlay-Ebene ausgeblendet
  await expect(page.locator('.frame-big-title[data-id="fr1"]')).toHaveText('Lageplan');
  await expect(page.locator('.ov-frame-title').first()).toBeHidden();
  // Rahmen hat einen sichtbaren Rand
  expect(await css(page, '[data-id="fr1"] .frame-body', 'border-top-style')).toBe('solid');
  await shot(page, 'uebersicht');
  // Hineinzoomen: volle Darstellung, kleine Titel wieder da
  await page.getByTestId('zoom-value').click();
  await page.getByRole('menuitem', { name: /^100 %/ }).click();
  await expect(page.locator('.obj-sticky').first()).toBeVisible();
  await expect(page.locator('.obj-lod')).toHaveCount(0);
  await expect(page.locator('.frame-big-title')).toHaveCount(0);
});

test('Bilder: Platzhalter bei Fehler, Fläche in Durchschnittsfarbe beim Herauszoomen', async ({ page }) => {
  const imageId = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 90;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ec4e92';
    ctx.fillRect(0, 0, 160, 90);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
    const img = await (window as any).__stachel.session.uploadImage(new File([blob], 'pink.png', { type: 'image/png' }));
    return img.imageId as string;
  });
  await create(page, [
    { id: 'i1', type: 'image', x: 0, y: 0, w: 480, h: 270, imageId },
    { id: 'i2', type: 'image', x: 540, y: 0, w: 480, h: 270, imageId: 'gibt-es-nicht' },
  ]);
  await setCam(page, { x: 200, y: 300, z: 1 });
  const img = page.locator('[data-id="i1"] img');
  await expect(img).toHaveAttribute('loading', 'lazy');
  await expect(img).toHaveAttribute('decoding', 'async');
  await expect(img).not.toHaveClass(/is-loading/);
  await expect(page.locator('[data-id="i2"]')).toContainText('Bild nicht verfügbar');
  await shot(page, 'bilder');
  // unter 25 %: Fläche in der Durchschnittsfarbe statt <img>
  await setCam(page, { x: 600, y: 400, z: 0.2 });
  await expect(page.locator('[data-id="i1"] img')).toHaveCount(0);
  expect(await css(page, '[data-id="i1"] .image-fill', 'background-color')).toBe('rgb(236, 78, 146)');
  // sehr klein: nur noch einfache Fläche
  await setCam(page, { x: 600, y: 400, z: 0.1 });
  await expect(page.locator('[data-id="i1"].obj-lod')).toHaveCount(1);
});

test('Text: Darstellung nie größer als h, Höhe wird beim Auswählen nachgemessen', async ({ page }) => {
  await create(page, [{ id: 't', type: 'text', x: 0, y: 0, w: 200, h: 30, fontSize: 24, text: 'Eine lange Zeile, die umbrechen muss und höher wird als gespeichert', color: '#0a0a0a' }]);
  await setCam(page, { x: 300, y: 300, z: 1 });
  const box = (await page.locator('[data-id="t"]').boundingBox())!;
  expect(box.height).toBeCloseTo(30, 0);
  // nicht ausgewählt: h bleibt (kein Schreiben fremder Objekte)
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).__stachel.store.get('t').h)).toBe(30);
  // ausgewählt: gemessene Höhe wird übernommen
  await page.mouse.click(310, 312);
  await expect.poll(() => page.evaluate(() => (window as any).__stachel.store.get('t').h)).toBeGreaterThan(90);
});

test('Gleichzeitiges Bearbeiten: Hinweis und fremder Text bleibt erhalten', async ({ page }) => {
  await create(page, [{ id: 'n', type: 'sticky', x: 0, y: 0, w: 200, h: 200, color: '#fff27a', text: '' }]);
  await setCam(page, { x: 600, y: 350, z: 1 });
  await page.mouse.dblclick(700, 450);
  await expect(page.locator('.sticky-text.editing')).toBeFocused();
  await page.keyboard.type('Bühne');
  // fremde Änderung am Rich-Text (anderer Origin, wie ein zweiter Client): neuer Absatz am Ende
  await page.evaluate(() => {
    const s = (window as any).__stachel.store;
    const frag = s.objects.get('n').get('content');
    const El = frag.get(0).constructor;
    const Txt = frag.get(0).get(0).constructor;
    s.doc.transact(() => {
      const p = new El('paragraph');
      const t = new Txt();
      t.insert(0, 'Bar ab 18 Uhr');
      p.insert(0, [t]);
      frag.insert(frag.length, [p]);
    }, 'remote');
  });
  await expect(page.locator('.remote-hint')).toContainText('Wird gerade auch von');
  await shot(page, 'gleichzeitig');
  await page.keyboard.type(' Nord');
  await page.keyboard.press('Escape');
  await expect(page.locator('.remote-hint')).toHaveCount(0);
  const text = await page.evaluate(() => (window as any).__stachel.store.get('n').text);
  expect(text).toBe('Bühne Nord\nBar ab 18 Uhr');
});

test('Minimap: Verbinder und Rahmentitel, Einklappen, Sichtbereich relativ ziehen', async ({ page }) => {
  await page.goto('/?offline=1&demo=1');
  await page.waitForFunction(() => (window as any).__stachel?.store);
  const map = page.getByRole('img', { name: 'Übersichtskarte' });
  await expect(map).toBeVisible();
  await page.waitForTimeout(300);
  // Ausschnitt der Karte: Verbinder (pink) und Rahmentitel sind gezeichnet
  const hasPink = await map.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 120 && d[i + 2] > 110 && d[i + 2] < 190) return true;
    return false;
  });
  expect(hasPink).toBe(true);
  await page.locator('.minimap').screenshot({ path: path.join(OUT, 'rendering-minimap.png') });

  // Ziehen am blauen Rechteck: Ansicht wandert relativ (kein Sprung zum Klickpunkt)
  const before = await camera(page);
  const box = (await map.boundingBox())!;
  // nach dem Einpassen liegt die Kartenmitte im Sichtbereich: dort greifen und 10 px nach rechts ziehen
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const mid = await camera(page);
  expect(Math.abs(mid.x - before.x)).toBeLessThan(1); // Greifen allein verschiebt nichts
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  const after = await camera(page);
  expect(after.x).toBeLessThan(before.x); // Sicht nach rechts → Kamera-x kleiner
  expect(Math.abs(after.y - before.y)).toBeLessThan(2);

  // Einklappen bleibt nach dem Neuladen erhalten
  await page.getByRole('button', { name: 'Übersicht ausblenden' }).click();
  await expect(map).toHaveCount(0);
  await page.reload();
  await page.waitForFunction(() => (window as any).__stachel?.store);
  await expect(page.getByRole('button', { name: 'Übersicht einblenden' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Übersichtskarte' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Übersicht einblenden' }).click();
  await expect(page.getByRole('img', { name: 'Übersichtskarte' })).toBeVisible();
});

test.describe('Handy', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  test('Minimap ist eingeklappt verfügbar', async ({ page }) => {
    await page.goto('/?offline=1&demo=1');
    await page.waitForFunction(() => (window as any).__stachel?.store);
    const btn = page.getByRole('button', { name: 'Übersicht einblenden' });
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.getByRole('img', { name: 'Übersichtskarte' })).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'rendering-handy-minimap.png') });
  });
});
