// HTTP-Client für eigene Konten und Teilen (Modus local, docs/features/accounts.md).
import { request } from '../../api';
import type { BoardRole, User } from '../../protocol';

export type ShareRole = Exclude<BoardRole, 'owner'>;

export interface SharePerson {
  key: string;
  name: string;
  email: string | null;
  role: BoardRole;
  via: 'owner' | 'member' | 'link';
}

export interface ShareInfo {
  title: string;
  role: BoardRole;
  canManage: boolean;
  people: SharePerson[];
  invites: { email: string; role: ShareRole }[];
  link: ShareRole | null;
  url: string;
}

export interface OwnedBoard {
  id: string;
  title: string;
  inTrash: boolean;
  people: { key: string; name: string; role: BoardRole }[];
}

export const ROLE_NAMES: Record<BoardRole, string> = { owner: 'Besitzer:in', edit: 'Kann bearbeiten', comment: 'Kann kommentieren', view: 'Kann ansehen' };

const id = (s: string) => encodeURIComponent(s);

export const accountApi = {
  register: (b: { name: string; email: string; password: string; terms: boolean; captcha: string; website: string }) => request<{ ok: true; verified?: boolean }>('POST', '/api/auth/register', b),
  verify: (token: string) => request<{ email: string }>('POST', '/api/auth/verify', { token }),
  resend: (email: string) => request<{ ok: true }>('POST', '/api/auth/resend', { email }),
  login: (email: string, password: string) => request<{ user: User }>('POST', '/api/auth/login', { email, password }).then((r) => r.user),
  forgot: (email: string) => request<{ ok: true }>('POST', '/api/auth/forgot', { email }),
  reset: (token: string, password: string) => request<{ email: string }>('POST', '/api/auth/reset', { token, password }),

  account: () => request<{ account: { key: string; name: string; email: string; createdAt: string }; boards: OwnedBoard[] }>('GET', '/api/account'),
  rename: (name: string) => request<{ user: User }>('PATCH', '/api/account', { name }).then((r) => r.user),
  changePassword: (current: string, password: string) => request<{ ok: true }>('POST', '/api/account/password', { current, password }),
  deleteAccount: (password: string, boards: Record<string, string>) => request<{ ok: true }>('POST', '/api/account/delete', { password, boards }),
  /** „Meine Daten herunterladen“ (ZIP, Art. 20 DSGVO) – direkter Download über die Adresse (Cookie-Sitzung) */
  exportUrl: '/api/account/export',

  share: (boardId: string) => request<ShareInfo & { ok: true }>('GET', `/api/boards/${id(boardId)}/share`),
  invite: (boardId: string, emails: string[], role: ShareRole) => request<ShareInfo & { ok: true }>('POST', `/api/boards/${id(boardId)}/share`, { emails, role }),
  setRole: (boardId: string, key: string, role: ShareRole) => request<ShareInfo & { ok: true }>('PATCH', `/api/boards/${id(boardId)}/members/${id(key)}`, { role }),
  remove: (boardId: string, key: string) => request<(ShareInfo & { ok: true }) | { ok: true; left: true }>('DELETE', `/api/boards/${id(boardId)}/members/${id(key)}`),
  removeInvite: (boardId: string, email: string) => request<ShareInfo & { ok: true }>('DELETE', `/api/boards/${id(boardId)}/invites/${id(email)}`),
  setLink: (boardId: string, role: ShareRole | null) => request<ShareInfo & { ok: true }>('PUT', `/api/boards/${id(boardId)}/link`, { role }),
  transfer: (boardId: string, key: string) => request<ShareInfo & { ok: true }>('POST', `/api/boards/${id(boardId)}/owner`, { key }),
};
