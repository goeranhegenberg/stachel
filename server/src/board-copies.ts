// Board duplizieren und als Vorlage speichern (docs/contract.md §3): Kopie des Yjs-Dokuments samt Bildern und
// Vorschaubild. Ist das Board gerade geöffnet, wird der Live-Stand kopiert, sonst der gespeicherte.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import { boardDocName, DOC_OBJECTS, type BoardInfo } from '../../shared/protocol.js';
import { nowIso, type Db } from './db.js';
import { sendError } from './http-util.js';
import { randomToken, type Session } from './sessions.js';
import { copyThumbnail, decorateBoards } from './thumbnails.js';
import type { BoardEvents } from './board-events.js';

const MAX_TITLE = 120;

export interface BoardRow {
  id: string;
  title: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

interface Deps {
  db: Db;
  hocuspocus: Hocuspocus<any>;
  imagesDir: string;
  getBoard: (id: string) => BoardRow | undefined;
  toBoard: (r: BoardRow) => BoardInfo;
  /** Kopie angelegt → Übersichten aktualisieren */
  events?: BoardEvents;
}

/** Aktueller Dokumentstand: live aus Hocuspocus, sonst aus SQLite, sonst leer. */
export function boardState(db: Db, hocuspocus: Hocuspocus<any>, boardId: string): Uint8Array | null {
  const name = boardDocName(boardId);
  const live = hocuspocus.documents.get(name);
  if (live) return Y.encodeStateAsUpdate(live);
  const row = db.prepare('SELECT state FROM documents WHERE name = ?').get(name) as { state: Uint8Array } | undefined;
  return row ? new Uint8Array(row.state) : null;
}

/** Felder eines Objekts mit einer Datei-ID aus `images`: Bild bzw. aktuelle PDF-Seite, Original-PDF (documents.ts). */
const FILE_FIELDS = ['imageId', 'docFile'] as const;
/** PDF-Seiten: Y.Map Seitennummer → Bild-ID (docs/features/documents.md) */
const PAGES_FIELD = 'docPages';

/** Schlüssel eines Objekts, die auf Dateien zeigen (für Beobachter: welche Änderung betrifft Dateien) */
export const FILE_KEYS: ReadonlySet<string> = new Set([...FILE_FIELDS, PAGES_FIELD]);

/** Alle Datei-IDs, die ein Objekt nutzt. */
export function fileRefs(m: Y.Map<unknown>): string[] {
  const out: string[] = [];
  for (const f of FILE_FIELDS) {
    const v = m.get(f);
    if (typeof v === 'string') out.push(v);
  }
  const pages = m.get(PAGES_FIELD);
  if (pages instanceof Y.Map) pages.forEach((v) => typeof v === 'string' && out.push(v));
  return out;
}

/** Bild-IDs im Dokument ersetzen (`imageId`, PDF-Original und -Seiten), liefert den neuen Stand. */
export function remapImages(state: Uint8Array, map: ReadonlyMap<string, string>): Uint8Array {
  if (!map.size) return state;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const objects = doc.getMap<Y.Map<unknown>>(DOC_OBJECTS);
  doc.transact(() => {
    objects.forEach((m) => {
      if (m instanceof Y.Map) remapObject(m, map);
    });
  });
  const out = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return out;
}

/** Datei-IDs eines Objekts nach `map` ersetzen (in der laufenden Transaktion); true = etwas geändert. */
export function remapObject(m: Y.Map<unknown>, map: ReadonlyMap<string, string>): boolean {
  let changed = false;
  for (const f of FILE_FIELDS) {
    const id = m.get(f);
    const next = typeof id === 'string' ? map.get(id) : undefined;
    if (next && next !== id) {
      m.set(f, next);
      changed = true;
    }
  }
  const pages = m.get(PAGES_FIELD);
  if (pages instanceof Y.Map) {
    for (const [k, id] of [...pages.entries()]) {
      const next = typeof id === 'string' ? map.get(id) : undefined;
      if (next && next !== id) {
        pages.set(k, next);
        changed = true;
      }
    }
  }
  return changed;
}

/** Bild-IDs aus `wanted`, die ein Objekt im Dokumentstand `state` nutzt (`imageId`, PDF-Original und -Seiten). */
export function usedImages(state: Uint8Array, wanted: ReadonlySet<string>): Set<string> {
  const used = new Set<string>();
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    doc.getMap<Y.Map<unknown>>(DOC_OBJECTS).forEach((m) => {
      if (!(m instanceof Y.Map)) return;
      for (const id of fileRefs(m)) if (wanted.has(id)) used.add(id);
    });
  } finally {
    doc.destroy();
  }
  return used;
}

