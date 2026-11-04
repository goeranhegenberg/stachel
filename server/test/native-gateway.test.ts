// Native-Gateway /native/v1 (docs/contract.md §8.4–§8.7): Schnappschuss je Objekttyp, Patches bei Web-Änderungen,
// Resume mit/ohne Ringpuffer, Anwesenheit in beide Richtungen, unbekannte Typen, Ops mit ack/nack und Rückgängig.
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NATIVE_OBJECT_TYPES } from '../../shared/native.js';
import { loginMember, startEnv, waitFor, type Browser, type TestEnv } from './helpers.js';
import { applyPatches, appSession, NativeClient, webClient, type Msg } from './native-client.js';
import { plain, RICH_ALL, seedAllTypes, SHAPE_KINDS } from './native-seed.js';

let env: TestEnv;
let ws: string;
beforeAll(async () => {
  // Sandbox-Schalter: der Seed schreibt einen Kommentar von „Jonas“ über Maras Verbindung (sync.ts, SEC-06)
  env = await startEnv({ nativeIdleMs: 300, nativeBufferMax: 50, nativeDevActions: true });
  ws = env.base.replace('http', 'ws');
});
afterAll(async () => {
  await env?.stop();
});

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

let memberId = 700;
/** Person mit Browser-Sitzung (Web) und App-Token für dieselbe Person. */
async function person(name: string) {
  const kt = env.fake.addMember(++memberId, name);
  const browser = await loginMember(env, kt);
  const { token, user } = await appSession(env.base, kt);
  return { kt, browser, token, user };
}

async function newBoard(b: Browser, title = 'Native') {
  return (await b.post('/api/boards', { title })).body.board as { id: string; title: string };
}

function app(token: string | null) {
  const c = new NativeClient(ws, token);
  cleanup.push(() => c.close());
  return c;
}

function web(boardId: string, b: Browser) {
  const w = webClient(ws, boardId, { cookie: b.cookieHeader() });
  cleanup.push(() => w.destroy());
  return w;
}

const byId = (objects: Record<string, any>[]) => new Map(objects.map((o) => [o.id as string, o]));

describe('Verbinden und Ablehnen', () => {
  it('ohne bzw. mit falschem Token: not_logged_in (4401); Token im hello geht auch', async () => {
    const mara = await person('Mara');
    const board = await newBoard(mara.browser);
    const anon = app(null);
    expect((await anon.hello(board.id)).error).toBe('not_logged_in');
    expect((await anon.waitClosed()).code).toBe(4401);
    const viaHello = app(null);
    const w = await viaHello.hello(board.id, { token: mara.token });
    expect(w.t).toBe('welcome');
    expect(w.user).toEqual({ key: mara.user.key, name: 'Mara', isOrga: false });
  });

  it('unbekanntes Board 4404, Papierkorb 4410, alte Protokollversion 4426, kein hello 4400', async () => {
    const mara = await person('Mara');
    const a = app(mara.token);
    expect((await a.hello('gibtesnicht')).error).toBe('unknown_board');
    expect((await a.waitClosed()).code).toBe(4404);

    const board = await newBoard(mara.browser);
    await mara.browser.req('DELETE', `/api/boards/${board.id}`);
    const b = app(mara.token);
    expect((await b.hello(board.id)).error).toBe('board_deleted');
    expect((await b.waitClosed()).code).toBe(4410);

    const c = app(mara.token);
    expect((await c.hello(board.id, { proto: 2 })).error).toBe('upgrade_required');
    expect((await c.waitClosed()).code).toBe(4426);

    const d = app(mara.token);
    await d.open();
    d.send({ t: 'ping' });
    expect((await d.waitClosed()).code).toBe(4400);
  });

  it('fremder Origin → HTTP 403', async () => {
    const mara = await person('Mara');
    const c = new NativeClient(ws, mara.token, { headers: { Origin: 'https://evil.example' } });
    cleanup.push(() => c.close());
    await expect(c.open()).rejects.toThrow(/403/);
  });
});

