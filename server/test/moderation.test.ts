// Melden (POST /api/reports, DSA Art. 16), Blockieren (/api/blocks: Posteingang, Einladungen) und Moderation über die
// Admin-API (tools/admin.mts): entscheiden mit Begründung und Benachrichtigung, Inhalte entfernen, Boards sperren
// (readonly/hidden) und löschen, Konten sperren. Modus local und org.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadInstance } from '../src/instance.js';
import { Browser, loginAdmin, sleep, startEnv, waitFor, type TestEnv } from './helpers.js';
import { LOCAL, mailsOf, PW, signUp, waitMail } from './local-helpers.js';

const ADMIN_TOKEN = 'admin-token-'.padEnd(48, 'x');
const MOD = 'moderation@example.org';
const admin = (env: TestEnv) => {
  const b = new Browser(env.base);
  const h = { Authorization: `Bearer ${ADMIN_TOKEN}` };
  return {
    get: (p: string) => b.get(p, { headers: h }),
    post: (p: string, json?: unknown) => b.post(p, json, { headers: h }),
    put: (p: string, json?: unknown) => b.req('PUT', p, { json, headers: h }),
    del: (p: string) => b.req('DELETE', p, { headers: h }),
  };
};
const me = async (b: Browser) => (await b.get('/api/auth/me')).body.user as { key: string; name: string };
const put = (b: Browser, p: string, json?: unknown) => b.req('PUT', p, { json });
const del = (b: Browser, p: string) => b.req('DELETE', p);

let seq = 0;
/** Kommentar-Thread als Person schreiben (wie der Browser über den Sync; der Posteingang sieht die Person als Ursprung) */
async function comment(env: TestEnv, boardId: string, by: { key: string; name: string }, text: string, mentions: string[] = []) {
  const thread = `t${++seq}`;
  const msg = `m${seq}`;
  const conn = await env.srv.hocuspocus.openDirectConnection(`board:${boardId}`, { user: { ...by, isOrga: false } });
  await conn.transact((doc) => {
    const t = new Y.Map<unknown>();
    const msgs = new Y.Array<unknown>();
    msgs.push([{ id: msg, by: by.key, name: by.name, text, at: new Date().toISOString(), ...(mentions.length ? { mentions } : {}) }]);
    t.set('x', 10);
    t.set('y', 10);
    t.set('messages', msgs);
    doc.getMap('collab.comments').set(thread, t);
  });
  await conn.disconnect();
  return { thread, msg };
}

async function sticky(env: TestEnv, boardId: string, id: string, text: string) {
  const conn = await env.srv.hocuspocus.openDirectConnection(`board:${boardId}`, { system: 'test' } as never);
  await conn.transact((doc) => {
    const o = new Y.Map<unknown>();
    o.set('id', id);
    o.set('type', 'sticky');
    o.set('x', 0);
    o.set('y', 0);
    o.set('w', 100);
    o.set('h', 100);
    o.set('text', text);
    doc.getMap('objects').set(id, o);
  });
  await conn.disconnect();
}

/** Browser-Sync (Hocuspocus) mit dem Cookie einer Person */
function connect(env: TestEnv, boardId: string, b: Browser) {
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
  return { doc, state, destroy: () => (provider.destroy(), socket.destroy()) };
}

async function docHas(env: TestEnv, boardId: string, read: (doc: Y.Doc) => boolean) {
  const conn = await env.srv.hocuspocus.openDirectConnection(`board:${boardId}`, { system: 'test' } as never);
  let res = false;
  await conn.transact((doc) => {
    res = read(doc);
  });
  await conn.disconnect();
  return res;
}

