// Vorlagen der Instanz über `GET /api/templates/instance` (server/src/template-packs.ts): wer die Instanz betreibt, legt
// sie als JSON-Dateien auf dem Server ab; die Galerie zeigt sie unter der Kategorie der Instanz. Einfügen wie eigene
// Vorlagen (Format der Zwischenablage, own.ts). Ohne Server (Offline-Modus) oder ohne Dateien bleibt die Liste leer.
import { useEffect, useSyncExternalStore } from 'react';
import { request } from '../../../api';
import type { BoardObject } from '../../../protocol';
import { cleanTemplateObjects } from './own';

/** Eine Vorlage der Instanz, wie die Galerie sie zeigt. */
export interface PackTemplate {
  id: string;
  name: string;
  desc: string;
  keywords: string[];
  objects: BoardObject[];
}

export interface PackState {
  /** Name der Kategorie (null = keine Vorlagen der Instanz) */
  category: string | null;
  list: PackTemplate[];
}

interface Raw {
  category?: unknown;
  templates?: { id?: unknown; name?: unknown; desc?: unknown; keywords?: unknown; objects?: unknown }[];
}

/** Antwort des Servers tolerant übernehmen (leere Vorlagen fallen weg). */
export function packFromServer(r: Raw): PackState {
  const list: PackTemplate[] = [];
  for (const t of Array.isArray(r.templates) ? r.templates : []) {
    if (!t || typeof t.id !== 'string' || typeof t.name !== 'string') continue;
    const objects = cleanTemplateObjects(t.objects);
    if (!objects.length) continue;
    const keywords = Array.isArray(t.keywords) ? t.keywords.filter((k): k is string => typeof k === 'string') : [];
    list.push({ id: t.id, name: t.name, desc: typeof t.desc === 'string' ? t.desc : '', keywords, objects });
  }
  const category = typeof r.category === 'string' && r.category.trim() ? r.category.trim() : null;
  return { category: list.length ? category ?? 'Weitere Vorlagen' : null, list };
}

/** Passt die Vorlage der Instanz zur Suche der Galerie? (Name, Beschreibung, Kategorie, Stichwörter) */
export const packMatches = (t: PackTemplate, category: string, q: string) => {
  const needle = q.trim().toLowerCase();
  return !needle || [t.name, t.desc, category, ...t.keywords].join(' ').toLowerCase().includes(needle);
};

let state: PackState = { category: null, list: [] };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: PackState) {
  state = next;
  for (const l of listeners) l();
}

/** Liste laden (einmal je Seite; Fehler = leer lassen und beim nächsten Öffnen erneut versuchen). */
export function loadPackTemplates(): Promise<void> {
  loading ??= request<Raw>('GET', '/api/templates/instance')
    .then((r) => set(packFromServer(r)))
    .catch(() => {
      loading = null;
    });
  return loading;
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Vorlagen der Instanz für die Galerie. */
export function usePackTemplates(): PackState {
  useEffect(() => {
    void loadPackTemplates();
  }, []);
  return useSyncExternalStore(subscribe, () => state);
}

/** Nur für Tests: Zwischenspeicher setzen bzw. leeren. */
export function setPackTemplatesForTest(next: PackState | null) {
  loading = next ? Promise.resolve() : null;
  set(next ?? { category: null, list: [] });
}
