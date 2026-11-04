// Bilder und PDFs gehören dem Board, auf das sie hochgeladen wurden (Sicherheits-Review 2026-11-02 UPL-1).
// Abrufen darf sie nur, wer dieses Board sehen kann (access.ts canViewImage). Fügt jemand ein Bild- oder PDF-Objekt mit
// der Datei-ID eines anderen Boards ein (Kopieren/Einfügen über Boards hinweg im Web, in den Apps, per MCP), legt der
// Server hier eine eigene Kopie für das Ziel-Board an und schreibt die neue ID ins Objekt – aber nur, wenn die Person
// das Quell-Board sehen darf. Sonst bleibt die fremde ID im Objekt tot (404), genau wie für alle anderen.
// So hängt kein Board mehr an Dateien eines anderen: Endgültig löschen entfernt die eigenen Dateien vollständig
// (trash.ts, kein Umhängen mehr), Duplizieren kopiert nur eigene Dateien (board-copies.ts).
//
// Alte Stände (vor dieser Regel eingefügt) stellt `migrateLegacyRefs` einmal beim Start um: Kopie, wenn die Person,
// die das Objekt angelegt hat, oder die Besitzer:in des Ziel-Boards das Quell-Board sehen darf (im Papierkorb zählt
// die Rolle von davor); sonst bleibt der Verweis tot. Die alte Tabelle `image_access` (Treffer der früheren Suche)
// wird geleert.
import fs from 'node:fs';
import path from 'node:path';
import type { Extension } from '@hocuspocus/server';
import * as Y from 'yjs';
import { boardDocName, DOC_OBJECTS } from '../../shared/protocol.js';
import type { BoardAccess } from './access.js';
import { FILE_KEYS, fileRefs, remapObject } from './board-copies.js';
import { nowIso, type Db } from './db.js';
import { randomToken } from './sessions.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS image_copies (
  src TEXT NOT NULL,              -- Datei-ID auf dem Quell-Board
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  copy TEXT NOT NULL,             -- eigene Kopie für board_id (images.id)
  PRIMARY KEY (src, board_id)
);
CREATE TABLE IF NOT EXISTS server_migrations (
  name TEXT PRIMARY KEY,
  done_at TEXT NOT NULL
);
`;

const LEGACY_MIGRATION = 'image-binding-1';
const BOARD_DOC = /^board:([A-Za-z0-9_-]{1,64})$/;

/** Origin der Umschreibungen hier: ohne Person (Versionsverlauf/Posteingang zählen sie nicht als Änderung von jemandem). */
export const BINDING_ORIGIN = { source: 'local', binding: true } as const;

interface ImageRow {
  id: string;
  board_id: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

/** Person einer Transaktion (Hocuspocus-Verbindung, Direktverbindung, App-Schreiber); KI-Tokens zählen als ihre Person. */
function originUser(origin: unknown): string | null {
  const o = origin as { source?: unknown; connection?: { context?: { user?: unknown } }; context?: { user?: unknown } } | null;
  const u = (o?.source === 'connection' ? o.connection?.context?.user : o?.context?.user) as { key?: unknown } | undefined;
  if (!u || typeof u.key !== 'string' || !u.key) return null;
  return u.key.startsWith('ai:') ? u.key.slice(3) : u.key;
}

/** Schlüssel des Objekts in `objects`, zu dem eine Datei-Änderung gehört; null = keine Datei-Änderung. */
function changedObject(e: Y.YEvent<any>, objects: Y.Map<unknown>): string | null {
  const t = e.target as Y.AbstractType<any>;
  const key = (x: Y.AbstractType<any>) => (x._item?.parentSub as string | null | undefined) ?? null;
  if (t instanceof Y.Map && t.parent === objects) {
    return [...(e as Y.YMapEvent<unknown>).keysChanged].some((k) => FILE_KEYS.has(k)) ? key(t) : null;
  }
  // Seiten einer PDF (`docPages`, Y.Map im Objekt)
  if (t instanceof Y.Map && t.parent instanceof Y.Map && t.parent.parent === objects && key(t) === 'docPages') return key(t.parent);
  return null;
}

export class ImageBinding {
  private readonly watching = new Map<string, () => void>();
  private readonly getImage;

  constructor(
    private readonly db: Db,
    private readonly imagesDir: string,
    private readonly access: BoardAccess,
    private readonly log: (msg: string, err?: unknown) => void = (msg, err) => console.error(`[images] ${msg}`, err ?? ''),
  ) {
    db.exec(SCHEMA);
    this.getImage = db.prepare('SELECT id, board_id, mime, width, height, bytes FROM images WHERE id = ?');
  }

  /** Datei-ID gehört einem anderen Board als `boardId` (und existiert). */
  private foreign(boardId: string, id: string): boolean {
    const row = this.getImage.get(id) as ImageRow | undefined;
    return !!row && row.board_id !== boardId;
  }

  /** Darf `userKey` Dateien von `boardId` nutzen? (Modus org: jedes vorhandene Board) */
  private canUse(userKey: string, boardId: string, ignoreTrash = false): boolean {
    const role = this.access.roleOf({ key: userKey }, boardId, { ignoreTrash });
    return role !== null;
  }

  /**
   * Eigene Kopie von Datei `srcId` für `boardId` (dieselbe Kopie bei wiederholtem Einfügen); null = gibt es nicht, gehört
   * schon dem Board, oder `allowed` verneint den Zugriff auf das Quell-Board.
   */
  copyTo(boardId: string, srcId: string, owner: string, allowed: (srcBoard: string) => boolean): string | null {
    const row = this.getImage.get(srcId) as ImageRow | undefined;
    if (!row || row.board_id === boardId || !allowed(row.board_id)) return null;
    const prev = this.db
      .prepare('SELECT c.copy FROM image_copies c JOIN images i ON i.id = c.copy AND i.board_id = c.board_id WHERE c.src = ? AND c.board_id = ?')
      .get(srcId, boardId) as { copy: string } | undefined;
    if (prev) return prev.copy;
    const from = path.join(this.imagesDir, srcId);
    if (!fs.existsSync(from)) return null;
    const id = randomToken(16);
    fs.copyFileSync(from, path.join(this.imagesDir, id));
    try {
      this.db
        .prepare('INSERT INTO images (id, board_id, mime, width, height, bytes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, boardId, row.mime, row.width, row.height, row.bytes, owner, nowIso());
      this.db.prepare('INSERT OR REPLACE INTO image_copies (src, board_id, copy) VALUES (?, ?, ?)').run(srcId, boardId, id);
    } catch (e) {
      fs.rmSync(path.join(this.imagesDir, id), { force: true });
      throw e;
    }
    return id;
  }

  /** Hocuspocus-Erweiterung: beobachtet jedes geladene Board-Dokument. */
  readonly hooks: Extension = {
    afterLoadDocument: async ({ documentName, document }) => {
      const id = BOARD_DOC.exec(documentName)?.[1];
      if (id) this.watch(id, document);
    },
    afterUnloadDocument: async ({ documentName }) => {
      const id = BOARD_DOC.exec(documentName)?.[1];
      if (!id) return;
      this.watching.get(id)?.();
      this.watching.delete(id);
    },
  };

  /** Neue bzw. geänderte Objekte einer Person mit fremden Datei-IDs → Kopien anlegen (gleich nach der Transaktion). */
  watch(boardId: string, doc: Y.Doc) {
    this.watching.get(boardId)?.();
    const objects = doc.getMap<unknown>(DOC_OBJECTS);
    const onObjects = (events: Y.YEvent<any>[], tr: Y.Transaction) => {
      try {
        if (tr.origin === BINDING_ORIGIN) return;
        const user = originUser(tr.origin);
        if (!user) return;
        const ids = new Set<string>();
        for (const e of events) {
          if (e.target === objects) {
            for (const [id, ch] of (e as Y.YMapEvent<unknown>).changes.keys) if (ch.action !== 'delete') ids.add(id);
          } else {
            const id = changedObject(e, objects);
            if (id) ids.add(id);
          }
        }
        const refs = new Set<string>();
        for (const id of ids) {
          const m = objects.get(id);
          if (m instanceof Y.Map) for (const ref of fileRefs(m)) if (this.foreign(boardId, ref)) refs.add(ref);
        }
        if (refs.size) setImmediate(() => this.bind(boardId, doc, user, ids, refs));
      } catch (e) {
        this.log(`Dateien auf Board ${boardId} nicht geprüft`, e);
      }
    };
    objects.observeDeep(onObjects);
    this.watching.set(boardId, () => objects.unobserveDeep(onObjects));
  }

  private bind(boardId: string, doc: Y.Doc, user: string, ids: ReadonlySet<string>, refs: ReadonlySet<string>) {
    try {
      const map = new Map<string, string>();
      for (const ref of refs) {
        const copy = this.copyTo(boardId, ref, user, (src) => this.canUse(user, src));
        if (copy) map.set(ref, copy);
      }
      if (!map.size) return;
      const objects = doc.getMap<unknown>(DOC_OBJECTS);
      doc.transact(() => {
        for (const id of ids) {
          const m = objects.get(id);
          if (m instanceof Y.Map) remapObject(m, map);
        }
      }, BINDING_ORIGIN);
    } catch (e) {
      this.log(`Dateien für Board ${boardId} nicht kopiert`, e);
    }
  }

  /**
   * Einmalig beim Start (vor dem ersten Sync): Verweise auf Dateien anderer Boards in gespeicherten Dokumenten in eigene
   * Kopien umstellen (Regeln oben). `force` (Tests) läuft auch, wenn es schon gelaufen ist. Liefert Zahlen fürs Log.
   */
  migrateLegacyRefs(force = false): { boards: number; copied: number; dead: number } {
    const out = { boards: 0, copied: 0, dead: 0 };
    if (!force && this.db.prepare('SELECT 1 FROM server_migrations WHERE name = ?').get(LEGACY_MIGRATION)) return out;
    const boards = this.db.prepare('SELECT id, created_by FROM boards').all() as unknown as { id: string; created_by: string }[];
    const load = this.db.prepare('SELECT state FROM documents WHERE name = ?');
    const save = this.db.prepare('UPDATE documents SET state = ? WHERE name = ?');
    for (const b of boards) {
      const row = load.get(boardDocName(b.id)) as { state: Uint8Array } | undefined;
      if (!row) continue;
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, new Uint8Array(row.state));
        const objects = doc.getMap<unknown>(DOC_OBJECTS);
        const todo: { m: Y.Map<unknown>; map: Map<string, string> }[] = [];
        objects.forEach((m) => {
          if (!(m instanceof Y.Map)) return;
          const refs = fileRefs(m).filter((r) => this.foreign(b.id, r));
          if (!refs.length) return;
          const creator = typeof m.get('createdBy') === 'string' ? (m.get('createdBy') as string) : '';
          const allowed = (src: string) => (!!creator && this.canUse(creator, src, true)) || this.canUse(b.created_by, src, true);
          const map = new Map<string, string>();
          for (const r of refs) {
            const copy = this.copyTo(b.id, r, creator || b.created_by, allowed);
            if (copy) {
              map.set(r, copy);
              out.copied++;
            } else out.dead++;
          }
          if (map.size) todo.push({ m, map });
        });
        if (!todo.length) continue;
        doc.transact(() => {
          for (const t of todo) remapObject(t.m, t.map);
        }, BINDING_ORIGIN);
        save.run(Y.encodeStateAsUpdate(doc), boardDocName(b.id));
        out.boards++;
      } catch (e) {
        this.log(`Board ${b.id}: alte Datei-Verweise nicht umgestellt`, e);
      } finally {
        doc.destroy();
      }
    }
    this.db.exec('DELETE FROM image_access');
    this.db.prepare('INSERT OR REPLACE INTO server_migrations (name, done_at) VALUES (?, ?)').run(LEGACY_MIGRATION, nowIso());
    return out;
  }
}
