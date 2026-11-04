// Haftnotiz-Formen: „Quadrat“ und „Rechteck“ (breiter, gleiche Höhe; 199 × 228 bzw. 350 × 228 dp).
// Die Form ergibt sich aus dem Seitenverhältnis (kein eigenes Feld, alte Boards bleiben gültig). Seitengriffe ziehen die
// Notiz frei in Breite bzw. Höhe („frei“), Eckgriffe skalieren proportional. Das Notiz-Werkzeug merkt sich die zuletzt
// gewählte Form; Tab, Strg+Pfeil und Plus-Griff kopieren Breite und Höhe und damit die Form.
import { useState } from 'react';
import { STICKY_COLORS, type BoardObject } from '../../protocol';
import { ColorPicker, CustomColorToggle, RecentSwatches } from '../../ui/ColorPicker';
import { useRecentColors } from '../../ui/recentColors';
import { colorName } from '../../ui/a11y';
import { PopBtn } from '../../editor/ContextBar';
import { defineContextAction, defineObjectType, defineTool, objectTypes, tools } from '../../editor/ext/registry';
import { getToolOption, setToolOption, useToolOption } from '../../editor/ext/toolOptions';
import type { CtxProps } from '../../editor/ext/types';
import { STICKY_SHAPES, stickyShapeOf, stickyShapePatch, stickySize, type StickyShape } from './stickyGeom';

export { stickySize };

/** Zuletzt gewählte Form (Werkzeug-Option, gilt für neue Notizen). */
export const toolStickyShape = (): StickyShape => (getToolOption<StickyShape>('sticky', 'shape', 'square') === 'rect' ? 'rect' : 'square');

// ---- Typ: alle acht Griffe, Seiten frei, Ecken proportional; neue Notiz in der gemerkten Form ------------------------

const core = objectTypes.get('sticky')!;
defineObjectType({
  ...core,
  create: (p, api) => {
    const base = core.create!(p, api);
    const { w, h } = stickySize(toolStickyShape());
    return { ...base, x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), w, h };
  },
  defaultSize: stickySize('square'),
  handles: () => ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'],
  keepAspect: 'corner',
});

// ---- Symbole ------------------------------------------------------------------------------------------------------

export function StickyShapeIcon({ shape, size = 22 }: { shape: StickyShape | 'free'; size?: number }) {
  const w = shape === 'rect' ? 18 : shape === 'free' ? 15 : 13;
  const h = shape === 'free' ? 9 : 13;
  const x = (24 - w) / 2;
  const y = (24 - h) / 2;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={`M${x} ${y}h${w}v${h - 4}l-4 4h-${w - 4}z`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeDasharray={shape === 'free' ? '2.5 2' : undefined} />
    </svg>
  );
}

// ---- Kontextleiste: Form der Notiz(en) -----------------------------------------------------------------------------

const onlyStickies = (c: { types: ReadonlySet<string> }) => c.types.size === 1 && c.types.has('sticky');

/** gemeinsame Form der Auswahl (gemischt → 'free') */
const shapeOfAll = (sel: readonly BoardObject[]): StickyShape | 'free' => {
  const s = new Set(sel.map(stickyShapeOf));
  return s.size === 1 ? [...s][0] : 'free';
};

function ShapeBar({ selected, pop, togglePop }: CtxProps) {
  const cur = shapeOfAll(selected);
  return (
    <div className="ctx-group">
      <PopBtn open={pop === 'shapes.stickyShape'} onToggle={togglePop('shapes.stickyShape')} label="Form der Notiz">
        <StickyShapeIcon shape={cur} />
      </PopBtn>
    </div>
  );
}

function ShapePop({ selected, choose }: CtxProps) {
  const cur = shapeOfAll(selected);
  return (
    <>
      {STICKY_SHAPES.map((s) => (
        <button
          key={s.shape}
          className={`ctx-btn${cur === s.shape ? ' is-active' : ''}`}
          aria-label={s.label}
          title={s.label}
          aria-pressed={cur === s.shape}
          onClick={() => {
            // die nächste neue Notiz kommt in der zuletzt gewählten Form
            setToolOption('sticky', 'shape', s.shape);
            choose((o) => stickyShapePatch(o, s.shape));
          }}
        >
          <StickyShapeIcon shape={s.shape} />
        </button>
      ))}
    </>
  );
}

defineContextAction({
  id: 'shapes.stickyShape',
  order: 21,
  when: (c) => !c.locked && onlyStickies(c),
  Bar: ShapeBar,
  pops: { 'shapes.stickyShape': { className: 'ctx-pop--row', label: 'Form der Notiz', Body: ShapePop } },
});

// ---- Werkzeug: Farbe und Form neuer Notizen ------------------------------------------------------------------------

function StickyToolOptions() {
  const [color, setColor] = useToolOption('sticky', 'color', STICKY_COLORS[0]);
  const [shape, setShape] = useToolOption<StickyShape>('sticky', 'shape', 'square');
  const [custom, setCustom] = useState(false);
  const recent = useRecentColors();
  if (custom)
    return (
      <span className="shapes-sticky-swatches">
        <ColorPicker
          value={color}
          label="Eigene Notizfarbe"
          onPick={(c) => {
            setColor(c);
            setCustom(false);
          }}
          onCancel={() => setCustom(false)}
        />
      </span>
    );
  return (
    <>
      <span className="shapes-sticky-swatches">
        {STICKY_COLORS.map((c) => (
          <button key={c} className={`swatch${color === c ? ' is-active' : ''}`} style={{ background: c }} aria-label={`Notizfarbe ${colorName(c)}`} onClick={() => setColor(c)} />
        ))}
        {/* zuletzt benutzte eigene Farben als eigene Zeile – nur, wenn es welche gibt (die Leiste bleibt sonst zweizeilig) */}
        {recent.length > 0 && (
          <span className="cp-line">
            <RecentSwatches onPick={setColor} current={(STICKY_COLORS as readonly string[]).includes(color) ? undefined : color} />
          </span>
        )}
      </span>
      <CustomColorToggle open={false} onClick={() => setCustom(true)} />
      <span className="fly-sep" />
      {STICKY_SHAPES.map((s) => (
        <button key={s.shape} className={`fly-btn${shape === s.shape ? ' is-active' : ''}`} aria-label={`Notizform ${s.label}`} title={s.label} aria-pressed={shape === s.shape} onClick={() => setShape(s.shape)}>
          <StickyShapeIcon shape={s.shape} />
        </button>
      ))}
    </>
  );
}

defineTool({ ...tools.get('sticky')!, Options: StickyToolOptions });
