// Datenmodell des Moduls „structure“ (Vertrag: docs/features/structure.md): neue Objekttypen und Felder
// per Module-Augmentation. Alle Felder optional – alte Boards laden unverändert.

export type CardStatus = 'todo' | 'doing' | 'blocked' | 'done';
export interface CardTag {
  label: string;
  color: string;
}
export interface CardPerson {
  key: string;
  name: string;
}

export type MindSide = 'l' | 'r';
/** Lage eines Mindmap-Knotens im Baum. level/side/hidden schreibt das automatische Layout. */
export interface MindInfo {
  /** Elternknoten; fehlt (oder existiert nicht) = Wurzel */
  parent?: string;
  /** Reihenfolge unter Geschwistern (aufsteigend) */
  order?: number;
  /** Seite an der Wurzel (nur Kinder der Wurzel), Standard rechts */
  side?: MindSide;
  /** Zweig eingeklappt */
  collapsed?: boolean;
  level?: number;
  /** liegt in einem eingeklappten Zweig */
  hidden?: boolean;
}

/** Tabelleninhalt (Lesekopie; im Y.Map liegt er als Y.Map, siehe table/yjs.ts). */
export interface TableData {
  rows: string[];
  cols: string[];
  /** Zelltext je `${zeilenId}:${spaltenId}` */
  cells: Record<string, string>;
  /** relative Spaltenbreiten je Spalten-id (fehlt = 1) */
  widths: Record<string, number>;
}
export type TableHead = 'row' | 'col' | 'both' | 'none';

declare module '../../../../shared/protocol' {
  interface ObjectTypeMap {
    card: true;
    table: true;
    mindnode: true;
  }
  interface BoardObject {
    /** Karte: Beschreibung (Titel = text) */
    desc?: string;
    /** Karte: zuständige Person */
    assignee?: CardPerson;
    /** Karte: Fälligkeit `YYYY-MM-DD` */
    due?: string;
    /** Karte: Tags */
    tags?: CardTag[];
    /** Karte: Status (fehlt = ohne) */
    status?: CardStatus;
    /** Tabelle: im Y.Map ein Y.Map (rows/cols als Y.Array, cells/widths als Y.Map) */
    table?: TableData;
    /** Tabelle: Kopfzeile/-spalte hervorheben (Standard 'row') */
    tableHead?: TableHead;
    /** Mindmap-Knoten */
    mind?: MindInfo;
    /** Rahmen: Position in der Rahmen-Liste/Präsentation (Fractional-Index); fehlt = nach den sortierten, in Lesereihenfolge */
    slide?: string;
    /** Rahmen: Rasterweite (fehlt = ohne Raster) */
    frameGrid?: number;
    /** Rahmen: Spalten/Zeilen beschriften (A, B, … / 1, 2, …) */
    frameGridLabels?: boolean;
    /** Rahmen: Sprechernotizen (Klartext; beim Präsentieren sieht sie nur die präsentierende Person) */
    notes?: string;
  }
}

export {};
