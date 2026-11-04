// Vorschaubilder der Boards (docs/contract.md §3, P8): der **Server** rendert sie aus dem Board-Dokument
// (`ServerThumbnails`, SVG aus dem Web-Code `features/tools/thumbSvg.ts`, gerastert mit sharp/libvips und den Barlow-
// Schriften aus `server/assets/fonts`). Nach Änderungen gedrosselt neu (Ruhe `idleMs`, Abstand `minGapMs`), beim Start
// für Boards ohne Server-Vorschau nachgeholt. Private Objekte (privater Modus) liegen in eigenen Dokumenten und kommen
// nie ins Bild; ausgeliefert wird nur mit Board-Recht (Zugriffs-Wächter im Sitzungs-Bereich, access.ts).
// Gespeichert in SQLite (klein), gelöscht zusammen mit dem Board (ON DELETE CASCADE). Hochladen per PUT (alte Web-/
// App-Stände) wird nur noch quittiert, damit kein Browser-Bild mit privaten Notizen in die Übersicht gelangt.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import * as Y from 'yjs';
import type { BoardEvents } from './board-events.js';
import type { BoardInfo } from '../../shared/protocol.js';
import { nowIso, type Db } from './db.js';
import { IMAGE_CSP, sendError } from './http-util.js';
import { serializeObjects } from './native/serialize.js';
import { WEB } from '#stachel-web';

export const THUMB_MAX_BYTES = 512 * 1024;
/** Stand des Server-Renderers; ältere Zeilen (1 = vom Browser hochgeladen) werden beim Start neu gerendert */
export const THUMB_RENDERER = 2;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** höchstens so viele Bilder je Vorschau einbetten */
const MAX_IMAGES = 40;

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
  const cols = db.prepare('PRAGMA table_info(board_thumbnails)').all() as unknown as { name: string }[];
  if (!cols.some((c) => c.name === 'renderer')) db.exec('ALTER TABLE board_thumbnails ADD COLUMN renderer INTEGER NOT NULL DEFAULT 1');
}

let fontsReady = false;

/**
 * Schriften für librsvg/Pango (fontconfig): Barlow aus `server/assets/fonts` (oder `STACHEL_FONTS_DIR`), Konfiguration
 * und Cache unter dem Temp-Ordner (der Container schreibt nur nach /data und /tmp). Muss vor dem ersten Text laufen.
 */
export function setupThumbnailFonts(env: NodeJS.ProcessEnv = process.env): string | null {
  if (fontsReady) return env.FONTCONFIG_FILE ?? null;
  fontsReady = true;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [env.STACHEL_FONTS_DIR, path.resolve(process.cwd(), 'assets/fonts'), path.resolve(here, '../assets/fonts'), path.resolve(here, '../../../assets/fonts')];
  const dir = candidates.find((d) => !!d && fs.existsSync(path.join(d, 'Barlow-Regular.ttf')));
  if (!dir) return null;
  const base = path.join(os.tmpdir(), 'stachel-fontconfig');
  fs.mkdirSync(base, { recursive: true });
  const conf = path.join(base, 'fonts.conf');
  const x = (p: string) => p.replace(/\\/g, '/').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  fs.writeFileSync(
    conf,
    `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${x(dir)}</dir>\n  <cachedir>${x(path.join(base, 'cache'))}</cachedir>\n` +
      `  <alias><family>sans-serif</family><prefer><family>Barlow</family></prefer></alias>\n</fontconfig>\n`,
  );
  env.FONTCONFIG_FILE = conf;
  return conf;
}

/** Board-Hintergrund aus den Einstellungen (`tools.settings`, web settingsModel.ts). */
function backgroundOf(doc: Y.Doc): string | undefined {
  const c = doc.getMap<unknown>('tools.settings').get('color');
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : undefined;
}

/** SVG der Vorschau (Tests, Prüfungen); null = leeres Board. */
export function thumbnailSvgOf(doc: Y.Doc, images?: ReadonlyMap<string, string>) {
  const background = backgroundOf(doc);
  return WEB.thumbnail(serializeObjects(doc) as unknown as Record<string, unknown>[], { ...(background ? { background } : {}), ...(images ? { images } : {}) });
}

