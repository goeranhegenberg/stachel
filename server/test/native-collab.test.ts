// Zusammenarbeit aus der Org-App (docs/contract.md §8.6 E3, §8.11): Kommentar-Ops (anlegen, antworten, bearbeiten,
// löschen, erledigen) mit den Y-Strukturen des Web-Moduls collab, Reaktionen, Gelesen-Stand, Upload-Platzhalter in der
// Awareness und der Posteingang `GET /api/native/v1/inbox` (Erwähnungen und Karten-Zuweisungen).
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loginMember, startEnv, waitFor, type TestEnv } from './helpers.js';
import { appSession, NativeClient, webClient } from './native-client.js';

let env: TestEnv;
let ws: string;
beforeAll(async () => {
  env = await startEnv({ nativeIdleMs: 300, nativeBufferMax: 50 });
  ws = env.base.replace('http', 'ws');
});
afterAll(async () => {
  await env?.stop();
});
const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

let memberId = 1200;
async function person(name: string) {
  const kt = env.fake.addMember(++memberId, name);
  const browser = await loginMember(env, kt);
  const { token, user } = await appSession(env.base, kt);
  return { kt, browser, token, user };
}

async function setup() {
  const mara = await person('Mara');
  const jonas = await person('Jonas');
  const board = (await mara.browser.post('/api/boards', { title: 'Zusammen' })).body.board as { id: string; title: string };
  const w = webClient(ws, board.id, { cookie: jonas.browser.cookieHeader() });
  cleanup.push(() => w.destroy());
  await w.synced();
  const note = new Y.Map<unknown>();
  for (const [k, v] of Object.entries({ type: 'sticky', x: 100, y: 50, w: 200, h: 200, z: 'a0', text: 'Bühne' })) note.set(k, v);
  w.objects.set('n1', note);
  await w.flushed();
  const a = new NativeClient(ws, mara.token);
  cleanup.push(() => a.close());
  const welcome = await a.hello(board.id);
  return { mara, jonas, board, w, a, welcome };
}

let reqNo = 5000;
async function ops(a: NativeClient, list: Record<string, unknown>[], req = ++reqNo) {
  const from = a.messages.length;
  a.send({ t: 'ops', req, ops: list });
  return a.next((m) => (m.t === 'ack' || m.t === 'nack') && m.req === req, 5000, from);
}

const comments = (w: ReturnType<typeof webClient>) => w.doc.getMap<Y.Map<unknown>>('collab.comments');
const messagesOf = (w: ReturnType<typeof webClient>, t: string) => (comments(w).get(t)?.get('messages') as Y.Array<Record<string, unknown>> | undefined)?.toArray() ?? [];

