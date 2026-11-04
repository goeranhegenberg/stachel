// Lesen für den Assistenten: kompakte Objektsicht, Board-Überblick (Bereiche, Rahmen, Cluster), Suche, Filter.
import type { Obj } from '../board/model';
import { boundsOf, centerOf, frameOf, overlaps, unionOf, type Rect } from '../board/geometry';
import { colorKey } from '../board/palette';
import { kindOf } from '../kinds/kinds';
import { textOf } from '../kinds/common';

export interface Snap {
  all: Obj[];
  byId: Map<string, Obj>;
  frames: Obj[];
}

export function snap(all: Obj[]): Snap {
  return { all, byId: new Map(all.map((o) => [o.id, o])), frames: all.filter((o) => o.type === 'frame') };
}

/** Kompakte Sicht eines Objekts (ohne leere Felder). */
export function compact(o: Obj, s: Snap, opts: { connections?: Map<string, string[]> } = {}): Record<string, unknown> {
  const kind = kindOf(o.type);
  const b = boundsOf(o, s.byId);
  const base: Record<string, unknown> = { id: o.id, type: o.type };
  if (o.type === 'connector') Object.assign(base, { bounds: b });
  else Object.assign(base, { x: Math.round(o.x), y: Math.round(o.y), w: Math.round(o.w), h: Math.round(o.h) });
  if (o.rotation) base.rotation = o.rotation;
  const extra = kind ? kind.read(o) : genericRead(o);
  Object.assign(base, extra);
  const fr = frameOf(o, s.frames, s.byId);
  if (fr) base.frame = fr.id;
  if (o.groupId) base.group = o.groupId;
  if (o.locked) base.locked = true;
  if (o.hidden) base.hidden = true;
  if (o.linkTo) base.linkTo = o.linkTo;
  const conns = opts.connections?.get(o.id);
  if (conns?.length) base.connectors = conns;
  return prune(base);
}

function genericRead(o: Obj): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (['id', 'type', 'x', 'y', 'w', 'h', 'z', 'createdBy', 'updatedAt', 'content'].includes(k)) continue;
    if (typeof v === 'string' && v.length > 300) out[k] = `${v.slice(0, 300)}…`;
    else if (v && typeof v === 'object' && JSON.stringify(v).length > 400) out[k] = '(…)';
    else out[k] = v;
  }
  const t = textOf(o);
  if (t) out.text = t;
  return out;
}

export function prune(o: Record<string, unknown>): Record<string, unknown> {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === '') delete o[k];
  return o;
}

/** Verbinder je Objekt: „→id“ (ausgehend) bzw. „←id“ (eingehend), mit Verbinder-id in Klammern. */
export function connectionIndex(s: Snap): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (id: string, v: string) => out.set(id, [...(out.get(id) ?? []), v]);
  for (const c of s.all) {
    if (c.type !== 'connector') continue;
    const a = c.from?.objectId as string | undefined;
    const b = c.to?.objectId as string | undefined;
    if (a) add(a, `→${b ?? 'Punkt'} (${c.id})`);
    if (b) add(b, `←${a ?? 'Punkt'} (${c.id})`);
  }
  return out;
}

/** Durchsuchbarer Text eines Objekts (wie die Board-Suche: Text, Titel, Tags, zuständige Person, Tabellenzellen). */
export function searchText(o: Obj): string {
  const parts: string[] = [];
  if (typeof o.text === 'string') parts.push(o.text);
  if (typeof o.title === 'string') parts.push(o.title);
  if (typeof o.desc === 'string') parts.push(o.desc);
  if (Array.isArray(o.tags)) parts.push(...o.tags.map((t: { label?: string }) => t.label ?? ''));
  if (o.assignee?.name) parts.push(o.assignee.name);
  if (o.table?.cells) parts.push(...Object.values(o.table.cells as Record<string, string>));
  if (o.emoji) parts.push(o.emoji);
  return parts.join('\n');
}

export interface Filter {
  ids?: string[];
  types?: string[];
  area?: Rect;
  frame?: string;
  text?: string;
  tag?: string;
  color?: string;
}

