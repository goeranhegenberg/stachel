// Bilder der Produktseite (web/public/landing/img/*.webp, docs/features/website.md): startet eine eigene Sandbox im Modus
// local MIT STACHEL_BASE_PATH=/app (prüft nebenbei den Pfad-Betrieb), legt Beispiel-Boards an, Jonas und Lena sind per
// Awareness live dabei, und fotografiert die Web-App im Browser (Computer und Handy).
// Vorher bauen: `cd e2e && npm run build` (web/dist + server/dist). Aufruf im Repo-Wurzelordner:
//   server/node_modules/.bin/tsx tools/landing-screenshots.mts [port]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { solveCaptcha } from '../server/src/captcha';
import { webClient } from '../server/test/native-client';
import { fragment, richText, Y } from '../server/test/native-seed';
import { StachelServer } from '../e2e/support/server';
import { ROOT, WEB_DIST } from '../e2e/support/paths';

const require = createRequire(path.join(ROOT, 'e2e/package.json'));
const { chromium } = require('playwright') as typeof import('playwright');
const sharp = createRequire(path.join(ROOT, 'server/package.json'))('sharp') as typeof import('sharp');

const port = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 8471);
const OUT = path.join(ROOT, 'web/public/landing/img');
const RAW = fs.mkdtempSync(path.join(os.tmpdir(), 'stachel-landing-shots-'));
const PW = 'Stachel-Probe-2026';
const BASE_PATH = '/app';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `stachel-landing-${port}-`));
const mailLog = path.join(dataDir, 'mail.log');
const server = new StachelServer(port, dataDir, 'http://127.0.0.1:9', path.join(dataDir, 'server.log'), {
  STACHEL_AUTH: 'local',
  STACHEL_BRAND: 'Stachel',
  STACHEL_MAIL_MODE: 'log',
  STACHEL_CAPTCHA_MAX: '20000',
  STACHEL_BASE_PATH: BASE_PATH,
  STACHEL_LANDING: '1',
  // Beispiel-Kommentare von Jonas schreibt Mara über /sync (sonst lehnt comment-guard.ts fremde Autorschaft ab)
  STACHEL_NATIVE_DEV_ACTIONS: '1',
});
await server.start();
const base = server.url;
const H = { 'Content-Type': 'application/json', 'X-Stachel': '1' };

async function api(method: string, p: string, body?: unknown, cookie?: string) {
  const res = await fetch(base + p, { method, headers: { ...H, ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { res, json: (await res.json().catch(() => ({}))) as any };
}

async function account(name: string, email: string): Promise<{ cookie: string; key: string }> {
  const { json: c } = await api('GET', '/api/auth/captcha');
  const r = await api('POST', '/api/auth/register', { name, email, password: PW, terms: true, captcha: solveCaptcha(c) });
  if (!r.res.ok) throw new Error('register ' + JSON.stringify(r.json));
  let token = '';
  for (let i = 0; i < 100 && !token; i++) {
    const mails = fs.existsSync(mailLog) ? fs.readFileSync(mailLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const m = mails.find((x: { to: string }) => x.to === email);
    // Mail-Link mit Pfad der Web-App: /app/verify/<token>
    if (m) token = new RegExp(`${BASE_PATH}/verify/([A-Za-z0-9_-]+)`).exec(m.text)![1]!;
    else await new Promise((res) => setTimeout(res, 100));
  }
  await api('POST', '/api/auth/verify', { token });
  const login = await api('POST', '/api/auth/login', { email, password: PW });
  const cookie = login.res.headers.getSetCookie().map((s) => s.split(';')[0]!).find((s) => s.startsWith('stachel_session='))!;
  const me = await api('GET', '/api/auth/me', undefined, cookie);
  return { cookie, key: me.json.user.key };
}

const mara = await account('Mara Lindner', 'mara@sandbox.test');
const jonas = await account('Jonas Becker', 'jonas@sandbox.test');
const lena = await account('Lena Hoffmann', 'lena@sandbox.test');

async function board(title: string, fill: (objects: Y.Map<Y.Map<unknown>>, doc: Y.Doc) => void) {
  const { json } = await api('POST', '/api/boards', { title }, mara.cookie);
  const id: string = json.board.id;
  await api('POST', `/api/boards/${id}/share`, { emails: ['jonas@sandbox.test'], role: 'edit' }, mara.cookie);
  await api('POST', `/api/boards/${id}/share`, { emails: ['lena@sandbox.test'], role: 'comment' }, mara.cookie);
  const w = webClient(base.replace(/^http/, 'ws'), id, { cookie: mara.cookie });
  await w.synced();
  w.doc.transact(() => fill(w.objects, w.doc));
  await w.flushed(30_000);
  w.destroy();
  return id;
}
let z = 0;
const put = (objects: Y.Map<Y.Map<unknown>>, id: string, f: Record<string, unknown>) => {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries({ id, createdBy: mara.key, updatedAt: new Date().toISOString(), z: `a${(++z).toString(36).padStart(4, '0')}`, ...f })) {
    m.set(k, k === 'content' ? fragment(v as never) : v);
  }
  objects.set(id, m);
};
type O = Y.Map<Y.Map<unknown>>;
const heading = (s: string) => ({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: s }] }] });
const sticky = (o: O, id: string, x: number, y: number, color: string, text: string) =>
  put(o, id, { type: 'sticky', x, y, w: 240, h: 240, color, text, content: richText(text), fontSize: 30 });
