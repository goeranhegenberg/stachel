// Abstimmung (ohne React): Sitzung in 'collab.vote', Stimmen in 'collab.votes', Ergebnisse in 'collab.voteHistory'.
// Alles ohne Rückgängig (gemeinsamer Ablauf, nicht Board-Inhalt).
import type * as Y from 'yjs';
import { nanoid } from 'nanoid';
import type { BoardObject } from '../../protocol';
import type { BoardStore } from '../../board/store';
import { num, str, Y_VOTE, Y_VOTE_HISTORY, Y_VOTES } from './model';
import type { Author } from './comments';
import { isInvisible } from '../../board/types';

export interface VoteSession {
  id: string;
  title: string;
  /** Stimmen pro Person */
  perPerson: number;
  /** mehrere Stimmen auf dasselbe Objekt erlaubt */
  multi: boolean;
  /** Ende in ms seit 1970 (null = ohne Zeitlimit) */
  endsAt: number | null;
  startedBy: string;
  startedByName: string;
  startedAt: number;
  ended: boolean;
  /** anonym: Stimmen ohne Namen, Schlüssel mit verschleierter Person (voterOf) */
  anonymous: boolean;
}

export interface VoteEntry {
  n: number;
  /** fehlt bei anonymen Abstimmungen */
  name?: string;
}

export interface Ranked {
  objectId: string;
  votes: number;
  rank: number;
}

export interface VoteResult {
  id: string;
  title: string;
  at: string;
  voters: number;
  total: number;
  ranking: Ranked[];
}

export const MAX_HISTORY = 20;

export const voteMap = (store: BoardStore) => store.extMap<unknown>(Y_VOTE, { undo: false });
export const votesMap = (store: BoardStore) => store.extMap<VoteEntry>(Y_VOTES, { undo: false });
export const historyArray = (store: BoardStore) => store.extArray<VoteResult>(Y_VOTE_HISTORY, { undo: false });

/** Auf diese Objekte kann man abstimmen (nicht Linien, Striche, Rahmen). */
export const votable = (o: BoardObject) => o.type !== 'connector' && o.type !== 'pen' && o.type !== 'frame' && !isInvisible(o);

export function readSession(map: Y.Map<unknown>): VoteSession | null {
  const s = map.get('session') as Record<string, unknown> | undefined;
  if (!s || typeof s !== 'object' || typeof s.id !== 'string') return null;
  return {
    id: s.id,
    title: str(s.title),
    perPerson: Math.max(1, Math.round(num(s.perPerson, 3))),
    multi: s.multi === true,
    endsAt: typeof s.endsAt === 'number' ? s.endsAt : null,
    startedBy: str(s.startedBy),
    startedByName: str(s.startedByName, 'Jemand'),
    startedAt: num(s.startedAt),
    ended: s.ended === true,
    anonymous: s.anonymous === true,
  };
}

/** 53-Bit-Prüfsumme (cyrb53) – nur zum Verschleiern, keine Kryptografie. */
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Wer im Stimmen-Schlüssel steht: der userKey bzw. bei anonymen Abstimmungen eine je Abstimmung andere Prüfsumme.
 * So zeigt niemand Namen an und die Stimmen verschiedener Abstimmungen lassen sich nicht verknüpfen. Wer die
 * userKeys kennt, kann im Dokument zurückrechnen – „anonym“ heißt hier: in der Oberfläche ohne Namen.
 */
export function voterOf(session: Pick<VoteSession, 'id' | 'anonymous'>, userKey: string): string {
  return session.anonymous ? `anon-${cyrb53(`${session.id}|${userKey}`)}` : userKey;
}

/** Läuft die Sitzung noch (nicht beendet, Zeit nicht abgelaufen)? */
export const isRunning = (s: VoteSession | null, now: number): boolean => !!s && !s.ended && (s.endsAt === null || now < s.endsAt);

export function startVote(store: BoardStore, opts: { title: string; perPerson: number; multi: boolean; minutes: number | null; anonymous?: boolean }, who: Author): VoteSession {
  const now = Date.now();
  const session: VoteSession = {
    id: nanoid(8),
    title: opts.title.trim() || 'Abstimmung',
    perPerson: Math.min(99, Math.max(1, Math.round(opts.perPerson))),
    multi: opts.multi,
    endsAt: opts.minutes ? now + opts.minutes * 60_000 : null,
    startedBy: who.key,
    startedByName: who.name,
    startedAt: now,
    ended: false,
    anonymous: !!opts.anonymous,
  };
  const map = voteMap(store);
  store.doc.transact(() => {
    clearVotes(store);
    map.set('session', session);
  });
  return session;
}

const voteKey = (session: string, user: string, obj: string) => `${session}|${user}|${obj}`;
const parseKey = (k: string) => {
  const [session, user, ...rest] = k.split('|');
  return { session, user, obj: rest.join('|') };
};

