// Laufende PDF-Uploads (Platzhalter auf dem Board, nur bei mir) und Fortschritt „Alle Seiten aufs Board“.
import { useSyncExternalStore } from 'react';
import type { Rect } from '../../board/geometry';

export interface PdfUpload {
  key: string;
  rect: Rect;
  name: string;
}

let uploads: PdfUpload[] = [];
const subs = new Set<() => void>();

export function setUploads(fn: (u: PdfUpload[]) => PdfUpload[]) {
  uploads = fn(uploads);
  for (const s of subs) s();
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

export const useUploads = () => useSyncExternalStore(subscribe, () => uploads);
