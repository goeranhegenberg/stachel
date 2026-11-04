// Last-Messung mit gemischten Boards (2000/5000/10000 Objekte: Rich-Text-Notizen, Formen, Text, Bilder, Verbinder).
// Gemessen wird die Arbeit des Hauptthreads (Chrome-DevTools-Metrik TaskDuration) statt der Bildzeit: Sie hängt kaum von
// der Rechnerlast ab (headless taktet rAF ohnehin mit ≈ 16,7 ms). Grenzwerte mit viel Luft, damit nur echte Regressionen
// (z. B. Culling kaputt, O(n) pro Frame, Re-Render aller Objekte bei Cursor-Bewegungen) auffallen.
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { openOffline } from './helpers';

async function taskMs(cdp: CDPSession): Promise<number> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return (metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0) * 1000;
}

/** Gemischtes Board im Raster (240 px Abstand) anlegen; liefert ms bis zum ersten gezeichneten Frame. */
export async function seedMixed(page: Page, n: number): Promise<number> {
  return page.evaluate(async (n) => {
    const st = (window as any).__stachel;
    // 8 verschiedene Bilder (je 800×600), mehrfach verwendet
    const imageIds: string[] = [];
    for (let k = 0; k < 8; k++) {
      const c = document.createElement('canvas');
      c.width = 800;
      c.height = 600;
      const g = c.getContext('2d')!;
      g.fillStyle = `hsl(${k * 45} 70% 55%)`;
      g.fillRect(0, 0, 800, 600);
      g.fillStyle = '#fff';
      g.fillRect(100 + k * 20, 100, 300, 200);
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
      imageIds.push((await st.session.uploadImage(new File([blob], `b${k}.png`, { type: 'image/png' }))).imageId);
    }
    const cols = Math.ceil(Math.sqrt(n));
    const colors = ['#fff27a', '#c9e14a', '#ffb0d2', '#a6d8ff'];
    const list: any[] = [];
    for (let i = 0; i < n; i++) {
      const x = (i % cols) * 240;
      const y = Math.floor(i / cols) * 240;
      const id = `o${i}`;
      const kind = i % 20;
      if (kind < 10) {
        const a = `Notiz ${i + 1} mit `;
        const content = {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: a }, { type: 'text', text: 'fettem', marks: [{ type: 'bold' }] }, { type: 'text', text: ' Text' }] },
            { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Punkt eins' }] }] }] },
          ],
        };
        list.push({ id, type: 'sticky', x, y, w: 200, h: 200, color: colors[i % 4], text: `${a}fettem Text\nPunkt eins`, content });
      } else if (kind < 15) list.push({ id, type: 'shape', shape: kind % 2 ? 'ellipse' : 'rect', x, y: y + 40, w: 200, h: 120, color: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2, text: `Form ${i}`, fontSize: 20 });
      else if (kind < 17) list.push({ id, type: 'text', x, y: y + 80, w: 200, h: 30, fontSize: 22, text: `Überschrift ${i}`, color: '#0a0a0a' });
      else if (kind === 17) list.push({ id, type: 'image', x, y: y + 25, w: 200, h: 150, imageId: imageIds[i % 8] });
      else list.push({ id, type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: `o${i - 8}` }, to: { objectId: `o${i - 6}` }, color: '#0a0a0a', strokeWidth: 2, arrowEnd: true });
    }
    const t0 = performance.now();
    st.store.createMany(list);
    st.store.undoManager.clear();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - t0;
  }, n);
}

type Kind = 'pan' | 'zoom' | 'drag' | 'peers';

