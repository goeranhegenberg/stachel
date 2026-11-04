// Baut dist/server/src/index.js: ein ES-Modul mit dem Server und den mitbenutzten Dateien aus web/src (Native-API,
// server/src/native/web-impl.ts) und shared/. npm-Pakete bleiben extern (zur Laufzeit aus server/node_modules, eine
// Yjs-Instanz). Typprüfung vorher mit tsc (package.json "build").
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

fs.rmSync(path.join(here, 'dist'), { recursive: true, force: true });
await build({
  entryPoints: [path.join(here, 'src/index.ts')],
  outfile: path.join(here, 'dist/server/src/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  // ohne die `paths` aus tsconfig.json (die gelten nur für die Typprüfung)
  tsconfigRaw: { compilerOptions: { target: 'ES2023' } },
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'warning',
  plugins: [
    {
      // Brücke zum Web-Code: Typprüfung gegen web-decl.d.ts, gebündelt wird die echte Umsetzung
      name: 'stachel-web',
      setup(b) {
        b.onResolve({ filter: /^#stachel-web$/ }, () => ({ path: path.join(here, 'src/native/web-impl.ts') }));
      },
    },
  ],
});