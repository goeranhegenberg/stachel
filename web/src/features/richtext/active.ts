// Zustand außerhalb von React: Editor-API, gerade bearbeitetes Objekt (für die Format-Leiste), letzter Zeigerdruck.
import { useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import type { EditorApi } from '../../editor/ext/types';
import type { TextVariant } from '../../editor/text/engine';

let api: EditorApi | null = null;
/** Die Format-Leiste (Overlay-Slot) meldet die API, damit Text-Engine und Kürzel an den Store kommen. */
export const setApi = (a: EditorApi) => {
  api = a;
};
export const getApi = () => api;

export interface ActiveEdit {
  id: string;
  variant: TextVariant;
  editor: Editor;
  /** Bearbeitung beenden (wie Esc) */
  finish(): void;
}

let active: ActiveEdit | null = null;
let version = 0;
/** offenes Popover der Format-Leiste (z. B. 'link' nach Strg K) */
let pop: string | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((fn) => fn());
};

export const getActive = () => active;
export const setActive = (a: ActiveEdit | null) => {
  if (a === null && active === null) return;
  active = a;
  pop = null;
  emit();
};
/** Editor hat sich geändert (Inhalt, Auswahl) → Leiste neu zeichnen */
export const bumpActive = emit;
export const getPop = () => pop;
export const setPop = (p: string | null) => {
  pop = p;
  emit();
};

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
/** Neu rendern bei jeder Änderung des aktiven Editors. */
export const useActiveVersion = () => useSyncExternalStore(subscribe, () => version);

// Strg K auf einem ausgewählten Objekt: beim Start der Bearbeitung alles markieren und das Link-Feld öffnen
let linkAll: string | null = null;
export const requestLinkAll = (id: string) => {
  linkAll = id;
};
export const takeLinkAll = (id: string) => {
  if (linkAll !== id) return false;
  // erst nach dem Einhängen löschen (StrictMode hängt den Editor zweimal ein)
  queueMicrotask(() => {
    if (linkAll === id) linkAll = null;
  });
  return true;
};

// Getippt (statt geklickt): Cursor ans Ende; geklickt: an die Klickstelle
let typed: string | null = null;
export const markTyped = (id: string) => {
  typed = id;
};
export const takeTyped = (id: string) => {
  if (typed !== id) return false;
  // erst nach dem Einhängen löschen (StrictMode hängt den Editor zweimal ein)
  queueMicrotask(() => {
    if (typed === id) typed = null;
  });
  return true;
};

let lastDown: { x: number; y: number; t: number } | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => (lastDown = { x: e.clientX, y: e.clientY, t: performance.now() }), true);
}
/** Letzter Zeigerdruck, falls er gerade erst war (Doppelklick/Klick zum Bearbeiten). */
export const recentDown = (ms = 700) => (lastDown && performance.now() - lastDown.t < ms ? lastDown : null);
