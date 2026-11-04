// Gesten in der Zeitleiste: Eintrag verschieben (auch in eine andere Spur), Länge an den Enden ziehen, neuen Eintrag
// in einer Spur aufziehen, Spur umsortieren. Alles rastet auf ganze Tage; ein Ziehvorgang ist ein Undo-Schritt,
// Esc bricht ab. Andere sehen das Ziehen live (jede Änderung geht sofort ins Dokument).
import type { BoardObject } from '../../../protocol';
import type { EditorApi } from '../../../editor/ext/types';
import { editorApi } from '../bridge';
import { dayAt, dragDays, fmtDay, laneAt, layoutFor, newItemSpan, parseDay, safeTimeline, snapDays, type DragMode, type Layout } from './model';
import { activeItem, setDraft, setEdit, setFocus } from './state';
import { addItem, moveLane, patchItem } from './yjs';

/** DOM-Element der Zeitleiste im Board (nicht in einem Export) */
export const objectEl = (id: string) => document.querySelector<HTMLElement>(`[data-testid="board"] .obj[data-id="${CSS.escape(id)}"]`);

/** Bildschirmpunkt → innere Einheiten der Zeitleiste (über das gezeichnete Element, also mit Kamera und Maßstab). */
export function localAt(id: string, L: Layout, clientX: number, clientY: number): { lx: number; ly: number } | null {
  const el = objectEl(id);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { lx: ((clientX - r.left) * L.W0) / r.width, ly: ((clientY - r.top) * L.H0) / r.height };
}

const current = (api: EditorApi, id: string): { o: BoardObject; L: Layout } | null => {
  const o = api.store.get(id);
  return o ? { o, L: layoutFor(o) } : null;
};

interface Track {
  el: HTMLElement;
  pointerId: number;
  /** Bewegung (Bildschirm) über der Schwelle */
  move: (ev: PointerEvent, first: boolean) => void;
  up: (moved: boolean) => void;
  cancel?: () => void;
  /** Touch: langes Drücken ohne Bewegung */
  longPress?: () => void;
  threshold: number;
  start: { x: number; y: number };
}

/** Zeiger bis zum Loslassen verfolgen (Capture auf `el`), Esc bricht ab. */
function track(t: Track) {
  const { el } = t;
  try {
    el.setPointerCapture(t.pointerId);
  } catch {
    /* Zeiger schon weg */
  }
  let moved = false;
  let timer = t.longPress
    ? window.setTimeout(() => {
        timer = 0;
        if (moved) return;
        done();
        navigator.vibrate?.(8);
        t.longPress!();
      }, 500)
    : 0;
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== t.pointerId) return;
    if (!moved && Math.hypot(ev.clientX - t.start.x, ev.clientY - t.start.y) < t.threshold) return;
    const first = !moved;
    moved = true;
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    t.move(ev, first);
  };
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== t.pointerId) return;
    done();
    t.up(moved);
  };
  const onCancel = (ev: PointerEvent) => {
    if (ev.pointerId !== t.pointerId) return;
    done();
    t.cancel?.();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    done();
    t.cancel?.();
  };
  function done() {
    if (timer) clearTimeout(timer);
    timer = 0;
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('structure-tl-dragging');
  }
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
}

interface PointerLike {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  currentTarget: EventTarget | null;
}

/**
 * Eintrag ziehen: `move` verschiebt (Spur folgt dem Zeiger), `start`/`end` ändern die Länge. Ohne Bewegung bleibt es
 * ein Klick (`onClick`), Touch: langes Drücken ruft `onLongPress`.
 */
export function dragItem(e: PointerLike, id: string, key: string, mode: DragMode, opts: { onClick?: () => void; onLongPress?: () => void } = {}) {
  const api = editorApi();
  const cur = api && current(api, id);
  if (!api || !cur) return;
  const it = safeTimeline(cur.o.timeline).items[key];
  const p0 = localAt(id, cur.L, e.clientX, e.clientY);
  if (!it || !p0) return;
  const a0 = parseDay(it.start)!;
  const b0 = parseDay(it.end)!;
  const lane0 = it.lane;
  let last = `${it.start}|${it.end}|${lane0}`;
  let depth = 0;
  const store = api.store;
  track({
    el: e.currentTarget as HTMLElement,
    pointerId: e.pointerId,
    start: { x: e.clientX, y: e.clientY },
    threshold: e.pointerType === 'touch' ? 8 : 3,
    longPress: opts.onLongPress,
    move: (ev, first) => {
      if (first) {
        store.stopCapturing();
        depth = store.undoDepth();
        document.body.classList.add('structure-tl-dragging');
      }
      const c = current(api, id);
      const p = c && localAt(id, c.L, ev.clientX, ev.clientY);
      if (!c || !p) return;
      const dd = snapDays(p.lx - p0.lx, c.L.dayPx);
      // Meilensteine haben nur einen Tag: Enden ziehen verschiebt sie
      const [a, b] = dragDays(a0, b0, it.ms ? 'move' : mode, dd, c.L);
      const lane = mode === 'move' ? laneAt(c.L, p.ly).id : lane0;
      const sig = `${fmtDay(a)}|${fmtDay(b)}|${lane}`;
      if (sig === last) return;
      last = sig;
      patchItem(store, id, key, { start: fmtDay(a), end: fmtDay(b), lane });
    },
    up: (moved) => {
      if (moved) store.stopCapturing();
      else opts.onClick?.();
    },
    cancel: () => {
      if (depth) store.revertTo(depth);
    },
  });
}

