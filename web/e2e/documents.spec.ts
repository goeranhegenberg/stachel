// Feature-Modul documents: PDF hochladen (Dateiauswahl, Ablegen, Einfügen), blättern am Objekt, Vollbild, Export der
// aktuellen Seite, „Alle Seiten aufs Board“, Größe ändern – und live mit zwei Browsern (Seitenwechsel für alle,
// fehlende Seiten erzeugt der zweite Browser nach). Test-PDF: e2e/fixtures/drei-seiten.pdf (Seite 1 grün, 2 blau, 3 pink).
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import type { Server } from '@hocuspocus/server';
import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { installFakeApi, sampleBoards, type FakeUser } from './fakeApi';
import { startSyncServer } from './syncServer';
import { objects, openOffline } from './helpers';

const PDF = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/drei-seiten.pdf'));
const OUT = path.resolve(import.meta.dirname, '../../docs/screenshots');
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `documents-${name}.png`) });

/** Farbe des Rechtecks je Seite (fixtures/drei-seiten.pdf) */
const COLOR = { 1: [201, 224, 74], 2: [23, 99, 181], 3: [237, 79, 145] } as const;

const docs = async (page: Page) => (await objects(page)).filter((o) => o.type === 'document') as unknown as Doc[];
interface Doc {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  docPage?: number;
  docCount?: number;
  docPages?: Record<string, string>;
  imageId?: string;
  docName?: string;
  docFile?: string;
}

/** Realistischer Klick (Maus runter/hoch in Schritten) */
async function press(page: Page, target: Locator) {
  const b = (await target.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
  await page.mouse.down();
  await page.mouse.up();
}

/** Farbe der angezeigten Seite des Dokuments (Mitte des Farbrechtecks) */
async function shownColor(page: Page, id: string): Promise<number[]> {
  const img = page.locator(`[data-id="${id}"] .documents-sheet img:not(.is-loading)`);
  await expect(img).toBeVisible();
  return img.evaluate(async (el: HTMLImageElement) => {
    await el.decode().catch(() => {});
    const c = document.createElement('canvas');
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    const g = c.getContext('2d')!;
    g.drawImage(el, 0, 0);
    return [...g.getImageData(Math.round(c.width * 0.5), Math.round(c.height * 0.7), 1, 1).data].slice(0, 3);
  });
}
const near = (a: number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]) < 24);
async function expectPageShown(page: Page, id: string, n: 1 | 2 | 3) {
  await expect.poll(async () => near(await shownColor(page, id), COLOR[n]), { timeout: 15_000 }).toBe(true);
}

const pager = (page: Page, id: string) => page.locator(`.documents-ctl[data-doc="${id}"] .documents-pager`);

