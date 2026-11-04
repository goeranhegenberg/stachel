// Notiz-Stapel (Quick Win Q2, docs/features/shapes.md „Notiz-Stapel“) ohne React – für den Browser und die
// Web-Aktionen der App (native.ts): Haftnotizen auf eine andere ziehen legt sie dort ab; ein Stapel ist eine Gruppe
// (`groupId`, Klick wählt alle, Ziehen nimmt alle mit) aus Haftnotizen mit `stacked: true` an derselben Stelle. Oben
// liegt die mit dem höchsten `z`. Durchblättern tauscht nur die z-Werte der Mitglieder, Auffächern legt sie in ein
// Raster daneben und löst den Stapel auf.
import type { BoardObject } from '../../../protocol';
import type { BoardStore, Patch, Snapshot } from '../../../board/store';
import { isInvisible } from '../../../board/types';

declare module '../../../../../shared/protocol' {
  interface BoardObject {
    /** sticky: liegt auf einem Notiz-Stapel (zusammen mit `groupId`; ohne Gruppe bedeutungslos) */
    stacked?: boolean;
  }
}

/** Höchstens so viele Notizen auf einmal auf einen Stapel legen bzw. auffächern. */
export const STACK_MAX = 200;
/** Abstand der Notizen beim Auffächern bzw. der abgenommenen Notiz zum Stapel (Welt-px) */
export const STACK_GAP = 24;

type Lookup = Pick<Snapshot, 'ordered' | 'byId'>;

const isNote = (o: BoardObject | undefined): o is BoardObject => o?.type === 'sticky';

/** Gehört `o` zu einem Stapel (Haftnotiz mit `stacked` und Gruppe)? */
export const inStack = (o: BoardObject | undefined): o is BoardObject & { groupId: string } => isNote(o) && o.stacked === true && typeof o.groupId === 'string';

/** Mitglieder des Stapels von `o` von unten nach oben (leer = kein Stapel aus mindestens zwei Notizen). */
export function stackOf(o: BoardObject | undefined, snap: Lookup): BoardObject[] {
  if (!inStack(o)) return [];
  const list = snap.ordered.filter((x) => inStack(x) && x.groupId === o.groupId);
  return list.length >= 2 ? list : [];
}

/** Alle Stapel (Gruppen-ID → Mitglieder von unten nach oben) aus mindestens zwei Notizen. */
export function allStacks(snap: Lookup): Map<string, BoardObject[]> {
  const out = new Map<string, BoardObject[]>();
  for (const o of snap.ordered) if (inStack(o)) out.set(o.groupId, [...(out.get(o.groupId) ?? []), o]);
  for (const [g, list] of out) if (list.length < 2) out.delete(g);
  return out;
}

/** Ist die Auswahl `ids` genau ein ganzer Stapel? Dann seine Mitglieder (unten → oben), sonst null. */
export function selectedStack(ids: readonly string[], snap: Lookup): BoardObject[] | null {
  if (ids.length < 2) return null;
  const members = stackOf(snap.byId.get(ids[0]!), snap);
  if (members.length !== ids.length) return null;
  const set = new Set(ids);
  return members.every((m) => set.has(m.id)) ? members : null;
}

/**
 * Ziel beim Ablegen der verschobenen Objekte `moved` (alle Haftnotizen, nicht gesperrt): die oberste andere sichtbare,
 * ungesperrte Haftnotiz, in deren innerer Hälfte die Mitte der zuerst gegriffenen Notiz liegt. Null = kein Stapeln.
 */
export function stackTarget(moved: readonly BoardObject[], snap: Lookup, grabbed?: string): BoardObject | null {
  if (!moved.length || moved.length > STACK_MAX || !moved.every((o) => isNote(o) && !o.locked)) return null;
  const ids = new Set(moved.map((o) => o.id));
  const lead = moved.find((o) => o.id === grabbed) ?? moved[moved.length - 1]!;
  const cx = lead.x + lead.w / 2;
  const cy = lead.y + lead.h / 2;
  for (let i = snap.ordered.length - 1; i >= 0; i--) {
    const t = snap.ordered[i]!;
    if (ids.has(t.id) || !isNote(t) || t.locked || isInvisible(t)) continue;
    if (Math.abs(cx - (t.x + t.w / 2)) <= t.w / 4 && Math.abs(cy - (t.y + t.h / 2)) <= t.h / 4) return t;
  }
  return null;
}

/**
 * `ids` (Haftnotizen) auf die Notiz `onto` legen: alle bekommen die Gruppe des Stapels (bzw. eine neue `newGroup()`),
 * `stacked`, Lage, Größe und Drehung des Ziels und liegen danach oben. Liefert die Mitglieder (unten → oben) oder
 * null, wenn nichts zu tun ist. Ein Schritt (im laufenden Rückgängig-Schritt des Aufrufers).
 */
