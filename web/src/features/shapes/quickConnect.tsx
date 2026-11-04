// Verbinder ziehen: Andockpunkte aller Objekte in der Nähe sind beim Ziehen sichtbar und rasten ein,
// die Vorschau zeigt die echte Linie (Linienart des Werkzeugs). Ziehen am blauen Plus ins Leere legt eine gleiche
// Form an und verbindet sie. Ersetzt das Kern-Ziehen über connectorDrag (editor/core/tools.tsx).
import { useEffect, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { BoardObject, ConnectorEnd, Side } from '../../protocol';
import { center, normRect, type Point } from '../../board/geometry';
import { connectorGeometry, connectorPath, endAnchor, endSide, isAttached, nearestSide, sidePoint } from '../../board/connector';
import type { NewObject } from '../../board/store';
import { siblingFields } from '../../board/types';
import { connectorDrag, newLineStyle } from '../../editor/core/tools';
import { shapePath } from '../../editor/core/shapeKinds';
import { defineSlot, defineTool, tools, typeDef } from '../../editor/ext/registry';
import { getToolOption } from '../../editor/ext/toolOptions';
import type { EditorApi, SlotProps, ToolGesture } from '../../editor/ext/types';
import { setEditorApi } from './apiRef';
import { capGeom, projectOnPath } from './connectorGeom';
import { CapMark } from './connector';
import { capPatch, type CapStyle } from './model';
import { entryById } from './catalog';
import { ShapeIcon } from './kinds';
import { stickySize, toolStickyShape } from './stickyShape';

const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];
/** Fangradius der Andockpunkte (Bildschirm-px) und Suchradius für Objekte in der Nähe */
const SNAP_PX = 18;
const NEAR_PX = 70;
const GHOST = '__shapes_ghost__';

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Objekte mit Andockpunkten nahe `p` (ohne `skipId`), nächste zuerst. */
export function nearAnchorables(api: EditorApi, p: Point, skipId: string | null, radius: number): BoardObject[] {
  return api
    .queryRect({ x: p.x - radius, y: p.y - radius, w: radius * 2, h: radius * 2 })
    .filter((o) => o.id !== skipId && typeDef(o).anchorable && !typeDef(o).derive)
    .sort((a, b) => dist(center(a), p) - dist(center(b), p))
    .slice(0, 8);
}

/** Andockpunkt (Seitenmitte am Umriss) im Fangradius. */
export function snapAnchor(objs: BoardObject[], p: Point, z: number): { o: BoardObject; side: Side; at: Point } | null {
  let best: { o: BoardObject; side: Side; at: Point; d: number } | null = null;
  for (const o of objs)
    for (const side of SIDES) {
      const at = sidePoint(o, side).p;
      const d = dist(at, p) * z;
      if (d < SNAP_PX && (!best || d < best.d)) best = { o, side, at, d };
    }
  return best;
}

interface Style {
  cap: CapStyle;
}
const toolStyle = (): Style => ({ cap: getToolOption<CapStyle>('connector', 'cap', 'triangle') });

/** Felder eines neuen Verbinders; Linienart: zwischen zwei Objekten geschwungen, sofern im Werkzeug nichts gewählt ist. */
function connectorFields(style: Style, from: ConnectorEnd, to: ConnectorEnd): Partial<NewObject> {
  return { color: '#0a0a0a', strokeWidth: 2, lineStyle: newLineStyle(from, to), ...capPatch('end', style.cap) };
}

/** Kopie von `src` (ohne Text) mit Mitte bei `p`. */
function cloneAt(src: BoardObject, p: Point): NewObject {
  return { ...siblingFields(src), x: Math.round(p.x - src.w / 2), y: Math.round(p.y - src.h / 2) };
}

/** Anker-Punkte als SVG (Weltkoordinaten), der eingerastete gefüllt. */
function AnchorDots({ objs, z, active }: { objs: BoardObject[]; z: number; active?: { id: string; side: Side } | null }) {
  const out: ReactNode[] = [];
  for (const o of objs)
    for (const side of SIDES) {
      const at = sidePoint(o, side).p;
      const on = active?.id === o.id && active.side === side;
      out.push(<circle key={`${o.id}-${side}`} className={`shapes-dot${on ? ' is-on' : ''}`} cx={at.x} cy={at.y} r={(on ? 7 : 5) / z} strokeWidth={2 / z} />);
    }
  return <g className="shapes-dots">{out}</g>;
}