/** Meine Stimmen in dieser Sitzung je Objekt. */
export function myVotes(votes: Y.Map<VoteEntry>, sessionId: string, me: string): Map<string, number> {
  const out = new Map<string, number>();
  votes.forEach((v, k) => {
    const p = parseKey(k);
    if (p.session === sessionId && p.user === me) out.set(p.obj, Math.max(0, num(v?.n)));
  });
  return out;
}

export const used = (mine: ReadonlyMap<string, number>) => [...mine.values()].reduce((a, b) => a + b, 0);

export type VoteOutcome = 'added' | 'removed' | 'none-left' | 'not-running';

/**
 * Klick auf ein Objekt: ohne `multi` schaltet er meine Stimme um, mit `multi` kommt eine dazu.
 * `delta: -1` nimmt eine Stimme zurück.
 */
export function castVote(store: BoardStore, session: VoteSession | null, who: Author, objectId: string, delta: 1 | -1 = 1, now = Date.now()): VoteOutcome {
  if (!session || !isRunning(session, now)) return 'not-running';
  const votes = votesMap(store);
  const voter = voterOf(session, who.key);
  const k = voteKey(session.id, voter, objectId);
  const cur = Math.max(0, num(votes.get(k)?.n));
  const mine = myVotes(votes, session.id, voter);
  let next = cur + delta;
  if (delta === 1 && !session.multi && cur > 0) next = 0;
  if (next > cur && used(mine) >= session.perPerson) return 'none-left';
  next = Math.max(0, next);
  store.doc.transact(() => {
    if (next === 0) votes.delete(k);
    else votes.set(k, session.anonymous ? { n: next } : { n: next, name: who.name });
  });
  return next > cur ? 'added' : 'removed';
}

/** Rangfolge der Objekte nach Stimmen (gleich viele Stimmen = gleicher Rang). */
export function tally(votes: Y.Map<VoteEntry>, sessionId: string, exists?: (id: string) => boolean): { ranking: Ranked[]; voters: number; total: number } {
  const sums = new Map<string, number>();
  const voters = new Set<string>();
  votes.forEach((v, k) => {
    const p = parseKey(k);
    const n = Math.max(0, num(v?.n));
    if (p.session !== sessionId || n === 0 || (exists && !exists(p.obj))) return;
    sums.set(p.obj, (sums.get(p.obj) ?? 0) + n);
    voters.add(p.user);
  });
  const sorted = [...sums].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  let rank = 0;
  let prev = -1;
  const ranking = sorted.map(([objectId, n], i) => {
    if (n !== prev) rank = i + 1;
    prev = n;
    return { objectId, votes: n, rank };
  });
  return { ranking, voters: voters.size, total: ranking.reduce((a, r) => a + r.votes, 0) };
}

/** Namen je Objekt (nur nicht-anonyme Abstimmungen; für das Ergebnis). */
export function voterNames(votes: Y.Map<VoteEntry>, sessionId: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  votes.forEach((v, k) => {
    const p = parseKey(k);
    if (p.session !== sessionId || Math.max(0, num(v?.n)) === 0 || typeof v?.name !== 'string' || !v.name) return;
    const list = out.get(p.obj) ?? [];
    if (!list.includes(v.name)) list.push(v.name);
    out.set(p.obj, list);
  });
  for (const l of out.values()) l.sort((a, b) => a.localeCompare(b, 'de'));
  return out;
}

/** Wie viele Personen haben schon abgestimmt (für die Leiste). */
export function voterCount(votes: Y.Map<VoteEntry>, sessionId: string): number {
  return tally(votes, sessionId).voters;
}

/** Abstimmung beenden (vorzeitig oder nach Ablauf – jeder Client darf, mehrfach ist harmlos). */
export function endVote(store: BoardStore) {
  const map = voteMap(store);
  const s = readSession(map);
  if (!s || s.ended) return;
  map.set('session', { ...s, ended: true, endsAt: s.endsAt !== null ? Math.min(s.endsAt, Date.now()) : Date.now() });
}

/** Ergebnis ins Archiv übernehmen, Sitzung und Stimmen entfernen. */
export function closeVote(store: BoardStore, exists?: (id: string) => boolean) {
  const map = voteMap(store);
  const s = readSession(map);
  if (!s) return;
  const votes = votesMap(store);
  const t = tally(votes, s.id, exists);
  const hist = historyArray(store);
  store.doc.transact(() => {
    if (t.total > 0) {
      hist.insert(0, [{ id: s.id, title: s.title, at: new Date().toISOString(), voters: t.voters, total: t.total, ranking: t.ranking }]);
      if (hist.length > MAX_HISTORY) hist.delete(MAX_HISTORY, hist.length - MAX_HISTORY);
    }
    clearVotes(store);
    map.delete('session');
  });
}

function clearVotes(store: BoardStore) {
  const votes = votesMap(store);
  for (const k of [...votes.keys()]) votes.delete(k);
}

export function readHistory(arr: Y.Array<VoteResult>): VoteResult[] {
  return arr.toArray().filter((r): r is VoteResult => !!r && typeof r === 'object' && typeof r.id === 'string' && Array.isArray(r.ranking));
}
