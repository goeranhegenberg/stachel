import { describe, expect, it } from 'vitest';
import '../../editor/core';
import './index';
import { boundaryPoint, connectorGeometry, sidePoint } from '../../board/connector';
import { shapeKinds, objectTypes, contextActions, tools } from '../../editor/ext/registry';
import { BoardStore } from '../../board/store';
import * as Y from 'yjs';
import type { BoardObject, ShapeKind } from '../../protocol';
import { KIND_GEOMETRY } from './geometry';
import { matches, searchShapes, SHAPE_ENTRIES } from './catalog';
import { capGeom, capTrim, pathPointAt, projectOnPath, roundedElbowPath } from './connectorGeom';
import { CAP_STYLES, capOf, capPatch, fillOpacityOf, labelPosOf } from './model';
import { ALL_EMOJI, EMOJI_GROUPS, searchEmoji } from './emoji';
import { objectFor, safeIconNode } from './stickers';
import { reversePatch } from './connector';
import { STAMPS } from './stamps';

const obj = (o: Partial<BoardObject>): BoardObject => ({ id: 'x', type: 'shape', x: 0, y: 0, w: 200, h: 120, z: 'a0', createdBy: 't', updatedAt: '', ...o }) as BoardObject;

describe('Formen-Geometrie', () => {
  const kinds = Object.keys(KIND_GEOMETRY) as ShapeKind[];

  it('alle Formen liefern gültige Pfade, Umrisse im Rechteck und sinnvolle Textflächen', () => {
    expect(kinds.length).toBeGreaterThanOrEqual(22);
    for (const k of kinds) {
      const g = KIND_GEOMETRY[k]!;
      for (const [w, h] of [
        [200, 120],
        [60, 200],
        [16, 16],
      ]) {
        const d = g.path(w, h, 1);
        expect(d, k).toMatch(/^M/);
        expect(d, k).not.toMatch(/NaN|Infinity/);
        for (const p of g.outline?.(w, h) ?? []) {
          expect(p.x, k).toBeGreaterThanOrEqual(-0.01);
          expect(p.x, k).toBeLessThanOrEqual(w + 0.01);
          expect(p.y, k).toBeGreaterThanOrEqual(-0.01);
          expect(p.y, k).toBeLessThanOrEqual(h + 0.01);
        }
        const [t, r, b, l] = g.insets?.(w, h) ?? [0, 0, 0, 0];
        for (const v of [t, r, b, l]) expect(v, k).toBeGreaterThanOrEqual(0);
        if (w >= 60 && h >= 60) {
          expect(t + b, k).toBeLessThan(h);
          expect(l + r, k).toBeLessThan(w);
        }
      }
      if (g.simpleClip) expect(g.simpleClip).toMatch(/^polygon\(.+\)$/);
    }
  });

  it('alle Formen stehen im Formen-Register, jede Bibliotheksform ist registriert', () => {
    const registered = new Set(shapeKinds.list().map((s) => s.kind));
    for (const e of SHAPE_ENTRIES) expect(registered.has(e.kind), e.id).toBe(true);
    // Kernformen behalten ihre Namen (Ansagen, Tests)
    expect(shapeKinds.get('ellipse')!.label).toBe('Ellipse');
    expect(shapeKinds.get('star')!.label).toBe('Stern');
  });

  it('Wolke: jeder Bogen endet an einem neuen Punkt (kein doppelter Umlauf)', () => {
    const d = KIND_GEOMETRY.cloud!.path(160, 120, 1);
    const ends = [...d.matchAll(/A[\d.]+ [\d.]+ 0 0 1 ([\d.]+ [\d.]+)/g)].map((m) => m[1]);
    expect(ends).toHaveLength(9);
    expect(new Set(ends).size).toBe(9);
    expect(ends.at(-1)).toBe(d.match(/^M([\d.]+ [\d.]+)/)![1]);
  });

  it('Erweiterte Formen: Pfeile oben/unten, Herz und das Flussdiagramm-Set sind da', () => {
    for (const k of ['arrowUp', 'arrowDown', 'pentagonArrow', 'heart', 'manualOperation', 'offPage', 'merge', 'card', 'sort', 'multiDocument', 'display', 'storedData', 'internalStorage', 'summing', 'or'] as ShapeKind[])
      expect(shapeKinds.get(k), k).toBeTruthy();
    expect(SHAPE_ENTRIES.filter((e) => e.section === 'flow').length).toBeGreaterThanOrEqual(22);
    // Pfeil oben: Spitze oben in der Mitte, Pfeil unten: unten
    const up = obj({ shape: 'arrowUp', w: 100, h: 200 });
    expect(boundaryPoint(up, { x: 50, y: -1000 }).y).toBeCloseTo(0, 0);
    const down = obj({ shape: 'arrowDown', w: 100, h: 200 });
    expect(boundaryPoint(down, { x: 50, y: 1000 }).y).toBeCloseTo(200, 0);
  });

  it('Verbinder docken am Umriss an: Stern, Pfeil, Zylinder', () => {
    const star = obj({ shape: 'star', w: 160, h: 152 });
    const right = boundaryPoint(star, { x: 1000, y: 76 + 30 });
    // rechte Kante des Rechtecks wäre x=160 – am Stern liegt der Punkt deutlich weiter innen
    expect(right.x).toBeLessThan(150);
    const arrow = obj({ shape: 'arrowRight', w: 200, h: 100 });
    expect(boundaryPoint(arrow, { x: 1000, y: 50 }).x).toBeCloseTo(200, 0);
    // Schaft ist schmaler als die Form: senkrecht von oben trifft er bei y = 22 % der Höhe
    expect(boundaryPoint(arrow, { x: 40, y: -1000 }).y).toBeCloseTo(22, 0);
    // Andockpunkt oben am Sechseck liegt auf der oberen Kante
    expect(sidePoint(obj({ shape: 'hexagon', w: 170, h: 145 }), 'n').p.y).toBeCloseTo(0, 5);
  });
});

