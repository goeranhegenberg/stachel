// Papierkorb (docs/contract.md §3 „Papierkorb“): Löschen → Papierkorb, Wiederherstellen (vollständig), Rechte,
// endgültiges Löschen von Hand und nach 30 Tagen (gefälschte Uhr) samt Aufräumen der Dateien, Migration alter DBs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Browser, loginAdmin, loginMember, startEnv, waitFor, type TestEnv } from './helpers.js';
import { openDb } from '../src/db.js';
import { setupTrash, TRASH_MS } from '../src/trash.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  await env?.stop();
});

const open: Array<{ destroy: () => void }> = [];
afterEach(() => {
  while (open.length) open.pop()!.destroy();
});

function connect(boardId: string, cookie: string) {
  class CookieWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: { cookie } });
    }
  }
  const socket = new HocuspocusProviderWebsocket({ url: env.wsUrl, WebSocketPolyfill: CookieWebSocket, maxAttempts: 3, delay: 50, minDelay: 50 });
  const doc = new Y.Doc();
  const state = { synced: false, failed: null as string | null, stateless: [] as any[] };
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: `board:${boardId}`,
    document: doc,
    onSynced: () => {
      state.synced = true;
    },
    onAuthenticationFailed: ({ reason }) => {
      state.failed = reason;
    },
    onStateless: ({ payload }) => {
      state.stateless.push(JSON.parse(payload));
    },
  });
  provider.attach();
  const handle = {
    doc,
    provider,
    state,
    destroy: () => {
      provider.destroy();
      socket.destroy();
    },
  };
  open.push(handle);
  return handle;
}

/** Liest Server-Sent Events von /api/boards/events mit. */
async function listen(b: Browser) {
  const ctrl = new AbortController();
  const res = await fetch(`${env.base}/api/boards/events`, { headers: { cookie: b.cookieHeader() }, signal: ctrl.signal });
  const events: any[] = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const line of chunk.split('\n')) if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
        }
      }
    } catch {
      // abgebrochen
    }
  })();
  return { events, stop: () => ctrl.abort() };
}

/** Echte PNG-Datei (RGB, w×h). */
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
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x7f);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function upload(b: Browser, boardId: string, data: Buffer) {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(data)], { type: 'image/png' }), 'bild.png');
  return (await b.req('POST', `/api/boards/${boardId}/images`, { body: fd })).body.image as { id: string; url: string };
}

const newBoard = async (b: Browser, title: string) => (await b.post('/api/boards', { title })).body.board as { id: string; title: string };
const listed = async (b: Browser) => ((await b.get('/api/boards')).body.boards as { id: string }[]).map((x) => x.id);
const inTrash = async (b: Browser) => ((await b.get('/api/trash')).body.boards as { id: string; canManage: boolean }[]);
const imageFile = (id: string) => path.join(env.cfg.dataDir, 'images', id);
const variantFile = (id: string) => path.join(env.cfg.dataDir, 'image-variants', `${id}-256.webp`);

/** Yjs-Stand direkt in SQLite schreiben (Board gerade nicht geöffnet). */
function putDoc(boardId: string, fill: (doc: Y.Doc) => void) {
  const doc = new Y.Doc();
  fill(doc);
  env.srv.db.prepare('INSERT OR REPLACE INTO documents (name, state, updated_at) VALUES (?, ?, ?)').run(`board:${boardId}`, Y.encodeStateAsUpdate(doc), new Date().toISOString());
}

function imageObj(id: string, imageId: string): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries({ id, type: 'image', x: 0, y: 0, w: 10, h: 10, z: 'a0', imageId })) m.set(k, v);
  return m;
}

