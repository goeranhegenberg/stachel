// Privater Modus (docs/features/private.md): Geheimhaltung auf Protokollebene. Private Inhalte liegen in der
// Privat-Ablage der Person; andere Clients – Web über /sync (rohe Yjs-Rahmen) und Apps über /native/v1 (alle JSON-
// Nachrichten) – bekommen bis zum Aufdecken nur Platzhalter ohne Text. Dazu: Rechte, Server-Wurzeln, Aufdecken mit
// Countdown, anonym, eigene aufdecken, Auto-Aufdecken ohne Modus, App-Ops in die Ablage.
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { boardDocName, privateDocName } from '../../shared/protocol.js';
import { loginMember, sleep, startEnv, waitFor, type Browser, type TestEnv } from './helpers.js';
import { appSession, NativeClient } from './native-client.js';

let env: TestEnv;
let ws: string;
beforeAll(async () => {
  env = await startEnv({ nativeIdleMs: 300 });
  ws = env.base.replace('http', 'ws');
});
afterAll(async () => {
  await env?.stop();
});
const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

const SECRET = 'Geheimnis-Kaktus-4711';
const SECRET2 = 'Zweites-Geheimnis-0815';

/**
 * Yjs-Client über /sync wie im Browser, der **jeden empfangenen WebSocket-Rahmen** aufhebt (Prüfung auf Protokollebene).
 * `names`: Dokumente auf derselben Verbindung (Board und ggf. eigene Ablage).
 */
function syncClient(headers: Record<string, string>, names: string[], user?: { key: string; name: string }) {
  const frames: Buffer[] = [];
  class RecordingSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers });
      this.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
        frames.push(Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer));
      });
    }
  }
  const socket = new HocuspocusProviderWebsocket({ url: `${ws}/sync`, WebSocketPolyfill: RecordingSocket as any, maxAttempts: 1 });
  const docs = names.map((name) => {
    const doc = new Y.Doc();
    const state = { synced: false, failed: null as string | null };
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name,
      document: doc,
      onSynced: () => {
        state.synced = true;
      },
      onAuthenticationFailed: ({ reason }) => {
        state.failed = reason;
      },
    });
    provider.attach();
    // anwesend wie ein Browser (Moderation „ist da“)
    if (user) provider.setAwarenessField('user', { key: user.key, name: user.name, color: '#1763b5' });
    return { name, doc, provider, state };
  });
  const client = {
    frames,
    docs,
    doc: (i = 0) => docs[i]!.doc,
    objects: (i = 0) => docs[i]!.doc.getMap<Y.Map<unknown>>('objects'),
    /** Kommt `text` irgendwo in einem empfangenen Rahmen vor? */
    saw: (text: string) => frames.some((f) => f.includes(Buffer.from(text, 'utf8'))),
    async synced(i = 0, timeoutMs = 8000) {
      const end = Date.now() + timeoutMs;
      const s = docs[i]!.state;
      while (!s.synced) {
        if (s.failed) throw new Error(`Sync abgelehnt: ${s.failed}`);
        if (Date.now() > end) throw new Error('Sync-Timeout');
        await sleep(20);
      }
    },
    async failed(i = 0, timeoutMs = 8000): Promise<string> {
      const end = Date.now() + timeoutMs;
      const s = docs[i]!.state;
      while (!s.failed) {
        if (s.synced) throw new Error('unerwartet verbunden');
        if (Date.now() > end) throw new Error('kein Fehler');
        await sleep(20);
      }
      return s.failed;
    },
    async flushed(timeoutMs = 5000) {
      const end = Date.now() + timeoutMs;
      while (docs.some((d) => d.provider.hasUnsyncedChanges)) {
        if (Date.now() > end) throw new Error('nicht gesendet');
        await sleep(20);
      }
    },
    destroy() {
      for (const d of docs) d.provider.destroy();
      socket.destroy();
    },
  };
  cleanup.push(() => client.destroy());
  return client;
}

