// Endpunkte des Imports (docs/features/import.md §2). Das Miro-Token geht nur einmal per POST an den Server und wird
// hier nirgends abgelegt (kein localStorage, keine Adresse, kein Log).
import type {
  ImportJob,
  ImportOauthStart,
  ImportOptions,
  ImportRemoteBoards,
  ImportSources,
  ImportTokenResult,
} from '../../../../shared/import';
import { request } from '../../api';

const enc = encodeURIComponent;

export const importApi = {
  sources: () => request<ImportSources>('GET', '/api/import/sources'),
  /** Zugriffstoken prüfen → Verbindung `conn` (nur im Speicher des Servers). */
  token: (token: string) => request<ImportTokenResult>('POST', '/api/import/miro/token', { token }),
  oauthStart: () => request<ImportOauthStart>('POST', '/api/import/miro/oauth/start', { client: 'web' }).then((r) => r.url),
  disconnect: () => request<{ ok: true }>('DELETE', '/api/import/miro/oauth'),
  boards: (conn: string, query = '', offset?: number) => {
    const q = new URLSearchParams({ conn });
    if (query) q.set('query', query);
    if (offset !== undefined) q.set('offset', String(offset));
    return request<ImportRemoteBoards>('GET', `/api/import/miro/boards?${q}`);
  },
  start: (conn: string, boards: string[], options: ImportOptions) =>
    request<{ ok: true; jobs: ImportJob[] }>('POST', '/api/import/miro/jobs', { conn, boards, options }).then((r) => r.jobs),
  jobs: () => request<{ ok: true; jobs: ImportJob[] }>('GET', '/api/import/jobs').then((r) => r.jobs),
  job: (id: string) => request<{ ok: true; job: ImportJob }>('GET', `/api/import/jobs/${enc(id)}`).then((r) => r.job),
  cancel: (id: string) => request<{ ok: true }>('DELETE', `/api/import/jobs/${enc(id)}`),
};

/** Ist der Import auf dieser Instanz für die Person nutzbar? */
export const importOffered = (s: ImportSources | null | undefined) => !!s?.miro?.enabled && (s.miro.token || s.miro.oauth);
