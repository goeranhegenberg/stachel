// Native App-Schnittstelle v1 (docs/contract.md §8): Konstanten und Nachrichtentypen für server/ und Tests.
// Nur Typen + Konstanten, keine Laufzeit-Abhängigkeiten (wie protocol.ts).

export const NATIVE_PATH = '/native/v1';
export const NATIVE_PROTO = 1;
/** Präfix der App-Sitzungs-Tokens (POST /api/auth/app-session) */
export const APP_SESSION_PREFIX = 'sts_';
export const APP_SESSION_PATH = '/api/auth/app-session';
/**
 * Kopfzeile der Stachel-App beim QR-Long-Poll (`GET /api/auth/qr/:code/wait`, Wert `1`): bei `approved` kommt ein
 * sts_-Token im Body statt eines Sitzungs-Cookies (§8.1). Klein geschrieben wie Node-Header.
 */
export const APP_HEADER = 'x-stachel-app';
/** Welche App sich im `hello` meldet (§8.4, Mindestversion je App); fehlt bzw. unbekannt = `org` */
export const NATIVE_CLIENTS = ['org', 'stachel'] as const;
export type NativeClientApp = (typeof NATIVE_CLIENTS)[number];
/** Ops, die die Rolle `comment` (Modus local) schicken darf – schreiben nur `collab.comments`/`collab.reads` (§8.4) */
export const NATIVE_COMMENT_OPS = ['comment', 'reply', 'commentEdit', 'commentDelete', 'resolve', 'mentionsRead'] as const;
export const NATIVE_INFO_PATH = '/api/native/info';
/** Posteingang der App: neue @Erwähnungen und Karten-Zuweisungen (§8.11) */
export const NATIVE_INBOX_PATH = '/api/native/v1/inbox';

/**
 * Was der Server in v1 kann (welcome.features, /api/native/info). `text` (Rich-Text mit Zusammenführen) seit E2;
 * seit E3 `comments` (Kommentar-Ops), `reactions` (Op `react`), `uploads` (presence.uploads → „lädt hoch …“),
 * `inbox` (GET /api/native/v1/inbox); `mind` (Mindmap-Op mit dem Web-Code samt Layout, Mindmap-Regeln auch bei
 * create/update/remove von Knoten); seit F1 `act` (Web-Aktionen, §8.12, Liste in welcome.actions) und `extra`
 * (presence.extra mit den Awareness-Feldern aus NATIVE_PRESENCE_EXTRA).
 */
export const NATIVE_FEATURES = ['objects', 'ext', 'presence', 'ops', 'undo', 'text', 'comments', 'reactions', 'uploads', 'inbox', 'mind', 'act', 'extra', 'private'] as const;

/**
 * Awareness-Felder der Feature-Module, die die App über `presence.extra` setzen darf (§8.4); Format wie im Web
 * (web/src/features/collab/model.ts AW_*, structure/frames/present.ts PRESENT_FIELD).
 */
export const NATIVE_PRESENCE_EXTRA = ['collab.status', 'collab.follow', 'collab.summon', 'collab.laser', 'collab.chat', 'structure.present', 'structure.handover'] as const;
export type NativePresenceExtraKey = (typeof NATIVE_PRESENCE_EXTRA)[number];

export const NATIVE_LIMITS = {
  /** Einträge (Objekte + Patches + IDs) je ops-Nachricht */
  maxOps: 500,
  /** größte Nachricht der App (Bytes) */
  maxMessageBytes: 4 * 1024 * 1024,
  /** längster Text je Feld */
  maxTextLength: 20_000,
} as const;

/** Typen, die unter allen anderen liegen (Rahmen) – Zeichenreihenfolge §8.4. */
export const NATIVE_BELOW_TYPES = ['frame'] as const;

/**
 * Alle Objekttypen, die das Web kennt (`defineObjectType`), und Y-Felder (`registerYField`) samt JSON-Form im
 * Schnappschuss. Der Paritäts-Test (server/test/native-parity.test.ts) vergleicht diese Listen mit dem Web-Code und
 * mit docs/native_paritaet.md – ein neuer Typ im Web ohne Eintrag hier lässt ihn scheitern.
 */
export const NATIVE_OBJECT_TYPES = [
  'sticky',
  'text',
  'shape',
  'connector',
  'pen',
  'frame',
  'image',
  'sticker',
  'icon',
  'card',
  'table',
  'mindnode',
  'timeline',
  'document',
] as const;
export type NativeObjectType = (typeof NATIVE_OBJECT_TYPES)[number];

export const NATIVE_Y_FIELDS = {
  content: 'prosemirror-json',
  table: 'table-data',
  timeline: 'timeline-data',
  docPages: 'page-map',
} as const;

// ---- Nachrichten ------------------------------------------------------------------------------------------------------

/** Objekt-JSON (§8.5): Felder roh, Y-Felder als JSON. */
export interface NativeObject {
  id: string;
  type: string;
  [field: string]: unknown;
}

export type NativeChange =
  | { id: string; created: NativeObject }
  | { id: string; removed: true }
  | { id: string; set?: Record<string, unknown>; unset?: string[] };

export interface NativePatch {
  rev: number;
  by: string | null;
  changes: NativeChange[];
  ext?: Record<string, unknown>;
}