test.describe('PDF (offline)', () => {
  test.beforeEach(async ({ page }) => {
    await openOffline(page);
  });

  test('hochladen, blättern, Vollbild, alle Seiten aufs Board, Größe ändern', async ({ page }) => {
    await page.getByTestId('image-input').setInputFiles({ name: 'Ablaufplan 2027.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect.poll(async () => (await docs(page)).length, { timeout: 20_000 }).toBe(1);
    const d = (await docs(page))[0];
    expect(d).toMatchObject({ docCount: 3, docPage: 0, docName: 'Ablaufplan 2027.pdf' });
    expect(d.h / d.w).toBeCloseTo(842 / 595, 1);
    expect(d.imageId).toBe(d.docPages!['0']);
    // übrige Seiten kommen im Hintergrund
    await expect.poll(async () => Object.keys((await docs(page))[0].docPages ?? {}).length, { timeout: 20_000 }).toBe(3);
    await expectPageShown(page, d.id, 1);
    await expect(pager(page, d.id).getByTestId('documents-page')).toHaveText('1 / 3');
    await expect(page.locator(`.documents-ctl[data-doc="${d.id}"] .documents-name`)).toHaveText('Ablaufplan 2027.pdf');
    await page.keyboard.press('Escape'); // Auswahl aufheben
    await page.waitForTimeout(150);
    await shot(page, 'board');

    // Blättern an der Seitenleiste: kein Undo-Schritt
    const undo = () => page.evaluate(() => (window as any).__stachel.store.undoManager.undoStack.length);
    const before = await undo();
    await press(page, pager(page, d.id).getByRole('button', { name: 'Nächste Seite' }));
    await expect(pager(page, d.id).getByTestId('documents-page')).toHaveText('2 / 3');
    await expectPageShown(page, d.id, 2);
    const now = (await docs(page))[0];
    expect(now.docPage).toBe(1);
    expect(now.imageId).toBe(now.docPages!['1']);
    expect(await undo()).toBe(before);
    await expect(pager(page, d.id).getByRole('button', { name: 'Vorige Seite' })).toBeEnabled();

    // Auswahl → Kontextleiste: Vollbild (lokal blättern, Objekt bleibt auf Seite 2)
    await press(page, page.locator(`[data-id="${d.id}"]`));
    const bar = page.getByRole('toolbar', { name: 'Auswahl bearbeiten' });
    await expect(bar.locator('.documents-ctx-n')).toHaveText('2 / 3');
    await press(page, bar.getByRole('button', { name: 'Vollbild ansehen' }));
    const viewer = page.getByTestId('documents-viewer');
    await expect(viewer).toBeVisible();
    await expect(page.getByTestId('documents-viewer-page')).toHaveText('2 / 3');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('documents-viewer-page')).toHaveText('3 / 3');
    await expect(viewer.getByRole('button', { name: 'Nächste Seite' })).toBeDisabled();
    await expect(viewer.locator('img')).toBeVisible();
    await page.waitForTimeout(200);
    await shot(page, 'vollbild');
    expect((await docs(page))[0].docPage).toBe(1);
    await page.keyboard.press('Home');
    await expect(page.getByTestId('documents-viewer-page')).toHaveText('1 / 3');
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(pager(page, d.id).getByTestId('documents-page')).toHaveText('2 / 3');

    // Größe ändern an der Ecke: Seitenverhältnis bleibt
    await press(page, page.locator(`[data-id="${d.id}"]`));
    const se = page.locator('[data-handle="se"]');
    const hb = (await se.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x - 60, hb.y - 40, { steps: 8 });
    await page.mouse.up();
    const resized = (await docs(page))[0];
    expect(resized.w).toBeLessThan(d.w);
    expect(resized.h / resized.w).toBeCloseTo(d.h / d.w, 1);

    // Alle Seiten aufs Board: drei Bilder rechts daneben, ein Undo-Schritt
    await expect(bar.getByRole('button', { name: 'Alle Seiten aufs Board legen' })).toBeVisible();
    await press(page, bar.getByRole('button', { name: 'Alle Seiten aufs Board legen' }));
    await expect.poll(async () => (await objects(page)).filter((o) => o.type === 'image').length).toBe(3);
    const imgs = (await objects(page)).filter((o) => o.type === 'image') as unknown as (Doc & { imageId: string })[];
    const pages = (await docs(page))[0].docPages!;
    expect(imgs.map((i) => i.imageId)).toEqual([pages['0'], pages['1'], pages['2']]);
    for (const i of imgs) {
      expect(i.x).toBeGreaterThan(resized.x + resized.w);
      expect(i.y).toBe(resized.y);
      expect(i.w).toBe(resized.w);
    }
    await page.waitForTimeout(300);
    await shot(page, 'alle-seiten');
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await objects(page)).filter((o) => o.type === 'image').length).toBe(0);
    expect(await docs(page)).toHaveLength(1);
  });

  test('Ablegen und Einfügen (Strg V) einer PDF, falsche Datei wird abgelehnt', async ({ page }) => {
    const b64 = PDF.toString('base64');
    // Ablegen aus dem Dateimanager
    await page.evaluate(async (data) => {
      const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bin], 'Lageplan.pdf', { type: 'application/pdf' }));
      const board = document.querySelector('[data-testid="board"]')!;
      board.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 500, clientY: 400 }));
      board.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 500, clientY: 400 }));
    }, b64);
    await expect.poll(async () => (await docs(page)).length, { timeout: 20_000 }).toBe(1);
    expect((await docs(page))[0].docName).toBe('Lageplan.pdf');
    // Einfügen (Datei in der Zwischenablage)
    await page.evaluate(async (data) => {
      const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bin], 'Kopie.pdf', { type: 'application/pdf' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, b64);
    await expect.poll(async () => (await docs(page)).length, { timeout: 20_000 }).toBe(2);
    // kaputte PDF → Hinweis, kein Objekt
    await page.getByTestId('image-input').setInputFiles({ name: 'kaputt.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 kein echtes PDF') });
    await expect(page.getByRole('status').filter({ hasText: 'keine lesbare PDF' })).toBeVisible();
    expect(await docs(page)).toHaveLength(2);
    // Dateiauswahl nimmt PDFs an
    await expect(page.getByTestId('image-input')).toHaveAttribute('accept', /application\/pdf/);
  });

  test('Export (PNG) zeigt die aktuelle Seite', async ({ page }) => {
    await page.getByTestId('image-input').setInputFiles({ name: 'Ablauf.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect.poll(async () => Object.keys((await docs(page))[0]?.docPages ?? {}).length, { timeout: 20_000 }).toBe(3);
    const d = (await docs(page))[0];
    await press(page, pager(page, d.id).getByRole('button', { name: 'Nächste Seite' }));
    await press(page, pager(page, d.id).getByRole('button', { name: 'Nächste Seite' }));
    await expect(pager(page, d.id).getByTestId('documents-page')).toHaveText('3 / 3');
    await page.evaluate((id) => (window as any).__stachel.api().setSelection([id]), d.id);
    await page.getByRole('button', { name: 'Board-Menü' }).click();
    await page.getByRole('menuitem', { name: 'Exportieren …' }).click();
    const dialog = page.getByTestId('export-dialog');
    await expect(dialog.getByRole('radio', { name: /Auswahl/ })).toBeChecked();
    const [png] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Exportieren' }).click()]);
    const b64 = fs.readFileSync((await png.path())!).toString('base64');
    const color = await page.evaluate(async (data) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      return [...g.getImageData(Math.round(c.width * 0.5), Math.round(c.height * 0.7), 1, 1).data].slice(0, 3);
    }, b64);
    expect(near(color, COLOR[3])).toBe(true);
  });
});

