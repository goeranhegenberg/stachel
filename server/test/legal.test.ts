// Rechtliche Pflichten (legal.ts, docs/legal/zusammenfassung.md): Nutzungsbedingungen bei der Registrierung (CR-1),
// „Meine Daten herunterladen“ (CR-8), Ablauf unbenutzter KI-Tokens (CR-9), Löschfristen (CR-10).
import { inflateRawSync } from 'node:zlib';
import * as Y from 'yjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadInstance } from '../src/instance.js';
import { applyRetention, boardFolder, INVITE_RETENTION_DAYS, legalStartupWarnings, REPORT_RETENTION_DAYS, USER_RETENTION_DAYS } from '../src/legal.js';
import { mails } from '../src/mail-templates.js';
import { zipStream } from '../src/zip.js';
import { Browser, loginAdmin, startEnv, type TestEnv } from './helpers.js';
import { captcha, LOCAL, mailsOf, PW, signUp, waitMail } from './local-helpers.js';

const DAY = 24 * 3600_000;
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

/** ZIP lesen (zentrales Verzeichnis): Name → Inhalt. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(-1);
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(local + 26);
    const data = buf.subarray(local + 30 + lNameLen, local + 30 + lNameLen + size);
    out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    p += 46 + nameLen;
  }
  return out;
}

async function collect(s: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of s) parts.push(Buffer.from(c as Buffer));
  return Buffer.concat(parts);
}

describe('zip.ts', () => {
  it('schreibt ein gültiges ZIP mit UTF-8-Namen, komprimiert und gespeichert, überspringt fehlende Dateien', async () => {
    const buf = await collect(
      zipStream([
        { name: 'konto.json', data: JSON.stringify({ name: 'Mara Lindner' }) },
        { name: 'boards/Größe (x1)/dateien/a.png', data: PNG_1x1, compress: false },
        { name: 'fehlt.bin', data: async () => null },
        { name: 'leer.txt', data: '' },
      ]),
    );
    const z = unzip(buf);
    expect([...z.keys()]).toEqual(['konto.json', 'boards/Größe (x1)/dateien/a.png', 'leer.txt']);
    expect(JSON.parse(z.get('konto.json')!.toString())).toEqual({ name: 'Mara Lindner' });
    expect(z.get('boards/Größe (x1)/dateien/a.png')!.equals(PNG_1x1)).toBe(true);
    expect(z.get('leer.txt')!.length).toBe(0);
  });
  it('Ordnernamen ohne störende Zeichen, mit ID', () => {
    expect(boardFolder('Plan: A/B?', 'abc')).toBe('Plan A B (abc)');
    expect(boardFolder('  ', 'x')).toBe('Board (x)');
    expect(boardFolder('..geheim', 'y')).toBe('geheim (y)');
  });
});

describe('CR-1 Nutzungsbedingungen (Modus local)', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startEnv({ instance: { ...LOCAL, termsUrl: 'https://stachel.example.test/nutzungsbedingungen', privacyUrl: 'https://stachel.example.test/datenschutz' } });
  });
  afterAll(async () => {
    await env?.stop();
  });

  it('/api/instance nennt die Nutzungsbedingungen; ohne Häkchen keine Registrierung; Zeitpunkt wird gespeichert', async () => {
    const b = new Browser(env.base);
    expect((await b.get('/api/instance')).body.termsUrl).toBe('https://stachel.example.test/nutzungsbedingungen');
    const base = { name: 'Nora Neu', email: 'nora@example.org', password: PW };
    const no = await b.post('/api/auth/register', { ...base, captcha: await captcha(b) });
    expect(no.status).toBe(400);
    expect(no.body.error).toBe('terms_required');
    expect(no.body.message).toMatch(/Nutzungsbedingungen.*18 Jahre/);
    const before = mailsOf(env).length;
    expect((await b.post('/api/auth/register', { ...base, terms: true, captcha: await captcha(b) })).status).toBe(200);
    const row = env.srv.db.prepare('SELECT terms_accepted_at, privacy_accepted_at FROM accounts WHERE email = ?').get('nora@example.org') as {
      terms_accepted_at: string;
      privacy_accepted_at: string;
    };
    expect(Date.parse(row.terms_accepted_at)).toBeGreaterThan(Date.now() - 60_000);
    expect(row.privacy_accepted_at).toBeTruthy();
    // Fuß der Mails: Impressum/Datenschutz/Nutzungsbedingungen
    const m = await waitMail(env, 'nora@example.org', /bestätigen/, before);
    expect(m.text).toContain('Nutzungsbedingungen: https://stachel.example.test/nutzungsbedingungen');
  });

  it('Mail-Fuß im HTML verlinkt die Nutzungsbedingungen nur, wenn gesetzt', () => {
    const ctx = { brand: 'Stachel', publicUrl: 'https://stachel.example', imprintUrl: '', privacyUrl: '' };
    expect(mails.verify({ ...ctx, termsUrl: 'https://x.example/agb' }, 'a@example.org', 'A', 'https://stachel.example/verify/t').html).toContain('>Nutzungsbedingungen</a>');
    expect(mails.verify(ctx, 'a@example.org', 'A', 'https://stachel.example/verify/t').html).not.toContain('Nutzungsbedingungen');
  });

  it('Startwarnung nur im Modus local ohne STACHEL_TERMS_URL', () => {
    expect(legalStartupWarnings({ ...loadInstance({ STACHEL_AUTH: 'local' }) })[0]).toMatch(/STACHEL_TERMS_URL/);
    expect(legalStartupWarnings(loadInstance({ STACHEL_AUTH: 'local', STACHEL_TERMS_URL: 'https://x.example/agb' }))).toEqual([]);
    expect(legalStartupWarnings(loadInstance({ STACHEL_AUTH: 'org' }))).toEqual([]);
    expect(loadInstance({ STACHEL_TERMS_URL: 'javascript:alert(1)' }).termsUrl).toBe('');
  });
});

describe('CR-8 Meine Daten herunterladen', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startEnv({ instance: LOCAL });
  });
  afterAll(async () => {
    await env?.stop();
  });

  const download = (b: Browser, headers: Record<string, string> = {}) =>
    fetch(`${env.base}/api/account/export`, { headers: { ...(b.cookies.size ? { cookie: b.cookieHeader() } : {}), ...headers } });

  it('ZIP mit konto.json, eigenen Boards als JSON samt Dateien; fremde Boards nur als Mitgliedschaft', async () => {
    const mara = await signUp(env, 'Mara Lindner', 'mara@example.org');
    const jonas = await signUp(env, 'Jonas Keller', 'jonas@example.org');
    const own = (await mara.post('/api/boards', { title: 'Festival: Lageplan' })).body.board;
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(PNG_1x1)], { type: 'image/png' }), 'karte.png');
    const img = (await mara.req('POST', `/api/boards/${own.id}/images`, { body: fd })).body.image;
    expect(img.id).toBeTruthy();
    // Inhalt live im geöffneten Board (noch nicht gespeichert)
    const conn = await env.srv.hocuspocus.openDirectConnection(`board:${own.id}`, { user: { key: 'u:x', name: 'Test', isOrga: false } });
    await conn.transact((doc) => {
      const o = new Y.Map<unknown>();
      o.set('type', 'sticky');
      o.set('x', 10);
      o.set('y', 20);
      o.set('w', 350);
      o.set('h', 199);
      o.set('color', 'yellow');
      o.set('z', 'a0');
      doc.getMap('objects').set('n1', o);
    });
    const foreign = (await jonas.post('/api/boards', { title: 'Jonas privat' })).body.board;
    expect((await jonas.post(`/api/boards/${foreign.id}/share`, { emails: ['mara@example.org'], role: 'comment' })).status).toBeLessThan(300);

    const res = await download(mara);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/zip');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="stachel-daten-\d{4}-\d{2}-\d{2}\.zip"/);
    const z = unzip(Buffer.from(await res.arrayBuffer()));
    expect(z.get('LIESMICH.txt')!.toString()).toContain('Art. 20 DSGVO');
    const konto = JSON.parse(z.get('konto.json')!.toString());
    expect(konto.konto).toMatchObject({ name: 'Mara Lindner', email: 'mara@example.org' });
    expect(konto.konto.nutzungsbedingungenAkzeptiertAm).toBeTruthy();
    expect(konto.eigeneBoards).toHaveLength(1);
    expect(konto.mitgliedschaften).toEqual([expect.objectContaining({ boardId: foreign.id, titel: 'Jonas privat', rolle: 'comment' })]);
    expect(JSON.stringify(konto)).not.toMatch(/password|passwort_hash|scrypt/i);
    const dir = `boards/${boardFolder(own.title, own.id)}`;
    const board = JSON.parse(z.get(`${dir}/board.json`)!.toString());
    expect(board.board).toMatchObject({ id: own.id, titel: 'Festival: Lageplan' });
    expect(board.objects).toEqual([expect.objectContaining({ id: 'n1', type: 'sticky', x: 10, y: 20 })]);
    expect(board.dateien).toEqual([expect.objectContaining({ id: img.id, typ: 'image/png' })]);
    expect(z.get(`${dir}/dateien/${img.id}.png`)?.length).toBeGreaterThan(0);
    // Boards anderer nicht als Inhalt
    expect([...z.keys()].some((k) => k.includes(foreign.id))).toBe(false);
    await conn.disconnect();
  });

  it('ohne Anmeldung 401, mit App-Sitzung (sts_) erlaubt, mit KI-Token nicht; höchstens 3 je Stunde', async () => {
    expect((await fetch(`${env.base}/api/account/export`)).status).toBe(401);
    const b = await signUp(env, 'Pia Export', 'pia@example.org');
    const app = await new Browser(env.base).post('/api/auth/app-session', { email: 'pia@example.org', password: PW });
    expect(app.status).toBe(200);
    const tok = await b.post('/api/tokens', { label: 'Test' });
    expect((await fetch(`${env.base}/api/account/export`, { headers: { authorization: `Bearer ${tok.body.secret}` } })).status).toBe(401);
    expect((await fetch(`${env.base}/api/account/export`, { headers: { authorization: `Bearer ${app.body.token}` } })).status).toBe(200);
    expect((await download(b)).status).toBe(200);
    expect((await download(b)).status).toBe(200);
    const fourth = await download(b);
    expect(fourth.status).toBe(429);
    expect(((await fourth.json()) as { error: string }).error).toBe('rate_limited');
  });
});

describe('CR-9 KI-Tokens verfallen nach 12 Monaten ohne Nutzung', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startEnv();
  });
  afterAll(async () => {
    await env?.stop();
  });

  it('Liste zeigt expiresAt; unbenutzt seit über 12 Monaten → ungültig und aufgeräumt', async () => {
    const b = await loginAdmin(env);
    const created = await b.post('/api/tokens', { label: 'Alt' });
    const list = (await b.get('/api/tokens')).body.tokens;
    const t = list.find((x: { id: string }) => x.id === created.body.token.id);
    expect(Date.parse(t.expiresAt) - Date.parse(t.createdAt)).toBe(365 * DAY);
    const auth = { authorization: `Bearer ${created.body.secret}` };
    expect((await new Browser(env.base).get('/api/boards', { headers: auth })).status).toBe(200);
    // 13 Monate zurückdatieren
    const old = new Date(Date.now() - 396 * DAY).toISOString();
    env.srv.db.prepare('UPDATE api_tokens SET created_at = ?, last_used_at = ? WHERE id = ?').run(old, old, t.id);
    expect((await new Browser(env.base).get('/api/boards', { headers: auth })).status).toBe(401);
    const r = applyRetention(env.srv.db, 'org');
    expect(r.tokens).toBe(1);
    expect((await b.get('/api/tokens')).body.tokens.some((x: { id: string }) => x.id === t.id)).toBe(false);
  });
});

describe('CR-10 Löschfristen', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startEnv();
  });
  afterAll(async () => {
    await env?.stop();
  });

  it('Modus org: Personen 2 Jahre nach der letzten Anmeldung weg (samt Favoriten/Besuchen), aktive bleiben', () => {
    const db = env.srv.db;
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const add = (key: string, lastSeen: number) => db.prepare('INSERT OR REPLACE INTO users (key, name, first_seen, last_seen) VALUES (?, ?, ?, ?)').run(key, key, iso(lastSeen), iso(lastSeen));
    add('a:alt', now - (USER_RETENTION_DAYS + 1) * DAY);
    add('a:knapp', now - (USER_RETENTION_DAYS - 1) * DAY);
    add('a:sitzung', now - (USER_RETENTION_DAYS + 5) * DAY);
    db.prepare('INSERT INTO sessions (id, user_key, name, is_orga, org_token, created_at, verified_at, expires_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?)').run(
      'sid-test',
      'a:sitzung',
      'Sitzung',
      'x',
      iso(now),
      iso(now),
      iso(now + DAY),
    );
    db.prepare('INSERT INTO board_favorites (user_key, board_id, created_at) VALUES (?, ?, ?)').run('a:alt', 'b1', iso(now));
    db.prepare('INSERT INTO board_visits (user_key, board_id, opened_at) VALUES (?, ?, ?)').run('a:alt', 'b1', iso(now));
    const r = applyRetention(db, 'org', now);
    expect(r.users).toBe(1);
    const keys = (db.prepare('SELECT key FROM users').all() as { key: string }[]).map((x) => x.key);
    expect(keys).not.toContain('a:alt');
    expect(keys).toContain('a:knapp');
    expect(keys).toContain('a:sitzung');
    expect(db.prepare("SELECT 1 FROM board_favorites WHERE user_key = 'a:alt'").get()).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM board_visits WHERE user_key = 'a:alt'").get()).toBeUndefined();
    // Modus local: users hängt am Konto, bleibt
    add('u:konto', now - (USER_RETENTION_DAYS + 10) * DAY);
    expect(applyRetention(db, 'local', now).users).toBe(0);
    expect(db.prepare("SELECT 1 FROM users WHERE key = 'u:konto'").get()).toBeTruthy();
  });
});

describe('CR-10 offene Einladungen verfallen nach 90 Tagen (Modus local)', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startEnv({ instance: LOCAL });
  });
  afterAll(async () => {
    await env?.stop();
  });

  it('alte Einladung weg, frische bleibt', async () => {
    const owner = await signUp(env, 'Eva Einlader', 'eva@example.org');
    const board = (await owner.post('/api/boards', { title: 'Einladungen' })).body.board;
    expect((await owner.post(`/api/boards/${board.id}/share`, { emails: ['alt@example.org'], role: 'view' })).status).toBeLessThan(300);
    expect((await owner.post(`/api/boards/${board.id}/share`, { emails: ['neu@example.org'], role: 'view' })).status).toBeLessThan(300);
    const db = env.srv.db;
    db.prepare("UPDATE board_invites SET created_at = ? WHERE email = 'alt@example.org'").run(new Date(Date.now() - (INVITE_RETENTION_DAYS + 1) * DAY).toISOString());
    expect(applyRetention(db, 'local').invites).toBe(1);
    const left = (db.prepare('SELECT email FROM board_invites WHERE board_id = ?').all(board.id) as { email: string }[]).map((x) => x.email);
    expect(left).toEqual(['neu@example.org']);
  });
});

describe('Löschfrist erledigter Meldungen (1 Jahr nach der Entscheidung)', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startEnv({ instance: LOCAL });
  });
  afterAll(async () => {
    await env?.stop();
  });

  it('alte erledigte Meldung weg, offene und frisch erledigte bleiben', () => {
    const db = env.srv.db;
    const old = new Date(Date.now() - (REPORT_RETENTION_DAYS + 1) * DAY).toISOString();
    const ins = db.prepare(
      "INSERT INTO reports (id, created_at, status, reporter_key, reporter_name, board_id, board_title, reason, text, evidence, decided_at) VALUES (?, ?, ?, 'u:r', 'R', 'b1', 'B', 'other', 't', '{}', ?)",
    );
    ins.run('R-OLDCLOSE', old, 'closed', old);
    ins.run('R-OLDOPEN1', old, 'open', null);
    ins.run('R-NEWCLOSE', old, 'closed', new Date().toISOString());
    expect(applyRetention(db, 'local').reports).toBe(1);
    const left = (db.prepare('SELECT id FROM reports ORDER BY id').all() as { id: string }[]).map((r) => r.id);
    expect(left).toEqual(['R-NEWCLOSE', 'R-OLDOPEN1']);
  });
});