describe('Schnappschuss', () => {
  it('enthält jeden Objekttyp des Web mit allen Feldern, Y-Felder als JSON, unbekannte Typen unverändert, Reihenfolge wie Web', async () => {
    const mara = await person('Mara');
    const board = await newBoard(mara.browser, 'Alle Typen');
    const w = web(board.id, mara.browser);
    await w.synced();
    seedAllTypes(w.doc);
    await w.flushed();

    const a = app(mara.token);
    const welcome = await a.hello(board.id);
    expect(welcome.t).toBe('welcome');
    expect(welcome).toMatchObject({ proto: 1, rev: 0, board: { id: board.id, title: 'Alle Typen' }, role: 'edit', below: ['frame'] });
    expect(typeof welcome.epoch).toBe('string');
    const objs = welcome.snapshot.objects as Record<string, any>[];
    const map = byId(objs);

    // jeder Typ, den das Web kennt, ist da
    for (const type of NATIVE_OBJECT_TYPES) expect(objs.some((o) => o.type === type), type).toBe(true);
    // jedes Feld jedes Objekts aus dem Y.Doc kommt mit
    w.objects.forEach((m, id) => {
      const o = map.get(id)!;
      expect(o, id).toBeTruthy();
      for (const k of m.keys()) expect(k in o, `${id}.${k}`).toBe(true);
    });
    expect(objs).toHaveLength(w.objects.size);

    // Rich-Text: ProseMirror-JSON mit allen Knoten/Marks, Klartext-Spiegel passt
    const rich = map.get('sticky_rich')!;
    expect(rich.content).toEqual(RICH_ALL);
    expect(rich.text).toBe(plain(RICH_ALL));
    expect(rich.tags).toEqual([{ label: 'Wichtig', color: '#ec4e92' }, { label: 'Technik', color: '#1763b5' }]);
    expect(map.get('conn_curved')!.content).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Weg zur Bühne' }] }] });
    expect(map.get('sticky_old')!.content).toBeUndefined();
    // Formen: alle 41
    for (const kind of SHAPE_KINDS) expect(map.get(`shape_${kind}`)?.shape).toBe(kind);
    // Verbinder-Enden roh
    expect(map.get('conn_elbow')).toMatchObject({ from: { objectId: 'sticky_rect', side: 'e' }, to: { objectId: 'sticky_old', side: 'w' }, lineStyle: 'elbow', dash: 'dashed' });
    expect(map.get('conn_free')).toMatchObject({ from: { x: 1900, y: 0 }, to: { x: 2200, y: 150 } });
    // Tabelle, Zeitleiste, PDF-Seiten, Karten-Beschreibung (Y.Text)
    expect(map.get('table1')!.table).toEqual({
      rows: ['r1', 'r2', 'r3'],
      cols: ['c1', 'c2', 'c3'],
      cells: { 'r1:c1': 'Was', 'r1:c2': 'Wer', 'r1:c3': 'Wann', 'r2:c1': 'Zelte', 'r2:c2': 'Mara', 'r2:c3': 'Fr', 'r3:c1': 'Strom' },
      widths: { c1: 2 },
    });
    expect(map.get('timeline1')!.timeline).toEqual({
      lanes: ['l1', 'l2'],
      names: { l1: 'Aufbau', l2: 'Programm' },
      items: {
        i1: { lane: 'l1', start: '2027-06-08', end: '2027-06-11', title: 'Zelte', color: '#2b8a3e' },
        i2: { lane: 'l2', start: '2027-06-12', end: '2027-06-12', title: 'Eröffnung', ms: true },
      },
    });
    expect(map.get('doc1')!.docPages).toEqual({ 0: 'img_page0', 1: 'img_page1' });
    expect(map.get('card1')!.desc).toBe('Freitag ab 14 Uhr, mit Lena und Mara');
    expect(map.get('mind_b')!.mind).toEqual({ parent: 'mind_root', order: 1, side: 'l', level: 1, collapsed: true });
    expect(map.get('icon1')!.iconNode).toHaveLength(4);
    // unbekannter Typ: unverändert
    expect(map.get('future1')).toEqual({
      id: 'future1', type: 'future.widget', x: 2000, y: 1300, w: 240, h: 160, z: expect.any(String), createdBy: 'a:seed', updatedAt: '2026-11-01T12:00:00.000Z',
      'future.payload': { level: 3, items: ['a', 'b'] }, color: '#e2d5ff',
    });
    // Reihenfolge: Rahmen unten, dann z, dann id
    expect(objs[0]!.id).toBe('frame1');
    const rest = objs.slice(1);
    for (let i = 1; i < rest.length; i++) {
      const p = rest[i - 1]!;
      const q = rest[i]!;
      expect(p.z < q.z || (p.z === q.z && p.id < q.id), `${p.id} vor ${q.id}`).toBe(true);
    }
    // Feature-Strukturen
    expect(welcome.snapshot.ext['collab.comments'].t1).toMatchObject({ objectId: 'sticky_rich', resolved: false, messages: [{ id: 'm1', text: '@Mara passt das so?' }] });
    expect(welcome.snapshot.ext['collab.reactions']['sticky_rich|👍|m:7']).toMatchObject({ e: '👍' });
  });

  it('want ohne "ext" lässt Feature-Strukturen weg; einzelne Namen gehen', async () => {
    const mara = await person('Mara');
    const board = await newBoard(mara.browser);
    const w = web(board.id, mara.browser);
    await w.synced();
    seedAllTypes(w.doc);
    await w.flushed();
    const a = app(mara.token);
    expect((await a.hello(board.id, { want: ['objects'] })).snapshot.ext).toEqual({});
    const b = app(mara.token);
    expect(Object.keys((await b.hello(board.id, { want: ['collab.reactions'] })).snapshot.ext)).toEqual(['collab.reactions']);
  });
});