test.describe('PDF am Handy', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('Seitenleiste per Fingertipp, Vollbild passt auf den Bildschirm', async ({ page }) => {
    await openOffline(page);
    await page.getByTestId('image-input').setInputFiles({ name: 'Helferplan.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect.poll(async () => Object.keys((await docs(page))[0]?.docPages ?? {}).length, { timeout: 20_000 }).toBe(3);
    const d = (await docs(page))[0];
    await page.evaluate(() => (window as any).__stachel.api().fitAll());
    const next = pager(page, d.id).getByRole('button', { name: 'Nächste Seite' });
    const nb = (await next.boundingBox())!;
    expect(nb.width).toBeGreaterThanOrEqual(40); // Fingergröße
    await page.touchscreen.tap(nb.x + nb.width / 2, nb.y + nb.height / 2);
    await expect(pager(page, d.id).getByTestId('documents-page')).toHaveText('2 / 3');
    await expectPageShown(page, d.id, 2);
    await page.waitForTimeout(200);
    await shot(page, 'handy');
    await page.evaluate((id) => (window as any).__stachel.api().openModal('documents.viewer', { id }), d.id);
    const img = page.getByTestId('documents-viewer').locator('img');
    await expect(img).toBeVisible();
    const ib = (await img.boundingBox())!;
    expect(ib.x).toBeGreaterThanOrEqual(0);
    expect(ib.x + ib.width).toBeLessThanOrEqual(390);
    expect(ib.y + ib.height).toBeLessThanOrEqual(844);
    await page.getByTestId('documents-viewer').getByRole('button', { name: 'Nächste Seite' }).tap();
    await expect(page.getByTestId('documents-viewer-page')).toHaveText('3 / 3');
    await page.waitForTimeout(200);
    await shot(page, 'handy-vollbild');
  });
});

// ---- Zwei Browser live ---------------------------------------------------------------------------------------------------

let server: Server;
let syncPort = 0;
/** Dateien des Fake-Servers (beide Browser teilen sie) */
const files = new Map<string, { type: string; body: Buffer }>();
let fileSeq = 0;

const MARA: FakeUser = { key: 'm:12', name: 'Mara Lindner', isOrga: true };
const JONAS: FakeUser = { key: 'm:31', name: 'Jonas Keller', isOrga: false };

async function openAs(browser: Browser, user: FakeUser, session: string, board: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addCookies([{ name: 'stachel_session', value: session, domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();
  await installFakeApi(page, { loggedIn: true, user, boards: sampleBoards(), syncPort });
  // Upload und Abruf von Bildern/PDFs wie der echte Server (docs/contract.md §3)
  await page.route(/\/api\/boards\/[^/]+\/(images|files)$/, async (route) => {
    const req = route.request();
    const kind = req.url().endsWith('/files') ? 'files' : 'images';
    const body = req.postDataBuffer()!;
    // Multipart grob zerlegen: Inhalt zwischen Kopf und Abschluss-Grenze
    const boundary = `--${/boundary=(.+)$/.exec(req.headers()['content-type'] ?? '')![1]}`;
    const start = body.indexOf('\r\n\r\n') + 4;
    const end = body.lastIndexOf(`\r\n${boundary}`);
    const head = body.subarray(0, start).toString('latin1');
    const type = /Content-Type: ([^\r\n]+)/i.exec(head)?.[1] ?? 'application/octet-stream';
    const id = `${kind === 'files' ? 'f' : 'i'}${++fileSeq}`;
    files.set(id, { type, body: body.subarray(start, end) });
    const json = kind === 'files' ? { ok: true, file: { id, url: `/api/files/${id}`, bytes: end - start } } : { ok: true, image: { id, url: `/api/images/${id}`, width: 1273, height: 1800 } };
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(json) });
  });
  await page.route(/\/api\/(images|files)\/[^/?]+(\?.*)?$/, async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    const f = files.get(id);
    if (!f) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"ok":false,"error":"not_found"}' });
    await route.fulfill({ status: 200, contentType: f.type, body: f.body });
  });
  await page.goto(`/?b=${board}`);
  await expect(page.getByTestId('status')).toHaveText('Live');
  return page;
}

