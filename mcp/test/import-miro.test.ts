// Werkzeug import_miro_board gegen einen Fake-Stachel-Server (nur die Import-Endpunkte aus docs/features/import.md §2)
// über einen echten MCP-Client (In-Memory-Transport). Prüft Ablauf, Board-Link, Bericht, Fehlertexte und dass das
// Miro-Token nie in einer Antwort auftaucht.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ImportJob } from '../../shared/import';
import { Agent } from '../src/agent';
import { importMiroBoard, parseMiroBoard } from '../src/import-miro';
import type { Renderer } from '../src/render/renderer';
import { StachelApi } from '../src/stachel/api';
import { createMcpServer } from '../src/tools';

const MIRO_TOKEN = 'eyJtaXJvIjoic2VjcmV0LXRva2VuLTEyMzQ1Njc4OTAifQ';
const API_TOKEN = 'stk_testtesttesttesttesttest';

interface Req {
  method: string;
  path: string;
  auth?: string;
  xs?: string;
  body?: any;
}

/** Fake-Stachel: Verhalten je Test über `state` steuerbar. */
const state = {
  reqs: [] as Req[],
  tokenStatus: 200,
  /** Status-Folge, die GET /api/import/jobs/:id nacheinander liefert (letzter bleibt) */
  jobStates: [] as Partial<ImportJob>[],
  polls: 0,
  boardPages: [] as { boards: { id: string; name: string; modifiedAt?: string }[]; next?: number }[],
  importsOff: false,
};

const baseJob = (over: Partial<ImportJob> = {}): ImportJob => ({
  id: 'job1',
  source: 'miro',
  sourceBoard: 'uXjVO1a2b3c=',
  sourceName: 'Workshop Q4',
  status: 'queued',
  phase: 'queued',
  done: 0,
  total: 0,
  createdAt: '2026-11-04T10:00:00.000Z',
  ...over,
});

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

let server: http.Server;
let url: string;

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const u = new URL(req.url!, 'http://x');
    const r: Req = { method: req.method!, path: u.pathname + u.search, auth: req.headers.authorization, xs: req.headers['x-stachel'] as string | undefined, body: raw ? JSON.parse(raw) : undefined };
    state.reqs.push(r);
    if (r.auth !== `Bearer ${API_TOKEN}`) return send(res, 401, { ok: false, error: 'unauthorized', message: 'Bitte anmelden.' });
    if (state.importsOff && u.pathname.startsWith('/api/import/')) return send(res, 404, { ok: false, error: 'not_found', message: 'Nicht gefunden.' });
    if (req.method === 'POST' && u.pathname === '/api/import/miro/token') {
      if (state.tokenStatus === 400) return send(res, 400, { ok: false, error: 'miro_token_invalid', message: 'Miro lehnt das Zugriffstoken ab. Bitte ein neues Token in Miro erzeugen und erneut einfügen.' });
      return send(res, 200, { ok: true, conn: 'c_123', expiresAt: '2026-11-04T11:00:00.000Z' });
    }
    if (req.method === 'GET' && u.pathname === '/api/import/miro/boards') {
      if (u.searchParams.get('conn') !== 'c_123') return send(res, 401, { ok: false, error: 'miro_conn_expired', message: 'Die Verbindung zu Miro ist abgelaufen. Bitte neu verbinden.' });
      const page = Number(u.searchParams.get('offset') ?? 0) / 50;
      return send(res, 200, { ok: true, ...(state.boardPages[page] ?? { boards: [] }) });
    }
    if (req.method === 'POST' && u.pathname === '/api/import/miro/jobs') return send(res, 202, { ok: true, jobs: [baseJob({ sourceBoard: r.body.boards[0] })] });
    if (req.method === 'GET' && u.pathname === '/api/import/jobs/job1') {
      const s = state.jobStates[Math.min(state.polls++, state.jobStates.length - 1)] ?? {};
      return send(res, 200, { ok: true, job: baseJob(s) });
    }
    if (req.method === 'GET' && u.pathname.startsWith('/api/import/jobs/')) return send(res, 404, { ok: false, error: 'job_not_found', message: 'Diesen Import gibt es nicht (mehr).' });
    send(res, 404, { ok: false, error: 'not_found', message: 'Nicht gefunden.' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  Object.assign(state, { reqs: [], tokenStatus: 200, jobStates: [], polls: 0, boardPages: [], importsOff: false });
});

