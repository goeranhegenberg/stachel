// Sticker (Emoji und Stempel) und Icons als eigene Objekte, dazu das Sticker-Werkzeug (Stempel bleiben aktiv).
import { createElement, type CSSProperties } from 'react';
import type { BoardObject } from '../../protocol';
import { INK_COLORS } from '../../board/colors';
import type { NewObject } from '../../board/store';
import type { Point } from '../../board/geometry';
import { defineContextAction, defineObjectType, defineTool } from '../../editor/ext/registry';
import { getToolOption, setToolOption, useToolOption } from '../../editor/ext/toolOptions';
import type { EditorApi, ObjectViewProps } from '../../editor/ext/types';
import { tapGesture } from '../../editor/core/tools';
import { placeStyle } from '../../editor/render/format';
import { recentEmoji, rememberEmoji } from './emoji';
import type { IconNode } from './model';
import { stampById, StampSvg, STAMPS } from './stamps';

const CORNERS = ['nw', 'ne', 'se', 'sw'] as const;

// ---- Icon-Zeichnung absichern (kommt aus dem geteilten Dokument) ------------------------------------------------------

const TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);
const ATTRS = new Set(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points']);

/** Nur einfache SVG-Formen mit Geometrie-Attributen; alles andere fällt weg. */
export function safeIconNode(node: unknown): IconNode {
  if (!Array.isArray(node)) return [];
  const out: IconNode = [];
  for (const item of node.slice(0, 40)) {
    if (!Array.isArray(item) || typeof item[0] !== 'string' || !TAGS.has(item[0])) continue;
    const attrs: Record<string, string | number> = {};
    const raw = item[1] && typeof item[1] === 'object' ? (item[1] as Record<string, unknown>) : {};
    for (const [k, v] of Object.entries(raw)) {
      // Füllung nur als Strichfarbe oder keine (lucide füllt kleine Punkte mit currentColor)
      if (k === 'fill' && (v === 'currentColor' || v === 'none')) attrs[k] = v;
      if (!ATTRS.has(k)) continue;
      if (typeof v === 'number' && Number.isFinite(v)) attrs[k] = v;
      else if (typeof v === 'string' && v.length < 4000 && /^[\d\s.,+\-eEMmLlHhVvCcSsQqTtAaZz]*$/.test(v)) attrs[k] = v;
    }
    out.push([item[0], attrs]);
  }
  return out;
}

export function IconGlyph({ node, color, width = 2, size = '100%' }: { node: unknown; color: string; width?: number; size?: number | string }) {
  const safe = safeIconNode(node);
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" style={{ color }} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {safe.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}

// ---- Platzieren ---------------------------------------------------------------------------------------------------------

export type PlaceItem = { kind: 'stamp'; id: string } | { kind: 'emoji'; ch: string } | { kind: 'icon'; name: string; label: string; node: IconNode };

export const STAMP_SIZE = 72;
export const EMOJI_SIZE = 96;
export const ICON_SIZE = 64;

export function objectFor(item: PlaceItem, p: Point): NewObject {
  if (item.kind === 'stamp') return { type: 'sticker', stamp: item.id, x: Math.round(p.x - STAMP_SIZE / 2), y: Math.round(p.y - STAMP_SIZE / 2), w: STAMP_SIZE, h: STAMP_SIZE };
  if (item.kind === 'emoji') return { type: 'sticker', emoji: item.ch, x: Math.round(p.x - EMOJI_SIZE / 2), y: Math.round(p.y - EMOJI_SIZE / 2), w: EMOJI_SIZE, h: EMOJI_SIZE };
  return { type: 'icon', icon: item.name, iconNode: item.node, color: '#0a0a0a', x: Math.round(p.x - ICON_SIZE / 2), y: Math.round(p.y - ICON_SIZE / 2), w: ICON_SIZE, h: ICON_SIZE };
}

/** Objekt anlegen: Stempel ohne Werkzeugwechsel (mehrfach stempeln), Emoji/Icon ausgewählt. */
export function place(api: EditorApi, item: PlaceItem, p: Point, keepTool = item.kind === 'stamp') {
  if (item.kind === 'emoji') rememberEmoji(item.ch);
  const obj = objectFor(item, p);
  if (keepTool) {
    api.store.stopCapturing();
    api.store.create(obj);
    api.store.stopCapturing();
  } else api.create(obj, { select: true });
}

export const currentItem = (): PlaceItem => getToolOption<PlaceItem>('shapes.sticker', 'item', { kind: 'stamp', id: 'like' });

/** Gegenstand fürs Sticker-Werkzeug wählen und das Werkzeug aktivieren. */
export function armSticker(api: EditorApi, item: PlaceItem) {
  setToolOption('shapes.sticker', 'item', item);
  api.setTool('shapes.sticker');
}

export function ItemPreview({ item, size = 26 }: { item: PlaceItem; size?: number }) {
  if (item.kind === 'stamp') return <StampSvg id={item.id} size={size} />;
  if (item.kind === 'emoji') return <span className="shapes-emoji" style={{ fontSize: size * 0.86 }}>{item.ch}</span>;
  return <IconGlyph node={item.node} color="currentColor" size={size} />;
}

// ---- Sticker --------------------------------------------------------------------------------------------------------------

function StickerView({ o }: ObjectViewProps) {
  const style: CSSProperties = o.emoji ? { fontSize: Math.min(o.w, o.h) * 0.84 } : {};
  return (
    <div className={`obj shapes-sticker${o.stamp ? ' shapes-sticker--stamp' : ''}`} data-id={o.id} data-type="sticker" style={placeStyle(o, style)}>
      {o.emoji ? <span className="shapes-emoji">{o.emoji}</span> : <StampSvg id={o.stamp} />}
    </div>
  );
}

const stickerName = (o: Pick<BoardObject, 'emoji' | 'stamp'>) => o.emoji ?? stampById(o.stamp)?.label ?? 'Sticker';

defineObjectType({
  type: 'sticker',
  label: 'Sticker',
  View: StickerView,
  simpleStyle: (o) => ({ background: o.emoji ? '#ffd23f' : (stampById(o.stamp)?.bg ?? '#1763b5'), borderRadius: '50%' }),
  lodPx: 14,
  defaultSize: { w: STAMP_SIZE, h: STAMP_SIZE },
  create: (p) => objectFor(currentItem(), p),
  plainText: stickerName,
  colorable: false,
  rotatable: true,
  anchorable: true,
  handles: () => [...CORNERS],
  keepAspect: true,
});

// ---- Icon -----------------------------------------------------------------------------------------------------------------

function IconView({ o }: ObjectViewProps) {
  return (
    <div className="obj shapes-iconobj" data-id={o.id} data-type="icon" style={placeStyle(o)}>
      <IconGlyph node={o.iconNode} color={o.color ?? '#0a0a0a'} width={o.strokeWidth ?? 2} />
    </div>
  );
}

defineObjectType({
  type: 'icon',
  label: 'Icon',
  View: IconView,
  simpleStyle: (o) => ({ background: o.color ?? '#0a0a0a', opacity: 0.22, borderRadius: '22%' }),
  lodPx: 14,
  defaultSize: { w: ICON_SIZE, h: ICON_SIZE },
  plainText: (o) => o.icon,
  palette: INK_COLORS,
  defaultColor: '#0a0a0a',
  rotatable: true,
  anchorable: true,
  handles: () => [...CORNERS],
  keepAspect: true,
});

const ICON_WIDTHS = [1, 1.5, 2, 2.5, 3];

defineContextAction({
  id: 'shapes.iconStroke',
  order: 55,
  when: (c) => !c.locked && c.types.size === 1 && c.types.has('icon'),
  Bar: ({ first, patch }) => (
    <div className="ctx-group" aria-label="Strichstärke">
      {ICON_WIDTHS.map((w) => (
        <button key={w} className={`ctx-btn${(first.strokeWidth ?? 2) === w ? ' is-active' : ''}`} aria-label={`Strichstärke ${String(w).replace('.', ',')}`} title={`Strich ${String(w).replace('.', ',')}`} onClick={() => patch(() => ({ strokeWidth: w === 2 ? undefined : w }))}>
          <span className="width-dot" style={{ width: w * 3 + 2, height: w * 3 + 2 }} />
        </button>
      ))}
    </div>
  ),
});

// ---- Werkzeug „Sticker“ ---------------------------------------------------------------------------------------------------

/** Werkzeug-Symbol: Aufkleber mit umgeschlagener Ecke und Lächeln. */
function IconStickerTool() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 13.5V6.5A2.5 2.5 0 0 0 17.5 4h-11A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h7Z" />
      <path d="M13.5 20v-4a2.5 2.5 0 0 1 2.5-2.5h4" />
      <path d="M8.5 12.5c.7 1 1.7 1.5 2.8 1.5" />
      <path d="M9 9h.01M14 9h.01" strokeWidth="2.6" />
    </svg>
  );
}

