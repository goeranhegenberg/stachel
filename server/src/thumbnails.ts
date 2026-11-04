// Vorschaubilder der Boards (docs/contract.md §3): der Browser rendert das Bild selbst und lädt es per PUT hoch.
// Gespeichert in SQLite (klein, ≤ 512 KB), gelöscht zusammen mit dem Board (ON DELETE CASCADE).
import type { FastifyInstance } from 'fastify';
import type { BoardEvents } from './board-events.js';
import type { BoardInfo } from '../../shared/protocol.js';
import { nowIso, type Db } from './db.js';
import { IMAGE_CSP, sendError } from './http-util.js';
import { sniffImage } from './images.js';

export const THUMB_MAX_BYTES = 512 * 1024;
export const THUMB_MAX_SIDE = 2000;
const THUMB_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS board_thumbnails (
  board_id TEXT PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS board_templates (
  board_id TEXT PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
`;

/** Tabellen für Vorschaubilder und Vorlagen anlegen (idempotent). */
export function setupBoardExtras(db: Db) {
  db.exec(SCHEMA);
}

/** BoardInfo um `thumbnailAt` (Stand des Vorschaubilds) und `template` ergänzen. */
export function decorateBoards(db: Db, boards: BoardInfo[]): BoardInfo[] {
  if (!boards.length) return boards;
  const thumbs = new Map(
    (db.prepare('SELECT board_id, updated_at FROM board_thumbnails').all() as unknown as { board_id: string; updated_at: string }[]).map((r) => [
      r.board_id,
      r.updated_at,
    ]),
  );
  const templates = new Set((db.prepare('SELECT board_id FROM board_templates').all() as unknown as { board_id: string }[]).map((r) => r.board_id));
  return boards.map((b) => {
    const out: BoardInfo = { ...b };
    const t = thumbs.get(b.id);
    if (t) out.thumbnailAt = t;
    if (templates.has(b.id)) out.template = true;
    return out;
  });
}

/** Vorschaubild eines Boards auf ein anderes übertragen (Duplizieren). */
export function copyThumbnail(db: Db, fromId: string, toId: string) {
  db.prepare(
    `INSERT OR REPLACE INTO board_thumbnails (board_id, mime, data, width, height, updated_at)
     SELECT ?, mime, data, width, height, ? FROM board_thumbnails WHERE board_id = ?`,
  ).run(toId, nowIso(), fromId);
}

interface Deps {
  db: Db;
  boardExists: (id: string) => boolean;
  /** neues Vorschaubild → Übersichten aktualisieren (gedrosselt) */
  events?: BoardEvents;
}

/** PUT/GET /api/boards/:id/thumbnail – im Sitzungs-Bereich registrieren (preHandler requireSession gilt). */
export async function registerThumbnails(scope: FastifyInstance, { db, boardExists, events }: Deps) {
  setupBoardExtras(db);
  // eigener Kind-Bereich: Rohdaten-Parser gilt nur hier
  await scope.register(async (s) => {
    s.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: THUMB_MAX_BYTES }, (_req, body, done) => done(null, body));

    s.put<{ Params: { id: string } }>('/api/boards/:id/thumbnail', async (req, reply) => {
      if (!boardExists(req.params.id)) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || buf.length === 0) return sendError(reply, 400, 'invalid_input', 'Bitte ein Bild senden.');
      const info = sniffImage(buf);
      if (!info || !THUMB_TYPES.has(info.mime)) return sendError(reply, 415, 'unsupported_type', 'Nur PNG, JPEG oder WebP sind erlaubt.');
      if (info.width < 1 || info.height < 1 || info.width > THUMB_MAX_SIDE || info.height > THUMB_MAX_SIDE) {
        return sendError(reply, 413, 'too_large', `Das Vorschaubild darf höchstens ${THUMB_MAX_SIDE} px groß sein.`);
      }
      const now = nowIso();
      db.prepare(
        `INSERT INTO board_thumbnails (board_id, mime, data, width, height, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(board_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, width = excluded.width,
           height = excluded.height, updated_at = excluded.updated_at`,
      ).run(req.params.id, info.mime, buf, info.width, info.height, now);
      events?.emit({ type: 'updated', id: req.params.id });
      return { ok: true, thumbnailAt: now };
    });

    s.get<{ Params: { id: string }; Querystring: { v?: string } }>('/api/boards/:id/thumbnail', async (req, reply) => {
      const row = boardExists(req.params.id)
        ? (db.prepare('SELECT mime, data, updated_at FROM board_thumbnails WHERE board_id = ?').get(req.params.id) as
            | { mime: string; data: Uint8Array; updated_at: string }
            | undefined)
        : undefined;
      if (!row) return sendError(reply, 404, 'not_found', 'Kein Vorschaubild vorhanden.');
      // mit passendem ?v= (thumbnailAt) unveränderlich, sonst immer nachfragen
      const cache = req.query.v === row.updated_at ? 'private, max-age=31536000, immutable' : 'private, no-cache';
      return reply.header('Cache-Control', cache).header('Content-Disposition', 'inline').header('Content-Security-Policy', IMAGE_CSP).type(row.mime).send(Buffer.from(row.data));
    });
  });
}
