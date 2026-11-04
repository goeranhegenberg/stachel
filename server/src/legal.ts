// Rechtliche Pflichten im Betrieb:
// - CR-8 „Meine Daten herunterladen“ (Art. 20 DSGVO): `GET /api/account/export` → ZIP mit konto.json und je eigenem Board
//   board.json (Objekte wie in der Native-API) samt hochgeladener Dateien. Nur Modus local (eigene Konten).
// - CR-10 Löschfristen: Personen im Modus org 2 Jahre nach `last_seen` vergessen (Tabelle `users` mit Namen,
//   Favoriten, „zuletzt geöffnet“), offene Einladungen (E-Mail-Adressen Dritter) nach 90 Tagen löschen, API-Tokens nach
//   12 Monaten ohne Nutzung (api-tokens.ts). Läuft beim Start und dann stündlich.
//   Erledigte Meldungen (reports.ts) 1 Jahr nach der Entscheidung.
// - CR-1: Warnung beim Start, wenn im Modus local STACHEL_TERMS_URL fehlt.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import { SESSION_COOKIE } from '../../shared/protocol.js';
import type { Accounts } from './accounts.js';
import { accountKey } from './accounts.js';
import { TOKEN_UNUSED_DAYS } from './api-tokens.js';
import type { Db } from './db.js';
import { MESSAGES, sendError } from './http-util.js';
import type { InstanceConfig } from './instance.js';
import { appSessionToken } from './native/auth.js';
import { versionSnapshot } from './native/version-snapshot.js';
import { RateLimiter } from './rate-limit.js';
import type { SessionStore } from './sessions.js';
import { zipStream, type ZipEntry } from './zip.js';

const DAY = 24 * 3600_000;
/** Modus org: Name/Schlüssel einer Person so lange nach der letzten Anmeldung (Löschfrist laut Datenschutzerklärung) */
export const USER_RETENTION_DAYS = 730;
/** offene Einladungen an E-Mail-Adressen (Daten Dritter) */
export const INVITE_RETENTION_DAYS = 90;
/** erledigte Meldungen (Beleg, Namen, Begründung) so lange nach der Entscheidung – Widerspruchsfrist 6 Monate + Puffer */
export const REPORT_RETENTION_DAYS = 365;
/** Export: so oft je Konto und Stunde */
export const EXPORT_PER_HOUR = 3;

// ---- Löschfristen -----------------------------------------------------------------------------------------------

export interface RetentionResult {
  users: number;
  invites: number;
  tokens: number;
  reports: number;
}

/**
 * Löschregeln anwenden. `mode` = Betriebsart: Personen werden nur im Modus org nach `last_seen` vergessen (im Modus
 * local hängt die Zeile am Konto und verschwindet mit ihm). Personen mit gültiger Sitzung oder API-Token bleiben.
 * `onTokenGone` trennt offene Verbindungen gelöschter API-Tokens.
 */
