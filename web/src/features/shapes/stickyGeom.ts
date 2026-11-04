// Haftnotiz-Formen (ohne React/Register, testbar): Quadrat und Rechteck, sonst „frei“ nach Seitengriff-Ziehen.
import type { BoardObject } from '../../protocol';
import type { Patch } from '../../board/store';

export type StickyShape = 'square' | 'rect';
/** Breite : Höhe einer rechteckigen Notiz (350 : 199). */
export const STICKY_RECT_RATIO = 1.75;
/** Standardhöhe (und Breite der quadratischen Notiz). */
export const STICKY_SIZE = 200;

export const STICKY_SHAPES: { shape: StickyShape; label: string }[] = [
  { shape: 'square', label: 'Quadrat' },
  { shape: 'rect', label: 'Rechteck' },
];

/** Form einer Notiz aus ihrem Seitenverhältnis; 'free' nach freiem Ziehen an einem Seitengriff. */
export function stickyShapeOf(o: Pick<BoardObject, 'w' | 'h'>): StickyShape | 'free' {
  const r = o.w / Math.max(1, o.h);
  if (Math.abs(r - 1) < 0.03) return 'square';
  if (Math.abs(r - STICKY_RECT_RATIO) < 0.04) return 'rect';
  return 'free';
}

/** Größe einer neuen Notiz der Form. */
export const stickySize = (shape: StickyShape, h = STICKY_SIZE) => ({ w: shape === 'rect' ? Math.round(h * STICKY_RECT_RATIO) : h, h });

/** Notiz auf eine Form bringen: Höhe und Mitte bleiben (auch gedreht sauber), nur die Breite ändert sich. */
export function stickyShapePatch(o: BoardObject, shape: StickyShape): Patch | null {
  if (o.type !== 'sticky' || stickyShapeOf(o) === shape) return null;
  const { w } = stickySize(shape, o.h);
  return { x: Math.round(o.x + (o.w - w) / 2), w };
}

