// Bildschirm-Ebene über dem Board: Auswahl, Griffe, Hilfslinien, Entwürfe, fremde Auswahl und Live-Cursor.
import { useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import type { BoardObject, Side } from '../protocol';
import type { Snapshot } from '../board/store';
import { baseRect, center, objRect, rectsPath, rectToScreen, rotatePoint, rotationOf, unionRects, worldToScreen, type Camera, type Handle, type Point, type Rect } from '../board/geometry';
import { arrowHead } from '../board/connector';
import { smoothPath } from '../board/pen';
import { isBelow } from '../board/types';
import type { Peer } from '../board/session';
import { FAR_ZOOM } from './render/format';
import { typeDef } from './ext/registry';
import type { Draft, EditCallbacks } from './ext/types';
import { textEngine } from './text/engine';
import { shapePath } from './core/shapeKinds';
import type { GapMark, Line } from './interaction/snapping';
import { angleLabel, canRotateAll } from './interaction/rotate';

export type { Draft, Side };

export const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];
const SIDE_DIR: Record<Side, Point> = { n: { x: 0, y: -1 }, e: { x: 1, y: 0 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 } };
const ALL_HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
/** Ab so vielen ausgewählten Objekten werden die Einzelrahmen als ein Pfad gezeichnet. */
const SUB_PATH_FROM = 200;

/** Weltrechteck eines Objekts (abgeleitete Typen wie Verbinder: aus der Geometrie). */
export function boundsOf(o: BoardObject, snap: Snapshot, pad = 0): Rect | null {
  const derive = typeDef(o).derive;
  if (derive) {
    const d = derive(o, (id) => snap.byId.get(id));
    if (!d) return null;
    return pad ? { x: d.bounds.x - pad, y: d.bounds.y - pad, w: d.bounds.w + 2 * pad, h: d.bounds.h + 2 * pad } : d.bounds;
  }
  return objRect(o);
}

export function selectionBounds(ids: readonly string[], snap: Snapshot): Rect | null {
  const rects: Rect[] = [];
  for (const id of ids) {
    const o = snap.byId.get(id);
    if (!o) continue;
    const r = boundsOf(o, snap);
    if (r) rects.push(r);
  }
  return unionRects(rects);
}

export function handlesFor(selected: BoardObject[]): Handle[] {
  if (selected.length !== 1) return ['nw', 'ne', 'se', 'sw'];
  const o = selected[0];
  // gedrehte Objekte: Griffe drehen sich mit (Rahmen wird gedreht gezeichnet), Größe entlang der gedrehten Achsen
  if (o.locked) return [];
  return typeDef(o).handles?.(o) ?? ALL_HANDLES;
}

/** Bildschirmabstand der Plus-Griffe bzw. Andockpunkte von der Objektkante. */
const ADD_GAP = 30;
const ANCHOR_GAP = 16;

/** Mittelpunkt einer Seite, `gap` Bildschirmpunkte nach außen versetzt. */
function sidePoint(s: Rect, side: Side, gap: number): Point {
  const d = SIDE_DIR[side];
  return { x: s.x + s.w / 2 + d.x * (s.w / 2 + gap), y: s.y + s.h / 2 + d.y * (s.h / 2 + gap) };
}

const HANDLE_POS: Record<Handle, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

/** Unsichtbare Trefferfläche der Griffe bei Touch (mindestens 40 px; der Griff selbst bleibt 18 px). */
const HIT_AREA: CSSProperties = { position: 'absolute', left: '50%', top: '50%', width: 44, height: 44, margin: '-22px 0 0 -22px', borderRadius: '50%' };

const coarseQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
const subscribeCoarse = (fn: () => void) => {
  coarseQuery?.addEventListener?.('change', fn);
  return () => coarseQuery?.removeEventListener?.('change', fn);
};
/** Hauptzeiger ist ein Finger (Handy, Tablet). */
const useCoarsePointer = () => useSyncExternalStore(subscribeCoarse, () => !!coarseQuery?.matches);

