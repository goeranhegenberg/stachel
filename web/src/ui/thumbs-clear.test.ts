// CR-11 (docs/legal/datenschutz.md §6): beim Abmelden alle Vorschaubilder aus dem localStorage löschen, sonst nichts.
import { describe, expect, it } from 'vitest';
import { clearThumbs, loadThumb, saveThumb } from './thumbs';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    m,
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('clearThumbs', () => {
  it('löscht stachel:thumb:* und den Index, lässt Einstellungen stehen', () => {
    const s = fakeStorage();
    saveThumb('b1', 'data:image/png;base64,1', s);
    saveThumb('b2', 'data:image/png;base64,2', s);
    s.setItem('stachel:thumb:verwaist', 'data:image/png;base64,3'); // nicht im Index
    s.setItem('stachel.wheel', 'zoom');
    s.setItem('stachel:boards-sort', 'name');
    clearThumbs(s);
    expect(loadThumb('b1', s)).toBeNull();
    expect(loadThumb('b2', s)).toBeNull();
    expect([...s.m.keys()].sort()).toEqual(['stachel.wheel', 'stachel:boards-sort']);
  });

  it('ohne Speicher bzw. bei gesperrtem Speicher: kein Fehler', () => {
    expect(() => clearThumbs(null)).not.toThrow();
    const broken = { ...fakeStorage(), key: () => { throw new Error('SecurityError'); } };
    expect(() => clearThumbs(broken)).not.toThrow();
  });
});
