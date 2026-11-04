import { describe, expect, it } from 'vitest';
import type { BoardObject } from '../../protocol';
import type { Snapshot } from '../../board/store';
import { authorLabels } from './authorLabels';

const note = (id: string, x: number, y: number, by: string, extra: Partial<BoardObject> = {}) =>
  ({ id, type: 'sticky', x, y, w: 200, h: 200, z: id, createdBy: by, updatedAt: '', color: '#fff27a', text: '', ...extra }) as BoardObject;
const snapOf = (objs: BoardObject[]) => ({ ordered: objs, byId: new Map(objs.map((o) => [o.id, o])) }) as unknown as Snapshot;
const names: Record<string, string> = { 'm:1': 'Mara', 'm:2': 'Tom' };
const nameOf = (k: string) => names[k] ?? null;

describe('Autor:in an Haftnotizen (Board-Einstellung authors)', () => {
  it('Name unten links an jeder sichtbaren Haftnotiz im Bild, mit Notizbreite als Platz', () => {
    const snap = snapOf([note('a', 0, 0, 'm:1'), note('b', 300, 0, 'm:2'), { ...note('s', 600, 0, 'm:1'), type: 'shape' } as BoardObject]);
    const l = authorLabels(snap, { x: 0, y: 0, z: 1 }, 1000, 800, nameOf, null);
    expect(l).toEqual([
      { id: 'a', x: 0, y: 200, maxW: 200, name: 'Mara' },
      { id: 'b', x: 300, y: 200, maxW: 200, name: 'Tom' },
    ]);
    // Kamera verschoben und gezoomt: Bildschirm-Koordinaten
    expect(authorLabels(snap, { x: 100, y: 50, z: 0.5 }, 1000, 800, nameOf, null)[1]).toEqual({ id: 'b', x: 250, y: 150, maxW: 100, name: 'Tom' });
  });

  it('nicht: unbekannte Person, ohne createdBy, beim Schreiben, ausgeblendet, zu klein, außerhalb des Bildes', () => {
    const snap = snapOf([
      note('fremd', 0, 0, 'm:9'),
      note('leer', 0, 0, ''),
      note('schreibt', 0, 0, 'm:1'),
      note('weg', 0, 0, 'm:1', { hidden: true } as Partial<BoardObject>),
      note('draußen', 5000, 0, 'm:1'),
      note('ok', 0, 300, 'm:1'),
    ]);
    expect(authorLabels(snap, { x: 0, y: 0, z: 1 }, 1000, 800, nameOf, 'schreibt').map((l) => l.id)).toEqual(['ok']);
    // 200 × 0,25 = 50 px < 60 px
    expect(authorLabels(snap, { x: 0, y: 0, z: 0.25 }, 1000, 800, nameOf, null)).toEqual([]);
  });
});
