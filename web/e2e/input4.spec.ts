// Runde 4 (Eingabe, Gesten, Kamera): schnelles Tippen nach dem Anlegen, Rad bei gebrochenen Deltas, gedrehte Größe,
// Fokusverlust beim Ziehen, Fenstergröße, Tab auf freien Platz, Umschalt-Achse, Auto-Schwenken, Zoom-Menü,
// Touch (Seiten-Zoom, Griffe, Palm-Rejection, Präsentation wischen).
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { camera, centerOf, drag, objects, openOffline } from './helpers';

/** Objekt mit Mitte am Bildschirmpunkt (x, y) anlegen (Standard: Haftnotiz 200 × 200). */
async function objAt(page: Page, x: number, y: number, extra: Record<string, unknown> = {}): Promise<string> {
  return page.evaluate(
    ([x, y, extra]) => {
      const s = (window as any).__stachel;
      const w = s.api().toWorld({ x, y });
      const o = { type: 'sticky', w: 200, h: 200, text: '', ...extra } as any;
      return s.store.create({ ...o, x: Math.round(w.x - o.w / 2), y: Math.round(w.y - o.h / 2) });
    },
    [x, y, extra] as const,
  );
}

const byId = async (page: Page, id: string) => (await objects(page)).find((o) => o.id === id)!;
const select = (page: Page, ids: string[]) => page.evaluate((ids) => (window as any).__stachel.api().setSelection(ids), ids);

/** Ruckelnde Bilder (langsames Gerät, volle Seite): requestAnimationFrame kommt erst nach `ms`. */
async function slowFrames(page: Page, ms: number) {
  await page.addInitScript((ms) => {
    const raf = window.requestAnimationFrame.bind(window);
    (window as any).__slowFrames = ms;
    window.requestAnimationFrame = (cb) => {
      const d = (window as any).__slowFrames;
      return d ? (setTimeout(() => raf(cb), d) as unknown as number) : raf(cb);
    };
  }, ms);
}

test.describe('Schnell tippen nach dem Anlegen', () => {
  test.beforeEach(async ({ page }) => {
    // Tiptap fokussierte erst im nächsten Bild: ruckelnde Bilder machen das Zeitfenster sicher nachstellbar
    await slowFrames(page, 60);
    await openOffline(page);
  });

  for (const via of ['knopf', 'taste'] as const) {
    for (const delay of [0, 20]) {
      test(`Notiz über ${via === 'knopf' ? 'Werkzeugknopf' : 'N'}, ${delay} ms: Text vollständig und in Reihenfolge`, async ({ page }) => {
        for (let i = 0; i < 6; i++) {
          await page.keyboard.press('Escape');
          if (via === 'knopf') await page.click('[data-tool="sticky"]');
          else await page.keyboard.press('n');
          await page.mouse.move(420 + (i % 3) * 260, 300 + Math.floor(i / 3) * 260);
          await page.mouse.down();
          await page.mouse.up();
          await page.keyboard.type('hallo welt', { delay });
          await expect(page.locator('.sticky-text.editing')).toBeFocused();
          await expect(page.getByText(/Wird gerade auch von/)).toHaveCount(0);
          await page.keyboard.press('Escape');
          const last = (await objects(page)).filter((o) => o.type === 'sticky').at(-1)!;
          expect(last.text).toBe('hallo welt');
        }
      });
    }
  }

  test('Text-Werkzeug über den Knopf, gedrosselte CPU', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Escape');
      await page.click('[data-tool="text"]');
      await page.mouse.move(420 + i * 220, 400);
      await page.mouse.down();
      await page.mouse.up();
      await page.keyboard.type('hallo welt', { delay: 10 });
      await page.keyboard.press('Escape');
      const last = (await objects(page)).filter((o) => o.type === 'text').at(-1)!;
      expect(last.text).toBe('hallo welt');
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  });
});

test.describe('Mausrad bei Browser-Zoom bzw. Pixeldichte', () => {
  for (const dpr of [1, 1.1, 1.5, 1.75, 3]) {
    test.describe(`Pixeldichte ${dpr}`, () => {
      test.use({ deviceScaleFactor: dpr });
      test('drei Rasten zoomen gleich weit (≈ 13 % je Raste)', async ({ page }) => {
        await openOffline(page);
        await page.mouse.move(720, 450);
        const z0 = (await camera(page)).z;
        for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -100);
        await expect.poll(async () => (await camera(page)).z / z0).toBeCloseTo(Math.exp(0.36), 2);
      });
    });
  }
});

