// Bedienelemente rund um die Zeitleiste: Kontextleiste (Zeitskala, Spur/Eintrag hinzufügen, Farbe, Meilenstein,
// Datum, Löschen), Kontextmenü, Dialog „Eintrag“, Griffe des aktiven Eintrags und „Spur hinzufügen“ (Bildschirm-
// Ebene, am Handy 44 px), Tastenkürzel und Haftnotizen/Karten, die auf eine Spur gezogen werden.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { BoardObject } from '../../../protocol';
import type { Rect } from '../../../board/geometry';
import { plainTextOf } from '../../../board/types';
import type { Snapshot } from '../../../board/store';
import { defineContextAction, defineMenuItem, defineModal, defineShortcut, defineSlot } from '../../../editor/ext/registry';
import { PopBtn, Toggle } from '../../../editor/ContextBar';
import type { CtxProps, EditorApi, SlotProps } from '../../../editor/ext/types';
import type { MenuItem } from '../../../editor/interaction/ContextMenu';
import { useSnapshot } from '../../../editor/ext/hooks';
import { Modal } from '../../../ui/Modal';
import { colorName } from '../../../ui/a11y';
import { bindField } from '../ytext';
import {
  dayPatch,
  DEFAULT_ITEM_COLOR,
  droppedItem,
  fmtDay,
  hitLocal,
  LABEL_W,
  layoutFor,
  parseDay,
  safeTimeline,
  toLocal,
  toWorldRect,
  TL_COLORS,
  toggleMsPatch,
  UNITS,
  unitOf,
  type Layout,
  type TlHit,
  type TlItem,
  type TlUnit,
} from './model';
import { activeItem, focusOf, setFocus, setEdit, useTimelineState } from './state';
import { dragItem, newItemAt } from './gestures';
import { addItem, addLane, moveLane, patchItem, removeItem, removeLane, setUnit, titleSource } from './yjs';
import { ITEM_MODAL } from './timeline';
import { IconDates, IconItemAdd, IconItemDel, IconLaneAdd, IconMilestone } from './icons';

const isTl = (o: BoardObject | null | undefined): o is BoardObject => !!o && o.type === 'timeline';

/** Einzeln ausgewählte, nicht gesperrte Zeitleiste */
function selectedTimeline(api: EditorApi): BoardObject | null {
  const s = api.selected();
  return s.length === 1 && isTl(s[0]) && !s[0].locked ? s[0] : null;
}

/** Ein Undo-Schritt für eine Aktion aus Menü/Leiste */
function step(api: EditorApi, fn: () => void) {
  api.store.stopCapturing();
  fn();
  api.store.stopCapturing();
}

function addLaneAndName(api: EditorApi, id: string, after?: string) {
  let lane: string | null = null;
  step(api, () => (lane = addLane(api.store, id, after)));
  if (!lane) return api.toast('Mehr Spuren gehen nicht.');
  setFocus(id, { kind: 'lane', id: lane });
  setEdit(id, { kind: 'lane', id: lane });
  const o = api.store.get(id);
  if (o) api.startEditing(o);
}

// ---- Kontextleiste ----------------------------------------------------------------------------------------------------

function TimelineBar(p: CtxProps) {
  useTimelineState();
  const o = p.single!;
  const unit = unitOf(o);
  const focus = focusOf(o.id);
  return (
    <div className="ctx-group">
      <PopBtn open={p.pop === 'tlUnit'} onToggle={p.togglePop('tlUnit')} label="Zeitskala">
        <span className="structure-tl-unit">{UNITS.find((u) => u.unit === unit)!.label}</span>
      </PopBtn>
      <button className="ctx-btn" aria-label="Spur hinzufügen" title="Spur hinzufügen" onClick={() => addLaneAndName(p.api, o.id, focus?.kind === 'lane' ? focus.id : undefined)}>
        <IconLaneAdd />
      </button>
      <button className="ctx-btn" aria-label="Eintrag hinzufügen" title="Eintrag hinzufügen (heute)" onClick={() => newItemAt(p.api, o.id, focus?.kind === 'lane' ? focus.id : null, null)}>
        <IconItemAdd />
      </button>
    </div>
  );
}

