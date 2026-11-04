// Modus local: Boards gehören jemandem; Teilen, Rollen, Freigabelink, Besitz übertragen und die Durchsetzung über
// REST, Bilder, Übersicht (SSE), Personen-Liste und Yjs (ansehen = readOnly, kommentieren = nur Kommentare).
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { updateTouchesOnly, COMMENT_ROOTS } from '../src/access.js';
import { Browser, startEnv, waitFor, sleep, type TestEnv } from './helpers.js';
import { captcha, LOCAL, linkParam, mailsOf, signUp, waitMail } from './local-helpers.js';

let env: TestEnv;
let owner: Browser;
let viewer: Browser;
let commenter: Browser;
let editor: Browser;
let stranger: Browser;
const key = async (b: Browser) => (await b.get('/api/auth/me')).body.user.key as string;

beforeAll(async () => {
  env = await startEnv({ instance: LOCAL });
  owner = await signUp(env, 'Olga Owner', 'olga@example.org');
  viewer = await signUp(env, 'Vera Viewer', 'vera@example.org');
  commenter = await signUp(env, 'Carl Comment', 'carl@example.org');
  editor = await signUp(env, 'Edda Edit', 'edda@example.org');
  stranger = await signUp(env, 'Sven Fremd', 'sven@example.org');
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
  const state = { synced: false, failed: null as string | null };
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: `board:${boardId}`,
    document: doc,
    onSynced: () => (state.synced = true),
    onAuthenticationFailed: ({ reason }) => (state.failed = reason),
  });
  provider.attach();
  const h = { doc, provider, state, destroy: () => (provider.destroy(), socket.destroy()) };
  open.push(h);
  return h;
}

const sticky = (doc: Y.Doc, id: string, text: string) =>
  doc.transact(() => {
    const o = new Y.Map<unknown>();
    o.set('id', id);
    o.set('type', 'sticky');
    o.set('text', text);
    doc.getMap('objects').set(id, o);
  });

const comment = (doc: Y.Doc, id: string, text: string, who = { key: 'x', name: 'x' }) =>
  doc.transact(() => {
    const t = new Y.Map<unknown>();
    t.set('x', 1);
    t.set('y', 2);
    t.set('createdBy', who.key);
    const msgs = new Y.Array<unknown>();
    msgs.push([{ id: `m-${id}`, by: who.key, name: who.name, text, at: new Date().toISOString() }]);
    t.set('messages', msgs);
    doc.getMap('collab.comments').set(id, t);
  });

/** Gespeicherter Stand (SQLite) des Boards. */
function stored(boardId: string): Y.Doc {
  const d = new Y.Doc();
  const live = env.srv.hocuspocus.documents.get(`board:${boardId}`);
  if (live) Y.applyUpdate(d, Y.encodeStateAsUpdate(live));
  return d;
}

