// Board-Sitzung: Y.Doc + Store + Sync (Hocuspocus) bzw. lokal (?offline=1). Kapselt Awareness und Bilder.
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { nanoid } from 'nanoid';
import { boardDocName, privateDocName, SYNC_PATH, type AwarenessState, type User } from '../protocol';
import { api, imageUrl } from '../api';
import { BoardStore } from './store';
import { userColor } from './colors';
import type { Point } from './geometry';

export type ConnectionStatus = 'connecting' | 'connected' | 'offline' | 'local' | 'denied';

export interface Peer extends AwarenessState {
  clientId: number;
  /** Zeitpunkt des Betretens (ms, Uhr des Clients; Awareness-Feld `since`) – wer früher da war, behält seine Farbe */
  since?: number;
  /** weitere Awareness-Felder der Feature-Module (z. B. Folgen-Modus), siehe BoardSession.setLocalField */
  extra: Readonly<Record<string, unknown>>;
}

export interface UploadedImage {
  imageId: string;
  width: number;
  height: number;
}

/** Wer das Board gelöscht hat (Stateless-Nachricht `board.deleted`, Vertrag §4). */
export interface DeletedBy {
  name: string;
  key: string;
}

/** Board-Titel, wie ihn der Server zuletzt gemeldet hat (`board.renamed`); höchste `seq` gewinnt. */
export interface RemoteTitle {
  title: string;
  seq: number;
}

export interface BoardSession {
  readonly store: BoardStore;
  /** Grund der Ablehnung durch den Sync-Server (Vertrag §4: "not_logged_in" | "unknown_board" | "board_deleted") */
  readonly deniedReason: string | null;
  /** Board wurde gelöscht, während es offen war (mit Namen; null = nicht gelöscht bzw. Name unbekannt) */
  readonly deletedBy: DeletedBy | null;
  /** Live-Titel vom Server (null = noch keiner gemeldet) */
  getRemoteTitle(): RemoteTitle | null;
  /** Neuen Titel merken (eigene Umbenennung), nur wenn er neuer ist als der bekannte */
  noteTitle(t: RemoteTitle): void;
  /** Eigene Nutzerangaben; die Farbe kann sich nach dem Verbinden ändern (eindeutig unter den Anwesenden). */
  readonly user: AwarenessState['user'];
  readonly isLocal: boolean;
  getStatus(): ConnectionStatus;
  getPeers(): readonly Peer[];
  subscribe(fn: () => void): () => void;
  setCursor(p: Point | null): void;
  setSelection(ids: string[]): void;
  /** Eigenes Awareness-Feld setzen (Feature-Module; Namen mit Modul-Präfix, z. B. 'collab.follow'). */
  setLocalField(key: string, value: unknown): void;
  /** Gibt es eigene Änderungen, die der Server noch nicht hat? */
  hasUnsyncedChanges(): boolean;
  /**
   * Eigene Privat-Ablage verbinden und in den Store einhängen (privater Modus, docs/features/private.md); mehrfach
   * aufrufbar. Ohne Server (offline/Vorschau) eine lokale Ablage.
   */
  openPrivate?(): void;
  uploadImage(file: File): Promise<UploadedImage>;
  imageSrc(imageId: string): string;
  destroy(): void;
}

abstract class BaseSession {
  protected listeners = new Set<() => void>();
  protected status: ConnectionStatus = 'connecting';
  protected peers: readonly Peer[] = [];
  protected remoteTitle: RemoteTitle | null = null;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getStatus = () => this.status;
  getPeers = () => this.peers;
  getRemoteTitle = () => this.remoteTitle;
  noteTitle(t: RemoteTitle) {
    if (this.remoteTitle && this.remoteTitle.seq >= t.seq) return;
    this.remoteTitle = t;
    this.emit();
  }
  protected emit() {
    for (const fn of this.listeners) fn();
  }
  protected setStatus(s: ConnectionStatus) {
    if (s === this.status) return;
    this.status = s;
    this.emit();
  }
}

function toAwarenessUser(u: User): AwarenessState['user'] {
  return { key: u.key, name: u.name, color: userColor(u.key) };
}

/**
 * Farben der Anwesenden: Jede Person nimmt beim Betreten die erste Farbe, die gerade niemand sonst hat,
 * und behält sie, solange sie da ist. Bis 12 Personen kollidiert so nichts. Reihenfolge: Blau und Pink der
 * Stachel-Farben zuerst, dann gut unterscheidbare Töne (alle mit weißer Schrift lesbar).
 */
