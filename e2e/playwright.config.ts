// Root-E2E: echter Server (server/dist) liefert web/dist aus, Fake-Identitätsdienst (Modus org).
// Vorher bauen: `npm run build` (baut web + server). Port per E2E_PORT (Standard 8397).
import { defineConfig, devices } from '@playwright/test';

export const E2E_PORT = Number(process.env.E2E_PORT ?? 8397);
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

export default defineConfig({
  testDir: './tests',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './support/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
    // keine Netzwerk-Aufrufe nach außen: alles läuft gegen 127.0.0.1
    serviceWorkers: 'block',
  },
});
