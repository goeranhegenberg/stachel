// Gemeinsame Typen und Konstanten für server/ und web/ – siehe docs/contract.md.
// Nur Typen + Konstanten, keine Laufzeit-Abhängigkeiten.

export const SESSION_COOKIE = 'stachel_session';
export const PAIR_COOKIE = 'stachel_pair';
export const CSRF_HEADER = 'X-Stachel';
export const SYNC_PATH = '/sync';
export const QR_PATH_PREFIX = '/qr/';
export const QR_TTL_SECONDS = 120;
export const QR_WAIT_SECONDS = 25;
export const SESSION_DAYS = 30;
export const REVERIFY_HOURS = 6;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export const boardDocName = (boardId: string) => `board:${boardId}`;

/** user key → base64url (UTF-8), Teil des Namens der Privat-Ablage */
export const privateKeyPart = (userKey: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(userKey)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * Privat-Ablage einer Person auf einem Board (privater Modus, docs/features/private.md): eigenes Yjs-Dokument, nur
 * diese Person darf es öffnen.
 */
export const privateDocName = (boardId: string, userKey: string) => `private:${boardId}:${privateKeyPart(userKey)}`;

/** Wurzel-Strukturen des privaten Modus im Board-Dokument (schreibt nur der Server) */
export const PRIVATE_MODE = 'private.mode';
export const PRIVATE_HIDDEN = 'private.hidden';

/** Zustand des privaten Modus (`private.mode` als JSON, REST `state`). */
export interface PrivateModeState {
  on: boolean;
  /** Moderation (user key) und Name */
  by?: string;
  byName?: string;
  since?: string;
  anonymous?: boolean;
  ownReveal?: boolean;
  /** Countdown läuft bis (ms, Server-Uhr) */
  revealAt?: number;
}

/** Platzhalter eines verdeckten Objekts (`private.hidden`): nur Lage, Größe, Typ – nie Inhalt. */
export interface PrivatePlaceholder {
  x: number;
  y: number;
  w: number;
  h: number;
  type: string;
  rotation?: number;
  /** user key (fehlt bei „Namen anonym“) */
  by?: string;
  /** undurchsichtiges Kürzel je Person und Board */
  o: string;
}

/** Stachel-Farben (Design). */
export const BRAND = {
  black: '#000000',
  white: '#ffffff',
  green: '#c9e14a',
  blue: '#1763b5',
  pink: '#ec4e92',
} as const;

/** Farben für Live-Cursor, deterministisch per user_key gewählt. */
export const USER_COLORS = ['#ec4e92', '#1763b5', '#7aa21b', '#e8590c', '#7048e8', '#0c8599', '#c2255c', '#5c940d'];

/**
 * Farben für Haftnotizen (36): ein Raster aus zwölf Spalten (Farbtöne Gelb, Orange, Rot, Pink, Lila, Indigo, Blau,
 * Hellblau, Türkis, Grün, Limette und neutral Weiß/Grau/Anthrazit) und drei Reihen – hell (Pastell wie klassische
 * Klebezettel), kräftig, dunkel. Reihenfolge zeilenweise; die Leisten zeigen zwölf Spalten (schmal sechs, seitlich
 * scrollbar). Die bisherigen Notizfarben stecken im Raster (gleiche Hex-Werte, alte Notizen bleiben Palettenfarbe); nur
 * Tannengrün `#2e7d32` ist nicht mehr in der Leiste, bleibt aber gültig. Die Schrift ergibt sich aus dem Kontrast nach
 * WCAG (web `board/colors.ts` `readableInk`): auf der dunklen Reihe weiß. Freie Farben (`#rrggbb`) sind ebenso erlaubt.
 */
export const STICKY_ROWS = 3;
export const STICKY_COLS = 12;
export const STICKY_COLORS = [
  // hell
  '#fff27a', '#ffd08a', '#ff9e8a', '#ffb3d1', '#e2d5ff', '#cdd3f8', '#7fb2f0', '#9fd3ff', '#7fd6e0', '#b9ecd8', '#c9e14a', '#ffffff',
  // kräftig
  '#ffd23f', '#ff8c42', '#c62828', '#f25c78', '#b388eb', '#5c6bc0', '#1565c0', '#29a8e0', '#2ec4b6', '#7bc950', '#a4b81c', '#d4d4cc',
  // dunkel
  '#8a6a00', '#6d4c41', '#7f1d1d', '#880e4f', '#6a1b9a', '#283593', '#0d2c6b', '#01579b', '#00695c', '#1b5e20', '#556b2f', '#2b2b2b',
];

export interface User {
  key: string; // "m:<id>" | "a:<username>"
  name: string;
  isOrga: boolean;
}

export interface BoardInfo {
  id: string;
  title: string;
  createdBy: string; // user key
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  /** Stand des Vorschaubilds (GET /api/boards/:id/thumbnail?v=…); fehlt = keins vorhanden */
  thumbnailAt?: string;
  /** Board ist eine Vorlage (POST /api/boards/:id/duplicate mit template:true) */
  template?: boolean;
  /** nur für die anfragende Person: Board mit Stern markiert (PUT/DELETE /api/boards/:id/favorite) */
  favorite?: boolean;
  /** nur für die anfragende Person: zuletzt geöffnet (ISO) */
  openedAt?: string;
  /** nur in der Antwort von PATCH: Reihenfolge der Umbenennung (höchste gewinnt, wie in board.renamed) */
  titleSeq?: number;
  /** nur Modus local (docs/contract.md §6): Rolle der anfragenden Person */
  role?: BoardRole;
}

/** Board-Rollen im Modus local (docs/contract.md §6): view < comment < edit < owner. */
export type BoardRole = 'owner' | 'edit' | 'comment' | 'view';

/** So viele Tage liegt ein gelöschtes Board im Papierkorb, dann löscht der Server es endgültig (docs/contract.md §3). */
export const TRASH_DAYS = 30;

/** Board im Papierkorb (`GET /api/trash`): Board-Angaben plus wer wann gelöscht hat. */
export interface TrashedBoardInfo extends BoardInfo {
  deletedAt: string;
  deletedBy: string; // user key
  deletedByName: string;
  /** ab hier löscht der Server endgültig (deletedAt + TRASH_DAYS) */
  purgeAt: string;
  /** anfragende Person darf wiederherstellen und endgültig löschen (Ersteller:in, wer gelöscht hat, Orga) */
  canManage: boolean;
}

/** Versionsverlauf (docs/contract.md §3 „Versionen“). */
export type BoardVersionKind = 'auto' | 'manual' | 'backup' | 'restored';
export interface BoardVersionPerson {
  key: string;
  name: string;
}
export interface BoardVersionInfo {
  id: string;
  createdAt: string;
  /** auto = automatisch, manual = „Version speichern“, backup = vor dem Wiederherstellen, restored = Stand danach */
  kind: BoardVersionKind;
  /** benannt = wird nie ausgedünnt */
  name: string | null;
  /** wer seit der vorigen Version geändert hat */
  people: BoardVersionPerson[];
  /** wer gespeichert bzw. wiederhergestellt hat */
  by: BoardVersionPerson | null;
  /** kind = restored: Zeitpunkt der wiederhergestellten Version */
  restoredFrom: string | null;
  objects: number;
  /** Speicherbedarf (komprimiert) */
  bytes: number;
}

export interface ApiError {
  ok: false;
  error: string;
  message: string;
}

/**
 * Objekttypen. Feature-Module ergänzen eigene Typen per Module-Augmentation, ohne diese Datei zu ändern:
 * `declare module '<pfad>/shared/protocol' { interface ObjectTypeMap { table: true } }` (siehe docs/architecture.md).
 */
export interface ObjectTypeMap {
  sticky: true;
  text: true;
  shape: true;
  connector: true;
  pen: true;
  frame: true;
  image: true;
}
export type ObjectType = keyof ObjectTypeMap;

/** Formen; erweiterbar wie ObjectTypeMap (`interface ShapeKindMap { star: true }`). */
export interface ShapeKindMap {
  rect: true;
  ellipse: true;
  diamond: true;
  triangle: true;
}
export type ShapeKind = keyof ShapeKindMap;

export type LineStyle = 'straight' | 'elbow' | 'curved';
export type DashStyle = 'solid' | 'dashed' | 'dotted';
export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

export type Side = 'n' | 'e' | 's' | 'w';

/**
 * Ende eines Verbinders: an ein Objekt geheftet oder frei auf dem Board.
 * `side`: angedocktes Ende sitzt fest an dieser Seitenmitte; fehlt es, wählt der Client die nächstliegende Seite
 * (gewinkelt/geschwungen) bzw. den Strahl von Mitte zu Mitte (gerade).
 */
export type ConnectorEnd = { objectId: string; side?: Side } | { x: number; y: number };

/** Felder eines Objekts in doc.getMap('objects'). Koordinaten in Board-Einheiten (1 = 1 px bei Zoom 100 %). */
export interface BoardObject {
  id: string;
  type: ObjectType;
  x: number;
  y: number;
  w: number;
  h: number;
  z: string; // Fractional Index
  color?: string; // Füllfarbe (sticky/shape/frame) bzw. Strichfarbe (pen/connector)
  /** Klartext (sticky/text/shape, Verbinder-Beschriftung). Bei Rich-Text der Klartext-Spiegel von `content`. */
  text?: string;
  /**
   * Rich-Text (sticky/text/shape/connector-Beschriftung): im Y.Map ein `Y.XmlFragment` im y-prosemirror-Format.
   * Im Schnappschuss nur eine Lesekopie, deren Form der registrierte Feld-Codec bestimmt (Standard: XML-String).
   * Siehe docs/contract.md §4 „Rich-Text“.
   */
  content?: unknown;
  fontSize?: number; // text-Objekte; sticky passt die Größe automatisch an
  shape?: ShapeKind;
  stroke?: string;
  strokeWidth?: number;
  from?: ConnectorEnd; // connector
  to?: ConnectorEnd; // connector
  arrowEnd?: boolean; // connector
  arrowStart?: boolean; // connector: Pfeil am Anfang (Standard aus)
  lineStyle?: LineStyle; // connector (Standard 'straight')
  dash?: DashStyle; // connector (Standard 'solid'); bei shape gilt nur 'dashed' für den Rand
  points?: number[]; // pen: [x0,y0,x1,y1,...] relativ zu (x,y)
  imageId?: string; // image
  title?: string; // frame
  locked?: boolean;
  groupId?: string; // gleiche groupId = eine Gruppe (Klick wählt alle Mitglieder)
  // Formatierung, gilt fürs ganze Objekt (sticky/text/shape)
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  align?: TextAlign; // Standard: text 'left', sticky/shape 'center'
  valign?: VerticalAlign; // sticky/shape, Standard 'middle'
  autoWidth?: boolean; // text: Breite folgt dem Inhalt (bis zum ersten manuellen Ziehen am Seitengriff)
  rotation?: number; // Grad im Uhrzeigersinn um die Mitte (sticky/shape/text/image); x/y/w/h bleiben ungedreht
  createdBy: string;
  updatedAt: string;
}

export interface AwarenessState {
  user: { key: string; name: string; color: string };
  cursor: { x: number; y: number } | null;
  selection: string[];
}

/**
 * Namen der Y-Strukturen im Board-Dokument: `objects` gehört dem Kern. Feature-Module legen eigene Strukturen
 * mit Modul-Präfix an (`<modul>.<zweck>`, z. B. 'collab.comments'), siehe docs/contract.md §4.
 */
export const DOC_OBJECTS = 'objects';

/**
 * Rich-Text (docs/contract.md §4 „Rich-Text“): Feld im Objekt-Y.Map mit einem Y.XmlFragment im y-prosemirror-Format.
 * Knoten- und Mark-Namen wie im Tiptap-StarterKit; mindestens diese werden verstanden, weitere nur additiv
 * (Clients überspringen Unbekanntes und behalten den Text).
 */
export const RICH_TEXT_FIELD = 'content';
export const RICH_TEXT_NODES = ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote', 'codeBlock', 'hardBreak'] as const;
export const RICH_TEXT_MARKS = ['bold', 'italic', 'strike', 'underline', 'code', 'link', 'highlight', 'textStyle'] as const;
/** Objekttypen mit Rich-Text (Verbinder: Beschriftung). */
export const RICH_TEXT_TYPES: readonly ObjectType[] = ['sticky', 'text', 'shape', 'connector'];