describe('Bibliothek und Suche', () => {
  it('findet mit Umlauten, Schreibvarianten und Suchwörtern', () => {
    expect(searchShapes('daten').map((e) => e.id)).toEqual(['data', 'database', 'storedData']);
    expect(searchShapes('fuenf').map((e) => e.id)).toEqual(['pentagon']);
    expect(searchShapes('Fünfeck').map((e) => e.id)).toEqual(['pentagon']);
    expect(searchShapes('ja nein').map((e) => e.id)).toEqual(['decision']);
    expect(searchShapes('')).toHaveLength(SHAPE_ENTRIES.length);
    expect(matches('GRÜN', 'grün')).toBe(true);
  });

  it('Emoji: eigener Datensatz ohne Doppelte, Suche auf Deutsch', () => {
    expect(ALL_EMOJI.length).toBeGreaterThan(450);
    expect(new Set(ALL_EMOJI.map((e) => e.ch)).size).toBe(ALL_EMOJI.length);
    for (const g of EMOJI_GROUPS) for (const e of g.items) expect(e.keys.trim(), e.ch).not.toBe('');
    expect(searchEmoji('kaktus').map((e) => e.ch)).toContain('🌵');
    expect(searchEmoji('daumen hoch').map((e) => e.ch)[0]).toBe('👍');
    expect(searchEmoji('bier').map((e) => e.ch)).toEqual(expect.arrayContaining(['🍺', '🍻']));
  });

  it('Icons: Auswahl mit deutschen Namen, jede Zeichnung übersteht die Absicherung', async () => {
    const { ICONS } = await import('./iconSet');
    expect(ICONS.length).toBeGreaterThan(250);
    expect(new Set(ICONS.map((i) => i.name)).size).toBe(ICONS.length);
    const tent = ICONS.find((i) => i.name === 'tent')!;
    expect(tent.label).toBe('Zelt');
    for (const i of ICONS) {
      const safe = safeIconNode(i.node);
      expect(safe.length, i.name).toBe(i.node.length);
      expect(JSON.stringify(safe), i.name).toBe(JSON.stringify(i.node.map(([t, a]) => [t, Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'key'))])));
    }
  });
});

