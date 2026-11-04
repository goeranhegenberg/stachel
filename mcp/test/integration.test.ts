// Integration: echter Stachel-Server (server/dist + web/dist, Fake-Identitätsdienst) + MCP-Server über Streamable HTTP +
// MCP-Client aus dem SDK. Ein gleichzeitig offener Browser sieht Mindmap und Verbinder live, der Assistent erscheint
// in der Anwesenheit, screenshot liefert ein echtes Bild, undo nimmt den letzten Schritt zurück, Widerrufen sperrt.
// Vorher bauen: `cd e2e && npm run build` (web + server). Bilder: mcp/test-results/*.png
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeOrg } from '../../server/test/fake-org';
import { StachelServer } from '../../e2e/support/server';
import { startHttp } from '../src/http';
import { Renderer } from '../src/render/renderer';
import { StachelApi } from '../src/stachel/api';
import { BoardConn } from '../src/stachel/board';

const OUT = path.resolve(import.meta.dirname, '../test-results');
const freePort = () =>
  new Promise<number>((r) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => r(p));
    });
  });

let org: FakeOrg;
let server: StachelServer;
let dataDir: string;
let mcp: Awaited<ReturnType<typeof startHttp>>;
let renderer: Renderer;
let browser: Browser;
let page: Page;
let client: Client;
let cookie = '';
let boardId = '';
let tokenId = '';
let secret = '';

async function api(method: string, p: string, body?: unknown) {
  const res = await fetch(server.url + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Stachel': '1', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.getSetCookie().find((c) => c.startsWith('stachel_session='));
  if (set) cookie = set.split(';')[0]!;
  return res.json() as Promise<any>;
}

async function call(name: string, args: Record<string, unknown>) {
  const r = (await client.callTool({ name, arguments: args })) as { content: { type: string; text?: string; data?: string }[]; isError?: boolean };
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return { ...r, text };
}

const count = (sel: string) => page.locator(sel).count();

beforeAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  org = await new FakeOrg().start();
  org.addAdmin('Mara', 'kaktus-123');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-mcp-it-'));
  server = new StachelServer(await freePort(), dataDir, org.url, path.join(OUT, 'server.log'));
  await server.start();
  await api('POST', '/api/auth/password', { username: 'Mara', password: 'kaktus-123' });
  boardId = (await api('POST', '/api/boards', { title: 'Festival mit KI' })).board.id;
  const tok = await api('POST', '/api/tokens', { label: 'Integrationstest' });
  secret = tok.secret;
  tokenId = tok.token.id;
  renderer = new Renderer();
  const tarball = path.join(dataDir, 'stachel-mcp.tgz');
  fs.writeFileSync(tarball, 'paket');
  mcp = await startHttp({ port: 0, host: '127.0.0.1', stachelUrl: server.url, renderer, tarball, log: () => {} });
  client = new Client({ name: 'integrationstest', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(mcp.url), { requestInit: { headers: { Authorization: `Bearer ${secret}` } } }));
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const [name, value] = cookie.split('=');
  await ctx.addCookies([{ name: name!, value: value!, url: server.url }]);
  page = await ctx.newPage();
  await page.goto(`${server.url}/?b=${boardId}`);
  await page.getByTestId('status').getByText('Live').waitFor({ timeout: 30_000 });
}, 120_000);

