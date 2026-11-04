// Web-Aktionen der Zeitleiste für die App (docs/contract.md §8.12, Paket P9): timeline.addItem, patchItem, setDay,
// removeItem, setTitle, addLane, setLaneName, moveLane, removeLane, setRange, setUnit, adopt. Ergebnis = dieselbe
// Web-Funktion (timeline/yjs.ts, model.ts) direkt auf einem Browser-Store (Größe folgt dem Layout bei gleichem Maßstab);
// Titel und Spurnamen live (Y.Text, gleichzeitiges Tippen zusammengeführt); ein Rückgängig-Schritt je Aktion.
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import '#stachel-web';
import { BoardStore, type NewObject } from '../../web/src/board/store';
import { newTimeline } from '../../web/src/features/structure/timeline/create';
import { droppedItem, extendRange, layoutFor, parseDay, toggleMsPatch, type TimelineData } from '../../web/src/features/structure/timeline/model';
import { addItem, addLane, moveLane, patchItem, removeLane, setRange, setTitle, setUnit } from '../../web/src/features/structure/timeline/yjs';
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
  const board = (await browser.post('/api/boards', { title: 'Zeitleisten' })).body.board as { id: string };
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

const START = parseDay('2026-11-02')!; // Montag
/** Zeitleiste mit festem Zeitraum (8 Wochen ab 2.11.2026) und Spuren l1–l3 */
function timeline(id: string, data?: Partial<TimelineData>, unit?: 'day' | 'week' | 'month') {
  const d: TimelineData = { lanes: ['l1', 'l2', 'l3'], names: { l1: 'Aufbau', l2: 'Programm', l3: 'Abbau' }, items: {}, ...data };
  return { id, ...newTimeline({ x: 600, y: 300 }, { data: d, start: START, end: START + 55, unit }) };
}

/** Browser-Store mit denselben Objekten (Referenz) */
function ref(...os: Record<string, unknown>[]) {
  const s = new BoardStore(new Y.Doc(), 'a:ref');
  s.createMany(os as unknown as NewObject[]);
  return s;
}
const live = (w: ReturnType<typeof webClient>, id: string) => w.objects.get(id)?.toJSON() as Record<string, any> | undefined;
/** Vergleichbares: Größe, Zeitraum, Skala, Daten (Lesekopie) */
const geom = (o: Record<string, any>) => ({ x: o.x, w: o.w, h: o.h, tlStart: o.tlStart, tlEnd: o.tlEnd, tlUnit: o.tlUnit, timeline: o.timeline });
const act = (name: string, args: Record<string, unknown>, key?: string) => ({ op: 'act', name, args, ...(key ? { key } : {}) });