const shape = (o: O, id: string, kind: string, x: number, y: number, w: number, h: number, color: string, text: string, extra: Record<string, unknown> = {}) =>
  put(o, id, { type: 'shape', shape: kind, x, y, w, h, color, stroke: '#0a0a0a', strokeWidth: 2, fontSize: 24, text, content: richText(text), ...extra });
const conn = (o: O, id: string, from: unknown, to: unknown, extra: Record<string, unknown> = {}) =>
  put(o, id, { type: 'connector', x: 0, y: 0, w: 1, h: 1, color: '#0a0a0a', strokeWidth: 2, arrowEnd: true, from, to, ...extra });

// ---- Boards (zuletzt angelegt = oben in der Liste) ----
await board('Retro Oktober', (o) => {
  put(o, 'h', { type: 'text', x: 0, y: 0, w: 600, h: 80, color: '#0a0a0a', fontSize: 56, autoWidth: true, text: 'Retro', content: heading('Retro') });
  sticky(o, 'a', 0, 120, '#c9e14a', 'Lief gut: Aufbau in Rekordzeit');
  sticky(o, 'b', 280, 120, '#ffb3d1', 'Besser: Funkgeräte früher verteilen');
  sticky(o, 'c', 560, 120, '#9fd3ff', 'Idee: Helfer-Frühstück');
});
await board('Sommerfest – Ideen', (o) => {
  put(o, 'h', { type: 'text', x: 0, y: 0, w: 600, h: 80, color: '#0a0a0a', fontSize: 56, autoWidth: true, text: 'Sommerfest', content: heading('Sommerfest') });
  sticky(o, 'a', 0, 120, '#fff27a', 'Kinderprogramm am Nachmittag');
  sticky(o, 'b', 280, 120, '#ffb3d1', 'Kuchenbuffet vom Verein');
  sticky(o, 'c', 0, 400, '#c9e14a', 'Lichterketten für den Abend');
  sticky(o, 'd', 280, 400, '#9fd3ff', 'Flyer bis Mai drucken');
});
await board('Einlass & Kasse', (o) => {
  shape(o, 's1', 'terminator', 0, 0, 260, 90, '#c9e14a', 'Gast kommt an');
  shape(o, 's2', 'diamond', 0, 170, 260, 160, '#fff27a', 'Ticket da?');
  shape(o, 's3', 'rect', 0, 410, 260, 100, '#ffffff', 'Bändchen ausgeben');
  shape(o, 's4', 'rect', 340, 200, 240, 100, '#ffb3d1', 'Abendkasse');
  conn(o, 'c1', { objectId: 's1' }, { objectId: 's2' });
  conn(o, 'c2', { objectId: 's2', side: 's' }, { objectId: 's3', side: 'n' }, { text: 'Ja', content: richText('Ja') });
  conn(o, 'c3', { objectId: 's2', side: 'e' }, { objectId: 's4', side: 'w' }, { text: 'Nein', content: richText('Nein') });
});
const mainId = await board('Stadtfest', (o, doc) => {
  put(o, 'title', { type: 'text', x: 0, y: 0, w: 760, h: 84, color: '#0a0a0a', fontSize: 64, autoWidth: true, text: 'Stadtfest', content: heading('Stadtfest') });
  put(o, 'sub', { type: 'text', x: 2, y: 92, w: 760, h: 36, color: '#6b6b66', fontSize: 24, autoWidth: true, text: 'Stand nach dem Orga-Treffen – bitte ergänzen!', content: richText('Stand nach dem Orga-Treffen – bitte ergänzen!') });
  put(o, 'frame', { type: 'frame', x: 0, y: 190, w: 820, h: 470, color: '#ffffff', title: 'Ablauf' });
  shape(o, 'f1', 'rect', 30, 240, 220, 100, '#ffffff', 'Aufbau Do + Fr');
  shape(o, 'f2', 'diamond', 300, 220, 220, 140, '#c9e14a', 'Strom ok?');
  shape(o, 'f3', 'ellipse', 570, 240, 220, 100, '#ffffff', 'Einlass 14 Uhr');
  shape(o, 'f4', 'rect', 570, 500, 220, 100, '#0a0a0a', 'Bühne & Bar', { textColor: '#ffffff', strokeWidth: 0 });
  shape(o, 'f5', 'rect', 300, 500, 220, 100, '#ffb3d1', 'Generator mieten');
  conn(o, 'k1', { objectId: 'f1', side: 'e' }, { objectId: 'f2', side: 'w' });
  conn(o, 'k2', { objectId: 'f2', side: 'e' }, { objectId: 'f3', side: 'w' }, { text: 'Ja', content: richText('Ja') });
  conn(o, 'k3', { objectId: 'f3', side: 's' }, { objectId: 'f4', side: 'n' });
  conn(o, 'k4', { objectId: 'f2', side: 's' }, { objectId: 'f5', side: 'n' }, { text: 'Nein', content: richText('Nein') });
  sticky(o, 'n1', 900, 190, '#fff27a', 'Bühnenplan bis 15.11. an die Technik');
  sticky(o, 'n2', 1170, 190, '#ffb3d1', 'Bierwagen: zweiten Anbieter anfragen');
  sticky(o, 'n3', 1440, 190, '#c9e14a', 'Awareness-Team Schichtplan');
  sticky(o, 'n4', 900, 450, '#9fd3ff', 'Shuttle vom Bahnhof?');
  sticky(o, 'n5', 1170, 450, '#ffd08a', 'Mehrweg-Becher statt Plastik');
  sticky(o, 'n6', 1440, 450, '#e2d5ff', 'Line-up bis Januar fix');
  // Kommentar von Jonas an „Shuttle vom Bahnhof?“ mit Antwort von Mara, Reaktionen
  const comments = doc.getMap<Y.Map<unknown>>('collab.comments');
  const th = new Y.Map<unknown>();
  const msgs = new Y.Array<unknown>();
  msgs.push([
    { id: 'm1', by: jonas.key, name: 'Jonas Becker', text: '@Mara Lindner Ich frage beim Busunternehmen nach zwei Fahrten am Freitag.', at: new Date(Date.now() - 3600_000).toISOString(), mentions: [mara.key] },
    { id: 'm2', by: mara.key, name: 'Mara Lindner', text: 'Super, danke! Ab 13 Uhr reicht.', at: new Date(Date.now() - 1800_000).toISOString(), mentions: [] },
  ]);
  for (const [k, v] of Object.entries({ id: 't1', x: 1140, y: 690, objectId: 'n4', dx: 240, dy: 240, resolved: false, createdBy: jonas.key, createdAt: new Date(Date.now() - 3600_000).toISOString() })) th.set(k, v);
  th.set('messages', msgs);
  comments.set('t1', th);
  const r = doc.getMap('collab.reactions');
  r.set(`n1|👍|${jonas.key}`, { o: 'n1', e: '👍', u: jonas.key, n: 'Jonas Becker', at: new Date().toISOString() });
  r.set(`n1|👍|${lena.key}`, { o: 'n1', e: '👍', u: lena.key, n: 'Lena Hoffmann', at: new Date().toISOString() });
  r.set(`n3|❤️|${lena.key}`, { o: 'n3', e: '❤️', u: lena.key, n: 'Lena Hoffmann', at: new Date().toISOString() });
});

