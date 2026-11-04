// Schreibt docs/native_fixtures/web/constants.json (Vertrag §8.13) aus dem Web-Code (tools/native-web-constants-data.mts).
// Das Flutter-Paket stachel_board erzeugt daraus lib/src/web/web_constants.g.dart. Aufruf (im Stachel-Repo):
//   server/node_modules/.bin/tsx --tsconfig web/tsconfig.json tools/native-web-constants.mts
// flutter/packages/stachel_board liest die Datei direkt; danach den Dart-Generator tool/gen_web_constants.dart laufen lassen.
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CSS-Importe der Web-Module (Schriften, Modul-CSS) leer laden – Node kennt sie nicht
register('data:text/javascript,' + encodeURIComponent(`export async function load(url, ctx, next) { if (url.endsWith('.css')) return { format: 'module', source: 'export default {}', shortCircuit: true }; return next(url, ctx); }`));

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONSTANTS_FILE = path.join(ROOT, 'docs/native_fixtures/web/constants.json');
const { buildWebConstants } = await import('./native-web-constants-data.mts');
fs.mkdirSync(path.dirname(CONSTANTS_FILE), { recursive: true });
fs.writeFileSync(CONSTANTS_FILE, `${JSON.stringify(buildWebConstants(), null, 1)}\n`);
console.log(`geschrieben: ${path.relative(ROOT, CONSTANTS_FILE)} (${Math.round(fs.statSync(CONSTANTS_FILE).size / 1024)} KB)`);
