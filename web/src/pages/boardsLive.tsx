// Board-Übersicht: Live-Aktualisierung (Server-Sent Events `GET /api/boards/events`) und Favoriten (Stern).
// Vertrag: docs/contract.md §3 „Live-Übersicht“, „Favoriten und zuletzt geöffnet“.
import { useEffect, useRef } from 'react';
import { CSRF_HEADER, type BoardInfo } from '../protocol';
import { ApiError } from '../api';

type BoardEvent =
  | { type: 'created'; id: string }
  | { type: 'renamed'; id: string; title: string; titleSeq: number }
  | { type: 'deleted'; id: string; by: string; byKey: string }
  | { type: 'restored'; id: string; by: string; byKey: string }
  | { type: 'purged'; id: string }
  | { type: 'updated'; id: string };

/** „created“/„updated“ laden die Liste neu (gesammelt), damit Vorschaubild, Reihenfolge und Zeiten stimmen. */
const RELOAD_DELAY_MS = 600;

/**
 * Ereignisse der anderen live übernehmen. Der Browser verbindet von selbst neu (EventSource); verpasste Ereignisse
 * holt das Neuladen beim Wiederverbinden nach. Ohne Sitzung (401) gibt EventSource auf – das merkt dann `load`.
 */
export function useBoardEvents(on: {
  reload: () => void;
  renamed: (id: string, title: string) => void;
  /** in den Papierkorb verschoben (Papierkorb: pages/trash.tsx) */
  deleted: (id: string, by: string, byKey: string) => void;
  /** aus dem Papierkorb zurückgeholt bzw. endgültig gelöscht; danach wird ohnehin neu geladen */
  restored?: (id: string, by: string) => void;
  purged?: (id: string) => void;
}) {
  const cb = useRef(on);
  cb.current = on;
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/boards/events');
    let timer = 0;
    let opened = false;
    const reload = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => cb.current.reload(), RELOAD_DELAY_MS);
    };
    es.onopen = () => {
      // nach einem Abriss: Verpasstes nachladen (beim ersten Öffnen lädt die Seite ohnehin)
      if (opened) reload();
      opened = true;
    };
    es.onmessage = (m) => {
      let e: BoardEvent;
      try {
        e = JSON.parse(m.data);
      } catch {
        return;
      }
      if (!e || typeof e.id !== 'string') return;
      if (e.type === 'renamed' && typeof e.title === 'string') cb.current.renamed(e.id, e.title);
      else if (e.type === 'deleted') {
        cb.current.deleted(e.id, typeof e.by === 'string' ? e.by : '', typeof e.byKey === 'string' ? e.byKey : '');
        reload(); // Papierkorb-Liste
      } else {
        if (e.type === 'restored') cb.current.restored?.(e.id, typeof e.by === 'string' ? e.by : '');
        else if (e.type === 'purged') cb.current.purged?.(e.id);
        reload();
      }
    };
    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, []);
}

/** Stern setzen/entfernen (PUT/DELETE /api/boards/:id/favorite). */
export async function setFavorite(id: string, on: boolean): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/boards/${encodeURIComponent(id)}/favorite`, {
      method: on ? 'PUT' : 'DELETE',
      headers: { Accept: 'application/json', [CSRF_HEADER]: '1' },
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('network', 0);
  }
  if (res.ok) return;
  let code = res.status >= 500 ? 'server' : 'bad_request';
  try {
    const d = await res.json();
    if (typeof d?.error === 'string') code = d.error;
  } catch {
    /* kein JSON */
  }
  throw new ApiError(code, res.status);
}

export function FavoriteButton({ board, onToggle }: { board: BoardInfo; onToggle: () => void }) {
  const on = !!board.favorite;
  const label = on ? `„${board.title}“ aus den Favoriten nehmen` : `„${board.title}“ als Favorit markieren`;
  return (
    <button className={`board-fav${on ? ' is-on' : ''}`} aria-pressed={on} aria-label={on ? 'Favorit' : 'Als Favorit markieren'} title={label} onClick={onToggle} data-testid="board-fav">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8z"
          fill={on ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
