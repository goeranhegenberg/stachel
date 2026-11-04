// HTTP-Client für Melden und Blockieren (server/src/reports.ts, blocks.ts, moderation.ts; docs/features/moderation.md).
import { request } from '../../api';
import { BLOCKS_PATH, REPORTS_PATH, type BlockedPerson, type ReportCreated, type ReportInput } from '../../../../shared/moderation';

const enc = encodeURIComponent;

export const moderationApi = {
  report: (input: ReportInput) => request<ReportCreated>('POST', REPORTS_PATH, input),
  blocks: () => request<{ ok: true; blocked: BlockedPerson[] }>('GET', BLOCKS_PATH).then((r) => r.blocked),
  block: (key: string) => request<{ ok: true; blocked: BlockedPerson[] }>('PUT', `${BLOCKS_PATH}/${enc(key)}`).then((r) => r.blocked),
  unblock: (key: string) => request<{ ok: true; blocked: BlockedPerson[] }>('DELETE', `${BLOCKS_PATH}/${enc(key)}`).then((r) => r.blocked),
  /** Moderations-Sperre des Boards (null = keine) */
  boardLock: (boardId: string) => request<{ ok: true; lock: { mode: 'readonly'; reason: string } | null }>('GET', `/api/boards/${enc(boardId)}/moderation`).then((r) => r.lock),
};
