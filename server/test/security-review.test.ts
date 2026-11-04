// Regressionstests aus dem Sicherheits-Review 2026-11-02 (docs/security/review_2026-11-02.md).
// Jeder Test spielt den Angriff aus dem Befund nach und erwartet die Abwehr.
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import * as encoding from 'lib0/encoding';
import path from 'node:path';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { commentMessageAllowed } from '../src/access.js';
import { commentChangeAllowed, messageHash, readComments, touchedRoots } from '../src/comment-guard.js';
import { ImageBinding } from '../src/image-binding.js';
import { Browser, sleep, startEnv, waitFor, type TestEnv } from './helpers.js';
import { LOCAL, signUp } from './local-helpers.js';

let env: TestEnv;
let owner: Browser;
let commenter: Browser;
let editor: Browser;

beforeAll(async () => {
  env = await startEnv({ instance: LOCAL });
  owner = await signUp(env, 'Olga Owner', 'olga@example.org');
  commenter = await signUp(env, 'Carl Comment', 'carl@example.org');
  editor = await signUp(env, 'Edda Edit', 'edda@example.org');
});
afterAll(async () => {
  await env?.stop();
});

const open: Array<{ destroy: () => void }> = [];
afterEach(() => {
  while (open.length) open.pop()!.destroy();
});

function connect(boardId: string, b: Browser) {
  const headers = { cookie: b.cookieHeader() };
  class CookieWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers });
    }
  }
  const socket = new HocuspocusProviderWebsocket({ url: env.wsUrl, WebSocketPolyfill: CookieWebSocket, maxAttempts: 1 });
  const doc = new Y.Doc();
  const state = { synced: false };
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `board:${boardId}`, document: doc, onSynced: () => (state.synced = true) });
  provider.attach();
  const h = { doc, socket, state, destroy: () => (provider.destroy(), socket.destroy()) };
  open.push(h);
  return h;
}

/** Hocuspocus-Nachricht: Dokumentname, Nachrichtentyp, Sync-Untertyp (2 = Update), Update. */
function syncMessage(doc: string, type: number, update: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarString(enc, doc);
  encoding.writeVarUint(enc, type);
  encoding.writeVarUint(enc, 2);
  encoding.writeVarUint8Array(enc, update);
  return encoding.toUint8Array(enc);
}

function stickyUpdate(base: Y.Doc, id: string): Uint8Array {
  const d = new Y.Doc();
  Y.applyUpdate(d, Y.encodeStateAsUpdate(base));
  const sv = Y.encodeStateVector(d);
  d.transact(() => {
    const o = new Y.Map<unknown>();
    o.set('id', id);
    o.set('type', 'sticky');
    d.getMap('objects').set(id, o);
  });
  return Y.encodeStateAsUpdate(d, sv);
}

function connectToken(boardId: string, token: string) {
  const headers = { authorization: `Bearer ${token}` };
  class TokenWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers });
    }
  }
  const socket = new HocuspocusProviderWebsocket({ url: env.wsUrl, WebSocketPolyfill: TokenWebSocket, maxAttempts: 1 });
  const doc = new Y.Doc();
  const state = { synced: false, closed: false };
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `board:${boardId}`, document: doc, onSynced: () => (state.synced = true) });
  socket.on('close', () => (state.closed = true));
  provider.attach();
  const h = { doc, socket, state, destroy: () => (provider.destroy(), socket.destroy()) };
  open.push(h);
  return h;
}

describe('SEC-03: Rechte entzogen → auch Sync-Verbindungen mit API-Token (KI/MCP) werden getrennt', () => {
  it('entfernte Person schreibt über ihr API-Token nicht weiter', async () => {
    const boardId = (await owner.post('/api/boards', { title: 'Entzug' })).body.board.id as string;
    await owner.post(`/api/boards/${boardId}/share`, { emails: 'edda@example.org', role: 'edit' });
    const secret = (await editor.post('/api/tokens', { label: 'KI' })).body.secret as string;
    const ai = connectToken(boardId, secret);
    const o = connect(boardId, owner);
    await waitFor(() => ai.state.synced && o.state.synced);
    const eKey = (await editor.get('/api/auth/me')).body.user.key as string;
    expect((await owner.req('DELETE', `/api/boards/${boardId}/members/${encodeURIComponent(eKey)}`)).status).toBe(200);
    await waitFor(() => ai.state.closed, 3000);
    ai.doc.transact(() => {
      const m = new Y.Map<unknown>();
      m.set('id', 'n-ai');
      m.set('type', 'sticky');
      ai.doc.getMap('objects').set('n-ai', m);
    });
    await sleep(400);
    expect(env.srv.hocuspocus.documents.get(`board:${boardId}`)?.getMap('objects').has('n-ai') ?? false).toBe(false);
  });
});