/** `frames` Frames lang eine Geste; ms pro Frame (Bildzeit) und Hauptthread-Arbeit pro Frame. */
export async function measure(page: Page, cdp: CDPSession, frames: number, kind: Kind, at = { x: 720, y: 450 }) {
  const before = await taskMs(cdp);
  const stats0 = await renders(page);
  const frameMs = await page.evaluate(
    async ({ frames, kind, at }) => {
      const st = (window as any).__stachel;
      const board = document.querySelector('[data-testid="board"]')!;
      const fire = (type: string, x: number, y: number, target: Element = board) =>
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0, buttons: 1, isPrimary: true }));
      if (kind === 'drag') fire('pointerdown', at.x, at.y, document.elementFromPoint(at.x, at.y) ?? board);
      const peer = (k: number, i: number) => ({
        clientId: 100 + k,
        user: { key: `p:${k}`, name: `Gast ${k}`, color: '#ec4e92' },
        cursor: { x: 200 + k * 50 + i * 4, y: 200 + i * 3 },
        selection: [],
        extra: {},
      });
      const t0 = performance.now();
      for (let i = 1; i <= frames; i++) {
        if (kind === 'zoom')
          board.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, deltaY: i % 2 ? 6 : -6, ctrlKey: true }));
        else if (kind === 'pan') {
          // Kamera direkt schieben (das Mausrad zoomt je nach Einstellung, Trackpad-Erkennung ist heuristisch)
          const c = st.getCamera();
          st.setCamera({ ...c, x: c.x - 9, y: c.y - 6 });
        }
        else if (kind === 'drag') fire('pointermove', at.x + i * 3, at.y + i * 2);
        // 5 andere Personen bewegen ihre Cursor (je Frame ein Awareness-Update pro Person)
        else for (let k = 0; k < 5; k++) st.session.setPeers(Array.from({ length: 5 }, (_, j) => peer(j, j <= k ? i : i - 1)));
        await new Promise((r) => requestAnimationFrame(r));
      }
      const dt = (performance.now() - t0) / frames;
      if (kind === 'drag') fire('pointerup', at.x + frames * 3, at.y + frames * 2);
      return dt;
    },
    { frames, kind, at },
  );
  const work = ((await taskMs(cdp)) - before) / frames;
  const stats1 = await renders(page);
  return { frameMs, work, culls: stats1.culls - stats0.culls, views: stats1.views - stats0.views };
}

/** Zähler aus ObjectLayer (Sichtbarkeit neu bestimmt / Objekt neu gerendert). */
export const renders = (page: Page): Promise<{ culls: number; views: number }> => page.evaluate(() => ({ ...(window as any).__stachelRenderStats }));

const fmt = (r: { frameMs: number; work: number; culls: number; views: number }) =>
  `${r.frameMs.toFixed(1)} ms/Frame, Hauptthread ${r.work.toFixed(1)} ms, Sichtbarkeit ${r.culls}×, Objekt-Renders ${r.views}`;

/**
 * Obergrenzen der Hauptthread-Arbeit pro Frame (ms). Bewusst großzügig (gemessen auf dem 8-Kern-Runner liegen die Werte
 * bei einem Bruchteil, siehe Bericht), eine Verdopplung fällt erst bei 10000 auf; ein Rückfall auf „alles neu zeichnen“
 * oder O(n)-Arbeit pro Frame dagegen sofort.
 */
const LIMIT = { pan: 30, zoom: 40, drag: 60, peers: 12, key: 60 };

// Grenzwerte gelten für den Produktions-Build; der Dev-Server misst React-Dev-Prüfungen mit (Faktor 2–4).
test.skip(!process.env.STACHEL_PERF_PROD, 'nur gegen den Produktions-Build (e2e/perf.playwright.config.ts)');

