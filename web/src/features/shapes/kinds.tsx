// Neue Formen im Formen-Register. Symbole werden aus demselben Pfad gezeichnet wie die Form selbst.
import type { ShapeKind } from '../../protocol';
import { defineShapeKind } from '../../editor/ext/registry';
import { shapePath } from '../../editor/core/shapeKinds';
import { entryOfKind, SHAPE_ENTRIES } from './catalog';
import { isOpenKind, KIND_GEOMETRY } from './geometry';

/** Symbol einer Form im Seitenverhältnis ihres Bibliothekseintrags (24er Raster). */
export function ShapeIcon({ kind, size = 20, w, h }: { kind: ShapeKind; size?: number; w?: number; h?: number }) {
  const e = entryOfKind(kind);
  const aw = w ?? e?.w ?? 180;
  const ah = h ?? e?.h ?? 120;
  const box = 19;
  const k = box / Math.max(aw, ah);
  const iw = aw * k;
  const ih = ah * k;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shapes-icon">
      <path
        transform={`translate(${(24 - iw) / 2} ${(24 - ih) / 2})`}
        d={shapePath(kind, iw, ih, 0.9)}
        fill={isOpenKind(kind) ? 'none' : 'currentColor'}
        fillOpacity={0.12}
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

const kinds = [...new Set(SHAPE_ENTRIES.map((e) => e.kind))].filter((k) => KIND_GEOMETRY[k]);
kinds.forEach((kind, i) => {
  const g = KIND_GEOMETRY[kind]!;
  defineShapeKind({
    kind,
    label: entryOfKind(kind)?.label ?? kind,
    order: 50 + i,
    icon: <ShapeIcon kind={kind} />,
    path: g.path,
    insets: g.insets,
    outline: g.outline,
    simpleClip: g.simpleClip,
    simpleRadius: g.simpleRadius,
  });
});
