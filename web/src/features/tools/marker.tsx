// Textmarker: Modus des Stift-Werkzeugs (Untermenü „Stift | Textmarker“). Breiter, halbtransparenter
// Strich, der mit „multiply“ über Notizen und Text liegt – Schrift bleibt lesbar, als läge die Farbe darunter.
// Gespeichert als normaler Stiftstrich (`type: 'pen'`) mit `marker: true` (docs/features/tools.md).
import { memo } from 'react';
import { penFromPoints, simplify, smoothPath } from '../../board/pen';
import type { Point } from '../../board/geometry';
import { colorName } from '../../ui/a11y';
import { defineObjectType, defineTool, objectTypes, tools } from '../../editor/ext/registry';
import { getToolOption, useToolOption } from '../../editor/ext/toolOptions';
import { placeStyle } from '../../editor/render/format';
import type { EditorApi, ObjectViewProps, ToolDef, ToolPointerEvent, ToolGesture } from '../../editor/ext/types';
import { IconMarker, IconPenMode } from './icons';

/** Farben des Textmarkers (Stachel-Akzente + klassisches Gelb) */
export const MARKER_COLORS = ['#ffe14d', '#c9e14a', '#ec4e92', '#4fa3ff', '#ff9a3c'];
const MARKER_NAMES: Record<string, string> = { '#ffe14d': 'Gelb', '#c9e14a': 'Grün', '#ec4e92': 'Pink', '#4fa3ff': 'Blau', '#ff9a3c': 'Orange' };
export const MARKER_WIDTHS = [12, 20, 32];
/** Deckkraft des Strichs; zusammen mit `multiply` bleibt Text darunter lesbar */
export const MARKER_OPACITY = 0.45;

export type PenMode = 'pen' | 'marker';
export const penMode = () => getToolOption<PenMode>('pen', 'mode', 'pen');

// ---- Darstellung: Stiftstrich mit Textmarker-Variante ------------------------------------------------------------

const corePenType = objectTypes.get('pen')!;
const CorePenView = corePenType.View;

const MarkerView = memo(function MarkerView({ o }: ObjectViewProps) {
  const d = smoothPath(o.points ?? []);
  const sw = o.strokeWidth ?? MARKER_WIDTHS[1];
  return (
    // multiply inline (nicht per Klasse), damit auch Export und Vorschaubild es übernehmen
    <div className="obj obj-pen tools-marker" data-id={o.id} data-type="pen" data-marker="true" style={{ ...placeStyle(o), mixBlendMode: 'multiply' }}>
      <svg width={o.w} height={o.h} overflow="visible" aria-hidden="true">
        <path className="hit" d={d} strokeWidth={Math.max(16, sw + 8)} />
        <path d={d} fill="none" stroke={o.color ?? MARKER_COLORS[0]} strokeOpacity={MARKER_OPACITY} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
});

function PenOrMarkerView(p: ObjectViewProps) {
  return p.o.marker ? <MarkerView {...p} /> : <CorePenView {...p} />;
}

defineObjectType({ ...corePenType, View: PenOrMarkerView });

// ---- Werkzeug: Stift mit Modus ------------------------------------------------------------------------------------

const corePen: ToolDef = tools.get('pen')!;
const CorePenOptions = corePen.Options;
const CorePenIcon = corePen.Icon;

function PenIcon() {
  const [mode] = useToolOption<PenMode>('pen', 'mode', 'pen');
  const [color] = useToolOption('pen', 'markerColor', MARKER_COLORS[0]);
  return mode === 'marker' ? <IconMarker color={color} /> : <CorePenIcon />;
}

function MarkerOptions() {
  const [color, setColor] = useToolOption('pen', 'markerColor', MARKER_COLORS[0]);
  const [width, setWidth] = useToolOption('pen', 'markerWidth', MARKER_WIDTHS[1]);
  return (
    <>
      {MARKER_COLORS.map((c) => (
        <button key={c} className={`swatch swatch--round${color === c ? ' is-active' : ''}`} style={{ background: c }} aria-label={`Textmarker ${MARKER_NAMES[c] ?? colorName(c)}`} onClick={() => setColor(c)} />
      ))}
      <span className="fly-sep" />
      {MARKER_WIDTHS.map((w) => (
        <button key={w} className={`fly-btn${width === w ? ' is-active' : ''}`} aria-label={`Markerbreite ${w}`} onClick={() => setWidth(w)}>
          <span className="tools-marker-dot" style={{ width: 20, height: 3 + w / 2, background: color }} />
        </button>
      ))}
    </>
  );
}

function PenOptions({ api }: { api: EditorApi }) {
  const [mode, setMode] = useToolOption<PenMode>('pen', 'mode', 'pen');
  return (
    <>
      <button className={`fly-btn${mode === 'pen' ? ' is-active' : ''}`} aria-label="Stift" title="Stift" aria-pressed={mode === 'pen'} onClick={() => setMode('pen')}>
        <IconPenMode />
      </button>
      <button className={`fly-btn${mode === 'marker' ? ' is-active' : ''}`} aria-label="Textmarker" title="Textmarker" aria-pressed={mode === 'marker'} onClick={() => setMode('marker')}>
        <IconMarker />
      </button>
      <span className="fly-sep" />
      {mode === 'marker' ? <MarkerOptions /> : CorePenOptions ? <CorePenOptions api={api} /> : null}
    </>
  );
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Textmarker-Strich zeichnen (wie der Stift, ein Undo-Schritt beim Loslassen). */
export function markerGesture(e: ToolPointerEvent, api: EditorApi): ToolGesture {
  const color = getToolOption('pen', 'markerColor', MARKER_COLORS[0]);
  const width = getToolOption('pen', 'markerWidth', MARKER_WIDTHS[1]);
  const points = [e.world];
  const draft = () =>
    api.setDraft({
      kind: 'world',
      node: <path className="tools-marker-draft" d={smoothPath(points.flatMap((q) => [q.x, q.y]))} fill="none" stroke={color} strokeOpacity={MARKER_OPACITY} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />,
    });
  draft();
  return {
    kind: 'pen',
    move: (m) => {
      if (dist(m.world, points[points.length - 1]) * api.camera().z < 2) return;
      points.push(m.world);
      draft();
    },
    up: () => {
      api.setDraft(null);
      const pts = simplify(points, 0.6 / api.camera().z);
      if (!pts.length) return;
      api.store.stopCapturing();
      api.store.create({ type: 'pen', ...penFromPoints(pts.length === 1 ? [pts[0], { x: pts[0].x + 0.5, y: pts[0].y }] : pts, width), color, strokeWidth: width, marker: true });
    },
    cancel: () => api.setDraft(null),
  };
}

defineTool({
  ...corePen,
  Icon: PenIcon,
  Options: PenOptions,
  down: (e, api) => (penMode() === 'marker' ? markerGesture(e, api) : corePen.down?.(e, api)),
});
