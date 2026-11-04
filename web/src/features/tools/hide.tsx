// Objekte ausblenden (Feld `hidden`): für alle unsichtbar und nicht anklickbar, bis jemand „Ausgeblendete zeigen“
// wählt – dann blass mit gestricheltem Rand und wieder auswählbar. Umsetzung ohne Kern-Änderung über CSS je Objekt-ID.
import { useEffect, useMemo } from 'react';
import type { BoardObject } from '../../protocol';
import type { Snapshot } from '../../board/store';
import type { EditorApi, SlotProps } from '../../editor/ext/types';
import { getPrefs, setPrefs, usePrefs } from './prefs';

const cssEscape = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));

export const hiddenIds =(snap: Snapshot): string[] => snap.ordered.filter((o) => o.hidden).map((o) => o.id);

/** CSS für ausgeblendete Objekte (Welt-Ebene und Rahmentitel im Overlay). */
export function hiddenCss(ids: readonly string[], show: boolean): string {
  if (!ids.length) return '';
  const sel = ids.flatMap((id) => [`.board .world [data-id="${cssEscape(id)}"]`, `.board .ov-frame-title[data-id="${cssEscape(id)}"]`]).join(',\n');
  // Notiz-Tags liegen in einer eigenen Ebene neben der Notiz (tags.tsx)
  const tags = ids.map((id) => `.board .world [data-tags-for="${cssEscape(id)}"]`).join(',\n');
  return show
    ? `${sel} { opacity: 0.38; outline: 2px dashed rgba(23, 99, 181, 0.9); outline-offset: 3px; }\n${tags} { opacity: 0.38; }`
    : `${sel},\n${tags} { visibility: hidden !important; pointer-events: none !important; }`;
}

/** Welt-Slot: Regeln einsetzen und die Auswahl von Unsichtbarem befreien (Auswahlrechteck, Strg A, Tab). */
export function HiddenObjects({ api, snap, selection }: SlotProps) {
  const prefs = usePrefs();
  const ids = useMemo(() => hiddenIds(snap), [snap]);
  const css = useMemo(() => hiddenCss(ids, prefs.showHidden), [ids, prefs.showHidden]);
  useEffect(() => {
    if (prefs.showHidden || !ids.length) return;
    const hidden = new Set(ids);
    if (selection.some((id) => hidden.has(id))) api.setSelection(selection.filter((id) => !hidden.has(id)));
  }, [api, ids, selection, prefs.showHidden]);
  // Hover-Rahmen und Andockpunkte über unsichtbaren Objekten ausblenden
  useEffect(() => {
    const board = document.querySelector<HTMLElement>('[data-testid="board"]');
    if (!board || prefs.showHidden || !ids.length) {
      board?.removeAttribute('data-tools-hover-hidden');
      return;
    }
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = board.getBoundingClientRect();
        const hit = api.hitTest(api.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top }));
        if (hit?.hidden) board.dataset.toolsHoverHidden = '';
        else board.removeAttribute('data-tools-hover-hidden');
      });
    };
    board.addEventListener('pointermove', move);
    return () => {
      cancelAnimationFrame(raf);
      board.removeEventListener('pointermove', move);
      board.removeAttribute('data-tools-hover-hidden');
    };
  }, [api, ids, prefs.showHidden]);
  return css ? <style data-testid="tools-hidden-css">{css}</style> : null;
}

/** Auswahl aus- bzw. einblenden (ein Undo-Schritt). */
export function toggleHidden(api: EditorApi, objs: readonly BoardObject[] = api.selected()) {
  const list = objs.filter((o) => !o.locked);
  if (!list.length) return;
  const hide = !list.every((o) => o.hidden);
  api.store.stopCapturing();
  api.store.updateMany(Object.fromEntries(list.map((o) => [o.id, { hidden: hide ? true : undefined }])));
  api.store.stopCapturing();
  if (hide && !getPrefs().showHidden) {
    api.setSelection([]);
    api.toast(list.length === 1 ? 'Ausgeblendet. Zurückholen: Board-Menü → Ausgeblendete zeigen.' : `${list.length} Objekte ausgeblendet.`);
  }
}

/** Alle ausgeblendeten Objekte wieder einblenden. */
export function showAll(api: EditorApi) {
  const ids = hiddenIds(api.snapshot());
  if (!ids.length) return;
  api.store.stopCapturing();
  api.store.updateMany(Object.fromEntries(ids.map((id) => [id, { hidden: undefined }])));
  api.store.stopCapturing();
  api.toast(ids.length === 1 ? '1 Objekt eingeblendet.' : `${ids.length} Objekte eingeblendet.`);
}

export const toggleShowHidden = () => setPrefs({ showHidden: !getPrefs().showHidden });
