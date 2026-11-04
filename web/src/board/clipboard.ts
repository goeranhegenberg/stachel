// Kopieren/Einfügen/Duplizieren: Objekte mit neuen IDs klonen, Verbinder-Bezüge umschreiben.
import { nanoid } from 'nanoid';
import type { BoardObject } from '../protocol';
import type { ObjectLookup } from './connector';
import type { NewObject } from './store';
import { plainTextOf, typeInfo, type CloneContext } from './types';

export const CLIPBOARD_MARKER = 'stachel/objects@1';

export interface ClipboardPayload {
  marker: typeof CLIPBOARD_MARKER;
  objects: BoardObject[];
}

/**
 * Klont `objs` versetzt um (dx, dy). Verbinder-Enden zu mitkopierten Objekten zeigen auf die Kopie,
 * Enden zu nicht kopierten Objekten werden zu freien Punkten. `idMap` bekommt alt → neu (für die neue Auswahl).
 */
export function cloneObjects(objs: readonly BoardObject[], dx: number, dy: number, lookup: ObjectLookup, idMap = new Map<string, string>()): NewObject[] {
  for (const o of objs) idMap.set(o.id, nanoid());
  // Kopien bilden eigene Gruppen – aber nur, wenn mindestens zwei Mitglieder mitkopiert werden (keine Einzelgruppen)
  const groupMap = new Map<string, string>();
  const count = new Map<string, number>();
  for (const o of objs) if (o.groupId) count.set(o.groupId, (count.get(o.groupId) ?? 0) + 1);
  const newGroup = (g: string | undefined) => {
    if (!g || count.get(g)! < 2) return undefined;
    if (!groupMap.has(g)) groupMap.set(g, nanoid(10));
    return groupMap.get(g);
  };
  const ctx: CloneContext = { map: (id) => idMap.get(id), lookup, dx, dy };
  const out: NewObject[] = [];
  for (const o of objs) {
    const { id, z: _z, createdBy: _c, updatedAt: _u, ...rest } = o;
    let clone: NewObject | null = { ...rest, id: idMap.get(id)!, x: o.x + dx, y: o.y + dy, locked: undefined, groupId: newGroup(o.groupId) };
    // Bezüge auf andere Objekte (z. B. Verbinder-Enden) je Typ umschreiben
    const remap = typeInfo(o.type).remap;
    if (remap) clone = remap(clone, o, ctx);
    if (clone) out.push(clone);
  }
  return out;
}

export function serialize(objs: readonly BoardObject[]): string {
  const payload: ClipboardPayload = { marker: CLIPBOARD_MARKER, objects: [...objs] };
  return JSON.stringify(payload);
}

/** Texte der Objekte zeilenweise – das landet beim Einfügen in Mail/Messenger. */
export function plainText(objs: readonly BoardObject[]): string {
  return objs
    .map((o) => plainTextOf(o)?.trim())
    .filter((t): t is string => !!t)
    .join('\n');
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML für die Zwischenablage: Stachel-Nutzdaten im meta-Element, dazu lesbarer Text. */
export function toHtml(objs: readonly BoardObject[]): string {
  const body = plainText(objs).split('\n').map(escapeHtml).join('<br>');
  return `<meta data-stachel="${encodeURIComponent(serialize(objs))}"><div>${body}</div>`;
}

/** Stachel-Objekte aus text/html oder (ältere Version) aus text/plain. */
export function parseClipboard(html: string, text: string): BoardObject[] | null {
  const m = /data-stachel="([^"]*)"/.exec(html);
  if (m) {
    try {
      const objs = parse(decodeURIComponent(m[1]));
      if (objs) return objs;
    } catch {
      /* kaputte Daten: wie fremder Inhalt behandeln */
    }
  }
  return text ? parse(text) : null;
}

export function parse(text: string): BoardObject[] | null {
  if (!text.includes(CLIPBOARD_MARKER)) return null;
  try {
    const data = JSON.parse(text) as ClipboardPayload;
    if (data.marker !== CLIPBOARD_MARKER || !Array.isArray(data.objects)) return null;
    return data.objects.filter((o) => o && typeof o.id === 'string' && typeof o.type === 'string');
  } catch {
    return null;
  }
}
