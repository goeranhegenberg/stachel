// Datenschutz-Lücken L1–L7 aus docs/store/data_safety.md §7: Log ohne E-Mail-Adressen, Konto löschen (API-Tokens weg,
// Name auf fremden Boards → „Gelöschtes Konto“), „Meine Daten bei Stachel löschen“ im Modus org, Org-Tokens
// verschlüsselt in SQLite, Bilder ohne EXIF/GPS, Seite /konto-loeschen.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import sharp from 'sharp';
import * as Y from 'yjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redactText, redactUrl } from '../src/app.js';
import { logIp } from '../src/rate-limit.js';
import { TokenCrypt } from '../src/token-crypt.js';
import { anonymizeDoc, DELETED_NAME } from '../src/forget-person.js';
import { cleanImage, cleanStoredImages, stripGif } from '../src/image-clean.js';
import { sniffImage } from '../src/images.js';
import { SessionStore } from '../src/sessions.js';
import { unpackState } from '../src/versions.js';
import { Browser, loginMember, startEnv, waitFor, type TestEnv } from './helpers.js';
import { captcha, linkParam, LOCAL, mailsOf, PW, signUp, waitMail } from './local-helpers.js';

const KEY = crypto.randomBytes(32).toString('base64');
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('L1: Log ohne E-Mail-Adressen', () => {
  it('redactUrl schwärzt Adressen in Query und Pfad, Tokens wie bisher', () => {
    expect(redactUrl('/?b=abc&register=1&email=mara%40example.org')).toBe('/?b=abc&register=1&email=***');
    expect(redactUrl('/app/?login=1&forgot=1&email=a.b%2Bc%40x.de')).toBe('/app/?login=1&forgot=1&email=***');
    expect(redactUrl('/api/boards/b1/invites/mara%40example.org')).toBe('/api/boards/b1/invites/***');
    expect(redactUrl('/api/boards/b1/invites/mara@example.org?x=1')).toBe('/api/boards/b1/invites/***?x=1');
    expect(redactUrl('/irgendwas?wer=jo@x.de&b=1')).toBe('/irgendwas?wer=***&b=1');
    expect(redactUrl('/app/verify/abcdefghijklmnopqrstuvwxyz')).toBe('/app/verify/***');
    expect(redactUrl('/verify/abcdefghijklmnopqrstuvwxyz')).toBe('/verify/***');
    expect(redactUrl('/api/boards/b1')).toBe('/api/boards/b1');
    expect(redactUrl('/b/b1?o=x')).toBe('/b/b1?o=x');
  });

  it('redactText kürzt Adressen in Meldungen (z. B. SMTP-Antworten)', () => {
    expect(redactText('550 5.1.1 <mara.muster@example.org>: Recipient rejected')).toBe('550 5.1.1 <m***@example.org>: Recipient rejected');
    expect(redactText('E-Mail an k***@x.de nicht gesendet')).toBe('E-Mail an k***@x.de nicht gesendet');
    expect(redactText('keine Adresse hier')).toBe('keine Adresse hier');
  });
});

