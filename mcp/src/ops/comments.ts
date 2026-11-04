// Kommentare (Y-Struktur `collab.comments`, Vertrag docs/features/collab.md): lesen, neuer Thread, Antwort, erledigt.
import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import type { Obj } from '../board/model';
import { ToolError } from '../kinds/common';

export const Y_COMMENTS = 'collab.comments';

export interface Author {
  key: string;
  name: string;
}

interface Msg {
  id: string;
  by: string;
  name: string;
  text: string;
  at: string;
  mentions?: string[];
}

const newMsg = (who: Author, text: string, mentions: string[]): Msg => ({
  id: nanoid(10),
  by: who.key,
  name: who.name,
  text,
  at: new Date().toISOString(),
  ...(mentions.length ? { mentions } : {}),
});

/** @Erwähnungen im Text (Namen bekannter Personen) → user_keys. */
export function mentionsIn(text: string, people: { key: string; name: string }[]): string[] {
  const out: string[] = [];
  for (const p of people) if (text.toLowerCase().includes(`@${p.name.toLowerCase()}`)) out.push(p.key);
  return out;
}

export function readThreads(map: Y.Map<unknown>, opts: { includeResolved?: boolean; objectId?: string } = {}) {
  const out: Record<string, unknown>[] = [];
  map.forEach((t, id) => {
    if (!(t instanceof Y.Map)) return;
    const msgs = t.get('messages');
    const messages = (msgs instanceof Y.Array ? msgs.toArray() : []).filter((m): m is Msg => !!m && typeof (m as Msg).text === 'string');
    if (!messages.length) return;
    const resolved = t.get('resolved') === true;
    if (resolved && !opts.includeResolved) return;
    const objectId = typeof t.get('objectId') === 'string' ? (t.get('objectId') as string) : undefined;
    if (opts.objectId && objectId !== opts.objectId) return;
    out.push({
      threadId: id,
      objectId,
      x: t.get('x'),
      y: t.get('y'),
      resolved: resolved || undefined,
      messages: messages.map((m) => ({ by: m.name, text: m.text, at: m.at })),
    });
  });
  return out.sort((a, b) => String((a.messages as Msg[])[0]?.at).localeCompare(String((b.messages as Msg[])[0]?.at)));
}

/** Neuer Thread an einem Objekt (oben rechts am Objekt) bzw. frei bei (x, y). */
export function addThread(map: Y.Map<unknown>, at: { obj?: Obj; x?: number; y?: number }, who: Author, text: string, mentions: string[]): string {
  const id = nanoid(10);
  const t = new Y.Map<unknown>();
  const msgs = new Y.Array<Msg>();
  msgs.push([newMsg(who, text, mentions)]);
  if (at.obj) {
    const dx = Math.max(0, at.obj.w - 16);
    t.set('x', Math.round(at.obj.x + dx));
    t.set('y', Math.round(at.obj.y + 16));
    t.set('objectId', at.obj.id);
    t.set('dx', Math.round(dx));
    t.set('dy', 16);
  } else {
    if (at.x === undefined || at.y === undefined) throw new ToolError('Kommentar braucht `objectId` oder x und y.');
    t.set('x', Math.round(at.x));
    t.set('y', Math.round(at.y));
  }
  t.set('resolved', false);
  t.set('createdBy', who.key);
  t.set('createdAt', new Date().toISOString());
  t.set('messages', msgs);
  map.set(id, t);
  return id;
}

export function reply(map: Y.Map<unknown>, threadId: string, who: Author, text: string, mentions: string[]) {
  const t = map.get(threadId);
  const msgs = t instanceof Y.Map ? t.get('messages') : null;
  if (!(t instanceof Y.Map) || !(msgs instanceof Y.Array)) throw new ToolError(`Kommentar-Thread „${threadId}“ gibt es nicht. Threads liefert get_comments.`);
  msgs.push([newMsg(who, text, mentions)]);
  if (t.get('resolved') === true) {
    t.set('resolved', false);
    t.delete('resolvedBy');
  }
}

export function resolve(map: Y.Map<unknown>, threadId: string, resolved: boolean, by: string) {
  const t = map.get(threadId);
  if (!(t instanceof Y.Map)) throw new ToolError(`Kommentar-Thread „${threadId}“ gibt es nicht. Threads liefert get_comments.`);
  t.set('resolved', resolved);
  if (resolved) t.set('resolvedBy', by);
  else t.delete('resolvedBy');
}
