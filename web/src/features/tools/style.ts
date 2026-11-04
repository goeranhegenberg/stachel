// Format übertragen ohne React (formatPainter.tsx, Web-Aktion `tools.pasteStyle` der App): Positivliste der
// Formatfelder je Typ, Format eines Objekts, Patch für ein Zielobjekt.
import type { BoardObject } from '../../protocol';
import type { Patch } from '../../board/store';

/** Textformat: gilt bei allen Typen mit Text und wird auch zwischen verschiedenen Typen übertragen */
export const TEXT_KEYS = ['fontSize', 'fontFamily', 'bold', 'italic', 'strike', 'align'] as const;
/**
 * Positivliste der Formatfelder je Typ („Stil einfügen“: Farbe, Schrift, Rand, Linie, Ausrichtung).
 * Inhalt, Lage, Bezüge und Daten (Beschreibung, Person, Datum, Status, Tags, Tabelleninhalt, Mindmap-Baum, Links …)
 * werden nie übertragen. Unbekannte Typen: nur `color`.
 */
export const STYLE_KEYS: Record<string, readonly string[]> = {
  sticky: ['color', ...TEXT_KEYS, 'valign'],
  text: ['color', ...TEXT_KEYS],
  shape: ['color', 'stroke', 'strokeWidth', 'dash', 'fillOpacity', ...TEXT_KEYS, 'valign'],
  connector: ['color', 'strokeWidth', 'dash', 'lineStyle', 'arrowStart', 'arrowEnd', 'capStart', 'capEnd', 'fontSize', 'fontFamily', 'bold', 'italic', 'strike'],
  pen: ['color', 'strokeWidth', 'marker'],
  frame: ['color'],
  card: ['color'],
  table: ['color', 'tableHead'],
  mindnode: ['color'],
  icon: ['color'],
  sticker: [],
  image: [],
};
export const styleKeys = (type: string) => STYLE_KEYS[type] ?? ['color'];
/** Typen, deren `color` die Füllung ist, bzw. die Strich-/Schriftfarbe */
const FILL_TYPES = new Set(['sticky', 'shape', 'frame']);
const INK_TYPES = new Set(['text', 'connector', 'pen']);

export type Style = { type: string; fields: Record<string, unknown> };

/** Was ein Typ für das Übertragen zwischen Typen kann (Editor: `typeDef(type).textual`/`.valign`). */
export interface StyleTraits {
  textual(type: string): boolean;
  valign(type: string): boolean;
}

/** Eigenschaften der Kern-Typen ohne Editor-Register (Server); ein Web-Test hält sie gleich mit `typeDef`. */
const TEXTUAL = new Set(['sticky', 'text', 'shape']);
const VALIGN = new Set(['sticky', 'shape']);
export const CORE_STYLE_TRAITS: StyleTraits = { textual: (t) => TEXTUAL.has(t), valign: (t) => VALIGN.has(t) };

export function extractStyle(o: BoardObject): Style {
  const cur = o as unknown as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const k of styleKeys(o.type)) if (cur[k] !== undefined) fields[k] = structuredClone(cur[k]);
  return { type: o.type, fields };
}

/** Patch, der das Format `s` auf `o` überträgt; null = nichts Passendes. */
export function stylePatch(s: Style, o: BoardObject, traits: StyleTraits): Patch | null {
  const cur = o as unknown as Record<string, unknown>;
  const p: Record<string, unknown> = {};
  if (s.type === o.type) {
    // gleicher Typ: alle Formatfelder des Typs, fehlende beim Vorbild werden zurückgesetzt
    for (const k of styleKeys(o.type)) p[k] = s.fields[k];
  } else {
    if (traits.textual(o.type) && traits.textual(s.type)) {
      const both = (k: string) => styleKeys(o.type).includes(k) && styleKeys(s.type).includes(k);
      for (const k of TEXT_KEYS) if (both(k)) p[k] = s.fields[k];
      if (traits.valign(o.type) && traits.valign(s.type)) p.valign = s.fields.valign;
    }
    const sameKind = (FILL_TYPES.has(s.type) && FILL_TYPES.has(o.type)) || (INK_TYPES.has(s.type) && INK_TYPES.has(o.type));
    if (sameKind && s.fields.color !== undefined) p.color = s.fields.color;
  }
  // nur echte Änderungen
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) if (JSON.stringify(cur[k]) !== JSON.stringify(v)) out[k] = v;
  return Object.keys(out).length ? (out as Patch) : null;
}

/** Patches für das Format `s` auf `objs` (gesperrte bleiben); `adjust` = Typ-Anpassung (Textbreite bei autoWidth). */
export function stylePatches(s: Style, objs: readonly BoardObject[], traits: StyleTraits, adjust: (o: BoardObject, p: Patch) => Patch): Record<string, Patch> {
  const patches: Record<string, Patch> = {};
  for (const o of objs) {
    if (o.locked) continue;
    const p = stylePatch(s, o, traits);
    if (p) patches[o.id] = adjust(o, p);
  }
  return patches;
}