describe('Verbinder', () => {
  const lookup = (id: string) => ({ a: obj({ id: 'a', x: 0, y: 0, w: 100, h: 100 }), b: obj({ id: 'b', x: 400, y: 300, w: 100, h: 100 }) })[id];

  it('Punkt entlang der Linie und Projektion passen zusammen (gerade, gewinkelt, geschwungen)', () => {
    for (const lineStyle of ['straight', 'elbow', 'curved'] as const) {
      const g = connectorGeometry({ from: { objectId: 'a' }, to: { objectId: 'b' }, lineStyle }, lookup)!;
      for (const t of [0.1, 0.35, 0.5, 0.8]) {
        const p = pathPointAt(g, t);
        expect(projectOnPath(g, p), `${lineStyle} ${t}`).toBeCloseTo(t, 2);
      }
      expect(pathPointAt(g, 0)).toEqual(g.a);
    }
  });

  it('Spitzen: Form, Abstand der Linie und Kompatibilität mit arrowStart/arrowEnd', () => {
    const tip = { x: 100, y: 0 };
    const dir = { x: 1, y: 0 };
    expect(capGeom('none', tip, dir, 2)).toBeNull();
    expect(capGeom('triangle', tip, dir, 2)).toMatchObject({ kind: 'polygon', filled: true });
    expect(capGeom('triangleOpen', tip, dir, 2)).toMatchObject({ kind: 'polygon', filled: false });
    expect(capGeom('arrow', tip, dir, 2)).toMatchObject({ kind: 'polyline' });
    expect(capGeom('circle', tip, dir, 2)).toMatchObject({ kind: 'circle', filled: true });
    expect(capGeom('diamondOpen', tip, dir, 2)).toMatchObject({ kind: 'polygon', filled: false });
    expect(capGeom('bar', tip, dir, 2)).toMatchObject({ kind: 'line' });
    // Kreis liegt vor der Spitze, die Linie endet am Kreis
    const c = capGeom('circle', tip, dir, 2) as { c: { x: number }; r: number };
    expect(c.c.x + c.r).toBeCloseTo(100, 5);
    expect(capTrim('circle', 2)).toBeCloseTo(2 * c.r, 5);
    for (const cap of CAP_STYLES) expect(capTrim(cap, 2)).toBeGreaterThanOrEqual(0);

    // alte Boards: nur arrowStart/arrowEnd
    expect(capOf({}, 'end')).toBe('triangle');
    expect(capOf({ arrowEnd: false }, 'end')).toBe('none');
    expect(capOf({ arrowStart: true }, 'start')).toBe('triangle');
    expect(capOf({}, 'start')).toBe('none');
    expect(capOf({ capEnd: 'bogus' as never }, 'end')).toBe('triangle');
    // neue Spitzen setzen die alten Schalter passend (ältere Clients zeigen Pfeil bzw. keinen)
    for (const cap of CAP_STYLES) {
      expect(capOf(capPatch('end', cap) as BoardObject, 'end')).toBe(cap);
      expect(capOf(capPatch('start', cap) as BoardObject, 'start')).toBe(cap);
    }
    expect(capPatch('end', 'none')).toEqual({ capEnd: undefined, arrowEnd: false });
    expect(capPatch('start', 'circle')).toEqual({ capStart: 'circle', arrowStart: true });
  });

  it('gewinkelte Linie mit runden Ecken: gleiche Endpunkte, Bögen an jedem Knick', () => {
    const g = connectorGeometry({ from: { objectId: 'a' }, to: { objectId: 'b' }, lineStyle: 'elbow' }, lookup)!;
    const d = roundedElbowPath(g, 0, 0, 0, 0, 12);
    expect(d.startsWith(`M${g.a.x} ${g.a.y}`)).toBe(true);
    expect(d.endsWith(`L${g.b.x} ${g.b.y}`)).toBe(true);
    expect(d.match(/Q/g)?.length).toBe(g.pts.length - 2);
    // gekürzt um die Spitze: Ende rückt entlang der Endrichtung zurück
    const t = roundedElbowPath(g, 0, 0, 0, 10, 12);
    expect(t.endsWith(`L${g.b.x - g.dirB.x * 10} ${g.b.y - g.dirB.y * 10}`)).toBe(true);
  });

  it('Richtung umkehren tauscht Enden, Spitzen und Lage der Beschriftung', () => {
    const o = obj({ type: 'connector', from: { objectId: 'a', side: 'e' }, to: { x: 5, y: 6 }, capStart: 'diamond', arrowStart: true, arrowEnd: false, labelPos: 0.2 });
    const p = reversePatch(o);
    expect(p).toMatchObject({ from: { x: 5, y: 6 }, to: { objectId: 'a', side: 'e' }, capEnd: 'diamond', arrowEnd: true, arrowStart: undefined });
    expect(p.labelPos).toBeCloseTo(0.8, 5);
  });

  it('Werte außerhalb des Bereichs werden begrenzt', () => {
    expect(fillOpacityOf({})).toBe(1);
    expect(fillOpacityOf({ fillOpacity: -2 })).toBe(0);
    expect(fillOpacityOf({ fillOpacity: Number.NaN })).toBe(1);
    expect(labelPosOf({})).toBe(0.5);
    expect(labelPosOf({ labelPos: 3 })).toBe(0.98);
  });

  it('Kern-Einträge sind ersetzt, nicht verdoppelt', () => {
    expect(contextActions.list().filter((a) => a.id === 'core.connector')).toHaveLength(1);
    expect(contextActions.get('core.shape')!.pops!['shapes.fill']).toBeTruthy();
    expect(tools.get('connector')!.Options).toBeTruthy();
    expect(tools.get('shapes.sticker')).toBeTruthy();
    expect(objectTypes.get('shape')!.colorable).toBe(false);
  });
});

