// Umriss einer Vorlage bzw. eingefügter Objekte (Vorschau, freier Platz beim Einfügen) – ohne React.
import type { BoardObject } from '../../../protocol';
import { connectorGeometry } from '../../../board/connector';
import { objRect, unionRects, type Rect } from '../../../board/geometry';

/** Grenzen der Objekte (Verbinder über ihre Enden, Rahmentitel mit Platz darüber). */
export function previewBounds(objects: readonly BoardObject[]): Rect | null {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const rects: Rect[] = [];
  for (const o of objects) {
    if (o.type === 'connector') {
      const g = connectorGeometry(o, (id) => byId.get(id));
      if (g) rects.push(unionRects([g.a, g.b, ...g.pts].map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))!);
    } else if (!o.mind?.hidden) {
      const r = objRect(o);
      rects.push(o.type === 'frame' && o.title ? { ...r, y: r.y - Math.max(18, r.w / 36) * 1.6, h: r.h + Math.max(18, r.w / 36) * 1.6 } : r);
    }
  }
  return unionRects(rects);
}
