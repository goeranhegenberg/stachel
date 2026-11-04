// Web-Aktionen für die native App (docs/contract.md §8.12) – Paket P9 des Paritäts-Audits
// (docs/native_paritaet_audit.md §4): Zeitleiste wie im Browser (timeline/yjs.ts, model.ts) – Einträge anlegen, ziehen,
// Felder ändern, löschen, Titel und Spurnamen live (Y.Text, gleichzeitiges Tippen zusammengeführt über `ctx.text`),
// Spuren hinzufügen/verschieben/löschen, Zeitraum und Zeitskala, Haftnotiz/Karte auf eine Spur ziehen. Größe (w/h) folgt
// jeweils dem neuen Layout bei gleichem Maßstab (`editTimeline`), jede Aktion ist ein Rückgängig-Schritt.
// Test: server/test/native-act-timeline.test.ts, Doku: Abschnitt „Native-Aktionen“ in docs/features/timeline.md.
// Wird von web/src/native/actions.ts importiert (Sammel-Import, nicht ändern).
import * as Y from 'yjs';
import type { BoardObject } from '../../../protocol';
import type { BoardStore } from '../../../board/store';
import { plainTextOf } from '../../../board/types';
import { A, parseArgs, type Check } from '../../../native/args';
import { defineNativeAction, textMerge, type NativeActionCtx } from '../../../native/registry';
import { dayPatch, droppedItem, extendRange, fmtDay, hitLocal, layoutFor, MAX_DAYS, parseDay, safeTimeline, toLocal, toggleMsPatch, unitOf, type Layout, type TlItem, type TlUnit } from './model';
import { addItem, addLane, editTimeline, moveLane, patchItem, removeItem, removeLane, setRange, setUnit, TL_FIELD } from './yjs';

/** Ungesperrte Zeitleiste (sonst nichts zu tun). */
const timelineOf = (store: BoardStore, id: string): BoardObject | null => {
  const o = store.get(id);
  return o && o.type === 'timeline' && !o.locked ? o : null;
};

/** Wie `step` der Kontextleiste: eigener Rückgängig-Schritt. */
function step<T>(store: BoardStore, fn: () => T): T {
  store.stopCapturing();
  const r = fn();
  store.stopCapturing();
  return r;
}

/** Tag `YYYY-MM-DD` (gültig) */
const day: Check = (v) => parseDay(v) !== null;
/** Titel/Spurname wie das Eingabefeld (maxLength 200) */
const TITLE = 200;

/** Y.Text eines Felds `field` in der Y.Map `m` (alter String bzw. leer: als Y.Text anlegen, wie yTextSource). */
function yText(m: Y.Map<unknown>, field: string): Y.Text {
  const t = m.get(field);
  if (t instanceof Y.Text) return t;
  const y = new Y.Text(typeof t === 'string' ? t : '');
  m.set(field, y);
  return y;
}

/** Eingabe der App (`text`, ausgehend von `base`) in ein Y.Text übernehmen; `conflict` = dieselbe Stelle geändert. */
function mergeInto(t: Y.Text, base: string | undefined, text: string, ctx: NativeActionCtx): boolean {
  const cur = t.toString();
  const m = base === undefined ? { text, conflict: cur !== text && cur !== '' } : textMerge(ctx).merge(base, text, cur);
  textMerge(ctx).apply(t, m.text);
  return m.conflict;
}

// ---- Einträge (I17–I19) -------------------------------------------------------------------------------------------

/**
 * Eintrag anlegen (Doppeltippen in eine Spur, „Eintrag hinzufügen (heute)“, „Eintrag hier anlegen“): Tage und Spur
 * rechnet die App wie `newItemAt` (Standardlänge je Skala); neuer Eintrag = `<key>-1`.
 */
