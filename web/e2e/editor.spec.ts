import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { addSticky as addStickyRaw, camera, centerOf, drag, objects, openOffline, selection, type Obj } from './helpers';

/** Werkzeug per Kürzel – vorher Auswahl aufheben, sonst landet die Taste als Text im ausgewählten Objekt. */
async function useTool(page: Page, key: string) {
  await page.keyboard.press('Escape');
  await page.keyboard.press(key);
}

/** Wie helpers.addSticky, aber vorher Auswahl aufheben: Tippen auf einer ausgewählten Notiz schreibt sonst hinein. */
async function addSticky(page: Page, at: { x: number; y: number }, text: string): Promise<Obj> {
  await page.keyboard.press('Escape');
  return addStickyRaw(page, at, text);
}

test.beforeEach(async ({ page }) => {
  await openOffline(page);
});

test('Haftnotiz anlegen und Text tippen', async ({ page }) => {
  const s = await addSticky(page, { x: 700, y: 450 }, 'Bühnenplan an Technik');
  expect(s.text).toBe('Bühnenplan an Technik');
  // Notiz ist um den Klickpunkt zentriert (Kamera: Ursprung in der Bildmitte)
  expect(s.x).toBe(700 - 720 - 100);
  expect(s.y).toBe(450 - 450 - 100);
  await expect(page.locator(`[data-id="${s.id}"] .sticky-text`)).toHaveText('Bühnenplan an Technik');
  // Schrift wurde automatisch angepasst und passt in die Notiz
  const fits = await page.locator(`[data-id="${s.id}"] .sticky-text`).evaluate((el) => el.scrollHeight <= el.parentElement!.clientHeight);
  expect(fits).toBe(true);
  // Werkzeug springt zurück auf Auswahl
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute('aria-pressed', 'true');
});

test('Doppelklick bearbeitet Text', async ({ page }) => {
  const s = await addSticky(page, { x: 600, y: 400 }, 'Alt');
  await page.mouse.dblclick(600, 400);
  await expect(page.locator('.sticky-text.editing')).toBeFocused();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Neu');
  await page.keyboard.press('Escape');
  expect((await objects(page)).find((o) => o.id === s.id)!.text).toBe('Neu');
});

test('Verschieben per Ziehen', async ({ page }) => {
  const s = await addSticky(page, { x: 600, y: 400 }, 'Zieh mich');
  await drag(page, { x: 600, y: 400 }, { x: 800, y: 500 });
  const moved = (await objects(page)).find((o) => o.id === s.id)!;
  expect(moved.x - s.x).toBe(200);
  expect(moved.y - s.y).toBe(100);
  // Pfeiltasten
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const nudged = (await objects(page)).find((o) => o.id === s.id)!;
  expect(nudged.x - moved.x).toBe(1);
  expect(nudged.y - moved.y).toBe(10);
});

test('Größe ändern über Griff', async ({ page }) => {
  const s = await addSticky(page, { x: 600, y: 400 }, 'Größer');
  await page.mouse.click(600, 400);
  const handle = page.locator('[data-handle="se"]');
  await expect(handle).toBeVisible();
  const hb = (await handle.boundingBox())!;
  await drag(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, { x: hb.x + 100, y: hb.y + 60 });
  const r = (await objects(page)).find((o) => o.id === s.id)!;
  expect(r.w).toBeGreaterThan(290);
  expect(r.w).toBe(r.h); // Haftnotiz behält das Seitenverhältnis
  expect(r.x).toBe(s.x);
  expect(r.y).toBe(s.y);
});

test('Verbinder zwischen zwei Notizen folgt beim Verschieben', async ({ page }) => {
  const a = await addSticky(page, { x: 400, y: 400 }, 'A');
  const b = await addSticky(page, { x: 900, y: 400 }, 'B');
  await useTool(page, 'l');
  await drag(page, await centerOf(page, a.id), await centerOf(page, b.id));
  const conn = (await objects(page)).find((o) => o.type === 'connector')!;
  expect(conn.from).toEqual({ objectId: a.id });
  expect(conn.to).toEqual({ objectId: b.id });
  const path = page.locator(`[data-id="${conn.id}"]`);
  await expect(path).toBeVisible();
  const before = (await path.boundingBox())!;
  // B nach unten ziehen → Verbinder folgt
  await page.keyboard.press('Escape');
  await drag(page, { x: 900, y: 400 }, { x: 900, y: 650 });
  const after = (await path.boundingBox())!;
  expect(after.height).toBeGreaterThan(before.height + 100);
  // Löschen von A entfernt den Verbinder
  await page.mouse.click(400, 400);
  await page.keyboard.press('Delete');
  expect((await objects(page)).some((o) => o.type === 'connector')).toBe(false);
});

test('Rückgängig und Wiederholen', async ({ page }) => {
  const s = await addSticky(page, { x: 600, y: 400 }, 'Undo');
  await drag(page, { x: 600, y: 400 }, { x: 700, y: 400 });
  expect((await objects(page))[0].x).toBe(s.x + 100);
  await page.keyboard.press('Control+z');
  expect((await objects(page))[0].x).toBe(s.x);
  await page.keyboard.press('Control+y');
  expect((await objects(page))[0].x).toBe(s.x + 100);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z'); // Text
  await page.keyboard.press('Control+z'); // Anlegen
  expect(await objects(page)).toHaveLength(0);
  await page.keyboard.press('Control+Shift+Z');
  expect(await objects(page)).toHaveLength(1);
  // Buttons
  await page.getByTestId('undo').click();
  expect(await objects(page)).toHaveLength(0);
  await page.getByTestId('redo').click();
  expect(await objects(page)).toHaveLength(1);
});

test('Zoom per Strg+Rad, Knöpfen und Einpassen', async ({ page }) => {
  await addSticky(page, { x: 600, y: 400 }, 'Zoom');
  await expect(page.getByTestId('zoom-value')).toHaveText('100 %');
  await page.mouse.move(600, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  const z1 = (await camera(page)).z;
  expect(z1).toBeGreaterThan(1.3);
  // Punkt unter dem Mauszeiger bleibt stehen
  const c = await centerOf(page, (await objects(page))[0].id);
  expect(Math.abs(c.x - 600)).toBeLessThan(2);
  await page.getByTestId('zoom-value').click();
  await page.getByRole('menuitem', { name: /^100 %/ }).click();
  await expect(page.getByTestId('zoom-value')).toHaveText('100 %');
  await page.getByRole('button', { name: 'Vergrößern' }).click();
  await expect(page.getByTestId('zoom-value')).toHaveText('125 %');
  await page.getByRole('button', { name: 'Verkleinern' }).click();
  await page.getByRole('button', { name: 'Verkleinern' }).click();
  await expect(page.getByTestId('zoom-value')).toHaveText('75 %');
  await page.getByRole('button', { name: 'Alles einpassen' }).click();
  await expect(page.getByTestId('zoom-value')).toHaveText('100 %'); // max. 100 % beim Einpassen
  // Trackpad-Wischen (kleine, gebrochene Werte) verschiebt; das Mausrad zoomt (e2e/ux.spec.ts)
  await page.mouse.move(600, 400);
  const before = await camera(page);
  await page.evaluate(() =>
    document.querySelector('[data-testid="board"]')!.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 600, clientY: 400, deltaY: 12.5 })),
  );
  const after = await camera(page);
  expect(after.y).toBeCloseTo(before.y - 12.5, 0);
  expect(after.z).toBe(before.z);
});