describe('L6: Org-Tokens verschlüsselt (TokenCrypt)', () => {
  it('seal/open, fremder Schlüssel, Klartext von früher, ungültige Schlüssel', () => {
    const c = TokenCrypt.fromKey(KEY);
    const sealed = c.seal('org-geheim');
    expect(sealed.startsWith('enc1:')).toBe(true);
    expect(sealed).not.toContain('org-geheim');
    expect(c.seal('x')).not.toBe(c.seal('x')); // zufälliger IV
    expect(c.open(sealed)).toBe('org-geheim');
    expect(c.open('alt-klartext')).toBe('alt-klartext');
    expect(TokenCrypt.fromKey(crypto.randomBytes(32).toString('hex')).open(sealed)).toBe('');
    expect(TokenCrypt.plain.open(sealed)).toBe('');
    expect(TokenCrypt.plain.seal('a')).toBe('a');
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
    expect(c.open(tampered)).toBe('');
    expect(() => TokenCrypt.fromKey('zu-kurz')).toThrow(/32 Byte/);
    expect(TokenCrypt.fromKey(crypto.randomBytes(32).toString('base64url')).enabled).toBe(true);
  });

  describe('im Server', () => {
    let env: TestEnv;
    beforeAll(async () => {
      env = await startEnv({ tokenKey: KEY });
    });
    afterAll(async () => {
      await env.stop();
    });

    it('Sitzung, API-Token und QR-Kopplung speichern das Org-Token nur verschlüsselt; Nachprüfung klappt', async () => {
      const token = env.fake.addMember(41, 'Nora Nachtigall');
      const b = await loginMember(env, token);
      const rows = env.srv.db.prepare('SELECT org_token AS t FROM sessions').all() as { t: string }[];
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.t.startsWith('enc1:')).toBe(true);
        expect(r.t).not.toContain(token);
      }
      const p = env.srv.db.prepare("SELECT org_token AS t FROM pairings WHERE org_token IS NOT NULL").all() as { t: string }[];
      for (const r of p) expect(r.t.startsWith('enc1:')).toBe(true);
      // Nachprüfung nach 6 h nutzt das entschlüsselte Token
      env.srv.sessions.setVerifiedAt(b.cookies.get('stachel_session')!, '2020-01-01T00:00:00.000Z');
      expect((await b.get('/api/auth/me')).status).toBe(200);
      const created = (await b.post('/api/tokens', { label: 'KI' })).body;
      const t = env.srv.db.prepare('SELECT org_token AS t FROM api_tokens').get() as { t: string };
      expect(t.t.startsWith('enc1:')).toBe(true);
      expect(t.t).not.toContain(token);
      expect((await new Browser(env.base).get('/api/tokens/me', { headers: bearer(created.secret) })).status).toBe(200);
    });

    it('Klartext-Zeilen von früher werden beim Start verschlüsselt und bleiben gültig', async () => {
      const db = env.srv.db;
      const plain = new SessionStore(db, env.srv.sessions as never);
      const { cookie } = plain.create({ userKey: 'm:42', name: 'Alt', isOrga: false }, 'altes-token');
      expect((db.prepare('SELECT org_token AS t FROM sessions WHERE user_key = ?').get('m:42') as { t: string }).t).toBe('altes-token');
      const c = TokenCrypt.fromKey(KEY);
      expect(c.migrate(db)).toBeGreaterThanOrEqual(1);
      const t = (db.prepare('SELECT org_token AS t FROM sessions WHERE user_key = ?').get('m:42') as { t: string }).t;
      expect(t.startsWith('enc1:')).toBe(true);
      expect(env.srv.sessions.get(cookie)!.orgToken).toBe('altes-token');
      expect(c.migrate(db)).toBe(0);
    });
  });
});

/** Beiträge der Person auf einem Board wie aus dem Web (Kommentar, Reaktion, Stimme, Abstimmung, Timer, „zuständig“). */
async function contribute(env: TestEnv, boardId: string, who: { key: string; name: string }, browser: Browser) {
  const conn = await env.srv.hocuspocus.openDirectConnection(`board:${boardId}`, { user: who });
  await conn.transact((doc) => {
    const t = new Y.Map<unknown>();
    const msgs = new Y.Array<unknown>();
    msgs.push([
      { id: 'm1', by: 'u:andere', name: 'Andere', text: 'erste', at: '2026-11-01T10:00:00.000Z' },
      { id: 'm2', by: who.key, name: who.name, text: 'meine Antwort', at: '2026-11-01T10:01:00.000Z' },
      { id: 'm3', by: `ai:${who.key}`, name: `KI (für ${who.name})`, text: 'vom Assistenten', at: '2026-11-01T10:02:00.000Z' },
    ]);
    t.set('x', 1);
    t.set('y', 2);
    t.set('resolved', false);
    t.set('createdBy', who.key);
    t.set('createdAt', '2026-11-01T10:00:00.000Z');
    t.set('messages', msgs);
    doc.getMap('collab.comments').set('t1', t);
    doc.getMap('collab.reactions').set(`o1|👍|${who.key}`, { o: 'o1', e: '👍', u: who.key, n: who.name, at: 1 });
    doc.getMap('collab.reactions').set('o1|👍|u:andere', { o: 'o1', e: '👍', u: 'u:andere', n: 'Andere', at: 1 });
    doc.getMap('collab.vote').set('session', { id: 's1', title: 'Wohin?', startedBy: who.key, startedByName: who.name, startedAt: 1, ended: false });
    doc.getMap('collab.votes').set(`s1|${who.key}|o1`, { n: 2, name: who.name });
    doc.getMap('collab.timer').set('timer', { state: 'running', endsAt: 5, remaining: 0, duration: 5, by: who.name, run: 1 });
    doc.getMap('structure.people').set(who.key, who.name);
    doc.getMap('structure.people').set('u:andere', 'Andere');
  });
  await conn.disconnect();
  // Version mit dem Namen sichern (gesicherter Stand, „geändert von“, „gespeichert von“)
  const v = await browser.post(`/api/boards/${boardId}/versions`, { name: 'Stand mit Namen' });
  expect(v.status).toBe(201);
  expect(v.body.version.by.name).toBe(who.name);
}

