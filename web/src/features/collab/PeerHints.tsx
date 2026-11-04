// Kleine Live-Hinweise auf dem Board: Bilder, die andere gerade hochladen (als Platzhalter), und der Name
// der Person, die eine Haftnotiz angelegt hat (beim Überfahren mit der Maus bzw. mit der Board-Einstellung „Autor:in an
// Haftnotizen zeigen“ dauerhaft an jeder Notiz).
import { useEffect, useRef, useState } from 'react';
import { worldToScreen, type Point } from '../../board/geometry';
import type { SlotProps } from '../../editor/ext/types';
import { useBoardSettings } from '../tools/settings';
import { authorLabels } from './authorLabels';
import { AW_UPLOADS } from './model';
import { usePeers, usePeople } from './ui';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

interface RemoteUpload {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string | null;
}

/** Awareness-Feld `collab.uploads` einer anderen Person lesen (fremde Daten: streng prüfen, höchstens 10). */
export function readUploads(v: unknown): RemoteUpload[] {
  if (!Array.isArray(v)) return [];
  const out: RemoteUpload[] = [];
  for (const u of v.slice(0, 10)) {
    if (!u || typeof u !== 'object') continue;
    const { x, y, w, h, color } = u as Record<string, unknown>;
    if (![x, y, w, h].every(isNum) || (w as number) <= 0 || (h as number) <= 0 || (w as number) > 1e5 || (h as number) > 1e5) continue;
    out.push({ x: x as number, y: y as number, w: w as number, h: h as number, color: typeof color === 'string' && /^#[0-9a-f]{3,8}$/i.test(color) ? color : null });
  }
  return out;
}

/** Slot (overlay): Upload-Platzhalter der anderen. Der eigene zeichnet der Editor (Awareness: AW_UPLOADS). */
export function PeerUploads({ api, cam, width, height }: SlotProps) {
  const peers = usePeers(api);
  const items: React.ReactNode[] = [];
  for (const p of peers) {
    readUploads(p.extra[AW_UPLOADS]).forEach((u, i) => {
      const a = worldToScreen(cam, { x: u.x, y: u.y });
      const w = u.w * cam.z;
      const h = u.h * cam.z;
      if (a.x > width || a.y > height || a.x + w < 0 || a.y + h < 0) return;
      items.push(
        <div
          key={`${p.clientId}-${i}`}
          className="upload-ph collab-upload-ph"
          role="status"
          style={{ transform: `translate(${a.x}px, ${a.y}px)`, width: w, height: h, background: u.color ?? undefined, ['--ring' as string]: p.user.color }}
        >
          <span>{p.user.name.split(' ')[0]} lädt hoch …</span>
        </div>,
      );
    });
  }
  if (!items.length) return null;
  return <div className="collab-layer">{items}</div>;
}

/** Verzögerung, bis der Name erscheint (kein Flackern beim Drüberfahren). */
export const AUTHOR_DELAY_MS = 600;

/**
 * Slot (overlay): Beim Überfahren einer Haftnotiz mit der Maus erscheint nach kurzer Zeit unten rechts, wer sie
 * angelegt hat („Autor anzeigen“). Nicht bei Touch, beim Ziehen, Bearbeiten oder mit anderem Werkzeug.
 */
export function AuthorHover({ api, cam, snap }: SlotProps) {
  const people = usePeople(api, []);
  const always = useBoardSettings(api).authors;
  const [hover, setHover] = useState<string | null>(null);
  const timer = useRef(0);
  const last = useRef<string | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      const board = t?.closest?.('.board') as HTMLElement | null;
      let id: string | null = null;
      if (e.pointerType === 'mouse' && e.buttons === 0 && board && !t?.closest('.panel, .collab-pop, .ctxbar, .modal') && api.tool() === 'select') {
        const r = board.getBoundingClientRect();
        const p: Point = api.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
        const o = api.hitTest(p);
        if (o?.type === 'sticky' && o.createdBy && api.editingId() !== o.id) id = o.id;
      }
      if (id === last.current) return;
      last.current = id;
      clearTimeout(timer.current);
      setHover(null);
      if (id) timer.current = window.setTimeout(() => setHover(id), AUTHOR_DELAY_MS);
    };
    const leave = () => {
      last.current = null;
      clearTimeout(timer.current);
      setHover(null);
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', leave, true);
    window.addEventListener('wheel', leave, { passive: true });
    document.addEventListener('pointerleave', leave);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', leave, true);
      window.removeEventListener('wheel', leave);
      document.removeEventListener('pointerleave', leave);
    };
  }, [api]);

  const o = hover ? snap.byId.get(hover) : undefined;
  // mit „Autor:in an Haftnotizen zeigen“ steht der Name schon an jeder Notiz
  if (!o || always || api.presenting() || api.editingId() === o.id) return null;
  const me = api.session.user;
  const name = o.createdBy === me.key ? 'dir' : (people.find((p) => p.key === o.createdBy)?.name ?? null);
  if (!name) return null;
  const s = worldToScreen(cam, { x: o.x + o.w, y: o.y + o.h });
  if (o.w * cam.z < 60) return null;
  return (
    <div className="collab-layer">
      <span className="collab-author" style={{ transform: `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-100%, -100%)` }} data-testid="note-author">
        von {name}
      </span>
    </div>
  );
}

/**
 * Slot (overlay): Board-Einstellung „Autor:in an Haftnotizen zeigen“ (für alle) – an jeder Haftnotiz im Bild klein unten
 * links, wer sie angelegt hat (echter Name, auch der eigene). Nicht beim Präsentieren (Slot ohne `presenting`) und nicht
 * an der Notiz, in der gerade geschrieben wird; erst ab 60 px Notizbreite.
 */
export function AuthorLabels({ api, cam, snap, width, height }: SlotProps) {
  const on = useBoardSettings(api).authors;
  const people = usePeople(api, []);
  if (!on || api.presenting()) return null;
  const me = api.session.user;
  const names = new Map(people.map((p) => [p.key, p.name]));
  const labels = authorLabels(snap, cam, width, height, (key) => (key === me.key ? me.name : (names.get(key) ?? null)), api.editingId());
  if (!labels.length) return null;
  return (
    <div className="collab-layer" data-testid="note-authors">
      {labels.map((l) => (
        <span key={l.id} className="collab-author-label" style={{ transform: `translate(${l.x}px, ${l.y}px) translate(0, -100%)`, maxWidth: l.maxW }} data-note={l.id}>
          {l.name}
        </span>
      ))}
    </div>
  );
}