describe('Patches bei Änderungen im Web', () => {
  it('Feld setzen/entfernen, Objekt neu/weg, Rich-Text, Tabelle – je Transaktion ein Patch mit rev+1 und by', async () => {
    const mara = await person('Mara');
    const jonas = await person('Jonas');
    const board = await newBoard(mara.browser);
    const w = web(board.id, jonas.browser);
    await w.synced();
    seedAllTypes(w.doc);
    await w.flushed();
    const a = app(mara.token);
    const welcome = await a.hello(board.id);
    const state = new Map((welcome.snapshot.objects as Record<string, any>[]).map((o) => [o.id as string, o]));
    let rev = welcome.rev as number;
    const nextPatch = async () => {
      const p = await a.next((m) => m.t === 'patch' && m.rev === rev + 1);
      rev = p.rev;
      return p;
    };

    // Feld setzen + entfernen in einer Transaktion
    w.doc.transact(() => {
      const m = w.objects.get('sticky_rect')!;
      m.set('x', 999);
      m.delete('rotation');
    });
    let p = await nextPatch();
    expect(p.by).toBe(jonas.user.key);
    expect(p.changes).toEqual([{ id: 'sticky_rect', set: { x: 999 }, unset: ['rotation'] }]);

    // neu
    w.doc.transact(() => {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({ id: 'neu1', type: 'sticky', x: 1, y: 2, w: 200, h: 200, z: 'zz', text: 'Neu' })) m.set(k, v);
      w.objects.set('neu1', m);
    });
    p = await nextPatch();
    expect(p.changes).toEqual([{ id: 'neu1', created: { id: 'neu1', type: 'sticky', x: 1, y: 2, w: 200, h: 200, z: 'zz', text: 'Neu' } }]);

    // Rich-Text tippen (tiefe Änderung im Fragment) → ganzes content neu
    w.doc.transact(() => {
      const frag = w.objects.get('sticky_rich')!.get('content') as Y.XmlFragment;
      const para = frag.get(4) as Y.XmlElement;
      (para.get(0) as Y.XmlText).insert(0, 'Neue ');
    });
    p = await nextPatch();
    expect(p.changes).toHaveLength(1);
    expect(p.changes[0].id).toBe('sticky_rich');
    expect(p.changes[0].set.content.content[4].content[0].text).toBe('Neue Zeile 1');

    // Tabellenzelle (Y.Text tief in table) → ganzes table neu
    w.doc.transact(() => {
      const cells = (w.objects.get('table1')!.get('table') as Y.Map<unknown>).get('cells') as Y.Map<unknown>;
      (cells.get('r2:c1') as Y.Text).insert(5, ' (6 Stück)');
    });
    p = await nextPatch();
    expect(p.changes[0]).toMatchObject({ id: 'table1', set: { table: { cells: { 'r2:c1': 'Zelte (6 Stück)' } } } });

    // löschen (mit angedocktem Verbinder in derselben Transaktion)
    w.doc.transact(() => {
      w.objects.delete('sticky_old');
      w.objects.delete('conn_elbow');
    });
    p = await nextPatch();
    expect(p.changes).toEqual(expect.arrayContaining([{ id: 'sticky_old', removed: true }, { id: 'conn_elbow', removed: true }]));

    // Feature-Struktur: Reaktion dazu → ext ganz
    w.doc.getMap('collab.reactions').set('neu1|🎉|m:1', { o: 'neu1', e: '🎉', u: 'm:1', n: 'X', at: 'now' });
    p = await nextPatch();
    expect(p.changes).toEqual([]);
    expect(Object.keys(p.ext['collab.reactions'])).toHaveLength(2);

    // App-Stand = Schnappschuss + Patches = frischer Schnappschuss
    const all = a.messages.filter((m) => m.t === 'patch');
    applyPatches(state, all);
    const fresh = app(mara.token);
    const again = await fresh.hello(board.id);
    expect(again.rev).toBe(rev);
    expect(new Map((again.snapshot.objects as Record<string, any>[]).map((o) => [o.id, o]))).toEqual(state);
  });

  it('Umbenennen und Löschen des Boards kommen als event; Löschen trennt mit 4410', async () => {
    const mara = await person('Mara');
    const board = await newBoard(mara.browser);
    const a = app(mara.token);
    await a.hello(board.id);
    await mara.browser.req('PATCH', `/api/boards/${board.id}`, { json: { title: 'Neuer Titel' } });
    expect(await a.next((m) => m.t === 'event')).toMatchObject({ type: 'board.renamed', title: 'Neuer Titel', titleSeq: expect.any(Number) });
    await mara.browser.req('DELETE', `/api/boards/${board.id}`);
    expect(await a.next((m) => m.t === 'event' && m.type === 'board.deleted')).toMatchObject({ by: 'Mara', byKey: mara.user.key });
    expect((await a.waitClosed()).code).toBe(4410);
  });
});

