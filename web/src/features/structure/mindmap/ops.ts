// Mindmap-Operationen ohne React: Knoten anlegen, einklappen, löschen, umhängen – jeweils samt Layout in
// einem Undo-Schritt. Daten: Objekttyp `mindnode`, Feld `mind` (model.ts).
import { nanoid } from 'nanoid';
import type { BoardObject } from '../../../protocol';
import type { BoardStore, NewObject, Patch, Snapshot } from '../../../board/store';
import type { MindInfo, MindSide } from '../model';
import { H_GAP, layoutMind, mindTree, type MindIn, type MindOut } from './layout';
import { MIND_COLORS, mindSize } from './style';

export const isMind = (o: BoardObject | undefined | null): o is BoardObject => o?.type === 'mindnode';

const cache = new WeakMap<Snapshot, BoardObject[]>();
/** Alle Mindmap-Knoten des Schnappschusses. */
export function mindNodes(snap: Snapshot): BoardObject[] {
  let list = cache.get(snap);
  if (!list) cache.set(snap, (list = snap.ordered.filter(isMind)));
  return list;
}

const toIn = (o: BoardObject): MindIn => ({ id: o.id, parent: o.mind?.parent, order: o.mind?.order, side: o.mind?.side, collapsed: o.mind?.collapsed, x: o.x, y: o.y });

/** Wurzel eines Knotens (Elternkette, Zyklen-sicher). */
export function rootOf(byId: ReadonlyMap<string, BoardObject>, id: string): string {
  const seen = new Set<string>();
  let cur = id;
  for (;;) {
    seen.add(cur);
    const p = byId.get(cur)?.mind?.parent;
    if (!p || seen.has(p) || !isMind(byId.get(p))) return cur;
    cur = p;
  }
}

export const isRootNode = (byId: ReadonlyMap<string, BoardObject>, o: BoardObject) => rootOf(byId, o.id) === o.id;

/** Kinder eines Knotens (nach Reihenfolge). */
export function childrenOf(nodes: readonly BoardObject[], id: string): BoardObject[] {
  return nodes.filter((o) => o.mind?.parent === id && o.id !== id).sort((a, b) => (a.mind?.order ?? 0) - (b.mind?.order ?? 0) || (a.id < b.id ? -1 : 1));
}

/** Knoten samt aller Nachfahren. */
export function subtree(nodes: readonly BoardObject[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const k of nodes) if (k.mind?.parent === out[i] && !out.includes(k.id)) out.push(k.id);
  return out;
}

const mindEq = (a: MindInfo | undefined, b: MindInfo) => JSON.stringify(a ?? {}) === JSON.stringify(b);

/** Feld-Patch, damit `o` dem Layout entspricht (null = passt schon). */
function placePatch(o: BoardObject, p: MindOut, isRoot: boolean): Patch | null {
  const mind: MindInfo = { ...o.mind, level: p.level };
  if (isRoot) delete mind.side;
  else mind.side = p.side;
  if (p.hidden) mind.hidden = true;
  else delete mind.hidden;
  const patch: Patch = {};
  if (o.x !== p.x) patch.x = p.x;
  if (o.y !== p.y) patch.y = p.y;
  if (o.w !== p.w) patch.w = p.w;
  if (o.h !== p.h) patch.h = p.h;
  if (!mindEq(o.mind, mind)) patch.mind = mind;
  return Object.keys(patch).length ? patch : null;
}

/** Layout-Patches für die Mindmaps mit diesen Wurzeln (alle, wenn `roots` fehlt). */
export function layoutPatches(nodes: readonly BoardObject[], roots?: ReadonlySet<string>): Record<string, Patch> {
  const ins = nodes.map(toIn);
  const text = new Map(nodes.map((o) => [o.id, o.text ?? '']));
  const out = layoutMind(ins, (n, level) => mindSize(text.get(n.id) ?? '', level));
  const tree = mindTree(ins);
  const rootCache = new Map<string, string>();
  const root = (id: string): string => {
    const have = rootCache.get(id);
    if (have) return have;
    const p = tree.parentOf(id);
    const r = p ? root(p) : id;
    rootCache.set(id, r);
    return r;
  };
  const patches: Record<string, Patch> = {};
  for (const o of nodes) {
    const p = out.get(o.id);
    if (!p || (roots && !roots.has(root(o.id)))) continue;
    const patch = placePatch(o, p, !tree.parentOf(o.id));
    if (patch) patches[o.id] = patch;
  }
  return patches;
}

export interface MindChange {
  add?: NewObject[];
  patch?: Record<string, Patch>;
  remove?: Iterable<string>;
}

