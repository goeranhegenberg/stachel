// Ein Assistent = ein API-Token: Identität, offene Board-Verbindungen (je Board eine, nacheinander benutzt),
// Rückgängig-Verlauf je Board, gemeinsamer Renderer für Bildschirmfotos.
import { StachelApi, StachelError, type BoardInfo, type Identity } from './stachel/api';
import { BoardConn } from './stachel/board';
import type { Renderer } from './render/renderer';
import { ToolError } from './kinds/common';

/** Board-Verbindung nach so langer Pause ruhen lassen (der Assistent verschwindet aus der Anwesenheit; Dokument und
 * Rückgängig-Verlauf bleiben im Speicher) … */
const IDLE_MS = 5 * 60_000;
/** … und nach so langer Pause ganz vergessen. */
const DROP_MS = 3 * 3600_000;
const BOARD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const READ_ONLY_ROLES = new Set(['view', 'comment']);

export class Agent {
  private identity: Promise<Identity> | null = null;
  private conns = new Map<string, Promise<BoardConn>>();
  private locks = new Map<string, Promise<unknown>>();
  private boardsCache: { at: number; list: BoardInfo[] } | null = null;
  private sweeper: ReturnType<typeof setInterval>;
  lastUsed = Date.now();

  constructor(
    readonly api: StachelApi,
    readonly renderer: Renderer,
    /** Adresse der Web-App für den Renderer (Standard: dieselbe wie die API) */
    readonly webUrl: string = api.baseUrl,
  ) {
    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref?.();
  }

  me(): Promise<Identity> {
    if (!this.identity) {
      this.identity = this.api.me();
      this.identity.catch(() => (this.identity = null));
    }
    return this.identity;
  }

  async boards(fresh = false): Promise<BoardInfo[]> {
    if (!fresh && this.boardsCache && Date.now() - this.boardsCache.at < 15_000) return this.boardsCache.list;
    const list = await this.api.boards();
    this.boardsCache = { at: Date.now(), list };
    return list;
  }

  invalidateBoards() {
    this.boardsCache = null;
  }

  async boardInfo(id: string): Promise<BoardInfo> {
    if (!BOARD_ID.test(id)) throw new ToolError(`„${id}“ ist keine Board-ID. Gültige IDs liefert list_boards.`);
    let b = (await this.boards()).find((x) => x.id === id);
    if (!b) b = (await this.boards(true)).find((x) => x.id === id);
    if (!b) throw new ToolError(`Board „${id}“ gibt es nicht (oder es liegt im Papierkorb). Gültige IDs liefert list_boards.`);
    return b;
  }

  /** Verbindung zum Board (öffnet bei Bedarf); `write` prüft, ob die eigene Rolle Bearbeiten erlaubt. */
  async board(id: string, opts: { write?: boolean | 'comment' } = {}): Promise<BoardConn> {
    const info = await this.boardInfo(id);
    if (opts.write && info.role && READ_ONLY_ROLES.has(info.role) && !(opts.write === 'comment' && info.role === 'comment')) {
      throw new ToolError(`Auf „${info.title}“ darfst du nur ${info.role === 'view' ? 'ansehen' : 'kommentieren'} – Änderungen sind nicht möglich.`);
    }
    this.lastUsed = Date.now();
    let p = this.conns.get(id);
    if (p) {
      const c = await p.catch(() => null);
      if (c && c.synced) return c;
      if (c) {
        try {
          await c.resume();
          return c;
        } catch {
          c.destroy();
        }
      }
      this.conns.delete(id);
    }
    const me = await this.me();
    p = BoardConn.open(this.api, id, me.ai, me.user);
    this.conns.set(id, p);
    p.catch(() => this.conns.delete(id));
    return p;
  }

  /** Arbeiten auf einem Board nacheinander ausführen (keine überlappenden Tool-Aufrufe je Board). */
  async withBoard<T>(id: string, write: boolean | 'comment', fn: (c: BoardConn) => Promise<T> | T): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const run = prev.then(async () => {
      const c = await this.board(id, { write });
      const res = await fn(c);
      if (write && !(await c.flush())) throw new StachelError(504, 'not_saved', 'Die Änderung ist lokal gemacht, der Server hat sie aber noch nicht bestätigt (Verbindung?). Bitte gleich nochmal prüfen.');
      return res;
    });
    this.locks.set(id, run.catch(() => {}));
    return run;
  }

  private sweep() {
    for (const [id, p] of this.conns) {
      void p.then(
        (c) => {
          const idle = Date.now() - c.lastUsed;
          if (idle > DROP_MS) {
            c.destroy();
            this.conns.delete(id);
          } else if (idle > IDLE_MS) c.suspend();
        },
        () => this.conns.delete(id),
      );
    }
  }

  async close() {
    clearInterval(this.sweeper);
    for (const p of this.conns.values()) (await p.catch(() => null))?.destroy();
    this.conns.clear();
  }
}
