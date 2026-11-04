// Handy (hochkant/quer), Verbindungshinweise und Screenshots der Seiten (docs/screenshots/pages-*.png).
import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { installFakeApi, sampleBoards } from './fakeApi';

const OUT = path.resolve(import.meta.dirname, '../../docs/screenshots');
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `pages-${name}.png`) });

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const PHONE_LANDSCAPE = { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

type Box = { x: number; y: number; width: number; height: number };
const box = async (l: Locator): Promise<Box> => (await l.boundingBox())!;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: Box, w: number, h: number) => a.x >= 0 && a.y >= 0 && a.x + a.width <= w + 0.5 && a.y + a.height <= h + 0.5;

async function tap(page: Page, l: Locator) {
  const b = await box(l);
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}

test.describe('Handy: Anmeldung', () => {
  test.use(PHONE);

  test('Passwort zuerst, QR erst auf Wunsch (und erst dann Long-Poll)', async ({ page }) => {
    const state = await installFakeApi(page);
    await page.goto('/');
    const heading = page.getByRole('heading', { name: 'Benutzername & Passwort' });
    await expect(heading).toBeInViewport();
    await expect(page.getByLabel('Benutzername', { exact: true })).toBeInViewport();
    await expect(page.getByRole('img', { name: 'QR-Code zum Anmelden' })).toHaveCount(0);
    await page.waitForTimeout(800);
    expect(state.qrStarts).toBe(0);
    await page.waitForTimeout(200);
    await shot(page, 'handy-anmeldung');

    // Modul tools: erst „Mit der {App}“ (Knopf „In der {App} öffnen“), der QR-Code nur auf Wunsch
    await page.getByRole('button', { name: /Mit der Musterverein-App/ }).click();
    const toggle = page.getByRole('button', { name: 'QR-Code hier zeigen' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    const hide = page.getByRole('button', { name: 'QR-Code ausblenden' });
    await expect(hide).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('img', { name: 'QR-Code zum Anmelden' })).toBeVisible();
    await expect.poll(() => state.qrStarts).toBe(1);
    await page.getByRole('img', { name: 'QR-Code zum Anmelden' }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    await shot(page, 'handy-anmeldung-qr');
    await hide.click();
    await expect(page.getByRole('img', { name: 'QR-Code zum Anmelden' })).toHaveCount(0);

    // Passwort-Login funktioniert wie am Desktop
    await page.getByLabel('Benutzername', { exact: true }).fill('orga');
    await page.getByLabel('Passwort', { exact: true }).fill('geheim');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Boards' })).toBeVisible();
  });
});

test.describe('Handy: Board-Übersicht', () => {
  test.use(PHONE);

  test('Suche und Reihenfolge passen auf 390 px, Menü zeigt den Löschgrund', async ({ page }) => {
    await installFakeApi(page, { loggedIn: true, boards: sampleBoards(), user: { key: 'm:99', name: 'Gast Gärtner', isOrga: false } });
    await page.goto('/');
    await expect(page.locator('.board-card__title')).toHaveCount(5);
    for (const l of [page.getByRole('searchbox'), page.getByRole('radiogroup', { name: 'Reihenfolge' })]) expect(inside(await box(l), 390, 10_000)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.waitForTimeout(700);
    await shot(page, 'handy-boards');
    await page.getByRole('searchbox').fill('lage');
    await page.locator('.board-card').first().getByRole('button', { name: 'Board-Aktionen' }).click();
    await expect(page.locator('.board-menu__reason')).toBeVisible();
    await page.waitForTimeout(250);
    await shot(page, 'handy-boards-suche-menue');
  });
});

for (const v of [
  { name: 'hochkant', opts: PHONE },
  { name: 'quer', opts: PHONE_LANDSCAPE },
]) {
  test.describe(`Handy ${v.name}: Editor`, () => {
    test.use(v.opts);

    test('Werkzeugleiste unten, nichts ragt heraus oder überdeckt sich', async ({ page }) => {
      const { width: W, height: H } = v.opts.viewport;
      await page.goto('/?offline=1&demo=1');
      await expect(page.locator('[data-id="demo-s1"]')).toBeVisible();
      const toolbar = page.getByRole('navigation', { name: 'Werkzeuge' });
      const tb = await box(toolbar);
      expect(inside(tb, W, H), `Werkzeugleiste ${JSON.stringify(tb)}`).toBe(true);
      expect(tb.height).toBeLessThanOrEqual(56);
      expect(tb.y + tb.height).toBeGreaterThan(H - 70); // unten
      for (const sel of ['.topbar--left', '.topbar--right', '.history', '.bottom-right']) {
        const b = await box(page.locator(sel));
        expect(inside(b, W, H), sel).toBe(true);
        expect(overlaps(b, tb), `${sel} überdeckt die Werkzeugleiste`).toBe(false);
      }
      expect(overlaps(await box(page.locator('.history')), await box(page.locator('.topbar--left')))).toBe(false);
      // alle Werkzeuge erreichbar, auch Rahmen und Bild
      for (const t of ['select', 'sticky', 'text', 'shape', 'connector', 'pen', 'frame', 'image']) {
        const b = await box(page.locator(`[data-tool="${t}"]`));
        expect(inside(b, W, H), t).toBe(true);
        expect(b.width).toBeGreaterThanOrEqual(30);
      }
      await page.waitForTimeout(300);
      await shot(page, `handy-${v.name}-editor`);

      // Werkzeug-Optionen erscheinen über der Leiste und bleiben im Bild
      await tap(page, page.locator('[data-tool="pen"]'));
      const fly = page.getByRole('group', { name: 'Werkzeug-Optionen' });
      await expect(fly).toBeVisible();
      const fb = await box(fly);
      expect(inside(fb, W, H), `Optionen ${JSON.stringify(fb)}`).toBe(true);
      expect(fb.y + fb.height).toBeLessThanOrEqual(tb.y);
      await page.waitForTimeout(200);
      await shot(page, `handy-${v.name}-werkzeug-optionen`);
      await tap(page, page.locator('[data-tool="select"]'));

      // Auswahl: Kontextleiste vollständig sichtbar; hochkant ersetzt sie die Werkzeugleiste
      await tap(page, page.locator('[data-id="demo-s3"]'));
      const ctx = page.getByRole('toolbar', { name: 'Auswahl bearbeiten' });
      await expect(ctx).toBeVisible();
      const cb = await box(ctx);
      expect(inside(cb, W, H), `Kontextleiste ${JSON.stringify(cb)}`).toBe(true);
      if (W < 700) {
        await expect(toolbar).toBeHidden();
        expect(cb.y + cb.height).toBeGreaterThan(H - 70);
      }
      await page.waitForTimeout(250);
      await shot(page, `handy-${v.name}-auswahl`);
    });
  });
}

test.describe('Verbindungshinweise (ui/ConnectionNotice)', () => {
  async function mount(page: Page) {
    // über dem echten (leeren) Editor, so wie es in EditorPage eingehängt würde
    await page.goto('/?offline=1');
    await expect(page.getByTestId('board')).toBeVisible();
    await page.evaluate(async () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const p = '/src/ui/ConnectionNotice.harness.tsx';
      const m = await import(/* @vite-ignore */ p);
      (window as any).__cn = m.mountConnectionNotice(el);
    });
  }
  const setStatus = (page: Page, s: string) => page.evaluate((st) => (window as any).__cn.setStatus(st), s);

  test('Laden statt „Leeres Board", Band bei Verbindungsverlust, „Wieder verbunden", Rückfrage beim Schließen', async ({ page }) => {
    await mount(page);
    await expect(page.getByTestId('board-loading')).toContainText('Board wird geladen');
    await page.waitForTimeout(400);
    await shot(page, 'editor-laedt');
    // Anlegen gesperrt: die Fläche nimmt keine Klicks an
    expect(await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('[data-testid="board-loading"]') !== null)).toBe(true);
    await setStatus(page, 'offline');
    await expect(page.getByTestId('board-loading')).toContainText('Der Server antwortet noch nicht');

    await setStatus(page, 'connected');
    await expect(page.getByTestId('board-loading')).toHaveCount(0);
    await expect(page.getByTestId('conn-banner')).toHaveCount(0);

    // kurzer Aussetzer: kein Band, kein Toast
    await setStatus(page, 'offline');
    await page.waitForTimeout(400);
    await setStatus(page, 'connected');
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('conn-banner')).toHaveCount(0);
    await expect(page.getByTestId('conn-back')).toHaveCount(0);

    // längerer Ausfall mit eigener Änderung
    await setStatus(page, 'offline');
    await expect(page.getByTestId('conn-banner')).toContainText('Keine Verbindung – deine Änderungen werden gespeichert, sobald du wieder online bist.');
    await page.evaluate(() => (window as any).__cn.localEdit());
    await shot(page, 'editor-offline-band');
    const prevented = await page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(true);

    await setStatus(page, 'connecting');
    await expect(page.getByTestId('conn-banner')).toBeVisible();
    await setStatus(page, 'connected');
    await expect(page.getByTestId('conn-banner')).toHaveCount(0);
    await expect(page.getByTestId('conn-back')).toHaveText('Wieder verbunden');
    await expect(page.getByTestId('conn-back')).toHaveCount(0, { timeout: 6000 });
    const after = await page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(after).toBe(false);
  });
});

