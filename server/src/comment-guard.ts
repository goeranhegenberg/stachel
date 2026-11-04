// Kommentar-Autorschaft im Live-Sync (Sicherheits-Review 2026-11-02 SEC-06). Über `/sync` schreiben Browser und MCP
// Yjs-Updates direkt ins Dokument; der Server prüft hier dieselben Regeln wie die Native-API (native/writer.ts `collab`):
// - neue Nachrichten tragen `by`/`name` der verbundenen Person (KI-Token: „KI (für …)“),
// - bearbeiten und löschen nur eigene Nachrichten, den ganzen Thread nur, wer ihn begonnen hat,
// - `createdBy`/`createdAt` eines Threads bleiben, `resolvedBy` ist die Person, die erledigt.
// Rückgängig/Wiederholen stellt gelöschte Nachrichten anderer wieder her (eigener Thread gelöscht → Undo): erlaubt, wenn
// die Nachricht genau so schon einmal auf dem Board stand (Tabelle `comment_msgs`: ID + Hash des Inhalts).
// Erledigen, Verschieben, Reaktionen und Gelesen-Stand sind nicht betroffen.
//
// Damit nicht jede Tastatureingabe das ganze Dokument kopiert, ermittelt `touchedRoots` aus dem Update (ohne es
// anzuwenden), welche Wurzel-Strukturen es ändert; nur Updates, die `collab.comments` berühren (oder sich nicht
// zuordnen lassen), werden auf einer Kopie angewendet und verglichen. Abgelehnt wird wie bei SEC-01: Hocuspocus
// übernimmt die Nachricht nicht (connection.readOnly für diese Nachricht).
import { createHash } from 'node:crypto';
import type { Extension } from '@hocuspocus/server';
import * as Y from 'yjs';
import { messageUpdate } from './access.js';
import type { Db } from './db.js';

