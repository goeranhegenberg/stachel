// Board-Übersicht im Modus local (docs/features/accounts.md): Filter „Meine Boards / Mit mir geteilt / Favoriten“,
// Teilen im Karten-Menü, Rolle an der Karte, Link zur Konto-Seite. Im Modus org bleibt alles wie bisher.
import { useState } from 'react';
import type { BoardInfo } from '../../protocol';
import { useInstance } from '../../instance';
import type { CardAction } from '../../features/tools/overview/overview';
import { IconShare, ShareDialog } from '../../features/sharing/ShareDialog';
import { ROLE_NAMES } from './accountApi';
import './account.css';

export type OwnerFilter = 'all' | 'mine' | 'shared' | 'favorites';
const LABELS: Record<OwnerFilter, string> = { all: 'Alle', mine: 'Meine Boards', shared: 'Mit mir geteilt', favorites: 'Favoriten' };
const KEY = 'stachel:boards-filter';

function readFilter(): OwnerFilter {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'mine' || v === 'shared' || v === 'favorites' ? v : 'all';
  } catch {
    return 'all';
  }
}

/** Modus local? Dann Filter, Teilen und Konto-Link. */
export function useLocalBoards() {
  const inst = useInstance();
  const local = inst?.auth === 'local';
  const [filter, setFilterState] = useState<OwnerFilter>(readFilter);
  const [sharing, setSharing] = useState<BoardInfo | null>(null);
  const setFilter = (f: OwnerFilter) => {
    setFilterState(f);
    try {
      localStorage.setItem(KEY, f);
    } catch {
      /* egal */
    }
  };
  return {
    local,
    brand: inst?.brand ?? 'Stachel',
    /** Modus org: Name der Organisation für die Kopfzeile */
    orgName: inst?.orgName ?? null,
    filter: local ? filter : ('all' as const),
    setFilter,
    sharing,
    setSharing,
    /** Liste nach dem gewählten Filter */
    apply: (list: BoardInfo[], userKey: string) => {
      if (!local || filter === 'all') return list;
      if (filter === 'mine') return list.filter((b) => b.createdBy === userKey);
      if (filter === 'shared') return list.filter((b) => b.createdBy !== userKey);
      return list.filter((b) => b.favorite);
    },
  };
}

export function OwnerFilterBar({ value, onChange }: { value: OwnerFilter; onChange: (f: OwnerFilter) => void }) {
  return (
    <div className="acc-filter" role="group" aria-label="Boards filtern" data-testid="owner-filter">
      {(Object.keys(LABELS) as OwnerFilter[]).map((f) => (
        <button key={f} aria-pressed={value === f} onClick={() => onChange(f)}>
          {LABELS[f]}
        </button>
      ))}
    </div>
  );
}

/** Karten-Menü: „Teilen …“ (alle mit Zugriff; verwalten nur Besitzer:in und Bearbeitende). */
export function shareAction(onShare: () => void): CardAction {
  return { label: 'Teilen …', icon: <IconShare size={18} />, onSelect: onShare };
}

/** Rolle an der Karte (nur wenn nicht eigenes Board). */
export function RoleTag({ board }: { board: BoardInfo }) {
  if (!board.role || board.role === 'owner') return null;
  return (
    <span className="acc-role" data-testid="board-role">
      {ROLE_NAMES[board.role]}
    </span>
  );
}

export function BoardShareDialog({ board, me, onClose, onChanged }: { board: BoardInfo; me: string; onClose: () => void; onChanged: () => void }) {
  return (
    <ShareDialog
      boardId={board.id}
      title={board.title}
      me={me}
      onClose={() => {
        onClose();
        onChanged();
      }}
      onLeft={onChanged}
    />
  );
}
