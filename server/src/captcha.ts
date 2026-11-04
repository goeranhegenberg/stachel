// Captcha ohne Drittanbieter (Modus local, docs/features/accounts.md): Proof-of-Work im ALTCHA-Format.
// Der Server gibt eine signierte Aufgabe aus (salt mit Ablaufzeit, challenge = SHA-256(salt + geheime Zahl)); der Browser
// probiert im Web Worker Zahlen durch, bis der Hash passt, und schickt die Lösung mit dem Formular. Kein Cookie, kein
// Tracking, keine externe Verbindung. Jede Lösung gilt genau einmal (Tabelle captcha_used) und höchstens CAPTCHA_TTL lang.
import crypto from 'node:crypto';
import { nowIso, type Db } from './db.js';

export const CAPTCHA_TTL_MS = 10 * 60_000;
export const CAPTCHA_ALGORITHM = 'SHA-256';

export interface CaptchaChallenge {
  algorithm: typeof CAPTCHA_ALGORITHM;
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
}

export type CaptchaCheck = 'ok' | 'missing' | 'invalid' | 'expired' | 'reused';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS captcha_used (
  challenge TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);
`;

const sha256hex = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export class Captcha {
  /** HMAC-Schlüssel nur im Speicher: nach einem Neustart sind offene Aufgaben ungültig (Formular holt eine neue). */
  private readonly key = crypto.randomBytes(32);

  constructor(
    private readonly db: Db,
    readonly maxNumber: number,
    private readonly now: () => number = Date.now,
  ) {
    db.exec(SCHEMA);
  }

  private sign(challenge: string): string {
    return crypto.createHmac('sha256', this.key).update(challenge).digest('hex');
  }

  create(): CaptchaChallenge {
    const expires = Math.floor((this.now() + CAPTCHA_TTL_MS) / 1000);
    const salt = `${crypto.randomBytes(12).toString('hex')}?expires=${expires}`;
    const number = crypto.randomInt(0, this.maxNumber + 1);
    const challenge = sha256hex(salt + number);
    return { algorithm: CAPTCHA_ALGORITHM, challenge, maxnumber: this.maxNumber, salt, signature: this.sign(challenge) };
  }

  /** Lösung prüfen und (nur wenn gültig) als verbraucht markieren. `payload` = base64(JSON) wie bei ALTCHA. */
  verify(payload: unknown): CaptchaCheck {
    if (typeof payload !== 'string' || !payload) return 'missing';
    if (payload.length > 2000) return 'invalid';
    let p: { algorithm?: unknown; challenge?: unknown; number?: unknown; salt?: unknown; signature?: unknown };
    try {
      p = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    } catch {
      return 'invalid';
    }
    if (!p || typeof p !== 'object') return 'invalid';
    const { algorithm, challenge, number, salt, signature } = p;
    if (algorithm !== CAPTCHA_ALGORITHM || typeof challenge !== 'string' || typeof salt !== 'string' || typeof signature !== 'string') return 'invalid';
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 0 || number > this.maxNumber) return 'invalid';
    if (!/^[0-9a-f]{64}$/.test(challenge) || !/^[0-9a-f]{64}$/.test(signature)) return 'invalid';
    const want = Buffer.from(this.sign(challenge), 'hex');
    if (!crypto.timingSafeEqual(want, Buffer.from(signature, 'hex'))) return 'invalid';
    const exp = Number(/[?&]expires=(\d+)/.exec(salt)?.[1] ?? NaN);
    if (!Number.isFinite(exp) || exp * 1000 < this.now()) return 'expired';
    if (sha256hex(salt + number) !== challenge) return 'invalid';
    this.purge();
    const res = this.db
      .prepare('INSERT OR IGNORE INTO captcha_used (challenge, expires_at) VALUES (?, ?)')
      .run(challenge, new Date(exp * 1000).toISOString());
    return res.changes ? 'ok' : 'reused';
  }

  purge() {
    this.db.prepare('DELETE FROM captcha_used WHERE expires_at < ?').run(nowIso());
  }
}

/** Lösung im Test/Werkzeug finden (wie der Browser-Worker). */
export function solveCaptcha(c: Pick<CaptchaChallenge, 'challenge' | 'salt' | 'maxnumber' | 'algorithm' | 'signature'>): string | null {
  for (let n = 0; n <= c.maxnumber; n++) {
    if (sha256hex(c.salt + n) === c.challenge) {
      return Buffer.from(JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, number: n, salt: c.salt, signature: c.signature })).toString('base64');
    }
  }
  return null;
}
