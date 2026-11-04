import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { BoardObject } from '../protocol';
import {
  attachedConnectors,
  boundaryPoint,
  CONNECTOR_GAP,
  connectorBounds,
  connectorGeometry,
  connectorPath,
  dashArray,
  elbowRoute,
  endAnchor,
  nearestSide,
  type ConnectorGeometry,
} from './connector';
import type { Point } from './geometry';
import { BoardStore } from './store';

const o = (id: string, x: number, y: number, w: number, h: number, extra: Partial<BoardObject> = {}): BoardObject => ({
  id,
  type: 'sticky',
  x,
  y,
  w,
  h,
  z: 'a0',
  createdBy: '',
  updatedAt: '',
  ...extra,
});

describe('Verbinder', () => {
  it('Randpunkt eines Rechtecks in Richtung Ziel', () => {
    const r = o('r', 0, 0, 200, 100);
    expect(boundaryPoint(r, { x: 1000, y: 50 })).toEqual({ x: 200, y: 50 });
    expect(boundaryPoint(r, { x: 100, y: -500 })).toEqual({ x: 100, y: 0 });
    const diag = boundaryPoint(r, { x: 300, y: 150 });
    expect(diag.x).toBeCloseTo(200);
    expect(diag.y).toBeCloseTo(100);
  });

  it('Randpunkte von Ellipse, Raute, Dreieck', () => {
    const e = o('e', 0, 0, 200, 100, { type: 'shape', shape: 'ellipse' });
    const pe = boundaryPoint(e, { x: 100 + 300, y: 50 + 300 });
    // liegt auf der Ellipse
    expect(((pe.x - 100) / 100) ** 2 + ((pe.y - 50) / 50) ** 2).toBeCloseTo(1);
    const d = o('d', 0, 0, 200, 100, { type: 'shape', shape: 'diamond' });
    const pd = boundaryPoint(d, { x: 400, y: 50 + 300 });
    expect(Math.abs(pd.x - 100) / 100 + Math.abs(pd.y - 50) / 50).toBeCloseTo(1);
    const t = o('t', 0, 0, 100, 100, { type: 'shape', shape: 'triangle' });
    expect(boundaryPoint(t, { x: 50, y: 1000 }).y).toBeCloseTo(100); // Grundseite
  });

  it('dockt an zwei Objekte an und folgt ihnen', () => {
    const objs = new Map<string, BoardObject>([
      ['a', o('a', 0, 0, 100, 100)],
      ['b', o('b', 300, 0, 100, 100)],
    ]);
    const lookup = (id: string) => objs.get(id);
    const c = { from: { objectId: 'a' }, to: { objectId: 'b' } };
    const g = connectorGeometry(c, lookup)!;
    expect(g.a).toEqual({ x: 100 + CONNECTOR_GAP, y: 50 });
    expect(g.b).toEqual({ x: 300 - CONNECTOR_GAP, y: 50 });
    // b wandert nach unten → Verbinder folgt
    objs.set('b', o('b', 0, 400, 100, 100));
    const g2 = connectorGeometry(c, lookup)!;
    expect(g2.a).toEqual({ x: 50, y: 100 + CONNECTOR_GAP });
    expect(g2.b).toEqual({ x: 50, y: 400 - CONNECTOR_GAP });
  });

  it('freie Enden und fehlende Objekte', () => {
    const lookup = (id: string) => (id === 'a' ? o('a', 0, 0, 100, 100) : undefined);
    expect(endAnchor({ x: 5, y: 6 }, lookup)).toEqual({ x: 5, y: 6 });
    const g = connectorGeometry({ from: { objectId: 'a' }, to: { x: 500, y: 50 } }, lookup)!;
    expect(g.b).toEqual({ x: 500, y: 50 });
    expect(g.a.x).toBeCloseTo(100 + CONNECTOR_GAP);
    expect(connectorGeometry({ from: { objectId: 'weg' }, to: { x: 0, y: 0 } }, lookup)).toBeNull();
  });

  it('findet angedockte Verbinder', () => {
    const list = [
      o('x', 0, 0, 1, 1, { type: 'connector', from: { objectId: 'a' }, to: { x: 1, y: 1 } }),
      o('y', 0, 0, 1, 1, { type: 'connector', from: { x: 0, y: 0 }, to: { objectId: 'b' } }),
      o('z', 0, 0, 1, 1, { type: 'connector', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }),
    ];
    expect(attachedConnectors(list, new Set(['a']))).toEqual(['x']);
    expect(attachedConnectors(list, new Set(['a', 'b']))).toEqual(['x', 'y']);
  });

  it('folgt dem Objekt auch über den Store (Verschieben per Yjs)', () => {
    const store = new BoardStore(new Y.Doc(), 'm:1');
    const [a, b] = store.createMany([
      { type: 'sticky', x: 0, y: 0, w: 100, h: 100 },
      { type: 'sticky', x: 300, y: 0, w: 100, h: 100 },
    ]);
    const c = store.create({ type: 'connector', x: 0, y: 0, w: 1, h: 1, from: { objectId: a }, to: { objectId: b } });
    store.update(b, { y: 500 });
    const g = connectorGeometry(store.get(c)!, store.get)!;
    expect(g.b.y).toBeLessThan(500);
    expect(g.b.y).toBeGreaterThan(400);
  });
});

