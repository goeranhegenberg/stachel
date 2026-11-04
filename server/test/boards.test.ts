import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Browser, loginAdmin, loginMember, sleep, startEnv, waitFor, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  await env?.stop();
});

/** Echte PNG-Datei (RGB, w×h) erzeugen. */
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
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x7f);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const JPEG_1x1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);
const GIF_1x1 = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
const WEBP_1x1 = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

async function upload(b: Browser, boardId: string, data: Buffer, filename: string, type = 'application/octet-stream') {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(data)], { type }), filename);
  return b.req('POST', `/api/boards/${boardId}/images`, { body: fd });
}

describe('Boards', () => {
  it('ohne Sitzung → 401 not_logged_in', async () => {
    const anon = new Browser(env.base);
    for (const [m, p] of [
      ['GET', '/api/boards'],
      ['POST', '/api/boards'],
      ['PATCH', '/api/boards/x'],
      ['DELETE', '/api/boards/x'],
      ['GET', '/api/images/x'],
    ] as const) {
      const r = await anon.req(m, p, m === 'GET' || m === 'DELETE' ? {} : { json: { title: 't' } });
      expect(r.status, `${m} ${p}`).toBe(401);
      expect(r.body).toMatchObject({ ok: false, error: 'not_logged_in' });
    }
  });

  it('anlegen, auflisten (zuletzt geändert zuerst), umbenennen', async () => {
    const b = await loginAdmin(env);
    const c1 = await b.post('/api/boards', { title: '  Lageplan   2027 ' });
    expect(c1.status).toBe(201);
    expect(c1.body.ok).toBe(true);
    const board1 = c1.body.board;
    expect(board1).toMatchObject({ title: 'Lageplan 2027', createdBy: 'a:orga', createdByName: 'orga' });
    expect(board1.id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(board1.createdAt).toMatch(/Z$/);
    expect(board1.updatedAt).toBe(board1.createdAt);

    await sleep(5);
    const board2 = (await b.post('/api/boards', { title: 'Ideen' })).body.board;
    let list = await b.get('/api/boards');
    expect(list.status).toBe(200);
    let ids = list.body.boards.map((x: { id: string }) => x.id);
    expect(ids.indexOf(board2.id)).toBeLessThan(ids.indexOf(board1.id));

    await sleep(5);
    const p = await b.req('PATCH', `/api/boards/${board1.id}`, { json: { title: 'Lageplan final' } });
    expect(p.status).toBe(200);
    expect(p.body.board.title).toBe('Lageplan final');
    list = await b.get('/api/boards');
    ids = list.body.boards.map((x: { id: string }) => x.id);
    expect(ids.indexOf(board1.id)).toBeLessThan(ids.indexOf(board2.id));
  });

  it('ohne Titel → „Unbenanntes Board“; ungültige Titel → 400', async () => {
    const b = await loginAdmin(env);
    const c = await b.post('/api/boards', {});
    expect(c.status).toBe(201);
    expect(c.body.board.title).toBe('Unbenanntes Board');
    expect((await b.post('/api/boards', { title: 42 })).status).toBe(400);
    expect((await b.post('/api/boards', { title: 'x'.repeat(121) })).status).toBe(400);
    const p = await b.req('PATCH', `/api/boards/${c.body.board.id}`, { json: { title: '   ' } });
    expect(p.status).toBe(400);
    expect(p.body.error).toBe('invalid_input');
  });

  it('unbekanntes Board → 404', async () => {
    const b = await loginAdmin(env);
    expect((await b.req('PATCH', '/api/boards/gibtsnicht', { json: { title: 'x' } })).status).toBe(404);
    expect((await b.req('DELETE', '/api/boards/gibtsnicht')).status).toBe(404);
    expect((await upload(b, 'gibtsnicht', makePng(1, 1), 'a.png')).status).toBe(404);
  });

  it('löschen: nur Ersteller:in oder Orga, sonst 403 forbidden', async () => {
    const anna = await loginMember(env, env.fake.addMember(201, 'Anna'));
    const ben = await loginMember(env, env.fake.addMember(202, 'Ben'));
    const orga = await loginMember(env, env.fake.addMember(203, 'Olga', 'active', true));

    const b1 = (await anna.post('/api/boards', { title: 'Annas Board' })).body.board;
    expect(b1.createdBy).toBe('m:201');
    const d1 = await ben.req('DELETE', `/api/boards/${b1.id}`);
    expect(d1.status).toBe(403);
    expect(d1.body.error).toBe('forbidden');
    // Bearbeiten darf jede:r
    expect((await ben.req('PATCH', `/api/boards/${b1.id}`, { json: { title: 'Von Ben umbenannt' } })).status).toBe(200);

    expect((await anna.req('DELETE', `/api/boards/${b1.id}`)).status).toBe(200);
    const b2 = (await anna.post('/api/boards', { title: 'Noch eins' })).body.board;
    const d2 = await orga.req('DELETE', `/api/boards/${b2.id}`);
    expect(d2.status).toBe(200);
    // Löschen = Papierkorb (trash.ts): Antwort trägt das Board mit deletedAt/purgeAt
    expect(d2.body.board).toMatchObject({ id: b2.id, deletedAt: expect.any(String), purgeAt: expect.any(String) });
    const ids = (await anna.get('/api/boards')).body.boards.map((x: { id: string }) => x.id);
    expect(ids).not.toContain(b1.id);
    expect(ids).not.toContain(b2.id);
  });
});

describe('Bilder', () => {
  it('gültige Bilder (PNG/JPEG/WebP/GIF) werden per Magic Bytes erkannt', async () => {
    const b = await loginAdmin(env);
    const board = (await b.post('/api/boards', { title: 'Bilder' })).body.board;

    const png = await upload(b, board.id, makePng(3, 2), 'foto.txt', 'text/plain'); // Endung/Typ egal
    expect(png.status).toBe(201);
    expect(png.body.image).toMatchObject({ width: 3, height: 2 });
    expect(png.body.image.url).toBe(`/api/images/${png.body.image.id}`);

    for (const [buf, name] of [
      [JPEG_1x1, 'a.jpg'],
      [WEBP_1x1, 'a.webp'],
      [GIF_1x1, 'a.gif'],
    ] as const) {
      const r = await upload(b, board.id, buf, name);
      expect(r.status, name).toBe(201);
      expect(r.body.image, name).toMatchObject({ width: 1, height: 1 });
    }

    const get = await fetch(env.base + png.body.image.url, { headers: { cookie: b.cookieHeader() } });
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/png');
    expect(get.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(get.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await get.arrayBuffer()).equals(makePng(3, 2))).toBe(true);

    // ohne Sitzung kein Bild
    const anon = await fetch(env.base + png.body.image.url);
    expect(anon.status).toBe(401);
  });

  it('ungültige Dateien → 415 unsupported_type (auch mit .png-Endung)', async () => {
    const b = await loginAdmin(env);
    const board = (await b.post('/api/boards', { title: 'Ungültig' })).body.board;
    const fake = await upload(b, board.id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'bild.png', 'image/png');
    expect(fake.status).toBe(415);
    expect(fake.body).toMatchObject({ ok: false, error: 'unsupported_type' });
    const html = await upload(b, board.id, Buffer.from('<html><script>alert(1)</script></html>'), 'x.gif', 'image/gif');
    expect(html.status).toBe(415);
    const truncated = await upload(b, board.id, makePng(2, 2).subarray(0, 12), 'kaputt.png');
    expect(truncated.status).toBe(415);
  });

  it('zu große Datei → 413 too_large', async () => {
    const b = await loginAdmin(env);
    const board = (await b.post('/api/boards', { title: 'Groß' })).body.board;
    const big = Buffer.alloc(15 * 1024 * 1024 + 10);
    makePng(1, 1).copy(big);
    const r = await upload(b, board.id, big, 'riesig.png');
    expect(r.status).toBe(413);
    expect(r.body.error).toBe('too_large');
  });

  it('ohne Datei bzw. falsches Feld → 400', async () => {
    const b = await loginAdmin(env);
    const board = (await b.post('/api/boards', { title: 'Leer' })).body.board;
    expect((await b.post(`/api/boards/${board.id}/images`, { file: 'x' })).status).toBe(400);
    const fd = new FormData();
    fd.append('bild', new Blob([new Uint8Array(makePng(1, 1))]), 'a.png');
    expect((await b.req('POST', `/api/boards/${board.id}/images`, { body: fd })).status).toBe(400);
  });

  it('Board löschen entfernt seine Bilder', async () => {
    const b = await loginAdmin(env);
    const board = (await b.post('/api/boards', { title: 'Weg damit' })).body.board;
    const img = (await upload(b, board.id, makePng(4, 4), 'a.png')).body.image;
    const file = path.join(env.cfg.dataDir, 'images', img.id);
    expect(fs.existsSync(file)).toBe(true);
    expect((await b.req('DELETE', `/api/boards/${board.id}`)).status).toBe(200);
    expect(fs.existsSync(file)).toBe(true); // im Papierkorb bleibt das Bild
    expect((await b.req('DELETE', `/api/trash/${board.id}`)).status).toBe(200);
    expect(fs.existsSync(file)).toBe(false);
    expect((await b.get(img.url)).status).toBe(404);
  });

  it('Einfügen über Boards hinweg legt eine eigene Kopie an; endgültig löschen nimmt alle eigenen Bilder mit (UPL-1)', async () => {
    const b = await loginAdmin(env);
    const a = (await b.post('/api/boards', { title: 'Quelle' })).body.board;
    const stored = (await b.post('/api/boards', { title: 'Ziel gespeichert' })).body.board;
    const live = (await b.post('/api/boards', { title: 'Ziel live' })).body.board;
    const img1 = (await upload(b, a.id, makePng(4, 4), 'a.png')).body.image;
    const img2 = (await upload(b, a.id, makePng(5, 5), 'b.png')).body.image;
    const file = (id: string) => path.join(env.cfg.dataDir, 'images', id);
    const owner = (id: string) => (env.srv.db.prepare('SELECT board_id FROM images WHERE id = ?').get(id) as { board_id: string } | undefined)?.board_id;

    // „Ziel gespeichert“: fremde ID nur in SQLite, ohne Einfügen über den Sync (kein Kopieren) → bleibt ein toter Verweis
    putDoc(stored.id, (objects) => objects.set('i1', imageObj('i1', img1.id)));
    // „Ziel live“: Einfügen über den Sync → der Server legt sofort eine Kopie fürs Ziel-Board an und schreibt sie ein
    const conn = await env.srv.hocuspocus.openDirectConnection(`board:${live.id}`, { user: { key: 'a:test', name: 'Test', isOrga: true } });
    await conn.transact((doc) => doc.getMap('objects').set('i2', imageObj('i2', img2.id)));
    const liveDoc = env.srv.hocuspocus.documents.get(`board:${live.id}`)!;
    const imageIdOf = () => (liveDoc.getMap('objects').get('i2') as Y.Map<unknown>).get('imageId') as string;
    await waitFor(() => imageIdOf() !== img2.id);
    const copy = imageIdOf();
    expect(owner(copy)).toBe(live.id);
    expect(owner(img2.id)).toBe(a.id);
    // nochmal einfügen: dieselbe Kopie, keine weitere Datei
    await conn.transact((doc) => doc.getMap('objects').set('i3', imageObj('i3', img2.id)));
    await waitFor(() => (liveDoc.getMap('objects').get('i3') as Y.Map<unknown>).get('imageId') !== img2.id);
    expect((liveDoc.getMap('objects').get('i3') as Y.Map<unknown>).get('imageId')).toBe(copy);

    expect((await b.req('DELETE', `/api/boards/${a.id}`)).status).toBe(200);
    expect((await b.req('DELETE', `/api/trash/${a.id}`)).status).toBe(200);
    // alle Dateien der Quelle sind weg (kein Umhängen mehr), die Kopie bleibt
    expect((await b.get(img1.url)).status).toBe(404);
    expect((await b.get(img2.url)).status).toBe(404);
    expect(fs.existsSync(file(img1.id))).toBe(false);
    expect(fs.existsSync(file(img2.id))).toBe(false);
    expect(owner(img1.id)).toBeUndefined();
    expect((await b.get(`/api/images/${copy}`)).status).toBe(200);
    await conn.disconnect();

    expect((await b.req('DELETE', `/api/boards/${live.id}`)).status).toBe(200);
    expect((await b.req('DELETE', `/api/trash/${live.id}`)).status).toBe(200);
    expect(fs.existsSync(file(copy))).toBe(false);
  });
});

function imageObj(id: string, imageId: string): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries({ id, type: 'image', x: 0, y: 0, w: 10, h: 10, z: 'a0', imageId })) m.set(k, v);
  return m;
}

/** Dokumentstand eines Boards direkt in SQLite schreiben (wie nach dem Speichern durch den Sync-Server). */
function putDoc(boardId: string, fill: (objects: Y.Map<Y.Map<unknown>>, doc: Y.Doc) => void) {
  const doc = new Y.Doc();
  fill(doc.getMap('objects'), doc);
  env.srv.db
    .prepare('INSERT OR REPLACE INTO documents (name, state, updated_at) VALUES (?, ?, ?)')
    .run(`board:${boardId}`, Y.encodeStateAsUpdate(doc), new Date().toISOString());
  doc.destroy();
}
