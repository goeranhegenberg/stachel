// Wen ich blockiert habe (GET /api/blocks), einmal je Seite geladen. Ohne React (collab/comments.ts filtert damit die
// ungelesenen @Erwähnungen, der Server bündelt diesen Code für die Native-API mit).
import type { BlockedPerson } from '../../../../shared/moderation';

let list: BlockedPerson[] = [];
let keys: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

/** Hat die angemeldete Person `key` blockiert? (vor dem ersten Laden: nein) */
export const isBlocked = (key: string) => keys.has(key);

export const blockedList = (): readonly BlockedPerson[] => list;

export function setBlocked(next: BlockedPerson[]) {
  list = next;
  keys = new Set(next.map((p) => p.key));
  listeners.forEach((fn) => fn());
}

export function subscribeBlocked(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
