// Native-Gateway `wss://<origin>/native/v1` (docs/contract.md §8.4): die Apps sprechen JSON auf Objekt-Ebene,
// der Server bleibt einziger Yjs-Schreiber. Je Verbindung ein Board: hello → welcome (Schnappschuss) bzw. resumed
// (fehlende Patches), danach Patches, Anwesenheit, Ops mit ack/nack.
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Hocuspocus } from '@hocuspocus/server';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  NATIVE_BELOW_TYPES,
  NATIVE_CLOSE,
  NATIVE_COMMENT_OPS,
  NATIVE_FEATURES,
  NATIVE_LIMITS,
  NATIVE_PROTO,
  type NativeCloseReason,
  type NativePatch,
} from '../../../shared/native.js';
import { WEB } from '#stachel-web';
import type { BoardRole } from '../../../shared/protocol.js';
import type { BoardAccess } from '../access.js';
import type { BoardEvent, BoardEvents } from '../board-events.js';
import { rememberVisit } from '../board-prefs.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { toUser, type Session, type SessionStore } from '../sessions.js';
import { wsOriginAllowed } from '../sync.js';
import { appSessionToken, appVersionOk } from './auth.js';
import { Mirrors, type BoardMirror } from './mirror.js';
import { NativePresence, peersOf, pickColor, type PresenceInput } from './presence.js';
import { ID_RE, OpError, validateOps } from './validate.js';
import { NativeWriter } from './writer.js';
import { serializeObjects } from './serialize.js';
import type { PrivateArea, PrivateMode } from '../private-mode.js';

const HELLO_MS = 10_000;
const PING_MS = 10_000;
const MAX_ANON_MESSAGE = 64 * 1024;
/** Sendepuffer, ab dem die App als „zu langsam“ getrennt wird (sie verbindet mit resume neu) */
const MAX_BUFFERED = 8 * 1024 * 1024;
/** Anwesenheit an die App höchstens alle … ms */
const PRESENCE_OUT_MS = 100;
/** Anwesenheit von der App höchstens alle … ms ins Dokument (der letzte Stand gilt) */
const PRESENCE_IN_MS = 50;
const MAX_MESSAGES_PER_SEC = 100;
const MAX_OPS_PER_SEC = 30;
/** gemerkte `ack.results` je Sitzung und Board (Wiederholung einer `req`, §8.12) */
const MAX_REQ_RESULTS = 100;
/**
 * Rolle `comment` (Modus local): nur Kommentar-Ops – sie schreiben `collab.comments` bzw. `collab.reads` wie das Web unter
 * dieser Rolle (sync.ts lässt dort nur COMMENT_ROOTS aus access.ts zu; `react` schreibt `collab.reactions` und fehlt
 * deshalb, ebenso Undo/Redo und Web-Aktionen).
 */
const COMMENT_OPS: ReadonlySet<string> = new Set(NATIVE_COMMENT_OPS);
const FORBIDDEN = {
  view: 'Du darfst dieses Board nur ansehen.',
  comment: 'Du darfst hier nur kommentieren.',
} as const;

const MESSAGES: Record<NativeCloseReason, string> = {
  not_logged_in: 'Bitte melde dich an.',
  unknown_board: 'Dieses Board gibt es nicht.',
  board_deleted: 'Dieses Board liegt im Papierkorb.',
  no_access: 'Du hast keinen Zugriff auf dieses Board.',
  access_changed: 'Deine Rechte für dieses Board haben sich geändert.',
  upgrade_required: 'Bitte die App aktualisieren.',
  invalid_input: 'Ungültige Nachricht.',
  rate_limited: 'Zu viele Nachrichten.',
  server_restart: 'Stachel startet neu.',
  too_slow: 'Die Verbindung ist zu langsam.',
};

export interface NativeGatewayDeps {
  cfg: Config;
  db: Db;
  sessions: SessionStore;
  hocuspocus: Hocuspocus<any>;
  events: BoardEvents;
  access: BoardAccess;
  /** Privater Modus (private-mode.ts): eigene Ablage je App-Sitzung */
  privateMode?: PrivateMode;
}

class Denied extends Error {
  constructor(
    readonly reason: NativeCloseReason,
    message?: string,
  ) {
    super(message ?? MESSAGES[reason]);
  }
}