/** Vorschaubild eines Dokuments rendern (WebP 560 × 260); null = leeres Board. Bilder kommen über `image(id, px)`. */
export async function renderThumbnail(doc: Y.Doc, image: (imageId: string, px: number) => Promise<string | null> = async () => null): Promise<Buffer | null> {
  setupThumbnailFonts();
  const first = thumbnailSvgOf(doc);
  if (!first) return null;
  const images = new Map<string, string>();
  const wanted = new Map<string, number>();
  for (const w of first.wantedImages) wanted.set(w.imageId, Math.max(wanted.get(w.imageId) ?? 0, w.px));
  for (const [id, px] of [...wanted].slice(0, MAX_IMAGES)) {
    const uri = await image(id, px).catch(() => null);
    if (uri) images.set(id, uri);
  }
  const svg = images.size ? thumbnailSvgOf(doc, images)!.svg : first.svg;
  return sharp(Buffer.from(svg), { limitInputPixels: 50_000_000 }).webp({ quality: 84 }).toBuffer();
}

interface ServerThumbnailDeps {
  db: Db;
  imagesDir: string;
  events?: BoardEvents;
  /** Ruhe nach der letzten Speicherung, Mindestabstand zweier Vorschauen eines Boards */
  idleMs?: number;
  minGapMs?: number;
  log?: (msg: string, err?: unknown) => void;
}

/** Erzeugt Vorschaubilder nach Änderungen (gedrosselt, eins nach dem anderen) und holt fehlende nach. */
export class ServerThumbnails {
  private timers = new Map<string, NodeJS.Timeout>();
  private last = new Map<string, number>();
  private queue: string[] = [];
  private running = false;
  private stopped = false;
  private readonly idleMs: number;
  private readonly minGapMs: number;
  /** Ende der laufenden Abarbeitung (Tests) */
  idle: Promise<void> = Promise.resolve();
  private settle: (() => void) | null = null;

  constructor(private readonly deps: ServerThumbnailDeps) {
    setupBoardExtras(deps.db);
    this.idleMs = deps.idleMs ?? 5000;
    this.minGapMs = deps.minGapMs ?? 60_000;
  }

  /** Nach einer Speicherung: nach `idleMs` Ruhe neu rendern, höchstens alle `minGapMs`. */
  schedule(boardId: string) {
    if (this.stopped || !ID_RE.test(boardId)) return;
    clearTimeout(this.timers.get(boardId));
    const wait = Math.max(this.idleMs, (this.last.get(boardId) ?? 0) + this.minGapMs - Date.now());
    const t = setTimeout(() => {
      this.timers.delete(boardId);
      this.enqueue(boardId);
    }, wait);
    t.unref?.();
    this.timers.set(boardId, t);
  }

  /** Boards mit Inhalt, deren Vorschau fehlt oder vom Browser bzw. einem älteren Renderer stammt, nachholen. */
  backfill(): number {
    const rows = this.deps.db
      .prepare(
        `SELECT b.id AS id FROM boards b JOIN documents d ON d.name = 'board:' || b.id
         LEFT JOIN board_thumbnails t ON t.board_id = b.id
         WHERE b.deleted_at IS NULL AND (t.board_id IS NULL OR t.renderer < ?)
         ORDER BY b.updated_at DESC`,
      )
      .all(THUMB_RENDERER) as unknown as { id: string }[];
    for (const r of rows) this.enqueue(r.id);
    return rows.length;
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.queue = [];
  }

  private enqueue(boardId: string) {
    if (this.stopped || this.queue.includes(boardId)) return;
    this.queue.push(boardId);
    if (!this.running) {
      this.running = true;
      this.idle = new Promise((r) => (this.settle = r));
      void this.drain();
    }
  }

  private async drain() {
    try {
      while (!this.stopped && this.queue.length) {
        const id = this.queue.shift()!;
        this.last.set(id, Date.now());
        try {
          await this.render(id);
        } catch (e) {
          this.deps.log?.(`[thumbnails] ${id}: Vorschau fehlgeschlagen`, e);
        }
      }
    } finally {
      this.running = false;
      this.settle?.();
    }
  }

