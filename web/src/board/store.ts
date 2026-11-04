// Yjs-Schicht: einzige Stelle, die Y.Map-Interna kennt. Die UI arbeitet mit unveränderlichen BoardObject-Schnappschüssen.
import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import { DOC_OBJECTS, RICH_TEXT_FIELD, type BoardObject, type ObjectType } from '../protocol';
import { compareKeys, keysAbove, keysBelow } from './fractional';
import { attachedConnectors } from './connector';
import { isBelow, isKnownType } from './types';

/** Origin für eigene Änderungen (Vertrag §4) – nur diese verfolgt der UndoManager. */
export const LOCAL_ORIGIN = 'stachel:local';
/** Nummer eines Rückgängig-Schritts (Board und Privat-Ablage gemeinsam, StackItem.meta) */
const UNDO_SEQ = 'stachel:seq';

export type NewObject = Omit<BoardObject, 'id' | 'z' | 'createdBy' | 'updatedAt'> & Partial<Pick<BoardObject, 'id' | 'z'>>;
/** `undefined` als Wert entfernt das Feld. */
export type Patch = Partial<Omit<BoardObject, 'id' | 'type' | 'createdBy'>>;

export interface Snapshot {
  version: number;
  byId: ReadonlyMap<string, BoardObject>;
  /** von unten nach oben; Rahmen liegen immer unter allem anderen */
  ordered: readonly BoardObject[];
  /** Position jedes Objekts in `ordered` */
  rank: ReadonlyMap<string, number>;
  topZ: string | null;
  bottomZ: string | null;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Objektfeld, das im Y.Map als eigener Y-Typ liegt (z. B. `content` = Y.XmlFragment für Rich-Text).
 * Im Schnappschuss steht nur die Lesekopie `toPlain`; beim Anlegen/Ändern mit einem Klartext-Wert (Kopie aus der
 * Zwischenablage) baut `fromPlain` daraus einen neuen Y-Typ (undefined = Feld weglassen).
 */
export interface YFieldCodec {
  toPlain(v: Y.AbstractType<any>): unknown;
  fromPlain(v: unknown): Y.AbstractType<any> | undefined;
}

const Y_FIELDS = new Map<string, YFieldCodec>([
  // Standard bis zum Rich-Text-Modul: Lesekopie als XML-String, Kopien behalten nur den Klartext (`text`)
  [RICH_TEXT_FIELD, { toPlain: (v) => v.toJSON(), fromPlain: () => undefined }],
]);

/** Codec für ein Y-Feld setzen (ersetzt den vorhandenen). */
export function registerYField(name: string, codec: YFieldCodec) {
  Y_FIELDS.set(name, codec);
}

/** Registrierter Codec eines Y-Felds (Server: Schnappschuss der Native-API, docs/contract.md §8.5). */
export const yFieldCodec = (name: string): YFieldCodec | undefined => Y_FIELDS.get(name);

/**
 * Privat-Ablage (privater Modus, docs/features/private.md): Entscheidet beim Anlegen, ob ein neues Objekt in die
 * Ablage statt ins Board geht. Bekommt das neue Objekt und den Store (für `isPrivate` angedockter Objekte).
 */
export type CreateRoute = (o: NewObject & { id: string }, store: BoardStore) => boolean;

export interface BoardStoreOptions {
  /**
   * Origin der eigenen Änderungen (Standard LOCAL_ORIGIN). Der Server gibt jeder App-Sitzung einen eigenen
   * (server/src/native), damit Rückgängig nur deren Schritte zurücknimmt.
   */
  origin?: unknown;
}

/** Wert fürs Y.Map: Y-Felder ggf. aus der Lesekopie neu aufbauen; undefined = nicht schreiben. */
function toYValue(key: string, v: unknown): unknown {
  const codec = Y_FIELDS.get(key);
  if (!codec || v instanceof Y.AbstractType) return v;
  return codec.fromPlain(v);
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Fremde/unvollständige Daten tolerant in ein BoardObject überführen. */
export function normalize(id: string, raw: Record<string, unknown>): BoardObject | null {
  const type = raw.type as ObjectType;
  if (!isKnownType(type)) return null;
  return {
    ...(raw as Partial<BoardObject>),
    id,
    type,
    x: num(raw.x),
    y: num(raw.y),
    w: Math.max(1, num(raw.w, 100)),
    h: Math.max(1, num(raw.h, 100)),
    z: typeof raw.z === 'string' ? raw.z : '',
    createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  } as BoardObject;
}

export function compareObjects(a: BoardObject, b: BoardObject): number {
  const fa = isBelow(a) ? 0 : 1;
  const fb = isBelow(b) ? 0 : 1;
  if (fa !== fb) return fa - fb;
  return compareKeys(a.z, b.z) || compareKeys(a.id, b.id);
}

export class BoardStore {
  readonly doc: Y.Doc;
  readonly objects: Y.Map<Y.Map<unknown>>;
  readonly undoManager: Y.UndoManager;
  private byId = new Map<string, BoardObject>();
  private snap: Snapshot;
  private listeners = new Set<() => void>();
  private historyListeners = new Set<() => void>();
  private history: HistoryState = { canUndo: false, canRedo: false };
  private version = 0;
  private exts = new Map<string, Y.AbstractType<any>>();
  readonly userKey: string;
  /** Origin eigener Änderungen (nur diese verfolgt der UndoManager) */
  readonly origin: unknown;
  // Privat-Ablage (privater Modus): zweite Quelle von Objekten, nur für diese Person (docs/features/private.md)
  private pdoc: Y.Doc | null = null;
  private pobjects: Y.Map<Y.Map<unknown>> | null = null;
  private pundo: Y.UndoManager | null = null;
  private privIds = new Set<string>();
  private createRoute: CreateRoute | null = null;
  /** laufende Nummer der Rückgängig-Schritte über beide Dokumente (der jüngste wird zuerst zurückgenommen) */
  private undoSeq = 0;

  constructor(doc: Y.Doc, userKey: string, opts: BoardStoreOptions = {}) {
    this.doc = doc;
    this.userKey = userKey;
    this.origin = opts.origin ?? LOCAL_ORIGIN;
    this.objects = doc.getMap<Y.Map<unknown>>(DOC_OBJECTS);
    this.objects.forEach((m, id) => this.read(id, m));
    this.snap = this.buildSnapshot();
    this.objects.observeDeep(this.onDeep);
    this.undoManager = new Y.UndoManager(this.objects, { trackedOrigins: new Set([this.origin]), captureTimeout: 600 });
    this.watchUndo(this.undoManager);
  }

  private watchUndo(um: Y.UndoManager) {
    for (const ev of ['stack-item-popped', 'stack-cleared'] as const) um.on(ev, this.onHistory);
    // Schritte über beide Verläufe durchnummerieren: Rückgängig nimmt den jüngsten zuerst
    const stamp = (e: { stackItem: { meta: Map<any, any> } }) => {
      e.stackItem.meta.set(UNDO_SEQ, ++this.undoSeq);
      this.onHistory();
    };
    um.on('stack-item-added', stamp);
    um.on('stack-item-updated', stamp);
  }

  // ---- Privat-Ablage (privater Modus) ----------------------------------------------

  /**
   * Privat-Ablage einhängen: Ihre Objekte erscheinen im Schnappschuss wie Board-Objekte (gleiche ID: Board gewinnt),
   * Änderungen daran gehen in dieses Dokument, Rückgängig über beide. Einmal je Store.
   */
  attachPrivate(doc: Y.Doc) {
    if (this.pdoc) return;
    this.pdoc = doc;
    this.pobjects = doc.getMap<Y.Map<unknown>>(DOC_OBJECTS);
    this.pobjects.forEach((_m, id) => this.readAny(id));
    this.pobjects.observeDeep(this.onDeep);
    // dieselbe Origin-Menge: trackOrigin wirkt auf beide Verläufe
    this.pundo = new Y.UndoManager(this.pobjects, { trackedOrigins: this.undoManager.trackedOrigins, captureTimeout: 600 });
    this.watchUndo(this.pundo);
    this.snap = this.buildSnapshot();
    for (const fn of this.listeners) fn();
  }

  /** Eingehängte Privat-Ablage (null = keine). */
  get privateDoc(): Y.Doc | null {
    return this.pdoc;
  }

  /** Regel, welche neuen Objekte in die Ablage gehen (null = alle ins Board). */
  setCreateRoute(fn: CreateRoute | null) {
    this.createRoute = fn;
  }

  /** Liegt das Objekt in der eigenen Privat-Ablage (nur für mich sichtbar)? */
  isPrivate = (id: string): boolean => this.privIds.has(id);

  /** IDs der eigenen privaten Objekte. */
  privateIds(): ReadonlySet<string> {
    return this.privIds;
  }

  /** Y.Map eines Objekts – im Board oder in der Ablage (Live-Stand). */
  mapOf(id: string): Y.Map<unknown> | undefined {
    return this.objects.get(id) ?? this.pobjects?.get(id);
  }

  /** Dokument, in dem das Objekt liegt (Board bzw. Ablage). */
  docOf(id: string): Y.Doc {
    return !this.objects.has(id) && this.pobjects?.has(id) ? this.pdoc! : this.doc;
  }

  /** Gibt es das Objekt (Board oder Ablage, Live-Stand)? */
  has(id: string): boolean {
    return this.objects.has(id) || !!this.pobjects?.has(id);
  }

  destroy() {
    this.objects.unobserveDeep(this.onDeep);
    this.pobjects?.unobserveDeep(this.onDeep);
    this.pundo?.destroy();
    this.undoManager.destroy();
    this.listeners.clear();
    this.historyListeners.clear();
  }

  // ---- Lesen ---------------------------------------------------------------

  getSnapshot = (): Snapshot => this.snap;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getHistory = (): HistoryState => this.history;
  subscribeHistory = (fn: () => void) => {
    this.historyListeners.add(fn);
    return () => {
      this.historyListeners.delete(fn);
    };
  };
  get = (id: string): BoardObject | undefined => this.byId.get(id);

  // ---- Schreiben -----------------------------------------------------------

  transact(fn: () => void) {
    const p = this.pdoc;
    // mit Ablage: beide Dokumente in einer Klammer (gleicher Origin → je ein Rückgängig-Schritt, zeitgleich)
    this.doc.transact(p ? () => p.transact(fn, this.origin) : fn, this.origin);
  }

  create(obj: NewObject): string {
    return this.createMany([obj])[0];
  }

  /** Legt Objekte über allem an (Reihenfolge der Liste bleibt erhalten). */
  createMany(list: NewObject[]): string[] {
    if (list.length === 0) return [];
    const keys = keysAbove(this.snap.topZ, list.length);
    const now = new Date().toISOString();
    const ids: string[] = [];
    this.transact(() => {
      list.forEach((o, i) => {
        const id = o.id ?? nanoid();
        const full: Record<string, unknown> = { ...o, id, z: o.z ?? keys[i], createdBy: this.userKey, updatedAt: now };
        const m = new Y.Map<unknown>();
        for (const [k, v] of Object.entries(full)) {
          const y = v === undefined ? undefined : toYValue(k, v);
          if (y !== undefined) m.set(k, y);
        }
        const target = this.pobjects && this.createRoute?.({ ...o, id }, this) ? this.pobjects : this.objects;
        target.set(id, m);
        // sofort merken: die Regel für spätere Objekte derselben Liste (Verbinder an dieser Notiz) sieht sie schon
        if (target === this.pobjects) this.privIds.add(id);
        ids.push(id);
      });
    });
    return ids;
  }

  update(id: string, patch: Patch) {
    this.updateMany({ [id]: patch });
  }

  updateMany(patches: Record<string, Patch>) {
    const now = new Date().toISOString();
    this.transact(() => {
      const left = new Set<string>();
      for (const [id, patch] of Object.entries(patches)) {
        const m = this.mapOf(id);
        if (!m) continue;
        const g = m.get('groupId');
        if (typeof g === 'string' && 'groupId' in patch && patch.groupId !== g) left.add(g);
        let changed = false;
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) {
            if (m.has(k)) {
              m.delete(k);
              changed = true;
            }
          } else if (!sameValue(m.get(k), v)) {
            const y = toYValue(k, v);
            if (y === undefined) continue;
            m.set(k, y);
            changed = true;
          }
        }
        if (changed) m.set('updatedAt', now);
      }
      this.dissolveLoneGroups(left);
    });
  }

