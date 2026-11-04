// Zeitleiste: Datumsachse (Tag/Woche/Monat), Spuren mit Namen, Einträge als Balken
// oder Meilenstein. Bedienung: Eintrag ziehen (Spur wechseln), Enden ziehen, in eine Spur doppelklicken bzw. aufziehen,
// Titel inline schreiben; Ränder des Objekts ändern den Zeitraum, Ecken skalieren. Daten: ./yjs.ts, Vertrag:
// docs/features/timeline.md.
import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import type { BoardObject } from '../../../protocol';
import { textOn } from '../../../board/colors';
import { placeStyle } from '../../../editor/render/format';
import { defineObjectType } from '../../../editor/ext/registry';
import type { EditCallbacks, ObjectViewProps } from '../../../editor/ext/types';
import { editorApi } from '../bridge';
import { bindField } from '../ytext';
import {
  BAR_H,
  DEFAULT_ITEM_COLOR,
  DIAMOND,
  HEAD_H,
  HEAD_TOP,
  LABEL_W,
  layoutFor,
  layoutOf,
  hitLocal,
  NEW_LEN,
  resizeRange,
  safeTimeline,
  scaleOf,
  sizeFor,
  spanLabel,
  ticks,
  timelineText,
  todayNum,
  weekday,
  fmtDay,
  extendRange,
  type Layout,
} from './model';
import { activeItem, draftOf, editOf, focusOf, recentDown, recordDown, setEdit, setFocus, useTimelineState, type EditTarget, type Focus } from './state';
import { createAndEdit, dragItem, dragLane, drawItem, localAt } from './gestures';
import { laneNameSource, setRange, titleSource } from './yjs';
import { newTimeline } from './create';
import './timeline.css';

/** Langes Drücken auf einen Eintrag (Touch) bzw. „Bearbeiten …“: Dialog */
export const ITEM_MODAL = 'structure.timelineItem';

export { newTimeline };

/** Beim Tippen auf eine ausgewählte Zeitleiste: Zeichen für den Titel des aktiven Eintrags */
const typed = new Map<string, string>();

// ---- Ansicht --------------------------------------------------------------------------------------------------------

