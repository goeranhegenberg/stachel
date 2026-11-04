// HTTP-Client für die Miro-REST-API (docs/features/import.md §3 „Ratenlimits“): Zeitlimit 30 s je Anfrage, Cursor- und
// Offset-Seiten, `X-RateLimit-Remaining/-Reset` (bei knappem Rest vorab warten), 429/5xx/Netzfehler mit exponentiellem
// Backoff (1, 2, 4 … 60 s bzw. `Retry-After`, höchstens 6 Versuche), 401 → einmal erneuern (OAuth), sonst MiroAuthError.
// Fehlertexte enthalten nie Token, Adressen mit Signatur oder Antwortinhalte. Uhr und Warten sind für Tests injizierbar.

/** Zugang zu Miro: aktuelles Access-Token, bei OAuth erneuerbar (`refresh` → neues Token oder null). */
export interface MiroAuth {
  token(): Promise<string>;
  refresh?(): Promise<string | null>;
}

/** Miro lehnt das Token ab (abgelaufen, widerrufen, ungültig). */
export class MiroAuthError extends Error {
  constructor() {
    super('Miro hat den Zugang abgelehnt');
    this.name = 'MiroAuthError';
  }
}

/** Andere Fehler der Miro-API; `status` 0 = nicht erreichbar bzw. nach allen Versuchen gescheitert. */
export class MiroApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MiroApiError';
  }
}

/** Abbruch (Job abgebrochen). */
export class ImportAbortError extends Error {
  constructor() {
    super('abgebrochen');
    this.name = 'ImportAbortError';
  }
}

export interface MiroClientOptions {
  /** REST-Basis, z. B. https://api.miro.com (Tests: Fake-Miro) */
  base: string;
  auth: MiroAuth;
  signal?: AbortSignal;
  /** Warten (Tests: sofort, mit Protokoll) */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** höchstens so viele Versuche je Anfrage (429/5xx/Netz) */
  maxAttempts?: number;
  /** ab so wenigen Credits vorab bis zum Reset warten */
  lowCredits?: number;
  /** vor jedem Warten (Status 0 = Netzfehler/Zeitlimit, `credits` = knappe Credits) – nur Zahlen, fürs Log */
  onWait?: (reason: number | 'credits', ms: number) => void;
}

export type Query = Record<string, string | number | boolean | undefined>;

const MAX_WAIT_MS = 60_000;

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ImportAbortError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new ImportAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** `Retry-After` (Sekunden oder HTTP-Datum) in ms; null = fehlt/unbrauchbar. */
export function retryAfterMs(v: string | null, now: number): number | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

/** `X-RateLimit-Reset`: Unix-Zeit in s (Miro) oder Sekunden bis zum Reset; ms bis dahin, höchstens 60 s. */
export function resetWaitMs(v: string | null, now: number): number {
  const n = Number(v);
  if (!v || !Number.isFinite(n) || n <= 0) return 0;
  const ms = n > 1e9 ? n * 1000 - now : n * 1000;
  return Math.min(MAX_WAIT_MS, Math.max(0, Math.round(ms)));
}

export class MiroClient {
  readonly base: string;
  private readonly auth: MiroAuth;
  private readonly signal: AbortSignal | undefined;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly lowCredits: number;
  private readonly onWait: MiroClientOptions['onWait'];
  /** vor der nächsten Anfrage so lange warten (knappe Credits) */
  private waitUntil = 0;
  /** Zahl der Anfragen (Fortschritt, Tests) */
  requests = 0;

  constructor(o: MiroClientOptions) {
    this.base = o.base.replace(/\/+$/, '');
    this.auth = o.auth;
    this.signal = o.signal;
    this.sleep = o.sleep ?? abortableSleep;
    this.now = o.now ?? Date.now;
    this.fetchImpl = o.fetch ?? fetch;
    this.timeoutMs = o.timeoutMs ?? 30_000;
    this.maxAttempts = Math.max(1, o.maxAttempts ?? 6);
    this.lowCredits = o.lowCredits ?? 1_000;
    this.onWait = o.onWait;
  }

  /** Adresse unter der API-Basis (Pfad mit `/`, oder volle Adresse mit genau dieser Basis). */
  url(pathOrUrl: string, query?: Query): URL {
    const u = /^https?:\/\//i.test(pathOrUrl) ? new URL(pathOrUrl) : new URL(this.base + pathOrUrl);
    if (u.origin !== new URL(this.base).origin) throw new MiroApiError(0, 'Adresse liegt nicht bei der Miro-API');
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
    return u;
  }

