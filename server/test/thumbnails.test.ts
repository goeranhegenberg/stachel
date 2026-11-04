// Vorschaubilder, Duplizieren und Vorlagen (Feature-Modul tools, docs/contract.md §3).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { remapImages } from '../src/board-copies.js';
import { Browser, loginAdmin, startEnv, waitFor, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  await env?.stop();
});

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

const putThumb = (b: Browser, id: string, data: Buffer, type = 'image/png', csrf = true) =>
  b.req('PUT', `/api/boards/${id}/thumbnail`, { body: new Uint8Array(data), headers: { 'Content-Type': type }, csrf });

async function newBoard(b: Browser, title: string) {
  const r = await b.post('/api/boards', { title });
  expect(r.status).toBe(201);
  return r.body.board as { id: string; title: string };
}

/** Provider wie im Browser, nur mit Cookie-Header über ws (wie in sync.test.ts). */
function connect(b: Browser, boardId: string) {
  const headers = { cookie: b.cookieHeader() };
  class CookieWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers });
    }
  }
  const socket = new HocuspocusProviderWebsocket({ url: env.wsUrl, WebSocketPolyfill: CookieWebSocket, maxAttempts: 1 });
  const doc = new Y.Doc();
  let synced = false;
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `board:${boardId}`, document: doc, onSynced: () => (synced = true) });
  provider.attach();
  return {
    doc,
    provider,
    synced: () => synced,
    close: () => {
      provider.destroy();
      socket.destroy();
      doc.destroy();
    },
  };
}

/** Objekte live schreiben und warten, bis der Server sie hat (Board bleibt offen, bis close()). */
async function writeObjects(b: Browser, boardId: string, objs: Record<string, Record<string, unknown>>) {
  const c = connect(b, boardId);
  await waitFor(c.synced);
  const map = c.doc.getMap<Y.Map<unknown>>('objects');
  c.doc.transact(() => {
    for (const [id, o] of Object.entries(objs)) map.set(id, new Y.Map(Object.entries(o)));
  });
  await waitFor(() => !c.provider.hasUnsyncedChanges);
  return c;
}

async function readObjects(b: Browser, boardId: string) {
  const c = connect(b, boardId);
  await waitFor(c.synced);
  const out = c.doc.getMap('objects').toJSON() as Record<string, Record<string, unknown>>;
  c.close();
  return out;
}