describe('Resume', () => {
  it('mit passender Epoche und Ringpuffer: resumed mit genau den fehlenden Patches; sonst welcome', async () => {
    const mara = await person('Mara');
    const board = await newBoard(mara.browser);
    const w = web(board.id, mara.browser);
    await w.synced();
    seedAllTypes(w.doc);
    await w.flushed();
    const a = app(mara.token);
    const welcome = await a.hello(board.id);
    const state = new Map((welcome.snapshot.objects as Record<string, any>[]).map((o) => [o.id as string, o]));
    a.close();
    await a.waitClosed();

    // Funkloch: drei Änderungen im Web
    for (let i = 0; i < 3; i++) w.objects.get('sticky_rect')!.set('x', 100 + i);
    w.objects.delete('pen1');
    await w.flushed();

    const b = app(mara.token);
    const resumed = await b.hello(board.id, { resume: { epoch: welcome.epoch, rev: welcome.rev } });
    expect(resumed.t).toBe('resumed');
    expect(resumed.epoch).toBe(welcome.epoch);
    expect(resumed.rev).toBe(welcome.rev + 4);
    expect(resumed.patches.map((p: Msg) => p.rev)).toEqual([1, 2, 3, 4].map((n) => welcome.rev + n));
    applyPatches(state, resumed.patches);
    expect(state.get('sticky_rect')!.x).toBe(102);
    expect(state.has('pen1')).toBe(false);

    // nichts verpasst → resumed ohne Patches
    const c = app(mara.token);
    const same = await c.hello(board.id, { resume: { epoch: welcome.epoch, rev: resumed.rev } });
    expect(same).toMatchObject({ t: 'resumed', patches: [] });

    // falsche Epoche → Schnappschuss
    const d = app(mara.token);
    expect((await d.hello(board.id, { resume: { epoch: 'alt', rev: 2 } })).t).toBe('welcome');

    // Ringpuffer reicht nicht (bufferMax 50 im Test) → Schnappschuss
    // einzeln bestätigt, damit es 60 Transaktionen (Patches) werden und nicht ein zusammengefasstes Update
    for (let i = 0; i < 60; i++) {
      w.objects.get('sticky_rect')!.set('y', 1000 + i);
      await w.flushed();
    }
    await waitFor(async () => {
      const m = (await env.srv.native.mirrors.peek(board.id))!;
      return m.rev >= resumed.rev + 60;
    });
    const e = app(mara.token);
    const full = await e.hello(board.id, { resume: { epoch: welcome.epoch, rev: resumed.rev } });
    expect(full.t).toBe('welcome');
    expect(byId(full.snapshot.objects).get('sticky_rect')!.y).toBe(1059);
  });

  it('nach dem Schließen des Spiegels (kein App da) gibt es eine neue Epoche', async () => {
    const mara = await person('Mara');
    const board = await newBoard(mara.browser);
    const a = app(mara.token);
    const first = await a.hello(board.id);
    a.close();
    await a.waitClosed();
    await waitFor(async () => (await env.srv.native.mirrors.peek(board.id)) === null, 3000); // nativeIdleMs 300
    const b = app(mara.token);
    const again = await b.hello(board.id, { resume: { epoch: first.epoch, rev: first.rev } });
    expect(again.t).toBe('welcome');
    expect(again.epoch).not.toBe(first.epoch);
  });
});