  /** Löscht Objekte samt angedockter Verbinder; bleibt von einer Gruppe nur ein Mitglied, wird sie aufgelöst. */
  remove(ids: Iterable<string>) {
    const set = new Set(ids);
    for (const c of attachedConnectors(this.byId.values(), set)) set.add(c);
    this.transact(() => {
      const left = new Set<string>();
      for (const id of set) {
        const g = this.mapOf(id)?.get('groupId');
        if (typeof g === 'string') left.add(g);
        if (this.objects.has(id)) this.objects.delete(id);
        else this.pobjects?.delete(id);
      }
      this.dissolveLoneGroups(left);
    });
  }

  bringToFront(ids: string[]) {
    const sorted = this.sortedIds(ids);
    if (!sorted.length) return;
    const keys = keysAbove(this.snap.topZ, sorted.length);
    this.updateMany(Object.fromEntries(sorted.map((id, i) => [id, { z: keys[i] }])));
  }

  sendToBack(ids: string[]) {
    const sorted = this.sortedIds(ids);
    if (!sorted.length) return;
    const keys = keysBelow(this.snap.bottomZ, sorted.length);
    this.updateMany(Object.fromEntries(sorted.map((id, i) => [id, { z: keys[i] }])));
  }

  undo() {
    this.latest('undoStack')?.undo();
  }
  redo() {
    this.latest('redoStack')?.redo();
  }
  /** Verlauf mit dem jüngsten Schritt (ohne Ablage immer der des Boards). */
  private latest(stack: 'undoStack' | 'redoStack'): Y.UndoManager | null {
    const p = this.pundo;
    if (!p) return this.undoManager;
    const seq = (um: Y.UndoManager) => {
      const top = um[stack][um[stack].length - 1];
      return top ? ((top.meta.get(UNDO_SEQ) as number | undefined) ?? 0) : -1;
    };
    const a = seq(this.undoManager);
    const b = seq(p);
    if (a < 0 && b < 0) return null;
    return b > a ? p : this.undoManager;
  }
  /** Beendet den laufenden Undo-Schritt (z. B. nach einem Ziehvorgang). */
  stopCapturing() {
    this.undoManager.stopCapturing();
    this.pundo?.stopCapturing();
  }
  /** Anzahl eigener Undo-Schritte – Merkpunkt vor einer Geste. */
  undoDepth(): number {
    return this.undoManager.undoStack.length + (this.pundo?.undoStack.length ?? 0);
  }
  /** Verwirft eigene Schritte oberhalb von `depth` (Esc beim Ziehen), ohne sie wiederholbar zu machen. */
  revertTo(depth: number) {
    while (this.undoDepth() > depth) {
      const um = this.latest('undoStack');
      if (!um) break;
      um.undo();
      um.redoStack.pop();
    }
    this.stopCapturing();
    this.onHistory();
  }

