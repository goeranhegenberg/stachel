// Breite eines Text-Objekts mit autoWidth: längste Zeile per Canvas messen (Schrift wie in ObjectLayer).
import type { BoardObject } from '../../protocol';
import type { Patch } from '../../board/store';
import { textMeasureOverride } from '../measureText';

let ctx: CanvasRenderingContext2D | null = null;

export const TEXT_PLACEHOLDER = 'Text eingeben';
const MAX_AUTO_WIDTH = 2400;

/** Schriftstärke wie die Darstellung: große Schrift kräftiger, fett immer 700+. */
export function textWeight(o: Pick<BoardObject, 'fontSize' | 'bold'>): number {
  const fs = o.fontSize ?? 24;
  const base = fs >= 40 ? 700 : fs >= 28 ? 600 : 500;
  return o.bold ? Math.max(700, base + 200) : base;
}

export function autoTextWidth(o: Pick<BoardObject, 'text' | 'fontSize' | 'bold' | 'italic'>): number {
  const fs = o.fontSize ?? 24;
  const text = o.text || TEXT_PLACEHOLDER;
  ctx ??= typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  let widest = 0;
  for (const line of text.split('\n')) {
    let w: number;
    if (ctx) {
      ctx.font = `${o.italic ? 'italic ' : ''}${textWeight(o)} ${fs}px Barlow, system-ui, sans-serif`;
      w = ctx.measureText(line).width;
    } else {
      // ohne Canvas (Server, Web-Aktion der App): die gesetzte Messung aus den Chromium-Schriftmaßen
      const m = textMeasureOverride();
      w = m ? m(line, fs, textWeight(o), !!o.italic, 'Barlow') : line.length * fs * 0.52;
    }
    widest = Math.max(widest, w);
  }
  // etwas Luft für Caret und Rundung, damit nichts umbricht
  return Math.min(MAX_AUTO_WIDTH, Math.max(Math.round(fs * 1.2), Math.ceil(widest + fs * 0.25 + 4)));
}

/** Patch berührt die Textbreite (Schrift, Text, Breite)? */
export const affectsTextWidth = (p: Patch) => 'fontSize' in p || 'bold' in p || 'italic' in p || 'text' in p || 'w' in p;

/** Text mit autoWidth: Breite folgt dem (gepatchten) Inhalt (Typ `text`, adjustPatch). */
export const adjustTextPatch = (o: BoardObject, p: Patch): Patch =>
  o.autoWidth && affectsTextWidth(p) && !('w' in p) ? { ...p, w: autoTextWidth({ ...o, ...p } as BoardObject) } : p;