/** Jedes Teilstück liegt waagerecht oder senkrecht. */
const isOrtho = (pts: Point[]) => pts.every((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) < 1e-6 || Math.abs(p.y - pts[i - 1].y) < 1e-6);
const inside = (g: ConnectorGeometry, pts: Point[]) => {
  const b = connectorBounds(g, 0);
  return pts.every((p) => p.x >= b.x - 1e-6 && p.y >= b.y - 1e-6 && p.x <= b.x + b.w + 1e-6 && p.y <= b.y + b.h + 1e-6);
};

describe('Verbinder: Arten und Seiten', () => {
  const objs = new Map<string, BoardObject>([
    ['a', o('a', 0, 0, 100, 100)],
    ['b', o('b', 400, 200, 100, 100)],
    ['c', o('c', 400, -300, 100, 100)],
  ]);
  const lookup = (id: string) => objs.get(id);

  it('wählt ohne feste Seite die nächstliegende', () => {
    expect(nearestSide(objs.get('a')!, { x: 450, y: 250 })).toBe('e');
    expect(nearestSide(objs.get('a')!, { x: 60, y: 900 })).toBe('s');
    expect(nearestSide(objs.get('a')!, { x: -300, y: 40 })).toBe('w');
    expect(nearestSide(objs.get('a')!, { x: 40, y: -300 })).toBe('n');
  });

  it('gerade: dockt mit fester Seite an der Seitenmitte an', () => {
    const g = connectorGeometry({ from: { objectId: 'a', side: 's' } as never, to: { objectId: 'b', side: 'w' } as never }, lookup)!;
    expect(g.style).toBe('straight');
    expect(g.a).toEqual({ x: 50, y: 100 + CONNECTOR_GAP });
    expect(g.b).toEqual({ x: 400 - CONNECTOR_GAP, y: 250 });
    expect(g.pts).toEqual([g.a, g.b]);
    expect(g.mid).toEqual({ x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 });
  });

  it('gewinkelt: senkrecht aus der Seite, achsenparallel, höchstens zwei Knicke', () => {
    const g = connectorGeometry({ from: { objectId: 'a' }, to: { objectId: 'b' }, lineStyle: 'elbow' }, lookup)!;
    expect(g.style).toBe('elbow');
    // a rechts raus, b links rein (nächstliegende Seiten)
    expect(g.a).toEqual({ x: 100 + CONNECTOR_GAP, y: 50 });
    expect(g.b).toEqual({ x: 400 - CONNECTOR_GAP, y: 250 });
    expect(isOrtho(g.pts)).toBe(true);
    expect(g.pts.length).toBe(4); // Z-Form: 2 Knicke
    expect(g.pts[1].y).toBe(50); // erstes Stück waagerecht
    expect(g.pts[2].y).toBe(250);
    expect(g.dirB).toEqual({ x: 1, y: 0 }); // Pfeil zeigt in die linke Seite von b hinein
    expect(g.dirA).toEqual({ x: -1, y: 0 });
    expect(connectorPath(g)).toMatch(/^M[\d. -]+(L[\d. -]+){3}$/);
    expect(inside(g, g.pts)).toBe(true);
  });

  it('gewinkelt: ein Knick zwischen waagerechter und senkrechter Seite', () => {
    const g = connectorGeometry({ from: { objectId: 'a', side: 'e' } as never, to: { objectId: 'c', side: 's' } as never, lineStyle: 'elbow' }, lookup)!;
    expect(g.pts).toEqual([g.a, { x: 450, y: 50 }, g.b]);
    expect(g.b).toEqual({ x: 450, y: -200 + CONNECTOR_GAP });
    expect(g.dirB).toEqual({ x: 0, y: -1 });
  });

  it('gewinkelt: Umweg, wenn das Ziel hinter der Ausgangsseite liegt', () => {
    const pts = elbowRoute({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -200, y: 300 }, { x: -1, y: 0 });
    expect(isOrtho(pts)).toBe(true);
    expect(pts[1].x).toBeGreaterThan(0); // erst nach rechts aus der Seite
    expect(pts[pts.length - 2].x).toBeLessThan(-200); // von links in das Ziel
  });

  it('geschwungen: Bézier mit Kontrollpunkten senkrecht zur Seite', () => {
    const g = connectorGeometry({ from: { objectId: 'a' }, to: { objectId: 'b' }, lineStyle: 'curved' }, lookup)!;
    expect(g.style).toBe('curved');
    expect(g.pts).toHaveLength(4);
    const [a, c1, c2, b] = g.pts;
    expect(c1.y).toBeCloseTo(a.y); // waagerecht aus der rechten Seite
    expect(c1.x).toBeGreaterThan(a.x);
    expect(c2.y).toBeCloseTo(b.y);
    expect(c2.x).toBeLessThan(b.x);
    expect(connectorPath(g)).toMatch(/^M[\d. -]+C[\d. -]+$/);
    // Mitte liegt auf der Kurve zwischen den Enden, Grenzen umschließen die Kurve, aber nicht die weiten Kontrollpunkte
    expect(g.mid.x).toBeGreaterThan(a.x);
    expect(g.mid.x).toBeLessThan(b.x);
    const bb = connectorBounds(g, 0);
    expect(bb.x).toBeCloseTo(a.x);
    expect(bb.x + bb.w).toBeCloseTo(b.x);
  });

  it('freie Enden funktionieren bei allen Arten', () => {
    for (const lineStyle of ['straight', 'elbow', 'curved'] as const) {
      const g = connectorGeometry({ from: { x: 0, y: 0 }, to: { x: 300, y: 120 }, lineStyle }, lookup)!;
      expect(g.a).toEqual({ x: 0, y: 0 });
      expect(g.b).toEqual({ x: 300, y: 120 });
      if (lineStyle === 'elbow') expect(isOrtho(g.pts)).toBe(true);
      expect(inside(g, [g.a, g.b, g.mid])).toBe(true);
    }
  });

  it('kürzt den Pfad für Pfeilspitzen an beiden Enden', () => {
    const g = connectorGeometry({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }, lookup)!;
    expect(connectorPath(g, 0, 0, 10, 10)).toBe('M10 0L90 0');
    expect(connectorPath(g, -5, 0)).toBe('M5 0L105 0');
  });

  it('Strichmuster skaliert mit der Strichstärke', () => {
    expect(dashArray(undefined, 2)).toBeUndefined();
    expect(dashArray('solid', 2)).toBeUndefined();
    expect(dashArray('dashed', 2)).toBe('10 8');
    expect(dashArray('dashed', 6)).toBe('26 18');
    expect(dashArray('dotted', 2)).toBe('0 6');
  });

  it('gedrehtes Objekt: Randpunkt liegt auf dem gedrehten Umriss', () => {
    const r = o('r', 0, 0, 200, 100, { rotation: 90 });
    // um 90° gedreht: 100 breit, 200 hoch um die Mitte (100, 50)
    const p = boundaryPoint(r, { x: 1000, y: 50 });
    expect(p.x).toBeCloseTo(150);
    expect(p.y).toBeCloseTo(50);
  });
});