const DONE: Partial<ImportJob> = {
  status: 'done',
  phase: 'done',
  boardId: 'b_new1',
  report: {
    imported: { sticky: 12, frame: 2, connector: 0 },
    adjusted: [{ code: 'sticky_color', text: 'Notizfarbe auf die nächste Stachel-Farbe gesetzt', count: 7 }],
    skipped: [{ code: 'unsupported_shape', text: 'Unbekannte Form als Rechteck übernommen', count: 1 }],
    notes: ['Tabellen, Kommentare und Freihand liefert die Schnittstelle nicht.'],
  },
};

const env = () => ({ api: new StachelApi(url, API_TOKEN), webUrl: 'https://board.example.org/', pollMs: 1, sleep: async () => {} });
const textOf = (r: { content: unknown }) => (r.content as { type: string; text: string }[]).map((c) => c.text).join('\n');

describe('parseMiroBoard', () => {
  it('nimmt IDs und Board-Links, lehnt fremde Hosts ab', () => {
    expect(parseMiroBoard('uXjVO1a2b3c=')).toBe('uXjVO1a2b3c=');
    expect(parseMiroBoard('https://miro.com/app/board/uXjVO1a2b3c=/')).toBe('uXjVO1a2b3c=');
    expect(parseMiroBoard('https://miro.com/app/board/uXjVO1a2b3c%3D/?share_link_id=123')).toBe('uXjVO1a2b3c=');
    expect(parseMiroBoard('miro.com/app/board/uXjVO1a2b3c=')).toBe('uXjVO1a2b3c=');
    expect(() => parseMiroBoard('https://example.org/app/board/uXjVO1a2b3c=/')).toThrow(/nicht auf miro\.com/);
    expect(() => parseMiroBoard('https://miro.com/app/dashboard/')).toThrow(/keine Board-ID/);
    expect(() => parseMiroBoard('a b')).toThrow(/keine gültige Miro-Board-ID/);
  });
});