test('Rahmen-Auswahl und Löschen', async ({ page }) => {
  await addSticky(page, { x: 400, y: 300 }, 'Eins');
  await addSticky(page, { x: 700, y: 300 }, 'Zwei');
  const third = await addSticky(page, { x: 1100, y: 650 }, 'Drei');
  await page.keyboard.press('Escape');
  await drag(page, { x: 250, y: 150 }, { x: 900, y: 500 });
  const sel = await selection(page);
  expect(sel).toHaveLength(2);
  expect(sel).not.toContain(third.id);
  await expect(page.getByTestId('selection-box')).toBeVisible();
  // Shift-Klick ergänzt
  await page.keyboard.down('Shift');
  await page.mouse.click(1100, 650);
  await page.keyboard.up('Shift');
  expect(await selection(page)).toHaveLength(3);
  await page.keyboard.press('Delete');
  expect(await objects(page)).toHaveLength(0);
});

test('Kontextleiste: Farbe, Duplizieren, Sperren, Löschen', async ({ page }) => {
  const s = await addSticky(page, { x: 600, y: 400 }, 'Kontext');
  await page.mouse.click(600, 400);
  const bar = page.getByRole('toolbar', { name: 'Auswahl bearbeiten' });
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Farbe', exact: true }).click();
  await bar.getByRole('button', { name: 'Farbe Rosa' }).click();
  expect((await objects(page))[0]).toMatchObject({ color: '#ffb3d1' });
  await bar.getByRole('button', { name: 'Duplizieren' }).click();
  expect(await objects(page)).toHaveLength(2);
  await page.keyboard.press('Control+d');
  expect(await objects(page)).toHaveLength(3);
  // oberstes Objekt am Klickpunkt sperren
  await page.mouse.click(600, 400);
  const [top] = await selection(page);
  const before = (await objects(page)).find((o) => o.id === top)!;
  await bar.getByRole('button', { name: 'Sperren' }).click();
  expect((await objects(page)).find((o) => o.id === top)!.locked).toBe(true);
  await expect(page.locator('.ov-lock')).toHaveText('Gesperrt');
  // gesperrt: weder verschieben noch löschen
  await drag(page, { x: 600, y: 400 }, { x: 650, y: 450 });
  await page.keyboard.press('Delete');
  const locked = (await objects(page)).find((o) => o.id === top)!;
  expect(locked.x).toBe(before.x);
  await bar.getByRole('button', { name: 'Entsperren' }).click();
  await bar.getByRole('button', { name: 'Löschen' }).click();
  expect((await objects(page)).find((o) => o.id === top)).toBeUndefined();
  expect((await objects(page)).find((o) => o.id === s.id)).toBeDefined();
});

test('Formen, Text, Stift und Rahmen', async ({ page }) => {
  // Form aufziehen
  await useTool(page, 's');
  await drag(page, { x: 300, y: 200 }, { x: 500, y: 320 });
  // Text
  await useTool(page, 't');
  await page.mouse.click(700, 200);
  await page.keyboard.type('Überschrift');
  await page.keyboard.press('Escape');
  // zweites Esc hebt die Auswahl auf (sonst schreibt „p“ in den ausgewählten Text)
  await page.keyboard.press('Escape');
  // Stift
  await useTool(page, 'p');
  await page.mouse.move(300, 500);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(300 + i * 10, 500 + Math.sin(i / 3) * 40);
  await page.mouse.up();
  await page.keyboard.press('Escape');
  // Rahmen um alles
  await useTool(page, 'f');
  await drag(page, { x: 250, y: 150 }, { x: 1150, y: 650 });
  const list = await objects(page);
  const types = list.map((o) => o.type).sort();
  expect(types).toEqual(['frame', 'pen', 'shape', 'text']);
  const shape = list.find((o) => o.type === 'shape')!;
  expect(shape.w).toBe(200);
  expect(shape.h).toBe(120);
  expect(list.find((o) => o.type === 'text')!.text).toBe('Überschrift');
  // Rahmen am Titel ziehen → Inhalte wandern mit
  const title = page.locator('.ov-frame-title');
  const tb = (await title.boundingBox())!;
  await drag(page, { x: tb.x + 10, y: tb.y + tb.height / 2 }, { x: tb.x + 110, y: tb.y + tb.height / 2 + 50 });
  const after = await objects(page);
  for (const o of after) {
    const prev = list.find((p) => p.id === o.id)!;
    expect(o.x - prev.x).toBe(100);
    expect(o.y - prev.y).toBe(50);
  }
});

test('Kopieren und Einfügen über die Zwischenablage', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await addSticky(page, { x: 600, y: 400 }, 'Kopie');
  await page.mouse.click(600, 400);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  const list = await objects(page);
  expect(list).toHaveLength(2);
  expect(list[1].text).toBe('Kopie');
  // eingefügt wird am Mauszeiger: Mitte der Kopie liegt unter der Maus
  expect(list[1].x + list[1].w / 2).toBe(600 - 720);
  expect(list[1].y + list[1].h / 2).toBe(400 - 450);
  // ohne Maus über dem Board: versetzt um 24
  await page.mouse.move(720, 2000);
  await page.evaluate(() => document.querySelector('[data-testid="board"]')!.dispatchEvent(new PointerEvent('pointerleave')));
  await page.keyboard.press('Control+v');
  const again = await objects(page);
  expect(again).toHaveLength(3);
  expect(again[2].x - again[0].x).toBe(24);
});

test('Hand-Werkzeug und Leertaste verschieben die Ansicht', async ({ page }) => {
  const c0 = await camera(page);
  await page.keyboard.press('h');
  await drag(page, { x: 700, y: 400 }, { x: 600, y: 300 });
  const c1 = await camera(page);
  expect(c1.x - c0.x).toBe(-100);
  expect(c1.y - c0.y).toBe(-100);
  await page.keyboard.press('v');
  await page.keyboard.down('Space');
  await drag(page, { x: 600, y: 300 }, { x: 650, y: 300 });
  await page.keyboard.up('Space');
  expect((await camera(page)).x - c1.x).toBe(50);
  expect(await objects(page)).toHaveLength(0);
});