/** Haftnotiz mit Rich-Text (Fragment) und Klartext-Spiegel in eine `objects`-Map schreiben. */
function addNote(objects: Y.Map<Y.Map<unknown>>, id: string, text: string, extra: Record<string, unknown> = {}) {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries({ type: 'sticky', x: 100, y: 50, w: 200, h: 200, z: 'a5', color: '#fff27a', text, createdBy: 'x', ...extra })) m.set(k, v);
  const frag = new Y.XmlFragment();
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(text)]);
  frag.insert(0, [p]);
  m.set('content', frag);
  objects.doc!.transact(() => objects.set(id, m));
}

let memberId = 4400;
async function person(name: string) {
  const kt = env.fake.addMember(++memberId, name);
  const browser = await loginMember(env, kt);
  const { token, user } = await appSession(env.base, kt);
  return { kt, browser, token, user, cookie: { cookie: browser.cookieHeader() } };
}

async function control(b: Browser, boardId: string, body: Record<string, unknown>) {
  return b.post(`/api/boards/${boardId}/private`, body);
}

async function setup() {
  const mara = await person('Mara');
  const jonas = await person('Jonas');
  const board = (await mara.browser.post('/api/boards', { title: 'Retro' })).body.board as { id: string };
  return { mara, jonas, board };
}

const hidden = (doc: Y.Doc) => doc.getMap<Record<string, unknown>>('private.hidden');
const mode = (doc: Y.Doc) => doc.getMap<unknown>('private.mode');

