// Lokale Einstellungen (nur dieser Browser): Einrasten am Raster, Ausgeblendete zeigen. localStorage immer in try/catch.
import { useSyncExternalStore } from 'react';

export interface Prefs {
  /** Objekte beim Ziehen am Raster einrasten */
  snap: boolean;
  /** ausgeblendete Objekte blass zeigen (und auswählbar machen) */
  showHidden: boolean;
}

const KEY = 'stachel:tools:prefs';
const DEFAULTS: Prefs = { snap: false, showHidden: false };

function load(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { snap: v.snap === true, showHidden: false };
  } catch {
    return { ...DEFAULTS };
  }
}

let prefs: Prefs = load();
const listeners = new Set<() => void>();

export const getPrefs = () => prefs;

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  try {
    // „Ausgeblendete zeigen“ gilt nur bis zum Neuladen
    localStorage.setItem(KEY, JSON.stringify({ snap: prefs.snap }));
  } catch {
    /* egal */
  }
  for (const fn of listeners) fn();
}

export const subscribePrefs = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const usePrefs = () => useSyncExternalStore(subscribePrefs, getPrefs);
