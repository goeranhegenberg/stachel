// Teammitglieder für „zuständig“: alle, die das Board schon geöffnet haben (Y-Struktur `structure.people`,
// ohne Undo), dazu die gerade Anwesenden.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { boardPeople, currentBoardId } from '../../../instance';
import type * as Y from 'yjs';
import { useY } from '../../../editor/ext/hooks';
import type { EditorApi } from '../../../editor/ext/types';
import type { CardPerson } from '../model';

export const PEOPLE = 'structure.people';

export const peopleMap = (api: EditorApi): Y.Map<string> => api.store.extMap<string>(PEOPLE, { undo: false });

/** Eigenen Namen im Board vermerken (einmal je Öffnen, nur bei Änderung). */
export function useRegisterMe(api: EditorApi) {
  useEffect(() => {
    const map = peopleMap(api);
    const me = api.session.user;
    if (me?.key && map.get(me.key) !== me.name) api.store.transact(() => map.set(me.key, me.name));
  }, [api]);
}

const byName = (a: CardPerson, b: CardPerson) => a.name.localeCompare(b.name, 'de');

export function usePeople(api: EditorApi): CardPerson[] {
  const stored = useY(peopleMap(api), (m) => [...m.entries()]);
  const peers = useSyncExternalStore(api.session.subscribe, api.session.getPeers);
  // Modus local: nur Personen, die (noch) Zugriff auf das Board haben (instance.ts, docs/contract.md §6)
  const [allowed, setAllowed] = useState<{ key: string; name: string }[] | null>(null);
  useEffect(() => {
    if (api.session.isLocal) return;
    let alive = true;
    void boardPeople(currentBoardId()).then((list) => alive && setAllowed(list));
    return () => {
      alive = false;
    };
  }, [api.session]);
  const all = new Map<string, string>(allowed ? stored.filter(([k]) => allowed.some((p) => p.key === k)) : stored);
  for (const p of allowed ?? []) all.set(p.key, p.name);
  const me = api.session.user;
  if (me?.key) all.set(me.key, me.name);
  for (const p of peers) all.set(p.user.key, p.user.name);
  return [...all].map(([key, name]) => ({ key, name })).sort(byName);
}
