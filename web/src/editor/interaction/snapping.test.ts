import { describe, expect, it } from 'vitest';
import { guideLines, snapMove, snapResize } from './snapping';

describe('Einrasten', () => {
  const others = [{ x: 0, y: 0, w: 100, h: 100 }];
  it('rastet eine Kante 3 px neben der Linie ein und zeigt die Hilfslinie', () => {
    const r = snapMove({ x: 3, y: 200, w: 100, h: 100 }, others, 6);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(0);
    expect(r.lines.some((l) => l.x1 === 0 && l.x2 === 0 && l.y1 === 0 && l.y2 === 300)).toBe(true);
  });
  it('rastet Mitten ein, aber nicht außerhalb der Toleranz', () => {
    expect(snapMove({ x: 200, y: 22, w: 100, h: 50 }, others, 6).dy).toBe(3); // Mitte 47 → 50
    expect(snapMove({ x: 210, y: 210, w: 30, h: 30 }, others, 6)).toMatchObject({ dx: 0, dy: 0, lines: [] });
  });
  it('rastet auf gleiche Abstände zwischen Nachbarn ein', () => {
    const row = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 140, y: 0, w: 100, h: 100 },
    ];
    // dritter Nachbar rechts: Abstand 40 wie zwischen den ersten beiden
    const r = snapMove({ x: 283, y: 10, w: 100, h: 60 }, row, 6);
    expect(r.dx).toBe(-3);
    expect(r.gaps.map((g) => g.len)).toEqual([40, 40]);
    // mittig zwischen zwei Objekten
    const mid = snapMove({ x: 108, y: 300, w: 20, h: 20 }, [{ x: 0, y: 290, w: 100, h: 50 }, { x: 140, y: 290, w: 100, h: 50 }], 6);
    expect(mid.dx).toBe(2);
    expect(mid.gaps).toHaveLength(2);
  });
  it('rastet beim Größe ändern nur die gezogene Kante', () => {
    expect(snapResize({ x: 0, y: 200, w: 96, h: 50 }, 'e', others, 6)).toEqual({ dx: 4, dy: 0 });
    expect(snapResize({ x: 2, y: 200, w: 96, h: 50 }, 'e', others, 6)).toEqual({ dx: 2, dy: 0 });
    expect(guideLines({ x: 300, y: 300, w: 10, h: 10 }, others)).toEqual([]);
  });
});
