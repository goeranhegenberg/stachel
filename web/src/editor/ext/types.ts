// Schnittstellen der Erweiterungspunkte (Register): Objekttypen, Werkzeuge, Kontextleiste, Kürzel, Menüs, Panels.
// Überblick und Beispiele: docs/architecture.md.
import type { ComponentType, CSSProperties, MouseEvent as RMouseEvent, ReactNode } from 'react';
import type { BoardObject, ObjectType, ShapeKind, TextAlign } from '../../protocol';
import type { BoardSession } from '../../board/session';
import type { BoardStore, NewObject, Patch, Snapshot } from '../../board/store';
import type { Camera, Handle, Point, Rect } from '../../board/geometry';
import type { ObjectLookup } from '../../board/connector';
import type { TypeInfo } from '../../board/types';
import type { GapMark, Line } from '../interaction/snapping';
import type { Detail } from '../render/format';
import type { MenuItem } from '../interaction/ContextMenu';

// ---- Editor-API (bekommen alle Handler und Slot-Komponenten) ------------------------------------------------

/** Entwurf in der Overlay-Ebene (während einer Geste). `world`/`screen`: eigene Darstellung der Feature-Module. */
export type Draft =
  | { kind: 'marquee'; rect: Rect }
  | { kind: 'shape'; rect: Rect; shape: ShapeKind }
  | { kind: 'frame'; rect: Rect }
  | { kind: 'pen'; points: Point[]; color: string; width: number }
  | { kind: 'connector'; a: Point; b: Point }
  | { kind: 'guides'; lines: Line[]; gaps?: GapMark[] }
  /** SVG-Inhalt in Weltkoordinaten (die Kamera-Transformation setzt die Overlay-Ebene) */
  | { kind: 'world'; node: ReactNode }
  /** beliebiger Inhalt in Bildschirmkoordinaten */
  | { kind: 'screen'; node: ReactNode };

export interface EditorApi {
  readonly store: BoardStore;
  readonly session: BoardSession;

  // Lesen
  snapshot(): Snapshot;
  selection(): string[];
  selected(): BoardObject[];
  tool(): string;
  editingId(): string | null;
  camera(): Camera;
  viewSize(): { w: number; h: number };
  /** Zeigerart der letzten Eingabe ('mouse' | 'touch' | 'pen') */
  pointerType(): string;
  /** läuft gerade eine Präsentation? */
  presenting(): boolean;
  /** Präsentation ab Rahmen `index` starten (Übergabe, docs/features/private.md §7) */
  startPresent(index: number): void;
  /** Präsentation beenden */
  stopPresent(): void;

  // Umrechnen & Treffer
  toWorld(screen: Point): Point;
  toScreen(world: Point): Point;
  /** Weltpunkt unter dem Mauszeiger, falls er über dem Board ist */
  pointerWorld(): Point | null;
  viewCenter(): Point;
  /** Oberstes Objekt am Weltpunkt (Raster-Index, Hit-Rollen der Typen) */
  hitTest(p: Point, skip?: (o: BoardObject) => boolean): BoardObject | null;
  /** Objekte, deren Rechteck `r` schneidet (von unten nach oben) */
  queryRect(r: Rect): BoardObject[];
  /** Weltrechteck eines Objekts (auch abgeleitete Typen wie Verbinder) */
  bounds(o: BoardObject): Rect | null;

  // Auswahl, Werkzeug, Bearbeitung
  setSelection(ids: string[]): void;
  setTool(id: string): void;
  startEditing(o: BoardObject): void;
  /** Tab-Fluss: Bearbeitung beenden, gleiche Notiz rechts (bzw. links) anlegen und weiterschreiben */
  editNext(back: boolean): void;

