// Anordnen: Ausrichten/Verteilen (wie die Web-App, web/src/board/ops/arrange.ts) und Auto-Layout ohne Überlappung –
// Raster, Fluss links→rechts bzw. Baum oben→unten entlang der Verbinder, Cluster nach Farbe/Tag/Typ.
import { align as alignUnits, distribute as distributeUnits, type AlignMode } from '../../../web/src/board/ops/arrange';
import { clusterLayout } from '../../../web/src/features/tools/cluster';
import { boundsOf, contains, unionOf, type Point, type Rect } from '../board/geometry';
import type { Obj, Patch } from '../board/model';
import { colorKey } from '../board/palette';
import { FRAME_PAD, grid } from './place';
import { mindRoot, mindSubtree } from './mindmap';
import type { Snap } from './read';

/** Einheit beim Anordnen: Objekt, Gruppe, ganze Mindmap oder Rahmen samt Inhalt. */
export interface Unit {
  key: string;
  ids: string[];
  rect: Rect;
  /** Vertreter für Sortierung/Cluster */
  head: Obj;
}

export function unitsOf(objs: Obj[], s: Snap): Unit[] {
  const out: Unit[] = [];
  const used = new Set<string>();
  const minds = s.all.filter((o) => o.type === 'mindnode');
  const add = (key: string, ids: string[], head: Obj) => {
    const list = ids.filter((id) => !used.has(id));
    if (!list.length) return;
    list.forEach((id) => used.add(id));
    const r = unionOf(list.map((id) => s.byId.get(id)!).filter(Boolean), s.byId);
    if (r) out.push({ key, ids: list, rect: r, head });
  };
  // Rahmen zuerst (nehmen ihren Inhalt mit)
  for (const o of objs) {
    if (o.type !== 'frame') continue;
    const fr = boundsOf(o, s.byId);
    const kids = s.all.filter((k) => k.id !== o.id && k.type !== 'connector' && contains(fr, boundsOf(k, s.byId))).map((k) => k.id);
    add(o.id, [o.id, ...kids], o);
  }
  for (const o of objs) {
    if (used.has(o.id) || o.type === 'connector') continue;
    if (o.type === 'mindnode') {
      const root = mindRoot(s.byId, o.id);
      add(`mind:${root}`, mindSubtree(minds, root), s.byId.get(root) ?? o);
    } else if (o.groupId) {
      add(`group:${o.groupId}`, s.all.filter((k) => k.groupId === o.groupId).map((k) => k.id), o);
    } else add(o.id, [o.id], o);
  }
  return out;
}

/** Patches zum Verschieben von Einheiten (freie Verbinder-Enden innerhalb wandern mit). */
export function movePatches(units: Unit[], offsets: Map<string, { dx: number; dy: number }>, s: Snap): Record<string, Patch> {
  const patches: Record<string, Patch> = {};
  const moved = new Map<string, { dx: number; dy: number }>();
  for (const u of units) {
    const d = offsets.get(u.key);
    if (!d || (!d.dx && !d.dy)) continue;
    for (const id of u.ids) {
      const o = s.byId.get(id);
      if (!o || o.locked) continue;
      patches[id] = { x: Math.round(o.x + d.dx), y: Math.round(o.y + d.dy) };
      moved.set(id, d);
    }
  }
  // Verbinder, deren beide Enden mitwandern: freie Enden mitnehmen
  for (const c of s.all) {
    if (c.type !== 'connector') continue;
    const a = c.from?.objectId ? moved.get(c.from.objectId) : undefined;
    const b = c.to?.objectId ? moved.get(c.to.objectId) : undefined;
    const d = a ?? b;
    if (!d) continue;
    const p: Patch = {};
    if (c.from && !c.from.objectId && b) p.from = { x: c.from.x + d.dx, y: c.from.y + d.dy };
    if (c.to && !c.to.objectId && a) p.to = { x: c.to.x + d.dx, y: c.to.y + d.dy };
    if (Object.keys(p).length) patches[c.id] = p;
  }
  return patches;
}

