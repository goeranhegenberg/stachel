// Verkleinerte Bildvarianten GET /api/images/:id?w=256|1024 (docs/contract.md §3).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sniffImage } from '../src/images.js';
import { Browser, loginAdmin, startEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: Browser;
beforeAll(async () => {
  env = await startEnv();
  admin = await loginAdmin(env);
});
afterAll(async () => {
  await env?.stop();
});

/** echtes (dekodierbares) RGB-PNG */
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
const GIF_1x1 = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

async function newBoard() {
  const r = await admin.post('/api/boards', { title: 'Bilder' });
  expect(r.status).toBe(201);
  return r.body.board.id as string;
}

async function upload(boardId: string, data: Buffer, type = 'image/png') {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(data)], { type }), 'x');
  const r = await admin.req('POST', `/api/boards/${boardId}/images`, { body: fd });
  expect(r.status).toBe(201);
  return r.body.image as { id: string; url: string; width: number; height: number };
}

/** Binär abrufen (Browser.req liest Text) */
async function fetchImage(url: string) {
  const res = await fetch(env.base + url, { headers: { cookie: admin.cookieHeader() } });
  return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
}

const variantDir = () => path.join(env.cfg.dataDir, 'image-variants');

describe('Bildvarianten', () => {
  it('?w=256 und ?w=1024 liefern verkleinerte WebP mit denselben Sicherheits- und Cache-Headern', async () => {
    const board = await newBoard();
    const img = await upload(board, makePng(2400, 1200));
    for (const w of [256, 1024]) {
      const r = await fetchImage(`${img.url}?w=${w}`);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('image/webp');
      expect(r.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
      expect(r.headers.get('content-security-policy')).toMatch(/sandbox/);
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      const info = sniffImage(r.buf)!;
      expect(info.mime).toBe('image/webp');
      expect(info.width).toBe(w);
      expect(info.height).toBe(w / 2);
      expect(fs.existsSync(path.join(variantDir(), `${img.id}-${w}.webp`))).toBe(true);
    }
    // ohne w: unverändert das Original (abwärtskompatibel)
    const orig = await fetchImage(img.url);
    expect(orig.headers.get('content-type')).toBe('image/png');
    expect(sniffImage(orig.buf)!.width).toBe(2400);
  });

  it('Variante wird nur einmal erzeugt (gleichzeitige Abrufe, danach aus der Datei)', async () => {
    const board = await newBoard();
    const img = await upload(board, makePng(1800, 900));
    const all = await Promise.all(Array.from({ length: 6 }, () => fetchImage(`${img.url}?w=256`)));
    for (const r of all) expect(sniffImage(r.buf)?.width).toBe(256);
    const file = path.join(variantDir(), `${img.id}-256.webp`);
    const t = fs.statSync(file).mtimeMs;
    expect(fs.readdirSync(variantDir()).filter((f) => f.startsWith(img.id))).toEqual([`${img.id}-256.webp`]);
    await fetchImage(`${img.url}?w=256`);
    expect(fs.statSync(file).mtimeMs).toBe(t);
  });

  it('nur feste Stufen: andere w → 400 (kein beliebiges Skalieren)', async () => {
    const board = await newBoard();
    const img = await upload(board, makePng(600, 300));
    for (const q of ['w=300', 'w=0', 'w=abc', 'w=256.0', 'w=-256', 'w=1024&w=256', 'w=99999999999']) {
      const r = await fetchImage(`${img.url}?${q}`);
      expect(r.status, q).toBe(400);
    }
    expect(fs.readdirSync(variantDir()).filter((f) => f.startsWith(img.id))).toEqual([]);
  });

  it('kleines Bild und GIF: Original statt Variante (keine Vergrößerung, Animation bleibt)', async () => {
    const board = await newBoard();
    const small = await upload(board, makePng(200, 100));
    const r = await fetchImage(`${small.url}?w=256`);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(sniffImage(r.buf)!.width).toBe(200);
    const gif = await upload(board, GIF_1x1, 'image/gif');
    const g = await fetchImage(`${gif.url}?w=256`);
    expect(g.headers.get('content-type')).toBe('image/gif');
    expect(fs.readdirSync(variantDir()).filter((f) => f.startsWith(small.id) || f.startsWith(gif.id))).toEqual([]);
  });

  it('kaputtes Bild: Original wird ausgeliefert, kein Absturz, kein erneuter Versuch', async () => {
    const board = await newBoard();
    // gültiger Kopf (2000×1000), Bilddaten abgeschnitten
    const png = makePng(2000, 1000);
    const broken = Buffer.concat([png.subarray(0, 33), Buffer.from([0, 0, 0, 20]), Buffer.from('IDAT', 'latin1'), Buffer.alloc(24, 0x13)]);
    const img = await upload(board, broken);
    const r = await fetchImage(`${img.url}?w=1024`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.buf.equals(broken)).toBe(true);
    expect((await fetchImage(`${img.url}?w=1024`)).status).toBe(200);
    expect(fs.readdirSync(variantDir()).filter((f) => f.startsWith(img.id))).toEqual([]);
  });

  it('EXIF-Drehung wird wie im Browser angewandt', async () => {
    const board = await newBoard();
    // 1600×800 gespeichert, Orientierung 6 (90° im Uhrzeigersinn) → angezeigt 800×1600
    const jpg = await sharp({ create: { width: 1600, height: 800, channels: 3, background: '#c9e14a' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const img = await upload(board, jpg, 'image/jpeg');
    const r = await fetchImage(`${img.url}?w=256`);
    const info = sniffImage(r.buf)!;
    expect(info.mime).toBe('image/webp');
    expect(info.width).toBe(256);
    expect(info.height).toBe(512);
  });

  it('Board löschen entfernt auch die Varianten; ohne Sitzung 401; unbekannt 404', async () => {
    const board = await newBoard();
    const img = await upload(board, makePng(1500, 700));
    await fetchImage(`${img.url}?w=256`);
    await fetchImage(`${img.url}?w=1024`);
    expect(fs.readdirSync(variantDir()).filter((f) => f.startsWith(img.id))).toHaveLength(2);
    expect((await fetch(`${env.base}${img.url}?w=256`)).status).toBe(401);
    expect((await fetchImage('/api/images/gibtsnicht?w=256')).status).toBe(404);
    expect((await admin.req('DELETE', `/api/boards/${board}`)).status).toBe(200);
    expect((await admin.req('DELETE', `/api/trash/${board}`)).status).toBe(200);
    expect(fs.readdirSync(variantDir()).filter((f) => f.startsWith(img.id))).toEqual([]);
    expect((await fetchImage(`${img.url}?w=256`)).status).toBe(404);
  });
});
