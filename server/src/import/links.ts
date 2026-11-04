// Gespeicherte Import-Verbindungen (docs/features/import.md §1 Weg B, §6): Tabelle `import_links` mit dem
// Refresh-Token, IMMER verschlüsselt (AES-256-GCM, Person `user_key` als zusätzliche Authentisierung: eine Zeile lässt
// sich keiner anderen Person unterschieben). Schlüssel per HKDF aus STACHEL_TOKEN_KEY, ohne den aus
// `<DATA_DIR>/import-secret.key` (beim ersten Start zufällig erzeugt, Rechte 0600). Access-Tokens nie in der Datenbank.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { nowIso, type Db } from '../db.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS import_links (
  user_key TEXT NOT NULL,
  provider TEXT NOT NULL,          -- miro
  refresh_token TEXT NOT NULL,     -- imp1:<base64url(iv 12 | tag 16 | ciphertext)>, AAD = provider + user_key
  created_at TEXT NOT NULL,
  used_at TEXT NOT NULL,
  PRIMARY KEY (user_key, provider)
);
`;

const PREFIX = 'imp1:';
const DAY = 24 * 3600_000;
/** Miro lässt Refresh-Tokens nach 60 Tagen ohne Nutzung verfallen */
export const LINK_UNUSED_DAYS = 60;
export const IMPORT_SECRET_FILE = 'import-secret.key';

/** Schlüssel für import_links: HKDF-SHA256 aus STACHEL_TOKEN_KEY bzw. der Datei im Datenordner. */
export function importKey(tokenKey: string, dataDir: string): Buffer {
  let ikm: Buffer;
  const raw = tokenKey.trim();
  if (raw) ikm = Buffer.from(raw, 'utf8');
  else {
    const file = path.join(dataDir, IMPORT_SECRET_FILE);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dataDir, { recursive: true });
      try {
        fs.writeFileSync(file, `${crypto.randomBytes(32).toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
    const s = fs.readFileSync(file, 'utf8').trim();
    ikm = Buffer.from(s, 'base64');
    if (ikm.length < 32) throw new Error(`${file} ist unbrauchbar (erwartet 32 Byte base64). Datei löschen, dann neu verbinden.`);
  }
  return Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.from('stachel-import'), Buffer.from('import-links/v1'), 32));
}

export class ImportLinks {
  constructor(
    private readonly db: Db,
    private readonly key: Buffer,
  ) {
    db.exec(SCHEMA);
  }

  private aad(userKey: string, provider: string) {
    return Buffer.from(`import:${provider}:${userKey}`, 'utf8');
  }

  seal(userKey: string, provider: string, plain: string): string {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    c.setAAD(this.aad(userKey, provider));
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
  }

  /** null = nicht entschlüsselbar (falsche Person, anderer Schlüssel, kaputt) */
  open(userKey: string, provider: string, stored: string): string | null {
    if (!stored.startsWith(PREFIX)) return null;
    try {
      const raw = Buffer.from(stored.slice(PREFIX.length), 'base64url');
      const d = crypto.createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
      d.setAAD(this.aad(userKey, provider));
      d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
    } catch {
      return null;
    }
  }

  save(userKey: string, provider: string, refreshToken: string) {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO import_links (user_key, provider, refresh_token, created_at, used_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_key, provider) DO UPDATE SET refresh_token = excluded.refresh_token, used_at = excluded.used_at`,
      )
      .run(userKey, provider, this.seal(userKey, provider, refreshToken), now, now);
  }

  /** Refresh-Token lesen; eine nicht lesbare Zeile wird gelöscht (neu verbinden). */
  load(userKey: string, provider: string): string | null {
    const row = this.db.prepare('SELECT refresh_token FROM import_links WHERE user_key = ? AND provider = ?').get(userKey, provider) as
      | { refresh_token: string }
      | undefined;
    if (!row) return null;
    const plain = this.open(userKey, provider, row.refresh_token);
    if (plain === null) this.remove(userKey, provider);
    return plain;
  }

  has(userKey: string, provider: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM import_links WHERE user_key = ? AND provider = ?').get(userKey, provider));
  }

  touch(userKey: string, provider: string) {
    this.db.prepare('UPDATE import_links SET used_at = ? WHERE user_key = ? AND provider = ?').run(nowIso(), userKey, provider);
  }

  remove(userKey: string, provider: string) {
    this.db.prepare('DELETE FROM import_links WHERE user_key = ? AND provider = ?').run(userKey, provider);
  }

  /** alle Verbindungen einer Person (Konto löschen) */
  ofUser(userKey: string): string[] {
    return (this.db.prepare('SELECT provider FROM import_links WHERE user_key = ?').all(userKey) as unknown as { provider: string }[]).map((r) => r.provider);
  }

  forgetUser(userKey: string): number {
    return Number(this.db.prepare('DELETE FROM import_links WHERE user_key = ?').run(userKey).changes);
  }

  /** Löschfrist: 60 Tage ohne Nutzung */
  purgeUnused(now = Date.now()): number {
    const cutoff = new Date(now - LINK_UNUSED_DAYS * DAY).toISOString();
    return Number(this.db.prepare('DELETE FROM import_links WHERE used_at < ?').run(cutoff).changes);
  }
}
