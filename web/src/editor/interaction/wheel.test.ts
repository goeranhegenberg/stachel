import { describe, expect, it } from 'vitest';
import { createNotchCounter, createWheelClassifier } from './wheel';

const ev = (deltaY: number, deltaX = 0, timeStamp = 0, deltaMode = 0) => ({ deltaY, deltaX, timeStamp, deltaMode });

describe('Mausrad oder Trackpad', () => {
  it('Mausrad: Zeilen-Modus oder große ganze Schritte ohne deltaX', () => {
    const c = createWheelClassifier();
    expect(c(ev(3, 0, 0, 1))).toBe('mouse');
    expect(c(ev(100, 0, 1000))).toBe('mouse');
    expect(c(ev(-120, 0, 2000))).toBe('mouse');
    expect(c(ev(53, 0, 3000))).toBe('mouse');
  });
  it('Trackpad: kleine oder gebrochene Werte, deltaX', () => {
    const c = createWheelClassifier();
    expect(c(ev(4))).toBe('trackpad');
    expect(c(ev(12.5, 0, 1000))).toBe('trackpad');
    expect(c(ev(60, 8, 2000))).toBe('trackpad');
  });
  it('Schwung nach Trackpad-Wischen bleibt Trackpad', () => {
    const c = createWheelClassifier();
    expect(c(ev(6, 0, 0))).toBe('trackpad');
    expect(c(ev(100, 0, 100))).toBe('trackpad');
    expect(c(ev(100, 0, 1000))).toBe('mouse');
  });
});

describe('Mausrad bei Browser-Zoom bzw. Pixeldichte (gebrochene Deltas)', () => {
  it('−100 geteilt durch 1.1 / 1.5 / 1.75 / 3 bzw. 0.67 bleibt ein Mausrad', () => {
    for (const dpr of [1.1, 1.25, 1.5, 1.75, 2, 3, 0.67]) {
      const c = createWheelClassifier();
      expect(c(ev(-100 / dpr, 0, 1000), dpr), `dpr ${dpr}`).toBe('mouse');
    }
  });
  it('Trackpad bleibt Trackpad, auch bei hoher Pixeldichte', () => {
    const c = createWheelClassifier();
    expect(c(ev(3.5, 0, 0), 2)).toBe('trackpad');
    expect(c(ev(12.25, 0, 1000), 3)).toBe('trackpad');
  });
  it('jede Raste zählt gleich, egal wie groß das Delta ist', () => {
    for (const d of [100, 90.909, 66.667, 33.333, 3, 120, 53]) {
      const n = createNotchCounter();
      expect(n({ deltaMode: 0, deltaY: -d })).toBe(-1);
      expect(n({ deltaMode: 0, deltaY: d })).toBe(1);
      // zwei zusammengefasste Rasten
      expect(n({ deltaMode: 0, deltaY: 2 * d })).toBe(2);
    }
  });
  it('Zeilen-Modus (Firefox) mit eigener Schrittweite', () => {
    const n = createNotchCounter();
    expect(n({ deltaMode: 0, deltaY: 100 })).toBe(1);
    expect(n({ deltaMode: 1, deltaY: 3 })).toBe(1);
    expect(n({ deltaMode: 1, deltaY: -6 })).toBe(-2);
  });
});
