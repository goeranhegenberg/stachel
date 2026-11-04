// Einstellungen der Werkzeuge (Notizfarbe, Form, Stiftfarbe …): pro Sitzung im Speicher, für alle Komponenten gleich.
import { useCallback, useSyncExternalStore } from 'react';

const values = new Map<string, unknown>();
const listeners = new Set<() => void>();
const k = (tool: string, key: string) => `${tool}.${key}`;

export function getToolOption<T>(tool: string, key: string, fallback: T): T {
  const v = values.get(k(tool, key));
  return v === undefined ? fallback : (v as T);
}

export function setToolOption(tool: string, key: string, value: unknown) {
  values.set(k(tool, key), value);
  for (const fn of listeners) fn();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** Werkzeug-Option lesen und setzen (React). */
export function useToolOption<T>(tool: string, key: string, fallback: T): [T, (v: T) => void] {
  const v = useSyncExternalStore(subscribe, () => getToolOption(tool, key, fallback));
  const set = useCallback((next: T) => setToolOption(tool, key, next), [tool, key]);
  return [v, set];
}