/** Stand nach einer Änderung (für das Layout vor dem Schreiben). */
function applyChange(nodes: readonly BoardObject[], ch: MindChange): BoardObject[] {
  const removed = new Set(ch.remove ?? []);
  const list = nodes.filter((o) => !removed.has(o.id)).map((o) => (ch.patch?.[o.id] ? ({ ...o, ...ch.patch[o.id] } as BoardObject) : o));
  for (const a of ch.add ?? []) if (a.type === 'mindnode') list.push({ z: '', createdBy: '', updatedAt: '', ...a, id: a.id! } as BoardObject);
  return list;
}

/** Änderung samt Layout als ein Undo-Schritt schreiben. Liefert die ids der neuen Objekte. */
export function commitMind(store: BoardStore, ch: MindChange): string[] {
  const snap = store.getSnapshot();
  const next = applyChange(mindNodes(snap), ch);
  const byId = new Map(next.map((o) => [o.id, o]));
  const roots = new Set<string>();
  for (const id of [...Object.keys(ch.patch ?? {}), ...(ch.add ?? []).map((a) => a.id!)]) if (byId.has(id)) roots.add(rootOf(byId, id));
  for (const id of ch.remove ?? []) {
    const p = snap.byId.get(id)?.mind?.parent;
    if (p && byId.has(p)) roots.add(rootOf(byId, p));
  }
  const lay = layoutPatches(next, roots);
  const ids: string[] = [];
  store.stopCapturing();
  store.transact(() => {
    if (ch.remove) store.remove(ch.remove);
    for (const a of ch.add ?? []) ids.push(store.create({ ...a, ...(lay[a.id!] ?? {}) } as NewObject));
    const patches: Record<string, Patch> = {};
    for (const [id, p] of Object.entries(ch.patch ?? {})) patches[id] = p;
    for (const [id, p] of Object.entries(lay)) if (!ch.add?.some((a) => a.id === id)) patches[id] = { ...patches[id], ...p };
    store.updateMany(patches);
  });
  store.stopCapturing();
  return ids;
}

/** Neuer Wurzelknoten (Mindmap-Werkzeug, Vorlage). `id` vorgeben: Native-API (die App erzeugt die IDs). */
export function newRoot(p: { x: number; y: number }, text = '', id = nanoid()): NewObject {
  const s = mindSize(text, 0);
  return { id, type: 'mindnode', x: Math.round(p.x - s.w / 2), y: Math.round(p.y - s.h / 2), w: s.w, h: s.h, text, color: '#0a0a0a', mind: { level: 0 } };
}

/** Nächste freie Zweigfarbe einer Wurzel. */
function branchColor(nodes: readonly BoardObject[], rootId: string): string {
  const used = childrenOf(nodes, rootId).map((k) => k.color);
  return MIND_COLORS.find((c) => !used.includes(c)) ?? MIND_COLORS[used.length % MIND_COLORS.length];
}

/** Kind anlegen (Tab, Plus). Liefert die neue id (`id` vorgeben: Native-API). */
export function addChild(store: BoardStore, node: BoardObject, side?: MindSide, id = nanoid()): string {
  const snap = store.getSnapshot();
  const nodes = mindNodes(snap);
  const root = isRootNode(snap.byId, node);
  const kids = childrenOf(nodes, node.id);
  const order = kids.length ? Math.max(...kids.map((k) => k.mind?.order ?? 0)) + 1 : 0;
  const s = mindSize('', root ? 1 : 2);
  const dir = (root ? side : node.mind?.side) === 'l' ? -1 : 1;
  const add: NewObject = {
    id,
    type: 'mindnode',
    x: Math.round(dir > 0 ? node.x + node.w + H_GAP : node.x - H_GAP - s.w),
    y: node.y,
    ...s,
    text: '',
    color: root ? branchColor(nodes, node.id) : (node.color ?? MIND_COLORS[0]),
    mind: { parent: node.id, order, ...(root ? { side: side ?? 'r' } : {}) },
  };
  const patch = node.mind?.collapsed ? { [node.id]: { mind: { ...node.mind, collapsed: undefined } } } : undefined;
  return commitMind(store, { add: [add], patch })[0];
}

/** Geschwister darunter anlegen (Enter). Wurzeln haben keine Geschwister → null. `id` vorgeben: Native-API. */
export function addSibling(store: BoardStore, node: BoardObject, id = nanoid()): string | null {
  const snap = store.getSnapshot();
  if (isRootNode(snap.byId, node)) return null;
  const nodes = mindNodes(snap);
  const parent = snap.byId.get(node.mind!.parent!)!;
  const sibs = childrenOf(nodes, parent.id);
  const i = sibs.findIndex((k) => k.id === node.id);
  const a = node.mind?.order ?? 0;
  const next = sibs[i + 1]?.mind?.order;
  const order = next !== undefined && next > a ? (a + next) / 2 : a + 1;
  const parentIsRoot = isRootNode(snap.byId, parent);
  const add: NewObject = {
    id,
    type: 'mindnode',
    x: node.x,
    y: node.y + node.h + 16,
    ...mindSize('', parentIsRoot ? 1 : 2),
    text: '',
    color: parentIsRoot ? branchColor(nodes, parent.id) : (node.color ?? MIND_COLORS[0]),
    mind: { parent: parent.id, order, ...(parentIsRoot ? { side: node.mind?.side ?? 'r' } : {}) },
  };
  return commitMind(store, { add: [add] })[0];
}