describe('Privat-Ablage über /sync', () => {
  it('nur die Person selbst darf ihre Ablage öffnen', async () => {
    const { mara, jonas, board } = await setup();
    const own = syncClient(mara.cookie, [privateDocName(board.id, mara.user.key)]);
    await own.synced();
    const foreign = syncClient(jonas.cookie, [privateDocName(board.id, mara.user.key)]);
    expect(await foreign.failed()).toBe('no_access');
    // Schreibweise, die nicht kanonisch ist (andere Codierung desselben Keys), gibt es nicht
    const odd = syncClient(mara.cookie, [`private:${board.id}:${Buffer.from(mara.user.key).toString('base64')}==`]);
    expect(await odd.failed()).toMatch(/^(no_access|unknown_board)$/);
  });

  it('private.mode und private.hidden kann kein Client schreiben', async () => {
    const { mara, board } = await setup();
    const c = syncClient(mara.cookie, [boardDocName(board.id)]);
    await c.synced();
    c.doc().transact(() => {
      mode(c.doc()).set('on', true);
      hidden(c.doc()).set('fake', { x: 0, y: 0, w: 10, h: 10, type: 'sticky', o: 'x' });
    });
    await sleep(300); // der Server übernimmt das Update nicht (bleibt beim Client „ungesendet“)
    const state = await mara.browser.get(`/api/boards/${board.id}/private`);
    expect(state.body.state).toEqual({ on: false });
    const other = syncClient(mara.cookie, [boardDocName(board.id)]);
    await other.synced();
    expect(hidden(other.doc()).size).toBe(0);
    expect(mode(other.doc()).get('on')).toBeUndefined();
  });

  it('vorhandene Einträge (Modus an, Platzhalter) lassen sich nicht überschreiben oder löschen', async () => {
    const { mara, jonas, board } = await setup();
    await control(mara.browser, board.id, { action: 'start' });
    const j = syncClient(jonas.cookie, [privateDocName(board.id, jonas.user.key)]);
    await j.synced();
    addNote(j.objects(), 'j1', 'verdeckt');
    await j.flushed();
    const c = syncClient(mara.cookie, [boardDocName(board.id)]);
    await c.synced();
    await waitFor(() => hidden(c.doc()).has('j1'));
    c.doc().transact(() => mode(c.doc()).set('on', false)); // überschreibt den Schlüssel (ohne Wurzelnamen im Update)
    await sleep(200);
    c.doc().transact(() => hidden(c.doc()).delete('j1')); // reine Löschung
    await sleep(300);
    const fresh = syncClient(jonas.cookie, [boardDocName(board.id)]);
    await fresh.synced();
    expect(mode(fresh.doc()).get('on')).toBe(true);
    expect(hidden(fresh.doc()).has('j1')).toBe(true);
    expect((await mara.browser.get(`/api/boards/${board.id}/private`)).body.state.on).toBe(true);
  });

  it('Web ↔ Web: andere sehen nur Platzhalter (kein Text in irgendeinem Rahmen), nach Aufdecken alles samt Rich-Text', async () => {
    const { mara, jonas, board } = await setup();
    expect((await control(mara.browser, board.id, { action: 'start' })).body.state).toMatchObject({ on: true, by: mara.user.key, byName: 'Mara' });
    const watcher = syncClient(jonas.cookie, [boardDocName(board.id)]);
    await watcher.synced();
    const writer = syncClient(mara.cookie, [boardDocName(board.id), privateDocName(board.id, mara.user.key)], mara.user);
    await writer.synced(0);
    await writer.synced(1);
    addNote(writer.objects(1), 'p1', SECRET, { x: 300, y: 120, rotation: 5 });
    await writer.flushed();
    await waitFor(() => hidden(watcher.doc()).has('p1'));
    const ph = hidden(watcher.doc()).get('p1')!;
    expect(ph).toMatchObject({ x: 300, y: 120, w: 200, h: 200, type: 'sticky', rotation: 5, by: mara.user.key });
    expect(Object.keys(ph).sort()).toEqual(['by', 'h', 'o', 'rotation', 'type', 'w', 'x', 'y']);
    expect(watcher.objects().has('p1')).toBe(false);
    // Bearbeiten in der Ablage: Platzhalter folgt der Lage, Text bleibt verborgen
    writer.doc(1).transact(() => writer.objects(1).get('p1')!.set('x', 340));
    writer.doc(1).transact(() => writer.objects(1).get('p1')!.set('text', SECRET2));
    await writer.flushed();
    await waitFor(() => hidden(watcher.doc()).get('p1')?.x === 340);
    await sleep(100);
    expect(watcher.saw(SECRET)).toBe(false);
    expect(watcher.saw(SECRET2)).toBe(false);
    // Jonas ist nicht Moderation, Mara ist da → darf nicht aufdecken
    expect((await control(jonas.browser, board.id, { action: 'reveal' })).status).toBe(403);
    expect((await control(mara.browser, board.id, { action: 'reveal', countdown: 0 })).body.state).toEqual({ on: false });
    await waitFor(() => watcher.objects().has('p1'));
    const obj = watcher.objects().get('p1')!;
    expect(obj.get('text')).toBe(SECRET2);
    expect(obj.get('x')).toBe(340);
    expect(obj.get('content')).toBeInstanceOf(Y.XmlFragment);
    expect((obj.get('content') as Y.XmlFragment).toString()).toContain(SECRET);
    expect(hidden(watcher.doc()).size).toBe(0);
    await waitFor(() => writer.objects(1).size === 0);
    expect(writer.objects(0).get('p1')?.get('text')).toBe(SECRET2);
  });

  it('ohne laufenden Modus bleibt nichts privat (nachgereichtes wird sofort aufgedeckt)', async () => {
    const { mara, jonas, board } = await setup();
    const watcher = syncClient(jonas.cookie, [boardDocName(board.id)]);
    await watcher.synced();
    const writer = syncClient(mara.cookie, [privateDocName(board.id, mara.user.key)]);
    await writer.synced();
    addNote(writer.objects(), 'late', 'offline geschrieben');
    await writer.flushed();
    await waitFor(() => watcher.objects().get('late')?.get('text') === 'offline geschrieben');
    await waitFor(() => writer.objects().size === 0);
  });

  it('Countdown, anonym und „eigene aufdecken“', async () => {
    const { mara, jonas, board } = await setup();
    expect((await control(mara.browser, board.id, { action: 'start', anonymous: true, ownReveal: true })).status).toBe(200);
    expect((await control(jonas.browser, board.id, { action: 'start' })).status).toBe(409);
    const watcher = syncClient(mara.cookie, [boardDocName(board.id)]);
    await watcher.synced();
    const j = syncClient(jonas.cookie, [privateDocName(board.id, jonas.user.key)]);
    await j.synced();
    addNote(j.objects(), 'j1', 'Jonas eins');
    await j.flushed();
    await waitFor(() => hidden(watcher.doc()).has('j1'));
    expect(hidden(watcher.doc()).get('j1')!.by).toBeUndefined(); // anonym: kein Name
    // eigene aufdecken (Modus läuft weiter)
    expect((await control(jonas.browser, board.id, { action: 'revealOwn' })).status).toBe(200);
    await waitFor(() => watcher.objects().has('j1'));
    expect(watcher.objects().get('j1')!.get('createdBy')).toBe('');
    expect(mode(watcher.doc()).get('on')).toBe(true);
    addNote(j.objects(), 'j2', 'Jonas zwei');
    await j.flushed();
    await waitFor(() => hidden(watcher.doc()).has('j2'));
    // Countdown 1 s, sichtbar als revealAt; Abbrechen und neu starten
    const r = await control(mara.browser, board.id, { action: 'reveal', countdown: 1 });
    expect(r.body.state.revealAt).toBeGreaterThan(Date.now());
    await waitFor(() => typeof mode(watcher.doc()).get('revealAt') === 'number');
    expect((await control(mara.browser, board.id, { action: 'cancel' })).status).toBe(200);
    await sleep(1200);
    expect(watcher.objects().has('j2')).toBe(false);
    await control(mara.browser, board.id, { action: 'reveal', countdown: 1 });
    await waitFor(() => watcher.objects().has('j2'), 4000);
    expect(mode(watcher.doc()).get('on')).toBe(false);
    expect(watcher.saw('Jonas zwei')).toBe(true); // erst jetzt
  });
});

