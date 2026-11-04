import { USER_COLORS } from '../protocol';

/** Deterministische Nutzerfarbe aus dem user_key (FNV-1a). */
export function userColor(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return USER_COLORS[(h >>> 0) % USER_COLORS.length];
}

export function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Farben für Formen und Rahmen (Füllung). */
export const SHAPE_FILLS = ['#ffffff', '#000000', '#c9e14a', '#1763b5', '#ec4e92', '#fff27a', '#9fd3ff', '#ffb3d1', '#e9e9e4'];
/** Farben für Striche, Verbinder und Text. */
export const INK_COLORS = ['#0a0a0a', '#1763b5', '#ec4e92', '#7aa21b', '#e8590c', '#7048e8', '#8a8a85', '#ffffff'];

/** Schrift auf Notizen und freien Farben: Schwarz (wie überall) bzw. Weiß. */
export const INK_DARK = '#0a0a0a';
export const INK_LIGHT = '#ffffff';

const HEX6 = /^#[0-9a-f]{6}$/i;

/** Relative Leuchtdichte nach WCAG 2.x (sRGB linearisiert, 0 = Schwarz … 1 = Weiß); null bei ungültiger Farbe. */
export function relativeLuminance(hex: string): number | null {
  if (!HEX6.test(hex)) return null;
  const lin = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
}

/** Kontrastverhältnis zweier Farben nach WCAG 2.x (1 … 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a) ?? 1;
  const lb = relativeLuminance(b) ?? 1;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Schrift einer Haftnotiz (und jeder frei gewählten Notizfarbe): die der beiden Schriftfarben Schwarz/Weiß mit dem
 * höheren Kontrast nach WCAG, bei Gleichstand Schwarz. Auf allen hellen Notizfarben (die zwölf alten) bleibt es Schwarz,
 * auf den dunklen wird es Weiß. Die App rechnet dasselbe (`stachel_board` `readableInk`).
 */
export function readableInk(bg: string | undefined): string {
  if (!bg || !HEX6.test(bg)) return INK_DARK;
  return contrastRatio(bg, INK_LIGHT) > contrastRatio(bg, INK_DARK) ? INK_LIGHT : INK_DARK;
}

/** Lesbare Textfarbe auf einem Hintergrund. */
export function textOn(bg: string | undefined): string {
  if (!bg || !/^#[0-9a-f]{6}$/i.test(bg)) return '#0a0a0a';
  const r = parseInt(bg.slice(1, 3), 16);
  const g = parseInt(bg.slice(3, 5), 16);
  const b = parseInt(bg.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.55 ? '#ffffff' : '#0a0a0a';
}
