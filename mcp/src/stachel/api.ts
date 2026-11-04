// HTTP-API von Stachel mit persönlichem API-Token (docs/contract.md §3, „KI-Zugang (MCP)“).

export interface StachelUser {
  key: string;
  name: string;
  isOrga: boolean;
}

export interface Identity {
  user: StachelUser;
  /** So erscheint der Assistent im Board (Anwesenheit, Versionen): key `ai:<user_key>`, Name „KI (für …)“ */
  ai: StachelUser;
  token: { id: string; label: string };
}

export interface BoardInfo {
  id: string;
  title: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  template?: boolean;
  favorite?: boolean;
  /** Modus mit eigenen Konten: eigene Rolle (owner/edit/comment/view); fehlt = bearbeiten */
  role?: string;
}

export class StachelError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class StachelApi {
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    readonly token: string,
    private readonly timeoutMs = 20_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  get authHeader() {
    return `Bearer ${this.token}`;
  }

  async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: {
          Authorization: this.authHeader,
          'X-Stachel': '1',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new StachelError(0, 'unreachable', `Stachel unter ${this.baseUrl} ist nicht erreichbar (${(e as Error).message}). Adresse prüfen bzw. später nochmal versuchen.`);
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // kein JSON
    }
    if (!res.ok || json?.ok === false) {
      const code = json?.error ?? `http_${res.status}`;
      let msg = json?.message ?? `Stachel antwortet mit HTTP ${res.status}.`;
      if (res.status === 401) msg = 'Das API-Token ist ungültig oder widerrufen. Bitte in Stachel unter „KI-Zugang (MCP)“ ein neues anlegen.';
      throw new StachelError(res.status, code, msg);
    }
    return json as T;
  }

  me(): Promise<Identity> {
    return this.req<Identity & { ok: true }>('GET', '/api/tokens/me');
  }

  async boards(): Promise<BoardInfo[]> {
    return (await this.req<{ boards: BoardInfo[] }>('GET', '/api/boards')).boards;
  }

  async createBoard(title: string): Promise<BoardInfo> {
    return (await this.req<{ board: BoardInfo }>('POST', '/api/boards', { title })).board;
  }

  async users(): Promise<{ key: string; name: string }[]> {
    return (await this.req<{ users: { key: string; name: string }[] }>('GET', '/api/users')).users;
  }

  /** Bild (bzw. verkleinerte Fassung) für den Bildschirmfoto-Renderer. */
  async image(path: string): Promise<{ body: Buffer; type: string } | null> {
    try {
      const res = await fetch(this.baseUrl + path, { headers: { Authorization: this.authHeader }, signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) return null;
      return { body: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') ?? 'application/octet-stream' };
    } catch {
      return null;
    }
  }

  /** WebSocket-Adresse des Sync-Servers. */
  get syncUrl(): string {
    return `${this.baseUrl.replace(/^http/, 'ws')}/sync`;
  }
}
