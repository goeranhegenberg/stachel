// Suche auf dem Board (Strg F): Treffer in Lesereihenfolge, hervorgehoben; Enter/Umschalt+Enter springen.
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { BoardObject } from '../../protocol';
import { expand, rectToScreen, type Rect } from '../../board/geometry';
import { plainTextOf } from '../../board/types';
import { findMatch } from '../../ui/search';
import { IconClose, IconSearch } from '../../ui/icons';
import { typeDef } from '../../editor/ext/registry';
import type { EditorApi, SlotProps } from '../../editor/ext/types';
import { usePrefs } from './prefs';
import { IconArrowDown, IconArrowUp, IconReplace } from './icons';
import { useBoardRole } from '../sharing/role';
import { REPLACE_MAX_LEN, replaceCount, replaceInStore, replacePreview, replaceToast } from './replace';

interface SearchState {
  open: boolean;
  query: string;
  /** aktueller Treffer (Index in der Trefferliste) */
  index: number;
  /** wird bei jedem Öffnen erhöht → Eingabefeld fokussieren */
  focus: number;
  /** Zeile „Ersetzen durch“ offen (Q3) */
  replaceOpen: boolean;
  replacement: string;
}

let state: SearchState = { open: false, query: '', index: 0, focus: 0, replaceOpen: false, replacement: '' };
const listeners = new Set<() => void>();
const set = (patch: Partial<SearchState>) => {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const useSearch = () => useSyncExternalStore(subscribe, () => state);

export const openSearch = () => set({ open: true, focus: state.focus + 1 });
/** Suchen & Ersetzen öffnen (Board-Menü, Befehlspalette). */
export const openReplace = () => set({ open: true, replaceOpen: true, focus: state.focus + 1 });
export const closeSearch = () => set({ open: false });

/**
 * Durchsuchbarer Text eines Objekts: Klartext-Spiegel bzw. Rahmentitel, dazu Tags von Notizen und Karten
 * und die zuständige Person einer Karte.
 */
export const searchText = (o: BoardObject): string => {
  const parts = [plainTextOf(o) ?? ''];
  if (Array.isArray(o.tags)) for (const t of o.tags) if (t && typeof t.label === 'string') parts.push(t.label);
  if (o.assignee && typeof o.assignee.name === 'string') parts.push(o.assignee.name);
  return parts.filter(Boolean).join('\n');
};

export interface Hit {
  o: BoardObject;
  r: Rect;
}

/** Treffer in Lesereihenfolge (oben nach unten, in einer Zeile links nach rechts). */
export function findHits(objects: readonly BoardObject[], query: string, bounds: (o: BoardObject) => Rect | null, includeHidden = false): Hit[] {
  if (!query.trim()) return [];
  const out: Hit[] = [];
  for (const o of objects) {
    if (o.hidden && !includeHidden) continue;
    const text = searchText(o);
    if (!text || !findMatch(text, query)) continue;
    const r = bounds(o);
    if (r) out.push({ o, r });
  }
  return readingOrder(out);
}

/** Zeilen von oben nach unten (gleiche Zeile, wenn die Oberkante in der oberen Hälfte des Zeilenanfangs liegt), darin links nach rechts. */
export function readingOrder<T extends { r: Rect }>(items: T[]): T[] {
  const rows: T[][] = [];
  for (const it of [...items].sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x)) {
    const row = rows[rows.length - 1];
    if (row && it.r.y < row[0].r.y + Math.min(row[0].r.h, it.r.h) / 2) row.push(it);
    else rows.push([it]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.r.x - b.r.x));
}