defineNativeAction<{ id: string; lane: string; start: string; end: string; title?: string; color?: string; ms?: boolean }>('timeline.addItem', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, lane: A.id, start: day, end: day, title: A.opt(A.str(TITLE)), color: A.opt(A.color), ms: A.opt(A.bool) }),
  run(store, { id, lane, start, end, title, color, ms }, ctx) {
    const o = timelineOf(store, id);
    const key = ctx.id(1);
    const d = o && safeTimeline(o.timeline);
    if (!o || !d || d.items[key]) return { skipped: true, data: { key } };
    let a = parseDay(start)!;
    let b = parseDay(end)!;
    if (b < a) [a, b] = [b, a];
    const it: TlItem = { lane: d.lanes.includes(lane) ? lane : d.lanes[0]!, start: fmtDay(a), end: fmtDay(ms ? a : b), title: title ?? '', ...(color ? { color } : {}), ...(ms ? { ms: true } : {}) };
    step(store, () => addItem(store, id, it, key));
    return { data: { key } };
  },
});

/**
 * Felder eines Eintrags (Ziehen, Spur, Farbe): nur geänderte werden geschrieben, `color: null` = Standardfarbe. `ms`
 * schaltet wie die Kontextleiste zwischen Balken und Meilenstein um (Balken bekommt die Standardlänge der Skala).
 */
defineNativeAction<{ id: string; key: string; start?: string; end?: string; lane?: string; color?: string | null; ms?: boolean }>('timeline.patchItem', {
  undo: 'undo',
  args: (raw) =>
    parseArgs(raw, {
      id: A.id,
      key: A.id,
      start: A.opt(day),
      end: A.opt(day),
      lane: A.opt(A.id),
      color: A.opt((v) => v === null || A.color(v)),
      ms: A.opt(A.bool),
    }),
  run(store, { id, key, start, end, lane, color, ms }) {
    const o = timelineOf(store, id);
    const d = o && safeTimeline(o.timeline);
    const it = d?.items[key];
    if (!o || !d || !it) return { skipped: true };
    const patch: Parameters<typeof patchItem>[3] = {};
    if (start !== undefined) patch.start = start;
    if (end !== undefined) patch.end = end;
    if (lane !== undefined && d.lanes.includes(lane)) patch.lane = lane;
    if (color !== undefined) patch.color = color ?? undefined;
    if (ms !== undefined && ms !== !!it.ms) Object.assign(patch, toggleMsPatch({ ...it, ...(patch.start ? { start: patch.start } : {}) }, unitOf(o)));
    if (!Object.keys(patch).length) return { skipped: true };
    step(store, () => patchItem(store, id, key, patch));
  },
});

/** Dialog „Eintrag“: Beginn bzw. Ende ändern (Ende ≥ Beginn, beim Beginn bleibt die Länge; Meilenstein: ein Tag). */
defineNativeAction<{ id: string; key: string; which: 'start' | 'end'; day: string }>('timeline.setDay', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, key: A.id, which: A.oneOf('start', 'end'), day }),
  run(store, { id, key, which, day: v }) {
    const o = timelineOf(store, id);
    const it = o && safeTimeline(o.timeline).items[key];
    if (!o || !it) return { skipped: true };
    step(store, () => patchItem(store, id, key, dayPatch(it, which, parseDay(v)!)));
  },
});

defineNativeAction<{ id: string; key: string }>('timeline.removeItem', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, key: A.id }),
  run(store, { id, key }) {
    const o = timelineOf(store, id);
    if (!o || !safeTimeline(o.timeline).items[key]) return { skipped: true };
    step(store, () => removeItem(store, id, key));
  },
});

/** Live-Quelle der Zeitleiste ohne anzulegen (Titel, Spurnamen) */
const tlMap = (store: BoardStore, id: string, part: 'names' | 'items') => {
  const m = store.yField<Y.Map<unknown>>(id, TL_FIELD)?.get(part);
  return m instanceof Y.Map ? (m as Y.Map<unknown>) : undefined;
};