describe('Vorschaubilder', () => {
  it('ohne Sitzung 401, ohne X-Stachel 403', async () => {
    const anon = new Browser(env.base);
    expect((await putThumb(anon, 'x', makePng(4, 4))).status).toBe(401);
    expect((await anon.get('/api/boards/x/thumbnail')).status).toBe(401);
    const b = await loginAdmin(env);
    const board = await newBoard(b, 'CSRF');
    const r = await putThumb(b, board.id, makePng(4, 4), 'image/png', false);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('csrf');
  });

  it('hochladen, in der Liste als thumbnailAt, abrufen mit Cache-Regel', async () => {
    const b = await loginAdmin(env);
    const board = await newBoard(b, 'Mit Vorschau');
    expect((await b.get(`/api/boards/${board.id}/thumbnail`)).status).toBe(404);
    const png = makePng(560, 260);
    const r = await putThumb(b, board.id, png);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.thumbnailAt).toMatch(/Z$/);

    const list = await b.get('/api/boards');
    const info = list.body.boards.find((x: any) => x.id === board.id);
    expect(info.thumbnailAt).toBe(r.body.thumbnailAt);
    expect(info.template).toBeUndefined();

    const g = await fetch(`${env.base}/api/boards/${board.id}/thumbnail?v=${encodeURIComponent(r.body.thumbnailAt)}`, { headers: { cookie: b.cookieHeader() } });
    expect(g.status).toBe(200);
    expect(g.headers.get('content-type')).toBe('image/png');
    expect(g.headers.get('cache-control')).toContain('immutable');
    expect(Buffer.from(await g.arrayBuffer()).equals(png)).toBe(true);
    const g2 = await fetch(`${env.base}/api/boards/${board.id}/thumbnail`, { headers: { cookie: b.cookieHeader() } });
    expect(g2.headers.get('cache-control')).toBe('private, no-cache');

    // Ersetzen: neuer Stand
    const r2 = await putThumb(b, board.id, makePng(280, 130));
    expect(r2.status).toBe(200);
    expect(r2.body.thumbnailAt >= r.body.thumbnailAt).toBe(true);
  });

  it('prüft Typ, Größe und Board', async () => {
    const b = await loginAdmin(env);
    const board = await newBoard(b, 'Prüfungen');
    expect((await putThumb(b, 'unbekannt123', makePng(4, 4))).status).toBe(404);
    const gif = await putThumb(b, board.id, GIF_1x1, 'image/gif');
    expect(gif.status).toBe(415);
    expect(gif.body.error).toBe('unsupported_type');
    const text = await putThumb(b, board.id, Buffer.from('kein bild'), 'image/png');
    expect(text.status).toBe(415);
    const empty = await b.req('PUT', `/api/boards/${board.id}/thumbnail`, { json: { image: 'x' } });
    expect(empty.status).toBe(400);
    const huge = await putThumb(b, board.id, makePng(2400, 10));
    expect(huge.status).toBe(413);
    expect(huge.body.error).toBe('too_large');
    const big = await putThumb(b, board.id, Buffer.concat([makePng(4, 4), Buffer.alloc(600 * 1024)]));
    expect(big.status).toBe(413);
  });

  it('Löschen des Boards löscht das Vorschaubild', async () => {
    const b = await loginAdmin(env);
    const board = await newBoard(b, 'Weg');
    await putThumb(b, board.id, makePng(8, 8));
    expect((await b.req('DELETE', `/api/boards/${board.id}`)).status).toBe(200);
    expect((await b.req('DELETE', `/api/trash/${board.id}`)).status).toBe(200);
    const rows = env.srv.db.prepare('SELECT COUNT(*) AS n FROM board_thumbnails WHERE board_id = ?').get(board.id) as { n: number };
    expect(rows.n).toBe(0);
  });
});

