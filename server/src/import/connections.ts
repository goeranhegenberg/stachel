// Zugänge zu Miro für Board-Liste und Jobs (docs/features/import.md §1):
// - Weg A: persönliches Token als Verbindung `conn` – nur im Speicher, 60 min, an die Person gebunden, ID zufällig.
// - Weg B: `conn = "oauth"` – Refresh-Token verschlüsselt in import_links (links.ts), Access-Token nur im Speicher bis
//   zum Ablauf; Erneuern speichert das neue Refresh-Token (Miro rotiert es), je Person nur ein Erneuern gleichzeitig.
import crypto from 'node:crypto';
import { MiroApiError, MiroAuthError, type MiroAuth } from './miro/client.js';
import { OauthError, refreshTokens, revokeToken, type OauthSettings, type TokenSet } from './miro/oauth.js';
import type { ImportLinks } from './links.js';

export const CONN_TTL_MS = 60 * 60_000;
const MAX_CONNS_PER_USER = 5;
const PROVIDER = 'miro';

interface TokenConn {
  userKey: string;
  token: string;
  expiresAt: number;
}

export class MiroAccess {
  private readonly conns = new Map<string, TokenConn>();
  private readonly access = new Map<string, { token: string; expiresAt: number }>();
  private readonly refreshing = new Map<string, Promise<string | null>>();
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly links: ImportLinks,
    readonly oauth: OauthSettings | null,
    opts: { now?: () => number; fetch?: typeof fetch } = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  // ---- Weg A ----

  addToken(userKey: string, token: string): { conn: string; expiresAt: number } {
    this.purge();
    const mine = [...this.conns].filter(([, c]) => c.userKey === userKey).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    while (mine.length >= MAX_CONNS_PER_USER) this.conns.delete(mine.shift()![0]);
    const conn = `mc_${crypto.randomBytes(24).toString('base64url')}`;
    const expiresAt = this.now() + CONN_TTL_MS;
    this.conns.set(conn, { userKey, token, expiresAt });
    return { conn, expiresAt };
  }

  dropConn(userKey: string, conn: string) {
    if (this.conns.get(conn)?.userKey === userKey) this.conns.delete(conn);
  }

  // ---- Weg B ----

  connected(userKey: string): boolean {
    return !!this.oauth && this.links.has(userKey, PROVIDER);
  }

  /** nach dem Code-Tausch: Refresh-Token speichern, Access-Token merken */
  connect(userKey: string, t: TokenSet) {
    if (t.refreshToken) this.links.save(userKey, PROVIDER, t.refreshToken);
    this.access.set(userKey, { token: t.accessToken, expiresAt: t.expiresAt });
  }

  /** Verbindung trennen: Widerruf bei Miro versuchen (nicht fatal), Zeile und Speicher löschen. */
  async disconnect(userKey: string): Promise<void> {
    if (this.oauth && this.links.has(userKey, PROVIDER)) {
      let token = this.validAccess(userKey);
      if (!token) token = await this.refresh(userKey).catch(() => null);
      if (token) await revokeToken(this.oauth, token, this.fetchImpl);
    }
    this.links.remove(userKey, PROVIDER);
    this.access.delete(userKey);
  }

  /** Konto löschen: Widerruf versuchen, alles der Person vergessen. */
  async forgetUser(userKey: string): Promise<void> {
    await this.disconnect(userKey).catch(() => this.links.remove(userKey, PROVIDER));
    this.links.forgetUser(userKey);
    for (const [k, c] of this.conns) if (c.userKey === userKey) this.conns.delete(k);
  }

  // ---- Zugang für Client und Jobs ----

  /** Zugang zur Verbindung `conn` der Person; null = unbekannt/abgelaufen/fremd. */
  auth(userKey: string, conn: unknown): MiroAuth | null {
    if (conn === 'oauth') {
      if (!this.connected(userKey)) return null;
      return {
        token: async () => {
          const t = this.validAccess(userKey) ?? (await this.refresh(userKey));
          if (!t) throw new MiroAuthError();
          this.links.touch(userKey, PROVIDER);
          return t;
        },
        refresh: () => this.refresh(userKey),
      };
    }
    if (typeof conn !== 'string' || conn.length > 100) return null;
    const c = this.conns.get(conn);
    if (!c || c.userKey !== userKey) return null;
    if (c.expiresAt <= this.now()) {
      this.conns.delete(conn);
      return null;
    }
    // der Job behält das Token, auch wenn die Verbindung danach abläuft
    const token = c.token;
    return { token: async () => token };
  }

  private validAccess(userKey: string): string | null {
    const a = this.access.get(userKey);
    return a && a.expiresAt > this.now() ? a.token : null;
  }

  /** Access-Token erneuern; null = Verbindung ungültig (Zeile gelöscht). Wirft MiroApiError, wenn Miro nicht erreichbar ist. */
  refresh(userKey: string): Promise<string | null> {
    const running = this.refreshing.get(userKey);
    if (running) return running;
    const p = (async () => {
      if (!this.oauth) return null;
      const refreshToken = this.links.load(userKey, PROVIDER);
      if (!refreshToken) return null;
      try {
        const t = await refreshTokens(this.oauth, refreshToken, this.fetchImpl, this.now);
        this.connect(userKey, t);
        return t.accessToken;
      } catch (e) {
        if (e instanceof OauthError && e.kind === 'invalid') {
          this.links.remove(userKey, PROVIDER);
          this.access.delete(userKey);
          return null;
        }
        throw new MiroApiError(0, 'Miro ist nicht erreichbar');
      }
    })().finally(() => this.refreshing.delete(userKey));
    this.refreshing.set(userKey, p);
    return p;
  }

  purge() {
    const now = this.now();
    for (const [k, c] of this.conns) if (c.expiresAt <= now) this.conns.delete(k);
    for (const [k, a] of this.access) if (a.expiresAt <= now) this.access.delete(k);
  }
}
