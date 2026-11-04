// Ersatz-Sitzung für den Editor: Ein Feature-Modul zeigt damit vorübergehend ein anderes Dokument auf der Leinwand
// (z. B. die Vorschau einer alten Version, features/versions), ohne die Live-Sitzung zu trennen. EditorPage baut den
// Editor dann mit `session` neu auf; die Live-Sitzung bleibt verbunden und bekommt weiter alle Änderungen.
import { useSyncExternalStore } from 'react';
import type { BoardSession } from '../../board/session';

export interface SessionOverride {
  /** gilt nur für diese Live-Sitzung (anderes Board geöffnet = ohne Wirkung) */
  live: BoardSession;
  /** stattdessen im Editor gezeigte Sitzung */
  session: BoardSession;
  /** Wechsel des Schlüssels baut den Editor neu auf */
  key: string;
}

let current: SessionOverride | null = null;
const listeners = new Set<() => void>();

export function setSessionOverride(o: SessionOverride | null) {
  if (o === current) return;
  current = o;
  listeners.forEach((fn) => fn());
}

export const getSessionOverride = () => current;

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Ersatz für die Live-Sitzung `live` (null = Live-Sitzung zeigen). */
export function useSessionOverride(live: BoardSession): SessionOverride | null {
  const o = useSyncExternalStore(subscribe, getSessionOverride);
  return o && o.live === live ? o : null;
}
