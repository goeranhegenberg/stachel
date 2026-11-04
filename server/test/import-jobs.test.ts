// Import Ende-zu-Ende gegen Fake-Miro: Token → Boards → Auftrag → Board mit Objekten, Version und Bericht; Abbruch,
// Grenzen, Neustart, 401 im Auftrag, Token nie im Log (server/src/import/jobs.ts, routes.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ImportJob } from '../../shared/import.js';
import { openDb } from '../src/db.js';
import { JOB_ERRORS, ImportJobs } from '../src/import/jobs.js';
import { loadImportConfig } from '../src/config.js';
import { loginAdmin, loginMember, waitFor, type Browser } from './helpers.js';
import { boardObjects, captureLog, sampleBoard, startImportEnv, type ImportEnv } from './import-helpers.js';
import { loadFixtureBoards } from './fake-miro.js';

let env: ImportEnv | null = null;
afterEach(async () => {
  await env?.stop();
  env = null;
});

async function connect(b: Browser, token = 'tok-secret-1234'): Promise<string> {
  const r = await b.post('/api/import/miro/token', { token });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.conn as string;
}

async function finished(b: Browser, id: string): Promise<ImportJob> {
  let job: ImportJob | null = null;
  await waitFor(async () => {
    job = (await b.get(`/api/import/jobs/${id}`)).body.job as ImportJob;
    return ['done', 'failed', 'canceled'].includes(job.status);
  }, 15_000);
  return job!;
}

