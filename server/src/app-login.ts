// Automatische Anmeldung aus der App einer Organisation (Modus org, Stachel im WebView der App).
// Vertrag: docs/contract.md §2 „App-Login“. Die App holt mit ihrem Org-Token einen Einmal-Code
// (60 s, einmal einlösbar, nur der Hash liegt in SQLite) und öffnet damit /auth/app im WebView.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { BRAND, SESSION_COOKIE } from '../../shared/protocol.js';
import { nowIso, type Db } from './db.js';
import { MESSAGES, sendError } from './http-util.js';
import type { Identity, OrgIdentityClient } from './org-identity.js';
import { ipKey, RateLimiter } from './rate-limit.js';
import { randomToken, sha256, type SessionStore } from './sessions.js';
import { rememberUser } from './users.js';
import { TokenCrypt } from './token-crypt.js';

export const APP_CODE_PATH = '/api/auth/app-code';
export const APP_LOGIN_PATH = '/auth/app';
export const APP_CODE_TTL_MS = 60_000;
const KEEP_ROWS_MS = 10 * 60_000;
/** Wie Board-IDs (app.ts ID_RE); alles andere wird nicht durchgereicht (kein Open Redirect). */
const BOARD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_codes (
  code_hash TEXT PRIMARY KEY,     -- sha256 des Einmal-Codes (base64url)
  user_key TEXT NOT NULL,
  name TEXT NOT NULL,
  is_orga INTEGER NOT NULL,
  org_token TEXT,            -- nach dem Einlösen NULL
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
`;

interface AppCodeRow {
  code_hash: string;
  user_key: string;
  name: string;
  is_orga: number;
  org_token: string | null;
  expires_at: string;
  used_at: string | null;
}

export interface AppLoginDeps {
  db: Db;
  org: OrgIdentityClient;
  sessions: SessionStore;
  publicUrl: string;
  /** STACHEL_BASE_PATH der Web-App ('' oder z. B. `/app`, site.ts) */
  basePath?: string;
  setSessionCookie: (reply: FastifyReply, cookie: string) => void;
  /** Org-Token der Einmal-Codes verschlüsselt speichern (token-crypt.ts) */
  crypt?: TokenCrypt;
}

export class AppCodeStore {
  constructor(
    private readonly db: Db,
    /** Org-Token verschlüsselt speichern (token-crypt.ts) */
    private readonly crypt: TokenCrypt = TokenCrypt.plain,
  ) {
    db.exec(SCHEMA);
  }

  create(identity: Identity, orgToken: string): { code: string; expiresAt: string } {
    const code = randomToken(32);
    const now = Date.now();
    const expiresAt = new Date(now + APP_CODE_TTL_MS).toISOString();
    this.db
      .prepare(
        `INSERT INTO app_codes (code_hash, user_key, name, is_orga, org_token, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(sha256(code), identity.userKey, identity.name, identity.isOrga ? 1 : 0, this.crypt.seal(orgToken), new Date(now).toISOString(), expiresAt);
    return { code, expiresAt };
  }

  /** Löst einen Code genau einmal ein; null = unbekannt, abgelaufen oder schon benutzt. */
  redeem(code: string): { identity: Identity; orgToken: string } | null {
    if (!code || code.length > 100) return null;
    const hash = sha256(code);
    const row = this.db.prepare('SELECT * FROM app_codes WHERE code_hash = ?').get(hash) as AppCodeRow | undefined;
    if (!row || row.used_at || !row.org_token || row.expires_at <= nowIso()) return null;
    const res = this.db
      .prepare('UPDATE app_codes SET used_at = ?, org_token = NULL WHERE code_hash = ? AND used_at IS NULL')
      .run(nowIso(), hash);
    if (Number(res.changes) !== 1) return null;
    return {
      identity: { userKey: row.user_key, name: row.name, isOrga: row.is_orga === 1 },
      orgToken: this.crypt.open(row.org_token),
    };
  }

  purgeOld(): void {
    const cutoff = new Date(Date.now() - KEEP_ROWS_MS).toISOString();
    this.db.prepare('DELETE FROM app_codes WHERE created_at < ?').run(cutoff);
  }
}

