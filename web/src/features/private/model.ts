// Privater Modus im Web (docs/features/private.md): Zustand aus dem Board-Dokument lesen, Steuern per REST.
import { useSyncExternalStore } from 'react';
import { request } from '../../api';
import { PRIVATE_HIDDEN, PRIVATE_MODE, type PrivateModeState } from '../../protocol';
import { useY } from '../../editor/ext/hooks';
import type { EditorApi } from '../../editor/ext/types';
import { readHidden, readMode } from './route';

export type PrivateAction = 'start' | 'reveal' | 'cancel' | 'revealOwn';

export interface ControlInput {
  action: PrivateAction;
  anonymous?: boolean;
  ownReveal?: boolean;
  countdown?: number;
}

export const privateApi = {
  control: (boardId: string, input: ControlInput) =>
    request<{ ok: true; state: PrivateModeState }>('POST', `/api/boards/${encodeURIComponent(boardId)}/private`, input).then((r) => r.state),
};

/** Zustand `private.mode` (live). */
export function usePrivateMode(api: EditorApi): PrivateModeState {
  return useY(api.store.doc.getMap(PRIVATE_MODE), () => readMode(api.store.doc));
}

/** Platzhalter `private.hidden` (live), ohne die eigenen (die sehe ich als echte Objekte). */
export function useHidden(api: EditorApi) {
  const all = useY(api.store.doc.getMap(PRIVATE_HIDDEN), () => readHidden(api.store.doc));
  useSyncExternalStore(api.store.subscribe, api.store.getSnapshot); // eigene IDs ändern sich mit dem Schnappschuss
  return all.filter((p) => !api.store.isPrivate(p.id));
}

/** Darf ich aufdecken (Moderation, sonst ist die Moderation nicht mehr da)? Der Server prüft genauso (+ Besitzer:in). */
export function canModerate(api: EditorApi, mode: PrivateModeState): boolean {
  if (!mode.on) return false;
  const me = api.session.user.key;
  if (mode.by === me) return true;
  return !api.session.getPeers().some((p) => p.user.key === mode.by || p.user.key === `ai:${mode.by}`);
}

/** Sekunden bis zum Aufdecken (aufgerundet), null = kein Countdown. */
export function countdownLeft(mode: PrivateModeState, now = Date.now()): number | null {
  if (!mode.on || mode.revealAt === undefined) return null;
  return Math.max(0, Math.ceil((mode.revealAt - now) / 1000));
}
