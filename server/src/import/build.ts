// Board aus dem Abbild bauen (docs/features/import.md §3 Schritt build): Das Yjs-Dokument entsteht offline mit dem
// Web-Store des Servers (#stachel-web, wie NativeWriter): Objekte in der Reihenfolge von map.ts mit aufsteigenden
// Ebenen-Schlüsseln, danach Mindmaps über `mind.tree`. Geladene Dateien bekommen ihre ID, fehlgeschlagene werden zu einem
// grauen Rechteck „Bild nicht übernommen“. Dann Board-Zeile, Dokument und Datei-Zeilen in EINER Transaktion (wie
// copyBoard), `created`-Ereignis und benannte Version „Import aus Miro (TT.MM.JJJJ)“.
import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { boardDocName, DOC_OBJECTS, RICH_TEXT_FIELD } from '../../../shared/protocol.js';
import { WEB } from '#stachel-web';
import { nowIso, type Db } from '../db.js';
import { randomToken } from '../sessions.js';
import type { BoardEvents } from '../board-events.js';
import type { MappedBoard } from './miro/types.js';

const MAX_TITLE = 120;
export const PLACEHOLDER_FILL = '#e6e6e6';
export const PLACEHOLDER_STROKE = '#9b9b9b';

/** Eine geladene, schon gespeicherte Datei (data/images/<id>). */
export interface StoredFile {
  id: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

export interface BuildDeps {
  db: Db;
  imagesDir: string;
  events?: BoardEvents;
  /** benannte Version (versions.saveNamed) */
  saveVersion?: (boardId: string, name: string, by: { key: string; name: string }) => Promise<unknown>;
}

/** „Import aus Miro (04.11.2026)“ */
export function versionName(at: Date = new Date()): string {
  const d = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' }).format(at);
  return `Import aus Miro (${d})`;
}

export function boardTitle(t: string): string {
  const s = t.replace(/\s+/g, ' ').trim();
  return (s || 'Import aus Miro').slice(0, MAX_TITLE);
}

/** Platzhalter statt einer nicht geladenen Datei (gleiche Lage, Gruppe, Drehung). */
export function placeholder(o: Record<string, unknown>, kind: 'image' | 'document'): Record<string, unknown> {
  const text = kind === 'image' ? 'Bild nicht übernommen' : 'Dokument nicht übernommen';
  const keep = ['id', 'x', 'y', 'w', 'h', 'rotation', 'groupId', 'locked', 'hidden'];
  const base = Object.fromEntries(keep.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  return {
    ...base,
    type: 'shape',
    shape: 'rect',
    color: PLACEHOLDER_FILL,
    stroke: PLACEHOLDER_STROKE,
    strokeWidth: 1,
    [RICH_TEXT_FIELD]: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    text,
  };
}

/** Yjs-Stand des neuen Boards (ohne Datenbank); Datei-Felder nach `files` gesetzt bzw. Platzhalter. */
export function buildDoc(userKey: string, userName: string, mapped: MappedBoard, files: ReadonlyMap<string, StoredFile | null>): Uint8Array {
  const need = new Map(mapped.assets.map((a) => [a.objectId, a]));
  const list = mapped.objects.map((o) => {
    const id = String(o.id);
    const a = need.get(id);
    let out: Record<string, unknown> = { ...o };
    if (a) {
      const f = files.get(id);
      if (!f) out = placeholder(out, a.kind);
      else if (a.kind === 'image') out.imageId = f.id;
      else out.docFile = f.id;
    }
    // Rich-Text: Klartext-Spiegel mitschreiben (Vertrag §4)
    const c = out[RICH_TEXT_FIELD];
    if (c !== undefined && WEB.isDoc(c)) out.text = WEB.plainOf(c);
    return out;
  });
  const doc = new Y.Doc();
  const origin = { source: 'import', context: { user: { key: userKey, name: userName } } };
  const store = WEB.createStore(doc, userKey, origin);
  try {
    const keys = WEB.keysAbove(null, list.length);
    store.transact(() => {
      if (list.length) store.createMany(list.map((o, i) => ({ ...o, z: keys[i] })));
      for (const m of mapped.minds) store.mind.tree(m.rootId, m.x, m.y, m.tree);
      if (mapped.descriptionId) placeAbove(doc, mapped.descriptionId, store);
    });
    return Y.encodeStateAsUpdate(doc);
  } finally {
    store.destroy();
    doc.destroy();
  }
}

/**
 * Beschreibung über den fertigen Inhalt rücken: Stachel ordnet Mindmaps neu an (andere Größen als in Miro), erst nach
 * `mind.tree` steht fest, wo oben links ist.
 */
function placeAbove(doc: Y.Doc, id: string, store: { updateMany(p: Record<string, Record<string, unknown>>): void }) {
  const objects = doc.getMap<unknown>(DOC_OBJECTS);
  const me = objects.get(id);
  if (!(me instanceof Y.Map)) return;
  let minX = Infinity;
  let minY = Infinity;
  objects.forEach((m, key) => {
    if (key === id || !(m instanceof Y.Map) || m.get('type') === 'connector') return;
    const x = m.get('x');
    const y = m.get('y');
    if (typeof x === 'number' && typeof y === 'number') {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
    }
  });
  const h = me.get('h');
  if (!Number.isFinite(minX) || typeof h !== 'number') return;
  store.updateMany({ [id]: { x: Math.round(minX), y: Math.round(minY - h - 60) } });
}

/** Board anlegen (eine Transaktion), Ereignis, benannte Version. Wirft nur vor dem Anlegen (dann räumt der Aufrufer die Dateien). */
export async function buildBoard(
  deps: BuildDeps,
  user: { key: string; name: string },
  mapped: MappedBoard,
  files: ReadonlyMap<string, StoredFile | null>,
  at: Date = new Date(),
): Promise<{ boardId: string; title: string }> {
  const state = buildDoc(user.key, user.name, mapped, files);
  const now = nowIso();
  const id = randomToken(9);
  const title = boardTitle(mapped.title);
  const { db } = deps;
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO boards (id, title, created_by, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      title,
      user.key,
      user.name,
      now,
      now,
    );
    db.prepare('INSERT INTO documents (name, state, updated_at) VALUES (?, ?, ?)').run(boardDocName(id), state, now);
    const ins = db.prepare('INSERT INTO images (id, board_id, mime, width, height, bytes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const seen = new Set<string>();
    for (const f of files.values()) {
      if (!f || seen.has(f.id)) continue;
      seen.add(f.id);
      ins.run(f.id, id, f.mime, f.width, f.height, f.bytes, user.key, now);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  deps.events?.emit({ type: 'created', id });
  // Version ist eine Zugabe: scheitert sie, bleibt das Board trotzdem
  if (deps.saveVersion) await deps.saveVersion(id, versionName(at), user).catch(() => {});
  return { boardId: id, title };
}

/** Datei ablegen wie die Upload-Route (tmp + rename). */
export async function storeFile(imagesDir: string, buf: Buffer): Promise<string> {
  const id = randomToken(16);
  const file = path.join(imagesDir, id);
  await fs.promises.writeFile(`${file}.tmp`, buf);
  await fs.promises.rename(`${file}.tmp`, file);
  return id;
}

export async function removeFiles(imagesDir: string, ids: Iterable<string>): Promise<void> {
  await Promise.all([...ids].map((id) => fs.promises.rm(path.join(imagesDir, id), { force: true })));
}
