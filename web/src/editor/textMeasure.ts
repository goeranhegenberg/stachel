// Textmessung per Canvas: automatische Schriftgröße für Haftnotizen, Schrumpfen bei Formen.
// Fett/kursiv werden mit gemessen (eigener Cache-Schlüssel), sonst passt die Auto-Größe nicht.
import { useSyncExternalStore } from 'react';
import { fitFontSize } from '../board/textfit';
import { measureText } from './measureText';

export { measureText };

export interface TextFormat {
  bold?: boolean;
  italic?: boolean;
}

const font = (weight: number, fs: number, italic = false, family = 'Barlow') => `${italic ? 'italic ' : ''}${weight} ${fs}px ${family}, system-ui, sans-serif`;

const cache = new Map<string, number>();
let fontsVersion = 0;
const listeners = new Set<() => void>();

if (typeof document !== 'undefined' && document.fonts) {
  const bump = () => {
    cache.clear();
    fontsVersion++;
    listeners.forEach((fn) => fn());
  };
  Promise.all([document.fonts.load(font(500, 16)), document.fonts.load(font(600, 16)), document.fonts.load('600 16px "Barlow Condensed"')])
    .then(bump)
    .catch(() => {});
  document.fonts.addEventListener?.('loadingdone', bump);
}

export function useFontsVersion() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => fontsVersion,
  );
}


const measurer = (weight: number, italic: boolean) => (text: string, fs: number) => measureText(text, fs, weight, italic);

/** Schriftgewicht nach Format (fett = 700, sonst Standard des Objekttyps). */
export const weightOf = (fmt: TextFormat | undefined, normal: number) => (fmt?.bold ? 700 : normal);
const fmtKey = (fmt: TextFormat | undefined) => `${fmt?.bold ? 'b' : ''}${fmt?.italic ? 'i' : ''}`;

function cached(key: string, compute: () => number) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const v = compute();
  if (cache.size > 4000) cache.clear();
  cache.set(key, v);
  return v;
}

/** Innenabstand einer Haftnotiz in Weltpunkten (nach der kürzeren Seite, damit rechteckige Notizen gleich wirken). */
export const stickyPadding = (w: number, h = w) => Math.round(Math.min(w, h) * 0.09);

/** Größte automatische Schrift einer Haftnotiz: nach der kürzeren Seite (Rechteck = gleiche Schrift wie Quadrat). */
export const stickyMaxFont = (w: number, h: number) => Math.max(8, (Math.min(w, h) * 0.82) / 4.6);

export function stickyFontSize(text: string, w: number, h: number, fmt?: TextFormat): number {
  return cached(`s|${fmtKey(fmt)}|${w}|${h}|${text}`, () => {
    const pad = stickyPadding(w, h);
    const innerW = Math.max(10, w - pad * 2);
    const innerH = Math.max(10, h - pad * 2);
    return fitFontSize(text, innerW * 0.96, innerH, measurer(weightOf(fmt, 500), !!fmt?.italic), { min: 5, max: stickyMaxFont(w, h) });
  });
}

/** Schrift einer Form: höchstens `wanted`, kleiner wenn der Text sonst nicht passt. */
export function shapeFontSize(text: string, wanted: number, innerW: number, innerH: number, fmt?: TextFormat): number {
  if (!text.trim()) return wanted;
  return cached(`f|${fmtKey(fmt)}|${wanted}|${Math.round(innerW)}|${Math.round(innerH)}|${text}`, () =>
    fitFontSize(text, innerW * 0.96, innerH, measurer(weightOf(fmt, 600), !!fmt?.italic), { min: 5, max: wanted }),
  );
}
