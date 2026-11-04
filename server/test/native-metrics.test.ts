// Schriftmaße der Native-API (Vertrag §8.13, server/src/native/text-metrics.*): alle Schnitte der Web-App da (direkt
// oder als Alias), die drei Mindmap-Schnitte mit unverändertem Schlüssel, Messung wie `measureText` im Web
// (Familie aus dem CSS-Namen, Gewicht, kursiv) – und der Web-Code misst auf dem Server damit.
import { describe, expect, it } from 'vitest';
import metrics from '../src/native/text-metrics.json';
import { metricsFamily, metricsMeasure } from '../src/native/text-metrics';
import '#stachel-web';
import { measureText } from '../../web/src/editor/measureText';

const FAMILIES = ['Barlow', 'Barlow Condensed', 'Source Serif 4', 'JetBrains Mono'];
const WEIGHTS = [400, 500, 600, 700, 800, 900];
const fonts = metrics.fonts as Record<string, { widths: number[]; pairs: Record<string, number>; triples: Record<string, number> }>;
const aliases = (metrics as { aliases: Record<string, string> }).aliases;

describe('Schriftmaße', () => {
  it('jeder Schnitt der Web-App ist gemessen oder Alias eines gemessenen derselben Familie', () => {
    for (const f of FAMILIES) {
      for (const italic of [false, true]) {
        for (const w of WEIGHTS) {
          const key = `${f}${italic ? ' Italic' : ''}|${w}`;
          const target = fonts[key] ? key : aliases[key];
          expect(target, key).toBeTruthy();
          expect(fonts[target!], key).toBeTruthy();
          expect(target!.startsWith(f), key).toBe(true);
        }
      }
    }
    for (const t of Object.values(aliases)) expect(fonts[t]).toBeTruthy();
  });

  it('Tabellen im Format der App (Breite je Zeichen, Paare, Dreiergruppen), Mindmap-Schnitte unter ihrem Schlüssel', () => {
    const n = [...metrics.chars].length;
    for (const [k, t] of Object.entries(fonts)) {
      expect(t.widths.length, k).toBe(n);
      expect(typeof t.pairs).toBe('object');
      expect(typeof t.triples).toBe('object');
    }
    for (const k of ['Barlow Condensed|700', 'Barlow|600', 'Barlow|500']) expect(fonts[k]).toBeTruthy();
  });

  it('Familie aus dem CSS-Namen: erster Name, ohne Anführungszeichen, „sans-serif“ als Rückfall zählt nicht', () => {
    expect(metricsFamily('"Barlow Condensed"')).toBe('Barlow Condensed');
    expect(metricsFamily('Barlow, system-ui, sans-serif')).toBe('Barlow');
    expect(metricsFamily('"Source Serif 4", Georgia, serif')).toBe('Source Serif 4');
    expect(metricsFamily('"JetBrains Mono", ui-monospace, monospace')).toBe('JetBrains Mono');
    expect(metricsFamily('irgendwas')).toBe('Barlow');
  });

  it('misst je Schnitt: fett breiter, kursiv eigene Tabelle, Mono gleich breit, Unterschneidung zählt', () => {
    const t = 'Sommerfest im Park 2027';
    expect(metricsMeasure(t, 20, 700)).toBeGreaterThan(metricsMeasure(t, 20, 500));
    expect(metricsMeasure(t, 20, 900)).toBeGreaterThan(metricsMeasure(t, 20, 700));
    expect(metricsMeasure(t, 20, 500, true)).not.toBe(metricsMeasure(t, 20, 500, false));
    expect(metricsMeasure(t, 20, 500, false, '"Source Serif 4"')).not.toBe(metricsMeasure(t, 20, 500));
    expect(metricsMeasure(t, 20, 500, false, '"Barlow Condensed"')).toBeLessThan(metricsMeasure(t, 20, 500));
    expect(metricsMeasure('iiii', 10, 400, false, '"JetBrains Mono"')).toBeCloseTo(metricsMeasure('MMMM', 10, 400, false, '"JetBrains Mono"'), 6);
    const w = fonts['Barlow|500']!.widths;
    const i = (c: string) => [...metrics.chars].indexOf(c);
    expect(metricsMeasure('AV', 1000, 500)).toBeCloseTo(w[i('A')]! + w[i('V')]! + (fonts['Barlow|500']!.pairs['AV'] ?? 0), 6);
    // Alias = gleiche Zahlen
    expect(metricsMeasure(t, 20, 500, false, '"JetBrains Mono"')).toBe(metricsMeasure(t, 20, 400, false, '"JetBrains Mono"'));
    // Zwischengewichte runden, außerhalb 400–900 begrenzt
    expect(metricsMeasure(t, 20, 650)).toBe(metricsMeasure(t, 20, 700));
    expect(metricsMeasure(t, 20, 100)).toBe(metricsMeasure(t, 20, 400));
  });

  it('der Web-Code misst auf dem Server mit den Schriftmaßen (measureText → metricsMeasure)', () => {
    for (const [fam, w, it] of [['Barlow', 500, false], ['"Barlow Condensed"', 700, false], ['Barlow', 700, true], ['"Source Serif 4"', 600, false]] as const) {
      expect(measureText('Bühne & Technik', 15, w, it, fam)).toBe(metricsMeasure('Bühne & Technik', 15, w, it, fam));
    }
  });
});