// Jonas und Lena live im Board: Cursor + Auswahl über Awareness
const live = [] as ReturnType<typeof webClient>[];
for (const [who, color, cursor, sel] of [
  [jonas, '#ec4e92', { x: 1290, y: 640 }, ['n5']],
  [lena, '#1763b5', { x: 420, y: 470 }, ['f2']],
] as const) {
  const w = webClient(base.replace(/^http/, 'ws'), mainId, { cookie: who.cookie });
  await w.synced();
  const aw = w.provider.awareness!;
  aw.setLocalStateField('since', Date.now());
  aw.setLocalStateField('user', { key: who.key, name: who === jonas ? 'Jonas Becker' : 'Lena Hoffmann', color });
  aw.setLocalStateField('cursor', cursor);
  aw.setLocalStateField('selection', [...sel]);
  live.push(w);
}

const app = `${base}${BASE_PATH}/`;
const browser = await chromium.launch();
const [cname, cvalue] = mara.cookie.split('=') as [string, string];

const deskCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: 'de-DE' });
await deskCtx.addCookies([{ name: cname, value: cvalue, url: base }]);
const desk = await deskCtx.newPage();
const shot = (page: typeof desk, n: string) => page.screenshot({ path: path.join(RAW, `${n}.png`) });

// Vorschaubilder für die Liste: jedes Board einmal öffnen
for (const b of (await api('GET', '/api/boards', undefined, mara.cookie)).json.boards as { id: string }[]) {
  await desk.goto(`${app}?b=${b.id}`);
  await desk.waitForTimeout(1500);
  await desk.getByRole('button', { name: 'Alles einpassen' }).click();
  await desk.waitForTimeout(2500);
}