export function registerAppLogin(app: FastifyInstance, deps: AppLoginDeps): AppCodeStore {
  const { db, org, sessions, publicUrl, setSessionCookie } = deps;
  const codes = new AppCodeStore(db, deps.crypt);
  const codeLimiter = new RateLimiter(60, 5 * 60_000); // ein Team hinter einem WLAN teilt sich eine IP
  const redeemLimiter = new RateLimiter(120, 5 * 60_000);

  // Org-App: Einmal-Code holen (kein CSRF-Header nötig, wie /api/auth/qr/approve).
  app.post(APP_CODE_PATH, async (req, reply) => {
    if (!codeLimiter.allow(ipKey(req.ip))) return sendError(reply, 429, 'rate_limited', MESSAGES.rate_limited);
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token || token.length > 4096) return sendError(reply, 401, 'invalid_token', org.messages.invalid_token);

    const check = await org.verifyToken(token);
    if (check.kind !== 'ok') {
      const e = org.verifyError(check)!;
      return sendError(reply, e.status, e.error, e.message);
    }
    const { code, expiresAt } = codes.create(check.identity, token);
    return { ok: true, code, url: `${publicUrl}${APP_LOGIN_PATH}?code=${code}`, expires_at: expiresAt };
  });

  // WebView der App: Code einlösen → Sitzung + Cookie → Board-Liste bzw. Board.
  app.get<{ Querystring: { code?: unknown; b?: unknown; o?: unknown; browser?: unknown } }>(
    APP_LOGIN_PATH,
    { exposeHeadRoute: false }, // HEAD (z. B. Link-Vorschau) darf den Code nicht verbrauchen
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const redeemed = redeemLimiter.allow(ipKey(req.ip)) ? codes.redeem(code) : null;
      if (!redeemed) return reply.code(410).type('text/html; charset=utf-8').send(expiredPage());

      sessions.delete(req.cookies[SESSION_COOKIE]); // alte Sitzung dieses WebViews ersetzen
      const { cookie, session } = sessions.create(redeemed.identity, redeemed.orgToken);
      setSessionCookie(reply, cookie);
      rememberUser(db, session);
      const b = typeof req.query.b === 'string' && BOARD_ID_RE.test(req.query.b) ? req.query.b : '';
      // app=1: Web merkt sich den App-WebView (pages/inApp.ts); browser=1: „Im Browser öffnen“ aus der nativen App
      // (System-Browser, docs/contract.md §8.1) – dort soll sich die Web-App nicht wie im WebView verhalten
      // o: Objekt auf dem Board („Im Browser öffnen“ am Objekt), nur zusammen mit b, gleiches Format
      const o = b && typeof req.query.o === 'string' && BOARD_ID_RE.test(req.query.o) ? `&o=${req.query.o}` : '';
      const home = `${deps.basePath ?? ''}/`;
      if (req.query.browser === '1') return reply.redirect(b ? `${home}?b=${b}${o}` : home, 302);
      return reply.redirect(b ? `${home}?b=${b}${o}&app=1` : `${home}?app=1`, 302);
    },
  );

  const housekeeping = setInterval(() => {
    try {
      codes.purgeOld();
      codeLimiter.prune();
      redeemLimiter.prune();
    } catch (e) {
      app.log.error(e);
    }
  }, 60_000);
  housekeeping.unref();
  app.addHook('onClose', async () => clearInterval(housekeeping));

  return codes;
}

/** Kleine Hinweisseite im Stachel-Look (Schriften wie die QR-Hinweisseite). */
export function expiredPage(): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="${BRAND.black}">
<title>Stachel – Link abgelaufen</title>
<style>
@font-face { font-family: 'Barlow'; font-weight: 400; font-display: swap; src: url(/qr-fonts/barlow-400.woff2) format('woff2'); }
@font-face { font-family: 'Barlow Condensed'; font-weight: 700; font-display: swap; src: url(/qr-fonts/barlow-condensed-700.woff2) format('woff2'); }
html, body { margin: 0; }
body {
  min-height: 100vh; box-sizing: border-box; background: ${BRAND.black}; color: ${BRAND.white};
  font-family: 'Barlow', system-ui, sans-serif; font-size: 18px; line-height: 1.5;
  display: flex; align-items: center; justify-content: center; padding: 24px 16px;
}
main { width: 100%; max-width: 440px; }
.logo { display: flex; align-items: center; gap: 10px; margin-bottom: 32px; }
.logo span { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 28px; letter-spacing: .04em; text-transform: uppercase; }
h1 { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 44px; line-height: 1; text-transform: uppercase; margin: 0 0 16px; }
h1 em { font-style: normal; color: ${BRAND.green}; }
p { margin: 0; color: #e6e6e6; }
</style>
</head>
<body>
<main>
  <div class="logo" aria-hidden="true">
    <svg width="30" height="30" viewBox="0 0 32 32"><circle cx="16" cy="9" r="7" fill="${BRAND.pink}"/><path d="M14.5 15h3L16 31z" fill="${BRAND.white}"/></svg>
    <span>Stachel</span>
  </div>
  <h1>Link <em>abgelaufen</em></h1>
  <p>Tippe in der App einfach nochmal auf Stachel.</p>
</main>
</body>
</html>`;
}
