import { describe, expect, it } from 'vitest';
import { findMatch, fold } from './search';

describe('Suche', () => {
  it('ignoriert Groß/Klein und Umlaute', () => {
    expect(fold('Gelände').text).toBe('gelande');
    expect(fold('GELAENDE').text).toBe('gelande');
    expect(fold('Straße').text).toBe('strasse');
    expect(findMatch('Lageplan Gelände', 'gelaende')).toEqual([9, 16]);
    expect(findMatch('Lageplan Gelände', 'GELÄNDE')).toEqual([9, 16]);
    expect(findMatch('Lageplan Gelände', 'lande')).toEqual([11, 16]);
  });

  it('liefert Fundstellen im Original', () => {
    const t = 'Helfer-Schichten';
    const m = findMatch(t, 'schicht')!;
    expect(t.slice(m[0], m[1])).toBe('Schicht');
    const s = 'Grüße aus Jüterbog';
    const n = findMatch(s, 'gruesse')!;
    expect(s.slice(n[0], n[1])).toBe('Grüße');
    const u = 'Festival-Müll';
    const k = findMatch(u, 'muell')!;
    expect(u.slice(k[0], k[1])).toBe('Müll');
  });

  it('leere oder fehlende Treffer', () => {
    expect(findMatch('Ideen-Pool', '   ')).toBeNull();
    expect(findMatch('Ideen-Pool', 'xyz')).toBeNull();
    expect(findMatch('Retro  Sommerfest', 'retro sommerfest')).toBeNull(); // doppeltes Leerzeichen im Titel
    expect(findMatch('Retro Sommerfest', '  retro   sommerfest ')).toEqual([0, 16]);
  });

  it('Emoji und Ersatzzeichen verschieben die Indizes nicht', () => {
    const t = '🌵 Kaktus-Ecke';
    const m = findMatch(t, 'kaktus')!;
    expect(t.slice(m[0], m[1])).toBe('Kaktus');
  });
});
