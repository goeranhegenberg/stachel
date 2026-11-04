// Web-Aktionen Q3 für die App (docs/contract.md §8.12): tools.cluster (cluster.ts), tools.replace (replace.ts),
// tools.convert (convert.ts). Ergebnis = dieselbe Web-Funktion direkt auf einem Browser-Store; Rückgängig in einem
// Schritt; Gesperrtes bleibt; Prüfung der args.
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WEB } from '#stachel-web';
import { BoardStore, type NewObject } from '../../web/src/board/store';
import { clusterInStore } from '../../web/src/features/tools/cluster';
import { convertInStore } from '../../web/src/features/tools/convert';
import { replaceInStore } from '../../web/src/features/tools/replace';
import { adjustTextPatch } from '../../web/src/editor/interaction/textWidth';
import { loginMember, startEnv, waitFor, type TestEnv } from './helpers.js';
import { appSession, NativeClient, webClient, type Msg } from './native-client.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv({ nativeIdleMs: 300 });
});
afterAll(async () => {
  await env?.stop();
});
const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

let memberId = 3900;
async function setup() {
  const kt = env.fake.addMember(++memberId, 'Mara');
  const browser = await loginMember(env, kt);
  const mara = await appSession(env.base, kt);
  const board = (await browser.post('/api/boards', { title: 'Ordnen' })).body.board as { id: string };
  const ws = env.base.replace('http', 'ws');
  const w = webClient(ws, board.id, { cookie: browser.cookieHeader() });
  cleanup.push(() => w.destroy());
  await w.synced();
  const a = new NativeClient(ws, mara.token);
  cleanup.push(() => a.close());
  const welcome = await a.hello(board.id);
  return { w, a, welcome, user: mara.user };
}

let reqNo = 100;
async function send(a: NativeClient, list: Record<string, unknown>[], req = ++reqNo): Promise<Msg> {
  const from = a.messages.length;
  a.send({ t: 'ops', req, ops: list });
  return a.next((m) => (m.t === 'ack' || m.t === 'nack') && m.req === req, 5000, from);
}
async function undo(a: NativeClient) {
  const from = a.messages.length;
  a.send({ t: 'undo', req: ++reqNo });
  return a.next((m) => (m.t === 'ack' || m.t === 'nack') && m.req === reqNo, 5000, from);
}

const sticky = (id: string, x: number, y = 0, extra: Record<string, unknown> = {}) => ({ id, type: 'sticky', x, y, w: 100, h: 100, text: id, ...extra });
const field = (w: ReturnType<typeof webClient>, id: string, k: string) => w.objects.get(id)?.get(k);
const refStore = (objects: Record<string, unknown>[]) => {
  const ref = new BoardStore(new Y.Doc(), 'a:ref');
  ref.createMany(objects as unknown as NewObject[]);
  ref.stopCapturing();
  return ref;
};
type Results = Record<string, { select?: string[]; data?: Record<string, unknown>; toast?: string; skipped?: true }>;