export function alignOffsets(units: Unit[], mode: AlignMode) {
  return alignUnits(units.map((u) => ({ key: u.key, rect: u.rect })), mode);
}

export function distributeOffsets(units: Unit[], axis: 'x' | 'y', gap?: number) {
  if (gap === undefined) return distributeUnits(units.map((u) => ({ key: u.key, rect: u.rect })), axis);
  // feste Abstände: vom ersten aus aneinanderreihen
  const out = new Map<string, { dx: number; dy: number }>();
  const pos = (r: Rect) => (axis === 'x' ? r.x : r.y);
  const len = (r: Rect) => (axis === 'x' ? r.w : r.h);
  const sorted = [...units].sort((a, b) => pos(a.rect) - pos(b.rect));
  let cursor = sorted.length ? pos(sorted[0]!.rect) : 0;
  for (const u of sorted) {
    const d = Math.round(cursor - pos(u.rect));
    if (d) out.set(u.key, axis === 'x' ? { dx: d, dy: 0 } : { dx: 0, dy: d });
    cursor += len(u.rect) + gap;
  }
  return out;
}

/** Lesereihenfolge: Zeilenbänder (halbe mittlere Höhe), darin links → rechts. */
export function readingOrder(units: Unit[]): Unit[] {
  if (!units.length) return units;
  const band = Math.max(40, (units.reduce((s, u) => s + u.rect.h, 0) / units.length) * 0.5);
  return [...units].sort((a, b) => Math.floor(a.rect.y / band) - Math.floor(b.rect.y / band) || a.rect.x - b.rect.x);
}

export type SortBy = 'position' | 'text' | 'color' | 'type';

function sortUnits(units: Unit[], by: SortBy): Unit[] {
  if (by === 'position') return readingOrder(units);
  const key = (u: Unit) => (by === 'text' ? String(u.head.text ?? u.head.title ?? '').toLowerCase() : by === 'color' ? colorKey(u.head.color) : u.head.type);
  return readingOrder(units).sort((a, b) => key(a).localeCompare(key(b), 'de'));
}

const offsetsTo = (units: Unit[], pos: Point[], origin: Point) =>
  new Map(units.map((u, i) => [u.key, { dx: Math.round(origin.x + pos[i]!.x - u.rect.x), dy: Math.round(origin.y + pos[i]!.y - u.rect.y) }]));

export interface LayoutResult {
  offsets: Map<string, { dx: number; dy: number }>;
  /** Grenzen des Ergebnisses */
  bounds: Rect;
  /** Beschriftungen für Cluster (Text über jedem Cluster) */
  labels?: { text: string; x: number; y: number }[];
}

/** Raster mit `columns` Spalten (Standard: möglichst quadratisch). */
export function layoutGrid(units: Unit[], origin: Point, opts: { columns?: number; gap: number; sortBy?: SortBy }): LayoutResult {
  const list = sortUnits(units, opts.sortBy ?? 'position');
  const cols = opts.columns ?? Math.max(1, Math.round(Math.sqrt(list.length * 1.4)));
  const g = grid(list.map((u) => u.rect), cols, opts.gap);
  return { offsets: offsetsTo(list, g.pos, origin), bounds: { x: origin.x, y: origin.y, w: g.w, h: g.h } };
}

/**
 * Ebenen-Layout entlang der Verbinder (Sugiyama light): Ebene = längster Weg von einer Quelle, Reihenfolge in der
 * Ebene nach Schwerpunkt der Nachbarn (weniger Kreuzungen), jede Ebene mittig. `flow` = links→rechts, `tree` = oben→unten.
 */
