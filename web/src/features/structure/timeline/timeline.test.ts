// Zeitleiste: Datumsrechnung, Raster/Kopf, Einrasten, Packen der Zeilen, Zeitraum über die Ränder, Yjs-Zusammenführung.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import '../../../editor/core';
import '../index';
import { BoardStore } from '../../../board/store';
import { typeDef } from '../../../editor/ext/registry';
import {
  dayAt,
  dragDays,
  extentOf,
  fmtDay,
  hitLocal,
  HEAD_H,
  isoWeek,
  LABEL_W,
  laneAt,
  laneHeight,
  layoutFor,
  layoutOf,
  MIN_LANE_H,
  mondayOf,
  monthStart,
  packRows,
  parseDay,
  rangeOf,
  resizeRange,
  ROW_H,
  safeTimeline,
  snapDays,
  spanLabel,
  ticks,
  timelineText,
  toLocal,
  weekday,
  type TimelineData,
} from './model';
import { addItem, addLane, moveLane, patchItem, removeItem, removeLane, setTitle, setUnit, titleSource } from './yjs';
import { newTimeline } from './timeline';
import { eventTimeline } from './template';

const D = (s: string) => parseDay(s)!;

describe('Datum', () => {
  it('liest und schreibt Tage ohne Zeitzonen-Versatz, lehnt ungültige ab', () => {
    expect(fmtDay(D('2026-10-30'))).toBe('2026-10-30');
    expect(D('2026-03-01') - D('2026-02-28')).toBe(1);
    expect(D('2024-03-01') - D('2024-02-28')).toBe(2); // Schaltjahr
    // Zeitumstellung (25.10.2026) ändert nichts an ganzen Tagen
    expect(D('2026-10-26') - D('2026-10-25')).toBe(1);
    expect(parseDay('2026-02-31')).toBeNull();
    expect(parseDay('2026-13-01')).toBeNull();
    expect(parseDay('30.10.2026')).toBeNull();
    expect(parseDay(undefined)).toBeNull();
  });

  it('Wochentag, Montag, Kalenderwoche, Monatsanfang', () => {
    expect(weekday(D('2026-10-26'))).toBe(0); // Montag
    expect(weekday(D('2026-11-01'))).toBe(6); // Sonntag
    expect(fmtDay(mondayOf(D('2026-11-01')))).toBe('2026-10-26');
    expect(isoWeek(D('2026-10-30'))).toBe(44);
    expect(isoWeek(D('2027-01-01'))).toBe(53); // 2026 hat 53 Wochen
    expect(isoWeek(D('2027-01-04'))).toBe(1);
    expect(isoWeek(D('2025-12-29'))).toBe(1); // Montag gehört schon zu KW 1/2026
    expect(fmtDay(monthStart(D('2026-10-30')))).toBe('2026-10-01');
    expect(fmtDay(monthStart(D('2026-12-15'), 1))).toBe('2027-01-01');
    expect(spanLabel(D('2026-11-03'), D('2026-11-09'))).toBe('3.11.–9.11.2026');
    expect(spanLabel(D('2026-12-28'), D('2027-01-02'))).toBe('28.12.2026–2.1.2027');
  });
});

describe('Raster und Kopf', () => {
  const r = { start: D('2026-10-26'), end: D('2026-11-08'), days: 14 };
  it('Tagesansicht: ein Feld je Tag, Wochenenden markiert, heute hervorgehoben, Monate oben', () => {
    const t = ticks(r, 'day', D('2026-10-30'));
    expect(t.bottom).toHaveLength(14);
    expect(t.bottom.filter((x) => x.weekend).map((x) => x.label)).toEqual(['31', '1', '7', '8']);
    expect(t.bottom.find((x) => x.today)?.label).toBe('30');
    expect(t.top.map((x) => x.label)).toEqual(['Oktober 2026', 'November 2026']);
    // Monatsgrenze nach 6 Tagen (26.–31.10.)
    expect(t.top[1].x).toBe(6 * 40);
  });
  it('Wochenansicht: Kalenderwochen, angeschnittene Wochen am Rand', () => {
    const t = ticks({ start: D('2026-10-28'), end: D('2026-11-10'), days: 14 }, 'week');
    expect(t.bottom.map((x) => x.label)).toEqual(['KW 44', 'KW 45', 'KW 46']);
    expect(t.bottom.map((x) => x.w / 18)).toEqual([5, 7, 2]);
  });
  it('Monatsansicht: Monate unten, Jahre oben', () => {
    const t = ticks({ start: D('2026-11-01'), end: D('2027-02-28'), days: D('2027-02-28') - D('2026-11-01') + 1 }, 'month');
    expect(t.bottom.map((x) => x.label)).toEqual(['Nov', 'Dez', 'Jan', 'Feb']);
    expect(t.top.map((x) => x.label)).toEqual(['2026', '2027']);
  });
});

