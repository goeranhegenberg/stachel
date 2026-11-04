// Hilfen für Tests im Modus local (eigene Konten): Mails aus dem Mail-Log, Captcha lösen, Konto anlegen.
import fs from 'node:fs';
import path from 'node:path';
import { solveCaptcha } from '../src/captcha.js';
import { loadInstance } from '../src/instance.js';
import { Browser, waitFor, type TestEnv } from './helpers.js';

export const LOCAL = { ...loadInstance({ STACHEL_MAIL_MODE: 'log' }), auth: 'local' as const, mailMode: 'log' as const, captchaMax: 3000, brand: 'Stachel Test' };

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Mails aus DATA_DIR/mail.log (Modus log). */
export function mailsOf(env: TestEnv): Mail[] {
  const file = path.join(env.cfg.dataDir, 'mail.log');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Mail);
}

export async function waitMail(env: TestEnv, to: string, subject: RegExp, after = 0): Promise<Mail> {
  let hit: Mail | undefined;
  await waitFor(() => {
    hit = mailsOf(env)
      .slice(after)
      .find((m) => m.to === to && subject.test(m.subject));
    return !!hit;
  }, 5000);
  return hit!;
}

/** Token aus einem Mail-Link: `/verify/<token>`, `/reset/<token>` (seit der Stachel-App) bzw. `?<param>=<token>`. */
export const linkParam = (m: Mail, param: string) => new RegExp(`(?:[?&]${param}=|/${param}/)([A-Za-z0-9_-]+)`).exec(m.text)?.[1] ?? '';

export async function captcha(b: Browser): Promise<string> {
  const c = await b.get('/api/auth/captcha');
  return solveCaptcha(c.body)!;
}

export const PW = 'Wüstenblume-Siebzehn';

/** Registrieren + bestätigen + anmelden; liefert den angemeldeten Browser. */
export async function signUp(env: TestEnv, name: string, email: string, password = PW): Promise<Browser> {
  const b = new Browser(env.base);
  const before = mailsOf(env).length;
  const r = await b.post('/api/auth/register', { name, email, password, terms: true, captcha: await captcha(b) });
  if (r.status !== 200) throw new Error(`register ${r.status} ${JSON.stringify(r.body)}`);
  const m = await waitMail(env, email, /bestätigen/, before);
  const v = await b.post('/api/auth/verify', { token: linkParam(m, 'verify') });
  if (v.status !== 200) throw new Error(`verify ${v.status}`);
  const l = await b.post('/api/auth/login', { email, password });
  if (l.status !== 200) throw new Error(`login ${l.status} ${JSON.stringify(l.body)}`);
  return b;
}

