// Persönliche Board-Angaben je Person: Favoriten (Stern) und „zuletzt geöffnet“. Vertrag: docs/contract.md §3.
// Beides gilt geräteübergreifend (Server statt localStorage) und verschwindet mit dem Board.
import type { FastifyInstance } from 'fastify';
import type { BoardInfo } from '../../shared/protocol.js';
import { nowIso, type Db } from './db.js';
import { sendError } from './http-util.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS board_favorites (
  user_key TEXT NOT NULL,
  board_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_key, board_id)
);
CREATE TABLE IF NOT EXISTS board_visits (
  user_key TEXT NOT NULL,
  board_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  PRIMARY KEY (user_key, board_id)
);
`;

/** Ein Besuch zählt höchstens einmal pro Minute (Wiederverbinden nach WLAN-Wacklern schreibt nicht jedes Mal). */
const VISIT_EVERY_MS = 60_000;

export function setupBoardPrefs(db: Db) {
  db.exec(SCHEMA);
}

const recentVisits = new Map<string, number>();

/** Board geöffnet (beim WebSocket-Anmelden, sync.ts). */
export function rememberVisit(db: Db, userKey: string, boardId: string, now = Date.now()) {
  const k = `${userKey}|${boardId}`;
  if (now - (recentVisits.get(k) ?? 0) < VISIT_EVERY_MS) return;
  if (recentVisits.size > 5000) recentVisits.clear();
  recentVisits.set(k, now);
  db.prepare(
    `INSERT INTO board_visits (user_key, board_id, opened_at) VALUES (?, ?, ?)
     ON CONFLICT(user_key, board_id) DO UPDATE SET opened_at = excluded.opened_at`,
  ).run(userKey, boardId, new Date(now).toISOString());
}

/** Board gelöscht: Favoriten und Besuche aller Personen entfernen (in der Lösch-Transaktion aufrufen). */
export function forgetBoardPrefs(db: Db, boardId: string) {
  db.prepare('DELETE FROM board_favorites WHERE board_id = ?').run(boardId);
  db.prepare('DELETE FROM board_visits WHERE board_id = ?').run(boardId);
  for (const k of recentVisits.keys()) if (k.endsWith(`|${boardId}`)) recentVisits.delete(k);
}

/** `favorite` und `openedAt` der Person an die Board-Liste hängen. */
export function decorateForUser(db: Db, userKey: string, boards: BoardInfo[]): BoardInfo[] {
  const favs = new Set(
    (db.prepare('SELECT board_id FROM board_favorites WHERE user_key = ?').all(userKey) as unknown as { board_id: string }[]).map((r) => r.board_id),
  );
  const visits = new Map(
    (db.prepare('SELECT board_id, opened_at FROM board_visits WHERE user_key = ?').all(userKey) as unknown as { board_id: string; opened_at: string }[]).map(
      (r) => [r.board_id, r.opened_at],
    ),
  );
  return boards.map((b) => {
    const out: BoardInfo = { ...b };
    if (favs.has(b.id)) out.favorite = true;
    const at = visits.get(b.id);
    if (at) out.openedAt = at;
    return out;
  });
}

/** `PUT|DELETE /api/boards/:id/favorite` (im Scope mit Sitzungsprüfung registrieren). */
export function registerBoardPrefs(scope: FastifyInstance, opts: { db: Db; boardExists: (id: string) => boolean }) {
  const { db, boardExists } = opts;
  scope.put<{ Params: { id: string } }>('/api/boards/:id/favorite', async (req, reply) => {
    if (!boardExists(req.params.id)) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
    db.prepare('INSERT OR IGNORE INTO board_favorites (user_key, board_id, created_at) VALUES (?, ?, ?)').run(req.session!.userKey, req.params.id, nowIso());
    return { ok: true, favorite: true };
  });
  scope.delete<{ Params: { id: string } }>('/api/boards/:id/favorite', async (req, reply) => {
    if (!boardExists(req.params.id)) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
    db.prepare('DELETE FROM board_favorites WHERE user_key = ? AND board_id = ?').run(req.session!.userKey, req.params.id);
    return { ok: true, favorite: false };
  });
}
