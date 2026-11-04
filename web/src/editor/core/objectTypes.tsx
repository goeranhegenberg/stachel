// Kern-Objekttypen im Typ-Register: Darstellung, Größe, Bearbeiten, Griffe. Verhalten wie vor dem Umbau auf Register.
import { memo, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { STICKY_COLORS, type BoardObject } from '../../protocol';
import { INK_COLORS, readableInk, SHAPE_FILLS, textOn } from '../../board/colors';
import { mapRect, worldToScreen, type Handle } from '../../board/geometry';
import { arrowHeadAt, connectorBounds, connectorGeometry, connectorPath, dashArray, isAttached, type ConnectorGeometry } from '../../board/connector';
import { scalePoints, smoothPath } from '../../board/pen';
import type { Patch } from '../../board/store';
import { measureText, shapeFontSize, stickyFontSize, stickyPadding, useFontsVersion } from '../textMeasure';
import { adjustTextPatch, autoTextWidth, textWeight } from '../interaction/textWidth';
import { flexAlign, formatStyle, placeStyle, textFormat, valignOf } from '../render/format';
import { knownColor, rememberColor } from '../render/imageColor';
import { chooseVariant, getImageZoom, markVariantLoaded, subscribeImageZoom, variantSrc } from '../render/imageVariant';
import { textEngine } from '../text/engine';
import { defineObjectType, shapeKinds } from '../ext/registry';
import { getToolOption } from '../ext/toolOptions';
import type { ObjectViewProps, SelectionViewProps } from '../ext/types';
import { shapeInsets, shapePath } from './shapeKinds';

const CORNERS: Handle[] = ['nw', 'ne', 'se', 'sw'];

/** Hinweis unter einem Objekt, das gerade auch jemand anderes bearbeitet. */
export function RemoteHint({ name }: { name?: string }) {
  return (
    <div className="remote-hint" role="status">
      Wird gerade auch von {name || 'jemand anderem'} bearbeitet
    </div>
  );
}

// ---- Haftnotiz ------------------------------------------------------------------------------------------------------

function StickyView({ o, editing, remoteName, cb }: ObjectViewProps) {
  useFontsVersion();
  const fmt = textFormat(o);
  const fs = o.fontSize ?? stickyFontSize(o.text ?? '', o.w, o.h, fmt);
  const pad = stickyPadding(o.w, o.h);
  const fill = o.color ?? '#fff27a';
  const [foreign, setForeign] = useState(false);
  const tStyle: CSSProperties = { fontSize: fs, ...formatStyle(o, 500, 'center') };
  const T = textEngine();
  return (
    <div className="obj obj-sticky" data-id={o.id} data-type="sticky" style={placeStyle(o, { background: fill, color: readableInk(fill) })}>
      <div className="sticky-body" style={{ padding: pad, alignItems: flexAlign(valignOf(o)) }}>
        {editing ? <T.Edit o={o} variant="sticky" className="sticky-text" style={tStyle} cb={cb} onForeign={setForeign} /> : <T.View o={o} variant="sticky" className="sticky-text" style={tStyle} />}
      </div>
      {editing && foreign && <RemoteHint name={remoteName} />}
    </div>
  );
}

defineObjectType({
  type: 'sticky',
  label: 'Haftnotiz',
  View: StickyView,
  simpleStyle: (o) => ({ background: o.color ?? '#fff27a' }),
  defaultSize: { w: 200, h: 200 },
  create: (p) => ({ type: 'sticky', x: Math.round(p.x - 100), y: Math.round(p.y - 100), w: 200, h: 200, color: getToolOption('sticky', 'color', STICKY_COLORS[0]), text: '' }),
  edit: 'text',
  textual: true,
  valign: true,
  autoFont: (o) => stickyFontSize(o.text ?? '', o.w, o.h, o),
  palette: STICKY_COLORS,
  defaultColor: STICKY_COLORS[0],
  rotatable: true,
  anchorable: true,
  addHandles: true,
  handles: () => CORNERS,
  keepAspect: true,
});

// ---- Text -----------------------------------------------------------------------------------------------------------

// Große Schrift etwas kräftiger – Überschriften sollen nach Überschrift aussehen
const textStyle = (o: BoardObject): CSSProperties => {
  const fs = o.fontSize ?? 24;
  return {
    fontSize: fs,
    color: o.color ?? '#0a0a0a',
    letterSpacing: fs >= 40 ? '-0.01em' : undefined,
    ...formatStyle(o, 500, 'left'),
    fontWeight: textWeight(o),
    whiteSpace: o.autoWidth ? 'pre' : undefined,
  };
};

function TextView({ o, editing, selected, remoteName, cb }: ObjectViewProps) {
  useFontsVersion();
  const ref = useRef<HTMLDivElement>(null);
  const [foreign, setForeign] = useState(false);
  // Gemessene Höhe mit o.h vergleichen (andere Schrift-Metrik, fremde Änderungen) – nur melden, nicht schreiben.
  // Nur für ausgewählte Texte: sonst schreiben mehrere Clients gegeneinander.
  useLayoutEffect(() => {
    if (editing || !selected || !cb.onMeasured) return;
    const el = ref.current?.querySelector('.text-content') as HTMLElement | null;
    if (!el) return;
    const h = Math.max(Math.ceil(el.offsetHeight), Math.round((o.fontSize ?? 24) * 1.25));
    if (Math.abs(h - o.h) > 2) cb.onMeasured(o.id, h);
  });
  const T = textEngine();
  return (
    <div
      ref={ref}
      className={`obj obj-text${editing ? ' is-editing' : ''}`}
      data-id={o.id}
      data-type="text"
      style={placeStyle(o, editing ? { height: 'auto', minHeight: o.h, width: o.autoWidth ? 'max-content' : o.w, minWidth: o.w } : undefined)}
    >
      {editing ? (
        <T.Edit o={o} variant="text" className="text-content" style={textStyle(o)} placeholder="Text eingeben" cb={cb} onForeign={setForeign} />
      ) : (
        <T.View o={o} variant="text" className="text-content" style={textStyle(o)} />
      )}
      {editing && foreign && <RemoteHint name={remoteName} />}
    </div>
  );
}

/** Text-Patch: berührt er die Textmaße? */

defineObjectType({
  type: 'text',
  label: 'Text',
  View: TextView,
  simpleStyle: (o) => ({ background: o.color ?? '#0a0a0a', opacity: 0.3, borderRadius: Math.min(o.h, 6 * (o.fontSize ?? 24)) }),
  create: (p) => ({
    type: 'text',
    x: Math.round(p.x - 8),
    y: Math.round(p.y - 18),
    w: autoTextWidth({ fontSize: 28 }),
    h: 36,
    fontSize: 28,
    text: '',
    color: '#0a0a0a',
    autoWidth: true,
  }),
  edit: 'text',
  onEditDone: (o, api, el) => {
    if (!(o.text ?? '').trim()) {
      api.store.remove([o.id]);
      return;
    }
    const content = el?.querySelector('.text-content') as HTMLElement | null;
    if (content) api.store.update(o.id, { h: Math.max(8, Math.ceil(content.offsetHeight)) });
  },
  // Breite folgt bei autoWidth dem (gepatchten) Inhalt
  adjustPatch: adjustTextPatch,
  measure: '.text-content',
  textual: true,
  textAlign: 'left',
  defaultFontSize: 24,
  palette: INK_COLORS,
  defaultColor: '#0a0a0a',
  rotatable: true,
  anchorable: true,
  handles: () => [...CORNERS, 'e', 'w'],
  keepAspect: 'corner',
  sideResize: 'width',
  resize: (o, base, ctx) =>
    // Seitengriff: ab jetzt feste Breite; Ecke: Schrift skaliert mit
    ctx.widthOnly ? { ...base, autoWidth: undefined } : { ...base, fontSize: Math.max(6, Math.round((o.fontSize ?? 24) * (ctx.rect.h / o.h) * 10) / 10) },
  afterResize: (o, api) => {
    if (o.autoWidth) api.store.update(o.id, { w: autoTextWidth(o) });
  },
});

// ---- Form -----------------------------------------------------------------------------------------------------------

function ShapeView({ o, editing, remoteName, cb }: ObjectViewProps) {
  useFontsVersion();
  const [foreign, setForeign] = useState(false);
  const sw = Math.max(0, o.strokeWidth ?? 2);
  const fill = o.color ?? '#ffffff';
  const [t, r, b, l] = shapeInsets(o.shape, o.w, o.h);
  const fs = shapeFontSize(o.text ?? '', o.fontSize ?? 20, o.w - l - r, o.h - t - b, textFormat(o));
  const tStyle: CSSProperties = { fontSize: fs, color: textOn(fill), ...formatStyle(o, 600, 'center') };
  const inner: CSSProperties = { padding: `${t}px ${r}px ${b}px ${l}px`, alignItems: flexAlign(valignOf(o)) };
  const T = textEngine();
  return (
    <div className="obj obj-shape" data-id={o.id} data-type="shape" style={placeStyle(o)}>
      <svg width={o.w} height={o.h} className="shape-svg" aria-hidden="true">
        <path
          d={shapePath(o.shape, o.w, o.h, sw / 2)}
          fill={fill}
          stroke={sw > 0 ? (o.stroke ?? '#0a0a0a') : 'none'}
          strokeWidth={sw}
          strokeLinejoin="round"
          strokeDasharray={sw > 0 && o.dash === 'dashed' ? dashArray('dashed', sw) : undefined}
        />
      </svg>
      <div className="shape-text-wrap" style={inner}>
        {editing ? <T.Edit o={o} variant="shape" className="shape-text" style={tStyle} cb={cb} onForeign={setForeign} /> : <T.View o={o} variant="shape" className="shape-text" style={tStyle} />}
      </div>
      {editing && foreign && <RemoteHint name={remoteName} />}
    </div>
  );
}

defineObjectType({
  type: 'shape',
  label: 'Form',
  View: ShapeView,
  simpleStyle: (o) => {
    const style: CSSProperties = { background: o.color ?? '#ffffff' };
    const sw = o.strokeWidth ?? 2;
    const kind = o.shape ? shapeKinds.get(o.shape) : undefined;
    if (kind?.simpleRadius) style.borderRadius = kind.simpleRadius;
    if (kind?.simpleClip) style.clipPath = kind.simpleClip;
    else if (sw > 0) style.boxShadow = `inset 0 0 0 ${Math.max(sw, Math.min(o.w, o.h) * 0.04)}px ${o.stroke ?? '#0a0a0a'}`;
    return style;
  },
  defaultSize: { w: 180, h: 120 },
  create: (p) => ({
    type: 'shape',
    shape: getToolOption('shape', 'kind', 'rect'),
    x: Math.round(p.x - 90),
    y: Math.round(p.y - 60),
    w: 180,
    h: 120,
    color: '#ffffff',
    stroke: '#0a0a0a',
    strokeWidth: 2,
    text: '',
    fontSize: 20,
  }),
  edit: 'text',
  textual: true,
  valign: true,
  defaultFontSize: 20,
  palette: SHAPE_FILLS,
  defaultColor: '#ffffff',
  rotatable: true,
  anchorable: true,
  addHandles: true,
});

// ---- Rahmen ---------------------------------------------------------------------------------------------------------

function FrameView({ o }: ObjectViewProps) {
  return (
    <div className="obj obj-frame" data-id={o.id} data-type="frame" style={placeStyle(o)}>
      <div className="frame-body" style={{ background: o.color ?? '#ffffff' }} />
    </div>
  );
}

/**
 * Weit herausgezoomt: Rahmentitel größer, aber über der Oberkante des Rahmens (nicht in der Mitte), damit er den
 * Inhalt nicht verdeckt – gerade am Handy, wo man oft weit herausgezoomt startet.
 * Größe in Bildschirm-px, umgerechnet in Weltpunkte; dient auch als Griff zum Verschieben des Rahmens.
 */
const FrameBigTitle = memo(function FrameBigTitle({ o, zq }: { o: BoardObject; zq: number }) {
  useFontsVersion();
  const z = 2 ** zq;
  const screenW = o.w * z;
  if (screenW < 40) return null;
  const title = o.title || 'Rahmen';
  // Breite je px Schriftgröße: Text (Barlow Condensed 700, Großbuchstaben) + Buchstabenabstand + Innenabstand
  const perPx = measureText(title.toUpperCase(), 100, 700, false, '"Barlow Condensed"') / 100 + 0.04 * title.length + 1;
  const px = Math.max(11, Math.min(18, screenW / perPx));
  return (
    <div
      className="obj frame-big-title"
      data-id={o.id}
      data-frame-title
      style={{ transform: `translate(${o.x}px, ${o.y - 4 / z}px) translateY(-100%)`, fontSize: px / z, maxWidth: o.w }}
    >
      {title}
    </div>
  );
});

defineObjectType({
  type: 'frame',
  label: 'Rahmen',
  View: FrameView,
  FarLabel: FrameBigTitle,
  lodPx: null,
  below: true,
  hit: 'background',
  plainText: (o) => o.title,
  defaultSize: { w: 640, h: 420 },
  create: (p, api) => ({
    type: 'frame',
    x: Math.round(p.x - 320),
    y: Math.round(p.y - 210),
    w: 640,
    h: 420,
    title: `Rahmen ${api.snapshot().ordered.filter((o) => o.type === 'frame').length + 1}`,
    color: '#ffffff',
  }),
  edit: 'title',
  palette: SHAPE_FILLS,
  defaultColor: '#ffffff',
  container: true,
  marquee: 'contain',
});

// ---- Bild -----------------------------------------------------------------------------------------------------------

/** benötigte Bildstufe nach Bildschirmbreite (Objektbreite × Zoom × devicePixelRatio), ändert sich nur an Stufengrenzen */
function useImageVariant(src: string | undefined, w: number): number {
  return useSyncExternalStore(subscribeImageZoom, () => (src ? chooseVariant(src, w * getImageZoom() * (window.devicePixelRatio || 1)) : 0));
}

function ImageView({ o, imageSrc: base, far }: ObjectViewProps) {
  const variant = useImageVariant(far ? undefined : base, o.w);
  // Stufe fehlgeschlagen (z. B. älterer Server ohne Varianten): Original nehmen
  const [failed, setFailed] = useState<string | null>(null);
  const tierSrc = base ? variantSrc(base, variant) : undefined;
  const src = tierSrc && tierSrc === failed ? base : tierSrc;
  const [state, setState] = useState<{ src?: string; s: 'loading' | 'ok' | 'error' }>({ src, s: 'loading' });
  const s = state.src === src ? state.s : 'loading';
  // zuletzt erfolgreich geladene Fassung: bleibt sichtbar, bis die größere Stufe da ist (kein Aufblitzen beim Hineinzoomen)
  const [shown, setShown] = useState<string | null>(null);
  const prev = s === 'loading' && shown && shown !== src && base && (shown === base || shown.startsWith(`${base}?`)) ? shown : null;
  const fill = o.color ?? knownColor(base);
  let body: React.ReactNode;
  if (!src || s === 'error') {
    body = (
      <div className="image-missing">
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
          <path d="M4 5h16v14H4z M4 15l4.5-4.5 4 4 2.5-2.5L20 17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="15.5" cy="9" r="1.6" fill="currentColor" />
        </svg>
        <span>Bild nicht verfügbar</span>
      </div>
    );
  } else if (far) {
    body = <div className="image-fill" style={{ background: fill ?? '#d9d9d3' }} />;
  } else {
    body = (
      <>
        {prev ? <img src={prev} alt="" draggable={false} /> : s === 'loading' && <div className="image-loading" style={fill ? { background: fill } : undefined} />}
        <img
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          loading="lazy"
          className={s === 'loading' ? 'is-loading' : undefined}
          style={prev ? { position: 'absolute', inset: 0 } : undefined}
          onLoad={(e) => {
            if (base) {
              rememberColor(base, e.currentTarget);
              markVariantLoaded(base, src === base ? 0 : variant);
            }
            setState({ src, s: 'ok' });
            setShown(src);
          }}
          onError={() => (src !== base ? setFailed(src) : setState({ src, s: 'error' }))}
        />
      </>
    );
  }
  return (
    <div className="obj obj-image" data-id={o.id} data-type="image" style={placeStyle(o)}>
      {body}
    </div>
  );
}

defineObjectType({
  type: 'image',
  label: 'Bild',
  View: ImageView,
  simpleStyle: (o, imageSrc) => ({ background: o.color ?? knownColor(imageSrc) ?? '#d9d9d3' }),
  lodPx: 80,
  colorable: false,
  rotatable: true,
  anchorable: true,
  handles: () => CORNERS,
  keepAspect: true,
});

// ---- Stift ----------------------------------------------------------------------------------------------------------

const PenView = memo(function PenView({ o }: ObjectViewProps) {
  const d = smoothPath(o.points ?? []);
  const sw = o.strokeWidth ?? 4;
  return (
    <div className="obj obj-pen" data-id={o.id} data-type="pen" style={placeStyle(o)}>
      <svg width={o.w} height={o.h} overflow="visible" aria-hidden="true">
        <path className="hit" d={d} strokeWidth={Math.max(16, sw + 12)} />
        <path d={d} fill="none" stroke={o.color ?? '#0a0a0a'} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
});

defineObjectType({
  type: 'pen',
  label: 'Zeichnung',
  View: PenView,
  lodPx: null,
  hit: 'none',
  palette: INK_COLORS,
  defaultColor: '#0a0a0a',
  snapTarget: false,
  resize: (o, base, ctx) => (o.points ? { ...base, points: scalePoints(o.points, ctx.rect.w / o.w, ctx.rect.h / o.h) } : base),
});

// ---- Verbinder ------------------------------------------------------------------------------------------------------

function ConnectorView({ o, editing, derived }: ObjectViewProps) {
  const g = derived as ConnectorGeometry;
  const sw = o.strokeWidth ?? 2;
  const color = o.color ?? '#0a0a0a';
  const arrowEnd = o.arrowEnd !== false;
  const arrowStart = !!o.arrowStart;
  const size = 8 + sw * 3;
  const bounds = connectorBounds(g, 16 + sw * 3);
  const lx = (v: number) => v - bounds.x;
  const ly = (v: number) => v - bounds.y;
  // Linie endet vor der Pfeilspitze, damit die Spitze sauber bleibt.
  const d = connectorPath(g, bounds.x, bounds.y, arrowStart ? size * 0.7 : 0, arrowEnd ? size * 0.7 : 0);
  const heads = [arrowEnd ? arrowHeadAt(g.b, g.dirB, size) : null, arrowStart ? arrowHeadAt(g.a, g.dirA, size) : null];
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
        {heads.map((h, i) => h && <polygon key={i} points={h.map((q) => `${lx(q.x)},${ly(q.y)}`).join(' ')} fill={color} stroke={color} strokeWidth={1} strokeLinejoin="round" />)}
      </svg>
      {/* beim Bearbeiten zeigt die Overlay-Ebene das Eingabefeld an derselben Stelle */}
      {label && !editing && (
        <div className="conn-label" style={{ transform: `translate(${lx(g.mid.x)}px, ${ly(g.mid.y)}px) translate(-50%, -50%)`, fontSize: labelFs, color }}>
          <T.View o={o} variant="label" className="conn-label-text" />
        </div>
      )}
    </div>
  );
}

/** Auswahl eines Verbinders: Linie nachzeichnen, Griffe an beiden Enden. */
function ConnectorSelection({ o, snap, cam, width, height, hideHandles }: SelectionViewProps) {
  const g = connectorGeometry(o, (id) => snap.byId.get(id));
  if (!g) return null;
  const a = worldToScreen(cam, g.a);
  const b = worldToScreen(cam, g.b);
  return (
    <>
      <svg className="ov-svg" width={width} height={height}>
        <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.z})`}>
          <path d={connectorPath(g)} className="ov-conn-sel" strokeWidth={6 / cam.z} fill="none" />
        </g>
      </svg>
      {!o.locked && !hideHandles && (
        <>
          <div className="ov-end" data-handle="from" style={{ transform: `translate(${a.x}px, ${a.y}px)` }} />
          <div className="ov-end" data-handle="to" style={{ transform: `translate(${b.x}px, ${b.y}px)` }} />
        </>
      )}
    </>
  );
}

defineObjectType({
  type: 'connector',
  label: 'Verbinder',
  View: ConnectorView,
  SelectionView: ConnectorSelection,
  lodPx: null,
  hit: 'none',
  derive: (o, lookup) => {
    const g = connectorGeometry(o, lookup);
    return g ? { bounds: connectorBounds(g), key: connectorPath(g), data: g } : null;
  },
  edit: 'label',
  onEditDone: (o, api) => {
    if (o.text !== undefined && !o.text.trim()) api.store.update(o.id, { text: undefined });
  },
  palette: INK_COLORS,
  defaultColor: '#0a0a0a',
  snapTarget: false,
  marquee: 'contain',
  // beim Skalieren einer Auswahl wandern nur die freien Enden mit
  resize: (o, _base, ctx) => {
    const mp = (p: { x: number; y: number }) => {
      const r = mapRect({ x: p.x, y: p.y, w: 0, h: 0 }, ctx.from, ctx.to);
      return { x: Math.round(r.x), y: Math.round(r.y) };
    };
    const p: Patch = {};
    if (o.from && !isAttached(o.from)) p.from = mp(o.from);
    if (o.to && !isAttached(o.to)) p.to = mp(o.to);
    return p;
  },
});
