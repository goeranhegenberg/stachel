// Zeitleiste im Yjs-Dokument: Feld `timeline` = Y.Map {
//   lanes: Y.Array<string>                 Reihenfolge der Spuren
//   names: Y.Map<Y.Text | string>          Spurname je id
//   items: Y.Map<Y.Map>                    je Eintrag { lane, start, end, color?, ms?, title: Y.Text | string }
// }
// Jeder Eintrag ist eine eigene Y.Map, jedes Feld wird einzeln geschrieben: Zwei Personen können gleichzeitig
// verschiedene Einträge (oder Titel und Datum desselben Eintrags) ändern, ohne sich zu überschreiben. Titel und
// Spurnamen sind Y.Text (gleichzeitiges Tippen wird zusammengeführt, siehe ../ytext.ts).
import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import { registerYField, type BoardStore, type Patch } from '../../../board/store';
import type { BoardObject } from '../../../protocol';
import { spliceOf, yTextSource, type TextSource } from '../ytext';
import { fmtDay, layoutOf, MAX_LANES, rangeOf, safeTimeline, scaleOf, sizeFor, unitOf, type TimelineData, type TlItem, type TlUnit, type Range } from './model';

export const TL_FIELD = 'timeline';

type Str = string | Y.Text;
const str = (v: unknown) => (v instanceof Y.Text ? v.toString() : typeof v === 'string' ? v : '');

function itemToY(it: TlItem): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set('lane', it.lane);
  m.set('start', it.start);
  m.set('end', it.end);
  if (it.color) m.set('color', it.color);
  if (it.ms) m.set('ms', true);
  m.set('title', new Y.Text(it.title ?? ''));
  return m;
}

export function timelineToY(d: TimelineData): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  const lanes = new Y.Array<string>();
  lanes.push(d.lanes);
  const names = new Y.Map<Str>();
  for (const l of d.lanes) names.set(l, new Y.Text(d.names[l] ?? ''));
  const items = new Y.Map<Y.Map<unknown>>();
  for (const [id, it] of Object.entries(d.items)) items.set(id, itemToY(it));
  m.set('lanes', lanes);
  m.set('names', names);
  m.set('items', items);
  return m;
}

export function timelineFromY(y: Y.AbstractType<any>): TimelineData {
  if (!(y instanceof Y.Map)) return safeTimeline(undefined);
  const lanes = y.get('lanes');
  const names = y.get('names');
  const items = y.get('items');
  const n: Record<string, string> = {};
  if (names instanceof Y.Map) names.forEach((v, k) => (n[k] = str(v)));
  const its: Record<string, unknown> = {};
  if (items instanceof Y.Map)
    items.forEach((v, k) => {
      if (!(v instanceof Y.Map)) return;
      const o: Record<string, unknown> = {};
      v.forEach((x, f) => (o[f] = x instanceof Y.Text ? x.toString() : x));
      its[k] = o;
    });
  return safeTimeline({ lanes: lanes instanceof Y.Array ? lanes.toArray() : [], names: n, items: its });
}

// Lesekopie im Schnappschuss; Kopieren/Einfügen baut daraus eine neue Y-Struktur
registerYField(TL_FIELD, {
  toPlain: timelineFromY,
  fromPlain: (v) => (v && typeof v === 'object' ? timelineToY(safeTimeline(v)) : undefined),
});

export interface Live {
  y: Y.Map<unknown>;
  lanes: Y.Array<string>;
  names: Y.Map<Str>;
  items: Y.Map<Y.Map<unknown>>;
}

/** Lebende Struktur (legt sie bei alten/kaputten Daten an). */
export function live(store: BoardStore, o: BoardObject): Live | null {
  const y = store.ensureYField<Y.Map<unknown>>(o.id, TL_FIELD, () => timelineToY(safeTimeline(o.timeline)));
  if (!y) return null;
  const get = <T>(k: string, make: () => T) => {
    let v = y.get(k) as T | undefined;
    if (!v || !(v instanceof Y.AbstractType)) {
      v = make();
      y.set(k, v);
    }
    return v;
  };
  const t: Live = {
    y,
    lanes: get('lanes', () => new Y.Array<string>()),
    names: get('names', () => new Y.Map<Str>()),
    items: get('items', () => new Y.Map<Y.Map<unknown>>()),
  };
  // Spuren-Liste leer (kaputte Daten): die Ersatzspur der Lesekopie festschreiben
  if (!t.lanes.length) t.lanes.push(safeTimeline(o.timeline).lanes.slice(0, 1));
  return t;
}

/** Aktuelles Objekt (Lesekopie) */
const now = (store: BoardStore, id: string) => store.get(id);

/**
 * Änderung an der Zeitleiste als ein Schritt; Größe (w/h) folgt dem neuen Layout bei gleichem Maßstab.
 * `fn` kann Objektfelder (Zeitraum, Skala) zurückgeben.
 */