/** Titel live (Y.Text): Eingabe der App mit dem aktuellen Stand zusammenführen; Höhe folgt (Meilenstein-Titel). */
defineNativeAction<{ id: string; key: string; base?: string; text: string }>('timeline.setTitle', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, key: A.id, base: A.opt(A.str()), text: A.str(TITLE) }),
  run(store, { id, key, base, text }, ctx) {
    const o = timelineOf(store, id);
    if (!o || !safeTimeline(o.timeline).items[key]) return { skipped: true };
    let conflict = false;
    store.transact(() => {
      // lebende Struktur sicherstellen (alte Boards), dann wie titleSource.write: Text und Größe in einem Schritt
      editTimeline(store, id, () => {});
      const m = tlMap(store, id, 'items')?.get(key);
      if (!(m instanceof Y.Map)) return;
      conflict = mergeInto(yText(m as Y.Map<unknown>, 'title'), base, text, ctx);
      editTimeline(store, id, () => {});
    });
    return { data: { conflict } };
  },
});

// ---- Spuren (I21) ---------------------------------------------------------------------------------------------------

/** Spur unter `after` (aktive Spur) bzw. am Ende; neue Spur = `<key>-1`, höchstens 40 („Mehr Spuren gehen nicht.“). */
defineNativeAction<{ id: string; after?: string; name?: string }>('timeline.addLane', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, after: A.opt(A.id), name: A.opt(A.str(TITLE)) }),
  run(store, { id, after, name }, ctx) {
    const o = timelineOf(store, id);
    const lane = ctx.id(1);
    if (!o || safeTimeline(o.timeline).lanes.includes(lane)) return { skipped: true, data: { lane } };
    const ok = step(store, () => addLane(store, id, after, name ?? '', lane));
    return ok ? { data: { lane } } : { toast: 'Mehr Spuren gehen nicht.', data: { lane: null } };
  },
});

/** Spurname live (Y.Text, Umbenennen in der Namensspalte). */
defineNativeAction<{ id: string; lane: string; base?: string; text: string }>('timeline.setLaneName', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, lane: A.id, base: A.opt(A.str()), text: A.str(TITLE) }),
  run(store, { id, lane, base, text }, ctx) {
    const o = timelineOf(store, id);
    if (!o || !safeTimeline(o.timeline).lanes.includes(lane)) return { skipped: true };
    let conflict = false;
    store.transact(() => {
      editTimeline(store, id, () => {});
      const names = tlMap(store, id, 'names');
      if (names) conflict = mergeInto(yText(names, lane), base, text, ctx);
    });
    return { data: { conflict } };
  },
});

/** Spur an Position `to` (Index in der neuen Reihenfolge): „nach oben/unten“, Griff ⋮⋮ ziehen. */
defineNativeAction<{ id: string; lane: string; to: number }>('timeline.moveLane', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, lane: A.id, to: A.int(0, 1000) }),
  run(store, { id, lane, to }) {
    const o = timelineOf(store, id);
    const d = o && safeTimeline(o.timeline);
    if (!o || !d || !d.lanes.includes(lane) || d.lanes.indexOf(lane) === Math.min(to, d.lanes.length - 1)) return { skipped: true };
    step(store, () => moveLane(store, id, lane, to));
  },
});

/** Spur samt Einträgen löschen (die letzte bleibt). */
defineNativeAction<{ id: string; lane: string }>('timeline.removeLane', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, lane: A.id }),
  run(store, { id, lane }) {
    const o = timelineOf(store, id);
    const d = o && safeTimeline(o.timeline);
    if (!o || !d || !d.lanes.includes(lane) || d.lanes.length <= 1) return { skipped: true };
    step(store, () => removeLane(store, id, lane));
  },
});

// ---- Zeitraum und Zeitskala (I20, I22) --------------------------------------------------------------------------------

/**
 * Zeitraum: `start`/`end` (Tage) oder `extend` = Knopf „‹ n“ bzw. „n ›“ (bis zu den Einträgen außerhalb). Die
 * Seitengriffe schreibt die App selbst (wie `resize` im Browser: `tlStart`/`tlEnd`, `x`, `w`, `h`).
 */