describe('Import aus Miro (Ende zu Ende)', () => {
  it('Token → Board-Liste → Auftrag → neues Board mit Objekten, Bildern, Version und Bericht', async () => {
    env = await startImportEnv();
    env.miro.tokens.add('tok-secret-1234');
    env.miro.addBoard(await sampleBoard('b1', 'Workshop'));
    env.miro.addBoard(await sampleBoard('b2', 'Retro'));
    const b = await loginAdmin(env);

    const src = await b.get('/api/import/sources');
    expect(src.body).toEqual({ ok: true, miro: { enabled: true, token: true, oauth: false, connected: false } });

    const bad = await b.post('/api/import/miro/token', { token: 'falsch-falsch-falsch' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('miro_token_invalid');

    const conn = await connect(b);
    const list = await b.get(`/api/import/miro/boards?conn=${conn}`);
    expect(list.status).toBe(200);
    expect(list.body.boards.map((x: { id: string }) => x.id).sort()).toEqual(['b1', 'b2']);
    const q = await b.get(`/api/import/miro/boards?conn=${conn}&query=retro`);
    expect(q.body.boards).toEqual([{ id: 'b2', name: 'Retro', description: 'Ein Test-Board', modifiedAt: '2026-11-01T10:00:00Z' }]);

    // fremde Person kann die Verbindung nicht nutzen
    const other = await loginMember(env, env.fake.addMember(77, 'Lena'));
    expect((await other.get(`/api/import/miro/boards?conn=${conn}`)).status).toBe(401);

    const res = await b.post('/api/import/miro/jobs', { conn, boards: ['b1'], options: { keepColors: false } });
    expect(res.status).toBe(202);
    // Name aus der Board-Liste schon vor dem Lesen (Fortschrittsanzeige)
    expect(res.body.jobs[0].sourceName).toBe('Workshop');
    const job = await finished(b, res.body.jobs[0].id);
    expect(job.status, job.error).toBe('done');
    expect(job.sourceName).toBe('Workshop');
    expect(job.phase).toBe('done');
    expect(job.boardId).toBeTruthy();
    expect(job.report!.imported.sticky).toBe(2);
    expect(job.report!.skipped.some((e) => e.code === 'image_failed')).toBe(true);

    // Board: Titel, Objekte, Bild-ID, Platzhalter, Bild-Zeilen
    const boards = (await b.get('/api/boards')).body.boards as { id: string; title: string }[];
    expect(boards.find((x) => x.id === job.boardId)?.title).toBe('Workshop');
    const objs = [...boardObjects(env, job.boardId!).values()];
    const types = objs.map((o) => o.type);
    expect(types.filter((t) => t === 'sticky')).toHaveLength(2);
    expect(types).toContain('frame');
    expect(types).toContain('connector');
    const img = objs.find((o) => o.type === 'image');
    expect(typeof img?.imageId).toBe('string');
    expect(String(img!.imageId).length).toBeGreaterThan(5);
    expect(objs.some((o) => o.type === 'shape' && o.text === 'Bild nicht übernommen')).toBe(true);
    const doc = objs.find((o) => o.type === 'document');
    expect(typeof doc?.docFile).toBe('string');
    const files = env.srv.db.prepare('SELECT mime FROM images WHERE board_id = ?').all(job.boardId!) as { mime: string }[];
    expect(files.map((f) => f.mime).sort()).toEqual(['application/pdf', 'image/png']);
    expect((await b.get(`/api/images/${img!.imageId}`)).status).toBe(200);

    // benannte Version
    const versions = await b.get(`/api/boards/${job.boardId}/versions`);
    expect(versions.body.versions.some((v: { name: string | null }) => /^Import aus Miro \(\d\d\.\d\d\.\d{4}\)$/.test(v.name ?? ''))).toBe(true);

    // Liste der eigenen Aufträge; fremde sehen sie nicht
    expect((await b.get('/api/import/jobs')).body.jobs.map((j: ImportJob) => j.id)).toContain(job.id);
    expect((await other.get(`/api/import/jobs/${job.id}`)).status).toBe(404);
    expect((await other.get('/api/import/jobs')).body.jobs).toEqual([]);

    // Datei-Abruf ohne Token, API mit Token
    const fileReqs = env.miro.requests.filter((r) => r.path.startsWith('/files/'));
    expect(fileReqs.length).toBeGreaterThan(0);
    expect(fileReqs.every((r) => r.auth === null)).toBe(true);
    const imgReq = env.miro.requests.find((r) => r.path.includes('/resources/images/bild.png'));
    expect(imgReq?.query).toMatchObject({ format: 'original', redirect: 'false' });
  });

  it('alle Fixture-Boards (server/test/fixtures/miro) lassen sich über den Fake importieren', async () => {
    env = await startImportEnv();
    env.miro.tokens.add('tok-secret-1234');
    const fixtures = loadFixtureBoards();
    expect(fixtures.length).toBeGreaterThan(0);
    for (const f of fixtures) env.miro.addBoard(f);
    const b = await loginAdmin(env);
    const conn = await connect(b);
    const res = await b.post('/api/import/miro/jobs', { conn, boards: fixtures.map((f) => f.board.id) });
    expect(res.status).toBe(202);
    for (const j of res.body.jobs as ImportJob[]) {
      const job = await finished(b, j.id);
      expect(job.status, `${j.sourceBoard}: ${job.error}`).toBe('done');
      const objs = boardObjects(env, job.boardId!);
      expect(objs.size, j.sourceBoard).toBeGreaterThan(0);
      expect(Object.values(job.report!.imported).reduce((a, n) => a + n, 0)).toBeGreaterThan(0);
      if (fixtures.find((f) => f.board.id === j.sourceBoard)?.mindNodes?.length) {
        expect([...objs.values()].some((o) => o.type === 'mindnode'), 'Mindmap').toBe(true);
      }
    }
  });

  it('Abbruch: wartender und laufender Auftrag, kein halbes Board', async () => {
    env = await startImportEnv();
    env.miro.tokens.add('tok-secret-1234');
    env.miro.addBoard(await sampleBoard('b1'));
    env.miro.addBoard(await sampleBoard('b2'));
    const b = await loginAdmin(env);
    const conn = await connect(b);
    env.miro.delayMs = 150;
    const res = await b.post('/api/import/miro/jobs', { conn, boards: ['b1', 'b2'] });
    const [j1, j2] = res.body.jobs as ImportJob[];
    // je Person nur einer gleichzeitig: der zweite wartet
    await waitFor(async () => (await b.get(`/api/import/jobs/${j1!.id}`)).body.job.status === 'running');
    expect((await b.get(`/api/import/jobs/${j2!.id}`)).body.job.status).toBe('queued');
    expect((await b.req('DELETE', `/api/import/jobs/${j2!.id}`)).body.job.status).toBe('canceled');
    await b.req('DELETE', `/api/import/jobs/${j1!.id}`);
    const done1 = await finished(b, j1!.id);
    expect(done1.status).toBe('canceled');
    expect(done1.boardId).toBeUndefined();
    const before = (await b.get('/api/boards')).body.boards.length;
    expect(before).toBe(0);
    expect((env.srv.db.prepare('SELECT COUNT(*) AS n FROM images').get() as { n: number }).n).toBe(0);
  });

  it('Grenzen: Boards je Tag (429) und Boards je Person (403)', async () => {
    env = await startImportEnv({ env: { STACHEL_IMPORTS_PER_DAY: '1' } });
    env.miro.tokens.add('tok-secret-1234');
    env.miro.addBoard(await sampleBoard('b1'));
    const b = await loginAdmin(env);
    const conn = await connect(b);
    const two = await b.post('/api/import/miro/jobs', { conn, boards: ['b1', 'b1x'] });
    expect(two.status).toBe(429);
    expect(two.body.error).toBe('import_limit');
    const one = await b.post('/api/import/miro/jobs', { conn, boards: ['b1'] });
    expect(one.status).toBe(202);
    await finished(b, one.body.jobs[0].id);
    expect((await b.post('/api/import/miro/jobs', { conn, boards: ['b1'] })).status).toBe(429);

    const limits = env.cfg.limits;
    await env.stop();

    env = await startImportEnv({ overrides: { limits: { ...limits, maxBoardsPerUser: 1 } } });
    env.miro.tokens.add('tok-secret-1234');
    const c = await loginAdmin(env);
    expect((await c.post('/api/boards', { title: 'schon da' })).status).toBe(201);
    const cc = await connect(c);
    const r = await c.post('/api/import/miro/jobs', { conn: cc, boards: ['b1'] });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('board_limit');
  });

  it('Eingaben: unbekannte Verbindung, zu viele Boards, Import aus', async () => {
    env = await startImportEnv({ env: { STACHEL_IMPORT_MIRO_TOKEN: 'off' } });
    const b = await loginAdmin(env);
    expect((await b.post('/api/import/miro/token', { token: 'tok-secret-1234' })).body.error).toBe('import_disabled');
    expect((await b.get('/api/import/miro/boards?conn=mc_unbekannt')).body.error).toBe('miro_conn_expired');
    expect((await b.post('/api/import/miro/jobs', { conn: 'oauth', boards: ['b1'] })).status).toBe(401);
    expect((await b.post('/api/import/miro/oauth/start', {})).body.error).toBe('oauth_disabled');
    expect((await b.get('/api/import/sources')).body.miro).toEqual({ enabled: true, token: false, oauth: false, connected: false });
    // ohne X-Stachel: CSRF
    expect((await b.req('POST', '/api/import/miro/token', { json: { token: 'x' }, csrf: false })).status).toBe(403);
    // ohne Sitzung
    expect((await fetch(`${env.base}/api/import/sources`)).status).toBe(401);
    await env.stop();

    env = await startImportEnv({ env: { STACHEL_IMPORT: 'off' } });
    const c = await loginAdmin(env);
    expect((await c.get('/api/import/sources')).body.miro.enabled).toBe(false);
    expect((await c.post('/api/import/miro/token', { token: 'tok-secret-1234' })).status).toBe(403);
    expect((await c.post('/api/import/miro/jobs', { conn: 'x', boards: ['b1'] })).body.error).toBe('import_disabled');

    await env.stop();
    env = await startImportEnv();
    env.miro.tokens.add('tok-secret-1234');
    const d = await loginAdmin(env);
    const conn = await connect(d);
    const many = Array.from({ length: 11 }, (_, i) => `b${i}`);
    expect((await d.post('/api/import/miro/jobs', { conn, boards: many })).status).toBe(400);
    expect((await d.post('/api/import/miro/jobs', { conn, boards: ['../x'] })).status).toBe(400);
    expect((await d.post('/api/import/miro/jobs', { conn, boards: ['b1'], options: { keepColors: 'ja' } })).status).toBe(400);
  });

  it('401 während des Auftrags → failed mit Hinweis; Miro nicht erreichbar → failed', async () => {
    env = await startImportEnv();
    env.miro.tokens.add('tok-secret-1234');
    env.miro.addBoard(await sampleBoard('b1'));
    const b = await loginAdmin(env);
    const conn = await connect(b);
    env.miro.tokens.delete('tok-secret-1234');
    const r = await b.post('/api/import/miro/jobs', { conn, boards: ['b1'] });
    const job = await finished(b, r.body.jobs[0].id);
    expect(job.status).toBe('failed');
    expect(job.error).toBe(JOB_ERRORS.auth);

    env.miro.tokens.add('tok-secret-1234');
    const r2 = await b.post('/api/import/miro/jobs', { conn, boards: ['gibtsnicht'] });
    expect((await finished(b, r2.body.jobs[0].id)).error).toBe(JOB_ERRORS.notFound);
  });

  it('Neustart: offene Aufträge werden failed („Bitte erneut verbinden“)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-import-'));
    const db = openDb(dir);
    try {
      const cfg = loadImportConfig({}, 'https://x.test');
      const deps = { db, imagesDir: dir, cfg, uploads: { fits: () => ({ ok: true as const }), boards: () => 0, limits: { maxBoardsPerUser: 0 } as never }, mapBoard: () => { throw new Error('x'); }, download: { hosts: [], maxBytes: 1 } };
      new ImportJobs(deps);
      db.prepare("INSERT INTO import_jobs (id, user_key, source, source_board, source_name, status, phase, options, created_at) VALUES ('j1', 'u', 'miro', 'b', '', 'running', 'images', '{}', ?)").run(new Date().toISOString());
      db.prepare("INSERT INTO import_jobs (id, user_key, source, source_board, source_name, status, phase, options, created_at) VALUES ('j2', 'u', 'miro', 'b', '', 'queued', 'queued', '{}', ?)").run(new Date().toISOString());
      const again = new ImportJobs(deps);
      expect(again.get('u', 'j1')).toMatchObject({ status: 'failed', error: JOB_ERRORS.restart });
      expect(again.get('u', 'j2')?.status).toBe('failed');
      expect(again.get('andere', 'j1')).toBeNull();
      // Löschfrist 30 Tage
      expect(again.purge(Date.now() + 31 * 24 * 3600_000)).toBe(2);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Token, Signatur-Adressen und Inhalte landen nie im Log', async () => {
    const cap = captureLog();
    try {
      env = await startImportEnv({ overrides: { logLevel: 'info' } });
      env.miro.tokens.add('tok-secret-1234');
      env.miro.addBoard(await sampleBoard('b1', 'Geheimes Board'));
      const b = await loginAdmin(env);
      const conn = await connect(b);
      await b.get(`/api/import/miro/boards?conn=${conn}`);
      const r = await b.post('/api/import/miro/jobs', { conn, boards: ['b1'] });
      expect((await finished(b, r.body.jobs[0].id)).status).toBe('done');
      await b.post('/api/import/miro/token', { token: 'tok-anders-9876' });
    } finally {
      cap.restore();
    }
    const log = cap.text();
    expect(log).toContain('fertig');
    for (const secret of ['tok-secret-1234', 'tok-anders-9876', 'sig=ok', 'Geheimes Board', 'Erste', 'mc_']) expect(log, secret).not.toContain(secret);
  });
});