describe('Kommentar-Ops', () => {
  it('anlegen am Objekt mit @Erwähnung: Web sieht den Thread wie vom Web-Modul, die App bekommt ext; Wiederholung legt nichts doppelt an', async () => {
    const { a, w, mara, jonas } = await setup();
    const at = { x: 150, y: 60, objectId: 'n1', dx: 50, dy: 10 };
    const ack = await ops(a, [{ op: 'comment', thread: 't1', msg: 'm1', at, text: '@Jonas Strom klären', mentions: [jonas.user.key] }]);
    expect(ack.t).toBe('ack');
    await waitFor(() => comments(w).has('t1'));
    const t = comments(w).get('t1')!;
    expect(t.get('objectId')).toBe('n1');
    expect([t.get('x'), t.get('y'), t.get('dx'), t.get('dy')]).toEqual([150, 60, 50, 10]);
    expect(t.get('resolved')).toBe(false);
    expect(t.get('createdBy')).toBe(mara.user.key);
    const [m] = messagesOf(w, 't1');
    expect(m).toMatchObject({ id: 'm1', by: mara.user.key, name: 'Mara', text: '@Jonas Strom klären', mentions: [jonas.user.key] });
    // die App sieht die Struktur im Patch (ganz)
    const patch = a.messages.find((x) => x.t === 'patch' && x.ext?.['collab.comments']);
    expect(patch!.ext['collab.comments'].t1.messages[0].text).toBe('@Jonas Strom klären');
    // gleiche IDs nochmal (neue req, z. B. nach Server-Neustart): nichts doppelt
    await ops(a, [{ op: 'comment', thread: 't1', msg: 'm1', at, text: 'anders', mentions: [] }]);
    await ops(a, [{ op: 'reply', thread: 't1', msg: 'm2', text: 'Antwort', mentions: [] }]);
    await ops(a, [{ op: 'reply', thread: 't1', msg: 'm2', text: 'Antwort', mentions: [] }]);
    await waitFor(() => messagesOf(w, 't1').length === 2);
    expect(messagesOf(w, 't1').map((x) => x.text)).toEqual(['@Jonas Strom klären', 'Antwort']);
  });

  it('erledigen, Antwort öffnet wieder, bearbeiten/löschen nur Eigenes, Thread löschen nur wer ihn begann; Rückgängig je Aktion', async () => {
    const { a, w, mara, jonas, board } = await setup();
    await ops(a, [{ op: 'comment', thread: 't2', msg: 'm1', at: { x: 0, y: 0 }, text: 'Frei auf dem Board', mentions: [] }]);
    await waitFor(() => comments(w).has('t2'));
    expect(comments(w).get('t2')!.has('objectId')).toBe(false);
    await ops(a, [{ op: 'resolve', thread: 't2', resolved: true }]);
    await waitFor(() => comments(w).get('t2')!.get('resolved') === true);
    expect(comments(w).get('t2')!.get('resolvedBy')).toBe(mara.user.key);
    // Jonas (Web) antwortet → wieder offen (Web-Regel) – hier über eine zweite App-Sitzung von Jonas
    const b = new NativeClient(ws, jonas.token);
    cleanup.push(() => b.close());
    await b.hello(board.id);
    await ops(b, [{ op: 'reply', thread: 't2', msg: 'j1', text: 'Noch offen', mentions: [] }]);
    await waitFor(() => comments(w).get('t2')!.get('resolved') === false);
    // fremde Nachricht bearbeiten/löschen und fremden Thread löschen: nichts passiert
    await ops(b, [{ op: 'commentEdit', thread: 't2', msg: 'm1', text: 'gehackt', mentions: [] }]);
    await ops(b, [{ op: 'commentDelete', thread: 't2' }]);
    await ops(a, [{ op: 'commentDelete', thread: 't2', msg: 'j1' }]);
    await new Promise((r) => setTimeout(r, 100));
    expect(messagesOf(w, 't2').map((x) => x.text)).toEqual(['Frei auf dem Board', 'Noch offen']);
    // eigene Nachricht bearbeiten: `edited` gesetzt, Erwähnungen ersetzt
    await ops(b, [{ op: 'commentEdit', thread: 't2', msg: 'j1', text: 'Noch offen, @Mara?', mentions: [mara.user.key] }]);
    await waitFor(() => messagesOf(w, 't2')[1]?.text === 'Noch offen, @Mara?');
    expect(messagesOf(w, 't2')[1]).toMatchObject({ mentions: [mara.user.key] });
    expect(typeof messagesOf(w, 't2')[1]!.edited).toBe('string');
    await ops(b, [{ op: 'commentDelete', thread: 't2', msg: 'j1' }]);
    await waitFor(() => messagesOf(w, 't2').length === 1);
    await ops(a, [{ op: 'commentDelete', thread: 't2' }]);
    await waitFor(() => !comments(w).has('t2'));
    // Rückgängig der App: ein eigener Schritt je Aktion (Thread wieder da, dann die Antwort weg)
    await ops(a, [{ op: 'comment', thread: 't4', msg: 'm1', at: { x: 0, y: 0 }, text: 'Neu', mentions: [] }]);
    await ops(a, [{ op: 'reply', thread: 't4', msg: 'm2', text: 'Nachtrag', mentions: [] }]);
    await waitFor(() => messagesOf(w, 't4').length === 2);
    a.send({ t: 'undo', req: ++reqNo });
    await a.next((m) => m.t === 'ack' && m.req === reqNo);
    await waitFor(() => messagesOf(w, 't4').length === 1);
    expect(comments(w).has('t4')).toBe(true);
  });

  it('Prüfung: leerer Text, kaputte IDs, fehlender Anker → nack invalid_input, nichts geschrieben', async () => {
    const { a, w } = await setup();
    for (const bad of [
      { op: 'comment', thread: 't3', msg: 'm1', at: { x: 0, y: 0 }, text: '   ' },
      { op: 'comment', thread: 't 3', msg: 'm1', at: { x: 0, y: 0 }, text: 'x' },
      { op: 'comment', thread: 't3', msg: 'm1', text: 'x' },
      { op: 'comment', thread: 't3', msg: 'm1', at: { x: 0, y: 0 }, text: 'x', mentions: 'm:1' },
      { op: 'resolve', thread: 't3', resolved: 'ja' },
      { op: 'react', ids: ['n1'], emoji: '', on: true },
      { op: 'react', ids: ['n1'], emoji: '👍|x', on: true },
      { op: 'mentionsRead', at: 'gestern' },
    ]) {
      const r = await ops(a, [bad]);
      expect(r).toMatchObject({ t: 'nack', error: 'invalid_input', index: 0 });
    }
    expect(comments(w).size).toBe(0);
  });
});

