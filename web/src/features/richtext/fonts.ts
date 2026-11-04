// Schriftarten (alle self-hosted über @fontsource, keine externen Aufrufe).
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/source-serif-4/600.css';
import '@fontsource/source-serif-4/700.css';
import '@fontsource/source-serif-4/700-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/400-italic.css';
import '@fontsource/jetbrains-mono/700.css';

export type FontKey = 'barlow' | 'condensed' | 'serif' | 'mono';

export interface FontDef {
  key: FontKey;
  label: string;
  /** Name für Canvas-Messung und CSS (ohne Fallbacks) */
  family: string;
  css: string;
}

export const FONTS: readonly FontDef[] = [
  { key: 'barlow', label: 'Barlow', family: 'Barlow', css: 'Barlow, system-ui, sans-serif' },
  { key: 'condensed', label: 'Barlow Condensed', family: '"Barlow Condensed"', css: '"Barlow Condensed", system-ui, sans-serif' },
  { key: 'serif', label: 'Serif', family: '"Source Serif 4"', css: '"Source Serif 4", Georgia, serif' },
  { key: 'mono', label: 'Mono', family: '"JetBrains Mono"', css: '"JetBrains Mono", ui-monospace, monospace' },
];

export const fontOf = (key: unknown): FontDef => FONTS.find((f) => f.key === key) ?? FONTS[0];

/** CSS-Schriftfamilie eines Objekts; undefined = Standard (Barlow, vom Editor geerbt). */
export const fontCss = (key: unknown): string | undefined => (key && key !== 'barlow' ? fontOf(key).css : undefined);
