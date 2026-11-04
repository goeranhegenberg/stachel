import { describe, expect, it } from 'vitest';
import { lassoBounds, pointInPolygon, rectInLasso } from './lasso';

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];
// U-Form: Einbuchtung von oben zwischen x 40 und 60 bis y 80
const u = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 40, y: 80 },
  { x: 60, y: 80 },
  { x: 60, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe('Lasso', () => {
  it('Punkt im Polygon', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 50 }, square)).toBe(false);
    expect(pointInPolygon({ x: 50, y: 40 }, u)).toBe(false);
    expect(pointInPolygon({ x: 20, y: 40 }, u)).toBe(true);
  });
  it('nur komplett umschlossene Rechtecke', () => {
    expect(rectInLasso({ x: 10, y: 10, w: 20, h: 20 }, square)).toBe(true);
    expect(rectInLasso({ x: 90, y: 10, w: 20, h: 20 }, square)).toBe(false);
    // überspannt die Einbuchtung: Ecken drin, aber die Mitte nicht
    expect(rectInLasso({ x: 10, y: 30, w: 80, h: 20 }, u)).toBe(false);
    expect(rectInLasso({ x: 5, y: 5, w: 20, h: 20 }, u)).toBe(true);
    expect(rectInLasso({ x: 5, y: 5, w: 20, h: 20 }, square.slice(0, 2))).toBe(false);
  });
  it('Grenzen', () => {
    expect(lassoBounds(u)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});
