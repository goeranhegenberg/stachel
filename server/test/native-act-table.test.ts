// Web-Aktionen der Tabellen für die App (docs/contract.md §8.12, Paket P3): table.setCell, table.addRow, table.addCol,
// table.removeRow, table.removeCol, table.resizeCol, table.setHead. Ergebnis = dieselbe Web-Funktion (table/yjs.ts,
// table/create.ts) direkt auf einem Browser-Store (Höhe aus den umbrochenen Zellen mit den Schriftmaßen); Zellen live
// (Y.Text, gleichzeitiges Tippen zusammengeführt); ein Rückgängig-Schritt je Aktion.
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import '#stachel-web';
import { BoardStore, type NewObject } from '../../web/src/board/store';
import { headPatch, newTable, tableEnv } from '../../web/src/features/structure/table/create';
import { tableFrom } from '../../web/src/features/structure/table/model';
import { addCol, addRow, removeCol, removeRow, resizeCol, setCell } from '../../web/src/features/structure/table/yjs';
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

let memberId = 3700;
async function setup() {
  const kt = env.fake.addMember(++memberId, 'Mara');
  const browser = await loginMember(env, kt);
  const mara = await appSession(env.base, kt);
  const board = (await browser.post('/api/boards', { title: 'Tabellen' })).body.board as { id: string };
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

/** Tabelle mit festen Zeilen/Spalten r1…/c1… (wie das Werkzeug: 480 breit, Kopfzeile). */
function table(id: string, rows: string[][]) {
  const d = tableFrom(rows);
  const rename = (xs: string[], p: string) => new Map(xs.map((x, i) => [x, `${p}${i + 1}`]));
  const rm = rename(d.rows, 'r');
  const cm = rename(d.cols, 'c');
  const cells: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.cells)) {
    const [r, c] = k.split(':');
    cells[`${rm.get(r!)}:${cm.get(c!)}`] = v;
  }
  return { id, ...newTable({ x: 240, y: 100 }, { rows: [...rm.values()], cols: [...cm.values()], cells, widths: {} }) };
}

/** Browser-Store mit derselben Tabelle (Referenz) */
function ref(o: ReturnType<typeof table>) {
  const s = new BoardStore(new Y.Doc(), 'a:ref');
  s.createMany([o as unknown as NewObject]);
  return s;
}
const live = (w: ReturnType<typeof webClient>, id: string) => w.objects.get(id)!.toJSON() as Record<string, any>;
const geom = (o: Record<string, any>) => ({ w: o.w, h: o.h, table: o.table, tableHead: o.tableHead });

