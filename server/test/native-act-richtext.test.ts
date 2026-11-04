// Web-Aktionen des Rich-Texts für die App (docs/contract.md §8.12, Paket P8): richtext.whole (Kontextleiste
// `core.format` fürs ganze Objekt: Unterstrichen, Textfarbe, Markierung, Liste; Link über den ganzen Text) und
// richtext.toggleTask (Kästchen auf dem Board). Ergebnis = dieselbe Web-Funktion (ops.ts) direkt auf einem Browser-Store;
// ein Rückgängig-Schritt je Aktion; gesperrte Objekte bleiben.
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WEB } from '#stachel-web';
import { BoardStore, type NewObject } from '../../web/src/board/store';
import { fragmentToJson, type PMDoc } from '../../web/src/features/richtext/doc';
import { listAllIn, markAllIn, setTextColorIn, toggleTaskIn } from '../../web/src/features/richtext/whole';
import { linkAttrs } from '../../web/src/features/richtext/native';
import { CORE_STYLE_TRAITS } from '../../web/src/features/tools/style';
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
  const board = (await browser.post('/api/boards', { title: 'Rich-Text' })).body.board as { id: string };
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

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const tasks = (...items: [string, boolean][]) => ({
  type: 'doc',
  content: [{ type: 'taskList', content: items.map(([t, checked]) => ({ type: 'taskItem', attrs: { checked }, content: [para(t)] })) }],
});
const objects = () => [
  { id: 'n1', type: 'sticky', x: 0, y: 0, w: 200, h: 200, color: '#fff27a', text: 'Erste\nZweite' },
  {
    id: 'n2',
    type: 'sticky',
    x: 300,
    y: 0,
    w: 200,
    h: 200,
    text: 'Fett und Code',
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fett', marks: [{ type: 'bold' }] }, { type: 'text', text: ' und Code' }] }] },
  },
  { id: 't1', type: 'text', x: 0, y: 300, w: 160, h: 36, fontSize: 24, text: 'Ein Text', color: '#0a0a0a', autoWidth: true },
  { id: 's1', type: 'shape', shape: 'rect', x: 300, y: 300, w: 180, h: 120, text: 'Form', content: { type: 'doc', content: [para('Form')] } },
  { id: 'locked', type: 'sticky', x: 600, y: 0, w: 200, h: 200, text: 'Gesperrt', locked: true },
  { id: 'img', type: 'image', x: 900, y: 0, w: 100, h: 100 },
  { id: 'todo', type: 'sticky', x: 0, y: 600, w: 200, h: 200, text: 'A\nB', content: tasks(['A', false], ['B', true]) },
];

function refStore() {
  const s = new BoardStore(new Y.Doc(), 'a:ref');
  s.createMany(objects() as unknown as NewObject[]);
  return s;
}
const contentOf = (m: Y.Map<unknown> | undefined): PMDoc | null => {
  const f = m?.get('content');
  return f instanceof Y.XmlFragment ? fragmentToJson(f) : null;
};
const liveDoc = (w: ReturnType<typeof webClient>, id: string) => contentOf(w.objects.get(id));
const refDoc = (s: BoardStore, id: string) => contentOf(s.objects.get(id));
const same = (w: ReturnType<typeof webClient>, s: BoardStore, id: string) => JSON.stringify(liveDoc(w, id)) === JSON.stringify(refDoc(s, id));
const targets = (s: BoardStore, ids: string[]) => ids.map((id) => s.get(id)!).filter((o) => !!o && !o.locked && CORE_STYLE_TRAITS.textual(o.type));
const ALL = ['n1', 'n2', 't1', 's1', 'locked', 'img'];

async function created() {
  const e = await setup();
  expect((await send(e.a, [{ op: 'create', objects: objects() }])).t).toBe('ack');
  await waitFor(() => e.w.objects.has('todo'));
  return e;
}

