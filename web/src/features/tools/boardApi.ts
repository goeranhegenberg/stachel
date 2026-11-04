// Board-Endpunkte des Moduls (docs/contract.md §3): Kopieren bzw. als Vorlage speichern.
import type { BoardInfo } from '../../protocol';
import { CSRF_HEADER } from '../../protocol';
import { ApiError } from '../../api';

/** Board kopieren (`template: true` = als Vorlage speichern). */
export async function duplicateBoard(id: string, opts: { title?: string; template?: boolean } = {}): Promise<BoardInfo> {
  let res: Response;
  try {
    res = await fetch(`/api/boards/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', [CSRF_HEADER]: '1' },
      body: JSON.stringify(opts),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('network', 0);
  }
  const data = (await res.json().catch(() => null)) as { ok?: boolean; board?: BoardInfo; error?: string; message?: string } | null;
  if (!res.ok || !data?.ok || !data.board) throw new ApiError(data?.error ?? (res.status >= 500 ? 'server' : 'bad_request'), res.status, data?.message);
  return data.board;
}
