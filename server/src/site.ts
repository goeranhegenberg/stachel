// Web-App unter einem Pfad und Produktseite an der Wurzel (docs/features/website.md).
//
// - STACHEL_BASE_PATH (z. B. `/app`, Standard leer = wie bisher alles unter `/`): Nur die Web-App wandert unter den Pfad –
//   index.html und Assets (`/app/`, `/app/assets/…`) und ihre Seitenadressen (`/app/?b=<id>`, Kurzlink `/app/b/<id>`).
//   API (`/api`), Sync (`/sync`), Native-API (`/native/v1`), App-Links (`/.well-known/…`), MCP (`/mcp`), QR-Seite
//   (`/qr/<code>`) und Schriften (`/qr-fonts`) bleiben an der Wurzel: Org-App, Stachel-App und MCP sprechen sie mit
//   der Domain allein an. Das Web-Bündel ist pfadneutral gebaut (Vite `base: './'`), ein Image dient beiden Instanzen.
// - Alte Adressen leiten weiter: `/` mit Query (`/?b=…`, `/?offline=1`, `/?verify=…`) → `/app/?…`, `/b/<id>` →
//   `/app/?b=<id>`, `/app` → `/app/` (Mail-Links `/verify|reset/<token>` siehe accounts.ts).
// - STACHEL_LANDING=1 (nur mit Pfad): Produktseite unter `/` aus `web/dist/landing/index.html` (statisches HTML aus
//   web/public/landing mit Platzhaltern `{{…}}` und Blöcken `<!--#if x-->…<!--#end x-->`), Bilder/CSS unter `/landing/`.
import fs from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Adresse einer Seite der Web-App (ohne Domain): `appPath('/app', '?b=x')` → `/app/?b=x`, ohne Pfad `/?b=x`. */
export const appPath = (basePath: string, rest = '') => `${basePath}/${rest}`;

/** Query-Teil einer Anfrage samt `?` (oder leer). */
const searchOf = (req: FastifyRequest) => {
  const i = req.url.indexOf('?');
  return i < 0 ? '' : req.url.slice(i);
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Füllt die Vorlage der Produktseite: `{{NAME}}` → Wert (HTML-escaped), `<!--#if x-->…<!--#end x-->` bleibt nur mit
 * gesetztem Schalter x, `<!--#if !x-->…<!--#end x-->` nur ohne. Unbekannte Platzhalter bleiben stehen (fällt im Test auf).
 */
export function fillLanding(tpl: string, vars: Record<string, string>, flags: Record<string, boolean>): string {
  return tpl
    .replace(/<!--#if (!?)([a-z]+)-->([\s\S]*?)<!--#end \2-->/g, (_m, not: string, name: string, body: string) =>
      Boolean(flags[name]) !== (not === '!') ? body : '',
    )
    .replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => (k in vars ? esc(vars[k]!) : m));
}

interface Landing {
  html: Buffer;
  br: Buffer;
  gz: Buffer;
}

function loadLanding(cfg: Config): Landing | null {
  const file = path.join(cfg.webDist, 'landing', 'index.html');
  if (!fs.existsSync(file)) return null;
  const origin = cfg.publicUrl;
  const html = fillLanding(
    fs.readFileSync(file, 'utf8'),
    {
      APP: appPath(cfg.basePath),
      ORIGIN: origin,
      HOST: new URL(origin).host,
      BRAND: cfg.instance.brand,
      REPO_URL: cfg.landing.repoUrl,
      PLAY_URL: cfg.landing.playUrl,
      IMPRINT_URL: cfg.instance.imprintUrl,
      PRIVACY_URL: cfg.instance.privacyUrl,
      TERMS_URL: cfg.instance.termsUrl,
    },
    {
      repo: Boolean(cfg.landing.repoUrl),
      play: Boolean(cfg.landing.playUrl),
      imprint: Boolean(cfg.instance.imprintUrl),
      privacy: Boolean(cfg.instance.privacyUrl),
      terms: Boolean(cfg.instance.termsUrl),
      local: cfg.instance.auth === 'local',
      legal: Boolean(cfg.instance.imprintUrl || cfg.instance.privacyUrl),
    },
  );
  const buf = Buffer.from(html, 'utf8');
  return {
    html: buf,
    br: brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
    gz: gzipSync(buf, { level: 9 }),
  };
}

