// Laserpointer: Werkzeug (Zeiger gedrückt halten), verblassende Spur – eigene und die der anderen (Awareness).
import { useEffect, useRef, useState } from 'react';
import { worldToScreen } from '../../board/geometry';
import type { EditorApi, SlotProps, ToolGesture, ToolPointerEvent } from '../../editor/ext/types';
import { AW_LASER } from './model';
import { LASER_LIFE, LaserReceiver, LaserSender, trailSegments, type TrailPoint } from './laser';
import { uiOf, usePeers } from './ui';

const senders = new WeakMap<object, LaserSender>();
let clearTimer = 0;

/** Werkzeug-Geste: Punkte senden, solange gedrückt. */
export function laserDown(e: ToolPointerEvent, api: EditorApi): ToolGesture {
  let s = senders.get(api.store);
  if (!s) senders.set(api.store, (s = new LaserSender()));
  const sender = s;
  const ui = uiOf(api.store);
  sender.begin();
  const add = (p: { x: number; y: number }, gap: boolean) => {
    api.session.setLocalField(AW_LASER, sender.add(p));
    ui.laser.set((pts) => [...pts.filter((q) => q.t > performance.now() - LASER_LIFE), { x: p.x, y: p.y, t: performance.now(), gap }]);
  };
  add(e.world, true);
  clearTimeout(clearTimer);
  return {
    kind: 'laser',
    move: (m) => add(m.world, false),
    up: () => {
      // nach dem Verblassen nichts mehr mitsenden
      clearTimer = window.setTimeout(() => api.session.setLocalField(AW_LASER, null), LASER_LIFE + 600);
    },
    cancel: () => api.session.setLocalField(AW_LASER, null),
  };
}

/** Slot (overlay, auch in der Präsentation): Spuren zeichnen. */
export function LaserLayer({ api, cam, width, height }: SlotProps) {
  const ui = uiOf(api.store);
  const peers = usePeers(api);
  const receivers = useRef(new Map<number, LaserReceiver>());
  const [, setTick] = useState(0);
  const raf = useRef(0);

  const own = ui.laser.get();
  // neue Punkte der anderen übernehmen
  useEffect(() => {
    const now = performance.now();
    const alive = new Set<number>();
    for (const p of peers) {
      alive.add(p.clientId);
      const msg = p.extra[AW_LASER];
      if (!msg) continue;
      let r = receivers.current.get(p.clientId);
      if (!r) receivers.current.set(p.clientId, (r = new LaserReceiver()));
      if (r.take(msg, now)) setTick((t) => t + 1);
    }
    for (const id of receivers.current.keys()) if (!alive.has(id)) receivers.current.delete(id);
  }, [peers]);
  useEffect(() => ui.laser.subscribe(() => setTick((t) => t + 1)), [ui]);

  // Verblassen animieren, solange Punkte da sind
  const now = performance.now();
  const others = [...receivers.current.entries()].map(([id, r]) => {
    r.prune(now);
    return { id, pts: r.points };
  });
  const active = own.some((p) => now - p.t < LASER_LIFE) || others.some((o) => o.pts.length > 0);
  useEffect(() => {
    if (!active) return;
    raf.current = requestAnimationFrame(() => setTick((t) => t + 1));
    return () => cancelAnimationFrame(raf.current);
  });
  if (!active) return null;

  // Kein Namensschild am Laser: Der Mauszeiger der Person (mit Namen) sitzt ohnehin an der Laserspitze.
  const draw = (pts: readonly TrailPoint[], key: string, color: string) => {
    const segs = trailSegments(pts, now);
    const head = pts[pts.length - 1];
    const hs = head && now - head.t < LASER_LIFE ? worldToScreen(cam, head) : null;
    return (
      <g key={key} data-laser={key}>
        {segs.map((s, i) => {
          const a = worldToScreen(cam, s.a);
          const b = worldToScreen(cam, s.b);
          return (
            <g key={i} opacity={s.alpha}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeOpacity={0.28} strokeWidth={12} strokeLinecap="round" />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={4} strokeLinecap="round" />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#fff" strokeOpacity={0.85} strokeWidth={1.4} strokeLinecap="round" />
            </g>
          );
        })}
        {hs && (
          <circle cx={hs.x} cy={hs.y} r={7} fill={color} stroke="#fff" strokeWidth={2} />
        )}
      </g>
    );
  };

  return (
    <svg className="collab-laser" width={width} height={height} aria-hidden="true">
      {own.length > 0 && draw(own, 'me', '#ff2d55')}
      {others.map((o) => (o.pts.length ? draw(o.pts, String(o.id), '#ff2d55') : null))}
    </svg>
  );
}
