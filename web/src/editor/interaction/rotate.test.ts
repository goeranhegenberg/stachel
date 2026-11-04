import { describe, expect, it } from 'vitest';
import type { BoardObject } from '../../protocol';
import { angleLabel, canRotateAll, rotateMany, rotationField, snapAngle } from './rotate';

const obj = (o: Partial<BoardObject>): BoardObject => ({ id: 'x', type: 'sticky', x: 0, y: 0, w: 200, h: 200, z: 'a0', createdBy: 't', updatedAt: '', ...o }) as BoardObject;

describe('Drehen: Einrasten', () => {
  it('rastet nahe 0°/90°/180°/270° magnetisch ein (±5°), sonst frei auf 0,1°', () => {
    expect(snapAngle(3, false)).toEqual({ deg: 0, snapped: true });
    expect(snapAngle(-4.9, false)).toEqual({ deg: 0, snapped: true });
    expect(snapAngle(5.4, false)).toEqual({ deg: 5.4, snapped: false });
    expect(snapAngle(30.04, false)).toEqual({ deg: 30, snapped: false });
    expect(snapAngle(87, false)).toEqual({ deg: 90, snapped: true });
    expect(snapAngle(-93, false)).toEqual({ deg: -90, snapped: true });
    expect(snapAngle(178, false)).toEqual({ deg: 180, snapped: true });
    expect(snapAngle(-178, false)).toEqual({ deg: 180, snapped: true });
    expect(snapAngle(272, false)).toEqual({ deg: -90, snapped: true });
    expect(snapAngle(363, false)).toEqual({ deg: 0, snapped: true });
  });

  it('Umschalt: 15°-Schritte, eingerastet nur auf rechten Winkeln', () => {
    expect(snapAngle(37, true)).toEqual({ deg: 30, snapped: false });
    expect(snapAngle(8, true)).toEqual({ deg: 15, snapped: false });
    expect(snapAngle(-7, true)).toEqual({ deg: 0, snapped: true });
    expect(snapAngle(97, true)).toEqual({ deg: 90, snapped: true });
  });

  it('Feld und Etikett', () => {
    expect(rotationField(0)).toBeUndefined();
    expect(rotationField(360)).toBeUndefined();
    expect(rotationField(-30.04)).toBe(-30);
    expect(angleLabel(-0.2)).toBe('0°');
    expect(angleLabel(89.6)).toBe('90°');
    expect(angleLabel(-45)).toBe('-45°');
  });
});

describe('Drehen: mehrere Objekte', () => {
  const info = (o: BoardObject) => (o.type === 'connector' ? { derive: true } : { rotatable: o.type !== 'frame' });

  it('nur wenn alle drehbar und nichts gesperrt ist', () => {
    const a = obj({ id: 'a' });
    const b = obj({ id: 'b', x: 300 });
    expect(canRotateAll([a], info)).toBe(false);
    expect(canRotateAll([a, b], info)).toBe(true);
    expect(canRotateAll([a, b, obj({ id: 'p', type: 'pen' })], info)).toBe(true);
    expect(canRotateAll([a, b, obj({ id: 'c', type: 'connector' })], info)).toBe(true);
    expect(canRotateAll([a, obj({ id: 'f', type: 'frame' })], info)).toBe(false);
    expect(canRotateAll([a, { ...b, locked: true }], info)).toBe(false);
    expect(canRotateAll([obj({ id: 'c', type: 'connector' }), obj({ id: 'd', type: 'connector' })], info)).toBe(false);
  });

  it('dreht um die gemeinsame Mitte; zurück auf 0° ergibt genau die alte Lage', () => {
    const a = obj({ id: 'a', x: 0, y: 0, w: 100, h: 100, rotation: 10 });
    const b = obj({ id: 'b', x: 300, y: 0, w: 100, h: 100 });
    const pen = obj({ id: 'p', type: 'pen', x: 0, y: 200, w: 104, h: 4, points: [2, 2, 102, 2], strokeWidth: 4 });
    const line = obj({ id: 'c', type: 'connector', from: { objectId: 'a' }, to: { x: 400, y: 300 } });
    const origin = new Map([a, b, pen, line].map((o) => [o.id, o]));
    const c = { x: 200, y: 50 };
    const p = rotateMany(origin, c, 90);
    // Mitte von a (50, 50) → (200, -100); Drehung wächst mit
    expect(p.a).toEqual({ x: 150, y: -150, rotation: 100 });
    expect(p.b).toEqual({ x: 150, y: 150, rotation: 90 });
    // Strich: Punkte gedreht, Rahmen neu
    expect(p.p.w).toBeCloseTo(4, 0);
    expect(p.p.h).toBeCloseTo(104, 0);
    // Verbinder: nur das freie Ende
    expect(p.c).toEqual({ to: { x: -50, y: 250 } });
    // zurück auf 0°
    const back = rotateMany(origin, c, 0);
    expect(back.a).toEqual({ x: 0, y: 0, rotation: 10 });
    expect(back.b).toEqual({ x: 300, y: 0, rotation: undefined });
    expect(back.p).toMatchObject({ x: 0, y: 200, points: [2, 2, 102, 2] });
  });
});
