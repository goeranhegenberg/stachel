// Versions-Endpunkte (docs/contract.md §3 „Versionen“).
import { CSRF_HEADER, type BoardInfo, type BoardVersionInfo } from '../../protocol';
import { ApiError } from '../../api';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers[CSRF_HEADER] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new ApiError('network', 0);
  }
  const data = (await res.json().catch(() => null)) as ({ ok?: boolean; error?: string; message?: string } & T) | null;
  if (!res.ok || !data?.ok) throw new ApiError(data?.error ?? (res.status >= 500 ? 'server' : 'bad_request'), res.status, data?.message);
  return data;
}

const base = (boardId: string) => `/api/boards/${encodeURIComponent(boardId)}/versions`;
const one = (boardId: string, id: string) => `${base(boardId)}/${encodeURIComponent(id)}`;

export interface RestoreResult {
  backup: BoardVersionInfo | null;
  restored: BoardVersionInfo | null;
  changed: boolean;
}

export const versionsApi = {
  list: (boardId: string) => call<{ versions: BoardVersionInfo[] }>('GET', base(boardId)).then((r) => r.versions),
  /** Inhalt einer Version als Yjs-Update (der Browser entpackt Brotli selbst). */
  async content(boardId: string, id: string): Promise<Uint8Array> {
    let res: Response;
    try {
      res = await fetch(one(boardId, id), { credentials: 'same-origin' });
    } catch {
      throw new ApiError('network', 0);
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
      throw new ApiError(data?.error ?? (res.status >= 500 ? 'server' : 'bad_request'), res.status, data?.message);
    }
    return new Uint8Array(await res.arrayBuffer());
  },
  save: (boardId: string, name: string) => call<{ version: BoardVersionInfo }>('POST', base(boardId), { name }).then((r) => r.version),
  rename: (boardId: string, id: string, name: string) => call<{ version: BoardVersionInfo }>('PATCH', one(boardId, id), { name }).then((r) => r.version),
  restore: (boardId: string, id: string) => call<RestoreResult>('POST', `${one(boardId, id)}/restore`),
  copy: (boardId: string, id: string, title?: string) => call<{ board: BoardInfo }>('POST', `${one(boardId, id)}/copy`, { title }).then((r) => r.board),
};
