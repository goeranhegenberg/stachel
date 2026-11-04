// Feature-Modul tools: Suche, Export (PNG/PDF), Board-Einstellungen, Raster/Einrasten, Format übertragen,
// Ausblenden, Ebenen, Objekt-Links, Kürzel-Übersicht, Übersicht (Vorschaubilder, Duplizieren, Vorlagen), Handy.
import { expect, test, type Page } from '@playwright/test';
import type { Server } from '@hocuspocus/server';
import fs from 'node:fs';
import path from 'node:path';
import { startSyncServer } from './syncServer';
import { installFakeApi, sampleBoards } from './fakeApi';
import { centerOf, drag, objects, openOffline, selection } from './helpers';

const OUT = path.resolve(import.meta.dirname, '../../docs/screenshots');
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `tools-${name}.png`) });

type Seed = { id: string; type: string; x: number; y: number; w: number; h: number; text?: string; title?: string; color?: string; [k: string]: unknown };

/** Objekte direkt in den Store legen (ein Schritt) und alles einpassen. */
async function seed(page: Page, list: Seed[]) {
  await page.evaluate((objs) => {
    const s = (window as any).__stachel;
    s.store.createMany(objs);
    s.store.stopCapturing();
  }, list);
  // erst nach dem Rendern kennt der Editor den neuen Inhalt
  await page.waitForTimeout(50);
  await page.evaluate(() => (window as any).__stachel.api().fitAll());
  await page.waitForTimeout(150);
}

const FESTIVAL: Seed[] = [
  { id: 'f1', type: 'frame', x: -40, y: -60, w: 760, h: 420, title: 'Bühne Nord' },
  { id: 'n1', type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'Bühnenaufbau Freitag', color: '#fff27a' },
  { id: 'n2', type: 'sticky', x: 240, y: 0, w: 200, h: 200, text: 'Getränke', color: '#c9e14a' },
  { id: 'n3', type: 'sticky', x: 480, y: 0, w: 200, h: 200, text: 'Licht für die Bühne', color: '#ffb3d1' },
  { id: 's1', type: 'shape', shape: 'ellipse', x: 900, y: 40, w: 220, h: 140, text: 'Einlass', color: '#9fd3ff' },
  { id: 't1', type: 'text', x: 0, y: 420, w: 520, h: 40, text: 'Sommerfest – Bühnenplan', fontSize: 32 },
  { id: 'c1', type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: 'n3' }, to: { objectId: 's1' }, color: '#0a0a0a', strokeWidth: 2, arrowEnd: true },
];