describe('Q3-Aktionen', () => {
  it('stehen in welcome.actions', async () => {
    const { welcome } = await setup();
    for (const n of ['tools.cluster', 'tools.replace', 'tools.convert']) expect(welcome.actions[n]).toBe(1);
    expect(WEB.actionList(false)['tools.cluster']).toBe(1);
  });

  it('tools.cluster nach Farbe: Lage und Überschriften wie clusterInStore im Browser, ein Undo-Schritt', async () => {
    const { a, w } = await setup();
    const objects = [
      sticky('a', 0, 0, { color: '#fff27a' }),
      sticky('b', 150, 0, { color: '#ffb3d1' }),
      sticky('c', 300, 20, { color: '#fff27a' }),
      sticky('d', 0, 300, { color: '#9fd3ff' }),
      sticky('e', 150, 300, { color: '#ffb3d1' }),
      sticky('lk', 900, 900, { locked: true }),
    ];
    await send(a, [{ op: 'create', objects }]);
    const ids = objects.map((o) => o.id);
    await waitFor(() => ids.every((id) => w.objects.has(id)));
    a.send({ t: 'step' });
    const ack = await send(a, [{ op: 'act', name: 'tools.cluster', args: { ids, by: 'color' }, key: 'cl1' }]);
    const r = (ack.results as Results)['0']!;
    const ref = refStore(objects);
    const expected = clusterInStore(ref, ids, 'color', new Map(), (i) => `cl1-${i + 1}`)!;
    expect(r.select?.sort()).toEqual(expected.select.sort());
    expect(r.data).toEqual({ groups: 3, rect: expected.rect });
    await waitFor(() => w.objects.has('cl1-3'));
    for (const id of [...ids, 'cl1-1', 'cl1-2', 'cl1-3']) {
      const o = ref.get(id)!;
      for (const k of ['x', 'y', 'w', 'h', 'text', 'type']) expect({ id, k, v: field(w, id, k) }).toEqual({ id, k, v: (o as unknown as Record<string, unknown>)[k] });
    }
    expect(['cl1-1', 'cl1-2', 'cl1-3'].map((id) => field(w, id, 'text'))).toEqual(['Gelb', 'Rosa', 'Hellblau']);
    expect(field(w, 'lk', 'x')).toBe(900);
    await undo(a);
    await waitFor(() => !w.objects.has('cl1-1') && field(w, 'c', 'x') === 300);
    expect(field(w, 'c', 'y')).toBe(20);
  });

  it('tools.cluster nach Autor:in: Namen aus structure.people und der Sitzung; zu wenig = Hinweis', async () => {
    const { a, w, user } = await setup();
    await send(a, [{ op: 'create', objects: [sticky('m1', 0), sticky('m2', 400)] }]);
    // Notiz von Jonas (wie aus dem Browser) und sein Name im Board
    w.doc.transact(() => {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({ ...sticky('j1', 200), z: 'a0', createdBy: 'm:77' })) m.set(k, v);
      w.objects.set('j1', m);
      w.doc.getMap<string>('structure.people').set('m:77', 'Jonas');
    });
    await w.flushed();
    await new Promise((res) => setTimeout(res, 150));
    const ack = await send(a, [{ op: 'act', name: 'tools.cluster', args: { ids: ['m1', 'j1', 'm2'], by: 'author' }, key: 'au' }]);
    expect((ack.results as Results)['0']!.data?.groups).toBe(2);
    await waitFor(() => w.objects.has('au-2'));
    expect([field(w, 'au-1', 'text'), field(w, 'au-2', 'text')]).toEqual([user.name, 'Jonas']);
    // Mara (m1, m2) links in einem Raster, Jonas rechts daneben
    expect(field(w, 'j1', 'x') as number).toBeGreaterThan(field(w, 'm2', 'x') as number);
    const one = await send(a, [{ op: 'act', name: 'tools.cluster', args: { ids: ['m1'], by: 'color' } }]);
    expect((one.results as Results)['0']).toEqual({ skipped: true, toast: 'Zum Clustern mindestens zwei bewegliche Objekte wählen.' });
    const bad = await send(a, [{ op: 'act', name: 'tools.cluster', args: { ids: ['m1'], by: 'stimmung' } }]);
    expect(bad.t).toBe('nack');
  });

  it('tools.replace: Rich-Text behält die Formatierung, Rahmen und Karte, Gesperrtes bleibt, „Ersetzen“ nur die erste, ein Schritt', async () => {
    const { a, w } = await setup();
    const content = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Die ' }, { type: 'text', text: 'Bühne', marks: [{ type: 'bold' }] }, { type: 'text', text: ' und die bühne' }] }],
    };
    const objects = [
      { id: 'n', type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'Die Bühne und die bühne', content },
      { id: 'f', type: 'frame', x: 0, y: 400, w: 400, h: 300, title: 'Bühnenplan' },
      { id: 'c', type: 'card', x: 500, y: 0, w: 300, h: 96, text: 'Bühne bauen' },
      { id: 't', type: 'text', x: 0, y: 800, w: 100, h: 36, text: 'Bühne', fontSize: 24, color: '#0a0a0a', autoWidth: true },
      { id: 'l', type: 'sticky', x: 900, y: 0, w: 100, h: 100, text: 'Bühne', locked: true },
    ];
    await send(a, [{ op: 'create', objects }]);
    await waitFor(() => objects.every((o) => w.objects.has(o.id)));
    a.send({ t: 'step' });
    const ids = objects.map((o) => o.id);
    const ack = await send(a, [{ op: 'act', name: 'tools.replace', args: { ids, query: 'buehne', replace: 'Theke' } }]);
    const r = (ack.results as Results)['0']!;
    expect(r.data).toEqual({ replaced: 5, changed: ['n', 'f', 'c', 't'], locked: 1 });
    expect(r.toast).toBe('5 Stellen ersetzt. 1 in gesperrten Objekten nicht ersetzt.');
    // Browser-Referenz
    const ref = refStore(objects);
    replaceInStore(ref, ids, 'buehne', 'Theke', { adjust: (o, p) => (o.type === 'text' ? adjustTextPatch(o, p) : p) });
    await waitFor(() => field(w, 't', 'text') === 'Theke');
    for (const id of ids) for (const k of ['text', 'title', 'w']) expect({ id, k, v: field(w, id, k) }).toEqual({ id, k, v: (ref.get(id) as unknown as Record<string, unknown>)[k] });
    expect(field(w, 'n', 'text')).toBe('Die Theke und die Theke');
    const frag = w.objects.get('n')!.get('content') as Y.XmlFragment;
    expect(frag.toString()).toContain('<bold>Theke</bold>');
    expect(field(w, 'l', 'text')).toBe('Bühne');
    await undo(a);
    await waitFor(() => field(w, 'n', 'text') === 'Die Bühne und die bühne' && field(w, 'f', 'title') === 'Bühnenplan');
    // nur die erste Fundstelle
    a.send({ t: 'step' });
    const one = await send(a, [{ op: 'act', name: 'tools.replace', args: { ids: ['l', 'n'], query: 'bühne', replace: 'X', first: true } }]);
    expect((one.results as Results)['0']!.data).toEqual({ replaced: 1, changed: ['n'], locked: 1 });
    await waitFor(() => field(w, 'n', 'text') === 'Die X und die bühne');
    // nichts / ungültig
    expect((await send(a, [{ op: 'act', name: 'tools.replace', args: { ids: ['f'], query: 'gibtsnicht', replace: '' } }])).results).toEqual({
      '0': { skipped: true, toast: 'Nichts gefunden.', data: { replaced: 0, changed: [], locked: 0 } },
    });
    expect((await send(a, [{ op: 'act', name: 'tools.replace', args: { ids: ['f'], query: '   ', replace: 'x' } }])).t).toBe('nack');
  });

  it('tools.convert: gleiche ID, Text und Farbe bleiben, Karte mit gemessener Höhe, ein Schritt', async () => {
    const { a, w } = await setup();
    const objects = [
      sticky('n', 0, 0, { color: '#ffb3d1', text: 'Notiz' }),
      { id: 'c', type: 'card', x: 300, y: 0, w: 300, h: 96, text: 'Karte', desc: 'Mehr dazu', status: 'doing', color: '#ec4e92' },
      { id: 'k', type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: 'n' }, to: { objectId: 'c' } },
      sticky('lk', 900, 0, { locked: true }),
    ];
    const created = await send(a, [{ op: 'create', objects }]);
    expect(created.t, JSON.stringify(created)).toBe('ack');
    await waitFor(() => objects.every((o) => w.objects.has(o.id)));
    a.send({ t: 'step' });
    const toShape = await send(a, [{ op: 'act', name: 'tools.convert', args: { ids: ['n', 'lk'], to: 'shape' } }]);
    expect((toShape.results as Results)['0']).toEqual({ select: ['n'], data: { changed: ['n'] } });
    await waitFor(() => field(w, 'n', 'type') === 'shape');
    expect([field(w, 'n', 'shape'), field(w, 'n', 'color'), field(w, 'n', 'text')]).toEqual(['rect', '#ffb3d1', 'Notiz']);
    expect(field(w, 'lk', 'type')).toBe('sticky');
    // Karte → Haftnotiz: Titel + Beschreibung als Text, Kartenfelder weg; Verbinder hängt weiter
    a.send({ t: 'step' });
    await send(a, [{ op: 'act', name: 'tools.convert', args: { ids: ['c'], to: 'sticky' } }]);
    await waitFor(() => field(w, 'c', 'type') === 'sticky');
    expect([field(w, 'c', 'text'), field(w, 'c', 'status'), field(w, 'c', 'desc')]).toEqual(['Karte\nMehr dazu', undefined, undefined]);
    expect((field(w, 'k', 'to') as { objectId: string }).objectId).toBe('c');
    // Form → Karte: Höhe wie cardContentHeight mit den Schriftmaßen des Servers
    a.send({ t: 'step' });
    await send(a, [{ op: 'act', name: 'tools.convert', args: { ids: ['n'], to: 'card' } }]);
    await waitFor(() => field(w, 'n', 'type') === 'card');
    const ref = refStore([sticky('n', 0, 0, { color: '#ffb3d1', text: 'Notiz' })]);
    convertInStore(ref, ['n'], 'card');
    expect(field(w, 'n', 'w')).toBe(ref.get('n')!.w);
    expect(field(w, 'n', 'color')).toBe('#1763b5');
    expect(typeof field(w, 'n', 'h')).toBe('number');
    await undo(a);
    await waitFor(() => field(w, 'n', 'type') === 'shape');
    await undo(a);
    await waitFor(() => field(w, 'c', 'type') === 'card' && field(w, 'c', 'status') === 'doing');
    expect((await send(a, [{ op: 'act', name: 'tools.convert', args: { ids: ['n'], to: 'frame' } }])).t).toBe('nack');
  });
});
