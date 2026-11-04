// Import aus anderen Whiteboards (docs/features/import.md, Vertrag docs/contract.md §3 „Import“).
// Nur Typen und Konstanten, keine Laufzeit-Abhängigkeiten (server/, web/ und mcp/ importieren relativ).

/** Quelle eines Imports. Bisher nur Miro (REST-API v2). */
export type ImportSource = 'miro';

/** `GET /api/import/sources` */
export interface ImportSources {
  ok: true;
  miro: {
    /** Import grundsätzlich an (STACHEL_IMPORT ≠ off) */
    enabled: boolean;
    /** persönliches Zugriffstoken einfügen erlaubt (STACHEL_IMPORT_MIRO_TOKEN ≠ off) */
    token: boolean;
    /** „Mit Miro verbinden“ (OAuth) möglich: MIRO_CLIENT_ID und MIRO_CLIENT_SECRET gesetzt */
    oauth: boolean;
    /** die anfragende Person hat eine gespeicherte OAuth-Verbindung (verschlüsseltes Refresh-Token) */
    connected: boolean;
  };
}

/**
 * Verbindung für Board-Liste und Import: `oauth` = gespeicherte OAuth-Verbindung der Person, sonst die ID aus
 * `POST /api/import/miro/token` (nur im Speicher des Servers, 60 min, an die Person gebunden).
 */
export type ImportConn = 'oauth' | string;

/** `POST /api/import/miro/token` → `{ok, conn}` */
export interface ImportTokenResult {
  ok: true;
  conn: string;
  /** Ablauf der Verbindung im Server (ISO) */
  expiresAt: string;
}

/** `POST /api/import/miro/oauth/start` → `{ok, url}`: diese Adresse im Browser öffnen (Miro-Freigabeseite). */
export interface ImportOauthStart {
  ok: true;
  url: string;
}

/** Eintrag der Board-Liste (`GET /api/import/miro/boards`). Nichts davon wird gespeichert. */
export interface ImportRemoteBoard {
  id: string;
  name: string;
  description?: string;
  /** zuletzt geändert (ISO) */
  modifiedAt?: string;
}

/** `GET /api/import/miro/boards?conn=&query=&offset=` */
export interface ImportRemoteBoards {
  ok: true;
  boards: ImportRemoteBoard[];
  /** nächste Seite: als `offset` übergeben; fehlt = Ende */
  next?: number;
}

/** Optionen eines Imports (`POST /api/import/miro/jobs`). */
export interface ImportOptions {
  /** Notizfarben als Originalfarbe statt der nächsten Palettenfarbe (Standard false) */
  keepColors?: boolean;
  /** Board-Beschreibung als Text oben links (Standard true) */
  description?: boolean;
}

/** höchstens so viele Boards je Auftrag */
export const IMPORT_MAX_BOARDS_PER_REQUEST = 10;

export type ImportJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';
/** read = Objekte lesen, images = Bilder/Dokumente laden, build = Board anlegen */
export type ImportPhase = 'queued' | 'read' | 'images' | 'build' | 'done';

/** Ein Eintrag im Bericht: Code (stabil, für Tests/Übersetzung), deutscher Text, Anzahl. */
export interface ImportReportEntry {
  code: string;
  text: string;
  count: number;
}

export interface ImportReport {
  /** übernommene Objekte je Stachel-Typ (sticky, shape, text, connector, frame, image, document, card, mindnode …) */
  imported: Record<string, number>;
  /** übernommen, aber angepasst (z. B. Notizfarbe auf die Palette, Form vereinfacht) */
  adjusted: ImportReportEntry[];
  /** nicht übernommen (unbekannte Typen, Bilder über der Quote, Verbinder ohne Ziel …) */
  skipped: ImportReportEntry[];
  /** feste Hinweise (was die Schnittstelle grundsätzlich nicht liefert) */
  notes: string[];
}

/** `GET /api/import/jobs/:id` → `{ok, job}`; `GET /api/import/jobs` → `{ok, jobs}` (eigene, neueste zuerst, 7 Tage) */
export interface ImportJob {
  id: string;
  source: ImportSource;
  /** Board-ID in der Quelle */
  sourceBoard: string;
  /** Name in der Quelle (Titel des neuen Boards) */
  sourceName: string;
  status: ImportJobStatus;
  phase: ImportPhase;
  /** Fortschritt der Phase */
  done: number;
  total: number;
  /** angelegtes Stachel-Board (ab Phase build bzw. bei done) */
  boardId?: string;
  /** Fehlertext (status failed), deutsch mit nächstem Schritt */
  error?: string;
  report?: ImportReport;
  createdAt: string;
  finishedAt?: string;
}

/** Abfrage-Abstand für den Fortschritt (Web und App) */
export const IMPORT_POLL_MS = 1500;
