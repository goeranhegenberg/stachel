import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  CSRF_HEADER,
  PAIR_COOKIE,
  QR_PATH_PREFIX,
  SESSION_COOKIE,
  SESSION_DAYS,
  type BoardInfo,
} from '../../shared/protocol.js';
import type { Config } from './config.js';
import { nowIso, openDb, type Db } from './db.js';
import { IMAGE_CSP, MESSAGES, sendError } from './http-util.js';
import { sniffImage } from './images.js';
import { cleanImage, cleanStoredImages, ImageCleanError } from './image-clean.js';
import { TokenCrypt } from './token-crypt.js';
import { forgetPerson } from './forget-person.js';
import { registerDeletionInfo, registerForgetMe } from './forget-routes.js';
import { registerLegalPages } from './legal-pages.js';
import { ImageVariants, parseVariantWidth } from './image-variants.js';
import { OrgIdentityClient, type Identity } from './org-identity.js';
import { PairingStore } from './pairings.js';
import { APP_CODE_PATH, registerAppLogin } from './app-login.js';
import { notFoundPage, qrHintPage, QR_FONTS } from './qr-page.js';
import { appPath, registerSite } from './site.js';
import { BoardEvents, registerBoardEvents } from './board-events.js';
import { decorateForUser, registerBoardPrefs, setupBoardPrefs } from './board-prefs.js';
import { registerUserTemplates, setupUserTemplates } from './user-templates.js';
import { registerTemplatePacks, TemplatePacks } from './template-packs.js';
import { registerWellKnown } from './well-known.js';
import { registerDocuments } from './documents.js';
import { registerPrivateRoutes } from './private-mode.js';
import { ipKey, logIp, RateLimiter } from './rate-limit.js';
import { setupModeration } from './moderation.js';
import { randomToken, SessionStore, toUser, type Session } from './sessions.js';
import { createSync, type SyncContext } from './sync.js';
import { ApiTokens, registerApiTokens } from './api-tokens.js';
import { registerBoardCopies } from './board-copies.js';
import { forgetVersions, registerVersions } from './versions.js';
import { registerTrash, setupTrash, Trash } from './trash.js';
import { decorateBoards, registerThumbnails, ServerThumbnails } from './thumbnails.js';
import { registerPhotoNotes } from './photo-notes.js';
import { registerUserRoutes, rememberUser, setupUsers } from './users.js';
import type { Hocuspocus } from '@hocuspocus/server';
import { BoardAccess, registerAccessGuard } from './access.js';
import { registerUploadLimits, UploadLimits } from './upload-limits.js';
import { notifyPeople, registerAccessRoutes } from './access-routes.js';
import { Accounts, registerAccounts, registerInstanceInfo } from './accounts.js';
import { applyRetention, legalStartupWarnings, registerDataExport } from './legal.js';
import { createMailer, maskEmail } from './mailer.js';
import { APP_HEADER, APP_SESSION_PATH, APP_SESSION_PREFIX, NATIVE_PATH } from '../../shared/native.js';
import { appSessionToken, registerAppSession } from './native/auth.js';
import { registerNativePublicRoutes, registerNativeRoutes } from './native/routes.js';
import { NativeGateway } from './native/gateway.js';
import { CALLBACK_PATH as IMPORT_CALLBACK_PATH, setupImport, type ImportModule } from './import/routes.js';
import { mapBoard } from './import/miro/map.js';

const require = createRequire(import.meta.url);

const MAX_TITLE = 120;
const MAX_IMAGE_SIDE = 20_000;
/** Mehr Pixel legen beim Dekodieren die Browser aller Board-Teilnehmer lahm (Dekompressionsbombe). */
const MAX_IMAGE_PIXELS = 100_000_000;
/** Gleichzeitige Long-Polls je QR-Code (ein Browser braucht einen, kurz zwei beim Neuladen). */
const MAX_WAITS_PER_CODE = 3;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