/** Eine App-Verbindung (ein Board). */
class NativeConn {
  session: Session | null = null;
  token: string | undefined;
  mirror: BoardMirror | null = null;
  presence: NativePresence | null = null;
  writer: NativeWriter | null = null;
  role: BoardRole = 'edit';
  joined = false;
  closed = false;
  private queue: Promise<void> = Promise.resolve();
  private unsub: (() => void) | null = null;
  private offHistory: (() => void) | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceIn: PresenceInput | null = null;
  private presenceInTimer: ReturnType<typeof setTimeout> | null = null;
  private window = { start: Date.now(), messages: 0, ops: 0 };
  private want = new Set<string>(['objects', 'ext']);
  /** eigene Privat-Ablage (privater Modus): offen, solange die Sitzung auf dem Board einen Eintrag hat */
  private area: PrivateArea | null = null;
  private offArea: (() => void) | null = null;
  private areaDirty = false;
  private areaTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly ws: WebSocket,
    headerToken: string | undefined,
    private readonly gw: NativeGateway,
  ) {
    this.token = headerToken;
  }

  get boardId() {
    return this.mirror?.boardId ?? null;
  }

  send(msg: unknown) {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;
    if (this.ws.bufferedAmount > MAX_BUFFERED) return this.close('too_slow');
    this.ws.send(JSON.stringify(msg));
  }

  /** Fehler melden und mit Close-Code trennen (§8.4). */
  close(reason: NativeCloseReason, message = MESSAGES[reason]) {
    if (this.closed) return;
    if (this.ws.readyState === this.ws.OPEN && reason !== 'too_slow') this.ws.send(JSON.stringify({ t: 'error', error: reason, message }));
    this.closed = true;
    this.ws.close(NATIVE_CLOSE[reason], reason);
    this.cleanup();
  }

  onMessage(data: RawData, isBinary: boolean) {
    if (this.closed) return;
    const now = Date.now();
    if (now - this.window.start >= 1000) this.window = { start: now, messages: 0, ops: 0 };
    if (++this.window.messages > MAX_MESSAGES_PER_SEC) return this.close('rate_limited');
    if (isBinary) return this.close('invalid_input', 'Nur JSON-Textnachrichten.');
    let msg: Record<string, unknown>;
    try {
      const v = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.concat(data as Buffer[]).toString('utf8'));
      if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.t !== 'string') throw new Error('kein t');
      msg = v as Record<string, unknown>;
    } catch {
      return this.close('invalid_input', 'Nachricht ist kein gültiges JSON mit `t`.');
    }
    // der Reihe nach (hello ist asynchron)
    this.queue = this.queue.then(() => this.handle(msg)).catch(() => this.close('invalid_input'));
  }

  private async handle(msg: Record<string, unknown>) {
    if (this.closed) return;
    if (!this.joined) {
      if (msg.t !== 'hello') return this.close('invalid_input', 'Die erste Nachricht muss `hello` sein.');
      try {
        await this.hello(msg);
      } catch (e) {
        if (e instanceof Denied) return this.close(e.reason, e.message);
        throw e;
      }
      return;
    }
    switch (msg.t) {
      case 'ping':
        return this.send({ t: 'pong' });
      case 'presence':
        return this.presenceFromApp(msg);
      case 'ops':
        return this.ops(msg);
      case 'step':
        this.writer?.step();
        return;
      case 'undo':
      case 'redo':
        return this.undoRedo(msg.t, msg.req);
      case 'hello':
        return this.close('invalid_input', 'Je Verbindung ein Board (`hello` nur einmal).');
      default:
        return; // unbekannte Nachrichten ignorieren (additive Erweiterungen)
    }
  }

  private async hello(msg: Record<string, unknown>) {
    const gw = this.gw;
    // Mindestversion je App (§8.2 `minApps`): `client` fehlt bzw. unbekannt = Org-App
    const stachelApp = msg.client === 'stachel';
    const upgrade = stachelApp
      ? 'Bitte die Stachel-App aktualisieren.'
      : gw.cfg.instance.auth === 'org'
        ? `Bitte die ${gw.cfg.instance.orgAppName} aktualisieren.`
        : MESSAGES.upgrade_required;
    if (msg.proto !== NATIVE_PROTO) throw new Denied('upgrade_required', upgrade);
    if (!appVersionOk(msg.app, stachelApp ? gw.cfg.nativeMinStachelApp : gw.cfg.nativeMinApp)) throw new Denied('upgrade_required', upgrade);
    const boardId = typeof msg.board === 'string' ? msg.board : '';
    if (!ID_RE.test(boardId)) throw new Denied('invalid_input', '`board` fehlt oder ist ungültig.');
    if (!this.token && typeof msg.token === 'string') this.token = appSessionToken(`Bearer ${msg.token}`);
    const session = this.token ? await gw.sessions.getVerified(this.token) : null;
    if (!session) throw new Denied('not_logged_in');
    this.session = session;
    const row = gw.boardRow(boardId);
    if (!row) throw new Denied('unknown_board');
    if (row.deleted_at) throw new Denied('board_deleted');
    const me = { key: session.userKey, isOrga: session.isOrga };
    const role = gw.access.connectRole(me, boardId);
    if (!role) throw new Denied('no_access');
    this.role = role;
    if (Array.isArray(msg.want)) this.want = new Set(['objects', ...msg.want.filter((w): w is string => typeof w === 'string').slice(0, 50)]);
    if (this.closed) return;

    const mirror = await gw.mirrors.acquire(boardId);
    if (this.closed) {
      gw.mirrors.release(boardId);
      return;
    }
    this.mirror = mirror;
    gw.conns.add(this);
    // Privater Modus: eigene Ablage (nur mit Bearbeiten-Recht – sonst legt man ohnehin nichts an)
    if (gw.privateMode && (role === 'edit' || role === 'owner')) {
      const entry = this.reqState()!;
      if (!entry.area) {
        const area = await gw.privateMode.openArea(boardId, session.userKey);
        if (entry.area) void area.close();
        else {
          entry.area = area;
          const prev = entry.dispose;
          entry.dispose = () => {
            prev?.();
            void area.close();
          };
        }
      }
      this.area = entry.area as PrivateArea;
      if (this.closed) return;
      const onUpdate = () => this.privateChanged();
      this.area.doc.on('update', onUpdate);
      this.offArea = () => this.area?.doc.off('update', onUpdate);
    }
    rememberVisit(gw.db, session.userKey, boardId);
    const user = toUser(session);
    this.presence = new NativePresence(mirror.doc, user, pickColor(user.key, peersOf(mirror.doc, null)));
    this.unsub = mirror.subscribe({
      onPatch: (p) => this.send({ t: 'patch', ...this.filterPatch(p) }),
      onPresence: () => this.schedulePresence(),
    });
    // Schreiber erst bei der ersten Op (reines Ansehen kostet so keinen Store); ein vorhandener (Wiederverbinden) zählt
    if (mirror.sessions.get(session.id)?.data) this.ensureWriter();
    this.joined = true;

    const head = {
      proto: NATIVE_PROTO,
      epoch: mirror.epoch,
      rev: mirror.rev,
      board: { id: boardId, title: row.title },
      user,
      role,
      color: this.presence.color,
      clientId: this.presence.clientId,
      features: [...NATIVE_FEATURES],
      below: [...NATIVE_BELOW_TYPES],
      actions: WEB.actionList(gw.cfg.nativeDevActions),
    };
    const tail = { peers: peersOf(mirror.doc, this.presence.clientId), history: this.writer?.history() ?? { canUndo: false, canRedo: false } };
    const resume = msg.resume as { epoch?: unknown; rev?: unknown } | undefined;
    const patches = resume && resume.epoch === mirror.epoch && typeof resume.rev === 'number' ? mirror.patchesSince(resume.rev) : null;
    if (patches) this.send({ t: 'resumed', ...head, patches: patches.map((p) => this.filterPatch(p)), ...tail });
    else this.send({ t: 'welcome', ...head, snapshot: mirror.snapshot(this.want), ...tail });
    if (this.area) this.sendPrivate();
  }

  /** Ablage geändert (eigene Op, anderer Tab, Aufdecken): gedrosselt die ganze Ablage schicken. */
  private privateChanged() {
    this.areaDirty = true;
    if (this.areaTimer || this.closed || !this.joined) return;
    this.areaTimer = setTimeout(() => {
      this.areaTimer = null;
      if (this.areaDirty) this.sendPrivate();
    }, 30);
  }

  /** `{t:"private", objects}` = die ganze eigene Ablage (docs/features/private.md §5). */
  private sendPrivate() {
    if (!this.area) return;
    this.areaDirty = false;
    this.send({ t: 'private', objects: serializeObjects(this.area.doc) });
  }

  /**
   * Schreiber der Sitzung auf diesem Board (bleibt über Wiederverbinden erhalten, solange der Spiegel lebt); null bei
   * `view`. Für `comment` gibt es ihn, aber ops() lässt nur Kommentar-Ops durch.
   */
  private ensureWriter(): NativeWriter | null {
    if (this.writer) return this.writer;
    const mirror = this.mirror;
    const session = this.session;
    if (!mirror || !session || this.role === 'view') return null;
    const entry = this.reqState()!;
    if (!entry.data) {
      const w = new NativeWriter(mirror.doc, toUser(session), session.id, mirror, {
        dev: this.gw.cfg.nativeDevActions,
        ...(entry.area ? { privateDoc: (entry.area as PrivateArea).doc } : {}),
      });
      entry.data = w;
      const prev = entry.dispose;
      entry.dispose = () => {
        w.destroy();
        prev?.();
      };
    }
    const writer = entry.data as NativeWriter;
    this.writer = writer;
    this.offHistory = writer.onHistory(() => this.send({ t: 'history', ...writer.history() }));
    return writer;
  }

  /** Nur gewünschte Feature-Strukturen. */
  private filterPatch(p: NativePatch): NativePatch {
    if (!p.ext) return p;
    let ext: Record<string, unknown> | undefined;
    for (const [k, v] of Object.entries(p.ext)) if (this.want.has('ext') || this.want.has(k)) (ext ??= {})[k] = v;
    const { ext: _drop, ...rest } = p;
    return ext ? { ...rest, ext } : rest;
  }

  private schedulePresence() {
    if (this.presenceTimer || this.closed) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      if (this.mirror && this.presence) this.send({ t: 'presence', peers: peersOf(this.mirror.doc, this.presence.clientId) });
    }, PRESENCE_OUT_MS);
  }

  private presenceFromApp(msg: Record<string, unknown>) {
    const input: PresenceInput = {};
    for (const k of ['cursor', 'selection', 'editing', 'viewport', 'uploads'] as const) if (k in msg) input[k] = msg[k];
    // presence.extra: Teil-Aktualisierung je Schlüssel, innerhalb der Drosselung zusammengelegt (§8.4)
    const extra = msg.extra && typeof msg.extra === 'object' && !Array.isArray(msg.extra) ? (msg.extra as Record<string, unknown>) : null;
    if (extra) input.extra = { ...((this.presenceIn?.extra as Record<string, unknown> | undefined) ?? {}), ...extra };
    this.presenceIn = { ...(this.presenceIn ?? {}), ...input };
    if (this.presenceInTimer) return;
    this.presenceInTimer = setTimeout(() => {
      this.presenceInTimer = null;
      const next = this.presenceIn;
      this.presenceIn = null;
      if (next && this.presence && !this.closed) this.presence.update(next);
    }, PRESENCE_IN_MS);
  }

  /** Stand der Sitzung auf diesem Board (letzte req, Schreiber); legt ihn an. */
  private reqState() {
    if (!this.mirror || !this.session) return undefined;
    let entry = this.mirror.sessions.get(this.session.id);
    if (!entry) this.mirror.sessions.set(this.session.id, (entry = { lastReq: 0 }));
    return entry;
  }

  private ops(msg: Record<string, unknown>) {
    const req = msg.req;
    if (!Number.isSafeInteger(req) || (req as number) < 1) return this.send({ t: 'nack', req: req ?? null, error: 'invalid_input', message: '`req` muss eine positive ganze Zahl sein.' });
    if (++this.window.ops > MAX_OPS_PER_SEC) return this.send({ t: 'nack', req, error: 'rate_limited', message: MESSAGES.rate_limited });
    if (this.role === 'view') return this.send({ t: 'nack', req, error: 'forbidden', message: FORBIDDEN.view });
    if (this.role === 'comment' && Array.isArray(msg.ops)) {
      const index = msg.ops.findIndex((o) => !o || typeof o !== 'object' || !COMMENT_OPS.has(String((o as { op?: unknown }).op)));
      if (index >= 0) return this.send({ t: 'nack', req, error: 'forbidden', message: FORBIDDEN.comment, index });
    }
    const writer = this.ensureWriter();
    if (!writer) return this.send({ t: 'nack', req, error: 'forbidden', message: FORBIDDEN.view });
    const state = this.reqState()!;
    // schon ausgeführt (Wiederholung nach Funkloch): nur bestätigen (mit gemerkten Ergebnissen der Web-Aktionen)
    if ((req as number) <= state.lastReq) {
      const results = state.results?.get(req as number);
      return this.send({ t: 'ack', req, rev: this.mirror!.rev, ...(results ? { results } : {}) });
    }
    let ops;
    try {
      ops = validateOps(msg.ops, { dev: this.gw.cfg.nativeDevActions });
    } catch (e) {
      if (e instanceof OpError) return this.send({ t: 'nack', req, error: e.error, message: e.message, ...(e.index !== undefined ? { index: e.index } : {}) });
      throw e;
    }
    const { conflicts, results } = writer.apply(ops);
    state.lastReq = req as number;
    // eigene Ablage vor dem ack (die App nimmt ihre optimistische Anzeige beim ack weg)
    if (this.areaDirty) this.sendPrivate();
    const hasResults = Object.keys(results).length > 0;
    if (hasResults) {
      const memo = (state.results ??= new Map());
      memo.set(req as number, results);
      if (memo.size > MAX_REQ_RESULTS) memo.delete(memo.keys().next().value!);
    }
    this.send({ t: 'ack', req, rev: this.mirror!.rev, ...(conflicts.length ? { conflict: conflicts } : {}), ...(hasResults ? { results } : {}) });
  }

  private undoRedo(kind: 'undo' | 'redo', req: unknown) {
    if (!Number.isSafeInteger(req)) return this.send({ t: 'nack', req: req ?? null, error: 'invalid_input', message: '`req` fehlt.' });
    // Rückgängig nur mit Bearbeiten-Recht (unter `comment` nähme es sonst womöglich mehr als Kommentare zurück)
    if (this.role === 'view' || this.role === 'comment') return this.send({ t: 'nack', req, error: 'forbidden', message: FORBIDDEN[this.role] });
    const writer = this.ensureWriter();
    if (!writer) return this.send({ t: 'nack', req, error: 'forbidden', message: FORBIDDEN.view });
    const state = this.reqState()!;
    if ((req as number) <= state.lastReq) return this.send({ t: 'ack', req, rev: this.mirror!.rev });
    const done = kind === 'undo' ? writer.undo() : writer.redo();
    state.lastReq = req as number;
    if (this.areaDirty) this.sendPrivate();
    if (!done) return this.send({ t: 'nack', req, error: 'nothing', message: kind === 'undo' ? 'Nichts zum Rückgängigmachen.' : 'Nichts zum Wiederholen.' });
    this.send({ t: 'ack', req, rev: this.mirror!.rev });
  }

  cleanup() {
    this.closed = true;
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    if (this.presenceInTimer) clearTimeout(this.presenceInTimer);
    if (this.areaTimer) clearTimeout(this.areaTimer);
    this.offArea?.();
    this.unsub?.();
    this.offHistory?.();
    this.presence?.destroy();
    this.presence = null;
    if (this.gw.conns.delete(this) && this.mirror) this.gw.mirrors.release(this.mirror.boardId);
  }
}