test('2000 Objekte: Culling und flüssiges Verschieben', async ({ page }) => {
  await page.evaluate(() => (window as any).__stachel.seedMany(2000));
  await expect.poll(() => page.evaluate(() => (window as any).__stachel.store.getSnapshot().ordered.length)).toBe(2000);
  // bei 100 % nur sichtbare Objekte im DOM
  const rendered = await page.locator('[data-type="sticky"]').count();
  expect(rendered).toBeLessThan(200);
  // Verschieben: Objekt-Renders zählen (deterministisch, anders als ms/Frame auf einem ausgelasteten Rechner, vgl. perf.spec)
  await page.keyboard.press('h');
  const stats = () => page.evaluate(() => ({ ...(window as any).__stachelRenderStats }) as { culls: number; views: number });
  const p0 = await stats();
  const avgMs = await page.evaluate(async () => {
    const board = document.querySelector('[data-testid="board"]')!;
    const fire = (type: string, x: number, y: number) =>
      board.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0, buttons: 1, isPrimary: true }));
    fire('pointerdown', 700, 400);
    const t0 = performance.now();
    for (let i = 1; i <= 60; i++) {
      fire('pointermove', 700 - i * 15, 400 - i * 10);
      await new Promise((r) => requestAnimationFrame(r));
    }
    const dt = performance.now() - t0;
    fire('pointerup', 0, 0);
    return dt / 60;
  });
  const panViews = (await stats()).views - p0.views;
  console.log(`Verschieben mit 2000 Objekten: ${avgMs.toFixed(1)} ms/Frame, ${panViews} Objekt-Renders (${rendered} im Bild)`);
  // nur Objekte, die neu ins Bild kommen – nicht alle sichtbaren je Frame (60 × rendered, StrictMode doppelt)
  expect(panViews).toBeLessThan(Math.max(800, rendered * 6));
  // Alles einpassen: alle 2000 sichtbar, Zoom bleibt bedienbar
  await page.getByRole('button', { name: 'Alles einpassen' }).click();
  await expect.poll(() => page.locator('[data-type="sticky"]').count()).toBe(2000);
  const z0 = await stats();
  const zoomMs = await page.evaluate(async () => {
    const board = document.querySelector('[data-testid="board"]')!;
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      board.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 700, clientY: 400, deltaY: i % 2 ? 30 : -30, ctrlKey: true }));
      await new Promise((r) => requestAnimationFrame(r));
    }
    return (performance.now() - t0) / 20;
  });
  const zoomViews = (await stats()).views - z0.views;
  console.log(`Zoomen mit 2000 sichtbaren Objekten: ${zoomMs.toFixed(1)} ms/Frame, ${zoomViews} Objekt-Renders`);
  // eingepasst bleibt jedes Objekt eine Fläche: Zoomen rendert die 2000 nicht je Frame neu (20 × 2000)
  expect(zoomViews).toBeLessThan(2000);
});

test('Bild über den Upload-Knopf einfügen', async ({ page }) => {
  // 2×1-PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEJMAIAKg4D/2MLmzYAAAAASUVORK5CYII=', 'base64');
  await page.getByTestId('image-input').setInputFiles({ name: 'plan.png', mimeType: 'image/png', buffer: png });
  await expect.poll(async () => (await objects(page)).filter((o) => o.type === 'image').length).toBe(1);
  const img = (await objects(page))[0];
  expect(img.w / img.h).toBeCloseTo(2, 0);
  await expect(page.locator(`[data-id="${img.id}"] img`)).toHaveAttribute('src', /^blob:/);
  // falsches Format → Hinweis
  await page.getByTestId('image-input').setInputFiles({ name: 'notiz.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await expect(page.getByRole('status').filter({ hasText: 'PNG, JPEG, WebP und GIF' })).toBeVisible();
});

test('Touch: Zwei-Finger-Zoom und -Verschieben', async ({ page }) => {
  const z = await page.evaluate(async () => {
    const board = document.querySelector('[data-testid="board"]')!;
    const fire = (type: string, id: number, x: number, y: number) =>
      board.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: id, pointerType: 'touch', isPrimary: id === 11, buttons: 1 }));
    fire('pointerdown', 11, 500, 400);
    fire('pointerdown', 12, 700, 400);
    for (let i = 1; i <= 10; i++) {
      fire('pointermove', 11, 500 - i * 10, 400);
      fire('pointermove', 12, 700 + i * 10, 400);
      await new Promise((r) => requestAnimationFrame(r));
    }
    fire('pointerup', 11, 400, 400);
    fire('pointerup', 12, 800, 400);
    return (window as any).__stachel.getCamera().z;
  });
  expect(z).toBeCloseTo(2, 1); // Abstand 200 → 400
  await expect(page.getByTestId('zoom-value')).toHaveText('200 %');
});

test('Rahmen umbenennen, Board-Titel ändern, Text einfügen', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await useTool(page, 'f');
  await drag(page, { x: 300, y: 200 }, { x: 900, y: 600 });
  const title = page.locator('.ov-frame-title');
  await title.dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Bühne Nord');
  await page.keyboard.press('Enter');
  await expect(title).toHaveText('Bühne Nord');
  expect((await objects(page))[0]).toMatchObject({ type: 'frame', title: 'Bühne Nord' } as never);

  await page.getByTestId('board-title').click();
  await page.getByLabel('Board-Titel').fill('Mein Testboard');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('board-title')).toHaveText('Mein Testboard');

  // fremder Text aus der Zwischenablage wird zur Haftnotiz
  await page.mouse.click(1200, 750);
  await page.evaluate(() => navigator.clipboard.writeText('Getränke-Liste prüfen'));
  await page.keyboard.press('Control+v');
  await expect.poll(async () => (await objects(page)).find((o) => o.type === 'sticky')?.text).toBe('Getränke-Liste prüfen');
});

test('Minimap springt an die geklickte Stelle', async ({ page }) => {
  await page.evaluate(() => (window as any).__stachel.seedMany(100));
  await page.getByTestId('zoom-value').click();
  await page.getByRole('menuitem', { name: /^100 %/ }).click();
  const before = await camera(page);
  const mm = (await page.getByRole('img', { name: 'Übersichtskarte' }).boundingBox())!;
  await page.mouse.click(mm.x + mm.width - 20, mm.y + mm.height - 20);
  const after = await camera(page);
  expect(after.x).toBeLessThan(before.x - 200);
  expect(after.y).toBeLessThan(before.y - 200);
});