describe('Reaktionen und Gelesen-Stand', () => {
  it('react an/aus wie das Web (Schlüssel objekt|emoji|person), mehrere Objekte, doppelt ist harmlos', async () => {
    const { a, w, mara } = await setup();
    const reactions = w.doc.getMap<Record<string, unknown>>('collab.reactions');
    await ops(a, [{ op: 'react', ids: ['n1', 'n1'], emoji: '👍', on: true }]);
    await waitFor(() => reactions.has(`n1|👍|${mara.user.key}`));
    expect(reactions.get(`n1|👍|${mara.user.key}`)).toMatchObject({ o: 'n1', e: '👍', u: mara.user.key, n: 'Mara' });
    await ops(a, [{ op: 'react', ids: ['n1'], emoji: '👍', on: true }]);
    expect(reactions.size).toBe(1);
    await ops(a, [{ op: 'react', ids: ['n1'], emoji: '👍', on: false }]);
    await waitFor(() => reactions.size === 0);
  });

  it('mentionsRead setzt collab.reads der eigenen Person, nie in die Zukunft', async () => {
    const { a, w, mara } = await setup();
    const reads = w.doc.getMap<string>('collab.reads');
    await ops(a, [{ op: 'mentionsRead', at: '2099-01-01T00:00:00.000Z' }]);
    await waitFor(() => reads.has(mara.user.key));
    expect(reads.get(mara.user.key)! < '2099').toBe(true);
    expect(Math.abs(Date.parse(reads.get(mara.user.key)!) - Date.now())).toBeLessThan(10_000);
  });
});

describe('Upload-Platzhalter', () => {
  it('presence.uploads erscheint im Web als collab.uploads (geprüft, höchstens 10), leer entfernt es', async () => {
    const { a, w, mara } = await setup();
    a.send({ t: 'presence', uploads: [{ x: 10, y: 20, w: 300, h: 200, color: '#aabbcc' }, { x: 'kaputt' }] });
    const state = () => [...w.provider.awareness!.getStates().values()].find((s) => (s.user as { key?: string } | undefined)?.key === mara.user.key);
    await waitFor(() => Array.isArray(state()?.['collab.uploads']));
    expect(state()!['collab.uploads']).toEqual([{ x: 10, y: 20, w: 300, h: 200, color: '#aabbcc' }]);
    a.send({ t: 'presence', uploads: [] });
    await waitFor(() => state() !== undefined && !('collab.uploads' in state()!));
  });
});

