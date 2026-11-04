// Kern-Werkzeuge im Werkzeug-Register (Reihenfolge, Kürzel und Untermenüs wie bei gängigen Whiteboards).
// Auswählen und Verschieben (Hand) steuert der Editor selbst; alle anderen bringen ihre Zeiger-Handler mit.
import { STICKY_COLORS, type BoardObject, type ConnectorEnd, type LineStyle, type ShapeKind } from '../../protocol';
import { INK_COLORS } from '../../board/colors';
import { center, distToSegment, normRect, type Point, type Rect } from '../../board/geometry';
import { endAnchor, isAttached } from '../../board/connector';
import { penFromPoints, simplify } from '../../board/pen';
import { IconConnector, IconEraser, IconFrame, IconLasso, IconMarquee, IconHand, IconImage, IconPen, IconSelect, IconShapes, IconSticky, IconText } from '../../ui/icons';
import { colorName } from '../../ui/a11y';
import { defineTool, shapeKinds, typeDef } from '../ext/registry';
import { getToolOption, useToolOption } from '../ext/toolOptions';
import type { EditorApi, ToolGesture, ToolPointerEvent } from '../ext/types';

export const PEN_WIDTHS = [2, 4, 8];

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Touch: erst beim Loslassen anlegen – ein zweiter Finger (Pinch) bricht die Geste ab und erzeugt nichts. */
export const tapGesture = (down: ToolPointerEvent, run: () => void): ToolGesture => ({
  kind: 'tap',
  up: (e) => {
    if (dist(e.screen, down.screen) < 10) run();
  },
});

/**
 * Linienart eines neuen Verbinders (Feld `lineStyle`, gerade = undefined): ausdrücklich im Werkzeug gewählt gilt immer;
 * sonst zwischen zwei Objekten geschwungen, freie Linien bleiben gerade.
 */
export function newLineStyle(from: ConnectorEnd | undefined, to: ConnectorEnd | undefined): LineStyle | undefined {
  const chosen = getToolOption<LineStyle | undefined>('connector', 'lineStyle', undefined);
  if (chosen) return chosen === 'straight' ? undefined : chosen;
  return isAttached(from) && isAttached(to) ? 'curved' : undefined;
}

/** Feature-Module können das Verbinder-Ziehen ersetzen (shapes: Andockpunkte beim Ziehen, neue Form am Plus-Griff). */
export const connectorDrag: { gesture?: typeof connectorGesture } = {};

/** Verbinder aus `from` ziehen (Werkzeug, Andockpunkte und Plus-Griffe der Auswahl). */
export function connectorGesture(api: EditorApi, from: ConnectorEnd, fromId: string | null, start: Point, screen: Point): ToolGesture {
  if (connectorDrag.gesture) return connectorDrag.gesture(api, from, fromId, start, screen);
  const lookup = (id: string) => api.snapshot().byId.get(id);
  return {
    kind: 'connector',
    hoverTarget: true,
    move: (e) => {
      const target = api.hitTest(e.world, (o) => o.id === fromId);
      api.setHover(target?.id ?? null);
      const a = fromId ? (endAnchor({ objectId: fromId }, lookup) ?? start) : start;
      api.setDraft({ kind: 'connector', a, b: e.world });
    },
    up: (e) => {
      const target = api.hitTest(e.world, (o) => o.id === fromId);
      api.setHover(null);
      if (!target && dist(e.screen, screen) < 12) return;
      if (target && target.id === fromId) return;
      const to: ConnectorEnd = target ? { objectId: target.id } : { x: Math.round(e.world.x), y: Math.round(e.world.y) };
      const a = endAnchor(from, lookup) ?? start;
      const b = endAnchor(to, lookup) ?? e.world;
      api.create({ type: 'connector', ...normRect(a, b), from, to, color: '#0a0a0a', strokeWidth: 2, arrowEnd: true, lineStyle: newLineStyle(from, to) }, { select: true });
    },
  };
}