/** Kamera zum Treffer: nur bewegen, wenn er nicht gut sichtbar ist; zu klein → heranzoomen. */
function reveal(api: EditorApi, r: Rect) {
  const cam = api.camera();
  const v = api.viewSize();
  const s = rectToScreen(cam, r);
  const margin = 72;
  const inView = s.x >= margin && s.y >= margin + 48 && s.x + s.w <= v.w - margin && s.y + s.h <= v.h - margin;
  const readable = Math.max(s.w, s.h) >= 60;
  if (inView && readable) return;
  if (readable && s.w < v.w * 0.7 && s.h < v.h * 0.6) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    api.animateCamera({ z: cam.z, x: v.w / 2 - cx * cam.z, y: v.h / 2 - cy * cam.z });
  } else api.fitTo(expand(r, Math.max(r.w, r.h) * 0.6), 1.25);
}

function focusBoard() {
  (document.querySelector('[data-testid="board"]') as HTMLElement | null)?.focus({ preventScroll: true });
}

/** Vorschau „3 Stellen in 2 Objekten“ (+ gesperrte). */
export function replacePreviewText(p: { total: number; objects: number; locked: number }): string {
  if (!p.total && !p.locked) return 'Keine Stelle zum Ersetzen';
  const main = `${p.total === 1 ? '1 Stelle' : `${p.total} Stellen`} in ${p.objects === 1 ? '1 Objekt' : `${p.objects} Objekten`}`;
  return p.locked ? `${main}, ${p.locked} gesperrt` : main;
}

