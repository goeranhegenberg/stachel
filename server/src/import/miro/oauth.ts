// „Mit Miro verbinden“ (docs/features/import.md §1 Weg B, §2): OAuth 2.0 Authorization Code mit PKCE (S256) und `state`.
// `state` = 32 Byte Zufall, 10 min gültig, einmalig, nur im Speicher (mit Person, PKCE-Verifier, Client web|app und dem
// Hash der startenden Sitzung). Kommt der Rückruf in einem Browser ohne passende Sitzung an, legt die Bestätigungsseite den
// Code hier ab und bekommt eine `nonce`, die nur sie kennt (POST /api/import/miro/callback).
// Token-Tausch und Erneuern: `POST <api>/v1/oauth/token` (Parameter in der Query wie in Miros Doku), Widerruf
// `POST <api>/v2/oauth/revoke` (JSON). Nichts davon landet im Log oder in Fehlertexten.
import crypto from 'node:crypto';

export type OauthClient = 'web' | 'app';

export interface OauthSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** REST-Basis (Token, Widerruf) */
  apiBase: string;
  /** Freigabeseite */
  authBase: string;
}

export interface PendingState {
  userKey: string;
  userName: string;
  verifier: string;
  client: OauthClient;
  /** sha256 der Sitzung, die gestartet hat */
  sessionHash: string;
  expiresAt: number;
  /** Rückruf ohne passende Sitzung: Code bis zur Bestätigung */
  code?: string;
  nonce?: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Ablauf des Access-Tokens (ms) */
  expiresAt: number;
}

/** Miro lehnt Code bzw. Refresh-Token ab (`invalid`) oder ist nicht erreichbar (`unavailable`). */
export class OauthError extends Error {
  constructor(readonly kind: 'invalid' | 'unavailable') {
    super(kind === 'invalid' ? 'Miro lehnt die Freigabe ab' : 'Miro ist nicht erreichbar');
    this.name = 'OauthError';
  }
}

export const STATE_TTL_MS = 10 * 60_000;
const MAX_STATES = 10_000;

const b64url = (b: Buffer) => b.toString('base64url');
export const sha256 = (s: string) => b64url(crypto.createHash('sha256').update(s).digest());

/** PKCE: Verifier (43 Zeichen) und S256-Challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: sha256(verifier) };
}

/** Offene `state`-Werte im Speicher (einmalig, 10 min). */
export class OauthStates {
  private readonly map = new Map<string, PendingState>();

  constructor(private readonly now: () => number = Date.now) {}

  create(p: Omit<PendingState, 'verifier' | 'expiresAt'>): { state: string; challenge: string } {
    this.purge();
    if (this.map.size >= MAX_STATES) this.map.delete(this.map.keys().next().value!);
    const state = b64url(crypto.randomBytes(32));
    const { verifier, challenge } = pkcePair();
    this.map.set(state, { ...p, verifier, expiresAt: this.now() + STATE_TTL_MS });
    return { state, challenge };
  }

  /** gültiger Eintrag ohne ihn zu verbrauchen */
  peek(state: unknown): PendingState | null {
    if (typeof state !== 'string' || state.length > 100) return null;
    const p = this.map.get(state);
    if (!p) return null;
    if (p.expiresAt <= this.now()) {
      this.map.delete(state);
      return null;
    }
    return p;
  }

  /** einmalig einlösen */
  consume(state: unknown): PendingState | null {
    const p = this.peek(state);
    if (p) this.map.delete(state as string);
    return p;
  }

  /** Bestätigungsseite: Code ablegen, `nonce` erzeugen (bei erneutem Aufruf bleibt die erste). */
  attachCode(state: string, code: string): string | null {
    const p = this.peek(state);
    if (!p) return null;
    if (p.code && p.code !== code) return null; // derselbe state mit anderem Code: nicht überschreiben
    p.code = code;
    p.nonce ??= b64url(crypto.randomBytes(32));
    return p.nonce;
  }

  /** Bestätigung: state + nonce prüfen und einlösen (zeitkonstanter Vergleich). */
  confirm(state: unknown, nonce: unknown): PendingState | null {
    const p = this.peek(state);
    if (!p || !p.code || !p.nonce || typeof nonce !== 'string') return null;
    const a = Buffer.from(p.nonce);
    const b = Buffer.from(nonce);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    this.map.delete(state as string);
    return p;
  }

  forgetUser(userKey: string) {
    for (const [k, v] of this.map) if (v.userKey === userKey) this.map.delete(k);
  }

  purge() {
    const now = this.now();
    for (const [k, v] of this.map) if (v.expiresAt <= now) this.map.delete(k);
  }
}

/** Adresse der Miro-Freigabeseite (Scope nur boards:read). */
export function authorizeUrl(s: OauthSettings, state: string, challenge: string): string {
  const u = new URL('/oauth/authorize', s.authBase);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', s.clientId);
  u.searchParams.set('redirect_uri', s.redirectUri);
  u.searchParams.set('scope', 'boards:read');
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

async function tokenCall(s: OauthSettings, params: Record<string, string>, fetchImpl: typeof fetch, now: () => number): Promise<TokenSet> {
  const u = new URL('/v1/oauth/token', s.apiBase);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetchImpl(u, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    });
  } catch {
    throw new OauthError('unavailable');
  }
  if (res.status >= 500 || res.status === 429) {
    await res.body?.cancel().catch(() => {});
    throw new OauthError('unavailable');
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* unten als ungültig */
  }
  const access = typeof body.access_token === 'string' ? body.access_token : '';
  if (!res.ok || !access) throw new OauthError(res.ok ? 'unavailable' : 'invalid');
  const expiresIn = Number(body.expires_in);
  return {
    accessToken: access,
    refreshToken: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null,
    // eine Minute Puffer; ohne Angabe 1 h wie Miros Vorgabe
    expiresAt: now() + Math.max(60, Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000 - 60_000,
  };
}

/** Code gegen Tokens tauschen (mit PKCE-Verifier). */
export function exchangeCode(s: OauthSettings, code: string, verifier: string, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Promise<TokenSet> {
  return tokenCall(
    s,
    { grant_type: 'authorization_code', client_id: s.clientId, client_secret: s.clientSecret, code, redirect_uri: s.redirectUri, code_verifier: verifier },
    fetchImpl,
    now,
  );
}

/** Erneuern: liefert neues Access- und (bei Miro immer) neues Refresh-Token. */
export function refreshTokens(s: OauthSettings, refreshToken: string, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Promise<TokenSet> {
  return tokenCall(s, { grant_type: 'refresh_token', client_id: s.clientId, client_secret: s.clientSecret, refresh_token: refreshToken }, fetchImpl, now);
}

/** Widerruf bei Miro; Fehler sind nicht fatal (false). */
export async function revokeToken(s: OauthSettings, accessToken: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(new URL('/v2/oauth/revoke', s.apiBase), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ accessToken, clientId: s.clientId, clientSecret: s.clientSecret }),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    await res.body?.cancel().catch(() => {});
    return res.ok;
  } catch {
    return false;
  }
}
