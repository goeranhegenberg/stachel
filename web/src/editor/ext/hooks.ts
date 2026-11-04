// React-Hilfen für Feature-Module: Board-Schnappschuss und eigene Y-Strukturen abonnieren.
import { useMemo, useRef, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import type { Snapshot } from '../../board/store';
import type { EditorApi } from './types';

/** Aktueller Board-Schnappschuss (rendert bei jeder Änderung neu). */
export function useSnapshot(api: EditorApi): Snapshot {
  return useSyncExternalStore(api.store.subscribe, api.store.getSnapshot);
}

/**
 * Wert aus einer Y-Struktur (z. B. store.extMap('comments')) lesen und bei Änderungen neu berechnen.
 * `read` bekommt die Struktur und muss bei gleichem Inhalt nicht dasselbe Objekt liefern.
 */
export function useY<T extends Y.AbstractType<any>, R>(type: T, read: (t: T) => R): R {
  const cache = useRef<{ version: number; value: R } | null>(null);
  const version = useRef(0);
  const sub = useMemo(
    () => (fn: () => void) => {
      const h = () => {
        version.current++;
        fn();
      };
      type.observeDeep(h);
      return () => type.unobserveDeep(h);
    },
    [type],
  );
  const get = () => {
    if (!cache.current || cache.current.version !== version.current) cache.current = { version: version.current, value: read(type) };
    return cache.current.value;
  };
  return useSyncExternalStore(sub, get);
}