describe('Boards gehören jemandem', () => {
  let boardId: string;
  beforeAll(async () => {
    boardId = (await owner.post('/api/boards', { title: 'Geheimplan' })).body.board.id;
  });

  it('nur die Besitzerin sieht ein neues Board; andere bekommen überall 404', async () => {
    expect((await owner.get('/api/boards')).body.boards.map((b: any) => [b.title, b.role])).toContainEqual(['Geheimplan', 'owner']);
    expect((await stranger.get('/api/boards')).body.boards.find((b: any) => b.id === boardId)).toBeUndefined();
    expect((await stranger.req('PATCH', `/api/boards/${boardId}`, { json: { title: 'x' } })).status).toBe(404);
    expect((await stranger.get(`/api/boards/${boardId}/thumbnail`)).status).toBe(404);
    expect((await stranger.post(`/api/boards/${boardId}/duplicate`, {})).status).toBe(404);
    expect((await stranger.req('PUT', `/api/boards/${boardId}/favorite`)).status).toBe(404);
    expect((await stranger.get(`/api/boards/${boardId}/share`)).status).toBe(404);
    expect((await stranger.get(`/api/users?board=${boardId}`)).status).toBe(404);
    const c = connect(boardId, stranger);
    await waitFor(() => c.state.failed !== null);
    expect(c.state.failed).toBe('no_access');
  });

  it('Bilder nur für Personen mit Zugriff', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const fd = new FormData();
    fd.append('file', new Blob([png], { type: 'image/png' }), 'a.png');
    const up = await owner.req('POST', `/api/boards/${boardId}/images`, { body: fd });
    expect(up.status).toBe(201);
    expect((await owner.get(up.body.image.url)).status).toBe(200);
    expect((await stranger.get(up.body.image.url)).status).toBe(404);
    expect((await stranger.post(`/api/boards/${boardId}/images`)).status).toBe(404);
  });

  it('Teilen mit Rollen: Liste, REST-Rechte je Rolle, Mitteilungsmail', async () => {
    const before = mailsOf(env).length;
    const r = await owner.post(`/api/boards/${boardId}/share`, { emails: ['vera@example.org'], role: 'view' });
    expect(r.status).toBe(200);
    await owner.post(`/api/boards/${boardId}/share`, { emails: 'carl@example.org', role: 'comment' });
    await owner.post(`/api/boards/${boardId}/share`, { emails: ['EDDA@example.org'], role: 'edit' });
    const m = await waitMail(env, 'vera@example.org', /geteilt/, before);
    expect(m.text).toContain(`/b/${boardId}`);

    const info = (await owner.get(`/api/boards/${boardId}/share`)).body;
    expect(info.people.map((p: any) => [p.name, p.role])).toEqual([
      ['Olga Owner', 'owner'],
      ['Edda Edit', 'edit'],
      ['Carl Comment', 'comment'],
      ['Vera Viewer', 'view'],
    ]);
    expect(info.people[1].email).toBe('edda@example.org');
    // ansehen: keine E-Mail-Adressen der anderen, nicht verwalten
    const vInfo = (await viewer.get(`/api/boards/${boardId}/share`)).body;
    expect(vInfo).toMatchObject({ role: 'view', canManage: false });
    expect(vInfo.people.every((p: any) => p.email === null)).toBe(true);

    expect((await viewer.get('/api/boards')).body.boards.find((b: any) => b.id === boardId).role).toBe('view');
    expect((await viewer.req('PATCH', `/api/boards/${boardId}`, { json: { title: 'x' } })).status).toBe(403);
    expect((await viewer.post(`/api/boards/${boardId}/share`, { emails: ['sven@example.org'], role: 'edit' })).status).toBe(403);
    expect((await commenter.req('PUT', `/api/boards/${boardId}/thumbnail`, { body: Buffer.from('x'), headers: { 'Content-Type': 'image/png' } })).status).toBe(403);
    expect((await editor.req('PATCH', `/api/boards/${boardId}`, { json: { title: 'Geheimplan 2' } })).status).toBe(200);
    expect((await editor.req('DELETE', `/api/boards/${boardId}`)).status).toBe(403);
    expect((await viewer.req('PUT', `/api/boards/${boardId}/favorite`)).status).toBe(200);
    // Personen-Auswahl (Erwähnungen) nur mit Zugriff
    const people = (await viewer.get(`/api/users?board=${boardId}`)).body.users.map((u: any) => u.name);
    expect(people).toEqual(['Carl Comment', 'Edda Edit', 'Olga Owner', 'Vera Viewer']);
    expect(people).not.toContain('Sven Fremd');
  });

  it('Yjs: bearbeiten schreibt, ansehen ist schreibgeschützt, kommentieren nur Kommentare', async () => {
    const e = connect(boardId, editor);
    const v = connect(boardId, viewer);
    const c = connect(boardId, commenter);
    await waitFor(() => e.state.synced && v.state.synced && c.state.synced);

    sticky(e.doc, 'n-edit', 'vom Editor');
    await waitFor(() => v.doc.getMap('objects').has('n-edit') && c.doc.getMap('objects').has('n-edit'));

    // Kommentar (erlaubt) kommt an, danach ein Objekt (verworfen)
    // als die Person selbst (fremder Autor würde abgelehnt, SEC-06)
    comment(c.doc, 't-comment', 'Kommentar vom Kommentierer', { key: await key(commenter), name: 'Carl Comment' });
    await waitFor(() => e.doc.getMap('collab.comments').has('t-comment'));
    sticky(c.doc, 'n-comment', 'vom Kommentierer');
    sticky(v.doc, 'n-view', 'vom Viewer');
    comment(v.doc, 't-view', 'Kommentar vom Viewer');
    await sleep(400);
    expect(e.doc.getMap('objects').has('n-view')).toBe(false);
    expect(e.doc.getMap('objects').has('n-comment')).toBe(false);
    expect(e.doc.getMap('collab.comments').has('t-view')).toBe(false);
    const s = stored(boardId);
    expect(s.getMap('objects').has('n-edit')).toBe(true);
    expect(s.getMap('objects').has('n-comment')).toBe(false);
    expect(s.getMap('collab.comments').has('t-comment')).toBe(true);

    // Kommentierer darf ein Objekt auch nicht löschen oder ändern (frische Verbindung)
    const c2 = connect(boardId, commenter);
    await waitFor(() => c2.state.synced && c2.doc.getMap('objects').has('n-edit'));
    c2.doc.transact(() => c2.doc.getMap('objects').delete('n-edit'));
    await sleep(400);
    expect(e.doc.getMap('objects').has('n-edit')).toBe(true);
    expect(stored(boardId).getMap('objects').has('n-edit')).toBe(true);
  });

  it('Rolle ändern trennt die Verbindung; mit neuer Rolle darf sie schreiben', async () => {
    const v = connect(boardId, viewer);
    await waitFor(() => v.state.synced);
    const vKey = await key(viewer);
    await owner.req('PATCH', `/api/boards/${boardId}/members/${encodeURIComponent(vKey)}`, { json: { role: 'edit' } });
    v.destroy();
    const v2 = connect(boardId, viewer);
    const e = connect(boardId, editor);
    await waitFor(() => v2.state.synced && e.state.synced);
    sticky(v2.doc, 'n-view2', 'jetzt mit Bearbeiten');
    await waitFor(() => e.doc.getMap('objects').has('n-view2'));
    await owner.req('PATCH', `/api/boards/${boardId}/members/${encodeURIComponent(vKey)}`, { json: { role: 'view' } });
  });

  it('Zugriff entziehen: Board weg aus der Liste, Sync abgelehnt; selbst verlassen geht', async () => {
    const vKey = await key(viewer);
    expect((await owner.req('DELETE', `/api/boards/${boardId}/members/${encodeURIComponent(vKey)}`)).status).toBe(200);
    expect((await viewer.get('/api/boards')).body.boards.find((b: any) => b.id === boardId)).toBeUndefined();
    const v = connect(boardId, viewer);
    await waitFor(() => v.state.failed !== null);
    expect(v.state.failed).toBe('no_access');
    const cKey = await key(commenter);
    expect((await commenter.req('DELETE', `/api/boards/${boardId}/members/${encodeURIComponent(cKey)}`)).body.left).toBe(true);
    expect((await commenter.get(`/api/boards/${boardId}/share`)).status).toBe(404);
    // Besitzerin lässt sich nicht entfernen
    const oKey = await key(owner);
    expect((await editor.req('DELETE', `/api/boards/${boardId}/members/${encodeURIComponent(oKey)}`)).status).toBe(403);
  });

  it('Freigabelink: angemeldete Personen mit Link sehen das Board, danach unter „Mit mir geteilt“; abschaltbar', async () => {
    expect((await stranger.get(`/api/boards/${boardId}/share`)).status).toBe(404);
    expect((await editor.req('PUT', `/api/boards/${boardId}/link`, { json: { role: 'comment' } })).body.link).toBe('comment');
    // noch nicht in der Liste (kennt den Link nicht), aber mit ?open= bzw. Editor
    expect((await stranger.get('/api/boards')).body.boards.find((b: any) => b.id === boardId)).toBeUndefined();
    expect((await stranger.get(`/api/boards?open=${boardId}`)).body.boards.find((b: any) => b.id === boardId).role).toBe('comment');
    expect((await stranger.get('/api/boards')).body.boards.find((b: any) => b.id === boardId)).toBeDefined();
    const ownerInfo = (await owner.get(`/api/boards/${boardId}/share`)).body;
    expect(ownerInfo.people.find((p: any) => p.name === 'Sven Fremd')).toMatchObject({ role: 'comment', via: 'link' });
    // ohne Anmeldung nichts
    expect((await new Browser(env.base).get(`/api/boards/${boardId}/share`)).status).toBe(401);
    await owner.req('PUT', `/api/boards/${boardId}/link`, { json: { role: null } });
    expect((await stranger.get('/api/boards')).body.boards.find((b: any) => b.id === boardId)).toBeUndefined();
    expect((await stranger.get(`/api/boards/${boardId}/share`)).status).toBe(404);
  });

  it('Einladung an Unregistrierte: Mail, nach Registrierung + Bestätigung Mitglied', async () => {
    const before = mailsOf(env).length;
    await owner.post(`/api/boards/${boardId}/share`, { emails: ['neu.gast@example.org'], role: 'edit' });
    const info = (await owner.get(`/api/boards/${boardId}/share`)).body;
    expect(info.invites).toEqual([{ email: 'neu.gast@example.org', role: 'edit' }]);
    const inv = await waitMail(env, 'neu.gast@example.org', /eingeladen/, before);
    expect(inv.text).toContain('register=1');
    const gast = await signUp(env, 'Gast Neu', 'neu.gast@example.org');
    expect((await gast.get('/api/boards')).body.boards.find((b: any) => b.id === boardId).role).toBe('edit');
    expect((await owner.get(`/api/boards/${boardId}/share`)).body.invites).toEqual([]);
  });

  it('Besitz übertragen: nur Besitzerin, neue Besitzerin darf löschen, alte bleibt Bearbeiterin', async () => {
    const eKey = await key(editor);
    expect((await editor.post(`/api/boards/${boardId}/owner`, { key: eKey })).status).toBe(403);
    expect((await owner.post(`/api/boards/${boardId}/owner`, { key: 'u:gibtsnicht' })).status).toBe(400);
    const r = await owner.post(`/api/boards/${boardId}/owner`, { key: eKey });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('edit');
    expect((await editor.get('/api/boards')).body.boards.find((b: any) => b.id === boardId)).toMatchObject({ role: 'owner', createdByName: 'Edda Edit' });
    expect((await owner.req('DELETE', `/api/boards/${boardId}`)).status).toBe(403);
    // Papierkorb nur für die Besitzerin
    expect((await editor.req('DELETE', `/api/boards/${boardId}`)).status).toBe(200);
    expect((await editor.get('/api/trash')).body.boards.map((b: any) => b.id)).toContain(boardId);
    expect((await owner.get('/api/trash')).body.boards.map((b: any) => b.id)).not.toContain(boardId);
    expect((await owner.post(`/api/trash/${boardId}/restore`)).status).toBe(404);
    expect((await editor.post(`/api/trash/${boardId}/restore`)).status).toBe(200);
  });
});