export const PRESENCE_COLORS = ['#1763b5', '#ec4e92', '#2b8a3e', '#e8590c', '#7048e8', '#0c8599', '#c92a2a', '#212529', '#ae3ec9', '#8d5524', '#5f6b7a', '#9a7b00'];

type Seat = { clientId: number; since?: number };
/** War `a` vor `b` da? (Betreten-Zeit, bei Gleichstand die clientId) */
const earlier = (a: Seat, b: Seat) => {
  const sa = a.since ?? Infinity;
  const sb = b.since ?? Infinity;
  return sa !== sb ? sa < sb : a.clientId < b.clientId;
};

/**
 * Eigene Farbe bestimmen: Sind eigene ältere Tabs da, deren Farbe (eine Person, eine Farbe). Sonst die bisherige,
 * solange keine andere Person, die früher da war, dieselbe hat; sonst die erste freie. Jeder Client entscheidet nur
 * über die eigene Farbe; wer später kommt, weicht aus – Farben der Anwesenden ändern sich also nicht.
 */
export function pickPresenceColor(me: { key: string; color: string } & Seat, peers: readonly (Pick<Peer, 'user'> & Seat)[]): string {
  const others = peers.filter((p) => p.user.key !== me.key);
  const older = peers.filter((p) => p.user.key === me.key && earlier(p, me)).sort((a, b) => (earlier(a, b) ? -1 : 1))[0];
  if (older && PRESENCE_COLORS.includes(older.user.color)) return older.user.color;
  const conflict = others.some((p) => p.user.color === me.color && earlier(p, me));
  if (!conflict && PRESENCE_COLORS.includes(me.color)) return me.color;
  const taken = new Set(others.map((p) => p.user.color));
  return PRESENCE_COLORS.find((c) => !taken.has(c)) ?? PRESENCE_COLORS[me.clientId % PRESENCE_COLORS.length];
}

const CORE_FIELDS = new Set(['user', 'cursor', 'selection', 'clientId', 'since']);

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Nur gültige Nutzer-Angaben übernehmen (fremde Clients können beliebige Awareness-Daten schicken). */
function peerUser(u: unknown): AwarenessState['user'] | null {
  if (!u || typeof u !== 'object') return null;
  const { key, name, color } = u as Record<string, unknown>;
  if (typeof key !== 'string' || !key || typeof name !== 'string') return null;
  return { key, name, color: typeof color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : userColor(key) };
}

/**
 * Anwesende aus der Awareness lesen. Mit `ownKey` bleiben eigene andere Tabs in der Liste (Anwesenheit zählt die
 * Person einmal), zeigen aber keinen „fremden“ Cursor und keine fremde Auswahl mit dem eigenen Namen.
 */
export function readPeers(states: Map<number, Record<string, any>>, own: number, ownKey?: string): Peer[] {
  const out: Peer[] = [];
  states.forEach((s, clientId) => {
    if (clientId === own || !s || typeof s !== 'object') return;
    const user = peerUser(s.user);
    if (!user) return;
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) if (!CORE_FIELDS.has(k)) extra[k] = v;
    const c = s.cursor;
    const self = ownKey !== undefined && user.key === ownKey;
    out.push({
      clientId,
      ...(isFiniteNum(s.since) ? { since: s.since } : {}),
      user,
      cursor: !self && c && typeof c === 'object' && isFiniteNum(c.x) && isFiniteNum(c.y) ? { x: c.x, y: c.y } : null,
      selection: !self && Array.isArray(s.selection) ? s.selection.filter((id: unknown): id is string => typeof id === 'string') : [],
      extra,
    });
  });
  return out.sort((a, b) => a.clientId - b.clientId);
}

/**
 * Verbindungsprüfung: alle PING_MS ein Stateless-`ping`, der Stachel-Server antwortet nur dieser Verbindung mit `pong`.
 * Kommt danach MESSAGE_TIMEOUT_MS lang gar nichts an, gilt die Verbindung als tot: Socket zu, der Provider verbindet neu
 * (Anzeige „Offline“ statt „Live“). Ohne das merkte der Client einen stillen Netzausfall erst nach 30–40 s (Zeitlimit des
 * Providers). Erst nach dem ersten `pong` aktiv – ein Server ohne Ping-Antwort (Test-Server) wird nicht ständig getrennt.
 * Das `offline`-Ereignis des Browsers wirkt sofort. (Bewusst nicht `forceSyncInterval`: das setzt den Zähler ungesendeter
 * Änderungen zurück und löste beim Schließen falsche Rückfragen aus.)
 */
