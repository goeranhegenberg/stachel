// Automatisches Mindmap-Layout (ohne React): Wurzel bleibt stehen, Zweige links/rechts als Baum,
// Geschwister untereinander, jeder Teilbaum mittig zu seinem Knoten. Eingeklappte Zweige sind versteckt.
import type { MindSide } from '../model';

export interface MindIn {
  id: string;
  parent?: string;
  order?: number;
  side?: MindSide;
  collapsed?: boolean;
  x: number;
  y: number;
}

export interface MindOut {
  x: number;
  y: number;
  w: number;
  h: number;
  level: number;
  side: MindSide;
  hidden: boolean;
}

export const H_GAP = 64;
export const V_GAP = 16;

export type SizeFn = (n: MindIn, level: number) => { w: number; h: number };

const byOrder = (a: MindIn, b: MindIn) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Eltern → Kinder (sortiert) und Wurzeln. Fehlende Eltern bzw. Zyklen machen einen Knoten zur Wurzel. */
export function mindTree(nodes: readonly MindIn[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, MindIn[]>();
  const parentOf = new Map<string, string>();
  for (const n of nodes) if (n.parent && n.parent !== n.id && byId.has(n.parent)) parentOf.set(n.id, n.parent);
  // Zyklen (gleichzeitiges Umhängen) auflösen: der kleinste Knoten im Kreis wird Wurzel
  for (const n of nodes) {
    const seen: string[] = [];
    let cur: string | undefined = n.id;
    while (cur && !seen.includes(cur)) {
      seen.push(cur);
      cur = parentOf.get(cur);
    }
    if (cur) {
      const loop = seen.slice(seen.indexOf(cur)).sort();
      parentOf.delete(loop[0]);
    }
  }
  const roots: MindIn[] = [];
  for (const n of nodes) {
    const p = parentOf.get(n.id);
    if (!p) roots.push(n);
    else kids.set(p, [...(kids.get(p) ?? []), n]);
  }
  for (const list of kids.values()) list.sort(byOrder);
  roots.sort(byOrder);
  return { roots, kids: (id: string) => kids.get(id) ?? [], parentOf: (id: string) => parentOf.get(id) };
}

/** Positionen, Größen, Ebene, Seite und Sichtbarkeit aller Knoten (mehrere Mindmaps möglich). */
export function layoutMind(nodes: readonly MindIn[], size: SizeFn): Map<string, MindOut> {
  const { roots, kids } = mindTree(nodes);
  const out = new Map<string, MindOut>();
  const sizes = new Map<string, { w: number; h: number }>();
  const sz = (n: MindIn, level: number) => {
    let s = sizes.get(n.id);
    if (!s) sizes.set(n.id, (s = size(n, level)));
    return s;
  };
  const span = new Map<string, number>();
  /** Höhe des sichtbaren Teilbaums */
  const spanOf = (n: MindIn, level: number): number => {
    const have = span.get(n.id);
    if (have !== undefined) return have;
    const list = n.collapsed ? [] : kids(n.id);
    const own = sz(n, level).h;
    const sum = list.reduce((s, k) => s + spanOf(k, level + 1), 0) + V_GAP * Math.max(0, list.length - 1);
    const v = Math.max(own, sum);
    span.set(n.id, v);
    return v;
  };
  const hide = (list: MindIn[], anchor: MindOut, level: number) => {
    for (const k of list) {
      const s = sz(k, level);
      out.set(k.id, { x: anchor.x, y: anchor.y, w: s.w, h: s.h, level, side: anchor.side, hidden: true });
      hide(kids(k.id), anchor, level + 1);
    }
  };
  const placeKids = (p: MindOut, list: MindIn[], side: MindSide, level: number) => {
    if (!list.length) return;
    const total = list.reduce((s, k) => s + spanOf(k, level), 0) + V_GAP * (list.length - 1);
    let top = p.y + p.h / 2 - total / 2;
    for (const k of list) {
      const s = sz(k, level);
      const sp = spanOf(k, level);
      const x = side === 'r' ? p.x + p.w + H_GAP : p.x - H_GAP - s.w;
      const me: MindOut = { x: Math.round(x), y: Math.round(top + sp / 2 - s.h / 2), w: s.w, h: s.h, level, side, hidden: false };
      out.set(k.id, me);
      if (k.collapsed) hide(kids(k.id), me, level + 1);
      else placeKids(me, kids(k.id), side, level + 1);
      top += sp + V_GAP;
    }
  };
  for (const r of roots) {
    const s = sz(r, 0);
    const me: MindOut = { x: r.x, y: r.y, w: s.w, h: s.h, level: 0, side: 'r', hidden: false };
    out.set(r.id, me);
    const list = kids(r.id);
    if (r.collapsed) {
      hide(list, me, 1);
      continue;
    }
    placeKids(me, list.filter((k) => k.side !== 'l'), 'r', 1);
    placeKids(me, list.filter((k) => k.side === 'l'), 'l', 1);
  }
  return out;
}

/** Alle Nachfahren eines Knotens (ohne ihn selbst). */
export function descendants(nodes: readonly MindIn[], id: string): string[] {
  const { kids } = mindTree(nodes);
  const out: string[] = [];
  const walk = (pid: string) => {
    for (const k of kids(pid)) {
      out.push(k.id);
      walk(k.id);
    }
  };
  walk(id);
  return out;
}
