// Bedienung (UX-Review): Kürzel, Radierer, Umschalt beim Größe ändern, App-Sitzung abgelaufen.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { installFakeApi, sampleBoards } from './fakeApi';
import { camera, drag, objects, openOffline, selection, type Obj } from './helpers';

const SHOTS = path.resolve(import.meta.dirname, '../test-results/ux');
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

/** Objekte direkt im Store anlegen (Weltkoordinaten; bei Kamera 100 % liegt (0,0) in der Bildmitte 720/450). */
const create = (page: Page, list: Record<string, unknown>[]): Promise<string[]> =>
  page.evaluate((l) => (window as any).__stachel.store.createMany(l), list);
const S = (x: number, y: number) => ({ x: x + 720, y: y + 450 });
const tool = (page: Page) => page.evaluate(() => (window as any).__stachel.api().tool());
const get = async (page: Page, id: string) => (await objects(page)).find((o) => o.id === id) as (Obj & Record<string, any>) | undefined;
const note = (x: number, y: number, extra: Record<string, unknown> = {}) => ({ type: 'sticky', x, y, w: 200, h: 200, color: '#fff27a', text: '', ...extra });

test.describe('Editor', () => {
  test.beforeEach(async ({ page }) => {
    await openOffline(page);
  });

  test('+ und − zoomen ohne Strg, auf einer ausgewählten Notiz wird + getippt', async ({ page }) => {
    await page.mouse.click(700, 450);
    expect((await camera(page)).z).toBe(1);
    await page.keyboard.press('+');
    const zIn = (await camera(page)).z;
    expect(zIn).toBeGreaterThan(1);
    await page.keyboard.press('-');
    await page.keyboard.press('-');
    expect((await camera(page)).z).toBeLessThan(1);
    // Notiz ausgewählt: „+“ beginnt die Bearbeitung mit dem Zeichen statt zu zoomen
    const [a] = await create(page, [note(-100, -100)]);
    const z = (await camera(page)).z;
    await page.evaluate((id) => (window as any).__stachel.api().setSelection([id]), a);
    await page.keyboard.press('+');
    await expect(page.locator('.editing')).toBeFocused();
    await page.keyboard.press('Escape');
    expect((await camera(page)).z).toBe(z);
    expect((await get(page, a))!.text).toBe('+');
  });

  test('Werkzeug-Taste wechselt auch bei Mehrfachauswahl von Notizen', async ({ page }) => {
    await create(page, [note(-300, -100), note(100, -100)]);
    await page.mouse.click(5, 450);
    await page.keyboard.press('Control+a');
    expect(await selection(page)).toHaveLength(2);
    await page.keyboard.press('n');
    expect(await tool(page)).toBe('sticky');
    expect(await selection(page)).toHaveLength(0);
    // Esc bei aktivem Werkzeug schaltet zurück auf Auswählen
    await page.keyboard.press('Escape');
    expect(await tool(page)).toBe('select');
    // eine einzelne Notiz: Taste wird getippt
    const id = (await objects(page))[0].id;
    await page.evaluate((i) => (window as any).__stachel.api().setSelection([i]), id);
    // api.setSelection außerhalb eines Ereignisses rendert React nachrangig; eine sofort gesendete Taste sähe sonst noch
    // die leere Auswahl und schaltete wieder auf Haftnotiz um (per Klick ausgewählt rendert React sofort)
    await expect.poll(() => selection(page)).toEqual([id]);
    await page.keyboard.press('n');
    // erst wenn die Bearbeitung steht (Rich-Text lädt nach); sofortiges Esc s. Bericht
    await expect(page.locator('.editing')).toBeFocused();
    await page.keyboard.press('Escape');
    expect(await tool(page)).toBe('select');
    expect((await get(page, id))!.text).toBe('n');
  });

  test('Umschalt erst während des Ziehens gedrückt hält das Seitenverhältnis', async ({ page }) => {
    const [id] = await create(page, [{ type: 'shape', shape: 'rect', x: -100, y: -50, w: 200, h: 100, color: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2, text: '' }]);
    await page.mouse.click(S(0, 0).x, S(0, 0).y);
    const hb = (await page.locator('[data-handle="se"]').boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 40, hb.y + 10, { steps: 3 });
    await page.keyboard.down('Shift');
    await page.mouse.move(hb.x + 200, hb.y + 20, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const r = (await get(page, id))!;
    expect(r.w).toBeGreaterThan(300);
    expect(Math.abs(r.w / r.h - 2)).toBeLessThan(0.05);
  });

  test('Radierer (E) löscht überfahrene Stiftstriche, Strg Z holt sie zurück', async ({ page }) => {
    // zwei Striche: einer waagerecht durch y=0, einer weiter unten; dazu eine Notiz, die bleiben muss
    const [p1, p2, n] = await create(page, [
      { type: 'pen', x: -200, y: -2, w: 400, h: 4, points: [2, 2, 398, 2], color: '#0a0a0a', strokeWidth: 4 },
      { type: 'pen', x: -200, y: 198, w: 400, h: 4, points: [2, 2, 398, 2], color: '#0a0a0a', strokeWidth: 4 },
      note(250, -250),
    ]);
    await page.mouse.click(5, 450);
    await page.keyboard.press('e');
    expect(await tool(page)).toBe('eraser');
    await expect(page.getByRole('group', { name: 'Werkzeug-Optionen' })).toBeVisible();
    // senkrecht durch den ersten Strich ziehen, schnell (wenige Schritte)
    await page.mouse.move(S(0, -60).x, S(0, -60).y);
    await page.mouse.down();
    await page.mouse.move(S(0, 60).x, S(0, 60).y, { steps: 2 });
    await page.waitForTimeout(100);
    await shot(page, 'radierer');
    // zweiter Strich wird nicht berührt → bleibt
    await page.mouse.move(S(150, 120).x, S(150, 120).y, { steps: 2 });
    await page.mouse.up();
    const ids = (await objects(page)).map((o) => o.id);
    expect(ids).not.toContain(p1);
    expect(ids).toContain(p2);
    expect(ids).toContain(n);
    // über die Notiz radieren löscht sie nicht
    await drag(page, S(260, -240), S(440, -60));
    expect((await objects(page)).map((o) => o.id)).toContain(n);
    await page.keyboard.press('Control+z');
    expect((await objects(page)).map((o) => o.id)).toContain(p1);
  });
});

test.describe('Lasso und Mausrad', () => {
  test.beforeEach(async ({ page }) => {
    await openOffline(page);
  });

  /** Freihand-Schleife um einen Weltbereich ziehen (Bildschirm = Welt + Bildmitte bei 100 %). */
  async function loop(page: Page, x1: number, y1: number, x2: number, y2: number, mod = false) {
    const pts = [S(x1, y1), S(x2, y1), S(x2, y2), S(x1, y2), S(x1, y1 + 10)];
    if (mod) await page.keyboard.down('Control');
    await page.mouse.move(pts[0].x, pts[0].y);
    await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 6 });
    await page.mouse.up();
    if (mod) await page.keyboard.up('Control');
  }

  test('Lasso über die Werkzeug-Option: nur komplett umschlossene Objekte', async ({ page }) => {
    const [a, b] = await create(page, [note(-300, -100, { w: 150, h: 150 }), note(50, -100, { w: 150, h: 150 })]);
    // Optionen erst beim zweiten Klick auf das aktive Auswahl-Werkzeug
    await expect(page.getByRole('group', { name: 'Werkzeug-Optionen' })).toHaveCount(0);
    await page.locator('[data-tool="select"]').click();
    await page.getByRole('button', { name: 'Lasso-Auswahl' }).click();
    await expect(page.getByRole('group', { name: 'Werkzeug-Optionen' })).toHaveCount(0);
    // A ganz, B nur halb umschlossen
    await loop(page, -330, -130, 120, 80);
    expect(await selection(page)).toEqual([a]);
    // Strg kehrt um: Rechteck schneidet B → ausgewählt
    await page.keyboard.press('Escape');
    await page.keyboard.down('Control');
    await drag(page, S(100, -200), S(120, 0));
    await page.keyboard.up('Control');
    expect(await selection(page)).toEqual([b]);
    // zurück auf Rechteck
    await page.locator('[data-tool="select"]').click();
    await page.getByRole('button', { name: 'Rechteck-Auswahl' }).click();
    await drag(page, S(-400, -300), S(400, 300));
    expect((await selection(page)).sort()).toEqual([a, b].sort());
  });

  test('Strg + Ziehen zieht ein Lasso, die Spur ist sichtbar', async ({ page }) => {
    const [a] = await create(page, [note(-300, -100, { w: 150, h: 150 }), note(50, -100, { w: 150, h: 150 })]);
    await page.keyboard.down('Control');
    await page.mouse.move(S(-330, -130).x, S(-330, -130).y);
    await page.mouse.down();
    await page.mouse.move(S(-120, -130).x, S(-120, -130).y, { steps: 5 });
    await page.mouse.move(S(-120, 80).x, S(-120, 80).y, { steps: 5 });
    await expect(page.getByTestId('lasso')).toBeVisible();
    await shot(page, 'lasso');
    await page.mouse.move(S(-330, 80).x, S(-330, 80).y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    await expect(page.getByTestId('lasso')).toHaveCount(0);
    expect(await selection(page)).toEqual([a]);
  });

  test('Mausrad zoomt, Trackpad verschiebt, Einstellung „Schwenken“ bleibt gespeichert', async ({ page }) => {
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, -100);
    const z1 = (await camera(page)).z;
    expect(z1).toBeGreaterThan(1.05);
    // Punkt unter dem Zeiger bleibt stehen: Kamera-Ursprung bleibt bei der Bildmitte
    const c1 = await camera(page);
    expect(Math.abs(c1.x - 720)).toBeLessThan(1);
    // Trackpad: kleine gebrochene Werte mit deltaX verschieben
    await page.waitForTimeout(300);
    const pad = (dx: number, dy: number) =>
      page.evaluate(
        ([x, y]) => document.querySelector('[data-testid="board"]')!.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 700, clientY: 400, deltaX: x, deltaY: y })),
        [dx, dy],
      );
    await pad(3.5, 8.25);
    const c2 = await camera(page);
    expect(c2.z).toBe(z1);
    expect(c2.y).toBeCloseTo(c1.y - 8.25, 1);
    // Umstellen über das Board-Menü
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Board-Menü' }).click();
    await page.getByRole('menuitem', { name: /Mausrad/ }).click();
    expect(await page.evaluate(() => localStorage.getItem('stachel.wheel'))).toBe('pan');
    const c3 = await camera(page);
    await page.mouse.wheel(0, 100);
    const c4 = await camera(page);
    expect(c4.z).toBe(c3.z);
    expect(c4.y).toBeCloseTo(c3.y - 100, 0);
    // in der Kürzel-Übersicht steht die Einstellung ebenfalls und lässt sich zurückstellen
    await page.keyboard.press('?');
    const zoomOpt = page.getByRole('radio', { name: 'Zoomen' });
    await expect(page.getByRole('radio', { name: 'Schwenken' })).toHaveAttribute('aria-checked', 'true');
    await shot(page, 'mausrad-einstellung');
    await zoomOpt.click();
    await expect(zoomOpt).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => localStorage.getItem('stachel.wheel'))).toBe('zoom');
  });
});

