// Fake-Miro (Node http) für Tests, E2E und Sandbox (docs/features/import.md §7 „Testen“): REST-API v2 lesend
// (Boards, Items/Verbinder/Gruppen/Mindmap mit Cursor-Seiten, Tags mit Offset, Tags je Objekt, Formen und Docs),
// Bild-/Dokument-Adressen (`redirect=false` → `{url}` auf sich selbst, Datei unter /files/… ohne Token), OAuth
// (`/oauth/authorize` leitet sofort mit Code zurück, `/v1/oauth/token` mit PKCE-Prüfung, `/v2/oauth/revoke`).
// Boards kommen aus dem Code (`addBoard`) oder aus `server/test/fixtures/miro/<board>/…` (`loadFixtureBoards`, Format
// dort in README.md).
// Adressen `https://api.miro.com` in den Daten werden beim Ausliefern auf die eigene Adresse umgeschrieben.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { loadMiroFixture, MIRO_FIXTURES_DIR } from './fixtures/miro/load.js';

export interface FakeFile {
  data: Buffer;
  type: string;
}

export interface FakeBoard {
  board: { id: string; name: string; description?: string; modifiedAt?: string };
  items: Record<string, any>[];
  connectors?: Record<string, any>[];
  tags?: Record<string, any>[];
  /** Tag-IDs je Objekt (`…/items/{id}/tags`) */
  itemTags?: Record<string, string[]>;
  /** Rohantwort-Einträge von `/groups` */
  groups?: Record<string, any>[];
  mindNodes?: Record<string, any>[];
  /** `/v2-experimental/…/shapes/{id}` */
  shapes?: Record<string, Record<string, any>>;
  /** HTML je doc_format-Objekt */
  docs?: Record<string, string>;
  /** Dateien `name` → Inhalt; Objekte verweisen mit `https://api.miro.com/v2/boards/<b>/resources/images/<name>` */
  files?: Record<string, FakeFile>;
}

export interface FakeRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  auth: string | null;
}

interface Failure {
  re: RegExp;
  status: number;
  times: number;
  headers?: Record<string, string>;
}

const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const b64url = (b: Buffer) => b.toString('base64url');

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf' };

/**
 * Boards aus `server/test/fixtures/miro/<board>/` im Format von server/test/fixtures/miro/README.md (gelesen mit dessen load.ts), dazu
 * optional `files/<name>` für Bild-/Dokument-Adressen `…/resources/images|documents/<name>`.
 */
