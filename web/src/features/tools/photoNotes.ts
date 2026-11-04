// „Zettel abfotografieren“ (P10, docs/features/photo-notes.md): Ergebnis der Server-Auswertung (POST
// /api/boards/:id/photo-notes) → Haftnotizen in der Anordnung wie auf dem Foto. React-frei: der Dialog im Web
// (PhotoNotesDialog.tsx) und die Web-Aktion `tools.photoNotes` der Apps (native.ts) bauen damit dieselben Objekte.
import type { BoardObject } from '../../protocol';
import { STICKY_COLORS } from '../../protocol';

/** Ein Zettel aus der Auswertung (Lage in Bildpunkten des Fotos) – ggf. vom Menschen korrigiert. */
export interface PhotoNote {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  text: string;
}

/** Antwort des Servers. */
export interface PhotoNotesResult {
  width: number;
  height: number;
  notes: (PhotoNote & { rgb: string; conf: number })[];
  /** false = ohne Texterkennung (Server ohne Tesseract) */
  ocr: boolean;
  /** kleine Vorschau des Fotos (data:-URI) */
  preview: string;
}

export const MAX_PHOTO_NOTES = 60;
/** Notizgrößen wie das Notiz-Werkzeug (Quadrat, Rechteck) */
const SQUARE = { w: 200, h: 200 };
const RECT = { w: 350, h: 228 };
/** Abstand zweier nebeneinander klebender Zettel auf dem Board */
const PITCH = 230;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 1;
};

/**
 * Haftnotizen (Ursprung oben links, ohne IDs/Ebenen): Mitten wie auf dem Foto, so skaliert, dass ein typischer Zettel
 * `PITCH` Board-Einheiten breit ist; breite Zettel (≥ 1,35 : 1) werden Rechteck-Notizen. Überlappen sich Notizen
 * (Perspektive, schräge Zettel), rücken spätere nach rechts. Reihenfolge = Leserichtung des Fotos.
 */
export function photoNoteObjects(notes: readonly PhotoNote[]): BoardObject[] {
  const list = notes.slice(0, MAX_PHOTO_NOTES);
  if (!list.length) return [];
  const s = PITCH / Math.max(1, median(list.map((n) => Math.min(n.w, n.h * 1.2))));
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const out: BoardObject[] = [];
  for (const n of list) {
    const size = n.w / Math.max(1, n.h) >= 1.35 ? RECT : SQUARE;
    let x = Math.round((n.x + n.w / 2) * s - size.w / 2);
    const y = Math.round((n.y + n.h / 2) * s - size.h / 2);
    for (let guard = 0; guard < 100; guard++) {
      const hit = placed.find((p) => x < p.x + p.w + 10 && p.x < x + size.w + 10 && y < p.y + p.h + 10 && p.y < y + size.h + 10);
      if (!hit) break;
      x = hit.x + hit.w + 20;
    }
    placed.push({ x, y, ...size });
    const color = /^#[0-9a-f]{6}$/i.test(n.color) ? n.color.toLowerCase() : STICKY_COLORS[0];
    out.push({ id: `photo-${out.length + 1}`, z: '', createdBy: '', updatedAt: '', type: 'sticky', x, y, w: size.w, h: size.h, color, text: n.text.replace(/\r\n?/g, '\n').trim().slice(0, 2000) } as BoardObject);
  }
  return out;
}