test.describe('Handy: Startansicht', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('erster Aufruf nicht unter 35 %, Rahmentitel verdecken keinen Inhalt', async ({ page }) => {
    await page.goto('/?offline=1&demo=1');
    await expect(page.locator('[data-id="demo-s1"]')).toBeVisible();
    const z = (await camera(page)).z;
    expect(z).toBeGreaterThanOrEqual(0.35);
    // der erste Rahmen beginnt sichtbar am linken Rand
    const left = Math.min(...(await page.locator('.obj-frame').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().x))));
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThan(40);
    await shot(page, 'handy-start');
    // weit herausgezoomt: der große Titel steht über dem Rahmen, nicht darin
    await page.evaluate(() => (window as any).__stachel.setCamera({ x: 60, y: 300, z: 0.15 }));
    const titles = page.locator('.frame-big-title');
    await expect(titles.first()).toBeVisible();
    for (const t of await titles.all()) {
      const id = await t.getAttribute('data-id');
      const tb = (await t.boundingBox())!;
      const fb = (await page.locator(`.obj-frame[data-id="${id}"]`).boundingBox())!;
      expect(tb.y + tb.height).toBeLessThanOrEqual(fb.y + 1);
    }
    await shot(page, 'handy-uebersicht');
  });
});

test.describe('App der Organisation: Sitzung abgelaufen', () => {
  test('Hinweis statt Anmeldeformular, „trotzdem mit Passwort“ zeigt das Formular', async ({ page }) => {
    await installFakeApi(page);
    await page.addInitScript(() => localStorage.setItem('stachel.inApp', '1'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const notice = page.getByTestId('app-session-expired');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Sitzung abgelaufen');
    await expect(notice).toContainText('Musterverein-App');
    await expect(page.getByLabel('Passwort', { exact: true })).toHaveCount(0);
    await shot(page, 'app-sitzung-abgelaufen');
    await page.getByRole('button', { name: 'Trotzdem mit Passwort anmelden' }).click();
    await expect(page.getByLabel('Passwort', { exact: true })).toBeVisible();
  });

  test('ohne App-Kennung bleibt das normale Anmeldeformular', async ({ page }) => {
    await installFakeApi(page);
    await page.goto('/');
    await expect(page.getByLabel('Passwort', { exact: true })).toBeVisible();
    await expect(page.getByTestId('app-session-expired')).toHaveCount(0);
  });

  test('Anmeldung mit ?app=1 merkt sich die App, Abmelden vergisst sie', async ({ page }) => {
    await installFakeApi(page, { loggedIn: true, boards: sampleBoards() });
    await page.goto('/?app=1');
    await expect(page.locator('.board-card__title').first()).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('stachel.inApp'))).toBe('1');
    expect(new URL(page.url()).search).toBe('');
    await page.getByRole('button', { name: 'Abmelden' }).click();
    await expect(page.getByLabel('Passwort', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('stachel.inApp'))).toBeNull();
  });
});

