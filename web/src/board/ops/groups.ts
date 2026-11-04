// Gruppen über das Feld `groupId`: Auswahl erweitern, Gruppieren, Lösen.
import { nanoid } from 'nanoid';
import type { BoardObject } from '../../protocol';
import type { Patch } from '../store';

/** Ergänzt die Auswahl um alle Mitglieder der berührten Gruppen (Reihenfolge bleibt). */
export function expandGroups(ids: readonly string[], ordered: readonly BoardObject[], byId: ReadonlyMap<string, BoardObject>): string[] {
  const groups = new Set<string>();
  for (const id of ids) {
    const g = byId.get(id)?.groupId;
    if (g) groups.add(g);
  }
  if (!groups.size) return [...ids];
  const out = new Set(ids);
  for (const o of ordered) if (o.groupId && groups.has(o.groupId)) out.add(o.id);
  return [...out];
}

export const groupMembers = (groupId: string, ordered: readonly BoardObject[]) => ordered.filter((o) => o.groupId === groupId).map((o) => o.id);

/** Ist die Auswahl genau eine ganze Gruppe? */
export function isWholeGroup(ids: readonly string[], ordered: readonly BoardObject[], byId: ReadonlyMap<string, BoardObject>): boolean {
  const g = ids.length ? byId.get(ids[0])?.groupId : undefined;
  if (!g || !ids.every((id) => byId.get(id)?.groupId === g)) return false;
  return groupMembers(g, ordered).length === ids.length;
}

export function groupPatches(objs: readonly BoardObject[]): Record<string, Patch> | null {
  const list = objs.filter((o) => !o.locked);
  if (list.length < 2) return null;
  const groupId = nanoid(10);
  return Object.fromEntries(list.map((o) => [o.id, { groupId }]));
}

export function ungroupPatches(objs: readonly BoardObject[]): Record<string, Patch> | null {
  const list = objs.filter((o) => o.groupId && !o.locked);
  if (!list.length) return null;
  return Object.fromEntries(list.map((o) => [o.id, { groupId: undefined }]));
}
