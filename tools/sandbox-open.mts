// Spielwiese für den Modus local (eigene Konten, docs/features/accounts.md): echter Server (server/dist + web/dist)
// mit STACHEL_AUTH=local und Mail-Log statt Versand. Vorher bauen: `cd e2e && npm run build`.
// Aufruf: server/node_modules/.bin/tsx tools/sandbox-open.mts [port]   (Standard 8616)
// Vorbereitete Konten (bestätigt): mara@example.org, jonas@example.org, lena@example.org – Passwort „Kaktus-Wüste-2026“.
// Mails (Bestätigen, Passwort vergessen, Einladungen) stehen in <Daten>/mail.log.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { StachelServer } from '../e2e/support/server';
import { hashPassword } from '../server/src/passwords';

const port = Number(process.argv[2] ?? 8616);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `stachel-open-${port}-`));
const env = {
  STACHEL_AUTH: 'local',
  STACHEL_BRAND: 'Stachel · INTSODE',
  STACHEL_MAIL_MODE: 'log',
  STACHEL_IMPRINT_URL: 'https://example.org/impressum',
  STACHEL_PRIVACY_URL: 'https://example.org/datenschutz',
  STACHEL_CAPTCHA_MAX: '50000',
};
const server = new StachelServer(port, dataDir, 'http://127.0.0.1:9', path.join(dataDir, 'server.log'), env);
await server.start();

// drei bestätigte Konten direkt in die Datenbank (der Server hat die Tabellen angelegt)
const db = new DatabaseSync(path.join(dataDir, 'stachel.sqlite'));
const now = new Date().toISOString();
const hash = await hashPassword('Kaktus-Wüste-2026');
for (const [id, name] of [
  ['mara', 'Mara Lindner'],
  ['jonas', 'Jonas Keller'],
  ['lena', 'Lena Berg'],
]) {
  db.prepare(
    'INSERT OR IGNORE INTO accounts (id, email, name, password_hash, verified_at, privacy_accepted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, `${id}@example.org`, name, hash, now, now, now, now);
}
db.close();
console.log(`Stachel-Sandbox (local): ${server.url}  (Daten ${dataDir}, Mails mail.log)`);

const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
