// Emoji-Reaktionen auf Objekte (ohne React): Y.Map 'collab.reactions', ein Eintrag je Objekt, Emoji und Person.
import type * as Y from 'yjs';
import type { BoardStore } from '../../board/store';
import { str, Y_REACTIONS } from './model';
import type { Author } from './comments';

export const EMOJIS = ['👍', '❤️', '😂', '🎉', '🤔', '👀', '🔥', '✅', '❓', '🌵'] as const;

export interface Reaction {
  o: string;
  e: string;
  u: string;
  n: string;
  at: string;
}

export interface ReactionGroup {
  emoji: string;
  people: Author[];
  mine: boolean;
}

export const reactionsMap = (store: BoardStore) => store.extMap<Reaction>(Y_REACTIONS);
const keyOf = (o: string, e: string, u: string) => `${o}|${e}|${u}`;

/**
 * Reaktion umschalten: haben alle Objekte sie schon von mir, entfernen; sonst bei den fehlenden ergänzen.
 * Ein Rückgängig-Schritt.
 */
export function toggleReaction(store: BoardStore, objectIds: readonly string[], emoji: string, who: Author) {
  const map = reactionsMap(store);
  if (!objectIds.length) return;
  const all = objectIds.every((o) => map.has(keyOf(o, emoji, who.key)));
  const at = new Date().toISOString();
  store.stopCapturing();
  store.transact(() => {
    for (const o of objectIds) {
      const k = keyOf(o, emoji, who.key);
      if (all) map.delete(k);
      else if (!map.has(k)) map.set(k, { o, e: emoji, u: who.key, n: who.name, at });
    }
  });
  store.stopCapturing();
}

/** Reaktionen je Objekt, Emojis in der Reihenfolge der ersten Reaktion. */
export function reactionsByObject(map: Y.Map<Reaction>, me: string): Map<string, ReactionGroup[]> {
  const rows: Reaction[] = [];
  map.forEach((r) => {
    if (r && typeof r === 'object' && typeof r.o === 'string' && typeof r.e === 'string') rows.push({ ...r, u: str(r.u), n: str(r.n, 'Unbekannt'), at: str(r.at) });
  });
  rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const out = new Map<string, ReactionGroup[]>();
  for (const r of rows) {
    let groups = out.get(r.o);
    if (!groups) out.set(r.o, (groups = []));
    let g = groups.find((x) => x.emoji === r.e);
    if (!g) groups.push((g = { emoji: r.e, people: [], mine: false }));
    g.people.push({ key: r.u, name: r.n });
    if (r.u === me) g.mine = true;
  }
  return out;
}

/** „Mara Lindner, Jonas Keller und du“ */
export function peopleText(people: readonly Author[], me: string): string {
  const names = people.filter((p) => p.key !== me).map((p) => p.name);
  if (people.some((p) => p.key === me)) names.push('du');
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
}
