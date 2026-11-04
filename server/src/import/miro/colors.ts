// Farben beim Import aus Miro (docs/import_miro_konzept.md §2.2): Hex-Normalisierung, Abstand im Lab-Raum (CIEDE2000),
// nächste Farbe einer Palette, Miro-Notizfarbnamen → Richtwert, Tag-Farben. Reine Funktionen.
// Die Notizpalette wird NIE fest verdrahtet: `nearestColor(hex, palette)` rechnet zur Laufzeit gegen die übergebene
// (bzw. die aktuelle `STICKY_COLORS`) – wächst die Palette, passt die Abbildung automatisch besser.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** Deckkraft 0…1 */
  a: number;
}

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`; sonst undefined (auch `transparent`). */
export function parseColor(v: unknown): Rgba | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4})$/.exec(s);
  if (m) {
    const d = m[1]!.split('').map((c) => parseInt(c + c, 16));
    return { r: d[0]!, g: d[1]!, b: d[2]!, a: d.length === 4 ? d[3]! / 255 : 1 };
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) {
    const n = parseInt(m[1]!, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(s);
  if (m) {
    const ch = (x: string) => Math.min(255, Number(x));
    let a = 1;
    if (m[4] !== undefined) a = m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
    if (!Number.isFinite(a)) a = 1;
    return { r: ch(m[1]!), g: ch(m[2]!), b: ch(m[3]!), a: Math.min(1, Math.max(0, a)) };
  }
  return undefined;
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');
export const toHex = (c: Pick<Rgba, 'r' | 'g' | 'b'>) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;

/** Farbe als `#rrggbb` (Deckkraft fällt weg); undefined, wenn keine oder ganz durchsichtig. */
export function hex6(v: unknown): string | undefined {
  const c = parseColor(v);
  return c && c.a > 0 ? toHex(c) : undefined;
}

// ---- Lab und CIEDE2000 -----------------------------------------------------------------------------------------------

const lin = (u: number) => {
  const x = u / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};

