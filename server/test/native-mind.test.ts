// Mindmaps aus der Org-App (docs/contract.md §8.6 `mind`): die Op führt den Mindmap-Code des Web aus
// (web/src/features/structure/mindmap/ops.ts samt Layout) – das Ergebnis im Dokument muss genau dem entsprechen, was
// dieselbe Web-Funktion lokal auf einem Y.Doc schreibt (Referenz unten). Dazu: allgemeine Ops auf Knoten folgen den
// Regeln der Web-Laufzeit (Löschen mit Unterthemen, Wurzel verschieben nimmt die Mindmap mit, Duplikat wird angeordnet),
// IDs der App (Wiederholung ohne Doppeltes), Rückgängig, Prüfung, Textmaße wie im Chromium.
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import '#stachel-web'; // setzt die Textmessung des Web-Codes auf die Schriftmaße (wie im Server)
import { BoardStore, type NewObject } from '../../web/src/board/store';
import type { BoardObject } from '../../web/src/protocol';
import * as ops from '../../web/src/features/structure/mindmap/ops';
import { mindSize } from '../../web/src/features/structure/mindmap/style';
import { metricsMeasure } from '../src/native/text-metrics.js';
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

let memberId = 1500;
async function setup() {
  const kt = env.fake.addMember(++memberId, 'Mara');
  const browser = await loginMember(env, kt);
  const { token } = await appSession(env.base, kt);
  const board = (await browser.post('/api/boards', { title: 'Mindmap' })).body.board as { id: string };
  const w = webClient(ws, board.id, { cookie: browser.cookieHeader() });
  cleanup.push(() => w.destroy());
  await w.synced();
  const a = new NativeClient(ws, token);
  cleanup.push(() => a.close());
  await a.hello(board.id);
  return { w, a };
}

let reqNo = 9000;
async function send(a: NativeClient, list: Record<string, unknown>[]) {
  const req = ++reqNo;
  const from = a.messages.length;
  a.send({ t: 'ops', req, ops: list });
  return a.next((m) => (m.t === 'ack' || m.t === 'nack') && m.req === req, 5000, from);
}

// ---- Referenz: Web-Code lokal ------------------------------------------------------------------------------------------

/** Lokaler Web-Store mit diesen Objekten (wie ein Browser, der das Board offen hat). */
function refStore(objects: BoardObject[]): BoardStore {
  const store = new BoardStore(new Y.Doc(), 'a:ref');
  if (objects.length) store.createMany(objects.map(({ createdBy: _c, updatedAt: _u, ...o }) => o as NewObject));
  return store;
}

/** Felder, die das Mindmap-Layout bestimmt, je Knoten (ohne z/createdBy/updatedAt). */
function mindState(objects: Y.Map<Y.Map<unknown>> | BoardStore): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  const add = (id: string, o: Record<string, unknown>) => {
    if (o.type !== 'mindnode') return;
    out[id] = { x: o.x, y: o.y, w: o.w, h: o.h, text: o.text ?? '', color: o.color, mind: o.mind };
  };
  if (objects instanceof BoardStore) for (const o of objects.getSnapshot().ordered) add(o.id, o as unknown as Record<string, unknown>);
  else objects.forEach((m, id) => add(id, m.toJSON()));
  return out;
}

/** Eine kleine Mindmap wie im Web angelegt: Festival → Programm (Bands, Workshops), Orga, links Technik. */
function sampleMap(): BoardObject[] {
  const store = refStore([]);
  const root = ops.newRoot({ x: 400, y: 300 }, 'Sommerfest', 'root');
  ops.commitMind(store, { add: [root] });
  const get = (id: string) => store.get(id)!;
  ops.addChild(store, get('root'), 'r', 'prog');
  ops.commitMind(store, { patch: { prog: { text: 'Programm' } } });
  ops.addSibling(store, get('prog'), 'orga');
  ops.commitMind(store, { patch: { orga: { text: 'Orga' } } });
  ops.addChild(store, get('prog'), undefined, 'bands');
  ops.commitMind(store, { patch: { bands: { text: 'Bands und Musik' } } });
  ops.addSibling(store, get('bands'), 'work');
  ops.commitMind(store, { patch: { work: { text: 'Workshops' } } });
  ops.addChild(store, get('root'), 'l', 'tech');
  ops.commitMind(store, { patch: { tech: { text: 'Technik' } } });
  return store.getSnapshot().ordered.map((o) => ({ ...o }));
}

