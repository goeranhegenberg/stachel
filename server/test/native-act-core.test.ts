// Web-Aktionen des Kerns für die App (docs/contract.md §8.12, Paket P1): core.group, core.ungroup, core.align,
// core.distribute. Ergebnis = dieselbe Web-Funktion (board/ops/groups.ts, board/ops/arrange.ts) direkt auf einem
// Browser-Store; ein Rückgängig-Schritt; Prüfung der args.
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BoardStore, type NewObject } from '../../web/src/board/store';
import { align, arrangePatches, distribute } from '../../web/src/board/ops/arrange';
import { nativeActionList } from '../../web/src/native/registry';
import '../../web/src/native/actions';
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

let memberId = 3100;
async function setup() {
  const kt = env.fake.addMember(++memberId, 'Mara');
  const browser = await loginMember(env, kt);
  const mara = await appSession(env.base, kt);
  const board = (await browser.post('/api/boards', { title: 'Kern' })).body.board as { id: string };
  const ws = env.base.replace('http', 'ws');
  const w = webClient(ws, board.id, { cookie: browser.cookieHeader() });
  cleanup.push(() => w.destroy());
  await w.synced();
  const a = new NativeClient(ws, mara.token);
  cleanup.push(() => a.close());
  const welcome = await a.hello(board.id);
  return { w, a, welcome };
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

/** Browser-Store mit denselben Objekten (Referenz). */
function refStore(objects: Record<string, unknown>[]) {
  const ref = new BoardStore(new Y.Doc(), 'a:ref');
  ref.createMany(objects as unknown as NewObject[]);
  return ref;
}
const isFrame = (o: { type: string }) => o.type === 'frame';
const field = (w: ReturnType<typeof webClient>, id: string, k: string) => w.objects.get(id)?.get(k);

describe('Kern-Aktionen (P1)', () => {
  it('stehen in welcome.actions', async () => {
    const { welcome } = await setup();
    for (const n of ['core.group', 'core.ungroup', 'core.align', 'core.distribute']) expect(welcome.actions[n]).toBe(1);
    expect(nativeActionList()['core.align']).toBe(1);
  });

  it('core.group: ungesperrte bekommen eine gemeinsame groupId, ein Rückgängig-Schritt; core.ungroup löst', async () => {
    const { a, w } = await setup();
    await send(a, [{ op: 'create', objects: [sticky('a', 0), sticky('b', 200), sticky('c', 400, 0, { locked: true })] }]);
    a.send({ t: 'step' });
    const ack = await send(a, [{ op: 'act', name: 'core.group', args: { ids: ['a', 'b', 'c'] } }]);
    expect(ack.t).toBe('ack');
    expect(ack.results).toEqual({ '0': { select: ['a', 'b'] } });
    await waitFor(() => typeof field(w, 'a', 'groupId') === 'string');
    expect(field(w, 'b', 'groupId')).toBe(field(w, 'a', 'groupId'));
    expect(field(w, 'c', 'groupId')).toBeUndefined();
    // nur ein Objekt ungesperrt: nichts zu tun (wie groupPatches → null)
    expect((await send(a, [{ op: 'act', name: 'core.group', args: { ids: ['c'] } }])).results).toEqual({ '0': { skipped: true } });
    // lösen
    a.send({ t: 'step' });
    expect((await send(a, [{ op: 'act', name: 'core.ungroup', args: { ids: ['a', 'b'] } }])).results).toEqual({ '0': { select: ['a', 'b'] } });
    await waitFor(() => field(w, 'a', 'groupId') === undefined && field(w, 'b', 'groupId') === undefined);
    // Rückgängig: wieder gruppiert, noch einmal: ungruppiert
    expect((await undo(a)).t).toBe('ack');
    await waitFor(() => typeof field(w, 'a', 'groupId') === 'string' && field(w, 'a', 'groupId') === field(w, 'b', 'groupId'));
    expect((await undo(a)).t).toBe('ack');
    await waitFor(() => field(w, 'a', 'groupId') === undefined);
  });

  it('core.align: wie arrangePatches(align) im Browser – Gruppe als Einheit, Rahmen mit Inhalt, Verbinder-Ende folgt', async () => {
    const { a, w } = await setup();
    const objects = [
      sticky('s1', 500, 50),
      sticky('g1', 300, 300, { groupId: 'G' }),
      sticky('g2', 460, 500, { groupId: 'G' }),
      { id: 'f', type: 'frame', x: 900, y: 0, w: 300, h: 300, title: 'Rahmen' },
      sticky('inside', 950, 50),
      sticky('locked', 50, 50, { locked: true }),
      { id: 'c', type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: 's1' }, to: { x: 300, y: 700 } },
    ];
    await send(a, [{ op: 'create', objects }]);
    a.send({ t: 'step' });
    const ids = ['s1', 'g1', 'g2', 'f', 'locked', 'c'];
    const ack = await send(a, [{ op: 'act', name: 'core.align', args: { ids, mode: 'left' } }]);
    expect(ack.results).toEqual({ '0': {} });
    const ref = refStore(objects);
    const expected = arrangePatches(ids.map((id) => ref.get(id)!), ref.getSnapshot(), (u) => align(u, 'left'), isFrame);
    ref.updateMany(expected);
    // Rahmen-Inhalt wandert mit, gesperrte bleiben, das freie Verbinder-Ende folgt s1
    expect(Object.keys(expected).sort()).toEqual(['c', 'f', 'inside', 's1']);
    await waitFor(() => field(w, 'inside', 'x') === ref.get('inside')!.x);
    for (const id of ['s1', 'g1', 'g2', 'f', 'inside', 'locked']) {
      expect({ id, x: field(w, id, 'x'), y: field(w, id, 'y') }).toEqual({ id, x: ref.get(id)!.x, y: ref.get(id)!.y });
    }
    expect(field(w, 'c', 'to')).toEqual(ref.get('c')!.to);
    // Gruppe g1/g2 hält ihren Abstand (eine Einheit)
    expect((field(w, 'g2', 'x') as number) - (field(w, 'g1', 'x') as number)).toBe(160);
    // Rückgängig: alles zurück
    await undo(a);
    await waitFor(() => field(w, 's1', 'x') === 500 && field(w, 'inside', 'x') === 950);
  });

  it('core.align alle Richtungen und core.distribute wie im Browser; zu wenige Einheiten → skipped', async () => {
    const { a, w } = await setup();
    const objects = [sticky('a', 0, 0), sticky('b', 300, 40, { w: 50, h: 100 }), sticky('c', 120, 200, { w: 80, h: 80 }), sticky('d', 700, 90)];
    await send(a, [{ op: 'create', objects }]);
    const ids = objects.map((o) => o.id);
    const ref = refStore(objects);
    for (const mode of ['hcenter', 'right', 'top', 'vcenter', 'bottom'] as const) {
      a.send({ t: 'step' });
      await send(a, [{ op: 'act', name: 'core.align', args: { ids, mode } }]);
      ref.updateMany(arrangePatches(ids.map((id) => ref.get(id)!), ref.getSnapshot(), (u) => align(u, mode), isFrame));
    }
    for (const axis of ['x', 'y'] as const) {
      a.send({ t: 'step' });
      await send(a, [{ op: 'act', name: 'core.distribute', args: { ids, axis } }]);
      ref.updateMany(arrangePatches(ids.map((id) => ref.get(id)!), ref.getSnapshot(), (u) => distribute(u, axis), isFrame));
    }
    await waitFor(() => ids.every((id) => field(w, id, 'x') === ref.get(id)!.x && field(w, id, 'y') === ref.get(id)!.y));
    // zwei Einheiten verteilen: nichts zu tun
    expect((await send(a, [{ op: 'act', name: 'core.distribute', args: { ids: ['a', 'b'], axis: 'x' } }])).results).toEqual({ '0': { skipped: true } });
    expect((await send(a, [{ op: 'act', name: 'core.align', args: { ids: ['a'], mode: 'left' } }])).results).toEqual({ '0': { skipped: true } });
  });

  it('prüft die args vor dem Schreiben', async () => {
    const { a } = await setup();
    for (const [name, args] of [
      ['core.align', { ids: ['a'], mode: 'diagonal' }],
      ['core.distribute', { ids: ['a'], axis: 'z' }],
      ['core.group', { ids: [] }],
      ['core.ungroup', { ids: ['a'], extra: 1 }],
    ] as const) {
      const nack = await send(a, [{ op: 'act', name, args }]);
      expect(nack.t, name).toBe('nack');
      expect(nack.error).toBe('invalid_input');
    }
  });
});
