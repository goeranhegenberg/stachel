// Oben rechts im Editor (Modus local): Rolle, wenn man nicht bearbeiten darf, und der Teilen-Knopf.
import { useState } from 'react';
import type { SlotProps } from '../../editor/ext/types';
import { appHref, navigate } from '../../router';
import { currentBoardId } from '../../instance';
import { useBoardRole } from './role';
import { IconShare, ShareDialog } from './ShareDialog';

export function ShareBar({ api }: SlotProps) {
  const { local, role } = useBoardRole(api);
  const [open, setOpen] = useState(false);
  const boardId = currentBoardId();
  if (!local || !boardId || !role) return null;
  return (
    <>
      {(role === 'view' || role === 'comment') && (
        <span className="panel share-badge" data-testid="role-badge" title={role === 'view' ? 'Du kannst dieses Board nur ansehen.' : 'Du kannst dieses Board ansehen und kommentieren.'}>
          {role === 'view' ? 'Nur ansehen' : 'Kommentieren'}
        </span>
      )}
      <button className="share-btn" onClick={() => setOpen(true)} data-testid="share-open" aria-label="Teilen" title="Teilen">
        <IconShare />
        <span className="share-btn__label">Teilen</span>
      </button>
      {open && <ShareDialog boardId={boardId} me={api.session.user.key} onClose={() => setOpen(false)} onLeft={() => navigate(appHref())} />}
    </>
  );
}
