// Vorlagenpakete der Instanz: Wer eine Instanz betreibt, legt eigene Vorlagen als JSON-Dateien in einen Ordner
// (STACHEL_TEMPLATES_DIR, Standard `<DATA_DIR>/templates`, im Container `/data/templates`). Die Galerie im Web und in der
// App zeigt sie unter einer eigenen Kategorie (STACHEL_TEMPLATES_CATEGORY, Standard der Name der Instanz bzw.
// „Weitere Vorlagen“) neben den eingebauten Vorlagen. Kein Code nötig, kein Neustart: Der Ordner wird höchstens alle
// 30 s neu gelesen, wenn sich Dateien geändert haben.
//
// Format je Datei (`*.json`, UTF-8) – Objekte im Format der Zwischenablage wie bei den eigenen Vorlagen
// (user-templates.ts), also genau das, was `GET /api/templates` liefert:
//   {"templates": [{"id": "ablauf", "name": "Ablauf", "desc": "…", "keywords": ["…"], "objects": [ … ]}, …]}
//   oder eine einzelne Vorlage {"name": …, "objects": […]} oder eine Liste [{…}, …].
// Ungültige Dateien und Vorlagen werden mit Warnung im Log übersprungen. Vertrag: docs/contract.md §3 „Vorlagen der
// Instanz“, Anleitung: docs/selfhosting.md.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { cleanName, MAX_TEMPLATE_ARGS_JSON, MAX_TEMPLATE_OBJECTS, validObject } from './user-templates.js';

export interface TemplatePackConfig {
  /** Ordner mit den `*.json`-Dateien; fehlt er, gibt es keine Vorlagen der Instanz */
  dir: string;
  /** Name der Kategorie in der Galerie */
  category: string;
}

export interface PackTemplate {
  id: string;
  name: string;
  desc: string;
  keywords: string[];
  objects: Record<string, unknown>[];
}

/** Höchstens so viele Vorlagen insgesamt, so große Dateien und so lange Beschreibungen. */
export const MAX_PACK_TEMPLATES = 200;
export const MAX_PACK_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DESC = 300;
const MAX_KEYWORDS = 20;
const RESCAN_MS = 30_000;

const str = (v: string | undefined) => (v ?? '').trim();

/** Einstellungen aus der Umgebung (config.ts). */
export function loadTemplatePackConfig(env: NodeJS.ProcessEnv, dataDir: string, brand: string): TemplatePackConfig {
  const category = str(env.STACHEL_TEMPLATES_CATEGORY) || (brand && brand !== 'Stachel' ? brand : 'Weitere Vorlagen');
  return { dir: path.resolve(str(env.STACHEL_TEMPLATES_DIR) || path.join(dataDir, 'templates')), category: category.slice(0, 40) };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** Eine Vorlage aus der Datei prüfen; Fehlertext oder die bereinigte Vorlage (ID noch ohne Dateiname). */
export function parsePackTemplate(raw: unknown, fallbackId: string): PackTemplate | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'keine Vorlage (Objekt erwartet)';
  const t = raw as Record<string, unknown>;
  const name = cleanName(t.name);
  if (!name) return 'Name fehlt oder ist zu lang';
  const objs = t.objects;
  if (!Array.isArray(objs) || !objs.length) return `„${name}“: keine Objekte`;
  if (objs.length > MAX_TEMPLATE_OBJECTS) return `„${name}“: mehr als ${MAX_TEMPLATE_OBJECTS} Objekte`;
  if (!objs.every(validObject)) return `„${name}“: ungültige Objekte (id, type, x, y, w, h nötig)`;
  if (new Set(objs.map((o) => o.id)).size !== objs.length) return `„${name}“: doppelte Objekt-IDs`;
  if (JSON.stringify({ json: JSON.stringify(objs) }).length > MAX_TEMPLATE_ARGS_JSON) return `„${name}“: zu groß`;
  const desc = typeof t.desc === 'string' ? t.desc.replace(/\s+/g, ' ').trim().slice(0, MAX_DESC) : '';
  const keywords = Array.isArray(t.keywords)
    ? t.keywords
        .filter((k): k is string => typeof k === 'string')
        .map((k) => k.trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, MAX_KEYWORDS)
    : [];
  const id = (typeof t.id === 'string' && slug(t.id)) || slug(name) || fallbackId;
  return { id, name, desc, keywords, objects: objs };
}