/** Größen-Zeiger passend zur Richtung des Griffs am gedrehten Objekt. */
const HANDLE_DEG: Record<Handle, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
const CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
function resizeCursor(h: Handle, deg: number): string {
  const a = (((HANDLE_DEG[h] + deg) % 180) + 180) % 180;
  return CURSORS[Math.round(a / 45) % 4];
}

interface OverlayProps {
  snap: Snapshot;
  cam: Camera;
  selection: readonly string[];
  editingId: string | null;
  hoverId: string | null;
  /** 'target': Andock-Ziel beim Verbinden (grün) · 'select': Hover im Auswahlmodus (blau) */
  hoverStyle: 'target' | 'select';
  /** Objekt, an dem die vier Andockpunkte gezeigt werden */
  anchorId: string | null;
  /** Plus-Griffe an der einzelnen Auswahl zeigen */
  showAdd: boolean;
  draft: Draft | null;
  peers: readonly Peer[];
  hideHandles: boolean;
  width: number;
  height: number;
  editCb: EditCallbacks;
  /** Zeichen, das an einen Rahmentitel beim Start der Bearbeitung angehängt wird */
  titleAppend: string | null;
  /** Während des Drehens: Winkel fürs Etikett, eingerastet; `box` = Rahmen einer Mehrfachauswahl bei Beginn */
  rotating?: { deg: number; snapped: boolean; box?: Rect } | null;
}

