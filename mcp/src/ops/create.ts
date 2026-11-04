// Anlegen: Objekte bauen, Bezüge (ref) auflösen, frei platzieren (neben dem Inhalt bzw. im Rahmen), Verbinder zuletzt.
import type { NewObj, Obj, Patch } from '../board/model';
import { boundsOf, type Point, type Rect } from '../board/geometry';
import { buildConnector, kindOf } from '../kinds/kinds';
import { mustGet, ToolError, type BuildCtx } from '../kinds/common';
import { flow, freeOrigin, GAP, grid, placeInFrame } from './place';
import type { Snap } from './read';

type Built = NewObj & { id: string };

export interface PlanResult {
  objs: Built[];
  /** Rahmen, die für neuen Inhalt wachsen */
  framePatches: Record<string, Patch>;
}

export function newCtx(s: Snap, model: BuildCtx['model'], people: BuildCtx['people'] = []): BuildCtx {
  return { model, all: s.all, byId: s.byId, refs: new Map(), pending: new Map(), people };
}

const rectOf = (o: { x: number; y: number; w: number; h: number }): Rect => ({ x: o.x, y: o.y, w: o.w, h: o.h });

/**
 * Plant create_objects: baut alle Einträge (Verbinder zuletzt), setzt Lagen. Einträge ohne x/y werden je Ziel
 * (Board bzw. Rahmen) als Block zeilenweise angeordnet und an einen freien Platz gelegt.
 */
export function planCreate(items: any[], s: Snap, ctx: BuildCtx, opts: { near?: Point } = {}): PlanResult {
  const objs: Built[] = [];
  const framePatches: Record<string, Patch> = {};
  const auto = new Map<string, Built[]>(); // Ziel ('' = Board, sonst Rahmen-id) → Objekte ohne Lage
  const refOf = new Map<Built, string | undefined>();
  const ordered = [...items].sort((a, b) => (a.type === 'frame' ? 0 : 1) - (b.type === 'frame' ? 0 : 1));
  for (const item of ordered) {
    if (item.type === 'connector') continue;
    const kind = kindOf(item.type);
    if (!kind?.build) throw new ToolError(`Objekttyp „${item.type}“ kann create_objects nicht anlegen.`);
    if (item.ref && (ctx.refs.has(item.ref) || ctx.byId.has(item.ref))) throw new ToolError(`ref „${item.ref}“ ist doppelt vergeben.`);
    const o = kind.build(item, ctx);
    if (item.ref) ctx.refs.set(item.ref, o.id);
    refOf.set(o, item.ref);
    const target = item.in ? mustGet(ctx, item.in, 'Rahmen') : null;
    if (target && target.type !== 'frame') throw new ToolError(`\`in\` muss ein Rahmen sein, „${item.in}“ ist ${target.type}.`);
    const hasPos = item.x !== undefined && item.y !== undefined;
    if (item.x !== undefined !== (item.y !== undefined)) throw new ToolError(`Bitte x und y zusammen angeben (oder beide weglassen) – Eintrag ${item.ref ?? item.type}.`);
    if (hasPos && target) {
      o.x = Math.round(target.x + item.x);
      o.y = Math.round(target.y + item.y);
    } else if (!hasPos) {
      const key = target?.id ?? '';
      auto.set(key, [...(auto.get(key) ?? []), o]);
    }
    ctx.pending.set(o.id, o);
    objs.push(o);
  }
  // freie Plätze: erst Board (Rahmen eingeschlossen), dann in Rahmen
  const placedRects: Rect[] = objs.filter((o) => ![...auto.values()].some((l) => l.includes(o))).map(rectOf);
  const boardList = auto.get('') ?? [];
  if (boardList.length) {
    const area = boardList.reduce((a, o) => a + o.w * o.h, 0);
    const maxW = Math.max(800, Math.min(4000, Math.sqrt(area) * 1.6), ...boardList.map((o) => o.w));
    const f = flow(boardList, maxW, boardList.every((o) => o.type === 'sticky') ? GAP : 48);
    const origin = freeOrigin(s, { w: f.w, h: f.h }, { near: opts.near, extra: placedRects });
    boardList.forEach((o, i) => {
      o.x = origin.x + f.pos[i]!.x;
      o.y = origin.y + f.pos[i]!.y;
      placedRects.push(rectOf(o));
    });
  }
  for (const [frameId, list] of auto) {
    if (!frameId) continue;
    const frame = (ctx.byId.get(frameId) ?? ctx.pending.get(frameId))!;
    const fr = { ...frame, ...(framePatches[frameId] ?? {}) } as Obj;
    const maxW = Math.max(fr.w - 96, ...list.map((o) => o.w));
    const f = flow(list, maxW, list.every((o) => o.type === 'sticky') ? GAP : 40);
    const { origin, framePatch } = placeInFrame(fr, { w: f.w, h: f.h }, s, placedRects);
    list.forEach((o, i) => {
      o.x = origin.x + f.pos[i]!.x;
      o.y = origin.y + f.pos[i]!.y;
      placedRects.push(rectOf(o));
    });
    if (framePatch) {
      if (ctx.pending.has(frameId)) Object.assign(ctx.pending.get(frameId)!, framePatch);
      else framePatches[frameId] = { ...(framePatches[frameId] ?? {}), ...framePatch };
    }
  }
  // Verbinder zuletzt (Enden dürfen auf neue Objekte zeigen)
  for (const item of items) {
    if (item.type !== 'connector') continue;
    if (item.ref && (ctx.refs.has(item.ref) || ctx.byId.has(item.ref))) throw new ToolError(`ref „${item.ref}“ ist doppelt vergeben.`);
    const c = buildConnector(item, ctx);
    if (item.ref) ctx.refs.set(item.ref, c.id);
    ctx.pending.set(c.id, c);
    objs.push(c);
  }
  return { objs, framePatches };
}

