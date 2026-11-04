// Farben wie in der Web-App (Paletten aus shared/protocol.ts, web/src/board/colors.ts, shapes/palette.tsx).
// Der Assistent darf Farben als Hex (#rrggbb) oder als Namen angeben; Namen werden je nach Verwendung aufgelöst:
// `fill` = helle Flächenfarben (Notizen, Formen, Rahmen), `ink` = kräftige Strich-/Schrift-/Akzentfarben.

export type ColorUse = 'fill' | 'ink';

/**
 * Flächenfarben: die 36 Haftnotiz-Farben (STICKY_COLORS – Raster aus zwölf Farbtönen × hell/kräftig/dunkel), auch für
 * Formen und Rahmen. Auf dunklen Notizen schreibt die Web-App automatisch weiß (Kontrast nach WCAG).
 */
const FILL: Record<string, string> = {
  yellow: '#fff27a',
  green: '#c9e14a',
  pink: '#ffb3d1',
  blue: '#9fd3ff',
  orange: '#ffd08a',
  violet: '#e2d5ff',
  mint: '#b9ecd8',
  coral: '#ff9e8a',
  teal: '#7fd6e0',
  midblue: '#7fb2f0',
  stone: '#d4d4cc',
  sunflower: '#ffd23f',
  tangerine: '#ff8c42',
  raspberry: '#f25c78',
  grass: '#7bc950',
  lagoon: '#2ec4b6',
  lavender: '#b388eb',
  red: '#c62828',
  royal: '#1565c0',
  aubergine: '#6a1b9a',
  brown: '#6d4c41',
  charcoal: '#2b2b2b',
  lightindigo: '#cdd3f8',
  indigo: '#5c6bc0',
  sky: '#29a8e0',
  limegreen: '#a4b81c',
  ochre: '#8a6a00',
  wine: '#7f1d1d',
  blackberry: '#880e4f',
  night: '#283593',
  navy: '#0d2c6b',
  ocean: '#01579b',
  darkteal: '#00695c',
  forest: '#1b5e20',
  olive: '#556b2f',
  white: '#ffffff',
  gray: '#e9e9e4',
  black: '#000000',
};

/** Strich-, Schrift- und Akzentfarben (INK_COLORS, Kartenfarben). */
const INK: Record<string, string> = {
  black: '#0a0a0a',
  blue: '#1763b5',
  pink: '#ec4e92',
  green: '#7aa21b',
  orange: '#e8590c',
  violet: '#7048e8',
  teal: '#0c8599',
  red: '#c92a2a',
  gray: '#8a8a85',
  white: '#ffffff',
  yellow: '#fff27a',
  mint: '#b9ecd8',
};

const ALIASES: Record<string, string> = {
  gelb: 'yellow',
  grün: 'green',
  gruen: 'green',
  lime: 'green',
  rosa: 'pink',
  magenta: 'pink',
  blau: 'blue',
  hellblau: 'blue',
  lila: 'violet',
  violett: 'violet',
  purple: 'violet',
  weiß: 'white',
  weiss: 'white',
  grau: 'gray',
  grey: 'gray',
  schwarz: 'black',
  türkis: 'teal',
  tuerkis: 'teal',
  petrol: 'teal',
  rot: 'red',
  minze: 'mint',
  koralle: 'coral',
  salmon: 'coral',
  turquoise: 'teal',
  mittelblau: 'midblue',
  steingrau: 'stone',
  stein: 'stone',
  sonnengelb: 'sunflower',
  mandarine: 'tangerine',
  himbeere: 'raspberry',
  grasgrün: 'grass',
  grasgruen: 'grass',
  lagune: 'lagoon',
  lavendel: 'lavender',
  dunkelrot: 'red',
  tannengrün: 'forest',
  tannengruen: 'forest',
  dunkelgrün: 'forest',
  dunkelgruen: 'forest',
  waldgrün: 'forest',
  waldgruen: 'forest',
  hellindigo: 'lightindigo',
  himmelblau: 'sky',
  limette: 'limegreen',
  ocker: 'ochre',
  weinrot: 'wine',
  bordeaux: 'wine',
  brombeere: 'blackberry',
  nachtblau: 'night',
  marineblau: 'navy',
  marine: 'navy',
  ozeanblau: 'ocean',
  dunkeltürkis: 'darkteal',
  dunkeltuerkis: 'darkteal',
  oliv: 'olive',
  königsblau: 'royal',
  koenigsblau: 'royal',
  dunkelblau: 'royal',
  braun: 'brown',
  anthrazit: 'charcoal',
  dunkelgrau: 'charcoal',
};

/** Haftnotiz-Farben der Web-App (36, eine Quelle: shared/protocol.ts). */
export { STICKY_COLORS } from '../../../shared/protocol';

/** Alle Farbnamen für Beschreibungen. */
export const COLOR_NAMES = [...new Set([...Object.keys(FILL), ...Object.keys(INK)])];

/** Farbe auflösen; null = ungültig. */
export function resolveColor(v: string, use: ColorUse): string | null {
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  const name = ALIASES[s] ?? s;
  return (use === 'fill' ? (FILL[name] ?? INK[name]) : (INK[name] ?? FILL[name])) ?? null;
}

/** Lesbarer Name für eine Farbe (Rückmeldung an den Assistenten), sonst der Hex-Wert. */
export function colorLabel(hex: string | undefined): string | undefined {
  if (!hex) return undefined;
  const h = hex.toLowerCase();
  const hit = Object.entries(FILL).find(([, v]) => v === h) ?? Object.entries(INK).find(([, v]) => v === h);
  return hit ? `${hit[0]} ${h}` : h;
}

/** Deutsche Namen der Farbnamen (Cluster-Überschriften). */
export const COLOR_DE: Record<string, string> = {
  yellow: 'Gelb',
  green: 'Grün',
  pink: 'Rosa',
  blue: 'Blau',
  orange: 'Orange',
  violet: 'Lila',
  mint: 'Mint',
  white: 'Weiß',
  gray: 'Grau',
  black: 'Schwarz',
  red: 'Rot',
  teal: 'Türkis',
  coral: 'Koralle',
  midblue: 'Mittelblau',
  stone: 'Steingrau',
  sunflower: 'Sonnengelb',
  tangerine: 'Mandarine',
  raspberry: 'Himbeere',
  grass: 'Grasgrün',
  lagoon: 'Lagune',
  lavender: 'Lavendel',
  forest: 'Waldgrün',
  lightindigo: 'Hellindigo',
  indigo: 'Indigo',
  sky: 'Himmelblau',
  limegreen: 'Limette',
  ochre: 'Ocker',
  wine: 'Weinrot',
  blackberry: 'Brombeere',
  night: 'Nachtblau',
  navy: 'Marineblau',
  ocean: 'Ozeanblau',
  darkteal: 'Dunkeltürkis',
  olive: 'Oliv',
  royal: 'Königsblau',
  aubergine: 'Aubergine',
  brown: 'Braun',
  charcoal: 'Anthrazit',
};

/** Name zum Gruppieren nach Farbe (cluster). */
export const colorKey = (hex: string | undefined) => colorLabel(hex)?.split(' ')[0] ?? 'ohne Farbe';
