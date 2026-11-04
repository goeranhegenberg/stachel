// Verbinder: Spitzen-Arten an beiden Enden, verschiebbare Beschriftung, Kontextleiste (ersetzt
// core.connector) und Voreinstellungen im Werkzeug. Das Ziehen selbst steht in quickConnect.tsx.
import type { PointerEvent as RPointerEvent, ReactNode } from 'react';
import type { BoardObject, DashStyle, LineStyle } from '../../protocol';
import { connectorBounds, connectorGeometry, connectorPath, dashArray, type ConnectorGeometry } from '../../board/connector';
import type { Patch } from '../../board/store';
import { defineContextAction, defineObjectType, defineTool, objectTypes, tools } from '../../editor/ext/registry';
import { useToolOption } from '../../editor/ext/toolOptions';
import type { CtxProps, ObjectViewProps } from '../../editor/ext/types';
import { PopBtn, Toggle } from '../../editor/ContextBar';
import { IconDash, IconLineCurved, IconLineElbow, IconLineStraight } from '../../editor/interaction/icons';
import { textEngine } from '../../editor/text/engine';
import { editorApi } from './apiRef';
import { capGeom, capTrim, pathPointAt, projectOnPath, roundedElbowPath, type CapGeom } from './connectorGeom';
import { CAP_STYLES, capOf, capPatch, labelPosOf, type CapStyle } from './model';

export const CAP_LABELS: Record<CapStyle, string> = {
  none: 'Keine',
  arrow: 'Pfeil',
  triangle: 'Dreieck',
  triangleOpen: 'Dreieck leer',
  circle: 'Kreis',
  circleOpen: 'Kreis leer',
  diamond: 'Raute',
  diamondOpen: 'Raute leer',
  bar: 'Querstrich',
};

export const LINE_STYLES: { style: LineStyle; label: string; icon: ReactNode }[] = [
  { style: 'straight', label: 'Gerade', icon: <IconLineStraight /> },
  { style: 'elbow', label: 'Gewinkelt', icon: <IconLineElbow /> },
  { style: 'curved', label: 'Geschwungen', icon: <IconLineCurved /> },
];
const DASHES: { dash: DashStyle; label: string }[] = [
  { dash: 'solid', label: 'Durchgezogen' },
  { dash: 'dashed', label: 'Gestrichelt' },
  { dash: 'dotted', label: 'Gepunktet' },
];
const WIDTHS = [1, 2, 4, 8];

// ---- Spitzen zeichnen -------------------------------------------------------------------------------------------------

const pts = (list: { x: number; y: number }[], ox: number, oy: number) => list.map((q) => `${Math.round((q.x - ox) * 100) / 100},${Math.round((q.y - oy) * 100) / 100}`).join(' ');

/** Spitze als SVG (Dreiecke/Rauten als polygon, Pfeil als polyline, Kreis, Querstrich als line – nie als path). */
export function CapMark({ g, color, sw, ox = 0, oy = 0 }: { g: CapGeom; color: string; sw: number; ox?: number; oy?: number }) {
  const stroke = Math.max(1.5, sw);
  if (g.kind === 'polygon') return <polygon points={pts(g.pts, ox, oy)} fill={g.filled ? color : '#ffffff'} stroke={color} strokeWidth={g.filled ? 1 : stroke} strokeLinejoin="round" />;
  if (g.kind === 'polyline') return <polyline points={pts(g.pts, ox, oy)} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />;
  if (g.kind === 'circle') return <circle cx={g.c.x - ox} cy={g.c.y - oy} r={g.r} fill={g.filled ? color : '#ffffff'} stroke={color} strokeWidth={g.filled ? 1 : stroke} />;
  return <line x1={g.a.x - ox} y1={g.a.y - oy} x2={g.b.x - ox} y2={g.b.y - oy} stroke={color} strokeWidth={stroke} strokeLinecap="round" />;
}

/** Symbol einer Spitze (Kontextleiste, Werkzeug); `end`: Spitze rechts, sonst links. */
export function CapIcon({ cap, end = true, size = 22 }: { cap: CapStyle; end?: boolean; size?: number }) {
  const tip = end ? { x: 20, y: 12 } : { x: 4, y: 12 };
  const dir = end ? { x: 1, y: 0 } : { x: -1, y: 0 };
  const g = capGeom(cap, tip, dir, 0.9);
  const trim = capTrim(cap, 0.9);
  const x1 = end ? 4 : 20;
  const x2 = end ? 20 - trim : 4 + trim;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <line x1={x1} y1={12} x2={x2} y2={12} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
      {g && <CapMark g={g} color="currentColor" sw={1.6} />}
    </svg>
  );
}

