// Textbreite ohne Browser aus den im Chromium gemessenen Schriftmaßen (text-metrics.json, tools/text-metrics.mts,
// Vertrag §8.13): Zeichenbreiten + Unterschneidung je Paar + Ligaturen je Dreiergruppe – so genau wie Canvas
// `measureText` im Web (< 0,01 px bei Alltagstext). Alle Schriften der Web-App (Barlow, Barlow Condensed, Source Serif 4,
// JetBrains Mono), Gewichte 400–900, normal und kursiv. Für die Native-API (web-impl.ts setzt es als Messung des
// Web-Codes: Mindmap-Layout, Web-Aktionen). Die Apps rechnen mit derselben Datei genauso
// (packages/stachel_board/lib/src/mindmap/mind_measure.dart) – Reihenfolge der Additionen nicht ändern, sonst weichen
// die Ergebnisse in der letzten Stelle ab.
import metrics from './text-metrics.json';

interface FontTable {
  widths: number[];
  pairs: Record<string, number>;
  triples: Record<string, number>;
}

const SIZE = metrics.size;
const index = new Map<string, number>();
[...metrics.chars].forEach((ch, i) => index.set(ch, i));
const tables = metrics.fonts as Record<string, FontTable>;
const aliases = ((metrics as { aliases?: Record<string, string> }).aliases ?? {}) as Record<string, string>;

/** Breite eines Zeichens ohne Tabelle (Emoji, CJK, Symbole) in em – wie mcp/src/layout/measure.ts. */
function fallback(cp: number): number {
  if (cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf)) return 1.25;
  if (cp >= 0x2e80 && cp <= 0xffef) return 1;
  return 0.56;
}

/** Familie der Tabelle aus einem CSS-Namen (erster Name der Liste, ohne Anführungszeichen, Groß/klein egal). */
export function metricsFamily(family: string): string {
  const f = (family.split(',')[0] ?? '').replace(/["']/g, '').trim().toLowerCase();
  if (f.includes('condensed')) return 'Barlow Condensed';
  if (f.includes('serif')) return 'Source Serif 4';
  if (f.includes('mono')) return 'JetBrains Mono';
  return 'Barlow';
}

const cache = new Map<string, FontTable>();

function table(family: string, weight: number, italic: boolean): FontTable {
  const fam = `${metricsFamily(family)}${italic ? ' Italic' : ''}`;
  const w = Math.min(900, Math.max(400, Math.round(weight / 100) * 100));
  const key = `${fam}|${w}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let t = tables[key] ?? (aliases[key] ? tables[aliases[key]!] : undefined);
  if (!t) {
    // nächster gemessener Schnitt derselben Familie und Lage (ältere Dateien ohne alle Schnitte)
    let dist = Infinity;
    for (const [k, v] of Object.entries(tables)) {
      const [f, kw] = k.split('|');
      const d = Math.abs(Number(kw) - w);
      if (f === fam && d < dist) {
        t = v;
        dist = d;
      }
    }
  }
  t ??= italic ? table(family, weight, false) : tables['Barlow|500']!;
  cache.set(key, t);
  return t;
}

/** Breite von `text` in Weltpunkten (Signatur wie `measureText` im Web). */
export function metricsMeasure(text: string, fs: number, weight = 500, italic = false, family = 'Barlow'): number {
  const t = table(family, weight, italic);
  let sum = 0;
  let prev = '';
  let prev2 = '';
  for (const ch of text) {
    const i = index.get(ch);
    sum += i !== undefined ? t.widths[i]! : fallback(ch.codePointAt(0) ?? 0) * SIZE;
    if (prev) sum += t.pairs[prev + ch] ?? 0;
    if (prev2) sum += t.triples[prev2 + prev + ch] ?? 0;
    prev2 = prev;
    prev = ch;
  }
  return (sum / SIZE) * fs;
}