describe('Modus local', () => {
  let env: TestEnv;
  let olga: Browser;
  let mia: Browser;
  let troll: Browser;
  let stranger: Browser;
  let boardId: string;
  let keys: Record<'olga' | 'mia' | 'troll', { key: string; name: string }>;

  beforeAll(async () => {
    env = await startEnv({ instance: { ...LOCAL, reportEmail: MOD, adminToken: ADMIN_TOKEN } });
    olga = await signUp(env, 'Olga Owner', 'olga@example.org');
    mia = await signUp(env, 'Mia Meldet', 'mia@example.org');
    troll = await signUp(env, 'Tom Troll', 'tom@example.org');
    stranger = await signUp(env, 'Sven Fremd', 'sven@example.org');
    keys = { olga: await me(olga), mia: await me(mia), troll: await me(troll) };
    boardId = (await olga.post('/api/boards', { title: 'Festival https://evil.example' })).body.board.id;
    const s = await olga.post(`/api/boards/${boardId}/share`, { emails: ['mia@example.org', 'tom@example.org'], role: 'edit' });
    expect(s.status).toBe(200);
  });
  afterAll(async () => {
    await env?.stop();
  });

  describe('Melden', () => {
    it('Board melden: 201, Mail an die Melde-Adresse, Eingangsbestätigung an die meldende Person', async () => {
      const before = mailsOf(env).length;
      const r = await mia.post('/api/reports', { boardId, reason: 'spam', text: 'Lauter Werbung hier' });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ ok: true, mailed: true });
      expect(r.body.report.id).toMatch(/^R-[A-Z0-9]{8}$/);
      const mod = await waitMail(env, MOD, new RegExp(r.body.report.id), before);
      expect(mod.text).toContain('Spam oder Betrug');
      expect(mod.text).toContain('Lauter Werbung hier');
      expect(mod.text).toContain('Mia Meldet');
      // Board-Titel entschärft (frei wählbar)
      expect(mod.text).not.toContain('https://evil.example');
      const ack = await waitMail(env, 'mia@example.org', /ist eingegangen/, before);
      expect(ack.text).toContain(r.body.report.id);
      expect(ack.text).toContain('Ein Mensch prüft');
    });

    it('prüft Eingaben, Zugriff und Anmeldung', async () => {
      expect((await mia.post('/api/reports', { boardId, reason: 'egal' })).status).toBe(400);
      const noText = await mia.post('/api/reports', { boardId, reason: 'illegal', text: 'kurz' });
      expect(noText.status).toBe(400);
      expect(noText.body.error).toBe('text_required');
      expect((await mia.post('/api/reports', { boardId, reason: 'spam', text: 'x'.repeat(2001) })).status).toBe(400);
      expect((await mia.post('/api/reports', { boardId: 'gibtsnicht', reason: 'spam' })).status).toBe(404);
      expect((await stranger.post('/api/reports', { boardId, reason: 'spam' })).status).toBe(404);
      expect((await mia.post('/api/reports', { boardId, reason: 'spam', userKey: keys.mia.key })).status).toBe(400);
      expect((await mia.post('/api/reports', { boardId, reason: 'spam', objectId: 'fehlt' })).status).toBe(404);
      expect((await new Browser(env.base).post('/api/reports', { boardId, reason: 'spam' })).status).toBe(401);
      expect((await mia.post('/api/reports', { boardId, reason: 'spam' }, { csrf: false })).status).toBe(403);
    });

    it('Objekt, Kommentar und Person melden: Beleg und betroffene Person', async () => {
      await sticky(env, boardId, 'obj1', 'Beleidigender Text auf der Notiz');
      const o = await mia.post('/api/reports', { boardId, objectId: 'obj1', reason: 'harassment' });
      expect(o.status).toBe(201);
      const c = await comment(env, boardId, keys.troll, 'Du bist doof');
      const cr = await mia.post('/api/reports', { boardId, commentId: c.thread, messageId: c.msg, reason: 'harassment' });
      expect(cr.status).toBe(201);
      const p = await mia.post('/api/reports', { boardId, userKey: keys.troll.key, reason: 'harassment', text: 'schreibt ständig Beleidigungen' });
      expect(p.status).toBe(201);
      const a = admin(env);
      const ro = (await a.get(`/api/admin/reports/${o.body.report.id}`)).body.report;
      expect(ro.evidence.object).toMatchObject({ id: 'obj1', type: 'sticky', text: 'Beleidigender Text auf der Notiz' });
      const rc = (await a.get(`/api/admin/reports/${cr.body.report.id}`)).body.report;
      expect(rc.evidence.comment.messages[0]).toMatchObject({ text: 'Du bist doof', by: keys.troll.key });
      expect(rc.target).toEqual({ key: keys.troll.key, name: 'Tom Troll' });
      const rp = (await a.get(`/api/admin/reports/${p.body.report.id}`)).body.report;
      expect(rp.target).toEqual({ key: keys.troll.key, name: 'Tom Troll' });
      expect(rp.reasonLabel).toBe('Belästigung, Hass oder Bedrohung');
    });

    it('Rate-Limit: höchstens 10 Meldungen je Person und Stunde', async () => {
      const b = await signUp(env, 'Viel Melder', 'viel@example.org');
      const id = (await b.post('/api/boards', { title: 'Eigenes' })).body.board.id;
      for (let i = 0; i < 10; i++) expect((await b.post('/api/reports', { boardId: id, reason: 'spam' })).status).toBe(201);
      const r = await b.post('/api/reports', { boardId: id, reason: 'spam' });
      expect(r.status).toBe(429);
    });
  });

  describe('Admin-API', () => {
    it('nur mit Admin-Token', async () => {
      const b = new Browser(env.base);
      expect((await b.get('/api/admin/reports')).status).toBe(401);
      expect((await b.get('/api/admin/reports', { headers: { Authorization: 'Bearer falsch' } })).status).toBe(401);
      // Sitzung einer Person reicht nicht
      expect((await olga.get('/api/admin/reports')).status).toBe(401);
      const list = await admin(env).get('/api/admin/reports');
      expect(list.status).toBe(200);
      expect(list.body.reports.length).toBeGreaterThan(3);
      expect(list.body.reports.every((r: { status: string }) => r.status === 'open')).toBe(true);
    });

    it('Inhalt entfernen: Kommentar weg, Entscheidung an beide Seiten (Art. 16 Abs. 5, Art. 17)', async () => {
      const c = await comment(env, boardId, keys.troll, 'Noch eine Beleidigung');
      const id = (await mia.post('/api/reports', { boardId, commentId: c.thread, reason: 'harassment' })).body.report.id;
      const before = mailsOf(env).length;
      const d = await admin(env).post(`/api/admin/reports/${id}/decision`, { decision: 'content_removed', statement: 'Beleidigung einer Person, verstößt gegen Nr. 4 der Nutzungsbedingungen.', ground: 'Nutzungsbedingungen Nr. 4' });
      expect(d.status).toBe(200);
      expect(d.body.applied).toBe('Kommentar entfernt');
      expect(d.body.notified).toMatchObject({ reporter: true, affected: true });
      expect(d.body.report).toMatchObject({ status: 'closed', decision: { decision: 'content_removed' } });
      expect(await docHas(env, boardId, (doc) => doc.getMap('collab.comments').has(c.thread))).toBe(false);
      const toReporter = await waitMail(env, 'mia@example.org', /Entscheidung zu deiner Meldung/, before);
      expect(toReporter.text).toContain('Inhalt entfernt');
      expect(toReporter.text).toContain('Beleidigung einer Person');
      const toAffected = await waitMail(env, 'tom@example.org', /Maßnahme wegen einer Meldung/, before);
      expect(toAffected.text).toContain('Nutzungsbedingungen Nr. 4');
      expect(toAffected.text).toContain('außergerichtliche Streitbeilegungsstelle');
      // meldende Person wird nicht genannt
      expect(toAffected.text).not.toContain('Mia');
      // Begründung ist Pflicht
      expect((await admin(env).post(`/api/admin/reports/${id}/decision`, { decision: 'no_action', statement: 'kurz' })).status).toBe(400);
    });

    it('Objekt entfernen', async () => {
      await sticky(env, boardId, 'obj2', 'Werbung');
      const id = (await mia.post('/api/reports', { boardId, objectId: 'obj2', reason: 'spam' })).body.report.id;
      const d = await admin(env).post(`/api/admin/reports/${id}/decision`, { decision: 'content_removed', statement: 'Werbung ohne Bezug zum Board entfernt.' });
      expect(d.body.applied).toBe('Objekt obj2 entfernt');
      expect(await docHas(env, boardId, (doc) => doc.getMap('objects').has('obj2'))).toBe(false);
    });

    it('Board nur ansehen bzw. ausblenden, wieder entsperren', async () => {
      const a = admin(env);
      const id = (await mia.post('/api/reports', { boardId, reason: 'other', text: 'Das Board enthält Hetze' })).body.report.id;
      const d = await a.post(`/api/admin/reports/${id}/decision`, { decision: 'board_readonly', statement: 'Board bis zur Klärung gesperrt.', notify: false });
      expect(d.body.applied).toContain('nur ansehen');
      expect(d.body.notified).toBeNull();
      const role = async (b: Browser) => (await b.get('/api/boards')).body.boards.find((x: { id: string }) => x.id === boardId)?.role;
      expect(await role(olga)).toBe('view');
      expect(await role(mia)).toBe('view');
      const rename = await olga.req('PATCH', `/api/boards/${boardId}`, { json: { title: 'Neu' } });
      // Modus local: der Rechte-Guard (access.ts) antwortet mit no_permission, die Rolle ist ja nur noch `view`
      expect(rename.status).toBe(403);
      expect((await mia.get(`/api/boards/${boardId}/moderation`)).body).toEqual({ ok: true, lock: { mode: 'readonly', reason: 'Board bis zur Klärung gesperrt.' } });

      expect((await a.put(`/api/admin/boards/${boardId}/lock`, { mode: 'hidden', reason: 'ausgeblendet' })).status).toBe(200);
      expect(await role(olga)).toBeUndefined();
      expect((await mia.get(`/api/boards/${boardId}/moderation`)).status).toBe(404);
      const locks = (await a.get('/api/admin/locks')).body;
      expect(locks.boards).toEqual([expect.objectContaining({ id: boardId, mode: 'hidden' })]);
      expect(locks.reportEmail).toBe(MOD);

      expect((await a.del(`/api/admin/boards/${boardId}/lock`)).body).toEqual({ ok: true, unlocked: true });
      expect(await role(olga)).toBe('owner');
      expect(await role(mia)).toBe('edit');
      expect((await mia.get(`/api/boards/${boardId}/moderation`)).body).toEqual({ ok: true, lock: null });
    });

    it('Konto sperren: Anfragen und Anmeldung abgewiesen, entsperren', async () => {
      const a = admin(env);
      const id = (await mia.post('/api/reports', { boardId, userKey: keys.troll.key, reason: 'harassment' })).body.report.id;
      const d = await a.post(`/api/admin/reports/${id}/decision`, { decision: 'account_locked', statement: 'Wiederholte Beleidigungen trotz Hinweis.' });
      expect(d.body.applied).toBe(`Konto ${keys.troll.key} gesperrt`);
      const r = await troll.get('/api/boards');
      expect(r.status).toBe(401); // Sitzung beim Sperren gelöscht
      const login = await troll.post('/api/auth/login', { email: 'tom@example.org', password: PW });
      expect(login.status).toBe(403);
      expect(login.body.error).toBe('account_locked');
      expect(login.body.message).toContain(MOD);
      expect(troll.cookies.size).toBe(0);
      expect((await a.get('/api/admin/locks')).body.accounts).toEqual([expect.objectContaining({ key: keys.troll.key, name: 'Tom Troll' })]);
      // andere bleiben unberührt
      expect((await mia.get('/api/boards')).status).toBe(200);
      expect((await a.del(`/api/admin/accounts/${encodeURIComponent(keys.troll.key)}/lock`)).body.unlocked).toBe(true);
      expect((await troll.post('/api/auth/login', { email: 'tom@example.org', password: PW })).status).toBe(200);
      expect((await troll.get('/api/boards')).status).toBe(200);
    });

    it('Board löschen', async () => {
      const id = (await mia.post('/api/boards', { title: 'Weg damit' })).body.board.id;
      expect((await admin(env).del(`/api/admin/boards/${id}`)).body).toEqual({ ok: true, deleted: true });
      expect((await mia.get('/api/boards')).body.boards.some((b: { id: string }) => b.id === id)).toBe(false);
      expect((await admin(env).get(`/api/admin/boards/${id}`)).status).toBe(404);
    });
  });

  describe('Blockieren', () => {
    it('Liste: blockieren, nicht sich selbst, aufheben', async () => {
      expect((await mia.get('/api/blocks')).body).toEqual({ ok: true, blocked: [] });
      expect((await put(mia, `/api/blocks/${encodeURIComponent(keys.mia.key)}`)).status).toBe(400);
      const r = await put(mia, `/api/blocks/${encodeURIComponent(keys.troll.key)}`);
      expect(r.status).toBe(200);
      expect(r.body.blocked).toEqual([expect.objectContaining({ key: keys.troll.key, name: 'Tom Troll' })]);
      expect((await del(mia, `/api/blocks/${encodeURIComponent(keys.troll.key)}`)).body.blocked).toEqual([]);
    });

    it('Erwähnungen Blockierter erreichen den Posteingang nicht', async () => {
      const inbox = async () => (await mia.get('/api/native/v1/inbox')).body.items as { byKey: string; text: string }[];
      await put(mia, `/api/blocks/${encodeURIComponent(keys.troll.key)}`);
      await comment(env, boardId, keys.troll, '@Mia Meldet schau mal', [keys.mia.key]);
      await comment(env, boardId, keys.olga, '@Mia Meldet bitte prüfen', [keys.mia.key]);
      await waitFor(async () => (await inbox()).some((i) => i.byKey === keys.olga.key));
      expect((await inbox()).some((i) => i.byKey === keys.troll.key)).toBe(false);
      // aufheben: wieder sichtbar
      await del(mia, `/api/blocks/${encodeURIComponent(keys.troll.key)}`);
      expect((await inbox()).some((i) => i.byKey === keys.troll.key)).toBe(true);
    });

    it('Einladungen Blockierter kommen nicht an', async () => {
      await put(mia, `/api/blocks/${encodeURIComponent(keys.troll.key)}`);
      const own = (await troll.post('/api/boards', { title: 'Troll-Board' })).body.board.id;
      const before = mailsOf(env).length;
      const s = await troll.post(`/api/boards/${own}/share`, { emails: ['mia@example.org', 'olga@example.org'], role: 'edit' });
      expect(s.status).toBe(200);
      expect(s.body.people.map((p: { key: string }) => p.key)).not.toContain(keys.mia.key);
      expect(s.body.people.map((p: { key: string }) => p.key)).toContain(keys.olga.key);
      await waitMail(env, 'olga@example.org', /geteilt/, before);
      expect(mailsOf(env).slice(before).some((m) => m.to === 'mia@example.org')).toBe(false);
      expect((await mia.get('/api/boards')).body.boards.some((b: { id: string }) => b.id === own)).toBe(false);
      await del(mia, `/api/blocks/${encodeURIComponent(keys.troll.key)}`);
    });
  });
});