describe('Übersicht live (SSE) nur mit Zugriff', () => {
  it('fremde Boards erzeugen keine Ereignisse, Teilen meldet sich bei der eingeladenen Person', async () => {
    const res = await fetch(`${env.base}/api/boards/events`, { headers: { cookie: stranger.cookieHeader() } });
    const reader = res.body!.getReader();
    let text = '';
    const pump = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
    })();
    const hidden = (await owner.post('/api/boards', { title: 'Nur Olga' })).body.board.id;
    await owner.req('PATCH', `/api/boards/${hidden}`, { json: { title: 'Nur Olga 2' } });
    const shared = (await owner.post('/api/boards', { title: 'Für Sven' })).body.board.id;
    await owner.post(`/api/boards/${shared}/share`, { emails: ['sven@example.org'], role: 'view' });
    await waitFor(() => text.includes(shared));
    expect(text).not.toContain(hidden);
    await reader.cancel();
    await pump.catch(() => {});
  });
});

describe('Konto löschen (DSGVO)', () => {
  it('eigene Boards übertragen oder löschen, Mitgliedschaften und Sitzungen weg', async () => {
    const quinn = await signUp(env, 'Quinn', 'quinn@example.org');
    const keep = (await quinn.post('/api/boards', { title: 'Weitergeben' })).body.board.id;
    const drop = (await quinn.post('/api/boards', { title: 'Wegwerfen' })).body.board.id;
    await quinn.post(`/api/boards/${keep}/share`, { emails: ['olga@example.org'], role: 'view' });
    const oKey = await key(owner);
    const acc = (await quinn.get('/api/account')).body;
    expect(acc.account.email).toBe('quinn@example.org');
    expect(acc.boards.find((b: any) => b.id === keep).people.map((p: any) => p.key)).toEqual([oKey]);
    expect((await quinn.post('/api/account/delete', { password: 'falsch', boards: {} })).status).toBe(403);
    const r = await quinn.post('/api/account/delete', { password: 'Wüstenblume-Siebzehn', boards: { [keep]: oKey, [drop]: 'delete' } });
    expect(r.status).toBe(200);
    expect((await quinn.get('/api/auth/me')).status).toBe(401);
    expect((await owner.get('/api/boards')).body.boards.find((b: any) => b.id === keep)).toMatchObject({ role: 'owner' });
    expect(env.srv.db.prepare('SELECT 1 FROM boards WHERE id = ?').get(drop)).toBeUndefined();
    expect(env.srv.db.prepare("SELECT 1 FROM accounts WHERE email = 'quinn@example.org'").get()).toBeUndefined();
    const b = new Browser(env.base);
    expect((await b.post('/api/auth/login', { email: 'quinn@example.org', password: 'Wüstenblume-Siebzehn' })).status).toBe(401);
    // Adresse ist wieder frei
    const again = await b.post('/api/auth/register', { name: 'Quinn 2', email: 'quinn@example.org', password: 'Wüstenblume-Siebzehn', terms: true, captcha: await captcha(b) });
    expect(again.status).toBe(200);
    const m = await waitMail(env, 'quinn@example.org', /bestätigen/);
    expect(linkParam(m, 'verify')).not.toBe('');
  });
});