test('Verbinder-Ende umhängen', async ({ page }) => {
  const a = await addSticky(page, { x: 400, y: 300 }, 'A');
  const b = await addSticky(page, { x: 800, y: 300 }, 'B');
  const c = await addSticky(page, { x: 800, y: 650 }, 'C');
  await useTool(page, 'l');
  await drag(page, await centerOf(page, a.id), await centerOf(page, b.id));
  const conn = (await objects(page)).find((o) => o.type === 'connector')!;
  const end = page.locator('[data-handle="to"]');
  await expect(end).toBeVisible();
  const eb = (await end.boundingBox())!;
  await drag(page, { x: eb.x + eb.width / 2, y: eb.y + eb.height / 2 }, await centerOf(page, c.id));
  expect((await objects(page)).find((o) => o.id === conn.id)!.to).toEqual({ objectId: c.id });
});

// ---- Bereich A: Editor-Interaktion --------------------------------------------------------------

const SHOTS = path.resolve(import.meta.dirname, '../../docs/screenshots');
/** Screenshot nach dem Einblenden (Popover/Menü-Animationen) */
async function shot(page: Page, name: string) {
  await page.waitForTimeout(260);
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

/** Objekte direkt im Store anlegen (Weltkoordinaten; bei Kamera 100 % liegt (0,0) in der Bildmitte 720/450). */
const create = (page: Page, list: Record<string, unknown>[]): Promise<string[]> =>
  page.evaluate((l) => (window as any).__stachel.store.createMany(l), list);
const S = (x: number, y: number) => ({ x: x + 720, y: y + 450 });
const note = (x: number, y: number, extra: Record<string, unknown> = {}) => ({ type: 'sticky', x, y, w: 200, h: 200, color: '#fff27a', text: '', ...extra });
const get = async (page: Page, id: string) => (await objects(page)).find((o) => o.id === id) as (Obj & Record<string, any>) | undefined;

/** Touch-Zeiger direkt feuern (wie ein Finger), Ziel = Element unter dem Punkt. */
async function touch(page: Page, steps: [type: string, id: number, x: number, y: number][]) {
  await page.evaluate(async (list) => {
    for (const [type, id, x, y] of list) {
      const el = (type === 'pointerdown' ? document.elementFromPoint(x, y) : null) ?? document.querySelector('[data-testid="board"]')!;
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: id, pointerType: 'touch', isPrimary: id === 11, buttons: type === 'pointerup' ? 0 : 1 }));
      await new Promise((r) => requestAnimationFrame(r));
    }
  }, steps);
}

test('Text: Schriftgröße zieht die Höhe nach, neuer Text wächst in der Breite', async ({ page }) => {
  await useTool(page, 't');
  await page.mouse.click(400, 300);
  await page.keyboard.type('Programm Samstag');
  const t0 = (await objects(page)).find((o) => o.type === 'text')! as Obj & { autoWidth?: boolean };
  expect(t0.autoWidth).toBe(true);
  expect(t0.w).toBeGreaterThan(180);
  const content = page.locator(`[data-id="${t0.id}"] .text-content`);
  // einzeilig: kein Umbruch trotz wachsender Breite
  expect(await content.evaluate((el) => (el as HTMLElement).offsetHeight)).toBeLessThan(28 * 1.25 * 1.5);
  await page.keyboard.press('Escape');
  const bar = page.getByRole('toolbar', { name: 'Auswahl bearbeiten' });
  await bar.getByRole('button', { name: 'Schriftgröße wählen' }).click();
  await bar.getByRole('button', { name: '64', exact: true }).click();
  await expect.poll(async () => (await get(page, t0.id))!.fontSize).toBe(64);
  // h folgt der gerenderten Höhe (vorher blieb h=36 bei 160 px Darstellung)
  await expect.poll(async () => Math.abs((await get(page, t0.id))!.h - (await content.evaluate((el) => (el as HTMLElement).offsetHeight)))).toBeLessThanOrEqual(1);
  const t1 = (await get(page, t0.id))!;
  expect(t1.h).toBeGreaterThan(70);
  expect(t1.w).toBeGreaterThan(t0.w * 1.8);
  const sel = (await page.getByTestId('selection-box').boundingBox())!;
  expect(Math.abs(sel.height - t1.h)).toBeLessThanOrEqual(2);
  // A+ ebenso
  await bar.getByRole('button', { name: 'Schrift größer' }).click();
  await expect.poll(async () => (await get(page, t0.id))!.fontSize).toBe(80);
  await expect.poll(async () => Math.abs((await get(page, t0.id))!.h - (await content.evaluate((el) => (el as HTMLElement).offsetHeight)))).toBeLessThanOrEqual(1);
  // Größe + Höhe sind ein Undo-Schritt
  await page.keyboard.press('Control+z');
  expect(await get(page, t0.id)).toMatchObject({ fontSize: 64, h: t1.h });
  // Seitengriff: ab jetzt feste Breite, Text bricht um
  const e = (await page.locator('[data-handle="e"]').boundingBox())!;
  await drag(page, { x: e.x + e.width / 2, y: e.y + e.height / 2 }, { x: e.x - t1.w * 0.5, y: e.y + e.height / 2 });
  const t2 = (await get(page, t0.id))!;
  expect(t2.autoWidth).toBeUndefined();
  expect(t2.w).toBeLessThan(t1.w * 0.6);
  // Höhe wird nach dem Loslassen gemessen (nächster Frame)
  await expect.poll(async () => (await get(page, t0.id))!.h).toBeGreaterThan(t1.h * 1.5);
});

test('Einrasten: Kanten, gleiche Abstände, Alt schaltet aus', async ({ page }) => {
  const [a, b] = await create(page, [note(-400, -300), note(0, 0)]);
  // b so ziehen, dass seine linke Kante 3 px neben der von a liegt
  await page.mouse.move(S(100, 100).x, S(100, 100).y);
  await page.mouse.down();
  await page.mouse.move(S(-297, 140).x, S(-297, 140).y, { steps: 8 });
  await expect(page.getByTestId('guides').locator('.ov-guide')).not.toHaveCount(0);
  await shot(page, 'editor-einrasten');
  await page.mouse.up();
  expect((await get(page, b))!.x).toBe(-400);
  await expect(page.getByTestId('guides')).toHaveCount(0);
  expect((await get(page, a))!.x).toBe(-400);
  // Alt beim Ziehen: kein Einrasten
  const c = S(-300, 180);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 20, c.y, { steps: 3 });
  await page.keyboard.down('Alt');
  await page.mouse.move(c.x + 3, c.y, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  expect((await get(page, b))!.x).toBe(-397);
  expect(await objects(page)).toHaveLength(2);
});