describe('Rich-Text-Aktionen (P8)', () => {
  it('stehen in welcome.actions', async () => {
    const { welcome } = await setup();
    for (const n of ['richtext.whole', 'richtext.toggleTask']) expect(welcome.actions[n]).toBe(1);
    expect(WEB.actionList(false)['richtext.whole']).toBe(1);
  });

  it('Unterstrichen fürs ganze Objekt wie markAll (Migration aus `text` im selben Schritt), gesperrte/Bilder bleiben, Rückgängig', async () => {
    const { a, w } = await created();
    const ref = refStore();
    a.send({ t: 'step' });
    const ack = await send(a, [{ op: 'act', name: 'richtext.whole', args: { ids: ALL, op: 'underline', value: true } }]);
    expect(ack.results).toEqual({ '0': {} });
    markAllIn(ref, targets(ref, ALL), 'underline', {});
    await waitFor(() => ['n1', 'n2', 't1', 's1'].every((id) => same(w, ref, id)));
    expect(JSON.stringify(liveDoc(w, 'n1'))).toContain('underline');
    expect(liveDoc(w, 'locked')).toBeNull();
    expect(w.objects.get('n1')?.get('text')).toBe('Erste\nZweite');
    // aus
    a.send({ t: 'step' });
    await send(a, [{ op: 'act', name: 'richtext.whole', args: { ids: ['n2'], op: 'underline', value: false } }]);
    await waitFor(() => !JSON.stringify(liveDoc(w, 'n2')).includes('underline'));
    await undo(a);
    await waitFor(() => JSON.stringify(liveDoc(w, 'n2')).includes('underline'));
    await undo(a);
    await waitFor(() => !JSON.stringify(liveDoc(w, 'n2')).includes('underline'));
  });

  it('Textfarbe: Text-Objekt ändert die Objektfarbe, andere bekommen textStyle.color; Automatisch nimmt sie weg', async () => {
    const { a, w } = await created();
    const ref = refStore();
    await send(a, [{ op: 'act', name: 'richtext.whole', args: { ids: ['n1', 't1', 's1'], op: 'color', value: '#1763b5' } }]);
    setTextColorIn(ref, targets(ref, ['n1', 't1', 's1']), '#1763b5');
    await waitFor(() => w.objects.get('t1')?.get('color') === '#1763b5' && same(w, ref, 'n1') && same(w, ref, 's1'));
    expect(JSON.stringify(liveDoc(w, 'n1'))).toContain('#1763b5');
    a.send({ t: 'step' });
    await send(a, [{ op: 'act', name: 'richtext.whole', args: { ids: ['n1', 't1'], op: 'color', value: null } }]);
    setTextColorIn(ref, targets(ref, ['n1', 't1']), null);
    await waitFor(() => w.objects.get('t1')?.get('color') === '#0a0a0a' && same(w, ref, 'n1'));
    expect(JSON.stringify(liveDoc(w, 'n1'))).not.toContain('textStyle');
  });

  it('Markierung setzen und entfernen wie markAll', async () => {
    const { a, w } = await created();
    const ref = refStore();
    await send(a, [{ op: 'act', name: 'richtext.whole', args: { ids: ['n2'], op: 'highlight', value: '#c9e14a' } }]);
    markAllIn(ref, targets(ref, ['n2']), 'highlight', { color: '#c9e14a' });
    await waitFor(() => same(w, ref, 'n2'));
    expect(JSON.stringify(liveDoc(w, 'n2'))).toContain('#c9e14a');
    await send(a, [{ op: 'act', name: 'richtext.whole', args: { ids: ['n2'], op: 'highlight', value: null } }]);
    markAllIn(ref, targets(ref, ['n2']), 'highlight', null);
    await waitFor(() => same(w, ref, 'n2'));
  });

  it('Liste: wie die Leiste umschalten (nochmal = zurück), `on` fest, Klartext bleibt', async () => {
    const { a, w } = await created();
    const ref = refStore();
    const ack = await send(a, [{ op: 'act', name: 'richtext.whole', args: { ids: ['n1', 't1'], op: 'list', value: 'bulletList' } }]);
    expect(ack.results).toEqual({ '0': { data: { changed: ['n1', 't1'] } } });
    listAllIn(ref, targets(ref, ['n1', 't1']), 'bulletList');
    await waitFor(() => same(w, ref, 'n1') && same(w, ref, 't1'));
    expect(liveDoc(w, 'n1')?.content[0].type).toBe('bulletList');
    expect(w.objects.get('n1')?.get('text')).toBe('Erste\nZweite');
    // `on: true` ändert nichts mehr
    const again = await send(a, [{ op: 'act', name: 'richtext.whole', args: { ids: ['n1'], op: 'list', value: 'bulletList', on: true } }]);
    expect(again.results).toEqual({ '0': { data: { changed: [] } } });
    // ohne `on`: zurück zu Absätzen
    await send(a, [{ op: 'act', name: 'richtext.whole', args: { ids: ['n1'], op: 'list', value: 'bulletList' } }]);
    listAllIn(ref, targets(ref, ['n1']), 'bulletList');
    await waitFor(() => same(w, ref, 'n1'));
    expect(liveDoc(w, 'n1')?.content[0].type).toBe('paragraph');
    // Checkliste
    await send(a, [{ op: 'act', name: 'richtext.whole', args: { ids: ['n1'], op: 'list', value: 'taskList' } }]);
    listAllIn(ref, targets(ref, ['n1']), 'taskList');
    await waitFor(() => same(w, ref, 'n1'));
  });

  it('Link über den ganzen Text: Eingabe wie das Link-Feld (normalizeHref), ungültig = Hinweis, null entfernt', async () => {
    const { a, w } = await created();
    const ref = refStore();
    const ack = await send(a, [{ op: 'act', name: 'richtext.whole', args: { ids: ['n2'], op: 'link', value: 'example.org' } }]);
    expect(ack.results).toEqual({ '0': { data: { href: 'https://example.org/' } } });
    markAllIn(ref, targets(ref, ['n2']), 'link', linkAttrs('https://example.org/'));
    await waitFor(() => same(w, ref, 'n2'));
    const bad = await send(a, [{ op: 'act', name: 'richtext.whole', args: { ids: ['n2'], op: 'link', value: 'javascript:alert(1)' } }]);
    expect(bad.results).toEqual({ '0': { skipped: true, toast: 'Das ist kein gültiger Link.' } });
    const mail = await send(a, [{ op: 'act', name: 'richtext.whole', args: { ids: ['n1'], op: 'link', value: 'mara@example.org' } }]);
    expect(mail.results).toEqual({ '0': { data: { href: 'mailto:mara@example.org' } } });
    await send(a, [{ op: 'act', name: 'richtext.whole', args: { ids: ['n2'], op: 'link', value: null } }]);
    await waitFor(() => !JSON.stringify(liveDoc(w, 'n2')).includes('link'));
  });

  it('nur gesperrte bzw. ohne Text: skipped; falsche args: nack', async () => {
    const { a } = await created();
    expect((await send(a, [{ op: 'act', name: 'richtext.whole', args: { ids: ['locked', 'img'], op: 'underline', value: true } }])).results).toEqual({ '0': { skipped: true } });
    expect((await send(a, [{ op: 'act', name: 'richtext.whole', args: { ids: ['n1'], op: 'bold', value: true } }])).t).toBe('nack');
    expect((await send(a, [{ op: 'act', name: 'richtext.whole', args: { ids: ['n1'], op: 'color', value: 'red' } }])).t).toBe('nack');
    expect((await send(a, [{ op: 'act', name: 'richtext.whole', args: { ids: ['n1'], op: 'list', value: 'heading' } }])).t).toBe('nack');
    expect((await send(a, [{ op: 'act', name: 'richtext.toggleTask', args: { id: 'n1', index: -1 } }])).t).toBe('nack');
  });

  it('richtext.toggleTask: Kästchen abhaken wie toggleTask, ein Rückgängig-Schritt, gesperrt/ohne Kästchen = skipped', async () => {
    const { a, w } = await created();
    const ref = refStore();
    a.send({ t: 'step' });
    const ack = await send(a, [{ op: 'act', name: 'richtext.toggleTask', args: { id: 'todo', index: 0 } }]);
    expect(ack.results).toEqual({ '0': { data: { checked: true } } });
    toggleTaskIn(ref, ref.get('todo')!, 0);
    await waitFor(() => same(w, ref, 'todo'));
    a.send({ t: 'step' });
    const second = await send(a, [{ op: 'act', name: 'richtext.toggleTask', args: { id: 'todo', index: 1 } }]);
    expect(second.results).toEqual({ '0': { data: { checked: false } } });
    expect((await send(a, [{ op: 'act', name: 'richtext.toggleTask', args: { id: 'todo', index: 5 } }])).results).toEqual({ '0': { skipped: true } });
    expect((await send(a, [{ op: 'act', name: 'richtext.toggleTask', args: { id: 'locked', index: 0 } }])).results).toEqual({ '0': { skipped: true } });
    await undo(a);
    await undo(a);
    await waitFor(() => JSON.stringify(liveDoc(w, 'todo')) === JSON.stringify(tasks(['A', false], ['B', true])));
  });
});
