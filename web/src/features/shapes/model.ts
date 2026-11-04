// Datenmodell des Moduls „shapes“ (docs/features/shapes.md): neue Formen, Felder für Füllung, Verbinder-Spitzen,
// Beschriftungsposition sowie die Typen „sticker“ (Emoji/Stempel) und „icon“. Alles optional – alte Boards laden weiter.
import type { BoardObject } from '../../protocol';
import type { Patch } from '../../board/store';

declare module '../../../../shared/protocol' {
  interface ObjectTypeMap {
    sticker: true;
    icon: true;
  }
  interface ShapeKindMap {
    roundrect: true;
    pentagon: true;
    hexagon: true;
    octagon: true;
    star: true;
    parallelogram: true;
    trapezoid: true;
    cylinder: true;
    cloud: true;
    callout: true;
    arrowRight: true;
    arrowLeft: true;
    arrowDouble: true;
    chevron: true;
    cross: true;
    braceLeft: true;
    braceRight: true;
    terminator: true;
    document: true;
    predefined: true;
    manualInput: true;
    delay: true;
    arrowUp: true;
    arrowDown: true;
    pentagonArrow: true;
    heart: true;
    manualOperation: true;
    offPage: true;
    merge: true;
    card: true;
    sort: true;
    multiDocument: true;
    display: true;
    storedData: true;
    internalStorage: true;
    summing: true;
    or: true;
  }
  interface BoardObject {
    /** shape: Deckkraft der Füllung 0…1 (fehlt = 1) */
    fillOpacity?: number;
    /** connector: Spitze am Anfang/Ende; fehlt = aus arrowStart/arrowEnd ('triangle' bzw. 'none') */
    capStart?: CapStyle;
    capEnd?: CapStyle;
    /** connector: Lage der Beschriftung entlang der Linie 0…1 (fehlt = 0.5) */
    labelPos?: number;
    /** sticker: Emoji-Zeichen */
    emoji?: string;
    /** sticker: Stempel (StampId) */
    stamp?: string;
    /** icon: Name im Iconset (lucide) und Zeichnung als SVG-Knoten [tag, attrs][] */
    icon?: string;
    iconNode?: IconNode;
  }
}

export type CapStyle = 'none' | 'arrow' | 'triangle' | 'triangleOpen' | 'circle' | 'circleOpen' | 'diamond' | 'diamondOpen' | 'bar';
export const CAP_STYLES: readonly CapStyle[] = ['none', 'arrow', 'triangle', 'triangleOpen', 'circle', 'circleOpen', 'diamond', 'diamondOpen', 'bar'];

export type IconNode = [string, Record<string, string | number>][];

/** Spitze eines Verbinder-Endes (Felder capStart/capEnd, sonst die alten Schalter arrowStart/arrowEnd). */
export function capOf(o: Pick<BoardObject, 'capStart' | 'capEnd' | 'arrowStart' | 'arrowEnd'>, end: 'start' | 'end'): CapStyle {
  const c = end === 'start' ? o.capStart : o.capEnd;
  if (c && (CAP_STYLES as readonly string[]).includes(c)) return c;
  return end === 'start' ? (o.arrowStart ? 'triangle' : 'none') : o.arrowEnd !== false ? 'triangle' : 'none';
}

/** Patch für eine neue Spitze; arrowStart/arrowEnd bleiben für ältere Clients passend gesetzt. */
export function capPatch(end: 'start' | 'end', cap: CapStyle): Patch {
  const value = cap === 'triangle' ? undefined : cap === 'none' ? undefined : cap;
  return end === 'start' ? { capStart: value, arrowStart: cap === 'none' ? undefined : true } : { capEnd: value, arrowEnd: cap !== 'none' };
}

export const fillOpacityOf = (o: Pick<BoardObject, 'fillOpacity'>) =>
  typeof o.fillOpacity === 'number' && Number.isFinite(o.fillOpacity) ? Math.min(1, Math.max(0, o.fillOpacity)) : 1;

export const labelPosOf = (o: Pick<BoardObject, 'labelPos'>) =>
  typeof o.labelPos === 'number' && Number.isFinite(o.labelPos) ? Math.min(0.98, Math.max(0.02, o.labelPos)) : 0.5;