async function seed(w: ReturnType<typeof webClient>, objects: BoardObject[]) {
  w.doc.transact(() => {
    for (const o of objects) {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(o)) if (v !== undefined) m.set(k, v);
      w.objects.set(o.id, m);
    }
  });
  await w.flushed();
}

/** Server-Stand (über den Web-Client) gleich der Referenz, sobald die Änderung angekommen ist. */
async function expectSame(w: ReturnType<typeof webClient>, ref: BoardStore) {
  const want = mindState(ref);
  await waitFor(() => JSON.stringify(Object.keys(mindState(w.objects)).sort()) === JSON.stringify(Object.keys(want).sort()));
  await waitFor(() => JSON.stringify(sortKeys(mindState(w.objects))) === JSON.stringify(sortKeys(want)), 3000).catch(() => {});
  expect(sortKeys(mindState(w.objects))).toEqual(sortKeys(want));
}

const sortKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sortKeys(x)])) : v;

// ---- Tests ----------------------------------------------------------------------------------------------------------

describe('Textmaße wie im Chromium', () => {
  it('Breiten mit Unterschneidung und Ligaturen (gemessen per Canvas in Chromium 2026-11)', () => {
    const s = 'AVATAR Tower fiflo Wählt Größe';
    expect(metricsMeasure(s, 28, 700, false, '"Barlow Condensed"')).toBeCloseTo(314.3837, 2);
    expect(metricsMeasure(s, 18, 600, false, 'Barlow')).toBeCloseTo(250.1458, 2);
    expect(metricsMeasure(s, 16, 500, false, 'Barlow')).toBeCloseTo(220.0798, 2);
    // Größe eines Knotens = Web-Formel mit diesen Breiten
    expect(mindSize('Sommerfest', 0)).toEqual(mindSize('Sommerfest', 0, (t) => metricsMeasure(t, 28, 700, false, 'Barlow Condensed') + 0.01 * 28 * t.length));
  });
});

