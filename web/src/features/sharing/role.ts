// Eigene Rolle auf dem offenen Board (Modus local). Wird beim Öffnen und nach jedem Wiederverbinden neu geholt: Ändert
// jemand die Rolle, trennt der Server die Verbindung (access_changed) und der Client verbindet mit der neuen Rolle neu.
import { useEffect, useSyncExternalStore } from 'react';
import type { BoardRole } from '../../protocol';
import type { EditorApi } from '../../editor/ext/types';
import { currentBoardId, useInstance } from '../../instance';
import { accountApi } from '../../pages/account/accountApi';

interface State {
  boardId: string | null;
  role: BoardRole | null;
  canManage: boolean;
}

let state: State = { boardId: null, role: null, canManage: false };
const listeners = new Set<() => void>();
const set = (s: State) => {
  state = s;
  listeners.forEach((fn) => fn());
};

async function refresh(boardId: string) {
  try {
    const r = await accountApi.share(boardId);
    if (currentBoardId() === boardId) set({ boardId, role: r.role, canManage: r.canManage });
  } catch {
    // kein Zugriff (mehr): der Editor zeigt das selbst (no_access); nur schreibgeschützt bleiben
    if (currentBoardId() === boardId) set({ boardId, role: state.boardId === boardId ? state.role : null, canManage: false });
  }
}

/** Rolle der Person auf dem Board im Editor; null = Modus org, offline oder noch unbekannt. */
export function useBoardRole(api: EditorApi): State & { local: boolean } {
  const inst = useInstance();
  const local = inst?.auth === 'local' && !api.session.isLocal;
  const boardId = local ? currentBoardId() : null;
  const s = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
  useEffect(() => {
    if (!boardId) return;
    if (state.boardId !== boardId) set({ boardId, role: null, canManage: false });
    void refresh(boardId);
    // nach dem Wiederverbinden (z. B. Rolle geändert) neu fragen
    let was = api.session.getStatus();
    const off = api.session.subscribe(() => {
      const now = api.session.getStatus();
      if (now === 'connected' && was !== 'connected') void refresh(boardId);
      was = now;
    });
    return off;
  }, [boardId, api.session]);
  return { ...(s.boardId === boardId ? s : { boardId, role: null, canManage: false }), local };
}

export const reloadRole = () => {
  const id = currentBoardId();
  if (id) void refresh(id);
};
