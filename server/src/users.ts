// Personen, die sich schon einmal bei Stachel angemeldet haben (für @Erwähnungen in Kommentaren).
// Vertrag: docs/contract.md §3 „Personen“. Sitzungen verfallen, die Tabelle `users` bleibt.
import type { FastifyInstance } from 'fastify';
import { nowIso, type Db } from './db.js';

export interface KnownUser {
  key: string;
  name: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  key TEXT PRIMARY KEY,           -- user_key (m:<id> | a:<name>)
  name TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
`;

/** Tabelle anlegen und einmalig aus vorhandenen Sitzungen und Boards füllen (ältere Datenbanken). */
export function setupUsers(db: Db) {
  db.exec(SCHEMA);
  db.exec(`
    INSERT OR IGNORE INTO users (key, name, first_seen, last_seen)
      SELECT user_key, name, MIN(created_at), MAX(verified_at) FROM sessions GROUP BY user_key;
    INSERT OR IGNORE INTO users (key, name, first_seen, last_seen)
      SELECT created_by, created_by_name, MIN(created_at), MAX(created_at) FROM boards GROUP BY created_by;
  `);
}

/** Anmeldung bzw. Sitzungsprüfung merken (Name kann sich beim Identitätsdienst ändern). */
export function rememberUser(db: Db, u: { userKey: string; name: string }) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO users (key, name, first_seen, last_seen) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen`,
  ).run(u.userKey, u.name, now, now);
}

export function listUsers(db: Db): KnownUser[] {
  const rows = db.prepare('SELECT key, name FROM users').all() as unknown as KnownUser[];
  return rows.map((r) => ({ key: r.key, name: r.name })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** `GET /api/users` – nur mit Sitzung (im Scope mit requireSession registrieren). */
export function registerUserRoutes(scope: FastifyInstance, db: Db) {
  scope.get('/api/users', async () => ({ ok: true, users: listUsers(db) }));
}