describe('SEC-02: Versions-Vorschau der Native-API nur mit Bearbeiten-Recht (wie /api/boards/:id/versions)', () => {
  it('ansehen/kommentieren bekommen keine alten Stände (zeigen gelöschte Inhalte)', async () => {
    const boardId = (await owner.post('/api/boards', { title: 'Versionen' })).body.board.id as string;
    await owner.post(`/api/boards/${boardId}/share`, { emails: 'carl@example.org', role: 'comment' });
    await owner.post(`/api/boards/${boardId}/share`, { emails: 'edda@example.org', role: 'view' });
    const vid = (await owner.post(`/api/boards/${boardId}/versions`, { name: 'Geheim' })).body.version.id as string;
    const snap = `/api/native/v1/boards/${boardId}/versions/${vid}/snapshot`;
    expect((await owner.get(snap)).status).toBe(200);
    expect((await commenter.get(`/api/boards/${boardId}/versions`)).status).toBe(403);
    expect((await commenter.get(snap)).status).toBe(403);
    expect((await editor.get(snap)).status).toBe(403);
    const stranger = await signUp(env, 'Sven Fremd', 'sven@example.org');
    expect((await stranger.get(snap)).status).toBe(404);
  });
});

describe('SEC-01: Rolle „kommentieren“ über Hocuspocus-Nachrichtentyp SyncReply (4)', () => {
  it('commentMessageAllowed prüft auch SyncReply-Nachrichten', () => {
    const doc = new Y.Doc();
    const update = stickyUpdate(doc, 'n1');
    expect(commentMessageAllowed(syncMessage('board:x', 0, update), doc)).toBe(false);
    expect(commentMessageAllowed(syncMessage('board:x', 4, update), doc)).toBe(false);
    // unbekannte Nachrichtentypen nicht durchwinken
    expect(commentMessageAllowed(syncMessage('board:x', 42, update), doc)).toBe(false);
  });

  it('live: Kommentierer kann per SyncReply kein Objekt anlegen', async () => {
    const boardId = (await owner.post('/api/boards', { title: 'SyncReply' })).body.board.id as string;
    await owner.post(`/api/boards/${boardId}/share`, { emails: 'carl@example.org', role: 'comment' });
    await owner.post(`/api/boards/${boardId}/share`, { emails: 'edda@example.org', role: 'edit' });
    const e = connect(boardId, editor);
    const c = connect(boardId, commenter);
    await waitFor(() => e.state.synced && c.state.synced);
    const name = `board:${boardId}`;
    c.socket.send(syncMessage(name, 4, stickyUpdate(c.doc, 'n-reply')));
    c.socket.send(syncMessage(name, 0, stickyUpdate(c.doc, 'n-sync')));
    await sleep(400);
    expect(e.doc.getMap('objects').has('n-reply')).toBe(false);
    expect(e.doc.getMap('objects').has('n-sync')).toBe(false);
    const live = env.srv.hocuspocus.documents.get(name)!;
    expect(live.getMap('objects').has('n-reply')).toBe(false);
  });
});

describe('MAIL-1: Einladungen tragen keine frei wählbaren Links in Betreff und Text', () => {
  it('Betreff ohne Titel/Namen, URLs im Titel entschärft', async () => {
    const { mails, defang } = await import('../src/mail-templates.js');
    const ctx = { brand: 'Stachel', publicUrl: 'https://stachel.example', imprintUrl: '', privacyUrl: '' };
    const m = mails.invite(ctx, 'x@example.org', 'Support', 'Konto gesperrt! https://evil.example/login', 'kann ansehen', 'https://stachel.example/?b=1');
    expect(m.subject).toBe('Stachel: Du wurdest zu einem Board eingeladen');
    expect(m.text).not.toContain('https://evil.example');
    expect(m.html).not.toContain('evil.example');
    expect(m.text).toContain('https://stachel.example/?b=1'); // eigener Knopf-Link bleibt
    expect(mails.shared(ctx, 'x@example.org', 'X', 'www.evil.de', 'T', 'r', 'https://stachel.example/b/1').subject).not.toContain('evil');
    expect(defang('Version 1.25')).toBe('Version 1.25');
  });
});