  // Anlegen & Ändern (jeweils eigener Undo-Schritt)
  /** Objekt anlegen; `select`/`edit` wählen es aus bzw. starten die Bearbeitung, das Werkzeug wechselt dann auf Auswahl. */
  create(obj: NewObject, opts?: { select?: boolean; edit?: boolean }): string;
  /** Objekt vom Typ `type` an `p` anlegen (ObjectTypeDef.create bzw. Standardgröße) und bearbeiten */
  placeAt(type: ObjectType, p: Point): string | null;
  /** Patch je ausgewähltem, nicht gesperrtem Objekt (null = auslassen), ein Undo-Schritt */
  patchSelection(fn: (o: BoardObject) => Patch | null): void;
  /** Typ-spezifische Anpassung eines Patches (z. B. Textbreite bei autoWidth) */
  adjustPatch(o: BoardObject, p: Patch): Patch;
  /** Höhe gemessener Typen (Text) nach dem Rendern nachziehen; `endStep` beendet danach den Undo-Schritt */
  remeasure(ids: Iterable<string>, endStep?: boolean): void;
  toggleFormat(ids: string[], k: 'bold' | 'italic' | 'strike'): void;
  deleteSelection(): void;
  duplicate(): void;
  copySelection(): void;
  /** Einfügen aus der System-Zwischenablage (bzw. zuletzt Kopiertem) an `at` */
  pasteAt(at: Point): Promise<void>;
  /** Objekte (z. B. aus einer Vorlage) einfügen: an `at` zentriert, sonst am Mauszeiger bzw. in der Bildmitte */
  insertObjects(objs: BoardObject[], at?: Point | null): void;
  toggleLock(): void;
  group(): void;
  ungroup(): void;
  bringToFront(): void;
  sendToBack(): void;
  /** Ausrichten/Verteilen: Einheiten (Gruppen bzw. Objekte) und Verschiebung anwenden */
  arrangeUnits(): Map<string, BoardObject[]>;
  applyArrange(fn: (units: { key: string; rect: Rect }[]) => Map<string, { dx: number; dy: number }>): void;
  /** Dateiauswahl für Bilder öffnen */
  pickImages(): void;
  addImages(files: File[], at?: Point | null): Promise<void>;

  // Kamera
  setCamera(c: Camera): void;
  animateCamera(c: Camera, ms?: number): void;
  fitTo(r: Rect, maxZoom?: number): void;
  fitAll(): void;
  zoomStep(dir: 1 | -1): void;
  zoomReset(): void;
  zoomToSelection(): void;
  centerOn(p: Point): void;

  // Oberfläche
  setDraft(d: Draft | null): void;
  setHover(id: string | null): void;
  toast(msg: string): void;
  openModal(id: string, props?: unknown): void;
  closeModal(): void;
  openSidebar(id: string | null): void;
  sidebar(): string | null;
}

// ---- Objekttypen ------------------------------------------------------------------------------------------------

/** Rückmeldungen der Text-Bearbeitung an den Editor (stabil, ObjectView ist memoisiert). */
export interface EditCallbacks {
  onTextChange: (id: string, text: string) => void;
  onTitleChange: (id: string, title: string) => void;
  onEditDone: (id: string, el: HTMLElement | null) => void;
  /** Gemessene Texthöhe weicht von `h` ab (andere Schrift-Metrik). Nur für ausgewählte Objekte übernehmen. */
  onMeasured?: (id: string, h: number) => void;
}

export interface ObjectViewProps {
  o: BoardObject;
  editing: boolean;
  detail: Detail;
  /** Objekt ist (bei mir) ausgewählt */
  selected: boolean;
  /** weit herausgezoomt (unter FAR_ZOOM) */
  far: boolean;
  imageSrc?: string;
  /** Name einer anderen Person, die das Objekt gerade ausgewählt hat */
  remoteName?: string;
  cb: EditCallbacks;
  /** Ergebnis von ObjectTypeDef.derive (z. B. Verbinder-Geometrie) */
  derived?: unknown;
}

/** Aus anderen Objekten abgeleitete Geometrie: Grenzen fürs Culling/Auswahl, Schlüssel fürs Neuzeichnen. */
export interface Derived {
  bounds: Rect;
  key: string;
  data: unknown;
}

export interface SelectionViewProps {
  o: BoardObject;
  snap: Snapshot;
  cam: Camera;
  width: number;
  height: number;
  /** Griffe ausblenden (z. B. beim Ziehen) */
  hideHandles: boolean;
}

export interface ResizeContext {
  /** Auswahlrechteck vor/nach dem Ziehen */
  from: Rect;
  to: Rect;
  /** neues (ungerundetes) Rechteck dieses Objekts */
  rect: Rect;
  /** Seitengriff, der nur die Breite ändert (sideResize: 'width') */
  widthOnly: boolean;
}