test.describe('Griffe, Ziehen, Fenster', () => {
  test.beforeEach(async ({ page }) => openOffline(page));

  test('gedrehtes Objekt: Größengriffe da, Größe entlang der gedrehten Achse, Gegenseite bleibt stehen', async ({ page }) => {
    const id = await objAt(page, 720, 450, { type: 'shape', shape: 'rect', w: 200, h: 100, rotation: 30 });
    await select(page, [id]);
    const handle = page.locator('[data-handle="e"]');
    await expect(handle).toBeVisible();
    await expect(page.locator('[data-handle="se"]')).toBeVisible();
    const o0 = await byId(page, id);
    const point = (o: { x: number; y: number; w: number; h: number }, fx: number, fy: number) => {
      const a = (30 * Math.PI) / 180;
      const cx = o.x + o.w / 2;
      const cy = o.y + o.h / 2;
      const px = o.x + fx * o.w - cx;
      const py = o.y + fy * o.h - cy;
      return { x: cx + px * Math.cos(a) - py * Math.sin(a), y: cy + px * Math.sin(a) + py * Math.cos(a) };
    };
    const w0 = point(o0, 0, 0.5);
    const b = (await handle.boundingBox())!;
    const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const z = (await camera(page)).z;
    // 80 Bildschirmpunkte entlang der gedrehten x-Achse ziehen
    await drag(page, from, { x: from.x + 80 * Math.cos(Math.PI / 6), y: from.y + 80 * Math.sin(Math.PI / 6) });
    const o1 = await byId(page, id);
    expect(o1.w).toBeGreaterThan(200 + 70 / z);
    expect(o1.h).toBe(100);
    expect((o1 as any).rotation).toBe(30);
    const w1 = point(o1, 0, 0.5);
    expect(Math.abs(w1.x - w0.x)).toBeLessThan(1.5);
    expect(Math.abs(w1.y - w0.y)).toBeLessThan(1.5);
    await page.screenshot({ path: 'test-results/input4-rotated-resize.png' });
  });

  test('Fokusverlust beim Ziehen: Objekt klebt nicht am Zeiger', async ({ page }) => {
    const id = await objAt(page, 600, 400);
    const o0 = await byId(page, id);
    await page.mouse.move(600, 400);
    await page.mouse.down();
    await page.mouse.move(700, 450, { steps: 5 });
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(50);
    const after = await byId(page, id);
    await page.mouse.move(900, 600, { steps: 5 });
    await page.mouse.up();
    const end = await byId(page, id);
    expect(end.x).toBe(after.x);
    expect(end.y).toBe(after.y);
    // die Verschiebung bis zum Fokusverlust bleibt
    expect(after.x).not.toBe(o0.x);
  });

  test('Maustaste außerhalb losgelassen (buttons = 0): Geste endet', async ({ page }) => {
    const id = await objAt(page, 600, 400);
    await page.mouse.move(600, 400);
    await page.mouse.down();
    await page.mouse.move(680, 440, { steps: 5 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 450, button: 'none', buttons: 0 });
    await page.waitForTimeout(50);
    const after = await byId(page, id);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 650, button: 'none', buttons: 0 });
    await page.waitForTimeout(50);
    const end = await byId(page, id);
    expect(end.x).toBe(after.x);
    expect(end.y).toBe(after.y);
    await page.mouse.up();
  });

  test('Fenstergröße ändern: die Bildmitte bleibt stehen', async ({ page }) => {
    const id = await objAt(page, 720, 450);
    await page.setViewportSize({ width: 1000, height: 700 });
    await expect.poll(async () => Math.round((await centerOf(page, id)).x)).toBe(500);
    expect(Math.round((await centerOf(page, id)).y)).toBe(350);
  });

  test('Umschalt beim Ziehen sperrt die Richtung', async ({ page }) => {
    const id = await objAt(page, 600, 400);
    const o0 = await byId(page, id);
    await page.mouse.move(600, 400);
    await page.mouse.down();
    await page.keyboard.down('Shift');
    await page.mouse.move(800, 437, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const o1 = await byId(page, id);
    expect(o1.y).toBe(o0.y);
    expect(o1.x - o0.x).toBeGreaterThan(150);
  });

  test('Objekt an den Rand ziehen schwenkt die Ansicht mit', async ({ page }) => {
    const id = await objAt(page, 1100, 450);
    const o0 = await byId(page, id);
    const c0 = await camera(page);
    await page.mouse.move(1100, 450);
    await page.mouse.down();
    await page.mouse.move(1436, 450, { steps: 10 });
    await page.waitForTimeout(600);
    await page.mouse.up();
    const c1 = await camera(page);
    const o1 = await byId(page, id);
    expect(c0.x - c1.x).toBeGreaterThan(80);
    // Objekt ist weiter gewandert als der Zeiger allein (Weg + Schwenk)
    expect(o1.x - o0.x).toBeGreaterThan((336 + 80) / c0.z);
    // ohne Ziehen: kein Schwenken
    await page.mouse.move(1436, 300);
    await page.waitForTimeout(300);
    expect((await camera(page)).x).toBe(c1.x);
  });

  test('Tab bzw. Umschalt+Tab legen die neue Notiz auf freien Platz', async ({ page }) => {
    await page.keyboard.press('n');
    await page.mouse.click(400, 400);
    await page.keyboard.type('A');
    await page.keyboard.press('Tab');
    await page.keyboard.type('B');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const a = (await objects(page)).find((o) => o.text === 'A')!;
    const ca = await centerOf(page, a.id);
    await page.mouse.dblclick(ca.x, ca.y);
    await page.keyboard.press('Tab');
    await page.keyboard.type('C');
    await page.keyboard.press('Escape');
    const b0 = (await objects(page)).find((o) => o.text === 'B')!;
    const cb = await centerOf(page, b0.id);
    await page.mouse.dblclick(cb.x, cb.y);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.type('D');
    await page.keyboard.press('Escape');
    const all = (await objects(page)).filter((o) => o.type === 'sticky');
    expect(all.map((o) => o.text).sort()).toEqual(['A', 'B', 'C', 'D']);
    // keine zwei Notizen überlappen
    for (const p of all)
      for (const q of all)
        if (p.id !== q.id) expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h, `${p.text}/${q.text}`).toBe(false);
    const c = all.find((o) => o.text === 'C')!;
    const b = all.find((o) => o.text === 'B')!;
    expect(c.y).toBe(b.y);
    expect(c.x).toBeGreaterThan(b.x);
    await page.screenshot({ path: 'test-results/input4-tab.png' });
  });

  test('Umschalt 0 setzt den Zoom auf 100 %, Zoom-Menü an der Prozentanzeige', async ({ page }) => {
    await page.getByRole('button', { name: 'Vergrößern' }).click();
    await expect(page.getByTestId('zoom-value')).toHaveText('125 %');
    await page.keyboard.press('Shift+Digit0');
    await expect(page.getByTestId('zoom-value')).toHaveText('100 %');
    await page.getByTestId('zoom-value').click();
    await page.getByRole('menuitem', { name: /^200 %/ }).click();
    await expect(page.getByTestId('zoom-value')).toHaveText('200 %');
    await page.getByTestId('zoom-value').click();
    await page.getByRole('menuitem', { name: /^50 %/ }).click();
    await expect(page.getByTestId('zoom-value')).toHaveText('50 %');
    await page.getByTestId('zoom-value').click();
    await expect(page.getByRole('menuitem', { name: /Alles einpassen/ })).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/input4-zoom-menu.png' });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    // Umschalt 0 auf einer ausgewählten Notiz tippt (wie „=“ auf deutscher Tastatur), statt zu zoomen
    const id = await objAt(page, 700, 450);
    await select(page, [id]);
    await page.keyboard.press('Shift+Digit0');
    await expect(page.locator('.sticky-text.editing')).toBeFocused();
  });
});

