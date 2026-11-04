// Board-Einstellungen ohne React (für den Browser und die Web-Aktion `tools.settings` der App, native-view.ts): im
// Yjs-Dokument unter 'tools.settings', für alle, ohne Rückgängig. settings.ts ergänzt die Editor-Hilfen und den Hook.
import type * as Y from 'yjs';
import type { BoardStore } from '../../board/store';

export const SETTINGS = 'tools.settings';

export type Pattern = 'dots' | 'lines' | 'none';
export const PATTERNS: readonly Pattern[] = ['dots', 'lines', 'none'];
export const PATTERN_LABELS: Record<Pattern, string> = { dots: 'Punkte', lines: 'Linien', none: 'Leer' };

/** Hintergrundfarben: hell, damit Texte, Verbinder und Rahmentitel lesbar bleiben (Standard zuerst) */
export const BG_COLORS = ['#f3f3ef', '#ffffff', '#fbf6e9', '#f1f4e4', '#e9f1f8', '#fbeff4', '#ecebe6'] as const;
export const BG_NAMES: Record<string, string> = {
  '#f3f3ef': 'Hellgrau',
  '#ffffff': 'Weiß',
  '#fbf6e9': 'Papier',
  '#f1f4e4': 'Salbei',
  '#e9f1f8': 'Eisblau',
  '#fbeff4': 'Rosé',
  '#ecebe6': 'Stein',
};

export interface BoardSettings {
  pattern: Pattern;
  color: string;
  /** Autor:in an jeder Haftnotiz zeigen (klein unten links, für alle) */
  authors: boolean;
}

export const DEFAULT_SETTINGS: BoardSettings = { pattern: 'dots', color: BG_COLORS[0], authors: false };

const HEX = /^#[0-9a-f]{6}$/i;

/** Fehlende/fremde Werte → Standard (alte Boards haben keine Einstellungen). */
export function readSettings(m: Pick<Y.Map<unknown>, 'get'>): BoardSettings {
  const p = m.get('pattern');
  const c = m.get('color');
  return {
    pattern: PATTERNS.includes(p as Pattern) ? (p as Pattern) : DEFAULT_SETTINGS.pattern,
    color: typeof c === 'string' && HEX.test(c) ? c.toLowerCase() : DEFAULT_SETTINGS.color,
    authors: m.get('authors') === true,
  };
}

/** Dunkler Hintergrund? (Raster und Hinweise hell zeichnen) */
export function isDark(hex: string): boolean {
  if (!HEX.test(hex)) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.45;
}

type SettingsStore = Pick<BoardStore, 'extMap' | 'transact'>;

export const settingsMapOf = (store: SettingsStore) => store.extMap<unknown>(SETTINGS, { undo: false });

export function writeSettingsTo(store: SettingsStore, patch: Partial<BoardSettings & { lastPattern: Pattern }>) {
  const m = settingsMapOf(store);
  store.transact(() => {
    for (const [k, v] of Object.entries(patch)) if (v !== undefined && m.get(k) !== v) m.set(k, v);
  });
}

/** Raster ein/aus (Strg '): zwischen „Leer“ und dem zuletzt gewählten Muster wechseln. */
export function toggleGridOf(store: SettingsStore) {
  const m = settingsMapOf(store);
  const cur = readSettings(m).pattern;
  if (cur === 'none') {
    const last = m.get('lastPattern');
    writeSettingsTo(store, { pattern: last === 'lines' ? 'lines' : 'dots' });
  } else writeSettingsTo(store, { pattern: 'none', lastPattern: cur });
}
