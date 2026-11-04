// Web-Aktionen des Moduls tools für die App (docs/contract.md §8.12, Paket P1): tools.layerStep (layers.ts),
// tools.copyStyle/tools.pasteStyle (style.ts, wie formatPainter.tsx). Ergebnis = dieselbe Web-Funktion direkt auf einem
// Browser-Store; Rückgängig; Hinweise wie im Web; Prüfung der args.
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WEB } from '#stachel-web';
import { BoardStore, type NewObject } from '../../web/src/board/store';
import { compareKeys } from '../../web/src/board/fractional';
import { layerStepPatches } from '../../web/src/features/tools/layers';
import { CORE_STYLE_TRAITS, extractStyle, stylePatches } from '../../web/src/features/tools/style';
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

let memberId = 3300;
async function setup() {
  const kt = env.fake.addMember(++memberId, 'Mara');
  const browser = await loginMember(env, kt);
  const mara = await appSession(env.base, kt);
  const board = (await browser.post('/api/boards', { title: 'Werkzeuge' })).body.board as { id: string };
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
const field = (w: ReturnType<typeof webClient>, id: string, k: string) => w.objects.get(id)?.get(k);
/** Reihenfolge von unten nach oben wie im Web (z, dann id). */
const orderOf = (w: ReturnType<typeof webClient>, ids: string[]) =>
  [...ids].sort((p, q) => compareKeys(String(field(w, p, 'z')), String(field(w, q, 'z'))) || compareKeys(p, q));

describe('Werkzeug-Aktionen (P1)', () => {
  it('stehen in welcome.actions', async () => {
    const { welcome } = await setup();
    for (const n of ['tools.layerStep', 'tools.copyStyle', 'tools.pasteStyle']) expect(welcome.actions[n]).toBe(1);
    expect(WEB.actionList(false)['tools.layerStep']).toBe(1);
  });

  it('tools.layerStep: springt am nächsten überlappenden Objekt vorbei wie layerStepPatches, Rückgängig', async () => {
    const { a, w } = await setup();
    // a, b überlappen; c liegt weit weg; d überlappt a
    const objects = [sticky('a', 0), sticky('c', 2000), sticky('b', 50), sticky('d', 80, 50)];
    await send(a, [{ op: 'create', objects }]);
    const ids = objects.map((o) => o.id);
    await waitFor(() => ids.every((id) => w.objects.has(id)));
    expect(orderOf(w, ids)).toEqual(['a', 'c', 'b', 'd']);
    const ref = new BoardStore(new Y.Doc(), 'a:ref');
    ref.createMany(objects as unknown as NewObject[]);
    a.send({ t: 'step' });
    const ack = await send(a, [{ op: 'act', name: 'tools.layerStep', args: { ids: ['a'], dir: 1 } }]);
    expect(ack.results).toEqual({ '0': {} });
    ref.updateMany(layerStepPatches(ref.getSnapshot().ordered, new Set(['a']), 1));
    const refOrder = ref.getSnapshot().ordered.map((o) => o.id);
    expect(refOrder).toEqual(['c', 'b', 'a', 'd']);
    await waitFor(() => orderOf(w, ids).join() === refOrder.join());
    // ganz oben (nichts überlappt mehr darüber): skipped
    expect((await send(a, [{ op: 'act', name: 'tools.layerStep', args: { ids: ['d'], dir: 1 } }])).results).toEqual({ '0': { skipped: true } });
    // nach hinten
    a.send({ t: 'step' });
    await send(a, [{ op: 'act', name: 'tools.layerStep', args: { ids: ['d'], dir: -1 } }]);
    ref.updateMany(layerStepPatches(ref.getSnapshot().ordered, new Set(['d']), -1));
    const refOrder2 = ref.getSnapshot().ordered.map((o) => o.id);
    await waitFor(() => orderOf(w, ids).join() === refOrder2.join());
    await undo(a);
    await waitFor(() => orderOf(w, ids).join() === refOrder.join());
  });

  it('tools.copyStyle liefert das Format wie extractStyle; tools.pasteStyle überträgt es wie stylePatch (auch zwischen Typen)', async () => {
    const { a, w } = await setup();
    const objects = [
      { id: 'src', type: 'shape', shape: 'rect', x: 0, y: 0, w: 180, h: 120, color: '#c9e14a', stroke: '#ec4e92', strokeWidth: 4, dash: 'dashed', fontSize: 32, bold: true, align: 'left', valign: 'top', text: 'Vorbild' },
      { id: 'shape2', type: 'shape', shape: 'ellipse', x: 300, y: 0, w: 180, h: 120, color: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2, text: 'Ziel' },
      sticky('note', 600, 0, { color: '#fff27a' }),
      { id: 'txt', type: 'text', x: 0, y: 300, w: 120, h: 36, fontSize: 24, text: 'Etwas Text', color: '#0a0a0a', autoWidth: true },
      sticky('locked', 900, 0, { locked: true }),
      { id: 'img', type: 'image', x: 0, y: 600, w: 100, h: 100 },
    ];
    expect((await send(a, [{ op: 'create', objects }])).t).toBe('ack');
    const ref = new BoardStore(new Y.Doc(), 'a:ref');
    ref.createMany(objects as unknown as NewObject[]);
    // kopieren
    const copy = await send(a, [{ op: 'act', name: 'tools.copyStyle', args: { id: 'src' } }]);
    const style = (copy.results as Record<string, { data: unknown; toast: string }>)['0'];
    expect(style.data).toEqual(extractStyle(ref.get('src')!));
    expect(style.toast).toBe('Format kopiert.');
    // einfügen auf Form, Notiz, Text (autoWidth), gesperrte Notiz
    a.send({ t: 'step' });
    const targets = ['shape2', 'note', 'txt', 'locked'];
    const ack = await send(a, [{ op: 'act', name: 'tools.pasteStyle', args: { ids: targets, style: style.data } }]);
    expect(ack.results).toEqual({ '0': {} });
    const s = extractStyle(ref.get('src')!);
    const adjust = (o: Parameters<typeof adjustTextPatch>[0], p: Parameters<typeof adjustTextPatch>[1]) => (o.type === 'text' ? adjustTextPatch(o, p) : p);
    const expected = stylePatches(s, targets.map((id) => ref.get(id)!), CORE_STYLE_TRAITS, adjust);
    expect(Object.keys(expected).sort()).toEqual(['note', 'shape2', 'txt']);
    expect(expected.txt.w).toBeGreaterThan(120); // Schrift 32 fett: breiter
    ref.updateMany(expected);
    await waitFor(() => field(w, 'shape2', 'stroke') === '#ec4e92' && field(w, 'txt', 'fontSize') === 32);
    for (const id of targets) {
      const o = ref.get(id)!;
      for (const k of ['color', 'stroke', 'strokeWidth', 'dash', 'fontSize', 'bold', 'align', 'valign', 'w']) {
        expect({ id, k, v: field(w, id, k) }).toEqual({ id, k, v: (o as unknown as Record<string, unknown>)[k] });
      }
    }
    // Notiz: Füllfarbe (Füllungen untereinander) und Textformat, kein Rand
    expect(field(w, 'note', 'color')).toBe('#c9e14a');
    expect(field(w, 'note', 'stroke')).toBeUndefined();
    // Bild: passt nicht → Hinweis wie im Web, Pinsel mit anderem Text
    const none = await send(a, [{ op: 'act', name: 'tools.pasteStyle', args: { ids: ['img'], style: style.data } }]);
    expect(none.results).toEqual({ '0': { toast: 'Das Format passt nicht zu dieser Auswahl.' } });
    const painter = await send(a, [{ op: 'act', name: 'tools.pasteStyle', args: { ids: ['img'], from: 'src', painter: true } }]);
    expect(painter.results).toEqual({ '0': { toast: 'Das Format passt nicht zu diesem Objekt.' } });
    // Rückgängig nimmt das Einfügen zurück
    await undo(a);
    await waitFor(() => field(w, 'shape2', 'stroke') === '#0a0a0a' && field(w, 'note', 'color') === '#fff27a');
  });

  it('tools.pasteStyle übernimmt nur Felder der Positivliste; prüft die args', async () => {
    const { a, w } = await setup();
    await send(a, [{ op: 'create', objects: [sticky('n', 0)] }]);
    const ack = await send(a, [{ op: 'act', name: 'tools.pasteStyle', args: { ids: ['n'], style: { type: 'sticky', fields: { color: '#9fd3ff', text: 'gekapert', x: 999 } } } }]);
    expect(ack.results).toEqual({ '0': {} });
    await waitFor(() => field(w, 'n', 'color') === '#9fd3ff');
    expect(field(w, 'n', 'text')).toBe('n');
    expect(field(w, 'n', 'x')).toBe(0);
    for (const args of [{ ids: ['n'] }, { ids: ['n'], from: 'n', style: { type: 'sticky', fields: {} } }, { ids: ['n'], style: { type: '', fields: {} } }, { ids: ['n'], from: 'n', painter: 'ja' }]) {
      const nack = await send(a, [{ op: 'act', name: 'tools.pasteStyle', args }]);
      expect(nack.t, JSON.stringify(args)).toBe('nack');
      expect(nack.error).toBe('invalid_input');
    }
    const bad = await send(a, [{ op: 'act', name: 'tools.layerStep', args: { ids: ['n'], dir: 2 } }]);
    expect(bad.error).toBe('invalid_input');
  });
});
