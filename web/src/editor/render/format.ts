// Darstellung der Formatfelder (fett/kursiv/durchgestrichen, Ausrichtung, Drehung) und Detailstufen.
import type { CSSProperties } from 'react';
import type { BoardObject, TextAlign, VerticalAlign } from '../../protocol';
import { rotationOf } from '../../board/geometry';
import type { TextFormat } from '../textMeasure';
import { typeDef } from '../ext/registry';

/** Ab dieser Bildschirmgröße (px, längere Seite) wird ein Objekt voll gezeichnet, darunter als einfache Fläche. */
export const LOD_MIN_PX = 40;
/** Unter diesem Zoom: Bilder als Fläche in Durchschnittsfarbe, große Rahmentitel. */
export const FAR_ZOOM = 0.25;

export type Detail = 'full' | 'simple';

/** Detailstufe nach Bildschirmgröße und `lodPx` des Typs (null = immer voll, Standard LOD_MIN_PX). */
export function detailOf(o: BoardObject, z: number): Detail {
  const lod = typeDef(o).lodPx;
  if (lod === null) return 'full';
  return Math.max(o.w, o.h) * z < (lod ?? LOD_MIN_PX) ? 'simple' : 'full';
}

export const textFormat = (o: BoardObject): TextFormat => ({ bold: !!o.bold, italic: !!o.italic });

const ALIGNS: readonly TextAlign[] = ['left', 'center', 'right'];
const VALIGNS: readonly VerticalAlign[] = ['top', 'middle', 'bottom'];

export const alignOf = (o: BoardObject, fallback: TextAlign): TextAlign => (ALIGNS.includes(o.align as TextAlign) ? (o.align as TextAlign) : fallback);
export const valignOf = (o: BoardObject): VerticalAlign => (VALIGNS.includes(o.valign as VerticalAlign) ? (o.valign as VerticalAlign) : 'middle');

/** Flex-Ausrichtung des Textcontainers nach `valign`. */
export const flexAlign = (v: VerticalAlign) => (v === 'top' ? 'flex-start' : v === 'bottom' ? 'flex-end' : 'center');

/** Schriftstil nach Format; `weight` ist das Normalgewicht des Objekttyps. */
export function formatStyle(o: BoardObject, weight: number, align: TextAlign): CSSProperties {
  return {
    fontWeight: o.bold ? 700 : weight,
    fontStyle: o.italic ? 'italic' : undefined,
    textDecoration: o.strike ? 'line-through' : undefined,
    textAlign: alignOf(o, align),
  };
}

/** Position + Drehung um die Objektmitte (für .obj mit transform-origin 0 0). */
export function placeStyle(o: BoardObject, extra?: CSSProperties): CSSProperties {
  const deg = rotationOf(o);
  return {
    transform: deg ? `translate(${o.x}px, ${o.y}px) rotate(${deg}deg)` : `translate(${o.x}px, ${o.y}px)`,
    transformOrigin: deg ? `${o.w / 2}px ${o.h / 2}px` : undefined,
    width: o.w,
    height: o.h,
    ...extra,
  };
}