describe('Duplizieren und Vorlagen', () => {
  it('kopiert Inhalt (live), Bilder mit neuen IDs und Vorschaubild', async () => {
    const b = await loginAdmin(env);
    const board = await newBoard(b, 'Lageplan');
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(makePng(20, 10))], { type: 'image/png' }), 'a.png');
    const up = await b.req('POST', `/api/boards/${board.id}/images`, { body: fd });
    expect(up.status).toBe(201);
    const imageId = up.body.image.id as string;
    await putThumb(b, board.id, makePng(40, 20));
    const live = await writeObjects(b, board.id, {
      s1: { id: 's1', type: 'sticky', x: 0, y: 0, w: 100, h: 100, z: 'a0', text: 'Bühne', createdBy: 'a:orga', updatedAt: '' },
      i1: { id: 'i1', type: 'image', x: 200, y: 0, w: 20, h: 10, z: 'a1', imageId, createdBy: 'a:orga', updatedAt: '' },
    });

    const r = await b.post(`/api/boards/${board.id}/duplicate`, {});
    live.close();
    expect(r.status).toBe(201);
    const copy = r.body.board;
    expect(copy).toMatchObject({ title: 'Lageplan (Kopie)', createdBy: 'a:orga' });
    expect(copy.id).not.toBe(board.id);
    expect(copy.thumbnailAt).toMatch(/Z$/);
    expect(copy.template).toBeUndefined();

    const objs = await readObjects(b, copy.id);
    expect(objs.s1?.text).toBe('Bühne');
    const newImage = objs.i1?.imageId as string;
    expect(newImage).toBeTruthy();
    expect(newImage).not.toBe(imageId);
    const img = await fetch(`${env.base}/api/images/${newImage}`, { headers: { cookie: b.cookieHeader() } });
    expect(img.status).toBe(200);

    // Original löschen: Kopie behält ihr Bild
    expect((await b.req('DELETE', `/api/boards/${board.id}`)).status).toBe(200);
    expect((await b.req('DELETE', `/api/trash/${board.id}`)).status).toBe(200);
    expect(fs.existsSync(path.join(env.cfg.dataDir, 'images', newImage))).toBe(true);
    expect(fs.existsSync(path.join(env.cfg.dataDir, 'images', imageId))).toBe(false);
  });

  it('Vorlage speichern und daraus ein Board anlegen', async () => {
    const b = await loginAdmin(env);
    const board = await newBoard(b, 'Schichtplan');
    const live = await writeObjects(b, board.id, { t1: { id: 't1', type: 'text', x: 0, y: 0, w: 200, h: 30, z: 'a0', text: 'Schicht', createdBy: '', updatedAt: '' } });
    live.close();
    await waitFor(() => Boolean(env.srv.db.prepare('SELECT 1 FROM documents WHERE name = ?').get(`board:${board.id}`)), 5000);
    // gespeicherter Stand (Board nicht mehr geöffnet)
    await waitFor(() => !env.srv.hocuspocus.documents.has(`board:${board.id}`), 5000);

    const t = await b.post(`/api/boards/${board.id}/duplicate`, { template: true });
    expect(t.status).toBe(201);
    expect(t.body.board).toMatchObject({ title: 'Schichtplan', template: true });
    const list = await b.get('/api/boards');
    expect(list.body.boards.find((x: any) => x.id === t.body.board.id).template).toBe(true);
    expect(list.body.boards.find((x: any) => x.id === board.id).template).toBeUndefined();

    const n = await b.post(`/api/boards/${t.body.board.id}/duplicate`, { title: '  Schichtplan   Samstag ' });
    expect(n.status).toBe(201);
    expect(n.body.board).toMatchObject({ title: 'Schichtplan Samstag' });
    expect(n.body.board.template).toBeUndefined();
    expect((await readObjects(b, n.body.board.id)).t1?.text).toBe('Schicht');
  });

  it('Fehlerfälle', async () => {
    const b = await loginAdmin(env);
    const board = await newBoard(b, 'Leer');
    expect((await b.post('/api/boards/gibtsnicht/duplicate', {})).status).toBe(404);
    expect((await b.post(`/api/boards/${board.id}/duplicate`, { title: 5 })).status).toBe(400);
    expect((await b.post(`/api/boards/${board.id}/duplicate`, { template: 'ja' })).status).toBe(400);
    expect((await b.post(`/api/boards/${board.id}/duplicate`, { title: 'x'.repeat(121) })).status).toBe(400);
    expect((await b.post(`/api/boards/${board.id}/duplicate`, {}, { csrf: false })).status).toBe(403);
    // leeres Board (noch nie gespeichert) lässt sich kopieren
    const r = await b.post(`/api/boards/${board.id}/duplicate`, {});
    expect(r.status).toBe(201);
    expect(await readObjects(b, r.body.board.id)).toEqual({});
  });

  it('remapImages ersetzt nur bekannte Bild-IDs', () => {
    const doc = new Y.Doc();
    const m = doc.getMap<Y.Map<unknown>>('objects');
    m.set('a', new Y.Map(Object.entries({ type: 'image', imageId: 'alt' })));
    m.set('b', new Y.Map(Object.entries({ type: 'image', imageId: 'fremd' })));
    const out = new Y.Doc();
    Y.applyUpdate(out, remapImages(Y.encodeStateAsUpdate(doc), new Map([['alt', 'neu']])));
    expect(out.getMap('objects').toJSON()).toEqual({ a: { type: 'image', imageId: 'neu' }, b: { type: 'image', imageId: 'fremd' } });
  });
});