describe('Sticker und Icons im Store', () => {
  it('neue Typen sind dem Store bekannt, Kopieren behält sie, Undo nimmt sie zurück', () => {
    const doc = new Y.Doc();
    const store = new BoardStore(doc, 'a:test');
    const s = store.create(objectFor({ kind: 'stamp', id: 'like' }, { x: 0, y: 0 }));
    const e = store.create(objectFor({ kind: 'emoji', ch: '🌵' }, { x: 100, y: 0 }));
    const i = store.create(objectFor({ kind: 'icon', name: 'tent', label: 'Zelt', node: [['path', { d: 'M1 1L5 5' }]] }, { x: 200, y: 0 }));
    const snap = store.getSnapshot();
    expect(snap.byId.get(s)).toMatchObject({ type: 'sticker', stamp: 'like', w: 72, h: 72, x: -36, y: -36 });
    expect(snap.byId.get(e)).toMatchObject({ type: 'sticker', emoji: '🌵', w: 96 });
    expect(snap.byId.get(i)).toMatchObject({ type: 'icon', icon: 'tent', iconNode: [['path', { d: 'M1 1L5 5' }]] });
    store.stopCapturing();
    store.undo();
    expect(store.getSnapshot().byId.has(i)).toBe(false);
    expect(STAMPS.map((x) => x.id)).toEqual(expect.arrayContaining(['like', 'heart', 'check', 'question', 'plusOne', 'star']));
  });

  it('Icon-Zeichnung: fremde Tags und Attribute fallen weg', () => {
    expect(
      safeIconNode([
        ['path', { d: 'M4 4L20 20', onload: 'alert(1)', style: 'x' }],
        ['script', { src: 'x' }],
        ['foreignObject', {}],
        ['circle', { cx: 12, cy: '12', r: 'url(javascript:1)' }],
        'kaputt',
      ]),
    ).toEqual([
      ['path', { d: 'M4 4L20 20' }],
      ['circle', { cx: 12, cy: '12' }],
    ]);
    expect(safeIconNode(null)).toEqual([]);
  });
});
