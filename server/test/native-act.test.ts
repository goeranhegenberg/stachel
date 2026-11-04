// Web-Aktionen der Native-API (docs/contract.md §8.12, Op `act`): Register und Sammel-Import (Stubs aller Pakete),
// Prüfung vor dem Schreiben, Ausführung wie im Browser (Ergebnis = dieselbe Web-Funktion direkt auf einem Browser-Store,
// sieht die Ops davor), Undo-Klassen und Person im Patch, feste IDs und Gedächtnis per `key`, Wiederholung einer `req`,
// `ack.results`, Fehler im Web-Code, Sandbox-Aktion `dev.note`, presence.extra (§8.4).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WEB } from '#stachel-web';
import { BoardStore, type NewObject } from '../../web/src/board/store';
import { movePatches } from '../../web/src/board/ops/move';
import { A, parseArgs } from '../../web/src/native/args';
import { defineNativeAction, nativeActionList, removeNativeActionForTest } from '../../web/src/native/registry';
import { loginMember, startEnv, waitFor, type TestEnv } from './helpers.js';
import { appSession, NativeClient, webClient, type Msg } from './native-client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC = path.resolve(here, '../../web/src');

// ---- Test-Aktionen: echte Web-Funktionen über das Register --------------------------------------------------------

let failRuns = 0;
let countRuns = 0;
const TEST_ACTIONS = ['test.move', 'test.markNone', 'test.markNull', 'test.count', 'test.fail', 'test.make'];
/** Verschieben mit board/ops/move.ts – liest den Schnappschuss des Stores wie im Browser */
defineNativeAction<{ ids: string[]; dx: number; dy: number }>('test.move', {
  version: 2,
  undo: 'undo',
  args: (raw) => parseArgs(raw, { ids: A.ids(), dx: A.num(), dy: A.num() }),
  run(store, { ids, dx, dy }) {
    const objs = ids.map((id) => store.get(id)).filter((o) => !!o);
    if (!objs.length) return { skipped: true };
    store.updateMany(movePatches(objs, dx, dy));
    return { select: objs.map((o) => o.id), focus: objs.map((o) => o.id) };
  },
});
/** Undo-Klasse none: Schreiben über den Store (verfolgter Origin) darf nicht rückgängig zu machen sein */
defineNativeAction<{ id: string }>('test.markNone', {
  undo: 'none',
  args: (raw) => parseArgs(raw, { id: A.id }),
  run(store, { id }) {
    store.updateMany({ [id]: { 'tasks.mark': 'none' } } as unknown as Parameters<typeof store.updateMany>[0]);
  },
});
/** Web-Code, der „ohne Rückgängig“ direkt mit doc.transact (Origin null) schreibt – wie timer.ts/voting.ts */
defineNativeAction<{ id: string }>('test.markNull', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id }),
  run(store, { id }) {
    store.doc.transact(() => store.objects.get(id)?.set('tasks.mark', 'null'));
  },
});
defineNativeAction<Record<string, never>>('test.count', {
  undo: 'none',
  args: (raw) => parseArgs(raw, {}),
  run: () => ({ data: ++countRuns }),
});
defineNativeAction<Record<string, never>>('test.fail', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, {}),
  run() {
    failRuns++;
    throw new Error('kaputt');
  },
});
/** legt mit festen IDs an (ctx.id), überspringt Vorhandenes */
defineNativeAction<{ n: number }>('test.make', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { n: A.int(1, 20) }),
  cost: ({ n }) => n * 30,
  run(store, { n }, ctx) {
    const ids = Array.from({ length: n }, (_, i) => ctx.id(i + 1));
    const fresh = ids.filter((id) => !ctx.exists(id));
    if (fresh.length) store.createMany(fresh.map((id, i) => ({ id, type: 'sticky', x: i * 220, y: 0, w: 200, h: 200, text: ctx.user.name })));
    return { select: ids, data: { now: ctx.now, v: ctx.v, measured: Math.round(ctx.measure('Hallo', 20)) } };
  },
});

let env: TestEnv;
let devEnv: TestEnv;
beforeAll(async () => {
  env = await startEnv({ nativeIdleMs: 300 });
  devEnv = await startEnv({ nativeIdleMs: 300, nativeDevActions: true });
});
afterAll(async () => {
  await env?.stop();
  await devEnv?.stop();
  for (const n of TEST_ACTIONS) removeNativeActionForTest(n);
});
const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