test('Einrasten auf gleiche Abstände zwischen Nachbarn', async ({ page }) => {
  const [, , b] = await create(page, [note(-400, -150), note(-100, -150), note(150, 150)]);
  await page.mouse.move(S(250, 250).x, S(250, 250).y);
  await page.mouse.down();
  // Abstand 100 wie zwischen den ersten beiden → b.x = 200 (gezogen auf 203)
  await page.mouse.move(S(303, -40).x, S(303, -40).y, { steps: 10 });
  await expect(page.locator('.ov-gap')).toHaveCount(2);
  await expect(page.locator('.ov-gap text').first()).toHaveText('100');
  await page.mouse.up();
  expect((await get(page, b))!.x).toBe(200);
});

test('Tab legt beim Schreiben die nächste Haftnotiz an', async ({ page }) => {
  await useTool(page, 'n');
  await page.mouse.click(500, 400);
  // erst tippen, wenn der Rich-Text-Editor steht (wird nachgeladen; unter Last sonst „insE“, s. Bericht)
  await expect(page.locator('.sticky-text.editing')).toBeFocused();
  await page.keyboard.type('Eins');
  await page.keyboard.press('Tab');
  await expect(page.locator('.sticky-text.editing')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Zur Übersicht' })).not.toBeFocused();
  await page.keyboard.type('Zwei');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.sticky-text.editing')).toBeFocused();
  await expect.poll(async () => (await objects(page)).length).toBe(3);
  await page.keyboard.type('Null');
  await page.keyboard.press('Control+Enter');
  const list = (await objects(page)) as (Obj & { color?: string })[];
  expect(list.map((o) => o.text)).toEqual(['Eins', 'Zwei', 'Null']);
  const [one, two, zero] = list;
  expect(two.x - one.x).toBe(240);
  expect(two.y).toBe(one.y);
  expect(two.color).toBe(one.color);
  expect(two.w).toBe(one.w);
  // Umschalt+Tab aus „Zwei“: links daneben liegt „Eins“ – die neue Notiz nimmt den nächsten freien Platz
  expect(zero.x).toBe(one.x - 240);
  expect(zero.y).toBe(one.y);
});

test('Plus-Griffe: Klick legt verbundene Kopie an, Ziehen zieht einen Verbinder', async ({ page }) => {
  const [a, other] = await create(page, [note(-300, -200, { text: 'Start', color: '#ffb3d1' }), note(250, -200)]);
  await page.mouse.click(S(-200, -100).x, S(-200, -100).y);
  await expect(page.locator('.ov-add')).toHaveCount(4);
  await shot(page, 'editor-plus-griffe');
  await page.locator('[data-handle="add-s"]').click();
  await expect(page.locator('.sticky-text.editing')).toBeFocused();
  await page.keyboard.type('Danach');
  await page.keyboard.press('Escape');
  const list = await objects(page);
  const added = list.find((o) => o.text === 'Danach')! as Obj & { color?: string };
  expect(added).toMatchObject({ x: -300, y: 40, w: 200, h: 200, color: '#ffb3d1' });
  const conn = list.find((o) => o.type === 'connector')!;
  // Plus-Griff unten: Verbinder dockt an den zugewandten Seiten an
  expect(conn.from).toEqual({ objectId: a, side: 's' });
  expect(conn.to).toEqual({ objectId: added.id, side: 'n' });
  // Ziehen am rechten Plus zur anderen Notiz → Verbinder
  await page.mouse.click(S(-200, -100).x, S(-200, -100).y);
  const plus = (await page.locator('[data-handle="add-e"]').boundingBox())!;
  await drag(page, { x: plus.x + plus.width / 2, y: plus.y + plus.height / 2 }, S(350, -100));
  const c2 = (await objects(page)).filter((o) => o.type === 'connector').at(-1)!;
  expect(c2.from).toEqual({ objectId: a, side: 'e' });
  expect(c2.to).toEqual({ objectId: other });
});

test('Überfahren zeigt Rahmen und Andockpunkte, Verbinder direkt herausziehen', async ({ page }) => {
  const [a, b] = await create(page, [note(-300, -100, { text: 'A' }), note(200, -100, { text: 'B' })]);
  await page.mouse.move(S(-200, 0).x, S(-200, 0).y);
  await expect(page.locator('.ov-hover--select')).toHaveCount(1);
  await expect(page.locator('.ov-anchor')).toHaveCount(4);
  await shot(page, 'editor-andockpunkte');
  const anchor = (await page.locator('[data-handle="anchor-e"]').boundingBox())!;
  await page.mouse.move(anchor.x + 6, anchor.y + 6, { steps: 4 });
  await expect(page.locator('.ov-anchor')).toHaveCount(4);
  await drag(page, { x: anchor.x + 6, y: anchor.y + 6 }, S(300, 0));
  const conn = (await objects(page)).find((o) => o.type === 'connector')!;
  expect(conn.from).toEqual({ objectId: a, side: 'e' });
  expect(conn.to).toEqual({ objectId: b });
  expect(await selection(page)).toEqual([conn.id]);
  // Maus weg: kein Hover
  await page.mouse.move(S(0, 300).x, S(0, 300).y);
  await expect(page.locator('.ov-hover--select')).toHaveCount(0);
});

test('Ausrichten und Verteilen über die Kontextleiste', async ({ page }) => {
  const ids = await create(page, [note(-400, -100), note(-50, 0), note(100, 50, { w: 100, h: 100 })]);
  await page.keyboard.press('Control+a');
  const bar = page.getByRole('toolbar', { name: 'Auswahl bearbeiten' });
  await bar.getByRole('button', { name: 'Ausrichten' }).click();
  await shot(page, 'editor-ausrichten');
  await bar.getByRole('button', { name: 'Oben ausrichten' }).click();
  expect((await objects(page)).map((o) => o.y)).toEqual([-100, -100, -100]);
  await page.keyboard.press('Control+z');
  expect((await objects(page)).map((o) => o.y)).toEqual([-100, 0, 50]);
  await bar.getByRole('button', { name: 'Horizontal verteilen' }).click();
  const [l, m, r] = ids.map(async (id) => (await get(page, id))!);
  const [L, M, R] = await Promise.all([l, m, r]);
  expect(M.x - (L.x + L.w)).toBe(R.x - (M.x + M.w));
  expect(L.x).toBe(-400);
  expect(R.x).toBe(100);
});

test('Gruppieren mit Strg+G: Klick wählt die Gruppe, Doppelklick das einzelne Objekt', async ({ page }) => {
  const [a, b, c] = await create(page, [note(-400, -100, { text: 'A' }), note(-150, -100, { text: 'B' }), note(200, -100, { text: 'C' })]);
  await page.mouse.click(S(-300, 0).x, S(-300, 0).y);
  await page.keyboard.down('Shift');
  await page.mouse.click(S(-50, 0).x, S(-50, 0).y);
  await page.keyboard.up('Shift');
  await page.keyboard.press('Control+g');
  const g = (await get(page, a))!.groupId;
  expect(g).toBeTruthy();
  expect((await get(page, b))!.groupId).toBe(g);
  expect((await get(page, c))!.groupId).toBeUndefined();
  await page.keyboard.press('Escape');
  await page.mouse.click(S(-300, 0).x, S(-300, 0).y);
  expect((await selection(page)).sort()).toEqual([a, b].sort());
  await expect(page.getByRole('button', { name: 'Gruppierung lösen' })).toBeVisible();
  // Gruppe verschieben bewegt beide
  await drag(page, S(-300, 0), S(-300, 50));
  expect((await get(page, b))!.y).toBe(-50);
  await page.mouse.dblclick(S(-50, 0).x, S(-50, 0).y);
  expect(await selection(page)).toEqual([b]);
  await expect(page.locator('.sticky-text.editing')).toHaveCount(0);
  // Duplizieren: neue, gemeinsame groupId
  await page.keyboard.press('Escape');
  await page.mouse.click(S(-300, 50).x, S(-300, 50).y);
  await page.keyboard.press('Control+d');
  const copies = (await objects(page)).slice(-2) as (Obj & { groupId?: string })[];
  expect(copies[0].groupId).toBeTruthy();
  expect(copies[0].groupId).not.toBe(g);
  expect(copies[0].groupId).toBe(copies[1].groupId);
  // Lösen und Löschen der Gruppe
  await page.keyboard.press('Delete');
  expect(await objects(page)).toHaveLength(3);
  await page.mouse.click(S(-300, 50).x, S(-300, 50).y);
  await page.keyboard.press('Control+Shift+g');
  expect((await get(page, a))!.groupId).toBeUndefined();
  await page.keyboard.press('Escape');
  await page.mouse.click(S(-300, 50).x, S(-300, 50).y);
  expect(await selection(page)).toEqual([a]);
});

test('Kontextmenü: Rechtsklick, Tastatur, leere Fläche, rechts ziehen verschiebt', async ({ page }) => {
  const [a] = await create(page, [note(-100, -100, { text: 'Menü' })]);
  await page.mouse.click(720, 450, { button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  expect(await selection(page)).toEqual([a]);
  // Kern-Einträge in dieser Reihenfolge, dazwischen die der Module (Ausschneiden, Ausblenden, Kommentieren …)
  const labels = await menu.getByRole('menuitem').allTextContents();
  const core = ['Kopieren', 'Einfügen', 'Duplizieren', 'Ebene', 'Sperren', 'Gruppieren', 'Auf Auswahl zoomen', 'Löschen'];
  const at = core.map((c) => labels.findIndex((l) => l.startsWith(c)));
  expect(at.every((i) => i >= 0), labels.join(' | ')).toBe(true);
  expect([...at].sort((x, y) => x - y)).toEqual(at);
  await shot(page, 'editor-kontextmenue');
  for (let i = 0; i < at[2]; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  expect(await objects(page)).toHaveLength(2);
  // leere Fläche
  await page.mouse.click(200, 700, { button: 'right' });
  const canvas = await menu.getByRole('menuitem').allTextContents();
  expect(canvas.slice(0, 3).map((l) => l.replace(/Strg.*|Umschalt.*/, ''))).toEqual(['Einfügen', 'Alles auswählen', 'Alles einpassen']);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page.mouse.click(200, 700, { button: 'right' });
  await menu.getByRole('menuitem', { name: /Alles auswählen/ }).click();
  expect(await selection(page)).toHaveLength(2);
  // Rechte Taste gedrückt + ziehen: Ansicht verschieben, kein Menü
  const c0 = await camera(page);
  await page.mouse.move(300, 700);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(400, 750, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  const c1 = await camera(page);
  expect(c1.x - c0.x).toBe(100);
  expect(c1.y - c0.y).toBe(50);
  await expect(menu).toHaveCount(0);
});

test('Touch: Wischen über ein Objekt verschiebt die Ansicht, Pinch legt keine Notiz an', async ({ page }) => {
  const [a] = await create(page, [note(0, 0)]);
  const c0 = await camera(page);
  await touch(page, [
    ['pointerdown', 11, 820, 550],
    ['pointermove', 11, 760, 520],
    ['pointermove', 11, 620, 450],
    ['pointerup', 11, 620, 450],
  ]);
  expect(await get(page, a)).toMatchObject({ x: 0, y: 0 });
  const c1 = await camera(page);
  expect(c1.x - c0.x).toBe(-200);
  expect(c1.y - c0.y).toBe(-100);
  // Antippen wählt aus, danach lässt es sich verschieben
  await touch(page, [
    ['pointerdown', 11, 620, 450],
    ['pointerup', 11, 620, 450],
  ]);
  expect(await selection(page)).toEqual([a]);
  await touch(page, [
    ['pointerdown', 11, 620, 450],
    ['pointermove', 11, 640, 460],
    ['pointermove', 11, 670, 470],
    ['pointerup', 11, 670, 470],
  ]);
  expect(await get(page, a)).toMatchObject({ x: 50, y: 20 });
  // Pinch mit Notiz-Werkzeug: keine verirrte Notiz
  await useTool(page, 'n');
  await touch(page, [
    ['pointerdown', 11, 300, 300],
    ['pointerdown', 12, 500, 300],
    ['pointermove', 11, 250, 300],
    ['pointermove', 12, 560, 300],
    ['pointerup', 11, 250, 300],
    ['pointerup', 12, 560, 300],
  ]);
  expect(await objects(page)).toHaveLength(1);
  // Ein Tipp legt an; bei kleiner Darstellung zoomt die Kamera zum Schreiben heran
  await page.evaluate(() => (window as any).__stachel.setCamera({ x: 720, y: 450, z: 0.3 }));
  await touch(page, [
    ['pointerdown', 11, 300, 300],
    ['pointerup', 11, 300, 300],
  ]);
  expect(await objects(page)).toHaveLength(2);
  await expect(page.locator('.sticky-text.editing')).toBeFocused();
  await expect.poll(async () => (await camera(page)).z).toBeGreaterThan(1.5);
  const w = (await page.locator('.obj-sticky:has(.editing)').boundingBox())!.width;
  expect(w).toBeGreaterThan(160);
});

test('Tippen auf ausgewählter Form startet die Bearbeitung, Text-Werkzeug bearbeitet vorhandenen Text', async ({ page }) => {
  const [shape, text] = await create(page, [
    { type: 'shape', shape: 'rect', x: -300, y: -100, w: 200, h: 120, color: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2, text: '', fontSize: 20 },
    { type: 'text', x: 100, y: -100, w: 300, h: 35, fontSize: 28, text: 'Hallo', color: '#0a0a0a' },
  ]);
  await page.mouse.click(S(-200, -40).x, S(-200, -40).y);
  await page.keyboard.type('abc');
  await expect(page.locator('.shape-text.editing')).toBeFocused();
  await page.keyboard.press('Escape');
  expect((await get(page, shape))!.text).toBe('abc');
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute('aria-pressed', 'true');
  // Text-Werkzeug auf vorhandenem Text
  await useTool(page, 't');
  await page.mouse.click(S(150, -85).x, S(150, -85).y);
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.keyboard.press('Escape');
  expect(await objects(page)).toHaveLength(2);
  expect((await get(page, text))!.text).toBe('Hallo!');
});

test('Formatierung: Fett, Kursiv, Durchgestrichen, Ausrichtung, Rand und Schriftgröße', async ({ page }) => {
  const [n, sh] = await create(page, [
    note(-350, -100, { text: 'Fett' }),
    { type: 'shape', shape: 'rect', x: 100, y: -60, w: 200, h: 120, color: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2, text: 'Form', fontSize: 20 },
  ]);
  await page.mouse.click(S(-250, 0).x, S(-250, 0).y);
  const bar = page.getByRole('toolbar', { name: 'Auswahl bearbeiten' });
  await bar.getByRole('button', { name: /^Fett/ }).click();
  expect((await get(page, n))!.bold).toBe(true);
  await expect(bar.getByRole('button', { name: /^Fett/ })).toHaveAttribute('aria-pressed', 'true');
  // Strg+I / Strg+Umschalt+S während der Bearbeitung
  // (Rich-Text: das gilt für die Textauswahl – hier alles markiert)
  await page.keyboard.press('Enter');
  await expect(page.locator('.sticky-text.editing')).toBeFocused();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+i');
  await page.keyboard.press('Control+Shift+S');
  await expect(page.locator('.sticky-text.editing')).toBeFocused();
  await page.keyboard.press('Escape');
  expect(await get(page, n)).toMatchObject({ bold: true, text: 'Fett' });
  await expect(page.locator(`[data-id="${n}"] em s, [data-id="${n}"] s em`)).toHaveText('Fett');
  // Schriftgröße manuell und zurück auf Auto
  await expect(bar.getByTestId('font-size')).toHaveText('Auto');
  await bar.getByTestId('font-size').click();
  await bar.getByRole('button', { name: '40', exact: true }).click();
  expect((await get(page, n))!.fontSize).toBe(40);
  await bar.getByTestId('font-size').click();
  await bar.getByRole('button', { name: 'Auto', exact: true }).click();
  expect((await get(page, n))!.fontSize).toBeUndefined();
  // Ausrichtung
  await bar.getByRole('button', { name: 'Textausrichtung' }).click();
  await bar.getByRole('button', { name: 'Linksbündig' }).click();
  await bar.getByRole('button', { name: 'Oben', exact: true }).click();
  expect(await get(page, n)).toMatchObject({ align: 'left', valign: 'top' });
  // Rand einer Form
  await page.mouse.click(S(200, 0).x, S(200, 0).y);
  await bar.getByRole('button', { name: 'Rand', exact: true }).click();
  await shot(page, 'editor-rand');
  await bar.getByRole('button', { name: 'Randfarbe Pink' }).click();
  await bar.getByRole('button', { name: 'Randstärke 4' }).click();
  await bar.getByRole('button', { name: 'Gestrichelt' }).click();
  expect(await get(page, sh)).toMatchObject({ stroke: '#ec4e92', strokeWidth: 4, dash: 'dashed' });
  // Strg+B ohne Bearbeitung wirkt auf die Auswahl
  await page.keyboard.press('Control+b');
  expect((await get(page, sh))!.bold).toBe(true);
});

test('Verbinder: Beschriftung, Linienart, Pfeile, Strich und Stärke', async ({ page }) => {
  const [a, b] = await create(page, [note(-400, -100), note(200, -100)]);
  const [c] = await create(page, [{ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: a }, to: { objectId: b }, color: '#0a0a0a', strokeWidth: 2, arrowEnd: true }]);
  // Doppelklick in die Linienmitte: Beschriftung
  await page.mouse.dblclick(S(0, 0).x, S(0, 0).y);
  const label = page.getByRole('textbox', { name: 'Beschriftung des Verbinders' });
  await expect(label).toBeFocused();
  await page.keyboard.type('Ja');
  await page.keyboard.press('Enter');
  expect((await get(page, c))!.text).toBe('Ja');
  expect(await selection(page)).toEqual([c]);
  const bar = page.getByRole('toolbar', { name: 'Auswahl bearbeiten' });
  await bar.getByRole('button', { name: 'Linienart' }).click();
  await bar.getByRole('button', { name: 'Gewinkelt' }).click();
  await bar.getByRole('button', { name: 'Pfeil am Anfang' }).click();
  await bar.getByRole('button', { name: 'Linie', exact: true }).click();
  await bar.getByRole('button', { name: 'Gepunktet' }).click();
  await bar.getByRole('button', { name: 'Linienstärke' }).click();
  await shot(page, 'editor-verbinder-optionen');
  await bar.getByRole('button', { name: 'Linienstärke 8' }).click();
  expect(await get(page, c)).toMatchObject({ lineStyle: 'elbow', arrowStart: true, arrowEnd: true, dash: 'dotted', strokeWidth: 8 });
  // Auswahl-Linie folgt demselben Pfad wie die Darstellung
  const d = await page.locator('.ov-conn-sel').getAttribute('d');
  expect(d).toMatch(/^M[\d.\- ]+L/);
  await bar.getByRole('button', { name: 'Linienart' }).click();
  await bar.getByRole('button', { name: 'Geschwungen' }).click();
  expect(await page.locator('.ov-conn-sel').getAttribute('d')).toContain('C');
});

test('Rahmen-Liste, Präsentation, Umschalt+2 und Kürzel-Übersicht', async ({ page }) => {
  const [, , zweiC] = await create(page, [
    { type: 'frame', x: 0, y: 0, w: 600, h: 400, title: 'Zwei-B', color: '#ffffff' },
    { type: 'frame', x: -800, y: -700, w: 600, h: 400, title: 'Eins', color: '#ffffff' },
    { type: 'frame', x: 800, y: 40, w: 600, h: 400, title: 'Zwei-C', color: '#ffffff' },
    note(150, 100, { text: 'Bühne' }),
  ]);
  await page.getByRole('button', { name: 'Rahmen-Liste' }).click();
  const panel = page.getByRole('dialog', { name: 'Rahmen' });
  await expect(panel.locator('.frames-panel__title')).toHaveText(['Eins', 'Zwei-B', 'Zwei-C']);
  await shot(page, 'editor-rahmen-liste');
  await panel.getByRole('button', { name: '3. Zwei-C' }).click();
  // Kamera passt den Rahmen in die freie Fläche ein: ganz im Bild, nicht unter der Rahmen-Liste (Ränder gemessen, ui/chromeInsets)
  await expect
    .poll(async () => {
      const f = (await page.locator(`.obj[data-id="${zweiC}"]`).boundingBox())!;
      const p = (await panel.boundingBox())!;
      return f.x >= p.x + p.width && f.x + f.width <= 1440 && f.y >= 0 && f.y + f.height <= 900 && f.width > 500;
    })
    .toBe(true);
  await panel.getByRole('button', { name: 'Präsentieren' }).click();
  await expect(page.getByTestId('present-pos')).toHaveText('1 / 3');
  await expect(page.getByRole('navigation', { name: 'Werkzeuge' })).toHaveCount(0);
  await page.waitForTimeout(400);
  await shot(page, 'editor-praesentation');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('present-pos')).toHaveText('2 / 3');
  await page.keyboard.press('PageDown');
  await expect(page.getByTestId('present-pos')).toHaveText('3 / 3');
  await page.keyboard.press('PageUp');
  await expect(page.getByTestId('present-pos')).toHaveText('2 / 3');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('present-pos')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Werkzeuge' })).toBeVisible();
  // Umschalt+2: auf Auswahl zoomen
  await page.getByRole('button', { name: 'Alles einpassen' }).click();
  const n = (await objects(page)).find((o) => o.type === 'sticky')!;
  const p = await centerOf(page, n.id);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Shift+Digit2');
  await expect.poll(async () => (await camera(page)).z).toBeCloseTo(2, 1);
  // Kürzel-Übersicht
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+?');
  await expect(page.getByRole('dialog', { name: 'Tastenkürzel' })).toBeVisible();
  await shot(page, 'editor-kuerzel');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Tastenkürzel' })).toHaveCount(0);
  await page.keyboard.press('Control+/');
  await expect(page.getByRole('dialog', { name: 'Tastenkürzel' })).toBeVisible();
});

test('Alt+Ziehen kopiert, Esc bricht Ziehen ab, Drehen rastet mit Umschalt ein', async ({ page }) => {
  const [a] = await create(page, [note(0, 0, { text: 'Original' })]);
  await page.keyboard.down('Alt');
  await drag(page, S(100, 100), S(300, 200));
  await page.keyboard.up('Alt');
  const list = await objects(page);
  expect(list).toHaveLength(2);
  expect(await get(page, a)).toMatchObject({ x: 0, y: 0 });
  const copy = list.find((o) => o.id !== a)!;
  expect(copy).toMatchObject({ x: 200, y: 100, text: 'Original' });
  expect(await selection(page)).toEqual([copy.id]);
  // Esc während des Ziehens setzt zurück
  await page.mouse.move(S(300, 200).x, S(300, 200).y);
  await page.mouse.down();
  await page.mouse.move(S(500, 300).x, S(500, 300).y, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await get(page, copy.id)).toMatchObject({ x: 200, y: 100 });
  // der abgebrochene Zug ist kein Undo-Schritt: Strg+Z nimmt die Kopie zurück
  await page.keyboard.press('Control+z');
  expect(await objects(page)).toHaveLength(1);
  // Esc beim Größe ändern
  await page.mouse.click(S(100, 100).x, S(100, 100).y);
  const se = (await page.locator('[data-handle="se"]').boundingBox())!;
  await page.mouse.move(se.x + 5, se.y + 5);
  await page.mouse.down();
  await page.mouse.move(se.x + 120, se.y + 120, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await get(page, a)).toMatchObject({ w: 200, h: 200 });
  // Drehen mit Umschalt: 15°-Schritte
  await page.mouse.click(S(100, 100).x, S(100, 100).y);
  const rot = (await page.locator('[data-handle="rotate"]').boundingBox())!;
  await page.mouse.move(rot.x + rot.width / 2, rot.y + rot.height / 2);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(S(330, 100).x, S(330, 100).y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const r = (await get(page, a))!.rotation as number;
  expect(r).toBeTruthy();
  expect(r % 15).toBe(0);
  await shot(page, 'editor-drehen');
});

test('Zwischenablage: Klartext für andere Programme, Stachel-Daten im HTML', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await create(page, [note(-300, -100, { text: 'Bühne' }), note(0, -100, { text: 'Bar' })]);
  await page.mouse.click(S(100, 300).x, S(100, 300).y);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Bühne\nBar');
  const html = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    return item.types.includes('text/html') ? (await item.getType('text/html')).text() : '';
  });
  expect(html).toContain('data-stachel=');
  expect(html).not.toContain('"marker"');
  await page.mouse.move(S(0, 250).x, S(0, 250).y);
  await page.keyboard.press('Control+v');
  const list = await objects(page);
  expect(list).toHaveLength(4);
  // Einfügen am Mauszeiger: Mitte der eingefügten Gruppe liegt unter der Maus
  const pasted = list.slice(2);
  const midX = (Math.min(...pasted.map((o) => o.x)) + Math.max(...pasted.map((o) => o.x + o.w))) / 2;
  expect(midX).toBe(0);
});

test('Handy: langes Drücken öffnet das Menü, Kontextleiste unten angedockt', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // erst nach dem Größenwechsel die Kamera setzen: der Editor hält dabei die Bildmitte fest und verschiebt sie sonst danach
  await page.waitForFunction(() => (window as any).__stachel.api().viewSize().w === 390);
  await page.evaluate(() => (window as any).__stachel.setCamera({ x: 195, y: 422, z: 1 }));
  const [a] = await create(page, [note(-100, -100, { text: 'Handy' })]);
  await page.evaluate(async () => {
    const el = document.elementFromPoint(195, 422)!;
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 195, clientY: 422, pointerId: 21, pointerType: 'touch', isPrimary: true, buttons: 1 }));
    await new Promise((r) => setTimeout(r, 650));
    document.querySelector('[data-testid="board"]')!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 195, clientY: 422, pointerId: 21, pointerType: 'touch', isPrimary: true }));
  });
  await expect(page.getByRole('menu')).toBeVisible();
  expect(await selection(page)).toEqual([a]);
  expect(await get(page, a)).toMatchObject({ x: -100, y: -100 });
  await shot(page, 'editor-handy-menue');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: 'Auswahl bearbeiten' })).toBeVisible();
  await shot(page, 'editor-handy-auswahl');
});