export function layoutLayered(units: Unit[], s: Snap, origin: Point, opts: { direction: 'right' | 'down'; gapMain: number; gapCross: number }): LayoutResult {
  const unitOf = new Map<string, Unit>();
  for (const u of units) for (const id of u.ids) unitOf.set(id, u);
  const out = new Map<string, Set<string>>(units.map((u) => [u.key, new Set()]));
  const inn = new Map<string, Set<string>>(units.map((u) => [u.key, new Set()]));
  for (const c of s.all) {
    if (c.type !== 'connector') continue;
    const a = c.from?.objectId ? unitOf.get(c.from.objectId) : undefined;
    const b = c.to?.objectId ? unitOf.get(c.to.objectId) : undefined;
    if (!a || !b || a === b) continue;
    out.get(a.key)!.add(b.key);
    inn.get(b.key)!.add(a.key);
  }
  // Zyklen brechen: DFS in Lesereihenfolge, Rückkanten ignorieren
  const order = readingOrder(units);
  const state = new Map<string, 0 | 1 | 2>();
  const dag = new Map<string, string[]>(units.map((u) => [u.key, []]));
  const visit = (k: string) => {
    state.set(k, 1);
    for (const n of out.get(k)!) {
      const st = state.get(n) ?? 0;
      if (st === 1) continue; // Rückkante
      dag.get(k)!.push(n);
      if (st === 0) visit(n);
    }
    state.set(k, 2);
  };
  for (const u of order) if (!inn.get(u.key)!.size && !state.get(u.key)) visit(u.key);
  for (const u of order) if (!state.get(u.key)) visit(u.key);
  // Ebenen: längster Weg
  const layer = new Map<string, number>();
  const indeg = new Map<string, number>(units.map((u) => [u.key, 0]));
  for (const [, ns] of dag) for (const n of ns) indeg.set(n, (indeg.get(n) ?? 0) + 1);
  const queue = order.filter((u) => !indeg.get(u.key)).map((u) => u.key);
  for (const k of queue) layer.set(k, 0);
  while (queue.length) {
    const k = queue.shift()!;
    for (const n of dag.get(k)!) {
      layer.set(n, Math.max(layer.get(n) ?? 0, layer.get(k)! + 1));
      indeg.set(n, indeg.get(n)! - 1);
      if (!indeg.get(n)) queue.push(n);
    }
  }
  const nLayers = Math.max(0, ...layer.values()) + 1;
  const layers: Unit[][] = Array.from({ length: nLayers }, () => []);
  for (const u of order) layers[layer.get(u.key) ?? 0]!.push(u);
  // Reihenfolge: Schwerpunkt der Vorgänger bzw. Nachfolger, ein paar Durchgänge
  const idx = new Map<string, number>();
  const reindex = () => layers.forEach((l) => l.forEach((u, i) => idx.set(u.key, i)));
  reindex();
  const nb = (k: string, dir: 'in' | 'out') => [...(dir === 'in' ? inn : out).get(k)!];
  for (let pass = 0; pass < 6; pass++) {
    const down = pass % 2 === 0;
    const seq = down ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const l of seq) {
      const bary = new Map(l.map((u) => {
        const ns = nb(u.key, down ? 'in' : 'out').filter((k) => idx.has(k));
        return [u.key, ns.length ? ns.reduce((a, k) => a + idx.get(k)!, 0) / ns.length : idx.get(u.key)!];
      }));
      l.sort((a, b) => bary.get(a.key)! - bary.get(b.key)!);
      reindex();
    }
  }
  const right = opts.direction === 'right';
  const main = (r: Rect) => (right ? r.w : r.h);
  const cross = (r: Rect) => (right ? r.h : r.w);
  const layerMain = layers.map((l) => Math.max(0, ...l.map((u) => main(u.rect))));
  const layerCross = layers.map((l) => l.reduce((a, u) => a + cross(u.rect), 0) + opts.gapCross * Math.max(0, l.length - 1));
  const maxCross = Math.max(0, ...layerCross);
  // Lage je Einheit: Hauptachse (Ebene) und Querachse (Start in der Ebene)
  const mainAt = new Map<string, number>();
  const crossAt = new Map<string, number>();
  let m = 0;
  layers.forEach((l, li) => {
    let c = (maxCross - layerCross[li]!) / 2;
    for (const u of l) {
      mainAt.set(u.key, m + (layerMain[li]! - main(u.rect)) / 2);
      crossAt.set(u.key, c);
      c += cross(u.rect) + opts.gapCross;
    }
    m += layerMain[li]! + opts.gapMain;
  });
  // Lange Kanten (über mehr als eine Ebene): Einheiten dazwischen, die im Weg der Linie liegen, zur Seite schieben
  // (wie ein Nein-Zweig unter die Hauptlinie), damit kein Verbinder durch ein Objekt läuft
  const byKey = new Map(units.map((u) => [u.key, u]));
  const mid = (k: string) => crossAt.get(k)! + cross(byKey.get(k)!.rect) / 2;
  const lane = 36;
  for (const [k, ns] of dag) {
    for (const n of ns) {
      const lk = layer.get(k) ?? 0;
      const ln = layer.get(n) ?? 0;
      if (ln - lk < 2) continue;
      const lo = Math.min(mid(k), mid(n)) - lane;
      const hi = Math.max(mid(k), mid(n)) + lane;
      for (let li = lk + 1; li < ln; li++) {
        const list = layers[li]!;
        for (const u of list) {
          const a = crossAt.get(u.key)!;
          if (a < hi && a + cross(u.rect) > lo) crossAt.set(u.key, hi + opts.gapCross / 2);
        }
        // Überlappungen in der Ebene auflösen (in Querrichtung nacheinander)
        const sorted = [...list].sort((p, q) => crossAt.get(p.key)! - crossAt.get(q.key)!);
        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1]!;
          const end = crossAt.get(prev.key)! + cross(prev.rect) + opts.gapCross;
          if (crossAt.get(sorted[i]!.key)! < end) crossAt.set(sorted[i]!.key, end);
        }
      }
    }
  }
  const list = units.filter((u) => crossAt.has(u.key));
  const minC = Math.min(0, ...list.map((u) => crossAt.get(u.key)!));
  const maxC = Math.max(maxCross, ...list.map((u) => crossAt.get(u.key)! + cross(u.rect))) - minC;
  const pos = list.map((u) => {
    const mm = mainAt.get(u.key)!;
    const cc = crossAt.get(u.key)! - minC;
    return right ? { x: mm, y: cc } : { x: cc, y: mm };
  });
  const totalMain = m - opts.gapMain;
  return {
    offsets: offsetsTo(list, pos, origin),
    bounds: right ? { x: origin.x, y: origin.y, w: totalMain, h: maxC } : { x: origin.x, y: origin.y, w: maxC, h: totalMain },
  };
}

