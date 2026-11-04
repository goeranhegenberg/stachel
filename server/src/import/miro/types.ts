// Schnittstelle zwischen Lesen (fetch-board.ts), Abbilden (map.ts, reine Funktionen) und Bauen (../build.ts).
// Miro-Antworten sind bewusst locker typisiert (die API liefert Zahlen teils als Strings, Felder fehlen je nach Typ);
// map.ts prüft jeden Wert selbst. Docs: docs/features/import.md.
import type { ImportReport, ImportReportEntry } from '../../../../shared/import.js';

/** Lage eines Miro-Objekts: Mitte (`origin: center`), relativ zur Board-Mitte oder zur linken oberen Ecke des Elternteils. */
export interface MiroPosition {
  x?: number;
  y?: number;
  origin?: string;
  relativeTo?: 'canvas_center' | 'parent_top_left' | string;
}

export interface MiroGeometry {
  width?: number;
  height?: number;
  rotation?: number;
}

/** Ein Objekt aus `GET /v2/boards/{id}/items` (bzw. v2-experimental). */
export interface MiroItem {
  id: string;
  type: string;
  data?: Record<string, any>;
  style?: Record<string, any>;
  position?: MiroPosition;
  geometry?: MiroGeometry;
  parent?: { id: string } | null;
  isSupported?: boolean;
  /** manche Antworten liefern Tag-IDs direkt mit */
  tagIds?: string[];
}

export interface MiroConnectorEnd {
  id?: string;
  position?: { x?: string; y?: string };
  snapTo?: string;
}

/** Ein Verbinder aus `GET /v2/boards/{id}/connectors`. */
export interface MiroConnector {
  id: string;
  startItem?: MiroConnectorEnd | null;
  endItem?: MiroConnectorEnd | null;
  shape?: string;
  style?: Record<string, any>;
  captions?: { content?: string; position?: string; textAlignVertical?: string }[];
  isSupported?: boolean;
}

export interface MiroTag {
  id: string;
  title?: string;
  fillColor?: string;
}

/** Gruppe (normalisiert aus `GET /v2/boards/{id}/groups`): Mitglieder-IDs. */
export interface MiroGroup {
  id: string;
  items: string[];
}

/** Mindmap-Knoten aus `GET /v2-experimental/boards/{id}/mindmap_nodes`. */
export interface MiroMindNode {
  id: string;
  type?: string;
  data?: { isRoot?: boolean; direction?: string; nodeView?: { type?: string; data?: Record<string, any> } } & Record<string, any>;
  style?: Record<string, any>;
  position?: MiroPosition;
  geometry?: MiroGeometry;
  parent?: { id: string } | null;
}

/** Alles, was der Import über ein Board gelesen hat (Eingabe für map.ts). */
export interface MiroBoardData {
  board: { id: string; name: string; description?: string };
  /** in der Reihenfolge, in der `/items` sie geliefert hat (= Ebenenfolge unten → oben) */
  items: MiroItem[];
  connectors: MiroConnector[];
  tags: MiroTag[];
  /** Tag-IDs je Objekt-ID (aus `…/items/{id}/tags`) */
  itemTags: Record<string, string[]>;
  groups: MiroGroup[];
  mindNodes: MiroMindNode[];
  /**
   * Formen aus `/v2-experimental/…/shapes/{id}` (Objekt-ID → Antwort): alle, die `/items` als `isSupported: false` ohne
   * `data`/`style` liefert (so kommen Flussdiagramm-Formen, echte Antworten 11/2026) bzw. mit unbekanntem `shape`
   */
  experimentalShapes: Record<string, MiroItem>;
  /** HTML von Miro-Docs (`doc_format`) je Objekt-ID */
  docs: Record<string, string>;
  /** Hinweise aus dem Lesen (z. B. Mindmap-Endpunkt nicht erreichbar) – landen im Bericht */
  warnings: ImportReportEntry[];
}

/** Eine Datei, die vor dem Bauen geladen werden muss. */
export interface AssetNeed {
  /** Stachel-Objekt, das die Datei bekommt */
  objectId: string;
  kind: 'image' | 'document';
  /** Miro-API-Adresse (`data.imageUrl`/`data.documentUrl`), wird mit Token und `redirect=false` abgefragt */
  apiUrl: string;
  /** Dateiname/Titel (Dokumente) */
  title?: string;
}

/** Ein Baum für `store.mind.tree` (gleiche Form wie MindTreeSpec in native/web-api.ts). */
export interface MindTree {
  text: string;
  side?: 'l' | 'r';
  children?: MindTree[];
}

/** Ein fertiges Stachel-Objekt für `store.createMany` (Felder wie `BoardObject` + Feature-Felder, ohne `z`/`createdBy`/`updatedAt`). */
export interface MappedObject extends Record<string, unknown> {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Ergebnis von map.ts: fertige Stachel-Objekte (ohne `z`, `createdBy`, `updatedAt`) in Zeichenreihenfolge unten → oben. */
export interface MappedBoard {
  title: string;
  /** Objekte für `store.createMany` (je mit `id`, `type`, `x`, `y`, `w`, `h` …; Rich-Text als ProseMirror-JSON in `content`) */
  objects: MappedObject[];
  /** Mindmaps, die nach den Objekten über `store.mind.tree(rootId, x, y, tree)` entstehen */
  minds: { rootId: string; x: number; y: number; tree: MindTree }[];
  /** Dateien zum Laden; das Objekt trägt bis dahin `imageId: ''` bzw. `docFile: ''` */
  assets: AssetNeed[];
  report: ImportReport;
  /** Text-Objekt mit der Board-Beschreibung: der Bau rückt es über den fertigen Inhalt (Mindmaps ordnet Stachel neu an) */
  descriptionId?: string;
}

export interface MapOptions {
  /** Notizpalette (Standard `STICKY_COLORS`), nächste Farbe wird berechnet */
  palette?: readonly string[];
  /** Originalfarben der Notizen behalten */
  keepColors?: boolean;
  /** Board-Beschreibung als Text oben links */
  description?: boolean;
  /** Obergrenzen (Rest → Bericht) */
  maxObjects?: number;
  maxImages?: number;
  /** ID-Erzeuger (Tests: deterministisch) */
  newId?: () => string;
}