afterAll(async () => {
  await client?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await mcp?.close();
  await renderer?.close();
  await server?.stop();
  await org?.stop();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('MCP-Server gegen echten Stachel-Server', () => {
  it('ohne bzw. mit falschem Token: 401 mit Hinweis', async () => {
    const res = await fetch(mcp.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{}' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
    const bad = await fetch(mcp.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer stk_falschfalschfalschfalsch' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(bad.status).toBe(401);
    expect((await bad.json()).error.message).toMatch(/ungültig oder widerrufen/);
  });

  it('Gesundheit und stdio-Paket zum Herunterladen', async () => {
    expect((await fetch(mcp.url.replace(/\/mcp$/, '/health'))).status).toBe(200);
    const pkg = await fetch(`${mcp.url}/stachel-mcp.tgz`);
    expect(pkg.status).toBe(200);
    expect(await pkg.text()).toBe('paket');
    expect((await fetch(mcp.url, { method: 'GET', headers: { Authorization: `Bearer ${secret}` } })).status).toBe(405);
  });

  it('Tools, Ressourcen, Prompt', async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    for (const t of ['list_boards', 'get_board_overview', 'get_objects', 'search', 'create_objects', 'create_notes', 'create_mindmap', 'create_kanban', 'connect', 'update_objects', 'arrange_objects', 'auto_layout', 'group_objects', 'delete_objects', 'get_comments', 'add_comment', 'undo', 'screenshot', 'private_mode']) {
      expect(tools).toContain(t);
    }
    const res = await client.listResources();
    expect(res.resources.map((r) => r.uri)).toContain('stachel://guide/design');
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toContain('board_gestalten');
    const boards = await call('list_boards', {});
    expect(boards.text).toContain('KI (für Mara)');
    expect(boards.text).toContain(boardId);
  });

  it('Mindmap und Verbinder erscheinen live im offenen Browser, KI in der Anwesenheit', async () => {
    const mind = await call('create_mindmap', {
      board: boardId,
      x: 80,
      y: 160,
      outline: 'Festival 2026\n- Programm\n  - Bands\n  - Workshops\n- Orga\n  - Helfer\n  - Toiletten\n- Werbung\n  - Instagram',
    });
    expect(mind.isError).toBeFalsy();
    await expect.poll(() => count('[data-type="mindnode"]'), { timeout: 10_000 }).toBe(9);
    const flow = await call('create_objects', {
      board: boardId,
      objects: [
        { type: 'shape', ref: 'a', shape: 'terminator', text: 'Einlass', x: 80, y: 520 },
        { type: 'shape', ref: 'b', text: 'Ticket **prüfen**', x: 360, y: 520 },
        { type: 'shape', ref: 'c', shape: 'diamond', text: 'Gültig?', x: 640, y: 500, w: 160, h: 160 },
        { type: 'connector', from: 'a', to: 'b', label: 'weiter' },
        { type: 'connector', from: 'b', to: 'c', style: 'elbow' },
      ],
    });
    expect(flow.isError).toBeFalsy();
    await expect.poll(() => count('[data-type="connector"]'), { timeout: 10_000 }).toBe(2);
    await expect.poll(() => count('[data-type="shape"]')).toBe(3);
    await expect.poll(() => page.locator('.presence__av[title^="KI (für Mara)"]').count(), { timeout: 10_000 }).toBe(1);
    await page.screenshot({ path: path.join(OUT, 'browser-live.png') });
  });

  it('screenshot liefert ein echtes PNG mit Legende', async () => {
    const r = await call('screenshot', { board: boardId, labels: true });
    expect(r.isError).toBeFalsy();
    const img = r.content.find((c) => c.type === 'image')!;
    const png = Buffer.from(img.data!, 'base64');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    expect(w).toBeGreaterThanOrEqual(400);
    expect(h).toBeGreaterThanOrEqual(300);
    expect(png.length).toBeGreaterThan(20_000);
    fs.writeFileSync(path.join(OUT, 'mcp-screenshot.png'), png);
    expect(r.text).toMatch(/Legende:\n1 = /);
    expect(r.text).toContain('„Festival 2026“');
  });

  it('Lesen: Überblick, Objekte, Suche', async () => {
    const o = await call('get_board_overview', { board: boardId });
    expect(JSON.parse(o.text).counts).toMatchObject({ mindnode: 9, shape: 3, connector: 2 });
    const objs = await call('get_objects', { board: boardId, types: ['shape'] });
    expect(objs.text).toContain('"text":"Ticket **prüfen**"');
    expect(objs.text).toMatch(/"connectors":\["→/);
    const s = await call('search', { board: boardId, query: 'toilet' });
    expect(s.text).toContain('Toiletten');
  });

  it('Fehler mit Korrekturhinweis, nichts geändert', async () => {
    const objs = await call('get_objects', { board: boardId, types: ['mindnode'], text: 'Bands' });
    const id = /"id":"([^"]+)"/.exec(objs.text)![1]!;
    const r = await call('update_objects', { board: boardId, updates: [{ id, status: 'done' }] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/`status` gibt es hier nicht\. Änderbar: /);
    const bad = await call('create_objects', { board: boardId, objects: [{ type: 'sticky', color: 'lachs' }] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/Farbe „lachs“/);
  });

  it('undo nimmt die letzte eigene Tool-Ausführung zurück (live sichtbar)', async () => {
    const r = await call('undo', { board: boardId });
    expect(r.text).toContain('1 Schritt(e) zurückgenommen');
    await expect.poll(() => count('[data-type="shape"]'), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => count('[data-type="connector"]')).toBe(0);
    expect(await count('[data-type="mindnode"]')).toBe(9);
    await call('undo', { board: boardId, redo: true });
    await expect.poll(() => count('[data-type="shape"]'), { timeout: 10_000 }).toBe(3);
  });

  it('ruhende Verbindung (nach Pause): Anwesenheit weg, beim nächsten Aufruf zurück, undo geht weiter', async () => {
    const api = new StachelApi(server.url, secret);
    const me = await api.me();
    const conn = await BoardConn.open(api, boardId, me.ai, me.user);
    try {
      const id = conn.change((m) => m.create([{ type: 'sticky', x: 900, y: 160, w: 200, h: 200, text: 'Pause', color: '#fff27a' }])[0]!);
      await conn.flush();
      await expect.poll(() => count('[data-type="sticky"]'), { timeout: 10_000 }).toBe(1);
      conn.suspend();
      await expect.poll(() => page.locator('.presence__av[title^="KI (für Mara)"]').count(), { timeout: 15_000 }).toBe(1); // die zweite Verbindung (MCP-Agent) ist noch da
      await conn.resume();
      expect(conn.undo()).toBe(1);
      await conn.flush();
      await expect.poll(() => count('[data-type="sticky"]'), { timeout: 10_000 }).toBe(0);
      expect(conn.model.get(id)).toBeNull();
    } finally {
      conn.destroy();
    }
  });

  it('privater Modus: das Tool steuert, verdeckte Inhalte bekommt der Assistent nicht zu sehen', async () => {
    const st = await call('private_mode', { board: boardId, action: 'start' });
    expect(st.text).toContain('"on":true');
    await page.getByTestId('private-bar').waitFor();
    // Mara schreibt im Browser verdeckt
    await page.keyboard.press('Escape');
    await page.keyboard.press('n');
    await page.mouse.click(1000, 640);
    await page.locator('.rt.editing').waitFor();
    await page.keyboard.type('KI darf das nicht lesen');
    await page.keyboard.press('Escape');
    await expect.poll(async () => JSON.parse((await call('private_mode', { board: boardId, action: 'status' })).text).hidden, { timeout: 8000 }).toBe(1);
    expect((await call('get_objects', { board: boardId, text: 'KI darf' })).text).toMatch(/^0 Treffer/);
    expect(JSON.parse((await call('get_board_overview', { board: boardId })).text).privateMode).toMatchObject({ on: true, hidden: 1 });
    await call('private_mode', { board: boardId, action: 'reveal', countdown: 0 });
    await expect.poll(async () => (await call('get_objects', { board: boardId, text: 'KI darf' })).text, { timeout: 8000 }).toMatch(/^1 Treffer/);
  });

  it('nach Widerruf des Tokens: kein Zugriff mehr', async () => {
    await api('DELETE', `/api/tokens/${tokenId}`);
    const r = await call('list_boards', {}).catch((e: Error) => ({ isError: true, text: e.message }));
    expect(r.isError || /ungültig|widerrufen|401/.test(r.text)).toBeTruthy();
  });
});