export function Overlay(p: OverlayProps) {
  const { snap, cam, selection, editingId, hoverId, draft, peers, hideHandles, width, height, editCb } = p;
  const selected = selection.map((id) => snap.byId.get(id)).filter((o): o is BoardObject => !!o);
  const single = selected.length === 1 ? selected[0] : null;
  const editing = editingId ? snap.byId.get(editingId) : null;
  const SelectionView = single ? typeDef(single).SelectionView : undefined;
  const coarse = useCoarsePointer();

  // eigene Auswahl
  let selectionEl: React.ReactNode = null;
  if (single && SelectionView) {
    selectionEl = <SelectionView o={single} snap={snap} cam={cam} width={width} height={height} hideHandles={hideHandles} />;
  } else if (selected.length > 0) {
    const bounds = selectionBounds(selection, snap);
    if (bounds) {
      // Mehrfachauswahl beim Drehen: Rahmen vom Gestenbeginn, um den gemeinsamen Winkel gedreht
      const groupTurn = !single && p.rotating?.box ? p.rotating : null;
      const deg = groupTurn ? groupTurn.deg : single ? rotationOf(single) : 0;
      // gedrehtes Einzelobjekt: Rahmen um das ungedrehte Rechteck, mitgedreht
      const s = rectToScreen(cam, groupTurn?.box ?? (deg && single ? baseRect(single) : bounds));
      const handles = hideHandles || editingId || groupTurn ? [] : handlesFor(selected);
      const anyLocked = selected.some((o) => o.locked);
      const canRotate = (single ? !single.locked && !!typeDef(single).rotatable : canRotateAll(selected, typeDef)) && !hideHandles && !editingId;
      // Winkel-Etikett neben dem Drehgriff (ungedreht, damit lesbar)
      let angleEl: React.ReactNode = null;
      if (p.rotating && canRotate) {
        const c = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
        const grip = rotatePoint({ x: s.x + s.w, y: s.y - (coarse ? 30 : 24) }, c, deg);
        angleEl = (
          <div
            key={p.rotating.snapped ? `snap-${Math.round(p.rotating.deg)}` : 'free'}
            className={`ov-angle${p.rotating.snapped ? ' is-snapped' : ''}`}
            data-testid="rotate-angle"
            style={{ transform: `translate(${Math.round(grip.x + 16)}px, ${Math.round(grip.y - 34)}px)` }}
          >
            {angleLabel(p.rotating.deg)}
          </div>
        );
      }
      const subs = selected.length > 1 ? selected.flatMap((o) => (boundsOf(o, snap) ? [{ id: o.id, r: boundsOf(o, snap)! }] : [])) : [];
      selectionEl = (
        <>
          {subs.length >= SUB_PATH_FROM ? (
            // sehr viele Objekte: ein einziger Pfad statt je ein DOM-Knoten
            <svg className="ov-svg" width={width} height={height}>
              <path d={rectsPath(subs.map((s) => rectToScreen(cam, s.r)))} fill="none" stroke="rgba(23,99,181,.55)" />
            </svg>
          ) : (
            subs.map(({ id, r }) => {
              const q = rectToScreen(cam, r);
              return <div key={id} className="ov-sub" style={{ transform: `translate(${q.x}px, ${q.y}px)`, width: q.w, height: q.h }} />;
            })
          )}
          <div
            className={`ov-sel${anyLocked ? ' ov-sel--locked' : ''}`}
            data-testid="selection-box"
            style={{ transform: `translate(${s.x}px, ${s.y}px)${deg ? ` rotate(${deg}deg)` : ''}`, width: s.w, height: s.h }}
          >
            {handles.map((h) => (
              <div
                key={h}
                className={`ov-handle ov-handle--${h}`}
                data-handle={h}
                style={{ left: `${HANDLE_POS[h][0] * 100}%`, top: `${HANDLE_POS[h][1] * 100}%`, cursor: deg ? resizeCursor(h, deg) : undefined }}
              >
                {coarse && <span style={HIT_AREA} />}
              </div>
            ))}
            {canRotate && (
              <div className="ov-rotate" data-handle="rotate" title="Drehen (Umschalt: 15°-Schritte)">
                {coarse && <span style={HIT_AREA} />}
              </div>
            )}
            {single?.locked && <span className="ov-lock">Gesperrt</span>}
          </div>
          {angleEl}
          {p.showAdd && single && !hideHandles && !editingId && (
            <>
              {SIDES.map((side) => {
                const q = sidePoint(rectToScreen(cam, objRect(single)), side, ADD_GAP);
                return (
                  <div key={side} className="ov-add" data-handle={`add-${side}`} title="Klicken: neues Objekt · Ziehen: Verbinder" style={{ transform: `translate(${q.x}px, ${q.y}px)` }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                      <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </div>
                );
              })}
            </>
          )}
        </>
      );
    }
  }

  // Hover-Rahmen
  const hover = hoverId ? snap.byId.get(hoverId) : null;
  const hoverRect = hover && !typeDef(hover).derive && !(p.hoverStyle === 'select' && selection.includes(hover.id)) ? rectToScreen(cam, objRect(hover)) : null;

  // Andockpunkte (Verbinder direkt aus dem Objekt ziehen)
  const anchorObj = p.anchorId ? snap.byId.get(p.anchorId) : null;
  const anchors = anchorObj && !hideHandles && anchorObj.id !== editingId ? rectToScreen(cam, objRect(anchorObj)) : null;

  // Titel von Rahmen (Container-Typen) in Bildschirmgröße; weit herausgezoomt übernimmt der große Titel in der Mitte
  const frameTitles: React.ReactNode[] = [];
  const far = cam.z < FAR_ZOOM;
  for (const f of snap.ordered) {
    if (!isBelow(f)) break; // Rahmen liegen vorne in der Reihenfolge
    if (!typeDef(f).container || (far && f.id !== editingId)) continue;
    const r = rectToScreen(cam, f);
    if (r.w < 48 || r.x > width || r.y > height + 30 || r.x + r.w < 0 || r.y + r.h < -30) continue;
    // Titel schrumpft beim Herauszoomen leicht mit (10–14 px), bleibt aber lesbar
    const fs = Math.max(10, Math.min(14, 14 * cam.z * 1.5));
    const style: CSSProperties = {
      transform: `translate(${r.x}px, ${r.y - fs * 1.6 - 3}px)`,
      maxWidth: Math.max(48, r.w),
      fontSize: fs,
      height: fs * 1.6,
      lineHeight: `${fs * 1.6}px`,
    };
    frameTitles.push(
      f.id === editingId ? (
        <FrameTitleInput key={f.id} id={f.id} initial={f.title ?? ''} append={p.titleAppend} cb={editCb} style={style} />
      ) : (
        <div key={f.id} className={`ov-frame-title${selection.includes(f.id) ? ' is-selected' : ''}`} data-id={f.id} data-frame-title style={style}>
          {f.title || 'Rahmen'}
        </div>
      ),
    );
  }

  // Beschriftung bearbeiten (Verbinder)
  let labelEl: React.ReactNode = null;
  if (editing && typeDef(editing).edit === 'label') {
    const r = boundsOf(editing, snap);
    const d = typeDef(editing).derive?.(editing, (id) => snap.byId.get(id));
    const mid = (d?.data as { mid?: Point } | undefined)?.mid ?? (r ? center(r) : null);
    if (mid) {
      const T = textEngine();
      labelEl = <T.LabelEdit key={editing.id} o={editing} at={worldToScreen(cam, mid)} cb={editCb} />;
    }
  }

  return (
    <div className="overlay">
      {frameTitles}
      {/* fremde Auswahl */}
      {peers.map((peer) => {
        const r = selectionBounds(peer.selection, snap);
        if (!r) return null;
        const s = rectToScreen(cam, r);
        // Name an der Auswahl (auch wenn der Cursor woanders ist: wer hat das gerade in der Hand?)
        return (
          <div key={`sel-${peer.clientId}`} className="ov-peer-sel" style={{ transform: `translate(${s.x - 3}px, ${s.y - 3}px)`, width: s.w + 6, height: s.h + 6, borderColor: peer.user.color }}>
            <span style={{ background: peer.user.color }}>{peer.user.name}</span>
          </div>
        );
      })}

      {hoverRect &&
        (p.hoverStyle === 'select' ? (
          <div className="ov-hover ov-hover--select" style={{ transform: `translate(${hoverRect.x}px, ${hoverRect.y}px)`, width: hoverRect.w, height: hoverRect.h }} />
        ) : (
          <div className="ov-hover" style={{ transform: `translate(${hoverRect.x - 4}px, ${hoverRect.y - 4}px)`, width: hoverRect.w + 8, height: hoverRect.h + 8 }} />
        ))}

      {selectionEl}

      {anchors &&
        SIDES.map((side) => {
          const q = sidePoint(anchors, side, ANCHOR_GAP);
          return <div key={side} className="ov-anchor" data-handle={`anchor-${side}`} title="Ziehen: Verbinder" style={{ transform: `translate(${q.x}px, ${q.y}px)` }} />;
        })}

      {draft && <DraftView draft={draft} cam={cam} width={width} height={height} />}

      {labelEl}

      {/* Live-Cursor */}
      {peers.map((peer) => {
        if (!peer.cursor) return null;
        const s = worldToScreen(cam, peer.cursor);
        if (s.x < -40 || s.y < -40 || s.x > width + 40 || s.y > height + 40) return null;
        return (
          <div key={`cur-${peer.clientId}`} className="ov-cursor" style={{ transform: `translate(${s.x}px, ${s.y}px)` }}>
            <svg width="22" height="22" viewBox="0 0 22 22">
              <path d="M3 2.5 18 10l-6.6 1.9L8.3 18.6Z" fill={peer.user.color} stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
            <span style={{ background: peer.user.color }}>{peer.user.name}</span>
          </div>
        );
      })}
    </div>
  );
}

function DraftView({ draft, cam, width, height }: { draft: Draft; cam: Camera; width: number; height: number }) {
  if (draft.kind === 'marquee') {
    const s = rectToScreen(cam, draft.rect);
    return <div className="ov-marquee" data-testid="marquee" style={{ transform: `translate(${s.x}px, ${s.y}px)`, width: s.w, height: s.h }} />;
  }
  if (draft.kind === 'guides') return <GuidesView lines={draft.lines} gaps={draft.gaps ?? []} cam={cam} width={width} height={height} />;
  if (draft.kind === 'screen') return <>{draft.node}</>;
  const t = `translate(${cam.x} ${cam.y}) scale(${cam.z})`;
  return (
    <svg className="ov-svg" width={width} height={height}>
      <g transform={t}>
        {draft.kind === 'world' && draft.node}
        {draft.kind === 'shape' && (
          <g transform={`translate(${draft.rect.x} ${draft.rect.y})`}>
            <path
              d={shapePath(draft.shape, draft.rect.w, draft.rect.h, 1)}
              fill="rgba(23,99,181,0.06)"
              stroke="#1763b5"
              strokeWidth={1.5 / cam.z}
              strokeDasharray={`${6 / cam.z} ${4 / cam.z}`}
            />
          </g>
        )}
        {draft.kind === 'frame' && (
          <rect
            x={draft.rect.x}
            y={draft.rect.y}
            width={draft.rect.w}
            height={draft.rect.h}
            fill="rgba(255,255,255,0.7)"
            stroke="#0a0a0a"
            strokeWidth={1.5 / cam.z}
            strokeDasharray={`${6 / cam.z} ${4 / cam.z}`}
          />
        )}
        {draft.kind === 'pen' && (
          <path d={smoothPath(draft.points.flatMap((q) => [q.x, q.y]))} fill="none" stroke={draft.color} strokeWidth={draft.width} strokeLinecap="round" strokeLinejoin="round" />
        )}
        {draft.kind === 'connector' && (
          <>
            <line x1={draft.a.x} y1={draft.a.y} x2={draft.b.x} y2={draft.b.y} stroke="#1763b5" strokeWidth={2 / cam.z} strokeLinecap="round" />
            <polygon points={arrowHead(draft.a, draft.b, 12 / cam.z).map((q) => `${q.x},${q.y}`).join(' ')} fill="#1763b5" />
          </>
        )}
      </g>
    </svg>
  );
}

/** Hilfslinien (1 px pink) und Abstandsmarken in Bildschirmkoordinaten, damit sie bei jedem Zoom fein bleiben. */
function GuidesView({ lines, gaps, cam, width, height }: { lines: Line[]; gaps: GapMark[]; cam: Camera; width: number; height: number }) {
  const S = (q: Point) => worldToScreen(cam, q);
  return (
    <svg className="ov-svg ov-guides" width={width} height={height} data-testid="guides">
      {lines.map((l, i) => {
        const a = S({ x: l.x1, y: l.y1 });
        const b = S({ x: l.x2, y: l.y2 });
        // auf halbe Pixel legen, damit 1 px scharf bleibt
        const snap = (v: number) => Math.round(v) + 0.5;
        return <line key={`l${i}`} x1={snap(a.x)} y1={snap(a.y)} x2={snap(b.x)} y2={snap(b.y)} className="ov-guide" />;
      })}
      {gaps.map((g, i) => {
        const a = S({ x: g.x1, y: g.y1 });
        const b = S({ x: g.x2, y: g.y2 });
        const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
        const t = 4;
        const mid = center({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
        return (
          <g key={`g${i}`} className="ov-gap">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            {horizontal ? (
              <>
                <line x1={a.x} y1={a.y - t} x2={a.x} y2={a.y + t} />
                <line x1={b.x} y1={b.y - t} x2={b.x} y2={b.y + t} />
              </>
            ) : (
              <>
                <line x1={a.x - t} y1={a.y} x2={a.x + t} y2={a.y} />
                <line x1={b.x - t} y1={b.y} x2={b.x + t} y2={b.y} />
              </>
            )}
            <text x={horizontal ? mid.x : mid.x + 8} y={horizontal ? mid.y - 7 : mid.y + 4} textAnchor={horizontal ? 'middle' : 'start'}>
              {g.len}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function FrameTitleInput({ id, initial, append, cb, style }: { id: string; initial: string; append: string | null; cb: EditCallbacks; style: CSSProperties }) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (append) {
      // Tippen auf einem ausgewählten Rahmen: Zeichen anhängen statt alles zu ersetzen
      el.value = initial + append;
      el.setSelectionRange(el.value.length, el.value.length);
      cb.onTitleChange(id, el.value);
    } else el.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <input
      ref={ref}
      className="ov-frame-title ov-frame-title--edit"
      style={style}
      defaultValue={initial}
      aria-label="Rahmentitel"
      onChange={(e) => cb.onTitleChange(id, e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') ref.current?.blur();
      }}
      onBlur={() => cb.onEditDone(id, null)}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