describe('Mindmap-Op wie der Web-Code', () => {
  it('Unterthema rechts/links an der Wurzel, an einem Hauptthema, auf gleicher Ebene – gleich der Web-Funktion', async () => {
    const { w, a } = await setup();
    const start = sampleMap();
    await seed(w, start);
    const ref = refStore(start);
    const get = (id: string) => ref.get(id)!;

    expect((await send(a, [{ op: 'mind', do: 'child', id: 'root', new: 'n1' }])).t).toBe('ack');
    ops.addChild(ref, get('root'), undefined, 'n1');
    await expectSame(w, ref);

    await send(a, [{ op: 'mind', do: 'child', id: 'root', new: 'n2', side: 'l' }]);
    ops.addChild(ref, get('root'), 'l', 'n2');
    await expectSame(w, ref);

    await send(a, [{ op: 'mind', do: 'child', id: 'orga', new: 'n3' }]);
    ops.addChild(ref, get('orga'), undefined, 'n3');
    await expectSame(w, ref);

    await send(a, [{ op: 'mind', do: 'sibling', id: 'bands', new: 'n4' }]);
    ops.addSibling(ref, get('bands'), 'n4');
    await expectSame(w, ref);
    // Farbe: Hauptthemen der Reihe nach, Unterthemen erben
    const s = mindState(w.objects);
    expect(s.n1!.color).not.toBe(s.prog!.color);
    expect(s.n3!.color).toBe(s.orga!.color);
    expect((s.n2!.mind as { side: string }).side).toBe('l');

    // Geschwister an der Wurzel gibt es nicht: nichts passiert
    await send(a, [{ op: 'mind', do: 'sibling', id: 'root', new: 'n5' }]);
    await expectSame(w, ref);
  });

  it('Text ändern ordnet neu an (Größe aus dem Text, Nachbarn rücken), Einklappen versteckt den Zweig, Ausklappen zeigt ihn', async () => {
    const { w, a } = await setup();
    const start = sampleMap();
    await seed(w, start);
    const ref = refStore(start);
    const get = (id: string) => ref.get(id)!;

    const long = 'Bands, Musik und alles, was auf der großen Bühne passiert – mit Zeilenumbruch';
    await send(a, [{ op: 'mind', do: 'text', id: 'bands', text: long }]);
    ops.commitMind(ref, { patch: { bands: { text: long } } });
    await expectSame(w, ref);
    expect(mindState(w.objects).bands!.h).toBeGreaterThan(40);

    await send(a, [{ op: 'mind', do: 'collapse', id: 'prog', collapsed: true }]);
    ops.toggleCollapse(ref, get('prog'));
    await expectSame(w, ref);
    expect((mindState(w.objects).bands!.mind as { hidden?: boolean }).hidden).toBe(true);
    // Wiederholung (Zielzustand): bleibt eingeklappt
    await send(a, [{ op: 'mind', do: 'collapse', id: 'prog', collapsed: true }]);
    await expectSame(w, ref);

    await send(a, [{ op: 'mind', do: 'collapse', id: 'prog', collapsed: false }]);
    ops.toggleCollapse(ref, get('prog'));
    await expectSame(w, ref);
    expect((mindState(w.objects).bands!.mind as { hidden?: boolean }).hidden).toBeUndefined();

    // Unterthema an einem eingeklappten Zweig klappt ihn auf (wie im Web)
    await send(a, [{ op: 'mind', do: 'collapse', id: 'prog', collapsed: true }]);
    ops.toggleCollapse(ref, get('prog'));
    await send(a, [{ op: 'mind', do: 'child', id: 'prog', new: 'k1' }]);
    ops.addChild(ref, get('prog'), undefined, 'k1');
    await expectSame(w, ref);
  });

  it('Löschen nimmt die Unterthemen mit und ordnet den Rest neu an – auch über die allgemeine remove-Op', async () => {
    const { w, a } = await setup();
    const start = sampleMap();
    await seed(w, start);
    const ref = refStore(start);

    await send(a, [{ op: 'mind', do: 'remove', ids: ['prog'] }]);
    ops.commitMind(ref, { remove: ops.withDescendants(ref.getSnapshot(), ['prog']) });
    await expectSame(w, ref);
    expect(Object.keys(mindState(w.objects)).sort()).toEqual(['orga', 'root', 'tech']);

    // ältere App: allgemeines remove → gleiche Regel
    await send(a, [{ op: 'remove', ids: ['root'] }]);
    await waitFor(() => Object.keys(mindState(w.objects)).length === 0);
  });

  it('Ziehen: auf einem anderen Knoten loslassen hängt um (Farbe des neuen Zweigs), sonst Einsortieren nach der Höhe bzw. Seitenwechsel', async () => {
    const { w, a } = await setup();
    const start = sampleMap();
    await seed(w, start);
    const ref = refStore(start);
    const get = (id: string) => ref.get(id)!;

    // Bands auf Orga ziehen: Lage per update, am Ende der Geste `drop` (eine Nachricht = ein Schritt)
    const orga = get('orga');
    const at = { x: orga.x + 10, y: orga.y + 2 };
    await send(a, [{ op: 'update', patches: { bands: at } }, { op: 'mind', do: 'drop', ids: ['bands'] }]);
    ref.updateMany({ bands: at });
    ops.dropNodes(ref, ['bands']);
    await expectSame(w, ref);
    expect((mindState(w.objects).bands!.mind as { parent: string }).parent).toBe('orga');
    expect(mindState(w.objects).bands!.color).toBe(mindState(w.objects).orga!.color);

    // Programm über Technik (links) ziehen, ohne Ziel: wechselt die Seite der Wurzel
    const root = get('root');
    const left = { x: root.x - 300, y: root.y - 200 };
    await send(a, [{ op: 'update', patches: { prog: left } }, { op: 'mind', do: 'drop', ids: ['prog'] }]);
    ref.updateMany({ prog: left });
    ops.dropNodes(ref, ['prog']);
    await expectSame(w, ref);
    expect((mindState(w.objects).prog!.mind as { side: string }).side).toBe('l');
  });

  it('Wurzel verschieben (allgemeines update) nimmt die ganze Mindmap mit; Größe ändern wird vom Layout zurückgesetzt', async () => {
    const { w, a } = await setup();
    const start = sampleMap();
    await seed(w, start);
    const ref = refStore(start);
    const before = mindState(w.objects);

    await send(a, [{ op: 'update', patches: { root: { x: before.root!.x as number + 200, y: before.root!.y as number + 50 } } }]);
    ref.updateMany({ root: { x: (before.root!.x as number) + 200, y: (before.root!.y as number) + 50 } });
    ops.commitMind(ref, { patch: { root: {} } });
    await expectSame(w, ref);
    expect(mindState(w.objects).bands!.x).toBe((before.bands!.x as number) + 200);

    // Unterthema verschieben ohne drop: bleibt, wo es ist (erst das Loslassen ordnet ein)
    await send(a, [{ op: 'update', patches: { work: { x: 0, y: 0 } } }]);
    await waitFor(() => mindState(w.objects).work!.x === 0);
    // Größe (ältere App mit Griffen): Layout setzt sie zurück
    await send(a, [{ op: 'update', patches: { orga: { w: 500 } } }]);
    ref.updateMany({ work: { x: 0, y: 0 }, orga: { w: 500 } });
    ops.commitMind(ref, { patch: { orga: {} } });
    await expectSame(w, ref);
    expect(mindState(w.objects).orga!.w).not.toBe(500);
  });

  it('neue Mindmap (root), Vorlage (tree), Duplikat per create – angeordnet wie im Web; mehrere Ops in einer Nachricht sehen einander', async () => {
    const { w, a } = await setup();
    const ref = refStore([]);
    await send(a, [
      { op: 'mind', do: 'root', new: 'r1', x: 0, y: 0, text: '' },
      { op: 'mind', do: 'child', id: 'r1', new: 'r1a' },
      { op: 'mind', do: 'text', id: 'r1a', text: 'Erstes Thema' },
    ]);
    ops.commitMind(ref, { add: [ops.newRoot({ x: 0, y: 0 }, '', 'r1')] });
    ops.addChild(ref, ref.get('r1')!, undefined, 'r1a');
    ops.commitMind(ref, { patch: { r1a: { text: 'Erstes Thema' } } });
    await expectSame(w, ref);

    const tree = { text: 'Festival', children: [{ text: 'Programm', children: [{ text: 'Bands' }] }, { text: 'Technik', side: 'l', children: [{ text: 'Strom' }] }] };
    await send(a, [{ op: 'mind', do: 'tree', new: 't', x: 1000, y: 500, tree }]);
    await waitFor(() => Object.keys(mindState(w.objects)).filter((k) => k.startsWith('t')).length === 5);
    const s = mindState(w.objects);
    expect(Object.keys(s).filter((k) => k.startsWith('t')).sort()).toEqual(['t', 't-1', 't-2', 't-3', 't-4']);
    expect(Math.abs((s.t!.x as number) + (s.t!.w as number) / 2 - 1000)).toBeLessThanOrEqual(1);
    expect(Math.abs((s.t!.y as number) + (s.t!.h as number) / 2 - 500)).toBeLessThanOrEqual(1);
    expect((s['t-3']!.mind as { side: string }).side).toBe('l');
    // so angeordnet, dass das Web nichts nachzuziehen hätte
    const tRef = refStore(Object.entries(s).filter(([k]) => k.startsWith('t')).map(([id, o]) => ({ id, type: 'mindnode', z: '', createdBy: '', updatedAt: '', ...o }) as BoardObject));
    expect(ops.layoutPatches(ops.mindNodes(tRef.getSnapshot()))).toEqual({});

    // Duplikat eines Unterthemas ohne Eltern (wie remap im Web: wird Wurzel) per create → angeordnet
    const dup = { id: 'd1', type: 'mindnode', x: 50, y: 900, w: 10, h: 10, text: 'Kopie', color: '#1763b5', mind: { level: 0 } };
    await send(a, [{ op: 'create', objects: [dup] }]);
    ops.commitMind(ref, { add: [dup as NewObject] });
    await waitFor(() => mindState(w.objects).d1 !== undefined);
    expect(sortKeys(mindState(w.objects).d1)).toEqual(sortKeys(mindState(ref).d1));
  });

  it('IDs der App: Wiederholung (auch mit neuer req) legt nichts doppelt an; Rückgängig nimmt den Schritt samt Layout zurück', async () => {
    const { w, a } = await setup();
    const start = sampleMap();
    await seed(w, start);
    const before = mindState(w.objects);
    await send(a, [{ op: 'mind', do: 'child', id: 'root', new: 'x1' }]);
    await send(a, [{ op: 'mind', do: 'child', id: 'root', new: 'x1' }]);
    await send(a, [{ op: 'mind', do: 'tree', new: 'root', x: 0, y: 0, tree: { text: 'nein' } }]);
    await waitFor(() => mindState(w.objects).x1 !== undefined);
    expect(Object.keys(mindState(w.objects)).length).toBe(Object.keys(before).length + 1);
    a.send({ t: 'step' });
    const from = a.messages.length;
    a.send({ t: 'undo', req: ++reqNo });
    await a.next((m) => m.t === 'ack' && m.req === reqNo, 5000, from);
    await waitFor(() => mindState(w.objects).x1 === undefined);
    expect(sortKeys(mindState(w.objects))).toEqual(sortKeys(before));
  });

  it('prüft die Op vorher (nichts halb geschrieben)', async () => {
    const { a } = await setup();
    const bad = async (op: Record<string, unknown>, error = 'invalid_input') => {
      const r = await send(a, [{ op: 'mind', do: 'root', new: 'ok', x: 0, y: 0, text: '' }, op]);
      expect(r.t).toBe('nack');
      expect(r.error).toBe(error);
      expect(r.index).toBe(1);
    };
    await bad({ op: 'mind', do: 'fly', id: 'a' });
    await bad({ op: 'mind', do: 'child', id: 'a' });
    await bad({ op: 'mind', do: 'child', id: 'a', new: 'b', side: 'x' });
    await bad({ op: 'mind', do: 'text', id: 'a', text: 5 });
    await bad({ op: 'mind', do: 'collapse', id: 'a' });
    await bad({ op: 'mind', do: 'remove', ids: [] });
    await bad({ op: 'mind', do: 'root', new: 'b', x: 'links', y: 0, text: '' });
    await bad({ op: 'mind', do: 'tree', new: 'b', x: 0, y: 0, tree: { text: 'a', children: [{}] } });
    let deep: Record<string, unknown> = { text: 'x' };
    for (let i = 0; i < 12; i++) deep = { text: 'x', children: [deep] };
    await bad({ op: 'mind', do: 'tree', new: 'b', x: 0, y: 0, tree: deep });
    await bad({ op: 'mind', do: 'child', id: 'a', new: 'b', extra: 1 });
  });
});
