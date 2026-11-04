// Live-Verbindung zu einem Board: Hocuspocus-Client mit dem API-Token (wie ein Browser), eigene Anwesenheit
// „KI (für <Name>)“ mit Farbe, Cursor und Auswahl dort, wo der Assistent gerade arbeitet, und ein eigener
// Rückgängig-Verlauf (jede Tool-Ausführung = ein Schritt).
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { boardDocName } from '../../../shared/protocol';
import { BoardModel, type Obj } from '../board/model';
import type { StachelApi, StachelUser } from './api';
import { StachelError } from './api';

/** Origin der Änderungen des Assistenten (nur diese nimmt `undo` zurück). */
export const AI_ORIGIN = 'stachel:mcp';

/** Anwesenheitsfarben wie web/src/board/session.ts (PRESENCE_COLORS); der Assistent nimmt bevorzugt Violett. */
const PRESENCE_COLORS = ['#1763b5', '#ec4e92', '#2b8a3e', '#e8590c', '#7048e8', '#0c8599', '#c92a2a', '#212529', '#ae3ec9', '#8d5524', '#5f6b7a', '#9a7b00'];
const AI_COLORS = ['#7048e8', '#ae3ec9', '#0c8599', ...PRESENCE_COLORS];

/** Cursor und Auswahl so lange zeigen, danach nur noch Anwesenheit. */
const FOCUS_MS = 45_000;

export interface BoardConnOptions {
  connectTimeoutMs?: number;
}

const reasonText: Record<string, string> = {
  not_logged_in: 'Das API-Token ist ungültig oder widerrufen.',
  unknown_board: 'Dieses Board gibt es nicht. Gültige IDs liefert list_boards.',
  board_deleted: 'Dieses Board liegt im Papierkorb bzw. wurde gelöscht.',
  forbidden: 'Du hast keinen Zugriff auf dieses Board.',
};

export class BoardConn {
  readonly doc = new Y.Doc();
  readonly model: BoardModel;
  readonly undoManager: Y.UndoManager;
  private provider!: HocuspocusProvider;
  private socket!: HocuspocusProviderWebsocket;
  private focusTimer: ReturnType<typeof setTimeout> | null = null;
  private failed: string | null = null;
  /** Verbindung ruht (nach einer Pause): Dokument und Rückgängig-Verlauf bleiben, die Anwesenheit verschwindet */
  private suspended = false;
  lastUsed = Date.now();
  private color: string;

  private constructor(
    readonly boardId: string,
    private readonly api: StachelApi,
    readonly ai: StachelUser,
    readonly owner: StachelUser,
  ) {
    this.model = new BoardModel(this.doc, owner.key);
    this.undoManager = new Y.UndoManager([this.model.objects, this.doc.getMap('collab.comments')], {
      trackedOrigins: new Set([AI_ORIGIN]),
      captureTimeout: 0,
    });
    this.color = AI_COLORS[0]!;
    this.connect();
  }

