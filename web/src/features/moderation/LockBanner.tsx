// Hinweis im Editor, wenn die Moderation das Board gesperrt hat (nur ansehen); lädt nebenbei die Blockier-Liste, damit
// @Erwähnungen blockierter Personen nicht als ungelesen zählen (collab/comments.ts).
import { useEffect, useState } from 'react';
import type { SlotProps } from '../../editor/ext/types';
import { currentBoardId } from '../../instance';
import { moderationApi } from './api';
import { loadBlocked } from './useBlocked';

export function LockBanner({ api }: SlotProps) {
  const online = !api.session.isLocal;
  const boardId = online ? currentBoardId() : null;
  const [lock, setLock] = useState<{ reason: string } | null>(null);
  useEffect(() => {
    if (online) void loadBlocked();
  }, [online]);
  useEffect(() => {
    if (!boardId) return;
    let alive = true;
    const refresh = () =>
      moderationApi.boardLock(boardId).then(
        (l) => alive && setLock(l),
        () => {},
      );
    void refresh();
    // nach dem Wiederverbinden neu fragen (Sperre trennt die Verbindung)
    let was = api.session.getStatus();
    const off = api.session.subscribe(() => {
      const now = api.session.getStatus();
      if (now === 'connected' && was !== 'connected') void refresh();
      was = now;
    });
    return () => {
      alive = false;
      off();
    };
  }, [boardId, api.session]);
  if (!lock) return null;
  return (
    <div className="mod-lock" role="status" data-testid="moderation-lock">
      <strong>Von der Moderation gesperrt:</strong> Dieses Board lässt sich nur ansehen.
      {lock.reason ? <span className="mod-lock__reason"> Grund: {lock.reason}</span> : null}
    </div>
  );
}