function readBoard(env: TestEnv, boardId: string) {
  const row = env.srv.db.prepare('SELECT state FROM documents WHERE name = ?').get(`board:${boardId}`) as { state: Uint8Array };
  const doc = new Y.Doc();
  Y.applyUpdate(doc, row.state);
  return { doc, raw: Buffer.from(row.state) };
}

function expectAnonymized(env: TestEnv, boardId: string, who: { key: string; name: string }) {
  const { doc, raw } = readBoard(env, boardId);
  const msgs = (doc.getMap('collab.comments').get('t1') as Y.Map<unknown>).get('messages') as Y.Array<{ by: string; name: string; text: string }>;
  expect(msgs.toArray().map((m) => [m.name, m.text])).toEqual([
    ['Andere', 'erste'],
    [DELETED_NAME, 'meine Antwort'],
    [`KI (für ${DELETED_NAME})`, 'vom Assistenten'],
  ]);
  expect((doc.getMap('collab.reactions').get(`o1|👍|${who.key}`) as { n: string }).n).toBe(DELETED_NAME);
  expect((doc.getMap('collab.reactions').get('o1|👍|u:andere') as { n: string }).n).toBe('Andere');
  expect((doc.getMap('collab.vote').get('session') as { startedByName: string }).startedByName).toBe(DELETED_NAME);
  expect((doc.getMap('collab.votes').get(`s1|${who.key}|o1`) as { name: string }).name).toBe(DELETED_NAME);
  expect((doc.getMap('collab.timer').get('timer') as { by: string }).by).toBe(DELETED_NAME);
  expect(doc.getMap('structure.people').get(who.key)).toBe(DELETED_NAME);
  // gespeicherter Stand enthält den Namen nicht mehr (auch nicht als gelöschter Eintrag)
  expect(raw.includes(who.name)).toBe(false);
  // gesicherte Versionen auch nicht
  const versions = env.srv.db.prepare('SELECT people, by_name, state FROM board_versions WHERE board_id = ?').all(boardId) as {
    people: string;
    by_name: string | null;
    state: Uint8Array;
  }[];
  expect(versions.length).toBeGreaterThan(0);
  for (const v of versions) {
    expect(v.people).not.toContain(who.name);
    expect(v.by_name ?? '').not.toContain(who.name);
    expect(Buffer.from(unpackState(v.state)).includes(who.name)).toBe(false);
  }
}

describe('anonymizeDoc', () => {
  it('ändert nur die Person (und ihren KI-Assistenten), zweiter Lauf ändert nichts', () => {
    const doc = new Y.Doc();
    const msgs = new Y.Array<unknown>();
    const t = new Y.Map<unknown>();
    doc.getMap('collab.comments').set('t', t);
    t.set('messages', msgs);
    msgs.push([{ id: 'a', by: 'u:x', name: 'X', text: '1' }, { id: 'b', by: 'u:y', name: 'Y', text: '2' }]);
    doc.getMap('structure.people').set('u:y', 'Y');
    expect(anonymizeDoc(doc, { key: 'u:x', name: 'X' })).toBe(1);
    expect(msgs.toArray()).toEqual([{ id: 'a', by: 'u:x', name: DELETED_NAME, text: '1' }, { id: 'b', by: 'u:y', name: 'Y', text: '2' }]);
    expect(anonymizeDoc(doc, { key: 'u:x', name: 'X' })).toBe(0);
    expect(doc.getMap('structure.people').get('u:y')).toBe('Y');
  });
});

