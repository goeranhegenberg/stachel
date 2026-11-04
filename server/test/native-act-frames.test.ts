// Web-Aktion `frames.reorder` (Paket P4, docs/contract.md §8.12): Rahmen-Liste aus der App umsortieren – Ergebnis wie
// die Web-Liste (order.ts movePatches) direkt auf einem Browser-Store, ein Rückgängig-Schritt.
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import '#stachel-web';
import { BoardStore, type NewObject } from '../../web/src/board/store';
import { nativeAction, nativeActionList } from '../../web/src/native/registry';
import { framesInOrder, movePatches } from '../../web/src/features/structure/frames/order';
import { loginMember, startEnv, waitFor, type TestEnv } from './helpers.js';
import { appSession, NativeClient, webClient, type Msg } from './native-client.js';

const ctx = { user: { key: 'a:t', name: 'T' }, now: new Date().toISOString(), v: 1, id: (n: number) => `k-${n}`, exists: () => false, measure: () => 0 };
const run = (store: BoardStore, raw: Record<string, unknown>) => {
  const def = nativeAction('frames.reorder')!;
  const p = def.args(raw, 1);
  if (!p.ok) throw new Error(p.error);
  return def.run(store, p.args, ctx);
};
const frame = (id: string, x: number, y: number, slide?: string) => ({ id, type: 'frame', x, y, w: 400, h: 300, title: id, color: '#ffffff', ...(slide ? { slide } : {}) });
/** zwei Zeilen, ohne `slide` (Lesereihenfolge) */
const BOARD = [frame('a', 0, 0), frame('b', 500, 40), frame('c', 1000, -20), frame('d', 0, 600), frame('e', 500, 620)];
const stores = (objs: object[]) => {
  const app = new BoardStore(new Y.Doc(), 'a:app');
  const web = new BoardStore(new Y.Doc(), 'a:web');
  app.createMany(objs as NewObject[]);
  web.createMany(objs as NewObject[]);
  return { app, web };
};
const order = (s: BoardStore) => framesInOrder(s.getSnapshot().ordered).map((f) => f.id);
const slides = (s: BoardStore) => Object.fromEntries(s.getSnapshot().ordered.map((o) => [o.id, o.slide]));

describe('frames.reorder direkt', () => {
  it('ist angemeldet und prüft die Argumente', () => {
    expect(nativeActionList()['frames.reorder']).toBe(1);
    const def = nativeAction('frames.reorder')!;
    expect(def.undo).toBe('undo');
    for (const bad of [{}, { id: 'a' }, { id: 'a', to: -1 }, { id: 'a', to: 1.5 }, { id: 'a b', to: 0 }, { id: 'a', to: 0, from: 1 }]) {
      expect(def.args(bad, 1).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('jede Verschiebung = movePatches der Web-Liste (Lesereihenfolge, dann vorhandene slide-Schlüssel)', () => {
    for (let from = 0; from < BOARD.length; from++) {
      for (let to = 0; to < BOARD.length; to++) {
        const { app, web } = stores(BOARD);
        const id = order(app)[from];
        const r = run(app, { id, to });
        web.updateMany(movePatches(framesInOrder(web.getSnapshot().ordered), from, to));
        expect(slides(app), `${from}→${to}`).toEqual(slides(web));
        expect(r).toEqual({ data: order(web) });
        expect(order(app)[to]).toBe(id);
      }
    }
  });

  it('mit schon sortierten Rahmen ändert sich nur der verschobene (Schlüssel dazwischen); zu großes to = ans Ende', () => {
    const sorted = [frame('a', 0, 0, 'a0'), frame('b', 500, 0, 'a1'), frame('c', 1000, 0, 'a2'), frame('n', 0, 900)];
    const { app, web } = stores(sorted);
    run(app, { id: 'a', to: 99 });
    web.updateMany(movePatches(framesInOrder(web.getSnapshot().ordered), 0, 3));
    expect(slides(app)).toEqual(slides(web));
    expect(order(app)).toEqual(['b', 'c', 'n', 'a']);
  });

  it('unbekannter Rahmen bzw. gleicher Platz: nichts ändert sich', () => {
    const { app } = stores(BOARD);
    expect(run(app, { id: 'fehlt', to: 0 })).toEqual({ skipped: true });
    expect(run(app, { id: 'a', to: 0 })).toEqual({ data: order(app) });
    expect(Object.values(slides(app)).every((s) => s === undefined)).toBe(true);
  });
});

describe('frames.reorder über die Native-API', () => {
  let env: TestEnv;
  const cleanup: (() => void)[] = [];
  beforeAll(async () => {
    env = await startEnv({ nativeIdleMs: 300 });
  });
  afterAll(async () => env?.stop());
  afterEach(() => {
    while (cleanup.length) cleanup.pop()!();
  });

  it('Web sieht die neue Reihenfolge, ein Rückgängig-Schritt stellt sie wieder her', async () => {
    const kt = env.fake.addMember(4712, 'Mara');
    const browser = await loginMember(env, kt);
    const mara = await appSession(env.base, kt);
    const board = (await browser.post('/api/boards', { title: 'Rahmen' })).body.board as { id: string };
    const ws = env.base.replace('http', 'ws');
    const w = webClient(ws, board.id, { cookie: browser.cookieHeader() });
    cleanup.push(() => w.destroy());
    await w.synced();
    const a = new NativeClient(ws, mara.token);
    cleanup.push(() => a.close());
    const welcome = await a.hello(board.id);
    expect(welcome.actions['frames.reorder']).toBe(1);
    let req = 10;
    const send = async (ops: Record<string, unknown>[]): Promise<Msg> => {
      const r = ++req;
      const from = a.messages.length;
      a.send({ t: 'ops', req: r, ops });
      return a.next((m) => (m.t === 'ack' || m.t === 'nack') && m.req === r, 5000, from);
    };
    await send([{ op: 'create', objects: BOARD }]);
    a.send({ t: 'step' });
    const ack = await send([{ op: 'act', name: 'frames.reorder', args: { id: 'e', to: 0 } }]);
    expect(ack.results['0'].data).toEqual(['e', 'a', 'b', 'c', 'd']);
    const webOrder = () => {
      const objs = [...w.objects.entries()].map(([id, m]) => ({ id, ...(m.toJSON() as object) }));
      return framesInOrder(objs as never).map((f) => f.id);
    };
    await waitFor(() => webOrder()[0] === 'e');
    expect(webOrder()).toEqual(['e', 'a', 'b', 'c', 'd']);
    a.send({ t: 'undo', req: ++req });
    await a.next((m) => m.t === 'ack' && m.req === req);
    await waitFor(() => webOrder()[0] === 'a');
    expect(webOrder()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