/** Form bzw. Rahmen aufziehen; ein kurzer Klick legt die Standardgröße an. */
function drawGesture(api: EditorApi, kind: 'shape' | 'frame', down: ToolPointerEvent): ToolGesture {
  const start = down.world;
  let rect: Rect | null = null;
  return {
    kind: 'draw',
    move: (e) => {
      let r = normRect(start, e.world);
      if (e.shift) {
        const s = Math.max(r.w, r.h);
        r = normRect(start, { x: start.x + Math.sign(e.world.x - start.x || 1) * s, y: start.y + Math.sign(e.world.y - start.y || 1) * s });
      }
      rect = r;
      api.setDraft(kind === 'shape' ? { kind: 'shape', rect: r, shape: getToolOption<ShapeKind>('shape', 'kind', 'rect') } : { kind: 'frame', rect: r });
    },
    up: (e) => {
      let r = rect ?? normRect(start, e.world);
      if (dist(e.screen, down.screen) < 8) {
        const size = typeDef(kind).defaultSize!;
        r = { x: start.x - size.w / 2, y: start.y - size.h / 2, w: size.w, h: size.h };
      }
      r = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(16, Math.round(r.w)), h: Math.max(16, Math.round(r.h)) };
      const base = typeDef(kind).create!(center(r), api);
      api.create({ ...base, ...r }, { select: true });
    },
  };
}

// ---- Untermenüs ---------------------------------------------------------------------------------------------------

function StickyIcon() {
  const [color] = useToolOption('sticky', 'color', STICKY_COLORS[0]);
  return (
    <span className="tb-sticky-icon">
      <IconSticky />
      <span className="tb-sticky-dot" style={{ background: color }} />
    </span>
  );
}

function StickyOptions() {
  const [color, setColor] = useToolOption('sticky', 'color', STICKY_COLORS[0]);
  return (
    <>
      {STICKY_COLORS.map((c) => (
        <button key={c} className={`swatch${color === c ? ' is-active' : ''}`} style={{ background: c }} aria-label={`Notizfarbe ${colorName(c)}`} onClick={() => setColor(c)} />
      ))}
    </>
  );
}

function ShapeOptions() {
  const [kind, setKind] = useToolOption<ShapeKind>('shape', 'kind', 'rect');
  return (
    <>
      {shapeKinds.list().map((s) => (
        <button key={s.kind} className={`fly-btn${kind === s.kind ? ' is-active' : ''}`} aria-label={s.label} title={s.label} onClick={() => setKind(s.kind)}>
          {s.icon}
        </button>
      ))}
    </>
  );
}

function PenOptions() {
  const [color, setColor] = useToolOption('pen', 'color', '#0a0a0a');
  const [width, setWidth] = useToolOption('pen', 'width', 4);
  return (
    <>
      {INK_COLORS.slice(0, 6).map((c) => (
        <button key={c} className={`swatch swatch--round${color === c ? ' is-active' : ''}`} style={{ background: c }} aria-label={`Stiftfarbe ${colorName(c)}`} onClick={() => setColor(c)} />
      ))}
      <span className="fly-sep" />
      {PEN_WIDTHS.map((w) => (
        <button key={w} className={`fly-btn${width === w ? ' is-active' : ''}`} aria-label={`Strichstärke ${w}`} onClick={() => setWidth(w)}>
          <span className="width-dot" style={{ width: w + 4, height: w + 4 }} />
        </button>
      ))}
    </>
  );
}

// ---- Werkzeuge ----------------------------------------------------------------------------------------------------

/** Auswählen: Rechteck (Standard) oder Lasso; Strg/⌘ beim Ziehen nimmt jeweils die andere Art. */
function SelectIcon() {
  const [lasso] = useToolOption('select', 'lasso', false);
  return lasso ? <IconLasso /> : <IconSelect />;
}

