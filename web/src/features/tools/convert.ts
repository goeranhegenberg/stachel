// Typ wechseln (Q3): Haftnotiz ↔ Form ↔ Text ↔ Karte. Das Objekt behält ID, Lage, Ebene, Gruppe, Autor:in,
// Kommentare, Abstimmungen und Verbinder; Text (samt Rich-Text) und Farbe bleiben, wo es passt. Felder, die nur der alte
// Typ kennt, fallen weg. React-frei: Web (organize.tsx), App (Web-Aktion `tools.convert`, native-organize.ts) und
// Server rechnen hiermit. Ein Rückgängig-Schritt.
import * as Y from 'yjs';
import { RICH_TEXT_FIELD, STICKY_COLORS, type BoardObject } from '../../protocol';
import type { BoardStore } from '../../board/store';

export type ConvertType = 'sticky' | 'shape' | 'text' | 'card';
export const CONVERT_TYPES: readonly ConvertType[] = ['sticky', 'shape', 'text', 'card'];
export const CONVERT_LABELS: Record<ConvertType, string> = { sticky: 'Haftnotiz', shape: 'Form', text: 'Text', card: 'Karte' };

/** Felder je Typ (docs/native_paritaet.md), die beim Wechsel wegfallen, wenn der neue Typ sie nicht kennt. */
const FIELDS: Record<ConvertType, readonly string[]> = {
  sticky: ['color', 'text', 'content', 'fontSize', 'bold', 'italic', 'strike', 'align', 'valign', 'fontFamily', 'tags'],
  text: ['color', 'text', 'content', 'fontSize', 'bold', 'italic', 'strike', 'align', 'fontFamily', 'autoWidth'],
  shape: ['shape', 'color', 'stroke', 'strokeWidth', 'dash', 'fillOpacity', 'text', 'content', 'fontSize', 'bold', 'italic', 'strike', 'align', 'valign', 'fontFamily'],
  card: ['text', 'desc', 'status', 'due', 'tags', 'assignee', 'color'],
};

const CARD_W = 300;
const CARD_COLOR = '#1763b5';
const INK = '#0a0a0a';
const TEXT_FS = 28;

export const isConvertType = (t: string): t is ConvertType => (CONVERT_TYPES as readonly string[]).includes(t);

/** Objekte, deren Typ sich wechseln lässt (ungesperrt, einer der vier Typen). */
export const convertible = (o: BoardObject) => !o.locked && isConvertType(o.type);

/** Mögliche Ziele für eine Auswahl: alle vier ohne den gemeinsamen Typ; leer, wenn etwas nicht wechseln kann. */
export function convertTargets(objs: readonly BoardObject[]): ConvertType[] {
  if (!objs.length || !objs.every(convertible)) return [];
  const same = objs.every((o) => o.type === objs[0]!.type) ? objs[0]!.type : null;
  return CONVERT_TYPES.filter((t) => t !== same);
}

/** Klartext einer Karte als ein Text: Titel, darunter die Beschreibung. */
const cardText = (o: BoardObject) => [o.text ?? '', typeof (o as { desc?: unknown }).desc === 'string' ? ((o as { desc?: string }).desc ?? '') : ''].filter(Boolean).join('\n');

/**
 * Neue Felder für `o` als Typ `to` (undefined = Feld entfernen), ohne `type`. Farbe: Fläche bleibt Fläche
 * (Notiz ↔ Form), Text-Objekte werden schwarz geschrieben, Karten bekommen den blauen Streifen.
 */
export function convertFields(o: BoardObject, to: ConvertType): Record<string, unknown> {
  const from = o.type as ConvertType;
  const out: Record<string, unknown> = {};
  for (const k of FIELDS[from]) if (!FIELDS[to].includes(k)) out[k] = undefined;
  const fill = from === 'sticky' || from === 'shape' ? o.color : undefined;
  switch (to) {
    case 'sticky':
      out.color = fill ?? STICKY_COLORS[0];
      out.fontSize = undefined; // Haftnotiz: Schrift passt sich an
      if (from === 'text') Object.assign(out, { w: Math.max(200, Math.round(o.w)), h: Math.max(200, Math.round(o.h)) });
      break;
    case 'shape':
      Object.assign(out, { shape: 'rect', color: fill ?? '#ffffff', stroke: INK, strokeWidth: 2, fontSize: o.fontSize ?? 20 });
      if (from === 'text') Object.assign(out, { w: Math.max(180, Math.round(o.w)), h: Math.max(120, Math.round(o.h)) });
      break;
    case 'text':
      Object.assign(out, { color: from === 'text' ? o.color : INK, fontSize: o.fontSize ?? TEXT_FS, autoWidth: undefined, valign: undefined });
      break;
    case 'card':
      Object.assign(out, { color: CARD_COLOR, w: Math.max(CARD_W, Math.round(o.w)) });
      break;
  }
  if (from === 'card' && to !== 'card') {
    out.text = cardText(o);
    out.desc = undefined;
  }
  if (to === 'card' && from !== 'card') {
    out.text = o.text ?? '';
    out.content = undefined; // Kartentitel ist Klartext
  }
  return out;
}

/**
 * Typ der Objekte `ids` wechseln (Gesperrtes und Unpassendes bleibt). `height(o)` = Höhe danach (Karten aus dem Inhalt,
 * Text-Objekte misst das Web im DOM nach). Liefert die gewechselten IDs.
 */
export function convertInStore(store: BoardStore, ids: readonly string[], to: ConvertType, height?: (o: BoardObject) => number | undefined): string[] {
  const done: string[] = [];
  const now = new Date().toISOString();
  store.stopCapturing();
  store.transact(() => {
    for (const id of new Set(ids)) {
      const o = store.get(id);
      const m = store.objects.get(id);
      if (!o || !m || !convertible(o) || o.type === to) continue;
      const fields = convertFields(o, to);
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) m.delete(k);
        else m.set(k, v);
      }
      m.set('type', to);
      // Rich-Text: Klartext ohne passenden Inhalt (z. B. aus einer Karte) wird beim ersten Bearbeiten übernommen
      if (to !== 'card' && fields.text !== undefined && m.get(RICH_TEXT_FIELD) instanceof Y.XmlFragment) m.delete(RICH_TEXT_FIELD);
      const after = { ...o, ...fields, type: to } as BoardObject;
      const h = height?.(after);
      if (h !== undefined && h !== o.h) m.set('h', h);
      m.set('updatedAt', now);
      done.push(id);
    }
  });
  store.stopCapturing();
  return done;
}
