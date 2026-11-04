import { describe, expect, it } from 'vitest';
import { STICKY_COLORS, USER_COLORS } from '../protocol';
import { INK_COLORS, SHAPE_FILLS } from '../board/colors';
import { colorName, describeObject, describeSelection } from './a11y';

describe('Barrierefreiheit', () => {
  it('alle Farben der Paletten haben deutsche Namen', () => {
    for (const c of [...STICKY_COLORS, ...SHAPE_FILLS, ...INK_COLORS, ...USER_COLORS]) expect(colorName(c), c).not.toMatch(/^#/);
    expect(colorName('#FFF27A')).toBe('Gelb');
    // 12 Notizfarben: die alten sieben unverändert an ihrer Stelle, dahinter fünf neue
    expect(STICKY_COLORS).toHaveLength(12);
    expect(STICKY_COLORS.slice(0, 7)).toEqual(['#fff27a', '#c9e14a', '#ffb3d1', '#9fd3ff', '#ffd08a', '#e2d5ff', '#ffffff']);
    expect(STICKY_COLORS.slice(7).map(colorName)).toEqual(['Koralle', 'Mint', 'Türkis', 'Mittelblau', 'Steingrau']);
    expect(new Set(STICKY_COLORS.map(colorName)).size).toBe(12);
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
