// Kern-Formen (Rechteck, Ellipse, Raute, Dreieck) im Formen-Register; weitere Formen kommen aus features/shapes.
import type { ShapeKind } from '../../protocol';
import { IconDiamond, IconEllipse, IconRect, IconTriangle } from '../../ui/icons';
import { defineShapeKind, shapeKinds } from '../ext/registry';

function roundRect(w: number, h: number, inset: number): string {
  const x1 = inset;
  const y1 = inset;
  const x2 = w - inset;
  const y2 = h - inset;
  const r = Math.min(6, (x2 - x1) / 4, (y2 - y1) / 4);
  return `M${x1 + r} ${y1}H${x2 - r}Q${x2} ${y1} ${x2} ${y1 + r}V${y2 - r}Q${x2} ${y2} ${x2 - r} ${y2}H${x1 + r}Q${x1} ${y2} ${x1} ${y2 - r}V${y1 + r}Q${x1} ${y1} ${x1 + r} ${y1}Z`;
}

/** SVG-Pfad einer Form (unbekannte Formen: Rechteck). */
export function shapePath(kind: ShapeKind | undefined, w: number, h: number, inset: number): string {
  const def = kind ? shapeKinds.get(kind) : undefined;
  return def ? def.path(w, h, inset) : roundRect(w, h, inset);
}

/** Textfläche in der Form: oben, rechts, unten, links. */
export function shapeInsets(kind: ShapeKind | undefined, w: number, h: number): [number, number, number, number] {
  const def = kind ? shapeKinds.get(kind) : undefined;
  return def?.insets?.(w, h) ?? [10, 12, 10, 12];
}

defineShapeKind({ kind: 'rect', label: 'Rechteck', order: 10, icon: <IconRect size={20} />, path: roundRect });

defineShapeKind({
  kind: 'ellipse',
  label: 'Ellipse',
  order: 20,
  icon: <IconEllipse size={20} />,
  path: (w, h, inset) => {
    const rx = (w - 2 * inset) / 2;
    const ry = (h - 2 * inset) / 2;
    return `M${inset} ${inset + ry}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`;
  },
  insets: (w, h) => [h * 0.14, w * 0.14, h * 0.14, w * 0.14],
  simpleRadius: '50%',
});

defineShapeKind({
  kind: 'diamond',
  label: 'Raute',
  order: 30,
  icon: <IconDiamond size={20} />,
  path: (w, h, inset) => `M${w / 2} ${inset}L${w - inset} ${h / 2}L${w / 2} ${h - inset}L${inset} ${h / 2}Z`,
  insets: (w, h) => [h * 0.2, w * 0.22, h * 0.2, w * 0.22],
  simpleClip: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
});

defineShapeKind({
  kind: 'triangle',
  label: 'Dreieck',
  order: 40,
  icon: <IconTriangle size={20} />,
  path: (w, h, inset) => `M${w / 2} ${inset}L${w - inset} ${h - inset}L${inset} ${h - inset}Z`,
  insets: (w, h) => [h * 0.42, w * 0.24, h * 0.08, w * 0.24],
  simpleClip: 'polygon(50% 0, 100% 100%, 0 100%)',
});
