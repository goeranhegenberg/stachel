// Darstellung der Board-Objekte (Weltkoordinaten, im skalierten .world-Container). Viewport-Culling + memo je Objekt.
// Detailstufen: kleine Objekte (< 40 px auf dem Bildschirm) nur als Fläche, ohne Text und Schatten.
// Wie ein Typ aussieht, steht im Typ-Register (editor/core/objectTypes.tsx bzw. Feature-Module).
import { memo, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import '@fontsource/barlow/500-italic.css';
import '@fontsource/barlow/600-italic.css';
import '@fontsource/barlow/700-italic.css';
import '@fontsource/barlow/800.css';
import '@fontsource/barlow/800-italic.css';
import '@fontsource/barlow/900.css';
import '@fontsource/barlow/900-italic.css';
import type { BoardObject } from '../protocol';
import type { Snapshot } from '../board/store';
import type { Peer } from '../board/session';
import { expand, GridIndex, intersects, objRect, rotationOf, viewRect, type Camera, type Rect } from '../board/geometry';
import { detailOf, FAR_ZOOM, placeStyle, type Detail } from './render/format';
import { typeDef } from './ext/registry';
import { notifyImageZoom, setImageZoom } from './render/imageVariant';
import type { Derived, EditCallbacks, ObjectViewProps } from './ext/types';

export type { EditCallbacks };

/**
 * Zähler für Last-Tests (e2e/perf*.spec.ts, `window.__stachelRenderStats`): wie oft die Sichtbarkeit neu bestimmt und
 * wie oft ein Objekt neu gerendert wurde. Deterministisch, anders als Zeiten – fängt „alles neu zeichnen“-Regressionen.
 */
export const renderStats = { culls: 0, views: 0 };
if (typeof window !== 'undefined') (window as unknown as { __stachelRenderStats: typeof renderStats }).__stachelRenderStats = renderStats;

interface LayerProps extends EditCallbacks {
  snap: Snapshot;
  cam: Camera;
  width: number;
  height: number;
  keep: ReadonlySet<string>;
  editingId: string | null;
  imageSrc: (imageId: string) => string;
  /** Anwesende – für den Hinweis „wird gerade auch von … bearbeitet“ */
  peers?: readonly Peer[];
  /**
   * Zoom dieser Ebene bestimmt die Bildstufen (render/imageVariant.ts). Nur die Ebene des Editors; Export und Vorschaubild
   * zeichnen mit eigenem Maßstab und dürfen den Zoom des Boards nicht überschreiben (sonst bleiben Bilder nach jedem
   * Vorschaubild auf einer zu kleinen Stufe stehen, bis man wieder zoomt).
   */
  ownsImageZoom?: boolean;
}

/** Sichtbares Objekt mit Detailstufe (abgeleitete Typen wie Verbinder: mit Geometrie). */
type Entry = { o: BoardObject; detail: Detail; selected: boolean; derived?: unknown; dkey?: string };

/**
 * Rendert nur Objekte im (erweiterten) Sichtbereich; `keep` wird immer gerendert.
 * Die Liste der sichtbaren Objekte samt Detailstufe wird nur neu bestimmt, wenn sich Schnappschuss, Sichtbereich (grob
 * gerastert), Zoom, Auswahl oder Bearbeitung ändern – nicht bei Cursor-Bewegungen anderer (Awareness) oder sonstigen
 * Editor-Renders. Kandidaten kommen aus einem Raster-Index (O(sichtbar) statt O(alle) pro Frame), abgeleitete Geometrie
 * (Verbinder) wird je Objekt zwischengespeichert, solange die gelesenen Objekte dieselben bleiben.
 * <Items> baut die Elemente nur neu, wenn sich die Liste (Signatur), der Schnappschuss oder die Bearbeitung ändern.
 */
export function ObjectLayer({ snap, cam, width, height, keep, editingId, imageSrc, peers, ownsImageZoom = true, onTextChange, onTitleChange, onEditDone, onMeasured }: LayerProps) {
  const z = cam.z;
  const far = z < FAR_ZOOM;
  // Bilder wählen ihre Größenstufe nach dem Zoom (render/imageVariant.ts), ohne dass die Liste neu rendert
  if (ownsImageZoom) setImageZoom(z);
  useLayoutEffect(() => {
    if (ownsImageZoom) notifyImageZoom();
  }, [z, ownsImageZoom]);
  const view = cullRect(cam, width, height);
  // Rahmentitel-Größe nur in groben Stufen ändern (sonst rendern Rahmen bei jedem Zoom-Frame neu)
  const zq = far ? Math.round(Math.log2(z) * 8) / 8 : 0;
  const cull = useRef<Culler | null>(null);
  cull.current ??= new Culler();
  const { entries, sig } = useMemo(
    () => cull.current!.visible(snap, view, z, keep, editingId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, view.x, view.y, view.w, view.h, z, keep, editingId],
  );
  // imageSrc ist pro Render eine neue Funktion (bind) – über eine Ref aktuell halten, nicht vergleichen
  const srcRef = useRef(imageSrc);
  srcRef.current = imageSrc;
  const cb = useMemo<EditCallbacks>(() => ({ onTextChange, onTitleChange, onEditDone, onMeasured }), [onTextChange, onTitleChange, onEditDone, onMeasured]);
  return <Items entries={entries} sig={sig} snap={snap} editingId={editingId} far={far} zq={zq} peers={peers} srcRef={srcRef} cb={cb} />;
}

/** Zwischenspeicher einer abgeleiteten Geometrie: gültig, solange das Objekt und alle dabei gelesenen Objekte gleich sind. */
type DerivedCache = { o: BoardObject; deps: [string, BoardObject | undefined][]; d: Derived | null };

/**
 * Sichtbarkeit je Frame: Raster-Index über die Objektrechtecke (inkrementell je Schnappschuss abgeglichen) und ein
 * Zwischenspeicher für abgeleitete Geometrie. Eine Instanz je ObjectLayer (Board-Wechsel = neue Instanz, nichts hängt nach).
 */
export class Culler {
  private index = new GridIndex<BoardObject>(512);
  private derived = new Map<string, DerivedCache>();
  /** Typen mit `derive` (Verbinder) je Schnappschuss; ihre Grenzen hängen von anderen Objekten ab */
  private dependents: BoardObject[] = [];
  private synced: Snapshot | null = null;

  private sync(snap: Snapshot) {
    if (this.synced === snap) return;
    this.dependents = [];
    for (const o of snap.ordered) if (typeDef(o).derive) this.dependents.push(o);
    this.index.sync(snap.byId, (o) => (typeDef(o).derive ? null : objRect(o)));
    if (this.derived.size > this.dependents.length) {
      // gelöschte Verbinder vergessen
      for (const id of this.derived.keys()) if (!snap.byId.has(id)) this.derived.delete(id);
    }
    this.synced = snap;
  }

  /** Abgeleitete Geometrie, neu berechnet nur wenn sich das Objekt oder eines der gelesenen Objekte geändert hat. */
  private derive(o: BoardObject, snap: Snapshot, derive: NonNullable<ReturnType<typeof typeDef>['derive']>): Derived | null {
    const c = this.derived.get(o.id);
    if (c && c.o === o && c.deps.every(([id, dep]) => snap.byId.get(id) === dep)) return c.d;
    const deps: [string, BoardObject | undefined][] = [];
    const d = derive(o, (id) => {
      const v = snap.byId.get(id);
      deps.push([id, v]);
      return v;
    });
    this.derived.set(o.id, { o, deps, d });
    return d;
  }

  visible(snap: Snapshot, view: Rect, z: number, keep: ReadonlySet<string>, editingId: string | null): { entries: Entry[]; sig: string } {
    renderStats.culls++;
    this.sync(snap);
    const show = new Set<string>(this.index.query(view));
    for (const o of this.dependents) {
      const d = this.derive(o, snap, typeDef(o).derive!);
      if (d && intersects(d.bounds, view)) show.add(o.id);
    }
    for (const id of keep) show.add(id);
    if (editingId) show.add(editingId);
    // in Board-Reihenfolge: bei vielen Treffern einmal durch die Liste, sonst nur die Treffer sortieren
    let list: BoardObject[];
    if (show.size * 8 > snap.ordered.length) list = snap.ordered.filter((o) => show.has(o.id));
    else {
      list = [];
      for (const id of show) {
        const o = snap.byId.get(id);
        if (o) list.push(o);
      }
      list.sort((a, b) => snap.rank.get(a.id)! - snap.rank.get(b.id)!);
    }
    const entries: Entry[] = [];
    let sig = '';
    for (const o of list) {
      const selected = keep.has(o.id);
      const derive = typeDef(o).derive;
      if (derive) {
        const d = this.derive(o, snap, derive);
        if (!d) continue;
        entries.push({ o, detail: 'full', selected, derived: d.data, dkey: d.key });
        sig += `${o.id}|`;
        continue;
      }
      const detail: Detail = o.id === editingId ? 'full' : detailOf(o, z);
      entries.push({ o, detail, selected });
      sig += `${o.id}${detail === 'full' ? '|' : '~'}${selected ? '*' : ''}`;
    }
    return { entries, sig };
  }
}

/**
 * Sichtbereich + Rand, nach außen auf ein grobes Raster gerundet: Beim Zoomen und Schieben ändert sich die
 * Menge der gerenderten Objekte so nur selten (sonst baut jeder Frame die Liste neu).
 */
export function cullRect(cam: Camera, width: number, height: number): Rect {
  const v = expand(viewRect(cam, width, height), 320 / cam.z);
  const cell = 2 ** Math.ceil(Math.log2(480 / cam.z));
  const x1 = Math.floor(v.x / cell) * cell;
  const y1 = Math.floor(v.y / cell) * cell;
  return { x: x1, y: y1, w: Math.ceil((v.x + v.w) / cell) * cell - x1, h: Math.ceil((v.y + v.h) / cell) * cell - y1 };
}

interface ItemsProps {
  entries: Entry[];
  sig: string;
  snap: Snapshot;
  editingId: string | null;
  far: boolean;
  zq: number;
  peers?: readonly Peer[];
  srcRef: { current: (imageId: string) => string };
  cb: EditCallbacks;
}

const Items = memo(
  function Items({ entries, editingId, far, zq, peers, srcRef, cb }: ItemsProps) {
    const items: React.ReactNode[] = [];
    const titles: React.ReactNode[] = [];
    for (const { o, detail, selected, derived, dkey } of entries) {
      const editing = o.id === editingId;
      const def = typeDef(o);
      if (def.FarLabel && far && !editing) titles.push(<def.FarLabel key={`t-${o.id}`} o={o} zq={zq} />);
      items.push(
        <ObjectView
          key={o.id}
          o={o}
          editing={editing}
          detail={detail}
          selected={selected}
          far={far}
          imageSrc={o.imageId ? srcRef.current(o.imageId) : undefined}
          remoteName={editing ? peerEditing(peers, o.id) : undefined}
          cb={cb}
          derived={derived}
          dkey={dkey}
        />,
      );
    }
    return (
      <>
        {items}
        {titles}
      </>
    );
  },
  (a, b) =>
    a.sig === b.sig &&
    a.snap === b.snap &&
    a.editingId === b.editingId &&
    a.far === b.far &&
    a.zq === b.zq &&
    a.cb === b.cb &&
    (a.editingId === null || a.peers === b.peers),
);

/** Name einer anderen Person, die das Objekt gerade ausgewählt hat (oder ''). */
function peerEditing(peers: readonly Peer[] | undefined, id: string): string {
  return peers?.find((p) => p.selection.includes(id))?.user.name ?? '';
}

/** Objekt über das Typ-Register darstellen; `dkey` = Schlüssel der abgeleiteten Geometrie (neu zeichnen nur bei Änderung). */
const ObjectView = memo(
  function ObjectView(p: ObjectViewProps & { dkey?: string }) {
    renderStats.views++;
    const def = typeDef(p.o);
    if (p.detail === 'simple') return <SimpleView o={p.o} style={def.simpleStyle?.(p.o, p.imageSrc)} />;
    return def.View ? <def.View {...p} /> : null;
  },
  (a, b) =>
    a.o === b.o &&
    a.editing === b.editing &&
    a.detail === b.detail &&
    a.selected === b.selected &&
    a.far === b.far &&
    a.imageSrc === b.imageSrc &&
    a.remoteName === b.remoteName &&
    a.dkey === b.dkey,
);

/** Weit herausgezoomt: nur eine Fläche in der Objektfarbe (kein Text, kein Schatten). */
function SimpleView({ o, style }: { o: BoardObject; style?: CSSProperties }) {
  return <div className={`obj obj-lod obj-lod--${o.type}`} data-id={o.id} data-type={o.type} style={flatPlaceStyle(o, style)} />;
}

/**
 * Lage ohne `transform` (left/top), solange nicht gedreht: Jede Transformation ist für den Browser ein eigener
 * Eigenschaftsknoten und Zeichenabschnitt. Bei „Alles einpassen“ mit Tausenden Flächen kostete das pro Zoom-Frame
 * Hunderte Millisekunden im Browser-Kern (Vorbereitung des Zeichnens), mit left/top fallen sie zu einem zusammen.
 */
function flatPlaceStyle(o: BoardObject, extra?: CSSProperties): CSSProperties {
  if (rotationOf(o)) return placeStyle(o, extra);
  return { left: o.x, top: o.y, width: o.w, height: o.h, ...extra };
}
