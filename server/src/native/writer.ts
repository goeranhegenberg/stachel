// Schreiber einer App-Sitzung auf einem Board (docs/contract.md §8.6): eigener Origin und eigener Rückgängig-Verlauf,
// Schreibregeln des Web-Stores (web/src/board/store.ts, mitbenutzt über #stachel-web). Die Objekt-Ops einer Nachricht
// laufen in einer Transaktion, Web-Aktionen (`act`, §8.12) dazwischen für sich wie im Browser.
import * as Y from 'yjs';
import { DOC_OBJECTS, RICH_TEXT_FIELD } from '../../../shared/protocol.js';
import { NATIVE_BELOW_TYPES, type NativeActOp, type NativeActResult, type NativeMindOp, type NativeOp } from '../../../shared/native.js';
import { WEB } from '#stachel-web';
import type { HistoryState, WebStore } from './web-api.js';
import { applyDocToFragment, isPMDoc, merge3, normalizeDoc, sameDoc, type PMDoc } from './richmerge.js';

const BELOW = new Set<string>(NATIVE_BELOW_TYPES);

/** Woher der Schreiber Basis-Stände für die `text`-Op bekommt (der Spiegel des Boards). */
export interface TextBase {
  readonly epoch: string;
  textAt(id: string, rev: number): { content: unknown; text: unknown } | undefined;
}

/** Ergebnis einer ops-Nachricht. */
export interface ApplyResult {
  /** Objekte, deren Rich-Text an derselben Stelle gleichzeitig geändert war (die App hat gewonnen) */
  conflicts: string[];
  /** Ergebnisse der Web-Aktionen je Index der Op (§8.12) */
  results: Record<string, NativeActResult>;
}

/** gemerkte Ergebnisse von Web-Aktionen je `key` (Wiederholung ohne zweites Ausführen) */
const ACT_MEMORY = 1000;

export class NativeWriter {
  /** Origin wie eine Hocuspocus-Direktverbindung mit Person: Versionsverlauf nennt sie, gespeichert wird normal */
  readonly origin: { source: 'local'; context: { user: { key: string; name: string } }; native: string };
  /** Origin für Schreibschritte ohne Rückgängig (Web-Aktionen): dieselbe Person, aber vom UndoManager nicht verfolgt */
  private readonly untracked: { source: 'local'; context: { user: { key: string; name: string } }; native: string; undo: false };
  private readonly store: WebStore;
  private readonly objects: Y.Map<unknown>;
  private readonly actMemory = new Map<string, NativeActResult>();
  private readonly dev: boolean;

  constructor(
    private readonly doc: Y.Doc,
    private readonly user: { key: string; name: string },
    sessionId: string,
    private readonly textBase?: TextBase,
    opts: { dev?: boolean; privateDoc?: Y.Doc } = {},
  ) {
    this.origin = { source: 'local', context: { user: { key: user.key, name: user.name } }, native: sessionId };
    this.untracked = { ...this.origin, undo: false };
    this.store = WEB.createStore(doc, user.key, this.origin);
    this.objects = doc.getMap<unknown>(DOC_OBJECTS);
    this.dev = !!opts.dev;
    // Privater Modus: eigene Ablage – neue Notizen gehen dorthin, Ops auf ihre IDs auch (docs/features/private.md §5)
    if (opts.privateDoc) {
      this.privateObjects = opts.privateDoc.getMap<unknown>(DOC_OBJECTS);
      this.store.attachPrivate(opts.privateDoc, doc);
    }
  }

  private privateObjects: Y.Map<unknown> | null = null;

  /**
   * Geprüfte Ops ausführen: aufeinanderfolgende Objekt-Ops in einer Transaktion, jede Web-Aktion (`act`) für sich wie
   * im Browser (eigene Schreibschritte auf dem aktuellen Stand, §8.12). Gleicher Origin → ein Rückgängig-Schritt.
   */
  apply(ops: NativeOp[]): ApplyResult {
    const conflicts: string[] = [];
    const results: Record<string, NativeActResult> = {};
    for (let i = 0; i < ops.length; ) {
      const op = ops[i]!;
      if (op.op === 'act') {
        results[String(i)] = this.act(op);
        i++;
        continue;
      }
      let j = i;
      while (j < ops.length && ops[j]!.op !== 'act') j++;
      const batch = ops.slice(i, j);
      this.store.transact(() => {
        for (const o of batch) this.applyOne(o, conflicts);
      });
      i = j;
    }
    return { conflicts, results };
  }

