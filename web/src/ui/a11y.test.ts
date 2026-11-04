import { describe, expect, it } from 'vitest';
import { STICKY_COLORS, USER_COLORS } from '../protocol';
import { INK_COLORS, SHAPE_FILLS } from '../board/colors';
import { colorName, describeObject, describeSelection } from './a11y';

describe('Barrierefreiheit', () => {
  it('alle Farben der Paletten haben deutsche Namen', () => {
    for (const c of [...STICKY_COLORS, ...SHAPE_FILLS, ...INK_COLORS, ...USER_COLORS]) expect(colorName(c), c).not.toMatch(/^#/);
    expect(colorName('#FFF27A')).toBe('Gelb');
    // 36 Notizfarben: Raster 12 Farbtöne × hell/kräftig/dunkel; die bisherigen Werte stecken darin (nur Tannengrün nicht)
    expect(STICKY_COLORS).toHaveLength(36);
    expect(STICKY_COLORS.slice(0, 12).map(colorName)).toEqual(['Gelb', 'Orange', 'Koralle', 'Rosa', 'Lila', 'Hellindigo', 'Mittelblau', 'Hellblau', 'Türkis', 'Mint', 'Grün', 'Weiß']);
    expect(STICKY_COLORS.slice(12, 24).map(colorName)).toEqual(['Sonnengelb', 'Mandarine', 'Rot', 'Himbeere', 'Lavendel', 'Indigo', 'Königsblau', 'Himmelblau', 'Lagune', 'Grasgrün', 'Limette', 'Steingrau']);
    expect(STICKY_COLORS.slice(24).map(colorName)).toEqual(['Ocker', 'Braun', 'Weinrot', 'Brombeere', 'Aubergine', 'Nachtblau', 'Marineblau', 'Ozeanblau', 'Dunkeltürkis', 'Waldgrün', 'Oliv', 'Anthrazit']);
    expect(new Set(STICKY_COLORS.map(colorName)).size).toBe(36);
    const before24 = ['#fff27a', '#c9e14a', '#ffb3d1', '#9fd3ff', '#ffd08a', '#e2d5ff', '#ffffff', '#ff9e8a', '#b9ecd8', '#7fd6e0', '#7fb2f0', '#d4d4cc', '#ffd23f', '#ff8c42', '#f25c78', '#7bc950', '#2ec4b6', '#b388eb', '#c62828', '#2e7d32', '#1565c0', '#6a1b9a', '#6d4c41', '#2b2b2b'];
    expect(before24.filter((c) => !STICKY_COLORS.includes(c))).toEqual(['#2e7d32']);
    expect(colorName('#2e7d32')).toBe('Tannengrün');
    expect(colorName('#123456')).toBe('#123456');
  });

  it('beschreibt Objekte und Auswahl kurz', () => {
    expect(describeObject({ type: 'sticky', text: 'Bühnenplan\nbis 15.11.' })).toBe('Haftnotiz „Bühnenplan bis 15.11.“');
    expect(describeObject({ type: 'shape', shape: 'diamond', text: '' })).toBe('Raute');
    expect(describeObject({ type: 'frame', title: 'Ideen-Pool', locked: true })).toBe('Rahmen „Ideen-Pool“, gesperrt');
    expect(describeObject({ type: 'text', text: 'x'.repeat(80) })).toHaveLength('Text „“'.length + 58);
    expect(describeSelection([])).toBe('Auswahl aufgehoben');
    expect(describeSelection([{ type: 'pen' }, { type: 'image' }])).toBe('2 Objekte ausgewählt');
  });
});
