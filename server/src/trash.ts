// Papierkorb (docs/contract.md §3 „Papierkorb“): Löschen verschiebt ein Board in den Papierkorb (Spalten
// `deleted_at`, `deleted_by`, `deleted_by_name` in `boards`). Inhalt, Bilder, Vorschaubild, Favoriten, „zuletzt
// geöffnet“ und Vorlagen-Markierung bleiben unverändert liegen, damit Wiederherstellen das Board vollständig zurückholt.
// Nach TRASH_DAYS Tagen (oder von Hand) löscht der Server endgültig: Board, Dokument, Vorschaubild, alle eigenen Bilder
// und PDFs samt verkleinerten Fassungen. Andere Boards hängen nie an diesen Dateien: Einfügen über Boards hinweg legt
// Kopien an (image-binding.ts, Sicherheits-Review UPL-1) – früher gingen „noch genutzte“ Bilder auf das andere Board
// über, das unterlief das Löschen (und gab sie Personen ohne Zugriff aufs Original).
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Hocuspocus } from '@hocuspocus/server';
import { boardDocName, TRASH_DAYS, type BoardInfo, type TrashedBoardInfo } from '../../shared/protocol.js';
import { nowIso, type Db } from './db.js';
import { IMAGE_CSP, sendError } from './http-util.js';
import type { BoardRow } from './board-copies.js';
import { forgetBoardPrefs } from './board-prefs.js';
import type { BoardEvents } from './board-events.js';
import type { ImageVariants } from './image-variants.js';
import type { Session } from './sessions.js';
import { decorateBoards } from './thumbnails.js';

export const TRASH_MS = TRASH_DAYS * 24 * 3600_000;
/** So oft sucht der Server nach abgelaufenen Boards (dazu einmal kurz nach dem Start). */
const PURGE_EVERY_MS = 3600_000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface TrashRow extends BoardRow {
  deleted_at: string | null;
  deleted_by: string | null;
  deleted_by_name: string | null;
}

