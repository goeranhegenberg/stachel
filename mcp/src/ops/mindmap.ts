// Mindmaps: aus Baum (JSON oder eingerückter Liste) anlegen, an Knoten anhängen und nach Änderungen neu layouten –
// mit demselben Layout wie die Web-App (web/src/features/structure/mindmap/layout.ts). Die Web-App rechnet fremde
// Änderungen nicht nach; wer ändert, schreibt Lage, Größe und `mind` aller Knoten der Mindmap mit (Vertrag structure.md).
import { nanoid } from 'nanoid';
import { layoutMind, mindTree, type MindIn } from '../../../web/src/features/structure/mindmap/layout';
import type { Obj, Patch } from '../board/model';
import { MIND_COLORS, mindSize } from '../layout/sizes';
import { ToolError } from '../kinds/common';

export interface MindSpec {
  text: string;
  color?: string;
  side?: 'left' | 'right';
  collapsed?: boolean;
  children?: MindSpec[];
}

export const MAX_MIND_NODES = 400;

/** Eingerückte Liste („- Thema“, 2 Leerzeichen je Ebene; erste Zeile = Wurzel) → Baum. */
export function parseOutline(outline: string): MindSpec {
  const lines = outline
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim());
  if (!lines.length) throw new ToolError('`outline` ist leer. Beispiel: "Festival\\n- Programm\\n  - Bands\\n- Orga".');
  const items = lines.map((l) => {
    const m = /^(\s*)(?:[-*+]|\d+[.)])?\s*(.*)$/.exec(l)!;
    return { indent: m[1]!.replace(/\t/g, '  ').length, text: m[2]!.trim() };
  });
  const root: MindSpec = { text: items[0]!.text, children: [] };
  const stack: { indent: number; node: MindSpec }[] = [{ indent: -1, node: root }];
  for (const it of items.slice(1)) {
    while (stack.length > 1 && stack[stack.length - 1]!.indent >= it.indent) stack.pop();
    const node: MindSpec = { text: it.text, children: [] };
    stack[stack.length - 1]!.node.children!.push(node);
    stack.push({ indent: it.indent, node });
  }
  return root;
}

const count = (s: MindSpec): number => 1 + (s.children ?? []).reduce((n, k) => n + count(k), 0);
const depth = (s: MindSpec): number => 1 + Math.max(0, ...(s.children ?? []).map(depth));

const toIn = (o: Obj): MindIn => ({ id: o.id, parent: o.mind?.parent, order: o.mind?.order, side: o.mind?.side, collapsed: o.mind?.collapsed, x: o.x, y: o.y });

/** Layout-Patches für alle Knoten (ändert nur, was abweicht). `nodes` = alle Mindmap-Knoten nach der Änderung. */
export function layoutPatches(nodes: readonly Obj[], roots?: ReadonlySet<string>): Record<string, Patch> {
  const ins = nodes.map(toIn);
  const text = new Map(nodes.map((o) => [o.id, String(o.text ?? '')]));
  const out = layoutMind(ins, (n, level) => mindSize(text.get(n.id) ?? '', level));
  const tree = mindTree(ins);
  const rootOf = (id: string): string => {
    let cur = id;
    for (let i = 0; i < 1000; i++) {
      const p = tree.parentOf(cur);
      if (!p) return cur;
      cur = p;
    }
    return cur;
  };
  const patches: Record<string, Patch> = {};
  for (const o of nodes) {
    const p = out.get(o.id);
    if (!p || (roots && !roots.has(rootOf(o.id)))) continue;
    const isRoot = !tree.parentOf(o.id);
    const mind: Record<string, unknown> = { ...o.mind, level: p.level };
    if (isRoot) delete mind.side;
    else mind.side = p.side;
    if (p.hidden) mind.hidden = true;
    else delete mind.hidden;
    const patch: Patch = {};
    if (o.x !== p.x) patch.x = p.x;
    if (o.y !== p.y) patch.y = p.y;
    if (o.w !== p.w) patch.w = p.w;
    if (o.h !== p.h) patch.h = p.h;
    if (JSON.stringify(o.mind ?? {}) !== JSON.stringify(mind)) patch.mind = mind;
    if (Object.keys(patch).length) patches[o.id] = patch;
  }
  return patches;
}

