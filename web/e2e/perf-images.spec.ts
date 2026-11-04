// Bildgrößen nach Bildschirmbedarf (docs/contract.md §3): Bilder vom Server werden als ?w=256 bzw. ?w=1024 geladen,
// das Original erst, wenn es auf dem Bildschirm breiter als 1024 px ist. Herauszoomen holt nichts neu. Kennt der
// Server keine Varianten (Fehler), lädt das Original. Läuft im normalen und im Perf-Lauf.
import zlib from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import type { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { installFakeApi, sampleBoards } from './fakeApi';
import { startSyncServer } from './syncServer';

let server: Server;
let syncPort = 0;
let conn: Awaited<ReturnType<Server['hocuspocus']['openDirectConnection']>>;

/** erzeugte PNGs je Größe merken: das 3000-px-Original zu packen dauert unter Last spürbar (pro Anfrage neu → Zeitüberschreitung) */
const pngs = new Map<string, Buffer>();
function makePng(w: number, h: number): Buffer {
  const key = `${w}x${h}`;
  if (!pngs.has(key)) pngs.set(key, buildPng(w, h));
  return pngs.get(key)!;
}
function buildPng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x90);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Bildobjekt (400 × 300 Welt-px) über die direkte Server-Verbindung anlegen; erscheint live bei allen */
async function addImage(id: string, imageId: string, y: number, z: string) {
  await conn.transact((doc: Y.Doc) => {
    const m = new Y.Map<unknown>();
    for (const [k, v] of Object.entries({ id, type: 'image', x: 0, y, w: 400, h: 300, imageId, z, createdBy: 'm:12', updatedAt: new Date().toISOString() })) m.set(k, v);
    doc.getMap<Y.Map<unknown>>('objects').set(id, m);
  });
}

test.beforeAll(async () => {
  ({ server, port: syncPort } = await startSyncServer({
    async onAuthenticate() {
      return { session: 'img' };
    },
  }));
  // offen halten: ohne Persistenz verwirft Hocuspocus das Dokument, sobald niemand mehr verbunden ist
  conn = await server.hocuspocus.openDirectConnection('board:b-plan', {});
  await addImage('img-1', 'pic1', 0, 'a0');
});

test.afterAll(async () => {
  await conn?.disconnect();
  await server?.destroy();
});

const zoomOf = async (page: Page) => Number((await page.getByTestId('zoom-value').innerText()).replace(/\D/g, '')) / 100;

async function zoomTo(page: Page, pred: (z: number) => boolean, dir: 'Vergrößern' | 'Verkleinern') {
  for (let i = 0; i < 30 && !pred(await zoomOf(page)); i++) {
    await page.getByRole('button', { name: dir, exact: true }).click();
    await page.waitForTimeout(60);
  }
  expect(pred(await zoomOf(page))).toBe(true);
}

test('Bilder laden die passende Größenstufe, beim Herauszoomen nichts neu, Fallback aufs Original', async ({ page, context }) => {
  await context.addCookies([{ name: 'stachel_session', value: 'img', domain: 'localhost', path: '/' }]);
  await installFakeApi(page, { loggedIn: true, boards: sampleBoards(), syncPort });
  const requests: string[] = [];
  // nach installFakeApi registriert → greift zuerst
  await page.route('**/api/images/**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname.slice('/api/images/'.length) + url.search);
    const w = Number(url.searchParams.get('w') ?? 0);
    if (url.pathname.endsWith('/pic2') && w) return route.fulfill({ status: 400, contentType: 'application/json', body: '{"ok":false,"error":"invalid_input"}' });
    const width = w || 3000;
    return route.fulfill({ status: 200, contentType: 'image/png', body: makePng(width, Math.round((width * 3) / 4)) });
  });
  // verschiedene Adressen je Bild (Playwright-Routen schalten den HTTP-Cache ab; im Betrieb sind sie `immutable` gecacht)
  const of = (id: string) => [...new Set(requests.filter((r) => r === id || r.startsWith(`${id}?`)))].sort();
  await page.goto('/?b=b-plan');
  await expect(page.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });

  // eingepasst auf 100 %: 400 px auf dem Bildschirm → 1024er-Stufe (nicht das 3000-px-Original)
  expect(await zoomOf(page)).toBe(1);
  await expect(page.locator('[data-id="img-1"] img')).toHaveAttribute('src', '/api/images/pic1?w=1024');
  await expect(page.locator('[data-id="img-1"] img')).not.toHaveClass(/is-loading/);
  expect(of('pic1')).toEqual(['pic1?w=1024']);

  // Export/Vorschaubild zeichnen mit eigenem Maßstab (hier 4×): das darf die Bildstufe im Board nicht umstellen
  // (__stachelTools gibt es nur im Dev-Server, nicht im Perf-Lauf gegen den Build)
  if (!process.env.STACHEL_PERF_PROD) {
    await expect.poll(() => page.evaluate(() => !!(window as any).__stachelTools)).toBe(true);
    await page.evaluate(() =>
      (window as any).__stachelTools.renderToSvg({ objects: [], byId: new Map(), rect: { x: 0, y: 0, w: 50, h: 50 }, scale: 4, background: null, imageSrc: () => '' }),
    );
    await page.getByTestId('board').hover();
    await page.waitForTimeout(300);
    expect(of('pic1')).toEqual(['pic1?w=1024']);
  }

  // auf 400 %: 1600 px → Original; bis es da ist, bleibt die 1024er sichtbar
  await zoomTo(page, (z) => z >= 4, 'Vergrößern');
  // 3000 × 2250 px laden und dekodieren dauert auf einem ausgelasteten Rechner länger als 5 s
  await expect(page.locator('[data-id="img-1"] img:not(.is-loading)')).toHaveAttribute('src', '/api/images/pic1', { timeout: 20_000 });
  await expect(page.locator('[data-id="img-1"] img')).toHaveCount(1);

  // wieder heraus auf ≈ 50 %: das Original ist geladen, nichts wird neu geholt
  await zoomTo(page, (z) => z <= 0.6, 'Verkleinern');
  await page.waitForTimeout(300);
  expect(of('pic1')).toEqual(['pic1', 'pic1?w=1024']);

  // neues Bild bei ≈ 50 %: 200 px → 256er-Stufe
  await addImage('img-3', 'pic3', -450, 'a2');
  await expect(page.locator('[data-id="img-3"] img')).toHaveAttribute('src', '/api/images/pic3?w=256');
  await expect(page.locator('[data-id="img-3"] img')).not.toHaveClass(/is-loading/);
  expect(of('pic3')).toEqual(['pic3?w=256']);

  // Server ohne Varianten (Fehler bei ?w=): Original statt „Bild nicht verfügbar“
  await addImage('img-2', 'pic2', 450, 'a1');
  await expect(page.locator('[data-id="img-2"] img')).toHaveAttribute('src', '/api/images/pic2');
  await expect(page.locator('[data-id="img-2"] img')).not.toHaveClass(/is-loading/, { timeout: 20_000 });
  await expect(page.locator('[data-id="img-2"] .image-missing')).toHaveCount(0);
  expect(of('pic2')).toEqual(['pic2', 'pic2?w=256']);
});