export function SearchBar({ api, snap, cam, width, height }: SlotProps) {
  const s = useSearch();
  const prefs = usePrefs();
  const { role } = useBoardRole(api);
  // Ersetzen nur mit Schreibrecht (wie der Server: Ansehen/Kommentieren dürfen keine Objekte ändern)
  const canReplace = role !== 'view' && role !== 'comment' && !api.presenting();
  const replaceRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => (s.open ? findHits(snap.ordered, s.query, (o) => api.bounds(o), prefs.showHidden) : []), [s.open, s.query, snap, api, prefs.showHidden]);
  const index = hits.length ? Math.min(s.index, hits.length - 1) : 0;
  const current = hits[index];
  const replacing = s.replaceOpen && canReplace;
  const preview = useMemo(() => (replacing ? replacePreview(hits.map((h) => h.o), s.query) : null), [replacing, hits, s.query]);

  useLayoutEffect(() => {
    if (!s.open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [s.open, s.focus]);

  // zum aktuellen Treffer fahren (bei neuer Anfrage bzw. neuem Index)
  const lastShown = useRef<string | null>(null);
  useEffect(() => {
    if (!s.open || !current) {
      lastShown.current = null;
      return;
    }
    const key = `${s.query}|${current.o.id}`;
    if (lastShown.current === key) return;
    lastShown.current = key;
    reveal(api, current.r);
  }, [s.open, s.query, current, api]);

  if (!s.open) return null;

  const go = (d: number) => {
    if (!hits.length) return;
    set({ index: (index + d + hits.length) % hits.length });
  };
  const close = () => {
    closeSearch();
    focusBoard();
  };
  const label = !s.query.trim() ? '' : hits.length ? `${index + 1} von ${hits.length}` : 'Keine Treffer';
  /** Ersetzen ab dem aktuellen Treffer (`first`) bzw. in allen Treffern – ein Rückgängig-Schritt. */
  const doReplace = (first: boolean) => {
    if (!hits.length) return;
    const ids = first ? [...hits.slice(index), ...hits.slice(0, index)].map((h) => h.o.id) : hits.map((h) => h.o.id);
    const r = replaceInStore(api.store, ids, s.query, s.replacement, { first, adjust: (o, p) => api.adjustPatch(o, p) });
    if (r.changed.length) api.remeasure(r.changed);
    api.toast(replaceToast(r));
    // „Ersetzen“: weiter zum nächsten Treffer, wenn der aktuelle keine Fundstelle mehr hat
    if (first && r.changed.length) {
      const o = api.store.get(r.changed[0]!);
      if (o && !replaceCount(o, s.query) && hits.length > 1) set({ index: index % Math.max(1, hits.length - 1) });
    }
  };

  return (
    <>
      <div className="tools-search-hits" aria-hidden="true">
        {hits.map((h, i) => {
          const r = rectToScreen(cam, h.r);
          if (r.x > width + 40 || r.y > height + 40 || r.x + r.w < -40 || r.y + r.h < -40) return null;
          return (
            <div
              key={h.o.id}
              className={`tools-search-hit${i === index ? ' is-current' : ''}${typeDef(h.o).container ? ' is-frame' : ''}`}
              data-hit={h.o.id}
              style={{ transform: `translate(${r.x - 5}px, ${r.y - 5}px)`, width: r.w + 10, height: r.h + 10 }}
            />
          );
        })}
      </div>
      <div className="tools-search panel" role="search" aria-label="Auf dem Board suchen" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <IconSearch size={20} className="tools-search__icon" />
        <input
          ref={inputRef}
          className="tools-search__input"
          type="search"
          placeholder="Auf dem Board suchen"
          aria-label="Suchbegriff"
          value={s.query}
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => set({ query: e.target.value, index: 0 })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              go(e.shiftKey ? -1 : 1);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              go(1);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              go(-1);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
              e.preventDefault();
              e.currentTarget.select();
            }
          }}
        />
        <span className="tools-search__count" role="status" aria-live="polite" data-testid="search-count">
          {label}
        </span>
        <span className="tools-search__nav">
          <button className="tools-search__btn" aria-label="Vorheriger Treffer" title="Vorheriger Treffer (Umschalt Enter)" disabled={hits.length < 2} onClick={() => go(-1)}>
            <IconArrowUp size={18} />
          </button>
          <button className="tools-search__btn" aria-label="Nächster Treffer" title="Nächster Treffer (Enter)" disabled={hits.length < 2} onClick={() => go(1)}>
            <IconArrowDown size={18} />
          </button>
        </span>
        {canReplace && (
          <button
            className={`tools-search__btn${s.replaceOpen ? ' is-active' : ''}`}
            aria-label="Ersetzen"
            aria-pressed={s.replaceOpen}
            title="Suchen und ersetzen"
            data-testid="search-replace-toggle"
            onClick={() => {
              set({ replaceOpen: !s.replaceOpen });
              if (!s.replaceOpen) requestAnimationFrame(() => replaceRef.current?.focus());
            }}
          >
            <IconReplace size={18} />
          </button>
        )}
        <button
          className="tools-search__all"
          disabled={!hits.length}
          title="Alle Treffer auswählen"
          onClick={() => {
            api.setSelection(hits.map((h) => h.o.id));
            closeSearch();
            focusBoard();
          }}
        >
          Alle wählen
        </button>
        <button className="tools-search__btn" aria-label="Suche schließen" title="Schließen (Esc)" onClick={close}>
          <IconClose size={18} />
        </button>
      </div>
      {replacing && (
        <div className="tools-replace panel" role="group" aria-label="Ersetzen" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <IconReplace size={18} className="tools-search__icon" />
          <input
            ref={replaceRef}
            className="tools-search__input"
            type="text"
            placeholder="Ersetzen durch"
            aria-label="Ersetzen durch"
            value={s.replacement}
            maxLength={REPLACE_MAX_LEN}
            autoComplete="off"
            spellCheck={false}
            data-testid="replace-input"
            onChange={(e) => set({ replacement: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                doReplace(!(e.ctrlKey || e.metaKey));
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
          />
          <span className="tools-search__count" role="status" aria-live="polite" data-testid="replace-count">
            {s.query.trim() ? replacePreviewText(preview!) : ''}
          </span>
          <button className="tools-replace__btn" disabled={!preview?.total} title="Diese Stelle ersetzen (Enter)" data-testid="replace-one" onClick={() => doReplace(true)}>
            Ersetzen
          </button>
          <button className="tools-search__all" disabled={!preview?.total} title="Alle Stellen ersetzen (Strg Enter)" data-testid="replace-all" onClick={() => doReplace(false)}>
            Alle
          </button>
        </div>
      )}
    </>
  );
}
