import { describe, expect, it } from 'vitest';
import type { BoardObject } from '../../protocol';
import { align, distribute } from './arrange';
import { expandGroups, groupPatches, isWholeGroup, ungroupPatches } from './groups';
import { movePatch } from './move';
import { cloneObjects, parseClipboard, plainText, toHtml } from '../clipboard';

const obj = (id: string, x: number, y: number, extra: Partial<BoardObject> = {}): BoardObject => ({
  id,
  type: 'sticky',
  x,
  y,
  w: 100,
  h: 100,
  z: id,
  createdBy: 'm:1',
  updatedAt: '',
  ...extra,
});

describe('Ausrichten und Verteilen', () => {
  const units = [
    { key: 'a', rect: { x: 0, y: 0, w: 100, h: 50 } },
    { key: 'b', rect: { x: 300, y: 40, w: 50, h: 100 } },
    { key: 'c', rect: { x: 120, y: 200, w: 80, h: 80 } },
  ];
  it('richtet links, rechts, zentriert und unten aus', () => {
    expect(align(units, 'left')).toEqual(new Map([['b', { dx: -300, dy: 0 }], ['c', { dx: -120, dy: 0 }]]));
    expect(align(units, 'right').get('a')).toEqual({ dx: 250, dy: 0 });
    expect(align(units, 'hcenter').get('a')).toEqual({ dx: 125, dy: 0 });
    expect(align(units, 'bottom').get('a')).toEqual({ dx: 0, dy: 230 });
    expect(align(units, 'vcenter').get('c')).toEqual({ dx: 0, dy: -100 });
  });
  it('verteilt mit gleichen Abständen, äußere bleiben stehen', () => {
    const d = distribute(units, 'x');
    // Spannweite 0..350, Breiten 230 → Abstand 60; c rückt auf x=160
    expect(d.get('c')).toEqual({ dx: 40, dy: 0 });
    expect(d.has('a')).toBe(false);
    expect(d.has('b')).toBe(false);
    expect(distribute(units.slice(0, 2), 'x').size).toBe(0);
  });
});

describe('Gruppen', () => {
  const list = [obj('a', 0, 0, { groupId: 'g' }), obj('b', 200, 0, { groupId: 'g' }), obj('c', 400, 0)];
  const byId = new Map(list.map((o) => [o.id, o]));
  it('Klick auf ein Mitglied wählt die ganze Gruppe', () => {
    expect(expandGroups(['a'], list, byId).sort()).toEqual(['a', 'b']);
    expect(expandGroups(['c'], list, byId)).toEqual(['c']);
    expect(isWholeGroup(['a', 'b'], list, byId)).toBe(true);
    expect(isWholeGroup(['a'], list, byId)).toBe(false);
  });
  it('gruppieren vergibt eine gemeinsame groupId, lösen entfernt sie', () => {
    const p = groupPatches([list[2], obj('d', 0, 0)])!;
    expect(p.c.groupId).toBeTruthy();
    expect(p.c.groupId).toBe(p.d.groupId);
    expect(groupPatches([list[2]])).toBeNull();
    expect(ungroupPatches(list)).toEqual({ a: { groupId: undefined }, b: { groupId: undefined } });
  });
  it('Kopien bekommen eine neue, gemeinsame groupId', () => {
    const clones = cloneObjects(list, 10, 0, (id) => byId.get(id));
    expect(clones[0].groupId).toBeTruthy();
    expect(clones[0].groupId).not.toBe('g');
    expect(clones[0].groupId).toBe(clones[1].groupId);
    expect(clones[2].groupId).toBeUndefined();
  });
});

describe('Zwischenablage', () => {
  it('schreibt lesbaren Text und Stachel-Daten ins HTML', () => {
    const objs = [obj('a', 0, 0, { text: 'Bühne <Nord>' }), obj('f', 0, 0, { type: 'frame', title: 'Plan' }), obj('p', 0, 0, { type: 'pen' })];
    expect(plainText(objs)).toBe('Bühne <Nord>\nPlan');
    const html = toHtml(objs);
    expect(html).toContain('Bühne &lt;Nord&gt;<br>Plan');
    expect(html).not.toContain('{"marker"');
    expect(parseClipboard(html, 'egal')!.map((o) => o.id)).toEqual(['a', 'f', 'p']);
    expect(parseClipboard('<b>fremd</b>', 'Einkaufsliste')).toBeNull();
  });
});

describe('Verschieben', () => {
  it('nimmt freie Verbinder-Enden mit, angedockte nicht', () => {
    const c = obj('c', 0, 0, { type: 'connector', from: { objectId: 'a' }, to: { x: 10, y: 20 } });
    expect(movePatch(c, 5, -5)).toEqual({ x: 5, y: -5, to: { x: 15, y: 15 } });
  });
});
