// Passwörter für eigene Konten (Modus local, docs/features/accounts.md): scrypt aus node:crypto, kein natives Paket.
// Format: `scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>` – Parameter stehen im Hash, damit sie später steigen können.
import crypto from 'node:crypto';
import { COMMON_PASSWORDS } from './common-passwords.js';

const N = 1 << 15;
const R = 8;
const P = 1;
const KEYLEN = 32;
/** scrypt braucht 128 · N · r Byte (32 MB); etwas Luft darüber. */
const MAXMEM = 64 * 1024 * 1024;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/** Hash für Konten, die es nicht gibt: gleiche Rechenzeit, damit die Antwortzeit nichts verrät. */
let dummy: Promise<string> | null = null;
export const dummyHash = () => (dummy ??= hashPassword(crypto.randomBytes(18).toString('base64url')));

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (!Number.isInteger(n) || n < 2 || n > 1 << 20 || !r || !p) return false;
  const salt = Buffer.from(parts[4]!, 'base64url');
  const want = Buffer.from(parts[5]!, 'base64url');
  const got = await scrypt(password, salt, n, r, p);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/**
 * Mindeststärke: Länge, nicht in der Liste sehr häufiger Passwörter, nicht E-Mail/Name, keine bloße Wiederholung bzw.
 * Tastenfolge. Liefert einen deutschen Hinweis oder null (in Ordnung).
 */
export function passwordProblem(password: string, ctx: { email?: string; name?: string } = {}): string | null {
  if (password.length < PASSWORD_MIN) return `Das Passwort braucht mindestens ${PASSWORD_MIN} Zeichen.`;
  if (password.length > PASSWORD_MAX) return `Das Passwort darf höchstens ${PASSWORD_MAX} Zeichen haben.`;
  const low = password.toLowerCase();
  const core = low.replace(/[\d\W_]+$/u, '').replace(/^[\d\W_]+/u, '');
  if (COMMON_PASSWORDS.has(low) || (core.length >= 4 && COMMON_PASSWORDS.has(core))) {
    return 'Dieses Passwort ist sehr verbreitet und wird schnell erraten. Bitte wähle ein anderes.';
  }
  if (new Set(low).size <= 3) return 'Das Passwort besteht fast nur aus denselben Zeichen. Bitte wähle ein anderes.';
  if (isRun(low)) return 'Eine bloße Zeichenfolge (z. B. 1234567890 oder qwertzuiop) ist leicht zu erraten.';
  const local = (ctx.email ?? '').toLowerCase().split('@')[0] ?? '';
  if ((local.length >= 4 && low.includes(local)) || (ctx.email && low === ctx.email.toLowerCase())) {
    return 'Das Passwort darf nicht deine E-Mail-Adresse enthalten.';
  }
  const name = (ctx.name ?? '').toLowerCase().replace(/\s+/g, '');
  if (name.length >= 4 && low.replace(/\s+/g, '').includes(name)) return 'Das Passwort darf nicht deinen Namen enthalten.';
  return null;
}

const ROWS = ['abcdefghijklmnopqrstuvwxyz', '01234567890', 'qwertzuiopü', 'asdfghjklöä', 'yxcvbnm', 'qwertyuiop', 'zxcvbnm'];
/** Ganze Zeichenfolge ist ein Ausschnitt einer Reihe (vorwärts oder rückwärts, auch wiederholt). */
function isRun(s: string): boolean {
  const unit = s.length >= 6 ? s : '';
  if (!unit) return false;
  for (const row of ROWS) {
    const both = [row.repeat(3), [...row].reverse().join('').repeat(3)];
    if (both.some((r) => r.includes(unit))) return true;
  }
  return false;
}