export const PING_MS = 4_000;
export const MESSAGE_TIMEOUT_MS = 9_000;

/** Stateless-Nachrichten des Servers (Vertrag §4). */
type ServerMessage = { type?: unknown; by?: unknown; byKey?: unknown; title?: unknown; titleSeq?: unknown };

/** Online: Hocuspocus über /sync, Auth per Session-Cookie. */
export class SyncSession extends BaseSession implements BoardSession {
  readonly store: BoardStore;
  readonly isLocal = false;
  deniedReason: string | null = null;
  deletedBy: DeletedBy | null = null;
  private me: AwarenessState['user'];
  private provider: HocuspocusProvider;
  private doc = new Y.Doc();
  /** Privat-Ablage (privater Modus): zweites Dokument über denselben WebSocket */
  private privateProvider: HocuspocusProvider | null = null;
  private privateDoc: Y.Doc | null = null;
  private readonly userKey: string;
  /** Browser meldet „kein Netz“ (navigator.onLine / offline-Ereignis) */
  private netDown = typeof navigator !== 'undefined' && navigator.onLine === false;
  private readonly since = Date.now();
  /** Zeitpunkt der letzten Nachricht vom Server; Server beantwortet Pings (erst dann wird geprüft) */
  private lastMessage = Date.now();
  private serverPongs = false;
  private pinger = 0;

  constructor(
    private boardId: string,
    me: User,
  ) {
    super();
    this.me = toAwarenessUser(me);
    this.userKey = me.key;
    this.store = new BoardStore(this.doc, me.key);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.provider = new HocuspocusProvider({
      url: `${proto}://${location.host}${SYNC_PATH}`,
      name: boardDocName(boardId),
      document: this.doc,
      // Auth läuft über das Session-Cookie im Upgrade-Request.
      token: 'cookie',
      onMessage: () => {
        this.lastMessage = Date.now();
      },
      onStatus: ({ status }) => {
        if (status === 'connected') this.lastMessage = Date.now();
        if (this.status === 'denied') return;
        if (this.netDown) return this.setStatus('offline');
        this.setStatus(status === 'connected' ? (this.provider?.isSynced ? 'connected' : 'connecting') : status === 'connecting' ? 'connecting' : 'offline');
      },
      onSynced: () => {
        if (this.status !== 'denied' && !this.netDown) this.setStatus('connected');
      },
      onAuthenticationFailed: ({ reason }) => {
        // board_deleted kam meist schon per Stateless-Nachricht (mit Namen)
        this.deniedReason = this.deletedBy ? 'board_deleted' : reason || 'not_logged_in';
        this.deny();
      },
      onStateless: ({ payload }) => this.onServerMessage(payload),
      onAwarenessChange: ({ states }) => {
        const map = new Map<number, Record<string, any>>();
        for (const s of states as Array<Record<string, any> & { clientId: number }>) map.set(s.clientId, s);
        this.peers = readPeers(map, this.doc.clientID, this.me.key);
        this.updateColor();
        this.emit();
      },
    });
    this.provider.setAwarenessField('since', this.since);
    this.provider.setAwarenessField('user', this.me);
    this.provider.setAwarenessField('cursor', null);
    this.provider.setAwarenessField('selection', []);
    window.addEventListener('offline', this.onOffline);
    window.addEventListener('online', this.onOnline);
    this.pinger = window.setInterval(this.checkAlive, PING_MS);
  }

  /** Ping senden bzw. eine stumme Verbindung trennen (siehe PING_MS). */
  private checkAlive = () => {
    if (this.status !== 'connected' || this.netDown) return;
    if (this.serverPongs && Date.now() - this.lastMessage > MESSAGE_TIMEOUT_MS) {
      this.serverPongs = false;
      this.setStatus('offline');
      this.provider.configuration.websocketProvider.webSocket?.close();
      return;
    }
    this.provider.sendStateless(JSON.stringify({ type: 'ping' }));
  };

  get user() {
    return this.me;
  }

  /** Farbe eindeutig unter den Anwesenden halten (pickPresenceColor). */
  private updateColor() {
    const color = pickPresenceColor({ key: this.me.key, clientId: this.doc.clientID, since: this.since, color: this.me.color }, this.peers);
    if (color === this.me.color) return;
    this.me = { ...this.me, color };
    this.provider.setAwarenessField('user', this.me);
  }

  private deny() {
    this.setStatus('denied');
    // nicht endlos neu verbinden
    this.provider.configuration.websocketProvider.disconnect();
  }

