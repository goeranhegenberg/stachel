// Objekttypen auf Datenebene (ohne React): welche Typen der Store kennt und wie Store, Hit-Test, Kopieren und
// Verschieben sie behandeln. Die Kern-Typen stehen hier; neue Typen trägt editor/ext/registry (defineObjectType) ein.
import type { BoardObject, ConnectorEnd } from '../protocol';
import { endAnchor, isAttached, type ObjectLookup } from './connector';
import type { NewObject, Patch } from './store';

export type HitRole = 'object' | 'background' | 'none';

export interface CloneContext {
  /** neue ID eines mitkopierten Objekts */
  map(id: string): string | undefined;
  lookup: ObjectLookup;
  dx: number;
  dy: number;
}

export interface TypeInfo {
  /** liegt unter allen anderen Objekten (Rahmen) */
  below?: boolean;
  /** Hit-Test: 'object' (Standard), 'background' (nur wenn sonst nichts trifft, z. B. Rahmen), 'none' (nur über DOM-Treffer) */
  hit?: HitRole;
  /** Weltrechteck hängt von anderen Objekten ab (Verbinder): nicht im Raster-Index, Grenzen über die Oberfläche */
  dependent?: boolean;
  /** Verschieben um dx/dy (Standard: x/y) */
  move?: (o: BoardObject, dx: number, dy: number) => Patch;
  /** Kopieren: Bezüge auf andere Objekte umschreiben; null verwirft die Kopie */
  remap?: (clone: NewObject, o: BoardObject, ctx: CloneContext) => NewObject | null;
  /** Klartext für Zwischenablage, Suche und Screenreader (Standard: `text`) */
  plainText?: (o: BoardObject) => string | undefined;
  /** Plus-Griff/Tab: Felder der Kopie daneben überschreiben (z. B. Inhalt einer Karte leeren); `undefined` entfernt */
  sibling?: (o: BoardObject) => Partial<BoardObject>;
  /** gerade nicht zu sehen (z. B. eingeklappter Mindmap-Zweig): keine Abstimm-Fläche, Reaktionen, Pins */
  invisible?: (o: BoardObject) => boolean;
}

const remapEnd = (end: ConnectorEnd | undefined, ctx: CloneContext): ConnectorEnd | undefined => {
  if (!end) return end;
  if (isAttached(end)) {
    const mapped = ctx.map(end.objectId);
    if (mapped) return end.side ? { objectId: mapped, side: end.side } : { objectId: mapped };
    const p = endAnchor(end, ctx.lookup);
    return p ? { x: p.x + ctx.dx, y: p.y + ctx.dy } : undefined;
  }
  return { x: end.x + ctx.dx, y: end.y + ctx.dy };
};

const INFO = new Map<string, TypeInfo>([
  ['sticky', {}],
  ['text', {}],
  ['shape', {}],
  ['image', {}],
  ['pen', { hit: 'none' }],
  ['frame', { below: true, hit: 'background', plainText: (o) => o.title }],
  [
    'connector',
    {
      hit: 'none',
      dependent: true,
      move: (o, dx, dy) => {
        const p: Patch = { x: o.x + dx, y: o.y + dy };
        if (o.from && !isAttached(o.from)) p.from = { x: o.from.x + dx, y: o.from.y + dy };
        if (o.to && !isAttached(o.to)) p.to = { x: o.to.x + dx, y: o.to.y + dy };
        return p;
      },
      remap: (clone, o, ctx) => {
        const from = remapEnd(o.from, ctx);
        const to = remapEnd(o.to, ctx);
        return from && to ? { ...clone, from, to } : null;
      },
    },
  ],
]);

/** Objekttyp bekannt machen bzw. Angaben ergänzen (undefined lässt Vorhandenes stehen). Unbekannte Typen blendet der Store aus. */
export function registerTypeInfo(type: string, info: TypeInfo = {}) {
  const next: TypeInfo = { ...INFO.get(type) };
  for (const [k, v] of Object.entries(info)) if (v !== undefined) (next as Record<string, unknown>)[k] = v;
  INFO.set(type, next);
}

export const isKnownType = (type: unknown): boolean => typeof type === 'string' && INFO.has(type);
export const typeInfo = (type: string): TypeInfo => INFO.get(type) ?? {};
export const hitRole = (o: Pick<BoardObject, 'type'>): HitRole => INFO.get(o.type)?.hit ?? 'object';
export const isBelow = (o: Pick<BoardObject, 'type'>): boolean => !!INFO.get(o.type)?.below;
export const isDependent = (o: Pick<BoardObject, 'type'>): boolean => !!INFO.get(o.type)?.dependent;
/**
 * Felder einer leeren Kopie daneben (Plus-Griff, Tab): alles außer Identität, Text, Sperre und Gruppe,
 * dazu die Überschreibungen des Typs.
 */
export function siblingFields(o: BoardObject): Omit<NewObject, 'x' | 'y'> {
  const { id: _i, z: _z, createdBy: _c, updatedAt: _u, text: _t, content: _r, x: _x, y: _y, ...rest } = o;
  return { ...rest, text: '', locked: undefined, groupId: undefined, ...(INFO.get(o.type)?.sibling?.(o) ?? {}) };
}

/** Objekt ist unsichtbar: ausgeblendet (Feld `hidden`, Modul tools) oder laut Typ verborgen. */
export const isInvisible = (o: BoardObject): boolean => (o as { hidden?: boolean }).hidden === true || !!INFO.get(o.type)?.invisible?.(o);

export const plainTextOf = (o: BoardObject): string | undefined => {
  const f = INFO.get(o.type)?.plainText;
  return f ? f(o) : o.text;
};
