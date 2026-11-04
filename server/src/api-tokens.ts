// Persönliche API-Tokens für KI-Assistenten (MCP-Server unter mcp/). Vertrag: docs/contract.md §3 „KI-Zugang (MCP)“,
// Bedienung: docs/features/mcp.md.
//
// - Ein Token gehört einer Person und hat deren Rechte (Bearer statt Cookie, HTTP und Sync).
// - Gespeichert wird nur der SHA-256-Hash; den Klartext sieht man genau einmal beim Anlegen.
// - Widerrufen löscht den Eintrag und trennt offene Sync-Verbindungen des Tokens.
// - Wie Sitzungen wird das Org-Token der Person alle REVERIFY_HOURS nachgeprüft (gesperrt → Token ungültig).
// - Im Sync erscheint der Assistent als eigene Person „KI (für <Name>)“ mit user.key `ai:<user_key>`; Rechte prüft
//   der Server mit der Person, der das Token gehört.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Hocuspocus } from '@hocuspocus/server';
import { REVERIFY_HOURS, type User } from '../../shared/protocol.js';
import { nowIso, type Db } from './db.js';
import { sendError } from './http-util.js';
import type { OrgIdentityClient } from './org-identity.js';
import { randomToken, sha256, type Session } from './sessions.js';
import { TokenCrypt } from './token-crypt.js';

export const API_TOKEN_PREFIX = 'stk_';
export const MAX_TOKENS_PER_USER = 20;
const MAX_LABEL = 60;
/** last_used_at höchstens so oft schreiben */
const TOUCH_MS = 60_000;
/** Ein Token verfällt, wenn es so lange nicht benutzt wurde (CR-9); legal.ts löscht es dann auch. */
export const TOKEN_UNUSED_DAYS = 365;
const UNUSED_MS = TOKEN_UNUSED_DAYS * 24 * 3600_000;
/** Ablauf der Sitzung eines Tokens: keiner – es gilt, bis es widerrufen wird, 12 Monate unbenutzt bleibt oder das Konto nicht mehr gilt. */
const NO_EXPIRY = '9999-12-31T23:59:59.999Z';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,  -- sha256 des Tokens (base64url)
  user_key TEXT NOT NULL,
  name TEXT NOT NULL,
  is_orga INTEGER NOT NULL,
  org_token TEXT NOT NULL,     -- aus der Sitzung, mit der das Token angelegt wurde (Nachprüfung)
  label TEXT NOT NULL,
  hint TEXT NOT NULL,               -- letzte 4 Zeichen, zum Wiedererkennen
  created_at TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS api_tokens_user ON api_tokens(user_key);
