// Barrierefreiheit: deutsche Farbnamen, Objektbeschreibungen und Ansagen für Screenreader.
import type { BoardObject } from '../protocol';
import { shapeKinds, typeDef } from '../editor/ext/registry';

/** Deutsche Namen aller Farben aus STICKY_COLORS, SHAPE_FILLS, INK_COLORS und USER_COLORS. */
export const COLOR_NAMES: Record<string, string> = {
  '#fff27a': 'Gelb',
  '#c9e14a': 'Grün',
  '#ffb3d1': 'Rosa',
  '#9fd3ff': 'Hellblau',
  '#ffd08a': 'Orange',
  '#e2d5ff': 'Lila',
  '#ffffff': 'Weiß',
  '#ff9e8a': 'Koralle',
  '#b9ecd8': 'Mint',
  '#7fd6e0': 'Türkis',
  '#7fb2f0': 'Mittelblau',
  '#d4d4cc': 'Steingrau',
  '#ffd23f': 'Sonnengelb',
  '#ff8c42': 'Mandarine',
  '#f25c78': 'Himbeere',
  '#7bc950': 'Grasgrün',
  '#2ec4b6': 'Lagune',
  '#b388eb': 'Lavendel',
  '#c62828': 'Rot',
  '#2e7d32': 'Tannengrün',
  '#1565c0': 'Königsblau',
  '#6a1b9a': 'Aubergine',
  '#6d4c41': 'Braun',
  '#2b2b2b': 'Anthrazit',
  '#cdd3f8': 'Hellindigo',
  '#5c6bc0': 'Indigo',
  '#29a8e0': 'Himmelblau',
  '#a4b81c': 'Limette',
  '#8a6a00': 'Ocker',
  '#7f1d1d': 'Weinrot',
  '#880e4f': 'Brombeere',
  '#283593': 'Nachtblau',
  '#0d2c6b': 'Marineblau',
  '#01579b': 'Ozeanblau',
  '#00695c': 'Dunkeltürkis',
  '#1b5e20': 'Waldgrün',
  '#556b2f': 'Oliv',
  '#000000': 'Schwarz',
  '#0a0a0a': 'Schwarz',
  '#1763b5': 'Blau',
  '#ec4e92': 'Pink',
  '#e9e9e4': 'Hellgrau',
  '#8a8a85': 'Grau',
  '#7aa21b': 'Dunkelgrün',
  '#e8590c': 'Dunkelorange',
  '#7048e8': 'Violett',
  '#0c8599': 'Petrol',
  '#c2255c': 'Beere',
  '#5c940d': 'Olivgrün',
};

export const colorName = (hex: string | undefined) => (hex ? (COLOR_NAMES[hex.toLowerCase()] ?? hex) : 'Standard');

/** Fallback, falls ein Typ (noch) nicht registriert ist; sonst gilt `label` aus dem Typ-Register. */
const TYPE_NAMES: Record<string, string> = {
  sticky: 'Haftnotiz',
  text: 'Text',
  shape: 'Form',
  connector: 'Verbinder',
  pen: 'Zeichnung',
  frame: 'Rahmen',
  image: 'Bild',
};

const SHAPE_NAMES: Record<string, string> = { rect: 'Rechteck', ellipse: 'Ellipse', diamond: 'Raute', triangle: 'Dreieck' };

const typeName = (type: string) => typeDef(type).label ?? TYPE_NAMES[type] ?? 'Objekt';
const shapeName = (kind: string) => shapeKinds.get(kind as never)?.label ?? SHAPE_NAMES[kind];

/** „Haftnotiz „Bühnenplan bis 15.11.“" – kurz genug für eine Ansage. */
export function describeObject(o: Pick<BoardObject, 'type' | 'text' | 'title' | 'shape' | 'locked'>): string {
  const kind = (o.type === 'shape' && o.shape ? shapeName(o.shape) : undefined) ?? typeName(o.type);
  const raw = (o.type === 'frame' ? o.title : o.text)?.replace(/\s+/g, ' ').trim() ?? '';
  const text = raw.length > 60 ? `${raw.slice(0, 57)}…` : raw;
  return `${kind}${text ? ` „${text}“` : ''}${o.locked ? ', gesperrt' : ''}`;
}

/** Ansage der Auswahl, z. B. „Haftnotiz „Ideen“ ausgewählt" oder „3 Objekte ausgewählt". */
export function describeSelection(objects: readonly Pick<BoardObject, 'type' | 'text' | 'title' | 'shape' | 'locked'>[]): string {
  if (objects.length === 0) return 'Auswahl aufgehoben';
  if (objects.length === 1) return `${describeObject(objects[0])} ausgewählt`;
  return `${objects.length} Objekte ausgewählt`;
}

let region: HTMLElement | null = null;

/** Höfliche Ansage über eine unsichtbare aria-live-Region (wird beim ersten Aufruf angelegt). */
export function announce(text: string) {
  if (typeof document === 'undefined') return;
  if (!region || !region.isConnected) {
    region = document.createElement('div');
    region.className = 'sr-only';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    region.dataset.testid = 'announcer';
    document.body.appendChild(region);
  }
  // gleicher Text zweimal hintereinander soll erneut angesagt werden
  region.textContent = region.textContent === text ? `${text} ` : text;
}