describe('Kommentar-Prüfung (updateTouchesOnly)', () => {
  it('erkennt Änderungen außerhalb der Kommentare, auch verschachtelt und als Löschung', () => {
    const base = new Y.Doc();
    sticky(base, 'a', 'x');
    comment(base, 't1', 'hallo');
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(base));
    /** Änderung am Client als Update; erlaubte übernimmt der „Server“ (base) wie im Betrieb */
    const diff = (fn: () => void) => {
      const before = Y.encodeStateVector(client);
      fn();
      return Y.encodeStateAsUpdate(client, before);
    };
    const accept = (u: Uint8Array) => {
      const ok = updateTouchesOnly(base, u, COMMENT_ROOTS);
      if (ok) Y.applyUpdate(base, u);
      return ok;
    };
    expect(accept(diff(() => comment(client, 't2', 'neu')))).toBe(true);
    const msgs = client.getMap<Y.Map<unknown>>('collab.comments').get('t1')!.get('messages') as Y.Array<unknown>;
    expect(accept(diff(() => msgs.push([{ id: 'm2', text: 'Antwort' }])))).toBe(true);
    expect(accept(diff(() => client.getMap('structure.people').set('u:x', 'X')))).toBe(true);
    expect(base.getMap('collab.comments').has('t2')).toBe(true);
    expect(updateTouchesOnly(base, diff(() => (client.getMap('objects').get('a') as Y.Map<unknown>).set('text', 'geändert')), COMMENT_ROOTS)).toBe(false);
    expect(updateTouchesOnly(base, diff(() => client.getMap('objects').delete('a')), COMMENT_ROOTS)).toBe(false);
    expect(updateTouchesOnly(base, diff(() => client.getMap('collab.votes').set('x', 1)), COMMENT_ROOTS)).toBe(false);
    // Update mit fehlenden Vorgängern: abgelehnt
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(base));
    other.getMap('collab.comments').set('t9', 'x');
    const first = Y.encodeStateAsUpdate(other, Y.encodeStateVector(base));
    other.getMap('collab.comments').set('t10', 'y');
    const second = Y.encodeStateAsUpdate(other, Y.encodeStateVectorFromUpdate(Y.mergeUpdates([Y.encodeStateAsUpdate(base), first])));
    expect(updateTouchesOnly(base, second, COMMENT_ROOTS)).toBe(false);
  });
});