interface BoardRow {
  id: string;
  title: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

const toBoard = (r: BoardRow): BoardInfo => ({
  id: r.id,
  title: r.title,
  createdBy: r.created_by,
  createdByName: r.created_by_name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

declare module 'fastify' {
  interface FastifyRequest {
    session?: Session;
  }
}

/**
 * Einmal-Codes (App-Login, QR), Link-Tokens aus Mails (Bestätigen, Zurücksetzen) und E-Mail-Adressen (Einladungs- und
 * Passwort-Links `?…&email=`, `DELETE /api/boards/:id/invites/<adresse>`) nicht ins Log schreiben.
 */
export function redactUrl(url: string): string {
  return url
    .replace(/([?&](?:code|state|conn)=)[^&#]*/g, '$1***')
    .replace(/^(\/api\/auth\/qr\/)(?!approve(?:[/?#]|$))[^/?#]+/, '$1***')
    .replace(/^(\/qr\/)[^/?#]+/, '$1***')
    .replace(/^((?:\/[^/?#]+)*?\/(?:verify|reset)\/)[^/?#]+/, '$1***')
    .replace(/([?&](?:verify|reset|email)=)[^&#]*/g, '$1***')
    .replace(/[^/?&=#]*(?:@|%40)[^/?&#]*/gi, '***');
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** E-Mail-Adressen in Log-Texten (Meldungen, Fehlertexte, z. B. SMTP-Antworten mit der Empfängeradresse) kürzen. */
export function redactText(s: string): string {
  return s.replace(EMAIL_RE, (m) => maskEmail(m));
}

/** Fehler fürs Log: wie pino, aber Meldung und Stack ohne E-Mail-Adressen. */
function logErr(e: unknown): { type: string; message: string; stack: string; [key: string]: unknown } {
  const x = (e instanceof Error ? e : new Error(String(e))) as Error & { code?: unknown; statusCode?: unknown };
  return {
    type: x.constructor?.name ?? 'Error',
    message: redactText(x.message),
    stack: redactText(x.stack ?? ''),
    ...(x.code !== undefined ? { code: x.code } : {}),
    ...(x.statusCode !== undefined ? { statusCode: x.statusCode } : {}),
  };
}

export interface App {
  app: FastifyInstance;
  db: Db;
  sessions: SessionStore;
  pairings: PairingStore;
  hocuspocus: Hocuspocus<SyncContext>;
  /** Papierkorb (trash.ts); Tests rufen purgeExpired mit gefälschter Uhr */
  trash: Trash;
  /** API-Tokens für KI-Assistenten (api-tokens.ts) */
  apiTokens: ApiTokens;
  /** zentrale Board-Rechteprüfung (access.ts, docs/contract.md §6) */
  access: BoardAccess;
  /** Native-API für die Apps (native/gateway.ts, docs/contract.md §8) */
  native: NativeGateway;
  /** einmaliges Bereinigen alter Bild-Originale (image-clean.ts); Zahl der geänderten Bilder */
  imageCleanup: Promise<number>;
  /** Vorschaubilder (thumbnails.ts) */
  thumbs: ServerThumbnails;
  /** Import aus Miro (import/routes.ts): Verbindungen, Aufträge */
  imports: ImportModule;
  close: () => Promise<void>;
}

export async function buildApp(cfg: Config): Promise<App> {
  if (cfg.instance.auth === 'org' && !cfg.orgIdentityUrl) {
    throw new Error('STACHEL_AUTH=org braucht STACHEL_ORG_IDENTITY_URL (http(s)-Adresse des Identitätsdienstes, docs/contract.md §1).');
  }
  const db = openDb(cfg.dataDir);
  setupUsers(db);
  setupBoardPrefs(db);
  setupUserTemplates(db);
  setupTrash(db);
  const events = new BoardEvents();
  const imagesDir = path.join(cfg.dataDir, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });
  const uploads = new UploadLimits(db, cfg.limits);

  const org = new OrgIdentityClient({
    identityUrl: cfg.orgIdentityUrl,
    loginUrl: cfg.orgLoginUrl,
    timeoutMs: cfg.orgTimeoutMs,
    name: cfg.instance.orgName,
  });
  // Betriebsart (instance.ts): local = eigene Konten (accounts.ts) und Board-Rechte (access.ts), org = Identitätsdienst
  const accounts = cfg.instance.auth === 'local' ? new Accounts(db) : null;
  const templatePacks = new TemplatePacks(cfg.templatePacks, (msg) => app.log.warn(msg));
  const verifier = accounts?.verifier() ?? org;
  const access = new BoardAccess(db, cfg.instance.auth);
  // Org-Tokens für die Nachprüfung verschlüsselt in SQLite (token-crypt.ts, STACHEL_TOKEN_KEY)
  const crypt = TokenCrypt.fromKey(cfg.tokenKey);
  const sessions = new SessionStore(db, verifier, crypt);
  const pairings = new PairingStore(db, crypt);
  // Persönliche API-Tokens für KI-Assistenten (MCP), api-tokens.ts
  const apiTokens = new ApiTokens(db, verifier, crypt);
  // Vorschaubilder der Übersicht rendert der Server (P8, thumbnails.ts): nach dem Speichern gedrosselt, beim Start nachholen
  const thumbs = new ServerThumbnails({
    db,
    imagesDir,
    events,
    ...(cfg.thumbnailIdleMs !== undefined ? { idleMs: cfg.thumbnailIdleMs } : {}),
    ...(cfg.thumbnailGapMs !== undefined ? { minGapMs: cfg.thumbnailGapMs } : {}),
    log: (msg, err) => app.log.warn({ err }, msg),
  });
  const sync = createSync(cfg, db, sessions, events, apiTokens, access, (id) => thumbs.schedule(id));
  apiTokens.attach(sync.hocuspocus);
  // Native-API (Apps ohne WebView): JSON auf Objekt-Ebene über /native/v1, der Server schreibt Yjs
  const native = new NativeGateway({ cfg, db, sessions, hocuspocus: sync.hocuspocus, events, access, privateMode: sync.privateMode });
  /** Person vergessen (Konto löschen): API-Tokens, Posteingang, Name auf Boards → „Gelöschtes Konto“ (forget-person.ts) */
  const forget = async (who: { key: string; name?: string }) => {
    // Import aus Miro: Widerruf versuchen, Verbindungen und Import-Berichte löschen (import/routes.ts)
    await imports.forgetUser(who.key);
    // Privat-Ablagen der Person (privater Modus) gehören nur ihr: ganz löschen
    await sync.privateMode.forgetUser(who.key);
    // eigene Liste blockierter Personen weg; in Meldungen bleibt der Beleg, die Mail-Adresse der Person geht (blocks.ts, reports.ts)
    const hasTable = (t: string) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
    if (hasTable('user_blocks')) db.prepare('DELETE FROM user_blocks WHERE user_key = ?').run(who.key);
    if (hasTable('reports')) db.prepare('UPDATE reports SET reporter_email = NULL WHERE reporter_key = ?').run(who.key);
    return forgetPerson(
      { db, hocuspocus: sync.hocuspocus, forgetTokens: (k) => apiTokens.forgetUser(k), renameInVersionTracks: (k, n) => sync.versions.renamePerson(k, n) },
      who,
    );
  };
  /** Verbindungen einer Person trennen; `exceptCookie` = eigene Sitzung (Cookie bzw. sts_-Token) bleibt verbunden. */
  const dropUser = (key: string, opts: { boardId?: string; exceptCookie?: string } = {}) => {
    sync.dropUser(key, opts);
    native.dropUser(key, { ...(opts.boardId ? { boardId: opts.boardId } : {}), ...(opts.exceptCookie ? { exceptToken: opts.exceptCookie } : {}) });
  };

  // Passwort-Login je IP: nur Fehlversuche zählen (ein Orga-Treffen im selben WLAN meldet sich oft an), dazu eine
  // grobe Bremse gegen Fluten aller Versuche
  const loginFailLimiter = new RateLimiter(10, 5 * 60_000);
  const loginFloodLimiter = new RateLimiter(60, 5 * 60_000);
  // je Benutzername (unabhängig von der IP): bremst verteiltes Raten, zählt nur Fehlversuche
  const userLoginLimiter = new RateLimiter(10, 15 * 60_000);
  const approveLimiter = new RateLimiter(30, 5 * 60_000);
  const qrLimiter = new RateLimiter(60, 5 * 60_000);
  const infoLimiter = new RateLimiter(60, 5 * 60_000);

  const app = Fastify({
    logger:
      cfg.logLevel === 'silent'
        ? false
        : {
            level: cfg.logLevel,
            serializers: {
              // zur Laufzeit ein FastifyRequest (mit ip hinter dem Proxy)
              req: (raw) => {
                const req = raw as unknown as { method?: string; url?: string; ip?: string };
                // IP nur gekürzt: das vollständige Zugriffsprotokoll führt nginx (14 Tage), dieses Protokoll rotiert nur nach Größe
                return { method: req.method, url: redactUrl(req.url ?? ''), remoteAddress: logIp(req.ip) };
              },
              err: logErr,
              error: logErr,
            },
            // Meldungstexte aller Log-Zeilen ohne E-Mail-Adressen (Datenschutz)
            hooks: {
              logMethod(args, method) {
                return method.apply(this, args.map((a) => (typeof a === 'string' ? redactText(a) : a)) as Parameters<typeof method>);
              },
            },
          },
    trustProxy: cfg.trustProxy,
    bodyLimit: 1024 * 1024,
  });
  // Import aus Miro (docs/features/import.md): Verbindungen, Aufträge, Routen
  const imports = setupImport({
    cfg,
    db,
    imagesDir,
    sessions,
    uploads,
    events,
    saveVersion: (id, name, by) => sync.versions.saveNamed(id, name, by),
    emailOf: (key) => accounts?.byKey(key)?.email ?? null,
    mapBoard,
    log: (msg) => app.log.info(msg),
  });
  // verkleinerte Fassungen (?w=256|1024), beim ersten Abruf erzeugt; eigener Ordner, damit images/ nur Originale hat
  const variants = new ImageVariants(path.join(cfg.dataDir, 'image-variants'), (msg, err) => app.log.warn({ err }, msg));
  // Papierkorb: Löschen ist umkehrbar, nach 30 Tagen räumt der Server auf (trash.ts)
  const trash = new Trash({
    db,
    hocuspocus: sync.hocuspocus,
    imagesDir,
    variants,
    events,
    dropBoard: sync.dropBoard,
    toBoard,
    onPurge: (id) => forgetVersions(db, id),
    log: (msg, err) => app.log.warn({ err }, msg),
    // Modus local: im Papierkorb nur die eigenen Boards (access.ts)
    visible: access.local ? (s, id) => access.roleOf({ key: s.userKey }, id) === 'owner' : undefined,
  });
  trash.start();

  const publicOrigin = new URL(cfg.publicUrl);
  // Web-App unter STACHEL_BASE_PATH (site.ts): Startseite der App und ihre öffentliche Adresse für Mail-/Teilen-Links
  const appHome = appPath(cfg.basePath);
  const appUrl = `${cfg.publicUrl}${cfg.basePath}`;
  const notFound = () => notFoundPage(appHome);
  const wsOrigin = `${publicOrigin.protocol === 'https:' ? 'wss:' : 'ws:'}//${publicOrigin.host}`;

  await app.register(fastifyCookie);
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        // wasm-unsafe-eval: nur WebAssembly übersetzen (pdf.js dekodiert damit JBIG2/JPEG 2000 in PDFs), kein eval
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", wsOrigin],
        workerSrc: ["'self'", 'blob:'],
        manifestSrc: ["'self'"],
        mediaSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(cfg.cookieSecure ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: cfg.cookieSecure ? { maxAge: 31536000, includeSubDomains: false } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
  await app.register(fastifyMultipart, {
    limits: { fileSize: cfg.limits.uploadMaxBytes, files: 1, fields: 5, parts: 6 },
  });

  // JSON: leerer Body ist erlaubt ({}), kaputtes JSON → 400.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = String(body);
    if (!text.trim()) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      const err = new Error('invalid_json') as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status === 413 || err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return sendError(reply, 413, 'too_large', uploads.tooLargeText());
    }
    if (status === 404 || (status === 403 && err.name === 'ForbiddenError')) {
      return sendError(reply, 404, 'not_found', MESSAGES.not_found); // u. a. Verzeichnisse aus web/dist
    }
    if (status >= 400 && status < 500) return sendError(reply, status, 'invalid_input', MESSAGES.invalid_input);
    req.log.error(err);
    return sendError(reply, 500, 'internal', 'Da ist etwas schiefgelaufen.');
  });

  const cookieBase = { httpOnly: true, sameSite: 'lax' as const, secure: cfg.cookieSecure };
  const setSessionCookie = (reply: FastifyReply, value: string, expiresAt?: string) => {
    const maxAge = expiresAt
      ? Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000))
      : SESSION_DAYS * 24 * 3600;
    reply.setCookie(SESSION_COOKIE, value, { ...cookieBase, path: '/', maxAge });
  };
  const clearSessionCookie = (reply: FastifyReply) => reply.clearCookie(SESSION_COOKIE, { ...cookieBase, path: '/' });
  const pairCookieOpts = { ...cookieBase, path: '/api/auth/qr' };

  const pathOf = (req: FastifyRequest) => req.url.split('?')[0] ?? '';
  /**
   * Pfad für Sicherheitsentscheidungen: das Muster der getroffenen Route (der Router dekodiert z. B. `/%61pi/boards`
   * zu `/api/boards`, der rohe Pfad fiele sonst durch die CSRF-Prüfung). Ohne Route: dekodierter roher Pfad.
   */
  const routePathOf = (req: FastifyRequest) => {
    const route = req.routeOptions?.url;
    if (route) return route;
    try {
      return decodeURIComponent(pathOf(req));
    } catch {
      return pathOf(req);
    }
  };

  // CSRF: zustandsändernde API-Requests brauchen X-Stachel: 1 (außer approve aus der App).
  app.addHook('onRequest', async (req, reply) => {
    const p = routePathOf(req);
    if (!p.startsWith('/api/')) return;
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
    if (p === '/api/auth/qr/approve' || p === APP_CODE_PATH) return;
    if (p === APP_SESSION_PATH && req.method === 'POST') return; // Org-App holt ihr Token (wie app-code)
    if (p === IMPORT_CALLBACK_PATH && req.method === 'POST') return; // Bestätigungsseite (Formular), abgesichert über state + nonce
    if (req.headers[CSRF_HEADER.toLowerCase()] !== '1') return sendError(reply, 403, 'csrf', MESSAGES.csrf);
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (routePathOf(req).startsWith('/api/') && !reply.hasHeader('cache-control')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  // Moderation (moderation.ts): gesperrte Konten an der Wurzel abweisen, Admin-API für tools/admin.mts; Melden und
  // Blockieren hängen unten im Sitzungs-Scope (moderation.routes)
  const moderation = await setupModeration(app, {
    db,
    sessions,
    access,
    hocuspocus: sync.hocuspocus,
    mailer: () => mailer,
    instance: cfg.instance,
    appUrl,
    emailOf: (key) => accounts?.byKey(key)?.email ?? null,
    dropUser: (key, opts) => dropUser(key, opts ?? {}),
    forgetTokens: (key) => apiTokens.forgetUser(key),
    deleteBoard: async (id) => {
      const row = db.prepare('SELECT * FROM boards WHERE id = ?').get(id) as (BoardRow & { deleted_at?: string | null }) | undefined;
      if (!row) return false;
      if (!row.deleted_at) trash.moveToTrash(row, { userKey: 'moderation', name: 'Moderation', isOrga: true });
      return trash.purge(id);
    },
    log: (msg) => app.log.info(msg),
  });

  const requireSession = async (req: FastifyRequest, reply: FastifyReply) => {
    // ohne Cookie: App-Sitzung (Bearer sts_…, Apps) bzw. persönliches API-Token (Bearer stk_…, KI über MCP)
    const session =
      sessions.get(req.cookies[SESSION_COOKIE]) ?? sessions.get(appSessionToken(req.headers.authorization)) ?? (await apiTokens.fromRequest(req));
    if (!session) return sendError(reply, 401, 'not_logged_in', MESSAGES.not_logged_in);
    req.session = session;
  };

  // ---------- Auth ----------

  app.get('/api/health', async () => ({ ok: true }));

  /**
   * Passwort-Anmeldung über die Organisation (STACHEL_ORG_LOGIN_URL, Body `{username, password}`) samt Rate-Limits; gemeinsam für den
   * Browser (`/api/auth/password`, Cookie) und die Stachel-App (`POST /api/auth/app-session`, sts_-Token). Fehler sind
   * schon gesendet, wenn null zurückkommt.
   */
  const orgPasswordLogin = async (req: FastifyRequest, reply: FastifyReply): Promise<{ identity: Identity; token: string } | null> => {
    const fail = (status: number, error: string, message: string) => {
      sendError(reply, status, error, message);
      return null;
    };
    if (!org.passwordLogin) return fail(404, 'not_found', MESSAGES.not_found);
    const ip = ipKey(req.ip);
    if (loginFailLimiter.blocked(ip) || !loginFloodLimiter.allow(ip)) return fail(429, 'rate_limited', MESSAGES.rate_limited);
    const body = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password || username.length > 200 || password.length > 1000) {
      return fail(400, 'invalid_input', 'Bitte Benutzername und Passwort eingeben.');
    }
    const userKey = username.toLowerCase();
    if (userLoginLimiter.blocked(userKey)) return fail(429, 'rate_limited', MESSAGES.rate_limited);
    const login = await org.login(username, password);
    if (login.kind === 'invalid') {
      userLoginLimiter.hit(userKey);
      loginFailLimiter.hit(ip);
      return fail(401, 'invalid_credentials', 'Benutzername oder Passwort ist falsch.');
    }
    if (login.kind === 'rate_limited') return fail(429, 'rate_limited', MESSAGES.rate_limited);
    if (login.kind === 'unreachable') return fail(502, 'org_unreachable', org.messages.org_unreachable);
    const check = await org.verifyToken(login.token);
    if (check.kind === 'invalid') {
      loginFailLimiter.hit(ip);
      return fail(401, 'invalid_credentials', 'Benutzername oder Passwort ist falsch.');
    }
    if (check.kind !== 'ok') {
      const e = org.verifyError(check)!;
      return fail(e.status, e.error, e.message);
    }
    return { identity: check.identity, token: login.token };
  };

  app.post('/api/auth/password', async (req, reply) => {
    const login = await orgPasswordLogin(req, reply);
    if (!login) return reply;
    const { cookie, session } = sessions.create(login.identity, login.token);
    setSessionCookie(reply, cookie);
    rememberUser(db, session);
    return { ok: true, user: toUser(session) };
  });

  app.post('/api/auth/qr', async (req, reply) => {
    if (!qrLimiter.allow(ipKey(req.ip))) return sendError(reply, 429, 'rate_limited', MESSAGES.rate_limited);
    const p = pairings.create(req.cookies[PAIR_COOKIE], { userAgent: req.headers['user-agent'], ip: req.ip });
    reply.setCookie(PAIR_COOKIE, p.secret, { ...pairCookieOpts, maxAge: 5 * 60 });
    return { ok: true, code: p.code, url: `${cfg.publicUrl}${QR_PATH_PREFIX}${p.code}`, expires_at: p.expiresAt };
  });

  const waiting = new Map<string, number>();
  app.get<{ Params: { code: string } }>('/api/auth/qr/:code/wait', async (req, reply) => {
    const code = req.params.code;
    const n = waiting.get(code) ?? 0;
    if (n >= MAX_WAITS_PER_CODE) return sendError(reply, 429, 'rate_limited', MESSAGES.rate_limited);
    waiting.set(code, n + 1);
    const ac = new AbortController();
    const onClose = () => ac.abort();
    reply.raw.once('close', onClose);
    try {
      const res = await pairings.wait(code, req.cookies[PAIR_COOKIE], cfg.qrWaitMs, ac.signal);
      switch (res.status) {
        case 'pending':
          return { ok: true, status: 'pending' };
        case 'wrong_browser':
          return sendError(reply, 403, 'wrong_browser', 'Dieser Code wurde in einem anderen Browser erzeugt.');
        case 'expired':
          return sendError(reply, 410, 'expired', 'Der Code ist abgelaufen.');
        case 'approved': {
          // Stachel-App (Header X-Stachel-App: 1, Vertrag §8.1): sts_-Token im Body statt Sitzungs-Cookie
          const forApp = req.headers[APP_HEADER] === '1';
          const { cookie, session } = sessions.create(res.identity, res.orgToken, forApp ? APP_SESSION_PREFIX : '');
          rememberUser(db, session);
          reply.clearCookie(PAIR_COOKIE, pairCookieOpts);
          if (forApp) return { ok: true, status: 'approved', user: toUser(session), token: cookie, expiresAt: session.expiresAt };
          setSessionCookie(reply, cookie);
          return { ok: true, status: 'approved', user: toUser(session) };
        }
      }
    } finally {
      reply.raw.off('close', onClose);
      const left = (waiting.get(code) ?? 1) - 1;
      if (left > 0) waiting.set(code, left);
      else waiting.delete(code);
    }
  });

  // Org-App: vor dem Freigeben zeigen, welcher Browser sich anmelden will (gegen QR-Phishing).
  app.get<{ Params: { code: string } }>('/api/auth/qr/:code/info', async (req, reply) => {
    if (!infoLimiter.allow(ipKey(req.ip))) return sendError(reply, 429, 'rate_limited', MESSAGES.rate_limited);
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token || token.length > 4096) return sendError(reply, 401, 'invalid_token', org.messages.invalid_token);
    const check = await org.verifyToken(token);
    if (check.kind !== 'ok') {
      const e = org.verifyError(check)!;
      return sendError(reply, e.status, e.error, e.message);
    }
    const res = pairings.info(req.params.code.trim());
    switch (res.check) {
      case 'unknown_code':
        return sendError(reply, 404, 'unknown_code', 'Diesen Code kennt Stachel nicht.');
      case 'expired':
        return sendError(reply, 410, 'expired', 'Der Code ist abgelaufen. Bitte im Browser neu laden.');
      case 'already_used':
        return sendError(reply, 409, 'already_used', 'Dieser Code wurde schon benutzt.');
    }
    const i = res.info!;
    return { ok: true, browser: i.browser, os: i.os, created_at: i.createdAt, ip_hint: i.ipHint };
  });

  app.post('/api/auth/qr/approve', async (req, reply) => {
    if (!approveLimiter.allow(ipKey(req.ip))) return sendError(reply, 429, 'rate_limited', MESSAGES.rate_limited);
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token || token.length > 4096) return sendError(reply, 401, 'invalid_token', org.messages.invalid_token);
    const body = (req.body ?? {}) as { code?: unknown };
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!code) return sendError(reply, 400, 'invalid_input', 'Code fehlt.');

    const check = await org.verifyToken(token);
    if (check.kind !== 'ok') {
      const e = org.verifyError(check)!;
      return sendError(reply, e.status, e.error, e.message);
    }
    const res = pairings.approve(code, check.identity, token);
    switch (res) {
      case 'ok':
        return { ok: true, name: check.identity.name };
      case 'unknown_code':
        return sendError(reply, 404, 'unknown_code', 'Diesen Code kennt Stachel nicht.');
      case 'expired':
        return sendError(reply, 410, 'expired', 'Der Code ist abgelaufen. Bitte im Browser neu laden.');
      case 'already_used':
        return sendError(reply, 409, 'already_used', 'Dieser Code wurde schon benutzt.');
    }
  });

  // Automatische Anmeldung aus der Org-App (WebView), siehe app-login.ts
  registerAppLogin(app, { db, org, sessions, publicUrl: cfg.publicUrl, basePath: cfg.basePath, setSessionCookie, crypt });
  // Native-API: Versionsinfo (native/routes.ts); App-Sitzung (Bearer sts_…) weiter unten
  registerNativePublicRoutes(app, { minApps: { org: cfg.nativeMinApp, stachel: cfg.nativeMinStachelApp }, devActions: cfg.nativeDevActions });

  // Betriebsart für die Web-App; Modus local: eigene Konten (accounts.ts), Org-Anmeldung aus
  registerInstanceInfo(app, cfg.instance, { orgPasswordLogin: org.passwordLogin, orgAndroidPackage: cfg.androidPackage || null, photoNotes: cfg.photoNotes.enabled });
  const mailer = createMailer(cfg.instance, cfg.dataDir, (msg, err) => (err ? app.log.error({ err }, msg) : app.log.info(msg)));
  let localLogin: ReturnType<typeof registerAccounts>['login'] | null = null;
  if (accounts) {
    ({ login: localLogin } = registerAccounts(app, {
      db,
      accounts,
      access,
      sessions,
      mailer,
      instance: cfg.instance,
      appUrl,
      basePath: cfg.basePath,
      setSessionCookie,
      clearSessionCookie,
      notFoundPage: notFound,
      dropUser: (key, exceptCookie) => dropUser(key, exceptCookie ? { exceptCookie } : {}),
      purgeBoard: async (id, by) => {
        const row = db.prepare('SELECT * FROM boards WHERE id = ?').get(id) as (BoardRow & { deleted_at?: string | null }) | undefined;
        if (row && !row.deleted_at) trash.moveToTrash(row, by);
        await trash.purge(id);
      },
      notify: (id, keys) => notifyPeople(events, id, keys),
      forget: (who) => forget(who),
    }));
  }
  // „Meine Daten herunterladen“ (Art. 20 DSGVO, legal.ts): ZIP mit Konto und eigenen Boards
  if (accounts) registerDataExport(app, { db, accounts, sessions, hocuspocus: sync.hocuspocus, imagesDir, instance: cfg.instance, appUrl });
  // Modus org: „Meine Daten bei Stachel löschen“ (POST /api/account/delete, forget-routes.ts); beide Modi: /konto-loeschen
  if (!accounts) registerForgetMe(app, { db, sessions, forget: (who) => forget(who), dropUser: (key) => dropUser(key), clearSessionCookie });
  registerDeletionInfo(app, { instance: cfg.instance, appUrl, basePath: cfg.basePath });
  // Impressum, Datenschutz, Nutzungsbedingungen aus <DATA_DIR>/legal (nur wenn die Instanz eigene Texte hinterlegt)
  registerLegalPages(app, { instance: cfg.instance, dir: cfg.legalDir, publicUrl: cfg.publicUrl, appUrl, basePath: cfg.basePath });
  // App-Sitzung (Bearer sts_…, native/auth.ts): Org-App mit Org-Token, Stachel-App mit Zugangsdaten wie der
  // Browser-Login des jeweiligen Modus
  registerAppSession(app, {
    db,
    org,
    sessions,
    dropSession: (t) => native.dropSession(t),
    mode: cfg.instance.auth,
    credentials: localLogin ?? orgPasswordLogin,
  });

  app.get('/api/auth/me', async (req, reply) => {
    // Apps: Bearer sts_… (kein Cookie), Nachprüfung wie beim Browser
    const appToken = req.cookies[SESSION_COOKIE] ? undefined : appSessionToken(req.headers.authorization);
    if (appToken) {
      const s = await sessions.getVerified(appToken);
      if (!s) return sendError(reply, 401, 'not_logged_in', MESSAGES.not_logged_in);
      rememberUser(db, s);
      return { ok: true, user: toUser(s), expiresAt: s.expiresAt };
    }
    const cookie = req.cookies[SESSION_COOKIE];
    const session = await sessions.getVerified(cookie);
    if (!session || !cookie) {
      if (cookie) clearSessionCookie(reply);
      return sendError(reply, 401, 'not_logged_in', MESSAGES.not_logged_in);
    }
    setSessionCookie(reply, cookie, session.expiresAt);
    rememberUser(db, session);
    return { ok: true, user: toUser(session) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    sessions.delete(req.cookies[SESSION_COOKIE]);
    sync.dropSession(req.cookies[SESSION_COOKIE]);
    clearSessionCookie(reply);
    return { ok: true };
  });

  // ---------- Boards & Bilder ----------

  await app.register(async (scope) => {
    scope.addHook('preHandler', requireSession);
    // Modus local: Board-Rechte für alle Routen mit Board-/Bild-ID (access.ts), vor dem Papierkorb-Guard
    registerAccessGuard(scope, access);
    // Speicherquote, Upload-Größe/-Rate, Boards je Person (upload-limits.ts, Review UPL-2)
    registerUploadLimits(scope, uploads);
    // Boards im Papierkorb: /api/boards/:id… → 410 in_trash (trash.ts)
    scope.addHook('preHandler', trash.guard);
    registerUserRoutes(scope, db);
    // Modus local: Teilen-Dialog, Personen je Board (access-routes.ts)
    if (accounts) {
      registerAccessRoutes(scope, {
        db,
        access,
        accounts,
        mailer,
        events,
        instance: cfg.instance,
        appUrl,
        limits: cfg.limits,
        dropUser: (key, opts) => dropUser(key, opts),
      });
    }

    const getBoard = (id: string) =>
      ID_RE.test(id) ? (db.prepare('SELECT * FROM boards WHERE id = ? AND deleted_at IS NULL').get(id) as BoardRow | undefined) : undefined;
    /** undefined = nicht angegeben, null = ungültig. */
    const readTitle = (body: unknown): string | null | undefined => {
      const t = (body as { title?: unknown } | null)?.title;
      if (t === undefined || t === null) return undefined;
      if (typeof t !== 'string') return null;
      const s = t.replace(/\s+/g, ' ').trim();
      return s.length > MAX_TITLE ? null : s;
    };
    // Melden, Blockieren, Moderations-Hinweis je Board (reports.ts, blocks.ts, moderation.ts)
    moderation.routes(scope);

    // Vorschaubilder, Duplizieren, Vorlagen (Feature-Modul tools)
    await registerThumbnails(scope, { db, boardExists: (id) => Boolean(getBoard(id)), events });
    registerBoardCopies(scope, { db, hocuspocus: sync.hocuspocus, imagesDir, getBoard, toBoard, events });
    // Versionsverlauf (versions.ts)
    registerVersions(scope, { db, versions: sync.versions, imagesDir, getBoard, toBoard, events });
    // Favoriten, „zuletzt geöffnet“ und Live-Übersicht
    registerBoardPrefs(scope, { db, boardExists: (id) => Boolean(getBoard(id)) });
    // Eigene Vorlagen aus einer Auswahl (user-templates.ts)
    registerUserTemplates(scope, { db });
    // Vorlagen der Instanz aus STACHEL_TEMPLATES_DIR (template-packs.ts)
    registerTemplatePacks(scope, templatePacks);
    registerBoardEvents(scope, events, access.local ? (req, e) => access.eventVisible({ key: req.session!.userKey }, e) : undefined);
    // PDF-Dokumente: Original hochladen/abrufen (Seiten kommen als Bilder)
    registerDocuments(scope, { db, imagesDir, boardExists: (id) => Boolean(getBoard(id)), uploads });
    // Zettel abfotografieren: Foto → Zettel mit Farbe und Text, nur im Speicher (photo-notes.ts, P10)
    await registerPhotoNotes(scope, { cfg: cfg.photoNotes, boardExists: (id) => Boolean(getBoard(id)) });
    // Privater Modus: Zustand, Starten, Aufdecken (private-mode.ts, docs/features/private.md)
    registerPrivateRoutes(scope, sync.privateMode, (id) => Boolean(getBoard(id)));
    registerTrash(scope, trash, db);
    // KI-Zugang (MCP): Tokens verwalten (api-tokens.ts)
    registerApiTokens(scope, { tokens: apiTokens, mcpUrl: cfg.mcpUrl ?? `${cfg.publicUrl}/mcp` });
    // Apps: native REST-Routen mit Sitzung, z. B. Posteingang (native/routes.ts, Vertrag §8.11)
    // Import aus Miro (import/routes.ts, docs/features/import.md §2)
    imports.routes(scope);
    registerNativeRoutes(scope, { inbox: sync.inbox, versions: sync.versions, boardTitle: (id) => getBoard(id)?.title, ...(access.local ? { visible: (req: FastifyRequest, boardId: string) => access.roleOf({ key: req.session!.userKey }, boardId) !== null } : {}) });

    scope.get<{ Querystring: { open?: string } }>('/api/boards', async (req) => {
      const all = db
        .prepare('SELECT * FROM boards WHERE deleted_at IS NULL ORDER BY updated_at DESC, created_at DESC')
        .all() as unknown as BoardRow[];
      // Modus local: nur Boards mit Zugriff (+ `role`); `?open=<id>` = gerade per Link geöffnet (access.ts)
      const me = { key: req.session!.userKey, isOrga: req.session!.isOrga };
      if (typeof req.query.open === 'string') access.noteOpen(me, req.query.open);
      // Modus org: alle Boards außer von der Moderation ausgeblendeten
      const rows = access.visibleBoards(me, all);
      return { ok: true, boards: access.decorate(me, decorateForUser(db, req.session!.userKey, decorateBoards(db, rows.map(toBoard)))) };
    });

    scope.post('/api/boards', async (req, reply) => {
      const title = readTitle(req.body);
      if (title === null) {
        return sendError(reply, 400, 'invalid_input', `Der Titel darf höchstens ${MAX_TITLE} Zeichen haben.`);
      }
      const s = req.session!;
      const now = nowIso();
      const row: BoardRow = {
        id: randomToken(9),
        title: title || 'Unbenanntes Board',
        created_by: s.userKey,
        created_by_name: s.name,
        created_at: now,
        updated_at: now,
      };
      db.prepare(
        'INSERT INTO boards (id, title, created_by, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(row.id, row.title, row.created_by, row.created_by_name, row.created_at, row.updated_at);
      events.emit({ type: 'created', id: row.id });
      return reply.code(201).send({ ok: true, board: toBoard(row) });
    });

    scope.patch<{ Params: { id: string } }>('/api/boards/:id', async (req, reply) => {
      const board = getBoard(req.params.id);
      if (!board) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
      const title = readTitle(req.body);
      if (!title) {
        return sendError(reply, 400, 'invalid_input', `Bitte gib einen Titel ein (höchstens ${MAX_TITLE} Zeichen).`);
      }
      const now = nowIso();
      db.prepare('UPDATE boards SET title = ?, updated_at = ? WHERE id = ?').run(title, now, board.id);
      // Reihenfolge der Umbenennungen = Reihenfolge hier (synchron): die höchste Nummer gewinnt bei allen
      const titleSeq = events.nextTitleSeq();
      events.emit({ type: 'renamed', id: board.id, title, titleSeq });
      return { ok: true, board: { ...toBoard({ ...board, title, updated_at: now }), titleSeq } };
    });

    // Löschen = in den Papierkorb (trash.ts); endgültig erst dort bzw. nach 30 Tagen
    scope.delete<{ Params: { id: string } }>('/api/boards/:id', async (req, reply) => {
      const board = getBoard(req.params.id);
      if (!board) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
      const s = req.session!;
      if (board.created_by !== s.userKey && !s.isOrga) {
        return sendError(reply, 403, 'forbidden', 'Nur wer das Board erstellt hat oder die Orga darf es löschen.');
      }
      const trashed = trash.moveToTrash(board, s);
      if (!trashed) return sendError(reply, 410, 'in_trash', 'Dieses Board liegt im Papierkorb.');
      return { ok: true, board: trashed };
    });

    scope.post<{ Params: { id: string } }>('/api/boards/:id/images', async (req, reply) => {
      const board = getBoard(req.params.id);
      if (!board) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
      if (!req.isMultipart()) return sendError(reply, 400, 'invalid_input', 'Bitte ein Bild hochladen.');
      const part = await req.file();
      if (!part || part.fieldname !== 'file') return sendError(reply, 400, 'invalid_input', 'Bitte ein Bild hochladen.');
      let buf: Buffer;
      try {
        buf = await part.toBuffer();
      } catch (e) {
        if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
          return sendError(reply, 413, 'too_large', uploads.tooLargeText('image'));
        }
        throw e;
      }
      const info = sniffImage(buf);
      if (!info) return sendError(reply, 415, 'unsupported_type', 'Nur PNG, JPEG, WebP oder GIF sind erlaubt.');
      if (info.width > MAX_IMAGE_SIDE || info.height > MAX_IMAGE_SIDE || info.width * info.height > MAX_IMAGE_PIXELS) {
        return sendError(reply, 413, 'too_large', 'Das Bild hat zu viele Pixel.');
      }
      // ohne EXIF/GPS, XMP, Kommentare; EXIF-Drehung eingerechnet (image-clean.ts)
      let clean: Awaited<ReturnType<typeof cleanImage>>;
      try {
        clean = await cleanImage(buf, info);
      } catch (e) {
        if (e instanceof ImageCleanError) return sendError(reply, 415, 'unsupported_type', 'Das Bild ließ sich nicht lesen.');
        throw e;
      }
      buf = clean.buf;
      const id = randomToken(16);
      const file = path.join(imagesDir, id);
      await fs.promises.writeFile(`${file}.tmp`, buf);
      await fs.promises.rename(`${file}.tmp`, file);
      db.prepare(
        'INSERT INTO images (id, board_id, mime, width, height, bytes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, board.id, clean.info.mime, clean.info.width, clean.info.height, buf.length, req.session!.userKey, nowIso());
      return reply
        .code(201)
        .send({ ok: true, image: { id, url: `/api/images/${id}`, width: clean.info.width, height: clean.info.height } });
    });

    scope.get<{ Params: { id: string }; Querystring: { w?: string } }>('/api/images/:id', async (req, reply) => {
      const id = req.params.id;
      const w = parseVariantWidth(req.query.w);
      if (w === 'invalid') return sendError(reply, 400, 'invalid_input', 'Unbekannte Bildgröße (erlaubt: w=256 oder w=1024).');
      const row = ID_RE.test(id)
        ? (db.prepare('SELECT mime, width FROM images WHERE id = ?').get(id) as { mime: string; width: number } | undefined)
        : undefined;
      const file = path.join(imagesDir, id);
      if (!row || !fs.existsSync(file)) return sendError(reply, 404, 'not_found', 'Bild nicht gefunden.');
      // kleinere Fassung, falls angefragt und sinnvoll; sonst (GIF, schon klein, Fehler) das Original
      const variant = w ? await variants.get(id, file, row, w) : null;
      return reply
        .header('Cache-Control', 'private, max-age=31536000, immutable')
        .header('Content-Disposition', 'inline')
        .header('Content-Security-Policy', IMAGE_CSP)
        .type(variant ? 'image/webp' : row.mime)
        .send(fs.createReadStream(variant ?? file));
    });
  });

  // Rückruf von Miro (ohne Sitzungspflicht, import/routes.ts)
  await imports.publicRoutes(app);

  // ---------- QR-Hinweisseite ----------

  // `?handy=1`: Rücksprung von „In der {Org-App} öffnen“, wenn die App den Link nicht übernommen hat
  app.get<{ Querystring: { handy?: string } }>(`${QR_PATH_PREFIX}:code`, async (req, reply) => {
    return reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(qrHintPage(req.query.handy === '1', appHome, cfg.instance.orgAppName));
  });

  registerWellKnown(app, cfg);

  app.get<{ Params: { file: string } }>('/qr-fonts/:file', async (req, reply) => {
    const spec = QR_FONTS[req.params.file];
    if (!spec) return reply.code(404).type('text/plain; charset=utf-8').send('Nicht gefunden.');
    return reply
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .type('font/woff2')
      .send(fs.createReadStream(require.resolve(spec)));
  });

  // ---------- Web-App (SPA), Kurzlinks, Produktseite (site.ts) ----------

  const { hasWeb } = await registerSite(app, cfg, { notFoundPage: notFound });

  app.setNotFoundHandler(async (req, reply) => {
    const p = pathOf(req);
    if (p === '/api' || p.startsWith('/api/') || p === '/sync') {
      return sendError(reply, 404, 'not_found', MESSAGES.not_found);
    }
    const lastSeg = p.split('/').pop() ?? '';
    if ((req.method === 'GET' || req.method === 'HEAD') && !lastSeg.includes('.')) {
      // Die Web-App läuft nur unter `/` bzw. STACHEL_BASE_PATH (Boards über `?b=<id>`); fastifyStatic liefert sie selbst
      // aus. Alles andere ist eine 404-Seite statt stillschweigend der Übersicht.
      if (!hasWeb && p === appHome) {
        return reply
          .code(503)
          .type('text/plain; charset=utf-8')
          .send('Die Web-App ist noch nicht gebaut (web/dist fehlt).');
      }
      return reply.code(404).header('Cache-Control', 'no-cache').type('text/html; charset=utf-8').send(notFound());
    }
    return reply.code(404).type('text/plain; charset=utf-8').send('Nicht gefunden.');
  });

  sync.attach(app.server, { [NATIVE_PATH]: native.handleUpgrade });

  // Org-Tokens von früher verschlüsseln (alle Tabellen sind jetzt angelegt)
  const sealed = crypt.migrate(db);
  if (sealed) app.log.info(`${sealed} gespeicherte Org-Tokens verschlüsselt`);
  if (!crypt.enabled && cfg.instance.auth === 'org') app.log.warn('STACHEL_TOKEN_KEY fehlt: Org-Tokens liegen im Klartext in SQLite');
  // alte Bild-Originale einmal ohne Metadaten neu schreiben (Hintergrund)
  const imageCleanup = cleanStoredImages(db, cfg.dataDir, imagesDir, (msg, err) => app.log.warn({ err }, msg)).then(
    (n) => {
      if (n) app.log.info(`${n} Bilder ohne Metadaten neu gespeichert`);
      return n;
    },
    (e) => {
      app.log.error({ err: e }, 'Bilder bereinigen fehlgeschlagen');
      return 0;
    },
  );

  // Vorschaubilder nachholen (fehlend, vom Browser hochgeladen oder älterer Renderer) – im Hintergrund, eins nach dem anderen
  const missingThumbs = cfg.thumbnailBackfill === false ? 0 : thumbs.backfill();
  if (missingThumbs) app.log.info(`${missingThumbs} Vorschaubilder werden neu erzeugt`);

  const housekeeping = setInterval(() => {
    try {
      pairings.purgeOld();
      sessions.purgeExpired();
      loginFailLimiter.prune();
      loginFloodLimiter.prune();
      userLoginLimiter.prune();
      approveLimiter.prune();
      qrLimiter.prune();
      infoLimiter.prune();
    } catch (e) {
      app.log.error(e);
    }
  }, 60_000);
  housekeeping.unref();
  // Löschfristen (legal.ts): Personen (Modus org) 2 Jahre nach der letzten Anmeldung, Einladungen 90 Tage, KI-Tokens 12 Monate unbenutzt, erledigte Meldungen 1 Jahr
  for (const w of legalStartupWarnings(cfg.instance)) app.log.warn(w);
  const retention = () => {
    try {
      const r = applyRetention(db, cfg.instance.auth, Date.now(), (id) => apiTokens.disconnect(id));
      if (r.users || r.invites || r.tokens || r.reports) app.log.info(`Löschfristen: ${r.users} Personen, ${r.invites} Einladungen, ${r.tokens} KI-Tokens, ${r.reports} Meldungen entfernt`);
      // Import: Berichte nach 30 Tagen, Miro-Verbindungen nach 60 Tagen ohne Nutzung
      const i = imports.purge();
      if (i.jobs || i.links) app.log.info(`Löschfristen Import: ${i.jobs} Berichte, ${i.links} Verbindungen entfernt`);
    } catch (e) {
      app.log.error(e);
    }
  };
  retention();
  const retentionTimer = setInterval(retention, 3600_000);
  retentionTimer.unref();

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    clearInterval(housekeeping);
    clearInterval(retentionTimer);
    thumbs.stop();
    await trash.stop();
    await imports.close();
    events.closeAll();
    await native.close();
    await sync.close();
    await app.close();
    await imageCleanup;
    db.close();
  };

  return { app, db, sessions, pairings, hocuspocus: sync.hocuspocus, trash, apiTokens, access, native, imageCleanup, thumbs, imports, close };
}