function sendLanding(req: FastifyRequest, reply: FastifyReply, l: Landing) {
  const accept = String(req.headers['accept-encoding'] ?? '');
  reply.header('Cache-Control', 'no-cache').header('Vary', 'Accept-Encoding').type('text/html; charset=utf-8');
  if (/\bbr\b/.test(accept)) return reply.header('Content-Encoding', 'br').send(l.br);
  if (/\bgzip\b/.test(accept)) return reply.header('Content-Encoding', 'gzip').send(l.gz);
  return reply.send(l.html);
}

export interface SiteOptions {
  /** 404-Seite (qr-page.ts) mit Weg zur Board-Übersicht */
  notFoundPage: () => string;
}

/** Registriert Web-App, Kurzlinks, Weiterleitungen und Produktseite. Liefert, ob `web/dist` gebaut ist. */
export async function registerSite(app: FastifyInstance, cfg: Config, opts: SiteOptions): Promise<{ hasWeb: boolean }> {
  const base = cfg.basePath;
  const home = appPath(base);

  // Kurzlink auf ein Board (Teilen, Mails, App-Links): /b/<id> bzw. /app/b/<id> → /app/?b=<id> (die Apps übernehmen
  // /b/* und /app/b/* direkt). Der alte Kurzlink ohne Pfad bleibt gültig.
  const boardLink = async (req: FastifyRequest<{ Params: { id: string }; Querystring: { o?: unknown } }>, reply: FastifyReply) => {
    const id = req.params.id;
    if (!ID_RE.test(id)) return reply.code(404).header('Cache-Control', 'no-cache').type('text/html; charset=utf-8').send(opts.notFoundPage());
    // Objekt-Link der App (`/b/<id>?o=<objekt>`, „Link kopieren“) bleibt im Browser ein Objekt-Link
    const o = req.query.o;
    const obj = typeof o === 'string' && ID_RE.test(o) ? `&o=${encodeURIComponent(o)}` : '';
    return reply.header('Cache-Control', 'no-store').redirect(appPath(base, `?b=${encodeURIComponent(id)}${obj}`), 302);
  };
  app.get('/b/:id', boardLink);
  if (base) app.get(`${base}/b/:id`, boardLink);

  const hasWeb = fs.existsSync(path.join(cfg.webDist, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: cfg.webDist,
      prefix: home,
      index: ['index.html'],
      preCompressed: true, // .br/.gz legt der Vite-Build an (web/vite.config.ts)
      wildcard: true,
      // Vorlage der Produktseite nur über `/` (gefüllt), nicht roh unter /app/landing/
      allowedPath: (p) => !p.startsWith('/landing/'),
      setHeaders: (reply, filePath) => {
        const rel = path.relative(cfg.webDist, filePath).replace(/\\/g, '/');
        reply.header('Cache-Control', rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }
  if (!base) {
    // ohne Pfad braucht die Web-App selbst `/`
    if (cfg.landing.enabled) app.log.warn('STACHEL_LANDING=1 wirkt nur zusammen mit STACHEL_BASE_PATH (z. B. /app) – die Web-App bleibt unter /.');
    return { hasWeb };
  }

  // ---- ab hier nur mit Pfad (z. B. /app) ----

  // /app ohne Schrägstrich: relative Assets brauchen /app/
  app.get(base, async (req, reply) => reply.redirect(`${home}${searchOf(req)}`, 301));

  let landing: Landing | null = null;
  if (cfg.landing.enabled) {
    landing = loadLanding(cfg);
    if (!landing) app.log.warn(`STACHEL_LANDING=1, aber ${path.join(cfg.webDist, 'landing', 'index.html')} fehlt – / leitet zur Web-App.`);
    else {
      await app.register(fastifyStatic, {
        root: path.join(cfg.webDist, 'landing'),
        prefix: '/landing/',
        decorateReply: false,
        index: false,
        preCompressed: true,
        allowedPath: (p) => !/\.html(?:\.br|\.gz)?$/.test(p), // Vorlage nur gefüllt über `/`
        setHeaders: (reply) => reply.header('Cache-Control', 'public, max-age=86400'),
      });
    }
  }

  // `/`: alte App-Adressen (`/?b=…`, `/?offline=1` des MCP-Renderers, `/?verify=…`) gehen zur Web-App, sonst
  // Produktseite bzw. Web-App
  app.get('/', async (req, reply) => {
    const search = searchOf(req);
    if (search.length > 1 || !landing) return reply.header('Cache-Control', 'no-store').redirect(`${home}${search.length > 1 ? search : ''}`, 302);
    return sendLanding(req, reply, landing);
  });
  return { hasWeb };
}