describe('L3: Konto löschen (Modus local)', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startEnv({ instance: LOCAL });
  });
  afterAll(async () => {
    await env.stop();
  });

  it('löscht persönliche API-Tokens und ersetzt den Namen auf fremden Boards (live, gespeichert, Versionen, Posteingang)', async () => {
    const olga = await signUp(env, 'Olga Owner', 'olga@example.org');
    const zora = await signUp(env, 'Zora Zaunkönig', 'zora@example.org');
    const zKey = (await zora.get('/api/auth/me')).body.user.key as string;
    const board = (await olga.post('/api/boards', { title: 'Olgas Board' })).body.board.id as string;
    await olga.post(`/api/boards/${board}/share`, { emails: ['zora@example.org'], role: 'edit' });
    const who = { key: zKey, name: 'Zora Zaunkönig' };
    await contribute(env, board, who, zora);
    env.srv.db
      .prepare(`INSERT INTO mentions (id, user_key, type, board_id, by_key, by_name, text, at, seen_at) VALUES (?, ?, 'mention', ?, ?, ?, 'hi', ?, ?)`)
      .run('m-x', 'u:olga', board, zKey, who.name, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
    const secret = (await zora.post('/api/tokens', { label: 'Mein Bot' })).body.secret as string;
    expect((await new Browser(env.base).get('/api/tokens/me', { headers: bearer(secret) })).status).toBe(200);
    // eigene Blockliste und eine eigene Meldung (Beleg bleibt, Mail-Adresse geht)
    expect((await zora.req('PUT', `/api/blocks/${encodeURIComponent('u:jemand')}`)).status).toBeLessThan(300);
    env.srv.db
      .prepare(
        "INSERT INTO reports (id, created_at, status, reporter_key, reporter_name, reporter_email, board_id, board_title, reason, text, evidence) VALUES ('R-ZORA0001', ?, 'open', ?, ?, 'zora@example.org', ?, 'B', 'other', 't', '{}')",
      )
      .run(new Date().toISOString(), zKey, who.name, board);

    const r = await zora.post('/api/account/delete', { password: PW, boards: {} });
    expect(r.status).toBe(200);
    expect((await new Browser(env.base).get('/api/tokens/me', { headers: bearer(secret) })).status).toBe(401);
    expect(env.srv.db.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE user_key = ?').get(zKey)).toEqual({ n: 0 });
    expect((env.srv.db.prepare("SELECT by_name FROM mentions WHERE id = 'm-x'").get() as { by_name: string }).by_name).toBe(DELETED_NAME);
    expect(env.srv.db.prepare('SELECT COUNT(*) AS n FROM user_blocks WHERE user_key = ?').get(zKey)).toEqual({ n: 0 });
    expect(env.srv.db.prepare("SELECT reporter_email FROM reports WHERE id = 'R-ZORA0001'").get()).toEqual({ reporter_email: null });
    await waitFor(() => !env.srv.hocuspocus.documents.has(`board:${board}`), 5000).catch(() => {});
    expectAnonymized(env, board, who);
    // Olga sieht das Board unverändert weiter
    expect((await olga.get('/api/boards')).body.boards.some((b: { id: string }) => b.id === board)).toBe(true);
  });

  it('SEC-05: Passwort zurücksetzen und Passwort ändern löschen die persönlichen API-Tokens', async () => {
    const kim = await signUp(env, 'Kim', 'kim@example.org');
    const s1 = (await kim.post('/api/tokens', { label: 'a' })).body.secret as string;
    const anon = new Browser(env.base);
    const before = mailsOf(env).length;
    expect((await anon.post('/api/auth/forgot', { email: 'kim@example.org', captcha: await captcha(anon) })).status).toBe(200);
    const m = await waitMail(env, 'kim@example.org', /Passwort/, before);
    const NEW = 'Kaktusblüte-Dreiundzwanzig';
    expect((await anon.post('/api/auth/reset', { token: linkParam(m, 'reset'), password: NEW })).status).toBe(200);
    expect((await anon.get('/api/tokens/me', { headers: bearer(s1) })).status).toBe(401);

    const kim2 = new Browser(env.base);
    expect((await kim2.post('/api/auth/login', { email: 'kim@example.org', password: NEW })).status).toBe(200);
    const s2 = (await kim2.post('/api/tokens', { label: 'b' })).body.secret as string;
    expect((await anon.get('/api/tokens/me', { headers: bearer(s2) })).status).toBe(200);
    expect((await kim2.post('/api/account/password', { current: NEW, password: 'Nochmal-Ganz-Anders-42' })).status).toBe(200);
    expect((await anon.get('/api/tokens/me', { headers: bearer(s2) })).status).toBe(401);
    expect((await kim2.get('/api/auth/me')).status).toBe(200); // eigene Sitzung bleibt
  });
});