describe('Anwesenheit', () => {
  it('die App erscheint im Web als Person (Farbe, Cursor, Auswahl, „schreibt hier“), Web-Peers kommen als presence', async () => {
    const mara = await person('Mara');
    const jonas = await person('Jonas');
    const board = await newBoard(mara.browser);
    const w = web(board.id, jonas.browser);
    await w.synced();
    w.provider.setAwarenessField('user', { key: jonas.user.key, name: 'Jonas', color: '#1763b5' });
    w.provider.setAwarenessField('since', Date.now() - 1000);
    w.provider.setAwarenessField('cursor', { x: 5, y: 6 });
    w.provider.setAwarenessField('richtext.caret', { id: 'n1', anchor: 1, head: 1 });
    w.provider.setAwarenessField('collab.status', 'active');
    await new Promise((r) => setTimeout(r, 100));

    const a = app(mara.token);
    const welcome = await a.hello(board.id);
    expect(welcome.color).toBe('#ec4e92'); // Blau hat Jonas
    expect(welcome.peers).toEqual([
      expect.objectContaining({ key: jonas.user.key, name: 'Jonas', color: '#1763b5', client: 'web', cursor: { x: 5, y: 6 }, editing: 'n1', extra: { 'collab.status': 'active' } }),
    ]);

    // App im Web sichtbar
    const appState = () => [...w.provider.awareness!.getStates().values()].find((s) => (s as any).user?.key === mara.user.key) as any;
    await waitFor(() => !!appState());
    expect(appState()).toMatchObject({ user: { key: mara.user.key, name: 'Mara', color: '#ec4e92' }, client: 'app', cursor: null, selection: [] });

    a.send({ t: 'presence', cursor: { x: 10, y: 20 }, selection: ['n1', 'n2'], editing: 'n1', viewport: { x: 0, y: 0, w: 390, h: 800 } });
    await waitFor(() => appState()?.cursor?.x === 10);
    expect(appState()).toMatchObject({ cursor: { x: 10, y: 20 }, selection: ['n1', 'n2'], 'richtext.caret': { id: 'n1' }, 'collab.viewport': { w: 390 } });
    a.send({ t: 'presence', editing: null, cursor: null });
    await waitFor(() => appState()?.cursor === null && !('richtext.caret' in appState()));

    // Web bewegt den Cursor → presence an die App (ganze Liste, ohne sich selbst)
    const from = a.messages.length;
    w.provider.setAwarenessField('cursor', { x: 50, y: 60 });
    const pr = await a.next((m) => m.t === 'presence' && m.peers.some((p: any) => p.cursor?.x === 50), 3000, from);
    expect(pr.peers.every((p: any) => p.id !== welcome.clientId)).toBe(true);

    // App trennt → sofort weg im Web
    a.close();
    await waitFor(() => !appState(), 3000);
  });

  it('zweites Gerät derselben Person bekommt dieselbe Farbe', async () => {
    const mara = await person('Mara');
    const board = await newBoard(mara.browser);
    const w = web(board.id, mara.browser);
    await w.synced();
    w.provider.setAwarenessField('user', { key: mara.user.key, name: 'Mara', color: '#2b8a3e' });
    await new Promise((r) => setTimeout(r, 100));
    const a = app(mara.token);
    expect((await a.hello(board.id)).color).toBe('#2b8a3e');
  });
});

