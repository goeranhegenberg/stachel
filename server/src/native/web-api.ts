// Schnittstelle zum mitbenutzten Web-Code (Datenschicht aus web/src, React-frei) für die Native-API.
// Umsetzung: web-impl.ts (gebündelt per esbuild, in Tests per vitest-Alias); der Server importiert sie über
// `#stachel-web` und wird gegen web-decl.d.ts geprüft (die Web-Dateien folgen nicht den strengeren Server-Regeln).
import type * as Y from 'yjs';
import type { NativeActResult } from '../../../shared/native.js';

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

/** Teil von `BoardStore` (web/src/board/store.ts), den der Native-Schreiber nutzt. */
export interface WebStore {
  readonly undoManager: Y.UndoManager;
  createMany(list: Record<string, unknown>[]): string[];
  /** `undefined` als Wert entfernt das Feld */
  updateMany(patches: Record<string, Record<string, unknown>>): void;
  /** Löscht samt angedockter Verbinder, löst Gruppen mit nur einem Mitglied auf */
  remove(ids: Iterable<string>): void;
  bringToFront(ids: string[]): void;
  sendToBack(ids: string[]): void;
  transact(fn: () => void): void;
  undo(): void;
  redo(): void;
  stopCapturing(): void;
  getHistory(): HistoryState;
  subscribeHistory(fn: () => void): () => void;
  destroy(): void;
  /** Privat-Ablage einhängen (privater Modus, docs/features/private.md); neue Objekte nach der Regel des Web-Moduls */
  attachPrivate(doc: Y.Doc, mainDoc: Y.Doc): void;
  /** Y.Map eines Objekts im Board oder in der Ablage (Live-Stand) */
  mapOf(id: string): Y.Map<unknown> | undefined;
  /** gibt es das Objekt (Board oder Ablage)? */
  has(id: string): boolean;
  /** liegt es in der Ablage? */
  isPrivate(id: string): boolean;
  /** Kommentare/Reaktionen wie das Modul collab (web/src/features/collab/comments.ts, reactions.ts), je ein Undo-Schritt */
  readonly collab: WebCollab;
  /** Mindmaps wie das Modul structure (web/src/features/structure/mindmap/ops.ts), samt Layout */
  readonly mind: WebMind;
  /**
   * Web-Aktion (Vertrag §8.12, web/src/native/registry.ts) mit schon geprüften `args` ausführen – außerhalb einer
   * Transaktion, wie der Browser sie aufruft. Wirft bei Fehlern im Web-Code.
   */
  act(name: string, args: Record<string, unknown>, ctx: WebActInput): NativeActResult;
}

/** Was der Server einer Web-Aktion mitgibt (der Rest des Kontexts entsteht im Web-Code). */
export interface WebActInput {
  user: { key: string; name: string };
  /** `key` der App (feste IDs `<key>-<n>`), sonst zufällig */
  key?: string;
  /** verlangte Version */
  v: number;
  /** Sandbox-Aktionen erlaubt */
  dev: boolean;
}

/** Prüfung einer Web-Aktion vor dem Schreiben. */
export type WebActCheck =
  | { ok: true; undo: 'undo' | 'none'; cost: number; args: Record<string, unknown> }
  | { ok: false; error: 'unsupported' | 'invalid_input'; message: string };

/** Baum für eine neue Mindmap (Vorlage): Wurzel mit Unterthemen, `side` nur an Hauptthemen. */
export interface MindTreeSpec {
  text: string;
  side?: 'l' | 'r';
  children?: MindTreeSpec[];
}

/**
 * Mindmap-Ops mit dem Code des Web (ops.ts/layout.ts, Größen aus den Schriftmaßen wie im Browser), alle im laufenden
 * Schritt der ops-Nachricht und auf dem Live-Stand (auch für eben angelegte Knoten). Fehlende Knoten → nichts.
 */
