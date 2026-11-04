// Board-Editor: Kamera, Gesten, Tastatur, Zwischenablage. Daten nur über BoardStore/BoardSession.
// Was Objekttypen, Werkzeuge, Kontextleiste, Kürzel, Menüs und Panels tun, steht in den Registern (editor/ext,
// Kern in editor/core, Erweiterungen in features/). Diese Datei sollen Feature-Module nicht ändern müssen.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { MAX_IMAGE_BYTES, RICH_TEXT_TYPES, type BoardObject, type ConnectorEnd, type ObjectType, type Side } from '../protocol';
import type { BoardSession } from '../board/session';
import type { NewObject, Patch, Snapshot } from '../board/store';
import {
  baseRect,
  center,
  clamp,
  contains,
  expand,
  fitRect,
  GridIndex,
  hitTest,
  intersects,
  mapRect,
  MAX_ZOOM,
  nextZoomStep,
  normRect,
  objRect,
  pointInRect,
  rectToScreen,
  resizeRect,
  rotationOf,
  screenToWorld,
  unionRects,
  viewRect,
  worldToScreen,
  zoomAt,
  type Camera,
  type Handle,
  type Point,
  type Rect,
} from '../board/geometry';
import { endAnchor, isAttached } from '../board/connector';
import { hitRole, isDependent, siblingFields } from '../board/types';
import { cloneObjects, parseClipboard, plainText, toHtml } from '../board/clipboard';
import { movableObjects, movePatches } from '../board/ops/move';
import { arrangePatches, arrangeUnits as arrangeUnitsOf, type Offsets, type Unit } from '../board/ops/arrange';
import { expandGroups, groupPatches, isWholeGroup, ungroupPatches } from '../board/ops/groups';
import { ObjectLayer } from './ObjectLayer';
import { boundsOf, Overlay, selectionBounds, type Draft } from './Overlay';
import { Toolbar } from './Toolbar';
import { ContextBar } from './ContextBar';
import { Minimap } from './Minimap';
import { IconClose, IconFit, IconMinus, IconPlus } from '../ui/icons';
import { announce, describeSelection } from '../ui/a11y';
import { guideLines, snapMove, snapResize } from './interaction/snapping';
import { lassoBounds, rectInLasso } from './interaction/lasso';
import { rotatedResize } from './interaction/resize';
import { canRotateAll, rotateMany, rotationField, snapAngle } from './interaction/rotate';
import { lockPageZoom } from './interaction/pageZoom';
import { createNotchCounter, createWheelClassifier, getWheelMode } from './interaction/wheel';
import { getToolOption } from './ext/toolOptions';
import { ContextMenu, type MenuItem } from './interaction/ContextMenu';
import { FramesPanel, framesInOrder, PresentBar } from './interaction/Frames';
import { IconFrames, IconKeyboard } from './interaction/icons';
import { imageInfo } from './render/imageColor';
import { fileHandlers, menuItems, modals, shortcuts, sidebarTabs, slotsAt, tools, typeDef, typesIntoText } from './ext/registry';
import { matchKey, parseKey, specificity } from './ext/keys';
import type { EditCallbacks, EditorApi, ShortcutDef, SlotProps, ToolGesture, ToolPointerEvent } from './ext/types';
import { textEngine } from './text/engine';
import { chromeInsets } from '../ui/chromeInsets';
import { byPointer } from '../ui/touch';
import { connectorGesture, newLineStyle } from './core/tools';
import './ext/setup';
import './editor.css';

type Gesture =
  | { kind: 'pan'; start: Point; cam: Camera; hold?: string }
  | { kind: 'rpan'; start: Point; cam: Camera; moved: boolean }
  | { kind: 'pinch'; dist: number; mid: Point; cam: Camera }
  | { kind: 'marquee'; start: Point; base: string[]; lasso?: Point[] }
  | {
      kind: 'move';
      start: Point;
      origin: Map<string, BoardObject>;
      moved: boolean;
      clickedId: string;
      wasSelected: boolean;
      screen: Point;
      depth: number;
      others: Rect[];
      box: Rect | null;
      copy: boolean;
      prevSel: string[];
    }
  | {
      kind: 'resize';
      handle: Handle;
      start: Point;
      box: Rect;
      /** Drehung des einzelnen Objekts in Grad (0 = ungedreht); `box` ist dann sein ungedrehtes Rechteck */
      rot: number;
      origin: Map<string, BoardObject>;
      keepAspect: boolean;
      textWidthOnly: boolean;
      depth: number;
      others: Rect[];
    }
  /** Drehen: ein Objekt (`id`) oder mehrere um die gemeinsame Mitte (`origin`, `box` = Rahmen bei Beginn) */
  | { kind: 'rotate'; id: string; c: Point; a0: number; r0: number; depth: number; origin?: Map<string, BoardObject>; box?: Rect; snapped?: boolean }
  | { kind: 'connEnd'; id: string; which: 'from' | 'to'; depth: number }
  | { kind: 'add'; id: string; side: Side; screen: Point }
  /** Präsentation per Touch: Wischen blättert, Tippen links/rechts ebenso */
  | { kind: 'swipe'; start: Point }
  /** Geste eines Werkzeugs aus dem Register (Notiz, Form, Stift, Verbinder …) */
  | { kind: 'tool'; g: ToolGesture };

const isEditableTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

