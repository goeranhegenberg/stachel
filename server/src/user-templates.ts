// Eigene Vorlagen („Vorlage aus Auswahl speichern“, Paket Q2): je Person privat, gerätübergreifend. Gespeichert wird die
// Auswahl im Format der Zwischenablage (`stachel/objects@1`, web/src/board/clipboard.ts: Schnappschuss-Objekte, Rich-Text
// als Lesekopie in `content`), eingefügt wird wie „Einfügen“ (neue IDs, Verbinder-Enden und Mindmap-Eltern umgeschrieben).
// Bilder/PDFs behalten ihre Datei-ID; beim Einfügen auf ein anderes Board kopiert image-binding.ts die Datei, wenn die
// Person das Quell-Board noch sehen darf (sonst bleibt das Bild leer, wie beim Kopieren über Boards hinweg).
// Vertrag: docs/contract.md §3 „Eigene Vorlagen“. Routen im Scope mit Sitzungsprüfung (Cookie, Bearer sts_… oder stk_…).
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { nowIso, type Db } from './db.js';
import { sendError } from './http-util.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS user_templates (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  name TEXT NOT NULL,
  objects TEXT NOT NULL,          -- JSON: BoardObject[] wie in der Zwischenablage
  object_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS user_templates_user ON user_templates (user_key, created_at);
`;

/** Höchstens so viele eigene Vorlagen je Person. */
export const MAX_USER_TEMPLATES = 50;
/** Höchstens so viele Objekte je Vorlage (wie die Web-Aktion `structure.insert`). */
export const MAX_TEMPLATE_OBJECTS = 500;
/**
 * Größte Vorlage: Zeichen der Argumente `{json: "…"}`, mit denen die App sie einfügt (Web-Aktion `structure.insert`) –
 * unter der Grenze der Native-API für `args` (256 KB); wie MAX_OWN_ARGS_JSON in web/src/features/structure/templates/own.ts.
 */
export const MAX_TEMPLATE_ARGS_JSON = 250_000;
export const MAX_TEMPLATE_NAME = 80;

export interface UserTemplate {
  id: string;
  name: string;
  createdAt: string;
  objects: Record<string, unknown>[];
}

interface Row {
  id: string;
  name: string;
  objects: string;
  created_at: string;
}

export function setupUserTemplates(db: Db) {
  db.exec(SCHEMA);
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Ein Objekt der Auswahl: Mindestform eines Board-Objekts (Rest prüft der Store beim Einfügen tolerant). */
export function validObject(o: unknown): o is Record<string, unknown> {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const r = o as Record<string, unknown>;
  return typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 64 && typeof r.type === 'string' && r.type.length <= 32 && num(r.x) && num(r.y) && num(r.w) && num(r.h);
}

/** Name prüfen: Leerraum zusammenfassen; null = ungültig. */
export function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s && s.length <= MAX_TEMPLATE_NAME ? s : null;
}

const toTemplate = (r: Row): UserTemplate => ({ id: r.id, name: r.name, createdAt: r.created_at, objects: JSON.parse(r.objects) as Record<string, unknown>[] });

/** Eigene Vorlagen der Person, neueste zuerst. */
export function listUserTemplates(db: Db, userKey: string): UserTemplate[] {
  const rows = db.prepare('SELECT id, name, objects, created_at FROM user_templates WHERE user_key = ? ORDER BY created_at DESC, id').all(userKey) as unknown as Row[];
  return rows.map(toTemplate);
}

/** `GET|POST /api/templates`, `DELETE /api/templates/:id` (im Scope mit Sitzungsprüfung registrieren). */
export function registerUserTemplates(scope: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  scope.get('/api/templates', async (req) => ({ ok: true, templates: listUserTemplates(db, req.session!.userKey) }));

  scope.post<{ Body: { name?: unknown; objects?: unknown } }>('/api/templates', async (req, reply) => {
    const body = (req.body ?? {}) as { name?: unknown; objects?: unknown };
    const name = cleanName(body.name);
    if (!name) return sendError(reply, 400, 'invalid_input', `Bitte gib einen Namen mit höchstens ${MAX_TEMPLATE_NAME} Zeichen ein.`);
    const objs = body.objects;
    if (!Array.isArray(objs) || !objs.length) return sendError(reply, 400, 'invalid_input', 'Wähle zuerst aus, was in die Vorlage soll.');
    if (objs.length > MAX_TEMPLATE_OBJECTS) return sendError(reply, 400, 'too_large', `Eine Vorlage hat höchstens ${MAX_TEMPLATE_OBJECTS} Objekte.`);
    if (!objs.every(validObject)) return sendError(reply, 400, 'invalid_input', 'Die Auswahl enthält ungültige Objekte.');
    if (new Set(objs.map((o) => o.id)).size !== objs.length) return sendError(reply, 400, 'invalid_input', 'Die Auswahl enthält doppelte Objekte.');
    const json = JSON.stringify(objs);
    if (JSON.stringify({ json }).length > MAX_TEMPLATE_ARGS_JSON) return sendError(reply, 400, 'too_large', 'Die Auswahl ist zu groß für eine Vorlage.');
    const key = req.session!.userKey;
    const count = (db.prepare('SELECT COUNT(*) AS n FROM user_templates WHERE user_key = ?').get(key) as { n: number }).n;
    if (count >= MAX_USER_TEMPLATES) return sendError(reply, 409, 'limit', `Du hast schon ${MAX_USER_TEMPLATES} eigene Vorlagen. Lösche zuerst eine.`);
    const row: Row = { id: randomBytes(9).toString('base64url'), name, objects: json, created_at: nowIso() };
    db.prepare('INSERT INTO user_templates (id, user_key, name, objects, object_count, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(row.id, key, row.name, row.objects, objs.length, row.created_at);
    return { ok: true, template: toTemplate(row) };
  });

  scope.delete<{ Params: { id: string } }>('/api/templates/:id', async (req, reply) => {
    const r = db.prepare('DELETE FROM user_templates WHERE id = ? AND user_key = ?').run(req.params.id, req.session!.userKey);
    if (!r.changes) return sendError(reply, 404, 'not_found', 'Diese Vorlage gibt es nicht.');
    return { ok: true };
  });
}