describe('Einrasten und Ziehen', () => {
  const r = { start: D('2026-11-01'), end: D('2026-11-30'), days: 30 };
  it('rastet auf ganze Tage', () => {
    expect(snapDays(17, 40)).toBe(0);
    expect(snapDays(21, 40)).toBe(1);
    expect(snapDays(-61, 40)).toBe(-2);
    expect(snapDays(-0.2, 18)).toBe(0);
  });
  it('verschieben bleibt im Zeitraum, Länge ändern lässt mindestens einen Tag', () => {
    const a = D('2026-11-10');
    const b = D('2026-11-14');
    expect(dragDays(a, b, 'move', 3, r)).toEqual([a + 3, b + 3]);
    expect(dragDays(a, b, 'move', 100, r)).toEqual([r.end, r.end + 4]); // höchstens bis der Anfang am Ende liegt
    expect(dragDays(a, b, 'move', -100, r)).toEqual([r.start - 4, r.start]);
    expect(dragDays(a, b, 'end', 2, r)).toEqual([a, b + 2]);
    expect(dragDays(a, b, 'end', -10, r)).toEqual([a, a]);
    expect(dragDays(a, b, 'start', 10, r)).toEqual([b, b]);
    expect(dragDays(a, b, 'start', -30, r)).toEqual([r.start, b]);
  });
});

describe('Zeilen (Kollision)', () => {
  it('überlappende Einträge kommen in neue Zeilen, freie Zeilen werden wiederverwendet', () => {
    const p = packRows([
      { id: 'a', a: 1, b: 5 },
      { id: 'b', a: 3, b: 8 },
      { id: 'c', a: 6, b: 7 },
      { id: 'd', a: 9, b: 9 },
      { id: 'e', a: 5, b: 5 },
    ]);
    expect(p.rows).toBe(3);
    expect(Object.fromEntries(p.row)).toEqual({ a: 0, e: 2, b: 1, c: 0, d: 0 });
    // aneinander (Ende 5, Anfang 6) passt in dieselbe Zeile
    expect(packRows([{ id: 'x', a: 1, b: 5 }, { id: 'y', a: 6, b: 9 }]).rows).toBe(1);
    expect(packRows([]).rows).toBe(1);
  });
  it('Meilensteine belegen Platz für ihren Titel; Spurhöhe wächst mit den Zeilen', () => {
    const [a, b] = extentOf({ lane: 'l', start: '2026-11-02', end: '2026-11-02', title: 'Line-up steht', ms: true }, 18);
    expect(a).toBe(D('2026-11-02'));
    expect(b - a).toBeGreaterThanOrEqual(5);
    expect(laneHeight(1)).toBe(MIN_LANE_H);
    expect(laneHeight(3) - laneHeight(2)).toBe(ROW_H);
  });
  it('Layout: Spuren untereinander, Einträge außerhalb gezählt, abgeschnittene markiert', () => {
    const d: TimelineData = {
      lanes: ['a', 'b'],
      names: { a: 'Orga', b: 'Technik' },
      items: {
        i1: { lane: 'a', start: '2026-11-02', end: '2026-11-06', title: 'Eins' },
        i2: { lane: 'a', start: '2026-11-04', end: '2026-11-10', title: 'Zwei' },
        i3: { lane: 'b', start: '2026-10-20', end: '2026-11-03', title: 'Drei' },
        i4: { lane: 'b', start: '2026-12-20', end: '2026-12-21', title: 'Später' },
        i5: { lane: 'b', start: '2026-09-01', end: '2026-09-02', title: 'Früher' },
      },
    };
    const L = layoutOf(d, { start: D('2026-11-01'), end: D('2026-11-30'), days: 30 }, 'day');
    expect(L.W0).toBe(LABEL_W + 30 * 40);
    expect(L.lanes.map((l) => l.rows)).toEqual([2, 1]);
    expect(L.lanes[1].y).toBe(HEAD_H + L.lanes[0].h);
    expect(L.before).toBe(1);
    expect(L.after).toBe(1);
    const i3 = L.items.find((b) => b.id === 'i3')!;
    expect(i3.cutL).toBe(true);
    expect(i3.x).toBe(LABEL_W);
    expect(i3.w).toBe(3 * 40);
    const i2 = L.items.find((b) => b.id === 'i2')!;
    expect(i2.row).toBe(1);
    // Treffer: Eintrag, leere Spur, Namensspalte, Kopf
    expect(hitLocal(L, i2.x + 5, i2.y + 5)).toMatchObject({ kind: 'item', id: 'i2' });
    expect(hitLocal(L, LABEL_W + 25 * 40 + 3, L.lanes[1].y + 10)).toEqual({ kind: 'lane', lane: 'b', day: D('2026-11-26') });
    expect(hitLocal(L, 20, L.lanes[1].y + 10)).toEqual({ kind: 'label', lane: 'b' });
    expect(hitLocal(L, 400, 10)?.kind).toBe('header');
    expect(dayAt(L, -50)).toBe(L.start);
    expect(laneAt(L, 99999).id).toBe('b');
  });
});