  /**
   * Web-Aktion (§8.12) außerhalb einer Transaktion ausführen, wie der Browser sie aufruft. Schreibschritte ohne bzw. mit
   * fremdem Origin (Web-Code, der „ohne Rückgängig“ schreibt) und bei Undo-Klasse `none` alle bekommen den Origin der
   * Person ohne Rückgängig – so nennt Versionsverlauf/Patch die Person, und Rückgängig nimmt nur, was es im Web nimmt.
   */
  private act(op: NativeActOp): NativeActResult {
    if (op.key) {
      const seen = this.actMemory.get(op.key);
      if (seen) return seen;
    }
    const v = op.v ?? 1;
    const checked = WEB.checkAction(op.name, op.args, v, this.dev);
    if (!checked.ok) return { error: 'failed', message: checked.message }; // geprüft in validateOps; nur zur Sicherheit
    const tracked = this.store.undoManager.trackedOrigins;
    const none = checked.undo === 'none';
    const swap = (tr: Y.Transaction) => {
      if (none || !tracked.has(tr.origin)) tr.origin = this.untracked;
    };
    let result: NativeActResult;
    this.doc.on('beforeTransaction', swap);
    try {
      result = this.store.act(op.name, checked.args, { user: this.user, ...(op.key ? { key: op.key } : {}), v, dev: this.dev });
    } catch (e) {
      console.error(`[native] Web-Aktion ${op.name} fehlgeschlagen:`, e);
      result = { error: 'failed', message: 'Die Aktion ist auf dem Server fehlgeschlagen.' };
    } finally {
      this.doc.off('beforeTransaction', swap);
    }
    if (op.key) {
      this.actMemory.set(op.key, result);
      if (this.actMemory.size > ACT_MEMORY) this.actMemory.delete(this.actMemory.keys().next().value!);
    }
    return result;
  }