export function stackOnto(store: BoardStore, ids: readonly string[], onto: string, newGroup: () => string): string[] | null {
  const snap = store.getSnapshot();
  const target = snap.byId.get(onto);
  if (!isNote(target) || target.locked) return null;
  const notes = ids.map((id) => snap.byId.get(id)).filter((o): o is BoardObject => isNote(o) && !o.locked && o.id !== onto);
  if (!notes.length || notes.length > STACK_MAX) return null;
  const g = inStack(target) ? target.groupId : newGroup();
  // die abgelegten Notizen in ihrer Reihenfolge über den Stapel
  notes.sort((a, b) => (snap.rank.get(a.id) ?? 0) - (snap.rank.get(b.id) ?? 0));
  const place: Patch = { x: target.x, y: target.y, w: target.w, h: target.h, rotation: target.rotation };
  store.transact(() => {
    const patches: Record<string, Patch> = { [onto]: { groupId: g, stacked: true } };
    for (const n of notes) patches[n.id] = { ...place, groupId: g, stacked: true };
    store.updateMany(patches);
    store.bringToFront(notes.map((n) => n.id));
  });
  return stackOf(store.get(onto) ?? undefined, store.getSnapshot()).map((o) => o.id);
}

/**
 * Nach dem Verschieben von `ids` (gegriffen: `grabbed`): liegt die gegriffene Haftnotiz mittig auf einer anderen, kommen
 * alle bewegten Haftnotizen auf deren Stapel. Sonst verlassen bewegte Notizen ihren Stapel, wenn er nicht ganz
 * mitgezogen wurde (eine einzelne Notiz aus dem Stapel herausziehen). Liefert die neue Auswahl, null = nichts geändert.
 */
export function dropNotes(store: BoardStore, ids: readonly string[], grabbed: string | undefined, newGroup: () => string): string[] | null {
  const snap = store.getSnapshot();
  const moved = ids.map((id) => snap.byId.get(id)).filter((o): o is BoardObject => !!o);
  const target = stackTarget(moved, snap, grabbed);
  if (target) return stackOnto(store, moved.map((o) => o.id), target.id, newGroup);
  const ids0 = new Set(moved.map((o) => o.id));
  const patches: Record<string, Patch> = {};
  for (const [, members] of allStacks(snap)) {
    const out = members.filter((m) => ids0.has(m.id) && !m.locked);
    if (!out.length || out.length === members.length) continue;
    for (const m of out) patches[m.id] = { stacked: undefined, groupId: undefined };
    const rest = members.filter((m) => !patches[m.id]);
    if (rest.length === 1) patches[rest[0]!.id] = { stacked: undefined, groupId: undefined };
  }
  if (!Object.keys(patches).length) return null;
  store.updateMany(patches);
  return moved.map((o) => o.id);
}

/**
 * Durchblättern: `dir` 1 = die oberste Notiz kommt nach unten (die nächste ist zu sehen), -1 = die unterste nach oben.
 * Tauscht nur die z-Werte der Mitglieder (der Stapel bleibt an seiner Stelle in der Ebenen-Reihenfolge). Liefert die
 * neue oberste Notiz.
 */
export function cycleStack(store: BoardStore, anyId: string, dir: 1 | -1): string | null {
  const members = stackOf(store.get(anyId) ?? undefined, store.getSnapshot());
  if (members.length < 2 || members.some((m) => m.locked)) return null;
  const zs = members.map((m) => m.z);
  const n = members.length;
  const patches: Record<string, Patch> = {};
  members.forEach((m, i) => {
    const to = dir === 1 ? (i === n - 1 ? 0 : i + 1) : i === 0 ? n - 1 : i - 1;
    if (m.z !== zs[to]) patches[m.id] = { z: zs[to] };
  });
  store.updateMany(patches);
  return (dir === 1 ? members[n - 2] : members[0])!.id;
}

/**
 * Auffächern: die Notizen des Stapels in ein Raster ab der Stapel-Ecke legen (oberste zuerst, Zeilen von links nach
 * rechts, so quadratisch wie möglich), `stacked` und die Gruppe entfernen. Liefert die Notizen (oberste zuerst).
 */
export function spreadStack(store: BoardStore, anyId: string): string[] | null {
  const members = stackOf(store.get(anyId) ?? undefined, store.getSnapshot());
  if (members.length < 2 || members.some((m) => m.locked)) return null;
  const top = [...members].reverse();
  const base = top[0]!;
  const cols = Math.ceil(Math.sqrt(top.length));
  const patches: Record<string, Patch> = {};
  top.forEach((m, i) => {
    patches[m.id] = { x: base.x + (i % cols) * (base.w + STACK_GAP), y: base.y + Math.floor(i / cols) * (base.h + STACK_GAP), stacked: undefined, groupId: undefined };
  });
  store.updateMany(patches);
  return top.map((m) => m.id);
}

/**
 * Eine Notiz vom Stapel nehmen (Standard: die oberste): sie landet rechts neben dem Stapel und gehört nicht mehr dazu;
 * bleibt nur eine Notiz übrig, ist auch sie kein Stapel mehr. Liefert die abgenommene Notiz.
 */
export function takeFromStack(store: BoardStore, anyId: string, which?: string): string | null {
  const snap = store.getSnapshot();
  const members = stackOf(store.get(anyId) ?? undefined, snap);
  if (members.length < 2) return null;
  const off = which ? members.find((m) => m.id === which) : members[members.length - 1];
  if (!off || off.locked) return null;
  const rest = members.filter((m) => m.id !== off.id);
  const patches: Record<string, Patch> = { [off.id]: { x: off.x + off.w + STACK_GAP, stacked: undefined, groupId: undefined } };
  if (rest.length === 1) patches[rest[0]!.id] = { stacked: undefined, groupId: undefined };
  store.updateMany(patches);
  return off.id;
}