// ---- Darstellung ------------------------------------------------------------------------------------------------------

type Geo = ConnectorGeometry & { mid: { x: number; y: number } };

/** Beschriftung eines ausgewählten Verbinders entlang der Linie ziehen (ein Undo-Schritt). */
function startLabelDrag(e: RPointerEvent<HTMLDivElement>, o: BoardObject, g: Geo) {
  const api = editorApi();
  // nur bei ausgewähltem Verbinder (sonst wählt der Editor ihn aus bzw. verschiebt ihn)
  if (!api || e.button !== 0 || o.locked || api.tool() !== 'select' || api.selection().length !== 1 || api.selection()[0] !== o.id) return;
  e.stopPropagation();
  const el = e.currentTarget;
  const board = el.closest('[data-testid="board"]') as HTMLElement | null;
  if (!board) return;
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    /* Zeiger schon weg */
  }
  const r = board.getBoundingClientRect();
  const sx = e.clientX;
  const sy = e.clientY;
  let moved = false;
  api.store.stopCapturing();
  const move = (ev: PointerEvent) => {
    ev.stopPropagation();
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
    moved = true;
    const p = api.toWorld({ x: ev.clientX - r.left, y: ev.clientY - r.top });
    api.store.update(o.id, { labelPos: projectOnPath(g, p) });
  };
  const up = (ev: PointerEvent) => {
    ev.stopPropagation();
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    api.store.stopCapturing();
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

function ConnectorView({ o, editing, derived }: ObjectViewProps) {
  const g = derived as Geo;
  const sw = o.strokeWidth ?? 2;
  const color = o.color ?? '#0a0a0a';
  const capA = capOf(o, 'start');
  const capB = capOf(o, 'end');
  const bounds = connectorBounds(g, 16 + sw * 3);
  const lx = (v: number) => v - bounds.x;
  const ly = (v: number) => v - bounds.y;
  // Linie endet vor der Spitze, damit die Spitze sauber bleibt
  // gewinkelt: runde Ecken (der Trefferpfad bleibt eckig)
  const d = g.style === 'elbow' ? roundedElbowPath(g, bounds.x, bounds.y, capTrim(capA, sw), capTrim(capB, sw), 10 + sw * 2) : connectorPath(g, bounds.x, bounds.y, capTrim(capA, sw), capTrim(capB, sw));
  const heads = [capGeom(capB, g.b, g.dirB, sw), capGeom(capA, g.a, g.dirA, sw)];
  const dotted = o.dash === 'dotted';
  const label = o.text ?? '';
  const labelFs = Math.max(12, o.fontSize ?? 14 + sw);
  const T = textEngine();
  return (
    <div className="obj obj-connector" data-id={o.id} data-type="connector" style={{ transform: `translate(${bounds.x}px, ${bounds.y}px)`, width: bounds.w, height: bounds.h }}>
      <svg width={bounds.w} height={bounds.h} aria-hidden="true">
        <path className="hit" d={connectorPath(g, bounds.x, bounds.y)} strokeWidth={Math.max(16, sw + 12)} />
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={dashArray(o.dash, sw)}
          className={dotted ? 'is-dotted' : undefined}
        />
        {heads.map((h, i) => h && <CapMark key={i} g={h} color={color} sw={sw} ox={bounds.x} oy={bounds.y} />)}
      </svg>
      {/* beim Bearbeiten zeigt die Overlay-Ebene das Eingabefeld an derselben Stelle */}
      {label && !editing && (
        // Ziehen verschiebt die Beschriftung des ausgewählten Verbinders (Markierung setzt quickConnect.tsx)
        <div className="conn-label" style={{ transform: `translate(${lx(g.mid.x)}px, ${ly(g.mid.y)}px) translate(-50%, -50%)`, fontSize: labelFs, color }} onPointerDown={(e) => startLabelDrag(e, o, g)}>
          <T.View o={o} variant="label" className="conn-label-text" />
        </div>
      )}
    </div>
  );
}

const core = objectTypes.get('connector')!;

defineObjectType({
  ...core,
  View: ConnectorView,
  // Beschriftung sitzt bei labelPos (Overlay-Bearbeitung liest `mid`)
  derive: (o, lookup) => {
    const g = connectorGeometry(o, lookup);
    if (!g) return null;
    const t = labelPosOf(o);
    const data: Geo = { ...g, mid: t === 0.5 ? g.mid : pathPointAt(g, t) };
    return { bounds: connectorBounds(g), key: connectorPath(g), data };
  },
});

// ---- Kontextleiste ------------------------------------------------------------------------------------------------------

const onlyConnectors = (c: { types: ReadonlySet<string> }) => c.types.size === 1 && c.types.has('connector');

/** Spitze umschalten: an → Form des anderen Endes (sonst Dreieck), aus → keine. */
function toggleCap(o: BoardObject, end: 'start' | 'end'): Patch {
  const other = capOf(o, end === 'start' ? 'end' : 'start');
  return capPatch(end, capOf(o, end) !== 'none' ? 'none' : other !== 'none' ? other : 'triangle');
}

/** Richtung umkehren: Enden, Spitzen und Lage der Beschriftung tauschen. */
export function reversePatch(o: BoardObject): Patch {
  const a = capOf(o, 'start');
  const b = capOf(o, 'end');
  return {
    from: o.to,
    to: o.from,
    ...(capPatch('start', b)),
    ...(capPatch('end', a)),
    labelPos: o.labelPos === undefined ? undefined : 1 - o.labelPos,
  };
}

function CapPop({ first, choose, end }: CtxProps & { end: 'start' | 'end' }) {
  const cur = capOf(first, end);
  return (
    <>
      {CAP_STYLES.map((c) => (
        <button key={c} className={`ctx-btn${cur === c ? ' is-active' : ''}`} aria-label={CAP_LABELS[c]} title={CAP_LABELS[c]} aria-pressed={cur === c} onClick={() => choose(() => capPatch(end, c))}>
          <CapIcon cap={c} end={end === 'end'} />
        </button>
      ))}
    </>
  );
}

function Chevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSwap() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h14m-3-3 3 3-3 3M20 16H6m3-3-3 3 3 3" />
    </svg>
  );
}

