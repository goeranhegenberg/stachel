// Ende-zu-Ende: Bild per Kopieren/Einfügen von Board A nach Board B, danach Board A löschen – das Bild in B bleibt
// (Bilder gehören ihrem Board: beim Einfügen in ein anderes Board legt der Server eine Kopie an, image-binding.ts).
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { FakeOrg } from '../../server/test/fake-org';
import { E2E_PORT } from '../playwright.config';
import { StachelServer } from '../support/server';

// eigener Port, damit die Datei parallel zu den anderen Root-E2E laufen kann
const PORT = E2E_PORT + 7;
let org: FakeOrg;
let server: StachelServer;
let dataDir: string;

/** Echte PNG-Datei (RGB, w×h, einfarbig). */
function makePng(w: number, h: number): Buffer {
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
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x40);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function openBoard(p: Page, id: string) {
  await p.goto(`/?b=${id}`);
  await expect(p.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
}

/** Bild im Board geladen (nicht „Bild nicht verfügbar“); liefert die Bild-URL. */
async function loadedImage(p: Page): Promise<string> {
  const img = p.locator('[data-type="image"] img');
  await expect(img).toHaveCount(1);
  await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0)).toBe(true);
  await expect(p.locator('.image-missing')).toHaveCount(0);
  return (await img.getAttribute('src'))!;
}

test.beforeAll(async () => {
  org = await new FakeOrg().start();
  org.addAdmin('Anna', 'kaktus-123');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-e2e-images-'));
  server = new StachelServer(PORT, dataDir, org.url, path.join(import.meta.dirname, '../test-results/server-images.log'));
  await server.start();
});

test.afterAll(async () => {
  await server?.stop();
  await org?.stop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Bild von A nach B kopieren, A löschen: das Bild in B ist noch da', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: server.url });
  const p = await ctx.newPage();
  await p.goto('/');
  await p.getByRole('textbox', { name: 'Benutzername' }).fill('Anna');
  await p.locator('#p').fill('kaktus-123');
  await p.getByRole('button', { name: 'Anmelden' }).click();
  await expect(p.getByRole('button', { name: 'Neues Board' })).toBeVisible();

  const create = async (title: string) =>
    (await (await p.request.post('/api/boards', { data: { title }, headers: { 'X-Stachel': '1' } })).json()).board as { id: string };
  const a = await create('Quelle');
  const b = await create('Ziel');

  // Bild in A einfügen (wie Strg V mit einem Bild in der Zwischenablage)
  await openBoard(p, a.id);
  const png = [...makePng(120, 80)];
  await p.evaluate((bytes) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], 'bild.png', { type: 'image/png' }));
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, png);
  const srcA = await loadedImage(p);

  // auswählen und kopieren; die Stachel-Daten aus dem copy-Ereignis mitschneiden
  const box = (await p.locator('[data-type="image"]').boundingBox())!;
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.evaluate(() => {
    window.addEventListener('copy', (e) => ((window as unknown as { copied: string }).copied = e.clipboardData!.getData('text/html')), { once: true });
  });
  await p.keyboard.press('Control+c');
  const html = await p.evaluate(() => (window as unknown as { copied: string }).copied);
  expect(html).toContain('data-stachel');

  // in B einfügen
  await openBoard(p, b.id);
  await p.evaluate((h) => {
    const dt = new DataTransfer();
    dt.setData('text/html', h);
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, html);
  const srcB = await loadedImage(p);
  expect(srcB).not.toBe(srcA); // eigene Kopie für B
  await p.waitForTimeout(500); // Sync zum Server
  await p.goto('/');

  // Quell-Board löschen
  const del = await p.request.delete(`/api/boards/${a.id}`, { headers: { 'X-Stachel': '1' } });
  expect(del.status()).toBe(200);

  // B neu öffnen: Bild lädt weiterhin
  await openBoard(p, b.id);
  expect(await loadedImage(p)).toBe(srcB);
  expect((await p.request.get(srcB)).status()).toBe(200);
  await ctx.close();
});