test.describe('Desktop: Seiten', () => {
  test('Board-Übersicht mit Suche, Fehler und Vorschaubild', async ({ page }) => {
    await installFakeApi(page, { loggedIn: true, boards: sampleBoards() });
    await page.goto('/');
    await expect(page.locator('.board-card__title')).toHaveCount(5);
    await page.evaluate(async () => {
      const p = '/src/ui/thumbs.ts';
      const m = await import(/* @vite-ignore */ p);
      const o = (id: string, type: string, x: number, y: number, w: number, h: number, extra = {}) => ({ id, type, x, y, w, h, z: 'a0', createdBy: 'm:1', updatedAt: '', ...extra });
      m.saveThumb(
        'b-plan',
        m.renderThumb([
          o('f1', 'frame', 0, 0, 1000, 460),
          o('s1', 'shape', 40, 50, 160, 70, { shape: 'rect', text: 'Aufbau' }),
          o('s2', 'shape', 260, 30, 140, 110, { shape: 'diamond', color: '#c9e14a' }),
          o('s3', 'shape', 460, 50, 160, 70, { shape: 'ellipse' }),
          o('s4', 'shape', 680, 50, 160, 70, { shape: 'rect', color: '#000000' }),
          o('k1', 'connector', 0, 0, 0, 0, { from: { objectId: 's1' }, to: { objectId: 's2' } }),
          o('k2', 'connector', 0, 0, 0, 0, { from: { objectId: 's2' }, to: { objectId: 's3' } }),
          o('k3', 'connector', 0, 0, 0, 0, { from: { objectId: 's3' }, to: { objectId: 's4' } }),
          o('n1', 'sticky', 40, 200, 180, 180, { color: '#fff27a', text: 'a' }),
          o('n2', 'sticky', 250, 200, 180, 180, { color: '#ffb3d1', text: 'b' }),
          o('n3', 'sticky', 460, 200, 180, 180, { color: '#c9e14a', text: 'c' }),
          o('n4', 'sticky', 670, 200, 180, 180, { color: '#9fd3ff', text: 'd' }),
        ]),
      );
      m.saveThumb(
        'b-ideen',
        m.renderThumb([
          o('a', 'sticky', 0, 0, 200, 200, { color: '#ffd08a', text: 'x' }),
          o('b', 'sticky', 220, 0, 200, 200, { color: '#e2d5ff', text: 'y' }),
          o('c', 'sticky', 440, 0, 200, 200, { color: '#ffffff', text: 'z' }),
          o('d', 'sticky', 0, 220, 200, 200, { color: '#c9e14a', text: 'x' }),
          o('e', 'sticky', 220, 220, 200, 200, { color: '#fff27a', text: '' }),
          o('p', 'pen', 120, 160, 400, 120, { color: '#ec4e92', strokeWidth: 4, points: [0, 60, 80, 0, 200, 110, 320, 10, 400, 70] }),
        ]),
      );
    });
    await page.reload();
    await expect(page.getByTestId('board-thumb-img')).toHaveCount(2);
    await page.waitForTimeout(800);
    await shot(page, 'desktop-boards');
    await page.getByRole('searchbox', { name: 'Boards durchsuchen' }).fill('sommerfest');
    await page.waitForTimeout(300);
    await shot(page, 'desktop-boards-suche');
    await page.getByRole('searchbox', { name: 'Boards durchsuchen' }).fill('Zirkus');
    await page.waitForTimeout(200);
    await shot(page, 'desktop-boards-keine-treffer');
    await page.getByRole('button', { name: 'Suche löschen' }).click();
    await page.locator('.board-card').nth(1).getByRole('button', { name: 'Board-Aktionen' }).click();
    await page.waitForTimeout(200);
    await shot(page, 'desktop-boards-menue');
  });

  test('Fehlerzustand mit „Nochmal versuchen"', async ({ page }) => {
    await installFakeApi(page, { loggedIn: true, boards: sampleBoards() });
    await page.route('**/api/boards', (route) =>
      route.request().method() === 'GET' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"error":"server","message":"x"}' }) : route.fallback(),
    );
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Nochmal versuchen' })).toBeVisible();
    await page.waitForTimeout(300);
    await shot(page, 'desktop-boards-fehler');
  });
});