/** Raster aus Haftnotizen (create_notes). */
export function planNotes(
  notes: { text: string; color?: string; tags?: { label: string; color?: string }[] }[],
  opts: { columns?: number; gap?: number; shape?: 'square' | 'rect'; size?: number; color?: string; x?: number; y?: number; in?: string; near?: Point },
  s: Snap,
  ctx: BuildCtx,
): PlanResult {
  const kind = kindOf('sticky')!;
  const built = notes.map((n) => kind.build!({ type: 'sticky', text: n.text, color: n.color ?? opts.color, tags: n.tags, shape: opts.shape, size: opts.size }, ctx));
  const cols = opts.columns ?? Math.min(6, Math.max(1, Math.ceil(Math.sqrt(built.length))));
  const g = grid(built, cols, opts.gap ?? GAP);
  const framePatches: Record<string, Patch> = {};
  let origin: Point;
  const frame = opts.in ? mustGet(ctx, opts.in, 'Rahmen') : null;
  if (frame && frame.type !== 'frame') throw new ToolError(`\`in\` muss ein Rahmen sein, „${opts.in}“ ist ${frame.type}.`);
  if (opts.x !== undefined && opts.y !== undefined) origin = frame ? { x: frame.x + opts.x, y: frame.y + opts.y } : { x: opts.x, y: opts.y };
  else if (frame) {
    const r = placeInFrame(frame as Obj, { w: g.w, h: g.h }, s);
    origin = r.origin;
    if (r.framePatch) framePatches[frame.id] = r.framePatch;
  } else origin = freeOrigin(s, { w: g.w, h: g.h }, { near: opts.near });
  built.forEach((o, i) => {
    o.x = Math.round(origin.x + g.pos[i]!.x);
    o.y = Math.round(origin.y + g.pos[i]!.y);
  });
  return { objs: built, framePatches };
}

export interface KanbanSpec {
  title?: string;
  columns: { title: string; color?: string; cards: any[] }[];
  columnWidth?: number;
  x?: number;
  y?: number;
}

/** Kanban wie die Vorlage (structure/templates/catalog.ts): Rahmen, Spalten mit Farbbalken und Kopf, Karten. */
export function planKanban(spec: KanbanSpec, s: Snap, ctx: BuildCtx, resolveInk: (c: string | undefined, field: string) => string | undefined): { plan: PlanResult; frameId: string; columnIds: string[]; cardIds: string[][] } {
  const colW = spec.columnWidth ?? 380;
  const cardKind = kindOf('card')!;
  const shapeKind = kindOf('shape')!;
  const textKind = kindOf('text')!;
  const frameKind = kindOf('frame')!;
  const defaults = ['#8a8a85', '#1763b5', '#e8590c', '#7aa21b', '#7048e8', '#ec4e92'];
  const cols = spec.columns.map((c, i) => {
    const accent = resolveInk(c.color, `columns[${i}].color`) ?? defaults[i % defaults.length]!;
    const cards = c.cards.map((card) => cardKind.build!({ type: 'card', ...card, color: card.color ?? accent, w: colW - 40 }, ctx));
    let y = 88;
    for (const k of cards) {
      k.y = y;
      y += k.h + 16;
    }
    return { accent, cards, h: Math.max(300, y + 24), title: c.title };
  });
  const colH = Math.max(...cols.map((c) => c.h));
  const w = 40 + cols.length * (colW + 20) + 20;
  const h = colH + 80;
  const origin = spec.x !== undefined && spec.y !== undefined ? { x: spec.x, y: spec.y } : freeOrigin(s, { w, h });
  const frame = frameKind.build!({ type: 'frame', title: spec.title ?? 'Kanban', w, h }, ctx);
  frame.x = origin.x;
  frame.y = origin.y;
  const objs: Built[] = [frame];
  const columnIds: string[] = [];
  const cardIds: string[][] = [];
  cols.forEach((c, i) => {
    const x = origin.x + 40 + i * (colW + 20);
    const y = origin.y + 40;
    const bg = shapeKind.build!({ type: 'shape', shape: 'rect', w: colW, h: colH, color: '#f3f3ef', strokeWidth: 0 }, ctx);
    Object.assign(bg, { x, y });
    const bar = shapeKind.build!({ type: 'shape', shape: 'rect', w: colW, h: 8, color: c.accent, strokeWidth: 0 }, ctx);
    Object.assign(bar, { x, y });
    const head = textKind.build!({ type: 'text', text: c.title.toUpperCase(), fontSize: 26, bold: true, fontFamily: 'condensed' }, ctx);
    Object.assign(head, { x: x + 22, y: y + 26 });
    objs.push(bg, bar, head);
    columnIds.push(bg.id);
    const ids: string[] = [];
    for (const k of c.cards) {
      k.x = x + 20;
      k.y = y + k.y;
      objs.push(k);
      ids.push(k.id);
    }
    cardIds.push(ids);
  });
  return { plan: { objs, framePatches: {} }, frameId: frame.id, columnIds, cardIds };
}

/** Grenzen geplanter Objekte (ohne Verbinder). */
export function planBounds(objs: Built[], s: Snap): Rect | null {
  const list = objs.filter((o) => o.type !== 'connector');
  if (!list.length) return null;
  const byId = new Map<string, Obj>([...s.byId, ...list.map((o) => [o.id, o as Obj] as const)]);
  const rs = list.map((o) => boundsOf(o as Obj, byId));
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
}