export interface WebMind {
  /** Unterthema `newId` an `id` (Plus/Tab); `side` nur an der Wurzel. false = Knoten fehlt bzw. `newId` gibt es schon */
  child(id: string, newId: string, side?: 'l' | 'r'): boolean;
  /** Thema auf gleicher Ebene darunter (Enter); an der Wurzel nichts */
  sibling(id: string, newId: string): boolean;
  /** neue Mindmap: Wurzel mit Mitte bei (x, y) */
  root(newId: string, x: number, y: number, text: string): boolean;
  /** neue Mindmap aus einem Baum (Vorlage), Wurzel-Mitte bei (x, y); Unterthemen bekommen `${newId}-1`, `-2` … */
  tree(newId: string, x: number, y: number, spec: MindTreeSpec): boolean;
  /** Text setzen und neu anordnen */
  text(id: string, text: string): void;
  /** Zweig ein-/ausklappen (Zielzustand, wiederholbar) */
  collapse(id: string, collapsed: boolean): void;
  /** Knoten samt Unterthemen löschen, Rest neu anordnen */
  remove(ids: string[]): void;
  /** nach dem Ziehen: auf einem Knoten → dort einhängen, sonst unter den Geschwistern einsortieren; dann Layout */
  drop(ids: string[]): void;
  /** Mindmaps dieser Knoten neu anordnen */
  layout(ids: string[]): void;
  /** Ist `id` ein Mindmap-Knoten (Live-Stand)? */
  isNode(id: string): boolean;
  /** Ist `id` eine Wurzel (kein Elternknoten)? */
  isRoot(id: string): boolean;
}

export interface CommentAuthor {
  key: string;
  name: string;
}

export interface WebCollab {
  /** Thread lesen (null = gibt es nicht) */
  thread(id: string): { createdBy: string; messages: { id: string; by: string }[] } | null;
  createThread(at: { x: number; y: number; objectId?: string; dx?: number; dy?: number }, who: CommentAuthor, text: string, mentions: string[], ids: { thread: string; msg: string }): void;
  addReply(thread: string, who: CommentAuthor, text: string, mentions: string[], msgId: string): void;
  editMessage(thread: string, msg: string, text: string, mentions: string[]): void;
  /** erste Nachricht = ganzer Thread */
  deleteMessage(thread: string, msg: string): void;
  deleteThread(thread: string): void;
  setResolved(thread: string, resolved: boolean, by: string): void;
  /** eigene Reaktion `emoji` auf `ids` setzen (`on`) bzw. entfernen */
  react(ids: string[], emoji: string, on: boolean, who: CommentAuthor): void;
  /** Gelesen-Stand der Erwähnungen (collab.reads, ohne Rückgängig) */
  markRead(userKey: string, at: string): void;
}

export interface WebModel {
  /** BoardStore mit eigenem Origin (Rückgängig nur für diesen) */
  createStore(doc: Y.Doc, userKey: string, origin: unknown): WebStore;
  /** Lesekopie eines Y-Felds mit dem im Web registrierten Codec (`registerYField`); undefined = kein Codec */
  yFieldToJson(field: string, value: Y.AbstractType<any>): unknown;
  /** Namen der Felder mit registriertem Codec */
  yFieldNames(): string[];
  /** Y.XmlFragment → ProseMirror-JSON (richtext/doc.ts) */
  fragmentToJson(f: Y.XmlFragment): unknown;
  /** Ist das ein ProseMirror-Dokument `{type:'doc', content:[…]}`? */
  isDoc(v: unknown): boolean;
  /** Klartext-Spiegel eines ProseMirror-Dokuments (Vertrag §4 „Rich-Text“) */
  plainOf(doc: unknown): string;
  /** Dokument aus Klartext, je Zeile ein Absatz (Vertrag §4 „Migration“) */
  textToDoc(text: string): unknown;
  /** Byte-weiser Vergleich von Ebenen-Schlüsseln (fractional.ts) */
  compareKeys(a: string, b: string): number;
  /** n neue Ebenen-Schlüssel über `top` bzw. unter `bottom` (fractional.ts, mit Zufallskürzel) */
  keysAbove(top: string | null, n: number): string[];
  keysBelow(bottom: string | null, n: number): string[];
  /** verfügbare Web-Aktionen mit Version (welcome.actions); `dev` = mit Sandbox-Aktionen */
  actionList(dev: boolean): Record<string, number>;
  /** Name, Version und `args` einer Web-Aktion prüfen (unbekannt/zu alt → unsupported, `args` falsch → invalid_input) */
  checkAction(name: string, args: Record<string, unknown>, v: number, dev: boolean): WebActCheck;
}