  // ---- Y-Felder & Erweiterungen ----------------------------------------------

  /** Lebender Y-Typ eines Objektfelds (z. B. `content`), sonst undefined. */
  yField<T extends Y.AbstractType<any>>(id: string, name: string): T | undefined {
    const v = this.mapOf(id)?.get(name);
    return v instanceof Y.AbstractType ? (v as T) : undefined;
  }

  /** Y-Typ eines Objektfelds holen bzw. mit `make` anlegen (im laufenden Undo-Schritt). */
  ensureYField<T extends Y.AbstractType<any>>(id: string, name: string, make: () => T): T | undefined {
    const m = this.mapOf(id);
    if (!m) return undefined;
    const cur = m.get(name);
    if (cur instanceof Y.AbstractType) return cur as T;
    const t = make();
    this.transact(() => m.set(name, t));
    return t;
  }

  /**
   * Eigene benannte Y.Map neben `objects` (z. B. 'comments'). Mit `undo` (Standard) gehören eigene Änderungen daran
   * – geschrieben in `store.transact` – zu Rückgängig/Wiederholen.
   */
  extMap<T = unknown>(name: string, opts: { undo?: boolean } = {}): Y.Map<T> {
    return this.ext(name, () => this.doc.getMap<T>(name), opts);
  }