/** Dokument-Objekte im Live-Stand des Sync-Servers (im Live-Betrieb gibt es kein window.__stachel) */
function serverDocs(board: string): Doc[] {
  const doc = server.hocuspocus.documents.get(`board:${board}`);
  if (!doc) return [];
  return [...doc.getMap<Y.Map<unknown>>('objects').values()].map((m) => m.toJSON() as Doc).filter((o) => (o as { type?: string }).type === 'document');
}
const shownPage = (page: Page, id: string) => page.locator(`[data-id="${id}"]`).getAttribute('data-page');

test.describe('PDF live', () => {
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

  test('zweiter Nutzer sieht das Dokument und jeden Seitenwechsel; Vollbild bleibt lokal', async ({ browser }) => {
    const a = await openAs(browser, MARA, 'sess-mara', 'b-plan');
    const b = await openAs(browser, JONAS, 'sess-jonas', 'b-plan');
    await a.getByTestId('image-input').setInputFiles({ name: 'Ablaufplan.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect.poll(() => Object.keys(serverDocs('b-plan')[0]?.docPages ?? {}).length, { timeout: 30_000 }).toBe(3);
    const d = serverDocs('b-plan')[0];
    // Original liegt beim „Server“ und ist die hochgeladene PDF
    expect(files.get(d.docFile!)?.body.equals(PDF)).toBe(true);

    await expect(b.locator(`[data-id="${d.id}"]`)).toBeVisible();
    await expectPageShown(b, d.id, 1);
    await expect(pager(b, d.id).getByTestId('documents-page')).toHaveText('1 / 3');

    // A blättert → B sieht Seite 2
    await press(a, pager(a, d.id).getByRole('button', { name: 'Nächste Seite' }));
    await expect(pager(b, d.id).getByTestId('documents-page')).toHaveText('2 / 3');
    expect(await shownPage(b, d.id)).toBe('2');
    await expectPageShown(b, d.id, 2);
    // B blättert weiter → A sieht Seite 3
    await press(b, pager(b, d.id).getByRole('button', { name: 'Nächste Seite' }));
    await expect(pager(a, d.id).getByTestId('documents-page')).toHaveText('3 / 3');
    await expectPageShown(a, d.id, 3);
    await b.waitForTimeout(200);
    await b.screenshot({ path: path.join(OUT, 'documents-live.png') });

    // B blättert im Vollbild zurück: bei A bleibt Seite 3
    await press(b, b.locator(`[data-id="${d.id}"]`));
    await press(b, b.getByRole('toolbar', { name: 'Auswahl bearbeiten' }).getByRole('button', { name: 'Vollbild ansehen' }));
    await b.keyboard.press('ArrowLeft');
    await expect(b.getByTestId('documents-viewer-page')).toHaveText('2 / 3');
    await a.waitForTimeout(300);
    await expect(pager(a, d.id).getByTestId('documents-page')).toHaveText('3 / 3');
    await b.keyboard.press('Escape');

    // A legt alle Seiten aufs Board → B sieht drei Bilder
    await press(a, a.locator(`[data-id="${d.id}"]`));
    await press(a, a.getByRole('toolbar', { name: 'Auswahl bearbeiten' }).getByRole('button', { name: 'Alle Seiten aufs Board legen' }));
    const images = () => Object.values(server.hocuspocus.documents.get('board:b-plan')!.getMap<Y.Map<unknown>>('objects').toJSON()).filter((o) => o.type === 'image').length;
    await expect.poll(images, { timeout: 10_000 }).toBe(3);
    // B holt alles ins Bild (Umschalt 1) und sieht die drei Seiten
    await b.keyboard.press('Shift+Digit1');
    await expect(b.locator('.world [data-type="image"]')).toHaveCount(3);
    await b.waitForTimeout(400);
    await b.screenshot({ path: path.join(OUT, 'documents-live-alle-seiten.png') });
    await a.context().close();
    await b.context().close();
  });

  test('fehlende Seiten erzeugt, wer das Dokument ansieht (Hochladende:r war schon weg)', async ({ browser }) => {
    // PDF liegt beim „Server“, im Board steht ein Dokument ohne Seitenbilder (Upload abgebrochen)
    files.set('f-alt', { type: 'application/pdf', body: PDF });
    const conn = await server.hocuspocus.openDirectConnection('board:b-lage', {});
    await conn.transact((doc) => {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({ id: 'doc1', type: 'document', x: 0, y: 0, w: 300, h: 424, z: 'a0', docFile: 'f-alt', docName: 'Alt.pdf', docCount: 3, docPage: 1, docRatios: [0.707, 0.707, 0.707], createdBy: 'm:12', updatedAt: new Date().toISOString() })) m.set(k, v);
      doc.getMap('objects').set('doc1', m);
    });
    // Verbindung offen halten, sonst entlädt der Server das Dokument wieder
    const b = await openAs(browser, JONAS, 'sess-jonas-2', 'b-lage');
    await conn.disconnect();
    await expect(b.locator('[data-id="doc1"] .documents-missing')).toContainText('Seite 2 wird vorbereitet');
    // nach kurzer Wartezeit rendert B die aktuelle Seite selbst und trägt sie für alle ein
    await expectPageShown(b, 'doc1', 2);
    // eingetragen im geteilten Dokument (für alle), Spiegel imageId zeigt auf die aktuelle Seite
    await expect.poll(() => serverDocs('b-lage')[0]?.docPages?.['1']).toBeTruthy();
    const state = serverDocs('b-lage')[0];
    expect(state.imageId).toBe(state.docPages!['1']);
    // B blättert auf Seite 3: auch die wird erzeugt
    await press(b, pager(b, 'doc1').getByRole('button', { name: 'Nächste Seite' }));
    await expectPageShown(b, 'doc1', 3);
    await b.context().close();
  });
});