export interface ObjectTypeDef extends TypeInfo {
  type: ObjectType;
  /** Name für Menschen („Haftnotiz“) */
  label: string;
  View: ComponentType<ObjectViewProps>;
  /** Fläche bei kleiner Darstellung (Detailstufe 'simple') */
  simpleStyle?: (o: BoardObject, imageSrc?: string) => CSSProperties;
  /** Ab dieser Bildschirmgröße (px, längere Seite) voll zeichnen; null = immer voll. Standard 40. */
  lodPx?: number | null;
  /** Geometrie aus anderen Objekten (Verbinder); setzt `dependent` */
  derive?: (o: BoardObject, lookup: ObjectLookup) => Derived | null;
  /** Weit herausgezoomt zusätzlich über allem zeichnen (großer Rahmentitel); `zq` = log2(Zoom), grob gerundet */
  FarLabel?: ComponentType<{ o: BoardObject; zq: number }>;
  /** Eigene Darstellung der Einzelauswahl statt Rahmen + Griffe (Bildschirmkoordinaten) */
  SelectionView?: ComponentType<SelectionViewProps>;
  /** Standardgröße beim Anlegen per Klick */
  defaultSize?: { w: number; h: number };
  /** Neues Objekt an `p` (Werkzeug-Klick, Doppelklick); Standard: defaultSize um p zentriert */
  create?: (p: Point, api: EditorApi) => NewObject;
  /** Bearbeiten-Einstieg: 'text' (Text im Objekt), 'title' (Titel über dem Objekt), 'label' (Beschriftung) */
  edit?: 'text' | 'title' | 'label';
  /** Nach dem Bearbeiten (leere Texte löschen, Höhe messen) */
  onEditDone?: (o: BoardObject, api: EditorApi, el: HTMLElement | null) => void;
  /** Patch vor dem Schreiben anpassen (z. B. Breite bei autoWidth) */
  adjustPatch?: (o: BoardObject, p: Patch) => Patch;
  /** Höhe folgt dem gerenderten Inhalt (CSS-Selektor des gemessenen Elements im Objekt) */
  measure?: string;
  /** Schriftgröße/Format in der Kontextleiste */
  textual?: boolean;
  /** Standard-Textausrichtung (sonst 'center') */
  textAlign?: TextAlign;
  /** senkrechte Ausrichtung wählbar */
  valign?: boolean;
  /** Schriftgröße, wenn `fontSize` fehlt */
  defaultFontSize?: number;
  /** Schriftgröße passt sich ohne `fontSize` automatisch an („Auto“): liefert die berechnete Größe */
  autoFont?: (o: BoardObject) => number;
  /** Farbpalette der Kontextleiste und Farbe, wenn `color` fehlt; `colorable: false` = keine Farbwahl */
  palette?: readonly string[];
  defaultColor?: string;
  colorable?: boolean;
  rotatable?: boolean;
  /** Andockpunkte beim Überfahren (Verbinder herausziehen) */
  anchorable?: boolean;
  /** Plus-Griffe und Tab-Fluss (Kopie daneben anlegen) */
  addHandles?: boolean;
  /** Griffe der Einzelauswahl (Standard: alle acht) */
  handles?: (o: BoardObject) => Handle[];
  /** Seitenverhältnis beim Skalieren halten (immer bzw. nur an Ecken) */
  keepAspect?: boolean | 'corner';
  /** Seitengriffe ändern nur die Breite (Text) */
  sideResize?: 'width';
  /** Patch beim Skalieren; `base` = neues x/y/w/h (gerundet) */
  resize?: (o: BoardObject, base: Patch, ctx: ResizeContext) => Patch;
  /** nach dem Skalieren (z. B. Breite neu bestimmen) */
  afterResize?: (o: BoardObject, api: EditorApi) => void;
  /**
   * Nach dem Verschieben mit der Maus bzw. dem Finger (Zeiger los), noch im Rückgängig-Schritt der Bewegung: alle
   * bewegten Objekte und das gegriffene (z. B. Haftnotiz auf Haftnotiz → Stapel). Je Typ der bewegten Objekte einmal.
   */
  afterMove?: (moved: BoardObject[], api: EditorApi, grabbed: string) => void;
  /** Rahmen-artig: nimmt enthaltene Objekte mit, nur über den Titel greifbar */
  container?: boolean;
  /** Auswahlrechteck: 'contain' = nur bei vollem Einschluss (Standard: berühren) */
  marquee?: 'touch' | 'contain';
  /** Einrast-Ziel für andere Objekte (Standard: ja) */
  snapTarget?: boolean;
  /** Kontextleisten-Einträge, die zu diesem Typ gehören (werden mit registriert) */
  actions?: ContextActionDef[];
}

