// Minimap unten rechts: Übersicht aller Objekte + Sichtbereich. Klick springt dorthin, Ziehen am blauen
// Rechteck verschiebt die Ansicht relativ. Objekte liegen in einem Zwischenspeicher-Canvas, der nur bei neuer
// snap.version oder neuem Kartenausschnitt neu gezeichnet wird – reine Kamerabewegung kopiert nur. Ändert sich der
// Inhalt laufend (Ziehen, fremde Änderungen), zeichnet er höchstens alle REDRAW_MS neu (bei 10 000 Objekten kostet ein
// Durchgang ≈ 8 ms, das fehlte sonst jedem Zieh-Frame); der letzte Stand folgt spätestens REDRAW_MS danach.
import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../board/store';
import { contains, expand, objRect, pointInRect, unionRects, viewRect, type Camera, type Point, type Rect } from '../board/geometry';
import { bezierAt, connectorBounds, connectorGeometry } from '../board/connector';

const W = 208;
const H = 132;
const STORE_KEY = 'stachel.minimap';
/** Mindestabstand zwischen zwei Neuzeichnungen der Objekte, solange sich der Inhalt ständig ändert */
export const REDRAW_MS = 200;

interface MapFrame {
  world: Rect;
  scale: number;
  ox: number;
  oy: number;
}

function readOpen(): boolean {
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (v === 'open') return true;
    if (v === 'closed') return false;
  } catch {
    /* Speicher gesperrt */
  }
  // ohne gespeicherte Wahl: am Handy und in niedrigen Fenstern eingeklappt
  return typeof window === 'undefined' || (window.innerWidth > 700 && window.innerHeight > 640);
}

function contentRect(snap: Snapshot): Rect | null {
  const rects: Rect[] = [];
  const lookup = (id: string) => snap.byId.get(id);
  for (const o of snap.ordered) {
    if (o.type !== 'connector') rects.push(objRect(o));
    else {
      const g = connectorGeometry(o, lookup);
      if (g) rects.push(connectorBounds(g, 0));
    }
  }
  return unionRects(rects);
}

/** Kartenausschnitt: Inhalt + Sicht, mit Rand. Bleibt stehen, solange beides hineinpasst und er nicht viel zu groß ist. */
function nextFrame(prev: MapFrame | null, content: Rect | null, view: Rect): MapFrame {
  const need = unionRects(content ? [content, view] : [view])!;
  if (prev && contains(prev.world, need) && prev.world.w * prev.world.h < need.w * need.h * 4) return prev;
  const world = expand(need, Math.max(need.w, need.h) * 0.06 + 40);
  const scale = Math.min(W / world.w, H / world.h);
  return { world, scale, ox: (W - world.w * scale) / 2, oy: (H - world.h * scale) / 2 };
}