describe('Löschen → Papierkorb', () => {
  it('Board verschwindet aus der Liste, liegt im Papierkorb, alle Board-Endpunkte sagen 410 in_trash', async () => {
    const admin = await loginAdmin(env);
    const sse = await listen(admin);
    const board = await newBoard(admin, 'Ablauf Samstag');
    const del = await admin.req('DELETE', `/api/boards/${board.id}`);
    expect(del.status).toBe(200);
    expect(del.body.board).toMatchObject({ id: board.id, title: 'Ablauf Samstag', deletedBy: 'a:orga', deletedByName: 'orga', canManage: true });
    expect(Date.parse(del.body.board.purgeAt) - Date.parse(del.body.board.deletedAt)).toBe(TRASH_MS);

    expect(await listed(admin)).not.toContain(board.id);
    const trash = await inTrash(admin);
    expect(trash.map((b) => b.id)).toContain(board.id);
    expect((await admin.get(`/api/trash/${board.id}`)).body.board.title).toBe('Ablauf Samstag');
    await waitFor(() => sse.events.some((e) => e.type === 'deleted' && e.id === board.id));
    expect(sse.events.find((e) => e.type === 'deleted')).toEqual({ type: 'deleted', id: board.id, by: 'orga', byKey: 'a:orga' });

    // nichts mehr daran ändern, kopieren, favorisieren, hochladen; zweites Löschen
    const gone = [
      await admin.req('PATCH', `/api/boards/${board.id}`, { json: { title: 'x' } }),
      await admin.post(`/api/boards/${board.id}/duplicate`, {}),
      await admin.req('PUT', `/api/boards/${board.id}/favorite`),
      await admin.req('PUT', `/api/boards/${board.id}/thumbnail`, { body: new Uint8Array(makePng(2, 2)), headers: { 'Content-Type': 'image/png' } }),
      await admin.get(`/api/boards/${board.id}/thumbnail`),
      await admin.req('DELETE', `/api/boards/${board.id}`),
    ];
    for (const r of gone) expect([r.status, r.body.error]).toEqual([410, 'in_trash']);
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(makePng(2, 2))]), 'a.png');
    expect((await admin.req('POST', `/api/boards/${board.id}/images`, { body: fd })).status).toBe(410);

    // Editor: Verbinden wird mit board_deleted abgelehnt (auch nach Ablauf der 24 h im Speicher, Quelle ist die DB)
    const c = connect(board.id, admin.cookieHeader());
    await waitFor(() => c.state.failed !== null);
    expect(c.state.failed).toBe('board_deleted');
    sse.stop();
  });

  it('wer es offen hat, bekommt board.deleted; die letzten Änderungen vor dem Löschen bleiben erhalten', async () => {
    const admin = await loginAdmin(env);
    const jonas = await loginMember(env, env.fake.addMember(501, 'Jonas'));
    const board = await newBoard(admin, 'Gerade offen');
    const c = connect(board.id, jonas.cookieHeader());
    await waitFor(() => c.state.synced);
    c.doc.getMap('objects').set('n1', new Y.Map(Object.entries({ id: 'n1', type: 'sticky', text: 'kurz vor dem Löschen' })));
    // sofort löschen: das Speichern beim Entladen des Dokuments sichert die Änderung trotzdem
    await new Promise((r) => setTimeout(r, 20));
    expect((await admin.req('DELETE', `/api/boards/${board.id}`)).status).toBe(200);
    await waitFor(() => c.state.stateless.some((m) => m.type === 'board.deleted'));
    expect(c.state.stateless.find((m) => m.type === 'board.deleted')).toEqual({ type: 'board.deleted', by: 'orga', byKey: 'a:orga' });
    await waitFor(() => Boolean(env.srv.db.prepare('SELECT 1 FROM documents WHERE name = ?').get(`board:${board.id}`)));
    c.destroy();

    expect((await admin.post(`/api/trash/${board.id}/restore`)).status).toBe(200);
    const d = connect(board.id, admin.cookieHeader());
    await waitFor(() => d.state.synced);
    expect((d.doc.getMap('objects').get('n1') as Y.Map<unknown>).get('text')).toBe('kurz vor dem Löschen');
  });
});

