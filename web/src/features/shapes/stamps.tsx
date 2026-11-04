// Stempel (Daumen hoch, Herz, Haken, Fragezeichen, +1, Stern …): runde Plaketten im Stachel-Look.
// Gezeichnet als SVG (viewBox 64×64), gespeichert wird nur die Id im Feld `stamp`.
import type { ReactNode } from 'react';

export interface StampDef {
  id: string;
  label: string;
  bg: string;
  ink: string;
  glyph: ReactNode;
}

const thumb = (
  <path d="M19 30.5h5.5v15.5H19a2 2 0 0 1-2-2V32.5a2 2 0 0 1 2-2Zm8 0 6.4-11.2c.8-1.4 2.6-1.9 4-1 1.2.7 1.8 2.1 1.5 3.5L37.6 28H46a3.2 3.2 0 0 1 3.1 3.9l-2.6 11.4A3.5 3.5 0 0 1 43 46H27Z" />
);
const word = (text: string, size = 30, dy = 0) => (
  <text x="32" y={32 + size * 0.35 + dy} textAnchor="middle" fontFamily="'Barlow Condensed', 'Barlow', sans-serif" fontWeight={800} fontSize={size} letterSpacing="-0.5">
    {text}
  </text>
);

export const STAMPS: StampDef[] = [
  { id: 'like', label: 'Daumen hoch', bg: '#1763b5', ink: '#ffffff', glyph: thumb },
  { id: 'heart', label: 'Herz', bg: '#ec4e92', ink: '#ffffff', glyph: <path d="M32 47.5S17.5 39 17.5 28.6A7.6 7.6 0 0 1 32 24.3a7.6 7.6 0 0 1 14.5 4.3C46.5 39 32 47.5 32 47.5Z" /> },
  {
    id: 'check',
    label: 'Haken',
    bg: '#c9e14a',
    ink: '#0a0a0a',
    glyph: <path d="m20 33.5 8.2 8.2L45 24.5" fill="none" stroke="currentColor" strokeWidth={6.5} strokeLinecap="round" strokeLinejoin="round" />,
  },
  { id: 'question', label: 'Fragezeichen', bg: '#e8590c', ink: '#ffffff', glyph: word('?', 38, 1) },
  { id: 'plusOne', label: 'Plus eins', bg: '#7048e8', ink: '#ffffff', glyph: word('+1', 30, 0) },
  {
    id: 'star',
    label: 'Stern',
    bg: '#ffd23f',
    ink: '#0a0a0a',
    glyph: <path d="m32 16.5 4.7 9.6 10.6 1.5-7.7 7.5 1.8 10.5L32 40.6l-9.4 5 1.8-10.5-7.7-7.5 10.6-1.5Z" strokeLinejoin="round" stroke="currentColor" strokeWidth={1.5} />,
  },
  { id: 'exclaim', label: 'Ausrufezeichen', bg: '#d6336c', ink: '#ffffff', glyph: word('!', 38, 1) },
  { id: 'dislike', label: 'Daumen runter', bg: '#5f5f5a', ink: '#ffffff', glyph: <g transform="rotate(180 32 32)">{thumb}</g> },
];

export const stampById = (id: string | undefined) => STAMPS.find((s) => s.id === id);

/** Stempel als SVG (füllt die Fläche). */
export function StampSvg({ id, size }: { id: string | undefined; size?: number | string }) {
  const s = stampById(id) ?? STAMPS[0];
  return (
    <svg className="shapes-stamp" viewBox="0 0 64 64" width={size ?? '100%'} height={size ?? '100%'} aria-hidden="true" style={{ color: s.ink }}>
      <circle cx="32" cy="32" r="29.5" fill={s.bg} />
      <circle cx="32" cy="32" r="25.5" fill="none" stroke={s.ink} strokeOpacity={0.28} strokeWidth="1.5" strokeDasharray="2 3" />
      <g fill="currentColor">{s.glyph}</g>
    </svg>
  );
}
