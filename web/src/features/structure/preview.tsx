// Leichte SVG-Vorschau beliebiger Board-Objekte (Vorlagen-Galerie, Rahmen-Liste): echte Formen, Farben und Texte,
// aber ohne DOM-Objekte des Editors. Unbekannte Typen anderer Module erscheinen als Fläche in ihrer Farbe.
import { memo, type ReactNode } from 'react';
import type { BoardObject } from '../../protocol';
import { textOn, userColor } from '../../board/colors';
import { arrowHeadAt, connectorGeometry, connectorPath, dashArray } from '../../board/connector';
import type { Rect } from '../../board/geometry';
import { smoothPath } from '../../board/pen';
import { shapePath, shapeInsets } from '../../editor/core/shapeKinds';
import { measureText, shapeFontSize, stickyFontSize, stickyPadding } from '../../editor/textMeasure';
import { MindEdges } from './mindmap/edges';
import { mindStyle } from './mindmap/style';
import { cellText, colWidths, rowHeights, safeTable } from './table/model';
import { cellMeasure } from './table/measure';
import { statusOf } from './card/status';
import { wrapText } from './text';
import { timelinePreview } from './timeline/preview';
import { previewBounds } from './templates/bounds';

export { previewBounds };

type Anchor = 'start' | 'middle' | 'end';

