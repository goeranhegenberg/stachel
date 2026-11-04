import { describe, expect, it } from 'vitest';
import type { BoardObject } from '../protocol';
import { contentBounds, loadThumb, MAX_THUMBS, removeThumb, saveThumb } from './thumbs';

function fakeStorage(limit = Infinity) {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const size = [...m.entries()].reduce((n, [key, val]) => n + (key === k ? 0 : val.length), 0) + v.length;
      if (size > limit) throw new Error('QuotaExceededError');
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
  };
}

const obj = (o: Partial<BoardObject>): BoardObject => ({ id: 'x', type: 'sticky', x: 0, y: 0, w: 10, h: 10, z: 'a0', createdBy: 'm:1', updatedAt: '', ...o });

describe('Vorschaubilder', () => {
  it('speichert, lädt und hält höchstens 30 Einträge (zuletzt benutzt bleibt)', () => {
    const s = fakeStorage();
    for (let i = 0; i < MAX_THUMBS + 5; i++) saveThumb(`b${i}`, `data:image/png;base64,${i}`, s);
    expect(loadThumb('b0', s)).toBeNull();
    expect(loadThumb('b4', s)).toBeNull();
    expect(loadThumb('b5', s)).toBe('data:image/png;base64,5');
    expect(loadThumb(`b${MAX_THUMBS + 4}`, s)).not.toBeNull();
    // erneut gespeichert → wandert nach vorn und überlebt
    saveThumb('b5', 'data:image/png;base64,neu', s);
    saveThumb('z1', 'data:image/png;base64,z', s);
    expect(loadThumb('b5', s)).toBe('data:image/png;base64,neu');
    expect(loadThumb('b6', s)).toBeNull();
    removeThumb('b5', s);
    expect(loadThumb('b5', s)).toBeNull();
    expect([...s.m.keys()].filter((k) => k.startsWith('stachel:thumb:')).length).toBeLessThanOrEqual(MAX_THUMBS);
  });

  it('ignoriert fremde Inhalte und volle Speicher', () => {
    const s = fakeStorage(200);
    s.m.set('stachel:thumb:evil', 'javascript:alert(1)');
    expect(loadThumb('evil', s)).toBeNull();
    expect(() => saveThumb('gross', `data:image/png;base64,${'A'.repeat(500)}`, s)).not.toThrow();
    expect(loadThumb('gross', s)).toBeNull();
    expect(loadThumb('x', null)).toBeNull();
  });

  it('Inhaltsrahmen ohne Verbinder', () => {
    expect(contentBounds([])).toBeNull();
    expect(
      contentBounds([obj({ x: 10, y: 20, w: 100, h: 50 }), obj({ id: 'y', x: -40, y: 0, w: 10, h: 10 }), obj({ id: 'c', type: 'connector', x: 9999, y: 9999 })]),
    ).toEqual({ x: -40, y: 0, w: 150, h: 70 });
  });
});