describe('Tabellen-Aktionen (P3)', () => {
  it('stehen in welcome.actions', async () => {
    const { welcome } = await setup();
    for (const n of ['table.setCell', 'table.addRow', 'table.addCol', 'table.removeRow', 'table.removeCol', 'table.resizeCol', 'table.setHead']) {
      expect(welcome.actions[n]).toBe(1);
    }
  });

  it('table.setCell: Zelle als Y.Text, gleichzeitiges Tippen im Web bleibt, Höhe wie im Browser', async () => {
    const { a, w } = await setup();
    const t = table('t1', [['Bereich', 'Fr'], ['Bar', '']]);
    await send(a, [{ op: 'create', objects: [t] }]);
    a.send({ t: 'step' });
    await waitFor(() => w.objects.has('t1'));
    const text = 'Lena, Tom und Mira übernehmen die Bar am Freitagabend bis Mitternacht';
    let ack = await send(a, [{ op: 'act', name: 'table.setCell', args: { id: 't1', r: 'r2', c: 'c2', base: '', text } }]);
    expect(ack.results['0']).toEqual({ data: { conflict: false } });
    const s = ref(t);
    setCell(s, s.get('t1')!, tableEnv(s.get('t1')!), 'r2', 'c2', text);
    await waitFor(() => live(w, 't1').table.cells['r2:c2'] === text);
    expect(geom(live(w, 't1'))).toEqual(geom(s.get('t1')!));
    expect(live(w, 't1').h).toBeGreaterThan(t.h);
    // Web tippt vorne in dieselbe Zelle, die App hinten (Basis = alter Stand)
    const cells = (w.objects.get('t1')!.get('table') as Y.Map<unknown>).get('cells') as Y.Map<unknown>;
    expect(cells.get('r2:c2')).toBeInstanceOf(Y.Text);
    (cells.get('r2:c2') as Y.Text).insert(0, 'Fr: ');
    await w.flushed();
    a.send({ t: 'step' });
    ack = await send(a, [{ op: 'act', name: 'table.setCell', args: { id: 't1', r: 'r2', c: 'c2', base: text, text: `${text}!` } }]);
    await waitFor(() => live(w, 't1').table.cells['r2:c2'] === `Fr: ${text}!`);
    // jede Eingabe ein Schritt; fehlende Zeile → nichts
    await undo(a);
    await waitFor(() => live(w, 't1').table.cells['r2:c2'] === `Fr: ${text}`);
    ack = await send(a, [{ op: 'act', name: 'table.setCell', args: { id: 't1', r: 'weg', c: 'c2', text: 'x' } }]);
    expect(ack.results['0']).toEqual({ skipped: true });
  });

  it('Zeilen und Spalten einfügen/löschen relativ zur aktiven Zelle, neue IDs aus key, Breite/Höhe wie im Browser', async () => {
    const { a, w } = await setup();
    const t = table('t2', [['A', 'B', 'C'], ['1', '2', '3']]);
    await send(a, [{ op: 'create', objects: [t] }]);
    a.send({ t: 'step' });
    const s = ref(t);
    const env = () => tableEnv(s.get('t2')!);
    let ack = await send(a, [{ op: 'act', name: 'table.addRow', args: { id: 't2', after: 'r1' }, key: 'kr' }]);
    expect(ack.results['0']).toEqual({ data: { row: 'kr-1' } });
    addRow(s, s.get('t2')!, env(), 'r1', 'kr-1');
    await waitFor(() => live(w, 't2').table.rows.length === 3);
    expect(geom(live(w, 't2'))).toEqual(geom(s.get('t2')!));
    expect(live(w, 't2').table.rows).toEqual(['r1', 'kr-1', 'r2']);
    // gleiche key nicht noch einmal; ohne after am Ende
    await send(a, [{ op: 'act', name: 'table.addRow', args: { id: 't2', after: 'r1' }, key: 'kr' }]);
    ack = await send(a, [{ op: 'act', name: 'table.addCol', args: { id: 't2', after: 'c1' }, key: 'kc' }]);
    expect(ack.results['0']).toEqual({ data: { col: 'kc-1' } });
    addCol(s, s.get('t2')!, env(), 'c1', 'kc-1');
    await waitFor(() => live(w, 't2').table.cols.length === 4);
    expect(geom(live(w, 't2'))).toEqual(geom(s.get('t2')!));
    expect(live(w, 't2').w).toBeGreaterThan(t.w);
    await send(a, [{ op: 'act', name: 'table.removeCol', args: { id: 't2', col: 'c3' } }]);
    removeCol(s, s.get('t2')!, env(), 'c3');
    await waitFor(() => live(w, 't2').table.cols.length === 3);
    expect(geom(live(w, 't2'))).toEqual(geom(s.get('t2')!));
    await send(a, [{ op: 'act', name: 'table.removeRow', args: { id: 't2', row: 'r2' } }]);
    removeRow(s, s.get('t2')!, env(), 'r2');
    await waitFor(() => live(w, 't2').table.rows.length === 2);
    expect(geom(live(w, 't2'))).toEqual(geom(s.get('t2')!));
    // Rückgängig: je Aktion ein Schritt
    await undo(a);
    await waitFor(() => live(w, 't2').table.rows.length === 3);
    // die letzte Zeile/Spalte bleibt
    const one = table('t3', [['x']]);
    await send(a, [{ op: 'create', objects: [one] }]);
    ack = await send(a, [
      { op: 'act', name: 'table.removeRow', args: { id: 't3', row: 'r1' } },
      { op: 'act', name: 'table.removeCol', args: { id: 't3', col: 'c1' } },
    ]);
    expect(ack.results).toEqual({ '0': { skipped: true }, '1': { skipped: true } });
  });

  it('table.resizeCol und table.setHead wie im Browser; gesperrt → nichts; Prüfung', async () => {
    const { a, w } = await setup();
    const t = table('t4', [['Kopf eins mit langem Text', 'B', 'C'], ['1', '2', '3']]);
    await send(a, [{ op: 'create', objects: [t] }]);
    a.send({ t: 'step' });
    const s = ref(t);
    const px = [260, 60, 160];
    await send(a, [{ op: 'act', name: 'table.resizeCol', args: { id: 't4', i: 0, px } }]);
    resizeCol(s, s.get('t4')!, tableEnv(s.get('t4')!), 0, px);
    await waitFor(() => Object.keys(live(w, 't4').table.widths).length > 0);
    expect(geom(live(w, 't4'))).toEqual(geom(s.get('t4')!));
    let ack = await send(a, [{ op: 'act', name: 'table.resizeCol', args: { id: 't4', i: 2, px } }]);
    expect(ack.results['0']).toEqual({ skipped: true });
    await send(a, [{ op: 'act', name: 'table.setHead', args: { id: 't4', head: 'both' } }]);
    s.update('t4', headPatch(s.get('t4')!, 'both'));
    await waitFor(() => live(w, 't4').tableHead === 'both');
    expect(geom(live(w, 't4'))).toEqual(geom(s.get('t4')!));
    await send(a, [{ op: 'act', name: 'table.setHead', args: { id: 't4', head: 'none' } }]);
    s.update('t4', headPatch(s.get('t4')!, 'none'));
    await waitFor(() => live(w, 't4').tableHead === 'none');
    expect(geom(live(w, 't4'))).toEqual(geom(s.get('t4')!));
    await send(a, [{ op: 'act', name: 'table.setHead', args: { id: 't4', head: 'row' } }]);
    await waitFor(() => live(w, 't4').tableHead === undefined);
    ack = await send(a, [{ op: 'act', name: 'table.setHead', args: { id: 't4', head: 'oben' } }]);
    expect([ack.t, ack.error]).toEqual(['nack', 'invalid_input']);
    await send(a, [{ op: 'update', patches: { t4: { locked: true } } }]);
    ack = await send(a, [{ op: 'act', name: 'table.addRow', args: { id: 't4' } }]);
    expect(ack.results['0']).toEqual({ skipped: true, data: { row: expect.any(String) } });
  });
});