test.describe('Editor (offline)', () => {
  test.beforeEach(async ({ page }) => {
    await openOffline(page);
  });

  test('Suche: Strg F, Treffer durchspringen, hervorheben, alle wählen', async ({ page }) => {
    await seed(page, FESTIVAL);
    await page.keyboard.press('Control+f');
    const input = page.getByRole('searchbox', { name: 'Suchbegriff' });
    await expect(input).toBeFocused();
    await input.fill('buhne');
    const count = page.getByTestId('search-count');
    // Rahmentitel, zwei Notizen, ein Text (Umlaut-tolerant)
    await expect(count).toHaveText('1 von 4');
    await expect(page.locator('.tools-search-hit')).toHaveCount(4);
    await expect(page.locator('.tools-search-hit.is-current')).toHaveAttribute('data-hit', 'f1');
    await input.press('Enter');
    await expect(count).toHaveText('2 von 4');
    await expect(page.locator('.tools-search-hit.is-current')).toHaveAttribute('data-hit', 'n1');
    await input.press('Shift+Enter');
    await expect(count).toHaveText('1 von 4');
    await input.press('ArrowDown');
    await input.press('ArrowDown');
    await expect(page.locator('.tools-search-hit.is-current')).toHaveAttribute('data-hit', 'n3');
    await page.waitForTimeout(400);
    await shot(page, 'suche');
    await input.fill('gibtsnicht');
    await expect(count).toHaveText('Keine Treffer');
    await input.fill('getränke');
    await page.getByRole('button', { name: 'Alle wählen' }).click();
    expect(await selection(page)).toEqual(['n2']);
    await expect(page.getByRole('search')).toHaveCount(0);
    // Esc schließt
    await page.keyboard.press('Control+f');
    await expect(input).toBeFocused();
    await input.press('Escape');
    await expect(page.getByRole('search')).toHaveCount(0);
  });

  test('Export: PNG der Auswahl und PDF mit einer Seite je Rahmen', async ({ page }) => {
    await seed(page, [...FESTIVAL, { id: 'f2', type: 'frame', x: 860, y: -60, w: 400, h: 300, title: 'Einlass' }]);
    await page.evaluate(() => (window as any).__stachel.api().setSelection(['n1', 'n2']));
    await page.getByRole('button', { name: 'Board-Menü' }).click();
    await page.getByRole('menuitem', { name: 'Exportieren …' }).click();
    const dialog = page.getByTestId('export-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /Auswahl/ })).toBeChecked();
    await expect(page.getByTestId('export-info')).toHaveText('1.040 × 560 Pixel');
    await page.waitForTimeout(250);
    await shot(page, 'export');
    const [png] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Exportieren' }).click()]);
    expect(png.suggestedFilename()).toBe('Offline-Board.png');
    const buf = fs.readFileSync((await png.path())!);
    expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(buf.readUInt32BE(16)).toBe(1040);
    expect(buf.readUInt32BE(20)).toBe(560);
    fs.writeFileSync(path.join(OUT, 'tools-export-ergebnis.png'), buf);
    // Inhalt wirklich gezeichnet: gelbe Notiz links, grüne rechts, Text dunkel
    const colors = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const px = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
      let dark = 0;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 60 && d[i + 1] < 60 && d[i + 2] < 60) dark++;
      return { yellow: px(110, 400), green: px(590, 400), dark };
    }, buf.toString('base64'));
    expect(colors.yellow).toEqual([255, 242, 122]);
    expect(colors.green).toEqual([201, 225, 74]);
    expect(colors.dark).toBeGreaterThan(500);

    // PDF: alle Rahmen
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Board-Menü' }).click();
    await page.getByRole('menuitem', { name: 'Exportieren …' }).click();
    await dialog.getByRole('radio', { name: /PDF/ }).click();
    await dialog.getByRole('radio', { name: /Alle Rahmen/ }).check();
    await expect(page.getByTestId('export-info')).toHaveText('2 Seiten');
    const [pdf] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Exportieren' }).click()]);
    expect(pdf.suggestedFilename()).toBe('Offline-Board.pdf');
    const text = fs.readFileSync((await pdf.path())!).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(text).toContain('/Filter /FlateDecode');
  });

  test('Rahmen exportieren über das Kontextmenü', async ({ page }) => {
    await seed(page, FESTIVAL);
    const title = page.locator('.ov-frame-title[data-id="f1"]');
    const box = (await title.boundingBox())!;
    await page.mouse.click(box.x + 20, box.y + box.height / 2, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Rahmen exportieren …' }).click();
    const dialog = page.getByTestId('export-dialog');
    await expect(dialog.getByRole('radio', { name: /^Rahmen/ })).toBeChecked();
    await expect(page.getByTestId('export-info')).toHaveText('1.520 × 840 Pixel');
    const [png] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Exportieren' }).click()]);
    expect(png.suggestedFilename()).toBe('Offline-Board – Bühne Nord.png');
  });

  test('Kontextmenü: Ausschneiden, Rückgängig/Wiederholen, Hintergrund auf leerer Fläche', async ({ page }) => {
    await seed(page, FESTIVAL);
    const p = await centerOf(page, 'n2');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Ausschneiden' }).click();
    await expect(page.locator('[data-id="n2"]')).toHaveCount(0);
    // leere Fläche unter dem Text
    const t = (await page.locator('[data-id="t1"]').boundingBox())!;
    await page.mouse.click(t.x + t.width / 2, t.y + t.height + 120, { button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Wiederholen' })).toBeDisabled();
    await page.waitForTimeout(150);
    await shot(page, 'kontextmenue-flaeche');
    await page.getByRole('menuitem', { name: 'Rückgängig' }).click();
    await expect(page.locator('[data-id="n2"]')).toHaveCount(1);
    await page.mouse.click(t.x + t.width / 2, t.y + t.height + 120, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Wiederholen' }).click();
    await expect(page.locator('[data-id="n2"]')).toHaveCount(0);
    await page.mouse.click(t.x + t.width / 2, t.y + t.height + 120, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Hintergrund & Raster …' }).click();
    await expect(page.getByTestId('settings-dialog')).toBeVisible();
  });

  test('Board-Einstellungen: Linien, Hintergrundfarbe, Raster ein/aus (für alle im Dokument)', async ({ page }) => {
    await seed(page, FESTIVAL);
    const board = page.getByTestId('board');
    await expect(board).not.toHaveAttribute('data-tools-pattern');
    await page.getByRole('button', { name: 'Board-Menü' }).click();
    await page.getByRole('menuitem', { name: 'Board-Einstellungen …' }).click();
    const dialog = page.getByTestId('settings-dialog');
    await dialog.getByRole('radio', { name: 'Linien' }).click();
    await expect(board).toHaveAttribute('data-tools-pattern', 'lines');
    await page.waitForTimeout(250);
    await shot(page, 'einstellungen');
    await dialog.getByRole('radio', { name: 'Farbe Eisblau' }).click();
    const settings = await page.evaluate(() => (window as any).__stachel.store.extMap('tools.settings').toJSON());
    expect(settings).toMatchObject({ pattern: 'lines', color: '#e9f1f8' });
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="board"]')!).backgroundColor)).toBe('rgb(233, 241, 248)');
    await dialog.getByRole('button', { name: 'Fertig' }).click();
    await page.waitForTimeout(200);
    await shot(page, 'hintergrund');
    // Strg ' schaltet das Raster aus und wieder auf Linien
    await page.keyboard.press("Control+'");
    await expect(board).toHaveAttribute('data-tools-pattern', 'none');
    await page.keyboard.press("Control+'");
    await expect(board).toHaveAttribute('data-tools-pattern', 'lines');
    // Einstellungen sind kein Rückgängig-Schritt
    await page.keyboard.press('Control+z');
    await expect(board).toHaveAttribute('data-tools-pattern', 'lines');
  });

  test('Einrasten am Raster beim Ziehen (Pfeiltasten bleiben pixelgenau)', async ({ page }) => {
    await seed(page, [{ id: 'g1', type: 'sticky', x: 5, y: 7, w: 200, h: 200, text: 'Raster' }]);
    await page.evaluate(() => (window as any).__stachel.setCamera({ x: 300, y: 200, z: 1 }));
    await page.getByRole('button', { name: 'Board-Menü' }).click();
    await expect(page.getByRole('menuitem', { name: /Am Raster einrasten/ })).toContainText('Aus');
    await page.getByRole('menuitem', { name: /Am Raster einrasten/ }).click();
    const c = await centerOf(page, 'g1');
    await drag(page, c, { x: c.x + 61, y: c.y + 33 });
    let o = (await objects(page)).find((x) => x.id === 'g1')!;
    expect(o.x % 24).toBe(0);
    expect(o.y % 24).toBe(0);
    expect(o.x).toBe(72);
    expect(o.y).toBe(48);
    await page.keyboard.press('ArrowRight');
    o = (await objects(page)).find((x) => x.id === 'g1')!;
    expect(o.x).toBe(73);
    // Einstellung bleibt nach dem Neuladen (nur in diesem Browser)
    await page.reload();
    await page.waitForFunction(() => (window as any).__stachel?.store);
    await page.getByRole('button', { name: 'Board-Menü' }).click();
    await expect(page.getByRole('menuitem', { name: /Am Raster einrasten/ })).toContainText('An');
  });

  test('Format übertragen: Pinsel und Strg Alt C / V', async ({ page }) => {
    await seed(page, [
      { id: 'a', type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'Vorbild', color: '#ffb3d1', bold: true, align: 'left' },
      { id: 'b', type: 'sticky', x: 260, y: 0, w: 200, h: 200, text: 'Ziel 1' },
      { id: 'c', type: 'shape', shape: 'rect', x: 520, y: 0, w: 200, h: 200, text: 'Ziel 2', color: '#ffffff' },
      { id: 'd', type: 'text', x: 0, y: 260, w: 300, h: 40, text: 'Ziel 3', fontSize: 24 },
    ]);
    await page.locator('[data-id="a"]').click();
    await page.getByRole('button', { name: 'Format übertragen' }).click();
    await expect(page.getByTestId('painter-layer')).toBeVisible();
    await page.waitForTimeout(200);
    await shot(page, 'format-pinsel');
    for (const id of ['b', 'c']) {
      const p = await centerOf(page, id);
      await page.mouse.click(p.x, p.y);
    }
    let list = await objects(page);
    expect(list.find((o) => o.id === 'b')).toMatchObject({ color: '#ffb3d1', bold: true, align: 'left' });
    expect(list.find((o) => o.id === 'c')).toMatchObject({ color: '#ffb3d1', bold: true });
    // Klick ins Leere beendet den Pinsel
    const empty = await page.evaluate(() => {
      const api = (window as any).__stachel.api();
      const p = api.toScreen({ x: 600, y: 420 });
      return { x: p.x, y: p.y, hit: (document.elementFromPoint(p.x, p.y) as HTMLElement | null)?.dataset?.testid };
    });
    expect(empty.hit).toBe('painter-layer');
    await page.mouse.click(empty.x, empty.y);
    await expect(page.getByTestId('painter-layer')).toHaveCount(0);
    // Rückgängig nimmt eine Übertragung zurück
    await page.keyboard.press('Control+z');
    list = await objects(page);
    expect((list.find((o) => o.id === 'c') as any).color).toBe('#ffffff');

    // Kürzel: Format kopieren und einfügen (Text bekommt nur das Textformat)
    await page.locator('[data-id="a"]').click();
    await page.keyboard.press('Control+Alt+c');
    await page.keyboard.press('Escape');
    await page.locator('[data-id="d"]').click();
    await page.keyboard.press('Control+Alt+v');
    const d = (await objects(page)).find((o) => o.id === 'd') as any;
    expect(d.bold).toBe(true);
    expect(d.color).toBeUndefined();
  });

  test('Ausblenden, Ausgeblendete zeigen, alle einblenden', async ({ page }) => {
    await seed(page, FESTIVAL);
    const n2 = page.locator('[data-id="n2"]');
    const p = await centerOf(page, 'n2');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Ausblenden' }).click();
    await expect(n2).toHaveCSS('visibility', 'hidden');
    expect(await selection(page)).toEqual([]);
    // Klick auf die Stelle trifft nichts; Strg A wählt Ausgeblendetes nicht
    await page.mouse.click(p.x, p.y);
    expect(await selection(page)).toEqual([]);
    await page.keyboard.press('Control+a');
    await expect.poll(() => selection(page)).not.toContain('n2');
    await page.keyboard.press('Escape');
    // Suche findet es nicht
    await page.keyboard.press('Control+f');
    await page.getByRole('searchbox', { name: 'Suchbegriff' }).fill('Getränke');
    await expect(page.getByTestId('search-count')).toHaveText('Keine Treffer');
    await page.keyboard.press('Escape');
    // Board-Menü: zeigen (blass) und alle einblenden
    await page.getByRole('button', { name: 'Board-Menü' }).click();
    await page.getByRole('menuitem', { name: 'Ausgeblendete zeigen (1)' }).click();
    await expect(n2).toHaveCSS('visibility', 'visible');
    await expect(n2).toHaveCSS('opacity', '0.38');
    await page.waitForTimeout(200);
    await shot(page, 'ausgeblendet');
    await page.getByRole('button', { name: 'Board-Menü' }).click();
    await page.getByRole('menuitem', { name: 'Alle einblenden' }).click();
    await expect(n2).toHaveCSS('opacity', '1');
    expect((await objects(page)).find((o) => o.id === 'n2')).not.toHaveProperty('hidden');
    // Kürzel Strg Umschalt H
    await n2.click();
    await page.keyboard.press('Control+Shift+h');
    expect((await objects(page)).find((o) => o.id === 'n2')).toHaveProperty('hidden', true);
  });

  test('Ebenen schrittweise, Sperren per Kürzel', async ({ page }) => {
    await seed(page, [
      { id: 'u', type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'Unten' },
      { id: 'm', type: 'sticky', x: 60, y: 60, w: 200, h: 200, text: 'Mitte', color: '#c9e14a' },
      { id: 'o', type: 'sticky', x: 120, y: 120, w: 200, h: 200, text: 'Oben', color: '#9fd3ff' },
    ]);
    const order = async () => (await objects(page)).map((o) => o.id).join('');
    expect(await order()).toBe('umo');
    await page.evaluate(() => (window as any).__stachel.api().setSelection(['u']));
    await page.keyboard.press('Control+]');
    expect(await order()).toBe('muo');
    await page.keyboard.press('Control+]');
    expect(await order()).toBe('mou');
    await page.keyboard.press('Control+[');
    expect(await order()).toBe('muo');
    // Menü
    const p = await centerOf(page, 'o');
    await page.mouse.click(p.x + 60, p.y + 60, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Ebene' }).hover();
    await page.getByRole('menuitem', { name: 'Eine Ebene nach hinten' }).click();
    expect(await order()).toBe('mou');
    // Sperren
    await page.keyboard.press('Control+Shift+l');
    expect((await objects(page)).find((o) => o.id === 'o')!.locked).toBe(true);
    await page.keyboard.press('Control+Shift+l');
    expect((await objects(page)).find((o) => o.id === 'o')!.locked).toBeUndefined();
  });

  test('Link kopieren und Objekt-Link öffnen', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seed(page, FESTIVAL);
    const p = await centerOf(page, 'n3');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await page.waitForTimeout(150);
    await shot(page, 'kontextmenue');
    await page.getByRole('menuitem', { name: 'Link kopieren' }).click();
    await expect(page.locator('.toast')).toHaveText('Link zum Objekt kopiert.');
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/\/\?offline=1&o=n3$/);
    // Objekt-Link im Demo-Board: Kamera fährt hin, Objekt ist ausgewählt, `o` verschwindet aus der Adresse
    await page.goto('/?offline=1&demo=1&o=demo-s4');
    await page.waitForFunction(() => (window as any).__stachel?.getSelection);
    await expect.poll(() => selection(page)).toEqual(['demo-s4']);
    await expect.poll(() => page.evaluate(() => location.search)).toBe('?offline=1&demo=1');
    await expect(page.locator('[data-id="demo-s4"]')).toBeInViewport();
  });

  test('Kürzel-Übersicht mit Filter', async ({ page }) => {
    await page.keyboard.press('?');
    const dlg = page.getByRole('dialog', { name: 'Tastenkürzel' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByText('Auf dem Board suchen')).toBeVisible();
    await expect(dlg.getByText('Eine Ebene nach vorne / hinten')).toBeVisible();
    await page.waitForTimeout(250);
    await shot(page, 'kuerzel');
    await dlg.getByRole('searchbox', { name: 'Kürzel suchen' }).fill('raster');
    await expect(dlg.locator('dd')).toHaveText(['Raster ein/aus']);
    await dlg.getByRole('searchbox', { name: 'Kürzel suchen' }).fill('xyz');
    await expect(dlg.getByText('Kein Kürzel passt')).toBeVisible();
  });
});

test.describe('Handy', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('Anmeldung: Passwort zuerst, dann „In der App öffnen“ statt QR', async ({ page }) => {
    const state = await installFakeApi(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Benutzername & Passwort' })).toBeInViewport();
    await expect(page.getByRole('img', { name: 'QR-Code zum Anmelden' })).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(state.qrStarts).toBe(0);
    await page.getByRole('button', { name: /Mit der Musterverein-App/ }).click();
    const open = page.getByTestId('open-app');
    await expect(open).toHaveAttribute('href', /\/qr\/[\w-]+$/);
    await expect(open).toHaveAttribute('target', '_blank');
    expect(state.qrStarts).toBe(1);
    await expect(page.getByText('Stachel am Computer offen?')).toBeVisible();
    await expect(page.getByRole('img', { name: 'QR-Code zum Anmelden' })).toHaveCount(0);
    await open.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot(page, 'handy-anmeldung');
    // Bestätigt die App, meldet sich die Seite von selbst an
    state.approveNext = true;
    await expect(page.getByRole('heading', { name: 'Boards' })).toBeVisible({ timeout: 10_000 });
  });

  test('Tablet: auch Passwort zuerst, QR nur auf Wunsch', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await installFakeApi(page);
    await page.goto('/');
    await page.getByRole('button', { name: /Mit der Musterverein-App/ }).click();
    await expect(page.getByTestId('open-app')).toBeVisible();
    await page.waitForTimeout(400);
    await shot(page, 'tablet-anmeldung');
    await page.getByRole('button', { name: 'QR-Code hier zeigen' }).click();
    await expect(page.getByRole('img', { name: 'QR-Code zum Anmelden' })).toBeVisible();
  });

  test('Editor: große Touch-Ziele, Werkzeugleiste unten, langes Drücken = Menü', async ({ page }) => {
    await openOffline(page);
    await seed(page, FESTIVAL.slice(0, 4));
    const tb = page.locator('.toolbar');
    const tbBox = (await tb.boundingBox())!;
    expect(tbBox.y + tbBox.height).toBeGreaterThan(844 - 80);
    for (const b of await page.locator('.toolbar > .tb-btn').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44 - 0.5); // Subpixel-Rundung (43,99)
    // langes Drücken auf eine Notiz
    const p = await centerOf(page, 'n2');
    // wie editor.spec: Touch-Zeigerereignisse (500 ms halten)
    await page.evaluate(async ({ x, y }) => {
      const el = document.elementFromPoint(x, y)!;
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 31, pointerType: 'touch', isPrimary: true, buttons: 1 }));
      await new Promise((r) => setTimeout(r, 650));
      document.querySelector('[data-testid="board"]')!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 31, pointerType: 'touch', isPrimary: true }));
    }, p);
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Link kopieren' })).toBeVisible();
    for (const it of await menu.getByRole('menuitem').all()) expect((await it.boundingBox())!.height).toBeGreaterThanOrEqual(44 - 0.5); // Subpixel-Rundung (43,99)
    const mb = (await menu.boundingBox())!;
    expect(mb.y + mb.height).toBeLessThanOrEqual(844);
    await page.waitForTimeout(200);
    await shot(page, 'handy-menue');
    await page.keyboard.press('Escape');
    // Suche über das Board-Menü
    await page.getByRole('button', { name: 'Board-Menü' }).tap();
    await page.getByRole('menuitem', { name: 'Auf dem Board suchen' }).tap();
    await page.getByRole('searchbox', { name: 'Suchbegriff' }).fill('bühne');
    await expect(page.getByTestId('search-count')).toHaveText('1 von 3');
    await page.waitForTimeout(400);
    await shot(page, 'handy-suche');
  });
});

