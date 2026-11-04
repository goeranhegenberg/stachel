// Modus org: Anmeldung über den Identitätsdienst einer externen Organisation (docs/contract.md §1 „Org-Token prüfen“).
// Stachel kennt nur zwei Adressen: STACHEL_ORG_IDENTITY_URL prüft ein Org-Token, STACHEL_ORG_LOGIN_URL (optional) tauscht
// Benutzername + Passwort gegen ein Org-Token.

export interface Identity {
  userKey: string;
  name: string;
  isOrga: boolean;
}

export type VerifyResult =
  | { kind: 'ok'; identity: Identity }
  | { kind: 'invalid' }
  | { kind: 'pending' }
  /** Token gültig, aber Konto gesperrt bzw. ohne Zugang (Token nicht verwerfen). */
  | { kind: 'forbidden' }
  | { kind: 'unreachable' };

export type LoginResult =
  | { kind: 'ok'; token: string }
  | { kind: 'invalid' }
  | { kind: 'rate_limited' }
  | { kind: 'unreachable' };

/** Antwort des Identitätsdienstes (Vertrag §1). */
interface OrgMe {
  id?: unknown;
  name?: unknown;
  admin?: unknown;
  status?: unknown;
  error?: unknown;
}

export interface OrgIdentityOptions {
  identityUrl: string;
  /** leer = keine Passwort-Anmeldung */
  loginUrl: string;
  timeoutMs: number;
  /** Name der Organisation in Fehlermeldungen (STACHEL_ORG_NAME) */
  name: string;
}

/** Fehler zu einem Prüf-Ergebnis, fertig für sendError. */
export interface OrgError {
  status: number;
  error: string;
  message: string;
}

/** user_key-Präfixe, die Stachel selbst vergibt (eigene Konten, KI-Assistent) – nie aus dem Identitätsdienst. */
const RESERVED_KEY = /^(u|ai):/;
// eslint-disable-next-line no-control-regex
const BAD_KEY_CHARS = /[\s\u0000-\u001f\u007f]/;

/** `id` der Antwort → user_key, oder null wenn unbrauchbar. */
export function orgUserKey(id: unknown): string | null {
  const key = typeof id === 'number' && Number.isFinite(id) ? String(id) : typeof id === 'string' ? id : '';
  if (!key || key.length > 200 || BAD_KEY_CHARS.test(key) || RESERVED_KEY.test(key)) return null;
  return key;
}

export class OrgIdentityClient {
  constructor(private readonly opts: OrgIdentityOptions) {}

  /** Gibt es eine Passwort-Anmeldung (STACHEL_ORG_LOGIN_URL)? */
  get passwordLogin(): boolean {
    return !!this.opts.loginUrl;
  }

  /** Texte für Menschen, mit dem Namen der Organisation */
  get messages() {
    const org = this.opts.name;
    return {
      invalid_token: `Die Anmeldung bei ${org} ist ungültig. Bitte melde dich neu an.`,
      pending: `Dein Konto bei ${org} wartet noch auf Freigabe.`,
      forbidden: `Dein Konto bei ${org} ist für Stachel nicht freigeschaltet (gesperrt oder ohne Zugang).`,
      org_unreachable: `${org} ist gerade nicht erreichbar. Bitte versuch es gleich nochmal.`,
    };
  }

  /** Fehler für ein nicht erfolgreiches Prüf-Ergebnis (null bei `ok`). */
  verifyError(res: VerifyResult): OrgError | null {
    const m = this.messages;
    switch (res.kind) {
      case 'ok':
        return null;
      case 'invalid':
        return { status: 401, error: 'invalid_token', message: m.invalid_token };
      case 'pending':
        return { status: 403, error: 'pending', message: m.pending };
      case 'forbidden':
        return { status: 403, error: 'forbidden', message: m.forbidden };
      case 'unreachable':
        return { status: 502, error: 'org_unreachable', message: m.org_unreachable };
    }
  }

  private async call(url: string, init: RequestInit): Promise<Response | null> {
    if (!url) return null;
    try {
      return await fetch(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch {
      return null;
    }
  }

  async login(username: string, password: string): Promise<LoginResult> {
    const res = await this.call(this.opts.loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res) return { kind: 'unreachable' };
    if (res.status === 401 || res.status === 400) return { kind: 'invalid' };
    if (res.status === 429) return { kind: 'rate_limited' };
    if (!res.ok) return { kind: 'unreachable' };
    const body = (await res.json().catch(() => null)) as { token?: unknown } | null;
    if (!body || typeof body.token !== 'string' || !body.token) return { kind: 'unreachable' };
    return { kind: 'ok', token: body.token };
  }

  async verifyToken(token: string): Promise<VerifyResult> {
    const res = await this.call(this.opts.identityUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res) return { kind: 'unreachable' };
    const body = (await res.json().catch(() => null)) as OrgMe | null;
    if (res.status === 401) return { kind: 'invalid' };
    if (res.status === 403) return body?.error === 'pending' || body?.status === 'pending' ? { kind: 'pending' } : { kind: 'forbidden' };
    if (!res.ok || !body || typeof body !== 'object') return { kind: 'unreachable' };

    const userKey = orgUserKey(body.id);
    if (!userKey) return { kind: 'unreachable' };
    if (body.status === 'pending') return { kind: 'pending' };
    if (body.status !== 'active') return { kind: 'forbidden' };
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
    return { kind: 'ok', identity: { userKey, name: name || `Team-Mitglied ${userKey}`, isOrga: body.admin === true } };
  }
}
