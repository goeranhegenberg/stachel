// Baut dist/stachel-mcp.mjs: ein ES-Modul mit dem MCP-Server und den mitbenutzten Dateien aus web/ und shared/.
// npm-Pakete bleiben extern (werden zur Laufzeit aus mcp/node_modules geladen, eine Yjs-Instanz).
import { build } from 'esbuild';
import fs from 'node:fs';

fs.rmSync('dist', { recursive: true, force: true });
await build({
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/stachel-mcp.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  // ohne die `paths` aus tsconfig.json (die gelten nur für die Typprüfung), sonst würde Yjs eingebündelt
  tsconfigRaw: { compilerOptions: { target: 'ES2023' } },
  sourcemap: true,
  legalComments: 'none',
  banner: { js: '// stachel-mcp – gebaut aus mcp/src (siehe docs/features/mcp.md)' },
  logLevel: 'info',
});