export function editTimeline(store: BoardStore, id: string, fn: (t: Live, d: TimelineData, o: BoardObject) => Patch | void) {
  store.transact(() => {
    const o = now(store, id);
    if (!o) return;
    const t = live(store, o);
    if (!t) return;
    const before = layoutOf(safeTimeline(o.timeline), rangeOf(o), unitOf(o));
    const k = scaleOf(o, before);
    const extra = fn(t, timelineFromY(t.y), o) || {};
    const next = { ...o, ...extra };
    const L = layoutOf(timelineFromY(t.y), rangeOf(next), unitOf(next));
    const size = sizeFor(k, L);
    const patch: Patch = { ...extra };
    if (size.w !== o.w) patch.w = size.w;
    if (size.h !== o.h) patch.h = size.h;
    if (Object.keys(patch).length) store.update(id, patch);
  });
}

// ---- Spuren -------------------------------------------------------------------------------------------------------------

/** Spur nach fter (bzw. am Ende); lane = feste id (Web-Aktion der App), sonst eine neue. */
export function addLane(store: BoardStore, id: string, after?: string, name = '', lane = nanoid(8)): string | null {
  let ok = false;
  editTimeline(store, id, (t, d) => {
    if (d.lanes.length >= MAX_LANES) return;
    const i = after ? d.lanes.indexOf(after) : -1;
    t.lanes.insert(i < 0 ? t.lanes.length : i + 1, [lane]);
    t.names.set(lane, new Y.Text(name));
    ok = true;
  });
  return ok ? lane : null;
}

/** Spur samt ihrer Einträge löschen (die letzte bleibt). */
export function removeLane(store: BoardStore, id: string, lane: string) {
  editTimeline(store, id, (t, d) => {
    if (d.lanes.length <= 1) return;
    const arr = t.lanes.toArray();
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] === lane) t.lanes.delete(i, 1);
    t.names.delete(lane);
    for (const [k, it] of Object.entries(d.items)) if (it.lane === lane) t.items.delete(k);
  });
}

/** Spur an Position `to` (Index in der neuen Reihenfolge) verschieben. */
export function moveLane(store: BoardStore, id: string, lane: string, to: number) {
  editTimeline(store, id, (t, d) => {
    const from = d.lanes.indexOf(lane);
    const dest = Math.max(0, Math.min(d.lanes.length - 1, to));
    if (from < 0 || from === dest) return;
    const arr = t.lanes.toArray();
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] === lane) t.lanes.delete(i, 1);
    t.lanes.insert(Math.min(dest, t.lanes.length), [lane]);
  });
}

/** Live-Quelle für den Spurnamen (Y.Text) */
export function laneNameSource(store: BoardStore, id: string, lane: string): TextSource {
  return yTextSource(store, () => store.yField<Y.Map<unknown>>(id, TL_FIELD)?.get('names') as Y.Map<unknown> | undefined, lane);
}

// ---- Einträge -----------------------------------------------------------------------------------------------------------

/** Eintrag anlegen; key = feste id (Web-Aktion der App), sonst eine neue. */
export function addItem(store: BoardStore, id: string, it: TlItem, key = nanoid(8)): string {
  editTimeline(store, id, (t) => {
    t.items.set(key, itemToY(it));
  });
  return key;
}

/** Felder eines Eintrags ändern (nur geänderte werden geschrieben; `undefined` entfernt). */
export function patchItem(store: BoardStore, id: string, key: string, patch: Partial<Omit<TlItem, 'title'>>) {
  editTimeline(store, id, (t) => {
    const m = t.items.get(key);
    if (!(m instanceof Y.Map)) return;
    for (const [f, v] of Object.entries(patch)) {
      if (v === undefined || v === false) {
        if (m.has(f)) m.delete(f);
      } else if (m.get(f) !== v) m.set(f, v);
    }
  });
}

export function removeItem(store: BoardStore, id: string, key: string) {
  editTimeline(store, id, (t) => {
    t.items.delete(key);
  });
}

/** Lebende Map eines Eintrags (ohne anzulegen) */
const itemMap = (store: BoardStore, id: string, key: string) => {
  const items = store.yField<Y.Map<unknown>>(id, TL_FIELD)?.get('items');
  const m = items instanceof Y.Map ? items.get(key) : undefined;
  return m instanceof Y.Map ? (m as Y.Map<unknown>) : undefined;
};

/** Live-Quelle für den Titel eines Eintrags; die Höhe (Meilenstein-Titel) wird im selben Schritt nachgezogen. */
export function titleSource(store: BoardStore, id: string, key: string): TextSource {
  const src = yTextSource(store, () => itemMap(store, id, key), 'title');
  return {
    ...src,
    write: (c) =>
      store.transact(() => {
        src.write(c);
        editTimeline(store, id, () => {});
      }),
  };
}

/** Titel auf `text` setzen (kleinste Änderung, gleichzeitige Eingaben anderer bleiben). */
export function setTitle(store: BoardStore, id: string, key: string, text: string) {
  const src = titleSource(store, id, key);
  const cur = src.read();
  if (cur !== text) src.write(spliceOf(cur, text));
}

// ---- Zeitraum und Skala ---------------------------------------------------------------------------------------------------

export function setRange(store: BoardStore, id: string, r: Pick<Range, 'start' | 'end'>) {
  editTimeline(store, id, () => ({ tlStart: fmtDay(r.start), tlEnd: fmtDay(r.end) }));
}

export function setUnit(store: BoardStore, id: string, unit: TlUnit) {
  editTimeline(store, id, () => ({ tlUnit: unit === 'week' ? undefined : unit }));
}