function TimelineView({ o, editing, selected, far, cb }: ObjectViewProps) {
  useTimelineState();
  const L = useMemo(() => layoutFor(o), [o]);
  const kx = o.w / L.W0;
  const ky = o.h / L.H0;
  const focus = selected || editing ? focusOf(o.id) : null;
  const draft = draftOf(o.id);
  const edit = editing ? editOf(o.id) : null;
  const today = todayNum();
  const T = useMemo(() => ticks(L, L.unit, today), [L, today]);
  const gridW = L.days * L.dayPx;
  const dp = L.dayPx;

  // ausgewählt → abgewählt: aktiven Eintrag vergessen
  useLayoutEffect(() => {
    if (!selected && !editing) setFocus(o.id, null);
  }, [selected, editing, o.id]);

  // Bearbeitung beginnt (Doppelklick, Enter, Tippen): was bearbeiten?
  useLayoutEffect(() => {
    if (!editing) {
      setEdit(o.id, null);
      return;
    }
    if (editOf(o.id)) return;
    const api = editorApi();
    const target = api ? editTargetFor(o, L, api) : null;
    if (target) setEdit(o.id, target);
    else cb.onEditDone(o.id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, o.id]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const api = editorApi();
    const cur = api?.store.get(o.id) ?? o;
    const Lc = layoutFor(cur);
    const p = localAt(o.id, Lc, e.clientX, e.clientY);
    const hit = p ? hitLocal(Lc, p.lx, p.ly) : null;
    recordDown(o.id, hit);
    const target = e.target as HTMLElement;
    if (!api || !hit || e.button !== 0 || api.tool() !== 'select' || cur.locked || api.presenting() || target.closest('[data-tl-btn]')) return;
    const isSel = api.selection().length === 1 && api.selection()[0] === o.id;
    const touch = e.pointerType === 'touch';
    // Auswahl neu setzen (gleicher Inhalt): der Editor zeichnet neu und die Kontextleiste misst ihre Einträge neu
    const focusOn = (f: Focus) => {
      setFocus(o.id, f);
      if (isSel) api.setSelection([o.id]);
    };
    if (hit.kind === 'item') {
      focusOn({ kind: 'item', id: hit.id });
      // Touch auf nicht ausgewählter Zeitleiste: der Editor schwenkt bzw. wählt aus (Tippen)
      if (touch && !isSel) return;
      e.stopPropagation();
      blurEditable();
      if (!isSel) api.setSelection([o.id]);
      const grip = (target.closest('[data-tl-grip]') as HTMLElement | null)?.dataset.tlGrip as 'start' | 'end' | undefined;
      dragItem(e, o.id, hit.id, grip ?? 'move', { onLongPress: touch ? () => api.openModal(ITEM_MODAL, { id: o.id, key: hit.id }) : undefined });
      return;
    }
    if (hit.kind === 'label') {
      focusOn({ kind: 'lane', id: hit.lane });
      if (isSel && target.closest('[data-tl-lanegrip]')) {
        e.stopPropagation();
        dragLane(e, o.id, hit.lane);
      }
      return;
    }
    if (hit.kind === 'lane') {
      focusOn({ kind: 'lane', id: hit.lane });
      // ausgewählt: in der Spur aufziehen legt einen Eintrag an (Maus/Stift; am Handy verschiebt der Finger)
      if (isSel && !touch) {
        e.stopPropagation();
        blurEditable();
        drawItem(e, o.id, hit.lane, hit.day);
      }
    }
  };

  const months = L.unit === 'month' ? T.bottom : T.top;
  const todayX = today >= L.start && today <= L.end ? LABEL_W + (today - L.start + 0.5) * dp : null;
  const w0 = weekday(L.start);
  // Wochenenden (Tag/Woche) als Hintergrund-Kachel je Woche, Tageslinien (Tag) bzw. Wochenlinien (Woche)
  const gridBg: CSSProperties =
    L.unit === 'month'
      ? {}
      : {
          backgroundImage: [
            'linear-gradient(90deg, var(--tl-line) 1px, transparent 1px)',
            `linear-gradient(90deg, transparent ${5 * dp}px, var(--tl-weekend) ${5 * dp}px)`,
          ].join(', '),
          backgroundSize: `${L.unit === 'day' ? dp : 7 * dp}px 100%, ${7 * dp}px 100%`,
          backgroundPosition: `${L.unit === 'day' ? 0 : -w0 * dp}px 0, ${-w0 * dp}px 0`,
        };

  return (
    <div
      className={`obj structure-tl${selected ? ' is-selected' : ''}${far ? ' is-far' : ''}${o.locked ? ' is-locked' : ''}`}
      data-id={o.id}
      data-type="timeline"
      style={placeStyle(o)}
      onPointerDown={onPointerDown}
    >
      <div className="structure-tl__inner" style={{ width: L.W0, height: L.H0, transform: `scale(${kx}, ${ky})` }}>
        {/* Spuren: Hintergrund und Namen */}
        {L.lanes.map((l, i) => (
          <div key={l.id} className={`structure-tl__lane${i % 2 ? ' is-odd' : ''}${focus?.kind === 'lane' && focus.id === l.id ? ' is-focus' : ''}`} style={{ top: l.y, height: l.h }} data-tl-lane={l.id} />
        ))}
        <div className="structure-tl__grid" style={{ left: LABEL_W, top: HEAD_H, width: gridW, height: L.H0 - HEAD_H, ...gridBg }} />
        {months.slice(1).map((t) => (
          <div key={`m${t.x}`} className="structure-tl__mline" style={{ left: LABEL_W + t.x, top: HEAD_TOP, height: L.H0 - HEAD_TOP }} />
        ))}
        {L.lanes.map((l) => (
          <div key={l.id} className="structure-tl__label" style={{ top: l.y, height: l.h }} data-tl-label={l.id}>
            {selected && !o.locked && L.lanes.length > 1 && (
              <span className="structure-tl__lanegrip" data-tl-lanegrip aria-label="Spur verschieben" title="Ziehen: Spur verschieben">
                ⋮⋮
              </span>
            )}
            <span className={`structure-tl__lanename${l.name ? '' : ' is-empty'}`}>{l.name || 'Ohne Namen'}</span>
          </div>
        ))}
        {/* Kopf */}
        <div className="structure-tl__head" style={{ height: HEAD_H, width: L.W0 }}>
          <div className="structure-tl__corner" style={{ width: LABEL_W, height: HEAD_H }}>
            {!far && <span>{L.unit === 'day' ? 'Tage' : L.unit === 'week' ? 'Wochen' : 'Monate'}</span>}
          </div>
          {T.top.map((t) => (
            <div key={`t${t.x}`} className="structure-tl__top" style={{ left: LABEL_W + t.x, width: t.w, height: HEAD_TOP }}>
              {!far && t.w >= 30 && <span>{t.label}</span>}
            </div>
          ))}
          {T.bottom.map((t) => (
            <div
              key={`b${t.x}`}
              className={`structure-tl__tick${t.weekend ? ' is-weekend' : ''}${t.today ? ' is-today' : ''}`}
              style={{ left: LABEL_W + t.x, width: t.w, top: HEAD_TOP, height: HEAD_H - HEAD_TOP }}
            >
              {!far && (
                <>
                  {t.sub && L.unit === 'day' && <small>{t.sub}</small>}
                  <span>{t.label}</span>
                  {t.sub && L.unit === 'week' && t.w >= 70 && <small>{t.sub}</small>}
                </>
              )}
            </div>
          ))}
          {L.before > 0 && <OutsideBtn o={o} side="before" n={L.before} />}
          {L.after > 0 && <OutsideBtn o={o} side="after" n={L.after} />}
        </div>
        {todayX !== null && <div className="structure-tl__today" style={{ left: todayX, top: HEAD_TOP, height: L.H0 - HEAD_TOP }} aria-hidden="true" />}
        {/* Einträge */}
        {L.items.map((b) => {
          const color = b.it.color ?? DEFAULT_ITEM_COLOR;
          const act = focus?.kind === 'item' && focus.id === b.id;
          const isEdit = edit?.kind === 'item' && edit.id === b.id;
          const style = { left: b.x, top: b.y, width: b.w, height: b.h, '--c': color, '--ink': textOn(color) } as CSSProperties;
          const label = `${b.it.title || 'Ohne Titel'}, ${spanLabel(b.a, b.b)}`;
          if (b.it.ms)
            return (
              <div key={b.id} className={`structure-tl__ms${act ? ' is-active' : ''}${isEdit ? ' is-editing' : ''}`} style={style} data-tl-item={b.id} aria-label={`Meilenstein ${label}`}>
                <span className="structure-tl__diamond" style={{ width: DIAMOND, height: DIAMOND }} />
                {!far && <span className="structure-tl__mstitle">{b.it.title}</span>}
              </div>
            );
          return (
            <div
              key={b.id}
              className={`structure-tl__item${act ? ' is-active' : ''}${isEdit ? ' is-editing' : ''}${b.cutL ? ' is-cut-l' : ''}${b.cutR ? ' is-cut-r' : ''}`}
              style={style}
              data-tl-item={b.id}
              aria-label={label}
              title={label}
            >
              {!far && <span className="structure-tl__title">{b.it.title}</span>}
              {!o.locked && !b.cutL && <span className="structure-tl__grip structure-tl__grip--start" data-tl-grip="start" />}
              {!o.locked && !b.cutR && <span className="structure-tl__grip structure-tl__grip--end" data-tl-grip="end" />}
            </div>
          );
        })}
        {draft?.kind === 'new' && <NewDraft L={L} lane={draft.lane} a={draft.a} b={draft.b} />}
        {draft?.kind === 'laneMove' && <div className="structure-tl__lanedrop" style={{ top: draft.y - 2, width: L.W0 }} />}
        {edit && <InlineEdit o={o} L={L} target={edit} cb={cb} />}
      </div>
    </div>
  );
}

function blurEditable() {
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) a.blur();
}

