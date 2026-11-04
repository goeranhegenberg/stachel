// Textbreite per Canvas – ohne React, damit Datenschicht-Code (z. B. das Mindmap-Layout) auch außerhalb des Browsers
// läuft: Der Server (Native-API) setzt mit `setTextMeasure` eine Messung aus den im Chromium gemessenen Schriftmaßen.
// Die Hooks/Caches für Haftnotizen und Formen liegen in textMeasure.ts.

export type MeasureFn = (text: string, fs: number, weight: number, italic: boolean, family: string) => number;

let override: MeasureFn | null = null;
let ctx: CanvasRenderingContext2D | null = null;

const font = (weight: number, fs: number, italic = false, family = 'Barlow') => `${italic ? 'italic ' : ''}${weight} ${fs}px ${family}, system-ui, sans-serif`;

/** Messung ersetzen (ohne Canvas, z. B. auf dem Server); null = wieder Canvas. */
export function setTextMeasure(fn: MeasureFn | null) {
  override = fn;
}

/** Gesetzte Messung (Server) oder null (Browser misst per Canvas). */
export const textMeasureOverride = (): MeasureFn | null => override;

/** Breite eines Textes in Barlow bzw. `family` (Weltpunkte). */
export function measureText(text: string, fs: number, weight = 500, italic = false, family = 'Barlow'): number {
  if (override) return override(text, fs, weight, italic, family);
  ctx ??= typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!ctx) return text.length * fs * 0.5;
  ctx.font = font(weight, fs, italic, family);
  return ctx.measureText(text).width;
}
