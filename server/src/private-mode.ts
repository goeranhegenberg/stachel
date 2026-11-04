// Privater Modus (docs/features/private.md): verdeckt schreiben, gemeinsam aufdecken – serverseitig durchgesetzt.
// Private Objekte liegen NICHT im Board-Dokument, sondern je Person in einer eigenen Privat-Ablage (Yjs-Dokument
// `private:<board>:<key>`, Tabelle `private_docs`), die nur diese Person öffnen darf. Ins Board schreibt der Server nur
// Platzhalter (`private.hidden`: Lage, Größe, Typ – nie Inhalt) und den Zustand (`private.mode`). Aufdecken kopiert die
// Objekte samt Y-Feldern ins Board und leert die Ablagen. Updates von Clients, die diese beiden Wurzeln berühren,
// verwirft sync.ts (messageAllowed) – nur der Server schreibt sie.
import crypto from 'node:crypto';
import type { Extension, Hocuspocus } from '@hocuspocus/server';
import type { FastifyInstance } from 'fastify';
import * as Y from 'yjs';
import {
  boardDocName,
  DOC_OBJECTS,
  PRIVATE_HIDDEN,
  PRIVATE_MODE,
  privateDocName,
  privateKeyPart,
  type PrivateModeState,
  type PrivatePlaceholder,
} from '../../shared/protocol.js';
import type { BoardAccess } from './access.js';
import { messageUpdate } from './access.js';
import { touchedRoots } from './comment-guard.js';
import { nowIso, type Db } from './db.js';
import { sendError } from './http-util.js';

