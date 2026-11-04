// Notizfarben nach WCAG und eigener Farbwähler (Welle B): Schrift auf dunklen Notizen weiß, alte Farben unverändert.
import { describe, expect, it } from 'vitest';
import { STICKY_COLORS } from '../protocol';
import { contrastRatio, readableInk, relativeLuminance, textOn } from '../board/colors';
import { hexToHsv, hsvToHex, parseHex } from './ColorPicker';
import { addRecentColor, MAX_RECENT, readRecentColors } from './recentColors';

describe('Schrift auf Notizen (WCAG)', () => {
  it('Leuchtdichte und Kontrast wie WCAG 2.x', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBe(0);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it('die alten hellen Notizfarben behalten schwarze Schrift (bestehende Boards sehen gleich aus)', () => {
    for (const c of ['#fff27a', '#c9e14a', '#ffb3d1', '#9fd3ff', '#ffd08a', '#e2d5ff', '#ffffff', '#ff9e8a', '#b9ecd8', '#7fd6e0', '#7fb2f0', '#d4d4cc']) {
      expect(readableInk(c), c).toBe('#0a0a0a');
      expect(readableInk(c), c).toBe(textOn(c));
    }
  });

  it('hell schwarz, dunkel weiß, kräftig je nach Kontrast – immer die Schrift mit dem höheren Kontrast (≥ 4,5 : 1)', () => {
    for (const c of STICKY_COLORS.slice(0, 12)) expect(readableInk(c), c).toBe('#0a0a0a');
    for (const c of STICKY_COLORS.slice(24)) expect(readableInk(c), c).toBe('#ffffff');
    expect(STICKY_COLORS.slice(12, 24).filter((c) => readableInk(c) === '#ffffff')).toEqual(['#c62828', '#5c6bc0', '#1565c0']);
    for (const c of STICKY_COLORS) expect(contrastRatio(c, readableInk(c)), c).toBeGreaterThanOrEqual(4.5);
  });

  it('dunkle Reihe ist eindeutig dunkel (Leuchtdichte unter 0,17), Dunkelgrün wie gewünscht', () => {
    for (const c of STICKY_COLORS.slice(24)) expect(relativeLuminance(c)!, c).toBeLessThan(0.17);
    expect(STICKY_COLORS[24 + 9]).toBe('#1b5e20');
  });

  it('freie Farben: berechnet, nicht fest; ungültig → Schwarz', () => {
    expect(readableInk('#123456')).toBe('#ffffff');
    expect(readableInk('#f0f0a0')).toBe('#0a0a0a');
    expect(readableInk('rot')).toBe('#0a0a0a');
    expect(readableInk(undefined)).toBe('#0a0a0a');
  });
});

describe('Farbwähler', () => {
  it('Hex-Eingabe: kurz, ohne #, Großbuchstaben', () => {
    expect(parseHex('#ABC')).toBe('#aabbcc');
    expect(parseHex('c62828')).toBe('#c62828');
    expect(parseHex(' #1565C0 ')).toBe('#1565c0');
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex('blau')).toBeNull();
  });

  it('HSV hin und zurück trifft jede Notizfarbe', () => {
    for (const c of STICKY_COLORS) expect(hsvToHex(hexToHsv(c)), c).toBe(c);
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
  });

  it('zuletzt benutzt: neueste zuerst, ohne Doppelte, höchstens acht', () => {
    const mem = new Map<string, string>();
    const s = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    for (let i = 0; i < 10; i++) addRecentColor(`#00000${i}`, s);
    addRecentColor('#000003', s);
    addRecentColor('kaputt', s);
    const r = readRecentColors(s);
    expect(r).toHaveLength(MAX_RECENT);
    expect(r[0]).toBe('#000003');
    expect(new Set(r).size).toBe(r.length);
  });
});
