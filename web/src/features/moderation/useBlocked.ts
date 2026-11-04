// React-Seite der Blockier-Liste (blocked.ts): laden, blockieren, aufheben.
import { useEffect, useSyncExternalStore } from 'react';
import type { BlockedPerson } from '../../../../shared/moderation';
import { moderationApi } from './api';
import { blockedList, setBlocked, subscribeBlocked } from './blocked';

let loading: Promise<void> | null = null;

/** Liste einmal je Seite holen (Fehler = leer lassen, nächster Aufruf versucht es wieder). */
export function loadBlocked(force = false): Promise<void> {
  if (force) loading = null;
  loading ??= moderationApi.blocks().then(setBlocked, () => {
    loading = null;
  });
  return loading;
}

export async function blockPerson(key: string) {
  setBlocked(await moderationApi.block(key));
}

export async function unblockPerson(key: string) {
  setBlocked(await moderationApi.unblock(key));
}

/** Blockierte Personen; `enabled = false` (offline) lädt nichts. */
export function useBlocked(enabled = true): readonly BlockedPerson[] {
  useEffect(() => {
    if (enabled) void loadBlocked();
  }, [enabled]);
  return useSyncExternalStore(subscribeBlocked, blockedList);
}
