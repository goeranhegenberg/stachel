// Org-Tokens (bzw. `local:<id>`) für die Nachprüfung liegen verschlüsselt in SQLite (docs/contract.md §1):
// AES-256-GCM mit dem Schlüssel aus Env `STACHEL_TOKEN_KEY` (32 Byte, base64/base64url oder 64 Hex-Zeichen).
// Gespeichertes Format `enc1:<base64url(iv 12 | tag 16 | ciphertext)>`. Ohne Schlüssel bleibt es Klartext (Tests, Dev);
// Klartext-Zeilen von früher liest `open` weiter und `migrate` verschlüsselt sie beim Start.
import crypto from 'node:crypto';
import type { Db } from './db.js';

const PREFIX = 'enc1:';

/** Tabellen mit der Spalte `org_token` (Sitzungen, API-Tokens, QR-Kopplungen, App-Codes). */
const TABLES: { table: string; key: string }[] = [
  { table: 'sessions', key: 'id' },
  { table: 'api_tokens', key: 'id' },
  { table: 'pairings', key: 'code' },
  { table: 'app_codes', key: 'code_hash' },
];

export class TokenCrypt {
  private constructor(private readonly key: Buffer | null) {}

  /** Klartext (kein Schlüssel). */
  static readonly plain = new TokenCrypt(null);

  /** Schlüssel aus Env-Wert; leer = Klartext. Wirft bei einem unbrauchbaren Wert (Start bricht ab statt still Klartext). */
  static fromKey(raw: string | undefined): TokenCrypt {
    const s = (raw ?? '').trim();
    if (!s) return TokenCrypt.plain;
    const key = /^[0-9a-fA-F]{64}$/.test(s) ? Buffer.from(s, 'hex') : Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (key.length !== 32) {
      throw new Error('STACHEL_TOKEN_KEY muss 32 Byte lang sein (z. B. `openssl rand -base64 32`).');
    }
    return new TokenCrypt(key);
  }

  get enabled(): boolean {
    return this.key !== null;
  }

  /** Zum Speichern; ohne Schlüssel unverändert. */
  seal(plain: string): string {
    if (!this.key) return plain;
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
  }

  /** Gespeicherten Wert lesen: Klartext von früher unverändert; nicht entschlüsselbar (falscher/fehlender Schlüssel) → ''. */
  open(stored: string): string {
    if (!stored.startsWith(PREFIX)) return stored;
    if (!this.key) return '';
    try {
      const raw = Buffer.from(stored.slice(PREFIX.length), 'base64url');
      const d = crypto.createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
    } catch {
      return '';
    }
  }

  /** `open` für Spalten, die NULL sein dürfen. */
  openNullable(stored: string | null): string | null {
    return stored === null ? null : this.open(stored);
  }

  /**
   * Beim Start: Klartext-Tokens aller Tabellen verschlüsseln (nur mit Schlüssel). Liefert die Zahl der Zeilen.
   * Tabellen, die es (noch) nicht gibt, werden übersprungen.
   */
  migrate(db: Db): number {
    if (!this.key) return 0;
    let n = 0;
    db.exec('BEGIN');
    try {
      for (const { table, key } of TABLES) {
        const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
        if (!exists) continue;
        const rows = db
          .prepare(`SELECT ${key} AS k, org_token AS t FROM ${table} WHERE org_token IS NOT NULL AND org_token NOT LIKE '${PREFIX}%'`)
          .all() as unknown as { k: string; t: string }[];
        const upd = db.prepare(`UPDATE ${table} SET org_token = ? WHERE ${key} = ?`);
        for (const r of rows) upd.run(this.seal(r.t), r.k);
        n += rows.length;
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return n;
  }
}