describe('Lesekopie absichern', () => {
  it('kaputte Daten: Ersatzspur, Doppelte raus, Ende vor Anfang getauscht, fremde Spur → erste', () => {
    const d = safeTimeline({
      lanes: ['a', 'a', 5, 'b'],
      names: { a: 'A' },
      items: {
        x: { lane: 'b', start: '2026-11-10', end: '2026-11-05', title: 'T' },
        y: { lane: 'weg', start: '2026-11-10', end: '2026-11-12' },
        z: { lane: 'a', start: 'kaputt' },
        m: { lane: 'a', start: '2026-11-10', end: '2026-11-20', ms: true, title: 'M' },
      },
    });
    expect(d.lanes).toEqual(['a', 'b']);
    expect(d.names).toEqual({ a: 'A', b: '' });
    expect(d.items.x).toMatchObject({ start: '2026-11-05', end: '2026-11-10' });
    expect(d.items.y.lane).toBe('a');
    expect(d.items.z).toBeUndefined();
    expect(d.items.m.end).toBe('2026-11-10');
    expect(safeTimeline(undefined).lanes).toHaveLength(1);
    // fehlender Zeitraum: 8 Wochen ab Montag
    const r = rangeOf({}, D('2026-10-30'));
    expect([fmtDay(r.start), r.days]).toEqual(['2026-10-26', 56]);
  });
});

describe('Zeitraum über die Ränder, Skalieren', () => {
  it('rechter Rand verlängert, linker Rand holt frühere Tage dazu', () => {
    const r = { start: D('2026-11-02'), end: D('2026-11-29'), days: 28 };
    const k = 0.5;
    const w = k * (LABEL_W + 28 * 18);
    expect(resizeRange(r, k, 'week', w + k * 18 * 7, false)).toEqual({ start: r.start, end: r.end + 7, days: 35 });
    expect(resizeRange(r, k, 'week', w + k * 18 * 3.4, true)).toEqual({ start: r.start - 3, end: r.end, days: 31 });
    expect(resizeRange(r, k, 'week', 10, false).days).toBe(3); // Mindestlänge
  });

  it('Objekt-Typ: Seitengriff ändert den Zeitraum, Ecke skaliert', () => {
    const o = { ...newTimeline({ x: 0, y: 0 }, { unit: 'day', start: D('2026-11-02'), end: D('2026-11-15') }), id: 't', z: '', createdBy: '', updatedAt: '' };
    const resize = typeDef('timeline').resize!;
    const from = { x: o.x, y: o.y, w: o.w, h: o.h };
    // rechter Rand um 3 Tage
    const east = resize(o as any, { x: o.x, y: o.y, w: o.w + 3 * 40 + 7, h: o.h }, { from, to: { ...from, w: o.w + 127 }, rect: from, widthOnly: false });
    expect(east).toMatchObject({ tlStart: '2026-11-02', tlEnd: '2026-11-18', w: o.w + 120, x: o.x });
    // linker Rand um 2 Tage nach rechts (kürzer)
    const west = resize(o as any, { x: o.x + 80, y: o.y, w: o.w - 80, h: o.h }, { from, to: { ...from, x: from.x + 80, w: o.w - 80 }, rect: from, widthOnly: false });
    expect(west).toMatchObject({ tlStart: '2026-11-04', tlEnd: '2026-11-15', w: o.w - 80, x: o.x + 80 });
    // Ecke: Seitenverhältnis bleibt, nur Größe
    const corner = resize(o as any, { x: 0, y: 0, w: o.w * 2, h: o.h * 2 }, { from, to: { ...from, w: o.w * 2, h: o.h * 2 }, rect: from, widthOnly: false });
    expect(corner).toEqual({ x: 0, y: 0, w: o.w * 2, h: o.h * 2 });
  });
});

