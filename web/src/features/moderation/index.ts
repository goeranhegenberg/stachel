// Feature-Modul „moderation“ (docs/features/moderation.md): Melden (Objekt per Rechtsklick, Board über „···“, Kommentar
// und Person in collab) nach DSA Art. 16 / Google Play UGC, Hinweis bei gesperrtem Board, Blockier-Liste. Offline nicht.
import { createElement } from 'react';
import { defineMenuItem, defineModal, defineSlot } from '../../editor/ext/registry';
import { currentBoardId } from '../../instance';
import { LockBanner } from './LockBanner';
import { ReportDialog, type ReportTarget } from './ReportDialog';
import { BlockedDialog } from './BlockedList';
import './moderation.css';

export const REPORT_MODAL = 'moderation.report';

defineModal({ id: REPORT_MODAL, Component: ({ api, props, onClose }) => createElement(ReportDialog, { target: props as ReportTarget, me: api.session.user.key, onClose }) });

defineMenuItem({
  id: 'moderation.reportObject',
  on: 'object',
  order: 98,
  item: (api) => {
    const boardId = currentBoardId();
    const sel = api.selection();
    if (api.session.isLocal || !boardId || sel.length !== 1) return null;
    return { label: 'Melden …', sep: true, onSelect: () => api.openModal(REPORT_MODAL, { kind: 'object', boardId, objectId: sel[0] } satisfies ReportTarget) };
  },
});

defineMenuItem({
  id: 'moderation.reportBoard',
  on: 'board',
  order: 95,
  item: (api) => {
    const boardId = currentBoardId();
    if (api.session.isLocal || !boardId) return null;
    return { label: 'Board melden …', sep: true, onSelect: () => api.openModal(REPORT_MODAL, { kind: 'board', boardId } satisfies ReportTarget) };
  },
});

// Blockierte Personen auch im Editor (Modus org hat keine Konto-Seite)
defineModal({ id: 'moderation.blocked', Component: ({ onClose }) => createElement(BlockedDialog, { onClose }) });
defineMenuItem({
  id: 'moderation.blocked',
  on: 'board',
  order: 96,
  item: (api) => (api.session.isLocal ? null : { label: 'Blockierte Personen …', onSelect: () => api.openModal('moderation.blocked') }),
});

defineSlot({ id: 'moderation.lock', slot: 'overlay', order: 2, Component: LockBanner, presenting: true });

export { BlockedList } from './BlockedList';
export { PersonActions } from './PersonActions';