/** sRGB → CIE-Lab (D65). */
export function toLab(c: Pick<Rgba, 'r' | 'g' | 'b'>): [number, number, number] {
  const r = lin(c.r);
  const g = lin(c.g);
  const b = lin(c.b);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Farbabstand CIEDE2000 zweier Lab-Farben. */
export function deltaE2000([L1, a1, b1]: [number, number, number], [L2, a2, b2]: [number, number, number]): number {
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h = (b: number, a: number) => (b === 0 && a === 0 ? 0 : (deg(Math.atan2(b, a)) + 360) % 360);
  const h1p = h(b1, a1p);
  const h2p = h(b2, a2p);
  const dL = L2 - L1;
  const dC = C2p - C1p;
  let dh = 0;
  if (C1p * C2p !== 0) {
    dh = h2p - h1p;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dh / 2));
  const Lm = (L1 + L2) / 2;
  const Cmp = (C1p + C2p) / 2;
  let hm = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hm = (h1p + h2p) / 2;
    else hm = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T = 1 - 0.17 * Math.cos(rad(hm - 30)) + 0.24 * Math.cos(rad(2 * hm)) + 0.32 * Math.cos(rad(3 * hm + 6)) - 0.2 * Math.cos(rad(4 * hm - 63));
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * Cmp;
  const Sh = 1 + 0.015 * Cmp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

/** Abstand zweier Farben (CIEDE2000); unlesbare Farben = unendlich weit. */
export function colorDistance(a: string, b: string): number {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return Infinity;
  return deltaE2000(toLab(ca), toLab(cb));
}

/** Buntheit (Chroma im Lab-Raum); unlesbar = unendlich. */
export function chroma(hex: string): number {
  const c = parseColor(hex);
  if (!c) return Infinity;
  const [, a, b] = toLab(c);
  return Math.hypot(a, b);
}

/** unter dieser Buntheit gilt eine Farbe als neutral (Weiß, Grau, Schwarz) */
const NEUTRAL_CHROMA = 10;

/**
 * Nächste Farbe der Palette (CIEDE2000); bei Gleichstand die frühere. Neutrale Farben (Grau, Schwarz) bleiben neutral,
 * wenn die Palette neutrale Farben hat – sonst würde Schwarz nach Helligkeit auf eine bunte Farbe fallen.
 * Leere Palette → die Farbe selbst.
 */
export function nearestColor(hex: string, palette: readonly string[]): string {
  let candidates = palette;
  if (chroma(hex) < NEUTRAL_CHROMA) {
    const neutral = palette.filter((p) => chroma(p) < NEUTRAL_CHROMA);
    if (neutral.length) candidates = neutral;
  }
  let best: string | undefined;
  let bestD = Infinity;
  for (const p of candidates) {
    const d = colorDistance(hex, p);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best ?? hex;
}

/** Relative Leuchtdichte (WCAG). */
export function luminance(c: Pick<Rgba, 'r' | 'g' | 'b'>): number {
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** Taugt die Farbe für schwarze Schrift (Kontrast ≥ 4,5 : 1)? Stachel-Notizen schreiben immer schwarz. */
export function readableWithBlack(hex: string): boolean {
  const c = parseColor(hex);
  if (!c) return false;
  return (luminance(c) + 0.05) / 0.05 >= 4.5;
}

// ---- Miro-Notizfarben ------------------------------------------------------------------------------------------------

/**
 * Miro liefert Notizfarben als Namen (16 Werte, Spec `StickyNoteStyle.fillColor`). Die Hex-Werte stehen nicht in der
 * Spec; das sind die Farben, die Miros Oberfläche zeigt (Richtwerte, Konzept §2.2).
 */
export const MIRO_STICKY_HEX: Readonly<Record<string, string>> = {
  gray: '#f5f6f8',
  light_yellow: '#fff9b1',
  yellow: '#f5d128',
  orange: '#ff9d48',
  light_green: '#d5f692',
  green: '#c9df56',
  dark_green: '#93d275',
  cyan: '#67c6c0',
  light_pink: '#ffcee0',
  pink: '#ea94bb',
  violet: '#c6a2d2',
  red: '#f0939d',
  light_blue: '#a6ccf5',
  blue: '#6cd8fa',
  dark_blue: '#9ea9ff',
  black: '#000000',
};

/** Miro-Standard, wenn die Notiz keine Farbe trägt */
export const MIRO_STICKY_DEFAULT = 'light_yellow';

/** Richtwert einer Miro-Notizfarbe (Name oder Hex); undefined = unbekannter Name. */
export function miroStickyHex(fill: unknown): string | undefined {
  if (fill === undefined || fill === null || fill === '') return MIRO_STICKY_HEX[MIRO_STICKY_DEFAULT];
  if (typeof fill !== 'string') return undefined;
  const k = fill.trim().toLowerCase();
  return MIRO_STICKY_HEX[k] ?? hex6(k);
}

/**
 * Notizfarbe für Stachel: nächste Farbe der Palette bzw. mit `keepColors` die Originalfarbe – außer sie ist zu dunkel
 * für schwarze Schrift (dann trotzdem die Palette). Unbekannter Name → Standard (helles Gelb) auf die Palette.
 */
export function stickyColor(fill: unknown, palette: readonly string[], keepColors = false): { color: string; source: string; known: boolean } {
  const hex = miroStickyHex(fill);
  const source = hex ?? MIRO_STICKY_HEX[MIRO_STICKY_DEFAULT]!;
  if (keepColors && hex && readableWithBlack(hex)) return { color: hex, source, known: true };
  return { color: nearestColor(source, palette), source, known: !!hex };
}

// ---- Tag-Farben ------------------------------------------------------------------------------------------------------

/** Tag-Farben von Stachel (gleich `TAG_COLORS` in web/src/features/tools/tags.tsx und structure/card/model.ts; Test prüft das). */
export const STACHEL_TAG_COLORS = ['#c9e14a', '#ec4e92', '#1763b5', '#ffd08a', '#9fd3ff', '#e2d5ff', '#ffb3d1', '#0a0a0a'] as const;

/** Miro-Tag-Farbnamen (12) → Stachel-Tag-Farbe (Konzept §2.2). */
export const MIRO_TAG_COLORS: Readonly<Record<string, string>> = {
  light_green: '#c9e14a',
  green: '#c9e14a',
  dark_green: '#c9e14a',
  red: '#ec4e92',
  magenta: '#ec4e92',
  blue: '#1763b5',
  dark_blue: '#1763b5',
  yellow: '#ffd08a',
  cyan: '#9fd3ff',
  violet: '#e2d5ff',
  gray: '#e2d5ff',
  black: '#0a0a0a',
};

/** Tag-Farbe: Name aus der Tabelle, Hex → nächste Tag-Farbe, sonst Grün. */
export function tagColor(fill: unknown): string {
  if (typeof fill === 'string') {
    const k = fill.trim().toLowerCase();
    const named = MIRO_TAG_COLORS[k];
    if (named) return named;
    const hex = hex6(k);
    if (hex) return nearestColor(hex, STACHEL_TAG_COLORS);
  }
  return STACHEL_TAG_COLORS[0];
}

/** Markierungsfarben der Format-Leiste (`HIGHLIGHTS` in web/src/features/richtext/FormatBar.tsx, Test prüft das). */
export const HIGHLIGHT_COLORS = ['#fff27a', '#c9e14a', '#ffb3d1', '#9fd3ff', '#ffd08a', '#e2d5ff'] as const;
