// Zuletzt benutzte eigene Farben (Farbwähler): je Gerät im localStorage, höchstens acht, neueste zuerst. Nur Komfort –
// ohne Speicher (privates Fenster) bleibt die Liste leer.
import { useSyncExternalStore } from 'react';

const KEY = 'stachel:recentColors';
export const MAX_RECENT = 8;
const HEX6 = /^#[0-9a-f]{6}$/i;

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const storage = (): Store | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

let cache: string[] | null = null;
const listeners = new Set<() => void>();

export function readRecentColors(s: Store | null = storage()): string[] {
  try {
    const v = JSON.parse(s?.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && HEX6.test(x)).map((x) => x.toLowerCase()).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/** Farbe vorne einreihen (doppelte fallen weg). */
export function addRecentColor(hex: string, s: Store | null = storage()) {
  if (!HEX6.test(hex)) return;
  const c = hex.toLowerCase();
  const next = [c, ...readRecentColors(s).filter((x) => x !== c)].slice(0, MAX_RECENT);
  try {
    s?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* Speicher gesperrt */
  }
  cache = next;
  for (const fn of listeners) fn();
}

export function useRecentColors(): string[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => (cache ??= readRecentColors()),
    () => [],
  );
}
