import { defineConfig, devices } from '@playwright/test';

/** Vite-Port; per PW_PORT einstellbar, damit parallele Läufe nicht kollidieren. */
const PORT = Number(process.env.PW_PORT ?? 5918);
/** Ziel des Vite-Proxys für /sync. Die Sync-Specs nutzen ihn nicht mehr (eigener freier Port pro Worker, e2e/syncServer.ts). */
export const TEST_SYNC_PORT = Number(process.env.PW_SYNC_PORT ?? 8195);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/?offline=1`,
    reuseExistingServer: false,
    env: { STACHEL_SERVER: `http://localhost:${TEST_SYNC_PORT}` },
    timeout: 60_000,
  },
});