const PRIVATE_DOC = /^private:([A-Za-z0-9_-]{1,64}):([A-Za-z0-9_-]{1,400})$/;
const BOARD_DOC = /^board:([A-Za-z0-9_-]{1,64})$/;
/** Wurzeln, die nur der Server schreibt */
const SERVER_ROOTS: ReadonlySet<string> = new Set([PRIVATE_MODE, PRIVATE_HIDDEN]);
/** Origin der Server-Schreibschritte (Versionsverlauf/Patch: keine Person) */
export const PRIVATE_ORIGIN = { source: 'private-mode' } as const;
/** Platzhalter nachziehen höchstens alle … ms je Ablage */
const SYNC_MS = 40;
export const MAX_COUNTDOWN_S = 10;
export const DEFAULT_COUNTDOWN_S = 3;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS private_docs (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_key TEXT NOT NULL,
  state BLOB NOT NULL,            -- Yjs-Stand der Privat-Ablage (objects)
  updated_at TEXT NOT NULL,
  PRIMARY KEY (board_id, user_key)
);
CREATE INDEX IF NOT EXISTS private_docs_user ON private_docs(user_key);
CREATE TABLE IF NOT EXISTS private_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`;

/** Board und Person aus dem Namen einer Privat-Ablage; null = kein (gültiger) Ablage-Name. */
export function parsePrivateDoc(name: string): { boardId: string; userKey: string } | null {
  const m = PRIVATE_DOC.exec(name);
  if (!m) return null;
  const userKey = Buffer.from(m[2]!, 'base64url').toString('utf8');
  // nur die kanonische Schreibweise (sonst zwei Dokumente für dieselbe Person)
  if (!userKey || privateKeyPart(userKey) !== m[2]) return null;
  return { boardId: m[1]!, userKey };
}

export interface ControlUser {
  key: string;
  name: string;
  isOrga?: boolean;
}

export interface ControlBody {
  action?: unknown;
  anonymous?: unknown;
  ownReveal?: unknown;
  countdown?: unknown;
}

export type ControlResult = { ok: true; state: PrivateModeState } | { ok: false; status: number; error: string; message: string };

type DirectConnection = Awaited<ReturnType<Hocuspocus['openDirectConnection']>>;

/** Eigene Ablage einer Verbindung der Native-API (offen, solange die App-Sitzung auf dem Board ist). */
export interface PrivateArea {
  readonly doc: Y.Doc;
  close(): Promise<void>;
}

export interface PrivateModeDeps {
  db: Db;
  access?: BoardAccess;
  /** Ersteller:in des Boards (zählt im Modus org als Besitzer:in) */
  boardOwner(boardId: string): string | null;
}

export class PrivateMode {
  private hp: Hocuspocus<any> | null = null;
  private readonly secret: string;
  /** Countdown je Board */
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Platzhalter nachziehen je Ablage (gedrosselt) */
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  /** Beobachter je geladener Ablage */
  private watching = new Map<string, () => void>();
  /** Schreibschritte je Board der Reihe nach (Aufdecken und Nachziehen dürfen sich nicht überholen) */
  private chains = new Map<string, Promise<unknown>>();
  private stopped = false;

  constructor(private readonly deps: PrivateModeDeps) {
    deps.db.exec(SCHEMA);
    const row = deps.db.prepare("SELECT v FROM private_meta WHERE k = 'secret'").get() as { v: string } | undefined;
    if (row) this.secret = row.v;
    else {
      this.secret = crypto.randomBytes(32).toString('base64url');
      deps.db.prepare("INSERT INTO private_meta (k, v) VALUES ('secret', ?)").run(this.secret);
    }
  }

  attach(hp: Hocuspocus<any>) {
    this.hp = hp;
  }

  /** Undurchsichtiges Kürzel je Person und Board (Platzhalter `o`). */
  tag(boardId: string, userKey: string): string {
    return crypto.createHmac('sha256', this.secret).update(`${boardId}\n${userKey}`).digest('base64url').slice(0, 12);
  }

  // ---- Speichern (aus sync.ts onLoadDocument/onStoreDocument) ------------------------------------------------------

  /** Ablage laden; false = kein Ablage-Name. */
  load(documentName: string, doc: Y.Doc): boolean {
    const p = parsePrivateDoc(documentName);
    if (!p) return false;
    const row = this.deps.db.prepare('SELECT state FROM private_docs WHERE board_id = ? AND user_key = ?').get(p.boardId, p.userKey) as
      | { state: Uint8Array }
      | undefined;
    if (row) Y.applyUpdate(doc, row.state);
    return true;
  }

  /** Ablage speichern (leer → Zeile weg); false = kein Ablage-Name. */
  store(documentName: string, doc: Y.Doc): boolean {
    const p = parsePrivateDoc(documentName);
    if (!p) return false;
    const db = this.deps.db;
    const board = db.prepare('SELECT 1 FROM boards WHERE id = ?').get(p.boardId);
    if (!board) return true; // endgültig gelöscht
    if (doc.getMap(DOC_OBJECTS).size === 0) {
      db.prepare('DELETE FROM private_docs WHERE board_id = ? AND user_key = ?').run(p.boardId, p.userKey);
      return true;
    }
    db.prepare(
      `INSERT INTO private_docs (board_id, user_key, state, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(board_id, user_key) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
    ).run(p.boardId, p.userKey, Y.encodeStateAsUpdate(doc), nowIso());
    return true;
  }

  /** Darf diese Verbindung die Ablage öffnen? Nur die Person selbst (ihr KI-Token zählt als sie). */
  owns(documentName: string, userKey: string): { boardId: string } | null {
    const p = parsePrivateDoc(documentName);
    return p && p.userKey === userKey ? { boardId: p.boardId } : null;
  }

  isPrivateDoc(documentName: string): boolean {
    return PRIVATE_DOC.test(documentName);
  }

  /**
   * Sync-Nachricht an ein Board-Dokument zulassen? Updates, die `private.mode` oder `private.hidden` berühren, nicht
   * (die schreibt nur der Server). Nicht zuzuordnende Updates werden auf einer Kopie geprüft.
   */
  messageAllowed(documentName: string, doc: Y.Doc, message: Uint8Array): boolean {
    if (!BOARD_DOC.test(documentName)) return true;
    const update = messageUpdate(message);
    if (update === null || update === 'invalid') return true; // 'invalid' lehnt der Kommentar-Wächter ab
    // Schnellweg (jede Tastatureingabe läuft hier durch, große Boards kommen als ein Update; touchedRoots wäre dort
    // quadratisch): Ein neuer Eintrag direkt in einer Wurzel-Map trägt deren Namen im Update; sonst hängt er an einem
    // vorhandenen Eintrag (Schlüssel überschreiben) bzw. löscht einen – beides prüft touchesExisting im Dokument.
    if (Buffer.from(update.buffer, update.byteOffset, update.byteLength).includes(ROOT_PREFIX)) {
      const roots = touchedRoots(doc, update);
      if (roots) return ![...roots].some((r) => SERVER_ROOTS.has(r));
      return !touchesOnCopy(doc, update);
    }
    return !touchesExisting(doc, update);
  }

  // ---- Hocuspocus-Erweiterung --------------------------------------------------------------------------------------

  readonly hooks: Extension = {
    afterLoadDocument: async ({ documentName, document }) => {
      if (parsePrivateDoc(documentName)) {
        this.watch(documentName, document);
        return;
      }
      const id = BOARD_DOC.exec(documentName)?.[1];
      // Countdown lief beim Neustart: weiter bzw. sofort aufdecken
      if (id) {
        const at = document.getMap<unknown>(PRIVATE_MODE).get('revealAt');
        if (document.getMap<unknown>(PRIVATE_MODE).get('on') === true && typeof at === 'number') this.schedule(id, at);
      }
    },
    afterUnloadDocument: async ({ documentName }) => {
      this.watching.get(documentName)?.();
      this.watching.delete(documentName);
    },
  };

  private watch(name: string, doc: Y.Doc) {
    this.watching.get(name)?.();
    const onUpdate = () => this.scheduleSync(name);
    doc.on('update', onUpdate);
    this.watching.set(name, () => doc.off('update', onUpdate));
    // beim Laden einmal abgleichen (Platzhalter nach Neustart, Auto-Aufdecken bei abgelaufenem Modus)
    this.scheduleSync(name);
  }

  private scheduleSync(name: string) {
    if (this.pending.has(name) || this.stopped) return;
    const t = setTimeout(() => {
      this.pending.delete(name);
      const p = parsePrivateDoc(name);
      if (p) void this.serial(p.boardId, () => this.syncHidden(p.boardId, p.userKey)).catch((e) => console.error('[private] Platzhalter', e));
    }, SYNC_MS);
    t.unref?.();
    this.pending.set(name, t);
  }

  /** Schreibschritte eines Boards nacheinander. */
  private serial<T>(boardId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(boardId) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.chains.set(boardId, next);
    void next.finally(() => {
      if (this.chains.get(boardId) === next) this.chains.delete(boardId);
    }).catch(() => {});
    return next;
  }

  private get hocuspocus(): Hocuspocus<any> {
    if (!this.hp) throw new Error('PrivateMode ohne Hocuspocus');
    return this.hp;
  }

  /** Dokument öffnen (geladen oder per Direktverbindung), `fn` ausführen, wieder freigeben. */
  private async withDoc<T>(name: string, fn: (doc: Y.Doc) => T): Promise<T> {
    const conn = await this.hocuspocus.openDirectConnection(name, { privateMode: true });
    try {
      return fn(conn.document!);
    } finally {
      await conn.disconnect();
    }
  }

  /** Platzhalter der Person im Board an ihre Ablage angleichen; läuft der Modus nicht, alles aufdecken. */
  private async syncHidden(boardId: string, userKey: string) {
    const name = privateDocName(boardId, userKey);
    const pdoc = this.hocuspocus.documents.get(name);
    if (!pdoc) return; // inzwischen entladen (beim nächsten Laden wieder)
    const objects = pdoc.getMap<unknown>(DOC_OBJECTS);
    const tag = this.tag(boardId, userKey);
    await this.withDoc(boardDocName(boardId), (main) => {
      const mode = main.getMap<unknown>(PRIVATE_MODE);
      if (mode.get('on') !== true) {
        if (objects.size) revealInto(main, [{ doc: pdoc, tag }], mode.get('anonymous') === true);
        else removeTag(main, tag);
        return;
      }
      const anonymous = mode.get('anonymous') === true;
      const hidden = main.getMap<unknown>(PRIVATE_HIDDEN);
      const want = new Map<string, PrivatePlaceholder>();
      objects.forEach((m, id) => {
        const p = placeholderOf(m, anonymous ? undefined : userKey, tag);
        if (p) want.set(id, p);
      });
      const changes: [string, PrivatePlaceholder | null][] = [];
      hidden.forEach((v, id) => {
        if ((v as { o?: unknown } | null)?.o === tag && !want.has(id)) changes.push([id, null]);
      });
      for (const [id, p] of want) {
        const cur = hidden.get(id);
        if (JSON.stringify(cur) !== JSON.stringify(p)) changes.push([id, p]);
      }
      if (!changes.length) return;
      main.transact(() => {
        for (const [id, p] of changes) {
          if (p) hidden.set(id, p);
          else hidden.delete(id);
        }
      }, PRIVATE_ORIGIN);
    });
  }

  // ---- Zustand und Steuerung -------------------------------------------------------------------------------------

  async state(boardId: string): Promise<PrivateModeState> {
    return this.withDoc(boardDocName(boardId), (main) => modeOf(main));
  }

  /** Zahl der eigenen verdeckten Objekte. */
  async mine(boardId: string, userKey: string): Promise<number> {
    return this.withDoc(privateDocName(boardId, userKey), (d) => d.getMap(DOC_OBJECTS).size);
  }

  /** Ist die Person mit diesem Key gerade auf dem Board (Web, App oder KI)? */
  private present(boardId: string, userKey: string | undefined): boolean {
    if (!userKey) return false;
    const doc = this.hocuspocus.documents.get(boardDocName(boardId));
    if (!doc) return false;
    for (const s of doc.awareness.getStates().values()) {
      const k = (s as { user?: { key?: unknown } } | null)?.user?.key;
      if (k === userKey || k === `ai:${userKey}`) return true;
    }
    return false;
  }

  /** Moderation: wer gestartet hat, Besitzer:in (Modus org: Ersteller:in bzw. Orga), alle wenn die Moderation weg ist. */
  private canModerate(boardId: string, user: ControlUser, state: PrivateModeState): boolean {
    if (state.by === user.key) return true;
    const access = this.deps.access;
    if (access?.local) {
      if (access.roleOf({ key: user.key }, boardId) === 'owner') return true;
    } else if (user.isOrga || this.deps.boardOwner(boardId) === user.key) return true;
    return !this.present(boardId, state.by);
  }

  /** REST `POST /api/boards/:id/private` (Rolle edit prüft der Zugriffs-Wächter). */
  async control(boardId: string, user: ControlUser, body: ControlBody): Promise<ControlResult> {
    const action = body.action;
    const fail = (status: number, error: string, message: string): ControlResult => ({ ok: false, status, error, message });
    return this.serial(boardId, async () => {
      const state = await this.state(boardId);
      switch (action) {
        case 'start': {
          if (state.on) return fail(409, 'already_running', 'Der private Modus läuft schon.');
          const next: PrivateModeState = {
            on: true,
            by: user.key,
            byName: user.name,
            since: nowIso(),
            anonymous: body.anonymous === true,
            ownReveal: body.ownReveal === true,
          };
          await this.withDoc(boardDocName(boardId), (main) =>
            main.transact(() => {
              const m = main.getMap<unknown>(PRIVATE_MODE);
              m.forEach((_v, k) => m.delete(k));
              for (const [k, v] of Object.entries(next)) m.set(k, v);
            }, PRIVATE_ORIGIN),
          );
          return { ok: true, state: next };
        }
        case 'reveal': {
          if (!state.on) return fail(409, 'not_running', 'Der private Modus läuft gerade nicht.');
          if (!this.canModerate(boardId, user, state)) return fail(403, 'not_facilitator', `Aufdecken kann nur ${state.byName ?? 'die Moderation'}.`);
          const c = body.countdown;
          const seconds = c === undefined ? DEFAULT_COUNTDOWN_S : typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= MAX_COUNTDOWN_S ? c : -1;
          if (seconds < 0) return fail(400, 'invalid_input', `Countdown 0 bis ${MAX_COUNTDOWN_S} Sekunden.`);
          if (seconds === 0) {
            await this.revealNow(boardId);
            return { ok: true, state: { on: false } };
          }
          const at = Date.now() + seconds * 1000;
          await this.withDoc(boardDocName(boardId), (main) => main.transact(() => main.getMap<unknown>(PRIVATE_MODE).set('revealAt', at), PRIVATE_ORIGIN));
          this.schedule(boardId, at);
          return { ok: true, state: { ...state, revealAt: at } };
        }
        case 'cancel': {
          if (!state.on || state.revealAt === undefined) return fail(409, 'not_running', 'Es läuft kein Countdown.');
          if (!this.canModerate(boardId, user, state)) return fail(403, 'not_facilitator', `Abbrechen kann nur ${state.byName ?? 'die Moderation'}.`);
          this.unschedule(boardId);
          await this.withDoc(boardDocName(boardId), (main) => main.transact(() => main.getMap<unknown>(PRIVATE_MODE).delete('revealAt'), PRIVATE_ORIGIN));
          const { revealAt: _r, ...rest } = state;
          return { ok: true, state: rest };
        }
        case 'revealOwn': {
          if (!state.on) return fail(409, 'not_running', 'Der private Modus läuft gerade nicht.');
          if (!state.ownReveal && !this.canModerate(boardId, user, state)) return fail(403, 'own_reveal_off', 'Eigene Notizen vorher aufdecken ist in dieser Runde aus.');
          await this.revealNow(boardId, user.key);
          return { ok: true, state };
        }
        default:
          return fail(400, 'invalid_input', '`action` muss start, reveal, cancel oder revealOwn sein.');
      }
    });
  }

  private schedule(boardId: string, at: number) {
    this.unschedule(boardId);
    const t = setTimeout(() => {
      this.timers.delete(boardId);
      void this.serial(boardId, async () => {
        const s = await this.state(boardId);
        if (s.on && s.revealAt === at) await this.revealNow(boardId);
      }).catch((e) => console.error('[private] Aufdecken', e));
    }, Math.max(0, at - Date.now()));
    t.unref?.();
    this.timers.set(boardId, t);
  }

  private unschedule(boardId: string) {
    const t = this.timers.get(boardId);
    if (t) clearTimeout(t);
    this.timers.delete(boardId);
  }

  /** Ablagen eines Boards (gespeicherte und gerade geladene), wahlweise nur einer Person. */
  private areaKeys(boardId: string, only?: string): string[] {
    const keys = new Set<string>();
    for (const r of this.deps.db.prepare('SELECT user_key FROM private_docs WHERE board_id = ?').all(boardId) as { user_key: string }[]) keys.add(r.user_key);
    for (const name of this.hocuspocus.documents.keys()) {
      const p = parsePrivateDoc(name);
      if (p?.boardId === boardId) keys.add(p.userKey);
    }
    return [...keys].filter((k) => only === undefined || k === only);
  }

  /**
   * Aufdecken (läuft in `serial`): Objekte aller (bzw. einer) Ablage(n) ins Board kopieren, Platzhalter weg, Ablagen
   * leeren. Ohne `only` endet der Modus.
   */
  private async revealNow(boardId: string, only?: string) {
    if (!only) this.unschedule(boardId);
    const conns: { conn: DirectConnection; tag: string }[] = [];
    try {
      for (const key of this.areaKeys(boardId, only)) {
        conns.push({ conn: await this.hocuspocus.openDirectConnection(privateDocName(boardId, key), { privateMode: true }), tag: this.tag(boardId, key) });
      }
      await this.withDoc(boardDocName(boardId), (main) => {
        const mode = main.getMap<unknown>(PRIVATE_MODE);
        revealInto(main, conns.map((c) => ({ doc: c.conn.document!, tag: c.tag })), mode.get('anonymous') === true, !only);
      });
    } finally {
      for (const c of conns) await c.conn.disconnect();
    }
  }

  // ---- Native-API ------------------------------------------------------------------------------------------------

  /** Eigene Ablage für eine App-Sitzung öffnen (bleibt offen bis `close`). */
  async openArea(boardId: string, userKey: string): Promise<PrivateArea> {
    const conn = await this.hocuspocus.openDirectConnection(privateDocName(boardId, userKey), { privateMode: true, native: true });
    let closed = false;
    return {
      doc: conn.document!,
      close: async () => {
        if (closed) return;
        closed = true;
        await conn.disconnect();
      },
    };
  }

  // ---- Aufräumen ---------------------------------------------------------------------------------------------------

  /** Person vergessen (forget-person.ts): ihre Ablagen löschen (offene leeren). */
  async forgetUser(userKey: string) {
    this.deps.db.prepare('DELETE FROM private_docs WHERE user_key = ?').run(userKey);
    for (const [name, doc] of this.hp?.documents ?? []) {
      if (parsePrivateDoc(name)?.userKey !== userKey) continue;
      const objects = doc.getMap(DOC_OBJECTS);
      doc.transact(() => objects.forEach((_v, k) => objects.delete(k)), PRIVATE_ORIGIN);
    }
  }

  /** Namen der geladenen Ablagen eines Boards (Board gelöscht: Verbindungen trennen). */
  loadedAreas(boardId: string): string[] {
    return [...(this.hp?.documents.keys() ?? [])].filter((n) => parsePrivateDoc(n)?.boardId === boardId);
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    for (const t of this.pending.values()) clearTimeout(t);
    this.timers.clear();
    this.pending.clear();
    for (const off of this.watching.values()) off();
    this.watching.clear();
  }
}

