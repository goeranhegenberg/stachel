// Haftnotiz-Formen (Quadrat/Rechteck/frei) und Linienart neuer Verbinder (zwischen Objekten geschwungen).
import { afterEach, describe, expect, it } from 'vitest';
import '../../editor/core';
import './index';
import type { BoardObject } from '../../protocol';
import { objectTypes } from '../../editor/ext/registry';
import { setToolOption } from '../../editor/ext/toolOptions';
import { newLineStyle } from '../../editor/core/tools';
import { stickyFontSize, stickyMaxFont, stickyPadding } from '../../editor/textMeasure';
import { STICKY_RECT_RATIO, stickyShapeOf, stickyShapePatch, stickySize } from './stickyGeom';

const note = (o: Partial<BoardObject>): BoardObject => ({ id: 'n', type: 'sticky', x: 0, y: 0, w: 200, h: 200, z: 'a0', createdBy: 't', updatedAt: '', ...o }) as BoardObject;

afterEach(() => {
  setToolOption('sticky', 'shape', undefined);
  setToolOption('connector', 'lineStyle', undefined);
});

describe('Haftnotiz-Formen', () => {
  it('Form folgt dem Seitenverhältnis (alte Notizen sind quadratisch)', () => {
    expect(stickyShapeOf({ w: 200, h: 200 })).toBe('square');
    expect(stickyShapeOf({ w: 350, h: 200 })).toBe('rect');
    expect(stickyShapeOf({ w: 700, h: 400 })).toBe('rect');
    expect(stickyShapeOf({ w: 260, h: 200 })).toBe('free');
    expect(stickyShapeOf({ w: 200, h: 420 })).toBe('free');
    expect(stickySize('rect')).toEqual({ w: 350, h: 200 });
    expect(STICKY_RECT_RATIO).toBeGreaterThan(1.5);
  });

  it('Umschalten behält Höhe und Mitte', () => {
    expect(stickyShapePatch(note({ x: 100 }), 'rect')).toEqual({ x: 25, w: 350 });
    expect(stickyShapePatch(note({ x: 25, w: 350 }), 'square')).toEqual({ x: 100, w: 200 });
    expect(stickyShapePatch(note({ w: 260, h: 120 }), 'square')).toEqual({ x: 70, w: 120 });
    // schon in der Form bzw. keine Notiz: kein Patch
    expect(stickyShapePatch(note({}), 'square')).toBeNull();
    expect(stickyShapePatch(note({ type: 'shape' }), 'rect')).toBeNull();
  });

  it('Typ: Seitengriffe frei, Ecken proportional; neue Notiz in der gemerkten Form', () => {
    const def = objectTypes.get('sticky')!;
    expect(def.handles!(note({}))).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
    expect(def.keepAspect).toBe('corner');
    const api = {} as Parameters<NonNullable<typeof def.create>>[1];
    expect(def.create!({ x: 0, y: 0 }, api)).toMatchObject({ x: -100, y: -100, w: 200, h: 200 });
    setToolOption('sticky', 'shape', 'rect');
    expect(def.create!({ x: 0, y: 0 }, api)).toMatchObject({ x: -175, y: -100, w: 350, h: 200 });
  });

  it('Autofit: Rechteck mit gleicher Höhe bekommt dieselbe Höchstschrift und denselben Rand wie das Quadrat', () => {
    expect(stickyMaxFont(350, 200)).toBe(stickyMaxFont(200, 200));
    expect(stickyPadding(350, 200)).toBe(stickyPadding(200, 200));
    // bisheriges Verhalten des Quadrats unverändert
    expect(stickyPadding(200)).toBe(18);
    expect(stickyMaxFont(200, 200)).toBeCloseTo((200 * 0.82) / 4.6, 5);
    // langer Text: im breiteren Rechteck nie kleiner als im Quadrat, in einer hohen freien Notiz ebenfalls nicht
    const long = 'Getränkestand am Eingang mit Kühlwagen und zwei Zapfanlagen aufbauen';
    expect(stickyFontSize(long, 350, 200)).toBeGreaterThanOrEqual(stickyFontSize(long, 200, 200));
    expect(stickyFontSize(long, 200, 400)).toBeGreaterThanOrEqual(stickyFontSize(long, 200, 200));
  });
});

describe('Linienart neuer Verbinder', () => {
  it('zwischen zwei Objekten geschwungen, freie Linien gerade', () => {
    expect(newLineStyle({ objectId: 'a' }, { objectId: 'b', side: 'w' })).toBe('curved');
    expect(newLineStyle({ objectId: 'a' }, { x: 10, y: 10 })).toBeUndefined();
    expect(newLineStyle({ x: 0, y: 0 }, { x: 10, y: 10 })).toBeUndefined();
  });

  it('ausdrücklich im Werkzeug gewählte Linienart gilt immer', () => {
    setToolOption('connector', 'lineStyle', 'straight');
    expect(newLineStyle({ objectId: 'a' }, { objectId: 'b' })).toBeUndefined();
    setToolOption('connector', 'lineStyle', 'elbow');
    expect(newLineStyle({ objectId: 'a' }, { objectId: 'b' })).toBe('elbow');
    expect(newLineStyle({ x: 0, y: 0 }, { x: 10, y: 10 })).toBe('elbow');
  });
});
