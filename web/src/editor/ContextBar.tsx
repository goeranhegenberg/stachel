// Kontextuelle Leiste über der Auswahl. Inhalt kommt aus dem Register (defineContextAction),
// die Leiste selbst kümmert sich nur um Position, Überlauf („···“) und Popover.
import { Fragment, useLayoutEffect, useRef, useState, type MouseEvent as RMouseEvent, type ReactNode } from 'react';
import type { BoardObject } from '../protocol';
import type { Rect } from '../board/geometry';
import type { Patch } from '../board/store';
import { contextActions } from './ext/registry';
import type { CtxInfo, CtxProps, EditorApi } from './ext/types';

type Pop = { key: string; left?: number; right?: number };

export function PopBtn({ open, onToggle, label, children, active }: { open: boolean; onToggle: (e: RMouseEvent<HTMLButtonElement>) => void; label: string; children: ReactNode; active?: boolean }) {
  return (
    <button className={`ctx-btn${active ? ' is-active' : ''}`} aria-label={label} title={label} aria-expanded={open} aria-haspopup="true" onClick={onToggle}>
      {children}
    </button>
  );
}

export function Toggle({ label, on, onClick, children }: { label: string; on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`ctx-btn${on ? ' is-active' : ''}`} aria-label={label} title={label} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

function MoreIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5.5" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.8" fill="currentColor" />
    </svg>
  );
}

interface Props {
  selected: BoardObject[];
  anchor: Rect; // Bildschirmrechteck der Auswahl
  viewWidth: number;
  api: EditorApi;
}

/** Abstände der schwebenden Leiste: unter der Kopfleiste, über den unteren Leisten (Rückgängig, Zoom, Werkzeuge quer). */
const TOP_FREE = 70;
const BOTTOM_FREE = 72;
/** Breite des Knopfs „···“ samt Trennstrich und Abstand */
const MORE_W = 50;

/** Gemessene Lage der Umgebung (aus dem DOM, weil Werkzeugleiste und Safe-Area per CSS liegen). */
type Frame = { barW: number; barH: number; viewH: number; leftMin: number; avail: number; brLeft: number; brTop: number };

/** Wie viele Einträge passen in die Leiste? Der Rest kommt hinter „···“. */
export function fitCount(widths: readonly number[], avail: number, moreW = MORE_W): number {
  const total = widths.reduce((s, w) => s + w, 0);
  if (total <= avail) return widths.length;
  let sum = 0;
  for (let i = 0; i < widths.length; i++) {
    if (sum + widths[i] + moreW > avail) return i;
    sum += widths[i];
  }
  return widths.length;
}

/**
 * Über oder unter der Auswahl – dort, wo die Leiste am wenigsten verdeckt: nie die Auswahl selbst,
 * möglichst keine Nachbarobjekte (z. B. Mindmap-Knoten, auf die man sonst daneben tippt). Bei Gleichstand oben.
 */
function bestTop(api: EditorApi, selected: readonly BoardObject[], anchor: Rect, left: number, w: number, h: number, tops: number[]): number {
  const ids = new Set(selected.map((o) => o.id));
  const cost = (t: number) => {
    // die Auswahl (samt Griffen) zu verdecken ist am schlimmsten
    const hitsSel = t < anchor.y + anchor.h && t + h > anchor.y;
    const a = api.toWorld({ x: left, y: t });
    const b = api.toWorld({ x: left + w, y: t + h });
    const r = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    // Objekte, die die Leiste ganz umschließen (Rahmen, große Flächen), zählen nicht: daneben bleibt Platz zum Klicken
    const others = api.queryRect(r).filter((o) => !ids.has(o.id) && !(o.x <= r.x && o.y <= r.y && o.x + o.w >= r.x + r.w && o.y + o.h >= r.y + r.h)).length;
    return (hitsSel ? 1000 : 0) + others;
  };
  let best = tops[0];
  let min = cost(best);
  for (const t of tops.slice(1)) {
    const c = cost(t);
    if (c < min) [best, min] = [t, c];
  }
  return best;
}

