// Board-Objekte im Yjs-Dokument lesen und schreiben – wie die Web-App (docs/contract.md §4, docs/features/*.md).
// Einzige Stelle im MCP-Server, die Y.Map-Interna kennt. Gemeinsamer Code aus web/ (Rich-Text, Ebenen-Schlüssel)
// wird direkt mitbenutzt, damit beide Seiten dasselbe Format schreiben.
import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import { DOC_OBJECTS, RICH_TEXT_FIELD } from '../../../shared/protocol';
import { compareKeys, keysAbove, keysBelow } from '../../../web/src/board/fractional';
import { fragmentToJson, jsonToFragment, plainOf, type PMDoc } from '../../../web/src/features/richtext/doc';

/** Lesekopie eines Objekts (Y-Felder als JSON: `content` = ProseMirror-JSON, `table` = TableData, `desc` = String). */
export interface Obj {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: string;
  [key: string]: any;
}

export interface NewObj {
  id?: string;
  z?: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  [key: string]: any;
}
/** `undefined` entfernt ein Feld. */
export type Patch = Record<string, unknown>;

/** Typen, die unter allem liegen (Rahmen) – wie `below` in web/src/board/types.ts. */
const BELOW = new Set(['frame']);
/** Typen mit Rich-Text-Feld `content` (Vertrag §4). */
export const RICH_TYPES = new Set(['sticky', 'text', 'shape', 'connector']);

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Reihenfolge wie in der Web-App: Rahmen zuerst, dann nach z, bei Gleichstand nach id. */
export function compareObjects(a: Obj, b: Obj): number {
  const fa = BELOW.has(a.type) ? 0 : 1;
  const fb = BELOW.has(b.type) ? 0 : 1;
  if (fa !== fb) return fa - fb;
  return compareKeys(a.z, b.z) || compareKeys(a.id, b.id);
}

function plainValue(key: string, v: unknown): unknown {
  if (v instanceof Y.XmlFragment) return fragmentToJson(v);
  if (v instanceof Y.Text) return v.toString();
  if (v instanceof Y.AbstractType) return v.toJSON();
  void key;
  return v;
}

/** Objekt aus seinem Y.Map lesen (tolerant wie `normalize` im Web-Store); null bei kaputten Einträgen. */
export function readObject(id: string, m: unknown): Obj | null {
  if (!(m instanceof Y.Map)) return null;
  const raw: Record<string, unknown> = {};
  m.forEach((v, k) => {
    raw[k] = plainValue(k, v);
  });
  if (typeof raw.type !== 'string' || !raw.type) return null;
  return {
    ...raw,
    id,
    type: raw.type,
    x: num(raw.x),
    y: num(raw.y),
    w: Math.max(1, num(raw.w, 100)),
    h: Math.max(1, num(raw.h, 100)),
    z: typeof raw.z === 'string' ? raw.z : '',
  };
}

/** Tabelleninhalt als Y-Struktur (structure/table/yjs.ts `tableToY`). */
export function tableToY(d: { rows: string[]; cols: string[]; cells: Record<string, string>; widths: Record<string, number> }): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  const rows = new Y.Array<string>();
  rows.push(d.rows);
  const cols = new Y.Array<string>();
  cols.push(d.cols);
  const cells = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(d.cells)) if (typeof v === 'string' && v) cells.set(k, v);
  const widths = new Y.Map<number>();
  for (const [k, v] of Object.entries(d.widths ?? {})) if (typeof v === 'number' && v > 0 && v !== 1) widths.set(k, v);
  m.set('rows', rows);
  m.set('cols', cols);
  m.set('cells', cells);
  m.set('widths', widths);
  return m;
}

/** Wert fürs Y.Map: Y-Felder aus ihrer Lesekopie aufbauen. */
function toYValue(key: string, v: unknown, type: string): unknown {
  if (v instanceof Y.AbstractType) return v;
  if (key === RICH_TEXT_FIELD) return jsonToFragment(v);
  if (key === 'table' && type === 'table' && v && typeof v === 'object') return tableToY(v as Parameters<typeof tableToY>[0]);
  // Karten-Beschreibung live als Y.Text (gleichzeitiges Tippen wird zusammengeführt)
  if (key === 'desc' && type === 'card' && typeof v === 'string') {
    const t = new Y.Text();
    t.insert(0, v);
    return t;
  }
  return v;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Verbinder, die an einem der Objekte hängen. */
export function attachedConnectors(all: Iterable<Obj>, ids: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const o of all) {
    if (o.type !== 'connector' || ids.has(o.id)) continue;
    const a = (o.from as { objectId?: string } | undefined)?.objectId;
    const b = (o.to as { objectId?: string } | undefined)?.objectId;
    if ((a && ids.has(a)) || (b && ids.has(b))) out.push(o.id);
  }
  return out;
}

