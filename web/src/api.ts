// HTTP-Client für docs/contract.md (§2 Auth, §3 Boards).
import { CSRF_HEADER, type BoardInfo, type User } from './protocol';

/** Deutsche Texte zu allen Fehlercodes aus dem Vertrag (plus Client-eigene). */
export const ERROR_TEXT: Record<string, string> = {
  invalid_credentials: 'Benutzername oder Passwort stimmt nicht.',
  rate_limited: 'Zu viele Versuche. Bitte warte ein paar Minuten und versuch es dann noch einmal.',
  pending: 'Dein Konto wartet noch auf Freigabe.',
  expired: 'Der QR-Code ist abgelaufen. Ein neuer wird erzeugt.',
  wrong_browser: 'Dieser QR-Code gehört zu einem anderen Browserfenster. Ein neuer wird erzeugt.',
  invalid_token: 'Die App ist nicht mehr angemeldet. Bitte melde dich in der App neu an.',
  unknown_code: 'Diesen QR-Code kennt Stachel nicht (mehr).',
  already_used: 'Dieser QR-Code wurde schon benutzt.',
  not_logged_in: 'Du bist nicht (mehr) angemeldet.',
  forbidden: 'Das darfst du nicht. Nur wer das Board angelegt hat oder zur Orga gehört, kann es löschen.',
  not_found: 'Das gibt es nicht (mehr).',
  too_large: 'Die Datei ist zu groß.',
  quota_exceeded: 'Dein Speicherplatz ist voll. Lösche Boards, die du nicht mehr brauchst, und leere den Papierkorb.',
  board_limit: 'Du hast zu viele Boards. Lösche alte Boards und leere den Papierkorb.',
  unsupported_type: 'Dieses Dateiformat geht nicht. Erlaubt sind PNG, JPEG, WebP und GIF.',
  bad_request: 'Die Anfrage war unvollständig.',
  invalid_input: 'Die Eingabe passt nicht (z. B. Titel länger als 120 Zeichen).',
  csrf: 'Sicherheitsprüfung fehlgeschlagen. Bitte lade die Seite neu.',
  unknown_board: 'Dieses Board wurde gelöscht oder es gibt es nicht.',
  in_trash: 'Dieses Board liegt im Papierkorb. Stell es dort wieder her, um es zu bearbeiten.',
  network: 'Keine Verbindung zum Stachel-Server. Prüfe dein Netz.',
  server: 'Der Server hat gerade ein Problem. Versuch es gleich noch einmal.',
  org_unreachable: 'Der Anmeldedienst ist gerade nicht erreichbar. Versuch es gleich noch einmal.',
};

/**
 * Codes, bei denen der Text des Servers genauer ist (Grenzen der Instanz, z. B. „höchstens 15 MB“, belegter Speicher;
 * Modus org: Name der Organisation, z. B. „Dein Konto bei … wartet noch auf Freigabe.“).
 */
const SERVER_TEXT = new Set(['too_large', 'quota_exceeded', 'board_limit', 'pending', 'org_unreachable']);

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message?: string) {
    super((SERVER_TEXT.has(code) && message) || (ERROR_TEXT[code] ?? message ?? ERROR_TEXT.server));
    this.code = code;
    this.status = status;
  }
}

export const errorText = (e: unknown): string => (e instanceof ApiError ? e.message : ERROR_TEXT.server);

export async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers[CSRF_HEADER] = '1';
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', ...init });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('network', 0);
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* kein JSON */
  }
  if (!res.ok || !data || data.ok === false) {
    const code = typeof data?.error === 'string' ? data.error : res.status === 413 ? 'too_large' : res.status >= 500 ? 'server' : 'bad_request';
    throw new ApiError(code, res.status, typeof data?.message === 'string' ? data.message : undefined);
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: User }>('GET', '/api/auth/me').then((r) => r.user),
  passwordLogin: (username: string, password: string) =>
    request<{ user: User }>('POST', '/api/auth/password', { username, password }).then((r) => r.user),
  qrStart: () => request<{ code: string; url: string; expires_at: string }>('POST', '/api/auth/qr'),
  qrWait: (code: string, signal: AbortSignal) =>
    request<{ status: 'pending' | 'approved'; user?: User }>('GET', `/api/auth/qr/${encodeURIComponent(code)}/wait`, undefined, {
      signal,
    }),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),

  /** `open`: Board, das gerade geöffnet wird (Modus local: per Freigabelink beigetreten, docs/contract.md §6) */
  boards: (open?: string) => request<{ boards: BoardInfo[] }>('GET', open ? `/api/boards?open=${encodeURIComponent(open)}` : '/api/boards').then((r) => r.boards),
  createBoard: (title: string) => request<{ board: BoardInfo }>('POST', '/api/boards', { title }).then((r) => r.board),
  renameBoard: (id: string, title: string) =>
    request<{ board: BoardInfo }>('PATCH', `/api/boards/${encodeURIComponent(id)}`, { title }).then((r) => r.board),
  deleteBoard: (id: string) => request<{ ok: true }>('DELETE', `/api/boards/${encodeURIComponent(id)}`),
  uploadImage: (boardId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ image: { id: string; url: string; width: number; height: number } }>(
      'POST',
      `/api/boards/${encodeURIComponent(boardId)}/images`,
      fd,
    ).then((r) => r.image);
  },
};

export const imageUrl = (id: string) => `/api/images/${encodeURIComponent(id)}`;