test.describe('Touch und Stift', () => {
  test.use({ viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  type TP = { x: number; y: number; id?: number };
  // eine CDP-Sitzung je Seite: der Touch-Zustand (begonnene Berührungen) hängt an der Sitzung
  const sessions = new WeakMap<Page, Promise<CDPSession>>();
  const cdpOf = (page: Page) => {
    if (!sessions.has(page)) sessions.set(page, page.context().newCDPSession(page));
    return sessions.get(page)!;
  };
  const touch = async (page: Page, type: 'touchStart' | 'touchMove' | 'touchEnd', pts: TP[]) => {
    await (await cdpOf(page)).send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })) });
  };

  test('Pinch über der Werkzeugleiste zoomt nicht die Seite', async ({ page }) => {
    await openOffline(page);
    const tb = (await page.getByRole('navigation', { name: 'Werkzeuge' }).boundingBox())!;
    const cx = tb.x + tb.width / 2;
    const cy = tb.y + tb.height / 2;
    await touch(page, 'touchStart', [{ x: cx, y: cy - 10 }, { x: cx, y: cy + 10 }]);
    for (let i = 1; i <= 10; i++) await touch(page, 'touchMove', [{ x: cx, y: cy - 10 - i * 15 }, { x: cx, y: cy + 10 + i * 15 }]);
    await touch(page, 'touchEnd', []);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  });

  test('Griffe haben eine große Trefferfläche (Eckgriff 14 px daneben greifen)', async ({ page }) => {
    await openOffline(page);
    const id = await objAt(page, 384, 500);
    await select(page, [id]);
    const h = (await page.locator('[data-handle="se"]').boundingBox())!;
    const o0 = await byId(page, id);
    const x = h.x + h.width / 2 - 14;
    const y = h.y + h.height / 2 - 14;
    await touch(page, 'touchStart', [{ x, y }]);
    for (let i = 1; i <= 8; i++) await touch(page, 'touchMove', [{ x: x + i * 6, y: y + i * 6 }]);
    await touch(page, 'touchEnd', []);
    const o1 = await byId(page, id);
    expect(o1.w).toBeGreaterThan(o0.w + 20);
    expect(o1.x).toBe(o0.x);
  });

  test('Stift zeichnet, aufliegender Handballen zoomt und schwenkt nicht', async ({ page }) => {
    await openOffline(page);
    await page.evaluate(() => (window as any).__stachel.api().setTool('pen'));
    const c0 = await camera(page);
    const cdp = await cdpOf(page);
    const pen = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', x: number, y: number) =>
      cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'pen' });
    await pen('mousePressed', 300, 400);
    await pen('mouseMoved', 320, 410);
    // Handballen legt sich auf und bewegt sich
    await touch(page, 'touchStart', [{ x: 600, y: 800, id: 7 }]);
    for (let i = 1; i <= 6; i++) {
      await pen('mouseMoved', 320 + i * 20, 410 + i * 5);
      await touch(page, 'touchMove', [{ x: 600 + i * 25, y: 800 - i * 20, id: 7 }]);
    }
    await pen('mouseReleased', 460, 440);
    await touch(page, 'touchEnd', []);
    expect(await camera(page)).toEqual(c0);
    expect((await objects(page)).filter((o) => o.type === 'pen')).toHaveLength(1);
    // Handballen zuerst, dann der Stift: das Schwenken des Ballens wird zurückgenommen
    await touch(page, 'touchStart', [{ x: 600, y: 800, id: 8 }]);
    await touch(page, 'touchMove', [{ x: 650, y: 760, id: 8 }]);
    await pen('mousePressed', 300, 500);
    await pen('mouseMoved', 400, 520);
    await touch(page, 'touchMove', [{ x: 700, y: 700, id: 8 }]);
    await pen('mouseReleased', 420, 530);
    await touch(page, 'touchEnd', []);
    expect(await camera(page)).toEqual(c0);
    expect((await objects(page)).filter((o) => o.type === 'pen')).toHaveLength(2);
  });

  test('Präsentation: Wischen und Tippen blättern durch die Rahmen', async ({ page }) => {
    await openOffline(page);
    await page.evaluate(() => {
      const s = (window as any).__stachel.store;
      s.create({ type: 'frame', x: 0, y: 0, w: 800, h: 600, title: 'Eins' });
      s.create({ type: 'frame', x: 1000, y: 0, w: 800, h: 600, title: 'Zwei' });
      s.create({ type: 'frame', x: 2000, y: 0, w: 800, h: 600, title: 'Drei' });
    });
    await page.getByRole('button', { name: 'Rahmen-Liste' }).tap();
    await page.getByRole('button', { name: /Präsentieren/ }).tap();
    const pos = page.getByTestId('present-pos');
    await expect(pos).toHaveText('1 / 3');
    const swipe = async (from: number, to: number) => {
      await touch(page, 'touchStart', [{ x: from, y: 500 }]);
      for (let i = 1; i <= 6; i++) await touch(page, 'touchMove', [{ x: from + ((to - from) * i) / 6, y: 500 + i }]);
      await touch(page, 'touchEnd', []);
    };
    await swipe(600, 200);
    await expect(pos).toHaveText('2 / 3');
    await swipe(200, 600);
    await expect(pos).toHaveText('1 / 3');
    // Tippen rechts weiter, links zurück
    await page.touchscreen.tap(700, 500);
    await expect(pos).toHaveText('2 / 3');
    await page.touchscreen.tap(60, 500);
    await expect(pos).toHaveText('1 / 3');
  });
});
