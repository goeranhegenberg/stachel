// Grenzen gegen Missbrauch (Sicherheits-Review 2026-11-02 UPL-2, MAIL-1): Speicherquote, Upload-Größe und -Rate,
// Boards je Person, Einladungs-Mails je Konto und je IP – mit kleinen Grenzen über die Konfiguration (limits.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, loadLimits } from '../src/limits.js';
import { Browser, startEnv, type TestEnv } from './helpers.js';
import { LOCAL, signUp } from './local-helpers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const MB = 1024 * 1024;

let env: TestEnv;

beforeAll(async () => {
  env = await startEnv({
    instance: LOCAL,
    limits: { ...DEFAULT_LIMITS, uploadMaxBytes: 1 * MB, userQuotaBytes: 100, uploadsPerHour: 4, maxBoardsPerUser: 3, invitesPerDay: 3, invitesPerDayIp: 5 },
  });
});
afterAll(async () => {
  await env?.stop();
});

function upload(b: Browser, boardId: string, data: Buffer = PNG, what: 'images' | 'files' = 'images') {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(data)], { type: 'image/png' }), 'a.png');
  return b.req('POST', `/api/boards/${boardId}/${what}`, { body: fd });
}

describe('UPL-2: Uploads und Boards', () => {
  it('Upload zu groß, Speicher voll: 413 mit Code und deutschem Text', async () => {
    const b = await signUp(env, 'Uli Upload', 'uli@example.org');
    const board = (await b.post('/api/boards', { title: 'Uploads' })).body.board.id as string;

    const big = await upload(b, board, Buffer.alloc(1.2 * MB, 1));
    expect(big.status).toBe(413);
    expect(big.body).toMatchObject({ error: 'too_large', message: 'Das Bild ist zu groß (höchstens 1 MB).' });
    const bigPdf = await upload(b, board, Buffer.alloc(1.2 * MB, 1), 'files');
    expect(bigPdf.body).toMatchObject({ error: 'too_large', message: 'Die PDF ist zu groß (höchstens 1 MB).' });

    // Quote 100 Bytes: so lange hochladen, bis der Speicher voll ist (die Grenze ist weich: der letzte Upload passt noch)
    const codes: number[] = [];
    let full: { error?: string; message?: string } | null = null;
    for (let i = 0; i < 4 && !full; i++) {
      const r = await upload(b, board);
      codes.push(r.status);
      if (r.status === 413) full = r.body;
    }
    expect(codes[0]).toBe(201);
    expect(full).toMatchObject({ error: 'quota_exceeded' });
    expect(full!.message).toMatch(/^Dein Speicherplatz ist voll \(\d+ MB von \d+ MB belegt\)\. Lösche Boards/);
  });

  it('Uploads je Stunde: danach 429 rate_limited', async () => {
    const b = await signUp(env, 'Rita Rate', 'rita@example.org');
    const board = (await b.post('/api/boards', { title: 'Rate' })).body.board.id as string;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await upload(b, board);
      statuses.push(r.status);
      if (r.status === 201) env.srv.db.prepare('DELETE FROM images WHERE id = ?').run(r.body.image.id); // nur die Rate prüfen, nicht die Quote
      if (r.status === 429) expect(r.body).toMatchObject({ error: 'rate_limited', message: expect.stringContaining('Zu viele Uploads') });
    }
    expect(statuses).toEqual([201, 201, 201, 201, 429]);
  });

  it('Boards je Person: Anlegen und Duplizieren gesperrt, Code board_limit', async () => {
    const b = await signUp(env, 'Bea Board', 'bea@example.org');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await b.post('/api/boards', { title: `B${i}` })).body.board.id);
    const r = await b.post('/api/boards', { title: 'zu viel' });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: 'board_limit', message: expect.stringContaining('3 Boards') });
    expect((await b.post(`/api/boards/${ids[0]}/duplicate`, {})).body.error).toBe('board_limit');
    // im Papierkorb zählen sie weiter, endgültig gelöscht nicht mehr
    await b.req('DELETE', `/api/boards/${ids[0]}`);
    expect((await b.post('/api/boards', { title: 'immer noch zu viel' })).status).toBe(403);
    await b.req('DELETE', `/api/trash/${ids[0]}`);
    expect((await b.post('/api/boards', { title: 'jetzt geht es' })).status).toBe(201);
  });

  it('Werte aus der Umgebung: Vorgaben, 0 = ohne Grenze, Upload höchstens 15 MB, Unsinn bricht ab', () => {
    expect(loadLimits({})).toEqual(DEFAULT_LIMITS);
    const l = loadLimits({ STACHEL_USER_QUOTA_MB: '0', STACHEL_UPLOAD_MAX_MB: '50', STACHEL_UPLOADS_PER_HOUR: '1000', STACHEL_INVITES_PER_DAY_IP: '7' });
    expect(l).toMatchObject({ userQuotaBytes: 0, uploadMaxBytes: 15 * MB, uploadsPerHour: 1000, invitesPerDayIp: 7 });
    expect(loadLimits({ STACHEL_UPLOAD_MAX_MB: '5' }).uploadMaxBytes).toBe(5 * MB);
    expect(() => loadLimits({ STACHEL_USER_QUOTA_MB: 'viel' })).toThrow(/Ungültiger Wert/);
  });
});

describe('MAIL-1: Einladungen je Konto und je IP pro Tag', () => {
  it('Tageslimit je Konto, dann je IP über mehrere Konten; nichts halb verschickt', async () => {
    const a = await signUp(env, 'Ina Invite', 'ina@example.org');
    const board = (await a.post('/api/boards', { title: 'Einladen' })).body.board.id as string;
    const invite = (b: Browser, id: string, emails: string[]) => b.post(`/api/boards/${id}/share`, { emails, role: 'view' });
    expect((await invite(a, board, ['x1@example.org', 'x2@example.org'])).status).toBe(200);
    // 2 + 2 > 3 (Tag je Konto): abgelehnt, und keine der beiden Einladungen angelegt
    const r = await invite(a, board, ['x3@example.org', 'x4@example.org']);
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: 'rate_limited', message: expect.stringContaining('zu viele Einladungen') });
    expect(env.srv.db.prepare("SELECT COUNT(*) AS n FROM board_invites WHERE email IN ('x3@example.org', 'x4@example.org')").get()).toEqual({ n: 0 });
    expect((await invite(a, board, ['x3@example.org'])).status).toBe(200);
    expect((await invite(a, board, ['x5@example.org'])).status).toBe(429);
    // anderes Konto, gleiche IP (5 je Tag, schon 3 verbraucht)
    const b = await signUp(env, 'Ben Invite', 'ben@example.org');
    const board2 = (await b.post('/api/boards', { title: 'Einladen 2' })).body.board.id as string;
    expect((await invite(b, board2, ['y1@example.org', 'y2@example.org'])).status).toBe(200);
    expect((await invite(b, board2, ['y3@example.org'])).status).toBe(429);
  });
});