/** Additive Migration: drei Spalten in `boards` (fehlen = nicht gelöscht). Bestehende Boards bleiben sichtbar. */
export function setupTrash(db: Db) {
  const have = new Set((db.prepare('PRAGMA table_info(boards)').all() as unknown as { name: string }[]).map((c) => c.name));
  for (const col of ['deleted_at', 'deleted_by', 'deleted_by_name']) {
    if (!have.has(col)) db.exec(`ALTER TABLE boards ADD COLUMN ${col} TEXT`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS boards_deleted_at ON boards(deleted_at)');
}

interface Deps {
  db: Db;
  hocuspocus: Hocuspocus<any>;
  imagesDir: string;
  variants: ImageVariants;
  events: BoardEvents;
  /** offene Editoren benachrichtigen und trennen (sync.ts) */
  dropBoard: (boardId: string, by: { name: string; key: string }) => void;
  toBoard: (r: BoardRow) => BoardInfo;
  /** weitere Daten des Boards beim endgültigen Löschen entfernen (in der Transaktion), z. B. Versionen */
  onPurge?: (boardId: string) => void;
  log?: (msg: string, err?: unknown) => void;
  /** Modus local: nur diese Boards zeigen (access.ts: eigene); fehlt = alle */
  visible?: (s: Who, boardId: string) => boolean;
  /** Uhr (Tests) */
  now?: () => number;
}

type Who = Pick<Session, 'userKey' | 'name' | 'isOrga'>;

export class Trash {
  private timer: ReturnType<typeof setInterval> | null = null;
  private first: ReturnType<typeof setTimeout> | null = null;
  private purging: Promise<number> | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? Date.now;
  }

  /** Board im Papierkorb (sonst undefined). */
  get(id: string): TrashRow | undefined {
    if (!ID_RE.test(id)) return undefined;
    return this.deps.db.prepare('SELECT * FROM boards WHERE id = ? AND deleted_at IS NOT NULL').get(id) as TrashRow | undefined;
  }

  isTrashed(id: string): boolean {
    return ID_RE.test(id) && Boolean(this.deps.db.prepare('SELECT 1 FROM boards WHERE id = ? AND deleted_at IS NOT NULL').get(id));
  }

  /** Wiederherstellen und endgültig löschen: wer es angelegt oder gelöscht hat, und die Orga. */
  canManage(row: TrashRow, s: Who): boolean {
    return s.isOrga || row.created_by === s.userKey || row.deleted_by === s.userKey;
  }

  info(row: TrashRow, s: Who, base = decorateBoards(this.deps.db, [this.deps.toBoard(row)])[0]!): TrashedBoardInfo {
    const deletedAt = row.deleted_at ?? nowIso();
    return {
      ...base,
      deletedAt,
      deletedBy: row.deleted_by ?? '',
      deletedByName: row.deleted_by_name ?? '',
      purgeAt: new Date(Date.parse(deletedAt) + TRASH_MS).toISOString(),
      canManage: this.canManage(row, s),
    };
  }

  /** Alle Boards im Papierkorb, zuletzt gelöschtes zuerst. */
  list(s: Who): TrashedBoardInfo[] {
    const all = this.deps.db.prepare('SELECT * FROM boards WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all() as unknown as TrashRow[];
    const rows = this.deps.visible ? all.filter((r) => this.deps.visible!(s, r.id)) : all;
    const bases = decorateBoards(this.deps.db, rows.map(this.deps.toBoard));
    return rows.map((r, i) => this.info(r, s, bases[i]));
  }

  /** Board in den Papierkorb (DELETE /api/boards/:id). Offene Editoren bekommen board.deleted und werden getrennt. */
  moveToTrash(board: BoardRow, s: Who): TrashedBoardInfo | null {
    const at = new Date(this.now()).toISOString();
    const res = this.deps.db
      .prepare('UPDATE boards SET deleted_at = ?, deleted_by = ?, deleted_by_name = ? WHERE id = ? AND deleted_at IS NULL')
      .run(at, s.userKey, s.name, board.id);
    if (!res.changes) return null;
    this.deps.dropBoard(board.id, { name: s.name, key: s.userKey });
    this.deps.events.emit({ type: 'deleted', id: board.id, by: s.name, byKey: s.userKey });
    const row = this.get(board.id);
    return row ? this.info(row, s) : null;
  }

  /** Zurückholen: Board erscheint wieder in der Liste, samt Inhalt, Bildern, Favoriten, Vorschaubild. */
  restore(row: TrashRow, s: Who): BoardInfo | null {
    const res = this.deps.db
      .prepare('UPDATE boards SET deleted_at = NULL, deleted_by = NULL, deleted_by_name = NULL WHERE id = ? AND deleted_at IS NOT NULL')
      .run(row.id);
    if (!res.changes) return null;
    this.deps.events.emit({ type: 'restored', id: row.id, by: s.name, byKey: s.userKey });
    return decorateBoards(this.deps.db, [this.deps.toBoard(row)])[0]!;
  }

  /**
   * Endgültig löschen (nur Boards im Papierkorb): alle Dateien des Boards und ihre Varianten. Vorschaubild,
   * Vorlagen-Markierung und Kopie-Vermerke (image_copies) verschwinden per ON DELETE CASCADE.
   */
  async purge(id: string): Promise<boolean> {
    const { db, hocuspocus, imagesDir, variants } = this.deps;
    if (!this.isTrashed(id)) return false;
    const images = (db.prepare('SELECT id FROM images WHERE board_id = ?').all(id) as unknown as { id: string }[]).map((i) => i.id);
    db.exec('BEGIN');
    try {
      const res = db.prepare('DELETE FROM boards WHERE id = ? AND deleted_at IS NOT NULL').run(id);
      if (!res.changes) {
        db.exec('ROLLBACK');
        return false;
      }
      db.prepare('DELETE FROM documents WHERE name = ?').run(boardDocName(id));
      db.prepare('DELETE FROM images WHERE board_id = ?').run(id);
      forgetBoardPrefs(db, id);
      this.deps.onPurge?.(id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    // falls das Dokument noch geladen ist (Speichern beim Entladen lief noch): nicht wieder anlegen lassen
    hocuspocus.closeConnections(boardDocName(id));
    this.deps.events.emit({ type: 'purged', id });
    await Promise.all(images.flatMap((i) => [fs.promises.rm(path.join(imagesDir, i), { force: true }), variants.remove(i)]));
    return true;
  }

  /** Alles endgültig löschen, was länger als TRASH_DAYS im Papierkorb liegt. Liefert die Anzahl. */
  purgeExpired(now = this.now()): Promise<number> {
    // nie zwei Läufe gleichzeitig (Zeitgeber und Test bzw. langsame Platte)
    this.purging ??= (async () => {
      const limit = new Date(now - TRASH_MS).toISOString();
      const ids = (this.deps.db.prepare('SELECT id FROM boards WHERE deleted_at IS NOT NULL AND deleted_at <= ?').all(limit) as unknown as { id: string }[]).map(
        (r) => r.id,
      );
      let n = 0;
      for (const id of ids) {
        try {
          if (await this.purge(id)) n++;
        } catch (e) {
          this.deps.log?.(`Board ${id} ließ sich nicht endgültig löschen`, e);
        }
      }
      return n;
    })().finally(() => (this.purging = null));
    return this.purging;
  }

  /** Aufräum-Job starten (stündlich, erster Lauf kurz nach dem Start). */
  start() {
    const run = () => void this.purgeExpired().catch((e) => this.deps.log?.('Papierkorb-Aufräumen fehlgeschlagen', e));
    this.first = setTimeout(run, 5_000);
    this.first.unref();
    this.timer = setInterval(run, PURGE_EVERY_MS);
    this.timer.unref();
  }

  async stop() {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
    this.first = this.timer = null;
    await this.purging?.catch(() => {});
  }

  /**
   * preHandler für alle Routen `/api/boards/:id…`: Boards im Papierkorb lassen sich nicht bearbeiten, kopieren,
   * favorisieren oder erneut löschen → 410 `in_trash` (statt 404, damit der Client „im Papierkorb“ sagen kann).
   */
  guard = async (req: FastifyRequest, reply: FastifyReply) => {
    const route = req.routeOptions?.url ?? '';
    if (!route.startsWith('/api/boards/:id')) return;
    const id = (req.params as { id?: unknown } | undefined)?.id;
    if (typeof id === 'string' && this.isTrashed(id)) return sendError(reply, 410, 'in_trash', 'Dieses Board liegt im Papierkorb.');
  };
}

/** Routen unter `/api/trash` (im Scope mit Sitzungsprüfung registrieren). */
export function registerTrash(scope: FastifyInstance, trash: Trash, db: Db) {
  const notInTrash = (reply: FastifyReply) => sendError(reply, 404, 'not_found', 'Dieses Board liegt nicht im Papierkorb.');
  const forbidden = (reply: FastifyReply) =>
    sendError(reply, 403, 'forbidden', 'Nur wer das Board angelegt oder gelöscht hat oder die Orga darf das.');

  scope.get('/api/trash', async (req) => ({ ok: true, boards: trash.list(req.session!) }));

  scope.get<{ Params: { id: string } }>('/api/trash/:id', async (req, reply) => {
    const row = trash.get(req.params.id);
    if (!row) return notInTrash(reply);
    return { ok: true, board: trash.info(row, req.session!) };
  });

  // Vorschaubild für die Karte im Papierkorb (GET /api/boards/:id/thumbnail ist für gelöschte Boards gesperrt)
  scope.get<{ Params: { id: string }; Querystring: { v?: string } }>('/api/trash/:id/thumbnail', async (req, reply) => {
    const row = trash.get(req.params.id)
      ? (db.prepare('SELECT mime, data, updated_at FROM board_thumbnails WHERE board_id = ?').get(req.params.id) as
          | { mime: string; data: Uint8Array; updated_at: string }
          | undefined)
      : undefined;
    if (!row) return sendError(reply, 404, 'not_found', 'Kein Vorschaubild vorhanden.');
    const cache = req.query.v === row.updated_at ? 'private, max-age=31536000, immutable' : 'private, no-cache';
    return reply
      .header('Cache-Control', cache)
      .header('Content-Disposition', 'inline')
      .header('Content-Security-Policy', IMAGE_CSP)
      .type(row.mime)
      .send(Buffer.from(row.data));
  });

  scope.post<{ Params: { id: string } }>('/api/trash/:id/restore', async (req, reply) => {
    const row = trash.get(req.params.id);
    if (!row) return notInTrash(reply);
    if (!trash.canManage(row, req.session!)) return forbidden(reply);
    const board = trash.restore(row, req.session!);
    if (!board) return notInTrash(reply);
    return { ok: true, board };
  });

  scope.delete<{ Params: { id: string } }>('/api/trash/:id', async (req, reply) => {
    const row = trash.get(req.params.id);
    if (!row) return notInTrash(reply);
    if (!trash.canManage(row, req.session!)) return forbidden(reply);
    if (!(await trash.purge(row.id))) return notInTrash(reply);
    return { ok: true };
  });

  // Papierkorb leeren: alle Boards, die die Person verwalten darf (Orga: alle)
  scope.delete('/api/trash', async (req) => {
    const s = req.session!;
    let purged = 0;
    for (const b of trash.list(s)) if (b.canManage && (await trash.purge(b.id))) purged++;
    return { ok: true, purged };
  });
}
