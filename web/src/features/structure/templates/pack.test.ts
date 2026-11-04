// Vorlagen der Instanz (packApi.ts): Antwort von GET /api/templates/instance tolerant übernehmen, Suche der Galerie.
import { describe, expect, it } from 'vitest';
import { packFromServer, packMatches } from './packApi';

const note = (id: string) => ({ id, type: 'sticky', x: 0, y: 0, w: 200, h: 200, color: '#fff27a', text: id });

describe('Vorlagen der Instanz', () => {
  it('übernimmt Kategorie und gültige Vorlagen, lässt leere und kaputte weg', () => {
    const s = packFromServer({
      category: ' Unser Fest ',
      templates: [
        { id: 'fest.ablauf', name: 'Ablauf', desc: 'Aufbau bis Abbau', keywords: ['tag', 3], objects: [note('a'), { id: 'x', type: 'gibtsnicht', x: 0, y: 0, w: 1, h: 1 }] },
        { id: 'fest.leer', name: 'Leer', objects: [] },
        { id: 7, name: 'Ohne ID', objects: [note('b')] } as never,
      ],
    });
    expect(s.category).toBe('Unser Fest');
    expect(s.list.map((t) => t.id)).toEqual(['fest.ablauf']);
    expect(s.list[0]).toMatchObject({ name: 'Ablauf', desc: 'Aufbau bis Abbau', keywords: ['tag'] });
    expect(s.list[0].objects.map((o) => o.id)).toEqual(['a']);
  });

  it('ohne Vorlagen keine Kategorie; ohne Kategorie „Weitere Vorlagen“', () => {
    expect(packFromServer({ category: 'Fest', templates: [] })).toEqual({ category: null, list: [] });
    expect(packFromServer({ templates: [{ id: 'a', name: 'A', objects: [note('a')] }] }).category).toBe('Weitere Vorlagen');
  });

  it('Suche in Name, Beschreibung, Kategorie und Stichwörtern', () => {
    const t = packFromServer({ category: 'Fest', templates: [{ id: 'a', name: 'Ablauf', desc: 'Der Tag', keywords: ['Running Order'], objects: [note('a')] }] }).list[0];
    expect(packMatches(t, 'Fest', '')).toBe(true);
    expect(packMatches(t, 'Fest', 'running')).toBe(true);
    expect(packMatches(t, 'Fest', 'fest')).toBe(true);
    expect(packMatches(t, 'Fest', 'tag')).toBe(true);
    expect(packMatches(t, 'Fest', 'zirkus')).toBe(false);
  });
});