describe('Wiederherstellen', () => {
  it('holt das Board vollständig zurück: Inhalt, Kommentare, Bilder, Vorschaubild, Vorlage, Favorit, zuletzt geöffnet', async () => {
    const admin = await loginAdmin(env);
    const sse = await listen(admin);
    const board = await newBoard(admin, 'Lageplan');
    const img = await upload(admin, board.id, makePng(300, 20));
    expect((await admin.get(`${img.url}?w=256`)).status).toBe(200); // Variante anlegen
    expect((await admin.req('PUT', `/api/boards/${board.id}/thumbnail`, { body: new Uint8Array(makePng(8, 8)), headers: { 'Content-Type': 'image/png' } })).status).toBe(200);
    expect((await admin.req('PUT', `/api/boards/${board.id}/favorite`)).status).toBe(200);
    env.srv.db.prepare('INSERT INTO board_templates (board_id, created_at) VALUES (?, ?)').run(board.id, new Date().toISOString());
    putDoc(board.id, (doc) => {
      doc.getMap('objects').set('i1', imageObj('i1', img.id));
      doc.getMap('collab.comments').set('k1', new Y.Map(Object.entries({ id: 'k1', text: 'Bühne weiter nach links?' })));
    });
    // „zuletzt geöffnet“ entsteht beim Verbinden
    const c = connect(board.id, admin.cookieHeader());
    await waitFor(() => c.state.synced);
    c.destroy();
    const before = ((await admin.get('/api/boards')).body.boards as any[]).find((b) => b.id === board.id);
    expect(before).toMatchObject({ favorite: true, template: true });
    expect(before.openedAt).toBeTruthy();
    expect(before.thumbnailAt).toBeTruthy();

    expect((await admin.req('DELETE', `/api/boards/${board.id}`)).status).toBe(200);
    // im Papierkorb: Vorschaubild über /api/trash, Bild bleibt abrufbar (andere Boards könnten es zeigen)
    const t = (await admin.get(`/api/trash/${board.id}`)).body.board;
    expect(t.thumbnailAt).toBe(before.thumbnailAt);
    const thumb = await admin.get(`/api/trash/${board.id}/thumbnail?v=${encodeURIComponent(t.thumbnailAt)}`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('content-type')).toBe('image/png');
    expect((await admin.get(img.url)).status).toBe(200);

    const res = await admin.post(`/api/trash/${board.id}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.board).toMatchObject({ id: board.id, title: 'Lageplan' });
    await waitFor(() => sse.events.some((e) => e.type === 'restored' && e.id === board.id));
    expect(sse.events.find((e) => e.type === 'restored')).toEqual({ type: 'restored', id: board.id, by: 'orga', byKey: 'a:orga' });
    expect((await inTrash(admin)).map((b) => b.id)).not.toContain(board.id);

    const after = ((await admin.get('/api/boards')).body.boards as any[]).find((b) => b.id === board.id);
    expect(after).toEqual(before);
    expect((await admin.get(img.url)).status).toBe(200);
    expect(fs.existsSync(variantFile(img.id))).toBe(true);
    const d = connect(board.id, admin.cookieHeader());
    await waitFor(() => d.state.synced);
    expect((d.doc.getMap('objects').get('i1') as Y.Map<unknown>).get('imageId')).toBe(img.id);
    expect((d.doc.getMap('collab.comments').get('k1') as Y.Map<unknown>).get('text')).toBe('Bühne weiter nach links?');
    // wieder bearbeitbar
    expect((await admin.req('PATCH', `/api/boards/${board.id}`, { json: { title: 'Lageplan 2' } })).status).toBe(200);
    // zweites Wiederherstellen: liegt nicht (mehr) im Papierkorb
    expect((await admin.post(`/api/trash/${board.id}/restore`)).status).toBe(404);
    sse.stop();
  });

  it('Rechte: Ersteller:in, wer gelöscht hat und die Orga; andere 403 (auch beim endgültigen Löschen)', async () => {
    const admin = await loginAdmin(env);
    const lena = await loginMember(env, env.fake.addMember(511, 'Lena'));
    const tom = await loginMember(env, env.fake.addMember(512, 'Tom'));
    const board = await newBoard(lena, 'Lenas Board');
    expect((await tom.req('DELETE', `/api/boards/${board.id}`)).status).toBe(403);
    expect((await admin.req('DELETE', `/api/boards/${board.id}`)).status).toBe(200);

    const forTom = (await inTrash(tom)).find((b) => b.id === board.id)!;
    const forLena = (await inTrash(lena)).find((b) => b.id === board.id)!;
    expect(forTom.canManage).toBe(false);
    expect(forLena.canManage).toBe(true);
    expect((await tom.post(`/api/trash/${board.id}/restore`)).status).toBe(403);
    expect((await tom.req('DELETE', `/api/trash/${board.id}`)).status).toBe(403);
    // Papierkorb leeren löscht nur, was man verwalten darf
    expect((await tom.req('DELETE', '/api/trash')).body).toEqual({ ok: true, purged: 0 });
    expect((await lena.post(`/api/trash/${board.id}/restore`)).status).toBe(200);
    expect(await listed(tom)).toContain(board.id);
  });

  it('ohne Sitzung 401, ohne CSRF-Header 403, unbekannte ID 404', async () => {
    const anon = new Browser(env.base);
    expect((await anon.get('/api/trash')).status).toBe(401);
    const admin = await loginAdmin(env);
    const board = await newBoard(admin, 'CSRF');
    await admin.req('DELETE', `/api/boards/${board.id}`);
    expect((await admin.req('POST', `/api/trash/${board.id}/restore`, { csrf: false })).status).toBe(403);
    expect((await admin.req('DELETE', `/api/trash/${board.id}`, { csrf: false })).status).toBe(403);
    expect((await admin.get('/api/trash/gibtsnicht')).status).toBe(404);
    expect((await admin.post('/api/trash/gibtsnicht/restore')).status).toBe(404);
    // Board, das nicht im Papierkorb liegt
    const live = await newBoard(admin, 'Lebt');
    expect((await admin.get(`/api/trash/${live.id}`)).status).toBe(404);
    expect((await admin.req('DELETE', `/api/trash/${live.id}`)).status).toBe(404);
    expect(await listed(admin)).toContain(live.id);
  });
});

describe('Endgültig löschen', () => {
  it('von Hand: Board, Dokument, Vorschaubild, Favoriten, Bilder und Varianten sind weg', async () => {
    const admin = await loginAdmin(env);
    const sse = await listen(admin);
    const board = await newBoard(admin, 'Weg damit');
    const img = await upload(admin, board.id, makePng(300, 20));
    expect((await admin.get(`${img.url}?w=256`)).status).toBe(200);
    await admin.req('PUT', `/api/boards/${board.id}/thumbnail`, { body: new Uint8Array(makePng(8, 8)), headers: { 'Content-Type': 'image/png' } });
    await admin.req('PUT', `/api/boards/${board.id}/favorite`);
    putDoc(board.id, (doc) => doc.getMap('objects').set('i1', imageObj('i1', img.id)));
    expect(fs.existsSync(imageFile(img.id)) && fs.existsSync(variantFile(img.id))).toBe(true);

    await admin.req('DELETE', `/api/boards/${board.id}`);
    expect(fs.existsSync(imageFile(img.id))).toBe(true); // im Papierkorb bleibt alles liegen
    expect((await admin.req('DELETE', `/api/trash/${board.id}`)).body).toEqual({ ok: true });
    await waitFor(() => sse.events.some((e) => e.type === 'purged' && e.id === board.id));

    const db = env.srv.db;
    expect(db.prepare('SELECT 1 FROM boards WHERE id = ?').get(board.id)).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM documents WHERE name = ?').get(`board:${board.id}`)).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM board_thumbnails WHERE board_id = ?').get(board.id)).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM board_favorites WHERE board_id = ?').get(board.id)).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM images WHERE board_id = ?').get(board.id)).toBeUndefined();
    expect(fs.existsSync(imageFile(img.id))).toBe(false);
    expect(fs.existsSync(variantFile(img.id))).toBe(false);
    expect((await admin.get(img.url)).status).toBe(404);
    expect((await admin.get(`/api/trash/${board.id}`)).status).toBe(404);
    // Editor: danach unknown_board bzw. (24 h nach board.deleted) board_deleted – jedenfalls nicht zugelassen
    const c = connect(board.id, admin.cookieHeader());
    await waitFor(() => c.state.failed !== null);
    expect(['board_deleted', 'unknown_board']).toContain(c.state.failed);
    sse.stop();
  });

  it('nach 30 Tagen automatisch (gefälschte Uhr); Bilder, die ein anderes Board nutzt (auch im Papierkorb), bleiben', async () => {
    const admin = await loginAdmin(env);
    const old = await newBoard(admin, 'Alt');
    const other = await newBoard(admin, 'Nutzt das Bild, liegt auch im Papierkorb');
    const young = await newBoard(admin, 'Jung');
    const own = await upload(admin, old.id, makePng(300, 20));
    const shared = await upload(admin, old.id, makePng(4, 4));
    putDoc(other.id, (doc) => doc.getMap('objects').set('i1', imageObj('i1', shared.id)));
    expect((await admin.get(`${own.url}?w=256`)).status).toBe(200);

    const t0 = Date.now();
    await admin.req('DELETE', `/api/boards/${old.id}`);
    await admin.req('DELETE', `/api/boards/${other.id}`);
    // „Jung“ wurde 10 Tage später gelöscht
    await admin.req('DELETE', `/api/boards/${young.id}`);
    env.srv.db.prepare('UPDATE boards SET deleted_at = ? WHERE id = ?').run(new Date(t0 + 10 * 86_400_000).toISOString(), young.id);

    expect(await env.srv.trash.purgeExpired(t0 + TRASH_MS - 60_000)).toBe(0);
    expect(env.srv.trash.isTrashed(old.id)).toBe(true);

    const n = await env.srv.trash.purgeExpired(t0 + TRASH_MS + 60_000);
    expect(n).toBeGreaterThanOrEqual(2); // old + other (+ ältere Reste anderer Tests)
    expect(env.srv.trash.isTrashed(old.id)).toBe(false);
    expect(env.srv.trash.isTrashed(other.id)).toBe(false);
    expect(env.srv.trash.isTrashed(young.id)).toBe(true);
    expect(fs.existsSync(imageFile(own.id))).toBe(false);
    expect(fs.existsSync(variantFile(own.id))).toBe(false);

    // „Jung“ 30 Tage nach seinem Löschen
    expect(await env.srv.trash.purgeExpired(t0 + 10 * 86_400_000 + TRASH_MS + 60_000)).toBeGreaterThanOrEqual(1);
    expect((await inTrash(admin)).map((b) => b.id)).not.toContain(young.id);
  });

  it('Endgültig löschen nimmt alle Bilder des Boards mit, auch wenn ein anderes Board die ID nennt (kein Umhängen, UPL-1)', async () => {
    const admin = await loginAdmin(env);
    const src = await newBoard(admin, 'Quelle');
    const dst = await newBoard(admin, 'Ziel');
    const img = await upload(admin, src.id, makePng(4, 4));
    putDoc(dst.id, (doc) => doc.getMap('objects').set('i1', imageObj('i1', img.id)));
    await admin.req('DELETE', `/api/boards/${dst.id}`);
    await admin.req('DELETE', `/api/boards/${src.id}`);
    expect((await admin.req('DELETE', `/api/trash/${src.id}`)).status).toBe(200);
    expect(env.srv.db.prepare('SELECT board_id FROM images WHERE id = ?').get(img.id)).toBeUndefined();
    expect(fs.existsSync(imageFile(img.id))).toBe(false);
    expect((await admin.post(`/api/trash/${dst.id}/restore`)).status).toBe(200);
    expect((await admin.get(img.url)).status).toBe(404);
  });

  it('Papierkorb leeren (Orga): alles weg, Rückgabe zählt mit', async () => {
    const admin = await loginAdmin(env);
    const a = await newBoard(admin, 'Leeren A');
    const b = await newBoard(admin, 'Leeren B');
    await admin.req('DELETE', `/api/boards/${a.id}`);
    await admin.req('DELETE', `/api/boards/${b.id}`);
    const res = await admin.req('DELETE', '/api/trash');
    expect(res.status).toBe(200);
    expect(res.body.purged).toBeGreaterThanOrEqual(2);
    expect(await inTrash(admin)).toEqual([]);
  });
});

describe('Migration', () => {
  it('alte Datenbank ohne Papierkorb-Spalten: Boards bleiben sichtbar, Migration ist idempotent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-trash-mig-'));
    try {
      const raw = new DatabaseSync(path.join(dir, 'stachel.sqlite'));
      raw.exec(`CREATE TABLE boards (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_by TEXT NOT NULL, created_by_name TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
      raw.prepare('INSERT INTO boards VALUES (?, ?, ?, ?, ?, ?)').run('alt1', 'Altes Board', 'a:orga', 'orga', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      raw.close();
      const db = openDb(dir);
      setupTrash(db);
      setupTrash(db);
      const row = db.prepare('SELECT title, deleted_at, deleted_by, deleted_by_name FROM boards WHERE id = ?').get('alt1');
      expect(row).toEqual({ title: 'Altes Board', deleted_at: null, deleted_by: null, deleted_by_name: null });
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
