// Kommentar-Threads (ohne React): Y-Struktur 'collab.comments', angeheftet an ein Objekt oder eine Board-Stelle.
import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import type { BoardObject } from '../../protocol';
import type { BoardStore, Snapshot } from '../../board/store';
import type { Point } from '../../board/geometry';
import { plainTextOf } from '../../board/types';
import { num, str, Y_COMMENTS } from './model';
import { isBlocked } from '../moderation/blocked';

export interface CommentMsg {
  id: string;
  /** userKey */
  by: string;
  name: string;
  text: string;
  /** ISO-Zeit */
  at: string;
  /** erwähnte userKeys */
  mentions?: string[];
  edited?: string;
}

export interface Thread {
  id: string;
  /** Weltposition (bei Objekt-Kommentaren: Rückfall, falls das Objekt fehlt) */
  x: number;
  y: number;
  /** angeheftet an dieses Objekt; dx/dy = Abstand zur linken oberen Ecke */
  objectId?: string;
  dx?: number;
  dy?: number;
  resolved: boolean;
  resolvedBy?: string;
  createdBy: string;
  createdAt: string;
  messages: CommentMsg[];
}

export interface Author {
  key: string;
  name: string;
}

export const commentsMap = (store: BoardStore) => store.extMap<Y.Map<unknown>>(Y_COMMENTS);

function readMsg(raw: unknown): CommentMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== 'string' || typeof m.text !== 'string') return null;
  return {
    id: m.id,
    by: str(m.by),
    name: str(m.name, 'Unbekannt'),
    text: m.text,
    at: str(m.at),
    mentions: Array.isArray(m.mentions) ? m.mentions.filter((k): k is string => typeof k === 'string') : undefined,
    edited: typeof m.edited === 'string' ? m.edited : undefined,
  };
}

/** Threads tolerant lesen (fremde/kaputte Einträge auslassen). */
export function readThreads(map: Y.Map<Y.Map<unknown>>): Thread[] {
  const out: Thread[] = [];
  map.forEach((t, id) => {
    if (!(t instanceof Y.Map)) return;
    const msgs = t.get('messages');
    const messages = (msgs instanceof Y.Array ? msgs.toArray() : []).map(readMsg).filter((m): m is CommentMsg => !!m);
    if (!messages.length) return;
    const objectId = t.get('objectId');
    out.push({
      id,
      x: num(t.get('x')),
      y: num(t.get('y')),
      objectId: typeof objectId === 'string' ? objectId : undefined,
      dx: num(t.get('dx')),
      dy: num(t.get('dy')),
      resolved: t.get('resolved') === true,
      resolvedBy: typeof t.get('resolvedBy') === 'string' ? (t.get('resolvedBy') as string) : undefined,
      createdBy: str(t.get('createdBy'), messages[0].by),
      createdAt: str(t.get('createdAt'), messages[0].at),
      messages,
    });
  });
  return out;
}

/** Eigener Rückgängig-Schritt je Aktion (nicht mit Board-Änderungen verschmelzen). */
function step(store: BoardStore, fn: () => void) {
  store.stopCapturing();
  store.transact(fn);
  store.stopCapturing();
}

const newMsg = (who: Author, text: string, mentions: string[], id = nanoid(10)): CommentMsg => ({
  id,
  by: who.key,
  name: who.name,
  text,
  at: new Date().toISOString(),
  ...(mentions.length ? { mentions } : {}),
});

export interface Anchor {
  x: number;
  y: number;
  objectId?: string;
  dx?: number;
  dy?: number;
}

/** Ankerpunkt für einen Kommentar an `p`: am obersten Objekt dort (falls vorhanden), sonst frei auf dem Board. */
export function anchorAt(p: Point, hit: BoardObject | null): Anchor {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  if (!hit || hit.type === 'connector' || hit.type === 'pen') return { x, y };
  return { x, y, objectId: hit.id, dx: x - hit.x, dy: y - hit.y };
}

/** `ids`: feste IDs für Thread und erste Nachricht (App über die Native-API: eine Wiederholung legt nichts doppelt an). */
export function createThread(store: BoardStore, at: Anchor, who: Author, text: string, mentions: string[] = [], ids: { thread?: string; msg?: string } = {}): string {
  const id = ids.thread ?? nanoid(10);
  const t = new Y.Map<unknown>();
  const msgs = new Y.Array<CommentMsg>();
  msgs.push([newMsg(who, text, mentions, ids.msg)]);
  t.set('x', at.x);
  t.set('y', at.y);
  if (at.objectId) {
    t.set('objectId', at.objectId);
    t.set('dx', at.dx ?? 0);
    t.set('dy', at.dy ?? 0);
  }
  t.set('resolved', false);
  t.set('createdBy', who.key);
  t.set('createdAt', new Date().toISOString());
  t.set('messages', msgs);
  step(store, () => commentsMap(store).set(id, t));
  return id;
}