/**
 * Cluster nach Farbe, erstem Tag oder Typ: je Cluster ein Raster, Cluster nebeneinander (mit Beschriftung) – dasselbe
 * Layout wie „Clustern“ im Editor und in der App (web/src/features/tools/cluster.ts `clusterLayout`).
 */
export function layoutClusters(units: Unit[], origin: Point, opts: { by: 'color' | 'tag' | 'type'; gap: number; clusterGap: number; labelSize: number }): LayoutResult {
  const keyOf = (u: Unit) =>
    opts.by === 'color' ? colorKey(u.head.color) : opts.by === 'tag' ? (Array.isArray(u.head.tags) && u.head.tags[0]?.label) || 'ohne Tag' : u.head.type;
  const l = clusterLayout(units, origin, keyOf, opts);
  return { offsets: l.offsets, bounds: l.bounds, labels: l.labels.map((x) => ({ text: x.key, x: x.x, y: x.y })) };
}

/** Rahmen auf Inhalt + Rand bringen (oben etwas mehr Platz). */
export function fitFramePatch(_frame: Obj, content: Rect): Patch {
  return { x: Math.round(content.x - FRAME_PAD), y: Math.round(content.y - FRAME_PAD), w: Math.round(content.w + 2 * FRAME_PAD), h: Math.round(content.h + 2 * FRAME_PAD) };
}