describe('L6: „Meine Daten bei Stachel löschen“ (Modus org)', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startEnv({ tokenKey: KEY });
  });
  afterAll(async () => {
    await env.stop();
  });

  it('löscht Sitzungen, Tokens, Favoriten, Posteingang; Name → „Gelöschtes Konto“; Boards bleiben', async () => {
    const flo = await loginMember(env, env.fake.addMember(7, 'Florentine Zeisig'));
    const jo = await loginMember(env, env.fake.addMember(8, 'Jonas'));
    const fKey = (await flo.get('/api/auth/me')).body.user.key as string;
    const who = { key: fKey, name: 'Florentine Zeisig' };
    const mine = (await flo.post('/api/boards', { title: 'Flos Board' })).body.board.id as string;
    const team = (await jo.post('/api/boards', { title: 'Team' })).body.board.id as string;
    await contribute(env, team, who, flo);
    env.srv.db.prepare('INSERT INTO board_favorites (user_key, board_id, created_at) VALUES (?, ?, ?)').run(fKey, team, '2026-11-01T00:00:00.000Z');
    env.srv.db
      .prepare(`INSERT INTO mentions (id, user_key, type, board_id, by_key, by_name, text, at, seen_at) VALUES ('m-f', ?, 'mention', ?, 'm:8', 'Jonas', 'hi', ?, ?)`)
      .run(fKey, team, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
    const secret = (await flo.post('/api/tokens', { label: 'KI' })).body.secret as string;

    expect((await flo.post('/api/account/delete', {})).status).toBe(400);
    expect((await flo.post('/api/account/delete', { confirm: true }, { csrf: false })).status).toBe(403);
    expect((await new Browser(env.base).post('/api/account/delete', { confirm: true })).status).toBe(401);
    expect((await new Browser(env.base).req('POST', '/api/account/delete', { json: { confirm: true }, headers: bearer(secret) })).status).toBe(401);
    const r = await flo.post('/api/account/delete', { confirm: true });
    expect(r.status).toBe(200);
    expect((await flo.get('/api/auth/me')).status).toBe(401);
    expect((await new Browser(env.base).get('/api/tokens/me', { headers: bearer(secret) })).status).toBe(401);
    for (const t of ['sessions', 'api_tokens', 'board_favorites', 'board_visits', 'mentions']) {
      expect(env.srv.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_key = ?`).get(fKey), t).toEqual({ n: 0 });
    }
    expect(env.srv.db.prepare('SELECT COUNT(*) AS n FROM users WHERE key = ?').get(fKey)).toEqual({ n: 0 });
    // Boards bleiben beim Team, Ersteller-Name anonym
    const boards = (await jo.get('/api/boards')).body.boards as { id: string; createdByName: string }[];
    expect(boards.find((b) => b.id === mine)?.createdByName).toBe(DELETED_NAME);
    expect(boards.some((b) => b.id === team)).toBe(true);
    await waitFor(() => !env.srv.hocuspocus.documents.has(`board:${team}`), 5000).catch(() => {});
    expectAnonymized(env, team, who);
  });

  it('App-Sitzung (sts_) darf löschen, nicht aber ein API-Token', async () => {
    const token = env.fake.addMember(9, 'Paula');
    const res = await new Browser(env.base).req('POST', '/api/auth/app-session', { headers: bearer(token), csrf: false });
    expect(res.status).toBe(200);
    const sts = res.body.token as string;
    const del = await new Browser(env.base).req('POST', '/api/account/delete', { json: { confirm: true }, headers: bearer(sts) });
    expect(del.status).toBe(200);
    expect((await new Browser(env.base).get('/api/auth/me', { headers: bearer(sts) })).status).toBe(401);
  });
});

// ---------- L5: Bilder ----------

const GPS_EXIF = {
  IFD0: { Artist: 'Geheimer Fotograf', Copyright: 'Privat' },
  IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 20/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '12/1 22/1 0/1' },
};

async function photo(fmt: 'jpeg' | 'png' | 'webp', orientation?: number): Promise<Buffer> {
  // 40×20 (quer), links rot, rechts blau
  const raw = Buffer.alloc(40 * 20 * 3);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 40; x++) raw.set(x < 20 ? [255, 0, 0] : [0, 0, 255], (y * 40 + x) * 3);
  let img = sharp(raw, { raw: { width: 40, height: 20, channels: 3 } }).withExif(GPS_EXIF as never);
  if (orientation) img = img.withMetadata({ orientation });
  return img[fmt]().toBuffer();
}

function pngWithText(base: Buffer): Buffer {
  const td = Buffer.concat([Buffer.from('tEXt', 'latin1'), Buffer.from('Comment\0Geheimer Ort 51.3N', 'latin1')]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(td.length - 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  const iend = base.length - 12;
  return Buffer.concat([base.subarray(0, iend), len, td, crc, base.subarray(iend)]);
}

const hasSecret = (b: Buffer) => b.includes('Geheimer') || b.includes('Exif\0\0');

describe('L5: Bilder ohne Metadaten', () => {
  it('JPEG/PNG/WebP: EXIF/GPS weg, verlustfrei ohne Drehung (Bilddaten byte-gleich)', async () => {
    for (const fmt of ['jpeg', 'png', 'webp'] as const) {
      const src = await photo(fmt);
      const meta = await sharp(src).metadata();
      expect(meta.exif, fmt).toBeDefined();
      const out = await cleanImage(src, sniffImage(src)!);
      expect(hasSecret(out.buf), fmt).toBe(false);
      const m2 = await sharp(out.buf).metadata();
      expect(m2.exif, fmt).toBeUndefined();
      expect([out.info.width, out.info.height], fmt).toEqual([40, 20]);
      // Pixel unverändert
      const a = await sharp(src).raw().toBuffer();
      const b = await sharp(out.buf).raw().toBuffer();
      expect(b.equals(a), fmt).toBe(true);
    }
    const png = pngWithText(await photo('png'));
    expect(png.includes('Geheimer Ort')).toBe(true);
    const cleaned = await cleanImage(png, sniffImage(png)!);
    expect(cleaned.buf.includes('Geheimer Ort')).toBe(false);
  });

  it('EXIF-Drehung wird eingerechnet (Hochformat bleibt Hochformat), danach ohne Orientation', async () => {
    const src = await photo('jpeg', 6); // 90° im Uhrzeigersinn anzeigen → 20×40
    expect((await sharp(src).metadata()).orientation).toBe(6);
    const out = await cleanImage(src, sniffImage(src)!);
    const meta = await sharp(out.buf).metadata();
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
    expect([out.info.width, out.info.height]).toEqual([20, 40]);
    // oben rot, unten blau (Rot war links)
    const { data } = await sharp(out.buf).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => [...data.subarray((y * 20 + x) * 3, (y * 20 + x) * 3 + 3)];
    expect(px(10, 2)[0]).toBeGreaterThan(200);
    expect(px(10, 37)[2]).toBeGreaterThan(200);
    expect(hasSecret(out.buf)).toBe(false);
  });

  it('GIF: Kommentar-Block weg, Bild bleibt', () => {
    const gif = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
    const comment = Buffer.concat([Buffer.from([0x21, 0xfe, 12]), Buffer.from('Geheimer Ort', 'latin1'), Buffer.from([0])]);
    const withComment = Buffer.concat([gif.subarray(0, 19), comment, gif.subarray(19)]);
    const out = stripGif(withComment);
    expect(out.includes('Geheimer')).toBe(false);
    expect(out.equals(gif)).toBe(true);
  });

  describe('Upload und Bestand', () => {
    let env: TestEnv;
    beforeAll(async () => {
      env = await startEnv();
    });
    afterAll(async () => {
      await env.stop();
    });

    it('hochgeladenes Original und Variante ohne EXIF/GPS, Maße nach Drehung', async () => {
      const b = await loginMember(env, env.fake.addMember(3, 'Bilder'));
      const board = (await b.post('/api/boards', { title: 'Fotos' })).body.board.id;
      const fd = new FormData();
      const big = await sharp({ create: { width: 1600, height: 800, channels: 3, background: '#c9e14a' } })
        .withExif(GPS_EXIF as never)
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer();
      fd.append('file', new Blob([new Uint8Array(big)]), 'foto.jpg');
      const r = await b.req('POST', `/api/boards/${board}/images`, { body: fd });
      expect(r.status).toBe(201);
      expect([r.body.image.width, r.body.image.height]).toEqual([800, 1600]);
      const file = fs.readFileSync(path.join(env.cfg.dataDir, 'images', r.body.image.id));
      expect(hasSecret(file)).toBe(false);
      const served = Buffer.from(await (await fetch(`${env.base}${r.body.image.url}`, { headers: { cookie: b.cookieHeader() } })).arrayBuffer());
      expect(hasSecret(served)).toBe(false);
      const variant = Buffer.from(await (await fetch(`${env.base}${r.body.image.url}?w=256`, { headers: { cookie: b.cookieHeader() } })).arrayBuffer());
      expect(hasSecret(variant)).toBe(false);
      expect((await sharp(variant).metadata()).width).toBe(256);
      expect((await sharp(variant).metadata()).exif).toBeUndefined();
    });

    it('alte Originale werden einmalig bereinigt (Marker-Datei)', async () => {
      await env.srv.imageCleanup;
      const src = await photo('jpeg');
      const id = 'altesbild0000000000001';
      fs.writeFileSync(path.join(env.cfg.dataDir, 'images', id), src);
      env.srv.db
        .prepare('INSERT INTO images (id, board_id, mime, width, height, bytes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, 'x', 'image/jpeg', 40, 20, src.length, 'm:3', '2026-01-01T00:00:00.000Z');
      const marker = path.join(env.cfg.dataDir, 'images-clean-v1.done');
      expect(fs.existsSync(marker)).toBe(true);
      expect(await cleanStoredImages(env.srv.db, env.cfg.dataDir, path.join(env.cfg.dataDir, 'images'), () => {})).toBe(0);
      fs.rmSync(marker);
      expect(await cleanStoredImages(env.srv.db, env.cfg.dataDir, path.join(env.cfg.dataDir, 'images'), () => {})).toBe(1);
      const now = fs.readFileSync(path.join(env.cfg.dataDir, 'images', id));
      expect(hasSecret(now)).toBe(false);
      expect((env.srv.db.prepare('SELECT bytes FROM images WHERE id = ?').get(id) as { bytes: number }).bytes).toBe(now.length);
    });
  });
});

describe('Seite /konto-loeschen (Google Play)', () => {
  it('Modus local: Konto löschen in App und Web, was gelöscht wird', async () => {
    const env = await startEnv({ instance: { ...LOCAL, imprintUrl: 'https://intsode.com/ueber-uns/' } });
    try {
      const r = await fetch(`${env.base}/konto-loeschen`);
      expect(r.status).toBe(200);
      const html = await r.text();
      expect(html).toContain('Konto <em>löschen</em>');
      expect(html).toContain('https://stachel.example.test');
      expect(html).toContain('?konto=1');
      expect(html).toContain('Gelöschtes Konto');
      expect(html).toContain('https://intsode.com/ueber-uns/');
    } finally {
      await env.stop();
    }
  });

  it('Modus org: „Meine Daten bei Stachel löschen“, Konto bei der Organisation bleibt', async () => {
    const env = await startEnv();
    try {
      const html = await (await fetch(`${env.base}/konto-loeschen`)).text();
      expect(html).toContain('Meine Daten bei Stachel löschen');
      expect(html).toContain('Konto bei Organisation');
    } finally {
      await env.stop();
    }
  });
});

describe('Anwendungsprotokoll mit gekürzter IP-Adresse', () => {
  it('IPv4 ohne letztes Oktett, IPv6 nur /48', () => {
    expect(logIp('203.0.113.77')).toBe('203.0.113.0');
    expect(logIp('::ffff:198.51.100.9')).toBe('198.51.100.0');
    expect(logIp('2001:db8:abcd:12:1:2:3:4')).toBe('2001:db8:abcd::/48');
    expect(logIp('2001:db8::1')).toBe('2001:db8:0::/48');
    expect(logIp(undefined)).toBeUndefined();
  });
});