  /** Ein Board rendern und speichern (bzw. die Vorschau eines leeren Boards entfernen). */
  async render(boardId: string): Promise<boolean> {
    const { db } = this.deps;
    const board = db.prepare('SELECT deleted_at FROM boards WHERE id = ?').get(boardId) as { deleted_at: string | null } | undefined;
    if (!board || board.deleted_at) return false;
    const row = db.prepare('SELECT state FROM documents WHERE name = ?').get(`board:${boardId}`) as { state: Uint8Array } | undefined;
    if (!row) return false;
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, row.state);
      const buf = await renderThumbnail(doc, (id, px) => this.imageUri(boardId, id, px));
      if (!buf) {
        const gone = db.prepare('DELETE FROM board_thumbnails WHERE board_id = ?').run(boardId);
        if (Number(gone.changes) > 0) this.deps.events?.emit({ type: 'updated', id: boardId }, Date.now(), true);
        return false;
      }
      // Board inzwischen endgültig gelöscht? Dann nichts mehr schreiben (FOREIGN KEY)
      if (!db.prepare('SELECT 1 FROM boards WHERE id = ?').get(boardId)) return false;
      db.prepare(
        `INSERT INTO board_thumbnails (board_id, mime, data, width, height, updated_at, renderer) VALUES (?, 'image/webp', ?, ?, ?, ?, ?)
         ON CONFLICT(board_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, width = excluded.width,
           height = excluded.height, updated_at = excluded.updated_at, renderer = excluded.renderer`,
      ).run(boardId, buf, 560, 260, nowIso(), THUMB_RENDERER);
      this.deps.events?.emit({ type: 'updated', id: boardId }, Date.now(), true);
      return true;
    } finally {
      doc.destroy();
    }
  }

  /** Bild des Boards (nur eigene, Tabelle `images`) verkleinert als data:-URI. */
  private async imageUri(boardId: string, imageId: string, px: number): Promise<string | null> {
    if (!ID_RE.test(imageId)) return null;
    const own = this.deps.db.prepare('SELECT mime FROM images WHERE id = ? AND board_id = ?').get(imageId, boardId) as { mime: string } | undefined;
    if (!own || !own.mime.startsWith('image/')) return null;
    const file = path.join(this.deps.imagesDir, imageId);
    if (!fs.existsSync(file)) return null;
    const w = Math.max(8, Math.min(512, Math.round(px)));
    const out = await sharp(file, { limitInputPixels: 100_000_000, failOn: 'none', animated: false })
      .rotate()
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer();
    return `data:image/webp;base64,${out.toString('base64')}`;
  }
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
    `INSERT OR REPLACE INTO board_thumbnails (board_id, mime, data, width, height, updated_at, renderer)
     SELECT ?, mime, data, width, height, ?, renderer FROM board_thumbnails WHERE board_id = ?`,
  ).run(toId, nowIso(), fromId);
}

interface Deps {
  db: Db;
  boardExists: (id: string) => boolean;
  /** neues Vorschaubild → Übersichten aktualisieren (gedrosselt) */
  events?: BoardEvents;
}

/** PUT/GET /api/boards/:id/thumbnail – im Sitzungs-Bereich registrieren (preHandler requireSession gilt). */
export async function registerThumbnails(scope: FastifyInstance, { db, boardExists }: Deps) {
  setupBoardExtras(db);
  // eigener Kind-Bereich: Rohdaten-Parser gilt nur hier
  await scope.register(async (s) => {
    s.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: THUMB_MAX_BYTES }, (_req, body, done) => done(null, body));

    // Alte Web-/App-Stände laden noch hoch: quittieren, aber nichts übernehmen – der Server rendert selbst (P8), und ein
    // Browser-Bild könnte private Notizen der hochladenden Person zeigen.
    s.put<{ Params: { id: string } }>('/api/boards/:id/thumbnail', async (req, reply) => {
      if (!boardExists(req.params.id)) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
      const row = db.prepare('SELECT updated_at FROM board_thumbnails WHERE board_id = ?').get(req.params.id) as { updated_at: string } | undefined;
      return { ok: true, thumbnailAt: row?.updated_at ?? null, ignored: true };
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