const messagesOf = (store: BoardStore, threadId: string) => {
  const m = commentsMap(store).get(threadId)?.get('messages');
  return m instanceof Y.Array ? (m as Y.Array<CommentMsg>) : null;
};

export function addReply(store: BoardStore, threadId: string, who: Author, text: string, mentions: string[] = [], msgId?: string) {
  const msgs = messagesOf(store, threadId);
  if (!msgs) return;
  step(store, () => {
    msgs.push([newMsg(who, text, mentions, msgId)]);
    // eine Antwort öffnet einen erledigten Thread wieder
    const t = commentsMap(store).get(threadId)!;
    if (t.get('resolved') === true) {
      t.set('resolved', false);
      t.delete('resolvedBy');
    }
  });
}

export function editMessage(store: BoardStore, threadId: string, msgId: string, text: string, mentions: string[] = []) {
  const msgs = messagesOf(store, threadId);
  if (!msgs) return;
  const i = msgs.toArray().findIndex((m) => m?.id === msgId);
  if (i < 0) return;
  const old = msgs.get(i);
  if (old.text === text) return;
  const { mentions: _old, ...rest } = old;
  void _old;
  step(store, () => {
    msgs.delete(i, 1);
    msgs.insert(i, [{ ...rest, text, edited: new Date().toISOString(), ...(mentions.length ? { mentions } : {}) }]);
  });
}

/** Nachricht löschen; die erste Nachricht löscht den ganzen Thread. */
export function deleteMessage(store: BoardStore, threadId: string, msgId: string) {
  const msgs = messagesOf(store, threadId);
  if (!msgs) return;
  const i = msgs.toArray().findIndex((m) => m?.id === msgId);
  if (i < 0) return;
  if (i === 0) return deleteThread(store, threadId);
  step(store, () => msgs.delete(i, 1));
}

export function deleteThread(store: BoardStore, threadId: string) {
  step(store, () => commentsMap(store).delete(threadId));
}

export function setResolved(store: BoardStore, threadId: string, resolved: boolean, by: string) {
  const t = commentsMap(store).get(threadId);
  if (!t) return;
  step(store, () => {
    t.set('resolved', resolved);
    if (resolved) t.set('resolvedBy', by);
    else t.delete('resolvedBy');
  });
}

/** Thread an eine neue Stelle setzen (Pin gezogen), dabei neu anheften. */
export function moveThread(store: BoardStore, threadId: string, at: Anchor) {
  const t = commentsMap(store).get(threadId);
  if (!t) return;
  step(store, () => {
    t.set('x', at.x);
    t.set('y', at.y);
    if (at.objectId) {
      t.set('objectId', at.objectId);
      t.set('dx', at.dx ?? 0);
      t.set('dy', at.dy ?? 0);
    } else {
      t.delete('objectId');
      t.delete('dx');
      t.delete('dy');
    }
  });
}

/** Weltposition des Pins: folgt dem Objekt (Abstand auf die aktuelle Größe begrenzt), sonst die gespeicherte Stelle. */
export function threadPos(t: Pick<Thread, 'x' | 'y' | 'objectId' | 'dx' | 'dy'>, snap: Pick<Snapshot, 'byId'>): Point {
  const o = t.objectId ? snap.byId.get(t.objectId) : undefined;
  if (!o) return { x: t.x, y: t.y };
  const dx = Math.min(Math.max(t.dx ?? 0, 0), o.w);
  const dy = Math.min(Math.max(t.dy ?? 0, 0), o.h);
  return { x: o.x + dx, y: o.y + dy };
}

export const lastActivity = (t: Thread) => t.messages.reduce((a, m) => (m.at > a ? m.at : a), t.createdAt);

/** Erwähnungen von `me`, die neuer sind als `readAt` (eigene Nachrichten zählen nicht). */
export function unreadMentions(threads: readonly Thread[], me: string, readAt: string | undefined): { thread: Thread; msg: CommentMsg }[] {
  const out: { thread: Thread; msg: CommentMsg }[] = [];
  for (const thread of threads)
    // blockierte Personen zählen nicht (moderation/blocked.ts, wie der Posteingang der App)
    for (const msg of thread.messages) if (msg.by !== me && msg.mentions?.includes(me) && (!readAt || msg.at > readAt) && !isBlocked(msg.by)) out.push({ thread, msg });
  return out.sort((a, b) => (a.msg.at < b.msg.at ? 1 : -1));
}

/** Kurzer Name eines Objekts für Listen („Haftnotiz „Bühne““). */
export function objectLabel(o: BoardObject | undefined, typeLabel: (o: BoardObject) => string): string {
  if (!o) return 'Gelöschtes Objekt';
  const text = plainTextOf(o)?.replace(/\s+/g, ' ').trim();
  const base = typeLabel(o);
  return text ? `${base} „${text.length > 32 ? `${text.slice(0, 31)}…` : text}“` : base;
}
