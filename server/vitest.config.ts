import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Native-API: mitbenutzter Web-Code (src/native/web-impl.ts) soll dieselbe Yjs-Instanz wie der Server nehmen, nicht
  // die aus web/node_modules (zwei Yjs-Kopien vertragen sich nicht).
  resolve: {
    alias: [
      { find: /^#stachel-web$/, replacement: path.join(here, 'src/native/web-impl.ts') },
      { find: /^yjs$/, replacement: path.join(here, 'node_modules/yjs/dist/yjs.mjs') },
      { find: /^nanoid$/, replacement: path.join(here, 'node_modules/nanoid/index.js') },
      { find: /^fractional-indexing$/, replacement: path.join(here, 'node_modules/fractional-indexing/src/index.js') },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 20_000,
    pool: 'forks',
    execArgv: ['--disable-warning=ExperimentalWarning'],
  },
});