let memberId = 2500;
async function setup(e = env) {
  const kt = e.fake.addMember(++memberId, 'Mara');
  const browser = await loginMember(e, kt);
  const mara = await appSession(e.base, kt);
  const board = (await browser.post('/api/boards', { title: 'Aktionen' })).body.board as { id: string };
  const ws = e.base.replace('http', 'ws');
  const w = webClient(ws, board.id, { cookie: browser.cookieHeader() });
  cleanup.push(() => w.destroy());
  await w.synced();
  const a = new NativeClient(ws, mara.token);
  cleanup.push(() => a.close());
  const welcome = await a.hello(board.id);
  return { w, a, mara, welcome, board };
}

let reqNo = 100;
async function send(a: NativeClient, list: Record<string, unknown>[], req = ++reqNo): Promise<Msg> {
  const from = a.messages.length;
  a.send({ t: 'ops', req, ops: list });
  return a.next((m) => (m.t === 'ack' || m.t === 'nack') && m.req === req, 5000, from);
}

const sticky = (id: string, x: number, y = 0) => ({ id, type: 'sticky', x, y, w: 200, h: 200, text: id });

describe('Register und Sammel-Import', () => {
  it('web/src/native/actions.ts importiert jede native.ts/native-*.ts der Web-Module (Stubs der Pakete P1–P9)', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/^native(-[a-z]+)?\.ts$/.test(e.name) && !p.includes(`${path.sep}native${path.sep}`)) files.push(p);
      }
    };
    walk(path.join(WEB_SRC, 'features'));
    walk(path.join(WEB_SRC, 'board'));
    const imports = fs.readFileSync(path.join(WEB_SRC, 'native/actions.ts'), 'utf8');
    const expected = [
      'board/ops/native.ts',
      'features/tools/native.ts',
      'features/tools/native-view.ts',
      'features/tools/native-organize.ts',
      'features/structure/native.ts',
      'features/structure/table/native.ts',
      'features/structure/frames/native.ts',
      'features/structure/timeline/native.ts',
      'features/collab/native.ts',
      'features/documents/native.ts',
      'features/richtext/native.ts',
      'features/shapes/stack/native.ts', // Q2 Notiz-Stapel
    ];
    const rel = files.map((f) => path.relative(WEB_SRC, f).split(path.sep).join('/')).sort();
    expect(rel).toEqual([...expected].sort());
    for (const f of rel) expect(imports, f).toContain(`import '../${f.replace(/\.ts$/, '')}';`);
  });

  it('Namen und Versionen; Sandbox-Aktionen nur mit dev; doppelte/ungültige Namen sind ein Fehler', () => {
    const list = nativeActionList();
    expect(list['test.move']).toBe(2);
    expect(list['test.count']).toBe(1);
    expect(list['dev.note']).toBeUndefined();
    expect(nativeActionList({ dev: true })['dev.note']).toBe(1);
    for (const name of Object.keys(nativeActionList({ dev: true }))) expect(name).toMatch(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*){1,3}$/);
    expect(WEB.actionList(false)).toEqual(list);
    const def = { undo: 'undo' as const, args: () => ({ ok: true as const, args: {} }), run: () => {} };
    expect(() => defineNativeAction('test.move', def)).toThrow(/doppelt/);
    expect(() => defineNativeAction('Kaputt', def)).toThrow(/Name/);
    expect(() => defineNativeAction('nur', def)).toThrow(/Name/);
  });

  it('welcome.actions und /api/native/info nennen die Aktionen mit Version, features enthält act und extra', async () => {
    const { welcome } = await setup();
    expect(welcome.features).toEqual(expect.arrayContaining(['act', 'extra']));
    expect(welcome.actions['test.move']).toBe(2);
    expect(welcome.actions['dev.note']).toBeUndefined();
    const info = (await (await fetch(`${env.base}/api/native/info`)).json()) as { actions: Record<string, number> };
    expect(info.actions).toEqual(welcome.actions);
    const devInfo = (await (await fetch(`${devEnv.base}/api/native/info`)).json()) as { actions: Record<string, number> };
    expect(devInfo.actions['dev.note']).toBe(1);
  });
});

