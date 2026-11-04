// Aussehen und Größe der Mindmap-Knoten je Ebene (Wurzel, Hauptzweig, Unterzweig).
import { measureText } from '../../../editor/measureText';
import { widest, wrapText, type Measure } from '../text';

export interface MindStyle {
  fs: number;
  weight: number;
  family: string;
  /** Buchstabenabstand in em */
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

export const mindStyle = (level: number) => MIND_STYLES[Math.min(Math.max(0, level), MIND_STYLES.length - 1)];

/** Zweigfarben (Hauptzweige der Reihe nach, Unterzweige erben). */
export const MIND_COLORS = ['#ec4e92', '#1763b5', '#7aa21b', '#e8590c', '#7048e8', '#0c8599', '#c2255c', '#0a0a0a'];

export const MIND_PLACEHOLDER = ['Zentrales Thema', 'Hauptthema', 'Unterthema'];

export function mindMeasure(level: number): Measure {
  const st = mindStyle(level);
  return (s) => measureText(s, st.fs, st.weight, false, st.family) + st.ls * st.fs * s.length;
}

/** Größe eines Knotens aus Text und Ebene. */
export function mindSize(text: string, level: number, measure: Measure = mindMeasure(level)): { w: number; h: number } {
  const st = mindStyle(level);
  const shown = text || MIND_PLACEHOLDER[Math.min(level, 2)];
  const lines = wrapText(shown, st.maxW - 2 * st.padX, measure);
  const w = Math.ceil(Math.min(st.maxW, Math.max(st.minW, widest(lines, measure) + 2 * st.padX + 2)));
  const h = Math.ceil(lines.length * st.fs * st.lh + 2 * st.padY);
  return { w, h };
}