for (const n of [2000, 5000, 10000]) {
  test(`${n} gemischte Objekte: Laden, Schwenken, Zoomen, 200 ziehen, Cursor, Tippen`, async ({ page }) => {
    test.setTimeout(240_000);
    await openOffline(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const first = await seedMixed(page, n);
    console.log(`[${n}] Anlegen + erstes Rendern: ${first.toFixed(0)} ms`);
    expect(await page.evaluate(() => (window as any).__stachel.store.getSnapshot().ordered.length)).toBe(n);

    // Culling: bei 100 % nur ein kleiner Teil im DOM
    await page.evaluate(() => (window as any).__stachel.setCamera({ x: 40, y: 40, z: 1 }));
    await page.waitForTimeout(100);
    const dom = await page.locator('.obj').count();
    console.log(`[${n}] Objekte im DOM bei 100 %: ${dom}`);
    expect(dom).toBeLessThan(250);

    // Schwenken bei 100 % (Objekte wandern ins Bild und hinaus)
    await measure(page, cdp, 5, 'pan');
    const pan = await measure(page, cdp, 60, 'pan');
    console.log(`[${n}] Schwenken 100 %: ${fmt(pan)}`);
    expect(pan.work).toBeLessThan(LIMIT.pan);
    // nur hereinkommende Objekte rendern, nicht alle sichtbaren je Frame
    expect(pan.views).toBeLessThan(dom * 4);

    // Zoomen bei 30 % (viele Objekte voll) und bei „Alles einpassen“ (alle als Fläche)
    await page.evaluate(() => (window as any).__stachel.setCamera({ x: 40, y: 40, z: 0.3 }));
    await measure(page, cdp, 5, 'zoom');
    const zoom30 = await measure(page, cdp, 30, 'zoom');
    console.log(`[${n}] Zoomen 30 % (${await page.locator('.obj').count()} im DOM): ${fmt(zoom30)}`);
    expect(zoom30.work).toBeLessThan(LIMIT.zoom);

    await page.getByRole('button', { name: 'Alles einpassen' }).click();
    await page.waitForTimeout(400);
    await measure(page, cdp, 5, 'zoom');
    const zoomFit = await measure(page, cdp, 30, 'zoom');
    console.log(`[${n}] Zoomen eingepasst (${await page.locator('.obj').count()} im DOM): ${fmt(zoomFit)}`);
    expect(zoomFit.work).toBeLessThan(LIMIT.zoom * (n / 2000));
    // eingepasst ändert sich beim Zoomen nichts an den Objekten (alle als Fläche)
    expect(zoomFit.views).toBeLessThan(n / 10);

    // Andere Personen bewegen Cursor: die Objekte dürfen dabei nicht neu gerendert werden
    await page.evaluate(() => (window as any).__stachel.setCamera({ x: 40, y: 40, z: 1 }));
    await page.waitForTimeout(100);
    await measure(page, cdp, 5, 'peers');
    const peers = await measure(page, cdp, 60, 'peers');
    console.log(`[${n}] 5 fremde Cursor (5 Updates/Frame): ${fmt(peers)}`);
    expect(peers.work).toBeLessThan(LIMIT.peers);
    expect(peers.culls).toBe(0);
    expect(peers.views).toBe(0);

    // 200 ausgewählte Objekte ziehen (bei 50 %)
    const ids: string[] = await page.evaluate(() => {
      const st = (window as any).__stachel;
      const sel = st.store
        .getSnapshot()
        .ordered.filter((o: any) => o.type !== 'connector')
        .slice(0, 200)
        .map((o: any) => o.id);
      st.api().setSelection(sel);
      st.setCamera({ x: 620, y: 350, z: 0.5 });
      return sel;
    });
    await page.waitForTimeout(200);
    const grab = await page.evaluate(() => {
      const r = document.querySelector('[data-id="o0"]')!.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const drag = await measure(page, cdp, 40, 'drag', grab);
    console.log(`[${n}] 200 Objekte ziehen: ${fmt(drag)}`);
    expect(drag.work).toBeLessThan(LIMIT.drag);
    const moved = await page.evaluate((id) => (window as any).__stachel.store.get(id), ids[0]);
    expect(moved.x).toBeGreaterThan(0);

    // Tippen in einer Notiz (Rich-Text-Editor)
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as any).__stachel.setCamera({ x: 300, y: 200, z: 1 }));
    await page.waitForTimeout(150);
    await page.locator('[data-id="o1"]').dblclick();
    await expect(page.locator('[data-id="o1"] .ProseMirror')).toBeFocused();
    await page.keyboard.press('End');
    const t0 = await taskMs(cdp);
    const w0 = Date.now();
    const text = 'schnell getippt';
    for (const ch of text) await page.keyboard.press(ch === ' ' ? 'Space' : ch);
    const keyWork = ((await taskMs(cdp)) - t0) / text.length;
    console.log(`[${n}] Tippen: ${((Date.now() - w0) / text.length).toFixed(1)} ms/Taste (Playwright-Rundreise), Hauptthread ${keyWork.toFixed(1)} ms`);
    await expect(page.locator('[data-id="o1"] .ProseMirror')).toContainText(text);
    expect(keyWork).toBeLessThan(LIMIT.key);
  });
}
