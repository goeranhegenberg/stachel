// Yjs-Sync über Hocuspocus am selben HTTP-Server (WebSocket-Upgrade auf SYNC_PATH).
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { Hocuspocus, type Document } from '@hocuspocus/server';
import { WebSocketServer, type WebSocket } from 'ws';
import * as Y from 'yjs';
import { SESSION_COOKIE, SYNC_PATH, type User } from '../../shared/protocol.js';
import type { Config } from './config.js';
import { nowIso, type Db } from './db.js';
import { parseCookieHeader } from './http-util.js';
import { toUser, type SessionStore } from './sessions.js';
import type { BoardEvent, BoardEvents } from './board-events.js';
import { rememberVisit } from './board-prefs.js';
import { BoardVersions } from './versions.js';
import { aiUser, type ApiTokens } from './api-tokens.js';
import { commentMessageAllowed, type BoardAccess } from './access.js';
import { NativeInbox } from './native/inbox.js';
import { ImageBinding } from './image-binding.js';
import { CommentGuard } from './comment-guard.js';
import { PrivateMode } from './private-mode.js';

export interface SyncContext {
  user: User;
  /** Verbindung eines KI-Assistenten mit API-Token (api-tokens.ts); `user` ist dann „KI (für <Name>)“ */
  apiTokenId?: string;
  /** Rolle „kommentieren“ (Modus local, access.ts): nur Änderungen an Kommentaren werden übernommen */
  commentOnly?: boolean;
  /** Rolle „ansehen“: schreibgeschützt für die ganze Verbindung */
  viewOnly?: boolean;
}

/** Fehler mit reason → Client bekommt „permission denied“ mit diesem Grund. */
class SyncDenied extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

const BOARD_DOC = /^board:([A-Za-z0-9_-]{1,64})$/;
/**
 * WebSocket-Ping des Servers: Antwortet ein Client zweimal nicht (WLAN weg, Laptop zugeklappt), wird die Verbindung
 * nach höchstens 2 × PING_MS getrennt und die Person verschwindet bei den anderen aus der Anwesenheit.
 */
const PING_MS = 5_000;
/** Interner Header (vom Server selbst gesetzt): ordnet Hocuspocus-Verbindungen ihrem WebSocket zu. */
const SOCKET_HEADER = 'x-stachel-socket';
/** So lange kennt der Server gelöschte Boards (Grund `board_deleted` statt `unknown_board` beim Wiederverbinden). */
const DELETED_TTL_MS = 24 * 3600_000;
const MAX_DELETED = 1000;
/** Größte Nachricht mit gültiger Sitzung (Einfügen/Offline-Stand großer Boards; Bilder gehen per HTTP). */
export const MAX_SYNC_MESSAGE = 16 * 1024 * 1024;
/** Ohne gültige Sitzung reicht das für den Anmelde-Handshake; mehr wird gar nicht erst gepuffert. */
export const MAX_ANON_MESSAGE = 64 * 1024;
/** Hocuspocus-Nachrichtentyp Awareness (MessageType.Awareness). */
const MSG_AWARENESS = 1;
const MAX_AWARENESS_NAME = 200;

