// Posteingang der Apps (docs/contract.md §8.11): neue @Erwähnungen in Kommentaren und Karten-Zuweisungen je
// Person. Der Server sieht sie beim Bearbeiten (Beobachter auf `collab.comments` und `objects` je geladenem Dokument)
// und legt sie in der Tabelle `mentions` ab; der Hintergrund-Check der App fragt `GET /api/native/v1/inbox?since=` –
// der Identitätsdienst bleibt unverändert (Konzept §4.5, §7.2 Frage 5).
import type { Extension } from '@hocuspocus/server';
import * as Y from 'yjs';
import { DOC_OBJECTS } from '../../../shared/protocol.js';
import { BLOCKS_SCHEMA } from '../blocks.js';
import { nowIso, type Db } from '../db.js';

/** `board:<id>` → id (wie sync.ts, ohne Import-Kreis) */
const boardIdFromDoc = (name: string) => /^board:([A-Za-z0-9_-]{1,64})$/.exec(name)?.[1] ?? null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mentions (
  id TEXT PRIMARY KEY,            -- mention|<board>|<thread>|<msg>|<user> bzw. assign|<board>|<object>|<user>
  user_key TEXT NOT NULL,
  type TEXT NOT NULL,             -- mention | assign
  board_id TEXT NOT NULL,
  object_id TEXT,
  thread_id TEXT,
  by_key TEXT,
  by_name TEXT,
  text TEXT NOT NULL,
  at TEXT NOT NULL,               -- Zeit laut Dokument (Nachricht) bzw. der Zuweisung
  seen_at TEXT NOT NULL           -- wann der Server es zuerst gesehen hat (danach fragt die App)
);
CREATE INDEX IF NOT EXISTS mentions_user ON mentions(user_key, seen_at);
CREATE INDEX IF NOT EXISTS mentions_board ON mentions(board_id);
`;

const COMMENTS = 'collab.comments';
/** Länge des Textausschnitts je Eintrag */
const SNIPPET = 200;
/** Ohne `since`: Einträge der letzten Tage */
const DEFAULT_DAYS = 7;
const MAX_ITEMS = 50;
/** Einträge älter als das werden aufgeräumt */
const KEEP_DAYS = 60;

export interface InboxItem {
  id: string;
  type: 'mention' | 'assign';
  boardId: string;
  boardTitle: string;
  objectId: string | null;
  threadId: string | null;
  by: string | null;
  byKey: string | null;
  text: string;
  at: string;
}

interface Row {
  id: string;
  type: 'mention' | 'assign';
  board_id: string;
  title: string | null;
  object_id: string | null;
  thread_id: string | null;
  by_key: string | null;
  by_name: string | null;
  text: string;
  at: string;
  seen_at: string;
}

/** Person einer Yjs-Transaktion: Hocuspocus-Verbindung (`{source:'connection', connection}`) bzw. Direktverbindung/App. */
function originUser(origin: unknown): { key: string; name: string } | null {
  const o = origin as { source?: unknown; connection?: { context?: { user?: unknown } }; context?: { user?: unknown } } | null;
  const u = (o?.source === 'connection' ? o.connection?.context?.user : o?.context?.user) as { key?: unknown; name?: unknown } | undefined;
  return u && typeof u.key === 'string' ? { key: u.key, name: typeof u.name === 'string' ? u.name : '' } : null;
}

const snippet = (s: string) => (s.length > SNIPPET ? `${s.slice(0, SNIPPET - 1)}…` : s);

export class NativeInbox {
  private readonly insert;
  /** je geladenem Dokument: Beobachter abmelden */
  private readonly watching = new Map<string, () => void>();

  constructor(
    private readonly db: Db,
    private readonly now: () => string = nowIso,
  ) {
    db.exec(SCHEMA);
    db.exec(BLOCKS_SCHEMA);
    this.insert = db.prepare(
      `INSERT OR IGNORE INTO mentions (id, user_key, type, board_id, object_id, thread_id, by_key, by_name, text, at, seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
  }

  /** Hocuspocus-Erweiterung: beobachtet jedes geladene Board-Dokument. */
  readonly hooks: Extension = {
    afterLoadDocument: async ({ documentName, document }) => {
      const id = boardIdFromDoc(documentName);
      if (id) this.watch(id, document);
    },
    afterUnloadDocument: async ({ documentName }) => {
      const id = boardIdFromDoc(documentName);
      if (!id) return;
      this.watching.get(id)?.();
      this.watching.delete(id);
    },
  };

  /** Beobachter auf Kommentare und Karten eines Dokuments (nur Änderungen ab jetzt zählen, kein Nachtrag alter Stände). */
  watch(boardId: string, doc: Y.Doc) {
    this.watching.get(boardId)?.();
    const comments = doc.getMap<unknown>(COMMENTS);
    const objects = doc.getMap<unknown>(DOC_OBJECTS);
    const onComments = (_events: Y.YEvent<any>[], tr: Y.Transaction) => this.guard(() => this.scanComments(boardId, comments, tr));
    const onObjects = (events: Y.YEvent<any>[], tr: Y.Transaction) => this.guard(() => this.scanAssign(boardId, objects, events, tr));
    comments.observeDeep(onComments);
    objects.observeDeep(onObjects);
    this.watching.set(boardId, () => {
      comments.unobserveDeep(onComments);
      objects.unobserveDeep(onObjects);
    });
  }

  private guard(fn: () => void) {
    try {
      fn();
    } catch (e) {
      console.error('[inbox]', e);
    }
  }

  /** Alle Nachrichten mit Erwähnungen ablegen (vorhandene bleiben unverändert: INSERT OR IGNORE). */
  private scanComments(boardId: string, comments: Y.Map<unknown>, tr: Y.Transaction) {
    // nur Änderungen von Menschen (nicht z. B. eine wiederhergestellte Version: die alten Erwähnungen sind keine Neuigkeit)
    if (!originUser(tr.origin)) return;
    const seen = this.now();
    comments.forEach((t, threadId) => {
      if (!(t instanceof Y.Map)) return;
      const msgs = t.get('messages');
      if (!(msgs instanceof Y.Array)) return;
      const objectId = typeof t.get('objectId') === 'string' ? (t.get('objectId') as string) : null;
      for (const m of msgs.toArray() as unknown[]) {
        if (!m || typeof m !== 'object') continue;
        const msg = m as { id?: unknown; by?: unknown; name?: unknown; text?: unknown; at?: unknown; mentions?: unknown };
        if (typeof msg.id !== 'string' || typeof msg.text !== 'string' || !Array.isArray(msg.mentions)) continue;
        for (const key of new Set(msg.mentions)) {
          if (typeof key !== 'string' || !key || key === msg.by) continue;
          this.insert.run(
            `mention|${boardId}|${threadId}|${msg.id}|${key}`,
            key,
            'mention',
            boardId,
            objectId,
            threadId,
            typeof msg.by === 'string' ? msg.by : null,
            typeof msg.name === 'string' ? msg.name : null,
            snippet(msg.text),
            typeof msg.at === 'string' ? msg.at : seen,
            seen,
          );
        }
      }
    });
  }

  /** Karte bekommt eine (andere) zuständige Person: Eintrag für sie, außer sie hat es selbst gesetzt. */
  private scanAssign(boardId: string, objects: Y.Map<unknown>, events: Y.YEvent<any>[], tr: Y.Transaction) {
    const by = originUser(tr.origin);
    if (!by) return;
    const seen = this.now();
    const check = (id: string) => {
      const o = objects.get(id);
      if (!(o instanceof Y.Map) || o.get('type') !== 'card') return;
      const a = o.get('assignee') as { key?: unknown } | undefined;
      const key = a && typeof a === 'object' && typeof a.key === 'string' ? a.key : '';
      if (!key || key === by.key) return;
      const title = typeof o.get('text') === 'string' ? (o.get('text') as string) : '';
      this.insert.run(`assign|${boardId}|${id}|${key}`, key, 'assign', boardId, id, null, by.key, by.name || null, snippet(title), seen, seen);
    };
    for (const e of events) {
      if (e.target === objects) {
        // neue Objekte (angelegt, eingefügt, dupliziert)
        for (const [id, change] of (e as Y.YMapEvent<unknown>).changes.keys) if (change.action === 'add') check(id);
      } else if (e.target instanceof Y.Map && e.target.parent === objects && (e as Y.YMapEvent<unknown>).keysChanged.has('assignee')) {
        // Schlüssel des Objekts in `objects` (Yjs-Item des eingebetteten Y.Map)
        const id = (e.target as unknown as { _item?: { parentSub?: string | null } })._item?.parentSub;
        if (id) check(id);
      }
    }
  }

  /**
   * Einträge der Person seit `since` (ISO; fehlt = die letzten 7 Tage), älteste zuerst, höchstens 50. Ohne Einträge von
   * Personen, die sie blockiert hat (blocks.ts).
   */
  list(userKey: string, since?: string): { items: InboxItem[]; now: string } {
    const now = this.now();
    const from = since ?? new Date(Date.parse(now) - DEFAULT_DAYS * 86_400_000).toISOString();
    const rows = this.db
      .prepare(
        `SELECT m.*, b.title FROM mentions m JOIN boards b ON b.id = m.board_id
         WHERE m.user_key = ? AND m.seen_at > ? AND b.deleted_at IS NULL
           AND (m.by_key IS NULL OR m.by_key NOT IN (SELECT blocked_key FROM user_blocks WHERE user_key = m.user_key))
         ORDER BY m.seen_at, m.id LIMIT ?`,
      )
      .all(userKey, from, MAX_ITEMS) as unknown as Row[];
    return {
      now,
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        boardId: r.board_id,
        boardTitle: r.title ?? '',
        objectId: r.object_id,
        threadId: r.thread_id,
        by: r.by_name,
        byKey: r.by_key,
        text: r.text,
        at: r.at,
      })),
    };
  }

  /** Alte Einträge und die endgültig gelöschter Boards entfernen. */
  prune() {
    const before = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
    this.db.prepare('DELETE FROM mentions WHERE seen_at < ? OR board_id NOT IN (SELECT id FROM boards)').run(before);
  }

  stop() {
    for (const off of this.watching.values()) off();
    this.watching.clear();
  }
}