test.describe('Board-Übersicht', () => {
  const THUMB = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP8/5+BgYGBAQAH/wH/VFk5JQAAAABJRU5ErkJggg==',
    'base64',
  );

  test('Vorschaubilder vom Server, Duplizieren, Vorlage speichern und daraus ein Board anlegen', async ({ page }) => {
    const boards = sampleBoards();
    boards[0] = { ...boards[0], thumbnailAt: '2026-10-23T10:00:00.000Z' } as any;
    const state = await installFakeApi(page, { loggedIn: true, boards });
    const thumbs: string[] = [];
    await page.route('**/api/boards/*/thumbnail*', (route) => {
      thumbs.push(new URL(route.request().url()).pathname + new URL(route.request().url()).search);
      return route.fulfill({ status: 200, contentType: 'image/png', body: THUMB });
    });
    const dupes: { id: string; body: any }[] = [];
    let n = 0;
    await page.route('**/api/boards/*/duplicate', async (route) => {
      const id = route.request().url().split('/').at(-2)!;
      const body = route.request().postDataJSON();
      dupes.push({ id, body });
      const src = state.boards.find((b) => b.id === id)!;
      const board = {
        ...src,
        id: `copy${++n}`,
        title: body.title ?? (body.template || (src as any).template ? src.title : `${src.title} (Kopie)`),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...(body.template ? { template: true } : { template: undefined }),
      };
      state.boards.push(board as any);
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, board }) });
    });
    await page.goto('/');
    await expect(page.locator('.board-card__title')).toHaveCount(5);
    await expect(page.getByTestId('board-thumb-server')).toHaveCount(1);
    expect(thumbs[0]).toBe(`/api/boards/${boards[0].id}/thumbnail?v=2026-10-23T10%3A00%3A00.000Z`);

    // Duplizieren
    const first = page.locator('.board-card').filter({ has: page.locator('.board-card__title', { hasText: new RegExp(`^${boards[1].title}$`) }) });
    await first.getByRole('button', { name: 'Board-Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Duplizieren' }).click();
    await expect(page.locator('.board-card__title').filter({ hasText: `${boards[1].title} (Kopie)` })).toHaveCount(1);
    expect(dupes[0]).toEqual({ id: boards[1].id, body: { template: false } });

    // Als Vorlage speichern → Vorlagen-Leiste, nicht im Raster
    await first.getByRole('button', { name: 'Board-Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Als Vorlage speichern' }).click();
    const tpl = page.locator('.tools-tpl');
    await expect(tpl.locator('.tools-tpl__name')).toHaveText([boards[1].title]);
    await expect(page.locator('.board-card__title')).toHaveCount(6);
    await page.waitForTimeout(500);
    await shot(page, 'uebersicht');

    // Vorlage verwenden
    await tpl.getByRole('button', { name: /Verwenden/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Board aus Vorlage' });
    await expect(dlg.getByRole('radio', { name: boards[1].title })).toHaveAttribute('aria-checked', 'true');
    await dlg.getByLabel('Name').fill('Neuer Plan');
    await page.waitForTimeout(200);
    await shot(page, 'neues-board-vorlage');
    await dlg.getByRole('button', { name: 'Anlegen' }).click();
    await expect.poll(() => page.evaluate(() => location.search)).toBe('?b=copy3');
    expect(dupes[2]).toEqual({ id: 'copy2', body: { title: 'Neuer Plan' } });
  });
});

