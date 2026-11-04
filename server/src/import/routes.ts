// Import-Endpunkte (docs/features/import.md §2, Typen shared/import.ts) und Zusammenbau des Moduls für app.ts.
// Mit Sitzung (Web-Cookie, App `sts_…`, API-Token `stk_…`): Quellen, Token-Verbindung, OAuth-Start/-Trennen,
// Board-Liste, Aufträge. Ohne Sitzungspflicht: Rückruf von Miro (GET) und die Bestätigung (POST, Formular, ohne
// X-Stachel – abgesichert über state + nonce, CSRF-Ausnahme in app.ts nur für genau diese Route).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { IMPORT_MAX_BOARDS_PER_REQUEST, type ImportOptions, type ImportRemoteBoard, type ImportSources } from '../../../shared/import.js';
import { BRAND, SESSION_COOKIE } from '../../../shared/protocol.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { MESSAGES, sendError } from '../http-util.js';
import { maskEmail } from '../mailer.js';
import { ipKey, RateLimiter } from '../rate-limit.js';
import type { SessionStore } from '../sessions.js';
import type { UploadLimits } from '../upload-limits.js';
import type { BoardEvents } from '../board-events.js';
import { MIRO_FILE_HOSTS, type DownloadOptions } from './assets.js';
import { MiroAccess } from './connections.js';
import { ImportJobs } from './jobs.js';
import { importKey, ImportLinks } from './links.js';
import { MiroApiError, MiroAuthError, MiroClient } from './miro/client.js';
import { authorizeUrl, exchangeCode, OauthError, OauthStates, sha256, type OauthSettings } from './miro/oauth.js';
import type { MapOptions, MappedBoard, MiroBoardData } from './miro/types.js';

export const CALLBACK_PATH = '/api/import/miro/callback';
const BOARD_ID_RE = /^[A-Za-z0-9_=.~%-]{1,100}$/;
const TOKEN_RE = /^[\x21-\x7e]{10,4096}$/;

export interface ImportDeps {
  cfg: Pick<Config, 'import' | 'publicUrl' | 'basePath' | 'tokenKey' | 'dataDir' | 'limits'>;
  db: Db;
  imagesDir: string;
  sessions: SessionStore;
  uploads: UploadLimits;
  events?: BoardEvents;
  saveVersion?: (boardId: string, name: string, by: { key: string; name: string }) => Promise<unknown>;
  /** E-Mail eines Kontos (Modus local) für die Bestätigungsseite, nur maskiert gezeigt */
  emailOf?: (userKey: string) => string | null;
  mapBoard: (data: MiroBoardData, opts?: MapOptions) => MappedBoard;
  log?: (msg: string) => void;
  /** Tests: fetch für Token/OAuth, DNS für Dateien, Uhr/Warten des Clients */
  fetch?: typeof fetch;
  resolve?: DownloadOptions['resolve'];
  client?: { sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; now?: () => number };
}

