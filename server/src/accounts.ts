// Eigene Konten (Modus local, docs/features/accounts.md): Registrieren mit Captcha, E-Mail-Bestätigung, Anmelden mit
// Sperre nach Fehlversuchen, Passwort vergessen, Konto (Name, Passwort, Löschen). Sitzungen wie bisher (sessions.ts):
// user_key `u:<id>`, im Feld org_token steht `local:<id>` (die Nachprüfung fragt dann dieses Modul, keinen Identitätsdienst).
//
// Grundsätze: keine Auskunft, ob eine E-Mail registriert ist (Registrieren, Passwort vergessen und Erneut-senden
// antworten immer gleich, Mails gehen im Hintergrund raus, scrypt läuft in jedem Zweig); Tokens nur als SHA-256-Hash;
// Passwörter mit scrypt.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE } from '../../shared/protocol.js';
import type { BoardAccess } from './access.js';
import { Captcha } from './captcha.js';
import { nowIso, type Db } from './db.js';
import { MESSAGES, sendError } from './http-util.js';
import type { InstanceConfig } from './instance.js';
import type { Identity, VerifyResult } from './org-identity.js';
import { mails, type MailContext } from './mail-templates.js';
import { isEmail, type Mailer } from './mailer.js';
import { dummyHash, hashPassword, passwordProblem, PASSWORD_MAX, verifyPassword } from './passwords.js';
import { ipKey, RateLimiter } from './rate-limit.js';
import { randomToken, sha256, toUser, type Session, type SessionStore } from './sessions.js';
import { appSessionToken } from './native/auth.js';
import { rememberUser } from './users.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,     -- klein geschrieben
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  verified_at TEXT,               -- null = E-Mail noch nicht bestätigt (Anmelden geht nicht)
  privacy_accepted_at TEXT NOT NULL, -- Datenschutz-Hinweis gezeigt (seit CR-1 kein Häkchen mehr, nur Kenntnisnahme)
  terms_accepted_at TEXT,         -- Nutzungsbedingungen akzeptiert + mind. 18 (CR-1; null = Konto von davor)
  terms_version TEXT,             -- Fassung der akzeptierten Nutzungsbedingungen (STACHEL_TERMS_VERSION; null = ohne Fassung)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_tokens (
  hash TEXT PRIMARY KEY,          -- sha256 des Tokens aus dem Link
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,          -- verify | reset
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_tokens_account ON account_tokens(account_id, purpose);
`;

export const VERIFY_TTL_MS = 24 * 3600_000;
export const RESET_TTL_MS = 3600_000;
const NAME_MAX = 80;
export const LOCAL_TOKEN_PREFIX = 'local:';

export interface AccountRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  verified_at: string | null;
  privacy_accepted_at: string;
  terms_accepted_at: string | null;
  terms_version: string | null;
  created_at: string;
  updated_at: string;
}

export const accountKey = (id: string) => `u:${id}`;
export const accountIdOf = (userKey: string) => (userKey.startsWith('u:') ? userKey.slice(2) : null);
export const normEmail = (s: unknown) => (typeof s === 'string' ? s.trim().toLowerCase() : '');

/** Name: Steuerzeichen raus, Leerraum zusammenfassen. */
export function cleanName(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const n = s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
  return n && n.length <= NAME_MAX ? n : null;
}

export class Accounts {
  constructor(private readonly db: Db) {
    db.exec(SCHEMA);
    // ältere Datenbanken: Spalte nachrüsten (CR-1)
    const cols = db.prepare('PRAGMA table_info(accounts)').all() as unknown as { name: string }[];
    if (!cols.some((c) => c.name === 'terms_accepted_at')) db.exec('ALTER TABLE accounts ADD COLUMN terms_accepted_at TEXT');
    if (!cols.some((c) => c.name === 'terms_version')) db.exec('ALTER TABLE accounts ADD COLUMN terms_version TEXT');
  }
  byEmail(email: string) {
    return this.db.prepare('SELECT * FROM accounts WHERE email = ?').get(email) as AccountRow | undefined;
  }
  byId(id: string) {
    return this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
  }
  byKey(userKey: string) {
    const id = accountIdOf(userKey);
    return id ? this.byId(id) : undefined;
  }
  identity(a: AccountRow): Identity {
    return { userKey: accountKey(a.id), name: a.name, isOrga: false };
  }
  /** Token anlegen (nur der Hash wird gespeichert); ältere Tokens desselben Zwecks verfallen. */
  issueToken(accountId: string, purpose: 'verify' | 'reset', ttlMs: number): string {
    const token = randomToken(32);
    const now = Date.now();
    this.db.prepare('DELETE FROM account_tokens WHERE account_id = ? AND purpose = ?').run(accountId, purpose);
    this.db
      .prepare('INSERT INTO account_tokens (hash, account_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(sha256(token), accountId, purpose, new Date(now).toISOString(), new Date(now + ttlMs).toISOString());
    return token;
  }
  /** Token einlösen (genau einmal). Lookup über den Hash: kein Vergleich von Geheimnissen im Klartext. */
  redeemToken(token: unknown, purpose: 'verify' | 'reset'): AccountRow | null {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const hash = sha256(token);
    const row = this.db.prepare('SELECT account_id, purpose, expires_at FROM account_tokens WHERE hash = ?').get(hash) as
      | { account_id: string; purpose: string; expires_at: string }
      | undefined;
    if (!row || row.purpose !== purpose) return null;
    this.db.prepare('DELETE FROM account_tokens WHERE hash = ?').run(hash);
    if (row.expires_at <= nowIso()) return null;
    return this.byId(row.account_id) ?? null;
  }
  /** Zahl der Konten (die erste Registrierung ist auch bei STACHEL_REGISTRATION=invite erlaubt) */
  count(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n);
  }
  purgeTokens() {
    this.db.prepare('DELETE FROM account_tokens WHERE expires_at <= ?').run(nowIso());
    // nie bestätigte Konten nach 7 Tagen entfernen (Adresse wird wieder frei, keine Datenreste)
    this.db.prepare('DELETE FROM accounts WHERE verified_at IS NULL AND created_at <= ?').run(new Date(Date.now() - 7 * 24 * 3600_000).toISOString());
  }

  /** Nachprüfung der Sitzung (sessions.ts ruft das statt des Identitätsdienstes): Konto da und bestätigt? */
  verifier() {
    return {
      verifyToken: async (token: string): Promise<VerifyResult> => {
        if (!token.startsWith(LOCAL_TOKEN_PREFIX)) return { kind: 'invalid' };
        const a = this.byId(token.slice(LOCAL_TOKEN_PREFIX.length));
        if (!a || !a.verified_at) return { kind: 'invalid' };
        return { kind: 'ok', identity: this.identity(a) };
      },
    };
  }
}

/**
 * Konto freischalten (Bestätigungslink, Instanz ohne E-Mail-Bestätigung oder `stachel-admin verify`): bestätigt, Name für
 * Erwähnungen gemerkt, Einladungen an die Adresse werden Mitgliedschaften.
 */
export function activateAccount(db: Db, access: Pick<BoardAccess, 'claimInvites'>, acc: AccountRow) {
  const now = nowIso();
  if (!acc.verified_at) db.prepare('UPDATE accounts SET verified_at = ?, updated_at = ? WHERE id = ?').run(now, now, acc.id);
  rememberUser(db, { userKey: accountKey(acc.id), name: acc.name });
  access.claimInvites(acc.email, accountKey(acc.id));
}

export interface AccountDeps {
  db: Db;
  accounts: Accounts;
  access: BoardAccess;
  sessions: SessionStore;
  mailer: Mailer;
  instance: InstanceConfig;
  /** öffentliche Adresse der Web-App (PUBLIC_URL + STACHEL_BASE_PATH, site.ts) für die Links in Mails */
  appUrl: string;
  /** STACHEL_BASE_PATH ('' oder z. B. `/app`) */
  basePath: string;
  setSessionCookie: (reply: FastifyReply, value: string) => void;
  /** HTML der 404-Seite (ungültiger Mail-Link) */
  notFoundPage: () => string;
  clearSessionCookie: (reply: FastifyReply) => void;
  /**
   * offene Sync- und Native-Verbindungen einer Person trennen (Konto gelöscht, Passwort geändert); `exceptCookie` = die
   * eigene Sitzung (Cookie bzw. sts_-Token) bleibt verbunden
   */
  dropUser: (userKey: string, exceptCookie?: string) => void;
  /** eigenes Board endgültig löschen (Papierkorb + endgültig, trash.ts) */
  purgeBoard: (boardId: string, by: Session) => Promise<void>;
  /** Board-Liste neu laden lassen (SSE) */
  notify: (boardId: string, userKeys: string[]) => void;
  /** Konto gelöscht: API-Tokens, Posteingang, Name auf verbliebenen Boards → „Gelöschtes Konto“ (forget-person.ts) */
  forget?: (who: { key: string; name?: string }) => Promise<unknown>;
}

/**
 * Pfade der Org-Anmeldung (Modus org): im Modus local gibt es sie nicht (404). `POST /api/auth/app-session` (Stachel-App mit
 * E-Mail + Passwort) und die App-Links (`/.well-known/…`, für die Stachel-App) gibt es in beiden Modi.
 */
const ORG_ROUTES = new Set([
  '/api/auth/password',
  '/api/auth/qr',
  '/api/auth/qr/:code/wait',
  '/api/auth/qr/:code/info',
  '/api/auth/qr/approve',
  '/api/auth/app-code',
  '/auth/app',
  '/qr/:code',
]);

/** Link-Token aus den Mails (randomToken(32), base64url) – wie redeemToken: 20–100 Zeichen. */
const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

/** `GET /api/instance` (immer, ohne Sitzung): Betriebsart und Auftritt für die Web-App. */
export function registerInstanceInfo(
  app: FastifyInstance,
  instance: InstanceConfig,
  org: { orgPasswordLogin: boolean; orgAndroidPackage: string | null; photoNotes?: boolean } = { orgPasswordLogin: false, orgAndroidPackage: null },
) {
  const isOrg = instance.auth === 'org';
  app.get('/api/instance', async (_req, reply) => {
    reply.header('Cache-Control', 'no-cache');
    return {
      ok: true,
      auth: instance.auth,
      brand: instance.brand,
      imprintUrl: instance.imprintUrl || null,
      privacyUrl: instance.privacyUrl || null,
      termsUrl: instance.termsUrl || null,
      registration: instance.auth === 'local' ? instance.registration : null,
      // false = Konten sind nach dem Registrieren sofort aktiv (keine Bestätigungsmail, STACHEL_REQUIRE_VERIFICATION)
      verification: instance.auth === 'local' ? instance.requireVerification : null,
      // Modus org (Vertrag §6): „Mit {orgName} anmelden“, „In der {orgAppName} öffnen“, Passwort-Anmeldung, Intent-Paket
      orgName: isOrg ? instance.orgName : null,
      orgAppName: isOrg ? instance.orgAppName : null,
      orgPasswordLogin: isOrg && org.orgPasswordLogin,
      orgAndroidPackage: isOrg ? org.orgAndroidPackage : null,
      // „Zettel abfotografieren“ auf diesem Server verfügbar (STACHEL_PHOTO_NOTES, photo-notes.ts)
      photoNotes: org.photoNotes !== false,
    };
  });
}

export function registerAccounts(app: FastifyInstance, deps: AccountDeps) {
  const { db, accounts, access, sessions, mailer, instance, appUrl, basePath } = deps;
  const captcha = new Captcha(db, instance.captchaMax);
  const ctx: MailContext = { brand: instance.brand, publicUrl: appUrl, imprintUrl: instance.imprintUrl, privacyUrl: instance.privacyUrl, termsUrl: instance.termsUrl };

  // Org-Anmeldung abschalten
  app.addHook('onRequest', async (req, reply) => {
    if (ORG_ROUTES.has(req.routeOptions?.url ?? '')) return sendError(reply, 404, 'not_found', MESSAGES.not_found);
  });

  const limits = {
    captcha: new RateLimiter(60, 5 * 60_000),
    registerIp: new RateLimiter(10, 3600_000),
    registerEmail: new RateLimiter(3, 3600_000),
    mailIp: new RateLimiter(10, 15 * 60_000),
    mailEmail: new RateLimiter(3, 3600_000),
    loginFail: new RateLimiter(10, 5 * 60_000),
    loginFlood: new RateLimiter(60, 5 * 60_000),
    loginEmail: new RateLimiter(10, 15 * 60_000),
    tokenIp: new RateLimiter(30, 15 * 60_000),
    account: new RateLimiter(20, 15 * 60_000),
  };
  const timer = setInterval(() => {
    for (const l of Object.values(limits)) l.prune();
    try {
      accounts.purgeTokens();
      captcha.purge();
    } catch {
      /* nächste Runde */
    }
  }, 60_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));

  const tooMany = (reply: FastifyReply) => sendError(reply, 429, 'rate_limited', MESSAGES.rate_limited);
  const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;
  const link = (q: string) => `${appUrl}/?${q}`;

  // Bestätigen/Zurücksetzen als Pfad (`/verify/<token>`, `/reset/<token>`, mit STACHEL_BASE_PATH `/app/verify/<token>`):
  // die Stachel-App übernimmt diese Pfade als App-Link (well-known.ts); ohne App leitet der Server auf `/?verify=…` bzw.
  // `/?reset=…` der Web-App um (mit Pfad `/app/?verify=…`). Die Pfade ohne Präfix bleiben für ältere Mails gültig.
  function sendVerify(a: AccountRow) {
    const token = accounts.issueToken(a.id, 'verify', VERIFY_TTL_MS);
    mailer.queue(mails.verify(ctx, a.email, a.name, `${appUrl}/verify/${token}`));
  }
  function sendReset(a: AccountRow) {
    const token = accounts.issueToken(a.id, 'reset', RESET_TTL_MS);
    mailer.queue(mails.reset(ctx, a.email, a.name, `${appUrl}/reset/${token}`));
  }
  for (const purpose of ['verify', 'reset'] as const) {
    for (const prefix of new Set(['', basePath])) {
      app.get<{ Params: { token: string } }>(`${prefix}/${purpose}/:token`, async (req, reply) => {
        const token = req.params.token;
        reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
        if (!LINK_TOKEN_RE.test(token)) return reply.code(404).type('text/html; charset=utf-8').send(deps.notFoundPage());
        return reply.redirect(`${basePath}/?${purpose}=${token}`, 302);
      });
    }
  }

  app.get('/api/auth/captcha', async (req, reply) => {
    if (!limits.captcha.allow(ipKey(req.ip))) return tooMany(reply);
    return { ok: true, ...captcha.create() };
  });

  const captchaError = (reply: FastifyReply, res: string) =>
    sendError(
      reply,
      400,
      'captcha_invalid',
      res === 'expired' ? 'Die Sicherheitsprüfung ist abgelaufen. Bitte noch einmal absenden.' : 'Die Sicherheitsprüfung ist fehlgeschlagen. Bitte noch einmal versuchen.',
    );

  // ---- Registrieren --------------------------------------------------------------------------------------------
  app.post('/api/auth/register', async (req, reply) => {
    const b = body(req);
    // Honigtopf: Menschen sehen das Feld nicht. Gefüllt → so tun, als hätte es geklappt.
    if (typeof b.website === 'string' && b.website.trim()) return { ok: true };
    const ip = ipKey(req.ip);
    if (limits.registerIp.blocked(ip)) return tooMany(reply);
    const name = cleanName(b.name);
    const email = normEmail(b.email);
    const password = typeof b.password === 'string' ? b.password : '';
    if (!name) return sendError(reply, 400, 'invalid_input', `Bitte gib deinen Namen an (höchstens ${NAME_MAX} Zeichen).`);
    if (!isEmail(email)) return sendError(reply, 400, 'invalid_email', 'Bitte gib eine gültige E-Mail-Adresse an.');
    const weak = passwordProblem(password, { email, name });
    if (weak) return sendError(reply, 400, 'weak_password', weak);
    // Nutzungsbedingungen + Mindestalter 18 (CR-1); die Datenschutzerklärung ist nur ein Hinweis, keine Einwilligung
    if (b.terms !== true) {
      return sendError(reply, 400, 'terms_required', 'Bitte akzeptiere die Nutzungsbedingungen und bestätige, dass du mindestens 18 Jahre alt bist.');
    }
    const check = captcha.verify(b.captcha);
    if (check !== 'ok') return captchaError(reply, check);
    if (!limits.registerIp.allow(ip) || !limits.registerEmail.allow(email)) return tooMany(reply);
    // invite: nur mit Einladung – außer dem allerersten Konto (sonst käme in eine frische Instanz nie jemand hinein)
    if (instance.registration === 'invite' && !access.hasInvite(email) && !accounts.byEmail(email) && accounts.count() > 0) {
      return sendError(reply, 403, 'registration_closed', 'Registrieren geht hier nur mit einer Einladung zu einem Board.');
    }
    // in jedem Zweig gleich viel Arbeit (scrypt), damit die Antwortzeit nichts verrät
    const hash = await hashPassword(password);
    const now = nowIso();
    const termsVersion = instance.termsVersion || null;
    const existing = accounts.byEmail(email);
    if (existing?.verified_at) {
      // ohne Bestätigung kann die Antwort ohnehin nicht verbergen, ob es das Konto gibt (sie meldet sofort „aktiv“)
      if (!instance.requireVerification) return sendError(reply, 409, 'email_taken', 'Für diese E-Mail-Adresse gibt es schon ein Konto. Melde dich damit an.');
      mailer.queue(mails.existing(ctx, email, existing.name, link('login=1'), link(`forgot=1&email=${encodeURIComponent(email)}`)));
      return { ok: true };
    }
    let acc: AccountRow;
    if (existing) {
      // nie bestätigt: Angaben überschreiben (nur wer das Postfach hat, kann es aktivieren)
      db.prepare('UPDATE accounts SET name = ?, password_hash = ?, privacy_accepted_at = ?, terms_accepted_at = ?, terms_version = ?, updated_at = ? WHERE id = ?').run(name, hash, now, now, termsVersion, now, existing.id);
      acc = accounts.byId(existing.id)!;
    } else {
      const id = randomToken(9);
      db.prepare(
        'INSERT INTO accounts (id, email, name, password_hash, verified_at, privacy_accepted_at, terms_accepted_at, terms_version, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)',
      ).run(id, email, name, hash, now, now, termsVersion, now, now);
      acc = accounts.byId(id)!;
    }
    if (!instance.requireVerification) {
      activateAccount(db, access, acc);
      return { ok: true, verified: true };
    }
    sendVerify(acc);
    return { ok: true };
  });

  app.post('/api/auth/verify', async (req, reply) => {
    if (!limits.tokenIp.allow(ipKey(req.ip))) return tooMany(reply);
    const acc = accounts.redeemToken(body(req).token, 'verify');
    if (!acc) return sendError(reply, 410, 'link_expired', 'Dieser Bestätigungslink ist abgelaufen oder wurde schon benutzt.');
    activateAccount(db, access, acc);
    return { ok: true, email: acc.email };
  });

  // Bestätigungsmail erneut senden (immer gleiche Antwort)
  app.post('/api/auth/resend', async (req, reply) => {
    const email = normEmail(body(req).email);
    const ip = ipKey(req.ip);
    if (!limits.mailIp.allow(ip)) return tooMany(reply);
    if (!isEmail(email)) return sendError(reply, 400, 'invalid_email', 'Bitte gib eine gültige E-Mail-Adresse an.');
    if (!limits.mailEmail.allow(`v:${email}`)) return { ok: true };
    const acc = accounts.byEmail(email);
    if (acc && !acc.verified_at) sendVerify(acc);
    return { ok: true };
  });

  // ---- Anmelden ------------------------------------------------------------------------------------------------
  /**
   * E-Mail + Passwort prüfen (Rate-Limits, Fehlercodes) – gemeinsam für den Browser (`/api/auth/login`, Cookie) und die
   * Stachel-App (`POST /api/auth/app-session`, sts_-Token). null = Fehler schon gesendet.
   */
  async function login(req: FastifyRequest, reply: FastifyReply): Promise<{ identity: Identity; token: string } | null> {
    const fail = (status: number, error: string, message: string) => {
      sendError(reply, status, error, message);
      return null;
    };
    const ip = ipKey(req.ip);
    if (limits.loginFail.blocked(ip) || !limits.loginFlood.allow(ip)) return fail(429, 'rate_limited', MESSAGES.rate_limited);
    const b = body(req);
    const email = normEmail(b.email);
    const password = typeof b.password === 'string' ? b.password : '';
    if (!email || !password || email.length > 254 || password.length > PASSWORD_MAX) {
      return fail(400, 'invalid_input', 'Bitte E-Mail-Adresse und Passwort eingeben.');
    }
    if (limits.loginEmail.blocked(email)) return fail(429, 'rate_limited', MESSAGES.rate_limited);
    const acc = accounts.byEmail(email);
    const ok = await verifyPassword(password, acc?.password_hash ?? (await dummyHash()));
    if (!acc || !ok) {
      limits.loginFail.hit(ip);
      limits.loginEmail.hit(email);
      return fail(401, 'wrong_login', 'E-Mail-Adresse oder Passwort ist falsch.');
    }
    if (!acc.verified_at) {
      return fail(403, 'not_verified', 'Bitte bestätige zuerst deine E-Mail-Adresse. Den Link haben wir dir geschickt.');
    }
    // im Feld org_token: `local:<id>` (Nachprüfung über accounts.verifier())
    return { identity: accounts.identity(acc), token: LOCAL_TOKEN_PREFIX + acc.id };
  }

  app.post('/api/auth/login', async (req, reply) => {
    const res = await login(req, reply);
    if (!res) return reply;
    const { cookie, session } = sessions.create(res.identity, res.token);
    deps.setSessionCookie(reply, cookie);
    rememberUser(db, session);
    return { ok: true, user: toUser(session) };
  });

  // ---- Passwort vergessen --------------------------------------------------------------------------------------
  app.post('/api/auth/forgot', async (req, reply) => {
    const email = normEmail(body(req).email);
    if (!limits.mailIp.allow(ipKey(req.ip))) return tooMany(reply);
    if (!isEmail(email)) return sendError(reply, 400, 'invalid_email', 'Bitte gib eine gültige E-Mail-Adresse an.');
    if (!limits.mailEmail.allow(`r:${email}`)) return { ok: true };
    const acc = accounts.byEmail(email);
    if (acc?.verified_at) sendReset(acc);
    else if (acc) sendVerify(acc); // nie bestätigt: erst bestätigen
    return { ok: true };
  });

  app.post('/api/auth/reset', async (req, reply) => {
    if (!limits.tokenIp.allow(ipKey(req.ip))) return tooMany(reply);
    const b = body(req);
    const password = typeof b.password === 'string' ? b.password : '';
    // Stärke vor dem Einlösen prüfen, damit ein Tippfehler den Link nicht verbraucht
    const tokenHash = typeof b.token === 'string' ? sha256(b.token) : '';
    const pre = tokenHash
      ? (db.prepare("SELECT a.email, a.name FROM account_tokens t JOIN accounts a ON a.id = t.account_id WHERE t.hash = ? AND t.purpose = 'reset'").get(tokenHash) as
          | { email: string; name: string }
          | undefined)
      : undefined;
    const weak = passwordProblem(password, pre ?? {});
    if (weak) return sendError(reply, 400, 'weak_password', weak);
    const acc = accounts.redeemToken(b.token, 'reset');
    if (!acc) return sendError(reply, 410, 'link_expired', 'Dieser Link ist abgelaufen oder wurde schon benutzt. Bitte fordere einen neuen an.');
    const hash = await hashPassword(password);
    const now = nowIso();
    // Reset beweist das Postfach: unbestätigte Konten gelten damit auch als bestätigt
    db.prepare('UPDATE accounts SET password_hash = ?, verified_at = COALESCE(verified_at, ?), updated_at = ? WHERE id = ?').run(hash, now, now, acc.id);
    // alle Sitzungen beenden (jemand kannte evtl. das alte Passwort)
    db.prepare('DELETE FROM sessions WHERE user_key = ?').run(accountKey(acc.id));
    // persönliche API-Tokens (MCP) gelten sonst ohne Ablauf weiter (Sicherheits-Review SEC-05)
    db.prepare('DELETE FROM api_tokens WHERE user_key = ?').run(accountKey(acc.id));
    deps.dropUser(accountKey(acc.id));
    access.claimInvites(acc.email, accountKey(acc.id));
    return { ok: true, email: acc.email };
  });

  // ---- Konto (mit Sitzung) -------------------------------------------------------------------------------------
  /** Sitzung der Anfrage: Cookie (Browser) bzw. `Authorization: Bearer sts_…` (Stachel-App); API-Tokens (stk_) nicht. */
  const sessionSecret = (req: FastifyRequest): string | undefined => {
    const cookie = req.cookies[SESSION_COOKIE];
    if (cookie && sessions.get(cookie)) return cookie;
    return appSessionToken(req.headers.authorization);
  };
  const current = (req: FastifyRequest, reply: FastifyReply): AccountRow | null => {
    const s = sessions.get(sessionSecret(req));
    const acc = s ? accounts.byKey(s.userKey) : undefined;
    if (!s || !acc) {
      sendError(reply, 401, 'not_logged_in', MESSAGES.not_logged_in);
      return null;
    }
    req.session = s;
    return acc;
  };

  /** Eigene Boards (für „Konto löschen“: löschen oder übertragen an eine Person mit Zugriff). */
  const ownedBoards = (key: string) =>
    (db.prepare('SELECT id, title, deleted_at FROM boards WHERE created_by = ? ORDER BY title').all(key) as unknown as { id: string; title: string; deleted_at: string | null }[]).map(
      (b) => ({
        id: b.id,
        title: b.title,
        inTrash: !!b.deleted_at,
        people: access
          .people(b.id)
          .filter((p) => p.key !== key && p.key.startsWith('u:'))
          .map((p) => ({ key: p.key, name: p.name, role: p.role })),
      }),
    );

  app.get('/api/account', async (req, reply) => {
    const acc = current(req, reply);
    if (!acc) return;
    return { ok: true, account: { key: accountKey(acc.id), name: acc.name, email: acc.email, createdAt: acc.created_at }, boards: ownedBoards(accountKey(acc.id)) };
  });

  // ---- Nutzungsbedingungen: Fassung und erneute Zustimmung (Nutzungsbedingungen § 11, STACHEL_TERMS_VERSION) ---------
  /** Stand für die Oberfläche: `pending` = die geltende Fassung ist noch nicht akzeptiert (Dialog in Web und App). */
  const termsState = (acc: AccountRow) => ({
    ok: true,
    url: instance.termsUrl || null,
    version: instance.termsVersion || null,
    acceptedVersion: acc.terms_version,
    acceptedAt: acc.terms_accepted_at,
    pending: Boolean(instance.termsVersion) && acc.terms_version !== instance.termsVersion,
  });
  app.get('/api/account/terms', async (req, reply) => {
    const acc = current(req, reply);
    if (!acc) return;
    reply.header('Cache-Control', 'no-store');
    return termsState(acc);
  });
  app.post('/api/account/terms', async (req, reply) => {
    const acc = current(req, reply);
    if (!acc) return;
    if (!limits.account.allow(acc.id)) return tooMany(reply);
    const b = body(req);
    if (b.accept !== true) {
      return sendError(reply, 400, 'terms_required', 'Bitte akzeptiere die Nutzungsbedingungen und bestätige, dass du mindestens 18 Jahre alt bist.');
    }
    // nur die Fassung, die gerade gilt (sonst hat jemand eine veraltete Seite offen)
    if ((instance.termsVersion || null) !== (typeof b.version === 'string' ? b.version : null)) {
      return sendError(reply, 409, 'terms_changed', 'Die Nutzungsbedingungen wurden gerade geändert. Bitte lade die Seite neu und lies die neue Fassung.');
    }
    const now = nowIso();
    db.prepare('UPDATE accounts SET terms_accepted_at = ?, terms_version = ?, updated_at = ? WHERE id = ?').run(now, instance.termsVersion || null, now, acc.id);
    return termsState(accounts.byId(acc.id)!);
  });

  app.patch('/api/account', async (req, reply) => {
    const acc = current(req, reply);
    if (!acc) return;
    if (!limits.account.allow(acc.id)) return tooMany(reply);
    const name = cleanName(body(req).name);
    if (!name) return sendError(reply, 400, 'invalid_input', `Bitte gib einen Namen an (höchstens ${NAME_MAX} Zeichen).`);
    const key = accountKey(acc.id);
    const now = nowIso();
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE accounts SET name = ?, updated_at = ? WHERE id = ?').run(name, now, acc.id);
      db.prepare('UPDATE sessions SET name = ? WHERE user_key = ?').run(name, key);
      db.prepare('UPDATE boards SET created_by_name = ? WHERE created_by = ?').run(name, key);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    rememberUser(db, { userKey: key, name });
    return { ok: true, user: { key, name, isOrga: false } };
  });

  app.post('/api/account/password', async (req, reply) => {
    const acc = current(req, reply);
    if (!acc) return;
    if (!limits.account.allow(acc.id)) return tooMany(reply);
    const b = body(req);
    const cur = typeof b.current === 'string' ? b.current : '';
    const next = typeof b.password === 'string' ? b.password : '';
    if (!(await verifyPassword(cur, acc.password_hash))) return sendError(reply, 403, 'wrong_password', 'Das bisherige Passwort stimmt nicht.');
    const weak = passwordProblem(next, { email: acc.email, name: acc.name });
    if (weak) return sendError(reply, 400, 'weak_password', weak);
    const now = nowIso();
    db.prepare('UPDATE accounts SET password_hash = ?, updated_at = ? WHERE id = ?').run(await hashPassword(next), now, acc.id);
    // andere Sitzungen beenden, diese bleibt (Cookie bzw. App-Token)
    const mine = sessionSecret(req);
    db.prepare('DELETE FROM sessions WHERE user_key = ? AND id != ?').run(accountKey(acc.id), sha256(mine ?? ''));
    db.prepare('DELETE FROM api_tokens WHERE user_key = ?').run(accountKey(acc.id)); // SEC-05: alle KI-Tokens
    deps.dropUser(accountKey(acc.id), mine);
    return { ok: true };
  });

  /**
   * Konto löschen (DSGVO): `boards` legt je eigenem Board fest, was passiert: 'delete' (Standard) oder der user_key
   * einer Person, die schon Zugriff hat (bekommt den Besitz).
   */
  app.post('/api/account/delete', async (req, reply) => {
    const acc = current(req, reply);
    if (!acc) return;
    if (!limits.account.allow(acc.id)) return tooMany(reply);
    const b = body(req);
    if (!(await verifyPassword(typeof b.password === 'string' ? b.password : '', acc.password_hash))) {
      return sendError(reply, 403, 'wrong_password', 'Das Passwort stimmt nicht.');
    }
    const choice = (b.boards && typeof b.boards === 'object' ? b.boards : {}) as Record<string, unknown>;
    const key = accountKey(acc.id);
    const session = req.session!;
    for (const board of ownedBoards(key)) {
      const to = choice[board.id];
      const target = typeof to === 'string' && to !== 'delete' ? board.people.find((p) => p.key === to) : undefined;
      if (target && !board.inTrash) {
        access.transfer(board.id, { key: target.key, name: target.name }, key);
        access.removeMember(board.id, key);
        deps.notify(board.id, [target.key]);
      } else {
        await deps.purgeBoard(board.id, session);
      }
    }
    access.forgetUser(key);
    // persönliche API-Tokens (MCP) und der Name in Kommentaren, Reaktionen, Stimmen usw. auf fremden Boards
    await deps.forget?.({ key, name: acc.name });
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM sessions WHERE user_key = ?').run(key);
      db.prepare('DELETE FROM board_favorites WHERE user_key = ?').run(key);
      db.prepare('DELETE FROM board_visits WHERE user_key = ?').run(key);
      db.prepare('DELETE FROM user_templates WHERE user_key = ?').run(key);
      db.prepare('DELETE FROM users WHERE key = ?').run(key);
      db.prepare('DELETE FROM board_invites WHERE email = ?').run(acc.email);
      db.prepare('DELETE FROM accounts WHERE id = ?').run(acc.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    deps.dropUser(key);
    deps.clearSessionCookie(reply);
    mailer.queue(mails.deleted(ctx, acc.email, acc.name));
    return { ok: true };
  });

  return { captcha, login };
}

