// Gemeinsame Bausteine der Collab-Oberfläche: Avatar, schwebende Fläche über dem Board, Kamera-Sprung, Bezeichnung.
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { BoardObject } from '../../protocol';
import { initials, userColor } from '../../board/colors';
import type { Point } from '../../board/geometry';
import type { EditorApi } from '../../editor/ext/types';
import { shapeKinds, typeDef } from '../../editor/ext/registry';

export function Avatar({ k, name, size = 'm', title, status }: { k: string; name: string; size?: 's' | 'm' | 'l'; title?: string; status?: string }) {
  return (
    <span className={`collab-av collab-av--${size}`} style={{ background: userColor(k) }} title={title} aria-hidden={title ? undefined : true}>
      {initials(name)}
      {status && <i className={`collab-dot collab-dot--${status}`} />}
    </span>
  );
}

/** Name eines Objekttyps für Menschen („Haftnotiz“, bei Formen die Form). */
export function typeLabel(o: BoardObject): string {
  if (o.type === 'shape') return shapeKinds.get(o.shape ?? 'rect')?.label ?? 'Form';
  return typeDef(o).label ?? 'Objekt';
}

/** Kamera weich auf einen Weltpunkt richten (mindestens `minZoom`). */
export function flyTo(api: EditorApi, p: Point, minZoom = 0.5, offsetX = 0) {
  const c = api.camera();
  const { w, h } = api.viewSize();
  const z = Math.max(c.z, minZoom);
  api.animateCamera({ z, x: w / 2 + offsetX - p.x * z, y: h / 2 - p.y * z });
}

/**
 * Fläche über dem Board, die Zeiger, Doppelklick, Kontextmenü und Mausrad nicht an den Editor weitergibt
 * (sonst startet er eine Geste bzw. zoomt).
 */
export function Floating({
  className,
  style,
  children,
  label,
  role = 'dialog',
  onKeyDown,
  boxRef,
}: {
  className: string;
  style?: CSSProperties;
  children: ReactNode;
  label?: string;
  role?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  boxRef?: RefObject<HTMLDivElement | null>;
}) {
  const wheel = useCallback(
    (el: HTMLDivElement | null) => {
      if (boxRef) boxRef.current = el;
      if (!el) return;
      el.addEventListener('wheel', (e) => {
        if (!e.ctrlKey) e.stopPropagation();
      });
    },
    [boxRef],
  );
  return (
    <div
      ref={wheel}
      className={className}
      style={style}
      role={role}
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}

/** Popover neben einem Bildschirmpunkt platzieren, im sichtbaren Bereich halten. */
export function usePlacement(at: Point, width: number, height: number, w = 330, gap = 46) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(240);
  useLayoutEffect(() => {
    if (ref.current) setH(ref.current.offsetHeight);
  });
  const right = at.x + gap + w <= width - 8;
  // rechts neben dem Pin (er ragt nach rechts), sonst links davon
  const x = right ? at.x + gap : Math.max(8, at.x - 12 - w);
  const y = Math.max(72, Math.min(at.y - 40, height - h - 12));
  return { ref, style: { transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)`, width: w } as CSSProperties };
}
