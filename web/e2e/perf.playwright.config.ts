// Performance-Läufe gegen den Produktions-Build (React ohne Dev-Prüfungen, gebündelt wie live).
// Aufruf: npx playwright test --config e2e/perf.playwright.config.ts
// Der Dev-Server (playwright.config.ts) misst React-Dev-Aufwand mit (jsxDEV, Prop-Prüfungen), Faktor 2–4 langsamer.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PW_PORT ?? 5938);
// Kennzeichen für die Specs (perf-scale, perf-load laufen nur gegen den Build)
process.env.STACHEL_PERF_PROD = '1';
/** Hocuspocus-Testserver für perf-memory.spec.ts (vite preview proxyt /sync dorthin, wie der Dev-Server) */
export const PERF_SYNC_PORT = Number(process.env.PW_PERF_SYNC_PORT ?? 8296);
process.env.STACHEL_PERF_SYNC_PORT = String(PERF_SYNC_PORT);
const OUT = 'node_modules/.perf-dist';

export default defineConfig({
  testDir: '.',
  testMatch: /perf.*\.spec\.ts/,
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: `npx vite build --outDir ${OUT} --emptyOutDir --logLevel warn${process.env.PERF_NOMINIFY ? " --minify false" : ""} && npx vite preview --outDir ${OUT} --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/?offline=1`,
    reuseExistingServer: false,
    timeout: 180_000,
    // Befehle laufen im web/-Ordner (Standard wäre der Ordner dieser Datei)
    cwd: '..',
    env: { STACHEL_SERVER: `http://localhost:${PERF_SYNC_PORT}` },
  },
});