export function filterObjects(s: Snap, f: Filter): Obj[] {
  const ids = f.ids ? new Set(f.ids) : null;
  const types = f.types?.length ? new Set(f.types) : null;
  const frame = f.frame ? s.byId.get(f.frame) : null;
  const fr = frame ? boundsOf(frame, s.byId) : null;
  const q = f.text?.toLowerCase();
  const tag = f.tag?.toLowerCase();
  return s.all.filter((o) => {
    if (ids && !ids.has(o.id)) return false;
    if (types && !types.has(o.type)) return false;
    const b = boundsOf(o, s.byId);
    if (f.area && !overlaps(f.area, b)) return false;
    if (fr && (o.id === frame!.id || !(b.x >= fr.x && b.y >= fr.y && b.x + b.w <= fr.x + fr.w && b.y + b.h <= fr.y + fr.h))) return false;
    if (q && !searchText(o).toLowerCase().includes(q)) return false;
    if (tag && !(Array.isArray(o.tags) && o.tags.some((t: { label?: string }) => t.label?.toLowerCase() === tag))) return false;
    if (f.color && colorKey(o.color) !== f.color.toLowerCase() && o.color?.toLowerCase() !== f.color.toLowerCase()) return false;
    return true;
  });
}

/** Räumliche Cluster (Objekte, die höchstens `gap` auseinander liegen), ohne Rahmen und Verbinder. */
export function clusters(objs: Obj[], s: Snap, gap = 160): Obj[][] {
  const list = objs.filter((o) => o.type !== 'frame' && o.type !== 'connector');
  const rects = list.map((o) => boundsOf(o, s.byId));
  const parent = list.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  // nach x sortiert vergleichen (ausreichend schnell für einige tausend Objekte)
  const order = list.map((_, i) => i).sort((a, b) => rects[a]!.x - rects[b]!.x);
  for (let ai = 0; ai < order.length; ai++) {
    const a = order[ai]!;
    const ra = rects[a]!;
    for (let bi = ai + 1; bi < order.length; bi++) {
      const b = order[bi]!;
      const rb = rects[b]!;
      if (rb.x > ra.x + ra.w + gap) break;
      if (overlaps(ra, rb, gap)) parent[find(a)] = find(b);
    }
  }
  const groups = new Map<number, Obj[]>();
  list.forEach((o, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), o]));
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

const label = (o: Obj) => {
  const t = (o.type === 'frame' ? o.title : o.text) as string | undefined;
  return t ? t.replace(/\s+/g, ' ').slice(0, 60) : undefined;
};

/** Überblick: Zahlen, Gesamtfläche, Rahmen mit Inhalt, Mindmaps, Cluster außerhalb von Rahmen, freie Fläche. */
export function overview(s: Snap) {
  const counts: Record<string, number> = {};
  for (const o of s.all) counts[o.type] = (counts[o.type] ?? 0) + 1;
  const bounds = unionOf(s.all, s.byId);
  const inFrame = new Map<string, Obj[]>();
  const outside: Obj[] = [];
  for (const o of s.all) {
    if (o.type === 'frame' || o.type === 'connector') continue;
    const f = frameOf(o, s.frames, s.byId);
    if (f) inFrame.set(f.id, [...(inFrame.get(f.id) ?? []), o]);
    else outside.push(o);
  }
  const frames = s.frames.map((f) => {
    const kids = inFrame.get(f.id) ?? [];
    const types: Record<string, number> = {};
    for (const k of kids) types[k.type] = (types[k.type] ?? 0) + 1;
    return prune({ id: f.id, title: f.title, bounds: boundsOf(f, s.byId), objects: kids.length, types, sample: kids.slice(0, 5).map(label).filter(Boolean) });
  });
  // Mindmaps: Wurzeln (Knoten ohne vorhandenen Eltern)
  const minds = s.all.filter((o) => o.type === 'mindnode');
  const mindIds = new Set(minds.map((m) => m.id));
  const roots = minds.filter((m) => !m.mind?.parent || !mindIds.has(m.mind.parent));
  const mindmaps = roots.map((r) => {
    const members = [r];
    for (let i = 0; i < members.length; i++) for (const m of minds) if (m.mind?.parent === members[i]!.id && !members.includes(m)) members.push(m);
    return { rootId: r.id, text: label(r), nodes: members.length, bounds: unionOf(members, s.byId) };
  });
  const groups = clusters(outside, s).map((c) => {
    const types: Record<string, number> = {};
    for (const k of c) types[k.type] = (types[k.type] ?? 0) + 1;
    return { bounds: unionOf(c, s.byId), objects: c.length, types, sample: c.slice(0, 4).map(label).filter(Boolean) };
  });
  const free = bounds ? { x: bounds.x + bounds.w + 200, y: bounds.y } : { x: 0, y: 0 };
  return { counts, total: s.all.length, bounds, frames, mindmaps, clustersOutsideFrames: groups.slice(0, 20), suggestedFreeSpot: free };
}

export const centerOfObj = (o: Obj, s: Snap) => centerOf(boundsOf(o, s.byId));
