// App-Sitzung der Org-App bzw. der Stachel-App (docs/contract.md §8.1): Org-Token (nur Modus org)
// oder Zugangsdaten im Body (Modus org `{username, password}`, Modus local `{email, password}`) → normale
// Stachel-Sitzung mit Token `sts_…` (nur der Hash liegt in `sessions`). Native REST-Routen (Info, Posteingang …): routes.ts.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { APP_SESSION_PATH, APP_SESSION_PREFIX } from '../../../shared/native.js';
import type { Db } from '../db.js';
import { MESSAGES, sendError } from '../http-util.js';
import type { Identity, OrgIdentityClient } from '../org-identity.js';
import { ipKey, RateLimiter } from '../rate-limit.js';
import { toUser, type SessionStore } from '../sessions.js';
import { rememberUser } from '../users.js';

/** `sts_`-Token aus `Authorization: Bearer …` (andere Tokens: undefined). */
export function appSessionToken(header: string | null | undefined): string | undefined {
  if (!header || header.length > 300) return undefined;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  const t = m?.[1];
  return t && t.startsWith(APP_SESSION_PREFIX) && t.length >= 20 && t.length <= 200 ? t : undefined;
}

export interface AppSessionDeps {
  db: Db;
  org: OrgIdentityClient;
  sessions: SessionStore;
  /** offene Native-Verbindungen dieser Sitzung trennen (Abmelden) */
  dropSession: (token: string) => void;
  /** Betriebsart: im Modus local gibt es kein Org-Token, nur Zugangsdaten */
  mode: 'org' | 'local';
  /**
   * Zugangsdaten aus dem Body prüfen – dieselbe Funktion wie der Browser-Login (`/api/auth/password` bzw.
   * `/api/auth/login`, samt Rate-Limits und Fehlercodes); null = Fehler schon gesendet
   */
  credentials: (req: FastifyRequest, reply: FastifyReply) => Promise<{ identity: Identity; token: string } | null>;
}

/** Body mit Zugangsdaten (sonst gilt das Bearer-Org-Token)? */
function hasCredentials(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const b = body as Record<string, unknown>;
  return 'password' in b || 'email' in b || 'username' in b;
}

export function registerAppSession(app: FastifyInstance, deps: AppSessionDeps) {
  const { db, org, sessions, dropSession } = deps;
  const limiter = new RateLimiter(60, 5 * 60_000); // ein Team hinter einem WLAN teilt sich eine IP

  app.post(APP_SESSION_PATH, async (req, reply) => {
    if (!limiter.allow(ipKey(req.ip))) return sendError(reply, 429, 'rate_limited', MESSAGES.rate_limited);
    // Stachel-App: Zugangsdaten wie beim Browser-Login (gleiche Prüfungen, Sperren, Fehlercodes), Ergebnis als sts_-Token
    if (hasCredentials(req.body)) {
      const login = await deps.credentials(req, reply);
      if (!login) return reply;
      const { cookie, session } = sessions.create(login.identity, login.token, APP_SESSION_PREFIX);
      rememberUser(db, session);
      return { ok: true, token: cookie, user: toUser(session), expiresAt: session.expiresAt };
    }
    // Modus local: kein Org-Token (keine Organisation an dieser Instanz)
    if (deps.mode === 'local') {
      if (req.headers.authorization) return sendError(reply, 404, 'not_found', MESSAGES.not_found);
      return sendError(reply, 400, 'invalid_input', 'Bitte E-Mail-Adresse und Passwort eingeben.');
    }
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token || token.length > 4096) return sendError(reply, 401, 'invalid_token', org.messages.invalid_token);
    const check = await org.verifyToken(token);
    if (check.kind !== 'ok') {
      const e = org.verifyError(check)!;
      return sendError(reply, e.status, e.error, e.message);
    }
    const { cookie, session } = sessions.create(check.identity, token, APP_SESSION_PREFIX);
    rememberUser(db, session);
    return { ok: true, token: cookie, user: toUser(session), expiresAt: session.expiresAt };
  });

  app.delete(APP_SESSION_PATH, async (req) => {
    const token = appSessionToken(req.headers.authorization);
    if (token) {
      sessions.delete(token);
      dropSession(token);
    }
    return { ok: true };
  });

  const housekeeping = setInterval(() => limiter.prune(), 60_000);
  housekeeping.unref();
  app.addHook('onClose', async () => clearInterval(housekeeping));
}

/** `GET /api/native/info` (ohne Sitzung). */
/** App-Version `x.y.z[+build]` mit Mindestversion vergleichen; unlesbare Versionen gelten als alt genug nur ohne Minimum. */
export function appVersionOk(app: unknown, minApp: string | null): boolean {
  if (!minApp) return true;
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1).map(Number);
  const a = typeof app === 'string' ? parse(app) : undefined;
  const m = parse(minApp);
  if (!m) return true;
  if (!a) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== m[i]) return a[i]! > m[i]!;
  return true;
}
