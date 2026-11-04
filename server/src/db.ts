import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,            -- sha256 des Cookie-Werts (base64url)
  user_key TEXT NOT NULL,
  name TEXT NOT NULL,
  is_orga INTEGER NOT NULL,
  org_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS pairings (
  code TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL,           -- pending | approved | redeemed
  user_key TEXT,
  name TEXT,
  is_orga INTEGER,
  org_token TEXT,
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  name TEXT PRIMARY KEY,
  state BLOB NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS images_board ON images(board_id);
`;

export function openDb(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'stachel.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  renameLegacyTokenColumn(db);
  db.exec(SCHEMA);
  return db;
}

/** Tabellen mit dem gespeicherten Org-Token (bzw. `local:<id>`) für die Nachprüfung, siehe token-crypt.ts. */
export const ORG_TOKEN_TABLES = ['sessions', 'pairings', 'api_tokens', 'app_codes'] as const;

/**
 * Bis 11/2026 hieß die Spalte `org_token` nach dem ersten Betreiber (`<name>_token`). Bestandsdaten: beim Start
 * umbenennen, Inhalt bleibt. Erkannt wird die alte Spalte als einzige `…_token`-Spalte außer `org_token`/`token_hash`.
 */
function renameLegacyTokenColumn(db: Db): void {
  for (const table of ORG_TOKEN_TABLES) {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.length || cols.includes('org_token')) continue;
    const legacy = cols.filter((c) => /^[a-z]+_token$/.test(c) && c !== 'token_hash');
    if (legacy.length === 1) db.exec(`ALTER TABLE ${table} RENAME COLUMN ${legacy[0]} TO org_token`);
  }
}

export const nowIso = () => new Date().toISOString();
