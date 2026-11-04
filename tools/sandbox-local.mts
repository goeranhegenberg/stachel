// Sandbox im Modus local (eigene Konten, docs/features/accounts.md) für die Stachel-App: `tools/sandbox.mts --local`.
// Echter Server mit STACHEL_AUTH=local, Mails nur ins Mail-Log (DATA_DIR/mail.log), leichtes Captcha. Mit `seed` je ein
// bestätigtes Konto pro Rolle über die echte API (Registrieren mit Captcha → Link aus dem Mail-Log → bestätigen) und ein
// Board der Besitzerin, das mit den anderen in ihrer Rolle geteilt ist.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { solveCaptcha } from '../server/src/captcha';
import { seedAllTypesBoard } from '../server/test/native-sandbox';
import { StachelServer } from '../e2e/support/server';

export const LOCAL_PASSWORD = 'Stachel-Probe-2026';
/** Konten der Sandbox: E-Mail `<rolle>@sandbox.test`, Passwort LOCAL_PASSWORD */
export const LOCAL_PEOPLE = [
  { role: 'owner', name: 'Olga Owner' },
  { role: 'edit', name: 'Edda Edit' },
  { role: 'comment', name: 'Carl Comment' },
  { role: 'view', name: 'Vera View' },
] as const;
/** Captcha-Schwierigkeit der Sandbox (die App rechnet im Mittel die Hälfte durch; Betrieb: 250000) */
const CAPTCHA_MAX = 20_000;

interface Mail {
  to: string;
  subject: string;
  text: string;
}

async function api(base: string, method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-Stachel': '1' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, any>;
  if (!res.ok) throw new Error(`${method} ${p}: HTTP ${res.status} ${json.error ?? ''}`);
  return { json, res };
}

/** Wartet auf eine Mail an `to` im Mail-Log (eine JSON-Zeile je Mail). */
async function waitMail(file: string, to: string, subject: RegExp): Promise<Mail> {
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    if (fs.existsSync(file)) {
      const hit = fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Mail)
        .find((m) => m.to === to && subject.test(m.subject));
      if (hit) return hit;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`keine Mail an ${to}`);
}

export async function runLocalSandbox(opts: { port: number; host: string; seed: boolean; infoFile?: string; env?: Record<string, string> }) {
  const { port, host } = opts;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `stachel-sandbox-local-${port}-`));
  const mailLog = path.join(dataDir, 'mail.log');
  const env: Record<string, string> = {
    STACHEL_AUTH: 'local',
    STACHEL_BRAND: 'Stachel Sandbox',
    STACHEL_MAIL_MODE: 'log',
    STACHEL_CAPTCHA_MAX: String(CAPTCHA_MAX),
    STACHEL_IMPRINT_URL: 'https://example.org/impressum',
    STACHEL_PRIVACY_URL: 'https://example.org/datenschutz',
    STACHEL_NATIVE_DEV_ACTIONS: '1',
    ...(host === '127.0.0.1' ? {} : { HOST: host }),
    // z. B. STACHEL_BASE_PATH=/app (tools/sandbox.mts --base)
    ...opts.env,
  };
  // kein Identitätsdienst nötig (Modus local fragt keinen)
  const server = new StachelServer(port, dataDir, 'http://127.0.0.1:9', path.join(dataDir, 'server.log'), env);
  await server.start();
  const base = server.url;

  const people: { role: string; name: string; email: string; key?: string; token?: string }[] = LOCAL_PEOPLE.map((p) => ({ ...p, email: `${p.role}@sandbox.test` }));
  let board: { id: string; title: string } | null = null;
  if (opts.seed) {
    for (const p of people) {
      const { json: c } = await api(base, 'GET', '/api/auth/captcha');
      await api(base, 'POST', '/api/auth/register', { name: p.name, email: p.email, password: LOCAL_PASSWORD, terms: true, captcha: solveCaptcha(c as never) });
      const mail = await waitMail(mailLog, p.email, /bestätigen/);
      const token = /\/verify\/([A-Za-z0-9_-]+)/.exec(mail.text)?.[1];
      if (!token) throw new Error(`kein Bestätigungslink für ${p.email}`);
      await api(base, 'POST', '/api/auth/verify', { token });
      // App-Sitzung wie die Stachel-App (ohne X-Stachel)
      const s = await fetch(`${base}/api/auth/app-session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: p.email, password: LOCAL_PASSWORD }) });
      const sj = (await s.json()) as { token: string; user: { key: string } };
      p.token = sj.token;
      p.key = sj.user.key;
    }
    // Board der Besitzerin (alle Objekttypen, mit Bildern/PDF), geteilt in der jeweiligen Rolle
    const owner = people[0]!;
    const login = await api(base, 'POST', '/api/auth/login', { email: owner.email, password: LOCAL_PASSWORD });
    const cookie = login.res.headers.getSetCookie().map((c) => c.split(';')[0]!).find((c) => c.startsWith('stachel_session='))!;
    const title = 'Geteiltes Board';
    const { id } = await seedAllTypesBoard(base, cookie, title);
    for (const p of people.slice(1)) await api(base, 'POST', `/api/boards/${id}/share`, { emails: [p.email], role: p.role }, { cookie });
    board = { id, title };
  }

  const info = {
    mode: 'local',
    stachelBase: base,
    nativeUrl: `${base.replace(/^http/, 'ws')}/native/v1`,
    password: LOCAL_PASSWORD,
    captchaMax: CAPTCHA_MAX,
    mailLog,
    people: opts.seed ? people : [],
    board,
    dataDir,
  };
  const infoFile = opts.infoFile ?? path.join(dataDir, 'sandbox.json');
  fs.writeFileSync(infoFile, JSON.stringify(info, null, 2));

  console.log(`Stachel-Sandbox (local): ${base}  (Daten ${dataDir}, Log server.log)`);
  console.log(`Native-API:      ${info.nativeUrl}  (hello mit client "stachel")`);
  console.log(`Mails:           ${mailLog}`);
  console.log('                 eine JSON-Zeile je Mail {at,to,subject,text,...}; Links im Text: /verify/<token>, /reset/<token>');
  console.log(`Captcha:         maxnumber ${CAPTCHA_MAX} (GET /api/auth/captcha)`);
  if (opts.seed) {
    console.log(`Konten (Passwort ${LOCAL_PASSWORD}):`);
    for (const p of people) console.log(`  ${p.role.padEnd(8)} ${p.email.padEnd(22)} ${p.key}  ${p.token}`);
    console.log(`Board:           ${board!.title} = ${board!.id} (owner besitzt es, edit/comment/view in ihrer Rolle geteilt)`);
  } else {
    console.log('Konten:          keine (mit --seed je eines pro Rolle: owner|edit|comment|view@sandbox.test)');
  }
  console.log(`Verbindungsdaten: ${infoFile}`);

  const stop = async () => {
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
