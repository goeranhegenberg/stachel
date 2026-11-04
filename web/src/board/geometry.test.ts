import { describe, expect, it } from 'vitest';
import {
  baseRect,
  contains,
  GridIndex,
  objRect,
  pointInObject,
  rectsPath,
  rotatedAABB,
  rotationOf,
  fitRect,
  hitTest,
  intersects,
  mapRect,
  nextZoomStep,
  normRect,
  resizeRect,
  screenToWorld,
  unionRects,
  viewRect,
  worldToScreen,
  zoomAt,
} from './geometry';
import type { BoardObject } from '../protocol';

const obj = (id: string, type: BoardObject['type'], x: number, y: number, w: number, h: number): BoardObject => ({
  id,
  type,
  x,
  y,
  w,
  h,
  z: id,
  createdBy: '',
  updatedAt: '',
});

describe('Kamera', () => {
  it('rechnet Bildschirm ↔ Welt hin und zurück', () => {
    const cam = { x: 120, y: -40, z: 1.5 };
    const p = { x: 333, y: 77 };
    const back = worldToScreen(cam, screenToWorld(cam, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });

  it('zoomt um den Mauszeiger (Weltpunkt bleibt stehen)', () => {
    const cam = { x: 10, y: 20, z: 1 };
    const anchor = { x: 400, y: 300 };
    const before = screenToWorld(cam, anchor);
    const next = zoomAt(cam, anchor, 2.5);
    const after = screenToWorld(next, anchor);
    expect(next.z).toBe(2.5);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('begrenzt den Zoom', () => {
    expect(zoomAt({ x: 0, y: 0, z: 1 }, { x: 0, y: 0 }, 100).z).toBe(4);
    expect(zoomAt({ x: 0, y: 0, z: 1 }, { x: 0, y: 0 }, 0).z).toBe(0.05);
  });

  it('passt ein Rechteck ein und zentriert es', () => {
    const cam = fitRect({ x: 0, y: 0, w: 2000, h: 1000 }, 1000, 600, 50);
    expect(cam.z).toBeCloseTo(0.45);
    const view = viewRect(cam, 1000, 600);
    expect(view.x + view.w / 2).toBeCloseTo(1000);
    expect(view.y + view.h / 2).toBeCloseTo(500);
  });

  it('Zoomstufen für +/−', () => {
    expect(nextZoomStep(1, 1)).toBe(1.25);
    expect(nextZoomStep(1, -1)).toBe(0.75);
    expect(nextZoomStep(0.8, 1)).toBe(1);
    expect(nextZoomStep(4, 1)).toBe(4);
  });
});

describe('Rechtecke', () => {
  it('normRect, intersects, contains, unionRects', () => {
    const r = normRect({ x: 10, y: 10 }, { x: 0, y: 30 });
    expect(r).toEqual({ x: 0, y: 10, w: 10, h: 20 });
    expect(intersects(r, { x: 9, y: 29, w: 5, h: 5 })).toBe(true);
    expect(intersects(r, { x: 11, y: 0, w: 5, h: 5 })).toBe(false);
    expect(contains({ x: 0, y: 0, w: 100, h: 100 }, r)).toBe(true);
    expect(contains(r, { x: 0, y: 0, w: 100, h: 100 })).toBe(false);
    expect(unionRects([r, { x: 50, y: -5, w: 1, h: 1 }])).toEqual({ x: 0, y: -5, w: 51, h: 35 });
    expect(unionRects([])).toBeNull();
  });

  it('resizeRect am Eck- und Kantengriff', () => {
    const start = { x: 0, y: 0, w: 100, h: 50 };
    expect(resizeRect(start, 'se', 20, 10, false)).toEqual({ x: 0, y: 0, w: 120, h: 60 });
    expect(resizeRect(start, 'nw', 20, 10, false)).toEqual({ x: 20, y: 10, w: 80, h: 40 });
    expect(resizeRect(start, 'e', 30, 99, false)).toEqual({ x: 0, y: 0, w: 130, h: 50 });
    // Seitenverhältnis halten
    const k = resizeRect(start, 'se', 100, 0, true);
    expect(k.w / k.h).toBeCloseTo(2);
    expect(k.w).toBe(200);
    // Mindestgröße, Griff „kippt" nicht
    const m = resizeRect(start, 'nw', 500, 500, false, 8);
    expect(m).toEqual({ x: 92, y: 42, w: 8, h: 8 });
  });

  it('mapRect skaliert Gruppenmitglieder', () => {
    const from = { x: 0, y: 0, w: 100, h: 100 };
    const to = { x: 100, y: 100, w: 200, h: 50 };
    expect(mapRect({ x: 50, y: 50, w: 10, h: 10 }, from, to)).toEqual({ x: 200, y: 125, w: 20, h: 5 });
  });
});

describe('hitTest', () => {
  const objs = [
    obj('f', 'frame', 0, 0, 1000, 1000),
    obj('a', 'sticky', 100, 100, 200, 200),
    obj('b', 'sticky', 150, 150, 200, 200),
    obj('c', 'connector', 0, 0, 1000, 1000),
  ];
  it('nimmt das oberste Objekt, Rahmen nur als Rückfall, Verbinder nie', () => {
    expect(hitTest(objs, { x: 160, y: 160 })!.id).toBe('b');
    expect(hitTest(objs, { x: 110, y: 110 })!.id).toBe('a');
    expect(hitTest(objs, { x: 900, y: 900 })!.id).toBe('f');
    expect(hitTest(objs, { x: 2000, y: 0 })).toBeNull();
    expect(hitTest(objs, { x: 160, y: 160 }, (o) => o.id === 'b')!.id).toBe('a');
  });
});

describe('Drehung', () => {
  it('normiert den Winkel', () => {
    expect(rotationOf({})).toBe(0);
    expect(rotationOf({ rotation: 370 })).toBe(10);
    expect(rotationOf({ rotation: -190 })).toBe(170);
    expect(rotationOf({ rotation: 180 })).toBe(180);
    expect(rotationOf({ rotation: Number.NaN })).toBe(0);
  });
  it('Bounds umschließen das gedrehte Rechteck', () => {
    const o = { ...obj('a', 'sticky', 0, 0, 200, 100), rotation: 90 };
    const r = objRect(o);
    expect(r.x).toBeCloseTo(50);
    expect(r.y).toBeCloseTo(-50);
    expect(r.w).toBeCloseTo(100);
    expect(r.h).toBeCloseTo(200);
    expect(baseRect(o)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    const d = rotatedAABB({ x: 0, y: 0, w: 100, h: 100 }, 45);
    expect(d.w).toBeCloseTo(Math.SQRT2 * 100);
    expect(d.x + d.w / 2).toBeCloseTo(50);
    expect(objRect(obj('b', 'sticky', 1, 2, 3, 4))).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });
  it('Hit-Test berücksichtigt die Drehung', () => {
    const o = { ...obj('a', 'sticky', 0, 0, 200, 40), rotation: 90 };
    expect(pointInObject({ x: 100, y: -60 }, o)).toBe(true); // jetzt oben (senkrecht)
    expect(pointInObject({ x: 10, y: 20 }, o)).toBe(false); // ehemals links
    expect(hitTest([o], { x: 100, y: 110 })?.id).toBe('a');
  });
});

describe('Raster-Index', () => {
  const rect = (x: number, y: number, w = 100, h = 100) => ({ x, y, w, h });

  it('findet Einträge im Bereich und am Punkt', () => {
    const g = new GridIndex(512);
    g.set('a', rect(0, 0));
    g.set('b', rect(2000, 2000));
    g.set('c', rect(480, 480, 100, 100)); // über eine Zellgrenze
    expect([...g.query(rect(-10, -10, 600, 600))].sort()).toEqual(['a', 'c']);
    expect([...g.queryPoint({ x: 2050, y: 2050 })]).toEqual(['b']);
    expect(g.query(rect(5000, 5000)).size).toBe(0);
    g.set('a', rect(3000, 0)); // verschoben
    expect(g.queryPoint({ x: 50, y: 50 }).size).toBe(0);
    expect([...g.queryPoint({ x: 3050, y: 50 })]).toEqual(['a']);
    g.delete('b');
    expect(g.size).toBe(2);
  });

  it('sehr große Objekte belegen keine tausenden Zellen', () => {
    const g = new GridIndex(512, 64);
    g.set('riesig', rect(-1e6, -1e6, 2e6, 2e6));
    g.set('klein', rect(10, 10, 5, 5));
    expect([...g.queryPoint({ x: 12, y: 12 })].sort()).toEqual(['klein', 'riesig']);
    expect([...g.queryPoint({ x: 9e5, y: -9e5 })]).toEqual(['riesig']);
  });

  it('sync fasst nur geänderte Objekte an und entspricht der linearen Suche', () => {
    const g = new GridIndex<{ x: number; y: number; w: number; h: number }>(256);
    let map = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (let i = 0; i < 400; i++) map.set(`o${i}`, rect((i % 20) * 150, Math.floor(i / 20) * 150));
    g.sync(map, (o) => o);
    expect(g.size).toBe(400);
    // eines verschieben, eines löschen, eines dazu
    map = new Map(map);
    map.set('o5', rect(9000, 9000));
    map.delete('o6');
    map.set('neu', rect(-500, -500));
    let calls = 0;
    g.sync(map, (o) => (calls++, o));
    expect(calls).toBe(2);
    const q = rect(100, 100, 700, 450);
    const linear = [...map].filter(([, r]) => intersects(r, q)).map(([id]) => id).sort();
    expect([...g.query(q)].sort()).toEqual(linear);
    expect(g.queryPoint({ x: 9050, y: 9050 }).has('o5')).toBe(true);
    expect(g.rectOf('o6')).toBeUndefined();
    expect([...g.query(rect(-1e5, -1e5, 2e5, 2e5))].length).toBe(400);
  });
});

describe('Umrisse', () => {
  it('fasst viele Rechtecke in einem Pfad zusammen', () => {
    expect(rectsPath([])).toBe('');
    expect(rectsPath([{ x: 1, y: 2, w: 3, h: 4 }, { x: 0.04, y: 0, w: 10.26, h: 1 }])).toBe('M1 2h3v4h-3ZM0 0h10.3v1h-10.3Z');
  });
});
