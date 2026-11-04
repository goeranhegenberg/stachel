// Web-Aktionen der Notiz-Stapel (Quick Win Q2, docs/contract.md §8.12): Ergebnis = die Web-Funktionen aus
// web/src/features/shapes/stack/model.ts direkt auf einem Browser-Store (gleiche Felder, gleiche Reihenfolge).
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import '#stachel-web';
import { BoardStore } from '../../web/src/board/store';
import { nativeAction, nativeActionList } from '../../web/src/native/registry';
import { cycleStack, dropNotes, spreadStack, takeFromStack } from '../../web/src/features/shapes/stack/model';

const ctx = { user: { key: 'a:t', name: 'T' }, now: new Date().toISOString(), v: 1, id: (n: number) => `k-${n}`, exists: () => false, measure: () => 0 };
const run = (store: BoardStore, name: string, raw: Record<string, unknown>) => {
  const def = nativeAction(name)!;
  const p = def.args(raw, 1);
  if (!p.ok) throw new Error(p.error);
  return def.run(store, p.args, ctx);
};

/** Zwei gleiche Boards: a, b, c, d nebeneinander, b fast mittig auf a gezogen */
function pair() {
  return [0, 1].map(() => {
    const s = new BoardStore(new Y.Doc(), 'a:ref');
    s.createMany(['a', 'b', 'c', 'd'].map((id, i) => ({ id, type: 'sticky', x: i * 400, y: 0, w: 200, h: 200, text: id, color: '#fff27a' })));
    s.update('b', { x: 10, y: 6 });
    return s;
  }) as [BoardStore, BoardStore];
}
/** Vergleichbarer Stand (ohne Zeitstempel und z – die Reihenfolge prüft `ordered`) */
const plain = (s: BoardStore) => s.getSnapshot().ordered.map(({ updatedAt: _u, z: _z, ...o }) => o);

describe('Notiz-Stapel aus der App', () => {
  it('sind angemeldet und prüfen die Argumente', () => {
    const list = nativeActionList();
    for (const a of ['shapes.stackDrop', 'shapes.stackCycle', 'shapes.stackSpread', 'shapes.stackTake']) expect(list[a], a).toBeGreaterThanOrEqual(1);
    expect(nativeAction('shapes.stackDrop')!.args({ ids: [] }, 1).ok).toBe(false);
    expect(nativeAction('shapes.stackDrop')!.args({ ids: ['a'], grabbed: 'a' }, 1).ok).toBe(true);
    expect(nativeAction('shapes.stackCycle')!.args({ id: 'a', dir: 2 }, 1).ok).toBe(false);
    expect(nativeAction('shapes.stackCycle')!.args({ id: 'a', dir: -1 }, 1).ok).toBe(true);
    expect(nativeAction('shapes.stackTake')!.args({ id: 'a', which: 5 }, 1).ok).toBe(false);
  });

  it('Ablegen, Durchblättern, Abnehmen, Auffächern = dieselben Web-Funktionen', () => {
    const [app, web] = pair();
    expect(run(app, 'shapes.stackDrop', { ids: ['b'], grabbed: 'b' })).toEqual({ select: ['a', 'b'] });
    dropNotes(web, ['b'], 'b', () => 'k-1');
    for (const s of [app, web]) s.update('c', { x: 14, y: 4 });
    expect(run(app, 'shapes.stackDrop', { ids: ['c'], grabbed: 'c' })).toEqual({ select: ['a', 'b', 'c'] });
    dropNotes(web, ['c'], 'c', () => 'k-1');
    expect(plain(app)).toEqual(plain(web));
    expect(app.getSnapshot().byId.get('a')!.groupId).toBe('k-1');

    expect(run(app, 'shapes.stackCycle', { id: 'a', dir: 1 })).toEqual({ data: { top: 'b' } });
    cycleStack(web, 'a', 1);
    expect(plain(app)).toEqual(plain(web));

    expect(run(app, 'shapes.stackTake', { id: 'a' })).toEqual({ select: ['b'] });
    takeFromStack(web, 'a');
    expect(plain(app)).toEqual(plain(web));

    expect(run(app, 'shapes.stackSpread', { id: 'c' })).toEqual({ select: ['a', 'c'] });
    spreadStack(web, 'c');
    expect(plain(app)).toEqual(plain(web));
    // nichts mehr zu tun
    expect(run(app, 'shapes.stackSpread', { id: 'c' })).toEqual({ skipped: true });
    expect(run(app, 'shapes.stackDrop', { ids: ['d'], grabbed: 'd' })).toEqual({ skipped: true });
  });
});