/** Mehrzeiliger Text in einem Kasten (umgebrochen, oben bzw. mittig). */
function TextBox(p: { text: string; x: number; y: number; w: number; h?: number; fs: number; weight?: number; color: string; anchor?: Anchor; family?: string; lh?: number; upper?: boolean; maxLines?: number }) {
  const { fs, weight = 500, lh = 1.25, anchor = 'start' } = p;
  const t = p.upper ? p.text.toUpperCase() : p.text;
  let lines = wrapText(t, Math.max(4, p.w), (s) => measureText(s, fs, weight, false, p.family));
  if (p.maxLines && lines.length > p.maxLines) lines = [...lines.slice(0, p.maxLines - 1), `${lines[p.maxLines - 1]}…`];
  const total = lines.length * fs * lh;
  const top = p.h !== undefined ? p.y + (p.h - total) / 2 : p.y;
  const x = anchor === 'middle' ? p.x + p.w / 2 : anchor === 'end' ? p.x + p.w : p.x;
  return (
    <text x={x} y={top} fontSize={fs} fontWeight={weight} fill={p.color} textAnchor={anchor} fontFamily={p.family ? `${p.family}, Barlow, sans-serif` : 'Barlow, sans-serif'}>
      {lines.map((l, i) => (
        <tspan key={i} x={x} y={top + fs * (i * lh + 0.95)}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

/** Rasterlinien eines Rasterrahmens. */
function gridPath(x: number, y: number, w: number, h: number, g: number): string {
  let d = '';
  for (let gx = g; gx < w; gx += g) d += `M${x + gx} ${y}V${y + h}`;
  for (let gy = g; gy < h; gy += g) d += `M${x} ${y + gy}H${x + w}`;
  return d;
}

function objectEl(o: BoardObject, lookup: (id: string) => BoardObject | undefined): ReactNode {
  const { x, y, w, h } = o;
  const rot = o.rotation ? `rotate(${o.rotation} ${x + w / 2} ${y + h / 2})` : undefined;
  switch (o.type) {
    case 'frame':
      return (
        <g key={o.id}>
          <rect x={x} y={y} width={w} height={h} fill={o.color ?? '#fff'} stroke="#d6d6cf" strokeWidth={Math.max(1.5, w / 400)} />
          {!!o.frameGrid && o.frameGrid >= 10 && <path d={gridPath(x, y, w, h, o.frameGrid)} stroke="rgba(10,10,10,.14)" strokeWidth={Math.max(1, w / 600)} fill="none" />}
          {o.title && <TextBox text={o.title} x={x} y={y - Math.max(18, w / 36) * 1.5} w={w} fs={Math.max(18, w / 36)} weight={700} color="#3a3a36" family='"Barlow Condensed"' upper maxLines={1} />}
        </g>
      );
    case 'sticky': {
      const fill = o.color ?? '#fff27a';
      const pad = stickyPadding(w, h);
      const fs = o.fontSize ?? stickyFontSize(o.text ?? '', w, h, o);
      return (
        <g key={o.id} transform={rot}>
          <rect x={x} y={y + 2} width={w} height={h} fill="rgba(0,0,0,.08)" />
          <rect x={x} y={y} width={w} height={h} fill={fill} />
          {o.text && <TextBox text={o.text} x={x + pad} y={y + pad} w={w - 2 * pad} h={h - 2 * pad} fs={fs} color={textOn(fill)} anchor="middle" />}
        </g>
      );
    }
    case 'shape': {
      const fill = o.color ?? '#fff';
      const sw = o.strokeWidth ?? 2;
      const [t, r, b, l] = shapeInsets(o.shape, w, h);
      const fs = shapeFontSize(o.text ?? '', o.fontSize ?? 20, w - l - r, h - t - b, o);
      return (
        <g key={o.id} transform={rot}>
          <path d={shapePath(o.shape, w, h, sw / 2)} transform={`translate(${x} ${y})`} fill={fill} stroke={sw > 0 ? (o.stroke ?? '#0a0a0a') : 'none'} strokeWidth={sw} strokeDasharray={o.dash === 'dashed' ? dashArray('dashed', sw) : undefined} />
          {o.text && <TextBox text={o.text} x={x + l} y={y + t} w={w - l - r} h={h - t - b} fs={fs} weight={o.bold ? 700 : 600} color={textOn(fill)} anchor="middle" />}
        </g>
      );
    }
    case 'text': {
      const fs = o.fontSize ?? 24;
      return (
        <g key={o.id} transform={rot}>
          <TextBox text={o.text ?? ''} x={x} y={y} w={o.autoWidth ? w + 9999 : w} fs={fs} weight={o.bold || fs >= 40 ? 700 : 500} color={o.color ?? '#0a0a0a'} anchor={o.align === 'center' ? 'middle' : o.align === 'right' ? 'end' : 'start'} />
        </g>
      );
    }
    case 'connector': {
      const g = connectorGeometry(o, lookup);
      if (!g) return null;
      const sw = o.strokeWidth ?? 2;
      const color = o.color ?? '#0a0a0a';
      const size = 8 + sw * 3;
      return (
        <g key={o.id}>
          <path d={connectorPath(g)} fill="none" stroke={color} strokeWidth={sw} strokeDasharray={dashArray(o.dash, sw)} strokeLinecap="round" />
          {o.arrowEnd !== false && <polygon points={arrowHeadAt(g.b, g.dirB, size).map((q) => `${q.x},${q.y}`).join(' ')} fill={color} />}
          {o.arrowStart && <polygon points={arrowHeadAt(g.a, g.dirA, size).map((q) => `${q.x},${q.y}`).join(' ')} fill={color} />}
          {o.text && <TextBox text={o.text} x={g.mid.x - 100} y={g.mid.y - 9} w={200} fs={14} weight={600} color={color} anchor="middle" />}
        </g>
      );
    }
    case 'pen':
      return <path key={o.id} d={smoothPath(o.points ?? [])} transform={`translate(${x} ${y})`} fill="none" stroke={o.color ?? '#0a0a0a'} strokeWidth={o.strokeWidth ?? 4} strokeLinecap="round" strokeLinejoin="round" />;
    case 'card': {
      const st = statusOf(o.status);
      const color = o.color ?? '#1763b5';
      const chips = [...(st ? [{ c: st.color, w: 56 }] : []), ...(o.tags ?? []).map((t) => ({ c: t.color, w: 18 + t.label.length * 7 }))];
      let cx = x + 18;
      return (
        <g key={o.id}>
          <rect x={x} y={y + 2} width={w} height={h} rx={10} fill="rgba(0,0,0,.07)" />
          <rect x={x} y={y} width={w} height={h} rx={10} fill="#fff" stroke="#e2e2dc" />
          <rect x={x} y={y} width={6} height={h} rx={3} fill={color} />
          <TextBox text={o.text ?? ''} x={x + 18} y={y + 14} w={w - 34} fs={17} weight={600} color="#0a0a0a" maxLines={2} />
          {chips.map((c, i) => {
            const el = <rect key={i} x={cx} y={y + h - 34} width={c.w} height={20} rx={6} fill={c.c} opacity={0.85} />;
            cx += c.w + 6;
            return el;
          })}
          {o.assignee && <circle cx={x + w - 26} cy={y + h - 24} r={13} fill={userColor(o.assignee.key)} />}
        </g>
      );
    }
    case 'table': {
      const d = safeTable(o.table);
      const ws = colWidths(d, w);
      const raw = rowHeights(d, ws, cellMeasure, (o.tableHead ?? 'row') !== 'col' && o.tableHead !== 'none');
      const k = h / (raw.reduce((a, b) => a + b, 0) || 1);
      const hs = raw.map((v) => v * k);
      const headRow = (o.tableHead ?? 'row') === 'row' || o.tableHead === 'both';
      const headCol = o.tableHead === 'col' || o.tableHead === 'both';
      const head = o.color ?? '#0a0a0a';
      const out: ReactNode[] = [<rect key="bg" x={x} y={y} width={w} height={h} rx={6} fill="#fff" stroke="#cfcfc8" strokeWidth={1.5} />];
      let ry = y;
      d.rows.forEach((r, i) => {
        let rx = x;
        d.cols.forEach((c, j) => {
          const isHead = headRow && i === 0;
          if (isHead) out.push(<rect key={`h${i}${j}`} x={rx} y={ry} width={ws[j]} height={hs[i]} fill={head} />);
          else if (headCol && j === 0) out.push(<rect key={`h${i}${j}`} x={rx} y={ry} width={ws[j]} height={hs[i]} fill="#f1f1ec" />);
          const t = cellText(d, r, c);
          if (t) out.push(<TextBox key={`t${i}${j}`} text={t} x={rx + 12} y={ry + 10} w={ws[j] - 24} fs={15} weight={isHead || (headCol && j === 0) ? 700 : 500} color={isHead ? textOn(head) : '#1c1c1a'} maxLines={3} />);
          rx += ws[j];
          if (j < d.cols.length - 1) out.push(<line key={`v${i}${j}`} x1={rx} y1={ry} x2={rx} y2={ry + hs[i]} stroke="#dcdcd5" />);
        });
        ry += hs[i];
        if (i < d.rows.length - 1) out.push(<line key={`r${i}`} x1={x} y1={ry} x2={x + w} y2={ry} stroke="#dcdcd5" />);
      });
      return <g key={o.id}>{out}</g>;
    }
    case 'mindnode': {
      if (o.mind?.hidden) return null;
      const level = o.mind?.level ?? (o.mind?.parent ? 1 : 0);
      const st = mindStyle(level);
      const color = o.color ?? '#ec4e92';
      const txt = <TextBox text={o.text ?? ''} x={x + st.padX} y={y} w={w - 2 * st.padX + 4} h={h} fs={st.fs} weight={st.weight} family={st.family === 'Barlow' ? undefined : st.family} lh={st.lh} color={level === 0 ? textOn(color) : '#0a0a0a'} anchor={level === 0 ? 'middle' : 'start'} />;
      if (level === 0)
        return (
          <g key={o.id}>
            <rect x={x} y={y} width={w} height={h} rx={Math.min(h / 2, 26)} fill={color} />
            {txt}
          </g>
        );
      if (level === 1)
        return (
          <g key={o.id}>
            <rect x={x + 1.25} y={y + 1.25} width={w - 2.5} height={h - 2.5} rx={Math.min(h / 2, 26)} fill="#fff" stroke={color} strokeWidth={2.5} />
            {txt}
          </g>
        );
      return (
        <g key={o.id}>
          <line x1={x} y1={y + h - 1.5} x2={x + w} y2={y + h - 1.5} stroke={color} strokeWidth={3} strokeLinecap="round" />
          {txt}
        </g>
      );
    }
    case 'timeline':
      return timelinePreview(o);
    case 'image':
      return <rect key={o.id} x={x} y={y} width={w} height={h} fill={o.color ?? '#d9d9d3'} transform={rot} />;
    default:
      return <rect key={o.id} x={x} y={y} width={w} height={h} rx={6} fill={o.color ?? '#e9e9e4'} transform={rot} />;
  }
}


interface PreviewProps {
  objects: readonly BoardObject[];
  /** Ausschnitt in Weltkoordinaten (Standard: alle Objekte) */
  view?: Rect | null;
  /** Rand in Anteilen der größeren Seite */
  pad?: number;
  className?: string;
  label?: string;
}

/** SVG-Vorschau; passt sich per viewBox in den Container ein. */
export const BoardPreview = memo(function BoardPreview({ objects, view, pad = 0.05, className, label }: PreviewProps) {
  const b = view ?? previewBounds(objects);
  if (!b) return <svg className={className} role="img" aria-label={label} />;
  const p = Math.max(b.w, b.h) * pad;
  const byId = new Map(objects.map((o) => [o.id, o]));
  const lookup = (id: string) => byId.get(id);
  const frames = objects.filter((o) => o.type === 'frame');
  const rest = objects.filter((o) => o.type !== 'frame');
  const minds = objects.filter((o) => o.type === 'mindnode');
  return (
    <svg className={className} viewBox={`${b.x - p} ${b.y - p} ${b.w + 2 * p} ${b.h + 2 * p}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
      {frames.map((o) => objectEl(o, lookup))}
      {minds.length > 0 && <MindEdges nodes={minds} byId={byId} />}
      {rest.map((o) => objectEl(o, lookup))}
    </svg>
  );
});
