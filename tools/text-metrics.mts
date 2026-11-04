// Erzeugt server/src/native/text-metrics.json (Vertrag §8.13): Textmaße aller Schriften der Web-App, gemessen im echten
// Chromium mit den Schriften der Web-App (wie `measureText` in web/src/editor/measureText.ts per Canvas). Je Schnitt
// Zeichenbreiten, Unterschneidung je Zeichenpaar und Ligaturen je Dreiergruppe (fi/fl/ffi …) – damit misst der Server
// (Native-API: Mindmap-Layout, Web-Aktionen) und die Apps genau wie der Browser (< 0,01 px bei Alltagstext).
// Gemessen: Barlow, Barlow Condensed, Source Serif 4, JetBrains Mono, je 400–900 normal und kursiv. Nimmt der Browser
// für einen Schnitt dieselbe Schrift wie für einen anderen (gleiche Breiten), steht er nur unter `aliases`.
// Die App nimmt dieselbe Datei (flutter/packages/stachel_board/tool/gen_text_metrics.dart).
// Aufruf (Web-App unter <url>, z. B. Sandbox oder `python -m http.server` in web/dist):
//   server/node_modules/.bin/tsx tools/text-metrics.mts http://127.0.0.1:8600
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore – Playwright liegt in web/node_modules (E2E der Web-App)
import { chromium } from '../web/node_modules/playwright/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] ?? 'http://127.0.0.1:8600';
const out = path.join(ROOT, 'server/src/native/text-metrics.json');

/** Familien der Web-App (main.tsx, editor/ObjectLayer.tsx, features/richtext/fonts.ts); Gewichte 400–900, normal + kursiv */
const FAMILIES = ['Barlow', 'Barlow Condensed', 'Source Serif 4', 'JetBrains Mono'];
const WEIGHTS = [400, 500, 600, 700, 800, 900];
// Reihenfolge = welcher gleiche Schnitt die Tabelle bekommt (die übrigen werden Alias): die Mindmap-Schnitte zuerst
// (Schlüssel und Werte wie bisher), dann je Familie normal vor kursiv, leichte vor schweren Gewichten
const FIRST: Spec[] = [['Barlow Condensed', 700, false], ['Barlow', 600, false], ['Barlow', 500, false]];
type Spec = [family: string, weight: number, italic: boolean];
const SPECS: Spec[] = [...FIRST];
for (const f of FAMILIES) for (const italic of [false, true]) for (const w of WEIGHTS) if (!SPECS.some((s) => s[0] === f && s[1] === w && s[2] === italic)) SPECS.push([f, w, italic]);
/** Gemessen in dieser Schriftgröße; Breiten in 1/1000 em */
const SIZE = 1000;

const chars: string[] = [];
for (let c = 32; c < 127; c++) chars.push(String.fromCharCode(c));
for (let c = 160; c < 384; c++) chars.push(String.fromCharCode(c));
for (const ch of '–—‘’‚“”„…•€™→←↑↓✓✔×·°§²³½¼¾') if (!chars.includes(ch)) chars.push(ch);
/** Ligaturen gibt es nur zwischen Buchstaben */
const letters = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZäöüßÄÖÜ'];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${url}/?offline=1`);
await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded');
// als Text übergeben: tsx/esbuild würde in eine Funktion Hilfsaufrufe (__name) einbauen, die es im Browser nicht gibt
const MEASURE = `async ({ chars, letters, specs, size }) => {
  const ctx = document.createElement('canvas').getContext('2d');
  const round = (v) => Math.round(v * 100) / 100;
  const fontOf = ([family, weight, italic]) => (italic ? 'italic ' : '') + weight + ' ' + size + 'px "' + family + '", system-ui, sans-serif';
  const families = new Set([...document.fonts].map((f) => f.family.replace(/["']/g, '')));
  for (const [family] of specs) if (!families.has(family)) throw new Error('Schrift fehlt in der Seite: ' + family);
  // erst alle Schnitte laden und Breiten messen, dann gleiche Schnitte zusammenfassen
  const all = [];
  for (const spec of specs) {
    await document.fonts.load(fontOf(spec).replace(', system-ui, sans-serif', ''), chars.join(''));
    ctx.font = fontOf(spec);
    all.push({ spec, widths: chars.map((c) => ctx.measureText(c).width) });
  }
  const result = {};
  const aliases = {};
  const unique = [];
  const keyOf = ([f, w, i]) => f + (i ? ' Italic' : '') + '|' + w;
  for (const m of all) {
    // gleiche Schriftdatei: gleiche Breiten der Grundzeichen (bis U+00FF; Symbole ohne eigene Glyphe kommen aus
    // Systemschriften und schwanken je Gewicht) und gleiche Unterschneidung in einer Stichprobe
    const same = unique.find((u) => u.spec[0] === m.spec[0] && chars.every((c, i) => c.codePointAt(0) >= 0x100 || u.widths[i] === m.widths[i]) && (() => {
      for (const s of ['AV', 'To', 'fi', 'Wa', 'ry', 'LT', 'P.', 'ff', 'Yo', 'Te', 'av', 'y,', 'kö', 'Fä', 'rt']) {
        ctx.font = fontOf(u.spec); const a = ctx.measureText(s).width;
        ctx.font = fontOf(m.spec); const b = ctx.measureText(s).width;
        if (a !== b) return false;
      }
      return true;
    })());
    if (same) aliases[keyOf(m.spec)] = keyOf(same.spec);
    else unique.push(m);
  }
  for (const { spec, widths: raw } of unique) {
    ctx.font = fontOf(spec);
    const m = (s) => ctx.measureText(s).width;
    const widths = raw;
    const w = new Map(chars.map((c, i) => [c, widths[i]]));
    const pairs = {};
    for (const a of chars) for (const b of chars) {
      const k = m(a + b) - w.get(a) - w.get(b);
      if (Math.abs(k) > 0.05) pairs[a + b] = round(k);
    }
    const triples = {};
    for (const a of letters) for (const b of letters) for (const c of letters) {
      const k = m(a + b + c) - w.get(a) - w.get(b) - w.get(c) - (pairs[a + b] ?? 0) - (pairs[b + c] ?? 0);
      if (Math.abs(k) > 0.05) triples[a + b + c] = round(k);
    }
    result[keyOf(spec)] = { widths: widths.map(round), pairs, triples };
  }
  return { fonts: result, aliases };
}`;
type Metrics = Record<string, { widths: number[]; pairs: Record<string, number>; triples: Record<string, number> }>;
const { fonts, aliases } = (await page.evaluate(`(${MEASURE})(${JSON.stringify({ chars, letters, specs: SPECS, size: SIZE })})`)) as { fonts: Metrics; aliases: Record<string, string> };
await browser.close();
fs.writeFileSync(out, `${JSON.stringify({ version: 1, size: SIZE, chars: chars.join(''), fonts, aliases })}
`);
console.log(`geschrieben: ${path.relative(ROOT, out)} (${chars.length} Zeichen, ${Object.keys(fonts).length} Schnitte, ${Object.keys(aliases).length} Aliasse, ${Math.round(fs.statSync(out).size / 1024)} KB)`);
for (const [k, f] of Object.entries(fonts)) console.log(`  ${k}: ${Object.keys(f.pairs).length} Paare, ${Object.keys(f.triples).length} Ligaturen`);
for (const [k, v] of Object.entries(aliases)) console.log(`  ${k} → ${v}`);