export function registerBoardCopies(scope: FastifyInstance, { db, hocuspocus, imagesDir, getBoard, toBoard, events }: Deps) {
  scope.post<{ Params: { id: string } }>('/api/boards/:id/duplicate', async (req, reply) => {
    const src = getBoard(req.params.id);
    if (!src) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
    const body = (req.body ?? {}) as { title?: unknown; template?: unknown };
    if (body.title !== undefined && body.title !== null && typeof body.title !== 'string') {
      return sendError(reply, 400, 'invalid_input', 'Der Titel muss ein Text sein.');
    }
    if (body.template !== undefined && typeof body.template !== 'boolean') {
      return sendError(reply, 400, 'invalid_input', 'template muss true oder false sein.');
    }
    const asTemplate = body.template === true;
    const given = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim() : '';
    if (given.length > MAX_TITLE) return sendError(reply, 400, 'invalid_input', `Der Titel darf höchstens ${MAX_TITLE} Zeichen haben.`);
    const srcIsTemplate = Boolean(db.prepare('SELECT 1 FROM board_templates WHERE board_id = ?').get(src.id));
    // Kopie: „… (Kopie)“; Vorlage speichern bzw. Board aus Vorlage: gleicher Titel
    const title = (given || (asTemplate || srcIsTemplate ? src.title : `${src.title} (Kopie)`)).slice(0, MAX_TITLE);

    const board = await copyBoard({ db, imagesDir, toBoard, events }, src, {
      title,
      session: req.session!,
      state: boardState(db, hocuspocus, src.id),
      asTemplate,
      thumbnail: true,
    });
    return reply.code(201).send({ ok: true, board });
  });
}

/**
 * Neues Board als Kopie von `src` mit dem Dokumentstand `state` anlegen (Duplizieren, Vorlage, Version als Kopie,
 * versions.ts). Bilddateien des Quell-Boards werden mit neuen IDs kopiert; `thumbnail` übernimmt das Vorschaubild.
 */
export async function copyBoard(
  { db, imagesDir, toBoard, events }: Pick<Deps, 'db' | 'imagesDir' | 'toBoard' | 'events'>,
  src: BoardRow,
  opts: { title: string; session: Session; state: Uint8Array | null; asTemplate?: boolean; thumbnail?: boolean },
): Promise<BoardInfo> {
  const { title, asTemplate = false } = opts;
  const s = opts.session;
  const now = nowIso();
  const row: BoardRow = { id: randomToken(9), title, created_by: s.userKey, created_by_name: s.name, created_at: now, updated_at: now };

  // Bilder kopieren (neue IDs), damit Löschen des Originals die Kopie nicht beschädigt. Nur Dateien, die dem Quell-Board
  // gehören (UPL-1: fremde IDs im Dokument bleiben tot) und die der kopierte Stand wirklich nutzt (nicht gelöschte
  // Objekte oder alte Versionen: die sieht, wer nur ansehen darf, sonst auch nicht).
  const own = db.prepare('SELECT * FROM images WHERE board_id = ?').all(src.id) as unknown as {
    id: string;
    mime: string;
    width: number;
    height: number;
    bytes: number;
  }[];
  const used = opts.state ? usedImages(opts.state, new Set(own.map((i) => i.id))) : new Set<string>();
  const images = own.filter((i) => used.has(i.id));
  const map = new Map<string, string>();
  const copied: string[] = [];
  try {
    for (const img of images) {
      const from = path.join(imagesDir, img.id);
      if (!fs.existsSync(from)) continue;
      const nid = randomToken(16);
      await fs.promises.copyFile(from, path.join(imagesDir, nid));
      copied.push(nid);
      map.set(img.id, nid);
    }
    let state = opts.state;
    if (state) state = remapImages(state, map);

    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO boards (id, title, created_by, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        row.id,
        row.title,
        row.created_by,
        row.created_by_name,
        row.created_at,
        row.updated_at,
      );
      if (state) db.prepare('INSERT INTO documents (name, state, updated_at) VALUES (?, ?, ?)').run(boardDocName(row.id), state, now);
      const ins = db.prepare('INSERT INTO images (id, board_id, mime, width, height, bytes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const img of images) {
        const nid = map.get(img.id);
        if (nid) ins.run(nid, row.id, img.mime, img.width, img.height, img.bytes, s.userKey, now);
      }
      if (opts.thumbnail) copyThumbnail(db, src.id, row.id);
      if (asTemplate) db.prepare('INSERT INTO board_templates (board_id, created_at) VALUES (?, ?)').run(row.id, now);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (e) {
    await Promise.all(copied.map((id) => fs.promises.rm(path.join(imagesDir, id), { force: true })));
    throw e;
  }
  events?.emit({ type: 'created', id: row.id });
  return decorateBoards(db, [toBoard(row)])[0]!;
}
