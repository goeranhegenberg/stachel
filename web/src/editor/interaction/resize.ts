// Größe ändern an gedrehten Objekten (entlang der gedrehten Achsen, Gegenecke bleibt stehen).
import { resizeRect, type Handle, type Rect } from '../../board/geometry';

/**
 * Größe eines um `rot` Grad (um seine Mitte) gedrehten Rechtecks über einen Griff ändern: Weltzug (dx, dy) in die
 * Objektachsen drehen, ungedreht ändern und dann so verschieben, dass die Gegenecke in der Welt stehen bleibt
 * (Verschiebung (I − R)(c − c′), c/c′ = alte/neue Mitte).
 */
export function rotatedResize(box: Rect, handle: Handle, dx: number, dy: number, rot: number, keep: boolean, widthOnly = false): Rect {
  const a = (rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const ldx = dx * cos + dy * sin;
  const ldy = -dx * sin + dy * cos;
  let nb = resizeRect(box, handle, ldx, ldy, keep, 12);
  if (widthOnly) nb = { x: nb.x, y: box.y, w: nb.w, h: box.h };
  const vx = box.x + box.w / 2 - (nb.x + nb.w / 2);
  const vy = box.y + box.h / 2 - (nb.y + nb.h / 2);
  return { ...nb, x: nb.x + vx - (vx * cos - vy * sin), y: nb.y + vy - (vx * sin + vy * cos) };
}
