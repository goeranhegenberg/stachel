// Farben der Formen (größere Palette) mit deutschen Namen, eigene Farbe per Farbwähler, Deckkraft-Regler.
import { useRef } from 'react';
import { colorName } from '../../ui/a11y';
import type { EditorApi } from '../../editor/ext/types';
import type { BoardObject } from '../../protocol';
import type { Patch } from '../../board/store';

/** Füllfarben: Graustufen, Stachel-Akzente, helle Töne. */
export const SHAPE_PALETTE = [
  '#ffffff',
  '#e9e9e4',
  '#8a8a85',
  '#000000',
  '#fff27a',
  '#ffd08a',
  '#ffb3d1',
  '#e2d5ff',
  '#9fd3ff',
  '#b9ecd8',
  '#c9e14a',
  '#7aa21b',
  '#ec4e92',
  '#e8590c',
  '#7048e8',
  '#1763b5',
];

const EXTRA_NAMES: Record<string, string> = { '#b9ecd8': 'Mint' };
export const nameOf = (hex: string) => EXTRA_NAMES[hex.toLowerCase()] ?? colorName(hex);

/** #rrggbb + Deckkraft → rgba() (für einfache Flächen). */
export function withAlpha(hex: string, a: number): string {
  if (a >= 1 || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(a * 100) / 100})`;
}

/** Änderungen während eines Regler-Zugs: ohne neuen Undo-Schritt je Bewegung (der UndoManager fasst sie zusammen). */
export function livePatch(api: EditorApi, fn: (o: BoardObject) => Patch | null) {
  const patches: Record<string, Patch> = {};
  for (const o of api.selected()) {
    if (o.locked) continue;
    const p = fn(o);
    if (p) patches[o.id] = p;
  }
  api.store.updateMany(patches);
}

/** Eigene Farbe: Farbwähler des Systems (offline), als Regenbogen-Feld dargestellt. */
export function CustomColor({ value, label, onPick }: { value: string; label: string; onPick: (hex: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <label className="shapes-custom" title={label}>
      <input ref={ref} type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onPick(e.target.value)} />
      <span aria-hidden="true" />
    </label>
  );
}

/** Deckkraft 0–100 % als Regler; ein Zug ergibt einen Undo-Schritt. */
export function OpacitySlider({ api, value, field, label = 'Deckkraft' }: { api: EditorApi; value: number; field: 'fillOpacity'; label?: string }) {
  const pct = Math.round(value * 100);
  return (
    <div className="shapes-slider">
      <span className="shapes-slider__label">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        aria-label={label}
        style={{ ['--v' as string]: `${pct}%` }}
        onPointerDown={() => api.store.stopCapturing()}
        onPointerUp={() => api.store.stopCapturing()}
        onKeyDown={() => api.store.stopCapturing()}
        onChange={(e) => {
          const v = Number(e.target.value) / 100;
          livePatch(api, () => ({ [field]: v >= 1 ? undefined : v }));
        }}
      />
      <span className="shapes-slider__value">{pct} %</span>
    </div>
  );
}