  /** GET mit JSON-Antwort. */
  async get<T = any>(pathOrUrl: string, query?: Query): Promise<T> {
    return (await this.request(this.url(pathOrUrl, query))) as T;
  }

  /** Alle Seiten eines Cursor-Endpunkts (`data`, `cursor`), je Seite einmal geliefert. */
  async *cursorPages<T = any>(path: string, query: Query = {}, limit = 50): AsyncGenerator<{ data: T[]; total?: number }> {
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (;;) {
      const res = (await this.get(path, { ...query, limit, cursor })) as { data?: T[]; cursor?: string; total?: number };
      const data = Array.isArray(res?.data) ? res.data : [];
      yield { data, ...(typeof res?.total === 'number' ? { total: res.total } : {}) };
      cursor = typeof res?.cursor === 'string' && res.cursor ? res.cursor : undefined;
      if (!cursor || !data.length || seen.has(cursor)) return;
      seen.add(cursor);
    }
  }

  /** Alle Seiten eines Offset-Endpunkts (`data`, `total`, `offset`, `size`). */
  async *offsetPages<T = any>(path: string, query: Query = {}, limit = 50): AsyncGenerator<{ data: T[]; total?: number }> {
    let offset = 0;
    for (let guard = 0; guard < 10_000; guard++) {
      const res = (await this.get(path, { ...query, limit, offset })) as { data?: T[]; total?: number };
      const data = Array.isArray(res?.data) ? res.data : [];
      yield { data, ...(typeof res?.total === 'number' ? { total: res.total } : {}) };
      offset += data.length;
      if (!data.length || data.length < limit || (typeof res?.total === 'number' && offset >= res.total)) return;
    }
  }

  private checkAbort() {
    if (this.signal?.aborted) throw new ImportAbortError();
  }

  private async request(u: URL): Promise<unknown> {
    let refreshed = false;
    let lastStatus = 0;
    for (let attempt = 0; attempt < this.maxAttempts; ) {
      this.checkAbort();
      const pause = this.waitUntil - this.now();
      if (pause > 0) {
        this.onWait?.('credits', Math.min(pause, MAX_WAIT_MS));
        await this.sleep(Math.min(pause, MAX_WAIT_MS), this.signal);
      }
      const token = await this.auth.token();
      let res: Response;
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const signal = this.signal ? AbortSignal.any([this.signal, timeout]) : timeout;
      try {
        this.requests++;
        res = await this.fetchImpl(u, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal, redirect: 'error' });
      } catch {
        this.checkAbort();
        // Netzfehler oder Zeitlimit: wie 5xx
        lastStatus = 0;
        await this.backoff(attempt++, null, 0);
        continue;
      }
      this.noteRateLimit(res.headers);
      if (res.status === 401) {
        await res.body?.cancel().catch(() => {});
        if (!refreshed && this.auth.refresh) {
          refreshed = true;
          if (await this.auth.refresh()) continue;
        }
        throw new MiroAuthError();
      }
      if (res.status === 429 || res.status >= 500) {
        lastStatus = res.status;
        await res.body?.cancel().catch(() => {});
        await this.backoff(attempt++, res.headers.get('retry-after'), res.status);
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new MiroApiError(res.status, `Miro antwortet mit ${res.status}`);
      }
      try {
        const text = await res.text();
        return text ? JSON.parse(text) : {};
      } catch {
        this.checkAbort();
        throw new MiroApiError(0, 'Antwort von Miro unlesbar');
      }
    }
    throw new MiroApiError(lastStatus === 429 ? 429 : 0, lastStatus === 429 ? 'Miro bremst (zu viele Anfragen)' : 'Miro ist nicht erreichbar');
  }

  private noteRateLimit(h: Headers) {
    const remaining = Number(h.get('x-ratelimit-remaining'));
    if (h.get('x-ratelimit-remaining') === null || !Number.isFinite(remaining) || remaining > this.lowCredits) return;
    const wait = resetWaitMs(h.get('x-ratelimit-reset'), this.now());
    if (wait > 0) this.waitUntil = Math.max(this.waitUntil, this.now() + wait);
  }

  private async backoff(attempt: number, retryAfter: string | null, status: number) {
    if (attempt + 1 >= this.maxAttempts) return; // letzter Versuch: nicht mehr warten
    const ms = Math.min(MAX_WAIT_MS, retryAfterMs(retryAfter, this.now()) ?? 1000 * 2 ** attempt);
    this.onWait?.(status, ms);
    await this.sleep(ms, this.signal);
  }
}
