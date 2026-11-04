import { describe, expect, it } from 'vitest';
import { descendants, H_GAP, layoutMind, mindTree, V_GAP, type MindIn } from './layout';

const size = () => ({ w: 100, h: 40 });
const node = (id: string, parent?: string, extra: Partial<MindIn> = {}): MindIn => ({ id, parent, x: 0, y: 0, order: 0, ...extra });

describe('Mindmap-Layout', () => {
  it('Wurzel bleibt stehen, Kinder rechts untereinander und mittig', () => {
    const out = layoutMind([node('r', undefined, { x: 500, y: 300 }), node('a', 'r', { order: 0 }), node('b', 'r', { order: 1 })], size);
    expect(out.get('r')).toMatchObject({ x: 500, y: 300, level: 0, hidden: false });
    const a = out.get('a')!;
    const b = out.get('b')!;
    expect(a.x).toBe(500 + 100 + H_GAP);
    expect(b.y - a.y).toBe(40 + V_GAP);
    // Mitte der Kinder = Mitte der Wurzel
    expect((a.y + b.y + 40) / 2).toBe(300 + 20);
    expect(a).toMatchObject({ level: 1, side: 'r' });
  });

  it('linke Seite, Reihenfolge nach order, Enkel erben die Seite', () => {
    const out = layoutMind([node('r'), node('a', 'r', { side: 'l', order: 2 }), node('b', 'r', { side: 'l', order: 1 }), node('c', 'a')], size);
    expect(out.get('a')!.x).toBe(-H_GAP - 100);
    expect(out.get('b')!.y).toBeLessThan(out.get('a')!.y);
    expect(out.get('c')).toMatchObject({ side: 'l', level: 2, x: -2 * (H_GAP + 100) });
  });

  it('Teilbäume nehmen den Platz ihrer Kinder ein', () => {
    const out = layoutMind([node('r'), node('a', 'r', { order: 0 }), node('a1', 'a', { order: 0 }), node('a2', 'a', { order: 1 }), node('a3', 'a', { order: 2 }), node('b', 'r', { order: 1 })], size);
    // b liegt unter dem ganzen Teilbaum von a
    expect(out.get('b')!.y).toBeGreaterThanOrEqual(out.get('a3')!.y + 40 + V_GAP - 1);
  });

  it('eingeklappte Zweige sind versteckt und brauchen keinen Platz', () => {
    const open = layoutMind([node('r'), node('a', 'r', { order: 0 }), node('a1', 'a'), node('a2', 'a', { order: 1 }), node('b', 'r', { order: 1 })], size);
    const closed = layoutMind([node('r'), node('a', 'r', { order: 0, collapsed: true }), node('a1', 'a'), node('a2', 'a', { order: 1 }), node('b', 'r', { order: 1 })], size);
    expect(closed.get('a1')!.hidden).toBe(true);
    expect(closed.get('a2')!.hidden).toBe(true);
    expect(closed.get('b')!.y - closed.get('a')!.y).toBeLessThan(open.get('b')!.y - open.get('a')!.y);
  });

  it('Zyklen und fehlende Eltern machen Wurzeln', () => {
    const t = mindTree([node('a', 'b'), node('b', 'a'), node('c', 'gibtsnicht')]);
    expect(t.roots.map((n) => n.id).sort()).toEqual(['a', 'c']);
    expect(descendants([node('r'), node('a', 'r'), node('a1', 'a'), node('b', 'r')], 'a')).toEqual(['a1']);
  });
});