defineNativeAction<{ id: string; start?: string; end?: string; extend?: 'before' | 'after' }>('timeline.setRange', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, start: A.opt(day), end: A.opt(day), extend: A.opt(A.oneOf('before', 'after')) }),
  run(store, { id, start, end, extend }) {
    const o = timelineOf(store, id);
    if (!o) return { skipped: true };
    let r: { start: number; end: number };
    if (extend) r = extendRange(o, extend);
    else {
      if (start === undefined || end === undefined) return { skipped: true };
      const a = parseDay(start)!;
      const b = parseDay(end)!;
      r = { start: Math.min(a, b), end: Math.min(Math.max(a, b), Math.min(a, b) + MAX_DAYS - 1) };
    }
    if (fmtDay(r.start) === o.tlStart && fmtDay(r.end) === o.tlEnd) return { skipped: true };
    step(store, () => setRange(store, id, r));
  },
});

defineNativeAction<{ id: string; unit: TlUnit }>('timeline.setUnit', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { id: A.id, unit: A.oneOf('day', 'week', 'month') }),
  run(store, { id, unit }) {
    const o = timelineOf(store, id);
    if (!o || unitOf(o) === unit) return { skipped: true };
    step(store, () => setUnit(store, id, unit));
  },
});

// ---- Haftnotiz/Karte auf eine Spur (I23) --------------------------------------------------------------------------------

const DROP_TYPES = new Set(['sticky', 'card']);

/** Oberste ungesperrte Zeitleiste und Spur unter dem Weltpunkt `p` (nicht Kopf/Namensspalte) – wie `dropTarget`. */
function dropTarget(store: BoardStore, p: { x: number; y: number }, skip: Set<string>): { t: BoardObject; L: Layout; lane: string; day: number } | null {
  const hits = store.getSnapshot().ordered.filter((o) => o.type === 'timeline' && !o.locked && !skip.has(o.id) && p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h);
  const t = hits[hits.length - 1];
  if (!t) return null;
  const L = layoutFor(t);
  const q = toLocal(t, L, p);
  const hit = hitLocal(L, q.lx, q.ly);
  if (!hit || (hit.kind !== 'lane' && hit.kind !== 'item')) return null;
  return { t, L, lane: hit.lane, day: hit.day };
}

/**
 * Nach dem Verschieben (die App schickt erst die Bewegung, dann diese Aktion): Haftnotizen/Karten `ids`, deren Mitte auf
 * einer Spur liegt, werden Einträge (Text, Farbe, Tag unter der Mitte) und verschwinden – ein Schritt wie `dropInto`.
 * Neue Einträge = `<key>-1` …; danach ist die Zeitleiste gewählt, `data.focus` = Zeitleiste und letzter Eintrag.
 */
defineNativeAction<{ ids: string[] }>('timeline.adopt', {
  undo: 'undo',
  args: (raw) => parseArgs(raw, { ids: A.ids(200) }),
  cost: ({ ids }) => ids.length,
  run(store, { ids }, ctx) {
    const moved = ids.map((id) => store.get(id)).filter((o): o is BoardObject => !!o && DROP_TYPES.has(o.type) && !o.locked);
    const skip = new Set(moved.map((o) => o.id));
    const plan = moved.map((o) => ({ o, tgt: dropTarget(store, { x: o.x + o.w / 2, y: o.y + o.h / 2 }, skip) })).filter((x) => x.tgt);
    if (!plan.length) return { skipped: true };
    let last: { t: string; key: string } | null = null;
    step(store, () =>
      store.transact(() => {
        plan.forEach(({ o, tgt }, i) => {
          const { t, L, lane, day: d } = tgt!;
          const key = addItem(store, t.id, droppedItem(o, plainTextOf(o) ?? '', L, lane, d), ctx.id(i + 1));
          last = { t: t.id, key };
        });
        store.remove(plan.map((x) => x.o.id));
      }),
    );
    const l = last as { t: string; key: string } | null;
    return {
      select: l ? [l.t] : [],
      toast: plan.length === 1 ? 'Als Eintrag in die Zeitleiste übernommen' : `${plan.length} Einträge in die Zeitleiste übernommen`,
      data: l ? { timeline: l.t, key: l.key } : undefined,
    };
  },
});