// ---- Formen -------------------------------------------------------------------------------------------------------

export interface ShapeKindDef {
  kind: ShapeKind;
  label: string;
  order: number;
  icon: ReactNode;
  /** SVG-Pfad in Objektkoordinaten, um `inset` (halbe Randbreite) eingerückt */
  path: (w: number, h: number, inset: number) => string;
  /** Textfläche: Abstände oben, rechts, unten, links */
  insets?: (w: number, h: number) => [number, number, number, number];
  /** Umriss zum Andocken von Verbindern (Polygon in Objektkoordinaten); fehlt = Rechteck */
  outline?: (w: number, h: number) => Point[];
  /** einfache Fläche bei kleiner Darstellung: CSS-clip-path bzw. border-radius */
  simpleClip?: string;
  simpleRadius?: string;
}

// ---- Werkzeuge ----------------------------------------------------------------------------------------------------

export interface ToolPointerEvent {
  world: Point;
  screen: Point;
  shift: boolean;
  alt: boolean;
  mod: boolean;
  pointerType: string;
  /** Element unter dem Zeiger */
  target: HTMLElement;
}

/** Laufende Geste eines Werkzeugs (zwischen pointerdown und pointerup). */
export interface ToolGesture {
  /** Name für CSS-Klassen/Cursor, z. B. 'draw' */
  kind?: string;
  /** Objekte unter dem Zeiger als Andock-Ziel (grün) hervorheben */
  hoverTarget?: boolean;
  move?(e: ToolPointerEvent): void;
  up?(e: ToolPointerEvent): void;
  /** Abbruch (Esc, zweiter Finger, pointercancel) */
  cancel?(): void;
}

export interface ToolDef {
  id: string;
  label: string;
  order: number;
  /** Kürzel (eine Taste, klein geschrieben) */
  key?: string;
  /** Text in der Kürzel-Übersicht (Standard: label) */
  hint?: string;
  Icon: ComponentType;
  /** Trennlinie davor */
  sepBefore?: boolean;
  /** CSS-Cursor über dem Board (Standard: crosshair) */
  cursor?: string;
  /** Knopf führt eine Aktion aus, statt das Werkzeug zu wählen (z. B. Bild einfügen) */
  action?: (api: EditorApi) => void;
  /** Untermenü neben dem Knopf, solange das Werkzeug aktiv ist */
  Options?: ComponentType<{ api: EditorApi }>;
  /** Objekte beim Überfahren als Andock-Ziel hervorheben (Verbinder) */
  hoverTarget?: boolean;
  /** Handy-Leiste: 'hide' = dort nicht zeigen (z. B. Hand: ein Finger verschiebt ohnehin), 'more' = immer hinter „Weitere“ */
  phone?: 'hide' | 'more';
  /** Optionen nicht dauernd zeigen, sondern erst beim erneuten Klick auf das aktive Werkzeug (Auswählen: Lasso) */
  optionsOnDemand?: boolean;
  /** Zeiger gedrückt (Werkzeug aktiv); Rückgabe = Geste bis zum Loslassen */
  down?: (e: ToolPointerEvent, api: EditorApi) => ToolGesture | void;
}

// ---- Kontextleiste ------------------------------------------------------------------------------------------------

export interface CtxInfo {
  selected: BoardObject[];
  types: ReadonlySet<string>;
  first: BoardObject;
  single: BoardObject | null;
  /** alle ausgewählten Objekte gesperrt */
  locked: boolean;
}

export interface CtxProps extends CtxInfo {
  api: EditorApi;
  /** Patch je ausgewähltem Objekt, ein Undo-Schritt */
  patch: (fn: (o: BoardObject) => Patch | null) => void;
  /** wie patch, schließt danach das Popover */
  choose: (fn: (o: BoardObject) => Patch | null) => void;
  /** Schlüssel des offenen Popovers */
  pop: string | null;
  togglePop: (key: string) => (e: RMouseEvent<HTMLButtonElement>) => void;
  closePop: () => void;
}