/** Eigener Eintrag der Leiste (am Handy wandert er als Ganzes hinter „···“), nur mit aktivem Eintrag sichtbar. */
function ItemBar(p: CtxProps) {
  useTimelineState();
  const o = p.single!;
  const key = activeItem(o.id);
  const it = key ? safeTimeline(o.timeline).items[key] : undefined;
  if (!it || !key) return null;
  return (
    <div className="ctx-group">
      <PopBtn open={p.pop === 'tlColor'} onToggle={p.togglePop('tlColor')} label="Farbe des Eintrags">
        <span className="structure-tl-dot" style={{ background: it.color ?? DEFAULT_ITEM_COLOR }} />
      </PopBtn>
      <Toggle label="Meilenstein" on={!!it.ms} onClick={() => step(p.api, () => patchItem(p.api.store, o.id, key, toggleMs(it, unitOf(o))))}>
        <IconMilestone />
      </Toggle>
      <button className="ctx-btn" aria-label="Datum ändern" title="Titel, Datum und Spur" onClick={() => p.api.openModal(ITEM_MODAL, { id: o.id, key })}>
        <IconDates />
      </button>
      <button className="ctx-btn" aria-label="Eintrag löschen" title="Eintrag löschen (Entf)" onClick={() => deleteItem(p.api, o.id, key)}>
        <IconItemDel />
      </button>
    </div>
  );
}

/** Balken ↔ Meilenstein (Balken bekommt wieder die Standardlänge der Skala) */
const toggleMs = (it: TlItem, unit: TlUnit): Parameters<typeof patchItem>[3] => toggleMsPatch(it, unit);

function deleteItem(api: EditorApi, id: string, key: string) {
  step(api, () => removeItem(api.store, id, key));
  setFocus(id, null);
}

const isTimelineSel = (c: { single: BoardObject | null; locked: boolean }) => !!c.single && c.single.type === 'timeline' && !c.locked;

defineContextAction({
  id: 'structure.timeline',
  order: 74,
  when: isTimelineSel,
  Bar: TimelineBar,
  pops: {
    tlUnit: {
      className: 'ctx-pop--row',
      label: 'Zeitskala',
      Body: (p) => (
        <>
          {UNITS.map((u) => (
            <button
              key={u.unit}
              className={`ctx-chip${unitOf(p.first) === u.unit ? ' is-active' : ''}`}
              onClick={() => {
                step(p.api, () => setUnit(p.api.store, p.first.id, u.unit));
                p.closePop();
              }}
            >
              {u.label}
            </button>
          ))}
        </>
      ),
    },
  },
});

