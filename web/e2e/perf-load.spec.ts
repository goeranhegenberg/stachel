// Ladezeit und Paketgrößen im Handy-Profil (4-fach gedrosselte CPU, langsames 4G wie Lighthouse-Mobil).
// Sinnvoll nur gegen den Produktions-Build: npx playwright test --config e2e/perf.playwright.config.ts perf-load
// Die Größen sind deterministisch (gute Regressionsprüfung), die Zeiten nur mit großzügigen Grenzen.
import { expect, test, devices } from '@playwright/test';
import type { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { installFakeApi, sampleBoards } from './fakeApi';
import { startSyncServer } from './syncServer';

test.use({ ...devices['Pixel 7'] });
test.skip(!process.env.STACHEL_PERF_PROD, 'nur gegen den Produktions-Build (e2e/perf.playwright.config.ts)');

type Res = { name: string; size: number; wire: number; type: string };

test('Handy mit 4G: Board öffnen, Paketgrößen', async ({ page }) => {
  test.setTimeout(120_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  // Lighthouse „Slow 4G“: 150 ms RTT, 1,6 Mbit/s runter, 750 kbit/s hoch; CPU 4× langsamer
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const t0 = Date.now();
  await page.goto('/?offline=1');
  await expect(page.getByTestId('board')).toBeVisible({ timeout: 60_000 });
  const boardMs = Date.now() - t0;
  // Rich-Text-Editor (Tiptap) ist nachgeladen, sobald man tippen kann
  await page.waitForFunction(() => (window as any).__stachel?.store, null, { timeout: 60_000 });
  const res: Res[] = await page.evaluate(() =>
    (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map((r) => ({
      name: new URL(r.name).pathname,
      size: r.decodedBodySize,
      wire: r.encodedBodySize,
      type: r.initiatorType,
    })),
  );
  const js = res.filter((r) => r.name.endsWith('.js'));
  const css = res.filter((r) => r.name.endsWith('.css'));
  const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
  const sum = (l: Res[], k: 'size' | 'wire') => l.reduce((a, r) => a + r[k], 0);
  for (const r of [...js, ...css].sort((a, b) => b.size - a.size).slice(0, 8)) console.log(`  ${r.name}: ${kb(r.size)} (Leitung ${kb(r.wire)})`);
  console.log(`Board sichtbar nach ${boardMs} ms; JS ${kb(sum(js, 'size'))} (Leitung ${kb(sum(js, 'wire'))}), CSS ${kb(sum(css, 'size'))} (Leitung ${kb(sum(css, 'wire'))})`);

  // Einstieg klein halten: Anmeldung/Übersicht dürfen nicht auf React + Router + App warten
  const entry = js.find((r) => /\/assets\/index-[\w-]+\.js$/.test(r.name));
  expect(entry?.size ?? 0).toBeLessThan(40 * 1024);
  // Board-Pfad gesamt (React, Yjs, Editor, Tiptap): heute ≈ 1,2 MB unkomprimiert. Grenze mit Luft für Wachstum,
  // fängt aber z. B. doppelt gebündelte Bibliotheken oder versehentlich mitgezogene Export-/Icon-Pakete.
  expect(sum(js, 'size')).toBeLessThan(1800 * 1024);
  expect(boardMs).toBeLessThan(30_000);
});

test.describe('mit Sync-Server', () => {
  let server: Server;
  let syncPort = 0;
  let connectedAt = 0;
  const conns: { disconnect(): Promise<void> }[] = [];

  test.beforeAll(async () => {
    ({ server, port: syncPort } = await startSyncServer({
      async onAuthenticate() {
        return { session: 'load' };
      },
      async onConnect() {
        connectedAt ||= Date.now();
      },
    }));
    const conn = await server.hocuspocus.openDirectConnection('board:b-plan', {});
    await conn.transact((doc: Y.Doc) => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      for (let i = 0; i < 300; i++) {
        const m = new Y.Map<unknown>();
        const fields = { id: `n-${i}`, type: 'sticky', x: (i % 20) * 240, y: Math.floor(i / 20) * 240, w: 200, h: 200, color: '#fff27a', text: `Notiz ${i}`, z: `a${String(i).padStart(4, '0')}`, createdBy: 'm:12', updatedAt: new Date().toISOString() };
        for (const [k, v] of Object.entries(fields)) m.set(k, v);
        objects.set(fields.id, m);
      }
    });
    conns.push(conn);
  });

  test.afterAll(async () => {
    for (const c of conns) await c.disconnect();
    await server?.destroy();
  });

  test('Handy mit 4G: Sync-Verbindung startet, bevor Tiptap geladen ist', async ({ page, context }) => {
    test.setTimeout(120_000);
    await context.addCookies([{ name: 'stachel_session', value: 'load', domain: 'localhost', path: '/' }]);
    await installFakeApi(page, { loggedIn: true, boards: sampleBoards(), syncPort });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

    connectedAt = 0;
    const t0 = Date.now();
    await page.goto('/?b=b-plan');
    await expect(page.locator('[data-id="n-0"]')).toBeVisible({ timeout: 60_000 });
    const boardMs = Date.now() - t0;
    await expect(page.getByTestId('status')).toHaveText('Live', { timeout: 30_000 });
    const syncMs = connectedAt - t0;
    // wann die Pakete fertig waren (relativ zum Seitenstart)
    const chunks = await page.evaluate(() =>
      (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
        .filter((r) => /\/assets\/(EditorPage|RichEdit)-[\w-]+\.js$/.test(r.name))
        .map((r) => ({ name: new URL(r.name).pathname.replace(/^\/assets\/|-[\w-]+\.js$/g, ''), start: Math.round(r.startTime), end: Math.round(r.responseEnd) })),
    );
    console.log(`Sync verbunden nach ${syncMs} ms, Board mit Inhalt nach ${boardMs} ms; Pakete: ${chunks.map((c) => `${c.name} ${c.start}–${c.end} ms`).join(', ')}`);
    expect(connectedAt).toBeGreaterThan(0);
    // die Verbindung wartet nicht mehr auf den Rich-Text-Editor
    expect(syncMs).toBeLessThan(boardMs);
    expect(boardMs).toBeLessThan(30_000);
  });
});