export interface CtxPopDef {
  /** zusätzliche Klasse (ctx-pop--row, --list, …) */
  className?: string;
  label: string;
  Body: ComponentType<CtxProps>;
}

export interface ContextActionDef {
  id: string;
  /** Position in der Leiste (links nach rechts); Kern: 10 Farbe … 90 Allgemein */
  order: number;
  when: (c: CtxInfo) => boolean;
  /** Knopfgruppe (rendert ihr eigenes `.ctx-group`) */
  Bar: ComponentType<CtxProps>;
  /** Popover-Inhalte nach Schlüssel (geöffnet über togglePop) */
  pops?: Record<string, CtxPopDef>;
}

// ---- Tastenkürzel -------------------------------------------------------------------------------------------------

export interface ShortcutDef {
  id: string;
  /** z. B. 'mod+d', 'mod+shift+g', 'shift+Digit1', 'PageDown', '?'; 'mod' = Strg bzw. ⌘, 'plus' = '+' */
  keys?: string[];
  /** false = nicht behandelt (Taste geht weiter) */
  run?: (api: EditorApi, e: KeyboardEvent) => boolean | void;
  /** 'board' (Standard), 'editing' (nur während der Textbearbeitung), 'both' */
  scope?: 'board' | 'editing' | 'both';
  /** erst nach „Tippen startet die Bearbeitung“ prüfen (druckbare Zeichen wie '?') */
  late?: boolean;
  /** Eintrag in der Kürzel-Übersicht */
  help?: { group: string; keys: string; label: string; order: number };
}

// ---- Menüs, Panels, Slots -----------------------------------------------------------------------------------------

export interface SlotProps {
  api: EditorApi;
  cam: Camera;
  snap: Snapshot;
  selection: readonly string[];
  width: number;
  height: number;
}

/**
 * Stellen in der Oberfläche: oben links (nach dem Board-Titel), oben rechts (vor den Anwesenden),
 * Zoomleiste, `world` (in der Welt-Ebene über den Objekten, Weltkoordinaten), `overlay` (über dem Board, Bildschirm).
 */
export type SlotName = 'topbarLeft' | 'topbarRight' | 'zoombar' | 'world' | 'overlay';

export interface SlotDef {
  id: string;
  slot: SlotName;
  order: number;
  Component: ComponentType<SlotProps>;
  /** auch im Präsentationsmodus zeigen (nur world/overlay) */
  presenting?: boolean;
}

export interface SidebarTabDef {
  id: string;
  title: string;
  order: number;
  Icon: ComponentType<{ size?: number }>;
  Panel: ComponentType<SlotProps & { onClose: () => void }>;
  /** Knopf oben rechts zum Öffnen */
  button?: boolean;
}

export interface ModalDef {
  id: string;
  Component: ComponentType<{ api: EditorApi; props: unknown; onClose: () => void }>;
}

export interface MenuItemDef {
  id: string;
  order: number;
  /** Kontextmenü: auf Objekt(en) oder auf leerer Fläche; Board-Menü: 'board' */
  on: 'object' | 'canvas' | 'board';
  /** Eintrag bauen; null = nicht zeigen. `at` = Weltpunkt des Klicks (Board-Menü: Bildmitte) */
  item: (api: EditorApi, at: Point) => MenuItem | null;
}

// ---- Dateien (Hochladen, Ziehen & Ablegen, Einfügen) ---------------------------------------------------------------

/**
 * Weitere Dateiarten neben Bildern (z. B. PDF): `addImages` (Dateiauswahl, Ablegen, Strg V) gibt passende Dateien an
 * den Handler weiter, Bilder bleiben beim Kern. `accept` ergänzt die Dateiauswahl.
 */
export interface FileHandlerDef {
  id: string;
  /** für `<input type="file" accept>`, z. B. 'application/pdf,.pdf' */
  accept: string;
  match: (f: File) => boolean;
  /** `at` = Weltpunkt (Ablegen) bzw. null/undefined = Zeiger oder Bildmitte */
  add: (files: File[], api: EditorApi, at?: Point | null) => void | Promise<void>;
}
