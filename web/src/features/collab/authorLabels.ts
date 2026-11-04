// „Autor:in an Haftnotizen zeigen“ (Board-Einstellung `authors`, features/tools/settingsModel.ts): welche Haftnotizen
// im Bild ihren Namen klein unten links tragen. Ohne React (Test: collab/authorLabels.test.ts).
import { worldToScreen, type Camera } from '../../board/geometry';
import type { Snapshot } from '../../board/store';
import { isInvisible } from '../../board/types';

/** Ab dieser Breite der Notiz auf dem Bildschirm (px) steht der Name daran (wie „von …“ beim Überfahren). */
export const AUTHOR_MIN_PX = 60;

export interface AuthorLabel {
  id: string;
  /** links unten in der Notiz, Bildschirm-px */
  x: number;
  y: number;
  /** Platz für den Namen (Notizbreite auf dem Bildschirm) */
  maxW: number;
  name: string;
}

/**
 * Namen für alle sichtbaren Haftnotizen im Ausschnitt `width`×`height`: nur mit bekannter Person (`nameOf` → null =
 * nichts zeigen), ab {@link AUTHOR_MIN_PX} Bildschirmbreite, nicht an der Notiz, die gerade jemand schreibt (`editing`).
 * Gedrehte Notizen bekommen den Namen an der ungedrehten Ecke (selten, bleibt lesbar).
 */
export function authorLabels(snap: Snapshot, cam: Camera, width: number, height: number, nameOf: (key: string) => string | null, editing: string | null): AuthorLabel[] {
  const out: AuthorLabel[] = [];
  // Notiz-Stapel (shapes/stack): nur die oberste trägt einen Namen
  const topOf = new Map<string, string>();
  for (const o of snap.ordered) if (o.type === 'sticky' && o.stacked && o.groupId) topOf.set(o.groupId, o.id);
  for (const o of snap.ordered) {
    if (o.type !== 'sticky' || !o.createdBy || o.id === editing || isInvisible(o)) continue;
    if (o.stacked && o.groupId && topOf.get(o.groupId) !== o.id) continue;
    const w = o.w * cam.z;
    if (w < AUTHOR_MIN_PX) continue;
    const a = worldToScreen(cam, { x: o.x, y: o.y });
    const h = o.h * cam.z;
    if (a.x > width || a.y > height || a.x + w < 0 || a.y + h < 0) continue;
    const name = nameOf(o.createdBy);
    if (!name) continue;
    out.push({ id: o.id, x: Math.round(a.x), y: Math.round(a.y + h), maxW: Math.floor(w), name });
  }
  return out;
}
