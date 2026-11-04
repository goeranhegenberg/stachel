// Zettel abfotografieren (P10): Anordnung wie auf dem Foto.
import { describe, expect, it } from 'vitest';
import { photoNoteObjects } from './photoNotes';

const note = (x: number, y: number, text = '', color = '#ffd23f', w = 200, h = 200) => ({ x, y, w, h, color, text });

describe('photoNoteObjects', () => {
  it('Raster wie auf dem Foto, typischer Zettel = 230 Einheiten, Farben und Text übernommen', () => {
    const objs = photoNoteObjects([note(40, 40, 'A', '#2b2b2b'), note(280, 40, 'B'), note(40, 280, 'C')]);
    expect(objs.map((o) => [o.type, o.text, o.color, o.w, o.h])).toEqual([
      ['sticky', 'A', '#2b2b2b', 200, 200],
      ['sticky', 'B', '#ffd23f', 200, 200],
      ['sticky', 'C', '#ffd23f', 200, 200],
    ]);
    expect(objs[1]!.x - objs[0]!.x).toBe(276);
    expect(objs[1]!.y).toBe(objs[0]!.y);
    expect(objs[2]!.y - objs[0]!.y).toBe(276);
    expect(new Set(objs.map((o) => o.id)).size).toBe(3);
  });

  it('breite Zettel werden Rechteck-Notizen, Überlappungen rücken nach rechts, ungültige Farbe = Gelb', () => {
    const objs = photoNoteObjects([note(0, 0, 'breit', '#ffd23f', 300, 200), note(100, 0, 'drüber', 'rot')]);
    expect([objs[0]!.w, objs[0]!.h]).toEqual([350, 228]);
    expect(objs[1]!.x).toBeGreaterThanOrEqual(objs[0]!.x + objs[0]!.w + 10);
    expect(objs[1]!.color).toBe('#fff27a');
  });

  it('leer → nichts', () => expect(photoNoteObjects([])).toEqual([]));
});