/** `private.mode` als JSON. */
export function modeOf(doc: Y.Doc): PrivateModeState {
  const m = doc.getMap<unknown>(PRIVATE_MODE);
  if (m.get('on') !== true) return { on: false };
  const out: PrivateModeState = { on: true };
  for (const k of ['by', 'byName', 'since'] as const) {
    const v = m.get(k);
    if (typeof v === 'string') out[k] = v;
  }
  out.anonymous = m.get('anonymous') === true;
  out.ownReveal = m.get('ownReveal') === true;
  const at = m.get('revealAt');
  if (typeof at === 'number') out.revealAt = at;
  return out;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Platzhalter eines privaten Objekts: nur Lage, Größe, Typ, Drehung. */
function placeholderOf(m: unknown, by: string | undefined, o: string): PrivatePlaceholder | null {
  if (!(m instanceof Y.Map)) return null;
  const type = m.get('type');
  if (typeof type !== 'string') return null;
  const rotation = m.get('rotation');
  return {
    x: num(m.get('x'), 0),
    y: num(m.get('y'), 0),
    w: Math.max(1, num(m.get('w'), 100)),
    h: Math.max(1, num(m.get('h'), 100)),
    type,
    ...(typeof rotation === 'number' && Number.isFinite(rotation) && rotation ? { rotation } : {}),
    ...(by ? { by } : {}),
    o,
  };
}

function removeTag(main: Y.Doc, tag: string) {
  const hidden = main.getMap<unknown>(PRIVATE_HIDDEN);
  const stale: string[] = [];
  hidden.forEach((v, id) => {
    if ((v as { o?: unknown } | null)?.o === tag) stale.push(id);
  });
  if (stale.length) main.transact(() => stale.forEach((id) => hidden.delete(id)), PRIVATE_ORIGIN);
}

/**
 * Objekte der Ablagen ins Board kopieren (gleiche ID, Y-Felder geklont; anonym ohne `createdBy`), danach erst die
 * Ablagen leeren – wer zusieht, sieht das Objekt nie doppelt und nie gar nicht. `end` beendet den Modus.
 */
function revealInto(main: Y.Doc, areas: { doc: Y.Doc; tag: string }[], anonymous: boolean, end = false) {
  const objects = main.getMap<Y.Map<unknown>>(DOC_OBJECTS);
  const hidden = main.getMap<unknown>(PRIVATE_HIDDEN);
  const tags = new Set(areas.map((a) => a.tag));
  main.transact(() => {
    for (const a of areas) {
      a.doc.getMap<unknown>(DOC_OBJECTS).forEach((m, id) => {
        if (!(m instanceof Y.Map) || typeof m.get('type') !== 'string' || objects.has(id)) return;
        const copy = m.clone();
        if (anonymous) copy.set('createdBy', '');
        objects.set(id, copy);
      });
    }
    if (end) {
      hidden.forEach((_v, id) => hidden.delete(id));
      const mode = main.getMap<unknown>(PRIVATE_MODE);
      mode.forEach((_v, k) => mode.delete(k));
      mode.set('on', false);
    } else {
      hidden.forEach((v, id) => {
        if (tags.has(String((v as { o?: unknown } | null)?.o))) hidden.delete(id);
      });
    }
  }, PRIVATE_ORIGIN);
  for (const a of areas) {
    const pobjects = a.doc.getMap<unknown>(DOC_OBJECTS);
    if (pobjects.size) a.doc.transact(() => pobjects.forEach((_v, k) => pobjects.delete(k)), PRIVATE_ORIGIN);
  }
}

const ROOT_PREFIX = Buffer.from('private.', 'utf8');

/**
 * Hängt das Update an vorhandene Einträge in `private.mode`/`private.hidden` an (Schlüssel überschreiben: linker bzw.
 * rechter Nachbar liegt dort) oder löscht dort? In den Wurzeln liegen nur JSON-Werte (keine verschachtelten Typen).
 */
function touchesExisting(doc: Y.Doc, update: Uint8Array): boolean {
  const roots = new Set([...SERVER_ROOTS].map((n) => doc.share.get(n)).filter((t): t is Y.AbstractType<any> => !!t));
  if (!roots.size) return false;
  const { structs, ds } = Y.decodeUpdate(update);
  const inRoots = (id: Y.ID | null) => {
    if (!id || id.clock >= Y.getState(doc.store, id.client)) return false;
    const it = Y.getItem(doc.store, id);
    return it instanceof Y.Item && roots.has(it.parent as Y.AbstractType<any>);
  };
  for (const s of structs) if (s instanceof Y.Item && (inRoots(s.origin) || inRoots(s.rightOrigin))) return true;
  for (const [client, ranges] of ds.clients) {
    const list = doc.store.clients.get(client);
    if (!list) continue;
    const have = Y.getState(doc.store, client);
    for (const { clock, len } of ranges) {
      if (clock >= have) continue;
      for (let i = Y.findIndexSS(list, clock); i < list.length && list[i]!.id.clock < clock + len; i++) {
        const s = list[i]!;
        if (s instanceof Y.Item && roots.has(s.parent as Y.AbstractType<any>)) return true;
      }
    }
  }
  return false;
}

/** Ändert das Update (auf einer Kopie eingespielt) eine der Server-Wurzeln? Fehlende Vorgänger gelten als ja. */
function touchesOnCopy(doc: Y.Doc, update: Uint8Array): boolean {
  if (Y.snapshotContainsUpdate(Y.snapshot(doc), update)) return false;
  const copy = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    let touched = false;
    copy.on('afterTransaction', (tr: Y.Transaction) => {
      for (const t of tr.changed.keys()) {
        let root: Y.AbstractType<any> = t;
        while (root._item) root = root._item.parent as Y.AbstractType<any>;
        const name = [...copy.share].find(([, v]) => v === root)?.[0];
        if (name && SERVER_ROOTS.has(name)) touched = true;
      }
    });
    Y.applyUpdate(copy, update);
    const store = copy.store as unknown as { pendingStructs: unknown; pendingDs: unknown };
    return touched || !!store.pendingStructs || !!store.pendingDs;
  } catch {
    return true;
  } finally {
    copy.destroy();
  }
}

/** REST-Routen (im Bereich mit Sitzungspflicht; Rolle: GET view, POST edit über den Zugriffs-Wächter). */
export function registerPrivateRoutes(scope: FastifyInstance, pm: PrivateMode, boardExists: (id: string) => boolean) {
  scope.get<{ Params: { id: string } }>('/api/boards/:id/private', async (req, reply) => {
    if (!boardExists(req.params.id)) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
    const s = req.session!;
    return { ok: true, state: await pm.state(req.params.id), mine: await pm.mine(req.params.id, s.userKey) };
  });
  scope.post<{ Params: { id: string } }>('/api/boards/:id/private', async (req, reply) => {
    if (!boardExists(req.params.id)) return sendError(reply, 404, 'not_found', 'Dieses Board gibt es nicht.');
    const s = req.session!;
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as ControlBody;
    const r = await pm.control(req.params.id, { key: s.userKey, name: s.name, isOrga: s.isOrga }, body);
    if (!r.ok) return sendError(reply, r.status, r.error, r.message);
    return { ok: true, state: r.state };
  });
}
