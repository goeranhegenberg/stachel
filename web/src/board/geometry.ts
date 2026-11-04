// Reine Geometrie: Rechtecke, Kamera, Hit-Tests.
import type { BoardObject } from '../protocol';
import { hitRole } from './types';

export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Kamera: screen = world * z + (x, y). */
export interface Camera {
  x: number;
  y: number;
  z: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function normRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
  );
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function expand(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

export const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export const screenToWorld = (cam: Camera, p: Point): Point => ({ x: (p.x - cam.x) / cam.z, y: (p.y - cam.y) / cam.z });
export const worldToScreen = (cam: Camera, p: Point): Point => ({ x: p.x * cam.z + cam.x, y: p.y * cam.z + cam.y });

export function rectToScreen(cam: Camera, r: Rect): Rect {
  return { x: r.x * cam.z + cam.x, y: r.y * cam.z + cam.y, w: r.w * cam.z, h: r.h * cam.z };
}

/** Sichtbarer Weltausschnitt für eine Bildschirmgröße. */
export function viewRect(cam: Camera, width: number, height: number): Rect {
  return { x: -cam.x / cam.z, y: -cam.y / cam.z, w: width / cam.z, h: height / cam.z };
}

/** Zoomt so, dass der Bildschirmpunkt `anchor` über demselben Weltpunkt bleibt. */
export function zoomAt(cam: Camera, anchor: Point, nextZoom: number): Camera {
  const z = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  const w = screenToWorld(cam, anchor);
  return { x: anchor.x - w.x * z, y: anchor.y - w.y * z, z };
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Kamera, die `r` mit Rand (Zahl oder Abstände je Seite) in einen Bildschirm der Größe width×height einpasst. */
export function fitRect(r: Rect, width: number, height: number, padding: number | Insets = 80, maxZoom = 1): Camera {
  const p = typeof padding === 'number' ? { top: padding, right: padding, bottom: padding, left: padding } : padding;
  const availW = Math.max(1, width - p.left - p.right);
  const availH = Math.max(1, height - p.top - p.bottom);
  const z = clamp(Math.min(availW / Math.max(r.w, 1), availH / Math.max(r.h, 1), maxZoom), MIN_ZOOM, MAX_ZOOM);
  const c = center(r);
  return { x: p.left + availW / 2 - c.x * z, y: p.top + availH / 2 - c.y * z, z };
}

/** Nächste „runde" Zoomstufe für +/−. */
const ZOOM_STEPS = [0.05, 0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];
export function nextZoomStep(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 0.001) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? MIN_ZOOM;
}

type Box = Pick<BoardObject, 'x' | 'y' | 'w' | 'h'> & { rotation?: number };

/** Drehung in Grad (0, wenn nicht gesetzt/ungültig), auf (-180, 180] normiert. */
export function rotationOf(o: { rotation?: number }): number {
  const r = o.rotation;
  if (typeof r !== 'number' || !Number.isFinite(r)) return 0;
  const n = ((((r + 180) % 360) + 360) % 360) - 180;
  return n === -180 ? 180 : n;
}

/** Ungedrehtes Rechteck eines Objekts (x/y/w/h wie gespeichert). */
export const baseRect = (o: Pick<BoardObject, 'x' | 'y' | 'w' | 'h'>): Rect => ({ x: o.x, y: o.y, w: o.w, h: o.h });

/** Achsenparalleles Rechteck um ein (ggf. um seine Mitte gedrehtes) Rechteck. */
export function rotatedAABB(r: Rect, deg: number): Rect {
  if (!deg) return { x: r.x, y: r.y, w: r.w, h: r.h };
  const a = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const w = r.w * c + r.h * s;
  const h = r.w * s + r.h * c;
  return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h };
}

/** Weltrechteck eines Objekts – bei Drehung das umschließende achsenparallele Rechteck. */
export const objRect = (o: Box): Rect => rotatedAABB(baseRect(o), rotationOf(o));

/** Dreht `p` um `c` (Grad, im Uhrzeigersinn bei y nach unten). */
export function rotatePoint(p: Point, c: Point, deg: number): Point {
  if (!deg) return p;
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Liegt der Punkt im (ggf. gedrehten) Objekt? */
export function pointInObject(p: Point, o: Box): boolean {
  const deg = rotationOf(o);
  const r = baseRect(o);
  return pointInRect(deg ? rotatePoint(p, center(r), -deg) : p, r);
}

/**
 * Oberstes Objekt unter einem Weltpunkt. `ordered` ist von unten nach oben sortiert.
 * Typen mit Hit-Rolle 'none' (Verbinder, Stiftstriche) werden ausgelassen, 'background' (Rahmen) nur, wenn sonst nichts trifft.
 */
export function hitTest(ordered: readonly BoardObject[], p: Point, skip?: (o: BoardObject) => boolean): BoardObject | null {
  let frame: BoardObject | null = null;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const o = ordered[i];
    const role = hitRole(o);
    if (role === 'none' || skip?.(o)) continue;
    if (!pointInObject(p, o)) continue;
    if (role === 'background') {
      frame ??= o;
      continue;
    }
    return o;
  }
  return frame;
}

