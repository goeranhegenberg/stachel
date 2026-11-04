import { describe, expect, it } from 'vitest';
import type { BoardObject } from '../../../protocol';
import { framesInOrder, movePatches } from './order';

const f = (id: string, x: number, y: number, slide?: string) => ({ id, type: 'frame', x, y, w: 100, h: 100, z: '', createdBy: '', updatedAt: '', slide }) as BoardObject;

describe('Rahmen-Reihenfolge', () => {
  it('ohne eigene Reihenfolge: Lesereihenfolge (Zeilen, dann links nach rechts)', () => {
    const list = [f('c', 0, 300), f('b', 200, 10), f('a', 0, 0)];
    expect(framesInOrder(list).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('Rahmen mit `slide` zuerst, neue Rahmen hinten', () => {
    const list = [f('a', 0, 0, 'a2'), f('b', 200, 0, 'a1'), f('neu', 0, 300)];
    expect(framesInOrder(list).map((x) => x.id)).toEqual(['b', 'a', 'neu']);
  });

  it('Verschieben schreibt Schlüssel (alle beim ersten Mal, danach nur einen)', () => {
    const list = [f('a', 0, 0), f('b', 200, 0), f('c', 400, 0)];
    const p = movePatches(list, 2, 0);
    expect(Object.keys(p).sort()).toEqual(['a', 'b', 'c']);
    const after = framesInOrder(list.map((x) => ({ ...x, ...p[x.id] })));
    expect(after.map((x) => x.id)).toEqual(['c', 'a', 'b']);
    const p2 = movePatches(after, 0, 2);
    expect(Object.keys(p2)).toEqual(['c']);
    expect(framesInOrder(after.map((x) => ({ ...x, ...p2[x.id] }))).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(movePatches(after, 1, 1)).toEqual({});
  });
});