`;

interface TokenRow {
  id: string;
  token_hash: string;
  user_key: string;
  name: string;
  is_orga: number;
  org_token: string;
  label: string;
  hint: string;
  created_at: string;
  verified_at: string;
  last_used_at: string | null;
}

/** Token-Angaben für die Oberfläche (ohne Geheimnis). */
export interface ApiTokenInfo {
  id: string;
  label: string;
  hint: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** verfällt an diesem Tag, wenn es bis dahin nicht benutzt wird (letzte Nutzung bzw. Anlegen + 12 Monate) */
  expiresAt: string;
}

/** Sitzung, die aus einem API-Token stammt. */
export type TokenSession = Session & { apiTokenId: string; apiTokenLabel: string };

export const isTokenSession = (s: Session | undefined | null): s is TokenSession => !!s && typeof (s as TokenSession).apiTokenId === 'string';

/** So erscheint der Assistent in Anwesenheit, Versionsverlauf usw. */
export function aiUser(owner: Pick<Session, 'userKey' | 'name' | 'isOrga'>): User {
  return { key: `ai:${owner.userKey}`, name: `KI (für ${owner.name})`, isOrga: owner.isOrga };
}

const expiresAt = (r: Pick<TokenRow, 'created_at' | 'last_used_at'>) => new Date(Date.parse(r.last_used_at ?? r.created_at) + UNUSED_MS).toISOString();
const info = (r: TokenRow): ApiTokenInfo => ({ id: r.id, label: r.label, hint: r.hint, createdAt: r.created_at, lastUsedAt: r.last_used_at, expiresAt: expiresAt(r) });

/** Bearer-Token aus einem Authorization-Header (nur Stachel-Tokens). */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header || header.length > 300) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  const t = m?.[1];
  return t && t.startsWith(API_TOKEN_PREFIX) && t.length >= 20 ? t : null;
}

export class ApiTokens {
  private inflight = new Map<string, Promise<TokenSession | null>>();
  private hocuspocus: Hocuspocus<any> | null = null;

  constructor(
    private readonly db: Db,
    /** Nachprüfung wie bei Sitzungen: Identitätsdienst (Modus org) bzw. im Modus local die eigenen Konten (accounts.ts) */
    private readonly verifier: Pick<OrgIdentityClient, 'verifyToken'>,
    /** Org-Token verschlüsselt speichern (token-crypt.ts, STACHEL_TOKEN_KEY) */
    private readonly crypt: TokenCrypt = TokenCrypt.plain,
  ) {
    db.exec(SCHEMA);
  }

  /** Sync-Server bekannt machen, damit Widerrufen offene Verbindungen trennt. */
  attach(hocuspocus: Hocuspocus<any>) {
    this.hocuspocus = hocuspocus;
  }

  list(userKey: string): ApiTokenInfo[] {
    const rows = this.db.prepare('SELECT * FROM api_tokens WHERE user_key = ? ORDER BY created_at DESC').all(userKey) as unknown as TokenRow[];
    return rows.map(info);
  }

  /** Neues Token für die Person der Sitzung; der Klartext kommt nur hier zurück. */
  create(owner: Session, label: string): { token: ApiTokenInfo; secret: string } | 'too_many' {
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE user_key = ?').get(owner.userKey) as { n: number }).n;
    if (n >= MAX_TOKENS_PER_USER) return 'too_many';
    const secret = API_TOKEN_PREFIX + randomToken(32);
    const now = nowIso();
    const row: TokenRow = {
      id: randomToken(9),
      token_hash: sha256(secret),
      user_key: owner.userKey,
      name: owner.name,
      is_orga: owner.isOrga ? 1 : 0,
      org_token: owner.orgToken,
      label,
      hint: secret.slice(-4),
      created_at: now,
      verified_at: owner.verifiedAt,
      last_used_at: null,
    };
    this.db
      .prepare(
        `INSERT INTO api_tokens (id, token_hash, user_key, name, is_orga, org_token, label, hint, created_at, verified_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(row.id, row.token_hash, row.user_key, row.name, row.is_orga, this.crypt.seal(row.org_token), row.label, row.hint, row.created_at, row.verified_at);
    return { token: info(row), secret };
  }

  /** Eigenes Token widerrufen; false = gibt es nicht bzw. gehört jemand anderem. */
  revoke(userKey: string, id: string): boolean {
    const res = this.db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_key = ?').run(id, userKey);
    if (Number(res.changes) === 0) return false;
    this.disconnect(id);
    return true;
  }

  /** Offene Sync-Verbindungen eines Tokens schließen (Wiederverbinden scheitert dann an der Anmeldung). */
  disconnect(id: string) {
    for (const doc of this.hocuspocus?.documents.values() ?? []) {
      for (const conn of doc.getConnections()) {
        if ((conn as unknown as { context?: { apiTokenId?: string } }).context?.apiTokenId === id) conn.close({ code: 1008, reason: 'not_logged_in' });
      }
    }
  }

  private row(secret: string): TokenRow | undefined {
    const r = this.db.prepare('SELECT * FROM api_tokens WHERE token_hash = ?').get(sha256(secret)) as TokenRow | undefined;
    if (r && Date.parse(expiresAt(r)) <= Date.now()) return undefined; // 12 Monate unbenutzt: verfallen (legal.ts räumt auf)
    return r && { ...r, org_token: this.crypt.open(r.org_token) };
  }

  /** Schnelle Prüfung ohne Identitätsdienst (WebSocket-Upgrade): gibt es das Token? */
  peek(header: string | null | undefined): boolean {
    const t = bearerToken(header);
    return !!t && !!this.row(t);
  }

  /** Sitzung zum Bearer-Header; prüft das Konto nach, wenn die letzte Prüfung zu alt ist. */
  async fromAuthorization(header: string | null | undefined): Promise<TokenSession | null> {
    const t = bearerToken(header);
    if (!t) return null;
    const row = this.row(t);
    if (!row) return null;
    if (Date.now() - Date.parse(row.verified_at) >= REVERIFY_HOURS * 3600_000) {
      let p = this.inflight.get(row.id);
      if (!p) {
        p = this.reverify(row).finally(() => this.inflight.delete(row.id));
        this.inflight.set(row.id, p);
      }
      return p;
    }
    this.touch(row);
    return toSession(row);
  }

  /** HTTP: Sitzung aus `Authorization: Bearer stk_…` (null = kein bzw. ungültiges Token). */
  fromRequest(req: FastifyRequest): Promise<TokenSession | null> {
    return this.fromAuthorization(req.headers.authorization);
  }

  private async reverify(row: TokenRow): Promise<TokenSession | null> {
    const res = await this.verifier.verifyToken(row.org_token);
    if (res.kind === 'unreachable') return toSession(row);
    if (res.kind !== 'ok') {
      this.db.prepare('DELETE FROM api_tokens WHERE id = ?').run(row.id);
      this.disconnect(row.id);
      return null;
    }
    const now = nowIso();
    const next: TokenRow = { ...row, name: res.identity.name, is_orga: res.identity.isOrga ? 1 : 0, verified_at: now, last_used_at: now };
    this.db.prepare('UPDATE api_tokens SET name = ?, is_orga = ?, verified_at = ?, last_used_at = ? WHERE id = ?').run(next.name, next.is_orga, now, now, row.id);
    return toSession(next);
  }

  private touch(row: TokenRow) {
    if (row.last_used_at && Date.now() - Date.parse(row.last_used_at) < TOUCH_MS) return;
    this.db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id);
  }

  /** Nur für Tests: Nachprüfung erzwingen. */
  setVerifiedAt(id: string, iso: string) {
    this.db.prepare('UPDATE api_tokens SET verified_at = ? WHERE id = ?').run(iso, id);
  }

  /** Alle Tokens einer Person löschen (z. B. wenn ihr Konto entfernt wird). */
  forgetUser(userKey: string) {
    const ids = (this.db.prepare('SELECT id FROM api_tokens WHERE user_key = ?').all(userKey) as unknown as { id: string }[]).map((r) => r.id);
    this.db.prepare('DELETE FROM api_tokens WHERE user_key = ?').run(userKey);
    ids.forEach((id) => this.disconnect(id));
  }
}