describe('import_miro_board (Fake-Stachel)', () => {
  it('über MCP: Werkzeug ist registriert, Import bis zum Ende, Link und Bericht, Token taucht nirgends auf', async () => {
    state.jobStates = [{ status: 'running', phase: 'read', done: 1, total: 3 }, { status: 'running', phase: 'build' }, DONE];
    const agent = new Agent(new StachelApi(url, API_TOKEN), {} as Renderer, 'https://board.example.org');
    const mcp = createMcpServer(agent);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1.0.0' });
    await Promise.all([mcp.connect(a), client.connect(b)]);
    try {
      const tool = (await client.listTools()).tools.find((t) => t.name === 'import_miro_board');
      expect(tool?.description).toContain('Importiert ein Board aus Miro über die Miro-REST-API (persönliches Zugriffstoken) als neues Stachel-Board.');
      expect(Object.keys((tool!.inputSchema as any).properties)).toEqual(expect.arrayContaining(['token', 'board', 'keepColors', 'description', 'wait']));

      // IMPORT_POLL_MS = 1,5 s, drei Abfragen → ein paar Sekunden
      const res = await client.callTool({ name: 'import_miro_board', arguments: { token: MIRO_TOKEN, board: 'https://miro.com/app/board/uXjVO1a2b3c=/', keepColors: true } });
      const t = textOf(res as any);
      expect(res.isError).toBeFalsy();
      expect(t).toContain('"id":"b_new1"');
      expect(t).toContain('"title":"Workshop Q4"');
      expect(t).toContain('"link":"https://board.example.org/b/b_new1"');
      expect(t).toContain('12 × sticky');
      expect(t).not.toContain('0 × connector');
      expect(t).toContain('Notizfarbe auf die nächste Stachel-Farbe gesetzt (7)');
      expect(t).toContain('Tabellen, Kommentare und Freihand');
      expect(t).not.toContain(MIRO_TOKEN);

      const [tok, job] = state.reqs;
      expect(tok).toMatchObject({ method: 'POST', path: '/api/import/miro/token', xs: '1', body: { token: MIRO_TOKEN } });
      expect(job).toMatchObject({ method: 'POST', path: '/api/import/miro/jobs', body: { conn: 'c_123', boards: ['uXjVO1a2b3c='], options: { keepColors: true } } });
      // das Token geht genau einmal an Stachel, danach nur noch die Verbindung
      expect(state.reqs.filter((r) => JSON.stringify(r).includes(MIRO_TOKEN))).toHaveLength(1);
      expect(state.reqs.slice(2).every((r) => r.method === 'GET' && r.path === '/api/import/jobs/job1')).toBe(true);
    } finally {
      await client.close();
      await agent.close();
    }
  });

  it('ohne board: Liste der Miro-Boards (mehrere Seiten, Suchbegriff wird durchgereicht)', async () => {
    state.boardPages = [
      { boards: [{ id: 'uA=', name: 'Retro', modifiedAt: '2026-10-01T00:00:00Z' }], next: 50 },
      { boards: [{ id: 'uB=', name: 'Retro 2' }] },
    ];
    const res = await importMiroBoard({ token: MIRO_TOKEN, query: 'Retro' }, env());
    const t = textOf(res);
    expect(t).toContain('2 Miro-Board(s)');
    expect(t).toContain('{"id":"uA=","name":"Retro","modifiedAt":"2026-10-01T00:00:00Z"}');
    expect(t).toContain('{"id":"uB=","name":"Retro 2"}');
    expect(t).not.toContain('weitere vorhanden');
    expect(state.reqs.map((r) => r.path)).toEqual(['/api/import/miro/token', '/api/import/miro/boards?conn=c_123&offset=0&query=Retro', '/api/import/miro/boards?conn=c_123&offset=50&query=Retro']);
    expect(state.reqs.some((r) => r.path.startsWith('/api/import/miro/jobs'))).toBe(false);
  });

  it('wait: false startet nur; job fragt den Stand ab (ohne token)', async () => {
    const started = textOf(await importMiroBoard({ token: MIRO_TOKEN, board: 'uXjVO1a2b3c=', wait: false }, env()));
    expect(started).toContain('läuft noch: wartet');
    expect(started).toContain('job = "job1"');
    expect(state.reqs.filter((r) => r.path.startsWith('/api/import/jobs/'))).toHaveLength(0);

    state.jobStates = [DONE];
    const done = textOf(await importMiroBoard({ job: 'job1' }, env()));
    expect(done).toContain('Import fertig');
    expect(done).toContain('https://board.example.org/b/b_new1');
  });

  it('nach der Wartezeit: Stand melden, Job läuft weiter', async () => {
    state.jobStates = [{ status: 'running', phase: 'images', done: 3, total: 40 }];
    const res = await importMiroBoard({ token: MIRO_TOKEN, board: 'uXjVO1a2b3c=' }, { ...env(), maxWaitMs: 0 });
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain('läuft noch: lädt Bilder und Dokumente (3/40). Job job1');
  });

  it('fehlgeschlagener Import: Fehlertext des Servers, isError', async () => {
    state.jobStates = [{ status: 'failed', phase: 'read', error: 'Die Verbindung zu Miro ist abgelaufen. Bitte neu verbinden.' }];
    const res = await importMiroBoard({ token: MIRO_TOKEN, board: 'uXjVO1a2b3c=' }, env());
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('fehlgeschlagen: Die Verbindung zu Miro ist abgelaufen');
  });

  it('Fehler: fehlendes/ungültiges Token, Instanz ohne Import, unbekannter Job – Token nie in der Meldung', async () => {
    const agent = new Agent(new StachelApi(url, API_TOKEN), {} as Renderer, 'https://board.example.org');
    const mcp = createMcpServer(agent);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1.0.0' });
    await Promise.all([mcp.connect(a), client.connect(b)]);
    const call = async (args: Record<string, unknown>) => {
      const r = (await client.callTool({ name: 'import_miro_board', arguments: args })) as any;
      return { isError: r.isError, text: textOf(r) };
    };
    try {
      const missing = await call({ board: 'uXjVO1a2b3c=' });
      expect(missing.isError).toBe(true);
      expect(missing.text).toContain('Es fehlt das persönliche Miro-Zugriffstoken');
      expect(state.reqs).toHaveLength(0);

      state.tokenStatus = 400;
      const invalid = await call({ token: MIRO_TOKEN, board: 'uXjVO1a2b3c=' });
      expect(invalid.isError).toBe(true);
      expect(invalid.text).toContain('Miro lehnt das Zugriffstoken ab');
      expect(invalid.text).not.toContain(MIRO_TOKEN);

      state.tokenStatus = 200;
      state.importsOff = true;
      const off = await call({ token: MIRO_TOKEN });
      expect(off.text).toContain('bietet den Import aus Miro nicht an');

      state.importsOff = false;
      const unknown = await call({ job: 'nope' });
      expect(unknown.text).toContain('Diesen Import gibt es nicht');

      const badLink = await call({ token: MIRO_TOKEN, board: 'https://evil.example/app/board/x/' });
      expect(badLink.text).toContain('nicht auf miro.com');
    } finally {
      await client.close();
      await agent.close();
    }
  });

  it('abgelaufene Miro-Verbindung (401 miro_*) meldet den Server-Text, nicht „API-Token ungültig“', async () => {
    const api = new StachelApi(url, API_TOKEN);
    await expect(api.req('GET', '/api/import/miro/boards?conn=alt')).rejects.toMatchObject({ status: 401, code: 'miro_conn_expired', message: expect.stringContaining('Verbindung zu Miro ist abgelaufen') });
  });
});
