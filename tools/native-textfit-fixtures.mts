// Referenzwerte der automatischen Schriftgröße für die Flutter-App (Paritäts-Audit F19): Haftnotiz (`stickyFontSize`)
// und Form (`shapeFontSize`) aus web/src/editor/textMeasure.ts, gerechnet im echten Chromium mit den Schriften der
// Web-App (Canvas `measureText` wie im Browser). Der Web-Code wird mit esbuild gebündelt und in die Seite geladen –
// nichts wird nachgebaut. Schreibt docs/native_fixtures/web/textfit.json; die App vergleicht ihre Portierung damit
// (packages/stachel_board/test/rest/textfit_web_reference_test.dart, liest die Datei direkt).
// Aufruf (Web-App unter <url>, z. B. Sandbox):
//   server/node_modules/.bin/tsx tools/native-textfit-fixtures.mts http://127.0.0.1:8790
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore – esbuild liegt in server/node_modules (Server-Build)
import { build } from '../server/node_modules/esbuild/lib/main.js';
// @ts-ignore – Playwright liegt in web/node_modules (E2E der Web-App)
import { chromium } from '../web/node_modules/playwright/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] ?? 'http://127.0.0.1:8600';
const out = path.join(ROOT, 'docs/native_fixtures/web/textfit.json');

const bundle = await build({
  stdin: {
    contents: `import { stickyFontSize, shapeFontSize } from './textMeasure';
      import { wrapLines } from '../board/textfit';
      import { measureText } from './measureText';
      (window as any).__textfit = { stickyFontSize, shapeFontSize, wrapLines, measureText };`,
    resolveDir: path.join(ROOT, 'web/src/editor'),
    loader: 'ts',
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
});

const TEXTS = [
  '',
  'Hallo',
  'Bühne',
  'Getränke besorgen',
  'Wer macht die Bar am Samstag?',
  'Das ist ein deutlich längerer Text für eine Haftnotiz mit vielen Wörtern',
  'Sommerfest-Festival-Planungs-Besprechung',
  'Donaudampfschifffahrtsgesellschaftskapitän',
  'Zeile eins\nZeile zwei\nZeile drei',
  'Kurz\n\nmit Leerzeile',
  'ÄÖÜ äöü ß – „Zitat“ … 100 % fertig!',
  'a b c d e f g h i j k l m n o p q r s t u v w x y z',
  'Ein sehr langer Absatz, der viele Zeilen braucht, damit die Schrift wirklich klein werden muss: Aufbau, Technik, Licht, Ton, Bühne, Catering, Einlass, Kasse, Awareness, Abbau und noch mehr.',
  'E-Mail an info@example.org schicken',
  '12:30 Soundcheck',
];
const STICKY_SIZES: [number, number][] = [
  [200, 200],
  [100, 100],
  [300, 200],
  [120, 240],
  [48, 48],
  [400, 400],
];
const FORMATS = [{}, { bold: true }, { italic: true }, { bold: true, italic: true }];
const SHAPES: [number, number, number][] = [
  [20, 168, 84],
  [32, 168, 84],
  [48, 300, 200],
  [20, 60, 30],
  [24, 120, 120],
];

const browser = await chromium.launch();
// die Seite verbietet Inline-Skripte (CSP); für das gebündelte Web-Modul hier ausgesetzt
const page = await browser.newPage({ bypassCSP: true });
await page.goto(`${url}/?offline=1`);
await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded');
await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
// als Text übergeben: tsx/esbuild würde in eine Funktion Hilfsaufrufe (__name) einbauen, die es im Browser nicht gibt
const RUN = `async ({ texts, stickies, formats, shapes }) => {
  for (const w of [500, 600, 700]) for (const it of ['', 'italic ']) await document.fonts.load(it + w + ' 16px Barlow');
  const f = window.__textfit;
  const cases = [];
  for (const text of texts) for (const [w, h] of stickies) for (const fmt of formats) {
    cases.push({ kind: 'sticky', text, w, h, bold: !!fmt.bold, italic: !!fmt.italic, fs: f.stickyFontSize(text, w, h, fmt) });
  }
  for (const text of texts) for (const [wanted, iw, ih] of shapes) for (const fmt of formats.slice(0, 2)) {
    cases.push({ kind: 'shape', text, wanted, innerW: iw, innerH: ih, bold: !!fmt.bold, italic: !!fmt.italic, fs: f.shapeFontSize(text, wanted, iw, ih, fmt) });
  }
  return cases;
}`;
const cases = await page.evaluate(`(${RUN})(${JSON.stringify({ texts: TEXTS, stickies: STICKY_SIZES, formats: FORMATS, shapes: SHAPES })})`);
await browser.close();

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  JSON.stringify({ about: 'Auto-Schriftgröße (stickyFontSize/shapeFontSize) im Chromium – tools/native-textfit-fixtures.mts', cases }, null, 1) + '\n',
);
console.log(`${(cases as unknown[]).length} Fälle → ${path.relative(ROOT, out)}`);
