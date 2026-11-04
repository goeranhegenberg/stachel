// Bildschirmfotos mit höchster Treue: Headless Chromium öffnet die echte Web-App von Stachel im Offline-Modus
// (`/?offline=1`, ohne Anmeldung, ohne Anwesenheit, schreibt nichts zurück), bekommt den aktuellen Board-Stand als
// Objektliste, blendet die Bedienleisten aus und fotografiert den gewünschten Ausschnitt. Bilder holt der Renderer
// mit dem API-Token des Assistenten. Ein Browser für alle Aufträge, je Auftrag eine eigene Seite, Zeitlimit.
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import type { Obj } from '../board/model';
import type { Rect } from '../board/geometry';

export interface ShotLabel {
  n: number;
  id: string;
}

export interface ShotJob {
  /** Basis-URL der Web-App (dieselbe Stachel-Instanz) */
  webUrl: string;
  objects: Obj[];
  /** Board-Einstellungen (Hintergrund/Raster, Y-Struktur tools.settings) */
  settings?: Record<string, unknown>;
  /** Weltausschnitt */
  rect: Rect;
  /** Bildgröße in Pixeln */
  width: number;
  height: number;
  /** Nummern an diese Objekte heften */
  labels?: ShotLabel[];
  /** alles in voller Darstellung (sonst wie im Editor: kleine Objekte weit herausgezoomt nur als Fläche) */
  fullDetail?: boolean;
  /** Bilder laden (mit Token) */
  fetchImage: (path: string) => Promise<{ body: Buffer; type: string } | null>;
}

export interface RendererOptions {
  /** fester Browser-Pfad (sonst Playwright-Chromium, dann Chrome, dann Edge) */
  executablePath?: string;
  timeoutMs?: number;
  /** Browser nach so langer Pause schließen (Speicher) */
  idleCloseMs?: number;
}

const HIDE_CSS = `
.editor > :not(.board) { display: none !important; }
.collab-notices, .collab-layer, .ov-cursor, .ov-peer-sel, .ov-hover, .ov-selection, .splash { display: none !important; }
* { animation: none !important; transition: none !important; caret-color: transparent !important; }
#mcp-labels { position: fixed; inset: 0; pointer-events: none; z-index: 99999; font: 700 12px Barlow, system-ui, sans-serif; }
#mcp-labels span { position: absolute; transform: translate(-30%, -60%); background: #7048e8; color: #fff; border: 2px solid #fff; border-radius: 10px; padding: 0 5px; line-height: 16px; min-width: 12px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,.35); }
`;