// ---------- UPL-1: Bilder gehören ihrem Board ----------

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function upload(b: Browser, boardId: string): Promise<{ id: string; url: string }> {
  const fd = new FormData();
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 'a.png');
  const r = await b.req('POST', `/api/boards/${boardId}/images`, { body: fd });
  expect(r.status).toBe(201);
  return r.body.image;
}

function imageObj(doc: Y.Doc, id: string, imageId: string, createdBy = '') {
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    for (const [k, v] of Object.entries({ id, type: 'image', x: 0, y: 0, w: 10, h: 10, z: 'a0', imageId, ...(createdBy ? { createdBy } : {}) })) m.set(k, v);
    doc.getMap('objects').set(id, m);
  });
}

const boardOfImage = (id: string) => (env.srv.db.prepare('SELECT board_id FROM images WHERE id = ?').get(id) as { board_id: string } | undefined)?.board_id;
const keyOf = async (b: Browser) => (await b.get('/api/auth/me')).body.user.key as string;

describe('UPL-1: Bilder/PDFs nur über das Board, dem sie gehören', () => {
  it('Ex-Mitglied liest ein Bild nicht über ein eigenes Board mit der ID weiter', async () => {
    const a = (await owner.post('/api/boards', { title: 'Geheim mit Bild' })).body.board.id as string;
    await owner.post(`/api/boards/${a}/share`, { emails: 'edda@example.org', role: 'view' });
    const img = await upload(owner, a);
    expect((await editor.get(img.url)).status).toBe(200);
    await owner.req('DELETE', `/api/boards/${a}/members/${encodeURIComponent(await keyOf(editor))}`);
    expect((await editor.get(img.url)).status).toBe(404);
    // eigenes Board mit der fremden ID (über den Sync eingefügt)
    const own = (await editor.post('/api/boards', { title: 'Mein Board' })).body.board.id as string;
    const e = connect(own, editor);
    await waitFor(() => e.state.synced);
    imageObj(e.doc, 'i1', img.id);
    await sleep(400);
    expect((await editor.get(img.url)).status).toBe(404);
    expect(boardOfImage(img.id)).toBe(a); // keine Kopie, nichts umgehängt
    const live = env.srv.hocuspocus.documents.get(`board:${own}`)!;
    expect((live.getMap('objects').get('i1') as Y.Map<unknown>).get('imageId')).toBe(img.id); // toter Verweis
    // endgültiges Löschen der Quelle „rettet“ das Bild nicht auf das fremde Board
    await owner.req('DELETE', `/api/boards/${a}`);
    expect((await owner.req('DELETE', `/api/trash/${a}`)).status).toBe(200);
    expect(boardOfImage(img.id)).toBeUndefined();
    expect((await owner.get(img.url)).status).toBe(404);
  });

  it('Mitglied fügt ein Bild in sein Board ein → eigene Kopie; nach dem Entzug bleibt die Kopie lesbar', async () => {
    const a = (await owner.post('/api/boards', { title: 'Quelle' })).body.board.id as string;
    await owner.post(`/api/boards/${a}/share`, { emails: 'edda@example.org', role: 'edit' });
    const img = await upload(owner, a);
    const own = (await editor.post('/api/boards', { title: 'Ziel' })).body.board.id as string;
    const e = connect(own, editor);
    await waitFor(() => e.state.synced);
    imageObj(e.doc, 'i1', img.id);
    const idOf = () => (e.doc.getMap('objects').get('i1') as Y.Map<unknown>).get('imageId') as string;
    await waitFor(() => idOf() !== img.id, 3000);
    const copy = idOf();
    expect(boardOfImage(copy)).toBe(own);
    expect(env.srv.db.prepare('SELECT created_by FROM images WHERE id = ?').get(copy)).toEqual({ created_by: await keyOf(editor) });
    await owner.req('DELETE', `/api/boards/${a}/members/${encodeURIComponent(await keyOf(editor))}`);
    expect((await editor.get(img.url)).status).toBe(404);
    expect((await editor.get(`/api/images/${copy}`)).status).toBe(200);
    // die Besitzerin der Quelle sieht die Kopie auf Eddas Board nicht
    expect((await owner.get(`/api/images/${copy}`)).status).toBe(404);
  });

  it('Duplizieren (auch mit „ansehen“, SEC-14) kopiert nur eigene, genutzte Bilder – fremde IDs bleiben tot', async () => {
    const a = (await owner.post('/api/boards', { title: 'Mit Bildern' })).body.board.id as string;
    const used = await upload(owner, a);
    const unused = await upload(owner, a); // hochgeladen, aber nicht (mehr) auf dem Board
    const other = (await commenter.post('/api/boards', { title: 'Fremd' })).body.board.id as string;
    const foreign = await upload(commenter, other);
    const o = connect(a, owner);
    await waitFor(() => o.state.synced);
    imageObj(o.doc, 'i1', used.id);
    imageObj(o.doc, 'i2', foreign.id); // fremde ID ohne Zugriff → bleibt tot
    await sleep(300);
    await owner.post(`/api/boards/${a}/share`, { emails: 'edda@example.org', role: 'view' });
    const count = () => Number((env.srv.db.prepare('SELECT COUNT(*) AS n FROM images').get() as { n: number }).n);
    const before = count();
    const dup = await editor.post(`/api/boards/${a}/duplicate`, {});
    expect(dup.status).toBe(201);
    const copies = env.srv.db.prepare('SELECT id FROM images WHERE board_id = ?').all(dup.body.board.id) as { id: string }[];
    expect(copies.length).toBe(1);
    expect(count()).toBe(before + 1);
    expect((await editor.get(`/api/images/${copies[0]!.id}`)).status).toBe(200);
    expect((await editor.get(foreign.url)).status).toBe(404);
    expect((await editor.get(unused.url)).status).toBe(200); // Board-Bild, Edda sieht das Board
  });

  it('alte Stände: einmalige Umstellung kopiert nur mit Zugriff und leert image_access', async () => {
    const a = (await owner.post('/api/boards', { title: 'Alt Quelle' })).body.board.id as string;
    await owner.post(`/api/boards/${a}/share`, { emails: 'edda@example.org', role: 'edit' });
    const img = await upload(owner, a);
    const eKey = await keyOf(editor);
    const own = (await editor.post('/api/boards', { title: 'Alt Ziel' })).body.board.id as string;
    const attacker = (await commenter.post('/api/boards', { title: 'Alt Angreifer' })).body.board.id as string;
    const put = (boardId: string, objectId: string, createdBy: string) => {
      const d = new Y.Doc();
      imageObj(d, objectId, img.id, createdBy);
      env.srv.db
        .prepare('INSERT OR REPLACE INTO documents (name, state, updated_at) VALUES (?, ?, ?)')
        .run(`board:${boardId}`, Y.encodeStateAsUpdate(d), new Date().toISOString());
    };
    put(own, 'i1', eKey); // Edda hat Zugriff auf die Quelle → Kopie
    put(attacker, 'i2', await keyOf(commenter)); // Carl nicht → bleibt tot
    env.srv.db.prepare('INSERT OR IGNORE INTO image_access (image_id, board_id) VALUES (?, ?)').run(img.id, attacker);
    const binding = new ImageBinding(env.srv.db, path.join(env.cfg.dataDir, 'images'), env.srv.access, () => {});
    const res = binding.migrateLegacyRefs(true);
    expect(res.copied).toBeGreaterThanOrEqual(1);
    const stored = (id: string) => {
      const d = new Y.Doc();
      Y.applyUpdate(d, new Uint8Array((env.srv.db.prepare('SELECT state FROM documents WHERE name = ?').get(`board:${id}`) as { state: Uint8Array }).state));
      return d.getMap('objects');
    };
    const copied = (stored(own).get('i1') as Y.Map<unknown>).get('imageId') as string;
    expect(copied).not.toBe(img.id);
    expect(boardOfImage(copied)).toBe(own);
    expect((stored(attacker).get('i2') as Y.Map<unknown>).get('imageId')).toBe(img.id);
    expect(env.srv.db.prepare('SELECT COUNT(*) AS n FROM image_access').get()).toEqual({ n: 0 });
    expect((await commenter.get(img.url)).status).toBe(404);
  });
});