  private onServerMessage(payload: string) {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(payload);
    } catch {
      return;
    }
    if (msg?.type === 'pong') {
      this.serverPongs = true;
    } else if (msg?.type === 'board.deleted') {
      this.deletedBy = { name: typeof msg.by === 'string' ? msg.by : '', key: typeof msg.byKey === 'string' ? msg.byKey : '' };
      this.deniedReason = 'board_deleted';
      this.deny();
      this.emit();
    } else if (msg?.type === 'board.renamed' && typeof msg.title === 'string' && typeof msg.titleSeq === 'number') {
      this.noteTitle({ title: msg.title, seq: msg.titleSeq });
    }
  }

  private onOffline = () => {
    this.netDown = true;
    if (this.status === 'denied') return;
    this.setStatus('offline');
    // keine Versuche ins Leere; bei „online“ sofort neu verbinden
    this.provider.configuration.websocketProvider.disconnect();
  };

  private onOnline = () => {
    if (!this.netDown) return;
    this.netDown = false;
    if (this.status === 'denied') return;
    this.setStatus('connecting');
    void this.provider.configuration.websocketProvider.connect()?.catch(() => {});
  };

  setCursor(p: Point | null) {
    this.provider.setAwarenessField('cursor', p ? { x: Math.round(p.x), y: Math.round(p.y) } : null);
  }
  setSelection(ids: string[]) {
    this.provider.setAwarenessField('selection', ids);
  }
  setLocalField(key: string, value: unknown) {
    if (CORE_FIELDS.has(key)) return;
    this.provider.setAwarenessField(key, value);
  }
  hasUnsyncedChanges = () => this.provider.hasUnsyncedChanges || !!this.privateProvider?.hasUnsyncedChanges;
  openPrivate() {
    if (this.privateProvider || this.status === 'denied') return;
    const doc = (this.privateDoc = new Y.Doc());
    this.privateProvider = new HocuspocusProvider({
      websocketProvider: this.provider.configuration.websocketProvider,
      name: privateDocName(this.boardId, this.userKey),
      document: doc,
      token: 'cookie',
    });
    this.privateProvider.attach();
    this.store.attachPrivate(doc);
  }
  async uploadImage(file: File): Promise<UploadedImage> {
    const img = await api.uploadImage(this.boardId, file);
    return { imageId: img.id, width: img.width, height: img.height };
  }
  imageSrc(imageId: string) {
    return imageUrl(imageId);
  }
  destroy() {
    clearInterval(this.pinger);
    window.removeEventListener('offline', this.onOffline);
    window.removeEventListener('online', this.onOnline);
    this.privateProvider?.destroy();
    this.provider.destroy();
    this.store.destroy();
    this.privateDoc?.destroy();
    this.doc.destroy();
    this.listeners.clear();
  }
}

/** Offline-Dev-Modus: lokales Y.Doc ohne Server. Optional Demo-Anwesende für Vorschauen. */
export class LocalSession extends BaseSession implements BoardSession {
  readonly store: BoardStore;
  readonly user: AwarenessState['user'];
  readonly isLocal = true;
  readonly deniedReason = null;
  readonly deletedBy = null;
  readonly doc = new Y.Doc();
  private images = new Map<string, string>();

  constructor(me: User) {
    super();
    this.status = 'local';
    this.user = toAwarenessUser(me);
    this.store = new BoardStore(this.doc, me.key);
  }

  setPeers(peers: Peer[]) {
    this.peers = peers;
    this.emit();
  }
  setCursor() {}
  setSelection() {}
  setLocalField() {}
  hasUnsyncedChanges = () => false;
  /** lokale Ablage (offline, Tests): privater Modus ohne Server */
  openPrivate() {
    if (!this.store.privateDoc) this.store.attachPrivate(new Y.Doc());
  }
  async uploadImage(file: File): Promise<UploadedImage> {
    const url = URL.createObjectURL(file);
    const size = await imageSize(url);
    const imageId = `local-${nanoid(8)}`;
    this.images.set(imageId, url);
    return { imageId, ...size };
  }
  imageSrc(imageId: string) {
    return this.images.get(imageId) ?? '';
  }
  destroy() {
    for (const url of this.images.values()) URL.revokeObjectURL(url);
    this.store.destroy();
    this.doc.destroy();
    this.listeners.clear();
  }
}

function imageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 400, height: img.naturalHeight || 300 });
    img.onerror = () => resolve({ width: 400, height: 300 });
    img.src = url;
  });
}
