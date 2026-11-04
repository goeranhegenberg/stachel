// Leichte SVG-Vorschau einer Zeitleiste (Vorlagen-Galerie, Rahmen-Liste): Kopf, Spuren, Balken und Meilensteine.
import type { ReactNode } from 'react';
import type { BoardObject } from '../../../protocol';
import { textOn } from '../../../board/colors';
import { DEFAULT_ITEM_COLOR, DIAMOND, HEAD_H, LABEL_W, layoutFor, todayNum } from './model';

export function timelinePreview(o: BoardObject): ReactNode {
  const L = layoutFor(o);
  const kx = o.w / L.W0;
  const ky = o.h / L.H0;
  const today = todayNum();
  const out: ReactNode[] = [
    <rect key="bg" x={0} y={0} width={L.W0} height={L.H0} rx={10} fill="#fff" stroke="#cfcfc8" strokeWidth={1.5} />,
    <rect key="head" x={0} y={0} width={L.W0} height={HEAD_H} fill="#0a0a0a" />,
  ];
  L.lanes.forEach((l, i) => {
    if (i % 2) out.push(<rect key={`l${l.id}`} x={LABEL_W} y={l.y} width={L.W0 - LABEL_W} height={l.h} fill="#fafaf7" />);
    out.push(<line key={`s${l.id}`} x1={0} y1={l.y} x2={L.W0} y2={l.y} stroke="#e3e3dc" />);
    out.push(
      <text key={`n${l.id}`} x={14} y={l.y + l.h / 2 + 6} fontSize={17} fontWeight={700} fontFamily='"Barlow Condensed", Barlow, sans-serif' fill="#1c1c1a">
        {(l.name || '').toUpperCase().slice(0, 18)}
      </text>,
    );
  });
  out.push(<line key="lab" x1={LABEL_W} y1={HEAD_H} x2={LABEL_W} y2={L.H0} stroke="#d6d6cf" strokeWidth={1.5} />);
  if (today >= L.start && today <= L.end) {
    const x = LABEL_W + (today - L.start + 0.5) * L.dayPx;
    out.push(<line key="today" x1={x} y1={24} x2={x} y2={L.H0} stroke="#ec4e92" strokeWidth={2} />);
  }
  for (const b of L.items) {
    const c = b.it.color ?? DEFAULT_ITEM_COLOR;
    if (b.it.ms) {
      const cx = b.x + DIAMOND / 2;
      const cy = b.y + b.h / 2;
      const r = DIAMOND * 0.55;
      out.push(<path key={b.id} d={`M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`} fill={c} />);
      out.push(
        <text key={`t${b.id}`} x={b.x + DIAMOND + 8} y={cy + 5} fontSize={14} fontWeight={700} fontFamily="Barlow, sans-serif" fill="#1c1c1a">
          {b.it.title.slice(0, 30)}
        </text>,
      );
      continue;
    }
    out.push(<rect key={b.id} x={b.x} y={b.y} width={b.w} height={b.h} rx={7} fill={c} />);
    if (b.w > 40)
      out.push(
        <text key={`t${b.id}`} x={b.x + 10} y={b.y + 20} fontSize={14} fontWeight={600} fontFamily="Barlow, sans-serif" fill={textOn(c)}>
          {b.it.title.slice(0, Math.max(0, Math.floor((b.w - 16) / 7.5)))}
        </text>,
      );
  }
  return (
    <g key={o.id} transform={`translate(${o.x} ${o.y}) scale(${kx} ${ky})`}>
      {out}
    </g>
  );
}