  /** Wie extMap, als Y.Array. */
  extArray<T = unknown>(name: string, opts: { undo?: boolean } = {}): Y.Array<T> {
    return this.ext(name, () => this.doc.getArray<T>(name), opts);
  }

  /** Fremde Origins (z. B. y-prosemirror) zusätzlich in Rückgängig/Wiederholen aufnehmen. */
  trackOrigin(origin: unknown) {
    this.undoManager.trackedOrigins.add(origin);
  }

  private ext<T extends Y.AbstractType<any>>(name: string, get: () => T, opts: { undo?: boolean }): T {
    if (name === DOC_OBJECTS) throw new Error(`"${name}" gehört dem Kern`);
    const have = this.exts.get(name);
    if (have) return have as T;
    const t = get();
    this.exts.set(name, t);
    if (opts.undo !== false) this.undoManager.addToScope(t);
    return t;
  }

  // ---- intern --------------------------------------------------------------

  /**
   * Gruppen aus `groups`, die (nach Löschen bzw. Lösen) nur noch ein Mitglied haben, auflösen – im laufenden
   * transact, damit Rückgängig beides zusammen zurücknimmt. Keine Gruppe aus einem einzelnen Objekt.
   */
  private dissolveLoneGroups(groups: ReadonlySet<string>) {
    if (!groups.size) return;
    const members = new Map<string, string[]>();
    const scan = (m: Y.Map<unknown>, id: string) => {
      const g = m.get('groupId');
      if (typeof g === 'string' && groups.has(g)) members.set(g, [...(members.get(g) ?? []), id]);
    };
    this.objects.forEach(scan);
    this.pobjects?.forEach(scan);
    for (const ids of members.values()) if (ids.length === 1) this.mapOf(ids[0])!.delete('groupId');
  }