  /** Eine Objekt-Op (in der laufenden Transaktion). */
  private applyOne(op: NativeOp, conflicts: string[]) {
    switch (op.op) {
      case 'create': {
        const list = op.objects.filter((o) => !this.store.has(o.id)).map((o) => withPlain({ ...o }));
        if (!list.length) break;
        // Ebenen-Schlüssel aus dem Live-Stand (der Store-Schnappschuss ist innerhalb der Transaktion veraltet)
        const keys = WEB.keysAbove(this.extremeZ('top'), list.length);
        this.store.createMany(list.map((o, i) => ({ ...o, z: keys[i] })));
        // Mindmap-Knoten (z. B. Duplikat): Layout wie die Web-Laufzeit nach eigenem Einfügen
        const minds = list.filter((o) => o.type === 'mindnode').map((o) => String(o.id));
        if (minds.length) this.store.mind.layout(minds);
        break;
      }
      case 'update': {
        const patches: Record<string, Record<string, unknown>> = {};
        for (const [id, p] of Object.entries(op.patches)) {
          if (!this.store.has(id)) continue;
          const next: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(p)) next[k] = v === null ? undefined : v;
          patches[id] = withPlain(next);
        }
        this.store.updateMany(patches);
        this.mindAfterUpdate(patches);
        break;
      }
      case 'remove': {
        // Mindmap-Knoten samt Unterthemen, Rest der Mindmap neu angeordnet (wie Löschen im Web)
        const ids = op.ids.filter((id) => this.store.has(id));
        const minds = ids.filter((id) => this.store.mind.isNode(id));
        if (minds.length) this.store.mind.remove(minds);
        this.store.remove(ids.filter((id) => this.store.has(id)));
        break;
      }
      case 'order': {
        // wie store.bringToFront/sendToBack, aber aus dem Live-Stand (auch für eben angelegte Objekte)
        const ids = this.sortedLive(op.ids);
        if (!ids.length) break;
        const keys = op.to === 'front' ? WEB.keysAbove(this.extremeZ('top'), ids.length) : WEB.keysBelow(this.extremeZ('bottom'), ids.length);
        this.store.updateMany(Object.fromEntries(ids.map((id, i) => [id, { z: keys[i] }])));
        break;
      }
      case 'text':
        if (this.text(op)) conflicts.push(op.id);
        break;
      case 'mind':
        this.mind(op);
        break;
      case 'act':
        break; // in apply() für sich
      default:
        this.collab(op);
    }
  }

  /** Mindmap-Op (Vertrag §8.6 `mind`) mit dem Mindmap-Code des Web (ops.ts) samt Layout. */
  private mind(op: NativeMindOp) {
    const m = this.store.mind;
    switch (op.do) {
      case 'child':
        m.child(op.id, op.new, op.side);
        break;
      case 'sibling':
        m.sibling(op.id, op.new);
        break;
      case 'root':
        m.root(op.new, op.x, op.y, op.text);
        break;
      case 'tree':
        m.tree(op.new, op.x, op.y, op.tree);
        break;
      case 'text':
        m.text(op.id, op.text);
        break;
      case 'collapse':
        m.collapse(op.id, op.collapsed);
        break;
      case 'remove':
        m.remove(op.ids);
        break;
      case 'drop':
        m.drop(op.ids);
        break;
      case 'layout':
        m.layout(op.ids);
        break;
    }
  }

  /**
   * Mindmap-Regeln für allgemeine Änderungen der App an Knoten (wie die Web-Laufzeit bei eigenen Änderungen,
   * mindmap.tsx `startMindRuntime`): Text, Größe, `mind` oder die Lage einer Wurzel geändert → Mindmap neu anordnen.
   * Verschieben eines Unterthemas ordnet erst `mind.drop` am Ende der Geste ein (Web: beim Loslassen).
   */
  private mindAfterUpdate(patches: Record<string, Record<string, unknown>>) {
    const m = this.store.mind;
    const ids: string[] = [];
    for (const [id, p] of Object.entries(patches)) {
      if (!m.isNode(id)) continue;
      const keys = Object.keys(p);
      const shape = keys.some((k) => k === 'text' || k === 'w' || k === 'h' || k === 'mind');
      const moved = keys.some((k) => k === 'x' || k === 'y');
      if (shape || (moved && m.isRoot(id))) ids.push(id);
    }
    if (ids.length) m.layout(ids);
  }

  /**
   * Kommentare, Reaktionen, Gelesen-Stand (Vertrag §8.6, E3) mit dem Code des Web-Moduls collab. Wiederholungen
   * (gleiche IDs) und Ops auf inzwischen gelöschte Threads/Nachrichten ändern nichts; bearbeiten/löschen nur eigene
   * Nachrichten (wie das Web), den ganzen Thread nur, wer ihn begonnen hat.
   */
  private collab(op: NativeOp) {
    const c = this.store.collab;
    const me = this.user;
    switch (op.op) {
      case 'comment':
        if (!c.thread(op.thread)) c.createThread(op.at, me, op.text, op.mentions, { thread: op.thread, msg: op.msg });
        break;
      case 'reply': {
        const t = c.thread(op.thread);
        if (t && !t.messages.some((m) => m.id === op.msg)) c.addReply(op.thread, me, op.text, op.mentions, op.msg);
        break;
      }
      case 'commentEdit': {
        const m = c.thread(op.thread)?.messages.find((x) => x.id === op.msg);
        if (m?.by === me.key) c.editMessage(op.thread, op.msg, op.text, op.mentions);
        break;
      }
      case 'commentDelete': {
        const t = c.thread(op.thread);
        if (!t) break;
        const first = t.messages[0];
        if (!op.msg || op.msg === first?.id) {
          if ((first?.by ?? t.createdBy) === me.key) c.deleteThread(op.thread);
        } else if (t.messages.find((x) => x.id === op.msg)?.by === me.key) c.deleteMessage(op.thread, op.msg);
        break;
      }
      case 'resolve':
        if (c.thread(op.thread)) c.setResolved(op.thread, op.resolved, me.key);
        break;
      case 'react':
        c.react(op.ids, op.emoji, op.on, me);
        break;
      case 'mentionsRead': {
        // nie in der Zukunft (Uhr des Handys): sonst gälten spätere Erwähnungen als gelesen
        const now = new Date().toISOString();
        c.markRead(me.key, op.at && op.at < now ? op.at : now);
        break;
      }
    }
  }

  /**
   * Rich-Text der App übernehmen (Vertrag §8.6 `text`, Konzept §4.6): Basis = `baseDoc` der App bzw. der Stand zur
   * Revision `base` (gleiche Epoche); hat seither niemand den Text geändert, gilt der App-Stand, sonst werden beide
   * Änderungen zusammengelegt. Ins Fragment geht nur der Unterschied, `text` (Klartext) im selben Schritt.
   * Liefert true bei echter Überlappung (die App hat gewonnen).
   */
  private text(op: Extract<NativeOp, { op: 'text' }>): boolean {
    const m = this.store.mapOf(op.id);
    if (!(m instanceof Y.Map) || typeof m.get('type') !== 'string') return false; // inzwischen gelöscht: nichts zu tun
    const field = m.get(RICH_TEXT_FIELD);
    const fragment = field instanceof Y.XmlFragment ? field : null;
    const current = effectiveDoc(fragment ? WEB.fragmentToJson(fragment) : undefined, m.get('text'));
    const mine = normalizeDoc(op.doc as PMDoc);
    let base: PMDoc | null = null;
    if (isPMDoc(op.baseDoc)) base = normalizeDoc(op.baseDoc);
    else if (this.textBase && (op.epoch === undefined || op.epoch === this.textBase.epoch)) {
      const v = this.textBase.textAt(op.id, op.base);
      if (v) base = effectiveDoc(v.content, v.text);
    }
    let result = mine;
    let conflict = false;
    if (!base) conflict = !sameDoc(current, mine); // Basis unbekannt: der spätere Stand gewinnt
    else if (!sameDoc(base, current)) ({ doc: result, conflict } = merge3(base, mine, current));
    const plain = WEB.plainOf(result);
    const textChanged = m.get('text') !== plain;
    if (fragment) {
      const before = fragment.length ? JSON.stringify(WEB.fragmentToJson(fragment)) : '';
      applyDocToFragment(fragment, result);
      const changed = textChanged || JSON.stringify(WEB.fragmentToJson(fragment)) !== before;
      if (textChanged) m.set('text', plain);
      if (changed) m.set('updatedAt', new Date().toISOString());
    } else {
      // noch kein Rich-Text (alt, nur `text`): Fragment anlegen (Migration, Vertrag §4)
      this.store.updateMany({ [op.id]: { content: result, text: plain } });
    }
    return conflict;
  }

  /** Höchster bzw. niedrigster Ebenen-Schlüssel im Dokument (wie topZ/bottomZ im Store-Schnappschuss). */
  private extremeZ(which: 'top' | 'bottom'): string | null {
    let best: string | null = null;
    const scan = (m: unknown) => {
      const z = m instanceof Y.Map ? m.get('z') : undefined;
      if (typeof z === 'string' && z && (best === null || (which === 'top' ? z > best : z < best))) best = z;
    };
    this.objects.forEach(scan);
    this.privateObjects?.forEach(scan);
    return best;
  }

  /** Vorhandene IDs in Zeichenreihenfolge (Rahmen unten, dann z, dann id). */
  private sortedLive(ids: string[]): string[] {
    const rows: { id: string; below: number; z: string }[] = [];
    for (const id of new Set(ids)) {
      const m = this.store.mapOf(id);
      if (!(m instanceof Y.Map)) continue;
      const z = m.get('z');
      rows.push({ id, below: BELOW.has(String(m.get('type'))) ? 0 : 1, z: typeof z === 'string' ? z : '' });
    }
    return rows.sort((a, b) => a.below - b.below || WEB.compareKeys(a.z, b.z) || WEB.compareKeys(a.id, b.id)).map((r) => r.id);
  }

  step() {
    this.store.stopCapturing();
  }

  /** false = nichts zum Rückgängigmachen/Wiederholen */
  undo(): boolean {
    if (!this.store.getHistory().canUndo) return false;
    this.store.undo();
    return true;
  }

  redo(): boolean {
    if (!this.store.getHistory().canRedo) return false;
    this.store.redo();
    return true;
  }

  history(): HistoryState {
    return this.store.getHistory();
  }

  onHistory(fn: () => void): () => void {
    return this.store.subscribeHistory(fn);
  }

  destroy() {
    this.store.destroy();
  }
}

/**
 * Rich-Text, der für ein Objekt gilt (Vertrag §4): `content`, wenn sein Klartext zu `text` passt, sonst `text` als
 * Absätze (ein alter Client hat nur `text` geändert bzw. es gibt noch kein `content`).
 */
export function effectiveDoc(content: unknown, text: unknown): PMDoc {
  const t = typeof text === 'string' ? text : '';
  if (isPMDoc(content) && WEB.plainOf(content) === t) return normalizeDoc(content);
  return normalizeDoc(t ? (WEB.textToDoc(t) as PMDoc) : { type: 'doc', content: [] });
}

/** Rich-Text: mit `content` kommt immer der Klartext-Spiegel `text` (Vertrag §4); ungültiger Inhalt wird weggelassen. */
function withPlain(o: Record<string, unknown>): Record<string, unknown> {
  const c = o[RICH_TEXT_FIELD];
  if (c === undefined) return o;
  if (WEB.isDoc(c)) o.text = WEB.plainOf(c);
  return o;
}