describe('Ops (App schreibt)', () => {
  it('create/update/remove/order in einer Transaktion: Web sieht es, ack nach eigenem Patch, Wiederholung idempotent', async () => {
    const mara = await person('Mara');
    const board = await newBoard(mara.browser);
    const w = web(board.id, mara.browser);
    await w.synced();
    seedAllTypes(w.doc);
    await w.flushed();
    const a = app(mara.token);
    const welcome = await a.hello(board.id);

    const ops = {
      t: 'ops',
      req: 1,
      ops: [
        { op: 'create', objects: [{ id: 'app_n1', type: 'sticky', x: 10, y: 20, w: 200, h: 200, color: '#fff27a', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Aus der App', marks: [{ type: 'bold' }] }] }] } }] },
        { op: 'update', patches: { sticky_rect: { x: 5, rotation: null }, gibtsnicht: { x: 1 } } },
        { op: 'remove', ids: ['sticky_old'] },
        { op: 'order', ids: ['shape_rect'], to: 'front' },
      ],
    };
    a.send(ops);
    const ack = await a.next((m) => m.t === 'ack' && m.req === 1);
    expect(ack.rev).toBe(welcome.rev + 1);
    const patch = a.messages.find((m) => m.t === 'patch' && m.rev === ack.rev)!;
    expect(a.messages.indexOf(patch)).toBeLessThan(a.messages.indexOf(ack));
    expect(patch.by).toBe(mara.user.key);
    const ch = new Map((patch.changes as any[]).map((c) => [c.id, c]));
    expect(ch.get('app_n1').created).toMatchObject({ type: 'sticky', createdBy: mara.user.key, text: 'Aus der App', content: { type: 'doc' } });
    expect(ch.get('sticky_rect')).toMatchObject({ set: { x: 5 }, unset: ['rotation'] });
    expect(ch.get('sticky_old')).toEqual({ id: 'sticky_old', removed: true });
    expect(ch.get('conn_elbow')).toEqual({ id: 'conn_elbow', removed: true }); // angedockter Verbinder mit gelöscht
    expect(ch.get('shape_rect').set.z > ch.get('app_n1').created.z).toBe(true);

    // Web hat alles
    await waitFor(() => w.objects.has('app_n1') && !w.objects.has('sticky_old'));
    expect(w.objects.get('app_n1')!.get('content')).toBeInstanceOf(Y.XmlFragment);
    expect(w.objects.get('app_n1')!.get('text')).toBe('Aus der App');
    expect(w.objects.get('sticky_rect')!.get('x')).toBe(5);
    expect(w.objects.get('sticky_rect')!.has('rotation')).toBe(false);

    // dieselbe req nochmal (Funkloch) → nur ack, nichts doppelt
    const before = a.messages.length;
    a.send(ops);
    const ack2 = await a.next((m) => m.t === 'ack' && m.req === 1, 3000, before);
    expect(ack2.rev).toBe(ack.rev);
    // auch über neue Verbindung derselben Sitzung
    const b = app(mara.token);
    await b.hello(board.id);
    b.send(ops);
    expect((await b.next((m) => m.t === 'ack')).rev).toBe(ack.rev);
    // create mit vorhandener ID bei neuer req: übersprungen
    b.send({ t: 'ops', req: 2, ops: [{ op: 'create', objects: [{ id: 'app_n1', type: 'sticky', x: 0, y: 0, w: 10, h: 10 }] }] });
    expect((await b.next((m) => m.t === 'ack' && m.req === 2)).rev).toBe(ack.rev);
    expect(w.objects.get('app_n1')!.get('w')).toBe(200);
  });

  it('Prüfung: ungültige Ops → nack mit Index, nichts geschrieben; unbekannte Op → unsupported', async () => {
    const mara = await person('Mara');
    const board = await newBoard(mara.browser);
    const a = app(mara.token);
    const welcome = await a.hello(board.id);
    const nack = async (req: number, ops: unknown) => {
      a.send({ t: 'ops', req, ops });
      return a.next((m) => (m.t === 'nack' || m.t === 'ack') && m.req === req);
    };
    const ok = { op: 'create', objects: [{ id: 'ok1', type: 'sticky', x: 0, y: 0, w: 1, h: 1 }] };
    expect(await nack(1, [ok, { op: 'update', patches: { ok1: { x: 'links' } } }])).toMatchObject({ t: 'nack', error: 'invalid_input', index: 1 });
    expect(await nack(2, [{ op: 'create', objects: [{ id: 'bad id!', type: 'sticky', x: 0, y: 0, w: 1, h: 1 }] }])).toMatchObject({ error: 'invalid_input', index: 0 });
    expect(await nack(3, [{ op: 'update', patches: { ok1: { color: 'rot' } } }])).toMatchObject({ error: 'invalid_input' });
    expect(await nack(4, [{ op: 'update', patches: { ok1: { geheim: 1 } } }])).toMatchObject({ error: 'invalid_input' });
    expect(await nack(5, [{ op: 'update', patches: { ok1: { z: 'a0' } } }])).toMatchObject({ error: 'invalid_input' });
    expect(await nack(6, [{ op: 'zaubern', id: 'ok1' }])).toMatchObject({ error: 'unsupported' });
    expect(await nack(7, [{ op: 'create', objects: [{ id: 'big', type: 'sticky', x: 0, y: 0, w: 1, h: 1, text: 'x'.repeat(20_001) }] }])).toMatchObject({ error: 'invalid_input' });
    expect(await nack(8, [{ op: 'remove', ids: Array.from({ length: 501 }, (_, i) => `i${i}`) }])).toMatchObject({ error: 'too_large' });
    expect(a.messages.some((m) => m.t === 'patch')).toBe(false);
    // Modul-Präfix ist erlaubt
    expect(await nack(9, [{ ...ok, objects: [{ ...ok.objects[0], 'tasks.taskId': 42 }] }])).toMatchObject({ t: 'ack', rev: welcome.rev + 1 });
  });

  it('Rückgängig nimmt nur eigene Schritte zurück; step trennt Schritte; history meldet den Stand', async () => {
    const mara = await person('Mara');
    const jonas = await person('Jonas');
    const board = await newBoard(mara.browser);
    const w = web(board.id, jonas.browser);
    await w.synced();
    const a = app(mara.token);
    const welcome = await a.hello(board.id);
    expect(welcome.history).toEqual({ canUndo: false, canRedo: false });
    a.send({ t: 'ops', req: 1, ops: [{ op: 'create', objects: [{ id: 'u1', type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'eins' }] }] });
    await a.next((m) => m.t === 'ack' && m.req === 1);
    expect(await a.next((m) => m.t === 'history')).toEqual({ t: 'history', canUndo: true, canRedo: false });
    a.send({ t: 'step' });
    a.send({ t: 'ops', req: 2, ops: [{ op: 'update', patches: { u1: { x: 300 } } }] });
    await a.next((m) => m.t === 'ack' && m.req === 2);
    // fremde Änderung im Web
    await waitFor(() => w.objects.has('u1'));
    w.objects.get('u1')!.set('color', '#c9e14a');
    await waitFor(() => a.messages.some((m) => m.t === 'patch' && m.by === jonas.user.key));

    a.send({ t: 'undo', req: 3 });
    await a.next((m) => m.t === 'ack' && m.req === 3);
    await waitFor(() => w.objects.get('u1')?.get('x') === 0);
    expect(w.objects.get('u1')!.get('color')).toBe('#c9e14a'); // Jonas' Änderung bleibt
    a.send({ t: 'undo', req: 4 });
    await a.next((m) => m.t === 'ack' && m.req === 4);
    await waitFor(() => !w.objects.has('u1'));
    a.send({ t: 'undo', req: 5 });
    expect(await a.next((m) => m.req === 5)).toMatchObject({ t: 'nack', error: 'nothing' });
    a.send({ t: 'redo', req: 6 });
    await a.next((m) => m.t === 'ack' && m.req === 6);
    await waitFor(() => w.objects.has('u1'));
  });

  it('Versionsverlauf nennt die Person der App-Änderung', async () => {
    const mara = await person('Mara');
    const board = await newBoard(mara.browser);
    const a = app(mara.token);
    await a.hello(board.id);
    a.send({ t: 'ops', req: 1, ops: [{ op: 'create', objects: [{ id: 'v1', type: 'text', x: 0, y: 0, w: 100, h: 40, text: 'Version' }] }] });
    await a.next((m) => m.t === 'ack');
    a.close();
    await a.waitClosed();
    await env.srv.native.mirrors.closeBoard(board.id);
    await waitFor(async () => ((await mara.browser.get(`/api/boards/${board.id}/versions`)).body.versions ?? []).length > 0, 5000);
    const versions = (await mara.browser.get(`/api/boards/${board.id}/versions`)).body.versions as { people: { key: string }[] }[];
    expect(versions.some((v) => v.people.some((p) => p.key === mara.user.key))).toBe(true);
  });
});