describe('Zeitleisten-Aktionen (P9)', () => {
  it('stehen in welcome.actions', async () => {
    const { welcome } = await setup();
    for (const n of ['addItem', 'patchItem', 'setDay', 'removeItem', 'setTitle', 'addLane', 'setLaneName', 'moveLane', 'removeLane', 'setRange', 'setUnit', 'adopt']) {
      expect(welcome.actions[`timeline.${n}`]).toBe(1);
    }
  });

  it('Einträge: anlegen (key-1), ziehen, Spur, Farbe, Meilenstein, Datum, löschen – Größe wie im Browser', async () => {
    const { a, w } = await setup();
    const t = timeline('tl1');
    await send(a, [{ op: 'create', objects: [t] }]);
    a.send({ t: 'step' });
    await waitFor(() => !!live(w, 'tl1'));
    const s = ref(t);
    let ack = await send(a, [act('timeline.addItem', { id: 'tl1', lane: 'l2', start: '2026-11-04', end: '2026-11-10', title: 'Bühne' }, 'ka')]);
    expect(ack.results['0']).toEqual({ data: { key: 'ka-1' } });
    addItem(s, 'tl1', { lane: 'l2', start: '2026-11-04', end: '2026-11-10', title: 'Bühne' }, 'ka-1');
    await waitFor(() => !!live(w, 'tl1')!.timeline.items['ka-1']);
    expect(geom(live(w, 'tl1')!)).toEqual(geom(s.get('tl1')!));
    // gleiche key nicht doppelt (der Server kennt das Ergebnis schon)
    ack = await send(a, [act('timeline.addItem', { id: 'tl1', lane: 'l2', start: '2026-11-04', end: '2026-11-10' }, 'ka')]);
    expect(ack.results['0']).toEqual({ data: { key: 'ka-1' } });
    expect(Object.keys(live(w, 'tl1')!.timeline.items)).toEqual(['ka-1']);
    // überlappender Eintrag in derselben Spur: zweite Zeile, die Zeitleiste wird höher
    const h0 = live(w, 'tl1')!.h;
    await send(a, [act('timeline.addItem', { id: 'tl1', lane: 'l2', start: '2026-11-06', end: '2026-11-08', color: '#ec4e92' }, 'kb')]);
    addItem(s, 'tl1', { lane: 'l2', start: '2026-11-06', end: '2026-11-08', title: '', color: '#ec4e92' }, 'kb-1');
    await waitFor(() => !!live(w, 'tl1')!.timeline.items['kb-1']);
    expect(live(w, 'tl1')!.h).toBeGreaterThan(h0);
    expect(geom(live(w, 'tl1')!)).toEqual(geom(s.get('tl1')!));
    // ziehen: Tage und Spur; Farbe zurück auf Standard (null)
    await send(a, [act('timeline.patchItem', { id: 'tl1', key: 'kb-1', start: '2026-11-16', end: '2026-11-18', lane: 'l3', color: null })]);
    patchItem(s, 'tl1', 'kb-1', { start: '2026-11-16', end: '2026-11-18', lane: 'l3', color: undefined });
    await waitFor(() => live(w, 'tl1')!.timeline.items['kb-1'].lane === 'l3');
    expect(geom(live(w, 'tl1')!)).toEqual(geom(s.get('tl1')!));
    expect(live(w, 'tl1')!.timeline.items['kb-1'].color).toBeUndefined();
    // Meilenstein und zurück (Balken bekommt die Standardlänge der Skala)
    await send(a, [act('timeline.patchItem', { id: 'tl1', key: 'ka-1', ms: true })]);
    const it = () => s.get('tl1')!.timeline!.items['ka-1']!;
    patchItem(s, 'tl1', 'ka-1', toggleMsPatch(it(), 'week'));
    await waitFor(() => live(w, 'tl1')!.timeline.items['ka-1'].ms === true);
    expect(geom(live(w, 'tl1')!)).toEqual(geom(s.get('tl1')!));
    await send(a, [act('timeline.patchItem', { id: 'tl1', key: 'ka-1', ms: false })]);
    patchItem(s, 'tl1', 'ka-1', toggleMsPatch(it(), 'week'));
    await waitFor(() => !live(w, 'tl1')!.timeline.items['ka-1'].ms);
    expect(geom(live(w, 'tl1')!)).toEqual(geom(s.get('tl1')!));
    expect(live(w, 'tl1')!.timeline.items['ka-1'].end).toBe('2026-11-10');
    // Dialog: Beginn nach dem Ende → Länge bleibt; Ende vor dem Beginn → bleibt am Beginn
    await send(a, [act('timeline.setDay', { id: 'tl1', key: 'ka-1', which: 'start', day: '2026-11-20' })]);
    await waitFor(() => live(w, 'tl1')!.timeline.items['ka-1'].start === '2026-11-20');
    expect(live(w, 'tl1')!.timeline.items['ka-1'].end).toBe('2026-11-26');
    await send(a, [act('timeline.setDay', { id: 'tl1', key: 'ka-1', which: 'end', day: '2026-11-01' })]);
    await waitFor(() => live(w, 'tl1')!.timeline.items['ka-1'].end === '2026-11-20');
    // Rückgängig: je Aktion ein Schritt
    await undo(a);
    await waitFor(() => live(w, 'tl1')!.timeline.items['ka-1'].end === '2026-11-26');
    await send(a, [act('timeline.removeItem', { id: 'tl1', key: 'kb-1' })]);
    await waitFor(() => !live(w, 'tl1')!.timeline.items['kb-1']);
    await undo(a);
    await waitFor(() => !!live(w, 'tl1')!.timeline.items['kb-1']);
    // unbekannter Eintrag, kaputte Tage
    ack = await send(a, [act('timeline.removeItem', { id: 'tl1', key: 'weg' })]);
    expect(ack.results['0']).toEqual({ skipped: true });
    ack = await send(a, [act('timeline.addItem', { id: 'tl1', lane: 'l1', start: '2026-02-31', end: '2026-03-01' })]);
    expect(ack.t).toBe('nack');
  });

  it('timeline.setTitle: Y.Text, gleichzeitiges Tippen im Web bleibt, Meilenstein-Titel ändert das Packen wie im Browser', async () => {
    const { a, w } = await setup();
    const t = timeline('tl2', { items: { m1: { lane: 'l1', start: '2026-11-03', end: '2026-11-03', title: 'Ein', ms: true }, b1: { lane: 'l1', start: '2026-11-05', end: '2026-11-07', title: '' } } });
    await send(a, [{ op: 'create', objects: [t] }]);
    a.send({ t: 'step' });
    await waitFor(() => !!live(w, 'tl2'));
    const s = ref(t);
    const title = 'Einlass und Bändchen-Ausgabe am Haupttor';
    let ack = await send(a, [act('timeline.setTitle', { id: 'tl2', key: 'm1', base: 'Ein', text: title })]);
    expect(ack.results['0']).toEqual({ data: { conflict: false } });
    setTitle(s, 'tl2', 'm1', title);
    await waitFor(() => live(w, 'tl2')!.timeline.items.m1.title === title);
    // der lange Meilenstein-Titel schiebt den Balken in eine zweite Zeile
    expect(geom(live(w, 'tl2')!)).toEqual(geom(s.get('tl2')!));
    expect(layoutFor(s.get('tl2')!).lanes[0]!.rows).toBe(2);
    const items = (w.objects.get('tl2')!.get('timeline') as Y.Map<unknown>).get('items') as Y.Map<Y.Map<unknown>>;
    const yt = items.get('m1')!.get('title') as Y.Text;
    expect(yt).toBeInstanceOf(Y.Text);
    yt.insert(0, 'Fr: ');
    await w.flushed();
    a.send({ t: 'step' });
    await send(a, [act('timeline.setTitle', { id: 'tl2', key: 'm1', base: title, text: `${title}!` })]);
    await waitFor(() => live(w, 'tl2')!.timeline.items.m1.title === `Fr: ${title}!`);
    await undo(a);
    await waitFor(() => live(w, 'tl2')!.timeline.items.m1.title === `Fr: ${title}`);
    ack = await send(a, [act('timeline.setTitle', { id: 'tl2', key: 'weg', text: 'x' })]);
    expect(ack.results['0']).toEqual({ skipped: true });
  });

  it('Spuren: hinzufügen (darunter, key-1), umbenennen live, verschieben, löschen samt Einträgen, letzte bleibt, höchstens 40', async () => {
    const { a, w } = await setup();
    const t = timeline('tl3', { items: { e1: { lane: 'l2', start: '2026-11-03', end: '2026-11-05', title: 'Probe' } } });
    await send(a, [{ op: 'create', objects: [t] }]);
    a.send({ t: 'step' });
    await waitFor(() => !!live(w, 'tl3'));
    const s = ref(t);
    let ack = await send(a, [act('timeline.addLane', { id: 'tl3', after: 'l1' }, 'kl')]);
    expect(ack.results['0']).toEqual({ data: { lane: 'kl-1' } });
    addLane(s, 'tl3', 'l1', '', 'kl-1');
    await waitFor(() => live(w, 'tl3')!.timeline.lanes.length === 4);
    expect(live(w, 'tl3')!.timeline.lanes).toEqual(['l1', 'kl-1', 'l2', 'l3']);
    expect(geom(live(w, 'tl3')!)).toEqual(geom(s.get('tl3')!));
    ack = await send(a, [act('timeline.setLaneName', { id: 'tl3', lane: 'kl-1', base: '', text: 'Technik' })]);
    expect(ack.results['0']).toEqual({ data: { conflict: false } });
    await waitFor(() => live(w, 'tl3')!.timeline.names['kl-1'] === 'Technik');
    const names = (w.objects.get('tl3')!.get('timeline') as Y.Map<unknown>).get('names') as Y.Map<unknown>;
    expect(names.get('kl-1')).toBeInstanceOf(Y.Text);
    await send(a, [act('timeline.moveLane', { id: 'tl3', lane: 'l3', to: 0 })]);
    moveLane(s, 'tl3', 'l3', 0);
    await waitFor(() => live(w, 'tl3')!.timeline.lanes[0] === 'l3');
    expect(geom(live(w, 'tl3')!).timeline.lanes).toEqual(s.get('tl3')!.timeline!.lanes);
    ack = await send(a, [act('timeline.moveLane', { id: 'tl3', lane: 'l3', to: 0 })]);
    expect(ack.results['0']).toEqual({ skipped: true });
    await send(a, [act('timeline.removeLane', { id: 'tl3', lane: 'l2' })]);
    removeLane(s, 'tl3', 'l2');
    await waitFor(() => live(w, 'tl3')!.timeline.lanes.length === 3);
    expect(live(w, 'tl3')!.timeline.items.e1).toBeUndefined();
    await undo(a);
    await waitFor(() => !!live(w, 'tl3')!.timeline.items.e1);
    // die letzte Spur bleibt; 40 Spuren: Hinweis
    const one = timeline('tl4', { lanes: ['x'], names: { x: '' } });
    const many = timeline('tl5', { lanes: Array.from({ length: 40 }, (_, i) => `m${i}`), names: {} });
    await send(a, [{ op: 'create', objects: [one, many] }]);
    ack = await send(a, [act('timeline.removeLane', { id: 'tl4', lane: 'x' }), act('timeline.addLane', { id: 'tl5' })]);
    expect(ack.results['0']).toEqual({ skipped: true });
    expect(ack.results['1']).toMatchObject({ toast: 'Mehr Spuren gehen nicht.', data: { lane: null } });
  });

  it('Zeitraum („‹ n“/„n ›“, Tage) und Zeitskala wie im Browser; gesperrt → nichts; Prüfung', async () => {
    const { a, w } = await setup();
    const t = timeline('tl6', {
      items: {
        v: { lane: 'l1', start: '2026-10-12', end: '2026-10-14', title: 'Vorab' },
        n: { lane: 'l2', start: '2027-01-20', end: '2027-01-22', title: 'Danach' },
      },
    });
    await send(a, [{ op: 'create', objects: [t] }]);
    a.send({ t: 'step' });
    await waitFor(() => !!live(w, 'tl6'));
    const s = ref(t);
    await send(a, [act('timeline.setRange', { id: 'tl6', extend: 'before' })]);
    setRange(s, 'tl6', extendRange(s.get('tl6')!, 'before'));
    await waitFor(() => live(w, 'tl6')!.tlStart === '2026-10-12');
    expect(geom(live(w, 'tl6')!)).toEqual(geom(s.get('tl6')!));
    await send(a, [act('timeline.setRange', { id: 'tl6', extend: 'after' })]);
    setRange(s, 'tl6', extendRange(s.get('tl6')!, 'after'));
    await waitFor(() => live(w, 'tl6')!.tlEnd === '2027-01-22');
    expect(geom(live(w, 'tl6')!)).toEqual(geom(s.get('tl6')!));
    await send(a, [act('timeline.setUnit', { id: 'tl6', unit: 'month' })]);
    setUnit(s, 'tl6', 'month');
    await waitFor(() => live(w, 'tl6')!.tlUnit === 'month');
    expect(geom(live(w, 'tl6')!)).toEqual(geom(s.get('tl6')!));
    await send(a, [act('timeline.setUnit', { id: 'tl6', unit: 'week' })]);
    await waitFor(() => live(w, 'tl6')!.tlUnit === undefined);
    await send(a, [act('timeline.setRange', { id: 'tl6', start: '2026-11-30', end: '2026-11-02' })]);
    await waitFor(() => live(w, 'tl6')!.tlEnd === '2026-11-30');
    expect(live(w, 'tl6')!.tlStart).toBe('2026-11-02');
    await undo(a);
    await waitFor(() => live(w, 'tl6')!.tlEnd === '2027-01-22');
    // gesperrt: nichts
    await send(a, [{ op: 'update', patches: { tl6: { locked: true } } }]);
    let ack = await send(a, [act('timeline.setUnit', { id: 'tl6', unit: 'day' }), act('timeline.addItem', { id: 'tl6', lane: 'l1', start: '2026-11-03', end: '2026-11-03' })]);
    expect(ack.results['0']).toEqual({ skipped: true });
    expect(ack.results['1']).toMatchObject({ skipped: true });
    ack = await send(a, [act('timeline.setUnit', { id: 'tl6', unit: 'year' })]);
    expect(ack.t).toBe('nack');
    ack = await send(a, [act('timeline.patchItem', { id: 'tl6', key: 'v', color: 'rot' })]);
    expect(ack.t).toBe('nack');
  });

  it('timeline.adopt: Haftnotiz/Karte auf einer Spur wird Eintrag (Text, Farbe, Tag), ein Schritt, Hinweis', async () => {
    const { a, w } = await setup();
    const t = timeline('tl7');
    await send(a, [{ op: 'create', objects: [t] }]);
    a.send({ t: 'step' });
    await waitFor(() => !!live(w, 'tl7'));
    const s = ref(t);
    const L = layoutFor(s.get('tl7')!);
    const k = t.w / L.W0;
    // Mitte der Notiz auf Spur 2 („Programm“), Tag 10 (12.11.)
    const lane2 = L.lanes[1]!;
    const cx = t.x + (168 + 10.5 * L.dayPx) * k;
    const cy = t.y + (lane2.y + lane2.h / 2) * k;
    const note = { id: 'n1', type: 'sticky', x: cx - 100, y: cy - 100, w: 200, h: 200, color: '#ffd08a', text: 'Soundcheck\n  Hauptbühne' };
    const away = { id: 'n2', type: 'sticky', x: t.x - 400, y: t.y, w: 200, h: 200, text: 'bleibt' };
    await send(a, [{ op: 'create', objects: [note, away] }]);
    a.send({ t: 'step' });
    const ack = await send(a, [act('timeline.adopt', { ids: ['n1', 'n2'] }, 'kd')]);
    expect(ack.results['0']).toEqual({ select: ['tl7'], toast: 'Als Eintrag in die Zeitleiste übernommen', data: { timeline: 'tl7', key: 'kd-1' } });
    addItem(s, 'tl7', droppedItem(note, 'Soundcheck\n  Hauptbühne', L, 'l2', START + 10), 'kd-1');
    await waitFor(() => !!live(w, 'tl7')!.timeline.items['kd-1']);
    expect(live(w, 'tl7')!.timeline.items['kd-1']).toEqual({ lane: 'l2', start: '2026-11-12', end: '2026-11-18', title: 'Soundcheck Hauptbühne', color: '#ffd08a' });
    expect(geom(live(w, 'tl7')!)).toEqual(geom(s.get('tl7')!));
    expect(w.objects.has('n1')).toBe(false);
    expect(w.objects.has('n2')).toBe(true);
    await undo(a);
    await waitFor(() => w.objects.has('n1') && !live(w, 'tl7')!.timeline.items['kd-1']);
    const none = await send(a, [act('timeline.adopt', { ids: ['n2'] })]);
    expect(none.results['0']).toEqual({ skipped: true });
  });
});
