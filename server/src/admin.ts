// Verwaltung einer Instanz mit eigenen Konten (Modus local) von der Kommandozeile – vor allem für Selbst-Hosting ohne
// Mailserver: Konten freischalten, Passwort-Link ausgeben. Im Docker-Image als `stachel-admin` (Dockerfile), sonst
// `node dist/server/src/index.js admin <befehl>` bzw. `npm run admin -- <befehl>` in server/.
// Arbeitet direkt auf DATA_DIR/stachel.sqlite (WAL, busy_timeout) und darf neben dem laufenden Server benutzt werden.
import { BoardAccess } from './access.js';
import { Accounts, activateAccount, normEmail, RESET_TTL_MS } from './accounts.js';
import type { Config } from './config.js';
import { openDb } from './db.js';
import { setupUsers } from './users.js';

const HELP = `stachel-admin – Konten einer Stachel-Instanz (STACHEL_AUTH=local) verwalten

  stachel-admin users                 alle Konten (E-Mail, Name, bestätigt, angelegt)
  stachel-admin verify <email>        Konto freischalten (E-Mail gilt als bestätigt)
  stachel-admin reset-link <email>    Link zum Passwort-Setzen ausgeben (1 Stunde gültig)

Liest dieselben Umgebungsvariablen wie der Server (DATA_DIR, PUBLIC_URL, STACHEL_AUTH).`;

export interface AdminIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const stdio: AdminIo = { out: (l) => console.log(l), err: (l) => console.error(l) };

/** Führt einen Befehl aus; Rückgabe = Exit-Code. */
export function runAdmin(args: string[], cfg: Config, io: AdminIo = stdio): number {
  const [cmd, arg] = args;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    io.out(HELP);
    return cmd ? 0 : 1;
  }
  if (cfg.instance.auth !== 'local') {
    io.err('Diese Instanz läuft nicht mit eigenen Konten (STACHEL_AUTH=local); es gibt nichts zu verwalten.');
    return 2;
  }
  const db = openDb(cfg.dataDir);
  try {
    setupUsers(db);
    const accounts = new Accounts(db);
    if (cmd === 'users') {
      const rows = db.prepare('SELECT email, name, verified_at, created_at FROM accounts ORDER BY created_at').all() as {
        email: string;
        name: string;
        verified_at: string | null;
        created_at: string;
      }[];
      if (!rows.length) io.out('Noch keine Konten.');
      for (const r of rows) io.out(`${r.email}\t${r.name}\t${r.verified_at ? 'bestätigt' : 'offen'}\t${r.created_at}`);
      return 0;
    }
    if (cmd === 'verify' || cmd === 'reset-link') {
      const email = normEmail(arg);
      const acc = email ? accounts.byEmail(email) : undefined;
      if (!acc) {
        io.err(`Kein Konto mit der E-Mail-Adresse „${arg ?? ''}“. Alle Konten: stachel-admin users`);
        return 1;
      }
      if (cmd === 'verify') {
        activateAccount(db, new BoardAccess(db, 'local'), acc);
        io.out(`${acc.email} ist freigeschaltet und kann sich jetzt anmelden.`);
      } else {
        const token = accounts.issueToken(acc.id, 'reset', RESET_TTL_MS);
        // /reset/<token> an der Wurzel leitet in die Web-App weiter (auch mit STACHEL_BASE_PATH)
        io.out(`${cfg.publicUrl}/reset/${token}`);
      }
      return 0;
    }
    io.err(`Unbekannter Befehl „${cmd}“.\n\n${HELP}`);
    return 1;
  } finally {
    db.close();
  }
}

