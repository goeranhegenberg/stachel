// Clustern ohne KI (Q3): ausgewählte Objekte nach Farbe, erstem Tag oder Autor:in in ordentliche Gruppen legen – je
// Gruppe ein Raster mit Überschrift, Gruppen nebeneinander. Das Raster ist das Auto-Layout des MCP-Servers
// (mcp/src/ops/layout.ts `layoutClusters` rechnet mit `clusterLayout` von hier), damit Web, App (Web-Aktion
// `tools.cluster`, native-organize.ts) und KI-Assistent dasselbe Ergebnis bekommen. React-frei (läuft auf dem Server).
import type { BoardStore, NewObject, Patch } from '../../board/store';
import { objRect, unionRects, type Point, type Rect } from '../../board/geometry';
import { measureText } from '../../editor/measureText';
import { STICKY_COLORS, type BoardObject } from '../../protocol';

export type ClusterBy = 'color' | 'tag' | 'author';

/** Einheit beim Anordnen (wie MCP `Unit`): ein Objekt oder eine ganze Gruppe. */
export interface ClusterUnit<T = BoardObject> {
  key: string;
  ids: string[];
  rect: Rect;
  /** Vertreter für die Gruppierung */
  head: T;
}

/** Größen wie das MCP-Auto-Layout: Abstand in einer Gruppe, zwischen Gruppen, Schriftgröße der Überschrift. */
export const CLUSTER_GAP_NOTES = 24;
export const CLUSTER_GAP = 48;
export const CLUSTER_LABEL_SIZE = 32;
export const clusterGapBetween = (gap: number) => Math.max(120, gap * 4);
export const clusterLabelHeight = (labelSize: number) => (labelSize ? Math.ceil(labelSize * 1.25) + 16 : 0);

/** Lesereihenfolge: Zeilenbänder (halbe mittlere Höhe), darin links → rechts (wie MCP `readingOrder`). */
export function bandOrder<U extends { rect: Rect }>(units: readonly U[]): U[] {
  if (!units.length) return [...units];
  const band = Math.max(40, (units.reduce((s, u) => s + u.rect.h, 0) / units.length) * 0.5);
  return [...units].sort((a, b) => Math.floor(a.rect.y / band) - Math.floor(b.rect.y / band) || a.rect.x - b.rect.x);
}

/** Raster mit `columns` Spalten: Spaltenbreite = breitestes Element der Spalte, Zeilenhöhe = höchstes der Zeile. */
export function gridOf(boxes: readonly { w: number; h: number }[], columns: number, gap: number): { pos: Point[]; w: number; h: number } {
  const cols = Math.max(1, Math.min(columns, boxes.length || 1));
  const colW = Array.from({ length: cols }, (_, c) => Math.max(0, ...boxes.filter((_, i) => i % cols === c).map((b) => b.w)));
  const rows = Math.ceil(boxes.length / cols);
  const rowH = Array.from({ length: rows }, (_, r) => Math.max(0, ...boxes.slice(r * cols, r * cols + cols).map((b) => b.h)));
  const colX = colW.map((_, c) => colW.slice(0, c).reduce((a, b) => a + b + gap, 0));
  const rowY = rowH.map((_, r) => rowH.slice(0, r).reduce((a, b) => a + b + gap, 0));
  const pos = boxes.map((_, i) => ({ x: colX[i % cols]!, y: rowY[Math.floor(i / cols)]! }));
  return { pos, w: colX[cols - 1]! + colW[cols - 1]!, h: rows ? rowY[rows - 1]! + rowH[rows - 1]! : 0 };
}

export interface ClusterLayout {
  offsets: Map<string, { dx: number; dy: number }>;
  bounds: Rect;
  /** Überschrift je Gruppe (Schlüssel der Gruppe, linke obere Ecke) in Reihenfolge der Gruppen */
  labels: { key: string; x: number; y: number }[];
  /** Gruppen in Reihenfolge mit ihren Einheiten */
  groups: { key: string; units: string[] }[];
}

/**
 * Gruppen nach `keyOf` (Reihenfolge = erstes Vorkommen in Lesereihenfolge), je Gruppe ein Raster mit
 * round(√n) Spalten, Gruppen nebeneinander ab `origin`; mit `labelSize` Platz für eine Überschrift darüber.
 */
