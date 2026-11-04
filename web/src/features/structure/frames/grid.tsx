// Rasterrahmen: Rahmen mit Gitter (Feld `frameGrid` = Kantenlänge) und optional Koordinaten A, B, C … / 1, 2, 3 …
// (`frameGridLabels`), z. B. für Lagepläne. Erweitert den Kern-Typ `frame` (gleiche id ersetzt).
import type { CSSProperties } from 'react';
import type { BoardObject } from '../../../protocol';
import { textOn } from '../../../board/colors';
import { placeStyle } from '../../../editor/render/format';
import { defineContextAction, defineObjectType, objectTypes } from '../../../editor/ext/registry';
import type { ObjectViewProps } from '../../../editor/ext/types';
import { PopBtn } from '../../../editor/ContextBar';
import { IconTable } from '../icons';

export const GRID_SIZES = [50, 100, 140, 200];

/** Spaltenname wie in Tabellen: A … Z, AA … */
export function colName(i: number): string {
  let s = '';
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

function gridLines(o: BoardObject): CSSProperties {
  const g = o.frameGrid!;
  const line = textOn(o.color ?? '#ffffff') === '#ffffff' ? 'rgba(255,255,255,.22)' : 'rgba(10,10,10,.13)';
  return {
    backgroundImage: `linear-gradient(to right, ${line} 1px, transparent 1px), linear-gradient(to bottom, ${line} 1px, transparent 1px)`,
    backgroundSize: `${g}px ${g}px`,
  };
}

function GridLabels({ o }: { o: BoardObject }) {
  const g = o.frameGrid!;
  const cols = Math.floor(o.w / g);
  const rows = Math.floor(o.h / g);
  if (cols > 60 || rows > 60) return null;
  const fs = Math.max(12, Math.min(28, g * 0.16));
  const color = textOn(o.color ?? '#ffffff') === '#ffffff' ? 'rgba(255,255,255,.55)' : 'rgba(10,10,10,.38)';
  return (
    <div className="structure-grid-labels" style={{ fontSize: fs, color }} aria-hidden="true">
      {Array.from({ length: cols }, (_, i) => (
        <span key={`c${i}`} style={{ transform: `translate(${i * g + g / 2}px, ${fs * 0.5}px) translateX(-50%)` }}>
          {colName(i)}
        </span>
      ))}
      {Array.from({ length: rows }, (_, i) => (
        <span key={`r${i}`} style={{ transform: `translate(${fs * 0.5}px, ${i * g + g / 2}px) translateY(-50%)` }}>
          {i + 1}
        </span>
      ))}
    </div>
  );
}

function FrameView({ o }: ObjectViewProps) {
  const grid = !!o.frameGrid && o.frameGrid >= 10;
  return (
    <div className="obj obj-frame" data-id={o.id} data-type="frame" style={placeStyle(o)}>
      <div className="frame-body" style={{ background: o.color ?? '#ffffff', ...(grid ? gridLines(o) : null) }} />
      {grid && o.frameGridLabels && <GridLabels o={o} />}
    </div>
  );
}

const core = objectTypes.get('frame');
if (core) defineObjectType({ ...core, View: FrameView });

defineContextAction({
  id: 'structure.frameGrid',
  order: 23,
  when: (c) => !c.locked && c.selected.length > 0 && c.selected.every((o) => o.type === 'frame'),
  Bar: (p) => (
    <div className="ctx-group">
      <PopBtn open={p.pop === 'frameGrid'} onToggle={p.togglePop('frameGrid')} label="Raster" active={!!p.first.frameGrid}>
        <IconTable />
      </PopBtn>
    </div>
  ),
  pops: {
    frameGrid: {
      className: 'ctx-pop--list structure-pop-grid',
      label: 'Raster',
      Body: (p) => (
        <>
          <button className={`ctx-chip${!p.first.frameGrid ? ' is-active' : ''}`} onClick={() => p.patch(() => ({ frameGrid: undefined, frameGridLabels: undefined }))}>
            Ohne
          </button>
          {GRID_SIZES.map((g) => (
            <button key={g} className={`ctx-chip${p.first.frameGrid === g ? ' is-active' : ''}`} aria-label={`Raster ${g}`} onClick={() => p.patch(() => ({ frameGrid: g }))}>
              {g}
            </button>
          ))}
          <button
            className={`ctx-chip${p.first.frameGridLabels ? ' is-active' : ''}`}
            aria-pressed={!!p.first.frameGridLabels}
            disabled={!p.first.frameGrid}
            onClick={() => p.patch((o) => ({ frameGridLabels: o.frameGridLabels ? undefined : true }))}
          >
            A1 B2
          </button>
        </>
      ),
    },
  },
});