/** Wurzel eines Knotens. */
export function mindRoot(byId: ReadonlyMap<string, Obj>, id: string): string {
  const seen = new Set<string>();
  let cur = id;
  for (;;) {
    seen.add(cur);
    const p = byId.get(cur)?.mind?.parent as string | undefined;
    if (!p || seen.has(p) || byId.get(p)?.type !== 'mindnode') return cur;
    cur = p;
  }
}

/** Knoten samt aller Nachfahren. */
export function mindSubtree(nodes: readonly Obj[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const k of nodes) if (k.mind?.parent === out[i] && !out.includes(k.id)) out.push(k.id);
  return out;
}

/**
 * Neue Knoten aus dem Baum. Mit `parent` hängen sie an einem vorhandenen Knoten (Ebene `parentLevel` + 1),
 * sonst ist `spec` die Wurzel bei (x, y). Farben wie die Web-App: Hauptthemen der Reihe nach, Unterthemen erben.
 */
export function buildMind(
  spec: MindSpec,
  opts: { x: number; y: number; parent?: Obj; parentLevel?: number; siblings?: number; resolveColor: (c: string | undefined) => string | undefined; balance?: boolean },
): (Obj & { id: string })[] {
  if (count(spec) > MAX_MIND_NODES) throw new ToolError(`Zu viele Knoten (${count(spec)}, höchstens ${MAX_MIND_NODES}). Bitte in mehrere Mindmaps teilen.`);
  if (depth(spec) > 10) throw new ToolError('Zu tief verschachtelt (höchstens 10 Ebenen).');
  const out: (Obj & { id: string })[] = [];
  const walk = (s: MindSpec, parent: string | undefined, level: number, inherited: string, order: number, side: 'l' | 'r' | undefined) => {
    if (typeof s.text !== 'string') throw new ToolError('Jeder Knoten braucht `text`.');
    const id = nanoid();
    const own = opts.resolveColor(s.color);
    const color = own ?? (level === 0 ? '#0a0a0a' : level === 1 ? MIND_COLORS[order % MIND_COLORS.length]! : inherited);
    const size = mindSize(s.text, level);
    const mind: Record<string, unknown> = parent ? { parent, order } : { level: 0 };
    if (level === 1) mind.side = side ?? 'r';
    if (s.collapsed) mind.collapsed = true;
    out.push({ id, type: 'mindnode', x: opts.x, y: opts.y, ...size, z: '', text: s.text.slice(0, 500), color, mind });
    const kids = s.children ?? [];
    const explicit = kids.some((k) => k.side);
    const half = Math.ceil(kids.length / 2);
    kids.forEach((k, i) => {
      let kSide: 'l' | 'r' | undefined;
      if (level === 0) kSide = k.side ? (k.side === 'left' ? 'l' : 'r') : !explicit && opts.balance && kids.length >= 5 && i >= half ? 'l' : 'r';
      walk(k, id, level + 1, color, i, kSide);
    });
    return id;
  };
  if (opts.parent) {
    const level = (opts.parentLevel ?? 0) + 1;
    const side = level === 1 ? (spec.side === 'left' ? 'l' : 'r') : undefined;
    walk(spec, opts.parent.id, level, String(opts.parent.color ?? '#0a0a0a'), opts.siblings ?? 0, side);
  } else walk(spec, undefined, 0, '#0a0a0a', 0, undefined);
  return out;
}

/** Layout einer neuen Mindmap mit der Wurzel bei (0,0): Knoten mit Lage und die Grenzen relativ zur Wurzel. */
export function layoutNew(nodes: (Obj & { id: string })[]): { nodes: (Obj & { id: string })[]; bounds: { x: number; y: number; w: number; h: number } } {
  const lay = layoutPatches(nodes);
  const placed = nodes.map((n) => ({ ...n, ...(lay[n.id] ?? {}) }) as Obj & { id: string });
  const vis = placed.filter((n) => !n.mind?.hidden);
  const x1 = Math.min(...vis.map((n) => n.x));
  const y1 = Math.min(...vis.map((n) => n.y));
  const x2 = Math.max(...vis.map((n) => n.x + n.w));
  const y2 = Math.max(...vis.map((n) => n.y + n.h));
  return { nodes: placed, bounds: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } };
}