export function clusterLayout<T>(units: readonly ClusterUnit<T>[], origin: Point, keyOf: (u: ClusterUnit<T>) => string, opts: { gap: number; clusterGap: number; labelSize: number }): ClusterLayout {
  const groups = new Map<string, ClusterUnit<T>[]>();
  for (const u of bandOrder(units)) {
    const k = keyOf(u);
    groups.set(k, [...(groups.get(k) ?? []), u]);
  }
  const offsets = new Map<string, { dx: number; dy: number }>();
  const labels: ClusterLayout['labels'] = [];
  const labelH = clusterLabelHeight(opts.labelSize);
  let x = origin.x;
  let maxH = 0;
  for (const [key, list] of groups) {
    const cols = Math.max(1, Math.round(Math.sqrt(list.length)));
    const g = gridOf(list.map((u) => u.rect), cols, opts.gap);
    if (opts.labelSize) labels.push({ key, x, y: origin.y });
    list.forEach((u, i) => offsets.set(u.key, { dx: Math.round(x + g.pos[i]!.x - u.rect.x), dy: Math.round(origin.y + labelH + g.pos[i]!.y - u.rect.y) }));
    x += g.w + opts.clusterGap;
    maxH = Math.max(maxH, g.h + labelH);
  }
  return {
    offsets,
    bounds: { x: origin.x, y: origin.y, w: groups.size ? x - opts.clusterGap - origin.x : 0, h: maxH },
    labels,
    groups: [...groups].map(([key, list]) => ({ key, units: list.map((u) => u.key) })),
  };
}

// ---- Board-Objekte -------------------------------------------------------------------------------------------------

/** Was nicht mitclustert: Verbinder (folgen ihren Enden), Rahmen, Mindmap-Knoten (eigenes Layout), Gesperrtes. */
export const clusterable = (o: BoardObject) => o.type !== 'connector' && o.type !== 'frame' && o.type !== 'mindnode' && !o.locked;

/** Einheiten der Auswahl: Gruppen ganz (alle ungesperrten Mitglieder), sonst je Objekt. */
export function clusterUnits(objs: readonly BoardObject[], all: readonly BoardObject[]): ClusterUnit[] {
  const out: ClusterUnit[] = [];
  const used = new Set<string>();
  for (const o of objs) {
    if (used.has(o.id) || !clusterable(o)) continue;
    const members = o.groupId ? all.filter((k) => k.groupId === o.groupId && clusterable(k)) : [o];
    const list = members.filter((k) => !used.has(k.id));
    if (!list.length) continue;
    list.forEach((k) => used.add(k.id));
    const r = unionRects(list.map(objRect));
    if (r) out.push({ key: o.groupId ? `group:${o.groupId}` : o.id, ids: list.map((k) => k.id), rect: r, head: o });
  }
  return out;
}

const tagKey = (o: BoardObject): string | null => {
  const t = Array.isArray(o.tags) ? o.tags.find((x) => x && typeof x.label === 'string' && x.label.trim()) : undefined;
  return t ? t.label.trim().toLocaleLowerCase('de') : null;
};

/**
 * Deutsche Farbnamen für die Überschriften – dieselben wie `COLOR_NAMES` in ui/a11y.ts (der Server darf die Datei nicht
 * laden, sie hängt am Editor-Register; organize.test.ts prüft die Gleichheit).
 */
export const CLUSTER_COLOR_NAMES: Record<string, string> = {
  '#fff27a': 'Gelb',
  '#c9e14a': 'Grün',
  '#ffb3d1': 'Rosa',
  '#9fd3ff': 'Hellblau',
  '#ffd08a': 'Orange',
  '#e2d5ff': 'Lila',
  '#ffffff': 'Weiß',
  '#ff9e8a': 'Koralle',
  '#b9ecd8': 'Mint',
  '#7fd6e0': 'Türkis',
  '#7fb2f0': 'Mittelblau',
  '#d4d4cc': 'Steingrau',
  '#000000': 'Schwarz',
  '#0a0a0a': 'Schwarz',
  '#1763b5': 'Blau',
  '#ec4e92': 'Pink',
  '#e9e9e4': 'Hellgrau',
  '#8a8a85': 'Grau',
  '#7aa21b': 'Dunkelgrün',
  '#e8590c': 'Dunkelorange',
  '#7048e8': 'Violett',
  '#0c8599': 'Petrol',
  '#c2255c': 'Beere',
  '#5c940d': 'Olivgrün',
};

/** Farbe, mit der ein Typ ohne `color` gezeichnet wird (Haftnotiz gelb, Form weiß, Text schwarz, Karte blau). */
const DEFAULT_COLOR: Record<string, string> = { sticky: STICKY_COLORS[0]!, shape: '#ffffff', text: '#0a0a0a', card: '#1763b5' };

/** Schlüssel der Gruppe eines Objekts (leer = ohne Farbe/Tag/Autor:in). */
export function clusterKey(o: BoardObject, by: ClusterBy): string {
  if (by === 'color') return (o.color ?? DEFAULT_COLOR[o.type] ?? '').toLowerCase();
  if (by === 'tag') return tagKey(o) ?? '';
  return o.createdBy ?? '';
}

/** Überschrift einer Gruppe: Farbname, Tag wie geschrieben, Name der Person. */
export function clusterHeading(key: string, by: ClusterBy, objs: readonly BoardObject[], names: ReadonlyMap<string, string>): string {
  if (by === 'color') return key ? (CLUSTER_COLOR_NAMES[key] ?? key) : 'Ohne Farbe';
  if (by === 'tag') {
    if (!key) return 'Ohne Tag';
    for (const o of objs) for (const t of Array.isArray(o.tags) ? o.tags : []) if (t && typeof t.label === 'string' && t.label.trim().toLocaleLowerCase('de') === key) return t.label.trim();
    return key;
  }
  return key ? (names.get(key) ?? 'Unbekannt') : 'Unbekannt';
}

