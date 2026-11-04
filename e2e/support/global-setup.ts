// Prüft nur, ob gebaut wurde; gebaut wird mit `npm run build` (dauert, deshalb nicht bei jedem Lauf).
import fs from 'node:fs';
import { SERVER_ENTRY, WEB_DIST } from './paths';

export default function globalSetup() {
  const missing = [
    [SERVER_ENTRY, 'server (npm --prefix ../server run build)'],
    [`${WEB_DIST}/index.html`, 'web (npm --prefix ../web run build)'],
  ].filter(([p]) => !fs.existsSync(p));
  if (missing.length) throw new Error(`Nicht gebaut: ${missing.map(([, w]) => w).join(', ')}. Erst \`npm run build\` im Ordner e2e/.`);
}
