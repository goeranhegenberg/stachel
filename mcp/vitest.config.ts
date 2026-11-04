import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Mitbenutzte Dateien aus web/ (Rich-Text, Mindmap-Layout) sollen dieselbe Yjs-Instanz wie der MCP-Server nehmen,
  // nicht die aus web/node_modules (zwei Yjs-Kopien vertragen sich nicht).
  resolve: {
    alias: [
      { find: /^yjs$/, replacement: path.join(here, 'node_modules/yjs/dist/yjs.mjs') },
      { find: /^nanoid$/, replacement: path.join(here, 'node_modules/nanoid/index.js') },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
  },
});