export function toggleCollapse(store: BoardStore, node: BoardObject) {
  const mind = { ...node.mind };
  if (mind.collapsed) delete mind.collapsed;
  else mind.collapsed = true;
  commitMind(store, { patch: { [node.id]: { mind } } });
}

/** Ausgewählte Knoten samt Nachfahren (für Löschen). */
export function withDescendants(snap: Snapshot, ids: readonly string[]): string[] {
  const nodes = mindNodes(snap);
  const out = new Set<string>();
  for (const id of ids) {
    if (isMind(snap.byId.get(id))) for (const d of subtree(nodes, id)) out.add(d);
    else out.add(id);
  }
  return [...out];
}

/**
 * Nach dem Ziehen eines Knotens: auf einem anderen Knoten losgelassen → dort einhängen, sonst unter den
 * Geschwistern nach der Höhe einsortieren (bzw. Seite der Wurzel wechseln). Danach Layout.
 */
export function dropNodes(store: BoardStore, ids: readonly string[]) {
  const snap = store.getSnapshot();
  const nodes = mindNodes(snap);
  const patch: Record<string, Patch> = {};
  for (const id of ids) {
    const o = snap.byId.get(id);
    if (!isMind(o) || isRootNode(snap.byId, o)) continue;
    const c = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
    const own = new Set(subtree(nodes, o.id));
    const target = [...nodes].reverse().find((t) => !own.has(t.id) && !t.mind?.hidden && c.x >= t.x - 8 && c.x <= t.x + t.w + 8 && c.y >= t.y - 8 && c.y <= t.y + t.h + 8);
    if (target && target.id !== o.mind?.parent) {
      const kids = childrenOf(nodes, target.id);
      const toRoot = isRootNode(snap.byId, target);
      const mind: MindInfo = { parent: target.id, order: kids.length ? Math.max(...kids.map((k) => k.mind?.order ?? 0)) + 1 : 0 };
      if (toRoot) mind.side = c.x < target.x + target.w / 2 ? 'l' : 'r';
      patch[o.id] = { mind };
      // Unterzweig übernimmt die Zweigfarbe des neuen Elternknotens
      if (!toRoot) for (const d of own) patch[d] = { ...patch[d], color: target.color };
      continue;
    }
    const parent = snap.byId.get(o.mind?.parent ?? '');
    if (!parent) continue;
    const mind: MindInfo = { ...o.mind };
    if (isRootNode(snap.byId, parent)) mind.side = c.x < parent.x + parent.w / 2 ? 'l' : 'r';
    const sibs = childrenOf(nodes, parent.id).filter((k) => k.id !== o.id && (k.mind?.side ?? 'r') === (mind.side ?? o.mind?.side ?? 'r'));
    const below = sibs.findIndex((k) => k.y + k.h / 2 > c.y);
    const prev = below < 0 ? sibs.at(-1) : sibs[below - 1];
    const next = below < 0 ? undefined : sibs[below];
    const a = prev?.mind?.order;
    const b = next?.mind?.order;
    mind.order = a === undefined ? (b === undefined ? 0 : b - 1) : b === undefined ? a + 1 : (a + b) / 2;
    patch[o.id] = { mind };
  }
  commitMind(store, { patch });
}

/** Pfeiltasten: Nachbarknoten im Baum. */
export function neighbor(snap: Snapshot, node: BoardObject, key: string): BoardObject | null {
  const nodes = mindNodes(snap).filter((o) => !o.mind?.hidden);
  const root = isRootNode(snap.byId, node);
  const side = node.mind?.side ?? 'r';
  const kids = childrenOf(nodes, node.id);
  const parent = root ? null : (snap.byId.get(node.mind?.parent ?? '') ?? null);
  const outward = root ? null : side === 'r' ? 'ArrowRight' : 'ArrowLeft';
  const inward = root ? null : side === 'r' ? 'ArrowLeft' : 'ArrowRight';
  if (root && (key === 'ArrowRight' || key === 'ArrowLeft')) return kids.find((k) => (k.mind?.side ?? 'r') === (key === 'ArrowRight' ? 'r' : 'l')) ?? null;
  if (key === outward) return kids[0] ?? null;
  if (key === inward) return parent;
  if (parent && (key === 'ArrowUp' || key === 'ArrowDown')) {
    const sibs = childrenOf(nodes, parent.id).filter((k) => (k.mind?.side ?? 'r') === side);
    const i = sibs.findIndex((k) => k.id === node.id);
    return sibs[i + (key === 'ArrowUp' ? -1 : 1)] ?? null;
  }
  return null;
}