function IconLabel() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M2.5 16h4M17.5 16h4" />
      <path d="M8.5 9.5V8h7v1.5M12 8v8.5M10.5 16.5h3" />
    </svg>
  );
}

function ConnectorBar({ api, first, single, patch, pop, togglePop }: CtxProps) {
  const a = capOf(first, 'start');
  const b = capOf(first, 'end');
  return (
    <div className="ctx-group">
      <PopBtn open={pop === 'lstyle'} onToggle={togglePop('lstyle')} label="Linienart">
        {LINE_STYLES.find((l) => l.style === (first.lineStyle ?? 'straight'))?.icon ?? LINE_STYLES[0].icon}
      </PopBtn>
      <span className="shapes-split">
        <Toggle label="Pfeil am Anfang" on={a !== 'none'} onClick={() => patch((o) => toggleCap(o, 'start'))}>
          <CapIcon cap={a === 'none' ? 'none' : a} end={false} />
        </Toggle>
        <button className="ctx-btn shapes-caret" aria-label="Spitze am Anfang wählen" title="Spitze am Anfang wählen" aria-expanded={pop === 'shapes.capStart'} onClick={togglePop('shapes.capStart')}>
          <Chevron />
        </button>
      </span>
      <span className="shapes-split">
        <Toggle label="Pfeil am Ende" on={b !== 'none'} onClick={() => patch((o) => toggleCap(o, 'end'))}>
          <CapIcon cap={b === 'none' ? 'none' : b} />
        </Toggle>
        <button className="ctx-btn shapes-caret" aria-label="Spitze am Ende wählen" title="Spitze am Ende wählen" aria-expanded={pop === 'shapes.capEnd'} onClick={togglePop('shapes.capEnd')}>
          <Chevron />
        </button>
      </span>
      <PopBtn open={pop === 'dash'} onToggle={togglePop('dash')} label="Linie">
        <IconDash dash={first.dash ?? 'solid'} />
      </PopBtn>
      <PopBtn open={pop === 'cwidth'} onToggle={togglePop('cwidth')} label="Linienstärke">
        <span className="ctx-num ctx-num--sm">{first.strokeWidth ?? 2}</span>
      </PopBtn>
      <button className="ctx-btn" aria-label="Richtung umkehren" title="Richtung umkehren" onClick={() => patch(reversePatch)}>
        <IconSwap />
      </button>
      {single && (
        <button className="ctx-btn" aria-label="Beschriftung" title="Beschriftung (Doppelklick auf die Linie)" onClick={() => api.startEditing(single)}>
          <IconLabel />
        </button>
      )}
    </div>
  );
}