export function ContextBar({ selected, anchor, viewWidth, api }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Frame>({ barW: 300, barH: 46, viewH: 0, leftMin: 8, avail: Infinity, brLeft: Infinity, brTop: Infinity });
  const [pop, setPop] = useState<Pop | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const widths = useRef(new Map<string, number>());
  const selKey = selected.map((o) => o.id).join(',');
  // Anzahl der Einträge in der Leiste je Auswahl; neue Auswahl zeigt erst alle (zum Messen), der Rest kommt ins Menü „···“
  const [cut, setCut] = useState<{ key: string; n: number } | null>(null);
  useLayoutEffect(() => {
    setPop(null);
    setMoreOpen(false);
  }, [selKey]);

  const info: CtxInfo = {
    selected,
    types: new Set(selected.map((o) => o.type)),
    first: selected[0],
    single: selected.length === 1 ? selected[0] : null,
    locked: selected.every((o) => o.locked),
  };
  const actions = contextActions.list().filter((a) => a.when(info));
  const shownCount = cut?.key === selKey ? Math.min(cut.n, actions.length) : actions.length;
  const inline = actions.slice(0, shownCount);
  const overflow = actions.slice(shownCount);
  const docked = viewWidth < 700;

  // Breiten der Einträge messen (je Eintrag die Gruppen zwischen zwei Markierungen), Umgebung messen, Überlauf bestimmen
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const sums = new Map<string, number>();
    let id: string | null = null;
    for (const el of bar.children) {
      const mark = (el as HTMLElement).dataset.ctx;
      if (mark) {
        id = mark;
        sums.set(id, 0);
      } else if (id && !el.classList.contains('ctx-pop') && !el.classList.contains('ctxbar__more')) sums.set(id, sums.get(id)! + el.getBoundingClientRect().width + 2);
    }
    for (const [k, w] of sums) widths.current.set(k, w);

    const editor = bar.parentElement;
    const viewH = editor?.clientHeight ?? innerHeight;
    // senkrechte Werkzeugleiste links nicht verdecken (x-canvas)
    let leftMin = 8;
    const e = editor?.getBoundingClientRect();
    const tb = editor?.querySelector('.toolbar');
    if (tb && e && !docked) {
      const r = tb.getBoundingClientRect();
      if (r.height > r.width && r.width > 0) leftMin = r.right - e.left + 8;
    }
    // Übersichtskarte und Zoom unten rechts
    const br = editor?.querySelector('.bottom-right')?.getBoundingClientRect();
    const brLeft = br && e && br.width ? br.left - e.left : Infinity;
    const brTop = br && e && br.width ? br.top - e.top : Infinity;
    const cs = getComputedStyle(bar);
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const maxW = docked ? parseFloat(cs.maxWidth) || viewWidth - 20 : viewWidth - leftMin - 8;
    const avail = maxW - pad;
    const next = fitCount(
      actions.map((a) => widths.current.get(a.id) ?? 0),
      avail,
    );
    if (next !== shownCount) setCut({ key: selKey, n: next });
    const f: Frame = { barW: bar.offsetWidth, barH: bar.offsetHeight, viewH, leftMin, avail, brLeft, brTop };
    if ((Object.keys(f) as (keyof Frame)[]).some((k) => f[k] !== frame[k])) setFrame(f);
  });

  // Popover nie aus dem Bildschirm ragen lassen (Handy: angedockte Leiste, breite Popover am Rand, niedrige Fenster)
  const popRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = ref.current?.getBoundingClientRect();
    if (!bar) return;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    // Kachel-Namen im Menü „···“ ohne Tastenkürzel („Fett (Strg B)“ → „Fett“)
    for (const b of moreRef.current?.querySelectorAll('button[aria-label]') ?? []) b.setAttribute('data-name', b.getAttribute('aria-label')!.replace(/\s*\(.*\)\s*$/, ''));
    for (const el of [popRef.current, moreRef.current]) {
      if (!el) continue;
      for (const k of ['translate', 'top', 'bottom', 'max-height', 'overflow-y'] as const) el.style.removeProperty(k);
      let r = el.getBoundingClientRect();
      // senkrecht: auf die Seite mit mehr Platz klappen, notfalls mit Scrollen
      const down = r.top >= bar.bottom - 1;
      const spaceBelow = vh - 8 - bar.bottom - 10;
      const spaceAbove = bar.top - 8 - 10;
      if (r.bottom > vh - 8 || r.top < 8) {
        const flip = down ? spaceAbove > spaceBelow : spaceBelow > spaceAbove;
        if (flip) {
          el.style.top = down ? 'auto' : 'calc(100% + 10px)';
          el.style.bottom = down ? 'calc(100% + 10px)' : 'auto';
        }
        r = el.getBoundingClientRect();
        if (r.bottom > vh - 8 || r.top < 8) {
          el.style.maxHeight = `${Math.max(80, down !== flip ? spaceBelow : spaceAbove)}px`;
          el.style.overflowY = 'auto';
          r = el.getBoundingClientRect();
        }
      }
      const shift = r.left < 8 ? 8 - r.left : r.right > vw - 8 ? Math.max(8 - r.left, vw - 8 - r.right) : 0;
      // translate statt margin: bei rechtsbündigem Popover (left: auto) wirkt margin-left nicht
      if (shift) el.style.translate = `${shift}px 0`;
    }
  });

  // Schwebend: über (sonst unter) der Auswahl, waagerecht und senkrecht im freien Bereich
  const { barW, barH, viewH, leftMin, brLeft, brTop } = frame;
  const left = Math.max(leftMin, Math.min(anchor.x + anchor.w / 2 - barW / 2, viewWidth - barW - 8));
  // unten: über Rückgängig/Werkzeugen, und über der Übersichtskarte, wenn die Leiste bis dorthin reicht
  const bottom = viewH ? Math.min(viewH - BOTTOM_FREE, left + barW > brLeft ? brTop - 8 : Infinity) : Infinity;
  const clampTop = (t: number) => Math.max(TOP_FREE, Math.min(t, bottom - barH));
  const top = docked ? 0 : bestTop(api, selected, anchor, left, barW, barH, [anchor.y - 60, anchor.y + anchor.h + 16].map(clampTop));

  /** Popover unter (bzw. am Handy über) dem Knopf öffnen, rechtsbündig in der rechten Hälfte. */
  const togglePop = (key: string) => (e: RMouseEvent<HTMLButtonElement>) => {
    if (pop?.key === key) return setPop(null);
    const b = e.currentTarget.getBoundingClientRect();
    const r = ref.current!.getBoundingClientRect();
    const l = Math.max(0, Math.min(b.left - r.left, r.width - b.width));
    // aus dem Menü „···“ heraus: das Popover ersetzt das Menü
    setMoreOpen(false);
    setPop(l > r.width / 2 ? { key, right: Math.max(0, r.right - b.right) } : { key, left: l });
  };
  const popStyle = pop ? (pop.right !== undefined ? { left: 'auto', right: pop.right } : { left: pop.left }) : undefined;

  const patch = (fn: (o: BoardObject) => Patch | null) => api.patchSelection(fn);
  const props: CtxProps = {
    ...info,
    api,
    patch,
    choose: (fn) => {
      patch(fn);
      setPop(null);
    },
    pop: pop?.key ?? null,
    togglePop,
    closePop: () => setPop(null),
  };
  const open = pop ? actions.find((a) => a.pops?.[pop.key]) : undefined;
  const openPop = open && pop ? open.pops![pop.key] : undefined;

  return (
    <div
      ref={ref}
      className={`ctxbar panel${docked ? ' ctxbar--docked' : ''}`}
      role="toolbar"
      aria-label="Auswahl bearbeiten"
      style={docked ? undefined : { transform: `translate(${left}px, ${top}px)` }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {inline.map((a) => (
        <Fragment key={a.id}>
          {/* Markierung: ab hier gehören die Gruppen zu diesem Eintrag (zum Messen) */}
          <i className="ctxbar__mark" data-ctx={a.id} hidden />
          <a.Bar {...props} />
        </Fragment>
      ))}
      {overflow.length > 0 && (
        <button
          className={`ctx-btn ctxbar__more${moreOpen ? ' is-active' : ''}`}
          aria-label="Weitere Aktionen"
          title="Weitere Aktionen"
          aria-haspopup="true"
          aria-expanded={moreOpen}
          onClick={() => {
            setPop(null);
            setMoreOpen((v) => !v);
          }}
        >
          <MoreIcon />
        </button>
      )}
      {moreOpen && overflow.length > 0 && (
        <div className="ctx-pop ctxbar__morepop panel" role="group" aria-label="Weitere Aktionen" ref={moreRef}>
          {overflow.map((a) => (
            <Fragment key={a.id}>
              <a.Bar {...props} />
            </Fragment>
          ))}
        </div>
      )}
      {/* Popover (außerhalb der Gruppen, damit am Handy nichts abgeschnitten wird) */}
      {openPop && (
        <div className={['ctx-pop', openPop.className, 'panel'].filter(Boolean).join(' ')} role="group" aria-label={openPop.label} style={popStyle} ref={popRef}>
          <openPop.Body {...props} />
        </div>
      )}
    </div>
  );
}