await desk.goto(`${app}?b=${mainId}`);
await desk.waitForTimeout(2500);
await desk.getByRole('button', { name: 'Hinweis schließen' }).click().catch(() => {});
// Übersichtskarte zu: sie verdeckt sonst das Kommentarfenster
await desk.getByRole('button', { name: 'Übersicht ausblenden' }).click().catch(() => {});
await desk.getByRole('button', { name: 'Alles einpassen' }).click();
await desk.waitForTimeout(1500);
await shot(desk, 'board');
await desk.getByRole('button', { name: /Kommentar von Jonas Becker/ }).click();
await desk.waitForTimeout(1200);
await shot(desk, 'kommentare');
await desk.keyboard.press('Escape');
await desk.waitForTimeout(500);
await desk.getByRole('button', { name: 'Teilen', exact: true }).click();
await desk.waitForTimeout(1500);
await shot(desk, 'teilen');
await desk.keyboard.press('Escape');
await desk.waitForTimeout(1500);
await desk.goto(app);
await desk.waitForTimeout(2500);
await shot(desk, 'boards');

// Handy (9:16): dasselbe Board in der Web-App am Handy, Jonas und Lena live dabei
const phoneCtx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'de-DE' });
await phoneCtx.addCookies([{ name: cname, value: cvalue, url: base }]);
const phone = await phoneCtx.newPage();
await phone.goto(`${app}?b=${mainId}`);
await phone.waitForTimeout(2500);
await phone.getByRole('button', { name: 'Hinweis schließen' }).click().catch(() => {});
await phone.getByRole('button', { name: 'Alles einpassen' }).click().catch(() => {});
await phone.waitForTimeout(800);
// eingepasst ist am Handy alles winzig: auf die Mitte (Ablauf rechts, Haftnotizen links) heranzoomen
for (let i = 0; i < 3; i++) {
  await phone.getByRole('button', { name: 'Vergrößern' }).click().catch(() => {});
  await phone.waitForTimeout(250);
}
await phone.waitForTimeout(1500);
await shot(phone, 'handy');

for (const w of live) w.destroy();
await browser.close();
await server.stop();

// WebP in zwei Breiten (srcset) für die Produktseite
fs.mkdirSync(OUT, { recursive: true });
const sizes: Record<string, number[]> = { board: [1600, 960], kommentare: [1200, 720], teilen: [1200, 720], boards: [1200, 720], handy: [600, 360] };
for (const [name, widths] of Object.entries(sizes)) {
  for (const w of widths) {
    const file = path.join(OUT, `${name}-${w}.webp`);
    await sharp(path.join(RAW, `${name}.png`)).resize({ width: w }).webp({ quality: 80, effort: 6 }).toFile(file);
    console.log(path.relative(ROOT, file), Math.round(fs.statSync(file).size / 1024), 'KB');
  }
}
// Ansicht der Produktseite mit den neuen Bildern (docs/screenshots/website-landing-*.png, docs/features/website.md)
fs.cpSync(OUT, path.join(WEB_DIST, 'landing/img'), { recursive: true });
await server.start();
const viewer = await chromium.launch();
for (const [name, viewport, full] of [
  ['desktop', { width: 1440, height: 900 }, true],
  ['handy', { width: 390, height: 844 }, false],
] as const) {
  const ctx = await viewer.newContext({ viewport, locale: 'de-DE', ...(name === 'handy' ? { isMobile: true, hasTouch: true } : {}) });
  const p = await ctx.newPage();
  await p.goto(`${base}/`);
  await p.waitForLoadState('networkidle');
  // Bilder unterhalb der Startansicht laden erst beim Scrollen (loading="lazy")
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
  });
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(ROOT, `docs/screenshots/website-landing-${name}.png`), fullPage: full });
  await ctx.close();
}
await viewer.close();
await server.stop();
console.log('Rohbilder:', RAW);
process.exit(0);