// ---- Yjs ----------------------------------------------------------------------------------------------------------------

const fresh = (key = 'm:1') => new BoardStore(new Y.Doc(), key);
function pair() {
  const a = fresh('m:1');
  const b = fresh('m:2');
  const sync = () => {
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)));
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc)));
  };
  return { a, b, sync };
}
const data = (s: BoardStore, id: string) => safeTimeline(s.get(id)!.timeline);

describe('Zeitleiste im Yjs-Dokument', () => {
  it('Einträge anlegen, ändern, löschen; Höhe folgt den Zeilen; Undo', () => {
    const s = fresh();
    const id = s.create(newTimeline({ x: 0, y: 0 }, { start: D('2026-11-02'), end: D('2026-11-29') }));
    const h0 = s.get(id)!.h;
    s.stopCapturing();
    const lane = data(s, id).lanes[0];
    const k1 = addItem(s, id, { lane, start: '2026-11-03', end: '2026-11-08', title: 'Bühne' });
    s.stopCapturing();
    const k2 = addItem(s, id, { lane, start: '2026-11-05', end: '2026-11-10', title: 'Bar' });
    s.stopCapturing();
    expect(Object.keys(data(s, id).items)).toEqual(expect.arrayContaining([k1, k2]));
    // überlappend → zweite Zeile → Spur höher
    expect(s.get(id)!.h).toBe(h0 + laneHeight(2) - laneHeight(1));
    patchItem(s, id, k2, { start: '2026-11-12', end: '2026-11-14' });
    s.stopCapturing();
    expect(s.get(id)!.h).toBe(h0);
    setTitle(s, id, k1, 'Bühne aufbauen');
    expect(data(s, id).items[k1].title).toBe('Bühne aufbauen');
    s.stopCapturing();
    removeItem(s, id, k1);
    expect(data(s, id).items[k1]).toBeUndefined();
    s.undo();
    expect(data(s, id).items[k1].title).toBe('Bühne aufbauen');
    s.undo();
    expect(data(s, id).items[k1].title).toBe('Bühne');
    expect(timelineText(data(s, id))).toContain('Bühne');
  });

  it('Spuren: hinzufügen, umsortieren, löschen samt Einträgen (letzte bleibt)', () => {
    const s = fresh();
    const id = s.create(newTimeline({ x: 0, y: 0 }));
    const [l1, l2, l3] = data(s, id).lanes;
    const l4 = addLane(s, id, l1, 'Neu')!;
    expect(data(s, id).lanes).toEqual([l1, l4, l2, l3]);
    expect(data(s, id).names[l4]).toBe('Neu');
    moveLane(s, id, l1, 3);
    expect(data(s, id).lanes).toEqual([l4, l2, l3, l1]);
    const k = addItem(s, id, { lane: l2, start: '2026-11-03', end: '2026-11-04', title: 'x' });
    removeLane(s, id, l2);
    expect(data(s, id).lanes).toEqual([l4, l3, l1]);
    expect(data(s, id).items[k]).toBeUndefined();
    for (const l of [l4, l3]) removeLane(s, id, l);
    removeLane(s, id, l1);
    expect(data(s, id).lanes).toEqual([l1]);
  });

  it('zwei Personen ändern gleichzeitig verschiedene Einträge bzw. Titel und Datum desselben – nichts geht verloren', () => {
    const { a, b, sync } = pair();
    const id = a.create(newTimeline({ x: 0, y: 0 }, { start: D('2026-11-02'), end: D('2026-11-29') }));
    const lane = data(a, id).lanes[0];
    const k1 = addItem(a, id, { lane, start: '2026-11-03', end: '2026-11-05', title: 'Bühne' });
    const k2 = addItem(a, id, { lane, start: '2026-11-10', end: '2026-11-12', title: 'Bar' });
    sync();
    // gleichzeitig: Mara verschiebt k1, Jonas verlängert k2 und benennt k1 um
    patchItem(a, id, k1, { start: '2026-11-04', end: '2026-11-06' });
    patchItem(b, id, k2, { end: '2026-11-15' });
    titleSource(b, id, k1).write({ index: 6, del: 0, ins: ' aufbauen' });
    // beide tippen gleichzeitig in denselben Titel
    titleSource(a, id, k2).write({ index: 0, del: 0, ins: 'Große ' });
    titleSource(b, id, k2).write({ index: 3, del: 0, ins: '-Team' });
    sync();
    for (const s of [a, b]) {
      const d = data(s, id);
      expect(d.items[k1]).toMatchObject({ start: '2026-11-04', end: '2026-11-06', title: 'Bühne aufbauen' });
      expect(d.items[k2]).toMatchObject({ start: '2026-11-10', end: '2026-11-15', title: 'Große Bar-Team' });
    }
    // gleichzeitig: eine Spur löschen und darin einen Eintrag anlegen → Eintrag landet in der ersten Spur
    const [l1, l2] = data(a, id).lanes;
    removeLane(a, id, l2);
    const k3 = addItem(b, id, { lane: l2, start: '2026-11-20', end: '2026-11-21', title: 'Spät' });
    sync();
    expect(data(a, id).items[k3].lane).toBe(l1);
    expect(data(b, id).items[k3].lane).toBe(l1);
  });

  it('Kopieren/Einfügen baut eine eigene Struktur; Skala ändert die Breite', () => {
    const s = fresh();
    const id = s.create(newTimeline({ x: 0, y: 0 }, { start: D('2026-11-02'), end: D('2026-11-29') }));
    addItem(s, id, { lane: data(s, id).lanes[0], start: '2026-11-03', end: '2026-11-05', title: 'Kopie' });
    const plain = s.get(id)!;
    const id2 = s.create({ ...plain, id: undefined, z: undefined } as any);
    expect(s.yField(id2, 'timeline')).toBeInstanceOf(Y.Map);
    expect(s.yField(id2, 'timeline')).not.toBe(s.yField(id, 'timeline'));
    expect(Object.values(data(s, id2).items)[0].title).toBe('Kopie');
    const w = s.get(id)!.w;
    setUnit(s, id, 'day');
    expect(s.get(id)!.tlUnit).toBe('day');
    expect(s.get(id)!.w).toBe(w - 28 * 18 + 28 * 40);
    setUnit(s, id, 'week');
    expect(s.get(id)!.tlUnit).toBeUndefined();
    expect(s.get(id)!.w).toBe(w);
  });

  it('Treffer aus Weltkoordinaten (skaliert), Vorlage baut gültige Zeitleiste', () => {
    const o = { ...newTimeline({ x: 0, y: 0 }, { k: 0.5 }), id: 't' };
    const L = layoutFor(o);
    const p = toLocal(o, L, { x: o.x + o.w, y: o.y + o.h });
    expect(p.lx).toBeCloseTo(L.W0);
    expect(p.ly).toBeCloseTo(L.H0);
    const objs = eventTimeline(D('2026-10-30'));
    const t = objs.find((x) => x.type === 'timeline')!;
    const d = safeTimeline(t.timeline);
    expect(d.lanes).toHaveLength(5);
    expect(Object.values(d.items).filter((i) => i.ms).length).toBe(4);
    expect(layoutFor(t, D('2026-10-30')).before + layoutFor(t, D('2026-10-30')).after).toBe(0);
  });
});