function SelectOptions() {
  const [lasso, setLasso] = useToolOption('select', 'lasso', false);
  return (
    <>
      <button className={`fly-btn${!lasso ? ' is-active' : ''}`} aria-label="Rechteck-Auswahl" title="Rechteck-Auswahl" aria-pressed={!lasso} onClick={() => setLasso(false)}>
        <IconMarquee />
      </button>
      <button className={`fly-btn${lasso ? ' is-active' : ''}`} aria-label="Lasso-Auswahl" title="Lasso-Auswahl (oder Strg beim Ziehen)" aria-pressed={lasso} onClick={() => setLasso(true)}>
        <IconLasso />
      </button>
    </>
  );
}

defineTool({ id: 'select', label: 'Auswählen', order: 10, key: 'v', Icon: SelectIcon, cursor: 'default', Options: SelectOptions, optionsOnDemand: true });
defineTool({ id: 'hand', label: 'Verschieben', hint: 'Ansicht verschieben', order: 20, key: 'h', Icon: IconHand, cursor: 'grab', phone: 'hide' });

defineTool({
  id: 'sticky',
  label: 'Haftnotiz',
  order: 30,
  key: 'n',
  Icon: StickyIcon,
  Options: StickyOptions,
  down: (e, api) => {
    if (e.pointerType === 'touch') return tapGesture(e, () => api.placeAt('sticky', e.world));
    api.placeAt('sticky', e.world);
  },
});

defineTool({
  id: 'text',
  label: 'Text',
  order: 40,
  key: 't',
  Icon: IconText,
  cursor: 'text',
  down: (e, api) => {
    const place = () => {
      // auf vorhandenem Text: diesen bearbeiten statt einen neuen darüberzulegen
      const hit = api.hitTest(e.world);
      if (hit?.type === 'text' && !hit.locked) {
        api.setTool('select');
        api.startEditing(hit);
      } else api.placeAt('text', e.world);
    };
    if (e.pointerType === 'touch') return tapGesture(e, place);
    place();
  },
});

defineTool({ id: 'shape', label: 'Form', order: 50, key: 's', Icon: IconShapes, Options: ShapeOptions, down: (e, api) => drawGesture(api, 'shape', e) });

defineTool({
  id: 'connector',
  label: 'Verbinder',
  order: 60,
  key: 'l',
  Icon: IconConnector,
  hoverTarget: true,
  down: (e, api) => {
    const o = api.hitTest(e.world);
    const from: ConnectorEnd = o ? { objectId: o.id } : { x: Math.round(e.world.x), y: Math.round(e.world.y) };
    return connectorGesture(api, from, o?.id ?? null, e.world, e.screen);
  },
});

defineTool({
  id: 'pen',
  label: 'Stift',
  order: 70,
  key: 'p',
  Icon: IconPen,
  Options: PenOptions,
  down: (e, api) => {
    const color = getToolOption('pen', 'color', '#0a0a0a');
    const width = getToolOption('pen', 'width', 4);
    const points = [e.world];
    api.setDraft({ kind: 'pen', points, color, width });
    return {
      kind: 'pen',
      move: (m) => {
        const last = points[points.length - 1];
        if (dist(m.world, last) * api.camera().z < 2) return;
        points.push(m.world);
        api.setDraft({ kind: 'pen', points: [...points], color, width });
      },
      up: () => {
        const pts = simplify(points, 0.6 / api.camera().z);
        if (!pts.length) return;
        api.store.stopCapturing();
        api.store.create({ type: 'pen', ...penFromPoints(pts.length === 1 ? [pts[0], { x: pts[0].x + 0.5, y: pts[0].y }] : pts, width), color, strokeWidth: width });
      },
    };
  },
});