// ---------- SEC-06: Kommentar-Autorschaft im Live-Sync ----------

describe('SEC-06: fremde Kommentare über /sync nicht ändern, löschen oder fälschen', () => {
  const me = { key: 'u:me', name: 'Ich' };
  const msg = (id: string, by: string, name: string, text = 'x') => ({ id, by, name, text, at: '2026-11-02T10:00:00Z' });
  const thread = (createdBy: string, ...messages: ReturnType<typeof msg>[]) => ({ createdBy, createdAt: 't', resolvedBy: undefined, messages });
  const none = () => false;

  it('Regeln wie die Native-API (commentChangeAllowed)', () => {
    const other = thread('u:o', msg('a', 'u:o', 'Olga'));
    const before = new Map([['t1', other]]);
    // eigene Antwort ja, Antwort im Namen anderer nein
    expect(commentChangeAllowed(before, new Map([['t1', thread('u:o', msg('a', 'u:o', 'Olga'), msg('b', me.key, me.name))]]), me, none)).toBe(true);
    expect(commentChangeAllowed(before, new Map([['t1', thread('u:o', msg('a', 'u:o', 'Olga'), msg('b', 'u:o', 'Olga'))]]), me, none)).toBe(false);
    expect(commentChangeAllowed(before, new Map([['t1', thread('u:o', msg('a', 'u:o', 'Olga'), msg('b', me.key, 'Olga'))]]), me, none)).toBe(false);
    // fremde Nachricht ändern bzw. löschen, fremden Thread löschen, Ersteller:in umschreiben: nein
    expect(commentChangeAllowed(before, new Map([['t1', thread('u:o', msg('a', 'u:o', 'Olga', 'anders'))]]), me, none)).toBe(false);
    expect(commentChangeAllowed(before, new Map([['t1', thread('u:o')]]), me, none)).toBe(false);
    expect(commentChangeAllowed(before, new Map(), me, none)).toBe(false);
    expect(commentChangeAllowed(before, new Map([['t1', thread(me.key, msg('a', 'u:o', 'Olga'))]]), me, none)).toBe(false);
    // neuer Thread mit fremdem Autor nein, eigener ja
    expect(commentChangeAllowed(new Map(), new Map([['t2', thread('u:o', msg('c', 'u:o', 'Olga'))]]), me, none)).toBe(false);
    expect(commentChangeAllowed(new Map(), new Map([['t2', thread(me.key, msg('c', me.key, me.name))]]), me, none)).toBe(true);
    // eigenen Thread samt fremder Antworten löschen ja, per Rückgängig wiederherstellen ja (genau so schon dagewesen)
    const mine = thread(me.key, msg('m', me.key, me.name), msg('r', 'u:o', 'Olga'));
    expect(commentChangeAllowed(new Map([['t3', mine]]), new Map(), me, none)).toBe(true);
    const seen = new Set(mine.messages.map((m) => `${m.id}|${messageHash(m)}`));
    const known = (id: string, h: string) => seen.has(`${id}|${h}`);
    expect(commentChangeAllowed(new Map(), new Map([['t3', mine]]), me, known)).toBe(true);
    const forged = thread(me.key, msg('m', me.key, me.name), msg('r', 'u:o', 'Olga', 'gefälscht'));
    expect(commentChangeAllowed(new Map(), new Map([['t3', forged]]), me, known)).toBe(false);
  });

  it('touchedRoots ordnet Updates ihren Wurzeln zu (ohne sie anzuwenden)', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const t = new Y.Map<unknown>();
      const msgs = new Y.Array<unknown>();
      msgs.push([msg('a', 'u:o', 'Olga')]);
      t.set('messages', msgs);
      doc.getMap('collab.comments').set('t1', t);
    });
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(doc));
    const diff = (fn: () => void) => {
      const sv = Y.encodeStateVector(client);
      fn();
      return Y.encodeStateAsUpdate(client, sv);
    };
    const msgsOf = () => (client.getMap('collab.comments').get('t1') as Y.Map<unknown>).get('messages') as Y.Array<unknown>;
    expect(touchedRoots(doc, stickyUpdate(doc, 'n1'))).toEqual(new Set(['objects']));
    expect(touchedRoots(doc, diff(() => msgsOf().delete(0, 1)))).toEqual(new Set(['collab.comments']));
    expect(touchedRoots(doc, diff(() => msgsOf().push([msg('b', 'u:x', 'X')])))).toEqual(new Set(['collab.comments']));
    expect(readComments(doc).get('t1')?.messages.map((m) => m.id)).toEqual(['a']);
  });

  /** Thread von Olga (Besitzerin) über ihre eigene Verbindung anlegen. */
  async function olgaThread(boardId: string, threadId: string) {
    const o = connect(boardId, owner);
    await waitFor(() => o.state.synced);
    const oKey = await keyOf(owner);
    o.doc.transact(() => {
      const t = new Y.Map<unknown>();
      const msgs = new Y.Array<unknown>();
      msgs.push([{ id: `${threadId}-m1`, by: oKey, name: 'Olga Owner', text: 'Von Olga', at: new Date().toISOString() }]);
      t.set('x', 1);
      t.set('y', 1);
      t.set('resolved', false);
      t.set('createdBy', oKey);
      t.set('createdAt', new Date().toISOString());
      t.set('messages', msgs);
      o.doc.getMap('collab.comments').set(threadId, t);
    });
    const live = () => env.srv.hocuspocus.documents.get(`board:${boardId}`)!;
    await waitFor(() => !!live()?.getMap('collab.comments').has(threadId));
    return { o, oKey, live };
  }

  const msgsOf = (doc: Y.Doc, t = 't1') => (doc.getMap('collab.comments').get(t) as Y.Map<unknown>).get('messages') as Y.Array<Record<string, unknown>>;

  for (const role of ['comment', 'edit'] as const) {
    it(`live (${role}): fremden Thread löschen, Nachricht ändern, Autor fälschen → verworfen; eigene Antwort kommt an`, async () => {
      const boardId = (await owner.post('/api/boards', { title: `Kommentare ${role}` })).body.board.id as string;
      const who = role === 'comment' ? commenter : editor;
      const whoName = role === 'comment' ? 'Carl Comment' : 'Edda Edit';
      await owner.post(`/api/boards/${boardId}/share`, { emails: role === 'comment' ? 'carl@example.org' : 'edda@example.org', role });
      const { oKey, live } = await olgaThread(boardId, 't1');
      const join = async () => {
        const h = connect(boardId, who);
        await waitFor(() => h.state.synced && h.doc.getMap('collab.comments').has('t1'));
        return h;
      };

      // 1. eigene Antwort: kommt an
      const ok = await join();
      const myKey = await keyOf(who);
      msgsOf(ok.doc).push([{ id: 'own', by: myKey, name: whoName, text: 'Meine Antwort', at: new Date().toISOString() }]);
      await waitFor(() => msgsOf(live()).toArray().some((m) => m.id === 'own'));

      // 2. Thread der Besitzerin löschen (je eine frische Verbindung: eine verworfene Nachricht blockiert die folgenden)
      (await join()).doc.getMap('collab.comments').delete('t1');
      // 3. Nachricht der Besitzerin ändern
      const edit = await join();
      edit.doc.transact(() => {
        msgsOf(edit.doc).delete(0, 1);
        msgsOf(edit.doc).insert(0, [{ id: 't1-m1', by: oKey, name: 'Olga Owner', text: 'Olga sagt: alle Rechte an Carl', at: new Date().toISOString() }]);
      });
      // 4. Antwort im Namen der Besitzerin (mit Erwähnung)
      msgsOf((await join()).doc).push([{ id: 'fake', by: oKey, name: 'Olga Owner', text: 'Bitte Passwort schicken', at: new Date().toISOString(), mentions: [myKey] }]);
      await sleep(500);

      expect(msgsOf(live()).toArray().map((m) => `${m.by}:${m.text}`)).toEqual([`${oKey}:Von Olga`, `${myKey}:Meine Antwort`]);
      // kein Posteingang-Eintrag mit falschem Absender
      expect(env.srv.db.prepare('SELECT COUNT(*) AS n FROM mentions WHERE board_id = ? AND text LIKE ?').get(boardId, '%Passwort%')).toEqual({ n: 0 });
    });
  }

  it('live: eigenen Thread löschen und per Rückgängig wiederherstellen (samt fremder Antwort) geht', async () => {
    const boardId = (await owner.post('/api/boards', { title: 'Undo' })).body.board.id as string;
    await owner.post(`/api/boards/${boardId}/share`, { emails: 'carl@example.org', role: 'comment' });
    const { o, live } = await olgaThread(boardId, 't1');
    const c = connect(boardId, commenter);
    await waitFor(() => c.state.synced && c.doc.getMap('collab.comments').has('t1'));
    const cKey = await keyOf(commenter);
    msgsOf(c.doc).push([{ id: 'carl', by: cKey, name: 'Carl Comment', text: 'Antwort von Carl', at: new Date().toISOString() }]);
    await waitFor(() => msgsOf(live()).length === 2 && msgsOf(o.doc).length === 2);
    const undo = new Y.UndoManager(o.doc.getMap('collab.comments'));
    o.doc.getMap('collab.comments').delete('t1');
    await waitFor(() => !live().getMap('collab.comments').has('t1'));
    undo.undo();
    await waitFor(() => live().getMap('collab.comments').has('t1'));
    expect(msgsOf(live()).toArray().map((m) => m.text)).toEqual(['Von Olga', 'Antwort von Carl']);
  });
});
