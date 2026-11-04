// Vorschaubilder der Boards: beim Verlassen eines Boards gerendert und lokal gespeichert (localStorage).
// Langfristig gehört das auf den Server (Vorschlag: PUT /api/boards/:id/thumb).
import { useLayoutEffect } from 'react';
import type { BoardObject, ConnectorEnd } from '../protocol';

export const THUMB_W = 280;
export const THUMB_H = 130;
const PREFIX = 'stachel:thumb:';
const INDEX = 'stachel:thumbs';
export const MAX_THUMBS = 30;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readIndex(s: Store): string[] {
  try {
    const v = JSON.parse(s.getItem(INDEX) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function loadThumb(boardId: string, s: Store | null = storage()): string | null {
  try {
    const v = s?.getItem(PREFIX + boardId) ?? null;
    return v && v.startsWith('data:image/') ? v : null;
  } catch {
    return null;
  }
}

/** Speichert (zuletzt benutzt vorne) und hält höchstens MAX_THUMBS Einträge. */
export function saveThumb(boardId: string, dataUrl: string, s: Store | null = storage()) {
  if (!s) return;
  try {
    const ids = [boardId, ...readIndex(s).filter((x) => x !== boardId)];
    for (const old of ids.splice(MAX_THUMBS)) s.removeItem(PREFIX + old);
    s.setItem(PREFIX + boardId, dataUrl);
    s.setItem(INDEX, JSON.stringify(ids));
  } catch {
    // Speicher voll oder gesperrt: ältere Hälfte wegwerfen, Vorschau ist nur Komfort
    try {
      const ids = readIndex(s);
      for (const old of ids.splice(Math.floor(ids.length / 2))) s.removeItem(PREFIX + old);
      s.setItem(INDEX, JSON.stringify(ids));
    } catch {
      /* egal */
    }
  }
}

/**
 * Alle Vorschaubilder löschen (`stachel:thumb:*` und `stachel:thumbs`) – beim Abmelden und Konto löschen, damit auf einem
 * geteilten Rechner keine Board-Inhalte der vorherigen Person im Browser bleiben (docs/legal/datenschutz.md §6, CR-11).
 */
export function clearThumbs(s: (Store & Pick<Storage, 'key' | 'length'>) | null = storage() as Storage | null) {
  if (!s) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && (k.startsWith(PREFIX) || k === INDEX)) keys.push(k);
    }
    for (const id of readIndex(s)) keys.push(PREFIX + id);
    for (const k of new Set(keys)) s.removeItem(k);
  } catch {
    /* Speicher gesperrt: nichts zu tun */
  }
}

export function removeThumb(boardId: string, s: Store | null = storage()) {
  if (!s) return;
  try {
    s.removeItem(PREFIX + boardId);
    s.setItem(INDEX, JSON.stringify(readIndex(s).filter((x) => x !== boardId)));
  } catch {
    /* egal */
  }
}

type Box = { x: number; y: number; w: number; h: number };

function endPoint(end: ConnectorEnd | undefined, byId: Map<string, BoardObject>): { x: number; y: number } | null {
  if (!end) return null;
  if ('objectId' in end) {
    const o = byId.get(end.objectId);
    return o ? { x: o.x + o.w / 2, y: o.y + o.h / 2 } : null;
  }
  return Number.isFinite(end.x) && Number.isFinite(end.y) ? end : null;
}

/** Inhaltsrahmen aller Objekte außer Verbindern. */
export function contentBounds(objects: readonly BoardObject[]): Box | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const o of objects) {
    if (o.type === 'connector' || !Number.isFinite(o.x + o.y + o.w + o.h)) continue;
    x0 = Math.min(x0, o.x);
    y0 = Math.min(y0, o.y);
    x1 = Math.max(x1, o.x + o.w);
    y1 = Math.max(y1, o.y + o.h);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

function shapePath(ctx: CanvasRenderingContext2D, o: BoardObject, w: number, h: number) {
  ctx.beginPath();
  switch (o.shape) {
    case 'ellipse':
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'diamond':
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w, h / 2);
      ctx.lineTo(w / 2, h);
      ctx.lineTo(0, h / 2);
      ctx.closePath();
      break;
    case 'triangle':
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      break;
    default:
      ctx.rect(0, 0, w, h);
  }
}

