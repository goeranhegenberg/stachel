import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardStore } from '../../../board/store';
import { allStacks, cycleStack, dropNotes, selectedStack, spreadStack, STACK_GAP, stackOf, stackTarget, takeFromStack } from './model';

/** Notizen nebeneinander (je 400 px Abstand), damit nichts zufällig übereinander liegt */
function board(...ids: string[]) {
  const s = new BoardStore(new Y.Doc(), 'm:1');
  s.createMany(ids.map((id, i) => ({ id, type: 'sticky', x: i * 400, y: 0, w: 200, h: 200, text: id, color: '#fff27a' })));
  return s;
}
let n = 0;
const gid = () => `g${++n}`;
const get = (s: BoardStore, id: string) => s.getSnapshot().byId.get(id)!;
const order = (s: BoardStore) => s.getSnapshot().ordered.map((o) => o.id);
const members = (s: BoardStore, id: string) => stackOf(get(s, id), s.getSnapshot()).map((o) => o.id);
/** `id` fast mittig auf `onto` ziehen und ablegen */
const put = (s: BoardStore, id: string, onto: string) => {
  const t = get(s, onto);
  s.update(id, { x: t.x + 12, y: t.y + 8 });
  return dropNotes(s, [id], id, gid);
};

describe('Notiz-Stapel', () => {
  it('Ablegen mittig auf einer Notiz legt die gezogene oben auf, gleiche Lage/Größe, ein Stapel aus zwei', () => {
    const s = board('a', 'b');
    s.update('a', { w: 260, h: 180 });
    expect(put(s, 'b', 'a')).toEqual(['a', 'b']);
    expect(get(s, 'b')).toMatchObject({ x: 0, y: 0, w: 260, h: 180, stacked: true, groupId: get(s, 'a').groupId });
    expect(get(s, 'a').stacked).toBe(true);
    expect(order(s).at(-1)).toBe('b');
    expect(allStacks(s.getSnapshot()).size).toBe(1);
  });

  it('nur nah an der Mitte (innere Hälfte), nicht auf gesperrte, nicht mit anderen Typen', () => {
    const s = board('a', 'b', 'l', 'm');
    s.update('l', { locked: true });
    const snap = () => s.getSnapshot();
    s.update('b', { x: 120 });
    expect(stackTarget([get(s, 'b')], snap(), 'b')).toBeNull(); // Mitte außerhalb der inneren Hälfte
    s.update('b', { x: 40 });
    expect(stackTarget([get(s, 'b')], snap(), 'b')?.id).toBe('a');
    s.update('m', { x: 810 });
    expect(stackTarget([get(s, 'm')], snap(), 'm')).toBeNull(); // Ziel gesperrt
    s.createMany([{ id: 'r', type: 'shape', shape: 'rect', x: 40, y: 0, w: 100, h: 100 }]);
    expect(stackTarget([get(s, 'b'), get(s, 'r')], snap(), 'b')).toBeNull();
  });

  it('auf einen Stapel ablegen wächst ihn; ganzen Stapel auf eine Notiz ziehen legt alle darauf', () => {
    const s = board('a', 'b', 'c', 'd');
    put(s, 'b', 'a');
    put(s, 'c', 'b');
    expect(members(s, 'a')).toEqual(['a', 'b', 'c']);
    // ganzen Stapel auf d ziehen (gegriffen an c)
    s.updateMany({ a: { x: 1210 }, b: { x: 1210 }, c: { x: 1210 } });
    expect(dropNotes(s, ['a', 'b', 'c'], 'c', gid)).toEqual(['d', 'a', 'b', 'c']);
    expect(new Set(['a', 'b', 'c', 'd'].map((id) => get(s, id).groupId)).size).toBe(1);
  });

  it('eine Notiz aus dem Stapel herausziehen nimmt sie ab; bleibt eine übrig, ist der Stapel weg; ganzer Stapel bleibt', () => {
    const s = board('a', 'b', 'c');
    put(s, 'b', 'a');
    put(s, 'c', 'a');
    // ganzer Stapel bewegt, ohne Ziel: bleibt ein Stapel
    s.updateMany({ a: { x: 3000 }, b: { x: 3000 }, c: { x: 3000 } });
    expect(dropNotes(s, ['a', 'b', 'c'], 'c', gid)).toBeNull();
    expect(members(s, 'a')).toHaveLength(3);
    s.update('c', { x: 3600 });
    expect(dropNotes(s, ['c'], 'c', gid)).toEqual(['c']);
    expect(get(s, 'c').groupId).toBeUndefined();
    expect(members(s, 'a')).toEqual(['a', 'b']);
    s.update('b', { x: 4200 });
    dropNotes(s, ['b'], 'b', gid);
    expect(get(s, 'a').groupId).toBeUndefined();
    expect(get(s, 'a').stacked).toBeUndefined();
    expect(allStacks(s.getSnapshot()).size).toBe(0);
  });

  it('Durchblättern tauscht nur die z-Werte; vorwärts und zurück ist wieder der Anfang', () => {
    const s = board('x', 'a', 'b', 'c', 'top');
    put(s, 'b', 'a');
    put(s, 'c', 'a');
    s.bringToFront(['top']);
    const zs = ['a', 'b', 'c'].map((id) => get(s, id).z).sort();
    expect(cycleStack(s, 'a', 1)).toBe('b');
    expect(order(s).filter((id) => 'abc'.includes(id))).toEqual(['c', 'a', 'b']);
    expect(['a', 'b', 'c'].map((id) => get(s, id).z).sort()).toEqual(zs);
    expect(order(s)[0]).toBe('x');
    expect(order(s).at(-1)).toBe('top');
    expect(cycleStack(s, 'a', -1)).toBe('c');
    expect(order(s).filter((id) => 'abc'.includes(id))).toEqual(['a', 'b', 'c']);
  });

  it('Auffächern: Raster ab der Ecke, oberste zuerst, Stapel aufgelöst', () => {
    const s = board('a', 'b', 'c');
    s.update('a', { x: 100, y: 50 });
    put(s, 'b', 'a');
    put(s, 'c', 'a');
    expect(spreadStack(s, 'b')).toEqual(['c', 'b', 'a']);
    const step = 200 + STACK_GAP;
    expect([get(s, 'c'), get(s, 'b'), get(s, 'a')].map((o) => [o.x, o.y])).toEqual([
      [100, 50],
      [100 + step, 50],
      [100, 50 + step],
    ]);
    expect(['a', 'b', 'c'].every((id) => get(s, id).groupId === undefined && get(s, id).stacked === undefined)).toBe(true);
  });

  it('Oberste abnehmen legt sie rechts daneben; eine bestimmte abnehmen', () => {
    const s = board('a', 'b', 'c');
    put(s, 'b', 'a');
    put(s, 'c', 'a');
    expect(takeFromStack(s, 'a')).toBe('c');
    expect(get(s, 'c')).toMatchObject({ x: 200 + STACK_GAP, y: 0 });
    expect(get(s, 'c').groupId).toBeUndefined();
    expect(members(s, 'a')).toHaveLength(2);
    expect(takeFromStack(s, 'b', 'a')).toBe('a');
    expect(allStacks(s.getSnapshot()).size).toBe(0);
  });

  it('selectedStack erkennt nur den ganzen Stapel', () => {
    const s = board('a', 'b', 'c');
    put(s, 'b', 'a');
    const snap = s.getSnapshot();
    expect(selectedStack(['a', 'b'], snap)?.map((o) => o.id)).toEqual(['a', 'b']);
    expect(selectedStack(['a'], snap)).toBeNull();
    expect(selectedStack(['a', 'c'], snap)).toBeNull();
  });

  it('Rückgängig nimmt das Stapeln in einem Schritt zurück', () => {
    const s = board('a', 'b');
    s.update('b', { x: 30, y: 30 });
    s.stopCapturing();
    dropNotes(s, ['b'], 'b', gid);
    s.stopCapturing();
    s.undo();
    expect(get(s, 'b')).toMatchObject({ x: 30, y: 30 });
    expect(get(s, 'b').groupId).toBeUndefined();
    expect(get(s, 'a').stacked).toBeUndefined();
  });
});
