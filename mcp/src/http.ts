// Streamable HTTP unter /mcp (zustandslos: jeder Aufruf trägt `Authorization: Bearer stk_…`). Je Token ein Agent
// (Board-Verbindungen und Rückgängig-Verlauf bleiben zwischen den Aufrufen erhalten), ein gemeinsamer Renderer.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Agent } from './agent';
import { Renderer } from './render/renderer';
import { StachelApi, StachelError } from './stachel/api';
import { createMcpServer } from './tools';

export interface HttpOptions {
  port: number;
  host: string;
  /** Stachel (API + Sync), z. B. https://stachel.example.org bzw. intern http://stachel:8080 */
  stachelUrl: string;
  /** Web-App für Bildschirmfotos (Standard: stachelUrl) */
  webUrl?: string;
  /** Pfad unter dem MCP läuft (Standard /mcp) */
  path?: string;
  /** gepacktes stdio-Paket zum Herunterladen (GET <path>/stachel-mcp.tgz) */
  tarball?: string;
  renderer?: Renderer;
  log?: (msg: string) => void;
}

const MAX_BODY = 4 * 1024 * 1024;
const AGENT_IDLE_MS = 30 * 60_000;
const TOKEN_RE = /^Bearer\s+(stk_[A-Za-z0-9_-]{20,})\s*$/i;

function jsonError(res: http.ServerResponse, status: number, message: string, extra: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: status === 401 ? -32001 : -32000, message }, id: null }));
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > MAX_BODY) throw new Error('too_large');
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

export function startHttp(opts: HttpOptions): Promise<{ server: http.Server; close: () => Promise<void>; url: string }> {
  const base = (opts.path ?? '/mcp').replace(/\/+$/, '');
  const renderer = opts.renderer ?? new Renderer();
  const log = opts.log ?? ((m: string) => console.error(m));
  const agents = new Map<string, Agent>();

  const agentFor = (token: string): Agent => {
    const key = crypto.createHash('sha256').update(token).digest('base64url');
    let a = agents.get(key);
    if (!a) {
      a = new Agent(new StachelApi(opts.stachelUrl, token), renderer, opts.webUrl ?? opts.stachelUrl);
      agents.set(key, a);
    }
    a.lastUsed = Date.now();
    return a;
  };
  const forget = (token: string) => {
    const key = crypto.createHash('sha256').update(token).digest('base64url');
    void agents.get(key)?.close();
    agents.delete(key);
  };
  const sweep = setInterval(() => {
    for (const [k, a] of agents) if (Date.now() - a.lastUsed > AGENT_IDLE_MS) void a.close().then(() => agents.delete(k));
  }, 60_000);
  sweep.unref();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/health' || url.pathname === `${base}/health`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, agents: agents.size }));
        return;
      }
      if (url.pathname === `${base}/stachel-mcp.tgz` && req.method === 'GET') {
        if (!opts.tarball || !fs.existsSync(opts.tarball)) return jsonError(res, 404, 'Paket nicht vorhanden.');
        res.writeHead(200, { 'Content-Type': 'application/gzip', 'Cache-Control': 'no-cache', 'Content-Disposition': 'attachment; filename="stachel-mcp.tgz"' });
        fs.createReadStream(opts.tarball).pipe(res);
        return;
      }
      if (url.pathname !== base && url.pathname !== `${base}/`) return jsonError(res, 404, 'Nicht gefunden.');
      if (req.method !== 'POST') return jsonError(res, 405, 'Nur POST (zustandsloses Streamable HTTP).', { Allow: 'POST' });
      const token = TOKEN_RE.exec(req.headers.authorization ?? '')?.[1];
      if (!token) {
        return jsonError(res, 401, 'API-Token fehlt: Header "Authorization: Bearer stk_…" setzen. Token anlegen in Stachel → Board-Menü → „KI-Zugang (MCP)“.', {
          'WWW-Authenticate': 'Bearer realm="stachel"',
        });
      }
      let body: unknown;
      try {
        body = await readBody(req);
      } catch (e) {
        return jsonError(res, (e as Error).message === 'too_large' ? 413 : 400, (e as Error).message === 'too_large' ? 'Anfrage zu groß.' : 'Ungültiges JSON.');
      }
      const agent = agentFor(token);
      try {
        await agent.me();
      } catch (e) {
        if (e instanceof StachelError && e.status === 401) {
          forget(token);
          return jsonError(res, 401, e.message, { 'WWW-Authenticate': 'Bearer realm="stachel", error="invalid_token"' });
        }
        return jsonError(res, 502, e instanceof Error ? e.message : 'Stachel nicht erreichbar.');
      }
      const mcp = createMcpServer(agent);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      log(`[mcp] Fehler: ${(e as Error).stack ?? e}`);
      if (!res.headersSent) jsonError(res, 500, 'Interner Fehler.');
    }
  });

  return new Promise((resolve) => {
    server.listen(opts.port, opts.host, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port;
      resolve({
        server,
        url: `http://${opts.host === '0.0.0.0' ? '127.0.0.1' : opts.host}:${port}${base}`,
        close: async () => {
          clearInterval(sweep);
          await Promise.all([...agents.values()].map((a) => a.close()));
          agents.clear();
          await new Promise<void>((r) => server.close(() => r()));
          if (!opts.renderer) await renderer.close();
        },
      });
    });
  });
}