  /** Neue Sync-Verbindung für dasselbe Dokument (Hocuspocus-Client mit dem API-Token im Upgrade-Header). */
  private connect() {
    const headers = { Authorization: this.api.authHeader };
    class AuthWebSocket extends WebSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols, { headers });
      }
    }
    this.failed = null;
    this.socket = new HocuspocusProviderWebsocket({ url: this.api.syncUrl, WebSocketPolyfill: AuthWebSocket as any });
    this.provider = new HocuspocusProvider({
      websocketProvider: this.socket,
      name: boardDocName(this.boardId),
      document: this.doc,
      onAuthenticationFailed: ({ reason }) => {
        this.failed = reason;
      },
    });
    this.provider.attach();
  }

  private async waitSynced(timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (!this.provider.isSynced) {
      if (this.failed) {
        const reason = this.failed;
        throw new StachelError(403, reason, reasonText[reason] ?? `Der Sync-Server lehnt die Verbindung ab (${reason}).`);
      }
      if (Date.now() > deadline) throw new StachelError(504, 'sync_timeout', 'Keine Verbindung zum Sync-Server von Stachel (Zeitlimit). Später nochmal versuchen.');
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /** Verbindet und wartet auf den ersten Abgleich. */
  static async open(api: StachelApi, boardId: string, ai: StachelUser, owner: StachelUser, opts: BoardConnOptions = {}): Promise<BoardConn> {
    const conn = new BoardConn(boardId, api, ai, owner);
    try {
      await conn.waitSynced(opts.connectTimeoutMs ?? 15_000);
    } catch (e) {
      conn.destroy();
      throw e;
    }
    conn.enter();
    return conn;
  }

  /** Nach einer Pause: Verbindung schließen (Anwesenheit weg), Dokument und Rückgängig-Verlauf behalten. */
  suspend() {
    if (this.suspended) return;
    this.suspended = true;
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.closeSocket();
  }

  get isSuspended() {
    return this.suspended;
  }

  /** Wieder verbinden (der Server schickt, was andere inzwischen geändert haben). */
  async resume(timeoutMs = 15_000) {
    if (!this.suspended && this.synced) return;
    this.closeSocket();
    this.connect();
    this.suspended = false;
    await this.waitSynced(timeoutMs);
    this.enter();
  }

  private closeSocket() {
    try {
      this.provider.destroy();
      this.socket.destroy();
    } catch {
      // schon zu
    }
  }

  /** Anwesenheit: eigene Farbe (frei unter den Anwesenden), Name „KI (für …)“. */
  private enter() {
    const taken = new Set<string>();
    this.provider.awareness?.getStates().forEach((s, id) => {
      const c = (s as { user?: { color?: string } }).user?.color;
      if (id !== this.doc.clientID && c) taken.add(c);
    });
    this.color = AI_COLORS.find((c) => !taken.has(c)) ?? AI_COLORS[0]!;
    this.provider.setAwarenessField('user', { key: this.ai.key, name: this.ai.name, color: this.color });
    this.provider.setAwarenessField('since', Date.now());
    this.provider.setAwarenessField('cursor', null);
    this.provider.setAwarenessField('selection', []);
  }

  get synced() {
    return !this.suspended && this.provider.isSynced && !this.failed;
  }

  /** Anzahl der Anwesenden (ohne den Assistenten selbst). */
  peers(): { name: string; key: string }[] {
    const out: { name: string; key: string }[] = [];
    this.provider.awareness?.getStates().forEach((s, id) => {
      const u = (s as { user?: { name?: string; key?: string } }).user;
      if (id !== this.doc.clientID && u?.name && u.key) out.push({ name: u.name, key: u.key });
    });
    return out;
  }

  /**
   * Eine Änderung = ein Transact = ein Rückgängig-Schritt. Danach Cursor und Auswahl auf die betroffenen Objekte,
   * damit alle sehen, wo der Assistent arbeitet.
   */
  change<T>(fn: (m: BoardModel) => T, focus?: (result: T) => string[]): T {
    if (this.failed) throw new StachelError(403, this.failed, reasonText[this.failed] ?? 'Die Verbindung zum Board wurde beendet.');
    this.lastUsed = Date.now();
    this.undoManager.stopCapturing();
    let result!: T;
    this.doc.transact(() => {
      result = fn(this.model);
    }, AI_ORIGIN);
    this.undoManager.stopCapturing();
    if (focus) this.focus(focus(result));
    return result;
  }

  /** Cursor in die Mitte der Objekte, Auswahl = diese Objekte (nach FOCUS_MS wieder aus). */
  focus(ids: string[]) {
    const objs = ids.map((id) => this.model.get(id)).filter((o): o is Obj => !!o && o.type !== 'connector');
    if (!objs.length) return;
    const x1 = Math.min(...objs.map((o) => o.x));
    const y1 = Math.min(...objs.map((o) => o.y));
    const x2 = Math.max(...objs.map((o) => o.x + o.w));
    const y2 = Math.max(...objs.map((o) => o.y + o.h));
    this.provider.setAwarenessField('cursor', { x: Math.round(x2 - Math.min(40, (x2 - x1) / 4)), y: Math.round(y2 - Math.min(30, (y2 - y1) / 4)) });
    this.provider.setAwarenessField('selection', ids.slice(0, 200));
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => {
      this.provider.setAwarenessField('cursor', null);
      this.provider.setAwarenessField('selection', []);
    }, FOCUS_MS);
    this.focusTimer.unref?.();
  }

  /** Eigene Schritte zurücknehmen (nur die des Assistenten in dieser Verbindung). */
  undo(steps = 1): number {
    let n = 0;
    while (n < steps && this.undoManager.canUndo()) {
      this.undoManager.undo();
      n++;
    }
    return n;
  }

  redo(steps = 1): number {
    let n = 0;
    while (n < steps && this.undoManager.canRedo()) {
      this.undoManager.redo();
      n++;
    }
    return n;
  }

  /** Wartet, bis der Server alle eigenen Änderungen bestätigt hat (dann sehen alle sie). */
  async flush(timeoutMs = 8000): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    while (this.provider.hasUnsyncedChanges) {
      if (Date.now() > end || this.failed) return false;
      await new Promise((r) => setTimeout(r, 20));
    }
    return true;
  }

  /** Y-Struktur eines Feature-Moduls (z. B. 'collab.comments'). */
  ext<T = unknown>(name: string): Y.Map<T> {
    return this.doc.getMap<T>(name);
  }

  get presenceColor() {
    return this.color;
  }

  destroy() {
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.closeSocket();
    this.undoManager.destroy();
    this.doc.destroy();
  }
}