describe('Posteingang GET /api/native/v1/inbox', () => {
  const inbox = async (token: string, since?: string) => {
    const res = await fetch(`${env.base}/api/native/v1/inbox${since ? `?since=${encodeURIComponent(since)}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: res.status, body: (await res.json()) as { ok: boolean; now: string; items: Record<string, unknown>[]; error?: string } };
  };

  it('Erwähnung aus der App und aus dem Web; nicht sich selbst; `since` liefert nur Neues', async () => {
    const { a, w, mara, jonas, board } = await setup();
    const start = (await inbox(jonas.token)).body.now;
    await ops(a, [{ op: 'comment', thread: 'ti', msg: 'm1', at: { x: 150, y: 60, objectId: 'n1', dx: 50, dy: 10 }, text: '@Jonas Strom klären', mentions: [jonas.user.key, mara.user.key] }]);
    await waitFor(async () => (await inbox(jonas.token, start)).body.items.length === 1);
    const { body } = await inbox(jonas.token, start);
    expect(body.items[0]).toMatchObject({ type: 'mention', boardId: board.id, boardTitle: 'Zusammen', objectId: 'n1', threadId: 'ti', by: 'Mara', byKey: mara.user.key, text: '@Jonas Strom klären' });
    // die eigene Erwähnung zählt nicht
    expect((await inbox(mara.token, start)).body.items).toEqual([]);
    // Web erwähnt Mara (wie das Modul collab: Nachricht mit mentions)
    const after = body.now;
    const msgs = comments(w).get('ti')!.get('messages') as Y.Array<unknown>;
    w.doc.transact(() => msgs.push([{ id: 'w1', by: jonas.user.key, name: 'Jonas', text: 'Mach ich, @Mara', at: new Date().toISOString(), mentions: [mara.user.key] }]));
    await w.flushed();
    await waitFor(async () => (await inbox(mara.token, start)).body.items.length === 1);
    expect((await inbox(mara.token, start)).body.items[0]).toMatchObject({ by: 'Jonas', text: 'Mach ich, @Mara' });
    // für Jonas nichts Neues seit `after`
    expect((await inbox(jonas.token, after)).body.items).toEqual([]);
  });

  it('Karten-Zuweisung durch jemand anderen (nicht durch sich selbst); Papierkorb blendet aus; Fehler', async () => {
    const { w, mara, jonas, board } = await setup();
    const start = (await inbox(mara.token)).body.now;
    const card = new Y.Map<unknown>();
    for (const [k, v] of Object.entries({ type: 'card', x: 0, y: 400, w: 240, h: 120, z: 'a1', text: 'Bühne aufbauen' })) card.set(k, v);
    w.objects.set('c1', card);
    await w.flushed();
    // Jonas weist sich selbst zu: nichts; dann Mara
    w.doc.transact(() => card.set('assignee', { key: jonas.user.key, name: 'Jonas' }));
    w.doc.transact(() => card.set('assignee', { key: mara.user.key, name: 'Mara' }));
    await w.flushed();
    await waitFor(async () => (await inbox(mara.token, start)).body.items.length === 1);
    expect((await inbox(mara.token, start)).body.items[0]).toMatchObject({ type: 'assign', objectId: 'c1', by: 'Jonas', text: 'Bühne aufbauen' });
    expect((await inbox(jonas.token, start)).body.items).toEqual([]);
    // Board im Papierkorb: ausgeblendet
    expect((await mara.browser.req('DELETE', `/api/boards/${board.id}`)).status).toBe(200);
    expect((await inbox(mara.token, start)).body.items).toEqual([]);
    expect((await inbox(mara.token, 'gestern')).status).toBe(400);
    const anon = await fetch(`${env.base}/api/native/v1/inbox`);
    expect(anon.status).toBe(401);
  });
});
