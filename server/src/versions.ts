// Versionsverlauf (docs/contract.md §3 „Versionen“): automatische Schnappschüsse des Yjs-Dokuments je Board,
// benannte Versionen, Vorschau, Wiederherstellen (ändert das Live-Dokument für alle) und Kopie als neues Board.
//
// Takt: Ein Board, das sich seit der letzten Version geändert hat, bekommt höchstens alle `intervalMs` (10 min) eine
// neue Version, solange jemand daran arbeitet, und eine, sobald die letzte Person das Board verlässt. Beim Laden wird
// ein Stand gesichert, den noch keine Version kennt (erstes Öffnen eines alten Boards, Absturz vor dem Verlassen).
// Ausdünnen: letzte 24 h alle, bis 30 Tage eine je Stunde, bis 1 Jahr eine je Tag, danach keine; benannte nie.
// Speicher: Jede Version ist ein kompakter Neuaufbau des Inhalts (ohne Bearbeitungsverlauf/Grabsteine), Brotli-komprimiert.
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import type { Extension, Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import { boardDocName, DOC_OBJECTS, type BoardInfo, type BoardVersionInfo, type BoardVersionKind, type BoardVersionPerson } from '../../shared/protocol.js';
import type { Db } from './db.js';
import { sendError } from './http-util.js';
import { randomToken } from './sessions.js';
import { copyBoard, type BoardRow } from './board-copies.js';
import type { BoardEvents } from './board-events.js';

export const VERSION_INTERVAL_MS = 10 * 60_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const MAX_NAME = 120;
const MAX_PEOPLE = 30;
/** Ausdünnen aller Boards (nur Kennzahlen, keine Inhalte gelesen) */
const THIN_EVERY_MS = HOUR;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS board_versions (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,             -- auto | manual | backup | restored
  name TEXT,                      -- gesetzt = benannt, wird nie ausgedünnt
  people TEXT NOT NULL,           -- JSON [{key,name}]: wer seit der vorigen Version geändert hat
  by_key TEXT,                    -- wer gespeichert/wiederhergestellt hat
  by_name TEXT,
  restored_from TEXT,             -- created_at der wiederhergestellten Version (kind = restored)
  objects INTEGER NOT NULL,
  bytes INTEGER NOT NULL,         -- Größe von state
  mark TEXT NOT NULL,             -- Abdruck des Live-Dokuments (SHA-256 von Zustandsvektor + Löschmenge): gleich = unverändert
  state BLOB NOT NULL             -- kompakter Yjs-Stand, Brotli-komprimiert
);
CREATE INDEX IF NOT EXISTS board_versions_board ON board_versions(board_id, created_at);
`;

interface VersionRow {
  id: string;
  board_id: string;
  created_at: string;
  kind: BoardVersionKind;
  name: string | null;
  people: string;
  by_key: string | null;
  by_name: string | null;
  restored_from: string | null;
  objects: number;
  bytes: number;
}

const INFO_COLS = 'id, board_id, created_at, kind, name, people, by_key, by_name, restored_from, objects, bytes';

function toInfo(r: VersionRow): BoardVersionInfo {
  let people: BoardVersionPerson[] = [];
  try {
    const p = JSON.parse(r.people) as unknown;
    if (Array.isArray(p)) people = p.filter((x): x is BoardVersionPerson => typeof x?.key === 'string' && typeof x?.name === 'string');
  } catch {
    // kaputt: ohne Personen
  }
  return {
    id: r.id,
    createdAt: r.created_at,
    kind: r.kind,
    name: r.name,
    people,
    by: r.by_key ? { key: r.by_key, name: r.by_name ?? '' } : null,
    restoredFrom: r.restored_from,
    objects: r.objects,
    bytes: r.bytes,
  };
}

/** Versionen eines Boards löschen (Board endgültig gelöscht, Papierkorb geleert). */
export function forgetVersions(db: Db, boardId: string) {
  db.prepare('DELETE FROM board_versions WHERE board_id = ?').run(boardId);
}

// ---------- Ausdünnen ----------

/**
 * Welche Versionen beim Ausdünnen wegfallen: jünger als 24 h alle behalten, bis 30 Tage die jüngste je Stunde, bis
 * 1 Jahr die jüngste je Tag, ältere gar nicht. Benannte Versionen bleiben immer (zählen aber in keinem Eimer mit).
 */
export function versionsToThin(list: readonly { id: string; at: number; named: boolean }[], now: number): string[] {
  const drop: string[] = [];
  const kept = new Set<string>();
  // jüngste zuerst: die erste je Eimer bleibt
  const sorted = [...list].sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  for (const v of sorted) {
    if (v.named) continue;
    const age = now - v.at;
    if (age < DAY) continue;
    if (age >= 365 * DAY) {
      drop.push(v.id);
      continue;
    }
    const bucket = age < 30 * DAY ? `h${Math.floor(v.at / HOUR)}` : `d${Math.floor(v.at / DAY)}`;
    if (kept.has(bucket)) drop.push(v.id);
    else kept.add(bucket);
  }
  return drop;
}

// ---------- Inhalt kopieren (Schnappschuss, Wiederherstellen) ----------

export type Kind = 'map' | 'array' | 'text' | 'xml';

/** Art einer Wurzel-Struktur. Der Server kennt die Strukturen der Feature-Module nicht: ungetypte erkennt er am Inhalt. */
export function kindOf(t: Y.AbstractType<any> | undefined): Kind | null {
  if (!t) return null;
  if (t instanceof Y.Map) return 'map';
  if (t instanceof Y.Array) return 'array';
  if (t instanceof Y.XmlFragment) return 'xml';
  if (t instanceof Y.Text) return 'text';
  if (t._map.size > 0) return 'map';
  for (let it: Y.Item | null = t._start; it; it = it.right) {
    const c = it.content;
    if (c instanceof Y.ContentDeleted) continue;
    if (c instanceof Y.ContentString || c instanceof Y.ContentFormat || c instanceof Y.ContentEmbed) return 'text';
    if (c instanceof Y.ContentType && (c.type instanceof Y.XmlElement || c.type instanceof Y.XmlText)) return 'xml';
    return 'array';
  }
  return null;
}

export function typed(doc: Y.Doc, name: string, kind: Kind): Y.AbstractType<any> {
  switch (kind) {
    case 'map':
      return doc.getMap(name);
    case 'array':
      return doc.getArray(name);
    case 'text':
      return doc.getText(name);
    case 'xml':
      return doc.getXmlFragment(name);
  }
}

/** Vergleichbarer Abdruck eines Werts (Y-Typen mit Art, Schlüssel sortiert). */
function print(v: unknown): unknown {
  if (v instanceof Y.Map) {
    const o: Record<string, unknown> = {};
    for (const k of [...v.keys()].sort()) o[k] = print(v.get(k));
    return { $map: o };
  }
  if (v instanceof Y.Array) return { $arr: v.toArray().map(print) };
  if (v instanceof Y.XmlFragment || v instanceof Y.XmlElement) return { $xml: v.toString() };
  if (v instanceof Y.Text) return { $text: v.toDelta() };
  if (v instanceof Uint8Array) return { $bin: Buffer.from(v).toString('base64') };
  return v === undefined ? null : v;
}

const same = (a: unknown, b: unknown) => JSON.stringify(print(a)) === JSON.stringify(print(b));

function cloneValue(v: unknown): unknown {
  if (v instanceof Y.AbstractType) return v.clone();
  if (v instanceof Uint8Array) return new Uint8Array(v);
  return v;
}

/** Y.Map `t` auf den Inhalt von `s` bringen; unveränderte Einträge bleiben unangetastet (kleine Änderung für alle). */
function syncMap(t: Y.Map<unknown>, s: Y.Map<unknown>) {
  for (const k of [...t.keys()]) if (!s.has(k)) t.delete(k);
  for (const [k, sv] of s.entries()) {
    const tv = t.get(k);
    if (sv instanceof Y.Map && tv instanceof Y.Map) syncMap(tv, sv);
    else if (!t.has(k) || !same(tv, sv)) t.set(k, cloneValue(sv));
  }
}

/**
 * Inhalt von `source` in `target` übernehmen (im laufenden `transact` des Aufrufers): danach hat `target` denselben
 * Inhalt wie `source`. Es entstehen nur Änderungen für tatsächlich abweichende Einträge; alle Strukturen
 * (`objects`, `collab.*` …) werden erfasst.
 */
export function applyContent(target: Y.Doc, source: Y.Doc) {
  const names = new Set([...source.share.keys(), ...target.share.keys()]);
  for (const name of names) {
    const kind = kindOf(source.share.get(name)) ?? kindOf(target.share.get(name));
    if (!kind) continue;
    let t: Y.AbstractType<any>;
    let s: Y.AbstractType<any>;
    try {
      s = typed(source, name, kind);
      t = typed(target, name, kind);
    } catch {
      continue; // in einem der beiden Dokumente schon mit anderer Art angelegt: nicht anfassen
    }
    if (kind === 'map') {
      syncMap(t as Y.Map<unknown>, s as Y.Map<unknown>);
      continue;
    }
    if (same(t, s)) continue;
    if (kind === 'text') {
      const tt = t as Y.Text;
      tt.delete(0, tt.length);
      tt.applyDelta((s as Y.Text).toDelta());
    } else if (kind === 'array') {
      const ta = t as Y.Array<unknown>;
      ta.delete(0, ta.length);
      ta.insert(0, (s as Y.Array<unknown>).toArray().map(cloneValue));
    } else {
      const tx = t as Y.XmlFragment;
      tx.delete(0, tx.length);
      tx.insert(
        0,
        (s as Y.XmlFragment).toArray().map((c) => c.clone() as Y.XmlElement | Y.XmlText),
      );
    }
  }
}

/** Kompakter Stand: Inhalt in ein frisches Dokument übernommen (ohne Verlauf und gelöschte Einträge). */
export function compactState(doc: Y.Doc): { state: Uint8Array; objects: number } {
  const out = new Y.Doc();
  try {
    out.transact(() => applyContent(out, doc));
    return { state: Y.encodeStateAsUpdate(out), objects: out.share.has(DOC_OBJECTS) ? out.getMap(DOC_OBJECTS).size : 0 };
  } finally {
    out.destroy();
  }
}

const compress = (b: Uint8Array) =>
  zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } });
const decompress = (b: Uint8Array) => new Uint8Array(zlib.brotliDecompressSync(b));
/** Gespeicherten Stand packen/entpacken (forget-person.ts schreibt gesicherte Stände ohne Namen neu). */
export const packState = compress;
export const unpackState = decompress;
/**
 * Abdruck des Dokumentstands: Zustandsvektor plus Löschmenge (ein reines Löschen ändert den Zustandsvektor nicht).
 * Gleicher Abdruck = keine Änderung seit der Version.
 */
export const docMark = (doc: Y.Doc) => createHash('sha256').update(Y.encodeSnapshot(Y.snapshot(doc))).digest('base64url');

// ---------- Versionen je Board ----------

interface Track {
  /** erste Änderung seit der letzten Version (ms) */
  dirtySince: number | null;
  /** wer seitdem geändert hat (Schlüssel → Name) */
  people: Map<string, string>;
}

export interface VersionOptions {
  intervalMs?: number;
  now?: () => number;
}

export class BoardVersions {
  private readonly tracks = new Map<string, Track>();
  private hp: Hocuspocus<any> | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private readonly intervalMs: number;
  private readonly now: () => number;

  constructor(
    private readonly db: Db,
    opts: VersionOptions = {},
  ) {
    this.intervalMs = opts.intervalMs ?? VERSION_INTERVAL_MS;
    this.now = opts.now ?? Date.now;
    db.exec(SCHEMA);
  }

  /** Hocuspocus-Erweiterung: merkt Änderungen, sichert beim Laden und wenn die letzte Person geht. */
  readonly hooks: Extension = {
    afterLoadDocument: async ({ documentName, document }) => {
      const id = boardOf(documentName);
      if (id) this.guard(() => this.snapshot(id, document, 'auto'));
    },
    onChange: async ({ documentName, context }) => {
      const id = boardOf(documentName);
      if (id) this.changed(id, (context as { user?: BoardVersionPerson } | undefined)?.user);
    },
    onDisconnect: async ({ documentName, document }) => {
      const id = boardOf(documentName);
      if (id && document.getConnectionsCount() === 0) this.guard(() => this.snapshot(id, document, 'auto'));
    },
    afterUnloadDocument: async ({ documentName }) => {
      const id = boardOf(documentName);
      if (id && !this.hp?.documents.has(documentName)) this.tracks.delete(id);
    },
  };

  /** Mit dem Sync-Server verbinden und den Takt starten. */
  attach(hp: Hocuspocus<any>) {
    this.hp = hp;
    const tick = setInterval(() => this.tick(), Math.min(60_000, Math.max(50, this.intervalMs / 4)));
    const thin = setInterval(() => this.guard(() => this.thinAll()), THIN_EVERY_MS);
    tick.unref();
    thin.unref();
    this.timers.push(tick, thin);
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private guard(fn: () => void) {
    try {
      fn();
    } catch (e) {
      console.error('[versions]', e);
    }
  }

  /** Konto gelöscht: Name in den noch nicht gesicherten Personenlisten ersetzen (forget-person.ts). */
  renamePerson(userKey: string, name: string) {
    for (const t of this.tracks.values()) {
      if (t.people.has(userKey)) t.people.set(userKey, name);
      if (t.people.has(`ai:${userKey}`)) t.people.set(`ai:${userKey}`, `KI (für ${name})`);
    }
  }

  changed(boardId: string, user?: BoardVersionPerson | null) {
    let t = this.tracks.get(boardId);
    if (!t) this.tracks.set(boardId, (t = { dirtySince: null, people: new Map() }));
    t.dirtySince ??= this.now();
    if (user?.key && t.people.size < MAX_PEOPLE) t.people.set(user.key, String(user.name ?? ''));
  }

  /** Geöffnete Boards, die seit `intervalMs` Änderungen ohne Version haben, sichern. */
  tick() {
    if (!this.hp) return;
    const now = this.now();
    for (const [name, doc] of this.hp.documents) {
      const id = boardOf(name);
      const t = id ? this.tracks.get(id) : undefined;
      if (id && t?.dirtySince != null && now - t.dirtySince >= this.intervalMs) this.guard(() => this.snapshot(id, doc, 'auto'));
    }
  }

  private latest(boardId: string): { id: string; mark: string; kind: string; name: string | null } | undefined {
    return this.db
      .prepare('SELECT id, mark, kind, name FROM board_versions WHERE board_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(boardId) as { id: string; mark: string; kind: string; name: string | null } | undefined;
  }

  /**
   * Version des Dokuments anlegen. Ohne `force` nur, wenn es sich seit der letzten Version geändert hat (docMark)
   * und nicht leer ist (neues Board). Liefert die neue Version oder null.
   */
  snapshot(
    boardId: string,
    doc: Y.Doc,
    kind: BoardVersionKind,
    opts: { force?: boolean; name?: string | null; by?: BoardVersionPerson | null; restoredFrom?: string | null } = {},
  ): BoardVersionInfo | null {
    if (!this.db.prepare('SELECT 1 FROM boards WHERE id = ?').get(boardId)) return null; // Board gelöscht
    const mark = docMark(doc);
    const last = this.latest(boardId);
    const track = this.tracks.get(boardId);
    if (!opts.force && last && last.mark === mark) {
      if (track) {
        track.dirtySince = null;
        track.people.clear();
      }
      return null;
    }
    const { state, objects } = compactState(doc);
    if (!opts.force && !last && objects === 0 && state.length <= 2) return null; // leeres Board, nichts zu sichern
    const packed = compress(state);
    const people = [...(track?.people ?? [])].map(([key, name]) => ({ key, name }));
    const row = {
      id: randomToken(12),
      created_at: new Date(this.now()).toISOString(),
      kind,
      name: opts.name ?? null,
      people: JSON.stringify(people),
      by_key: opts.by?.key ?? null,
      by_name: opts.by?.name ?? null,
      restored_from: opts.restoredFrom ?? null,
      objects,
      bytes: packed.length,
    };
    this.db
      .prepare(
        `INSERT INTO board_versions (id, board_id, created_at, kind, name, people, by_key, by_name, restored_from, objects, bytes, mark, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, boardId, row.created_at, row.kind, row.name, row.people, row.by_key, row.by_name, row.restored_from, row.objects, row.bytes, mark, packed);
    if (track) {
      track.dirtySince = null;
      track.people.clear();
    }
    this.thin(boardId);
    return toInfo({ ...row, board_id: boardId });
  }

  thin(boardId: string) {
    const rows = this.db.prepare('SELECT id, created_at, name FROM board_versions WHERE board_id = ?').all(boardId) as unknown as {
      id: string;
      created_at: string;
      name: string | null;
    }[];
    const drop = versionsToThin(
      rows.map((r) => ({ id: r.id, at: Date.parse(r.created_at), named: r.name !== null })),
      this.now(),
    );
    if (!drop.length) return;
    const del = this.db.prepare('DELETE FROM board_versions WHERE id = ?');
    this.db.exec('BEGIN');
    try {
      for (const id of drop) del.run(id);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Alle Boards ausdünnen; Versionen endgültig gelöschter Boards entfernen (Papierkorb-Boards bleiben in `boards`). */
  thinAll() {
    this.db.exec('DELETE FROM board_versions WHERE board_id NOT IN (SELECT id FROM boards)');
    const boards = this.db.prepare('SELECT DISTINCT board_id FROM board_versions').all() as unknown as { board_id: string }[];
    for (const b of boards) this.thin(b.board_id);
  }

  list(boardId: string): BoardVersionInfo[] {
    const rows = this.db
      .prepare(`SELECT ${INFO_COLS} FROM board_versions WHERE board_id = ? ORDER BY created_at DESC, rowid DESC`)
      .all(boardId) as unknown as VersionRow[];
    return rows.map(toInfo);
  }

  info(boardId: string, versionId: string): BoardVersionInfo | null {
    const row = this.db.prepare(`SELECT ${INFO_COLS} FROM board_versions WHERE board_id = ? AND id = ?`).get(boardId, versionId) as VersionRow | undefined;
    return row ? toInfo(row) : null;
  }

  /** Gespeicherter Stand (Brotli) einer Version. */
  packed(boardId: string, versionId: string): Uint8Array | null {
    const row = this.db.prepare('SELECT state FROM board_versions WHERE board_id = ? AND id = ?').get(boardId, versionId) as { state: Uint8Array } | undefined;
    return row ? new Uint8Array(row.state) : null;
  }

  /** Yjs-Update einer Version (entpackt). */
  content(boardId: string, versionId: string): Uint8Array | null {
    const p = this.packed(boardId, versionId);
    return p ? decompress(p) : null;
  }

  rename(boardId: string, versionId: string, name: string | null): BoardVersionInfo | null {
    const res = this.db.prepare('UPDATE board_versions SET name = ? WHERE board_id = ? AND id = ?').run(name, boardId, versionId);
    if (!res.changes) return null;
    if (name === null) this.thin(boardId);
    return this.info(boardId, versionId);
  }

  /** Dokument kurz direkt öffnen (geladen bzw. aus SQLite), `fn` ausführen, wieder freigeben (speichert). */
  private async withDoc<T>(boardId: string, by: BoardVersionPerson, fn: (conn: { doc: Y.Doc; transact: (f: (d: Y.Doc) => void) => Promise<void> }) => Promise<T> | T): Promise<T> {
    if (!this.hp) throw new Error('versions: nicht mit dem Sync-Server verbunden');
    const conn = await this.hp.openDirectConnection(boardDocName(boardId), { user: { key: by.key, name: by.name } });
    try {
      return await fn({ doc: conn.document!, transact: (f) => conn.transact(f) });
    } finally {
      await conn.disconnect();
    }
  }

  /**
   * „Version speichern“: aktuellen Stand mit Namen sichern. Ist der Stand seit der letzten Version unverändert und
   * diese noch unbenannt, bekommt sie den Namen (keine doppelte Kopie).
   */
  async saveNamed(boardId: string, name: string, by: BoardVersionPerson): Promise<BoardVersionInfo | null> {
    return this.withDoc(boardId, by, ({ doc }) => {
      const last = this.latest(boardId);
      if (last && last.name === null && last.mark === docMark(doc)) {
        this.db.prepare('UPDATE board_versions SET name = ?, by_key = COALESCE(by_key, ?), by_name = COALESCE(by_name, ?) WHERE id = ?').run(name, by.key, by.name, last.id);
        return this.info(boardId, last.id);
      }
      return this.snapshot(boardId, doc, 'manual', { force: true, name, by });
    });
  }

  /**
   * Version wiederherstellen: erst den aktuellen Stand sichern (falls keine Version ihn kennt), dann das Live-Dokument
   * auf den alten Inhalt bringen – alle Verbundenen sehen es sofort (normale Yjs-Änderung). `null` = Version unbekannt.
   */
  async restore(
    boardId: string,
    versionId: string,
    by: BoardVersionPerson,
  ): Promise<{ backup: BoardVersionInfo | null; restored: BoardVersionInfo | null; changed: boolean } | null> {
    const source = this.info(boardId, versionId);
    const content = source && this.content(boardId, versionId);
    if (!source || !content) return null;
    const old = new Y.Doc();
    try {
      Y.applyUpdate(old, content);
      return await this.withDoc(boardId, by, async ({ doc, transact }) => {
        this.changed(boardId); // wer seit der letzten Version geändert hat, steht in der Sicherung
        const backup = this.snapshot(boardId, doc, 'backup', { by });
        const before = docMark(doc);
        await transact((d) => applyContent(d, old));
        // onChange-Hooks laufen als Mikrotask: abwarten, damit die Person nicht in der nächsten Version auftaucht
        await new Promise((r) => setImmediate(r));
        const changed = before !== docMark(doc);
        const restored = changed ? this.snapshot(boardId, doc, 'restored', { force: true, by, restoredFrom: source.createdAt }) : null;
        return { backup, restored, changed };
      });
    } finally {
      old.destroy();
    }
  }
}

function boardOf(documentName: string): string | null {
  return /^board:([A-Za-z0-9_-]{1,64})$/.exec(documentName)?.[1] ?? null;
}

// ---------- HTTP ----------

interface Deps {
  db: Db;
  versions: BoardVersions;
  imagesDir: string;
  getBoard: (id: string) => BoardRow | undefined;
  toBoard: (r: BoardRow) => BoardInfo;
  events?: BoardEvents;
}

const VERSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** undefined = nicht angegeben, null = ungültig, '' = Name entfernen. */
function readName(body: unknown): string | null | undefined {
  const n = (body as { name?: unknown } | null)?.name;
  if (n === undefined) return undefined;
  if (n === null) return '';
  if (typeof n !== 'string') return null;
  const s = n.replace(/\s+/g, ' ').trim();
  return s.length > MAX_NAME ? null : s;
}

export function registerVersions(scope: FastifyInstance, { db, versions, imagesDir, getBoard, toBoard, events }: Deps) {
  const NOT_FOUND = 'Diese Version gibt es nicht (mehr).';
  const findBoard = (id: string) => getBoard(id);
  const person = (s: { userKey: string; name: string }): BoardVersionPerson => ({ key: s.userKey, name: s.name });

  scope.get<{ Params: { id: string } }>('/api/boards/:id/versions', async (req, reply) => {
    const board = findBoard(req.params.id);
    if (!board) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
    return { ok: true, versions: versions.list(board.id) };
  });

  scope.post<{ Params: { id: string } }>('/api/boards/:id/versions', async (req, reply) => {
    const board = findBoard(req.params.id);
    if (!board) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
    const name = readName(req.body);
    if (!name) return sendError(reply, 400, 'invalid_input', `Bitte gib der Version einen Namen (höchstens ${MAX_NAME} Zeichen).`);
    const v = await versions.saveNamed(board.id, name, person(req.session!));
    if (!v) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
    return reply.code(201).send({ ok: true, version: v });
  });

  scope.get<{ Params: { id: string; vid: string } }>('/api/boards/:id/versions/:vid', async (req, reply) => {
    const board = findBoard(req.params.id);
    const packed = board && VERSION_ID.test(req.params.vid) ? versions.packed(board.id, req.params.vid) : null;
    if (!packed) return sendError(reply, 404, 'not_found', NOT_FOUND);
    reply
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('Vary', 'Accept-Encoding')
      .type('application/octet-stream');
    // gespeichert ist Brotli: direkt ausliefern, wenn der Browser es kann
    if (/\bbr\b/.test(String(req.headers['accept-encoding'] ?? ''))) return reply.header('Content-Encoding', 'br').send(Buffer.from(packed));
    return reply.send(Buffer.from(decompress(packed)));
  });

  scope.patch<{ Params: { id: string; vid: string } }>('/api/boards/:id/versions/:vid', async (req, reply) => {
    const board = findBoard(req.params.id);
    if (!board || !VERSION_ID.test(req.params.vid)) return sendError(reply, 404, 'not_found', NOT_FOUND);
    const name = readName(req.body);
    if (name === undefined || name === null) return sendError(reply, 400, 'invalid_input', `Der Name darf höchstens ${MAX_NAME} Zeichen haben.`);
    const v = versions.rename(board.id, req.params.vid, name || null);
    if (!v) return sendError(reply, 404, 'not_found', NOT_FOUND);
    return { ok: true, version: v };
  });

  scope.post<{ Params: { id: string; vid: string } }>('/api/boards/:id/versions/:vid/restore', async (req, reply) => {
    const board = findBoard(req.params.id);
    if (!board || !VERSION_ID.test(req.params.vid)) return sendError(reply, 404, 'not_found', NOT_FOUND);
    const res = await versions.restore(board.id, req.params.vid, person(req.session!));
    if (!res) return sendError(reply, 404, 'not_found', NOT_FOUND);
    return { ok: true, ...res };
  });

  scope.post<{ Params: { id: string; vid: string } }>('/api/boards/:id/versions/:vid/copy', async (req, reply) => {
    const board = findBoard(req.params.id);
    const content = board && VERSION_ID.test(req.params.vid) ? versions.content(board.id, req.params.vid) : null;
    if (!board || !content) return sendError(reply, 404, 'not_found', NOT_FOUND);
    const t = (req.body as { title?: unknown } | null)?.title;
    if (t !== undefined && t !== null && typeof t !== 'string') return sendError(reply, 400, 'invalid_input', 'Der Titel muss ein Text sein.');
    const given = typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : '';
    if (given.length > 120) return sendError(reply, 400, 'invalid_input', 'Der Titel darf höchstens 120 Zeichen haben.');
    const copy = await copyBoard({ db, imagesDir, toBoard, events }, board, {
      title: (given || `${board.title} (alte Version)`).slice(0, 120),
      session: req.session!,
      state: content,
      thumbnail: false,
    });
    return reply.code(201).send({ ok: true, board: copy });
  });
}