export class NativeGateway {
  readonly conns = new Set<NativeConn>();
  readonly mirrors: Mirrors;
  readonly cfg: Config;
  readonly db: Db;
  readonly sessions: SessionStore;
  readonly access: BoardAccess;
  readonly privateMode: PrivateMode | undefined;
  private readonly wss: WebSocketServer;
  private readonly wssAnon: WebSocketServer;
  private closing = false;
  private offEvents: () => void;
  private recheck: ReturnType<typeof setInterval>;

  constructor(deps: NativeGatewayDeps) {
    this.cfg = deps.cfg;
    this.db = deps.db;
    this.sessions = deps.sessions;
    this.access = deps.access;
    this.privateMode = deps.privateMode;
    this.mirrors = new Mirrors(deps.hocuspocus, { idleMs: deps.cfg.nativeIdleMs, bufferMax: deps.cfg.nativeBufferMax, bufferMs: deps.cfg.nativeBufferMs });
    const deflate = { threshold: 1024 };
    this.wss = new WebSocketServer({ noServer: true, maxPayload: NATIVE_LIMITS.maxMessageBytes, perMessageDeflate: deflate });
    this.wssAnon = new WebSocketServer({ noServer: true, maxPayload: MAX_ANON_MESSAGE, perMessageDeflate: deflate });
    this.offEvents = deps.events.on((e) => this.onBoardEvent(e));
    // offene Verbindungen prüfen ihre Sitzung regelmäßig nach (abgelaufen, abgemeldet, beim Identitätsdienst gesperrt)
    this.recheck = setInterval(() => void this.recheckSessions(), deps.cfg.syncRecheckMs);
    this.recheck.unref();
  }

