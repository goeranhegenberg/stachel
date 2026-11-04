// Farben wie in der Web-App (Paletten aus shared/protocol.ts, web/src/board/colors.ts, shapes/palette.tsx).
// Der Assistent darf Farben als Hex (#rrggbb) oder als Namen angeben; Namen werden je nach Verwendung aufgelöst:
// `fill` = helle Flächenfarben (Notizen, Formen, Rahmen), `ink` = kräftige Strich-/Schrift-/Akzentfarben.

export type ColorUse = 'fill' | 'ink';

/** Helle Flächenfarben: die 12 Haftnotiz-Farben (STICKY_COLORS), auch für Formen und Rahmen. */
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
};

/** Haftnotiz-Farben der Web-App (12, eine Quelle: shared/protocol.ts). */
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
};

/** Name zum Gruppieren nach Farbe (cluster). */
export const colorKey = (hex: string | undefined) => colorLabel(hex)?.split(' ')[0] ?? 'ohne Farbe';