export const COMMENTS_ROOT = 'collab.comments';
const BOARD_DOC = /^board:([A-Za-z0-9_-]{1,64})$/;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS comment_msgs (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  msg_id TEXT NOT NULL,
  hash TEXT NOT NULL,             -- SHA-256 des Inhalts (by, name, text, at, …): Wiederherstellen nur unverändert
  PRIMARY KEY (board_id, msg_id, hash)
);
`;

export interface Author {
  key: string;
  name: string;
}

type Msg = Record<string, unknown> & { id?: unknown; by?: unknown; name?: unknown };

interface ThreadState {
  createdBy: unknown;
  createdAt: unknown;
  resolvedBy: unknown;
  messages: Msg[];
}

// ---------- Welche Wurzeln ändert ein Update? ----------

type IdLike = { client: number; clock: number };
const isId = (v: unknown): v is IdLike => !!v && typeof v === 'object' && typeof (v as IdLike).client === 'number' && typeof (v as IdLike).clock === 'number';

function rootName(type: unknown): string {
  let t = type as Y.AbstractType<any> | null;
  for (let i = 0; t && t._item && i < 10_000; i++) {
    const p = t._item.parent;
    if (!(p instanceof Y.AbstractType)) return '';
    t = p;
  }
  return t ? (Y.findRootTypeKey(t) ?? '') : '';
}

/**
 * Namen der Wurzel-Strukturen, die ein Update ändert (neue Inhalte und Löschungen), ohne es anzuwenden. `''` steht für
 * Inhalte, die sofort verworfen werden (Eltern schon aufgeräumt). null = nicht zuzuordnen (fehlende Vorgänger o. ä.).
 */
export function touchedRoots(doc: Y.Doc, update: Uint8Array): Set<string> | null {
  const { structs, ds } = Y.decodeUpdate(update);
  const store = doc.store;
  const local = new Map<number, Y.Item[]>();
  for (const s of structs) {
    if (!(s instanceof Y.Item)) continue;
    let list = local.get(s.id.client);
    if (!list) local.set(s.id.client, (list = []));
    list.push(s);
  }
  const findLocal = (id: IdLike) => local.get(id.client)?.find((s) => s.id.clock <= id.clock && id.clock < s.id.clock + s.length) ?? null;
  const findDoc = (id: IdLike): Y.Item | 'gc' | null => {
    if (id.clock >= Y.getState(store, id.client)) return null;
    const s = Y.getItem(store, id as Y.ID);
    return s instanceof Y.Item ? s : 'gc';
  };
  const memo = new Map<Y.Item, string | null>();
  const resolve = (item: Y.Item, depth = 0): string | null => {
    if (memo.has(item)) return memo.get(item)!;
    if (depth > 1000) return null;
    let out: string | null = null;
    const parent = item.parent as unknown;
    if (typeof parent === 'string') out = parent;
    else if (isId(parent)) {
      const p = findDoc(parent);
      if (p === 'gc') out = '';
      else if (p) out = p.content instanceof Y.ContentType ? rootName(p.content.type) : '';
      else {
        const l = findLocal(parent);
        out = l ? resolve(l, depth + 1) : null;
      }
    } else {
      // Elternteil kommt vom linken bzw. rechten Nachbarn (Yjs: Item.getMissing)
      const ref = (isId(item.origin) ? item.origin : null) ?? (isId(item.rightOrigin) ? item.rightOrigin : null);
      if (ref) {
        const n = findDoc(ref);
        if (n === 'gc') out = '';
        else if (n) out = rootName(n.parent);
        else {
          const l = findLocal(ref);
          out = l ? resolve(l, depth + 1) : null;
        }
      }
    }
    memo.set(item, out);
    return out;
  };
  const roots = new Set<string>();
  for (const list of local.values()) {
    for (const item of list) {
      const r = resolve(item);
      if (r === null) return null;
      if (r) roots.add(r);
    }
  }
  for (const [client, ranges] of ds.clients) {
    const have = Y.getState(store, client);
    const list = store.clients.get(client);
    for (const { clock, len } of ranges) {
      const end = clock + len;
      if (end > have) {
        // löscht Inhalte aus demselben Update (oder unbekannte)
        for (let c = Math.max(clock, have); c < end; ) {
          const l = findLocal({ client, clock: c });
          if (!l) return null;
          const r = resolve(l);
          if (r === null) return null;
          if (r) roots.add(r);
          c = l.id.clock + l.length;
        }
      }
      if (!list || clock >= have) continue;
      for (let i = Y.findIndexSS(list, clock); i < list.length && list[i]!.id.clock < end; i++) {
        const s = list[i]!;
        if (s instanceof Y.Item) {
          const r = rootName(s.parent);
          if (r) roots.add(r);
        }
      }
    }
  }
  return roots;
}

// ---------- Regeln ----------

/** Kommentare eines Dokuments als einfache Werte (tolerant wie web/src/features/collab/comments.ts readThreads). */
export function readComments(doc: Y.Doc): Map<string, ThreadState> {
  const out = new Map<string, ThreadState>();
  doc.getMap<unknown>(COMMENTS_ROOT).forEach((t, id) => {
    if (!(t instanceof Y.Map)) {
      out.set(id, { createdBy: undefined, createdAt: undefined, resolvedBy: undefined, messages: [] });
      return;
    }
    const msgs = t.get('messages');
    const messages = (msgs instanceof Y.Array ? msgs.toArray() : []).map((m) => (m && typeof m === 'object' ? (m as Msg) : ({ id: undefined } as Msg)));
    out.set(id, { createdBy: t.get('createdBy'), createdAt: t.get('createdAt'), resolvedBy: t.get('resolvedBy'), messages });
  });
  return out;
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export const messageHash = (m: Msg) => createHash('sha256').update(canonical(m)).digest('base64url');

/**
 * Darf `user` die Kommentare von `before` nach `after` ändern? `known(id, hash)`: stand diese Nachricht genau so schon
 * einmal auf dem Board (Wiederherstellen per Rückgängig)?
 */
export function commentChangeAllowed(
  before: ReadonlyMap<string, ThreadState>,
  after: ReadonlyMap<string, ThreadState>,
  user: Author,
  known: (msgId: string, hash: string) => boolean,
): boolean {
  const legit = (m: Msg) => typeof m.id === 'string' && ((m.by === user.key && m.name === user.name) || known(m.id, messageHash(m)));
  const starter = (t: ThreadState) => t.messages[0]?.by ?? t.createdBy;
  const same = (a: Msg, b: Msg) => canonical(a) === canonical(b);
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(id);
    const a = after.get(id);
    if (b && !a) {
      if (starter(b) !== user.key) return false;
      continue;
    }
    if (!b && a) {
      if (!a.messages.every(legit)) return false;
      if (a.createdBy !== (a.messages.length ? a.messages[0]!.by : user.key)) return false;
      if (new Set(a.messages.map((m) => m.id)).size !== a.messages.length) return false;
      continue;
    }
    if (!a || !b) continue;
    if (a.createdBy !== b.createdBy || a.createdAt !== b.createdAt) return false;
    if (a.resolvedBy !== b.resolvedBy && a.resolvedBy !== undefined && a.resolvedBy !== user.key) return false;
    // ganzer Thread ersetzt (neues messages-Array o. ä.) ändert nichts an den Regeln: Vergleich über die IDs
    const bm = new Map(b.messages.map((m) => [m.id, m]));
    const am = new Map(a.messages.map((m) => [m.id, m]));
    if (am.size !== a.messages.length && bm.size === b.messages.length) return false; // doppelte IDs
    for (const [mid, m] of bm) {
      const n = am.get(mid);
      if (!n) {
        if (m.by !== user.key) return false; // fremde Nachricht gelöscht
      } else if (!same(m, n)) {
        if (m.by !== user.key || n.by !== user.key || n.name !== m.name) return false; // fremde Nachricht geändert
      }
    }
    for (const [mid, n] of am) if (!bm.has(mid) && !legit(n)) return false;
  }
  return true;
}

// ---------- Prüfung im Sync ----------

export class CommentGuard {
  private readonly watching = new Map<string, () => void>();
  private readonly insert;
  private readonly lookup;

  constructor(private readonly db: Db) {
    db.exec(SCHEMA);
    this.insert = db.prepare('INSERT OR IGNORE INTO comment_msgs (board_id, msg_id, hash) VALUES (?, ?, ?)');
    this.lookup = db.prepare('SELECT 1 FROM comment_msgs WHERE board_id = ? AND msg_id = ? AND hash = ?');
  }

  /** Nachrichten eines Threads bzw. aller Threads vermerken (Board existiert: sonst greift der Fremdschlüssel). */
  private remember(boardId: string, threads: Iterable<ThreadState>) {
    if (!this.db.prepare('SELECT 1 FROM boards WHERE id = ?').get(boardId)) return;
    for (const t of threads) for (const m of t.messages) if (typeof m.id === 'string') this.insert.run(boardId, m.id, messageHash(m));
  }

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

  /** Vorhandene Nachrichten vermerken und jede neue (auch aus Native-API, MCP, Versionen) gleich dazu. */
  watch(boardId: string, doc: Y.Doc) {
    this.watching.get(boardId)?.();
    try {
      this.remember(boardId, readComments(doc).values());
    } catch (e) {
      console.error('[comments]', e);
    }
    const comments = doc.getMap<unknown>(COMMENTS_ROOT);
    const on = (events: Y.YEvent<any>[]) => {
      try {
        const ids = new Set<string>();
        for (const e of events) {
          let t = e.target as Y.AbstractType<any>;
          while (t._item && t.parent !== comments && t.parent instanceof Y.AbstractType) t = t.parent;
          if (t === comments) for (const k of (e as Y.YMapEvent<unknown>).keysChanged) ids.add(k);
          else if (t._item?.parentSub) ids.add(t._item.parentSub);
        }
        const all = readComments(doc);
        this.remember(boardId, [...ids].map((id) => all.get(id)).filter((t): t is ThreadState => !!t));
      } catch (e) {
        console.error('[comments]', e);
      }
    };
    comments.observeDeep(on);
    this.watching.set(boardId, () => comments.unobserveDeep(on));
  }

  /** Update von `user` auf Board `boardId` (Dokument `doc`) zulassen? */
  updateAllowed(boardId: string, doc: Y.Doc, update: Uint8Array, user: Author): boolean {
    if (Y.snapshotContainsUpdate(Y.snapshot(doc), update)) return true; // nichts Neues
    let roots: Set<string> | null;
    try {
      roots = touchedRoots(doc, update);
    } catch {
      roots = null;
    }
    if (roots && !roots.has(COMMENTS_ROOT)) return true;
    const copy = new Y.Doc({ gc: false });
    try {
      Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
      const pendingBefore = !!(copy.store as unknown as { pendingStructs: unknown }).pendingStructs;
      const before = readComments(copy);
      Y.applyUpdate(copy, update);
      const store = copy.store as unknown as { pendingStructs: unknown; pendingDs: unknown };
      // unvollständig (fehlende Vorgänger) und nicht zuzuordnen: könnte später Kommentare ändern → ablehnen
      if (!roots && !pendingBefore && (store.pendingStructs || store.pendingDs)) return false;
      const known = (id: string, hash: string) => !!this.lookup.get(boardId, id, hash);
      return commentChangeAllowed(before, readComments(copy), user, known);
    } catch {
      return false;
    } finally {
      copy.destroy();
    }
  }

  /** Hocuspocus-Nachricht (roh) zulassen? Nachrichten ohne Update immer; kaputte nicht. */
  messageAllowed(documentName: string, doc: Y.Doc, message: Uint8Array, user: Author): boolean {
    const update = messageUpdate(message);
    if (update === null) return true;
    if (update === 'invalid') return false;
    const boardId = BOARD_DOC.exec(documentName)?.[1] ?? '';
    return this.updateAllowed(boardId, doc, update, user);
  }
}