/** Verbinder aus `from` ziehen (Werkzeug, Andockpunkte, Plus-Griffe). */
export function connectGesture(api: EditorApi, from: ConnectorEnd, fromId: string | null, start: Point, screen: Point): ToolGesture {
  const lookup = (id: string) => api.snapshot().byId.get(id);
  const src = fromId ? lookup(fromId) : undefined;
  const sel = api.selection();
  const fromSide = endSide(from);
  // Plus-Griff: Ziehen an der einzigen Auswahl aus einer festen Seite (Andockpunkte erscheinen dort nicht)
  const viaPlus = !!src && !!fromSide && sel.length === 1 && sel[0] === src.id && !!typeDef(src).addHandles && !src.locked;
  const style = toolStyle();

  const resolve = (p: Point) => {
    const z = api.camera().z;
    const near = nearAnchorables(api, p, fromId, NEAR_PX / z);
    const snapped = snapAnchor(near, p, z);
    const hit = api.hitTest(p, (o) => o.id === fromId);
    // am Plus-Griff: Rahmen sind kein Ziel, dort entsteht die neue Form
    const target = snapped?.o ?? (hit && hit.id !== fromId && !(viaPlus && typeDef(hit).container) ? hit : null);
    const end: ConnectorEnd = snapped ? { objectId: snapped.o.id, side: snapped.side } : target ? { objectId: target.id } : { x: Math.round(p.x), y: Math.round(p.y) };
    return { near, snapped, target, end, z };
  };

  return {
    kind: 'connector',
    hoverTarget: true,
    move: (e) => {
      const { near, snapped, target, end, z } = resolve(e.world);
      api.setHover(target?.id ?? null);
      // Vorschau: am Plus ins Leere mit Geister-Form, die gleich angelegt wird
      let ghost: BoardObject | null = null;
      let to = end;
      if (viaPlus && !target && src) {
        ghost = { ...src, ...cloneAt(src, e.world), id: GHOST } as BoardObject;
        to = { objectId: GHOST, side: nearestSide(ghost, center(src)) };
      }
      const look = (id: string) => (id === GHOST ? (ghost ?? undefined) : lookup(id));
      const g = connectorGeometry({ from, to, lineStyle: newLineStyle(from, to) }, look);
      const dots = target && !near.includes(target) && typeDef(target).anchorable ? [...near, target] : near;
      const head = g ? capGeom(style.cap === 'none' ? 'triangle' : style.cap, g.b, g.dirB, 2 / z) : null;
      api.setDraft({
        kind: 'world',
        node: (
          <g className="shapes-draft">
            {ghost && <path d={shapePath(ghost.type === 'shape' ? ghost.shape : 'rect', ghost.w, ghost.h, 0)} transform={`translate(${ghost.x} ${ghost.y})`} className="shapes-ghost" strokeWidth={1.5 / z} strokeDasharray={`${6 / z} ${4 / z}`} />}
            <AnchorDots objs={dots} z={z} active={snapped ? { id: snapped.o.id, side: snapped.side } : null} />
            {g && <path d={connectorPath(g)} className="shapes-draft-line" strokeWidth={2 / z} fill="none" />}
            {g && head && <CapMark g={head} color="#1763b5" sw={2 / z} />}
          </g>
        ),
      });
    },
    up: (e) => {
      const { target, end } = resolve(e.world);
      api.setHover(null);
      if (!target && dist(e.screen, screen) < 12) return;
      if (target && target.id === fromId) return;
      const a = endAnchor(from, lookup) ?? start;
      if (viaPlus && !target && src) {
        // neue gleiche Form am Loslassen, verbunden über die zugewandten Seiten
        const clone = cloneAt(src, e.world);
        api.store.stopCapturing();
        const nid = api.store.create(clone);
        const live = (id: string) => api.store.get(id);
        const made = live(nid)!;
        const to = { objectId: nid, side: nearestSide(made, center(src)) };
        const b = endAnchor({ objectId: nid }, live) ?? e.world;
        api.store.create({ type: 'connector', ...normRect(a, b), from, to, ...connectorFields(style, from, to) } as NewObject);
        api.store.stopCapturing();
        api.setSelection([nid]);
        if (typeDef(made).edit === 'text') api.startEditing(made);
        return;
      }
      const b = endAnchor(end, lookup) ?? e.world;
      const cid = api.create({ type: 'connector', ...normRect(a, b), from, to: end, ...connectorFields(style, from, end) } as NewObject, { select: true });
      // aus einem Objekt ins Leere gezogen: kleine Formen-Auswahl am Linienende
      if (!target && fromId) setPending({ id: cid, at: { x: Math.round(e.world.x), y: Math.round(e.world.y) }, fromId });
    },
    cancel: () => api.setHover(null),
  };
}

