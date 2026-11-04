// Größen, die die Web-App aus dem Text misst (Mindmap-Knoten, Karten, Text mit automatischer Breite, Tabellen).
// Formeln wie in web/ (Quellen je Funktion); Konstanten, die dort in React-Dateien stehen, sind hier gespiegelt und
// werden von test/sync-web.test.ts gegen das Original geprüft.
import { textWeight, TEXT_PLACEHOLDER } from '../../../web/src/editor/interaction/textWidth';
import { wrapText, widest } from '../../../web/src/features/structure/text';
import { tableHeight, type CellMeasure } from '../../../web/src/features/structure/table/model';
import type { TableData } from '../../../web/src/features/structure/model';
import { measureText } from './measure';

// ---- Mindmap (web/src/features/structure/mindmap/style.ts) -----------------------------------------------------------

export interface MindStyle {
  fs: number;
  weight: number;
  family: string;
  ls: number;
  padX: number;
  padY: number;
  minW: number;
  maxW: number;
  lh: number;
}

const COND = '"Barlow Condensed"';
export const MIND_STYLES: MindStyle[] = [
  { fs: 28, weight: 700, family: COND, ls: 0.01, padX: 26, padY: 14, minW: 140, maxW: 360, lh: 1.15 },
  { fs: 18, weight: 600, family: 'Barlow', ls: 0, padX: 18, padY: 9, minW: 80, maxW: 280, lh: 1.3 },
  { fs: 16, weight: 500, family: 'Barlow', ls: 0, padX: 6, padY: 6, minW: 60, maxW: 260, lh: 1.3 },
];
/** Zweigfarben (Hauptzweige der Reihe nach, Unterzweige erben). */
export const MIND_COLORS = ['#ec4e92', '#1763b5', '#7aa21b', '#e8590c', '#7048e8', '#0c8599', '#c2255c', '#0a0a0a'];
export const MIND_PLACEHOLDER = ['Zentrales Thema', 'Hauptthema', 'Unterthema'];

export const mindStyle = (level: number) => MIND_STYLES[Math.min(Math.max(0, level), MIND_STYLES.length - 1)]!;

export function mindMeasure(level: number) {
  const st = mindStyle(level);
  return (s: string) => measureText(s, st.fs, st.weight, false, st.family) + st.ls * st.fs * s.length;
}

export function mindSize(text: string, level: number, measure = mindMeasure(level)): { w: number; h: number } {
  const st = mindStyle(level);
  const shown = text || MIND_PLACEHOLDER[Math.min(level, 2)]!;
  const lines = wrapText(shown, st.maxW - 2 * st.padX, measure);
  const w = Math.ceil(Math.min(st.maxW, Math.max(st.minW, widest(lines, measure) + 2 * st.padX + 2)));
  const h = Math.ceil(lines.length * st.fs * st.lh + 2 * st.padY);
  return { w, h };
}

// ---- Karte (web/src/features/structure/templates/build.ts `cardHeight`) ---------------------------------------------

export const CARD_W = 300;
export const CARD_COLORS = ['#1763b5', '#ec4e92', '#c9e14a', '#e8590c', '#7048e8', '#0c8599', '#0a0a0a', '#8a8a85'];

export function cardHeight(w: number, title: string, desc?: string, chips = 0): number {
  const tl = wrapText(title || 'Titel', w - 40, (s) => measureText(s, 17, 600)).length;
  const dl = desc ? Math.min(4, wrapText(desc, w - 40, (s) => measureText(s, 14, 500)).length) : 0;
  return Math.ceil(28 + tl * 22.1 + (dl ? 6 + dl * 20.3 : 0) + (chips ? 12 + 24 : 0));
}

// ---- Text (web/src/editor/interaction/textWidth.ts `autoTextWidth`) ------------------------------------------------

const MAX_AUTO_WIDTH = 2400;

export function autoTextWidth(o: { text?: string; fontSize?: number; bold?: boolean; italic?: boolean }): number {
  const fs = o.fontSize ?? 24;
  const text = o.text || TEXT_PLACEHOLDER;
  const weight = textWeight(o);
  const w = Math.max(...text.split('\n').map((line) => measureText(line, fs, weight)));
  return Math.min(MAX_AUTO_WIDTH, Math.max(Math.round(fs * 1.2), Math.ceil(w + fs * 0.25 + 4)));
}

/** Höhe eines Textes (Zeilenhöhe 1,25 wie die Vorlagen), bei fester Breite umbrochen. */
export function textHeight(o: { text?: string; fontSize?: number; bold?: boolean }, w?: number): number {
  const fs = o.fontSize ?? 24;
  const text = o.text || TEXT_PLACEHOLDER;
  const lines = w ? wrapText(text, w, (s) => measureText(s, fs, textWeight(o))).length : text.split('\n').length;
  return Math.ceil(lines * fs * 1.25);
}

// ---- Tabelle (web/src/features/structure/table/measure.ts) ---------------------------------------------------------

export const cellMeasure: CellMeasure = (s, bold) => measureText(s, 15, bold ? 700 : 500);

export function tableH(d: TableData, w: number, head: string = 'row'): number {
  return tableHeight(d, w, cellMeasure, head === 'row' || head === 'both');
}
