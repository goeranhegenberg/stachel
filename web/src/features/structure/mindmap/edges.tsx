// Linien der Mindmap (Editor-Welt-Ebene und Vorschauen), ohne Registrierungen.
import type { BoardObject } from '../../../protocol';
import { isMind } from './ops';
import { MIND_COLORS } from './style';

export const levelOf = (o: BoardObject) => o.mind?.level ?? (o.mind?.parent ? 1 : 0);

/** Linie vom Eltern- zum Kindknoten: Hauptthemen an der Mitte, Unterthemen an ihrer Unterstrich-Linie. */
export function mindEdge(p: BoardObject, n: BoardObject): string {
  const side = n.mind?.side ?? 'r';
  const pl = levelOf(p);
  const nl = levelOf(n);
  const sx = side === 'r' ? p.x + p.w : p.x;
  const sy = pl >= 2 ? p.y + p.h : p.y + p.h / 2;
  const ex = side === 'r' ? n.x : n.x + n.w;
  const ey = nl >= 2 ? n.y + n.h : n.y + n.h / 2;
  const dx = (ex - sx) / 2;
  return `M${sx},${sy} C${sx + dx},${sy} ${ex - dx},${ey} ${ex},${ey}`;
}

/** Linien aller sichtbaren Knoten (auch für Vorschauen). */
export function MindEdges({ nodes, byId }: { nodes: readonly BoardObject[]; byId: ReadonlyMap<string, BoardObject> }) {
  const paths = [];
  for (const n of nodes) {
    const p = n.mind?.parent ? byId.get(n.mind.parent) : undefined;
    if (!isMind(p) || n.mind?.hidden || p.mind?.hidden || p.id === n.id) continue;
    paths.push(<path key={n.id} d={mindEdge(p, n)} stroke={n.color ?? MIND_COLORS[0]} strokeWidth={levelOf(n) <= 1 ? 3 : 2} fill="none" strokeLinecap="round" />);
  }
  return <>{paths}</>;
}
