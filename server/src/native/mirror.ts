// Spiegel eines Boards für die Native-API (docs/contract.md §8.4): hält das Dokument über eine Direktverbindung geladen,
// kennt den JSON-Stand jedes Objekts und macht aus jeder Yjs-Transaktion genau einen Patch (Feld-Unterschiede) mit
// fortlaufender `rev`. Ein Ringpuffer der letzten Patches erlaubt Wiederaufnehmen (Resume) ohne Schnappschuss.
// Ein Spiegel je Board, gemeinsam für alle App-Verbindungen; er bleibt nach der letzten Verbindung noch eine Weile
// geladen (Funkloch → Resume statt Schnappschuss).
import crypto from 'node:crypto';
import type { Document, Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import { boardDocName, DOC_OBJECTS } from '../../../shared/protocol.js';
import type { NativeChange, NativeObject, NativePatch } from '../../../shared/native.js';
import { diffObject, extNames, serializeExt, serializeObject, serializeObjects, wantsExt } from './serialize.js';

export interface MirrorOptions {
  /** so lange bleibt ein Spiegel ohne App-Verbindung geladen (ms) */
  idleMs: number;
  /** Ringpuffer: höchstens so viele Patches … */
  bufferMax: number;
  /** … und höchstens so alt (ms) */
  bufferMs: number;
}

/** Empfänger von Patches und Anwesenheits-Änderungen (eine App-Verbindung). */
export interface MirrorSubscriber {
  onPatch(p: NativePatch): void;
  onPresence(): void;
}

type DirectConnection = Awaited<ReturnType<Hocuspocus['openDirectConnection']>>;

/** Wessen Änderung war das? (Hocuspocus-Verbindung, Server-Direktverbindung mit Person, App-Schreiber) */
export function originUser(origin: unknown): string | null {
  if (!origin || typeof origin !== 'object') return null;
  const o = origin as { source?: unknown; connection?: { context?: { user?: { key?: unknown } } }; context?: { user?: { key?: unknown } } };
  const key = o.source === 'connection' ? o.connection?.context?.user?.key : o.source === 'local' ? o.context?.user?.key : undefined;
  return typeof key === 'string' ? key : null;
}

/** Rich-Text eines Objekts ab einer Revision. */
export interface TextVersion {
  rev: number;
  content: unknown;
  text: unknown;
}

/** so viele Rich-Text-Stände je Objekt hält der Spiegel */
const TEXT_LOG_MAX = 40;

export class BoardMirror {
  readonly epoch = crypto.randomBytes(9).toString('base64url');
  rev = 0;
  readonly doc: Document;
  private objects = new Map<string, NativeObject>();
  private buffer: { patch: NativePatch; at: number }[] = [];
  private subs = new Set<MirrorSubscriber>();
  private closed = false;
  /**
   * Rich-Text-Stände je Objekt für die `text`-Op (Basis-Revision → Inhalt, §8.6): ab der ersten Änderung nach dem Laden
   * die letzten Stände `{rev, content, text}` (gültig ab `rev`); ohne Eintrag gilt der aktuelle Stand seit dem Laden.
   */
  private textLog = new Map<string, TextVersion[]>();
  /** Zusatzdaten je App-Sitzung (Schreiber, letzte req), räumt close() auf */
  readonly sessions = new Map<
    string,
    { lastReq: number; dispose?: () => void; data?: unknown; results?: Map<number, Record<string, unknown>>; /** Privat-Ablage (private-mode.ts) */ area?: unknown }
  >();

  constructor(
    readonly boardId: string,
    private readonly conn: DirectConnection,
    private readonly opts: MirrorOptions,
  ) {
    this.doc = conn.document!;
    for (const o of serializeObjects(this.doc)) this.objects.set(o.id, o);
    this.doc.on('afterTransaction', this.onTransaction);
    this.doc.awareness.on('change', this.onAwareness);
  }

  get isClosed() {
    return this.closed;
  }

  subscribe(s: MirrorSubscriber): () => void {
    this.subs.add(s);
    return () => {
      this.subs.delete(s);
    };
  }

  get subscriberCount() {
    return this.subs.size;
  }

  /** Schnappschuss (§8.4): Objekte von unten nach oben, gewünschte Feature-Strukturen. */
  snapshot(want: ReadonlySet<string>): { objects: NativeObject[]; ext: Record<string, unknown> } {
    const objects = serializeObjects(this.doc);
    const ext: Record<string, unknown> = {};
    for (const name of extNames(this.doc)) if (wantsExt(want, name)) ext[name] = serializeExt(this.doc, name);
    return { objects, ext };
  }

  /** Patches nach `rev` aus dem Ringpuffer; null = reicht nicht (dann Schnappschuss). */
  patchesSince(rev: number): NativePatch[] | null {
    this.trim();
    if (!Number.isInteger(rev) || rev < 0 || rev > this.rev) return null;
    if (rev === this.rev) return [];
    const first = this.buffer[0]?.patch.rev;
    if (first === undefined || first > rev + 1) return null;
    return this.buffer.filter((b) => b.patch.rev > rev).map((b) => b.patch);
  }

  private trim(now = Date.now()) {
    const cutoff = now - this.opts.bufferMs;
    let drop = Math.max(0, this.buffer.length - this.opts.bufferMax);
    while (drop < this.buffer.length && this.buffer[drop]!.at < cutoff) drop++;
    if (drop) this.buffer.splice(0, drop);
  }

  private onTransaction = (tr: Y.Transaction) => {
    if (this.closed || tr.changed.size === 0) return;
    const objectsMap = this.doc.getMap<unknown>(DOC_OBJECTS);
    const objectsType: Y.AbstractType<any> = objectsMap;
    const roots = new Map<Y.AbstractType<any>, string>();
    for (const [name, t] of this.doc.share) roots.set(t, name);
    const ids = new Set<string>();
    const exts = new Set<string>();
    for (const [type, keys] of tr.changed) {
      if (type === objectsType) {
        for (const k of keys) if (k) ids.add(k);
        continue;
      }
      // zur Wurzel hochlaufen; liegt sie bei `objects`, ist das Kind direkt darunter das Objekt
      let child: Y.AbstractType<any> = type;
      let parent = type._item?.parent;
      while (parent instanceof Y.AbstractType && parent !== objectsType && parent._item) {
        child = parent;
        parent = parent._item.parent;
      }
      if (parent === objectsType) {
        const id = child._item?.parentSub;
        if (id) ids.add(id);
        continue;
      }
      const root = parent instanceof Y.AbstractType ? parent : type;
      const name = roots.get(root);
      if (name && name !== DOC_OBJECTS) exts.add(name);
    }
    const changes: NativeChange[] = [];
    const rev = this.rev + 1;
    for (const id of ids) {
      const prev = this.objects.get(id);
      const next = serializeObject(id, objectsMap.get(id));
      if (!next) {
        if (prev) {
          this.objects.delete(id);
          this.textLog.delete(id);
          changes.push({ id, removed: true });
        }
        continue;
      }
      this.objects.set(id, next);
      if (!prev) changes.push({ id, created: next });
      else {
        const d = diffObject(prev, next);
        if (d) {
          changes.push({ id, ...d });
          const touched = [...Object.keys(d.set ?? {}), ...(d.unset ?? [])];
          if (touched.includes('content') || touched.includes('text')) this.logText(id, prev, next, rev);
        }
      }
    }
    let ext: Record<string, unknown> | undefined;
    for (const name of exts) (ext ??= {})[name] = serializeExt(this.doc, name);
    if (!changes.length && !ext) return;
    this.rev = rev;
    const patch: NativePatch = { rev, by: originUser(tr.origin), changes, ...(ext ? { ext } : {}) };
    this.buffer.push({ patch, at: Date.now() });
    this.trim();
    for (const s of this.subs) {
      try {
        s.onPatch(patch);
      } catch {
        // eine kaputte Verbindung darf die anderen nicht aufhalten
      }
    }
  };

  private logText(id: string, prev: NativeObject, next: NativeObject, rev: number) {
    let log = this.textLog.get(id);
    if (!log) this.textLog.set(id, (log = [{ rev: 0, content: prev.content, text: prev.text }]));
    log.push({ rev, content: next.content, text: next.text });
    if (log.length > TEXT_LOG_MAX) log.splice(0, log.length - TEXT_LOG_MAX);
  }

  /**
   * Rich-Text eines Objekts zur Revision `rev` (Basis einer `text`-Op); undefined = unbekannt (zu alt, Objekt fehlt,
   * Revision aus der Zukunft).
   */
  textAt(id: string, rev: number): TextVersion | undefined {
    if (!Number.isInteger(rev) || rev < 0 || rev > this.rev) return undefined;
    const log = this.textLog.get(id);
    if (!log) {
      const o = this.objects.get(id);
      return o ? { rev: 0, content: o.content, text: o.text } : undefined;
    }
    for (let i = log.length - 1; i >= 0; i--) if (log[i]!.rev <= rev) return log[i];
    return undefined;
  }

  private onAwareness = () => {
    for (const s of this.subs) s.onPresence();
  };

  /** Schließt den Spiegel (Dokument wird gespeichert und entladen, wenn sonst niemand verbunden ist). */
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.doc.off('afterTransaction', this.onTransaction);
    this.doc.awareness.off('change', this.onAwareness);
    for (const s of this.sessions.values()) s.dispose?.();
    this.sessions.clear();
    this.subs.clear();
    await this.conn.disconnect();
  }
}