defineContextAction({
  id: 'core.connector',
  order: 50,
  when: (c) => !c.locked && onlyConnectors(c),
  Bar: ConnectorBar,
  pops: {
    lstyle: {
      className: 'ctx-pop--row',
      label: 'Linienart',
      Body: ({ first, choose }) =>
        LINE_STYLES.map((l) => (
          <button key={l.style} className={`ctx-btn${(first.lineStyle ?? 'straight') === l.style ? ' is-active' : ''}`} aria-label={l.label} title={l.label} onClick={() => choose(() => ({ lineStyle: l.style === 'straight' ? undefined : l.style }))}>
            {l.icon}
          </button>
        )),
    },
    'shapes.capStart': { className: 'shapes-pop shapes-pop--caps', label: 'Spitze am Anfang', Body: (p) => <CapPop {...p} end="start" /> },
    'shapes.capEnd': { className: 'shapes-pop shapes-pop--caps', label: 'Spitze am Ende', Body: (p) => <CapPop {...p} end="end" /> },
    dash: {
      className: 'ctx-pop--row',
      label: 'Linie',
      Body: ({ first, choose }) =>
        DASHES.map((d) => (
          <button key={d.dash} className={`ctx-btn${(first.dash ?? 'solid') === d.dash ? ' is-active' : ''}`} aria-label={d.label} title={d.label} onClick={() => choose(() => ({ dash: d.dash === 'solid' ? undefined : d.dash }))}>
            <IconDash dash={d.dash} />
          </button>
        )),
    },
    cwidth: {
      className: 'ctx-pop--row',
      label: 'Linienstärke',
      Body: ({ first, choose }) =>
        WIDTHS.map((w) => (
          <button key={w} className={`ctx-btn${(first.strokeWidth ?? 2) === w ? ' is-active' : ''}`} aria-label={`Linienstärke ${w}`} title={`${w} px`} onClick={() => choose(() => ({ strokeWidth: w }))}>
            <span className="ctx-line-w" style={{ height: w }} />
          </button>
        )),
    },
  },
});

// ---- Werkzeug: Voreinstellung für neue Verbinder -------------------------------------------------------------------------

const TOOL_CAPS: CapStyle[] = ['triangle', 'arrow', 'none'];

function ConnectorOptions() {
  // nichts gewählt = automatisch: zwischen zwei Objekten geschwungen, frei gerade (editor/core/tools.tsx newLineStyle);
  // erneutes Klicken auf die gewählte Linienart schaltet zurück auf automatisch
  const [style, setStyle] = useToolOption<LineStyle | undefined>('connector', 'lineStyle', undefined);
  const [cap, setCap] = useToolOption<CapStyle>('connector', 'cap', 'triangle');
  return (
    <>
      {LINE_STYLES.map((l) => (
        <button
          key={l.style}
          className={`fly-btn${style === l.style ? ' is-active' : ''}`}
          aria-label={`Neue Verbinder: ${l.label}`}
          aria-pressed={style === l.style}
          title={style === l.style ? `${l.label} (nochmal klicken: automatisch)` : `${l.label} (sonst automatisch: zwischen Objekten geschwungen)`}
          onClick={() => setStyle(style === l.style ? undefined : l.style)}
        >
          {l.icon}
        </button>
      ))}
      <span className="fly-sep" />
      {TOOL_CAPS.map((c) => (
        <button key={c} className={`fly-btn${cap === c ? ' is-active' : ''}`} aria-label={`Spitze: ${CAP_LABELS[c]}`} title={`Spitze: ${CAP_LABELS[c]}`} onClick={() => setCap(c)}>
          <CapIcon cap={c} />
        </button>
      ))}
    </>
  );
}

defineTool({ ...tools.get('connector')!, Options: ConnectorOptions });