  private sortedIds(ids: string[]) {
    return ids
      .map((id) => this.byId.get(id))
      .filter((o): o is BoardObject => !!o)
      .sort(compareObjects)
      .map((o) => o.id);
  }

  /** Objekt aus Board bzw. Ablage lesen (Board gewinnt bei gleicher ID). */
  private readAny(id: string) {
    const main = this.objects.get(id);
    if (main instanceof Y.Map || !this.pobjects) {
      this.privIds.delete(id);
      return this.read(id, main);
    }
    const priv = this.pobjects.get(id);
    if (priv instanceof Y.Map) this.privIds.add(id);
    else this.privIds.delete(id);
    this.read(id, priv);
  }

  private read(id: string, m: Y.Map<unknown> | undefined) {
    if (!(m instanceof Y.Map)) {
      this.byId.delete(id);
      return;
    }
    const raw: Record<string, unknown> = {};
    m.forEach((v, k) => {
      raw[k] = v instanceof Y.AbstractType ? (Y_FIELDS.get(k)?.toPlain(v) ?? v.toJSON()) : v;
    });
    const o = normalize(id, raw);
    if (o) this.byId.set(id, o);
    else this.byId.delete(id);
  }

  private onDeep = (events: Y.YEvent<any>[]) => {
    const touched = new Set<string>();
    for (const ev of events) {
      if (ev.target === this.objects || ev.target === this.pobjects) {
        for (const key of ev.changes.keys.keys()) touched.add(key);
      } else {
        const id = ev.path[0];
        if (typeof id === 'string') touched.add(id);
      }
    }
    // Neu sortieren nur, wenn Objekte dazukommen/wegfallen oder sich z bzw. Typ ändern; sonst an Ort und Stelle ersetzen
    let resort = false;
    for (const id of touched) {
      const prev = this.byId.get(id);
      this.readAny(id);
      const next = this.byId.get(id);
      if (!prev || !next || prev.z !== next.z || prev.type !== next.type) resort = true;
    }
    this.snap = resort ? this.buildSnapshot() : this.patchSnapshot(touched);
    for (const fn of this.listeners) fn();
  };

  private onHistory = () => {
    const p = this.pundo;
    const next = { canUndo: this.undoManager.canUndo() || !!p?.canUndo(), canRedo: this.undoManager.canRedo() || !!p?.canRedo() };
    if (next.canUndo === this.history.canUndo && next.canRedo === this.history.canRedo) return;
    this.history = next;
    for (const fn of this.historyListeners) fn();
  };

  private buildSnapshot(): Snapshot {
    const ordered = [...this.byId.values()].sort(compareObjects);
    let topZ: string | null = null;
    let bottomZ: string | null = null;
    const rank = new Map<string, number>();
    ordered.forEach((o, i) => {
      rank.set(o.id, i);
      if (!o.z) return;
      if (topZ === null || o.z > topZ) topZ = o.z;
      if (bottomZ === null || o.z < bottomZ) bottomZ = o.z;
    });
    return { version: ++this.version, byId: new Map(this.byId), ordered, rank, topZ, bottomZ };
  }

  /** Nur Inhalte geändert (Reihenfolge gleich): Liste kopieren und die Einträge an ihrer Stelle ersetzen. */
  private patchSnapshot(ids: Iterable<string>): Snapshot {
    const prev = this.snap;
    const ordered = prev.ordered.slice();
    for (const id of ids) ordered[prev.rank.get(id)!] = this.byId.get(id)!;
    return { ...prev, version: ++this.version, byId: new Map(this.byId), ordered };
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
