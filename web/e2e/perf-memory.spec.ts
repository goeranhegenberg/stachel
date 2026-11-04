// Speicher beim Board-Wechsel: Provider, Y.Doc, UndoManager, Listener und DOM des alten Boards müssen freigegeben werden.
// Zwei Boards mit je 1500 Objekten (Rich-Text-Notizen, Formen, Verbinder) über einen echten Hocuspocus-Testserver,
// 12-mal hin und her. Gemessen nach erzwungener Speicherbereinigung: JS-Heap, DOM-Knoten, Event-Listener.
// Nur im Perf-Lauf (eigener Sync-Port): npx playwright test --config e2e/perf.playwright.config.ts perf-memory
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { generateNKeysBetween } from 'fractional-indexing';
import { installFakeApi, sampleBoards } from './fakeApi';

test.skip(!process.env.STACHEL_PERF_PROD, 'nur im Perf-Lauf (e2e/perf.playwright.config.ts)');

let server: Server;
/** offen halten: ohne Persistenz verwirft Hocuspocus ein Dokument, sobald niemand mehr verbunden ist */
const conns: { disconnect(): Promise<void> }[] = [];

/** Board im Server-Dokument füllen (Format wie der Store: je Objekt eine Y.Map unter `objects`). */
async function seed(name: string, n: number) {
  const conn = await server.hocuspocus.openDirectConnection(name, {});
  const keys = generateNKeysBetween(null, null, n);
  await conn.transact((doc: Y.Doc) => {
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    for (let i = 0; i < n; i++) {
      const id = `${name.slice(6)}-${i}`;
      const x = (i % 40) * 240;
      const y = Math.floor(i / 40) * 240;
      const kind = i % 10;
      const fields: Record<string, unknown> =
        kind < 6
          ? { type: 'sticky', x, y, w: 200, h: 200, color: '#fff27a', text: `Notiz ${i}` }
          : kind < 9
            ? { type: 'shape', shape: 'rect', x, y, w: 200, h: 120, color: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2, text: `Form ${i}` }
            : { type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: `${name.slice(6)}-${i - 3}` }, to: { objectId: `${name.slice(6)}-${i - 2}` }, color: '#0a0a0a', strokeWidth: 2 };
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({ ...fields, id, z: keys[i], createdBy: 'm:12', updatedAt: new Date().toISOString() })) m.set(k, v);
      if (kind < 6) {
        // Rich-Text wie vom Editor (y-prosemirror): Absatz mit fettem Wort
        const f = new Y.XmlFragment();
        const p = new Y.XmlElement('paragraph');
        const t = new Y.XmlText();
        t.insert(0, `Notiz ${i}`);
        t.format(0, 5, { bold: {} });
        p.insert(0, [t]);
        f.insert(0, [p]);
        m.set('content', f);
      }
      objects.set(id, m);
    }
  });
  conns.push(conn);
}

test.beforeAll(async () => {
  server = new Server({
    port: Number(process.env.STACHEL_PERF_SYNC_PORT),
    quiet: true,
    stopOnSignals: false,
    async onAuthenticate() {
      return { session: 'perf' };
    },
  });
  await server.listen();
  await seed('board:b-plan', 1500);
  await seed('board:b-ideen', 1500);
});

test.afterAll(async () => {
  for (const c of conns) await c.disconnect();
  await server?.destroy();
});

async function heap(cdp: CDPSession) {
  // mehrfach bereinigen: Yjs/React geben manches erst im zweiten Durchgang frei
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  const dom = await cdp.send('Memory.getDOMCounters');
  return { mb: usedSize / 1024 / 1024, nodes: dom.nodes, listeners: dom.jsEventListeners };
}

async function open(page: Page, board: string) {
  await page.evaluate((b) => {
    history.pushState(null, '', `/?b=${b}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, board);
  await expect(page.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
  await expect(page.locator(`[data-id="${board}-0"]`)).toBeVisible({ timeout: 20_000 });
}

test('Board-Wechsel gibt Speicher, Knoten und Listener frei', async ({ page, context }) => {
  test.setTimeout(240_000);
  await context.addCookies([{ name: 'stachel_session', value: 'perf', domain: 'localhost', path: '/' }]);
  await installFakeApi(page, { loggedIn: true, boards: sampleBoards(), keepSync: true });
  await page.goto('/?b=b-plan');
  await expect(page.getByTestId('status')).toHaveText('Live', { timeout: 20_000 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');

  const boards = ['b-ideen', 'b-plan'];
  // Aufwärmen: beide Boards einmal geladen, Caches gefüllt; auf einem Board eine Notiz bearbeitet (Tiptap, UndoManager)
  for (const b of boards) await open(page, b);
  await page.locator('[data-id="b-plan-0"]').click();
  await page.keyboard.type('x');
  await expect(page.locator('.ProseMirror')).toHaveCount(1);
  await page.keyboard.press('Escape');
  const base = await heap(cdp);
  console.log(`Nach Aufwärmen: ${base.mb.toFixed(1)} MB Heap, ${base.nodes} DOM-Knoten, ${base.listeners} Listener`);

  for (let round = 0; round < 6; round++) for (const b of boards) await open(page, b);
  const after = await heap(cdp);
  console.log(`Nach 12 weiteren Wechseln: ${after.mb.toFixed(1)} MB Heap, ${after.nodes} DOM-Knoten, ${after.listeners} Listener`);

  // Ein Board mit 1500 Objekten belegt ≈ 10+ MB; ein Leck pro Wechsel wüchse um ein Vielfaches davon.
  expect(after.mb - base.mb).toBeLessThan(12);
  expect(after.nodes).toBeLessThan(base.nodes * 1.3 + 500);
  expect(after.listeners).toBeLessThan(base.listeners * 1.3 + 50);
});