export interface NativePeer {
  id: number;
  key: string;
  name: string;
  color: string;
  client: 'web' | 'app' | 'ai';
  since: number | null;
  cursor: { x: number; y: number } | null;
  selection: string[];
  editing: string | null;
  extra: Record<string, unknown>;
}

export interface NativeHello {
  t: 'hello';
  proto: number;
  board: string;
  app?: string;
  /** `org` (Standard) | `stachel` – wählt die Mindestversion (§8.2 `minApps`) */
  client?: NativeClientApp;
  resume?: { epoch: string; rev: number };
  want?: string[];
  token?: string;
}

export type NativeOp =
  | { op: 'create'; objects: NativeObject[] }
  | { op: 'update'; patches: Record<string, Record<string, unknown>> }
  | { op: 'remove'; ids: string[] }
  | { op: 'order'; ids: string[]; to: 'front' | 'back' }
  | { op: 'text'; id: string; base: number; doc: unknown; epoch?: string; baseDoc?: unknown }
  // Kommentare (collab.comments, docs/features/collab.md) – IDs von der App, Wiederholung legt nichts doppelt an
  | { op: 'comment'; thread: string; msg: string; at: NativeCommentAnchor; text: string; mentions: string[] }
  | { op: 'reply'; thread: string; msg: string; text: string; mentions: string[] }
  | { op: 'commentEdit'; thread: string; msg: string; text: string; mentions: string[] }
  | { op: 'commentDelete'; thread: string; msg?: string }
  | { op: 'resolve'; thread: string; resolved: boolean }
  // Reaktionen (collab.reactions): eigene Reaktion an/aus
  | { op: 'react'; ids: string[]; emoji: string; on: boolean }
  // Gelesen-Stand der eigenen Erwähnungen (collab.reads, ohne Rückgängig)
  | { op: 'mentionsRead'; at?: string }
  // Mindmaps (structure, docs/features/structure.md): der Server führt den Mindmap-Code des Web samt Layout aus
  | NativeMindOp
  // Web-Aktion (§8.12): der Server führt die gleichnamige Aktion des Web-Codes aus (web/src/native/registry.ts)
  | NativeActOp;

/** Op `act` (§8.12): `args` prüft die Aktion; `key` = feste IDs `<key>-1` … und Gedächtnis gegen Doppeltes. */
export interface NativeActOp {
  op: 'act';
  name: string;
  args: Record<string, unknown>;
  key?: string;
  v?: number;
}

/** Ergebnis einer Web-Aktion in `ack.results[<index>]` (§8.12). */
export interface NativeActResult {
  /** IDs, die danach gewählt sind */
  select?: string[];
  /** Kamera einpassen auf diese IDs bzw. dieses Rechteck */
  focus?: string[] | { x: number; y: number; w: number; h: number };
  /** Text dieses Objekts sofort bearbeiten */
  edit?: string;
  /** Hinweistext des Web */
  toast?: string;
  /** aktionsspezifisch */
  data?: unknown;
  /** nichts zu tun (Ziel fehlt …) */
  skipped?: true;
  error?: 'failed';
  message?: string;
}

/** Name einer Web-Aktion: `<modul>.<aktion>` bzw. `<modul>.<bereich>.<aktion>` */
export const NATIVE_ACT_NAME_RE = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*){1,3}$/;
/** `key` einer Web-Aktion (Platz für `-<n>` bis 64 Zeichen) */
export const NATIVE_ACT_KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** Mindmap-Op (§8.6 `mind`, seit Feature `mind`): IDs neuer Knoten von der App, Wiederholung legt nichts doppelt an. */
export type NativeMindOp =
  | { op: 'mind'; do: 'child'; id: string; new: string; side?: 'l' | 'r' }
  | { op: 'mind'; do: 'sibling'; id: string; new: string }
  | { op: 'mind'; do: 'root'; new: string; x: number; y: number; text: string }
  | { op: 'mind'; do: 'tree'; new: string; x: number; y: number; tree: NativeMindTree }
  | { op: 'mind'; do: 'text'; id: string; text: string }
  | { op: 'mind'; do: 'collapse'; id: string; collapsed: boolean }
  | { op: 'mind'; do: 'remove' | 'drop' | 'layout'; ids: string[] };

/** Baum einer neuen Mindmap (Vorlage): `side` nur an Hauptthemen (Kinder der Wurzel). */
export interface NativeMindTree {
  text: string;
  side?: 'l' | 'r';
  children?: NativeMindTree[];
}

/** Grenzen der Mindmap-Op `tree` (wie der MCP-Server) */
export const NATIVE_MIND_LIMITS = { maxNodes: 400, maxDepth: 10, maxText: 500 } as const;

/** Anker eines Kommentars: Board-Stelle, optional an ein Objekt geheftet (dx/dy ab dessen linker oberer Ecke). */
export interface NativeCommentAnchor {
  x: number;
  y: number;
  objectId?: string;
  dx?: number;
  dy?: number;
}

/** Close-Codes je Grund (§8.4). */
export const NATIVE_CLOSE = {
  not_logged_in: 4401,
  unknown_board: 4404,
  board_deleted: 4410,
  no_access: 4403,
  access_changed: 4000,
  upgrade_required: 4426,
  invalid_input: 4400,
  rate_limited: 4429,
  server_restart: 1001,
  too_slow: 1013,
} as const;
export type NativeCloseReason = keyof typeof NATIVE_CLOSE;
