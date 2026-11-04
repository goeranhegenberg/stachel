// Vorschaubild für die Board-Übersicht: im Browser aus dem Board gerendert (wie der Export) und per
// PUT /api/boards/:id/thumbnail gespeichert – nach einer Ruhepause und beim Verlassen des Boards.
import { useEffect } from 'react';
import type { BoardObject } from '../../protocol';
import type { Snapshot } from '../../board/store';
import { expand, unionRects, type Rect } from '../../board/geometry';
import { CSRF_HEADER } from '../../protocol';
import type { EditorApi, SlotProps } from '../../editor/ext/types';
import { getSettings } from './settings';
import { currentBoardId } from './util';

/** Pixelmaße des Vorschaubilds (doppelte Auflösung der Karte 280 × 130) */
export const THUMB_W = 560;
export const THUMB_H = 260;
/** Ruhepause nach der letzten Änderung und Mindestabstand zwischen zwei Uploads */
const IDLE_MS = 4000;
const MIN_GAP_MS = 30_000;

/** Höhe des Rahmentitels über dem Rahmen im Vorschaubild (px im Bild, Titel steht außerhalb der Rahmengrenzen). */
const FRAME_TITLE_PX = 24;
/** … und mindestens so viel in Board-Einheiten (Titel in normaler Größe) */
const FRAME_TITLE_MIN = 30;

/**
 * Ausschnitt: Inhalt mit Rand, auf das Seitenverhältnis der Karte erweitert. Rahmen tragen ihren Titel oberhalb
 * ihrer Grenzen: `titleSpace` (Board-Einheiten) kommt bei ihnen oben dazu, sonst wäre der Titel abgeschnitten.
 */
export function thumbRect(objects: readonly BoardObject[], bounds: (o: BoardObject) => Rect | null, titleSpace = 0): Rect | null {
  const withTitle = (o: BoardObject): Rect | null => {
    const b = bounds(o);
    return b && o.type === 'frame' && titleSpace > 0 ? { x: b.x, y: b.y - titleSpace, w: b.w, h: b.h + titleSpace } : b;
  };
  const r = unionRects(objects.map(withTitle).filter((b): b is Rect => !!b));
  if (!r) return null;
  const p = expand(r, Math.max(24, Math.max(r.w, r.h) * 0.04));
  const aspect = THUMB_W / THUMB_H;
  if (p.w / p.h > aspect) {
    const h = p.w / aspect;
    return { x: p.x, y: p.y - (h - p.h) / 2, w: p.w, h };
  }
  const w = p.h * aspect;
  return { x: p.x - (w - p.w) / 2, y: p.y, w, h: p.h };
}

/** Vorschaubild rendern (WebP, sonst PNG); null bei leerem Board. */
export async function renderThumbnail(api: EditorApi, snap: Snapshot = api.snapshot(), background = getSettings(api).color): Promise<Blob | null> {
  const objects = snap.ordered.filter((o) => !o.hidden);
  const bounds = (o: BoardObject) => api.bounds(o);
  // Titelhöhe hängt vom Maßstab ab und der vom Ausschnitt: einmal schätzen, dann mit dem echten Maßstab nachrechnen
  const first = thumbRect(objects, bounds, FRAME_TITLE_MIN);
  if (!first) return null;
  const rect = thumbRect(objects, bounds, Math.max(FRAME_TITLE_MIN, (FRAME_TITLE_PX * first.w) / THUMB_W))!;
  const { canvasToBlob, renderToCanvas } = await import('./export/render');
  const canvas = await renderToCanvas({
    objects,
    byId: snap.byId,
    rect,
    scale: THUMB_W / rect.w,
    background,
    imageSrc: (id) => api.session.imageSrc(id),
  });
  // Safari kann kein WebP schreiben und liefert dann PNG – beides nimmt der Server
  return canvasToBlob(canvas, 'image/webp', 0.86);
}

/** Hochladen; meldet den neuen Stand an die Übersicht (Ereignis `stachel:thumbnail`). */
export async function uploadThumbnail(boardId: string, blob: Blob): Promise<string | null> {
  const res = await fetch(`/api/boards/${encodeURIComponent(boardId)}/thumbnail`, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'image/png', [CSRF_HEADER]: '1' },
    body: blob,
    credentials: 'same-origin',
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { thumbnailAt?: string } | null;
  const at = data?.thumbnailAt ?? null;
  if (at) window.dispatchEvent(new CustomEvent('stachel:thumbnail', { detail: { boardId, thumbnailAt: at } }));
  return at;
}

/**
 * Overlay-Slot ohne Darstellung: lädt nach Änderungen (4 s Ruhe, höchstens alle 30 s) und beim Verlassen ein neues
 * Vorschaubild hoch. Erst nach der ersten Synchronisierung, damit ein noch leeres Board nichts überschreibt.
 */
export function ThumbnailUploader({ api }: SlotProps) {
  useEffect(() => {
    const boardId = currentBoardId();
    if (!boardId || api.session.isLocal) return;
    let dirty = false;
    let busy = false;
    let last = 0;
    let timer = 0;
    let synced = api.session.getStatus() === 'connected';

    const run = async () => {
      if (!dirty || busy || !synced) return;
      const wait = last + MIN_GAP_MS - Date.now();
      if (wait > 0) {
        timer = window.setTimeout(run, wait);
        return;
      }
      busy = true;
      dirty = false;
      last = Date.now();
      try {
        const blob = await renderThumbnail(api);
        if (blob) await uploadThumbnail(boardId, blob);
      } catch {
        // Vorschau ist nur Komfort
      } finally {
        busy = false;
      }
    };
    const schedule = (ms = IDLE_MS) => {
      clearTimeout(timer);
      timer = window.setTimeout(run, ms);
    };
    // nach dem ersten Sync einmal erzeugen (auch für ältere Boards ohne Vorschau)
    const onSynced = () => {
      synced = true;
      dirty = true;
      schedule(1500);
    };
    const unStatus = api.session.subscribe(() => {
      if (!synced && api.session.getStatus() === 'connected') onSynced();
    });
    if (synced) onSynced();
    const unStore = api.store.subscribe(() => {
      dirty = true;
      schedule();
    });
    return () => {
      unStatus();
      unStore();
      clearTimeout(timer);
      // beim Verlassen: letzten Stand sichern (Rendern braucht das DOM, das jetzt noch da ist)
      if (dirty && synced) {
        const snap = api.store.getSnapshot();
        const color = getSettings(api).color;
        void renderThumbnail(api, snap, color)
          .then((blob) => blob && uploadThumbnail(boardId, blob))
          .catch(() => {});
      }
    };
  }, [api]);
  return null;
}