/** Alle Vorlagen aus einem Dateiinhalt (Paket, Liste oder einzelne Vorlage). */
function templatesOf(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray((data as { templates?: unknown }).templates)) return (data as { templates: unknown[] }).templates;
  return [data];
}

type Warn = (msg: string) => void;

/** Ordner einlesen (Dateien alphabetisch, Vorlagen in Dateireihenfolge). */
export function readTemplatePacks(dir: string, warn: Warn = () => {}): PackTemplate[] {
  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
  const out: PackTemplate[] = [];
  const ids = new Set<string>();
  for (const f of files) {
    const file = path.join(dir, f);
    let data: unknown;
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) continue;
      if (st.size > MAX_PACK_FILE_BYTES) {
        warn(`Vorlagen der Instanz: ${f} ist größer als ${MAX_PACK_FILE_BYTES / 1024 / 1024} MB, übersprungen`);
        continue;
      }
      data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    } catch (e) {
      warn(`Vorlagen der Instanz: ${f} ist kein gültiges JSON (${(e as Error).message}), übersprungen`);
      continue;
    }
    const base = slug(path.basename(f, path.extname(f))) || 'paket';
    templatesOf(data).forEach((raw, i) => {
      if (out.length >= MAX_PACK_TEMPLATES) return;
      const t = parsePackTemplate(raw, String(i + 1));
      if (typeof t === 'string') return warn(`Vorlagen der Instanz: ${f}, Vorlage ${i + 1}: ${t}, übersprungen`);
      let id = `${base}.${t.id}`;
      for (let n = 2; ids.has(id); n++) id = `${base}.${t.id}-${n}`;
      ids.add(id);
      out.push({ ...t, id });
    });
  }
  if (out.length >= MAX_PACK_TEMPLATES) warn(`Vorlagen der Instanz: höchstens ${MAX_PACK_TEMPLATES} Vorlagen, der Rest fehlt`);
  return out;
}

/** Fingerabdruck des Ordners (Namen, Größen, Änderungszeiten), um nur bei Änderungen neu zu lesen. */
function signature(dir: string): string {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.json'))
      .sort()
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return `${f}:${st.size}:${st.mtimeMs}`;
      })
      .join('|');
  } catch {
    return '';
  }
}

/** Vorlagen der Instanz mit Zwischenspeicher. */
export class TemplatePacks {
  private list: PackTemplate[] = [];
  private sig: string | null = null;
  private checkedAt = 0;

  constructor(
    readonly cfg: TemplatePackConfig,
    private readonly warn: Warn = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  /** Aktuelle Liste; liest den Ordner neu, wenn er sich geändert hat (höchstens alle 30 s geprüft). */
  templates(): PackTemplate[] {
    const t = this.now();
    if (this.sig !== null && t - this.checkedAt < RESCAN_MS) return this.list;
    this.checkedAt = t;
    const sig = signature(this.cfg.dir);
    if (sig !== this.sig) {
      this.sig = sig;
      this.list = sig ? readTemplatePacks(this.cfg.dir, this.warn) : [];
    }
    return this.list;
  }
}

/** `GET /api/templates/instance` (im Scope mit Sitzungsprüfung registrieren): `{ok, category, templates}`. */
export function registerTemplatePacks(scope: FastifyInstance, packs: TemplatePacks) {
  scope.get('/api/templates/instance', async () => ({ ok: true, category: packs.cfg.category, templates: packs.templates() }));
}