export interface ImportModule {
  links: ImportLinks;
  access: MiroAccess;
  jobs: ImportJobs;
  states: OauthStates;
  /** im Sitzungs-Bereich registrieren */
  routes(scope: FastifyInstance): void;
  /** an der Wurzel registrieren (Rückruf ohne Sitzungspflicht) */
  publicRoutes(app: FastifyInstance): Promise<void>;
  /** Konto löschen: Widerruf versuchen, Aufträge und Verbindungen der Person löschen */
  forgetUser(userKey: string): Promise<void>;
  /** Löschfristen: Aufträge > 30 Tage, Verbindungen > 60 Tage ungenutzt */
  purge(now?: number): { jobs: number; links: number };
  close(): Promise<void>;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** schlichte Seite im Stachel-Look, ohne JS (CSP-tauglich) */
function page(title: string, main: string): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<style>
@font-face { font-family: 'Barlow'; font-weight: 400; font-display: swap; src: url(/qr-fonts/barlow-400.woff2) format('woff2'); }
@font-face { font-family: 'Barlow'; font-weight: 600; font-display: swap; src: url(/qr-fonts/barlow-600.woff2) format('woff2'); }
@font-face { font-family: 'Barlow Condensed'; font-weight: 700; font-display: swap; src: url(/qr-fonts/barlow-condensed-700.woff2) format('woff2'); }
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; }
body { min-height: 100vh; background: ${BRAND.black}; color: ${BRAND.white}; font-family: 'Barlow', system-ui, sans-serif; font-size: 18px;
  line-height: 1.5; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
main { width: 100%; max-width: 460px; }
h1 { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 40px; line-height: 1.05; text-transform: uppercase; margin: 0 0 16px; }
h1 em { font-style: normal; color: ${BRAND.green}; }
p { margin: 0 0 20px; color: #e6e6e6; }
strong { color: ${BRAND.white}; }
.hint { font-size: 15px; color: #a6a6a6; }
.row { display: flex; flex-wrap: wrap; gap: 12px; margin: 0 0 20px; }
.btn { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 10px 24px; border-radius: 999px; border: 0;
  font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; background: ${BRAND.green}; color: ${BRAND.black}; }
.btn.secondary { background: transparent; color: ${BRAND.white}; border: 2px solid #555; }
.btn:focus-visible { outline: 3px solid ${BRAND.white}; outline-offset: 3px; }
</style>
</head>
<body>
<main>
${main}
</main>
</body>
</html>`;
}

/** Zusammenbau: Tabellen, Speicher, Warteschlange; die Routen hängt app.ts ein. */
export function setupImport(d: ImportDeps): ImportModule {
  const ic = d.cfg.import;
  const links = new ImportLinks(d.db, importKey(d.cfg.tokenKey, d.cfg.dataDir));
  const oauth: OauthSettings | null = ic.oauth ? { ...ic.oauth, apiBase: ic.apiBase, authBase: ic.authBase } : null;
  const access = new MiroAccess(links, oauth, { ...(d.fetch ? { fetch: d.fetch } : {}) });
  const states = new OauthStates();
  const download: Omit<DownloadOptions, 'signal'> = {
    hosts: [...MIRO_FILE_HOSTS, ...ic.extraHosts],
    devHosts: ic.devHosts,
    maxBytes: d.cfg.limits.uploadMaxBytes,
    ...(d.resolve ? { resolve: d.resolve } : {}),
  };
  const jobs = new ImportJobs({
    db: d.db,
    imagesDir: d.imagesDir,
    cfg: ic,
    uploads: d.uploads,
    ...(d.events ? { events: d.events } : {}),
    ...(d.saveVersion ? { saveVersion: d.saveVersion } : {}),
    mapBoard: d.mapBoard,
    download,
    ...(d.client ? { client: d.client } : {}),
    ...(d.log ? { log: d.log } : {}),
  });
  const tokenLimiter = new RateLimiter(20, 10 * 60_000);
  const callbackLimiter = new RateLimiter(60, 5 * 60_000);
  const timer = setInterval(() => {
    tokenLimiter.prune();
    callbackLimiter.prune();
    states.purge();
    access.purge();
  }, 5 * 60_000);
  timer.unref();

  const webBack = (error?: string) => `${d.cfg.publicUrl}${d.cfg.basePath}/?import=miro${error ? `&error=${encodeURIComponent(error)}` : ''}`;
  const disabled = (reply: FastifyReply) =>
    sendError(reply, 403, 'import_disabled', 'Der Import ist auf dieser Instanz ausgeschaltet. Frag den Betrieb dieser Instanz, ob er ihn einschalten kann.');
  const connExpired = (reply: FastifyReply) =>
    sendError(reply, 401, 'miro_conn_expired', 'Die Verbindung zu Miro ist abgelaufen. Bitte verbinde Stachel noch einmal mit Miro.');
  const unavailable = (reply: FastifyReply) =>
    sendError(reply, 502, 'miro_unavailable', 'Miro ist gerade nicht erreichbar. Bitte versuche es in ein paar Minuten noch einmal.');
  const clientFor = (auth: ReturnType<MiroAccess['auth']> & object, maxAttempts = 3) =>
    new MiroClient({ base: ic.apiBase, auth, maxAttempts, ...(d.fetch ? { fetch: d.fetch } : {}), ...(d.client ?? {}) });

  const routes = (scope: FastifyInstance) => {
    scope.get('/api/import/sources', async (req): Promise<ImportSources> => {
      const key = req.session!.userKey;
      return { ok: true, miro: { enabled: ic.enabled, token: ic.enabled && ic.tokenEnabled, oauth: ic.enabled && !!oauth, connected: ic.enabled && access.connected(key) } };
    });

    scope.post('/api/import/miro/token', async (req, reply) => {
      if (!ic.enabled || !ic.tokenEnabled) return disabled(reply);
      const key = req.session!.userKey;
      if (!tokenLimiter.allow(key)) return sendError(reply, 429, 'rate_limited', MESSAGES.rate_limited);
      const raw = (req.body as { token?: unknown } | null)?.token;
      const token = typeof raw === 'string' ? raw.trim().replace(/^Bearer\s+/i, '') : '';
      if (!TOKEN_RE.test(token)) {
        return sendError(reply, 400, 'miro_token_invalid', 'Das sieht nicht wie ein Miro-Token aus. Kopiere es in Miro unter „Your apps“ vollständig und füge es hier ein.');
      }
      try {
        await clientFor({ token: async () => token }, 2).get('/v2/boards', { limit: 1 });
      } catch (e) {
        if (e instanceof MiroAuthError || (e instanceof MiroApiError && (e.status === 401 || e.status === 403))) {
          return sendError(
            reply,
            400,
            'miro_token_invalid',
            'Miro hat das Token abgelehnt. Prüfe, ob du es vollständig kopiert hast und ob die App das Recht boards:read hat, oder erzeuge in Miro unter „Your apps“ ein neues.',
          );
        }
        return unavailable(reply);
      }
      const { conn, expiresAt } = access.addToken(key, token);
      return { ok: true, conn, expiresAt: new Date(expiresAt).toISOString() };
    });

    scope.post('/api/import/miro/oauth/start', async (req, reply) => {
      if (!ic.enabled) return disabled(reply);
      if (!oauth) return sendError(reply, 404, 'oauth_disabled', '„Mit Miro verbinden“ ist auf dieser Instanz nicht eingerichtet. Nutze ein persönliches Token.');
      const c = (req.body as { client?: unknown } | null)?.client;
      if (c !== undefined && c !== 'web' && c !== 'app') return sendError(reply, 400, 'invalid_input', MESSAGES.invalid_input);
      const s = req.session!;
      const raw = req.cookies[SESSION_COOKIE] ?? req.headers.authorization ?? s.id;
      const { state, challenge } = states.create({ userKey: s.userKey, userName: s.name, client: c === 'app' ? 'app' : 'web', sessionHash: sha256(String(raw)) });
      return { ok: true, url: authorizeUrl(oauth, state, challenge) };
    });

    scope.delete('/api/import/miro/oauth', async (req) => {
      await access.disconnect(req.session!.userKey);
      return { ok: true };
    });

    /** Namen der zuletzt gelisteten Boards je Person (nur im Speicher): Aufträge zeigen den Namen schon vor dem Lesen */
    const listedNames = new Map<string, Map<string, string>>();
    const rememberNames = (key: string, boards: ImportRemoteBoard[]) => {
      let m = listedNames.get(key);
      if (!m) {
        if (listedNames.size >= 1000) listedNames.delete(listedNames.keys().next().value!);
        listedNames.set(key, (m = new Map()));
      }
      for (const b of boards) {
        if (!b.name) continue;
        m.delete(b.id);
        m.set(b.id, b.name);
        if (m.size > 500) m.delete(m.keys().next().value!);
      }
    };

    scope.get<{ Querystring: { conn?: string; query?: string; offset?: string } }>('/api/import/miro/boards', async (req, reply) => {
      if (!ic.enabled) return disabled(reply);
      const key = req.session!.userKey;
      const auth = access.auth(key, req.query.conn);
      if (!auth) return connExpired(reply);
      const offset = Math.max(0, Math.min(100_000, Math.floor(Number(req.query.offset ?? 0)) || 0));
      const query = typeof req.query.query === 'string' ? req.query.query.trim().slice(0, 200) : '';
      try {
        const res = (await clientFor(auth).get('/v2/boards', { limit: 50, offset, sort: 'last_modified', ...(query ? { query } : {}) })) as {
          data?: Record<string, unknown>[];
          total?: number;
        };
        const data = Array.isArray(res?.data) ? res.data : [];
        const boards: ImportRemoteBoard[] = data
          .filter((b) => typeof b?.id === 'string')
          .map((b) => ({
            id: b.id as string,
            name: typeof b.name === 'string' ? b.name : '',
            ...(typeof b.description === 'string' && b.description ? { description: b.description } : {}),
            ...(typeof b.modifiedAt === 'string' ? { modifiedAt: b.modifiedAt } : {}),
          }));
        rememberNames(key, boards);
        const next = offset + data.length;
        const more = typeof res?.total === 'number' ? next < res.total : data.length === 50;
        return { ok: true, boards, ...(more && data.length ? { next } : {}) };
      } catch (e) {
        if (e instanceof MiroAuthError) {
          if (typeof req.query.conn === 'string' && req.query.conn !== 'oauth') access.dropConn(key, req.query.conn);
          return connExpired(reply);
        }
        return unavailable(reply);
      }
    });

    scope.post('/api/import/miro/jobs', async (req, reply) => {
      if (!ic.enabled) return disabled(reply);
      const s = req.session!;
      const body = (req.body ?? {}) as { conn?: unknown; boards?: unknown; options?: unknown };
      const auth = access.auth(s.userKey, body.conn);
      if (!auth) return connExpired(reply);
      const boards = Array.isArray(body.boards) ? [...new Set(body.boards)] : [];
      if (!boards.length || boards.length > IMPORT_MAX_BOARDS_PER_REQUEST || !boards.every((b) => typeof b === 'string' && BOARD_ID_RE.test(b))) {
        return sendError(reply, 400, 'invalid_input', `Bitte wähle 1 bis ${IMPORT_MAX_BOARDS_PER_REQUEST} Boards aus.`);
      }
      const o = (body.options ?? {}) as Record<string, unknown>;
      if (typeof o !== 'object' || Array.isArray(o) || (o.keepColors !== undefined && typeof o.keepColors !== 'boolean') || (o.description !== undefined && typeof o.description !== 'boolean')) {
        return sendError(reply, 400, 'invalid_input', MESSAGES.invalid_input);
      }
      const options: ImportOptions = {
        ...(o.keepColors !== undefined ? { keepColors: o.keepColors as boolean } : {}),
        ...(o.description !== undefined ? { description: o.description as boolean } : {}),
      };
      const names = listedNames.get(s.userKey);
      const res = jobs.create({ key: s.userKey, name: s.name }, auth, boards as string[], options, (id) => names?.get(id) ?? '');
      if (!res.ok) return sendError(reply, res.status, res.error, res.message);
      return reply.code(202).send({ ok: true, jobs: res.jobs });
    });

    scope.get('/api/import/jobs', async (req) => ({ ok: true, jobs: jobs.list(req.session!.userKey) }));

    scope.get<{ Params: { id: string } }>('/api/import/jobs/:id', async (req, reply) => {
      const job = jobs.get(req.session!.userKey, req.params.id);
      if (!job) return sendError(reply, 404, 'not_found', 'Diesen Import gibt es nicht (mehr).');
      return { ok: true, job };
    });

    scope.delete<{ Params: { id: string } }>('/api/import/jobs/:id', async (req, reply) => {
      const job = jobs.cancel(req.session!.userKey, req.params.id);
      if (!job) return sendError(reply, 404, 'not_found', 'Diesen Import gibt es nicht (mehr).');
      return { ok: true, job };
    });
  };

  // ---- Rückruf von Miro ----

  const accountLabel = (userKey: string, name: string) => {
    const email = d.emailOf?.(userKey);
    return email ? maskEmail(email) : name;
  };

  const htmlReply = (reply: FastifyReply, status: number, html: string) =>
    reply.code(status).header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').type('text/html; charset=utf-8').send(html);

  const errorPage = (reply: FastifyReply, status: number, title: string, text: string) =>
    htmlReply(
      reply,
      status,
      page('Stachel – Import aus Miro', `<h1>${title}</h1>\n<p>${text}</p>\n<div class="row"><a class="btn" href="${esc(webBack())}">Zu Stachel</a></div>`),
    );

  const donePage = (reply: FastifyReply, client: 'web' | 'app') =>
    htmlReply(
      reply,
      200,
      page(
        'Stachel – Import aus Miro',
        `<h1>Fertig – <em>verbunden</em></h1>
<p>Stachel kann jetzt deine Miro-Boards lesen. ${client === 'app' ? 'Du kannst zur App zurückkehren.' : 'Du kannst zu Stachel zurückkehren und Boards auswählen.'}</p>
${client === 'web' ? `<div class="row"><a class="btn" href="${esc(webBack())}">Zu Stachel</a></div>` : ''}
<p class="hint">Die Verbindung trennst du jederzeit im Import-Dialog („Verbindung trennen“).</p>`,
      ),
    );

  /** Code tauschen und speichern; liefert einen Fehlercode oder null */
  const complete = async (st: { userKey: string; verifier: string }, code: string): Promise<string | null> => {
    if (!oauth) return 'oauth_disabled';
    try {
      const t = await exchangeCode(oauth, code, st.verifier, d.fetch ?? fetch);
      access.connect(st.userKey, t);
      return null;
    } catch (e) {
      return e instanceof OauthError && e.kind === 'unavailable' ? 'miro_unavailable' : 'oauth_failed';
    }
  };

  const errorText: Record<string, string> = {
    access_denied: 'Du hast den Zugriff in Miro nicht erlaubt. Es wurde nichts verbunden.',
    state_expired: 'Der Freigabe-Link ist abgelaufen oder wurde schon benutzt. Starte „Mit Miro verbinden“ in Stachel noch einmal.',
    miro_unavailable: 'Miro ist gerade nicht erreichbar. Bitte versuche es in ein paar Minuten noch einmal.',
    oauth_failed: 'Miro hat die Freigabe nicht bestätigt. Starte „Mit Miro verbinden“ in Stachel noch einmal.',
  };

  const publicRoutes = async (app: FastifyInstance) => {
    await app.register(async (s) => {
      // nur hier: Formular-Body der Bestätigungsseite
      s.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 4096 }, (_req, body, done) => {
        done(null, Object.fromEntries(new URLSearchParams(String(body))));
      });

      s.get<{ Querystring: { code?: string; state?: string; error?: string } }>(CALLBACK_PATH, async (req, reply) => {
        if (!callbackLimiter.allow(ipKey(req.ip))) return errorPage(reply, 429, 'Zu viele <em>Versuche</em>', MESSAGES.rate_limited);
        const session = d.sessions.get(req.cookies[SESSION_COOKIE]);
        const st = states.peek(req.query.state);
        const fail = (code: string, clientIsWeb: boolean) => {
          if (clientIsWeb && session) return reply.redirect(webBack(code), 302);
          return errorPage(reply, 400, 'Nicht <em>verbunden</em>', esc(errorText[code] ?? errorText.oauth_failed!));
        };
        if (!ic.enabled || !oauth) return fail('oauth_failed', true);
        if (!st) return fail('state_expired', true);
        const mine = !!session && session.userKey === st.userKey;
        if (typeof req.query.error === 'string' || typeof req.query.code !== 'string' || !req.query.code || req.query.code.length > 2048) {
          states.consume(req.query.state);
          const e = typeof req.query.error === 'string' && /^[a-z_]{1,40}$/.test(req.query.error) ? req.query.error : 'oauth_failed';
          return fail(e, st.client === 'web' && mine);
        }
        if (mine) {
          states.consume(req.query.state);
          const err = await complete(st, req.query.code);
          if (err) return fail(err, st.client === 'web');
          if (st.client === 'web') return reply.redirect(webBack(), 302);
          return donePage(reply, st.client);
        }
        // anderer Browser (z. B. System-Browser der App) bzw. fremde Sitzung: erst bestätigen lassen
        const nonce = states.attachCode(req.query.state as string, req.query.code);
        if (!nonce) return fail('state_expired', false);
        return htmlReply(
          reply,
          200,
          page(
            'Stachel – Import aus Miro',
            `<h1>Miro <em>verbinden?</em></h1>
<p>Miro-Zugang mit dem Stachel-Konto <strong>${esc(accountLabel(st.userKey, st.userName))}</strong> verbinden? Stachel darf dann deine Miro-Boards lesen (nur lesen).</p>
<p class="hint">Hast du „Mit Miro verbinden“ nicht selbst in Stachel gestartet oder kennst du das Konto nicht, dann brich hier ab.</p>
<form method="post" action="${CALLBACK_PATH}">
<input type="hidden" name="state" value="${esc(req.query.state as string)}">
<input type="hidden" name="nonce" value="${esc(nonce)}">
<div class="row"><button class="btn" type="submit" name="confirm" value="1">Verbinden</button><button class="btn secondary" type="submit" name="confirm" value="0">Abbrechen</button></div>
</form>`,
          ),
        );
      });

      s.post(CALLBACK_PATH, async (req: FastifyRequest, reply: FastifyReply) => {
        if (!callbackLimiter.allow(ipKey(req.ip))) return errorPage(reply, 429, 'Zu viele <em>Versuche</em>', MESSAGES.rate_limited);
        const body = (req.body ?? {}) as { state?: unknown; nonce?: unknown; confirm?: unknown };
        const st = states.confirm(body.state, body.nonce);
        if (!st || !st.code) return errorPage(reply, 400, 'Nicht <em>verbunden</em>', esc(errorText.state_expired!));
        if (body.confirm === '0') return errorPage(reply, 200, 'Nicht <em>verbunden</em>', 'Abgebrochen. Es wurde nichts verbunden.');
        const err = await complete(st, st.code);
        if (err) return errorPage(reply, 400, 'Nicht <em>verbunden</em>', esc(errorText[err] ?? errorText.oauth_failed!));
        return donePage(reply, st.client);
      });
    });
  };

  return {
    links,
    access,
    jobs,
    states,
    routes,
    publicRoutes,
    async forgetUser(userKey) {
      states.forgetUser(userKey);
      await jobs.forgetUser(userKey);
      await access.forgetUser(userKey);
    },
    purge(now = Date.now()) {
      return { jobs: jobs.purge(now), links: links.purgeUnused(now) };
    },
    async close() {
      clearInterval(timer);
      await jobs.close();
    },
  };
}