/** Was ein Doppelklick bzw. Enter/Tippen bearbeitet; legt beim Doppelklick in eine leere Spur einen Eintrag an. */
function editTargetFor(o: BoardObject, L: Layout, api: NonNullable<ReturnType<typeof editorApi>>): EditTarget | null {
  const ch = typed.get(o.id);
  typed.delete(o.id);
  const hit = ch ? undefined : recentDown(o.id);
  if (hit?.kind === 'item') return { kind: 'item', id: hit.id };
  if (hit?.kind === 'label') return { kind: 'lane', id: hit.lane };
  if (hit?.kind === 'lane') {
    // Doppelklick in eine Spur: neuer Eintrag ab diesem Tag (createAndEdit setzt das Ziel)
    const b = Math.min(L.end, hit.day + NEW_LEN[L.unit] - 1);
    createAndEdit(api, o.id, { lane: hit.lane, start: fmtDay(hit.day), end: fmtDay(b), title: '' });
    return editOf(o.id);
  }
  if (hit) return null;
  // Tastatur: aktiver Eintrag bzw. aktive Spur
  const f = focusOf(o.id);
  if (f?.kind === 'item' && safeTimeline(o.timeline).items[f.id]) return { kind: 'item', id: f.id, typed: ch };
  if (f?.kind === 'lane' && !ch) return { kind: 'lane', id: f.id };
  return null;
}

function NewDraft({ L, lane, a, b }: { L: Layout; lane: string; a: number; b: number }) {
  const l = L.lanes.find((x) => x.id === lane);
  if (!l) return null;
  return <div className="structure-tl__draft" style={{ left: LABEL_W + (a - L.start) * L.dayPx, top: l.y + 10, width: (b - a + 1) * L.dayPx, height: BAR_H }} />;
}