test.describe('Vorschaubild hochladen (echter Sync)', () => {
  let server: Server;
  let syncPort = 0;
  test.beforeAll(async () => {
    ({ server, port: syncPort } = await startSyncServer());
  });
  test.afterAll(async () => {
    await server?.destroy();
  });

  test('nach Änderungen wird ein Bild per PUT gespeichert', async ({ page, context }) => {
    await context.addCookies([{ name: 'stachel_session', value: 'sess', domain: 'localhost', path: '/' }]);
    await installFakeApi(page, { loggedIn: true, boards: sampleBoards(), syncPort });
    const puts: { type: string; size: number; body: Buffer }[] = [];
    await page.route('**/api/boards/*/thumbnail', (route) => {
      const req = route.request();
      if (req.method() !== 'PUT') return route.fallback();
      const body = req.postDataBuffer()!;
      puts.push({ type: req.headers()['content-type'], size: body.length, body });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, thumbnailAt: new Date().toISOString() }) });
    });
    await page.goto('/?b=b-plan');
    await expect(page.getByTestId('status')).toHaveText('Live');
    // Notiz anlegen (Werkzeug)
    await page.keyboard.press('n');
    await page.mouse.click(700, 400);
    await page.keyboard.type('Vorschau');
    await page.keyboard.press('Escape');
    await expect.poll(() => puts.length, { timeout: 15_000 }).toBeGreaterThan(0);
    const last = puts.at(-1)!;
    expect(last.type).toBe('image/webp');
    expect(last.body.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(last.size).toBeGreaterThan(500);
    fs.writeFileSync(path.join(OUT, 'tools-vorschaubild.webp'), last.body);
  });

  test('Board-Menü: Board duplizieren und als Vorlage speichern', async ({ page, context }) => {
    await context.addCookies([{ name: 'stachel_session', value: 'sess', domain: 'localhost', path: '/' }]);
    const state = await installFakeApi(page, { loggedIn: true, boards: sampleBoards(), syncPort });
    const dupes: { id: string; body: any }[] = [];
    await page.route('**/api/boards/*/duplicate', (route) => {
      const id = route.request().url().split('/').at(-2)!;
      const body = route.request().postDataJSON();
      dupes.push({ id, body });
      const src = state.boards.find((b) => b.id === id)!;
      const now = new Date().toISOString();
      const board = { ...src, id: `kopie${dupes.length}`, title: body.template ? src.title : `${src.title} (Kopie)`, createdAt: now, updatedAt: now, ...(body.template ? { template: true } : {}) };
      state.boards.push(board as any);
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, board }) });
    });
    await page.goto('/?b=b-plan');
    await expect(page.getByTestId('status')).toHaveText('Live');
    await page.getByRole('button', { name: 'Board-Menü' }).click();
    await page.waitForTimeout(150);
    await shot(page, 'board-menue');
    await page.getByRole('menuitem', { name: 'Als Vorlage speichern' }).click();
    await expect(page.getByText('Als Vorlage gespeichert.', { exact: false })).toBeVisible();
    expect(dupes[0]).toEqual({ id: 'b-plan', body: { template: true } });
    await page.getByRole('button', { name: 'Board-Menü' }).click();
    await page.getByRole('menuitem', { name: 'Board duplizieren' }).click();
    await expect.poll(() => page.evaluate(() => location.search)).toBe('?b=kopie2');
    expect(dupes[1]).toEqual({ id: 'b-plan', body: { template: false } });
    await expect(page.getByTestId('board-title')).toContainText('(Kopie)');
  });
});
