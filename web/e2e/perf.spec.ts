// Performance mit 2000 Objekten: Zoomen in allen Stufen (bis „Alles einpassen“ ≈ 7 %) und Ziehen bei 100 % / 50 %.
// Läuft im normalen E2E-Lauf (Dev-Server). Robust gegen Rechnerlast: Geprüft wird vor allem, WIE VIEL neu gerendert
// wird (Zähler aus ObjectLayer, deterministisch); die Hauptthread-Arbeit pro Frame (Chrome-Metrik TaskDuration) nur mit
// großzügiger Grenze. Die Bildzeit (rAF) wird nur protokolliert. Genaue Zahlen gegen den Build: perf-scale.spec.ts.
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { camera, openOffline } from './helpers';

async function taskMs(cdp: CDPSession): Promise<number> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return (metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0) * 1000;
}

/** Läuft `frames` Frames lang `step(i)` im Browser; liefert ms pro Frame (Bildzeit und Hauptthread-Arbeit). */
const renders = (page: Page): Promise<{ culls: number; views: number }> => page.evaluate(() => ({ ...(window as any).__stachelRenderStats }));

/**
 * Hauptthread-Arbeit pro Frame (ms): allein auf dem Runner mit Dev-Server 4–17 ms, mit 4 parallelen Workern aber bis
 * ≈ 85 ms (TaskDuration ist Wandzeit, CPU-Konkurrenz zählt mit). Daher nur Schutz gegen Katastrophen; Regressionen
 * fangen die Render-Zähler, genaue Zeiten misst perf-scale.spec.ts gegen den Build (eigener Lauf, ein Worker).
 */
const WORK_LIMIT = 250;

async function measure(page: Page, cdp: CDPSession, frames: number, kind: 'zoom' | 'drag') {
  const before = await taskMs(cdp);
  const r0 = await renders(page);
  const frameMs = await page.evaluate(
    async ({ frames, kind }) => {
      const board = document.querySelector('[data-testid="board"]')!;
      const fire = (type: string, x: number, y: number, target: Element = board) =>
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0, buttons: 1, isPrimary: true }));
      // Ziehen: auf dem Objekt unter dem Punkt beginnen (wie ein echter Klick)
      if (kind === 'drag') fire('pointerdown', 720, 450, document.elementFromPoint(720, 450) ?? board);
      const t0 = performance.now();
      for (let i = 1; i <= frames; i++) {
        if (kind === 'zoom')
          board.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 720, clientY: 450, deltaY: i % 2 ? 6 : -6, ctrlKey: true }));
        else fire('pointermove', 720 + i * 3, 450 + i * 2);
        await new Promise((r) => requestAnimationFrame(r));
      }
      const dt = (performance.now() - t0) / frames;
      if (kind === 'drag') fire('pointerup', 720, 450);
      return dt;
    },
    { frames, kind },
  );
  const work = ((await taskMs(cdp)) - before) / frames;
  const r1 = await renders(page);
  return { frameMs, work, views: r1.views - r0.views };
}

test('2000 Objekte: Zoomen und Ziehen in allen Zoomstufen', async ({ page }) => {
  test.setTimeout(120_000);
  await openOffline(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.evaluate(() => (window as any).__stachel.seedMany(2000));
  await expect.poll(() => page.evaluate(() => (window as any).__stachel.store.getSnapshot().ordered.length)).toBe(2000);

  // „Alles einpassen“: alle 2000 im Bild, aber nur als einfache Flächen (kein Text, Pin, Schatten)
  await page.getByRole('button', { name: 'Alles einpassen' }).click();
  expect((await camera(page)).z).toBeLessThan(0.1);
  await expect(page.locator('[data-type="sticky"]')).toHaveCount(2000);
  await expect(page.locator('.obj-lod--sticky')).toHaveCount(2000);
  await expect(page.locator('.sticky-text')).toHaveCount(0);
  await measure(page, cdp, 5, 'zoom'); // Aufwärmen
  const fit = await measure(page, cdp, 40, 'zoom');
  console.log(`Zoom bei Einpassen (2000 sichtbar): ${fit.frameMs.toFixed(1)} ms/Frame, Hauptthread ${fit.work.toFixed(1)} ms, ${fit.views} Objekt-Renders`);
  // eingepasst bleibt jedes Objekt eine Fläche: Zoomen rendert keine Objekte neu
  expect(fit.views).toBeLessThan(50);
  expect(fit.work).toBeLessThan(WORK_LIMIT);

  // Übergang: alle sichtbaren Notizen in voller Darstellung
  for (const z of [0.22, 0.5, 1]) {
    await page.evaluate((z) => (window as any).__stachel.setCamera({ x: 40, y: 40, z }), z);
    await expect.poll(() => page.locator('.obj-sticky').count()).toBeGreaterThan(0);
    await measure(page, cdp, 5, 'zoom');
    const r = await measure(page, cdp, 30, 'zoom');
    const n = await page.locator('.obj-sticky').count();
    console.log(`Zoom bei ${Math.round(z * 100)} % (${n} Notizen voll): ${r.frameMs.toFixed(1)} ms/Frame, Hauptthread ${r.work.toFixed(1)} ms, ${r.views} Objekt-Renders`);
    // nur Objekte, die ins Bild kommen oder die Detailstufe wechseln – nicht alle sichtbaren je Frame (30 × n)
    expect(r.views).toBeLessThan(Math.max(200, n * 6));
    expect(r.work).toBeLessThan(WORK_LIMIT);
  }

  // Ziehen einer Notiz bei 100 % und 50 % (Schatten beim Ziehen vereinfacht)
  for (const z of [1, 0.5]) {
    await page.evaluate((z) => (window as any).__stachel.setCamera({ x: 720 - 100 * z, y: 450 - 100 * z, z }), z);
    await page.waitForTimeout(250);
    const r = await measure(page, cdp, 40, 'drag');
    console.log(`Ziehen bei ${z * 100} %: ${r.frameMs.toFixed(1)} ms/Frame, Hauptthread ${r.work.toFixed(1)} ms, ${r.views} Objekt-Renders`);
    // je Frame höchstens die gezogene Notiz (StrictMode im Dev-Server: doppelt) – nicht die Nachbarn
    expect(r.views).toBeLessThan(40 * 2 + 20);
    expect(r.work).toBeLessThan(WORK_LIMIT);
  }
  // die Notiz wurde tatsächlich verschoben
  const moved = await page.evaluate(() => (window as any).__stachel.store.getSnapshot().ordered[0]);
  expect(moved.x).toBeGreaterThan(0);
});
