import { describe, expect, it } from 'vitest';
import type { Rect } from '../../board/geometry';
import { rotatedResize } from './resize';

/** Weltlage einer Ecke (fx, fy ∈ {0, 1}) eines um seine Mitte gedrehten Rechtecks. */
function corner(r: Rect, rot: number, fx: number, fy: number) {
  const a = (rot * Math.PI) / 180;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const px = r.x + fx * r.w - cx;
  const py = r.y + fy * r.h - cy;
  return { x: cx + px * Math.cos(a) - py * Math.sin(a), y: cy + px * Math.sin(a) + py * Math.cos(a) };
}

describe('Größe ändern an gedrehten Objekten', () => {
  const box = { x: 0, y: 0, w: 200, h: 100 };

  it('ohne Drehung wie gewohnt', () => {
    expect(rotatedResize(box, 'se', 40, 20, 0, false)).toEqual({ x: 0, y: 0, w: 240, h: 120 });
  });

  it('90°: Zug nach unten verbreitert, die Gegenecke bleibt stehen', () => {
    const before = corner(box, 90, 0, 0);
    // Bei 90° zeigt die lokale x-Achse nach unten
    const nb = rotatedResize(box, 'e', 0, 50, 90, false);
    expect(nb.w).toBeCloseTo(250);
    expect(nb.h).toBeCloseTo(100);
    const after = corner(nb, 90, 0, 0);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('30°, Eckgriff: Gegenecke (nw) bleibt in der Welt stehen', () => {
    const before = corner(box, 30, 0, 0);
    const nb = rotatedResize(box, 'se', 37, -12, 30, false);
    const after = corner(nb, 30, 0, 0);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    // Zug entlang der gedrehten x-Achse ändert nur die Breite
    const along = rotatedResize(box, 'se', 50 * Math.cos(Math.PI / 6), 50 * Math.sin(Math.PI / 6), 30, false);
    expect(along.w).toBeCloseTo(250);
    expect(along.h).toBeCloseTo(100);
  });

  it('nur Breite (Text): Höhe bleibt, Gegenseite steht', () => {
    const before = corner(box, -45, 0, 0.5);
    const nb = rotatedResize(box, 'e', 30, -30, -45, false, true);
    expect(nb.h).toBe(100);
    const after = corner(nb, -45, 0, 0.5);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});
