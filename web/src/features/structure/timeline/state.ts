// Lokaler Zustand der Zeitleisten (nicht im Dokument): aktiver Eintrag bzw. aktive Spur je Zeitleiste, was gerade
// bearbeitet wird, letzter Zeigerdruck (für Doppelklick/Enter) und Entwürfe beim Ziehen.
import { useSyncExternalStore } from 'react';
import type { TlHit } from './model';

export type Focus = { kind: 'item'; id: string } | { kind: 'lane'; id: string };
export type EditTarget = { kind: 'item'; id: string; typed?: string } | { kind: 'lane'; id: string };
/** Entwurf während einer Geste (innere Einheiten) */
export type Draft = { kind: 'new'; lane: string; a: number; b: number } | { kind: 'laneMove'; lane: string; y: number } | null;

const focus = new Map<string, Focus>();
const edits = new Map<string, EditTarget>();
const drafts = new Map<string, Draft>();
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((fn) => fn());
};
export const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const focusOf = (id: string) => focus.get(id) ?? null;
export function setFocus(id: string, f: Focus | null) {
  const cur = focus.get(id);
  if (cur?.kind === f?.kind && cur?.id === f?.id) return;
  if (f) focus.set(id, f);
  else focus.delete(id);
  emit();
}
/** aktiver Eintrag (id) einer Zeitleiste */
export const activeItem = (id: string) => {
  const f = focus.get(id);
  return f?.kind === 'item' ? f.id : null;
};

export const editOf = (id: string) => edits.get(id) ?? null;
export function setEdit(id: string, t: EditTarget | null) {
  if (t) edits.set(id, t);
  else if (!edits.has(id)) return;
  else edits.delete(id);
  emit();
}

export const draftOf = (id: string) => drafts.get(id) ?? null;
export function setDraft(id: string, d: Draft) {
  if (d) drafts.set(id, d);
  else if (!drafts.has(id)) return;
  else drafts.delete(id);
  emit();
}

/** Neu zeichnen bei jeder lokalen Änderung (Zeitleisten sind selten zahlreich). */
export const useTimelineState = () => useSyncExternalStore(subscribe, () => version);

/** Letzter Zeigerdruck auf einer Zeitleiste – entscheidet, was ein Doppelklick bearbeitet. */
let lastDown: { id: string; hit: TlHit | null; at: number } | null = null;
export const recordDown = (id: string, hit: TlHit | null) => {
  lastDown = { id, hit, at: performance.now() };
};
/** Treffer des letzten Drucks, wenn er frisch ist (Doppelklick, langes Drücken) */
export const recentDown = (id: string, ms = 900): TlHit | null | undefined =>
  lastDown && lastDown.id === id && performance.now() - lastDown.at < ms ? lastDown.hit : undefined;