  boardRow(id: string) {
    return this.db.prepare('SELECT title, deleted_at FROM boards WHERE id = ?').get(id) as { title: string; deleted_at: string | null } | undefined;
  }

  /** WebSocket-Upgrade auf /native/v1 (aus sync.attach). */
  handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const reject = (status: number, text: string) => socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    if (!wsOriginAllowed(this.cfg, req)) return reject(403, 'Forbidden');
    if (this.closing) return reject(503, 'Service Unavailable');
    const token = appSessionToken(req.headers.authorization);
    // ohne gültiges Token nur kleine Nachrichten (die Anmeldung im hello)
    const server = token && this.sessions.get(token) ? this.wss : this.wssAnon;
    server.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, token));
  };

  private onConnection(ws: WebSocket, token: string | undefined) {
    const conn = new NativeConn(ws, token, this);
    const helloTimer = setTimeout(() => {
      if (!conn.joined) conn.close('invalid_input', 'Kein `hello` innerhalb von 10 s.');
    }, HELLO_MS);
    let alive = true;
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, PING_MS);
    ws.on('pong', () => {
      alive = true;
    });
    ws.on('message', (data, isBinary) => conn.onMessage(data, isBinary));
    ws.on('close', () => {
      clearTimeout(helloTimer);
      clearInterval(ping);
      conn.cleanup();
    });
    ws.on('error', () => ws.terminate());
  }

  private onBoardEvent(e: BoardEvent) {
    if (e.type === 'renamed') {
      for (const c of this.conns) if (c.boardId === e.id) c.send({ t: 'event', type: 'board.renamed', title: e.title, titleSeq: e.titleSeq });
    } else if (e.type === 'deleted' || e.type === 'purged') {
      for (const c of [...this.conns]) {
        if (c.boardId !== e.id) continue;
        if (e.type === 'deleted') c.send({ t: 'event', type: 'board.deleted', by: e.by, byKey: e.byKey });
        c.close('board_deleted');
      }
      void this.mirrors.closeBoard(e.id);
    }
  }

  private async recheckSessions() {
    for (const c of [...this.conns]) {
      if (!c.token) continue;
      try {
        if (!(await this.sessions.getVerified(c.token))) c.close('not_logged_in');
      } catch {
        // nächste Runde
      }
    }
  }

  /** Abmelden (DELETE /api/auth/app-session): Verbindungen dieser Sitzung trennen. */
  dropSession(token: string) {
    for (const c of [...this.conns]) if (c.token === token) c.close('not_logged_in');
  }

  /**
   * Rechte geändert bzw. Konto weg / Passwort geändert (Modus local): wie sync.dropUser; `exceptToken` = die eigene
   * App-Sitzung bleibt verbunden.
   */
  dropUser(userKey: string, opts: { boardId?: string; exceptToken?: string } = {}) {
    for (const c of [...this.conns]) {
      if (c.session?.userKey !== userKey) continue;
      if (opts.boardId && c.boardId !== opts.boardId) continue;
      if (opts.exceptToken && c.token === opts.exceptToken) continue;
      c.close(opts.boardId ? 'access_changed' : 'not_logged_in');
    }
  }

  async close() {
    this.closing = true;
    this.offEvents();
    clearInterval(this.recheck);
    for (const c of [...this.conns]) c.close('server_restart');
    for (const s of [this.wss, this.wssAnon]) {
      for (const ws of s.clients) ws.terminate();
      s.close();
    }
    await this.mirrors.closeAll();
  }
}