/** Abstand Punkt–Strecke. */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Neues Rechteck beim Ziehen am Griff. `keepAspect` hält das Seitenverhältnis. */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, keepAspect: boolean, min = 8): Rect {
  let x1 = start.x;
  let y1 = start.y;
  let x2 = start.x + start.w;
  let y2 = start.y + start.h;
  if (handle.includes('w')) x1 += dx;
  if (handle.includes('e')) x2 += dx;
  if (handle.includes('n')) y1 += dy;
  if (handle.includes('s')) y2 += dy;
  let w = Math.max(min, x2 - x1);
  let h = Math.max(min, y2 - y1);
  if (handle.includes('w')) x1 = x2 - w;
  if (handle.includes('n')) y1 = y2 - h;
  if (keepAspect && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    const horizontal = handle === 'e' || handle === 'w';
    const vertical = handle === 'n' || handle === 's';
    if (horizontal) h = w / ratio;
    else if (vertical) w = h * ratio;
    else if (w / h > ratio) h = w / ratio;
    else w = h * ratio;
    if (handle.includes('w')) x1 = x2 - w;
    if (handle.includes('n')) y1 = y2 - h;
    if (vertical) x1 = start.x + (start.w - w) / 2;
    if (horizontal) y1 = start.y + (start.h - h) / 2;
  }
  return { x: x1, y: y1, w, h };
}

/**
 * Raster-Index für schnelle Bereichsabfragen (Hit-Test, Auswahlrechteck, Culling).
 * Zellen von `cell` Weltpunkten; sehr große Objekte landen in einer eigenen Liste statt in tausenden Zellen.
 * `sync()` gleicht mit einer neuen Objekt-Map ab und fasst nur geänderte Einträge an (Vergleich per Identität).
 */
export class GridIndex<T = unknown> {
  private cells = new Map<string, Set<string>>();
  private rects = new Map<string, Rect>();
  private big = new Set<string>();
  private last: ReadonlyMap<string, T> | null = null;

  constructor(
    readonly cell = 512,
    private readonly maxCells = 1024,
  ) {}

  get size() {
    return this.rects.size;
  }

  rectOf(id: string): Rect | undefined {
    return this.rects.get(id);
  }

  set(id: string, r: Rect) {
    this.delete(id);
    if (!Number.isFinite(r.x + r.y + r.w + r.h)) return;
    this.rects.set(id, r);
    const [x1, y1, x2, y2] = this.span(r);
    if ((x2 - x1 + 1) * (y2 - y1 + 1) > this.maxCells) {
      this.big.add(id);
      return;
    }
    for (let cx = x1; cx <= x2; cx++)
      for (let cy = y1; cy <= y2; cy++) {
        const k = `${cx},${cy}`;
        let s = this.cells.get(k);
        if (!s) this.cells.set(k, (s = new Set()));
        s.add(id);
      }
  }

  delete(id: string) {
    const r = this.rects.get(id);
    if (!r) return;
    this.rects.delete(id);
    if (this.big.delete(id)) return;
    const [x1, y1, x2, y2] = this.span(r);
    for (let cx = x1; cx <= x2; cx++)
      for (let cy = y1; cy <= y2; cy++) {
        const k = `${cx},${cy}`;
        const s = this.cells.get(k);
        if (!s) continue;
        s.delete(id);
        if (s.size === 0) this.cells.delete(k);
      }
  }

  clear() {
    this.cells.clear();
    this.rects.clear();
    this.big.clear();
    this.last = null;
  }

  /** IDs aller Einträge, deren Rechteck `r` schneidet (exakt geprüft, ohne Reihenfolge). */
  query(r: Rect): Set<string> {
    const out = new Set<string>();
    const [x1, y1, x2, y2] = this.span(r);
    const cellsInQuery = (x2 - x1 + 1) * (y2 - y1 + 1);
    if (cellsInQuery > this.cells.size) {
      // Abfrage größer als der belegte Bereich: einfach alle prüfen
      for (const [id, b] of this.rects) if (intersects(b, r)) out.add(id);
      return out;
    }
    for (let cx = x1; cx <= x2; cx++)
      for (let cy = y1; cy <= y2; cy++) {
        const s = this.cells.get(`${cx},${cy}`);
        if (!s) continue;
        for (const id of s) if (!out.has(id) && intersects(this.rects.get(id)!, r)) out.add(id);
      }
    for (const id of this.big) if (intersects(this.rects.get(id)!, r)) out.add(id);
    return out;
  }

  queryPoint(p: Point): Set<string> {
    return this.query({ x: p.x, y: p.y, w: 0, h: 0 });
  }

  /**
   * Abgleich mit einer neuen Objekt-Map: nur Einträge mit neuer Identität werden neu einsortiert.
   * Rechtecke, die von anderen Objekten abhängen (Verbinder), hier mit `null` auslassen.
   */
  sync(next: ReadonlyMap<string, T>, rectOf: (o: T) => Rect | null) {
    const prev = this.last;
    if (prev === next) return;
    if (prev) for (const id of prev.keys()) if (!next.has(id)) this.delete(id);
    for (const [id, o] of next) {
      if (prev && prev.get(id) === o) continue;
      const r = rectOf(o);
      if (r) this.set(id, r);
      else this.delete(id);
    }
    this.last = next;
  }

  private span(r: Rect): [number, number, number, number] {
    const c = this.cell;
    return [Math.floor(r.x / c), Math.floor(r.y / c), Math.floor((r.x + r.w) / c), Math.floor((r.y + r.h) / c)];
  }
}

/** Viele Rechtecke als ein einziger SVG-Pfad (z. B. Umrisse einer großen Mehrfachauswahl statt je ein DOM-Knoten). */
export function rectsPath(rects: Iterable<Rect>): string {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  let d = '';
  for (const r of rects) d += `M${r1(r.x)} ${r1(r.y)}h${r1(r.w)}v${r1(r.h)}h${r1(-r.w)}Z`;
  return d;
}

/** Bildet ein Rechteck aus dem alten Gruppenrahmen in den neuen ab (Gruppen-Skalierung). */
export function mapRect(r: Rect, from: Rect, to: Rect): Rect {
  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;
  return { x: to.x + (r.x - from.x) * sx, y: to.y + (r.y - from.y) * sy, w: r.w * sx, h: r.h * sy };
}