function StickerOptions({ api }: { api: EditorApi }) {
  const [item, setItem] = useToolOption<PlaceItem>('shapes.sticker', 'item', { kind: 'stamp', id: 'like' });
  const isOn = (i: PlaceItem) => JSON.stringify(i) === JSON.stringify(item);
  return (
    <div className="shapes-fly-grid shapes-fly-grid--stickers">
      {STAMPS.map((s) => {
        const i: PlaceItem = { kind: 'stamp', id: s.id };
        return (
          <button key={s.id} className={`fly-btn shapes-fly-stamp${isOn(i) ? ' is-active' : ''}`} aria-label={`Stempel ${s.label}`} title={s.label} onClick={() => setItem(i)}>
            <StampSvg id={s.id} size={26} />
          </button>
        );
      })}
      {recentEmoji()
        .slice(0, 4)
        .map((ch) => {
          const i: PlaceItem = { kind: 'emoji', ch };
          return (
            <button key={ch} className={`fly-btn${isOn(i) ? ' is-active' : ''}`} aria-label={`Emoji ${ch}`} title={ch} onClick={() => setItem(i)}>
              <span className="shapes-emoji" style={{ fontSize: 21 }}>
                {ch}
              </span>
            </button>
          );
        })}
      {item.kind === 'icon' && (
        <button className="fly-btn is-active" aria-label={`Icon ${item.label}`} title={item.label}>
          <IconGlyph node={item.node} color="currentColor" size={22} />
        </button>
      )}
      <button
        className="fly-btn shapes-fly-more"
        aria-label="Alle Sticker und Icons"
        title="Alle Sticker und Icons"
        onClick={() => {
          setToolOption('shapes.library', 'tab', 'stickers');
          api.openSidebar('shapes.library');
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
      </button>
    </div>
  );
}

defineTool({
  id: 'shapes.sticker',
  label: 'Sticker',
  hint: 'Sticker, Stempel und Icons',
  order: 85,
  phone: 'more',
  Icon: IconStickerTool,
  Options: StickerOptions,
  cursor: 'copy',
  down: (e, api) => {
    const item = currentItem();
    if (e.pointerType === 'touch') return tapGesture(e, () => place(api, item, e.world));
    place(api, item, e.world);
  },
});