const GRID = 24;
/** Abstand neuer Nachbar-Objekte (Tab, Plus-Griff) */
const SIBLING_GAP = 40;
/** Einrast-Toleranz in Bildschirmpunkten */
const SNAP_PX = 6;
/** Mausrad: Zoom-Schritt je Raste (ln, ≈ 13 %) */
const WHEEL_STEP = 0.12;
/** Auto-Schwenken: Randbreite in Bildschirmpunkten und höchste Geschwindigkeit (px je Bild) */
const EDGE_PX = 32;
const EDGE_SPEED = 16;
/** Präsentation am Handy: Mindestweg einer Wischgeste zum Blättern */
const SWIPE_PX = 50;
/** Handy: kleinster Zoom beim ersten Öffnen eines Boards */
const PHONE_MIN_START_ZOOM = 0.35;
const SIDE_DIR: Record<Side, Point> = { n: { x: 0, y: -1 }, e: { x: 1, y: 0 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 } };
const OPPOSITE: Record<Side, Side> = { n: 's', e: 'w', s: 'n', w: 'e' };
const deg = (p: Point, c: Point) => (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
/** Bilder: große auf 520 px begrenzen, winzige auf 120 px aufziehen – Seitenverhältnis bleibt. */
const imageSize = (width: number, height: number) => {
  const longest = Math.max(1, width, height);
  const scale = Math.max(120 / longest, Math.min(1, 520 / longest));
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
};

/** Kürzel nach Spezifität (mehr Modifikatoren zuerst), damit z. B. Strg Umschalt Z vor Strg Z greift. */
function shortcutSpecs() {
  const out: { def: ShortcutDef; spec: ReturnType<typeof parseKey> }[] = [];
  for (const def of shortcuts.list()) if (def.run) for (const k of def.keys ?? []) out.push({ def, spec: parseKey(k) });
  return out.sort((a, b) => specificity(b.spec) - specificity(a.spec));
}

export interface EditorHandle {
  getCamera(): Camera;
  setCamera(c: Camera): void;
  getSelection(): string[];
  /** Editor-API (Tests und Seiten-Komponenten) */
  api: EditorApi;
}

interface EditorProps {
  session: BoardSession;
  topLeft: ReactNode;
  topRight: ReactNode;
  /** Kamera nach dem ersten Sync auf den Inhalt einpassen */
  ready: boolean;
  onToast: (msg: string) => void;
  handleRef?: React.MutableRefObject<EditorHandle | null>;
}

type Menu = { x: number; y: number; at: Point; on: 'object' | 'canvas' | 'board' };
type Upload = { key: string; rect: Rect; color: string | null };

export function Editor({ session, topLeft, topRight, ready, onToast, handleRef }: EditorProps) {
  const store = session.store;
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const history = useSyncExternalStore(store.subscribeHistory, store.getHistory);
  const peers = useSyncExternalStore(session.subscribe, session.getPeers);

  const boardRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [cam, setCamState] = useState<Camera>({ x: window.innerWidth / 2, y: window.innerHeight / 2, z: 1 });
  const camRef = useRef(cam);
  const [tool, setTool] = useState('select');
  const [selectionRaw, setSelectionRaw] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleAppend, setTitleAppend] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** Beim Drehen: aktueller Winkel fürs Etikett, eingerastet, Rahmen der Mehrfachauswahl */
  const [rotating, setRotating] = useState<{ deg: number; snapped: boolean; box?: Rect } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [gestureKind, setGestureKind] = useState<string | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  /** Zoom-Menü an der Prozentanzeige (Einpassen, 50/100/200 %) */
  const [zoomMenu, setZoomMenu] = useState<{ x: number; y: number } | null>(null);
  const [framesOpen, setFramesOpen] = useState(false);
  const [present, setPresent] = useState<number | null>(null);
  const [modal, setModal] = useState<{ id: string; props?: unknown } | null>(null);
  const [sidebar, setSidebar] = useState<string | null>(null);
  const [mouseHover, setMouseHover] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);

  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, Point>());
  /** Zeigerart je aktivem Zeiger ('mouse' | 'pen' | 'touch') */
  const pointerTypes = useRef(new Map<number, string>());
  /** Stift liegt auf: Touch-Zeiger (Handballen) werden übergangen, bis sie wieder loslassen */
  const penDown = useRef(false);
  const ignored = useRef(new Set<number>());
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const lastPointer = useRef<Point | null>(null);
  /** letzte Zeigerstelle der laufenden Geste (Abschluss bei Fokusverlust) */
  const gesturePoint = useRef<Point | null>(null);
  const lastPointerType = useRef('mouse');
  const pasteCount = useRef(0);
  const cameraTouched = useRef(false);
  const editingRef = useRef(editingId);
  editingRef.current = editingId;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  /** zuletzt kopierte Objekte (falls die System-Zwischenablage nicht lesbar ist) */
  const internalClip = useRef<BoardObject[]>([]);
  const rightDown = useRef(false);
  const pressTimers = useRef<number[]>([]);
  const pressStart = useRef<Point | null>(null);
  const presentCam = useRef<Camera | null>(null);
  const frameCursor = useRef(-1);
  const uploadSeq = useRef(0);

  // Auswahl ohne gelöschte Objekte (z. B. nach Undo oder fremdem Löschen)
  const selection = useMemo(() => selectionRaw.filter((id) => snap.byId.has(id)), [selectionRaw, snap]);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const setSelection = useCallback((ids: string[]) => setSelectionRaw([...new Set(ids)]), []);

  // Editor-API: stabiles Objekt, dessen Methoden immer die aktuellen Funktionen dieses Renders aufrufen
  const impl = useRef<EditorApi>(null!);
  const api = useMemo(() => new Proxy({} as EditorApi, { get: (_t, k) => (impl.current as unknown as Record<PropertyKey, unknown>)[k] }), []);

  const anim = useRef(0);
  const applyCam = useCallback((c: Camera) => {
    camRef.current = c;
    setCamState(c);
  }, []);
  /** Kamera setzen; eine laufende Kamerafahrt endet dabei. */
  const setCam = useCallback(
    (next: Camera | ((c: Camera) => Camera)) => {
      cancelAnimationFrame(anim.current);
      applyCam(typeof next === 'function' ? next(camRef.current) : next);
    },
    [applyCam],
  );

  /** Kamera weich zu `to` fahren: Zoom logarithmisch, Bildmitte des Ziels linear. */
  const animateCam = (to: Camera, ms = 280) => {
    cancelAnimationFrame(anim.current);
    const from = camRef.current;
    const focus = screenToWorld(to, { x: size.w / 2, y: size.h / 2 });
    const s0 = { x: focus.x * from.z + from.x, y: focus.y * from.z + from.y };
    const s1 = { x: size.w / 2, y: size.h / 2 };
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      const z = from.z * Math.pow(to.z / from.z, e);
      const sx = s0.x + (s1.x - s0.x) * e;
      const sy = s0.y + (s1.y - s0.y) * e;
      applyCam(t >= 1 ? to : { z, x: sx - focus.x * z, y: sy - focus.y * z });
      if (t < 1) anim.current = requestAnimationFrame(step);
    };
    cameraTouched.current = true;
    anim.current = requestAnimationFrame(step);
  };

  if (handleRef) handleRef.current = { getCamera: () => camRef.current, setCamera: setCam, getSelection: () => selectionRef.current, api };

  // ---- Größe & erste Einpassung ---------------------------------------------
  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    let last = { w: el.clientWidth, h: el.clientHeight };
    const ro = new ResizeObserver(() => {
      const next = { w: el.clientWidth, h: el.clientHeight };
      if (next.w === last.w && next.h === last.h) return;
      // Fenstergröße ändern bzw. Handy drehen: die Bildmitte bleibt stehen, nicht die linke obere Ecke
      if (last.w > 0 && last.h > 0) {
        const c = camRef.current;
        applyCam({ ...c, x: c.x + (next.w - last.w) / 2, y: c.y + (next.h - last.h) / 2 });
      }
      last = next;
      setSize(next);
    });
    ro.observe(el);
    setSize(last);
    return () => ro.disconnect();
  }, []);

  const contentBounds = useCallback(() => {
    const s = snapRef.current;
    return unionRects(s.ordered.map((o) => boundsOf(o, s)).filter((r): r is Rect => !!r));
  }, []);

  const insets = (r?: Rect, maxZoom?: number) => {
    // Platz für die Leisten lassen – gemessen, inkl. Übersichtskarte (ui/chromeInsets); feste Werte nur ohne DOM
    const measured = chromeInsets(boardRef.current, r, maxZoom);
    if (measured) return measured;
    const mobile = (boardRef.current?.clientWidth ?? size.w) < 700;
    return mobile ? { top: 64, right: 14, bottom: 70, left: 64 } : { top: 88, right: 72, bottom: 72, left: 100 };
  };

  /** Kamera weich auf ein Weltrechteck einpassen. */
  const fitTo = (r: Rect, maxZoom = 2) => {
    const el = boardRef.current;
    if (el) animateCam(fitRect(r, el.clientWidth, el.clientHeight, insets(r, maxZoom), maxZoom));
  };

  const fit = useCallback(() => {
    const el = boardRef.current;
    const b = contentBounds();
    if (!el) return;
    if (!b) {
      setCam({ x: el.clientWidth / 2, y: el.clientHeight / 2, z: 1 });
      return;
    }
    setCam(fitRect(b, el.clientWidth, el.clientHeight, insets(b, 1), 1));
  }, [contentBounds, setCam]);

  const didFit = useRef(false);
  useLayoutEffect(() => {
    if (!ready || didFit.current || cameraTouched.current) return;
    didFit.current = true;
    const el = boardRef.current;
    const b = contentBounds();
    if (!el || !b || el.clientWidth >= 700) return fit();
    // Handy: beim ersten Öffnen nicht winzig (unter 35 %) – lieber den ersten Rahmen bzw. die Inhaltsmitte zeigen
    const all = fitRect(b, el.clientWidth, el.clientHeight, insets(b, 1), 1);
    if (all.z >= PHONE_MIN_START_ZOOM) return setCam(all);
    const first = framesInOrder(snapRef.current.ordered)[0];
    const target = first ? fitRect(first, el.clientWidth, el.clientHeight, insets(first, 1), 1) : all;
    if (target.z >= PHONE_MIN_START_ZOOM) return setCam(target);
    // passt auch der Rahmen nicht: senkrecht mittig, waagerecht am linken Rand beginnen (dort fängt man an zu lesen)
    const r = first ?? b;
    const ins = insets();
    const z = PHONE_MIN_START_ZOOM;
    const availW = el.clientWidth - 32;
    const x = r.w * z <= availW ? 16 + (availW - r.w * z) / 2 - r.x * z : 16 - r.x * z;
    setCam({ x, y: ins.top + (el.clientHeight - ins.top - ins.bottom) / 2 - (r.y + r.h / 2) * z, z });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fit]);

  // Während Pan/Zoom eigene Ebene (kein Neu-Rastern pro Frame), danach wieder scharf
  const worldRef = useRef<HTMLDivElement>(null);
  const movingTimer = useRef(0);
  const firstCam = useRef(true);
  useLayoutEffect(() => {
    if (firstCam.current) {
      firstCam.current = false;
      return;
    }
    const el = worldRef.current;
    if (!el) return;
    el.classList.add('is-moving');
    clearTimeout(movingTimer.current);
    movingTimer.current = window.setTimeout(() => el.classList.remove('is-moving'), 180);
  }, [cam]);

  // ---- Awareness & Ansagen --------------------------------------------------
  useEffect(() => session.setSelection(selection), [session, selection]);
  // laufende Uploads auch für die anderen (Platzhalter zeichnet das Modul collab, Awareness-Feld collab.uploads)
  useEffect(() => session.setLocalField('collab.uploads', uploads.length ? uploads.map((u) => ({ ...u.rect, color: u.color })) : null), [session, uploads]);
  const announced = useRef<string[]>([]);
  useEffect(() => {
    // Screenreader: Auswahl ansagen (nicht beim Start mit leerer Auswahl)
    if (!selection.length && !announced.current.length) return;
    if (selection.length === announced.current.length && selection.every((id, i) => id === announced.current[i])) return;
    announced.current = selection;
    announce(describeSelection(selection.map((id) => snapRef.current.byId.get(id)!).filter(Boolean)));
  }, [selection]);
  const cursorTimer = useRef(0);
  const sendCursor = (p: Point | null) => {
    const now = performance.now();
    if (p && now - cursorTimer.current < 40) return;
    cursorTimer.current = now;
    session.setCursor(p);
  };

  // ---- Schreib-Drosselung (1× pro Frame) --------------------------------------
  const pending = useRef<(() => void) | null>(null);
  const schedule = (fn: () => void) => {
    const had = pending.current;
    pending.current = fn;
    if (!had)
      requestAnimationFrame(() => {
        const f = pending.current;
        pending.current = null;
        f?.();
      });
  };
  const flush = () => {
    const f = pending.current;
    pending.current = null;
    f?.();
  };

  // ---- Raster-Index (Hit-Test, Auswahlrechteck) -------------------------------
  const index = useRef(new GridIndex<BoardObject>());
  const indexed = useRef<Snapshot | null>(null);
  const indexedSnap = (): Snapshot => {
    const s = snapRef.current;
    if (indexed.current !== s) {
      index.current.sync(s.byId, (o) => (isDependent(o) ? null : objRect(o)));
      indexed.current = s;
    }
    return s;
  };
  const byRank = (s: Snapshot, ids: Iterable<string>) =>
    [...ids]
      .map((id) => s.byId.get(id))
      .filter((o): o is BoardObject => !!o)
      .sort((a, b) => s.rank.get(a.id)! - s.rank.get(b.id)!);
  /** Oberstes Objekt am Weltpunkt (nur Kandidaten aus dem Raster-Index prüfen). */
  const hitAt = (p: Point, skip?: (o: BoardObject) => boolean) => {
    const s = indexedSnap();
    return hitTest(byRank(s, index.current.queryPoint(p)), p, skip);
  };

  // ---- Hilfen -------------------------------------------------------------
  const screenPoint = (e: { clientX: number; clientY: number }): Point => {
    const r = boardRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toWorld = (p: Point) => screenToWorld(camRef.current, p);
  const viewCenter = () => toWorld({ x: size.w / 2, y: size.h / 2 });
  /** Weltpunkt unter dem Mauszeiger, wenn er gerade über dem Board ist (dort wird eingefügt). */
  const pointerWorld = (): Point | null => {
    const p = lastPointer.current;
    return p && p.x >= 0 && p.y >= 0 && p.x <= size.w && p.y <= size.h ? toWorld(p) : null;
  };
  const toolEvent = (e: React.PointerEvent, sp: Point, wp: Point): ToolPointerEvent => ({
    world: wp,
    screen: sp,
    shift: e.shiftKey,
    alt: e.altKey,
    mod: e.ctrlKey || e.metaKey,
    pointerType: e.pointerType,
    target: e.target as HTMLElement,
  });

  const objectAt = (target: EventTarget | null): BoardObject | null => {
    const el = (target as HTMLElement | null)?.closest?.('[data-id]') as HTMLElement | null;
    if (!el || !boardRef.current?.contains(el)) return null;
    return snapRef.current.byId.get(el.dataset.id!) ?? null;
  };
  /** Rahmen (Container) nur über den Titel greifen – außer er ist schon ausgewählt. */
  const grabbable = (o: BoardObject | null, target: Element | null) =>
    o && typeDef(o).container && !target?.closest('[data-frame-title]') && !selectionRef.current.includes(o.id) ? null : o;

  const isContainer = (o: BoardObject) => !!typeDef(o).container;
  /** Zu bewegende Objekte: Auswahl (ohne gesperrte) + Inhalte ausgewählter Rahmen. */
  const movableSet = (ids: string[]): Map<string, BoardObject> => movableObjects(ids, snapRef.current, isContainer);

  /** Einrast-Ziele: sichtbare, nicht bewegte Objekte (ohne Verbinder/Stift) – einmal pro Geste. */
  const snapCandidates = (exclude: ReadonlySet<string>): Rect[] => {
    const view = expand(viewRect(camRef.current, size.w, size.h), 200 / camRef.current.z);
    const out: Rect[] = [];
    for (const o of snapRef.current.ordered) {
      if (exclude.has(o.id) || typeDef(o).snapTarget === false) continue;
      const r = objRect(o);
      if (intersects(r, view)) out.push(r);
    }
    return out;
  };

  /** Höhe gemessener Typen (Text) nach dem Rendern messen und im selben Undo-Schritt nachziehen. */
  const remeasure = (ids: Iterable<string>, endStep = true) => {
    const list = [...ids].filter((id) => {
      const o = store.get(id);
      return !!o && !!typeDef(o).measure;
    });
    if (!list.length) {
      if (endStep) store.stopCapturing();
      return;
    }
    requestAnimationFrame(() => {
      const patches: Record<string, Patch> = {};
      for (const id of list) {
        const o = store.get(id);
        const sel = o && typeDef(o).measure;
        const el = sel ? (boardRef.current?.querySelector(`[data-id="${CSS.escape(id)}"] ${sel}`) as HTMLElement | null) : null;
        if (!o || !el) continue;
        const h = Math.max(8, Math.ceil(el.offsetHeight));
        if (h !== o.h) patches[id] = { h };
      }
      store.updateMany(patches);
      if (endStep) store.stopCapturing();
    });
  };

  /** Typ-spezifische Anpassung (z. B. Textbreite bei autoWidth). */
  const adjust = (o: BoardObject, p: Patch): Patch => typeDef(o).adjustPatch?.(o, p) ?? p;
  /** Patch berührt Textmaße eines gemessenen Typs? */
  const affectsMeasure = (p: Patch) => 'fontSize' in p || 'bold' in p || 'italic' in p || 'text' in p || 'w' in p;

  const zoomToEdit = (o: BoardObject) => {
    const r = objRect(o);
    const c = camRef.current;
    if (r.w * c.z >= 160) return;
    const z = Math.min(MAX_ZOOM, (size.w * 0.7) / r.w, (size.h * 0.45) / r.h);
    const mid = center(r);
    // etwas über der Mitte, damit die Bildschirmtastatur das Objekt nicht verdeckt
    animateCam({ z, x: size.w / 2 - mid.x * z, y: size.h * 0.36 - mid.y * z });
  };

  const startEditing = (o: BoardObject) => {
    if (o.locked) return;
    const mode = typeDef(o).edit;
    if (!mode) return;
    setSelection([o.id]);
    setEditingId(o.id);
    if (mode === 'text' && (lastPointerType.current === 'touch' || size.w < 700)) zoomToEdit(o);
  };

  /** Objekt anlegen (eigener Undo-Schritt), optional auswählen bzw. gleich bearbeiten. */
  const create = (obj: NewObject, opts: { select?: boolean; edit?: boolean } = {}) => {
    store.stopCapturing();
    const id = store.create(obj);
    if (opts.edit) store.stopCapturing(); // Anlegen und Tippen sind getrennte Undo-Schritte
    if (opts.select || opts.edit) {
      setSelection([id]);
      setTool('select');
    }
    if (opts.edit) startEditing(store.get(id)!);
    return id;
  };

  /** Objekt vom Typ an `p` anlegen (Werkzeug-Klick, Doppelklick) und gleich bearbeiten. */
  const placeAt = (type: ObjectType, p: Point): string | null => {
    const def = typeDef(type);
    const obj: NewObject | null = def.create
      ? def.create(p, api)
      : def.defaultSize
        ? ({ type, x: Math.round(p.x - def.defaultSize.w / 2), y: Math.round(p.y - def.defaultSize.h / 2), ...def.defaultSize } as NewObject)
        : null;
    if (!obj) return null;
    return create(obj, def.edit ? { edit: true } : { select: true });
  };

  /**
   * Freier Platz für ein gleich großes Objekt neben `o` in Richtung `side`: liegt dort schon etwas,
   * eine Objektbreite (bzw. -höhe) weiter. Rahmen und andere Hintergrund-Objekte zählen nicht als belegt.
   */
  const freeSpot = (o: BoardObject, side: Side): Point => {
    const d = SIDE_DIR[side];
    const s = indexedSnap();
    for (let i = 1; i <= 50; i++) {
      const r = { x: o.x + d.x * i * (o.w + SIBLING_GAP), y: o.y + d.y * i * (o.h + SIBLING_GAP), w: o.w, h: o.h };
      // knapp innen prüfen: Berühren an der Kante ist kein Überdecken
      const inner = expand(r, -2);
      const taken = byRank(s, index.current.query(inner)).some((q) => q.id !== o.id && !isDependent(q) && !typeDef(q).container && hitRole(q) !== 'background' && intersects(objRect(q), inner));
      if (!taken) return { x: r.x, y: r.y };
    }
    return { x: o.x + d.x * (o.w + SIBLING_GAP), y: o.y + d.y * (o.h + SIBLING_GAP) };
  };

  /** Gleiches Objekt (ohne Text) daneben anlegen, optional mit Verbinder zwischen den zugewandten Seiten. */
  const createSibling = (o: BoardObject, side: Side, connect: boolean): string => {
    const at = freeSpot(o, side);
    store.stopCapturing();
    const nid = store.create({ ...siblingFields(o), ...at });
    if (connect) {
      const lookup = (id: string) => store.get(id);
      const r = normRect(endAnchor({ objectId: o.id }, lookup)!, endAnchor({ objectId: nid }, lookup)!);
      const from = { objectId: o.id, side };
      const to = { objectId: nid, side: OPPOSITE[side] };
      store.create({ type: 'connector', ...r, from, to, color: '#0a0a0a', strokeWidth: 2, arrowEnd: true, lineStyle: newLineStyle(from, to) });
    }
    store.stopCapturing();
    return nid;
  };

  /** Tab beim Schreiben: Bearbeitung beenden, gleich große Notiz daneben anlegen und gleich weiterschreiben. */
  const editNext = (back: boolean) => {
    const id = editingRef.current;
    const o = id ? store.get(id) : undefined;
    (document.activeElement as HTMLElement | null)?.blur();
    if (!o || !typeDef(o).addHandles) return;
    const nid = createSibling(o, back ? 'w' : 'e', false);
    startEditing(store.get(nid)!);
  };

  /** Druckbares Zeichen auf einem ausgewählten Objekt: Bearbeitung starten und Zeichen anhängen. */
  const typeInto = (o: BoardObject, ch: string) => {
    if (typeDef(o).edit === 'title') {
      setTitleAppend(ch);
      startEditing(o);
      return;
    }
    store.stopCapturing();
    const engine = textEngine();
    // die Text-Engine (Rich-Text) nur für ihre Typen; Klartext-Typen der Module (Karte, Mindmap …) bekommen `text`
    if (engine.typeInto && RICH_TEXT_TYPES.includes(o.type)) engine.typeInto(o, ch, api);
    else store.update(o.id, adjust(o, { text: (o.text ?? '') + ch }));
    startEditing(store.get(o.id)!);
  };

  const toggleFormat = (ids: string[], k: 'bold' | 'italic' | 'strike') => {
    const objs = ids.map((id) => store.get(id)).filter((o): o is BoardObject => !!o && !o.locked && !!typeDef(o).textual);
    if (!objs.length) return;
    const on = !objs.every((o) => o[k]);
    const patches: Record<string, Patch> = {};
    for (const o of objs) patches[o.id] = adjust(o, { [k]: on || undefined });
    store.stopCapturing();
    store.updateMany(patches);
    remeasure(Object.keys(patches));
  };

  // ---- Bearbeiten-Callbacks (stabil, da ObjectView memoisiert ist) --------------
  const editCb = useMemo<EditCallbacks>(
    () => ({
      onTextChange: (id, text) => {
        const o = store.get(id);
        if (!o) return;
        store.update(id, api.adjustPatch(o, { text }));
        if (typeDef(o).measure) api.remeasure([id], false);
      },
      onTitleChange: (id, title) => store.update(id, { title }),
      onEditDone: (id, el) => {
        setEditingId((cur) => (cur === id ? null : cur));
        setTitleAppend(null);
        const o = store.get(id);
        if (!o) return;
        typeDef(o).onEditDone?.(o, api, el);
        store.stopCapturing();
      },
      // andere Schrift-Metrik als beim Anlegen: Höhe ausgewählter Texte an die gerenderte angleichen
      onMeasured: (id) => {
        const o = store.get(id);
        if (o && !o.locked && selectionRef.current.includes(id) && !gesture.current) api.remeasure([id], false);
      },
    }),
    [store, api],
  );

  // ---- Zeiger ------------------------------------------------------------------
  const beginGesture = (g: Gesture) => {
    gesture.current = g;
    setGestureKind(g.kind === 'tool' ? (g.g.kind ?? 'tool') : g.kind);
  };
  const endGesture = () => {
    stopEdgePan();
    gesture.current = null;
    setGestureKind(null);
    setDraft(null);
    setRotating(null);
  };
  /** Esc während einer Geste: alles zurück auf den Stand davor, ohne Undo-Schritt. */
  const cancelGesture = () => {
    const g = gesture.current;
    pending.current = null;
    clearPress();
    if (g && (g.kind === 'move' || g.kind === 'resize' || g.kind === 'rotate' || g.kind === 'connEnd')) {
      store.revertTo(g.depth);
      if (g.kind === 'move') setSelection(g.prevSel);
    } else if (g?.kind === 'pan' || g?.kind === 'rpan' || g?.kind === 'pinch') setCam(g.cam);
    else if (g?.kind === 'tool') g.g.cancel?.();
    setHoverId(null);
    endGesture();
  };

  const clearPress = () => {
    pressTimers.current.forEach((t) => clearTimeout(t));
    pressTimers.current = [];
    pressStart.current = null;
  };

  /** Rechtsklick/langes Drücken: Menü öffnen; ein nicht ausgewähltes Objekt vorher auswählen. */
  const openMenu = (clientX: number, clientY: number) => {
    const real = document.elementFromPoint(clientX, clientY);
    const o = grabbable(objectAt(real), real);
    if (o && !selectionRef.current.includes(o.id)) setSelection(expandGroups([o.id], snapRef.current.ordered, snapRef.current.byId));
    if (!o && selectionRef.current.length) setSelection([]);
    const r = boardRef.current!.getBoundingClientRect();
    setMenu({ x: clientX - r.left, y: clientY - r.top, at: toWorld({ x: clientX - r.left, y: clientY - r.top }), on: o ? 'object' : 'canvas' });
  };

  /** Neue Geste 'move' für die aktuelle Auswahl beginnen. */
  const beginMove = (sel: string[], clickedId: string, wasSelected: boolean, wp: Point, sp: Point, copy: boolean, prevSel: string[]) => {
    const origin = movableSet(sel);
    const boxes = [...origin.values()].filter((o) => !isDependent(o)).map(objRect);
    store.stopCapturing();
    beginGesture({
      kind: 'move',
      start: wp,
      origin,
      moved: false,
      clickedId,
      wasSelected,
      screen: sp,
      depth: store.undoDepth(),
      others: snapCandidates(copy ? new Set() : new Set(origin.keys())),
      box: unionRects(boxes),
      copy,
      prevSel,
    });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (isEditableTarget(target)) return;
    // Fokus selbst steuern (mousedown wird unten verhindert): offene Eingaben schließen
    // Palm-Rejection: solange ein Stift aufliegt, zählen Finger bzw. Handballen nicht
    if (e.pointerType === 'touch' && penDown.current) {
      ignored.current.add(e.pointerId);
      return;
    }
    if (e.pointerType === 'pen') {
      penDown.current = true;
      // schon aufliegender Handballen: seine Geste (Schwenken, Pinch) zurücknehmen und ihn ab jetzt übergehen
      const touches = [...pointerTypes.current].filter(([, t]) => t === 'touch').map(([id]) => id);
      if (touches.length) {
        if (gesture.current && gesture.current.kind !== 'tool') cancelGesture();
        for (const id of touches) {
          pointers.current.delete(id);
          pointerTypes.current.delete(id);
          ignored.current.add(id);
        }
      }
    }
    if (isEditableTarget(document.activeElement)) (document.activeElement as HTMLElement).blur();
    cancelAnimationFrame(anim.current);
    lastPointerType.current = e.pointerType;
    const sp = screenPoint(e);
    pointers.current.set(e.pointerId, sp);
    pointerTypes.current.set(e.pointerId, e.pointerType);
    gesturePoint.current = sp;
    try {
      boardRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* Zeiger schon weg (z. B. sehr kurzer Touch) */
    }

    // Zwei Finger: Pinch-Zoom + Pan (eine laufende Werkzeug-Geste wird verworfen)
    if (pointers.current.size === 2) {
      clearPress();
      flush();
      const cur = gesture.current;
      if (cur?.kind === 'tool') cur.g.cancel?.();
      const [a, b] = [...pointers.current.values()];
      setDraft(null);
      beginGesture({ kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam: camRef.current });
      return;
    }
    if (pointers.current.size > 2) return;

    // Rechte Taste: ziehen verschiebt die Ansicht, kurzer Klick öffnet das Menü
    if (e.button === 2) {
      rightDown.current = true;
      beginGesture({ kind: 'rpan', start: sp, cam: camRef.current, moved: false });
      return;
    }
    rightDown.current = false;

    const wp = toWorld(sp);
    // Präsentation am Handy/Tablet: Wischen bzw. Tippen blättert durch die Rahmen
    if (present !== null && e.pointerType !== 'mouse') {
      beginGesture({ kind: 'swipe', start: sp });
      return;
    }
    if (e.button === 1 || tool === 'hand' || spaceDown || present !== null) {
      e.preventDefault();
      beginGesture({ kind: 'pan', start: sp, cam: camRef.current });
      return;
    }

    // Touch: langes Drücken öffnet das Menü
    if (e.pointerType === 'touch' && tool === 'select') {
      clearPress();
      pressStart.current = sp;
      const cx = e.clientX;
      const cy = e.clientY;
      pressTimers.current.push(
        window.setTimeout(() => {
          // nach 300 ms Halten darf ein nicht ausgewähltes Objekt verschoben werden
          const g = gesture.current;
          if (g?.kind !== 'pan' || !g.hold || !pressStart.current) return;
          const sel = expandGroups([g.hold], snapRef.current.ordered, snapRef.current.byId);
          const prev = selectionRef.current;
          setSelection(sel);
          navigator.vibrate?.(8);
          beginMove(sel, g.hold, false, toWorld(pressStart.current), pressStart.current, false, prev);
        }, 300),
        window.setTimeout(() => {
          const g = gesture.current;
          if (!pressStart.current || (g?.kind === 'move' && g.moved)) return;
          gesture.current = null;
          setGestureKind(null);
          clearPress();
          openMenu(cx, cy);
        }, 500),
      );
    }

    if (tool !== 'select') {
      const g = tools.get(tool)?.down?.(toolEvent(e, sp, wp), api);
      if (g) beginGesture({ kind: 'tool', g });
      return;
    }

    const handle = target.closest('[data-handle]') as HTMLElement | null;
    if (handle) {
      const h = handle.dataset.handle!;
      const sel = selectionRef.current;
      if (h === 'from' || h === 'to') {
        store.stopCapturing();
        beginGesture({ kind: 'connEnd', id: sel[0], which: h, depth: store.undoDepth() });
        return;
      }
      if (h.startsWith('anchor-')) {
        const o = hoverId ? snapRef.current.byId.get(hoverId) : null;
        if (!o) return;
        beginGesture({ kind: 'tool', g: connectorGesture(api, { objectId: o.id, side: h.slice(7) as Side }, o.id, center(baseRect(o)), sp) });
        return;
      }
      if (h.startsWith('add-')) {
        beginGesture({ kind: 'add', id: sel[0], side: h.slice(4) as Side, screen: sp });
        return;
      }
      if (h === 'rotate') {
        if (sel.length > 1) {
          // mehrere Objekte: um die Mitte des Auswahlrahmens
          const origin = new Map<string, BoardObject>();
          for (const id of sel) {
            const o = snapRef.current.byId.get(id);
            if (o) origin.set(id, o);
          }
          const box = selectionBounds(sel, snapRef.current);
          if (!box || !canRotateAll([...origin.values()], typeDef)) return;
          const c = center(box);
          store.stopCapturing();
          beginGesture({ kind: 'rotate', id: sel[0], c, a0: deg(wp, c), r0: 0, depth: store.undoDepth(), origin, box, snapped: true });
          setRotating({ deg: 0, snapped: true, box });
          return;
        }
        const o = snapRef.current.byId.get(sel[0]);
        if (!o) return;
        const c = center(baseRect(o));
        store.stopCapturing();
        const snapped = rotationOf(o) % 90 === 0;
        beginGesture({ kind: 'rotate', id: o.id, c, a0: deg(wp, c), r0: rotationOf(o), depth: store.undoDepth(), snapped });
        setRotating({ deg: rotationOf(o), snapped });
        return;
      }
      const origin = new Map<string, BoardObject>();
      for (const id of sel) {
        const o = snapRef.current.byId.get(id);
        if (o && !o.locked) origin.set(id, o);
      }
      const only = origin.size === 1 ? [...origin.values()][0] : null;
      const rot = only && sel.length === 1 ? rotationOf(only) : 0;
      // gedrehtes Einzelobjekt: im ungedrehten Rechteck rechnen (Achsen des Objekts)
      const box = rot ? baseRect(only!) : selectionBounds(sel, snapRef.current);
      if (!box) return;
      const onlyDef = only ? typeDef(only) : null;
      const corner = h.length === 2;
      store.stopCapturing();
      beginGesture({
        kind: 'resize',
        handle: h as Handle,
        start: wp,
        box,
        rot,
        origin,
        // Umschalt wird beim Ziehen laufend abgefragt (auch erst während der Geste gedrückt)
        keepAspect: origin.size > 1 || onlyDef?.keepAspect === true || (onlyDef?.keepAspect === 'corner' && corner),
        textWidthOnly: onlyDef?.sideResize === 'width' && !corner,
        depth: store.undoDepth(),
        others: snapCandidates(new Set(origin.keys())),
      });
      return;
    }
    // Rahmen: nur über den Titel greifen (oder wenn schon ausgewählt) – sonst Auswahlrechteck darin
    const hit = grabbable(objectAt(target), target);
    if (hit) {
      const s = snapRef.current;
      const prev = selectionRef.current;
      const wasSelected = prev.includes(hit.id);
      // Touch: nicht ausgewählte Objekte erst nach Halten verschieben, sonst Ansicht verschieben
      if (e.pointerType === 'touch' && !wasSelected) {
        beginGesture({ kind: 'pan', start: sp, cam: camRef.current, hold: hit.id });
        return;
      }
      // Klick auf ein Gruppenmitglied wählt die ganze Gruppe
      const unit = expandGroups([hit.id], s.ordered, s.byId);
      let sel = prev;
      if (e.shiftKey) {
        if (wasSelected) {
          setSelection(prev.filter((id) => !unit.includes(id)));
          return;
        }
        sel = [...prev, ...unit];
      } else if (!wasSelected) sel = unit;
      setSelection(sel);
      beginMove(sel, hit.id, wasSelected, wp, sp, e.altKey, prev);
      return;
    }
    if (e.pointerType === 'touch') {
      if (!e.shiftKey) setSelection([]);
      beginGesture({ kind: 'pan', start: sp, cam: camRef.current });
      return;
    }
    const base = e.shiftKey ? selectionRef.current : [];
    if (!e.shiftKey) setSelection([]);
    // Lasso: Werkzeug-Option „Lasso“ oder Strg/⌘ beim Ziehen (kehrt die Option jeweils um)
    const lasso = getToolOption('select', 'lasso', false) !== (e.ctrlKey || e.metaKey);
    beginGesture({ kind: 'marquee', start: wp, base, lasso: lasso ? [wp] : undefined });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (ignored.current.has(e.pointerId)) return;
    // Maustaste ist nicht mehr gedrückt (z. B. außerhalb des Fensters losgelassen): Geste sauber beenden
    if (e.pointerType === 'mouse' && e.buttons === 0 && gesture.current && pointers.current.has(e.pointerId)) {
      finishGesture();
      return;
    }
    const sp = screenPoint(e);
    lastPointer.current = sp;
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, sp);
      gesturePoint.current = sp;
    }
    if (pressStart.current && Math.hypot(sp.x - pressStart.current.x, sp.y - pressStart.current.y) > 8) clearPress();
    const wp = toWorld(sp);
    sendCursor(wp);
    const g = gesture.current;

    if (!g) {
      if (e.pointerType === 'touch') return;
      if (tools.get(tool)?.hoverTarget) setHoverId(hitAt(wp)?.id ?? null);
      else if (tool === 'select' && present === null) {
        // Andockpunkte bleiben stehen, solange der Zeiger auf ihnen oder nahe am Objekt ist
        if ((e.target as HTMLElement).closest?.('[data-handle^="anchor-"]')) return;
        let h: BoardObject | null = hitAt(wp, (o) => hitRole(o) === 'background');
        if (!h && hoverId) {
          const cur = snapRef.current.byId.get(hoverId);
          if (cur && pointInRect(wp, expand(objRect(cur), 22 / camRef.current.z))) h = cur;
        }
        setHoverId(h?.id ?? null);
        setMouseHover(true);
      }
      return;
    }
    switch (g.kind) {
      case 'pan':
        cameraTouched.current = true;
        setCam({ ...g.cam, x: g.cam.x + sp.x - g.start.x, y: g.cam.y + sp.y - g.start.y });
        return;
      case 'rpan':
        if (!g.moved && Math.hypot(sp.x - g.start.x, sp.y - g.start.y) <= 4) return;
        g.moved = true;
        setGestureKind('pan');
        cameraTouched.current = true;
        setCam({ ...g.cam, x: g.cam.x + sp.x - g.start.x, y: g.cam.y + sp.y - g.start.y });
        return;
      case 'pinch': {
        const pts = [...pointers.current.values()];
        if (pts.length < 2) return;
        const [a, b] = pts;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const z = zoomAt(g.cam, g.mid, (g.cam.z * dist) / Math.max(1, g.dist));
        cameraTouched.current = true;
        setCam({ ...z, x: z.x + mid.x - g.mid.x, y: z.y + mid.y - g.mid.y });
        return;
      }
      case 'marquee': {
        if (g.lasso) {
          const pts = g.lasso;
          const last = pts[pts.length - 1];
          if (Math.hypot(wp.x - last.x, wp.y - last.y) * camRef.current.z < 3) return;
          pts.push(wp);
          const z = camRef.current.z;
          setDraft({
            kind: 'world',
            node: (
              <path
                className="ov-lasso"
                data-testid="lasso"
                d={`M${pts.map((q) => `${q.x} ${q.y}`).join('L')}Z`}
                fill="rgba(23,99,181,0.08)"
                stroke="#1763b5"
                strokeWidth={1.5 / z}
                strokeDasharray={`${6 / z} ${4 / z}`}
                strokeLinejoin="round"
              />
            ),
          });
          if (pts.length < 3) return;
          const s = indexedSnap();
          const near = index.current.query(lassoBounds(pts));
          const hits: string[] = [];
          for (const o of s.ordered) {
            if (!near.has(o.id) && !isDependent(o)) continue;
            const b = boundsOf(o, s);
            if (b && rectInLasso(b, pts)) hits.push(o.id);
          }
          setSelection([...g.base, ...expandGroups(hits, s.ordered, s.byId)]);
          return;
        }
        const rect = normRect(g.start, wp);
        setDraft({ kind: 'marquee', rect });
        const s = indexedSnap();
        const near = index.current.query(rect);
        const hits: string[] = [];
        for (const o of s.ordered) {
          if (!near.has(o.id) && !isDependent(o)) continue;
          const b = boundsOf(o, s);
          if (b && (typeDef(o).marquee === 'contain' ? contains(rect, b) : intersects(rect, b))) hits.push(o.id);
        }
        setSelection([...g.base, ...expandGroups(hits, s.ordered, s.byId)]);
        return;
      }
      case 'move':
        if (!g.moved && Math.hypot(sp.x - g.screen.x, sp.y - g.screen.y) < 3) return;
        applyMove(g, sp, e.altKey, e.shiftKey);
        updateEdgePan(sp, e.altKey, e.shiftKey);
        return;
      case 'swipe':
        return;
      case 'resize': {
        let dx = wp.x - g.start.x;
        let dy = wp.y - g.start.y;
        const keep = g.keepAspect || e.shiftKey;
        if (g.rot) {
          // gedreht: Zug in die Achsen des Objekts umrechnen, die Gegenecke bleibt in der Welt stehen
          const nb = rotatedResize(g.box, g.handle, dx, dy, g.rot, keep, g.textWidthOnly);
          setDraft(null);
          schedule(() => {
            const patches: Record<string, Patch> = {};
            for (const [id, o] of g.origin) {
              const base: Patch = { x: Math.round(nb.x), y: Math.round(nb.y), w: Math.max(8, Math.round(nb.w)), h: Math.max(8, Math.round(nb.h)) };
              const resize = typeDef(o).resize;
              patches[id] = resize ? resize(o, base, { from: g.box, to: nb, rect: nb, widthOnly: g.textWidthOnly }) : base;
            }
            store.updateMany(patches);
          });
          return;
        }
        let nb = resizeRect(g.box, g.handle, dx, dy, keep, 12);
        let guides: Draft | null = null;
        if (!e.altKey) {
          const s = snapResize(nb, g.handle, g.others, SNAP_PX / camRef.current.z);
          if (s.dx || s.dy) {
            dx += s.dx;
            dy += s.dy;
            nb = resizeRect(g.box, g.handle, dx, dy, keep, 12);
          }
          const lines = guideLines(nb, g.others);
          if (lines.length) guides = { kind: 'guides', lines };
        }
        setDraft(guides);
        schedule(() => {
          const patches: Record<string, Patch> = {};
          for (const [id, o] of g.origin) {
            const r = g.textWidthOnly ? { x: nb.x, y: o.y, w: nb.w, h: o.h } : mapRect(o, g.box, nb);
            const base: Patch = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(8, Math.round(r.w)), h: Math.max(8, Math.round(r.h)) };
            const resize = typeDef(o).resize;
            patches[id] = resize ? resize(o, base, { from: g.box, to: nb, rect: r, widthOnly: g.textWidthOnly }) : base;
          }
          store.updateMany(patches);
        });
        return;
      }
      case 'rotate': {
        // magnetisch auf 0°/90°/180°/270°, Umschalt: 15°-Schritte (interaction/rotate.ts)
        const { deg: a, snapped } = snapAngle(g.r0 + deg(wp, g.c) - g.a0, e.shiftKey);
        // dezente Rückmeldung beim Einrasten: Etikett (Overlay), am Handy ein kurzes Vibrieren
        if (snapped && !g.snapped && e.pointerType === 'touch') navigator.vibrate?.(8);
        g.snapped = snapped;
        setRotating({ deg: a, snapped, box: g.box });
        const origin = g.origin;
        schedule(() => (origin ? store.updateMany(rotateMany(origin, g.c, a)) : store.update(g.id, { rotation: rotationField(a) })));
        return;
      }
      case 'connEnd': {
        const c = snapRef.current.byId.get(g.id);
        if (!c) return;
        const other = g.which === 'from' ? c.to : c.from;
        const otherId = isAttached(other) ? other.objectId : null;
        const target = hitAt(wp, (o) => o.id === otherId);
        setHoverId(target?.id ?? null);
        const end: ConnectorEnd = target ? { objectId: target.id } : { x: Math.round(wp.x), y: Math.round(wp.y) };
        schedule(() => store.update(g.id, { [g.which]: end }));
        return;
      }
      case 'add': {
        // Ziehen am Plus: Verbinder aus dieser Seite des Objekts ziehen
        if (Math.hypot(sp.x - g.screen.x, sp.y - g.screen.y) < 6) return;
        const o = snapRef.current.byId.get(g.id);
        if (!o) return;
        gesture.current = { kind: 'tool', g: connectorGesture(api, { objectId: o.id, side: g.side }, o.id, center(baseRect(o)), g.screen) };
        setGestureKind('connector');
        onPointerMove(e);
        return;
      }
      case 'tool':
        g.g.move?.(toolEvent(e, sp, wp));
        return;
    }
  };

  /** Verschieben an die Zeigerstelle `sp` (Bildschirm); Umschalt sperrt die Richtung, Alt schaltet das Einrasten aus. */
  const applyMove = (g: Extract<Gesture, { kind: 'move' }>, sp: Point, alt: boolean, shift: boolean) => {
    if (!g.moved && g.copy) startCopy(g);
    g.moved = true;
    const wp = toWorld(sp);
    let dx = wp.x - g.start.x;
    let dy = wp.y - g.start.y;
    // Umschalt: nur waagerecht bzw. senkrecht (die größere Richtung gewinnt)
    const lock = shift ? (Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y') : null;
    if (lock === 'x') dy = 0;
    if (lock === 'y') dx = 0;
    let guides: Draft | null = null;
    // Alt schaltet das Einrasten aus (außer beim Kopie-Ziehen, das schon mit Alt beginnt)
    if (g.box && !(alt && !g.copy)) {
      const s = snapMove({ ...g.box, x: g.box.x + dx, y: g.box.y + dy }, g.others, SNAP_PX / camRef.current.z);
      if (lock !== 'y') dx += s.dx;
      if (lock !== 'x') dy += s.dy;
      if (s.lines.length || s.gaps.length) guides = { kind: 'guides', lines: s.lines, gaps: s.gaps };
    }
    setDraft(guides);
    const rx = Math.round(dx);
    const ry = Math.round(dy);
    schedule(() => store.updateMany(movePatches(g.origin.values(), rx, ry)));
  };

  // ---- Auto-Schwenken: Objekt an den Bildrand ziehen schwenkt die Ansicht mit ---------------------------------
  const edgePan = useRef<{ raf: number; sp: Point; alt: boolean; shift: boolean } | null>(null);
  /** Schwenk-Geschwindigkeit (px je Bild) am Rand: wächst bis EDGE_SPEED, je näher bzw. weiter draußen der Zeiger ist. */
  const edgeVelocity = (sp: Point): Point => {
    const v = (d: number) => (d > 0 ? (Math.min(d, EDGE_PX) / EDGE_PX) * EDGE_SPEED : 0);
    return { x: v(EDGE_PX - sp.x) - v(sp.x - (size.w - EDGE_PX)), y: v(EDGE_PX - sp.y) - v(sp.y - (size.h - EDGE_PX)) };
  };
  const stopEdgePan = () => {
    if (edgePan.current) cancelAnimationFrame(edgePan.current.raf);
    edgePan.current = null;
  };
  const updateEdgePan = (sp: Point, alt: boolean, shift: boolean) => {
    const v = edgeVelocity(sp);
    if (!v.x && !v.y) return stopEdgePan();
    if (edgePan.current) {
      Object.assign(edgePan.current, { sp, alt, shift });
      return;
    }
    const st = { raf: 0, sp, alt, shift };
    edgePan.current = st;
    const step = () => {
      const g = gesture.current;
      if (edgePan.current !== st || g?.kind !== 'move') return;
      const d = edgeVelocity(st.sp);
      if (!d.x && !d.y) return stopEdgePan();
      cameraTouched.current = true;
      setCam((c) => ({ ...c, x: c.x + d.x, y: c.y + d.y }));
      applyMove(g, st.sp, st.alt, st.shift);
      st.raf = requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
  };

  /** Alt+Ziehen: zuerst Kopien an Ort und Stelle anlegen, dann diese bewegen. */
  const startCopy = (g: Extract<Gesture, { kind: 'move' }>) => {
    const lookup = (id: string) => snapRef.current.byId.get(id);
    const idMap = new Map<string, string>();
    const clones = cloneObjects(withAttachedConnectors([...g.origin.values()]), 0, 0, lookup, idMap);
    const ids = store.createMany(clones);
    g.origin = new Map(ids.map((id) => [id, store.get(id)!] as const).filter(([, o]) => !!o));
    setSelection(selectionRef.current.map((id) => idMap.get(id)).filter((id): id is string => !!id));
  };

  /** Zeiger loslassen: aus den Listen nehmen; false = Zeiger wurde übergangen (Handballen) bzw. ist schon weg. */
  const releasePointer = (e: { pointerId: number; pointerType: string }) => {
    if (e.pointerType === 'pen') penDown.current = false;
    pointerTypes.current.delete(e.pointerId);
    if (ignored.current.delete(e.pointerId)) return false;
    return pointers.current.delete(e.pointerId);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!releasePointer(e)) return;
    completeGesture(e);
  };

  /**
   * Fokusverlust (Alt+Tab), Seite verborgen oder Maustaste außerhalb losgelassen: die laufende Geste wie beim
   * Loslassen an der letzten Zeigerstelle abschließen, damit nichts am Zeiger kleben bleibt.
   */
  const finishGesture = () => {
    const g = gesture.current;
    if (g?.kind === 'rpan') g.moved = true; // kein Menü
    if (g?.kind === 'add' || g?.kind === 'pinch' || g?.kind === 'swipe') endGesture();
    else if (g) {
      const p = gesturePoint.current ?? { x: 0, y: 0 };
      const r = boardRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const up = { pointerId: -1, pointerType: lastPointerType.current, clientX: p.x + r.left, clientY: p.y + r.top, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, target: boardRef.current };
      completeGesture(up as unknown as React.PointerEvent<HTMLDivElement>);
    }
    clearPress();
    stopEdgePan();
    pointers.current.clear();
    pointerTypes.current.clear();
    ignored.current.clear();
    penDown.current = false;
  };

  const completeGesture = (e: React.PointerEvent<HTMLDivElement>) => {
    clearPress();
    stopEdgePan();
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch') {
      // restlichen Finger nicht als neue Geste interpretieren
      if (pointers.current.size === 0) endGesture();
      return;
    }
    const sp = screenPoint(e);
    const wp = toWorld(sp);
    flush();
    switch (g.kind) {
      case 'swipe': {
        const dx = sp.x - g.start.x;
        const dy = sp.y - g.start.y;
        const at = present ?? 0;
        if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) goFrame(at + (dx < 0 ? 1 : -1), true);
        else if (Math.hypot(dx, dy) < 10 && sp.x > (size.w * 2) / 3) goFrame(at + 1, true);
        else if (Math.hypot(dx, dy) < 10 && sp.x < size.w / 3) goFrame(at - 1, true);
        break;
      }
      case 'pan':
        // Touch-Tipp auf ein Objekt wählt es aus
        if (g.hold && Math.hypot(sp.x - g.start.x, sp.y - g.start.y) < 8) setSelection(expandGroups([g.hold], snapRef.current.ordered, snapRef.current.byId));
        break;
      case 'rpan':
        if (!g.moved) {
          endGesture();
          openMenu(e.clientX, e.clientY);
          return;
        }
        break;
      case 'move':
        if (g.moved) {
          // Typ-Haken nach dem Ablegen (ObjectTypeDef.afterMove), im selben Rückgängig-Schritt wie die Bewegung
          const moved = [...g.origin.keys()].map((id) => store.get(id)).filter((o): o is BoardObject => !!o);
          for (const def of new Set(moved.map(typeDef))) def.afterMove?.(moved, api, g.clickedId);
        }
        store.stopCapturing();
        if (!g.moved && g.wasSelected && !e.shiftKey && selectionRef.current.length > 1) {
          // Klick in eine Mehrfachauswahl: nur das Objekt (bzw. seine Gruppe) behalten
          const s = snapRef.current;
          const unit = expandGroups([g.clickedId], s.ordered, s.byId);
          if (!isWholeGroup(selectionRef.current, s.ordered, s.byId)) setSelection(unit);
        }
        break;
      case 'resize':
        store.stopCapturing();
        // z. B. Text: Breite (autoWidth) neu bestimmen, danach die Höhe messen
        for (const id of g.origin.keys()) {
          const now = store.get(id);
          if (now) typeDef(now).afterResize?.(now, api);
        }
        remeasure(g.origin.keys());
        break;
      case 'rotate':
      case 'connEnd':
        store.stopCapturing();
        setHoverId(null);
        break;
      case 'add': {
        const o = store.get(g.id);
        if (o) {
          const nid = createSibling(o, g.side, true);
          endGesture();
          startEditing(store.get(nid)!);
          return;
        }
        break;
      }
      case 'tool':
        g.g.up?.(toolEvent(e, sp, wp));
        break;
    }
    endGesture();
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!releasePointer(e)) return;
    clearPress();
    flush();
    store.stopCapturing();
    const g = gesture.current;
    if (g?.kind === 'tool') g.g.cancel?.();
    endGesture();
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool !== 'select' || isEditableTarget(e.target) || present !== null) return;
    // Zeiger-Capture lenkt das Ereignis aufs Board um – echtes Ziel über die Koordinaten holen
    const real = document.elementFromPoint(e.clientX, e.clientY);
    if (isEditableTarget(real) || real?.closest('[data-handle]')) return;
    const o = objectAt(real);
    if (o && typeDef(o).container) {
      if (real?.closest('[data-frame-title]')) startEditing(o);
      return;
    }
    // Doppelklick in eine ausgewählte Gruppe wählt das einzelne Objekt
    if (o?.groupId && selectionRef.current.length > 1 && selectionRef.current.includes(o.id)) {
      setSelection([o.id]);
      return;
    }
    if (o) startEditing(o);
    else placeAt('sticky', toWorld(screenPoint(e)));
  };

  // ---- Rad & Trackpad -------------------------------------------------------------
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  const wheelKind = useRef(createWheelClassifier());
  const wheelNotches = useRef(createNotchCounter());
  wheelRef.current = (e: WheelEvent) => {
    e.preventDefault();
    cancelAnimationFrame(anim.current);
    cameraTouched.current = true;
    const sp = screenPoint(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const mouse = wheelKind.current(e, window.devicePixelRatio || 1) === 'mouse';
    if (e.ctrlKey || e.metaKey) {
      // Strg+Rad (Maus: je Raste gleich weit, unabhängig von Browser-Zoom und Pixeldichte), Trackpad-Pinch stufenlos
      const d = mouse ? wheelNotches.current(e) * 100 : e.deltaY * unit;
      const factor = Math.exp(clamp(-d * 0.0035, -0.35, 0.35));
      setCam((c) => zoomAt(c, sp, c.z * factor));
    } else if (mouse && !e.shiftKey && getWheelMode() === 'zoom') {
      // Mausrad zoomt (etwa 13 % je Raste, höchstens 3 Rasten je Ereignis); Umschalt+Rad schwenkt seitlich
      const n = clamp(wheelNotches.current(e), -3, 3);
      const factor = Math.exp(-n * WHEEL_STEP);
      setCam((c) => zoomAt(c, sp, c.z * factor));
    } else {
      const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit;
      const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * unit;
      setCam((c) => ({ ...c, x: c.x - dx, y: c.y - dy }));
    }
  };
  useEffect(() => {
    const el = boardRef.current!;
    const h = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener('wheel', h, { passive: false });
    // kein Seiten-Zoom per Geste, auch nicht über Leisten und Dialogen (Safari-Gesten inklusive)
    const unlock = lockPageZoom();
    return () => {
      el.removeEventListener('wheel', h);
      unlock();
    };
  }, []);

  // ---- Zoom-Steuerung ---------------------------------------------------------------
  const zoomStep = (dir: 1 | -1) => {
    cameraTouched.current = true;
    setCam((c) => zoomAt(c, { x: size.w / 2, y: size.h / 2 }, nextZoomStep(c.z, dir)));
  };
  /** Zoom auf eine feste Stufe, Bildmitte bleibt. */
  const zoomTo = (z: number) => {
    cameraTouched.current = true;
    setCam((c) => zoomAt(c, { x: size.w / 2, y: size.h / 2 }, z));
  };
  const zoomReset = () => zoomTo(1);
  const centerOn = (p: Point) => setCam((c) => ({ ...c, x: size.w / 2 - p.x * c.z, y: size.h / 2 - p.y * c.z }));
  const zoomToSelection = () => {
    const b = selectionBounds(selectionRef.current, snapRef.current);
    if (b) fitTo(b, 2);
  };

  // ---- Rahmen & Präsentation ------------------------------------------------------
  const frames = useMemo(() => framesInOrder(snap.ordered), [snap]);
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const goFrame = (i: number, presenting: boolean) => {
    const list = framesRef.current;
    if (!list.length) return;
    const idx = clamp(i, 0, list.length - 1);
    frameCursor.current = idx;
    const f = list[idx];
    const el = boardRef.current!;
    if (presenting) {
      setPresent(idx);
      cameraTouched.current = true;
      animateCam(fitRect(objRect(f), el.clientWidth, el.clientHeight, { top: 40, right: 24, bottom: 84, left: 24 }, MAX_ZOOM));
    } else fitTo(objRect(f), 2);
  };
  const startPresent = (i: number) => {
    presentCam.current = camRef.current;
    setFramesOpen(false);
    setSelection([]);
    setEditingId(null);
    setTool('select');
    goFrame(i, true);
  };
  const stopPresent = () => {
    setPresent(null);
    if (presentCam.current) animateCam(presentCam.current);
    presentCam.current = null;
  };

  // ---- Aktionen -----------------------------------------------------------------
  const selectedObjects = () => selectionRef.current.map((id) => snapRef.current.byId.get(id)).filter((o): o is BoardObject => !!o);

  const deleteSelection = () => {
    const ids = selectedObjects()
      .filter((o) => !o.locked)
      .map((o) => o.id);
    if (!ids.length) return;
    store.stopCapturing();
    store.remove(ids);
    store.stopCapturing();
    setSelection([]);
  };

  /** Objekte einfügen: an `at` (bzw. am Mauszeiger) zentriert, sonst versetzt bzw. in der Bildmitte. */
  const pasteObjects = (objs: BoardObject[], offset?: Point, at?: Point | null) => {
    if (!objs.length) return;
    const lookup = (id: string) => snapRef.current.byId.get(id);
    let d = offset;
    if (!d) {
      const b = unionRects(objs.map(objRect))!;
      const target = at ?? pointerWorld();
      if (target) d = { x: Math.round(target.x - (b.x + b.w / 2)), y: Math.round(target.y - (b.y + b.h / 2)) };
      else {
        const view = viewRect(camRef.current, size.w, size.h);
        if (intersects(b, view)) {
          pasteCount.current++;
          d = { x: 24 * pasteCount.current, y: 24 * pasteCount.current };
        } else {
          const c = viewCenter();
          d = { x: Math.round(c.x - (b.x + b.w / 2)), y: Math.round(c.y - (b.y + b.h / 2)) };
        }
      }
    }
    const idMap = new Map<string, string>();
    const clones = cloneObjects(objs, d.x, d.y, lookup, idMap);
    store.stopCapturing();
    const ids = store.createMany(clones);
    store.stopCapturing();
    // ausgewählt werden die eingefügten Objekte (Verbinder zwischen ihnen nur, wenn sie mitkopiert waren)
    setSelection(ids);
  };

  const pasteText = (text: string, at?: Point | null) => {
    const c = at ?? pointerWorld() ?? viewCenter();
    const sticky = typeDef('sticky').create!(c, api);
    store.stopCapturing();
    const id = store.create({ ...sticky, text: text.slice(0, 2000) });
    store.stopCapturing();
    setSelection([id]);
  };

  /** Einfügen aus dem Menü: System-Zwischenablage lesen, sonst das zuletzt Kopierte. */
  const pasteFromMenu = async (at: Point) => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const img = it.types.find((t) => /^image\/(png|jpe?g|webp|gif)$/.test(t));
        if (img) {
          const blob = await it.getType(img);
          void addImages([new File([blob], 'bild', { type: img })], at);
          return;
        }
        const html = it.types.includes('text/html') ? await (await it.getType('text/html')).text() : '';
        const text = it.types.includes('text/plain') ? await (await it.getType('text/plain')).text() : '';
        const objs = parseClipboard(html, text);
        if (objs) return pasteObjects(objs, undefined, at);
        if (text.trim()) return pasteText(text, at);
      }
    } catch {
      /* kein Zugriff auf die Zwischenablage */
    }
    if (internalClip.current.length) pasteObjects(internalClip.current, undefined, at);
    else onToast(byPointer('Zum Einfügen Strg V drücken.', 'Nichts zum Einfügen. Erst etwas kopieren.'));
  };

  const duplicate = () => {
    const objs = withAttachedConnectors(selectedObjects());
    pasteObjects(objs, { x: 24, y: 24 });
  };

  /** Verbinder zwischen zwei ausgewählten Objekten gehören beim Kopieren dazu. */
  const withAttachedConnectors = (objs: BoardObject[]) => {
    const ids = new Set(objs.map((o) => o.id));
    const extra = snapRef.current.ordered.filter(
      (c) => c.type === 'connector' && !ids.has(c.id) && isAttached(c.from) && isAttached(c.to) && ids.has(c.from.objectId) && ids.has(c.to.objectId),
    );
    return [...objs, ...extra];
  };

  const copySelection = () => {
    const objs = withAttachedConnectors(selectedObjects());
    if (!objs.length) return;
    internalClip.current = objs;
    // löst das copy-Ereignis aus (schreibt Text + HTML), funktioniert im Klick-Handler ohne Rückfrage
    if (!document.execCommand('copy')) void navigator.clipboard?.writeText(plainText(objs)).catch(() => {});
  };

  const patchSelection = (fn: (o: BoardObject) => Patch | null) => {
    const patches: Record<string, Patch> = {};
    for (const o of selectedObjects()) {
      if (o.locked) continue;
      const p = fn(o);
      if (p) patches[o.id] = adjust(o, p);
    }
    store.stopCapturing();
    store.updateMany(patches);
    // gemessene Typen (Text): Höhe nach dem Rendern messen – im selben Undo-Schritt
    remeasure(Object.keys(patches).filter((id) => affectsMeasure(patches[id])));
  };

  const toggleLock = () => {
    const objs = selectedObjects();
    const lock = !objs.every((o) => o.locked);
    store.stopCapturing();
    store.updateMany(Object.fromEntries(objs.map((o) => [o.id, { locked: lock ? true : undefined }])));
    store.stopCapturing();
  };

  const groupSelection = () => {
    const p = groupPatches(selectedObjects());
    if (!p) return;
    store.stopCapturing();
    store.updateMany(p);
    store.stopCapturing();
  };
  const ungroupSelection = () => {
    const p = ungroupPatches(selectedObjects());
    if (!p) return;
    store.stopCapturing();
    store.updateMany(p);
    store.stopCapturing();
  };

  /** Einheiten fürs Ausrichten: Gruppen zusammen, sonst einzelne Objekte (ohne Verbinder/gesperrte). */
  // React-frei in board/ops/arrange.ts (auch für die Web-Aktion `core.align` der App)
  const arrangeUnits = (): Map<string, BoardObject[]> => arrangeUnitsOf(selectedObjects());
  const applyArrange = (fn: (units: Unit[]) => Offsets) => {
    const patches = arrangePatches(selectedObjects(), snapRef.current, fn, isContainer);
    if (!Object.keys(patches).length) return;
    store.stopCapturing();
    store.updateMany(patches);
    store.stopCapturing();
  };

  /** Bilder hochladen: Platzhalter in Bildgröße an der Zielstelle, danach das Bild mit Durchschnittsfarbe. */
  const addImages = async (files: File[], at?: Point | null) => {
    // weitere Dateiarten (z. B. PDF) an ihr Feature-Modul geben (defineFileHandler)
    for (const h of fileHandlers.list()) {
      const mine = files.filter(h.match);
      if (!mine.length) continue;
      files = files.filter((f) => !mine.includes(f));
      void h.add(mine, api, at);
      if (!files.length) return;
    }
    const allowed = files.filter((f) => /^image\/(png|jpe?g|webp|gif)$/.test(f.type));
    if (!allowed.length) {
      if (files.length) onToast(`Nur PNG, JPEG, WebP und GIF${fileHandlers.get('documents.pdf') ? ' sowie PDF' : ''} können eingefügt werden.`);
      return;
    }
    const c = at ?? pointerWorld() ?? viewCenter();
    const ids: string[] = [];
    let offset = 0;
    for (const f of allowed) {
      if (f.size > MAX_IMAGE_BYTES) {
        onToast(`„${f.name}" ist größer als 15 MB.`);
        continue;
      }
      const key = `upload-${++uploadSeq.current}`;
      const info = await imageInfo(f);
      const ph = imageSize(info?.width ?? 400, info?.height ?? 300);
      setUploads((u) => [...u, { key, rect: { x: Math.round(c.x - ph.w / 2 + offset), y: Math.round(c.y - ph.h / 2 + offset), ...ph }, color: info?.color ?? null }]);
      try {
        const img = await session.uploadImage(f);
        const { w, h } = imageSize(img.width, img.height);
        store.stopCapturing();
        ids.push(store.create({ type: 'image', x: Math.round(c.x - w / 2 + offset), y: Math.round(c.y - h / 2 + offset), w, h, imageId: img.imageId, color: info?.color ?? undefined }));
        offset += 32;
      } catch (err) {
        onToast(err instanceof Error ? err.message : 'Das Bild konnte nicht hochgeladen werden.');
      } finally {
        setUploads((u) => u.filter((x) => x.key !== key));
      }
    }
    if (ids.length) setSelection(ids);
  };

  /** Tastatur: nächstes bzw. voriges Objekt auswählen und ins Bild holen (Tab bei fokussiertem Board). */
  const focusStep = (back: boolean): boolean => {
    const list = snapRef.current.ordered;
    if (!list.length) return false;
    const cur = selectionRef.current.length ? (snapRef.current.rank.get(selectionRef.current[selectionRef.current.length - 1]) ?? -1) : -1;
    const next = back ? (cur < 0 ? list.length - 1 : cur - 1) : cur + 1;
    if (next < 0 || next >= list.length) return false; // am Ende: Fokus verlässt das Board
    const o = list[next];
    setSelection([o.id]);
    const r = boundsOf(o, snapRef.current);
    if (r) {
      const s = rectToScreen(camRef.current, r);
      if (s.x < 0 || s.y < 0 || s.x + s.w > size.w || s.y + s.h > size.h) centerOn(center(r));
    }
    return true;
  };

  // ---- Editor-API -----------------------------------------------------------------
  impl.current = {
    store,
    session,
    snapshot: () => snapRef.current,
    selection: () => selectionRef.current,
    selected: selectedObjects,
    tool: () => toolRef.current,
    editingId: () => editingRef.current,
    camera: () => camRef.current,
    viewSize: () => size,
    pointerType: () => lastPointerType.current,
    presenting: () => present !== null,
    startPresent: (i) => startPresent(i),
    stopPresent: () => stopPresent(),
    toWorld,
    toScreen: (p) => worldToScreen(camRef.current, p),
    pointerWorld,
    viewCenter,
    hitTest: hitAt,
    queryRect: (r) => {
      const s = indexedSnap();
      const near = index.current.query(r);
      return s.ordered.filter((o) => {
        if (!near.has(o.id) && !isDependent(o)) return false;
        const b = boundsOf(o, s);
        return !!b && intersects(b, r);
      });
    },
    bounds: (o) => boundsOf(o, snapRef.current),
    setSelection,
    setTool: (id) => {
      setTool(id);
      if (id !== 'select' && id !== 'hand') setSelection([]);
    },
    startEditing,
    editNext,
    create,
    placeAt,
    patchSelection,
    adjustPatch: adjust,
    remeasure,
    toggleFormat,
    deleteSelection,
    duplicate,
    copySelection,
    pasteAt: pasteFromMenu,
    insertObjects: (objs, at) => pasteObjects(objs, undefined, at ?? null),
    toggleLock,
    group: groupSelection,
    ungroup: ungroupSelection,
    bringToFront: () => store.bringToFront(selectionRef.current),
    sendToBack: () => store.sendToBack(selectionRef.current),
    arrangeUnits,
    applyArrange,
    pickImages: () => fileRef.current?.click(),
    addImages,
    setCamera: (c) => {
      cameraTouched.current = true;
      setCam(c);
    },
    animateCamera: animateCam,
    fitTo,
    fitAll: fit,
    zoomStep,
    zoomReset,
    zoomToSelection,
    centerOn: (p) => {
      cameraTouched.current = true;
      centerOn(p);
    },
    setDraft,
    setHover: setHoverId,
    toast: onToast,
    openModal: (id, props) => setModal({ id, props }),
    closeModal: () => setModal(null),
    openSidebar: setSidebar,
    sidebar: () => sidebar,
  };

  // ---- Tastatur & Zwischenablage --------------------------------------------------
  /** Bis wann druckbare Tasten nichts auslösen (nach dem Löschen des gerade bearbeiteten Objekts durch andere). */
  const keysBlockedUntil = useRef(0);

  /** Eingabefeld der laufenden Bearbeitung fokussieren, Schreibmarke ans Ende; false = keins da. */
  const focusEditing = (): boolean => {
    const ed = boardRef.current?.querySelector<HTMLElement>('.editing, .ov-frame-title--edit');
    const el = ed && (isEditableTarget(ed) ? ed : ed.querySelector<HTMLElement>('[contenteditable="true"], textarea, input'));
    if (!el) return false;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
      return true;
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
    el.focus({ preventScroll: true });
    return true;
  };

  // Wer hatte welches Objekt zuletzt ausgewählt? (Name für den Hinweis, wenn jemand das bearbeitete Objekt löscht)
  const lastPicker = useRef(new Map<string, { name: string; t: number }>());
  useEffect(() => {
    const now = performance.now();
    for (const [id, v] of lastPicker.current) if (now - v.t > 15000) lastPicker.current.delete(id);
    for (const p of peers) for (const id of p.selection) lastPicker.current.set(id, { name: p.user.name, t: now });
  }, [peers]);

  // Jemand anderes löscht das Objekt, das ich gerade bearbeite: Bearbeitung sauber beenden, Hinweis zeigen und
  // die nächsten Tasten kurz schlucken (sonst schalten die weiter getippten Buchstaben Werkzeuge um)
  useEffect(() => {
    const objs = store.objects;
    const onChange = (ev: { transaction: { local: boolean }; changes: { keys: Map<string, { action: string }> } }) => {
      const id = editingRef.current;
      if (ev.transaction.local || !id || ev.changes.keys.get(id)?.action !== 'delete') return;
      keysBlockedUntil.current = performance.now() + 1000;
      setEditingId(null);
      setTitleAppend(null);
      boardRef.current?.focus({ preventScroll: true });
      const by = lastPicker.current.get(id)?.name;
      onToast(by ? `Von ${by} gelöscht` : 'Von jemand anderem gelöscht');
    };
    objs.observe(onChange);
    return () => objs.unobserve(onChange);
  }, [store, onToast]);

  /** Kürzel aus dem Register ausführen; true = behandelt. */
  const runShortcuts = (e: KeyboardEvent, phase: 'editing' | 'board' | 'late'): boolean => {
    for (const { def, spec } of shortcutSpecs()) {
      const scope = def.scope ?? 'board';
      if (phase === 'editing' ? scope === 'board' : scope === 'editing') continue;
      if (phase !== 'editing' && !!def.late !== (phase === 'late')) continue;
      if (!matchKey(spec, e)) continue;
      if (def.run!(api, e) === false) continue;
      e.preventDefault();
      if (phase === 'editing') e.stopPropagation();
      return true;
    }
    return false;
  };

  const keyRef = useRef<{
    down: (e: KeyboardEvent) => void;
    edit: (e: KeyboardEvent) => void;
    up: (e: KeyboardEvent) => void;
    copy: (e: ClipboardEvent) => void;
    cut: (e: ClipboardEvent) => void;
    paste: (e: ClipboardEvent) => void;
    /** Fenster verliert den Fokus bzw. wird verborgen: laufende Geste abschließen */
    lost: () => void;
  }>(null!);
  keyRef.current = {
    lost: () => {
      if (gesture.current || pointers.current.size) finishGesture();
    },
    // Tasten während der Textbearbeitung (vor dem Editierfeld, Capture-Phase)
    edit: (e) => {
      const id = editingRef.current;
      const el = document.activeElement as HTMLElement | null;
      if (!id || !el?.closest('.editing') || !boardRef.current?.contains(el)) return;
      runShortcuts(e, 'editing');
    },
    down: (e) => {
      if (isEditableTarget(e.target) || document.querySelector('.modal') || menu) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // Bearbeitung läuft schon, der Fokus ist aber noch nicht im Textfeld (z. B. noch auf dem Werkzeugknopf):
      // Taste dorthin umleiten statt sie als Kürzel bzw. „Tippen startet die Bearbeitung“ zu werten
      if (editingRef.current && !mod && !e.altKey && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter')) {
        if (focusEditing()) return;
      }
      // gerade bearbeitetes Objekt wurde gelöscht: weiter getippte Buchstaben lösen kurz keine Kürzel aus
      if (performance.now() < keysBlockedUntil.current && !mod && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter')) {
        e.preventDefault();
        return;
      }
      // Präsentation: nur Blättern und Beenden
      if (present !== null) {
        if (['arrowright', 'arrowdown', 'pagedown', ' ', 'enter'].includes(key)) goFrame(present + 1, true);
        else if (['arrowleft', 'arrowup', 'pageup', 'backspace'].includes(key)) goFrame(present - 1, true);
        else if (key === 'home') goFrame(0, true);
        else if (key === 'end') goFrame(framesRef.current.length - 1, true);
        else if (key === 'escape') stopPresent();
        else return;
        e.preventDefault();
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        if (!e.repeat) setSpaceDown(true);
        return;
      }
      if (runShortcuts(e, 'board')) return;
      if (mod) return;
      if (e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault();
        goFrame(frameCursor.current + (e.key === 'PageDown' ? 1 : -1), false);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (e.key === 'Escape') {
        if (gesture.current) cancelGesture();
        else if (framesOpen) setFramesOpen(false);
        else if (sidebar) setSidebar(null);
        else if (tool !== 'select') setTool('select');
        else setSelection([]);
        return;
      }
      if (e.key === 'Enter') {
        const sel = selectedObjects();
        if (sel.length === 1) {
          e.preventDefault();
          startEditing(sel[0]);
        }
        return;
      }
      if (e.key === 'Tab' && document.activeElement === boardRef.current && !e.altKey) {
        if (focusStep(e.shiftKey)) e.preventDefault();
        return;
      }
      if (e.key.startsWith('Arrow')) {
        const objs = movableSet(selectionRef.current);
        if (!objs.size) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        store.updateMany(movePatches(objs.values(), dx, dy));
        return;
      }
      // Tippen auf einem ausgewählten Objekt startet die Bearbeitung
      const sel = selectedObjects();
      const printable = e.key.length === 1 && !e.altKey;
      if (printable && tool === 'select' && sel.length === 1 && typesIntoText(sel[0]) && !sel[0].locked && !gesture.current && !editingRef.current) {
        e.preventDefault();
        typeInto(sel[0], e.key);
        return;
      }
      if (runShortcuts(e, 'late')) return;
      // Werkzeug-Kürzel: bei genau einem Text-Objekt in der Auswahl tippt die Taste (s. o.), sonst Werkzeug wechseln
      const t = tools.list().find((d) => d.key === key && !d.action);
      if (t && !e.altKey && !(sel.length === 1 && typesIntoText(sel[0]) && !sel[0].locked)) {
        setTool(t.id);
        if (t.id !== 'select' && t.id !== 'hand') setSelection([]);
        return;
      }
    },
    up: (e) => {
      if (e.key === ' ') setSpaceDown(false);
    },
    copy: (e) => {
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
      const objs = withAttachedConnectors(selectedObjects());
      if (!objs.length) return;
      e.preventDefault();
      // Klartext für Mail/Messenger, Stachel-Daten im HTML
      e.clipboardData?.setData('text/plain', plainText(objs));
      e.clipboardData?.setData('text/html', toHtml(objs));
      internalClip.current = objs;
      pasteCount.current = 0;
    },
    cut: (e) => {
      keyRef.current.copy(e);
      if (e.defaultPrevented) deleteSelection();
    },
    paste: (e) => {
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
      const dt = e.clipboardData;
      if (!dt) return;
      const files = [...dt.files].filter((f) => f.type.startsWith('image/') || fileHandlers.list().some((h) => h.match(f)));
      if (files.length) {
        e.preventDefault();
        void addImages(files);
        return;
      }
      const html = dt.getData('text/html');
      const text = dt.getData('text/plain');
      const objs = parseClipboard(html, text);
      if (objs) {
        e.preventDefault();
        pasteObjects(objs);
        return;
      }
      if (!text.trim()) return;
      e.preventDefault();
      // Fremder Text → Haftnotiz am Mauszeiger
      pasteText(text);
    },
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => keyRef.current.down(e);
    const edit = (e: KeyboardEvent) => keyRef.current.edit(e);
    const up = (e: KeyboardEvent) => keyRef.current.up(e);
    const copy = (e: ClipboardEvent) => keyRef.current.copy(e);
    const cut = (e: ClipboardEvent) => keyRef.current.cut(e);
    const paste = (e: ClipboardEvent) => keyRef.current.paste(e);
    const blur = () => {
      setSpaceDown(false);
      keyRef.current.lost();
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') keyRef.current.lost();
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('keydown', edit, true);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    document.addEventListener('copy', copy);
    document.addEventListener('cut', cut);
    document.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('keydown', edit, true);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
      document.removeEventListener('copy', copy);
      document.removeEventListener('cut', cut);
      document.removeEventListener('paste', paste);
    };
  }, []);

  // Werkzeugwechsel beendet Hover/Bearbeitung
  useEffect(() => {
    setHoverId(null);
    if (tool !== 'select') setEditingId(null);
  }, [tool]);

  // ---- Menüs --------------------------------------------------------------------
  // Am Handy ist oben rechts kein Platz: Seitenleisten-Knöpfe wandern ins Board-Menü
  const narrow = size.w < 700;
  const sidebarButtons = sidebarTabs.list().filter((t) => t.button);
  const menuFor = (m: Menu): MenuItem[] => {
    const items = menuItems
      .list()
      .filter((d) => d.on === m.on)
      .map((d) => d.item(api, m.at))
      .filter((it): it is MenuItem => !!it);
    if (m.on === 'board' && narrow) sidebarButtons.forEach((t, i) => items.push({ label: t.title, sep: i === 0 && items.length > 0, onSelect: () => setSidebar(t.id) }));
    return items;
  };
  const hasBoardMenu = menuItems.list().some((d) => d.on === 'board') || (narrow && sidebarButtons.length > 0);

  // ---- Darstellung ------------------------------------------------------------------
  const keep = useMemo(() => new Set(selection), [selection]);
  const selected = selection.map((id) => snap.byId.get(id)).filter((o): o is BoardObject => !!o);
  const selBounds = selected.length ? selectionBounds(selection, snap) : null;
  const showCtx = selBounds && !gestureKind && tool === 'select' && present === null && !menu;
  const single = selected.length === 1 ? selected[0] : null;
  const showAdd = !!single && !!typeDef(single).addHandles && !single.locked && tool === 'select' && !gestureKind && !editingId && present === null;
  const hoverObj = hoverId ? snap.byId.get(hoverId) : null;
  const anchorId =
    tool === 'select' && mouseHover && !gestureKind && hoverObj && typeDef(hoverObj).anchorable && hoverObj.id !== editingId && !(showAdd && single?.id === hoverObj.id) && present === null
      ? hoverObj.id
      : null;
  const hoverStyle = tools.get(tool)?.hoverTarget || gestureKind === 'connector' || gestureKind === 'connEnd' || (gesture.current?.kind === 'tool' && gesture.current.g.hoverTarget) ? 'target' : 'select';

  // Kontextleiste mit Abstand zu Plus- und Drehgriffen
  const ctxAnchor = (r: Rect): Rect =>
    (single && !single.locked && (showAdd || typeDef(single).rotatable)) || canRotateAll(selected, typeDef) ? { x: r.x, y: r.y - 40, w: r.w, h: r.h + 80 } : r;

  // Punktraster: Abstand verdoppeln, bis er auf dem Bildschirm nicht zu eng ist
  let gap = GRID * cam.z;
  while (gap < 14) gap *= 2;
  const dot = clamp(cam.z * 1.3, 0.9, 1.6);

  const cursor =
    gestureKind === 'pan' || (spaceDown && gestureKind === null) || tool === 'hand' || present !== null
      ? gestureKind === 'pan'
        ? 'grabbing'
        : 'grab'
      : gestureKind === 'rotate'
        ? 'grabbing'
        : (tools.get(tool)?.cursor ?? 'crosshair');

  const slotProps: SlotProps = { api, cam, snap, selection, width: size.w, height: size.h };
  const renderSlots = (name: Parameters<typeof slotsAt>[0]) =>
    slotsAt(name)
      .filter((s) => present === null || s.presenting)
      .map((s) => <s.Component key={s.id} {...slotProps} />);
  const sidebarDef = sidebar ? sidebarTabs.get(sidebar) : undefined;
  const modalDef = modal ? modals.get(modal.id) : undefined;

  return (
    <div className={`editor${present !== null ? ' is-presenting' : ''}${sidebarDef && present === null ? ' has-sidebar' : ''}`}>
      <div
        ref={boardRef}
        className={`board tool-${tool}${gestureKind === 'move' ? ' is-moving' : ''}`}
        data-testid="board"
        tabIndex={0}
        role="application"
        aria-label="Board"
        aria-roledescription="Whiteboard"
        style={{
          cursor,
          backgroundSize: `${gap}px ${gap}px`,
          backgroundPosition: `${cam.x}px ${cam.y}px`,
          backgroundImage: `radial-gradient(circle at ${dot}px ${dot}px, rgba(10,10,10,0.2) ${dot}px, transparent ${dot + 0.6}px)`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => {
          sendCursor(null);
          lastPointer.current = null;
          if (!gesture.current && tool === 'select') setHoverId(null);
        }}
        onMouseDown={(e) => {
          // verhindert, dass der Browser den Fokus von einer gerade geöffneten Textbearbeitung wegnimmt
          if (!isEditableTarget(e.target)) e.preventDefault();
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          // Kontextmenü-Taste der Tastatur (Rechtsklick und langes Drücken laufen über die Zeiger-Gesten)
          if (rightDown.current || lastPointerType.current === 'touch') {
            rightDown.current = false;
            return;
          }
          const b = selectionBounds(selectionRef.current, snapRef.current);
          const p = b ? rectToScreen(camRef.current, b) : { x: size.w / 2, y: size.h / 2, w: 0, h: 0 };
          const r = boardRef.current!.getBoundingClientRect();
          const x = p.x + p.w / 2;
          const y = p.y + p.h / 2;
          setMenu({ x: x + r.left, y: y + r.top, at: toWorld({ x, y }), on: b ? 'object' : 'canvas' });
        }}
        onDragOver={(e) => {
          if ([...e.dataTransfer.types].includes('Files')) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const files = [...e.dataTransfer.files];
          if (files.length) void addImages(files, toWorld(screenPoint(e)));
        }}
      >
        <div className="world" data-testid="world" ref={worldRef} style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}>
          <ObjectLayer snap={snap} cam={cam} width={size.w} height={size.h} keep={keep} editingId={editingId} imageSrc={session.imageSrc.bind(session)} peers={peers} {...editCb} />
          {renderSlots('world')}
        </div>
        <Overlay
          snap={snap}
          cam={cam}
          selection={selection}
          editingId={editingId}
          hoverId={present === null ? hoverId : null}
          hoverStyle={hoverStyle}
          anchorId={anchorId}
          showAdd={showAdd}
          draft={draft}
          peers={peers}
          hideHandles={gestureKind === 'move' || tool !== 'select'}
          width={size.w}
          height={size.h}
          editCb={editCb}
          titleAppend={titleAppend}
          rotating={gestureKind === 'rotate' ? rotating : null}
        />
        {uploads.map((u) => {
          const r = rectToScreen(cam, u.rect);
          return (
            <div key={u.key} className="upload-ph" role="status" style={{ transform: `translate(${r.x}px, ${r.y}px)`, width: r.w, height: r.h, background: u.color ?? undefined }}>
              <span>Wird hochgeladen …</span>
            </div>
          );
        })}
        {renderSlots('overlay')}
        {ready && snap.ordered.length === 0 && !draft && uploads.length === 0 && (
          <div className="empty-hint" aria-hidden="true">
            <strong>Leeres Board.</strong> {byPointer('Doppelklick', 'Doppeltippen')} für eine Haftnotiz – oder ein Werkzeug wählen.
          </div>
        )}
      </div>

      {present === null && (
        <>
          <div className="topbar topbar--left">
            {topLeft}
            <button className={`panel tl-frames${framesOpen ? ' is-active' : ''}`} aria-label="Rahmen-Liste" title="Rahmen-Liste und Präsentation" aria-expanded={framesOpen} onClick={() => setFramesOpen((v) => !v)}>
              <IconFrames size={20} />
              <span className="tl-frames__label">Rahmen</span>
            </button>
            {renderSlots('topbarLeft')}
            {hasBoardMenu && (
              <button
                className={`panel tl-menu${menu?.on === 'board' ? ' is-active' : ''}`}
                aria-label="Board-Menü"
                title="Board-Menü"
                aria-haspopup="menu"
                onClick={(e) => {
                  const b = e.currentTarget.getBoundingClientRect();
                  setMenu({ x: b.left, y: b.bottom + 8, at: viewCenter(), on: 'board' });
                }}
              >
                <span aria-hidden="true">···</span>
              </button>
            )}
          </div>
          <div className="topbar topbar--right">
            {renderSlots('topbarRight')}
            {!narrow &&
              sidebarButtons.map((t) => (
                <button key={t.id} className={`panel tr-btn${sidebar === t.id ? ' is-active' : ''}`} aria-label={t.title} title={t.title} aria-pressed={sidebar === t.id} onClick={() => setSidebar((s) => (s === t.id ? null : t.id))}>
                  <t.Icon size={20} />
                </button>
              ))}
            {topRight}
          </div>
          {framesOpen && (
            <FramesPanel
              frames={frames}
              onPick={(f) => {
                frameCursor.current = frames.indexOf(f);
                fitTo(objRect(f), 2);
              }}
              onPresent={startPresent}
              onClose={() => setFramesOpen(false)}
            />
          )}

          <Toolbar
            api={api}
            tool={tool}
            compact={size.w < 700 || size.h < 560}
            onTool={(t) => {
              setTool(t);
              if (t !== 'select') setSelection([]);
            }}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={() => store.undo()}
            onRedo={() => store.redo()}
          />

          {sidebarDef && (
            <aside className="sidebar panel" aria-label={sidebarDef.title} onPointerDown={(e) => e.stopPropagation()}>
              <div className="sidebar__head">
                <div className="sidebar__tabs" role="tablist" aria-label="Seitenleiste">
                  {sidebarTabs.list().map((t) => (
                    <button key={t.id} role="tab" aria-selected={t.id === sidebar} className={`sidebar__tab${t.id === sidebar ? ' is-active' : ''}`} title={t.title} aria-label={t.title} onClick={() => setSidebar(t.id)}>
                      <t.Icon size={18} />
                    </button>
                  ))}
                </div>
                <span className="sidebar__title">{sidebarDef.title}</span>
                <button className="sidebar__close" aria-label="Seitenleiste schließen" onClick={() => setSidebar(null)}>
                  <IconClose size={18} />
                </button>
              </div>
              <div className="sidebar__body" role="tabpanel">
                <sidebarDef.Panel {...slotProps} onClose={() => setSidebar(null)} />
              </div>
            </aside>
          )}
        </>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={['image/png,image/jpeg,image/webp,image/gif', ...fileHandlers.list().map((h) => h.accept)].join(',')}
        multiple
        hidden
        data-testid="image-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          void addImages(files);
        }}
      />

      {showCtx && <ContextBar selected={selected} anchor={ctxAnchor(rectToScreen(cam, selBounds))} viewWidth={size.w} api={api} />}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuFor(menu)} onClose={() => setMenu(null)} />}
      {zoomMenu && (
        <ContextMenu
          x={zoomMenu.x}
          y={zoomMenu.y}
          items={[
            { label: 'Alles einpassen', shortcut: 'Umschalt 1', onSelect: fit },
            { label: '50 %', sep: true, onSelect: () => zoomTo(0.5) },
            { label: '100 %', shortcut: 'Strg 0', onSelect: () => zoomTo(1) },
            { label: '200 %', onSelect: () => zoomTo(2) },
          ]}
          onClose={() => setZoomMenu(null)}
        />
      )}

      {present !== null ? (
        <PresentBar index={present} frames={frames} onGo={(i) => goFrame(i, true)} onExit={stopPresent} />
      ) : (
        <div className="bottom-right">
          <Minimap snap={snap} cam={cam} width={size.w} height={size.h} onNavigate={(p) => ((cameraTouched.current = true), centerOn(p))} />
          <div className="zoombar panel" onPointerDown={(e) => e.stopPropagation()}>
            <button className="zb-btn" aria-label="Verkleinern" onClick={() => zoomStep(-1)}>
              <IconMinus size={20} />
            </button>
            <button
              className={`zb-value${zoomMenu ? ' is-active' : ''}`}
              aria-label="Zoom-Stufe wählen"
              title="Zoom-Stufe (Strg 0: 100 %)"
              aria-haspopup="menu"
              aria-expanded={!!zoomMenu}
              data-testid="zoom-value"
              onClick={(e) => {
                const b = e.currentTarget.getBoundingClientRect();
                setZoomMenu((m) => (m ? null : { x: b.left, y: b.top - 8 - 4 * 40 }));
              }}
            >
              {Math.round(cam.z * 100)} %
            </button>
            <button className="zb-btn" aria-label="Vergrößern" onClick={() => zoomStep(1)}>
              <IconPlus size={20} />
            </button>
            <span className="zb-sep" />
            <button className="zb-btn" aria-label="Alles einpassen" title="Alles einpassen (Umschalt 1)" onClick={fit}>
              <IconFit size={20} />
            </button>
            {slotsAt('zoombar').map((s) => (
              <Fragment key={s.id}>
                <s.Component {...slotProps} />
              </Fragment>
            ))}
            <button className="zb-btn zb-keys" aria-label="Tastenkürzel" title="Tastenkürzel (?)" onClick={() => setModal({ id: 'shortcuts' })}>
              <IconKeyboard size={20} />
            </button>
          </div>
        </div>
      )}
      {modalDef && <modalDef.Component api={api} props={modal!.props} onClose={() => setModal(null)} />}
    </div>
  );
}
