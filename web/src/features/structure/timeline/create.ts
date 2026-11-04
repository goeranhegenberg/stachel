// Neue Zeitleiste ohne React (Werkzeug, Vorlagen – auch auf dem Server für die Web-Aktionen der App).
import { defaultRange, fmtDay, layoutOf, sizeFor, type TimelineData, type TlUnit } from './model';

/** Neue Zeitleiste (Werkzeug, Vorlagen) an `p` zentriert. */
export function newTimeline(p: { x: number; y: number }, opts: { unit?: TlUnit; data?: TimelineData; start?: number; end?: number; k?: number } = {}) {
  const unit = opts.unit ?? 'week';
  const r0 = defaultRange(unit);
  const start = opts.start ?? r0.start;
  const end = opts.end ?? r0.end;
  const data = opts.data ?? { lanes: ['l1', 'l2', 'l3'], names: { l1: 'Spur 1', l2: 'Spur 2', l3: 'Spur 3' }, items: {} };
  const L = layoutOf(data, { start, end, days: end - start + 1 }, unit);
  const { w, h } = sizeFor(opts.k ?? 1, L);
  return {
    type: 'timeline' as const,
    x: Math.round(p.x - w / 2),
    y: Math.round(p.y - h / 2),
    w,
    h,
    timeline: data,
    tlStart: fmtDay(start),
    tlEnd: fmtDay(end),
    ...(unit !== 'week' ? { tlUnit: unit } : {}),
  };
}