/** Klartext + Rich-Text für ein Textobjekt: `text` ist immer der Klartext-Spiegel von `content`. */
export function richFields(doc: PMDoc): { text: string; content: PMDoc } {
  return { text: plainOf(doc), content: doc };
}

/**
 * Lese- und Schreibzugriff auf `objects` eines Dokuments. Schreiben nur innerhalb von `BoardConn.change()` (ein
 * Transact = ein Undo-Schritt). `createdBy` ist die Person, der das Token gehört.
 */
export class BoardModel {
  readonly objects: Y.Map<Y.Map<unknown>>;

  constructor(
    readonly doc: Y.Doc,
    readonly owner: string,
  ) {
    this.objects = doc.getMap<Y.Map<unknown>>(DOC_OBJECTS);
  }

  get(id: string): Obj | null {
    return readObject(id, this.objects.get(id));
  }

  /** Alle Objekte, von unten nach oben. */
  all(): Obj[] {
    const out: Obj[] = [];
    this.objects.forEach((m, id) => {
      const o = readObject(id, m);
      if (o) out.push(o);
    });
    return out.sort(compareObjects);
  }

  private topZ(): string | null {
    let top: string | null = null;
    this.objects.forEach((m) => {
      const z = m.get('z');
      if (typeof z === 'string' && z && (top === null || z > top)) top = z;
    });
    return top;
  }

  private bottomZ(): string | null {
    let bottom: string | null = null;
    this.objects.forEach((m) => {
      const z = m.get('z');
      if (typeof z === 'string' && z && (bottom === null || z < bottom)) bottom = z;
    });
    return bottom;
  }

  /** Legt Objekte über allem an (Reihenfolge der Liste bleibt). Liefert die ids. */
  create(list: NewObj[]): string[] {
    if (!list.length) return [];
    const keys = keysAbove(this.topZ(), list.length);
    const now = new Date().toISOString();
    return list.map((o, i) => {
      const id = o.id ?? nanoid();
      const full: Record<string, unknown> = { ...o, id, z: o.z ?? keys[i], createdBy: this.owner, updatedAt: now };
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(full)) {
        if (v === undefined) continue;
        const y = toYValue(k, v, o.type);
        if (y !== undefined) m.set(k, y);
      }
      this.objects.set(id, m);
      return id;
    });
  }

  /** Felder ändern (undefined entfernt); Gruppen mit nur noch einem Mitglied lösen sich auf. */
  update(patches: Record<string, Patch>) {
    const now = new Date().toISOString();
    const left = new Set<string>();
    for (const [id, patch] of Object.entries(patches)) {
      const m = this.objects.get(id);
      if (!m) continue;
      const type = String(m.get('type'));
      const g = m.get('groupId');
      if (typeof g === 'string' && 'groupId' in patch && patch.groupId !== g) left.add(g);
      let changed = false;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) {
          if (m.has(k)) {
            m.delete(k);
            changed = true;
          }
        } else if (!sameValue(plainValue(k, m.get(k)), v)) {
          const y = toYValue(k, v, type);
          if (y === undefined) continue;
          m.set(k, y);
          changed = true;
        }
      }
      if (changed) m.set('updatedAt', now);
    }
    this.dissolveLoneGroups(left);
  }

  /** Löscht Objekte samt angedockter Verbinder (Mindmap-Unterthemen gibt der Aufrufer mit). Liefert alle gelöschten ids. */
  remove(ids: Iterable<string>): string[] {
    const set = new Set([...ids].filter((id) => this.objects.has(id)));
    for (const c of attachedConnectors(this.all(), set)) set.add(c);
    const left = new Set<string>();
    for (const id of set) {
      const g = this.objects.get(id)?.get('groupId');
      if (typeof g === 'string') left.add(g);
      this.objects.delete(id);
    }
    this.dissolveLoneGroups(left);
    return [...set];
  }

  bringToFront(ids: string[]) {
    const sorted = this.sorted(ids);
    const keys = keysAbove(this.topZ(), sorted.length);
    this.update(Object.fromEntries(sorted.map((id, i) => [id, { z: keys[i] }])));
  }

  sendToBack(ids: string[]) {
    const sorted = this.sorted(ids);
    const keys = keysBelow(this.bottomZ(), sorted.length);
    this.update(Object.fromEntries(sorted.map((id, i) => [id, { z: keys[i] }])));
  }

  private sorted(ids: string[]): string[] {
    return ids
      .map((id) => this.get(id))
      .filter((o): o is Obj => !!o)
      .sort(compareObjects)
      .map((o) => o.id);
  }

  private dissolveLoneGroups(groups: ReadonlySet<string>) {
    if (!groups.size) return;
    const members = new Map<string, string[]>();
    this.objects.forEach((m, id) => {
      const g = m.get('groupId');
      if (typeof g === 'string' && groups.has(g)) members.set(g, [...(members.get(g) ?? []), id]);
    });
    for (const ids of members.values()) if (ids.length === 1) this.objects.get(ids[0]!)!.delete('groupId');
  }
}