/** Trifft der Radierer (Kreis um `p`, Radius `r`) den Stiftstrich? Prüft die Liniensegmente, nicht nur die Box. */
export function penHit(o: BoardObject, p: Point, r: number): boolean {
  const pts = o.points ?? [];
  const reach = r + (o.strokeWidth ?? 2) / 2;
  if (p.x < o.x - reach || p.y < o.y - reach || p.x > o.x + o.w + reach || p.y > o.y + o.h + reach) return false;
  const at = (i: number) => ({ x: o.x + pts[i * 2], y: o.y + pts[i * 2 + 1] });
  const n = Math.floor(pts.length / 2);
  if (n === 1) return Math.hypot(p.x - at(0).x, p.y - at(0).y) <= reach;
  for (let i = 0; i < n - 1; i++) if (distToSegment(p, at(i), at(i + 1)) <= reach) return true;
  return false;
}

export const ERASER_SIZES = [8, 20, 40];

function EraserOptions() {
  const [size, setSize] = useToolOption('eraser', 'size', ERASER_SIZES[1]);
  return (
    <>
      {ERASER_SIZES.map((s) => (
        <button key={s} className={`fly-btn${size === s ? ' is-active' : ''}`} aria-label={`Radierer-Größe ${s}`} onClick={() => setSize(s)}>
          <span className="width-dot" style={{ width: 4 + s / 3, height: 4 + s / 3 }} />
        </button>
      ))}
    </>
  );
}

/** Radierer: löscht ganze Stiftstriche, über die man fährt (ein Undo-Schritt beim Loslassen). */
defineTool({
  id: 'eraser',
  label: 'Radierer',
  order: 75,
  key: 'e',
  Icon: IconEraser,
  cursor: 'crosshair',
  phone: 'more',
  Options: EraserOptions,
  down: (e, api) => {
    const hit = new Set<string>();
    let last = e.world;
    const r = () => getToolOption('eraser', 'size', ERASER_SIZES[1]) / 2 / api.camera().z;
    const sweep = (p: Point) => {
      const rad = r();
      // Zwischenpunkte, damit schnelle Bewegungen keine Striche überspringen
      const steps = Math.max(1, Math.ceil(dist(p, last) / Math.max(1, rad)));
      for (let i = 1; i <= steps; i++) {
        const q = { x: last.x + ((p.x - last.x) * i) / steps, y: last.y + ((p.y - last.y) * i) / steps };
        for (const o of api.queryRect({ x: q.x - rad, y: q.y - rad, w: rad * 2, h: rad * 2 })) {
          if (o.type === 'pen' && !o.locked && !hit.has(o.id) && penHit(o, q, rad)) hit.add(o.id);
        }
      }
      last = p;
      const s = api.snapshot();
      api.setDraft({
        kind: 'world',
        node: (
          <g className="eraser-draft">
            {[...hit].map((id) => {
              const o = s.byId.get(id);
              if (!o?.points) return null;
              const d = o.points.reduce((acc, v, i) => acc + (i % 2 ? `,${o.y + v}` : `${i ? ' L' : 'M'}${o.x + v}`), '');
              return <path key={id} d={d} fill="none" stroke="#ec4e92" strokeOpacity={0.55} strokeWidth={(o.strokeWidth ?? 2) + 4 / api.camera().z} strokeLinecap="round" strokeLinejoin="round" />;
            })}
            <circle cx={p.x} cy={p.y} r={rad} fill="rgba(255,255,255,0.6)" stroke="#0a0a0a" strokeWidth={1 / api.camera().z} />
          </g>
        ),
      });
    };
    sweep(e.world);
    return {
      kind: 'erase',
      move: (m) => sweep(m.world),
      up: () => {
        api.setDraft(null);
        if (!hit.size) return;
        api.store.stopCapturing();
        api.store.remove(hit);
        api.setSelection(api.selection().filter((id) => !hit.has(id)));
      },
      cancel: () => {
        hit.clear();
        api.setDraft(null);
      },
    };
  },
});

defineTool({ id: 'frame', label: 'Rahmen', order: 80, key: 'f', Icon: IconFrame, down: (e, api) => drawGesture(api, 'frame', e) });

defineTool({ id: 'image', label: 'Bild einfügen', order: 100, sepBefore: true, Icon: IconImage, action: (api) => api.pickImages() });