describe('Op act', () => {
  it('Ergebnis = dieselbe Web-Funktion direkt auf einem Browser-Store, sieht die Ops davor, ein Rückgängig-Schritt', async () => {
    const { a, w, mara } = await setup();
    const objects = [sticky('n1', 0), sticky('n2', 300, 40)];
    const ack = await send(a, [
      { op: 'create', objects },
      { op: 'act', name: 'test.move', args: { ids: ['n1', 'n2', 'fehlt'], dx: 37, dy: -12 }, v: 2 },
      { op: 'update', patches: { n2: { color: '#c9e14a' } } },
    ]);
    expect(ack.t).toBe('ack');
    expect(ack.results).toEqual({ '1': { select: ['n1', 'n2'], focus: ['n1', 'n2'] } });
    // Referenz: Browser-Store mit denselben Objekten, Web-Funktion direkt
    const ref = new BoardStore(new Y.Doc(), 'a:ref');
    ref.createMany(objects as NewObject[]);
    ref.updateMany(movePatches(['n1', 'n2'].map((id) => ref.get(id)!), 37, -12));
    await waitFor(() => w.objects.get('n2')?.get('color') === '#c9e14a');
    for (const id of ['n1', 'n2']) {
      expect({ x: w.objects.get(id)!.get('x'), y: w.objects.get(id)!.get('y') }).toEqual({ x: ref.get(id)!.x, y: ref.get(id)!.y });
      expect(w.objects.get(id)!.get('createdBy')).toBe(mara.user.key);
    }
    // patch(es) mit eigener Person vor dem ack, ack-rev = letzter Stand
    const patches = a.messages.filter((m) => m.t === 'patch');
    expect(patches.length).toBeGreaterThanOrEqual(2);
    expect(patches.every((p) => p.by === mara.user.key)).toBe(true);
    expect(ack.rev).toBe(patches.at(-1)!.rev);
    // ein Rückgängig-Schritt für die ganze Nachricht
    const from = a.messages.length;
    a.send({ t: 'undo', req: ++reqNo });
    await a.next((m) => m.t === 'ack' && m.req === reqNo, 5000, from);
    await waitFor(() => !w.objects.has('n1') && !w.objects.has('n2'));
  });

  it('Undo-Klasse none und Schreiben mit Origin null: Person im Patch, nicht rückgängig zu machen', async () => {
    const { a, w, mara } = await setup();
    await send(a, [{ op: 'create', objects: [sticky('m1', 0)] }]);
    a.send({ t: 'step' });
    const from = a.messages.length;
    const ack = await send(a, [{ op: 'act', name: 'test.markNone', args: { id: 'm1' } }]);
    expect(ack.results).toEqual({ '0': {} });
    await waitFor(() => w.objects.get('m1')?.get('tasks.mark') === 'none');
    const p1 = a.messages.slice(from).find((m) => m.t === 'patch')!;
    expect(p1.by).toBe(mara.user.key);
    const from2 = a.messages.length;
    await send(a, [{ op: 'act', name: 'test.markNull', args: { id: 'm1' } }]);
    await waitFor(() => w.objects.get('m1')?.get('tasks.mark') === 'null');
    expect(a.messages.slice(from2).find((m) => m.t === 'patch')!.by).toBe(mara.user.key);
    // Rückgängig nimmt nur das Anlegen (die Markierungen sind kein eigener Schritt)
    a.send({ t: 'undo', req: ++reqNo });
    await a.next((m) => m.t === 'ack' && m.req === reqNo);
    await waitFor(() => !w.objects.has('m1'));
    a.send({ t: 'undo', req: ++reqNo });
    expect((await a.next((m) => m.t === 'nack' && m.req === reqNo)).error).toBe('nothing');
  });

  it('feste IDs aus key, Wiederholung mit gleicher key führt nicht noch einmal aus, Wiederholung der req bringt results', async () => {
    const { a, w, mara } = await setup();
    const req = ++reqNo;
    const ack = await send(a, [{ op: 'act', name: 'test.make', args: { n: 3 }, key: 'k_abc' }], req);
    expect(ack.results['0'].select).toEqual(['k_abc-1', 'k_abc-2', 'k_abc-3']);
    expect(ack.results['0'].data.v).toBe(1);
    expect(Math.abs(Date.parse(ack.results['0'].data.now) - Date.now())).toBeLessThan(10_000);
    expect(ack.results['0'].data.measured).toBeGreaterThan(30);
    await waitFor(() => w.objects.has('k_abc-3'));
    expect(w.objects.get('k_abc-1')!.get('text')).toBe(mara.user.name);
    // gleiche req (Funkloch): gemerkte results
    const again = await send(a, [{ op: 'act', name: 'test.make', args: { n: 3 }, key: 'k_abc' }], req);
    expect(again.results).toEqual(ack.results);
    // neue req, gleiche key: nicht noch einmal ausgeführt
    const before = countRuns;
    const c1 = await send(a, [{ op: 'act', name: 'test.count', args: {}, key: 'k_cnt' }]);
    const c2 = await send(a, [{ op: 'act', name: 'test.count', args: {}, key: 'k_cnt' }]);
    expect(c1.results['0'].data).toBe(before + 1);
    expect(c2.results).toEqual(c1.results);
    expect(countRuns).toBe(before + 1);
    // ohne key: jedes Mal
    await send(a, [{ op: 'act', name: 'test.count', args: {} }, { op: 'act', name: 'test.count', args: {} }]);
    expect(countRuns).toBe(before + 3);
    // feste IDs: die Aktion legt Vorhandenes nicht noch einmal an (wie nach einem Server-Neustart ohne Gedächtnis)
    const keys = [...w.objects.keys()].filter((k) => k.startsWith('k_abc')).length;
    expect(keys).toBe(3);
  });

  it('Prüfung vor dem Schreiben: unbekannt/zu alte Version → unsupported, falsche args/key/Felder → invalid_input, mit index', async () => {
    const { a, w } = await setup();
    const n = (ops: Record<string, unknown>[]) => send(a, [{ op: 'create', objects: [sticky('v1', 0)] }, ...ops]);
    let r = await n([{ op: 'act', name: 'gibt.esNicht', args: {} }]);
    expect([r.t, r.error, r.index]).toEqual(['nack', 'unsupported', 1]);
    r = await n([{ op: 'act', name: 'test.move', args: { ids: ['v1'], dx: 1, dy: 1 }, v: 3 }]);
    expect([r.t, r.error, r.index]).toEqual(['nack', 'unsupported', 1]);
    r = await n([{ op: 'act', name: 'test.move', args: { ids: ['v1'], dx: 'viel', dy: 1 } }]);
    expect([r.t, r.error, r.index]).toEqual(['nack', 'invalid_input', 1]);
    expect(r.message).toContain('dx');
    r = await n([{ op: 'act', name: 'test.move', args: { ids: ['v1'], dx: 1, dy: 1, extra: 1 } }]);
    expect([r.error, r.index]).toEqual(['invalid_input', 1]);
    r = await n([{ op: 'act', name: 'test.move', args: { ids: ['v1'], dx: 1, dy: 1 }, key: 'mit leerzeichen' }]);
    expect(r.error).toBe('invalid_input');
    r = await n([{ op: 'act', name: 'test.move', args: { ids: ['v1'], dx: 1, dy: 1 }, wer: 'x' }]);
    expect(r.error).toBe('invalid_input');
    r = await n([{ op: 'act', name: 'Test.Move', args: {} }]);
    expect(r.error).toBe('invalid_input');
    r = await n([{ op: 'act', name: 'test.move', args: [1, 2] }]);
    expect(r.error).toBe('invalid_input');
    // Sandbox-Aktion ohne dev-Schalter gibt es nicht
    r = await n([{ op: 'act', name: 'dev.note', args: { x: 0, y: 0 } }]);
    expect(r.error).toBe('unsupported');
    // Kosten der Aktion zählen für die Grenze je Nachricht (20 × 30 > 500)
    r = await send(a, [{ op: 'act', name: 'test.make', args: { n: 20 } }]);
    expect([r.t, r.error]).toEqual(['nack', 'too_large']);
    // nichts geschrieben
    await send(a, [{ op: 'create', objects: [sticky('ok', 0)] }]);
    await waitFor(() => w.objects.has('ok'));
    expect(w.objects.has('v1')).toBe(false);
  });

  it('Fehler im Web-Code: results[i].error, die übrigen Ops gelten; Ziel fehlt → skipped', async () => {
    const { a, w } = await setup();
    const runs = failRuns;
    const ack = await send(a, [
      { op: 'create', objects: [sticky('f1', 0)] },
      { op: 'act', name: 'test.fail', args: {} },
      { op: 'act', name: 'test.move', args: { ids: ['weg'], dx: 1, dy: 1 }, v: 1 },
      { op: 'create', objects: [sticky('f2', 300)] },
    ]);
    expect(ack.t).toBe('ack');
    expect(failRuns).toBe(runs + 1);
    expect(ack.results['1']).toEqual({ error: 'failed', message: expect.any(String) });
    expect(ack.results['2']).toEqual({ skipped: true });
    await waitFor(() => w.objects.has('f1') && w.objects.has('f2'));
  });

  it('Sandbox-Aktion dev.note (nur mit STACHEL_NATIVE_DEV_ACTIONS): Haftnotiz mit fester ID, Auswahl/Kamera/Bearbeiten/Hinweis', async () => {
    const { a, w, welcome } = await setup(devEnv);
    expect(welcome.actions['dev.note']).toBe(1);
    const ack = await send(a, [{ op: 'act', name: 'dev.note', args: { x: 500, y: 300, text: 'Hallo' }, key: 'k_dev' }]);
    expect(ack.results).toEqual({ '0': { select: ['k_dev-1'], focus: ['k_dev-1'], edit: 'k_dev-1', toast: 'Notiz angelegt.' } });
    await waitFor(() => w.objects.has('k_dev-1'));
    const o = w.objects.get('k_dev-1')!.toJSON();
    expect(o).toMatchObject({ type: 'sticky', x: 400, y: 200, w: 200, h: 200, text: 'Hallo', color: '#fff27a' });
  });
});