function drawObjects(ctx: CanvasRenderingContext2D, snap: Snapshot, m: MapFrame) {
  const { world, scale, ox, oy } = m;
  const tx = (x: number) => ox + (x - world.x) * scale;
  const ty = (y: number) => oy + (y - world.y) * scale;
  const lookup = (id: string) => snap.byId.get(id);
  const titles: { x: number; y: number; w: number; text: string }[] = [];
  for (const o of snap.ordered) {
    if (o.type === 'connector') continue;
    const r = objRect(o);
    const x = tx(r.x);
    const y = ty(r.y);
    const w = Math.max(1.5, r.w * scale);
    const h = Math.max(1.5, r.h * scale);
    if (o.type === 'frame') {
      ctx.fillStyle = o.color ?? '#ffffff';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(10,10,10,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
      if (w >= 40) titles.push({ x, y, w, text: o.title || 'Rahmen' });
      continue;
    }
    ctx.fillStyle =
      o.type === 'sticky'
        ? (o.color ?? '#fff27a')
        : o.type === 'image'
          ? (o.color ?? '#9a9a94')
          : o.type === 'pen'
            ? (o.color ?? '#0a0a0a')
            : o.type === 'shape' && (o.color ?? '#ffffff').toLowerCase() === '#ffffff'
              ? '#cfcfc8'
              : (o.color ?? '#d8d8d2');
    if (o.type === 'pen' && o.points && o.points.length >= 4 && Math.max(w, h) > 6) {
      // Stiftstrich als Linie statt als gefülltes Rechteck
      const pts = o.points;
      ctx.strokeStyle = o.color ?? '#0a0a0a';
      ctx.lineWidth = Math.max(1, (o.strokeWidth ?? 4) * scale);
      ctx.beginPath();
      ctx.moveTo(tx(o.x + pts[0]), ty(o.y + pts[1]));
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(tx(o.x + pts[i]), ty(o.y + pts[i + 1]));
      ctx.stroke();
      continue;
    }
    if (o.type === 'pen' || o.type === 'text') ctx.globalAlpha = 0.55;
    if (o.type === 'shape' && o.shape === 'ellipse' && w > 4) {
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
  }
  // Verbinder als feine Linien
  ctx.lineWidth = 1;
  for (const o of snap.ordered) {
    if (o.type !== 'connector') continue;
    const g = connectorGeometry(o, lookup);
    if (!g) continue;
    const pts = g.style === 'curved' ? Array.from({ length: 9 }, (_, i) => bezierAt(g.pts, i / 8)) : g.pts;
    ctx.strokeStyle = o.color ?? '#0a0a0a';
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(tx(p.x), ty(p.y)) : ctx.moveTo(tx(p.x), ty(p.y))));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Rahmentitel über dem Rahmen (wie auf dem Board), nur wenn der Rahmen breit genug ist
  ctx.font = '600 9px "Barlow Condensed", Barlow, sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#3a3a36';
  for (const t of titles) {
    const text = fitText(ctx, t.text.toUpperCase(), t.w - 2);
    if (text) ctx.fillText(text, t.x + 1, Math.max(10, t.y - 1));
  }
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  for (let n = text.length - 1; n > 1; n--) {
    const t = `${text.slice(0, n)}…`;
    if (ctx.measureText(t).width <= max) return t;
  }
  return '';
}

export function Minimap({ snap, cam, width, height, onNavigate }: { snap: Snapshot; cam: Camera; width: number; height: number; onNavigate: (p: Point) => void }) {
  const [open, setOpen] = useState(readOpen);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<MapFrame | null>(null);
  const contentRef = useRef<{ version: number; rect: Rect | null }>({ version: -1, rect: null });
  const cacheRef = useRef<{ canvas: HTMLCanvasElement; version: number; frame: MapFrame | null; dpr: number } | null>(null);
  /** Ziehen: Startpunkt (Welt) und Sichtmitte zu Beginn */
  const dragRef = useRef<{ start: Point; center: Point } | null>(null);
  const viewRef = useRef<Rect | null>(null);

  /** Zeitpunkt der letzten Objekt-Neuzeichnung und geplanter Nachzügler (letzter Stand nach einer Änderungsserie) */
  const lastDrawRef = useRef(0);
  const trailRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const propsRef = useRef({ snap, cam, width, height });
  propsRef.current = { snap, cam, width, height };

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const draw = () => {
      const { snap, cam, width, height } = propsRef.current;
      const c = canvasRef.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== W * dpr) {
        c.width = W * dpr;
        c.height = H * dpr;
      }
      let cache = cacheRef.current;
      if (!cache || cache.dpr !== dpr) {
        const off = document.createElement('canvas');
        off.width = W * dpr;
        off.height = H * dpr;
        cache = cacheRef.current = { canvas: off, version: -1, frame: null, dpr };
      }
      // Inhalt geändert: sofort neu zeichnen, wenn die letzte Zeichnung lange genug her ist, sonst den alten Stand
      // weiter zeigen und einen Nachzügler planen
      const stale = cache.version !== snap.version;
      const wait = stale ? lastDrawRef.current + REDRAW_MS - performance.now() : 0;
      if (stale && wait > 0) {
        trailRef.current ??= setTimeout(() => {
          trailRef.current = null;
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(draw);
        }, wait);
      } else if (contentRef.current.version !== snap.version) contentRef.current = { version: snap.version, rect: contentRect(snap) };
      const view = viewRect(cam, width, height);
      viewRef.current = view;
      // Beim Ziehen Maßstab einfrieren, sonst wandert die Karte unter dem Finger weg.
      if (!dragRef.current || !mapRef.current) mapRef.current = nextFrame(mapRef.current, contentRef.current.rect, view);
      const m = mapRef.current;

      // Objekte nur neu zeichnen, wenn sich Inhalt (gedrosselt) oder Ausschnitt geändert haben
      if ((stale && wait <= 0) || cache.frame !== m) {
        const octx = cache.canvas.getContext('2d')!;
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
        octx.clearRect(0, 0, W, H);
        drawObjects(octx, snap, m);
        cache.version = snap.version;
        cache.frame = m;
        lastDrawRef.current = performance.now();
        if (trailRef.current) {
          clearTimeout(trailRef.current);
          trailRef.current = null;
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(cache.canvas, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Sichtbereich
      const vx = m.ox + (view.x - m.world.x) * m.scale;
      const vy = m.oy + (view.y - m.world.y) * m.scale;
      ctx.fillStyle = 'rgba(23,99,181,0.1)';
      ctx.strokeStyle = '#1763b5';
      ctx.lineWidth = 1.5;
      ctx.fillRect(vx, vy, view.w * m.scale, view.h * m.scale);
      ctx.strokeRect(vx, vy, view.w * m.scale, view.h * m.scale);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [open, snap, cam, width, height]);

  // Nachzügler beim Einklappen/Verlassen verwerfen
  useEffect(
    () => () => {
      if (trailRef.current) clearTimeout(trailRef.current);
      trailRef.current = null;
    },
    [open],
  );

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(STORE_KEY, next ? 'open' : 'closed');
    } catch {
      /* Speicher gesperrt – Zustand gilt dann nur bis zum Neuladen */
    }
  };

  const toWorld = (e: React.PointerEvent): Point | null => {
    const m = mapRef.current;
    const c = canvasRef.current;
    if (!m || !c) return null;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left - m.ox) / m.scale + m.world.x, y: (e.clientY - r.top - m.oy) / m.scale + m.world.y };
  };

  return (
    <div className={`minimap panel${open ? '' : ' is-collapsed'}`} onPointerDown={(e) => e.stopPropagation()}>
      {open && (
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          style={{ width: W, height: H }}
          aria-label="Übersichtskarte"
          role="img"
          onPointerDown={(e) => {
            const p = toWorld(e);
            const view = viewRef.current;
            if (!p || !view) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const center = { x: view.x + view.w / 2, y: view.y + view.h / 2 };
            if (pointInRect(p, view)) {
              // am Sichtbereich greifen: relativ verschieben, nichts springt
              dragRef.current = { start: p, center };
            } else {
              // daneben klicken: dorthin springen, dann relativ weiterziehen
              onNavigate(p);
              dragRef.current = { start: p, center: p };
            }
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d) return;
            const p = toWorld(e);
            if (p) onNavigate({ x: d.center.x + p.x - d.start.x, y: d.center.y + p.y - d.start.y });
          }}
          onPointerUp={() => (dragRef.current = null)}
          onPointerCancel={() => (dragRef.current = null)}
        />
      )}
      <button
        type="button"
        className="mm-toggle"
        aria-label={open ? 'Übersicht ausblenden' : 'Übersicht einblenden'}
        aria-expanded={open}
        title={open ? 'Übersicht ausblenden' : 'Übersicht einblenden'}
        onClick={toggle}
      >
        <svg width={open ? 15 : 18} height={open ? 15 : 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {open ? (
            <path d="M6 9l6 6 6-6" />
          ) : (
            <>
              <rect x="3.5" y="5" width="17" height="14" rx="2" />
              <rect x="11" y="10" width="6" height="5" rx="1" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}
