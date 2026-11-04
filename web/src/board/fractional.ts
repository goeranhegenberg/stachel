// Fractional-Index für die Ebenen-Reihenfolge (Feld `z`, lexikografisch sortiert).
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/** Plain-Byte-Vergleich (nicht localeCompare – der Vertrag sortiert lexikografisch). */
export const compareKeys = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Gleiche oder vertauschte Grenzen entstehen, wenn zwei Clients gleichzeitig denselben Schlüssel vergeben haben.
 * Dann gibt es nichts „dazwischen“: knapp über `a` einsortieren (`a + '1'` liegt direkt über `a`).
 */
const fixBounds = (a: string | null, b: string | null): string | null => (a !== null && b !== null && a >= b ? `${a}1` : b);

export function keyBetween(a: string | null, b: string | null): string {
  b = fixBounds(a, b);
  try {
    return generateKeyBetween(a, b);
  } catch {
    // Fremde/kaputte Schlüssel: nicht abstürzen, sondern grob einsortieren.
    return b === null ? `${a ?? ''}V` : `${b.slice(0, -1)}`;
  }
}

export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  b = fixBounds(a, b);
  try {
    return generateNKeysBetween(a, b, n);
  } catch {
    const out: string[] = [];
    let prev = a;
    for (let i = 0; i < n; i++) {
      prev = keyBetween(prev, b);
      out.push(prev);
    }
    return out;
  }
}

// Ziffern von fractional-indexing ohne '0' (ein Schlüssel darf nicht auf '0' enden)
const DIGITS = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Hängt an jeden Schlüssel ein zufälliges Kürzel, solange er dabei unter seinem oberen Nachbarn bleibt. Zwei Clients,
 * die gleichzeitig „über allem“ anlegen, bekommen so (fast sicher) verschiedene Schlüssel statt denselben.
 */
function spread(keys: string[], hi: string | null): string[] {
  return keys.map((k, i) => {
    let s = '';
    for (let j = 0; j < 3; j++) s += DIGITS[Math.floor(Math.random() * DIGITS.length)];
    const next = i + 1 < keys.length ? keys[i + 1] : hi;
    return next === null || k + s < next ? k + s : k;
  });
}

/** n neue Schlüssel über `top` (dem höchsten vorhandenen). */
export const keysAbove = (top: string | null, n: number) => spread(keysBetween(top, null, n), null);
/** n neue Schlüssel unter `bottom` (dem niedrigsten vorhandenen). */
export const keysBelow = (bottom: string | null, n: number) => spread(keysBetween(null, bottom, n), bottom);
