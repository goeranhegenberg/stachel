// Textmessung ohne Browser: Zeichenbreiten der Board-Schriften aus metrics.json (scripts/gen-metrics.mjs, gemessen im
// Chromium mit den Schriften der Web-App). Unterschneidung fehlt, die Breiten liegen deshalb eher etwas darüber –
// Knoten und Karten werden lieber knapp zu breit als zu schmal.
import metrics from './metrics.json';

type Family = 'Barlow' | 'Barlow Condensed';

const index = new Map<string, number>();
[...metrics.chars].forEach((ch, i) => index.set(ch, i));
const tables = metrics.fonts as Record<string, number[]>;
const weightsOf = (family: Family) =>
  Object.keys(tables)
    .filter((k) => k.startsWith(`${family}|`))
    .map((k) => Number(k.split('|')[1]));

function table(family: Family, weight: number): number[] {
  const ws = weightsOf(family);
  const best = ws.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a), ws[0] ?? 500);
  return tables[`${family}|${best}`] ?? tables['Barlow|500']!;
}

/** Breite eines Zeichens, das nicht in der Tabelle steht (Emoji, CJK, Symbole), in em. */
function fallback(cp: number): number {
  if (cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf)) return 1.25; // Emoji
  if (cp >= 0x2e80 && cp <= 0xffef) return 1; // CJK u. Ä.
  return 0.56;
}

/** `family` wie in CSS: 'Barlow' (Standard) oder '"Barlow Condensed"'. */
const familyOf = (f: string): Family => (/condensed/i.test(f) ? 'Barlow Condensed' : 'Barlow');

/** Breite eines Textes in Weltpunkten (wie `measureText` in web/src/editor/textMeasure.ts). */
export function measureText(text: string, fs: number, weight = 500, _italic = false, family = 'Barlow'): number {
  const t = table(familyOf(family), weight);
  let em = 0;
  for (const ch of text) {
    const i = index.get(ch);
    em += i !== undefined ? t[i]! : fallback(ch.codePointAt(0) ?? 0);
  }
  return em * fs;
}
