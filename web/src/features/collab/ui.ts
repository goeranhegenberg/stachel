// Lokaler Oberflächen-Zustand des Moduls (je Board-Sitzung), geteilt zwischen Slots, Werkzeug und Menüs.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { BoardStore } from '../../board/store';
import type { Peer } from '../../board/session';
import type { EditorApi } from '../../editor/ext/types';
import { useY } from '../../editor/ext/hooks';
import { Cell, Y_READS } from './model';
import { commentsMap, readThreads, type Anchor, type Thread } from './comments';
import type { Person } from './mentions';
import type { TrailPoint } from './laser';
import { currentBoardId, isLocal } from '../../instance';

export type CommentFilter = 'open' | 'resolved' | 'all';

export class CollabUi {
  /** offener Thread (Popover am Pin) */
  readonly openThread = new Cell<string | null>(null);
  /** neuer Kommentar wird gerade geschrieben (Stelle) */
  readonly composer = new Cell<Anchor | null>(null);
  /** Text, mit dem der nächste Composer startet (geretteter Entwurf eines gelöschten Threads) */
  readonly composerText = new Cell('');
  /** Antwort-Entwurf im offenen Thread (überlebt das Löschen des Threads durch andere) */
  readonly replyDraft = new Cell<{ threadId: string; text: string } | null>(null);
  /** Kommentar-Pins auf dem Board zeigen */
  readonly showComments = new Cell(true);
  readonly filter = new Cell<CommentFilter>('open');
  /** Person, der ich folge (userKey) */
  readonly follow = new Cell<string | null>(null);
  /** Name der geführten Person (für den Hinweis, solange sie kurz fehlt) */
  readonly followName = new Cell('');
  /** „Bin gleich zurück“ */
  readonly away = new Cell(false);
  /** Ergebnis-Ansicht der Abstimmung für diese Sitzung geschlossen */
  readonly resultsDismissed = new Cell<string | null>(null);
  /** eigene Laserspur (wird lokal gezeichnet) */
  readonly laser = new Cell<readonly TrailPoint[]>([]);
}

const uis = new WeakMap<BoardStore, CollabUi>();
export function uiOf(store: BoardStore): CollabUi {
  let ui = uis.get(store);
  if (!ui) uis.set(store, (ui = new CollabUi()));
  return ui;
}

/** zuletzt aktive Editor-API (für Symbole ohne api-Prop, z. B. den Seitenleisten-Knopf) */
export const currentApi = new Cell<EditorApi | null>(null);

export const useCell = <T>(c: Cell<T>): T => useSyncExternalStore(c.subscribe, c.get);

export function useThreads(api: EditorApi): Thread[] {
  return useY(commentsMap(api.store), readThreads);
}

export const readsMap = (store: BoardStore) => store.extMap<string>(Y_READS, { undo: false });

export function usePeers(api: EditorApi): readonly Peer[] {
  return useSyncExternalStore(api.session.subscribe, api.session.getPeers);
}

/** Eine Person je userKey (mehrere Tabs zählen einmal). */
export function uniquePeers(peers: readonly Peer[], me: string): Peer[] {
  const by = new Map<string, Peer>();
  for (const p of peers) if (p.user.key !== me && !by.has(p.user.key)) by.set(p.user.key, p);
  return [...by.values()];
}

// ---- Personen für @Erwähnungen ---------------------------------------------------------------------------------

let known: Promise<Person[]> | null = null;
let knownFor: string | null = null;
/**
 * GET /api/users (einmal je Seite; Fehler = leere Liste, offline gar nicht). Modus local: nur Personen mit Zugriff auf
 * das offene Board (`?board=`, docs/contract.md §6), deshalb je Board neu.
 */
function fetchKnown(): Promise<Person[]> {
  const board = isLocal() ? currentBoardId() : null;
  if (board !== knownFor) known = null;
  knownFor = board;
  known ??= fetch(board ? `/api/users?board=${encodeURIComponent(board)}` : '/api/users', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (Array.isArray(d?.users) ? (d.users as Person[]).filter((u) => typeof u?.key === 'string' && typeof u?.name === 'string') : []))
    .catch(() => {
      known = null;
      return [];
    });
  return known;
}

/** Alle bekannten Personen: Server-Liste, Anwesende und Kommentar-Autoren (ohne mich). */
export function usePeople(api: EditorApi, threads: readonly Thread[]): Person[] {
  const [server, setServer] = useState<Person[]>([]);
  const peers = usePeers(api);
  useEffect(() => {
    if (api.session.isLocal) return;
    let alive = true;
    void fetchKnown().then((list) => alive && setServer(list));
    return () => {
      alive = false;
    };
  }, [api.session]);
  const me = api.session.user.key;
  const by = new Map<string, Person>();
  for (const p of server) by.set(p.key, p);
  for (const p of peers) by.set(p.user.key, { key: p.user.key, name: p.user.name });
  // Modus local: Kommentar-Autor:innen ohne Zugriff (mehr) nicht zur Auswahl anbieten
  if (!isLocal() || !server.length) for (const t of threads) for (const m of t.messages) if (!by.has(m.by)) by.set(m.by, { key: m.by, name: m.name });
  by.delete(me);
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
