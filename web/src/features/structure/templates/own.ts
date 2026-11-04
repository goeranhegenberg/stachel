// Eigene Vorlagen („Vorlage aus Auswahl speichern“, Paket Q2) ohne React – für den Browser (gallery.tsx, saveTemplate.tsx)
// und die Web-Aktion `structure.insert` der App (native.ts). Gespeichert wird die Auswahl im Format der Zwischenablage
// (Schnappschuss-Objekte wie `serialize` in board/clipboard.ts, Rich-Text als Lesekopie in `content`) auf dem Server
// (`/api/templates`, server/src/user-templates.ts); eingefügt wird wie „Einfügen“ (neue IDs, Bezüge umgeschrieben).
// Bilder/PDFs behalten ihre Datei-ID – auf einem anderen Board legt der Server eine Kopie an, wenn die Person das
// Quell-Board sehen darf (server/src/image-binding.ts), sonst bleibt das Bild leer wie beim Kopieren über Boards.
import type { BoardObject } from '../../../protocol';
import type { Snapshot } from '../../../board/store';
import { isAttached } from '../../../board/connector';
import { contains, objRect } from '../../../board/geometry';
import { isKnownType } from '../../../board/types';

/** Höchstens so viele Objekte je eigene Vorlage (wie der Server). */
export const MAX_OWN_OBJECTS = 500;
/**
 * Größte Vorlage: JSON der Argumente der Web-Aktion `{json: "…"}` in Zeichen – unter der Grenze der Native-API für `args`
 * (256 KB, server/src/native/validate.ts), damit die App jede eigene Vorlage einfügen kann. Der Server prüft dasselbe.
 */
export const MAX_OWN_ARGS_JSON = 250_000;
export const MAX_OWN_NAME = 80;

/** Eine eigene Vorlage, wie `GET /api/templates` sie liefert. */
export interface OwnTemplate {
  id: string;
  name: string;
  createdAt: string;
  objects: BoardObject[];
}

/**
 * Was aus der Auswahl `ids` in die Vorlage kommt (in Zeichenreihenfolge): die gewählten Objekte, bei Rahmen alles, was
 * ganz darin liegt (wie beim Verschieben), und Verbinder, deren beide Enden mitkommen (wie beim Kopieren).
 */
export function templateFromSelection(snap: Pick<Snapshot, 'ordered' | 'byId'>, ids: readonly string[]): BoardObject[] {
  const take = new Set<string>();
  for (const id of ids) {
    const o = snap.byId.get(id);
    if (!o) continue;
    take.add(id);
    if (o.type === 'frame') {
      for (const c of snap.ordered) if (c.type !== 'frame' && c.type !== 'connector' && contains(objRect(o), objRect(c))) take.add(c.id);
    }
  }
  for (const c of snap.ordered) {
    if (c.type === 'connector' && !take.has(c.id) && isAttached(c.from) && isAttached(c.to) && take.has(c.from.objectId) && take.has(c.to.objectId)) take.add(c.id);
  }
  return snap.ordered.filter((o) => take.has(o.id));
}

/** Größe der Argumente, mit denen die App die Vorlage einfügt (`structure.insert`). */
export const insertArgsSize = (objs: readonly unknown[]) => JSON.stringify({ json: JSON.stringify(objs) }).length;

/** Name prüfen: Leerraum zusammenfassen; null = leer oder zu lang. */
export function cleanTemplateName(v: string): string | null {
  const s = v.replace(/\s+/g, ' ').trim();
  return s && s.length <= MAX_OWN_NAME ? s : null;
}

/** Warum sich die Auswahl nicht als Vorlage speichern lässt (null = geht). */
export function saveProblem(objs: readonly BoardObject[]): string | null {
  if (!objs.length) return 'Wähle zuerst aus, was in die Vorlage soll.';
  if (objs.length > MAX_OWN_OBJECTS) return `Eine Vorlage hat höchstens ${MAX_OWN_OBJECTS} Objekte.`;
  if (insertArgsSize(objs) > MAX_OWN_ARGS_JSON) return 'Die Auswahl ist zu groß für eine Vorlage.';
  return null;
}

const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_KEYS = 80;
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const isDoc = (v: unknown) => !!v && typeof v === 'object' && (v as { type?: unknown }).type === 'doc' && Array.isArray((v as { content?: unknown }).content);

/**
 * Objekte einer gespeicherten Vorlage tolerant übernehmen (Daten vom Server bzw. von der App): nur bekannte Typen mit
 * gültiger ID und Lage, einfache Feldnamen, Rich-Text nur als Dokument; `z`, Ersteller:in, Sperre fallen weg (setzt das
 * Einfügen neu). Unbrauchbares wird ausgelassen.
 */
export function cleanTemplateObjects(raw: unknown): BoardObject[] {
  if (!Array.isArray(raw)) return [];
  const out: BoardObject[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, MAX_OWN_OBJECTS)) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || !ID_RE.test(o.id) || seen.has(o.id) || !isKnownType(o.type) || ![o.x, o.y, o.w, o.h].every(num)) continue;
    const keys = Object.keys(o);
    if (keys.length > MAX_KEYS) continue;
    const clean: Record<string, unknown> = {};
    for (const k of keys) {
      if (!KEY_RE.test(k) || k === 'z' || k === 'createdBy' || k === 'updatedAt' || k === 'locked') continue;
      if (k === 'content' && !isDoc(o.content)) continue;
      clean[k] = o[k];
    }
    seen.add(o.id);
    out.push({ ...clean, z: '', createdBy: '', updatedAt: '' } as BoardObject);
  }
  return out;
}

/** Passt die eigene Vorlage zur Suche der Galerie? */
export const ownMatches = (t: Pick<OwnTemplate, 'name'>, q: string) => {
  const needle = q.trim().toLowerCase();
  return !needle || `${t.name} meine vorlagen`.toLowerCase().includes(needle);
};
