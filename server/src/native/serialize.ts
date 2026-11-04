// Objekt-JSON der Native-API (docs/contract.md §8.5): Felder roh, Y-Felder über die Codecs der Web-App.
// Unbekannte Typen und Felder bleiben drin – die App zeigt einen Platzhalter, der Server ändert nur, was sie schickt.
import * as Y from 'yjs';
import { DOC_OBJECTS } from '../../../shared/protocol.js';
import { NATIVE_BELOW_TYPES, type NativeObject } from '../../../shared/native.js';
import { WEB } from '#stachel-web';
import { kindOf, typed } from '../versions.js';

const BELOW = new Set<string>(NATIVE_BELOW_TYPES);

/** Beliebigen Y-Typ als JSON (XmlFragment = ProseMirror-JSON, Text = String, verschachtelte Typen ebenso). */
export function typeToJson(v: Y.AbstractType<any>): unknown {
  if (v instanceof Y.XmlFragment) return WEB.fragmentToJson(v);
  if (v instanceof Y.Text) return v.toString();
  if (v instanceof Y.Map) {
    const o: Record<string, unknown> = {};
    v.forEach((x, k) => {
      o[k] = x instanceof Y.AbstractType ? typeToJson(x) : x;
    });
    return o;
  }
  if (v instanceof Y.Array) return v.toArray().map((x) => (x instanceof Y.AbstractType ? typeToJson(x) : x));
  return v.toJSON();
}

function fieldValue(field: string, v: unknown): unknown {
  if (!(v instanceof Y.AbstractType)) return v;
  const viaCodec = WEB.yFieldToJson(field, v);
  return viaCodec !== undefined ? viaCodec : typeToJson(v);
}

/** Objekt aus seinem Y.Map; null bei kaputten Einträgen bzw. ohne `type` (die ignoriert das Web auch). */
export function serializeObject(id: string, m: unknown): NativeObject | null {
  if (!(m instanceof Y.Map)) return null;
  const out: Record<string, unknown> = {};
  m.forEach((v, k) => {
    out[k] = fieldValue(k, v);
  });
  if (typeof out.type !== 'string' || !out.type) return null;
  out.id = id;
  return out as NativeObject;
}

const zOf = (o: NativeObject) => (typeof o.z === 'string' ? o.z : '');

/** Zeichenreihenfolge (§8.4): Rahmen zuerst, dann `z` Byte-weise, bei Gleichstand `id`. */
export function compareNative(a: NativeObject, b: NativeObject): number {
  const fa = BELOW.has(a.type) ? 0 : 1;
  const fb = BELOW.has(b.type) ? 0 : 1;
  if (fa !== fb) return fa - fb;
  return WEB.compareKeys(zOf(a), zOf(b)) || WEB.compareKeys(a.id, b.id);
}

/** Alle Objekte eines Dokuments, von unten nach oben. */
export function serializeObjects(doc: Y.Doc): NativeObject[] {
  const out: NativeObject[] = [];
  doc.getMap<unknown>(DOC_OBJECTS).forEach((m, id) => {
    const o = serializeObject(id, m);
    if (o) out.push(o);
  });
  return out.sort(compareNative);
}

/** Namen der Feature-Strukturen (alles außer `objects`) mit Inhalt. */
export function extNames(doc: Y.Doc): string[] {
  return [...doc.share.keys()].filter((n) => n !== DOC_OBJECTS && kindOf(doc.share.get(n)) !== null).sort();
}

/** Feature-Struktur als JSON (§8.7); null = gibt es nicht bzw. leer. */
export function serializeExt(doc: Y.Doc, name: string): unknown {
  const kind = kindOf(doc.share.get(name));
  if (!kind) return null;
  return typeToJson(typed(doc, name, kind));
}

/** Gewünschte Feature-Strukturen (`want`: "ext" = alle, sonst einzelne Namen). */
export function wantsExt(want: ReadonlySet<string>, name: string): boolean {
  return want.has('ext') || want.has(name);
}

/** Feld-Unterschied zweier Objekt-JSONs; null = gleich. */
export function diffObject(prev: NativeObject, next: NativeObject): { set?: Record<string, unknown>; unset?: string[] } | null {
  let set: Record<string, unknown> | undefined;
  let unset: string[] | undefined;
  for (const [k, v] of Object.entries(next)) {
    if (!(k in prev) || !sameJson(prev[k], v)) (set ??= {})[k] = v;
  }
  for (const k of Object.keys(prev)) if (!(k in next)) (unset ??= []).push(k);
  if (!set && !unset) return null;
  return { ...(set ? { set } : {}), ...(unset ? { unset } : {}) };
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