connectorDrag.gesture = connectGesture;

// Verbinder-Werkzeug: Start an einem Andockpunkt rastet ebenfalls ein
const coreConnector = tools.get('connector')!;
defineTool({
  ...coreConnector,
  down: (e, api) => {
    const z = api.camera().z;
    const hit = api.hitTest(e.world);
    const snapped = snapAnchor(nearAnchorables(api, e.world, null, NEAR_PX / z), e.world, z);
    if (snapped) return connectGesture(api, { objectId: snapped.o.id, side: snapped.side }, snapped.o.id, e.world, e.screen);
    const from: ConnectorEnd = hit ? { objectId: hit.id } : { x: Math.round(e.world.x), y: Math.round(e.world.y) };
    return connectGesture(api, from, hit?.id ?? null, e.world, e.screen);
  },
});

// ---- Form am freien Linienende anhängen ------------------------------------------------------------------------------

interface Pending {
  id: string;
  at: Point;
  fromId: string;
}
let pending: Pending | null = null;
const pendingSubs = new Set<() => void>();
function setPending(p: Pending | null) {
  pending = p;
  pendingSubs.forEach((f) => f());
}
const subscribePending = (f: () => void) => {
  pendingSubs.add(f);
  return () => {
    pendingSubs.delete(f);
  };
};

const ATTACH: { id: string; label: string }[] = [
  { id: 'same', label: 'Gleiche Form' },
  { id: 'rect', label: 'Rechteck' },
  { id: 'roundrect', label: 'Abgerundetes Rechteck' },
  { id: 'circle', label: 'Kreis' },
  { id: 'decision', label: 'Raute' },
  { id: 'terminator', label: 'Start/Ende' },
  { id: 'sticky', label: 'Haftnotiz' },
];

/** Neues Objekt so ans Linienende setzen, dass die Linie an seiner zugewandten Seite endet; Verbinder umhängen. */
function attachAt(api: EditorApi, p: Pending, choice: string) {
  const c = api.store.get(p.id);
  const src = api.store.get(p.fromId);
  if (!c || !src) return;
  let obj: NewObject;
  if (choice === 'same') obj = cloneAt(src, p.at);
  else if (choice === 'sticky') obj = { type: 'sticky', x: 0, y: 0, ...stickySize(toolStickyShape()), color: src.type === 'sticky' ? src.color : '#fff27a', text: '' };
  else {
    const e = entryById(choice)!;
    obj = { type: 'shape', shape: e.kind, x: 0, y: 0, w: e.w, h: e.h, color: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2, text: '', fontSize: 20 };
  }
  // Mitte: vom Linienende aus ein Stück weiter in Zugrichtung
  const from = center(src);
  const len = Math.hypot(p.at.x - from.x, p.at.y - from.y) || 1;
  const d = { x: (p.at.x - from.x) / len, y: (p.at.y - from.y) / len };
  const side = Math.abs(d.x) * obj.h >= Math.abs(d.y) * obj.w ? obj.w / 2 / Math.abs(d.x || 1) : obj.h / 2 / Math.abs(d.y || 1);
  const reach = Math.min(side, Math.hypot(obj.w, obj.h) / 2);
  const cx = p.at.x + d.x * reach;
  const cy = p.at.y + d.y * reach;
  obj = { ...obj, x: Math.round(cx - obj.w / 2), y: Math.round(cy - obj.h / 2) };
  api.store.stopCapturing();
  const nid = api.store.create(obj);
  const to = { objectId: nid };
  // jetzt hängt die Linie an zwei Objekten: geschwungen wie beim direkten Verbinden (außer im Werkzeug anders gewählt)
  api.store.update(p.id, { to, lineStyle: c.lineStyle ?? newLineStyle(c.from, to) });
  api.store.stopCapturing();
  setPending(null);
  api.setSelection([nid]);
  const made = api.store.get(nid);
  if (made && typeDef(made).edit === 'text') api.startEditing(made);
}