export function applyRetention(db: Db, mode: 'org' | 'local', now = Date.now(), onTokenGone?: (id: string) => void): RetentionResult {
  const res: RetentionResult = { users: 0, invites: 0, tokens: 0, reports: 0 };
  const iso = (ms: number) => new Date(ms).toISOString();
  const has = (table: string) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
  if (mode === 'org' && has('users')) {
    const cutoff = iso(now - USER_RETENTION_DAYS * DAY);
    const stale = (
      db
        .prepare(
          `SELECT key FROM users u WHERE last_seen < ?
             AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_key = u.key AND s.expires_at > ?)
             ${has('api_tokens') ? 'AND NOT EXISTS (SELECT 1 FROM api_tokens t WHERE t.user_key = u.key)' : ''}`,
        )
        .all(cutoff, iso(now)) as unknown as { key: string }[]
    ).map((r) => r.key);
    if (stale.length) {
      db.exec('BEGIN');
      try {
        for (const key of stale) {
          db.prepare('DELETE FROM users WHERE key = ?').run(key);
          if (has('board_favorites')) db.prepare('DELETE FROM board_favorites WHERE user_key = ?').run(key);
          if (has('board_visits')) db.prepare('DELETE FROM board_visits WHERE user_key = ?').run(key);
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    }
    res.users = stale.length;
  }
  if (has('board_invites')) {
    res.invites = Number(db.prepare('DELETE FROM board_invites WHERE created_at < ?').run(iso(now - INVITE_RETENTION_DAYS * DAY)).changes);
  }
  if (has('api_tokens')) {
    const cutoff = iso(now - TOKEN_UNUSED_DAYS * DAY);
    const ids = (db.prepare('SELECT id FROM api_tokens WHERE COALESCE(last_used_at, created_at) < ?').all(cutoff) as unknown as { id: string }[]).map((r) => r.id);
    for (const id of ids) {
      db.prepare('DELETE FROM api_tokens WHERE id = ?').run(id);
      onTokenGone?.(id);
    }
    res.tokens = ids.length;
  }
  if (has('reports')) {
    // offene Meldungen bleiben, bis sie entschieden sind
    const cutoff = iso(now - REPORT_RETENTION_DAYS * DAY);
    res.reports = Number(db.prepare("DELETE FROM reports WHERE status <> 'open' AND COALESCE(decided_at, created_at) < ?").run(cutoff).changes);
  }
  return res;
}

// ---- Export ------------------------------------------------------------------------------------------------------

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

/** Ordnername im ZIP: lesbarer Titel + ID (eindeutig, ohne Zeichen, die Dateisysteme stören). */
export function boardFolder(title: string, id: string): string {
  const t = title
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 60)
    .trim();
  return `${t || 'Board'} (${id})`;
}

interface BoardRow {
  id: string;
  title: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface ExportDeps {
  db: Db;
  accounts: Accounts;
  sessions: SessionStore;
  hocuspocus: Hocuspocus<any>;
  imagesDir: string;
  instance: InstanceConfig;
  /** öffentliche Adresse der Web-App (für konto.json) */
  appUrl: string;
}

const LIESMICH = (brand: string, url: string, at: string) => `${brand} – deine Daten (Export vom ${at})

Dieses Archiv enthält die Daten, die ${brand} (${url}) zu deinem Konto speichert, in einem
maschinenlesbaren Format (Art. 20 DSGVO):

- konto.json: Konto (Name, E-Mail, Zeitpunkte), deine Boards, Mitgliedschaften auf Boards anderer,
  Favoriten, von dir verschickte offene Einladungen, KI-Zugänge (nur Name und Zeitpunkte, ohne Token),
  Import-Berichte und verbundene Import-Zugänge (nur Zeitpunkte, ohne Token).
- boards/<Titel> (<ID>)/board.json: Inhalt jedes eigenen Boards – alle Objekte (Notizen, Formen, Texte,
  Verbinder …) als JSON wie in der Stachel-App-Schnittstelle, dazu Kommentare, Abstimmungen usw. unter "ext".
- boards/<Titel> (<ID>)/dateien/: hochgeladene Bilder und PDFs des Boards (Dateiname = ID im board.json).

Nicht enthalten: Boards anderer Personen (dort bist du Mitglied; die Daten gehören der Besitzerin bzw. dem
Besitzer), Passwort (nur als Prüfwert gespeichert), Sitzungen.
Fragen zum Datenschutz: siehe Datenschutzerklärung der Instanz.
`;

/** `GET /api/account/export` (Modus local): Cookie-Sitzung oder App-Sitzung (Bearer sts_…), keine API-Tokens. */
export function registerDataExport(app: FastifyInstance, deps: ExportDeps) {
  const { db, accounts, sessions, hocuspocus, imagesDir, instance } = deps;
  const limiter = new RateLimiter(EXPORT_PER_HOUR, 3600_000);
  const running = new Set<string>();
  const timer = setInterval(() => limiter.prune(), 10 * 60_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));

  const sessionOf = (req: FastifyRequest) => {
    const cookie = req.cookies[SESSION_COOKIE];
    return (cookie ? sessions.get(cookie) : undefined) ?? sessions.get(appSessionToken(req.headers.authorization));
  };

  /** Live-Stand eines geladenen Boards (Hocuspocus), sonst der gespeicherte. */
  const boardState = (id: string): Uint8Array | null => {
    const live = hocuspocus.documents.get(`board:${id}`);
    if (live) return Y.encodeStateAsUpdate(live);
    const row = db.prepare('SELECT state FROM documents WHERE name = ?').get(`board:${id}`) as { state: Uint8Array } | undefined;
    return row?.state ?? null;
  };

  app.get('/api/account/export', async (req: FastifyRequest, reply: FastifyReply) => {
    const s = sessionOf(req);
    const acc = s ? accounts.byKey(s.userKey) : undefined;
    if (!s || !acc) return sendError(reply, 401, 'not_logged_in', MESSAGES.not_logged_in);
    if (running.has(acc.id) || !limiter.allow(acc.id)) return sendError(reply, 429, 'rate_limited', MESSAGES.rate_limited);
    const key = accountKey(acc.id);
    const now = new Date();
    const day = now.toISOString().slice(0, 10);

    const owned = db.prepare('SELECT * FROM boards WHERE created_by = ? ORDER BY title').all(key) as unknown as BoardRow[];
    const q = <T>(sql: string, ...args: string[]) => {
      try {
        return db.prepare(sql).all(...args) as unknown as T[];
      } catch {
        return [] as T[]; // Tabelle gibt es (noch) nicht
      }
    };
    const konto = {
      format: 'stachel-export/1',
      exportiertAm: now.toISOString(),
      instanz: { name: instance.brand, adresse: deps.appUrl },
      konto: {
        id: acc.id,
        schluessel: key,
        name: acc.name,
        email: acc.email,
        angelegtAm: acc.created_at,
        bestaetigtAm: acc.verified_at,
        datenschutzHinweisAm: acc.privacy_accepted_at,
        nutzungsbedingungenAkzeptiertAm: acc.terms_accepted_at ?? null,
        nutzungsbedingungenFassung: acc.terms_version ?? null,
        geaendertAm: acc.updated_at,
      },
      eigeneBoards: owned.map((b) => ({ id: b.id, titel: b.title, angelegtAm: b.created_at, geaendertAm: b.updated_at, imPapierkorbSeit: b.deleted_at ?? null, ordner: `boards/${boardFolder(b.title, b.id)}` })),
      mitgliedschaften: q<{ board_id: string; title: string; role: string; created_at: string }>(
        'SELECT m.board_id, b.title, m.role, m.created_at FROM board_members m JOIN boards b ON b.id = m.board_id WHERE m.user_key = ? ORDER BY b.title',
        key,
      ).map((m) => ({ boardId: m.board_id, titel: m.title, rolle: m.role, seit: m.created_at })),
      favoriten: q<{ board_id: string; created_at: string }>('SELECT board_id, created_at FROM board_favorites WHERE user_key = ?', key).map((f) => ({ boardId: f.board_id, seit: f.created_at })),
      zuletztGeoeffnet: q<{ board_id: string; opened_at: string }>('SELECT board_id, opened_at FROM board_visits WHERE user_key = ? ORDER BY opened_at DESC', key).map((v) => ({ boardId: v.board_id, am: v.opened_at })),
      verschickteEinladungen: q<{ board_id: string; email: string; role: string; created_at: string }>(
        'SELECT board_id, email, role, created_at FROM board_invites WHERE invited_by = ? ORDER BY created_at',
        key,
      ).map((i) => ({ boardId: i.board_id, email: i.email, rolle: i.role, am: i.created_at })),
      kiZugaenge: q<{ label: string; created_at: string; last_used_at: string | null }>('SELECT label, created_at, last_used_at FROM api_tokens WHERE user_key = ? ORDER BY created_at', key).map((t) => ({
        name: t.label,
        angelegtAm: t.created_at,
        zuletztBenutzt: t.last_used_at,
      })),
      eigeneVorlagen: q<{ name: string; object_count: number; created_at: string; objects: string }>('SELECT name, object_count, created_at, objects FROM user_templates WHERE user_key = ? ORDER BY created_at', key).map((t) => ({ name: t.name, objekte: t.object_count, angelegtAm: t.created_at, inhalt: JSON.parse(t.objects) as unknown })),
      erwaehnungen: q<{ board_id: string; created_at: string }>('SELECT board_id, created_at FROM mentions WHERE user_key = ? ORDER BY created_at DESC', key).map((m) => ({ boardId: m.board_id, am: m.created_at })),
      // Import aus Miro (import/jobs.ts): Berichte ohne Tokens; verbundene Miro-Zugänge nur mit Zeitpunkten
      importe: q<{ id: string; source: string; source_board: string; source_name: string; board_id: string | null; status: string; report: string | null; error: string | null; created_at: string; finished_at: string | null }>(
        'SELECT id, source, source_board, source_name, board_id, status, report, error, created_at, finished_at FROM import_jobs WHERE user_key = ? ORDER BY created_at DESC',
        key,
      ).map((j) => ({ id: j.id, quelle: j.source, quellBoard: j.source_board, quellName: j.source_name, boardId: j.board_id, status: j.status, fehler: j.error, bericht: j.report ? (JSON.parse(j.report) as unknown) : null, am: j.created_at, fertigAm: j.finished_at })),
      importVerbindungen: q<{ provider: string; created_at: string; used_at: string }>('SELECT provider, created_at, used_at FROM import_links WHERE user_key = ?', key).map((l) => ({ quelle: l.provider, verbundenAm: l.created_at, zuletztBenutzt: l.used_at })),
    };

    function* entries(): Generator<ZipEntry> {
      yield { name: 'LIESMICH.txt', data: LIESMICH(instance.brand, deps.appUrl, day) };
      yield { name: 'konto.json', data: JSON.stringify(konto, null, 2) };
      for (const b of owned) {
        const dir = `boards/${boardFolder(b.title, b.id)}`;
        const files = db.prepare('SELECT id, mime, bytes, created_at FROM images WHERE board_id = ? ORDER BY created_at').all(b.id) as unknown as { id: string; mime: string; bytes: number; created_at: string }[];
        yield {
          name: `${dir}/board.json`,
          data: async () => {
            const state = boardState(b.id);
            const snap = state ? versionSnapshot(state) : { objects: [], ext: {} };
            const out = {
              board: { id: b.id, titel: b.title, besitzer: b.created_by_name, angelegtAm: b.created_at, geaendertAm: b.updated_at, imPapierkorbSeit: b.deleted_at ?? null },
              dateien: files.map((f) => ({ id: f.id, typ: f.mime, bytes: f.bytes, datei: `dateien/${f.id}.${EXT[f.mime] ?? 'bin'}` })),
              objects: snap.objects,
              ext: snap.ext,
            };
            return Buffer.from(JSON.stringify(out, null, 2), 'utf8');
          },
        };
        for (const f of files) {
          yield {
            name: `${dir}/dateien/${f.id}.${EXT[f.mime] ?? 'bin'}`,
            compress: false,
            data: async () => {
              try {
                return await fs.promises.readFile(path.join(imagesDir, f.id));
              } catch {
                return null; // Datei fehlt (schon aufgeräumt): Eintrag weglassen
              }
            },
          };
        }
      }
    }

    // privater Modus: noch nicht aufgedeckte eigene Notizen (Privat-Ablagen, private-mode.ts)
    const privateAreas = q<{ board_id: string; state: Uint8Array; updated_at: string }>('SELECT board_id, state, updated_at FROM private_docs WHERE user_key = ?', key);
    function* all(): Generator<ZipEntry> {
      yield* entries();
      for (const p of privateAreas) {
        yield {
          name: `privat/${p.board_id}.json`,
          data: async () => Buffer.from(JSON.stringify({ boardId: p.board_id, geaendertAm: p.updated_at, objects: versionSnapshot(p.state).objects }, null, 2), 'utf8'),
        };
      }
    }

    running.add(acc.id);
    const stream = zipStream(all(), now);
    const done = () => running.delete(acc.id);
    stream.once('end', done).once('error', done).once('close', done);
    const file = `stachel-daten-${day}.zip`;
    return reply
      .header('Cache-Control', 'no-store')
      .header('Content-Disposition', `attachment; filename="${file}"`)
      .type('application/zip')
      .send(stream);
  });
}

// ---- Start ---------------------------------------------------------------------------------------------------------

/** Hinweise beim Start (Modus local ohne Nutzungsbedingungen). */
export function legalStartupWarnings(instance: InstanceConfig): string[] {
  const out: string[] = [];
  if (instance.auth === 'local' && !instance.termsUrl) {
    out.push('STACHEL_TERMS_URL fehlt: Die Registrierung zeigt „Ich akzeptiere die Nutzungsbedingungen …“ ohne Link. Bitte die Adresse der Nutzungsbedingungen setzen.');
  }
  return out;
}
