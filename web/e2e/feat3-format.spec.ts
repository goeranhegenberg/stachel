// Runde 3 (feat3): Format-Leiste am Handy ohne Wischen (über der Bildschirmtastatur), Textmarker-Werkzeug am Stift.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { objects, openOffline } from './helpers';

const OUT = path.resolve(import.meta.dirname, '../test-results/feat3');
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

const editing = (page: Page) => page.locator('.rt.editing');
const bar = (page: Page) => page.getByTestId('richtext-bar');

async function add(page: Page, obj: Record<string, unknown>): Promise<string> {
  return page.evaluate((o) => (window as any).__stachel.store.create(o), obj);
}
const get = (page: Page, id: string) => page.evaluate((i) => (window as any).__stachel.store.get(i), id);

async function startEditing(page: Page, id: string) {
  await page.evaluate((i) => {
    const s = (window as any).__stachel;
    s.api().startEditing(s.store.get(i));
  }, id);
  await expect(editing(page)).toBeFocused();
}

/** Ganzen Text im Editor markieren und warten, bis ProseMirror die Auswahl hat. */
async function selectWord(page: Page, word: string) {
  await editing(page).evaluate((el, w) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf(w);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + w.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
      return;
    }
  }, word);
  await page.waitForFunction((w) => {
    const ed = (document.querySelector('.ProseMirror') as any)?.editor;
    const { from, to } = ed.state.selection;
    return ed.state.doc.textBetween(from, to) === w;
  }, word);
}