function AttachPicker({ api, cam, selection }: SlotProps) {
  const p = useSyncExternalStore(subscribePending, () => pending);
  // schließt, sobald etwas anderes ausgewählt ist oder der Verbinder fehlt
  const live = !!p && selection.length === 1 && selection[0] === p.id && !!api.store.get(p.id);
  useEffect(() => {
    if (p && !live) setPending(null);
  }, [p, live]);
  useEffect(() => {
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPending(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [live]);
  if (!p || !live) return null;
  const s = { x: p.at.x * cam.z + cam.x, y: p.at.y * cam.z + cam.y };
  const src = api.store.get(p.fromId);
  return (
    <div className="shapes-attach panel" role="group" aria-label="Form anhängen" style={{ transform: `translate(${s.x + 14}px, ${s.y + 14}px)` }} onPointerDown={(e) => e.stopPropagation()}>
      {ATTACH.map((a) => {
        const e = entryById(a.id);
        const icon =
          a.id === 'same' && src ? (
            src.type === 'shape' ? (
              <ShapeIcon kind={src.shape ?? 'rect'} />
            ) : (
              <span className="shapes-attach__note" style={{ background: src.color ?? '#fff27a' }} />
            )
          ) : a.id === 'sticky' ? (
            <span className="shapes-attach__note" />
          ) : e ? (
            <ShapeIcon kind={e.kind} w={e.w} h={e.h} />
          ) : null;
        if (a.id === 'same' && src?.type !== 'shape' && src?.type !== 'sticky') return null;
        return (
          <button key={a.id} className={`fly-btn${a.id === 'same' ? ' shapes-attach__same' : ''}`} aria-label={a.label} title={a.label} onClick={() => attachAt(api, p, a.id)}>
            {icon}
          </button>
        );
      })}
    </div>
  );
}

defineSlot({ id: 'shapes.attach', slot: 'overlay', order: 51, Component: AttachPicker });

// ---- Overlay: Andockpunkte beim Verbinder-Werkzeug, Doppelklick setzt die Beschriftung an die Klickstelle ----------------

function ConnectLayer({ api, cam, width, height, selection, snap }: SlotProps) {
  setEditorApi(api);

  // Beschriftung des ausgewählten Verbinders als verschiebbar markieren (die Objekt-Ebene rendert Verbinder bei
  // Auswahländerungen nicht neu, daher direkt am DOM)
  const one = selection.length === 1 ? snap.byId.get(selection[0]) : undefined;
  const dragId = one?.type === 'connector' && !one.locked && api.tool() === 'select' ? one.id : '';
  useLayoutEffect(() => {
    document.querySelectorAll('.conn-label.shapes-label--drag').forEach((el) => {
      if (!dragId || !el.closest(`[data-id="${dragId}"]`)) el.classList.remove('shapes-label--drag');
    });
    if (dragId) document.querySelector(`[data-id="${dragId}"] .conn-label`)?.classList.add('shapes-label--drag');
  });

  // Doppelklick auf eine Linie ohne Beschriftung: Beschriftung dort, wo geklickt wurde (vor dem Editor)
  useEffect(() => {
    const board = document.querySelector('[data-testid="board"]');
    if (!board) return;
    const onDbl = (ev: Event) => {
      const e = ev as MouseEvent;
      if (api.tool() !== 'select') return;
      const real = document.elementFromPoint(e.clientX, e.clientY);
      const el = real?.closest('.obj-connector') as HTMLElement | null;
      if (!el || real?.closest('.conn-label')) return;
      const o = api.snapshot().byId.get(el.dataset.id ?? '');
      if (!o || o.locked || (o.text ?? '').trim()) return;
      const g = connectorGeometry(o, (id) => api.snapshot().byId.get(id));
      if (!g) return;
      const r = board.getBoundingClientRect();
      const t = projectOnPath(g, api.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top }));
      api.store.update(o.id, { labelPos: Math.abs(t - 0.5) < 0.03 ? undefined : t });
    };
    board.addEventListener('dblclick', onDbl, true);
    return () => board.removeEventListener('dblclick', onDbl, true);
  }, [api]);

  if (api.tool() !== 'connector') return null;
  const p = api.pointerWorld();
  if (!p) return null;
  const near = nearAnchorables(api, p, null, NEAR_PX / cam.z);
  if (!near.length) return null;
  const snapped = snapAnchor(near, p, cam.z);
  return (
    <svg className="shapes-layer" width={width} height={height} aria-hidden="true">
      <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.z})`}>
        <AnchorDots objs={near.slice(0, 3)} z={cam.z} active={snapped ? { id: snapped.o.id, side: snapped.side } : null} />
      </g>
    </svg>
  );
}

defineSlot({ id: 'shapes.connect', slot: 'overlay', order: 50, Component: ConnectLayer });


// ---- Enden eines Verbinders umhängen: Andockpunkte erscheinen und rasten ein (wie beim Neu-Ziehen) ---------------------

/** Ziel für ein gezogenes Ende: Andockpunkt (mit Seite), sonst Objekt darunter, sonst freier Punkt. */
export function endTarget(api: EditorApi, p: Point, skip: Set<string>): { end: ConnectorEnd; near: BoardObject[]; snapped: ReturnType<typeof snapAnchor>; target: BoardObject | null } {
  const z = api.camera().z;
  const near = nearAnchorables(api, p, null, NEAR_PX / z).filter((o) => !skip.has(o.id));
  const snapped = snapAnchor(near, p, z);
  const hit = api.hitTest(p, (o) => skip.has(o.id) || !!typeDef(o).derive);
  const target = snapped?.o ?? hit;
  const end: ConnectorEnd = snapped ? { objectId: snapped.o.id, side: snapped.side } : target ? { objectId: target.id } : { x: Math.round(p.x), y: Math.round(p.y) };
  return { end, near, snapped, target };
}

function EndDrag({ api }: SlotProps) {
  useEffect(() => {
    const board = document.querySelector('[data-testid="board"]') as HTMLElement | null;
    if (!board) return;
    const onDown = (ev: PointerEvent) => {
      const h = (ev.target as HTMLElement | null)?.closest?.('[data-handle="from"], [data-handle="to"]') as HTMLElement | null;
      if (!h || ev.button !== 0 || api.tool() !== 'select') return;
      const sel = api.selection();
      const c = sel.length === 1 ? api.store.get(sel[0]) : undefined;
      if (!c || c.type !== 'connector' || c.locked) return;
      // vor dem Editor: dessen Ende-Ziehen kennt keine Andockpunkte
      ev.stopPropagation();
      ev.preventDefault();
      const which = h.dataset.handle as 'from' | 'to';
      const other = which === 'from' ? c.to : c.from;
      const skip = new Set([c.id, ...(isAttached(other) ? [other.objectId] : [])]);
      const r = board.getBoundingClientRect();
      const depth = api.store.undoDepth();
      const sx = ev.clientX;
      const sy = ev.clientY;
      let moved = false;
      let frame = 0;
      let last: PointerEvent | null = null;
      api.store.stopCapturing();
      const apply = () => {
        frame = 0;
        if (!last) return;
        const p = api.toWorld({ x: last.clientX - r.left, y: last.clientY - r.top });
        const t = endTarget(api, p, skip);
        api.store.update(c.id, { [which]: t.end });
        const dots = t.target && !t.near.includes(t.target) && typeDef(t.target).anchorable ? [...t.near, t.target] : t.near;
        const z = api.camera().z;
        // Ziel umrahmen (eigene Markierung: der Kern-Hover zeigt zusätzlich seine Andockpunkte)
        const tb = t.target ? api.bounds(t.target) : null;
        api.setDraft({
          kind: 'world',
          node: (
            <g className="shapes-draft">
              {tb && <rect className="shapes-target" x={tb.x - 4 / z} y={tb.y - 4 / z} width={tb.w + 8 / z} height={tb.h + 8 / z} rx={6 / z} strokeWidth={2 / z} />}
              <AnchorDots objs={dots} z={z} active={t.snapped ? { id: t.snapped.o.id, side: t.snapped.side } : null} />
            </g>
          ),
        });
      };
      const move = (e: PointerEvent) => {
        if (e.pointerId !== ev.pointerId) return;
        // der Editor soll währenddessen nichts hervorheben (sonst doppelte Andockpunkte)
        e.stopPropagation();
        if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 3) return;
        moved = true;
        last = e;
        if (!frame) frame = requestAnimationFrame(apply);
      };
      const finish = (cancel: boolean) => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', onCancel, true);
        window.removeEventListener('keydown', onKey, true);
        if (frame) cancelAnimationFrame(frame);
        if (!cancel && moved && last) apply();
        api.setDraft(null);
        if (cancel) api.store.revertTo(depth);
        api.store.stopCapturing();
      };
      const up = (e: PointerEvent) => {
        if (e.pointerId === ev.pointerId) finish(false);
      };
      const onCancel = () => finish(true);
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        finish(true);
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', onCancel, true);
      window.addEventListener('keydown', onKey, true);
    };
    board.addEventListener('pointerdown', onDown, true);
    return () => board.removeEventListener('pointerdown', onDown, true);
  }, [api]);
  return null;
}

defineSlot({ id: 'shapes.endDrag', slot: 'overlay', order: 52, Component: EndDrag });