/** Alle Spiegel: einer je Board, mit Verweiszählung und verzögertem Schließen. */
export class Mirrors {
  private open = new Map<string, Promise<BoardMirror>>();
  private refs = new Map<string, number>();
  private idle = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly hocuspocus: Hocuspocus<any>,
    private readonly opts: MirrorOptions,
  ) {}

  /** Spiegel holen bzw. laden; jeder acquire braucht ein release. */
  async acquire(boardId: string): Promise<BoardMirror> {
    const t = this.idle.get(boardId);
    if (t) {
      clearTimeout(t);
      this.idle.delete(boardId);
    }
    this.refs.set(boardId, (this.refs.get(boardId) ?? 0) + 1);
    let p = this.open.get(boardId);
    if (!p) {
      p = this.hocuspocus
        .openDirectConnection(boardDocName(boardId), { native: true })
        .then((conn) => new BoardMirror(boardId, conn, this.opts));
      this.open.set(boardId, p);
      p.catch(() => {
        if (this.open.get(boardId) === p) this.open.delete(boardId);
      });
    }
    try {
      const m = await p;
      if (m.isClosed) throw new Error('mirror closed');
      return m;
    } catch (e) {
      this.release(boardId);
      throw e;
    }
  }

  release(boardId: string) {
    const n = (this.refs.get(boardId) ?? 1) - 1;
    if (n > 0) {
      this.refs.set(boardId, n);
      return;
    }
    this.refs.delete(boardId);
    if (this.idle.has(boardId)) return;
    const t = setTimeout(() => {
      this.idle.delete(boardId);
      if (!this.refs.has(boardId)) void this.closeBoard(boardId);
    }, this.opts.idleMs);
    t.unref?.();
    this.idle.set(boardId, t);
  }

  /** Geladener Spiegel (ohne zu laden). */
  async peek(boardId: string): Promise<BoardMirror | null> {
    const p = this.open.get(boardId);
    return p ? p.catch(() => null) : null;
  }

  /** Spiegel sofort schließen (Board gelöscht, Herunterfahren). */
  async closeBoard(boardId: string) {
    const p = this.open.get(boardId);
    this.open.delete(boardId);
    const t = this.idle.get(boardId);
    if (t) clearTimeout(t);
    this.idle.delete(boardId);
    const m = await p?.catch(() => null);
    await m?.close();
  }

  async closeAll() {
    await Promise.all([...this.open.keys()].map((id) => this.closeBoard(id)));
  }
}