describe('presence.extra', () => {
  it('setzt die Felder der Positivliste wie das Web (geprüft, Holen mit Server-Zeit), null entfernt, Unbekanntes bleibt weg', async () => {
    const { a, w, mara } = await setup();
    const state = () => [...w.provider.awareness!.getStates().values()].find((s) => (s.user as { key?: string } | undefined)?.key === mara.user.key);
    a.send({
      t: 'presence',
      extra: {
        'collab.status': 'idle',
        'collab.follow': 'm:7',
        'collab.summon': { id: 'abc12345', rect: { x: 1, y: 2, w: 300, h: 200 }, ts: 1 },
        'collab.laser': { s: 4, p: [1, 2, 3, 4] },
        'collab.chat': { text: 'Hallo', typing: true },
        'structure.present': { frameId: 'f_1', index: 0, total: 3, title: 'Start' },
        'collab.viewport': { x: 0, y: 0, w: 1, h: 1 },
        'fremd.feld': 1,
      },
    });
    await waitFor(() => state()?.['collab.status'] === 'idle');
    const s = state()!;
    expect(s['collab.follow']).toBe('m:7');
    expect(s['collab.summon']).toMatchObject({ id: 'abc12345', rect: { x: 1, y: 2, w: 300, h: 200 } });
    expect(Math.abs((s['collab.summon'] as { ts: number }).ts - Date.now())).toBeLessThan(10_000);
    expect(s['collab.laser']).toEqual({ s: 4, p: [1, 2, 3, 4] });
    expect(s['collab.chat']).toEqual({ text: 'Hallo', typing: true });
    expect(s['structure.present']).toEqual({ frameId: 'f_1', index: 0, total: 3, title: 'Start' });
    expect('collab.viewport' in s).toBe(false);
    expect('fremd.feld' in s).toBe(false);
    // Teil-Aktualisierung: ungültig wird ignoriert (alter Wert bleibt), null entfernt, Rest bleibt
    a.send({ t: 'presence', extra: { 'collab.status': 'schläft', 'collab.chat': null, 'collab.laser': { s: 1, p: [1] } } });
    await waitFor(() => state() !== undefined && !('collab.chat' in state()!));
    expect(state()!['collab.status']).toBe('idle');
    expect(state()!['collab.laser']).toEqual({ s: 4, p: [1, 2, 3, 4] });
    expect(state()!['collab.follow']).toBe('m:7');
  });
});
