// Ausschnitt eines Vorschaubilds (Seitenverhältnis der Karte in der Übersicht). Die Vorschaubilder selbst rendert seit
// Welle B (P8) der Server aus dem Board-Dokument (server/src/thumbnails.ts mit thumbSvg.ts) – der Browser lädt nichts
// mehr hoch, so gelangen auch keine privaten Notizen (privater Modus) der gerade arbeitenden Person in die Übersicht.
import type { BoardObject } from '../../protocol';
import { expand, unionRects, type Rect } from '../../board/geometry';

/** Pixelmaße des Vorschaubilds (doppelte Auflösung der Karte 280 × 130) */
export const THUMB_W = 560;
export const THUMB_H = 260;
/**
 * Ausschnitt: Inhalt mit Rand, auf das Seitenverhältnis der Karte erweitert. Rahmen tragen ihren Titel oberhalb
 * ihrer Grenzen: `titleSpace` (Board-Einheiten) kommt bei ihnen oben dazu, sonst wäre der Titel abgeschnitten.
 */
export function thumbRect(objects: readonly BoardObject[], bounds: (o: BoardObject) => Rect | null, titleSpace = 0): Rect | null {
  const withTitle = (o: BoardObject): Rect | null => {
    const b = bounds(o);
    return b && o.type === 'frame' && titleSpace > 0 ? { x: b.x, y: b.y - titleSpace, w: b.w, h: b.h + titleSpace } : b;
  };
  const r = unionRects(objects.map(withTitle).filter((b): b is Rect => !!b));
  if (!r) return null;
  const p = expand(r, Math.max(24, Math.max(r.w, r.h) * 0.04));
  const aspect = THUMB_W / THUMB_H;
  if (p.w / p.h > aspect) {
    const h = p.w / aspect;
    return { x: p.x, y: p.y - (h - p.h) / 2, w: p.w, h };
  }
  const w = p.h * aspect;
  return { x: p.x - (w - p.w) / 2, y: p.y, w, h: p.h };
}