/** Neuen Eintrag in einer Spur aufziehen (Maus); danach gleich den Titel schreiben. Klick ohne Ziehen: `onClick`. */
export function drawItem(e: PointerLike, id: string, lane: string, day0: number, onClick?: () => void) {
  const api = editorApi();
  if (!api) return;
  let span: [number, number] = [day0, day0];
  track({
    el: e.currentTarget as HTMLElement,
    pointerId: e.pointerId,
    start: { x: e.clientX, y: e.clientY },
    threshold: 4,
    move: (ev) => {
      const c = current(api, id);
      const p = c && localAt(id, c.L, ev.clientX, ev.clientY);
      if (!c || !p) return;
      const d = dayAt(c.L, p.lx);
      span = [Math.min(day0, d), Math.max(day0, d)];
      setDraft(id, { kind: 'new', lane, a: span[0], b: span[1] });
    },
    up: (moved) => {
      setDraft(id, null);
      if (!moved) return onClick?.();
      createAndEdit(api, id, { lane, start: fmtDay(span[0]), end: fmtDay(span[1]), title: '' });
    },
    cancel: () => setDraft(id, null),
  });
}

/** Eintrag anlegen (eigener Undo-Schritt), aktiv machen und den Titel bearbeiten. */
export function createAndEdit(api: EditorApi, id: string, it: Parameters<typeof addItem>[2], typed?: string) {
  api.store.stopCapturing();
  const key = addItem(api.store, id, it);
  api.store.stopCapturing();
  setFocus(id, { kind: 'item', id: key });
  setEdit(id, { kind: 'item', id: key, typed });
  const o = api.store.get(id);
  if (o && api.editingId() !== id) api.startEditing(o);
  return key;
}

/** Eintrag mit Standardlänge am Tag `day` (bzw. heute/Anfang) in der Spur – Doppelklick, Knopf „Eintrag hinzufügen“. */
export function newItemAt(api: EditorApi, id: string, lane: string | null, day: number | null) {
  const c = current(api, id);
  if (!c) return null;
  const { L } = c;
  const [a, b] = newItemSpan(L, day);
  // ohne Spur: die des aktiven Eintrags, sonst die erste
  const act = activeItem(id);
  const fromItem = act ? safeTimeline(c.o.timeline).items[act]?.lane : undefined;
  const ln = lane ?? fromItem ?? L.lanes[0].id;
  return createAndEdit(api, id, { lane: ln, start: fmtDay(a), end: fmtDay(b), title: '' });
}

/** Spur am Griff nach oben/unten ziehen. */
export function dragLane(e: PointerLike, id: string, lane: string) {
  const api = editorApi();
  if (!api) return;
  let to = -1;
  track({
    el: e.currentTarget as HTMLElement,
    pointerId: e.pointerId,
    start: { x: e.clientX, y: e.clientY },
    threshold: e.pointerType === 'touch' ? 8 : 3,
    move: (ev) => {
      const c = current(api, id);
      const p = c && localAt(id, c.L, ev.clientX, ev.clientY);
      if (!c || !p) return;
      // Ziel = Anzahl der anderen Spuren, deren Mitte über dem Zeiger liegt
      to = c.L.lanes.filter((l) => l.id !== lane && l.y + l.h / 2 < p.ly).length;
      const others = c.L.lanes.filter((l) => l.id !== lane);
      const y = to < others.length ? others[to].y : others.length ? others[others.length - 1].y + others[others.length - 1].h : c.L.lanes[0].y;
      setDraft(id, { kind: 'laneMove', lane, y });
    },
    up: (moved) => {
      setDraft(id, null);
      if (!moved || to < 0) return;
      api.store.stopCapturing();
      moveLane(api.store, id, lane, to);
      api.store.stopCapturing();
    },
    cancel: () => setDraft(id, null),
  });
}