export function loadFixtureBoards(): FakeBoard[] {
  const dir = MIRO_FIXTURES_DIR;
  const out: FakeBoard[] = [];
  for (const name of fs.readdirSync(dir)) {
    const d = path.join(dir, name);
    if (!fs.statSync(d).isDirectory() || !fs.existsSync(path.join(d, 'board.json'))) continue;
    const data = loadMiroFixture(name);
    const files: Record<string, FakeFile> = {};
    if (fs.existsSync(path.join(d, 'files'))) {
      for (const f of fs.readdirSync(path.join(d, 'files'))) files[f] = { data: fs.readFileSync(path.join(d, 'files', f)), type: MIME[f.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream' };
    }
    const raw = JSON.parse(fs.readFileSync(path.join(d, 'board.json'), 'utf8')) as Record<string, unknown>;
    out.push({
      board: { ...data.board, ...(typeof raw.modifiedAt === 'string' ? { modifiedAt: raw.modifiedAt } : {}) },
      items: data.items as Record<string, any>[],
      connectors: data.connectors as Record<string, any>[],
      tags: data.tags as Record<string, any>[],
      itemTags: data.itemTags,
      groups: data.groups.map((g) => ({ id: g.id, type: 'group', data: { items: g.items } })),
      mindNodes: data.mindNodes as Record<string, any>[],
      shapes: data.experimentalShapes as Record<string, Record<string, any>>,
      docs: data.docs,
      files,
    });
  }
  return out;
}

export class FakeMiro {
  private server: http.Server | null = null;
  base = '';
  readonly boards = new Map<string, FakeBoard>();
  /** gültige Access-Tokens (persönliche Tokens und per OAuth ausgegebene) */
  readonly tokens = new Set<string>();
  readonly requests: FakeRequest[] = [];
  readonly revoked: string[] = [];
  private readonly failures: Failure[] = [];
  private readonly codes = new Map<string, { challenge?: string; method?: string; redirectUri: string }>();
  private readonly refreshTokens = new Map<string, string>(); // refresh → access
  /** Seitengröße höchstens (Miro: 50) */
  pageLimit = 50;
  /** Header X-RateLimit-Remaining je Antwort (null = keiner) */
  rateRemaining: number | null = 99_000;
  /** /oauth/authorize lehnt ab (error=access_denied) */
  deny = false;
  /** Dateien zusätzlich unter dieser Adresse anbieten (z. B. anderer Host) */
  fileBase: string | null = null;
  /** Verzögerung je API-Antwort in ms (Abbruch-Tests) */
  delayMs = 0;

  constructor(readonly oauth: { clientId: string; clientSecret: string } = { clientId: 'fake-client', clientSecret: 'fake-secret' }) {}

  addBoard(b: FakeBoard): this {
    this.boards.set(b.board.id, b);
    return this;
  }

  /** nächste `times` Anfragen auf Pfade, die `re` treffen, mit `status` beantworten */
  fail(re: RegExp, status: number, times = 1, headers?: Record<string, string>) {
    this.failures.push({ re, status, times, ...(headers ? { headers } : {}) });
  }

  async start(port = 0, host = '127.0.0.1'): Promise<this> {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch(() => {
        if (!res.headersSent) json(res, 500, { status: 500, message: 'fake error' });
        else res.end();
      });
    });
    await new Promise<void>((r) => this.server!.listen(port, host, r));
    const a = this.server.address() as AddressInfo;
    this.base = `http://${host}:${a.port}`;
    return this;
  }

  async stop() {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server!.close(() => r()));
    this.server = null;
  }

  private rewrite(v: unknown): string {
    return JSON.stringify(v).replaceAll('https://api.miro.com', this.base);
  }

  private async body(req: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const u = new URL(req.url ?? '/', this.base);
    const query = Object.fromEntries(u.searchParams);
    const auth = req.headers.authorization ?? null;
    this.requests.push({ method: req.method ?? 'GET', path: u.pathname, query, auth });
    const p = u.pathname;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const f = this.failures.find((x) => x.times > 0 && x.re.test(p));
    if (f) {
      f.times--;
      return json(res, f.status, { status: f.status, message: 'fake failure' }, f.headers ?? {});
    }
    const rl: Record<string, string> = this.rateRemaining === null ? {} : { 'X-RateLimit-Limit': '100000', 'X-RateLimit-Remaining': String(this.rateRemaining), 'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60) };

    // ---- OAuth ----
    if (p === '/oauth/authorize') {
      const redirect = query.redirect_uri ?? '';
      if (query.client_id !== this.oauth.clientId || !redirect) return json(res, 400, { message: 'bad client' });
      const back = new URL(redirect);
      if (query.state) back.searchParams.set('state', query.state);
      if (this.deny) back.searchParams.set('error', 'access_denied');
      else {
        const code = b64url(crypto.randomBytes(16));
        this.codes.set(code, { ...(query.code_challenge ? { challenge: query.code_challenge, method: query.code_challenge_method } : {}), redirectUri: redirect });
        back.searchParams.set('code', code);
      }
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    if (p === '/v1/oauth/token' && req.method === 'POST') {
      const form = Object.fromEntries(new URLSearchParams(await this.body(req)));
      const q = { ...form, ...query };
      if (q.client_id !== this.oauth.clientId || q.client_secret !== this.oauth.clientSecret) return json(res, 401, { message: 'bad client' });
      if (q.grant_type === 'authorization_code') {
        const c = this.codes.get(q.code ?? '');
        this.codes.delete(q.code ?? '');
        if (!c || c.redirectUri !== q.redirect_uri) return json(res, 400, { error: 'invalid_grant' });
        if (c.challenge) {
          const ok = c.method === 'S256' && b64url(crypto.createHash('sha256').update(q.code_verifier ?? '').digest()) === c.challenge;
          if (!ok) return json(res, 400, { error: 'invalid_grant', message: 'pkce' });
        }
        return json(res, 200, this.issue());
      }
      if (q.grant_type === 'refresh_token') {
        const old = q.refresh_token ?? '';
        if (!this.refreshTokens.has(old)) return json(res, 400, { error: 'invalid_grant' });
        this.refreshTokens.delete(old);
        return json(res, 200, this.issue());
      }
      return json(res, 400, { error: 'unsupported_grant_type' });
    }
    if (p === '/v2/oauth/revoke' && req.method === 'POST') {
      let token = '';
      try {
        token = String((JSON.parse(await this.body(req)) as { accessToken?: unknown }).accessToken ?? '');
      } catch {
        /* leer */
      }
      if (!this.tokens.has(token)) return json(res, 404, { message: 'unknown token' });
      this.tokens.delete(token);
      this.revoked.push(token);
      res.writeHead(204);
      return res.end();
    }

    // ---- Dateien (ohne Token) ----
    const file = /^\/files\/([^/]+)\/([^/]+)$/.exec(p);
    if (file) {
      const b = this.boards.get(decodeURIComponent(file[1]!));
      const fdata = b?.files?.[decodeURIComponent(file[2]!)];
      if (!fdata || query.sig !== 'ok') return json(res, 403, { message: 'signature' });
      res.writeHead(200, { 'Content-Type': fdata.type, 'Content-Length': String(fdata.data.length) });
      return res.end(fdata.data);
    }

    // ---- REST-API (mit Token) ----
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!this.tokens.has(token)) return json(res, 401, { status: 401, code: 'tokenNotProvided', message: 'Unauthorized' }, rl);

    const page = <T>(list: T[]) => {
      const limit = Math.min(this.pageLimit, Math.max(1, Number(query.limit ?? 10) || 10));
      const start = Number(query.cursor ?? 0) || 0;
      const data = list.slice(start, start + limit);
      const next = start + limit < list.length ? String(start + limit) : undefined;
      return { data, total: list.length, size: data.length, limit, ...(next ? { cursor: next } : {}), type: 'cursor-list' };
    };
    const offsetPage = <T>(list: T[]) => {
      const limit = Math.min(this.pageLimit, Math.max(1, Number(query.limit ?? 20) || 20));
      const offset = Number(query.offset ?? 0) || 0;
      const data = list.slice(offset, offset + limit);
      return { data, total: list.length, size: data.length, offset, limit, type: 'list' };
    };
    const send = (v: unknown) => {
      res.writeHead(200, { 'Content-Type': 'application/json', ...rl });
      res.end(this.rewrite(v));
    };

    if (p === '/v2/boards') {
      const qq = (query.query ?? '').toLowerCase();
      const list = [...this.boards.values()].map((b) => b.board).filter((b) => !qq || b.name.toLowerCase().includes(qq));
      return send(offsetPage(list));
    }
    let m = /^\/v2(-experimental)?\/boards\/([^/]+)(?:\/(.*))?$/.exec(p);
    if (!m) return json(res, 404, { status: 404, message: 'not found' }, rl);
    const exp = !!m[1];
    const b = this.boards.get(decodeURIComponent(m[2]!));
    if (!b) return json(res, 404, { status: 404, message: 'board not found' }, rl);
    const rest = m[3] ?? '';
    if (!rest && !exp) return send({ ...b.board, type: 'board' });
    if (exp && rest === 'mindmap_nodes') return send(page(b.mindNodes ?? []));
    if ((m = /^shapes\/([^/]+)$/.exec(rest)) && exp) {
      const s = b.shapes?.[decodeURIComponent(m[1]!)];
      return s ? send(s) : json(res, 404, { status: 404, message: 'not found' }, rl);
    }
    if (exp) return json(res, 404, { status: 404, message: 'not found' }, rl);
    if (rest === 'items') return send(page(query.type ? b.items.filter((i) => i.type === query.type) : b.items));
    if (rest === 'connectors') return send(page(b.connectors ?? []));
    if (rest === 'tags') return send(offsetPage(b.tags ?? []));
    if (rest === 'groups') return send(page(b.groups ?? []));
    if ((m = /^items\/([^/]+)\/tags$/.exec(rest))) {
      const ids = b.itemTags?.[decodeURIComponent(m[1]!)] ?? [];
      return send({ tags: (b.tags ?? []).filter((t) => ids.includes(t.id)) });
    }
    if ((m = /^docs\/([^/]+)$/.exec(rest))) {
      const html = b.docs?.[decodeURIComponent(m[1]!)];
      return html === undefined ? json(res, 404, { status: 404, message: 'not found' }, rl) : send({ id: m[1], type: 'doc_format', content: html, contentType: query.textContentType ?? 'html' });
    }
    if ((m = /^resources\/(images|documents)\/([^/]+)$/.exec(rest))) {
      const name = decodeURIComponent(m[2]!);
      if (!b.files?.[name]) return json(res, 404, { status: 404, message: 'not found' }, rl);
      const at = `${this.fileBase ?? this.base}/files/${encodeURIComponent(b.board.id)}/${encodeURIComponent(name)}?sig=ok`;
      if (query.redirect === 'false') {
        res.writeHead(200, { 'Content-Type': 'application/json', ...rl });
        return res.end(JSON.stringify({ type: 'url', url: at }));
      }
      res.writeHead(307, { Location: at });
      return res.end();
    }
    return json(res, 404, { status: 404, message: 'not found' }, rl);
  }

  private issue() {
    const access = `fake_at_${b64url(crypto.randomBytes(12))}`;
    const refresh = `fake_rt_${b64url(crypto.randomBytes(12))}`;
    this.tokens.add(access);
    this.refreshTokens.set(refresh, access);
    return { access_token: access, refresh_token: refresh, expires_in: 3599, token_type: 'bearer', scope: 'boards:read', user_id: '1', team_id: '2' };
  }
}

/** kleines PNG für Fixtures */
export function tinyPng(w = 4, h = 3): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: '#e04040' } }).png().toBuffer();
}

/** kleines gültiges PDF für Fixtures */
export function tinyPdf(): Buffer {
  return Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');
}