/** Zeichnet die Board-Übersicht (gleiche Idee wie die Minimap) auf transparentem Grund. */
export function drawThumb(ctx: CanvasRenderingContext2D, objects: readonly BoardObject[], W = THUMB_W, H = THUMB_H) {
  ctx.clearRect(0, 0, W, H);
  const b = contentBounds(objects);
  if (!b) return;
  const pad = 14;
  // nicht über 60 % hineinzoomen, sonst wirkt eine einzelne Notiz riesig
  const scale = Math.min((W - pad * 2) / b.w, (H - pad * 2) / b.h, 0.6);
  const ox = (W - b.w * scale) / 2 - b.x * scale;
  const oy = (H - b.h * scale) / 2 - b.y * scale;
  const byId = new Map(objects.map((o) => [o.id, o]));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const o of objects) {
    const x = ox + o.x * scale;
    const y = oy + o.y * scale;
    const w = Math.max(1.5, o.w * scale);
    const h = Math.max(1.5, o.h * scale);
    ctx.save();
    if (o.type === 'connector') {
      const a = endPoint(o.from, byId);
      const e = endPoint(o.to, byId);
      if (a && e) {
        ctx.strokeStyle = o.color ?? 'rgba(10,10,10,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ox + a.x * scale, oy + a.y * scale);
        ctx.lineTo(ox + e.x * scale, oy + e.y * scale);
        ctx.stroke();
      }
      ctx.restore();
      continue;
    }
    if (o.rotation) {
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate((o.rotation * Math.PI) / 180);
      ctx.translate(-w / 2, -h / 2);
    } else ctx.translate(x, y);
    switch (o.type) {
      case 'frame':
        ctx.fillStyle = o.color ?? '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(10,10,10,0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
        break;
      case 'sticky':
        ctx.fillStyle = 'rgba(10,10,10,0.12)';
        ctx.fillRect(0.8, 1.4, w, h);
        ctx.fillStyle = o.color ?? '#fff27a';
        ctx.fillRect(0, 0, w, h);
        if (w > 14 && o.text) {
          ctx.fillStyle = 'rgba(10,10,10,0.3)';
          ctx.fillRect(w * 0.18, h * 0.38, w * 0.64, Math.max(1, h * 0.07));
          ctx.fillRect(w * 0.18, h * 0.54, w * 0.42, Math.max(1, h * 0.07));
        }
        break;
      case 'shape':
        shapePath(ctx, o, w, h);
        ctx.fillStyle = o.color ?? '#ffffff';
        ctx.fill();
        if (o.strokeWidth !== 0) {
          ctx.strokeStyle = o.stroke ?? '#0a0a0a';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        break;
      case 'text':
        ctx.fillStyle = o.color ?? '#0a0a0a';
        ctx.globalAlpha = 0.55;
        ctx.fillRect(0, h * 0.25, w, Math.max(1.2, Math.min(h * 0.5, 5)));
        break;
      case 'image':
        ctx.fillStyle = '#b9b9b2';
        ctx.fillRect(0, 0, w, h);
        break;
      case 'pen': {
        const p = o.points ?? [];
        if (p.length >= 4) {
          ctx.strokeStyle = o.color ?? '#0a0a0a';
          ctx.lineWidth = Math.max(0.8, (o.strokeWidth ?? 4) * scale);
          ctx.beginPath();
          ctx.moveTo(p[0] * scale, p[1] * scale);
          for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(p[i] * scale, p[i + 1] * scale);
          ctx.stroke();
        }
        break;
      }
      default:
        // Typen aus Feature-Modulen: Fläche in der Objektfarbe
        ctx.fillStyle = o.color ?? '#d8d8d2';
        ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }
}

/** Vorschaubild als PNG-Data-URL (doppelte Auflösung für scharfe Displays). */
export function renderThumb(objects: readonly BoardObject[]): string | null {
  try {
    const c = document.createElement('canvas');
    c.width = THUMB_W * 2;
    c.height = THUMB_H * 2;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.scale(2, 2);
    drawThumb(ctx, objects);
    return c.toDataURL('image/png');
  } catch {
    return null;
  }
}

interface ThumbSource {
  store: { getSnapshot(): { ordered: readonly BoardObject[] } };
  subscribe(fn: () => void): () => void;
  getStatus(): string;
}

/**
 * Speichert beim Verlassen des Boards (Unmount, Tab zu) ein Vorschaubild.
 * Erst nach der ersten erfolgreichen Synchronisierung, sonst würde ein noch leeres Board
 * ein gutes Vorschaubild überschreiben.
 */
export function useThumbCapture(boardId: string | undefined, session: ThumbSource | null) {
  useLayoutEffect(() => {
    if (!boardId || !session) return;
    let synced = session.getStatus() === 'connected';
    const unsub = session.subscribe(() => {
      if (session.getStatus() === 'connected') synced = true;
    });
    const save = () => {
      if (!synced) return;
      const url = renderThumb(session.store.getSnapshot().ordered);
      if (url) saveThumb(boardId, url);
    };
    const onHide = () => save();
    window.addEventListener('pagehide', onHide);
    return () => {
      unsub();
      window.removeEventListener('pagehide', onHide);
      save();
    };
  }, [boardId, session]);
}
