import { useSyncExternalStore } from 'react';

/** true, solange die Media-Query passt (z. B. '(pointer: coarse) and (max-width: 700px)'). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (fn) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', fn);
      return () => m.removeEventListener('change', fn);
    },
    () => window.matchMedia(query).matches,
  );
}