/** Hinweis auf Einträge außerhalb des Zeitraums; Klick erweitert den Zeitraum bis dorthin. */
function OutsideBtn({ o, side, n }: { o: BoardObject; side: 'before' | 'after'; n: number }) {
  const label = `${n} ${n === 1 ? 'Eintrag' : 'Einträge'} ${side === 'before' ? 'davor' : 'danach'} – Zeitraum erweitern`;
  return (
    <button
      className={`structure-tl__outside structure-tl__outside--${side}`}
      style={side === 'before' ? { left: LABEL_W + 4, top: HEAD_TOP + 4 } : { right: 4, top: HEAD_TOP + 4 }}
      data-tl-btn
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        const api = editorApi();
        if (!api || o.locked) return;
        api.store.stopCapturing();
        setRange(api.store, o.id, extendRange(o, side));
        api.store.stopCapturing();
      }}
    >
      {side === 'before' ? `‹ ${n}` : `${n} ›`}
    </button>
  );
}

/** Titel eines Eintrags bzw. Spurname direkt in der Zeitleiste schreiben (live, Y.Text). */
function InlineEdit({ o, L, target, cb }: { o: BoardObject; L: Layout; target: EditTarget; cb: EditCallbacks }) {
  const ref = useRef<HTMLInputElement>(null);
  const box = target.kind === 'item' ? L.items.find((b) => b.id === target.id) : null;
  const lane = target.kind === 'lane' ? L.lanes.find((l) => l.id === target.id) : null;
  const gone = !box && !lane;
  useLayoutEffect(() => {
    const el = ref.current;
    const api = editorApi();
    if (gone) {
      cb.onEditDone(o.id, null);
      return;
    }
    if (!el || !api) return;
    const src = target.kind === 'item' ? titleSource(api.store, o.id, target.id) : laneNameSource(api.store, o.id, target.id);
    if (target.kind === 'item' && target.typed) src.write({ index: src.read().length, del: 0, ins: target.typed });
    const off = bindField(el, src, api.store.subscribe);
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.id, target.kind, target.id, gone]);
  if (gone) return null;
  const style: CSSProperties = box
    ? box.it.ms
      ? { left: box.x + DIAMOND + 2, top: box.y, width: Math.max(160, box.w - DIAMOND), height: box.h }
      : { left: box.x, top: box.y, width: Math.max(box.w, 120), height: box.h }
    : { left: 0, top: lane!.y + lane!.h / 2 - 16, width: LABEL_W, height: 32 };
  return (
    <input
      ref={ref}
      className={`structure-tl__edit${target.kind === 'lane' ? ' is-lane' : ''}`}
      style={style}
      aria-label={target.kind === 'item' ? 'Titel des Eintrags' : 'Name der Spur'}
      placeholder={target.kind === 'item' ? 'Titel' : 'Name der Spur'}
      spellCheck
      maxLength={200}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
      onBlur={(e) => cb.onEditDone(o.id, e.currentTarget.closest('.obj'))}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}

// ---- Objekttyp -------------------------------------------------------------------------------------------------------

defineObjectType({
  type: 'timeline',
  label: 'Zeitleiste',
  View: TimelineView,
  simpleStyle: () => ({ background: '#fff', boxShadow: 'inset 0 18px 0 #0a0a0a, inset 0 0 0 2px #d9d9d3', borderRadius: 8 }),
  defaultSize: { w: 1176, h: 220 },
  create: (p) => newTimeline(p),
  edit: 'text',
  // Tippen auf die ausgewählte Zeitleiste: Zeichen in den Titel des aktiven Eintrags statt ins Feld `text`
  adjustPatch: (o, p) => {
    if (!('text' in p)) return p;
    if (activeItem(o.id)) typed.set(o.id, (typed.get(o.id) ?? '') + (p.text ?? '').slice((o.text ?? '').length));
    const { text: _t, ...rest } = p;
    return rest;
  },
  onEditDone: (o, api) => {
    setEdit(o.id, null);
    if (o.text !== undefined || o.content !== undefined) api.store.update(o.id, { text: undefined, content: undefined });
  },
  colorable: false,
  anchorable: true,
  marquee: 'contain',
  handles: () => ['nw', 'ne', 'se', 'sw', 'e', 'w'],
  keepAspect: 'corner',
  // Seitengriffe: Zeitraum erweitern/verkürzen (Tagesbreite bleibt); Ecken: alles skalieren
  resize: (o, base, ctx) => {
    if (ctx.widthOnly || (ctx.to.h === ctx.from.h && ctx.to.w !== ctx.from.w)) {
      const L = layoutFor(o);
      const k = scaleOf(o, L);
      const west = Math.abs(ctx.to.x - ctx.from.x) > 0.5;
      const r = resizeRange(L, k, L.unit, base.w ?? o.w, west);
      const L2 = layoutOf(safeTimeline(o.timeline), r, L.unit);
      const size = sizeFor(k, L2);
      return { x: west ? Math.round(o.x + o.w - size.w) : o.x, y: o.y, ...size, tlStart: fmtDay(r.start), tlEnd: fmtDay(r.end) };
    }
    return base;
  },
  plainText: (o) => timelineText(safeTimeline(o.timeline)),
});