/** Awareness-Fehler → Hocuspocus schließt die Verbindung zu diesem Dokument. */
class AwarenessRejected extends Error {
  readonly code = 1008;
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

/** Fremde Origins dürfen keine WebSocket-Verbindung aufbauen (Browser); ohne Origin (Apps, Server) ist es erlaubt. */
export function wsOriginAllowed(cfg: Pick<Config, 'publicUrl' | 'allowedOrigins'>, req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // Nicht-Browser-Clients
  if (origin === new URL(cfg.publicUrl).origin || cfg.allowedOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function boardIdFromDoc(name: string): string | null {
  return BOARD_DOC.exec(name)?.[1] ?? null;
}

/** Minimaler Leser für das lib0-Format (varUint, varString, varUint8Array) der Hocuspocus-Nachrichten. */
class Reader {
  private pos = 0;
  constructor(private readonly buf: Uint8Array) {}
  uint(): number {
    let num = 0;
    let mult = 1;
    for (;;) {
      if (this.pos >= this.buf.length) throw new AwarenessRejected('awareness_invalid');
      const b = this.buf[this.pos++]!;
      num += (b & 0x7f) * mult;
      if (b < 0x80) return num;
      mult *= 128;
      if (mult > 2 ** 53) throw new AwarenessRejected('awareness_invalid');
    }
  }
  bytes(): Uint8Array {
    const len = this.uint();
    if (this.pos + len > this.buf.length) throw new AwarenessRejected('awareness_invalid');
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  string(): string {
    return new TextDecoder().decode(this.bytes());
  }
}

/**
 * Prüft eine Awareness-Nachricht: Jede:r darf nur die eigenen Awareness-Einträge setzen bzw. entfernen, und das Feld
 * `user` muss zur Sitzung passen (sonst könnte man sich als jemand anderes ausgeben oder mit kaputten Werten die
 * Oberfläche aller anderen stören). `owners`: Yjs-clientID → user_key, je Dokument.
 */
export function checkAwareness(update: Uint8Array, user: User, owners: Map<number, string>): void {
  const dec = new Reader(update);
  dec.string(); // Dokumentname
  if (dec.uint() !== MSG_AWARENESS) return;
  const inner = new Reader(dec.bytes());
  const n = inner.uint();
  const seen: number[] = [];
  for (let i = 0; i < n; i++) {
    const clientId = inner.uint();
    inner.uint(); // clock
    const raw = inner.string();
    const owner = owners.get(clientId);
    if (owner !== undefined && owner !== user.key) throw new AwarenessRejected('awareness_foreign_client');
    let state: unknown;
    try {
      state = JSON.parse(raw);
    } catch {
      throw new AwarenessRejected('awareness_invalid');
    }
    if (state !== null && (typeof state !== 'object' || Array.isArray(state))) throw new AwarenessRejected('awareness_invalid');
    const u = (state as { user?: unknown } | null)?.user;
    if (u !== undefined) {
      const ok =
        typeof u === 'object' &&
        u !== null &&
        (u as { key?: unknown }).key === user.key &&
        (u as { name?: unknown }).name === user.name &&
        user.name.length <= MAX_AWARENESS_NAME &&
        (typeof (u as { color?: unknown }).color === 'string' || (u as { color?: unknown }).color === undefined) &&
        String((u as { color?: unknown }).color ?? '').length <= 64;
      if (!ok) throw new AwarenessRejected('awareness_user_mismatch');
    }
    seen.push(clientId);
  }
  for (const id of seen) owners.set(id, user.key);
}

/** Stateless-Nachricht an die Editoren eines Boards (docs/contract.md §4 „Stateless-Nachrichten“). */
export type BoardStateless =
  | { type: 'board.renamed'; title: string; titleSeq: number }
  | { type: 'board.deleted'; by: string; byKey: string };

export function createSync(cfg: Config, db: Db, sessions: SessionStore, events: BoardEvents, tokens?: ApiTokens, access?: BoardAccess) {
  /** undefined = gibt es nicht (mehr); `deleted_at` gesetzt = im Papierkorb (trash.ts) */
  const boardRow = (id: string) => db.prepare('SELECT deleted_at FROM boards WHERE id = ?').get(id) as { deleted_at: string | null } | undefined;
  const awarenessOwners = new WeakMap<Document, Map<number, string>>();
  /** gelöschte Boards: id → Zeitpunkt (Wiederverbinden bekommt `board_deleted`) */
  const deleted = new Map<string, number>();
  /** WebSocket je internem Socket-Kennzeichen und Dokumente je Kennzeichen (zum Trennen beim Löschen) */
  const socketsById = new Map<string, WebSocket>();
  const docSockets = new Map<string, Set<string>>();

  // Versionsverlauf: Schnappschüsse beim Laden, alle paar Minuten beim Bearbeiten und wenn die letzte Person geht
  const versions = new BoardVersions(db, { intervalMs: cfg.versionIntervalMs });
  // Posteingang der Apps: @Erwähnungen und Karten-Zuweisungen (native/inbox.ts, Vertrag §8.11)
  const inbox = new NativeInbox(db);
  const prune = setInterval(() => inbox.prune(), 3600_000);
  prune.unref();
  // Kommentar-Autorschaft im Live-Sync wie in der Native-API (comment-guard.ts, Review SEC-06)
  const comments = new CommentGuard(db);
  // Bilder/PDFs gehören ihrem Board; Einfügen über Boards hinweg legt Kopien an (image-binding.ts, Review UPL-1)
  const binding = access ? new ImageBinding(db, path.join(cfg.dataDir, 'images'), access) : null;
  // Privater Modus: Privat-Ablagen je Person, Platzhalter, Aufdecken (private-mode.ts, docs/features/private.md)
  const privateMode = new PrivateMode({
    db,
    ...(access ? { access } : {}),
    boardOwner: (id) => (db.prepare('SELECT created_by FROM boards WHERE id = ?').get(id) as { created_by: string } | undefined)?.created_by ?? null,
  });
  if (binding) {
    const moved = binding.migrateLegacyRefs();
    if (moved.boards) console.log(`[images] ${moved.boards} Boards: ${moved.copied} Dateien kopiert, ${moved.dead} Verweise ohne Zugriff`);
  }
  const hocuspocus = new Hocuspocus<SyncContext>({
    extensions: [versions.hooks, inbox.hooks, comments.hooks, privateMode.hooks, ...(binding ? [binding.hooks] : [])],
    name: 'stachel',
    quiet: true,
    timeout: 30_000,
    debounce: cfg.syncDebounceMs,
    maxDebounce: cfg.syncMaxDebounceMs,

    async onAuthenticate({ documentName, requestHeaders, connectionConfig }) {
      const cookie = parseCookieHeader(requestHeaders.get('cookie'))[SESSION_COOKIE];
      // KI-Assistent (MCP): persönliches API-Token statt Cookie; Rechte = die der Person, der das Token gehört
      const viaToken = (await tokens?.fromAuthorization(requestHeaders.get('authorization'))) ?? null;
      const session = viaToken ?? (await sessions.getVerified(cookie));
      if (!session) throw new SyncDenied('not_logged_in');
      // Privat-Ablage: nur die Person selbst (ihr KI-Token zählt als sie) und nur mit Bearbeiten-Recht
      const area = privateMode.isPrivateDoc(documentName) ? privateMode.owns(documentName, session.userKey) : null;
      if (privateMode.isPrivateDoc(documentName) && !area) throw new SyncDenied('no_access');
      const boardId = area ? area.boardId : boardIdFromDoc(documentName);
      const row = boardId ? boardRow(boardId) : undefined;
      // im Papierkorb: board_deleted (dauerhaft, der Client fragt /api/trash/:id nach); endgültig gelöscht: 24 h lang
      if (!boardId || !row || row.deleted_at) throw new SyncDenied(boardId && (row?.deleted_at || deleted.has(boardId)) ? 'board_deleted' : 'unknown_board');
      // Board-Rechte (Modus local, access.ts): ohne Zugriff ablehnen; ansehen = schreibgeschützt, kommentieren = nur Kommentare
      const role = access ? access.connectRole({ key: session.userKey }, boardId) : 'edit';
      if (!role) throw new SyncDenied('no_access');
      const mode = access?.yjsMode(role) ?? { readOnly: false, commentOnly: false };
      if (area && mode.readOnly) throw new SyncDenied('no_access');
      connectionConfig.readOnly = mode.readOnly;
      // Person je WebSocket merken – auch bei API-Tokens (KI/MCP), damit dropUser deren Verbindungen ebenfalls trennt
      const ws = socketsById.get(requestHeaders.get(SOCKET_HEADER) ?? '');
      if (ws) socketUsers.set(ws, session.userKey);
      if (access?.local && !viaToken) access.noteOpen({ key: session.userKey }, boardId);
      const viewOnly = mode.readOnly && !mode.commentOnly;
      if (viaToken) return { user: aiUser(session), apiTokenId: viaToken.apiTokenId, commentOnly: mode.commentOnly, viewOnly };
      rememberVisit(db, session.userKey, boardId);
      return { user: toUser(session), commentOnly: mode.commentOnly, viewOnly };
    },

    async connected({ documentName, requestHeaders }) {
      const id = requestHeaders.get(SOCKET_HEADER);
      if (!id) return;
      let set = docSockets.get(documentName);
      if (!set) docSockets.set(documentName, (set = new Set()));
      set.add(id);
    },

    async beforeHandleMessage({ update, context, document, documentName, connection }) {
      if (!context?.user) return;
      // Privat-Ablage: gehört der Person allein (onAuthenticate), keine Board-Regeln
      if (privateMode.isPrivateDoc(documentName)) {
        let owners = awarenessOwners.get(document);
        if (!owners) awarenessOwners.set(document, (owners = new Map()));
        checkAwareness(update, context.user, owners);
        return;
      }
      // Rolle „kommentieren“: Sync-Nachrichten, die mehr als Kommentare ändern, wie readOnly verwerfen (access.ts);
      // alle schreibenden Rollen: fremde Kommentare nicht ändern/löschen, Autor nicht fälschen (comment-guard.ts).
      // Ausnahme nur in der Test-Sandbox (STACHEL_NATIVE_DEV_ACTIONS=1): Seed-Daten schreiben Kommentare fester
      // Personen über /sync (test/native-seed.ts, tools/sandbox.mts, tools/native-fixtures.mts).
      if (!context.viewOnly) {
        connection.readOnly =
          (context.commentOnly === true && !commentMessageAllowed(update, document)) ||
          (!cfg.nativeDevActions && !comments.messageAllowed(documentName, document, update, context.user)) ||
          // `private.mode`/`private.hidden` schreibt nur der Server (private-mode.ts)
          !privateMode.messageAllowed(documentName, document, update);
      }
      let owners = awarenessOwners.get(document);
      if (!owners) awarenessOwners.set(document, (owners = new Map()));
      checkAwareness(update, context.user, owners);
    },

    // Verbindungsprüfung des Clients: {type:"ping"} → {type:"pong"} nur an diese Verbindung (Vertrag §4)
    async onStateless({ connection, payload }) {
      if (payload.length <= 64 && payload.includes('"ping"')) {
        try {
          if ((JSON.parse(payload) as { type?: unknown })?.type === 'ping') connection.sendStateless(JSON.stringify({ type: 'pong' }));
        } catch {
          // kein JSON: ignorieren
        }
      }
    },

    async onLoadDocument({ documentName, document }) {
      if (privateMode.load(documentName, document)) return;
      const row = db.prepare('SELECT state FROM documents WHERE name = ?').get(documentName) as
        | { state: Uint8Array }
        | undefined;
      if (row) Y.applyUpdate(document, row.state);
    },

    async onStoreDocument({ documentName, document }) {
      if (privateMode.store(documentName, document)) return;
      persist(documentName, document);
    },
  });

  /** Ganzes Dokument in SQLite schreiben (synchron). */
  function persist(documentName: string, document: Y.Doc) {
    const boardId = boardIdFromDoc(documentName);
    const row = boardId ? boardRow(boardId) : undefined;
    if (!boardId || !row) return; // Board inzwischen endgültig gelöscht
    const state = Y.encodeStateAsUpdate(document);
    const now = nowIso();
    db.prepare(
      `INSERT INTO documents (name, state, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
    ).run(documentName, state, now);
    // im Papierkorb: letzte Änderungen vor dem Löschen sichern (Wiederherstellen ist vollständig), aber nicht melden
    if (row.deleted_at) return;
    db.prepare('UPDATE boards SET updated_at = ? WHERE id = ?').run(now, boardId);
    events.emit({ type: 'updated', id: boardId });
  }

  // Beim Herunterfahren keine neuen Verbindungen: ein schnell wieder verbundener Client lüde das Dokument sonst neu.
  let closing = false;

  // Zwei Server nur wegen maxPayload: ohne gültige Sitzung wird keine große Nachricht angenommen
  // (die Anmeldung selbst läuft weiter über onAuthenticate, damit der Client den Grund erfährt).
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_SYNC_MESSAGE });
  const wssAnon = new WebSocketServer({ noServer: true, maxPayload: MAX_ANON_MESSAGE });
  /** Offene Verbindungen mit ihrem Session-Cookie (für Logout und Nachprüfung). */
  const sockets = new Map<WebSocket, string>();
  /** Person je Verbindung (dropUser; die Sitzung kann dann schon gelöscht sein), auch für API-Token-Verbindungen */
  const socketUsers = new WeakMap<WebSocket, string>();


  function toRequest(req: IncomingMessage, socketId: string): Request {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }
    headers.set(SOCKET_HEADER, socketId); // überschreibt einen gleichnamigen Header des Clients
    return new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, { headers });
  }

  let socketSeq = 0;
  function onConnection(ws: WebSocket, req: IncomingMessage, cookie: string | undefined) {
    if (cookie) sockets.set(ws, cookie);
    const userKey = cookie ? sessions.get(cookie)?.userKey : undefined;
    if (userKey) socketUsers.set(ws, userKey);
    const socketId = `s${++socketSeq}`;
    socketsById.set(socketId, ws);
    const conn = hocuspocus.handleConnection(ws, toRequest(req, socketId));
    let alive = true;
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, PING_MS);
    ws.on('pong', () => {
      alive = true;
      conn.touch();
    });
    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary) => {
      if (!isBinary) return;
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
      conn.handleMessage(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    });
    ws.on('close', (code, reason) => {
      sockets.delete(ws);
      socketsById.delete(socketId);
      for (const [name, set] of docSockets) if (set.delete(socketId) && set.size === 0) docSockets.delete(name);
      clearInterval(ping);
      conn.handleClose({ code, reason: reason.toString() });
    });
    ws.on('error', () => ws.terminate());
  }

  function reject(socket: Duplex, status: number, text: string) {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }

  /** WebSocket-Upgrades annehmen: `/sync` hier, weitere Pfade (Native-API `/native/v1`) über `others`. */
  function attach(server: HttpServer, others: Record<string, UpgradeHandler> = {}) {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const pathname = (req.url ?? '').split('?')[0] ?? '';
      const other = Object.hasOwn(others, pathname) ? others[pathname] : undefined;
      if (other) return other(req, socket, head);
      if (pathname !== SYNC_PATH) return reject(socket, 404, 'Not Found');
      if (!wsOriginAllowed(cfg, req)) return reject(socket, 403, 'Forbidden');
      if (closing) return reject(socket, 503, 'Service Unavailable');
      const cookie = parseCookieHeader(req.headers.cookie)[SESSION_COOKIE];
      const server = sessions.get(cookie) || tokens?.peek(req.headers.authorization) ? wss : wssAnon;
      server.handleUpgrade(req, socket, head, (ws) => onConnection(ws, req, cookie));
    });
  }

  /** Verbindungen zu einem Session-Cookie trennen (Logout). Der Client meldet sich dann neu an bzw. sieht not_logged_in. */
  function dropSession(cookie: string | undefined) {
    if (!cookie) return;
    for (const [ws, c] of sockets) if (c === cookie) ws.close(1008, 'not_logged_in');
  }

  /**
   * Verbindungen einer Person trennen (Modus local, access.ts): Rechte auf `boardId` geändert → der Client verbindet neu
   * und bekommt die neue Rolle bzw. `no_access`; ohne `boardId` (Konto gelöscht, Passwort geändert) alle außer `exceptCookie`.
   */
  function dropUser(userKey: string, opts: { boardId?: string; exceptCookie?: string } = {}) {
    const onBoard = opts.boardId ? new Set([...(docSockets.get(`board:${opts.boardId}`) ?? [])].map((id) => socketsById.get(id))) : null;
    // alle WebSockets (Cookie-Sitzungen und API-Tokens); die Person steht in socketUsers (onConnection/onAuthenticate)
    for (const ws of socketsById.values()) {
      if (socketUsers.get(ws) !== userKey || (opts.exceptCookie && sockets.get(ws) === opts.exceptCookie)) continue;
      if (onBoard && !onBoard.has(ws)) continue;
      ws.close(opts.boardId ? 4000 : 1008, opts.boardId ? 'access_changed' : 'not_logged_in');
    }
  }

  // Offene Verbindungen prüfen regelmäßig ihre Sitzung (abgelaufen, gelöscht oder beim Identitätsdienst gesperrt).
  let rechecking = false;
  const recheck = setInterval(async () => {
    if (rechecking) return;
    rechecking = true;
    try {
      for (const cookie of new Set(sockets.values())) {
        if (!(await sessions.getVerified(cookie))) dropSession(cookie);
      }
    } catch {
      // nächste Runde
    } finally {
      rechecking = false;
    }
  }, cfg.syncRecheckMs);
  recheck.unref();

  /** Stateless-Nachricht an alle, die das Board gerade offen haben. */
  function tell(boardId: string, msg: BoardStateless) {
    hocuspocus.documents.get(`board:${boardId}`)?.broadcastStateless(JSON.stringify(msg));
  }

  /**
   * Board gelöscht: Offene Editoren bekommen zuerst `board.deleted` (mit Namen), dann wird ihr WebSocket getrennt.
   * Wer später (wieder) verbindet, wird mit `board_deleted` abgelehnt. Das Dokument wird nicht mehr gespeichert
   * (persist prüft, ob es das Board noch gibt).
   */
  function dropBoard(boardId: string, by: { name: string; key: string }) {
    const now = Date.now();
    for (const [id, at] of deleted) if (now - at > DELETED_TTL_MS || deleted.size >= MAX_DELETED) deleted.delete(id);
    deleted.set(boardId, now);
    const name = `board:${boardId}`;
    tell(boardId, { type: 'board.deleted', by: by.name, byKey: by.key });
    for (const id of docSockets.get(name) ?? []) socketsById.get(id)?.close(4404, 'board_deleted');
    docSockets.delete(name);
    hocuspocus.closeConnections(name);
    for (const area of privateMode.loadedAreas(boardId)) hocuspocus.closeConnections(area);
  }

  // Umbenennen live an die offenen Editoren (Übersicht: SSE in board-events.ts)
  const offEvents = events.on((e: BoardEvent) => {
    if (e.type === 'renamed') tell(e.id, { type: 'board.renamed', title: e.title, titleSeq: e.titleSeq });
  });

  async function close() {
    closing = true;
    versions.stop();
    privateMode.stop();
    clearInterval(prune);
    inbox.stop();
    offEvents();
    clearInterval(recheck);
    hocuspocus.closeConnections();
    hocuspocus.flushPendingStores();
    const deadline = Date.now() + 5_000;
    while (hocuspocus.getDocumentsCount() > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    // Was dann noch geladen ist (Speichern hängt/scheiterte, Nachzügler-Nachrichten), direkt sichern, bevor die DB zugeht
    for (const [name, doc] of hocuspocus.documents) {
      try {
        if (!privateMode.store(name, doc)) persist(name, doc);
      } catch (e) {
        console.error(`[sync] ${name} beim Herunterfahren nicht gespeichert`, e);
      }
    }
    for (const server of [wss, wssAnon]) {
      for (const ws of server.clients) ws.terminate();
      server.close();
    }
  }

  versions.attach(hocuspocus);
  privateMode.attach(hocuspocus);

  return { hocuspocus, versions, inbox, privateMode, attach, dropBoard, dropSession, dropUser, close };
}
