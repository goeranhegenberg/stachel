// Web-Aktion `tools.settings` (Paket P4, docs/contract.md §8.12): Board-Hintergrund aus der App – Ergebnis wie die
// Web-Funktionen (settingsModel.ts) direkt auf einem Browser-Store, für alle sichtbar, ohne Rückgängig wie im Web.
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import '#stachel-web';
import { BoardStore } from '../../web/src/board/store';
import { nativeAction, nativeActionList } from '../../web/src/native/registry';
import { readSettings, settingsMapOf, toggleGridOf, writeSettingsTo } from '../../web/src/features/tools/settingsModel';
import { loginMember, startEnv, waitFor, type TestEnv } from './helpers.js';
import { appSession, NativeClient, webClient, type Msg } from './native-client.js';

const ctx = { user: { key: 'a:t', name: 'T' }, now: new Date().toISOString(), v: 1, id: (n: number) => `k-${n}`, exists: () => false, measure: () => 0 };
const run = (store: BoardStore, raw: Record<string, unknown>) => {
  const def = nativeAction('tools.settings')!;
  const p = def.args(raw, 1);
  if (!p.ok) throw new Error(p.error);
  return def.run(store, p.args, ctx);
};
const fresh = () => new BoardStore(new Y.Doc(), 'a:ref');
const plain = (s: BoardStore) => settingsMapOf(s).toJSON();

describe('tools.settings direkt', () => {
  it('ist angemeldet (Version 2: authors) und prüft die Argumente', () => {
    expect(nativeActionList()['tools.settings']).toBe(2);
    const def = nativeAction('tools.settings')!;
    expect(def.undo).toBe('none');
    for (const bad of [{}, { pattern: 'gitter' }, { color: 'rot' }, { color: '#abc' }, { toggleGrid: true, pattern: 'dots' }, { pattern: 'dots', x: 1 }, { authors: 'ja' }]) {
      expect(def.args(bad, 1).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(def.args({ pattern: 'lines', color: '#FBF6E9' }, 1).ok).toBe(true);
  });

  it('Muster, Farbe und Raster ein/aus = dieselben Web-Funktionen (lastPattern gemerkt)', () => {
    const app = fresh();
    const web = fresh();
    expect(run(app, { pattern: 'lines', color: '#FBF6E9' })).toEqual({ data: { pattern: 'lines', color: '#fbf6e9', authors: false } });
    writeSettingsTo(web, { pattern: 'lines', color: '#fbf6e9' });
    expect(plain(app)).toEqual(plain(web));
    // Raster aus: merkt „Linien“
    expect(run(app, { toggleGrid: true })).toEqual({ data: { pattern: 'none', color: '#fbf6e9', authors: false } });
    toggleGridOf(web);
    expect(plain(app)).toEqual(plain(web));
    expect(plain(app).lastPattern).toBe('lines');
    // wieder an: das gemerkte Muster
    run(app, { toggleGrid: true });
    toggleGridOf(web);
    expect(plain(app)).toEqual(plain(web));
    expect(readSettings(settingsMapOf(app)).pattern).toBe('lines');
    // nur die Farbe
    run(app, { color: '#e9f1f8' });
    writeSettingsTo(web, { color: '#e9f1f8' });
    expect(plain(app)).toEqual(plain(web));
  });

  it('Raster ein auf einem alten Board ohne Einstellungen: Punkte', () => {
    const app = fresh();
    expect(run(app, { toggleGrid: true })).toEqual({ data: { pattern: 'none', color: '#f3f3ef', authors: false } });
    expect(run(app, { toggleGrid: true })).toEqual({ data: { pattern: 'dots', color: '#f3f3ef', authors: false } });
  });
  it('Autor:in an Haftnotizen (authors) = dieselbe Web-Funktion, nur dieser Schalter ändert sich', () => {
    const app = fresh();
    const web = fresh();
    run(app, { pattern: 'lines' });
    writeSettingsTo(web, { pattern: 'lines' });
    expect(run(app, { authors: true })).toEqual({ data: { pattern: 'lines', color: '#f3f3ef', authors: true } });
    writeSettingsTo(web, { authors: true });
    expect(plain(app)).toEqual(plain(web));
    expect(readSettings(settingsMapOf(web)).authors).toBe(true);
    expect(run(app, { authors: false })).toEqual({ data: { pattern: 'lines', color: '#f3f3ef', authors: false } });
    // fremde Werte im Dokument zählen als aus
    settingsMapOf(web).set('authors', 'ja');
    expect(readSettings(settingsMapOf(web)).authors).toBe(false);
  });
});

describe('tools.settings über die Native-API', () => {
  let env: TestEnv;
  const cleanup: (() => void)[] = [];
  beforeAll(async () => {
    env = await startEnv({ nativeIdleMs: 300 });
  });
  afterAll(async () => env?.stop());
  afterEach(() => {
    while (cleanup.length) cleanup.pop()!();
  });

  it('Web sieht die Einstellungen sofort, App bekommt sie als ext, Rückgängig nimmt sie nicht zurück', async () => {
    const kt = env.fake.addMember(4711, 'Mara');
    const browser = await loginMember(env, kt);
    const mara = await appSession(env.base, kt);
    const board = (await browser.post('/api/boards', { title: 'Einstellungen' })).body.board as { id: string };
    const ws = env.base.replace('http', 'ws');
    const w = webClient(ws, board.id, { cookie: browser.cookieHeader() });
    cleanup.push(() => w.destroy());
    await w.synced();
    const a = new NativeClient(ws, mara.token);
    cleanup.push(() => a.close());
    const welcome = await a.hello(board.id);
    expect(welcome.actions['tools.settings']).toBe(2);

    let req = 10;
    const send = async (ops: Record<string, unknown>[]): Promise<Msg> => {
      const r = ++req;
      const from = a.messages.length;
      a.send({ t: 'ops', req: r, ops });
      return a.next((m) => (m.t === 'ack' || m.t === 'nack') && m.req === r, 5000, from);
    };
    await send([{ op: 'create', objects: [{ id: 's1', type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: 'x' }] }]);
    a.send({ t: 'step' });
    const from = a.messages.length;
    const ack = await send([{ op: 'act', name: 'tools.settings', args: { pattern: 'lines', color: '#fbeff4' } }]);
    expect(ack.results).toEqual({ '0': { data: { pattern: 'lines', color: '#fbeff4', authors: false } } });
    const settings = w.doc.getMap('tools.settings');
    await waitFor(() => settings.get('pattern') === 'lines' && settings.get('color') === '#fbeff4');
    const patch = await a.next((m) => m.t === 'patch' && !!m.ext?.['tools.settings'], 5000, from);
    expect(patch.ext['tools.settings']).toMatchObject({ pattern: 'lines', color: '#fbeff4' });
    // Rückgängig nimmt nur das Anlegen der Notiz
    a.send({ t: 'undo', req: ++req });
    await a.next((m) => m.t === 'ack' && m.req === req);
    await waitFor(() => !w.objects.has('s1'));
    expect(settings.get('pattern')).toBe('lines');
  });
});