/** Bildschirmtastatur nachstellen: visualViewport wird um `h` Pixel niedriger (wie iOS/Chrome mit resizes-visual). */
async function fakeKeyboard(page: Page) {
  await page.addInitScript(() => {
    const vv = new EventTarget() as EventTarget & Record<string, number>;
    Object.assign(vv, { width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
    (window as any).__kb = (h: number, offsetTop = 0) => {
      vv.height = innerHeight - h - offsetTop;
      vv.offsetTop = offsetTop;
      vv.dispatchEvent(new Event('resize'));
    };
  });
}

for (const vp of [
  { width: 390, height: 780 },
  { width: 360, height: 640 },
]) {
  test.describe(`Handy ${vp.width} px`, () => {
    test.use({ viewport: vp, isMobile: true, hasTouch: true });

    test('Format-Leiste passt ohne Wischen, Rest unter „Mehr“, bleibt über der Tastatur', async ({ page }) => {
      await fakeKeyboard(page);
      await openOffline(page);
      const id = await add(page, { type: 'shape', shape: 'rect', x: 0, y: 0, w: 260, h: 160, text: 'Getränke zählen' });
      await page.evaluate(() => (window as any).__stachel.api().fitAll());
      await startEditing(page, id);

      // nichts ragt heraus, nichts muss gescrollt werden
      const b = (await bar(page).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
      const overflow = await bar(page).evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      for (const name of ['Schriftgröße', 'Fett (Strg B)', 'Kursiv (Strg I)', 'Unterstrichen (Strg U)', 'Textfarbe', 'Markierung', 'Link (Strg K)', 'Mehr Formate']) {
        const bb = (await bar(page).getByRole('button', { name, exact: true }).boundingBox())!;
        expect(bb.x, name).toBeGreaterThanOrEqual(b.x);
        expect(bb.x + bb.width, name).toBeLessThanOrEqual(b.x + b.width + 0.5);
        expect(bb.width, name).toBeGreaterThanOrEqual(32); // gut treffbar
      }
      expect(b.y + b.height).toBeGreaterThan(vp.height - 80);

      // Tastatur geht auf: Leiste wandert darüber
      const KB = Math.round(vp.height * 0.5);
      await page.evaluate((h) => (window as any).__kb(h), KB);
      await expect.poll(async () => (await bar(page).boundingBox())!.y + (await bar(page).boundingBox())!.height).toBeLessThanOrEqual(vp.height - KB);

      // die Schreibmarke bleibt sichtbar: das Board fährt über Leiste und Tastatur
      const caretBottom = () =>
        page.evaluate(() => {
          const ed = (document.querySelector('.ProseMirror') as any).editor;
          return ed.view.coordsAtPos(ed.state.selection.head).bottom;
        });
      await expect.poll(async () => (await caretBottom()) - (await bar(page).boundingBox())!.y).toBeLessThanOrEqual(0);
      expect(await caretBottom()).toBeGreaterThan(60);

      // „Mehr“: Durchgestrichen, Listen, Ausrichtung, Schriftart – vollständig sichtbar über der Leiste
      await bar(page).getByRole('button', { name: 'Mehr Formate' }).click();
      const more = bar(page).getByRole('group', { name: 'Mehr Formate' });
      await expect(more).toBeVisible();
      const mb = (await more.boundingBox())!;
      const b2 = (await bar(page).boundingBox())!;
      expect(mb.y).toBeGreaterThanOrEqual(0);
      expect(mb.y + mb.height).toBeLessThanOrEqual(b2.y);
      expect(mb.x + mb.width).toBeLessThanOrEqual(vp.width);
      for (const name of ['Durchgestrichen (Strg Umschalt S)', 'Aufzählung', 'Nummerierte Liste', 'Checkliste', 'Linksbündig', 'Zentriert', 'Rechtsbündig', 'Oben', 'Barlow Condensed']) {
        await expect(more.getByRole('button', { name, exact: true })).toBeVisible();
      }
      await shot(page, `handy-${vp.width}-mehr`);

      await more.getByRole('button', { name: 'Nummerierte Liste' }).click();
      await more.getByRole('button', { name: 'Linksbündig' }).click();
      await expect(editing(page).locator('ol li')).toHaveText('Getränke zählen');
      expect((await get(page, id)).align).toBe('left');
      // aktiver Inhalt unter „Mehr“ wird am Knopf angezeigt
      await expect(bar(page).getByRole('button', { name: 'Mehr Formate' })).toHaveAttribute('aria-pressed', 'true');

      // Link direkt erreichbar, Feld über der Tastatur
      await selectWord(page, 'Getränke');
      await bar(page).getByRole('button', { name: 'Link (Strg K)' }).click();
      const input = page.getByRole('textbox', { name: 'Linkadresse' });
      await expect(input).toBeVisible();
      const ib = (await input.boundingBox())!;
      expect(ib.y + ib.height).toBeLessThanOrEqual(vp.height - KB);
      expect(ib.x + ib.width).toBeLessThanOrEqual(vp.width);
      await input.fill('example.org');
      await input.press('Enter');
      await expect(editing(page).locator('a')).toHaveText('Getränke');
      await shot(page, `handy-${vp.width}-tastatur`);

      // Tastatur zu: Leiste wieder unten
      await page.evaluate(() => (window as any).__kb(0));
      await expect.poll(async () => (await bar(page).boundingBox())!.y).toBeGreaterThan(vp.height - 80);
    });

    test('Popover bei offener Tastatur bleibt im sichtbaren Bereich (scrollt selbst)', async ({ page }) => {
      await fakeKeyboard(page);
      await openOffline(page);
      const id = await add(page, { type: 'text', x: 0, y: 0, w: 240, h: 40, text: 'Bühne' });
      await page.evaluate(() => (window as any).__stachel.api().fitAll());
      await startEditing(page, id);
      // sehr wenig Platz (Querformat-ähnlich): Größen-Liste muss in den Rest passen
      await page.evaluate((h) => (window as any).__kb(h), vp.height - 260);
      await bar(page).getByTestId('richtext-size').click();
      const pop = bar(page).getByRole('group', { name: 'Schriftgröße' });
      await expect(pop).toBeVisible();
      const pb = (await pop.boundingBox())!;
      expect(pb.y).toBeGreaterThanOrEqual(-1);
      const scrollable = await pop.evaluate((el) => el.scrollHeight > el.clientHeight || el.getBoundingClientRect().top >= 0);
      expect(scrollable).toBe(true);
    });
  });
}

test('Rechner: Leiste unverändert vollständig (Schriftart, Durchgestrichen, Listen, Ausrichtung direkt)', async ({ page }) => {
  await openOffline(page);
  const id = await add(page, { type: 'sticky', x: 0, y: 0, w: 220, h: 220, text: 'Ablauf' });
  await startEditing(page, id);
  for (const name of ['Schriftart', 'Durchgestrichen (Strg Umschalt S)', 'Aufzählung', 'Nummerierte Liste', 'Checkliste', 'Ausrichtung']) {
    await expect(bar(page).getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(bar(page).getByRole('button', { name: 'Mehr Formate' })).toHaveCount(0);
});

test.describe('Textmarker', () => {
  test('Stift → Textmarker: breiter, halbtransparenter Strich mit multiply, Farben und Breiten, Rückgängig', async ({ page }) => {
    await openOffline(page);
    const note = await add(page, { type: 'sticky', x: 0, y: 0, w: 220, h: 220, text: 'Wichtig: Bühnenaufbau' });
    await page.evaluate(() => (window as any).__stachel.api().fitAll());
    await page.keyboard.press('p');
    const opts = page.getByRole('group', { name: 'Werkzeug-Optionen' });
    await opts.getByRole('button', { name: 'Textmarker', exact: true }).click();
    await expect(opts.getByRole('button', { name: 'Textmarker', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await opts.getByRole('button', { name: 'Textmarker Pink' }).click();
    await opts.getByRole('button', { name: 'Markerbreite 32' }).click();
    await shot(page, 'marker-optionen');

    const box = (await page.locator(`[data-id="${note}"]`).boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 20, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 20, y + 4, { steps: 12 });
    // Entwurf während des Ziehens halbtransparent
    await expect(page.locator('.tools-marker-draft')).toHaveAttribute('stroke-opacity', /0\.4/);
    await page.mouse.up();

    const pens = (await objects(page)).filter((o) => o.type === 'pen') as any[];
    expect(pens).toHaveLength(1);
    expect(pens[0]).toMatchObject({ marker: true, color: '#ec4e92', strokeWidth: 32 });
    const el = page.locator(`[data-id="${pens[0].id}"]`);
    await expect(el).toHaveAttribute('data-marker', 'true');
    expect(await el.evaluate((e) => getComputedStyle(e).mixBlendMode)).toBe('multiply');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.mouse.click(10, 10);
    await shot(page, 'marker-notiz');

    // Stift-Modus bleibt der normale Stift
    await page.keyboard.press('p');
    await opts.getByRole('button', { name: 'Stift', exact: true }).click();
    await expect(opts.getByRole('button', { name: 'Stiftfarbe Schwarz' })).toBeVisible();
    await page.mouse.move(box.x + 20, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 40, { steps: 6 });
    await page.mouse.up();
    const after = (await objects(page)).filter((o) => o.type === 'pen') as any[];
    expect(after).toHaveLength(2);
    expect(after[1].marker).toBeUndefined();
    expect(after[1].strokeWidth).toBe(4);

    // Rückgängig nimmt Strich für Strich zurück
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect((await objects(page)).filter((o) => o.type === 'pen')).toHaveLength(0);
  });

  test('Radierer löscht auch Textmarker-Striche; Kopieren behält den Textmarker', async ({ page }) => {
    await openOffline(page);
    const id = await add(page, { type: 'pen', x: 100, y: 100, w: 200, h: 1, points: [0, 0, 200, 0], color: '#ffe14d', strokeWidth: 20, marker: true });
    await page.evaluate((i) => (window as any).__stachel.api().setSelection([i]), id);
    await page.keyboard.press('Control+d');
    await expect.poll(async () => (await objects(page)).filter((o) => o.type === 'pen').length).toBe(2);
    const pens = (await objects(page)).filter((o) => o.type === 'pen') as any[];
    expect(pens.every((p) => p.marker === true)).toBe(true);
    // Radierer über beide Striche
    await page.keyboard.press('Escape');
    await page.keyboard.press('e');
    const boxes = await Promise.all(pens.map((p) => page.locator(`[data-id="${p.id}"]`).boundingBox()));
    for (const b of boxes) {
      await page.mouse.move(b!.x + b!.width / 2, b!.y - 30);
      await page.mouse.down();
      await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height + 30, { steps: 10 });
      await page.mouse.up();
    }
    await expect.poll(async () => (await objects(page)).filter((o) => o.type === 'pen').length).toBe(0);
  });
});