describe('Modus org', () => {
  let env: TestEnv;
  let orga: Browser;
  let boardId: string;

  beforeAll(async () => {
    env = await startEnv({ instance: { ...loadInstance({ STACHEL_AUTH: 'org' }), mailMode: 'log', reportEmail: MOD, adminToken: ADMIN_TOKEN } });
    orga = await loginAdmin(env);
    boardId = (await orga.post('/api/boards', { title: 'Team' })).body.board.id;
  });
  afterAll(async () => {
    await env?.stop();
  });

  it('Melden geht an STACHEL_REPORT_EMAIL, ohne Mail an die meldende Person', async () => {
    const before = mailsOf(env).length;
    const r = await orga.post('/api/reports', { boardId, reason: 'copyright', text: 'Fotos aus fremder Quelle' });
    expect(r.status).toBe(201);
    expect(r.body.mailed).toBe(false);
    await waitMail(env, MOD, /Neue Meldung/, before);
    const d = await admin(env).post(`/api/admin/reports/${r.body.report.id}/decision`, { decision: 'no_action', statement: 'Fotos sind selbst aufgenommen.' });
    expect(d.body.notified.reporter).toBe(false);
    expect(d.body.notified.missing[0]).toContain('meldende Person');
  });

  it('Board-Sperre gilt auch hier (REST, Liste)', async () => {
    const a = admin(env);
    await a.put(`/api/admin/boards/${boardId}/lock`, { mode: 'readonly', reason: 'Prüfung' });
    const rename = await orga.req('PATCH', `/api/boards/${boardId}`, { json: { title: 'Neu' } });
    expect(rename.status).toBe(403);
    expect(rename.body.error).toBe('board_locked');
    expect((await orga.get(`/api/boards/${boardId}/moderation`)).body.lock).toEqual({ mode: 'readonly', reason: 'Prüfung' });
    await a.put(`/api/admin/boards/${boardId}/lock`, { mode: 'hidden', reason: 'Prüfung' });
    expect((await orga.get('/api/boards')).body.boards.some((b: { id: string }) => b.id === boardId)).toBe(false);
    expect((await orga.get(`/api/boards/${boardId}/moderation`)).status).toBe(404);
    await a.del(`/api/admin/boards/${boardId}/lock`);
    expect((await orga.get('/api/boards')).body.boards.some((b: { id: string }) => b.id === boardId)).toBe(true);
    expect((await orga.req('PATCH', `/api/boards/${boardId}`, { json: { title: 'Neu' } })).status).toBe(200);
  });

  it('Board-Sperre im Live-Sync: nur ansehen bzw. kein Zugriff', async () => {
    const a = admin(env);
    await a.put(`/api/admin/boards/${boardId}/lock`, { mode: 'readonly', reason: 'Prüfung' });
    const c = connect(env, boardId, orga);
    try {
      await waitFor(() => c.state.synced);
      c.doc.getMap('objects').set('neu', new Y.Map());
      await sleep(300);
      expect(await docHas(env, boardId, (doc) => doc.getMap('objects').has('neu'))).toBe(false);
    } finally {
      c.destroy();
    }
    await a.put(`/api/admin/boards/${boardId}/lock`, { mode: 'hidden', reason: 'Prüfung' });
    const h = connect(env, boardId, orga);
    try {
      await waitFor(() => h.state.failed !== null);
      expect(h.state.failed).toBe('no_access');
    } finally {
      h.destroy();
      await a.del(`/api/admin/boards/${boardId}/lock`);
    }
  });

  it('Konto sperren: neue Anmeldung wird abgewiesen', async () => {
    const key = (await orga.get('/api/auth/me')).body.user.key as string;
    await admin(env).put(`/api/admin/accounts/${encodeURIComponent(key)}/lock`, { reason: 'Test' });
    expect((await orga.get('/api/boards')).status).toBe(401);
    const again = await new Browser(env.base).post('/api/auth/password', { username: 'orga', password: 'geheim' });
    expect(again.status).toBe(403);
    expect(again.body.error).toBe('account_locked');
    await admin(env).del(`/api/admin/accounts/${encodeURIComponent(key)}/lock`);
    orga = await loginAdmin(env);
    expect(orga.cookies.size).toBeGreaterThan(0);
  });

  it('tools/admin.mts spricht mit der Admin-API', async () => {
    const cli = fileURLToPath(new URL('../../tools/admin.mts', import.meta.url));
    const run = (args: string[], token = ADMIN_TOKEN) =>
      new Promise<{ code: number; out: string }>((resolve) => {
        execFile(process.execPath, ['--import', 'tsx', cli, '--url', env.base, ...args], { env: { ...process.env, STACHEL_ADMIN_TOKEN: token } }, (err, stdout, stderr) =>
          resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: stdout + stderr }),
        );
      });
    const id = (await orga.post('/api/reports', { boardId, reason: 'spam' })).body.report.id as string;
    const list = await run(['reports']);
    expect(list.code).toBe(0);
    expect(list.out).toContain(id);
    const lock = await run(['lock-board', boardId, '--reason', 'CLI-Test']);
    expect(lock.out).toContain('nur ansehen');
    expect((await run(['locks'])).out).toContain('CLI-Test');
    expect((await run(['unlock-board', boardId])).out).toContain('entsperrt');
    const d = await run(['decide', id, 'no_action', '--statement', 'Kein Spam, normale Planung.']);
    expect(d.code).toBe(0);
    expect(d.out).toContain('Kein Verstoß');
    const bad = await run(['reports'], 'falsch');
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('Admin-Token');
  }, 30_000);

  it('ohne Admin-Token keine Admin-API', async () => {
    const off = await startEnv({ instance: { ...loadInstance({ STACHEL_AUTH: 'org' }), mailMode: 'log' } });
    try {
      expect((await admin(off).get('/api/admin/reports')).status).toBe(404);
    } finally {
      await off.stop();
    }
  });
});