describe('Privat-Ablage über die Native-API', () => {
  let reqNo = 100;
  async function ops(a: NativeClient, list: Record<string, unknown>[]) {
    const req = ++reqNo;
    const from = a.messages.length;
    a.send({ t: 'ops', req, ops: list });
    const ack = await a.next((m) => (m.t === 'ack' || m.t === 'nack') && m.req === req, 5000, from);
    return { ack, since: a.messages.slice(from) };
  }

  it('App legt im Modus an → nur eigene `private`-Nachricht (vor dem ack); andere App und Web sehen nur Platzhalter; Aufdecken bringt Patch', async () => {
    const { mara, jonas, board } = await setup();
    await control(mara.browser, board.id, { action: 'start' });
    const a = new NativeClient(ws, mara.token);
    cleanup.push(() => a.close());
    const welcome = await a.hello(board.id);
    expect(welcome.features).toContain('private');
    expect(welcome.snapshot.ext['private.mode']).toMatchObject({ on: true });
    await a.next((m) => m.t === 'private');
    const b = new NativeClient(ws, jonas.token);
    cleanup.push(() => b.close());
    await b.hello(board.id);
    const web = syncClient(jonas.cookie, [boardDocName(board.id)]);
    await web.synced();

    const { ack, since } = await ops(a, [{ op: 'create', objects: [{ id: 'app1', type: 'sticky', x: 10, y: 20, w: 200, h: 200, color: '#fff27a', text: SECRET }] }]);
    expect(ack.t).toBe('ack');
    const priv = since.filter((m) => m.t === 'private');
    expect(priv.length).toBeGreaterThan(0);
    expect(since.indexOf(priv[priv.length - 1]!)).toBeLessThan(since.indexOf(ack));
    expect(priv[priv.length - 1]!.objects.map((o: { id: string; text: string }) => [o.id, o.text])).toEqual([['app1', SECRET]]);
    expect(since.some((m) => m.t === 'patch' && m.changes.some((c: { id: string }) => c.id === 'app1'))).toBe(false);
    a.send({ t: 'step' });
    // Text bearbeiten (text-Op) und verschieben in der Ablage
    await ops(a, [{ op: 'text', id: 'app1', base: welcome.rev, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: SECRET2 }] }] } }]);
    a.send({ t: 'step' });
    const mark = a.messages.length;
    await ops(a, [{ op: 'update', patches: { app1: { x: 60 } } }]);
    const last = await a.next((m) => m.t === 'private' && m.objects[0]?.x === 60, 5000, mark);
    expect(last.objects[0].text).toBe(SECRET2);
    a.send({ t: 'step' });
    // Rückgängig nimmt nur die Verschiebung in der Ablage zurück
    const mark2 = a.messages.length;
    a.send({ t: 'undo', req: ++reqNo });
    const undone = await a.next((m) => m.t === 'private' && m.objects[0]?.x === 10, 5000, mark2);
    expect(undone.objects[0].text).toBe(SECRET2);

    await waitFor(() => hidden(web.doc()).has('app1'));
    await b.next((m) => m.t === 'patch' && !!m.ext?.['private.hidden']?.app1);
    await sleep(100);
    const allB = JSON.stringify(b.messages);
    expect(allB).not.toContain(SECRET);
    expect(allB).not.toContain(SECRET2);
    expect(web.saw(SECRET)).toBe(false);
    expect(web.saw(SECRET2)).toBe(false);

    expect((await control(mara.browser, board.id, { action: 'reveal', countdown: 0 })).status).toBe(200);
    const created = await b.next((m) => m.t === 'patch' && m.changes.some((c: { id: string; created?: unknown }) => c.id === 'app1' && c.created));
    expect(created.changes.find((c: { id: string }) => c.id === 'app1').created.text).toBe(SECRET2);
    await a.next((m) => m.t === 'private' && m.objects.length === 0);
    await waitFor(() => web.objects().get('app1')?.get('text') === SECRET2);
  });

  it('ohne Modus legt die App normal (öffentlich) an', async () => {
    const { mara, board } = await setup();
    const a = new NativeClient(ws, mara.token);
    cleanup.push(() => a.close());
    await a.hello(board.id);
    const { since } = await ops(a, [{ op: 'create', objects: [{ id: 'pub1', type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'offen' }] }]);
    expect(since.some((m) => m.t === 'patch' && m.changes.some((c: { id: string }) => c.id === 'pub1'))).toBe(true);
  });

  it('Übergabe: presence.extra structure.handover und structure.present.from kommen beim Web an', async () => {
    const { mara, jonas, board } = await setup();
    const a = new NativeClient(ws, mara.token);
    cleanup.push(() => a.close());
    const welcome = await a.hello(board.id);
    const web = syncClient(jonas.cookie, [boardDocName(board.id)]);
    await web.synced();
    a.send({ t: 'presence', extra: { 'structure.present': { frameId: 'f1', index: 0, total: 2, title: 'Start', from: 77 }, 'structure.handover': { to: jonas.user.key, id: 'h1', index: 0, frameId: 'f1' } } });
    const states = () => [...web.docs[0]!.provider.awareness!.getStates().values()] as Record<string, any>[];
    await waitFor(() => states().some((s) => s['structure.handover']?.to === jonas.user.key));
    const s = states().find((x) => x['structure.handover'])!;
    expect(s['structure.present']).toEqual({ frameId: 'f1', index: 0, total: 2, title: 'Start', from: 77 });
    expect(s.user.key).toBe(mara.user.key);
    expect(welcome.clientId).toBeTypeOf('number');
  });
});
