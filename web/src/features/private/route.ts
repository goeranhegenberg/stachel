// Privater Modus ohne React (docs/features/private.md): Zustand lesen und entscheiden, welche neuen Objekte in die
// eigene Privat-Ablage gehen. Benutzt vom Web-Modul und vom Server (Native-Schreiber über web-impl.ts).
import * as Y from 'yjs';
import { PRIVATE_HIDDEN, PRIVATE_MODE, type PrivateModeState, type PrivatePlaceholder } from '../../protocol';
import { isAttached } from '../../board/connector';
import type { CreateRoute } from '../../board/store';

/** Diese Typen sind im privaten Modus verdeckt (dazu Verbinder an privaten Objekten). */
export const PRIVATE_TYPES: ReadonlySet<string> = new Set(['sticky', 'text', 'shape']);

const bool = (v: unknown) => v === true;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** `private.mode` als JSON (fehlt bzw. aus → `{on:false}`). */
export function readMode(doc: Y.Doc): PrivateModeState {
  const m = doc.getMap<unknown>(PRIVATE_MODE);
  if (m.get('on') !== true) return { on: false };
  const revealAt = m.get('revealAt');
  return {
    on: true,
    by: str(m.get('by')),
    byName: str(m.get('byName')),
    since: str(m.get('since')),
    anonymous: bool(m.get('anonymous')),
    ownReveal: bool(m.get('ownReveal')),
    ...(typeof revealAt === 'number' && Number.isFinite(revealAt) ? { revealAt } : {}),
  };
}

/** Platzhalter der verdeckten Objekte (`private.hidden`), ungültige Einträge weggelassen. */
export function readHidden(doc: Y.Doc): (PrivatePlaceholder & { id: string })[] {
  const out: (PrivatePlaceholder & { id: string })[] = [];
  doc.getMap<unknown>(PRIVATE_HIDDEN).forEach((v, id) => {
    const p = v as Partial<PrivatePlaceholder> | null;
    if (!p || typeof p !== 'object') return;
    const nums = [p.x, p.y, p.w, p.h];
    if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return;
    out.push({
      id,
      x: p.x!,
      y: p.y!,
      w: Math.max(1, p.w!),
      h: Math.max(1, p.h!),
      type: typeof p.type === 'string' ? p.type : 'sticky',
      ...(typeof p.rotation === 'number' && Number.isFinite(p.rotation) ? { rotation: p.rotation } : {}),
      ...(typeof p.by === 'string' ? { by: p.by } : {}),
      o: typeof p.o === 'string' ? p.o : '',
    });
  });
  return out;
}

/**
 * Regel für `BoardStore.setCreateRoute`: Solange der Modus im Board-Dokument `doc` läuft, gehen neue Haftnotizen,
 * Texte und Formen in die Ablage – und Verbinder, deren Ende an einem privaten Objekt hängt (sonst zeigten sie für
 * andere ins Leere).
 */
export function privateRoute(doc: Y.Doc): CreateRoute {
  const mode = doc.getMap<unknown>(PRIVATE_MODE);
  return (o, store) => {
    if (mode.get('on') !== true) return false;
    if (PRIVATE_TYPES.has(o.type)) return true;
    if (o.type !== 'connector') return false;
    return [o.from, o.to].some((end) => !!end && isAttached(end) && store.isPrivate(end.objectId));
  };
}