defineContextAction({
  id: 'structure.timelineItem',
  order: 75,
  when: isTimelineSel,
  Bar: ItemBar,
  pops: {
    tlColor: {
      className: 'ctx-pop--row',
      label: 'Farbe des Eintrags',
      Body: (p) => {
        const key = activeItem(p.first.id);
        const cur = key ? (safeTimeline(p.first.timeline).items[key]?.color ?? DEFAULT_ITEM_COLOR) : null;
        return (
          <>
            {TL_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch${cur === c ? ' is-active' : ''}`}
                style={{ background: c }}
                aria-label={`Farbe ${colorName(c)}`}
                onClick={() => {
                  if (key) step(p.api, () => patchItem(p.api.store, p.first.id, key, { color: c === DEFAULT_ITEM_COLOR ? undefined : c }));
                  p.closePop();
                }}
              />
            ))}
          </>
        );
      },
    },
  },
});

// ---- Kontextmenü ------------------------------------------------------------------------------------------------------

/** Treffer des Rechtsklicks/langen Drucks in der ausgewählten Zeitleiste */
function menuHit(api: EditorApi, at: { x: number; y: number }): { o: BoardObject; L: Layout; hit: TlHit } | null {
  const o = selectedTimeline(api);
  if (!o) return null;
  const L = layoutFor(o);
  const p = toLocal(o, L, at);
  const hit = hitLocal(L, p.lx, p.ly);
  return hit ? { o, L, hit } : null;
}

const itemMenu = (order: number, build: (api: EditorApi, o: BoardObject, key: string) => MenuItem | null) =>
  defineMenuItem({
    id: `structure.tl.item${order}`,
    on: 'object',
    order,
    item: (api, at) => {
      const m = menuHit(api, at);
      if (m?.hit.kind !== 'item') return null;
      return build(api, m.o, m.hit.id);
    },
  });

itemMenu(1, (api, o, key) => ({ label: 'Titel, Datum und Spur …', onSelect: () => api.openModal(ITEM_MODAL, { id: o.id, key }) }));
itemMenu(2, (api, o, key) => ({
  label: 'Farbe',
  items: TL_COLORS.map((c) => ({ label: colorName(c), onSelect: () => step(api, () => patchItem(api.store, o.id, key, { color: c === DEFAULT_ITEM_COLOR ? undefined : c })) })),
}));
itemMenu(3, (api, o, key) => {
  const it = safeTimeline(o.timeline).items[key];
  if (!it) return null;
  return {
    label: it.ms ? 'Als Balken' : 'Als Meilenstein',
    onSelect: () => step(api, () => patchItem(api.store, o.id, key, toggleMs(it, unitOf(o)))),
  };
});
itemMenu(4, (api, o, key) => ({ label: 'Eintrag löschen', danger: true, onSelect: () => deleteItem(api, o.id, key) }));

const laneMenu = (order: number, build: (api: EditorApi, o: BoardObject, lane: string, L: Layout, hit: TlHit) => MenuItem | null) =>
  defineMenuItem({
    id: `structure.tl.lane${order}`,
    on: 'object',
    order,
    item: (api, at) => {
      const m = menuHit(api, at);
      if (m?.hit.kind !== 'label' && m?.hit.kind !== 'lane') return null;
      return build(api, m.o, m.hit.lane, m.L, m.hit);
    },
  });

laneMenu(1, (api, o, lane, _L, hit) => (hit.kind === 'lane' ? { label: 'Eintrag hier anlegen', onSelect: () => newItemAt(api, o.id, lane, hit.day) } : null));
laneMenu(2, (api, o, lane) => ({
  label: 'Spur umbenennen',
  onSelect: () => {
    setFocus(o.id, { kind: 'lane', id: lane });
    setEdit(o.id, { kind: 'lane', id: lane });
    api.startEditing(o);
  },
}));
laneMenu(3, (api, o, lane) => ({ label: 'Spur darunter einfügen', onSelect: () => addLaneAndName(api, o.id, lane) }));
laneMenu(4, (api, o, lane, L) => {
  const i = L.lanes.findIndex((l) => l.id === lane);
  return { label: 'Spur nach oben', disabled: i <= 0, onSelect: () => step(api, () => moveLane(api.store, o.id, lane, i - 1)) };
});
laneMenu(5, (api, o, lane, L) => {
  const i = L.lanes.findIndex((l) => l.id === lane);
  return { label: 'Spur nach unten', disabled: i >= L.lanes.length - 1, onSelect: () => step(api, () => moveLane(api.store, o.id, lane, i + 1)) };
});
laneMenu(6, (api, o, lane, L) => ({ label: 'Spur löschen', danger: true, disabled: L.lanes.length <= 1, onSelect: () => step(api, () => removeLane(api.store, o.id, lane)) }));

// ---- Dialog „Eintrag“ ---------------------------------------------------------------------------------------------------

function ItemDialog({ api, id, itemKey, onClose }: { api: EditorApi; id: string; itemKey: string; onClose: () => void }) {
  const snap = useSnapshot(api);
  const o = snap.byId.get(id);
  const it = o ? safeTimeline(o.timeline).items[itemKey] : undefined;
  const titleRef = useRef<HTMLInputElement>(null);
  const exists = !!it;
  useLayoutEffect(() => {
    if (!titleRef.current || !exists) return;
    return bindField(titleRef.current, titleSource(api.store, id, itemKey), api.store.subscribe);
  }, [api, id, itemKey, exists]);
  useEffect(() => {
    if (!exists) onClose();
  }, [exists, onClose]);
  if (!o || !it) return null;
  const d = safeTimeline(o.timeline);
  const set = (patch: Parameters<typeof patchItem>[3]) => step(api, () => patchItem(api.store, id, itemKey, patch));
  const setDay = (which: 'start' | 'end', v: string) => {
    const n = parseDay(v);
    if (n === null) return;
    // Anfang nach dem Ende (bzw. umgekehrt): den anderen Tag mitziehen, die Länge bleibt
    set(dayPatch(it, which, n));
  };
  return (
    <Modal title={it.ms ? 'Meilenstein' : 'Eintrag'} onClose={onClose}>
      <div className="structure-tldlg" onKeyDown={(e) => e.stopPropagation()}>
        <div className="field">
          <label htmlFor="tl-title">Titel</label>
          <input id="tl-title" ref={titleRef} className="input" data-autofocus defaultValue={it.title} maxLength={200} />
        </div>
        <div className="structure-tldlg__row">
          <div className="field">
            <label htmlFor="tl-start">{it.ms ? 'Datum' : 'Beginn'}</label>
            <input id="tl-start" type="date" className="input" value={it.start} onChange={(e) => setDay('start', e.target.value)} />
          </div>
          {!it.ms && (
            <div className="field">
              <label htmlFor="tl-end">Ende</label>
              <input id="tl-end" type="date" className="input" value={it.end} min={it.start} onChange={(e) => setDay('end', e.target.value)} />
            </div>
          )}
        </div>
        <div className="structure-tldlg__row">
          <div className="field">
            <label htmlFor="tl-lane">Spur</label>
            <select id="tl-lane" className="input" value={it.lane} onChange={(e) => set({ lane: e.target.value })}>
              {d.lanes.map((l) => (
                <option key={l} value={l}>
                  {d.names[l] || 'Ohne Namen'}
                </option>
              ))}
            </select>
          </div>
          <label className="structure-tldlg__check">
            <input type="checkbox" checked={!!it.ms} onChange={(e) => e.target.checked !== !!it.ms && set(toggleMs(it, unitOf(o)))} />
            Meilenstein (ein Tag)
          </label>
        </div>
        <div className="field">
          <span className="structure-carddlg__label">Farbe</span>
          <div className="structure-tldlg__swatches">
            {TL_COLORS.map((c) => (
              <button key={c} className={`swatch${(it.color ?? DEFAULT_ITEM_COLOR) === c ? ' is-active' : ''}`} style={{ background: c }} aria-label={`Farbe ${colorName(c)}`} onClick={() => set({ color: c === DEFAULT_ITEM_COLOR ? undefined : c })} />
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => {
              deleteItem(api, id, itemKey);
              onClose();
            }}
          >
            Löschen
          </button>
          <button className="btn btn--primary btn--sm" onClick={onClose}>
            Fertig
          </button>
        </div>
      </div>
    </Modal>
  );
}

defineModal({
  id: ITEM_MODAL,
  Component: ({ api, props, onClose }) => {
    const p = props as { id: string; key: string };
    return <ItemDialog api={api} id={p.id} itemKey={p.key} onClose={onClose} />;
  },
});

// ---- Bildschirm-Ebene: Griffe des aktiven Eintrags, „Spur hinzufügen“ ---------------------------------------------------

function TimelineHandles({ api, snap, selection }: SlotProps) {
  useTimelineState();
  const o = selection.length === 1 ? snap.byId.get(selection[0]) : undefined;
  if (!isTl(o) || o.locked || api.tool() !== 'select' || api.editingId() === o.id) return null;
  const L = layoutFor(o);
  const bl = api.toScreen({ x: o.x, y: o.y + o.h });
  const key = activeItem(o.id);
  const box = key ? L.items.find((b) => b.id === key && !b.it.ms) : undefined;
  let grips = null;
  if (box) {
    const r = toWorldRect(o, L, box);
    const a = api.toScreen({ x: r.x, y: r.y + r.h / 2 });
    const b = api.toScreen({ x: r.x + r.w, y: r.y + r.h / 2 });
    const grip = (side: 'start' | 'end', p: { x: number; y: number }) => (
      <button
        key={side}
        className="structure-tl-grip"
        style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
        aria-label={side === 'start' ? 'Beginn verschieben' : 'Ende verschieben'}
        title="Ziehen: Länge ändern"
        data-tl-handle={side}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          dragItem(e, o.id, box.id, side);
        }}
      />
    );
    grips = [!box.cutL && grip('start', a), !box.cutR && grip('end', b)];
  }
  return (
    <>
      {grips}
      <button
        className="structure-tl-add"
        style={{ transform: `translate(${bl.x}px, ${bl.y + 10}px)` }}
        aria-label="Spur hinzufügen"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          const f = focusOf(o.id);
          addLaneAndName(api, o.id, f?.kind === 'lane' ? f.id : undefined);
        }}
      >
        <b>+</b> Spur
      </button>
    </>
  );
}

defineSlot({ id: 'structure.timelineHandles', slot: 'overlay', order: 21, Component: TimelineHandles });

// ---- Haftnotizen/Karten auf eine Spur ziehen → Eintrag -----------------------------------------------------------------

const DROP_TYPES = new Set(['sticky', 'card']);
const center = (o: BoardObject) => ({ x: o.x + o.w / 2, y: o.y + o.h / 2 });

/** Zeitleiste und Spur unter einem Weltpunkt (nicht Kopf/Namensspalte). */
function dropTarget(api: EditorApi, p: { x: number; y: number }, skip: Set<string>): { t: BoardObject; L: Layout; lane: string; day: number } | null {
  const hits = api.queryRect({ x: p.x - 0.5, y: p.y - 0.5, w: 1, h: 1 }).filter((o) => isTl(o) && !o.locked && !skip.has(o.id));
  const t = hits[hits.length - 1];
  if (!t) return null;
  const L = layoutFor(t);
  const q = toLocal(t, L, p);
  const hit = hitLocal(L, q.lx, q.ly);
  if (!hit || (hit.kind !== 'lane' && hit.kind !== 'item')) return null;
  return { t, L, lane: hit.lane, day: hit.day };
}

/** Bewegte Haftnotizen/Karten seit dem Zeigerdruck */
function movedDroppables(api: EditorApi, before: Snapshot): BoardObject[] {
  return api.selected().filter((o) => {
    if (!DROP_TYPES.has(o.type) || o.locked) return false;
    const b = before.byId.get(o.id);
    return !!b && (b.x !== o.x || b.y !== o.y);
  });
}

function TimelineDrop({ api }: SlotProps) {
  const [zone, setZone] = useState<Rect | null>(null);
  useEffect(() => {
    let before: Snapshot | null = null;
    let raf = 0;
    let down0 = { x: 0, y: 0 };
    let last = { x: 0, y: 0 };
    /** Zeiger in Weltkoordinaten (das Board liegt nicht unbedingt bei 0/0) */
    const world = (e: PointerEvent) => {
      const r = document.querySelector('[data-testid="board"]')?.getBoundingClientRect();
      return api.toWorld({ x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) });
    };
    const down = (e: PointerEvent) => {
      before = e.button === 0 && api.tool() === 'select' ? api.snapshot() : null;
      if (before) down0 = last = world(e);
    };
    const move = (e: PointerEvent) => {
      if (!before || !e.buttons) return;
      last = world(e);
      if (raf) return;
      const snap0 = before;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const moved = movedDroppables(api, snap0);
        // Mitte vor dem Ziehen + Zeigerweg: hinkt dem Editor (der erst im nächsten Bild schreibt) nicht hinterher
        const c0 = moved.length ? center(snap0.byId.get(moved[0].id)!) : null;
        const tgt = c0 ? dropTarget(api, { x: c0.x + last.x - down0.x, y: c0.y + last.y - down0.y }, new Set(moved.map((o) => o.id))) : null;
        if (!tgt) return setZone(null);
        const l = tgt.L.lanes.find((x) => x.id === tgt.lane)!;
        const r = toWorldRect(tgt.t, tgt.L, { x: LABEL_W, y: l.y, w: tgt.L.W0 - LABEL_W, h: l.h });
        const a = api.toScreen(r);
        const z = api.camera().z;
        setZone({ x: a.x, y: a.y, w: r.w * z, h: r.h * z });
      });
    };
    const up = () => {
      const snap0 = before;
      before = null;
      cancelAnimationFrame(raf);
      raf = 0;
      setZone(null);
      if (!snap0) return;
      // nach dem Editor (er schreibt die letzte Verschiebung evtl. erst im nächsten Bild)
      requestAnimationFrame(() => dropInto(api, snap0));
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [api]);
  if (!zone) return null;
  return <div className="structure-tl-dropzone" style={{ transform: `translate(${zone.x}px, ${zone.y}px)`, width: zone.w, height: zone.h } as CSSProperties} aria-hidden="true" />;
}

/** Bewegte Haftnotizen/Karten, die auf einer Spur liegen, in Einträge umwandeln (ein Undo-Schritt). */
function dropInto(api: EditorApi, before: Snapshot) {
  const moved = movedDroppables(api, before);
  if (!moved.length) return;
  const skip = new Set(moved.map((o) => o.id));
  const plan = moved.map((o) => ({ o, tgt: dropTarget(api, center(o), skip) })).filter((x) => x.tgt);
  if (!plan.length) return;
  let last: { t: string; key: string } | null = null;
  api.store.stopCapturing();
  api.store.transact(() => {
    for (const { o, tgt } of plan) {
      const { t, L, lane, day } = tgt!;
      const key = addItem(api.store, t.id, droppedItem(o, plainTextOf(o) ?? '', L, lane, day));
      last = { t: t.id, key };
    }
    api.store.remove(plan.map((x) => x.o.id));
  });
  api.store.stopCapturing();
  if (last) {
    const l = last as { t: string; key: string };
    api.setSelection([l.t]);
    setFocus(l.t, { kind: 'item', id: l.key });
  }
  api.toast(plan.length === 1 ? 'Als Eintrag in die Zeitleiste übernommen' : `${plan.length} Einträge in die Zeitleiste übernommen`);
}

defineSlot({ id: 'structure.timelineDrop', slot: 'overlay', order: 22, Component: TimelineDrop });

// ---- Tastenkürzel (nur mit aktivem Eintrag, sonst geht die Taste weiter) --------------------------------------------------

function activeOf(api: EditorApi): { o: BoardObject; key: string } | null {
  const o = selectedTimeline(api);
  const key = o && activeItem(o.id);
  return o && key && safeTimeline(o.timeline).items[key] ? { o, key } : null;
}

defineShortcut({
  id: 'structure.tl.delete',
  keys: ['Delete', 'Backspace'],
  run: (api) => {
    const a = activeOf(api);
    if (!a) return false;
    deleteItem(api, a.o.id, a.key);
  },
});

defineShortcut({
  id: 'structure.tl.nudge',
  keys: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'],
  run: (api, e) => {
    const a = activeOf(api);
    if (!a) return false;
    const d = safeTimeline(a.o.timeline);
    const it = d.items[a.key];
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const n = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 7 : 1);
      step(api, () => patchItem(api.store, a.o.id, a.key, { start: fmtDay(parseDay(it.start)! + n), end: fmtDay(parseDay(it.end)! + n) }));
    } else {
      const i = d.lanes.indexOf(it.lane) + (e.key === 'ArrowUp' ? -1 : 1);
      if (i >= 0 && i < d.lanes.length) step(api, () => patchItem(api.store, a.o.id, a.key, { lane: d.lanes[i] }));
    }
  },
  help: { group: 'Bearbeiten', keys: '← → ↑ ↓', label: 'Zeitleiste: Eintrag um einen Tag bzw. eine Spur verschieben', order: 95 },
});

defineShortcut({
  id: 'structure.tl.escape',
  keys: ['Escape'],
  run: (api) => {
    const o = selectedTimeline(api);
    if (!o || !focusOf(o.id)) return false;
    setFocus(o.id, null);
  },
});