function toSession(r: TokenRow): TokenSession {
  return {
    id: `tok:${r.id}`,
    userKey: r.user_key,
    name: r.name,
    isOrga: r.is_orga === 1,
    orgToken: r.org_token,
    createdAt: r.created_at,
    verifiedAt: r.verified_at,
    expiresAt: NO_EXPIRY,
    apiTokenId: r.id,
    apiTokenLabel: r.label,
  };
}

/**
 * Routen (im Bereich mit Sitzungspflicht registrieren, `req.session` ist gesetzt):
 * - `GET /api/tokens`, `POST /api/tokens {label}`, `DELETE /api/tokens/:id` – nur mit Cookie-Sitzung (ein Token kann
 *   keine weiteren Tokens anlegen),
 * - `GET /api/tokens/me` – nur mit Token: wem gehört es, wie heißt der Assistent.
 */
export function registerApiTokens(scope: FastifyInstance, opts: { tokens: ApiTokens; mcpUrl: string }) {
  const { tokens, mcpUrl } = opts;
  const cookieOnly = (req: FastifyRequest) => !isTokenSession(req.session);
  const NO_TOKEN_MSG = 'Tokens lassen sich nur in Stachel selbst verwalten, nicht mit einem Token.';

  scope.get('/api/tokens', async (req, reply) => {
    if (!cookieOnly(req)) return sendError(reply, 403, 'forbidden', NO_TOKEN_MSG);
    return { ok: true, tokens: tokens.list(req.session!.userKey), mcpUrl };
  });

  scope.post('/api/tokens', async (req, reply) => {
    if (!cookieOnly(req)) return sendError(reply, 403, 'forbidden', NO_TOKEN_MSG);
    const raw = (req.body as { label?: unknown } | null)?.label;
    const label = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    if (raw !== undefined && typeof raw !== 'string') return sendError(reply, 400, 'invalid_input', 'Der Name muss ein Text sein.');
    if (label.length > MAX_LABEL) return sendError(reply, 400, 'invalid_input', `Der Name darf höchstens ${MAX_LABEL} Zeichen haben.`);
    const res = tokens.create(req.session!, label || 'KI-Assistent');
    if (res === 'too_many') {
      return sendError(reply, 409, 'too_many', `Du hast schon ${MAX_TOKENS_PER_USER} Tokens. Bitte widerrufe zuerst eins, das du nicht mehr brauchst.`);
    }
    return reply.code(201).send({ ok: true, token: res.token, secret: res.secret, mcpUrl });
  });

  scope.delete<{ Params: { id: string } }>('/api/tokens/:id', async (req, reply) => {
    if (!cookieOnly(req)) return sendError(reply, 403, 'forbidden', NO_TOKEN_MSG);
    if (!tokens.revoke(req.session!.userKey, req.params.id)) return sendError(reply, 404, 'not_found', 'Dieses Token gibt es nicht (mehr).');
    return { ok: true };
  });

  scope.get('/api/tokens/me', async (req, reply) => {
    const s = req.session!;
    if (!isTokenSession(s)) return sendError(reply, 400, 'invalid_input', 'Nur mit einem API-Token (Authorization: Bearer stk_…) abrufbar.');
    return { ok: true, user: { key: s.userKey, name: s.name, isOrga: s.isOrga }, ai: aiUser(s), token: { id: s.apiTokenId, label: s.apiTokenLabel } };
  });
}