test.describe('Android-WebView', () => {
  test.use({
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36',
  });
  test('fremdes WebView (Instagram, Facebook …) gilt nicht als App der Organisation, nur ?app=1 aus /auth/app', async ({ page }) => {
    await installFakeApi(page, { loggedIn: true, boards: sampleBoards() });
    await page.goto('/');
    await expect(page.locator('.board-card__title').first()).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('stachel.inApp'))).toBeNull();
    await page.goto('/?app=1');
    await expect(page.locator('.board-card__title').first()).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('stachel.inApp'))).toBe('1');
    expect(new URL(page.url()).search).toBe('');
  });
});

test.describe('Handy: Kontextleiste', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('Popover der Kontextleiste ragen nicht aus dem Bildschirm', async ({ page }) => {
    await openOffline(page);
    for (const obj of [note(-100, -100), { type: 'shape', shape: 'rect', x: -100, y: 150, w: 200, h: 100, color: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2, text: 'x' }]) {
      const [id] = await create(page, [obj]);
      await page.evaluate((i) => (window as any).__stachel.api().setSelection([i]), id);
      const bar = page.locator('.ctxbar');
      await expect(bar).toBeVisible();
      const n = await bar.locator('> * [aria-haspopup="true"], > [aria-haspopup="true"]').count();
      expect(n).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) {
        const btn = bar.locator('> * [aria-haspopup="true"], > [aria-haspopup="true"]').nth(i);
        if (!(await btn.isVisible())) continue;
        await btn.click();
        const pop = page.locator('.ctx-pop');
        if (!(await pop.count())) continue;
        const b = (await pop.boundingBox())!;
        expect(b.x, `${await btn.getAttribute('aria-label')}`).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, `${await btn.getAttribute('aria-label')}`).toBeLessThanOrEqual(390);
        await btn.click();
      }
    }
  });
});

test.describe('Desktop-Fensterhöhen', () => {
  for (const [w, h] of [
    [1280, 800],
    [1366, 768],
    [1280, 720],
    [1440, 900],
  ]) {
    test(`${w}×${h}: Werkzeugleiste überdeckt weder Kopfleiste noch Rückgängig-Knöpfe`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openOffline(page);
      const tb = (await page.locator('.toolbar').boundingBox())!;
      const hist = (await page.locator('.history').boundingBox())!;
      const top = (await page.locator('.topbar--left').boundingBox())!;
      expect(tb.y + tb.height).toBeLessThanOrEqual(hist.y);
      expect(tb.y).toBeGreaterThanOrEqual(top.y + top.height);
      // Werkzeug-Optionen sitzen weiter auf Höhe ihres Knopfs
      await page.keyboard.press('n');
      const btn = (await page.locator('.toolbar [data-tool="sticky"]').boundingBox())!;
      const fly = page.locator('.toolbar .flyout');
      if (await fly.count()) expect(Math.abs((await fly.boundingBox())!.y - btn.y)).toBeLessThan(btn.height + 12);
      if (w === 1280 && h === 800) await shot(page, 'werkzeugleiste-1280x800');
    });
  }
});
