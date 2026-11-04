import crypto from 'node:crypto';
import { REVERIFY_HOURS, SESSION_DAYS, type User } from '../../shared/protocol.js';
import { nowIso, type Db } from './db.js';
import type { Identity, OrgIdentityClient } from './org-identity.js';
import { TokenCrypt } from './token-crypt.js';

export interface Session {
  id: string;
  userKey: string;
  name: string;
  isOrga: boolean;
  orgToken: string;
  createdAt: string;
  verifiedAt: string;
  expiresAt: string;
}

interface SessionRow {
  id: string;
  user_key: string;
  name: string;
  is_orga: number;
  org_token: string;
  created_at: string;
  verified_at: string;
  expires_at: string;
}

const DAY_MS = 24 * 3600 * 1000;

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('base64url');
export const randomToken = (bytes: number) => crypto.randomBytes(bytes).toString('base64url');

export function toUser(s: Pick<Session, 'userKey' | 'name' | 'isOrga'>): User {
  return { key: s.userKey, name: s.name, isOrga: s.isOrga };
}

function fromRow(r: SessionRow, crypt: TokenCrypt): Session {
  return {
    id: r.id,
    userKey: r.user_key,
    name: r.name,
    isOrga: r.is_orga === 1,
    orgToken: crypt.open(r.org_token),
    createdAt: r.created_at,
    verifiedAt: r.verified_at,
    expiresAt: r.expires_at,
  };
}

export class SessionStore {
  private inflight = new Map<string, Promise<Session | null>>();

  constructor(
    private readonly db: Db,
    /** Nachprüfung: Identitätsdienst (Modus org) bzw. im Modus local die eigenen Konten (accounts.ts) */
    private readonly verifier: Pick<OrgIdentityClient, 'verifyToken'>,
    /** Org-Token verschlüsselt speichern (token-crypt.ts, STACHEL_TOKEN_KEY) */
    private readonly crypt: TokenCrypt = TokenCrypt.plain,
  ) {}

  /**
   * Legt eine Sitzung an und liefert den Cookie-Wert (nur der Hash wird gespeichert). `prefix`: App-Sitzungen der
   * Native-API bekommen `sts_` (Bearer-Token statt Cookie, docs/contract.md §8.1).
   */
  create(identity: Identity, orgToken: string, prefix = ''): { cookie: string; session: Session } {
    const cookie = prefix + randomToken(32);
    const now = new Date();
    const session: Session = {
      id: sha256(cookie),
      userKey: identity.userKey,
      name: identity.name,
      isOrga: identity.isOrga,
      orgToken,
      createdAt: now.toISOString(),
      verifiedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_DAYS * DAY_MS).toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO sessions (id, user_key, name, is_orga, org_token, created_at, verified_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.userKey,
        session.name,
        session.isOrga ? 1 : 0,
        this.crypt.seal(orgToken),
        session.createdAt,
        session.verifiedAt,
        session.expiresAt,
      );
    return { cookie, session };
  }

  /** Sitzung zum Cookie, ohne Nachprüfung; abgelaufene werden gelöscht. */
  get(cookie: string | undefined): Session | null {
    if (!cookie || cookie.length > 200) return null;
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sha256(cookie)) as SessionRow | undefined;
    if (!row) return null;
    if (row.expires_at <= nowIso()) {
      this.deleteById(row.id);
      return null;
    }
    return fromRow(row, this.crypt);
  }

  /**
   * Sitzung zum Cookie; ist sie älter als REVERIFY_HOURS geprüft, wird das Org-Token neu geprüft.
   * Ungültiges Token → Sitzung gelöscht (null). Netzfehler → Sitzung bleibt.
   */
  async getVerified(cookie: string | undefined): Promise<Session | null> {
    const session = this.get(cookie);
    if (!session) return null;
    const age = Date.now() - Date.parse(session.verifiedAt);
    if (age < REVERIFY_HOURS * 3600 * 1000) return session;
    let p = this.inflight.get(session.id);
    if (!p) {
      p = this.reverify(session).finally(() => this.inflight.delete(session.id));
      this.inflight.set(session.id, p);
    }
    return p;
  }

  private async reverify(session: Session): Promise<Session | null> {
    const res = await this.verifier.verifyToken(session.orgToken);
    if (res.kind === 'unreachable') return session;
    if (res.kind !== 'ok') {
      this.deleteById(session.id);
      return null;
    }
    const now = new Date();
    const updated: Session = {
      ...session,
      name: res.identity.name,
      isOrga: res.identity.isOrga,
      verifiedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_DAYS * DAY_MS).toISOString(),
    };
    this.db
      .prepare('UPDATE sessions SET name = ?, is_orga = ?, verified_at = ?, expires_at = ? WHERE id = ?')
      .run(updated.name, updated.isOrga ? 1 : 0, updated.verifiedAt, updated.expiresAt, session.id);
    return updated;
  }

  delete(cookie: string | undefined): void {
    if (cookie) this.deleteById(sha256(cookie));
  }

  private deleteById(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  /** Nur für Tests/Wartung: verified_at zurückdatieren. */
  setVerifiedAt(cookie: string, iso: string): void {
    this.db.prepare('UPDATE sessions SET verified_at = ? WHERE id = ?').run(iso, sha256(cookie));
  }

  purgeExpired(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
  }
}