/** Überschrift als Text-Objekt (fett, Barlow Condensed 32, Breite folgt dem Text) an `at`. */
export function headingObject(text: string, at: Point, id?: string): NewObject {
  const fs = CLUSTER_LABEL_SIZE;
  const w = Math.min(2400, Math.max(Math.round(fs * 1.2), Math.ceil(measureText(text, fs, 700, false, 'Barlow Condensed') + fs * 0.25 + 4)));
  // fontFamily gehört dem Modul richtext (Module-Augmentation, im Server-Typcheck nicht geladen)
  return { ...(id ? { id } : {}), type: 'text', x: Math.round(at.x), y: Math.round(at.y), w, h: Math.ceil(fs * 1.25), text, fontSize: fs, bold: true, fontFamily: 'condensed', color: '#0a0a0a', autoWidth: true } as NewObject;
}

/** Namen für „nach Autor:in“: wer das Board geöffnet hat (`structure.people`) und ggf. weitere bekannte Personen. */
export function peopleNames(store: BoardStore, extra: Iterable<[string, string]> = []): Map<string, string> {
  const names = new Map<string, string>();
  for (const [k, v] of store.extMap<string>('structure.people', { undo: false }).entries()) if (typeof v === 'string') names.set(k, v);
  for (const [k, v] of extra) if (k && v) names.set(k, v);
  return names;
}

/** Gibt es in der Auswahl etwas zu clustern (mindestens zwei Einheiten)? */
export const canCluster = (objs: readonly BoardObject[], all: readonly BoardObject[]) => clusterUnits(objs, all).length >= 2;

export interface ClusterResult {
  /** alles Bewegte und die neuen Überschriften (Auswahl danach) */
  select: string[];
  /** Anzahl Gruppen */
  groups: number;
  rect: Rect;
}

/**
 * Clustern ausführen (ein Rückgängig-Schritt): Einheiten verschieben (Verbinder mit freien Enden zwischen bewegten
 * Objekten wandern mit), Überschriften als Text-Objekte anlegen. `newId(i)` = ID der i-ten Überschrift (ab 0).
 */
export function clusterInStore(store: BoardStore, ids: readonly string[], by: ClusterBy, names: ReadonlyMap<string, string>, newId?: (i: number) => string): ClusterResult | null {
  const snap = store.getSnapshot();
  const objs = ids.map((id) => snap.byId.get(id)).filter((o): o is BoardObject => !!o);
  const units = clusterUnits(objs, snap.ordered);
  if (units.length < 2) return null;
  const cur = unionRects(units.map((u) => u.rect))!;
  const members = units.flatMap((u) => u.ids.map((id) => snap.byId.get(id)!));
  const gap = members.every((o) => o.type === 'sticky') ? CLUSTER_GAP_NOTES : CLUSTER_GAP;
  const layout = clusterLayout(units, { x: cur.x, y: cur.y }, (u) => clusterKey(u.head, by), { gap, clusterGap: clusterGapBetween(gap), labelSize: CLUSTER_LABEL_SIZE });
  const patches: Record<string, Patch> = {};
  const moved = new Map<string, { dx: number; dy: number }>();
  for (const u of units) {
    const d = layout.offsets.get(u.key);
    if (!d || (!d.dx && !d.dy)) continue;
    for (const id of u.ids) {
      const o = snap.byId.get(id)!;
      patches[id] = { x: Math.round(o.x + d.dx), y: Math.round(o.y + d.dy) };
      moved.set(id, d);
    }
  }
  // Verbinder: freie Enden mitnehmen, wenn das andere Ende an einem bewegten Objekt hängt (wie MCP movePatches)
  for (const c of snap.ordered) {
    if (c.type !== 'connector') continue;
    const a = c.from && 'objectId' in c.from ? moved.get(c.from.objectId) : undefined;
    const b = c.to && 'objectId' in c.to ? moved.get(c.to.objectId) : undefined;
    const p: Patch = {};
    if (c.from && !('objectId' in c.from) && b) p.from = { x: c.from.x + b.dx, y: c.from.y + b.dy };
    if (c.to && !('objectId' in c.to) && a) p.to = { x: c.to.x + a.dx, y: c.to.y + a.dy };
    if (Object.keys(p).length) patches[c.id] = p;
  }
  const headings = layout.labels.map((l, i) => headingObject(clusterHeading(l.key, by, members, names), l, newId?.(i)));
  let created: string[] = [];
  store.stopCapturing();
  store.transact(() => {
    if (Object.keys(patches).length) store.updateMany(patches);
    created = store.createMany(headings);
  });
  store.stopCapturing();
  return { select: [...members.map((o) => o.id), ...created], groups: layout.groups.length, rect: layout.bounds };
}
