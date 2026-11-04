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

/** Lesbare Textfarbe auf einem Hintergrund. */
export function textOn(bg: string | undefined): string {
  if (!bg || !/^#[0-9a-f]{6}$/i.test(bg)) return '#0a0a0a';
  const r = parseInt(bg.slice(1, 3), 16);
  const g = parseInt(bg.slice(3, 5), 16);
  const b = parseInt(bg.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.55 ? '#ffffff' : '#0a0a0a';
}
