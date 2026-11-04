// Erzeugt src/layout/metrics.json: Zeichenbreiten der Board-Schriften (Barlow, Barlow Condensed) je Schnitt, gemessen
// im echten Chromium mit den Schriften der Web-App. Damit misst der MCP-Server Texte (Mindmap-Knoten, Kartenhöhen,
// Text-Breiten, Tabellenzeilen) ohne Browser fast so genau wie die Web-App (ohne Unterschneidung).
// Aufruf (laufender Stachel-Server, z. B. Sandbox): node scripts/gen-metrics.mjs http://127.0.0.1:8617
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://127.0.0.1:8617';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/layout/metrics.json');

const chars = [];
for (let c = 32; c < 127; c++) chars.push(String.fromCharCode(c));
for (let c = 160; c < 384; c++) chars.push(String.fromCharCode(c));
for (const ch of '–—‘’‚“”„…•€™→←↑↓✓✔×·°§²³½¼¾€') if (!chars.includes(ch)) chars.push(ch);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${url}/?offline=1`);
await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded');
const result = await page.evaluate(async (chars) => {
  const specs = [
    ['Barlow', [400, 500, 600, 700, 800]],
    ['Barlow Condensed', [500, 600, 700]],
  ];
  const ctx = document.createElement('canvas').getContext('2d');
  const fonts = {};
  for (const [family, weights] of specs) {
    for (const w of weights) {
      await document.fonts.load(`${w} 100px "${family}"`, chars.join(''));
      ctx.font = `${w} 100px "${family}", system-ui, sans-serif`;
      fonts[`${family}|${w}`] = chars.map((ch) => Math.round(ctx.measureText(ch).width * 10) / 1000);
    }
  }
  return fonts;
}, chars);
await browser.close();
fs.writeFileSync(out, JSON.stringify({ size: 1, chars: chars.join(''), fonts: result }) + '\n');
console.log(`geschrieben: ${out} (${chars.length} Zeichen, ${Object.keys(result).length} Schnitte)`);
