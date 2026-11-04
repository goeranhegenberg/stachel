import { describe as group, expect, it } from 'vitest';
import type { BoardVersionInfo } from '../../protocol';
import { dayLabel, describe, groupByDay, objectsLabel, peopleOf, stamp, timeLabel, whenLabel } from './format';

const now = new Date(2026, 9, 30, 15, 0); // Freitag, 30. Oktober 2026, Ortszeit

function v(at: Date, patch: Partial<BoardVersionInfo> = {}): BoardVersionInfo {
  return { id: `v${at.getTime()}`, createdAt: at.toISOString(), kind: 'auto', name: null, people: [], by: null, restoredFrom: null, objects: 3, bytes: 100, ...patch };
}

group('Versionsverlauf: Texte', () => {
  it('Tage: Heute, Gestern, Wochentag mit Datum, fremdes Jahr mit Jahreszahl', () => {
    expect(dayLabel(new Date(2026, 9, 30, 0, 5), now)).toBe('Heute');
    expect(dayLabel(new Date(2026, 9, 29, 23, 59), now)).toBe('Gestern');
    expect(dayLabel(new Date(2026, 9, 28, 9), now)).toBe('Mittwoch, 28. Oktober');
    expect(dayLabel(new Date(2025, 11, 31, 9), now)).toBe('Mittwoch, 31. Dezember 2025');
    // Monatswechsel: 1. November → 31. Oktober ist „Gestern“
    expect(dayLabel(new Date(2026, 9, 31, 12), new Date(2026, 10, 1, 8))).toBe('Gestern');
  });

  it('Uhrzeit und Stempel', () => {
    expect(timeLabel(new Date(2026, 9, 30, 9, 5))).toBe('09:05');
    expect(stamp(new Date(2026, 9, 28, 14, 20).toISOString(), now)).toBe('28.10., 14:20');
    expect(stamp(new Date(2025, 2, 3, 8, 0).toISOString(), now)).toBe('3.3.2025, 08:00');
    expect(whenLabel(new Date(2026, 9, 30, 14, 20).toISOString(), now)).toBe('heute, 14:20');
    expect(whenLabel(new Date(2026, 9, 29, 14, 20).toISOString(), now)).toBe('gestern, 14:20');
    expect(whenLabel(new Date(2026, 9, 20, 14, 20).toISOString(), now)).toBe('20.10., 14:20');
  });

  it('gruppiert nach Kalendertagen in der Reihenfolge der Liste (neueste zuerst)', () => {
    const list = [v(new Date(2026, 9, 30, 14)), v(new Date(2026, 9, 30, 9)), v(new Date(2026, 9, 29, 22)), v(new Date(2026, 9, 27, 8))];
    const g = groupByDay(list, now);
    expect(g.map((x) => [x.label, x.items.length])).toEqual([
      ['Heute', 2],
      ['Gestern', 1],
      ['Dienstag, 27. Oktober', 1],
    ]);
    expect(groupByDay([], now)).toEqual([]);
  });

  it('beschreibt die Art der Version', () => {
    const at = new Date(2026, 9, 30, 14);
    expect(describe(v(at), now)).toBe('Automatisch gesichert');
    expect(describe(v(at, { people: [{ key: 'm:1', name: 'Mara Lindner' }] }), now)).toBe('Bearbeitet von Mara');
    expect(describe(v(at, { people: [{ key: 'm:1', name: 'Mara' }, { key: 'm:2', name: 'Jonas' }] }), now)).toBe('Bearbeitet von Mara und Jonas');
    expect(
      describe(v(at, { people: ['Mara', 'Jonas', 'Lena', 'Ida'].map((name, i) => ({ key: `m:${i}`, name })) }), now),
    ).toBe('Bearbeitet von Mara, Jonas und 2 weitere');
    expect(describe(v(at, { kind: 'manual', by: { key: 'm:1', name: 'Mara' } }), now)).toBe('Gespeichert von Mara');
    expect(describe(v(at, { kind: 'backup' }), now)).toBe('Sicherung vor dem Wiederherstellen');
    expect(describe(v(at, { kind: 'restored', by: { key: 'a:jonas', name: 'Jonas' }, restoredFrom: new Date(2026, 9, 29, 10, 0).toISOString() }), now)).toBe(
      'Jonas hat den Stand von gestern, 10:00 wiederhergestellt',
    );
  });

  it('Avatare: Bearbeitende plus wer gespeichert hat, ohne Doppelte', () => {
    const at = new Date(2026, 9, 30, 14);
    const mara = { key: 'm:1', name: 'Mara' };
    const jonas = { key: 'm:2', name: 'Jonas' };
    expect(peopleOf(v(at, { people: [mara], by: jonas }))).toEqual([mara, jonas]);
    expect(peopleOf(v(at, { people: [mara], by: mara }))).toEqual([mara]);
    expect(objectsLabel(1)).toBe('1 Objekt');
    expect(objectsLabel(0)).toBe('0 Objekte');
  });
});