export class Renderer {
  private browser: Promise<Browser> | null = null;
  private context: Promise<BrowserContext> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: RendererOptions = {}) {}

  private async launch(): Promise<Browser> {
    const args = ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu', '--js-flags=--max-old-space-size=512'];
    const attempts: (() => Promise<Browser>)[] = this.opts.executablePath
      ? [() => chromium.launch({ executablePath: this.opts.executablePath, args })]
      : [() => chromium.launch({ args }), () => chromium.launch({ channel: 'chrome', args }), () => chromium.launch({ channel: 'msedge', args })];
    let last: unknown;
    for (const a of attempts) {
      try {
        return await a();
      } catch (e) {
        last = e;
      }
    }
    throw new Error(
      `Kein Browser für Bildschirmfotos gefunden (${(last as Error)?.message?.split('\n')[0] ?? 'unbekannt'}). Lokal einmal "npx playwright install chromium" ausführen oder STACHEL_MCP_BROWSER auf Chrome/Edge setzen.`,
    );
  }

  private async ctx(): Promise<BrowserContext> {
    if (!this.browser) {
      this.browser = this.launch();
      this.browser.catch(() => (this.browser = null));
      this.context = null;
    }
    if (!this.context) {
      this.context = this.browser.then((b) => b.newContext({ deviceScaleFactor: 1, serviceWorkers: 'block', reducedMotion: 'reduce' }));
      this.context.catch(() => (this.context = null));
    }
    return this.context;
  }

  /** Ein Bild (PNG) des Ausschnitts; Aufträge laufen nacheinander. */
  shot(job: ShotJob): Promise<{ png: Buffer; legend: ShotLabel[] }> {
    const run = this.queue.then(() => this.render(job));
    this.queue = run.catch(() => {});
    return run;
  }

  private async render(job: ShotJob): Promise<{ png: Buffer; legend: ShotLabel[] }> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const timeout = this.opts.timeoutMs ?? 30_000;
    const context = await this.ctx();
    const page = await context.newPage().catch(async () => {
      // alter Browser abgestürzt: neu starten
      await this.close();
      return (await this.ctx()).newPage();
    });
    try {
      await page.setViewportSize({ width: job.width, height: job.height });
      page.setDefaultTimeout(timeout);
      await page.route('**/api/images/**', async (route) => {
        const u = new URL(route.request().url());
        const img = await job.fetchImage(u.pathname + u.search);
        if (img) await route.fulfill({ status: 200, body: img.body, contentType: img.type });
        else await route.fulfill({ status: 404, body: '' });
      });
      await page.goto(`${job.webUrl.replace(/\/+$/, '')}/?offline=1`, { waitUntil: 'load', timeout });
      await page.waitForFunction(() => (window as any).__stachel?.api?.(), undefined, { timeout });
      await page.addStyleTag({ content: HIDE_CSS });
      await page.evaluate(
        ({ objects, settings, rect, width, height, fullDetail }) => {
          const s = (window as any).__stachel;
          // Detailstufe: Texte auch klein ausschreiben (Register der Objekttypen, nur in dieser Seite)
          if (fullDetail && s.ext?.objectTypes) for (const t of s.ext.objectTypes.list()) s.ext.objectTypes.define({ ...t, lodPx: null });
          const store = s.store;
          const session = s.session;
          for (const o of objects) if (o.type === 'image' && typeof o.imageId === 'string') session.images?.set?.(o.imageId, `/api/images/${encodeURIComponent(o.imageId)}`);
          if (settings && Object.keys(settings).length) {
            const m = store.extMap('tools.settings', { undo: false });
            store.transact(() => Object.entries(settings).forEach(([k, v]) => m.set(k, v)));
          }
          store.createMany(objects);
          const api = s.api();
          api.setSelection?.([]);
          // Ausschnitt einpassen (8 % Rand)
          const pad = 0.04;
          const z = Math.min((width * (1 - 2 * pad)) / Math.max(1, rect.w), (height * (1 - 2 * pad)) / Math.max(1, rect.h), 4);
          api.setCamera({ x: width / 2 - (rect.x + rect.w / 2) * z, y: height / 2 - (rect.y + rect.h / 2) * z, z });
        },
        { objects: job.objects, settings: job.settings, rect: job.rect, width: job.width, height: job.height, fullDetail: job.fullDetail !== false },
      );
      // Schriften, Bilder, zwei Frames
      await page.evaluate(async () => {
        await document.fonts.ready;
        const imgs = [...document.querySelectorAll('img')] as HTMLImageElement[];
        await Promise.race([Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => ((i.onload = r), (i.onerror = r)))))), new Promise((r) => setTimeout(r, 6000))]);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
      await page.waitForTimeout(250);
      let legend: ShotLabel[] = [];
      if (job.labels?.length) {
        legend = await page.evaluate((labels) => {
          const s = (window as any).__stachel;
          const api = s.api();
          const snap = api.snapshot();
          const box = document.createElement('div');
          box.id = 'mcp-labels';
          const shown: { n: number; id: string }[] = [];
          for (const l of labels) {
            const o = snap.byId.get(l.id);
            const b = o && api.bounds(o);
            if (!b) continue;
            const p = api.toScreen({ x: b.x, y: b.y });
            if (p.x < -10 || p.y < -10 || p.x > innerWidth || p.y > innerHeight) continue;
            const el = document.createElement('span');
            el.textContent = String(l.n);
            el.style.left = `${Math.max(2, p.x)}px`;
            el.style.top = `${Math.max(10, p.y)}px`;
            box.appendChild(el);
            shown.push(l);
          }
          document.body.appendChild(box);
          return shown;
        }, job.labels);
      }
      const png = await page.screenshot({ type: 'png', timeout });
      return { png, legend };
    } finally {
      await page.close().catch(() => {});
      this.idleTimer = setTimeout(() => void this.close(), this.opts.idleCloseMs ?? 5 * 60_000);
      this.idleTimer.unref?.();
    }
  }

  async close() {
    const b = this.browser;
    this.browser = null;
    this.context = null;
    if (b) await (await b.catch(() => null))?.close().catch(() => {});
  }
}
