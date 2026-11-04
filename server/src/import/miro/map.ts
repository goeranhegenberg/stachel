// Abbildung Miro → Stachel (docs/features/import.md §4, Einzelheiten docs/import_miro_konzept.md §2). Reine Funktionen
// ohne I/O: Eingabe = alles, was fetch-board.ts gelesen hat (`MiroBoardData`), Ausgabe = fertige Stachel-Objekte für
// `store.createMany` (Reihenfolge = Ebenen unten → oben), Mindmaps für `store.mind.tree`, Dateien zum Laden und Bericht.
//
// Grundregeln
// - Lage: Miro gibt die Mitte an (`x = cx − w/2`); Kinder mit `relativeTo: parent_top_left` liegen relativ zur linken
//   oberen Ecke des Elternteils (rekursiv). 1 Miro-Einheit = 1 Stachel-Einheit, nichts wird verschoben.
// - Ebenen: Rahmen unten, dann die Reihenfolge von `/items` (Miro liefert sie in Ebenenfolge), Verbinder oben.
// - Zahlen kommen bei Miro oft als Strings („14“, „2.0“) – `num()` liest beides.
// - Keine Personendaten: Ersteller, Bearbeiter, Zuständige (assigneeId) werden nie übernommen.
// - Notizfarben: nächste Farbe der übergebenen Palette (Standard `STICKY_COLORS`, zur Laufzeit gerechnet).
import { randomBytes } from 'node:crypto';
import { STICKY_COLORS } from '../../../../shared/protocol.js';
import { NATIVE_MIND_LIMITS } from '../../../../shared/native.js';
import type { ImportReport, ImportReportEntry } from '../../../../shared/import.js';
import { hex6, parseColor, stickyColor, tagColor, toHex } from './colors.js';
import { colorizeDoc, htmlToDoc, htmlToPlain, linkMark, safeHref, type PMDoc, type PMNode } from './html.js';
import { mapCap, mapFont, mapLineStyle, mapShape, roundStroke, type CapStyle } from './shapes.js';
import type { AssetNeed, MapOptions, MappedBoard, MindTree, MappedObject, MiroBoardData, MiroConnector, MiroConnectorEnd, MiroItem, MiroMindNode } from './types.js';

/** Fester Hinweis im Bericht: was die Miro-Schnittstelle grundsätzlich nicht herausgibt. */
export const MIRO_NOTE_MISSING =
  'Tabellen, Kommentare, Freihand-Zeichnungen, Kanban-Boards, Zeitleisten und Abstimmungen gibt die Miro-Schnittstelle nicht heraus. Sie fehlen deshalb im neuen Board.';

/** Standard-Obergrenzen (wie STACHEL_IMPORT_MAX_OBJECTS / _MAX_IMAGES) */
export const MAP_DEFAULT_MAX_OBJECTS = 20_000;
export const MAP_DEFAULT_MAX_IMAGES = 1_000;

/** Stabile Codes des Berichts mit deutschem Text (Anzahl steht daneben). */
export const REPORT_TEXTS = {
  // angepasst
  sticky_color: 'Notizfarben auf die nächste Farbe der Stachel-Palette gesetzt',
  shape_similar: 'Formen ähnlich dargestellt (z. B. Sprechblase, Notiz-Klammer, Magnettrommel)',
  shape_unknown: 'Unbekannte Formen als Rechteck übernommen',
  font_family: 'Schriftarten durch eine der vier Stachel-Schriften ersetzt',
  stroke_width: 'Strichstärken auf die Stachel-Stufen (1, 2, 4, 8) gerundet',
  text_background: 'Texte mit Hintergrund: die Fläche liegt als eigene Form dahinter (gruppiert)',
  card_assignee: 'Karten ohne zuständige Person übernommen (Personen aus Miro werden nicht übernommen)',
  app_card: 'App-Karten als einfache Karten übernommen (ohne Verbindung zur App)',
  embed_link: 'Eingebettete Inhalte und Link-Vorschauen als Text mit Link übernommen',
  doc_format: 'Miro-Docs als Text übernommen (Bilder und Tabellen darin fehlen)',
  connector_erd: 'ERD-Spitzen (Krähenfuß) vereinfacht',
  connector_cap_unknown: 'Unbekannte Pfeilspitzen als Dreieck übernommen',
  connector_free_end: 'Verbinder-Enden an nicht übernommenen Objekten frei gelassen',
  connector_caption_extra: 'Weitere Verbinder-Beschriftungen als eigener Text übernommen',
  connector_text_orientation: 'Verbinder-Beschriftungen stehen waagerecht statt entlang der Linie',
  mindmap_layout: 'Mindmaps von Stachel neu angeordnet (Knotenfarben nach Stachel-Art)',
  tag_name_cut: 'Tag-Namen auf 40 Zeichen gekürzt',
  text_cut: 'Sehr lange Texte gekürzt (höchstens 20 000 Zeichen)',
  position_parent: 'Objekte mit unbekanntem Elternteil an ihrer relativen Lage abgelegt',
  link_unsafe: 'Links mit unsicherem Ziel als reiner Text übernommen',
  shape_opacity: 'Flussdiagramm-Formen, die Miro ohne Füllung und Rand meldet, mit sichtbarer Füllung und Rand übernommen',
  // fehlt
  unknown_type: 'Unbekannte Objekttypen nicht übernommen',
  unsupported_item: 'Objekte, die die Miro-Schnittstelle nicht vollständig liefert, nicht übernommen',
  table: 'Tabellen nicht übernommen (die Miro-Schnittstelle liefert ihren Inhalt nicht)',
  freehand: 'Freihand-Zeichnungen nicht übernommen (die Miro-Schnittstelle liefert sie nicht)',
  mindmap_node: 'Mindmap-Knoten nicht übernommen (die Mindmap ließ sich nicht lesen)',
  document_type: 'Dateien außer PDF nicht übernommen (an ihrer Stelle liegt eine Karte mit dem Dateinamen)',
  image_missing: 'Bilder ohne Datei-Adresse nicht übernommen',
  image_limit: 'Bilder und Dokumente über der Obergrenze je Board nicht übernommen',
  object_limit: 'Objekte über der Obergrenze je Board nicht übernommen',
  connector_no_end: 'Verbinder ohne erreichbares Ende nicht übernommen',
  mindmap_limit: 'Mindmap-Knoten über der Grenze (400 je Mindmap, 10 Ebenen) nicht übernommen',
  tag_limit: 'Tags über 8 je Objekt nicht übernommen',
} as const;
export type ReportCode = keyof typeof REPORT_TEXTS;

const ADJUSTED = new Set<ReportCode>([
  'sticky_color', 'shape_similar', 'shape_unknown', 'font_family', 'stroke_width', 'text_background', 'card_assignee',
  'app_card', 'embed_link', 'doc_format', 'connector_erd', 'connector_cap_unknown', 'connector_free_end',
  'connector_caption_extra', 'connector_text_orientation', 'mindmap_layout', 'tag_name_cut', 'text_cut', 'position_parent',
  'link_unsafe', 'shape_opacity',
]);

/** Bericht sammeln (gleicher Code = ein Eintrag mit Anzahl). */
class ReportBuilder {
  private adjusted = new Map<string, ImportReportEntry>();
  private skipped = new Map<string, ImportReportEntry>();
  readonly imported: Record<string, number> = {};
  /** unbekannte Objekttypen bzw. Formen (für den Text) */
  readonly unknownTypes = new Set<string>();
  readonly unknownShapes = new Set<string>();

  add(code: ReportCode, n = 1) {
    if (n <= 0) return;
    const map = ADJUSTED.has(code) ? this.adjusted : this.skipped;
    const e = map.get(code);
    if (e) e.count += n;
    else map.set(code, { code, text: REPORT_TEXTS[code], count: n });
  }

  /** fremde Einträge (Hinweise aus dem Lesen) */
  addEntry(e: ImportReportEntry) {
    const cur = this.skipped.get(e.code);
    if (cur) cur.count += e.count;
    else this.skipped.set(e.code, { ...e });
  }

  build(): ImportReport {
    const list = (m: Map<string, ImportReportEntry>) => [...m.values()].map((e) => ({ ...e }));
    const adjusted = list(this.adjusted);
    const skipped = list(this.skipped);
    const shapeEntry = adjusted.find((e) => e.code === 'shape_unknown');
    if (shapeEntry && this.unknownShapes.size) shapeEntry.text += ` (${[...this.unknownShapes].sort().slice(0, 10).join(', ')})`;
    const typeEntry = skipped.find((e) => e.code === 'unknown_type');
    if (typeEntry && this.unknownTypes.size) typeEntry.text += ` (${[...this.unknownTypes].sort().slice(0, 10).join(', ')})`;
    return { imported: { ...this.imported }, adjusted, skipped, notes: [MIRO_NOTE_MISSING] };
  }
}

// ---- kleine Helfer ---------------------------------------------------------------------------------------------------

/** Zahl aus Zahl oder String („14“, „2.0“, „50%“); sonst NaN. */
export function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim()) return parseFloat(v);
  return NaN;
}
const numOr = (v: unknown, d: number) => {
  const n = num(v);
  return Number.isFinite(n) ? n : d;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const COORD = 9_000_000;
const SIZE = 1_000_000;

/** Prozent-String „50%“/„50.0%“ bzw. Zahl → 0…1; NaN wenn nicht lesbar. */
export function pct(v: unknown): number {
  const n = num(typeof v === 'string' ? v.replace('%', '') : v);
  return Number.isFinite(n) ? n / 100 : NaN;
}

/** Seite eines Verbinder-Endes aus `snapTo` bzw. der Prozentlage (Seitenmitten n/e/s/w, Toleranz 2 %). */
export function sideOf(end: MiroConnectorEnd | null | undefined): 'n' | 'e' | 's' | 'w' | undefined {
  const snap = typeof end?.snapTo === 'string' ? end.snapTo.toLowerCase() : '';
  if (snap === 'top') return 'n';
  if (snap === 'right') return 'e';
  if (snap === 'bottom') return 's';
  if (snap === 'left') return 'w';
  const x = pct(end?.position?.x);
  const y = pct(end?.position?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.02;
  if (near(x, 0.5) && near(y, 0)) return 'n';
  if (near(x, 1) && near(y, 0.5)) return 'e';
  if (near(x, 0.5) && near(y, 1)) return 's';
  if (near(x, 0) && near(y, 0.5)) return 'w';
  return undefined;
}

const ALIGN = new Set(['left', 'center', 'right']);
const VALIGN = new Set(['top', 'middle', 'bottom']);
const alignOf = (v: unknown) => (typeof v === 'string' && ALIGN.has(v) ? (v as 'left' | 'center' | 'right') : undefined);
const valignOf = (v: unknown) => (typeof v === 'string' && VALIGN.has(v) ? (v as 'top' | 'middle' | 'bottom') : undefined);

/** Fast schwarze Textfarben gelten als Standard (keine eigene Mark). */
const isDefaultInk = (hex: string | undefined) => !hex || ['#000000', '#0a0a0a', '#1a1a1a', '#050038'].includes(hex);

const defaultNewId = () => randomBytes(12).toString('base64url');

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Obj = MappedObject;

// ---- Abbildung -------------------------------------------------------------------------------------------------------

/** Miro-Board → Stachel-Objekte, Mindmaps, Dateien und Bericht. */
export function mapBoard(data: MiroBoardData, opts: MapOptions = {}): MappedBoard {
  const palette = opts.palette && opts.palette.length ? opts.palette : STICKY_COLORS;
  const newId = opts.newId ?? defaultNewId;
  const maxObjects = opts.maxObjects ?? MAP_DEFAULT_MAX_OBJECTS;
  const maxImages = opts.maxImages ?? MAP_DEFAULT_MAX_IMAGES;
  const report = new ReportBuilder();
  for (const w of data.warnings ?? []) report.addEntry(w);

  // Formen mit nachgeladener v2-experimental-Antwort (Flussdiagramm): deren Felder gelten
  const experimental = new Set<string>();
  const items = (data.items ?? [])
    .filter((i) => i && typeof i.id === 'string')
    .map((i) => {
      const exp = i.type === 'shape' ? data.experimentalShapes?.[i.id] : undefined;
      if (!exp) return i;
      // echte Antworten: /items liefert Flussdiagramm-Formen als `isSupported: false` ohne data/style
      experimental.add(i.id);
      const merged: MiroItem = { ...i, data: { ...(i.data ?? {}), ...(exp.data ?? {}) }, style: { ...(i.style ?? {}), ...(exp.style ?? {}) }, geometry: { ...(i.geometry ?? {}), ...(exp.geometry ?? {}) } };
      if (exp.data?.shape) delete merged.isSupported;
      return merged;
    });
  const mindNodes = (data.mindNodes ?? []).filter((n) => n && typeof n.id === 'string');
  const mindIds = new Set(mindNodes.map((n) => n.id));
  /** alle Miro-Objekte mit Lage (Elternteile, freie Verbinder-Enden) */
  const raw = new Map<string, MiroItem | MiroMindNode>();
  for (const n of mindNodes) raw.set(n.id, n);
  for (const i of items) raw.set(i.id, i);

  // ---- Lage (absolut, linke obere Ecke) ----
  const boxCache = new Map<string, Box>();
  function rawBox(it: MiroItem | MiroMindNode, seen = new Set<string>()): Box {
    const cached = boxCache.get(it.id);
    if (cached) return cached;
    const w = clamp(numOr(it.geometry?.width, numOr(it.geometry?.height, 100)), 1, SIZE);
    const h = clamp(numOr(it.geometry?.height, w), 1, SIZE);
    let cx = numOr(it.position?.x, 0);
    let cy = numOr(it.position?.y, 0);
    const parentId = it.parent && typeof it.parent.id === 'string' ? it.parent.id : undefined;
    if (it.position?.relativeTo === 'parent_top_left' && parentId) {
      const parent = raw.get(parentId);
      if (parent && !seen.has(parentId)) {
        seen.add(it.id);
        const pb = rawBox(parent, seen);
        cx += pb.x;
        cy += pb.y;
      } else report.add('position_parent');
    }
    const box = { x: cx - w / 2, y: cy - h / 2, w, h };
    boxCache.set(it.id, box);
    return box;
  }

  // ---- Gruppen und Tags ----
  // Gruppen aus `/groups` bzw. dem Feld `group.id` am Objekt (echte Antworten liefern beides)
  const groupOf = new Map<string, string>();
  const gids = new Map<string, string>();
  const gidFor = (miroGroup: string) => {
    let g = gids.get(miroGroup);
    if (!g) gids.set(miroGroup, (g = newId()));
    return g;
  };
  for (const g of data.groups ?? []) {
    if (!g || !Array.isArray(g.items) || !g.items.length) continue;
    const gid = gidFor(String(g.id));
    for (const m of g.items) if (typeof m === 'string' && !groupOf.has(m)) groupOf.set(m, gid);
  }
  for (const i of items) {
    const g = (i as { group?: { id?: unknown } }).group?.id;
    if (typeof g === 'string' && g && !groupOf.has(i.id)) groupOf.set(i.id, gidFor(g));
  }
  const tagsById = new Map((data.tags ?? []).filter((t) => t && typeof t.id === 'string').map((t) => [t.id, t]));
  const tagsFor = (it: MiroItem): { label: string; color: string }[] | undefined => {
    const ids = [...(data.itemTags?.[it.id] ?? []), ...(Array.isArray(it.tagIds) ? it.tagIds : []), ...(Array.isArray(it.data?.tagIds) ? (it.data!.tagIds as unknown[]) : [])];
    const out: { label: string; color: string }[] = [];
    const seenIds = new Set<string>();
    const seenLabels = new Set<string>();
    let dropped = 0;
    for (const tid of ids) {
      if (typeof tid !== 'string' || seenIds.has(tid)) continue;
      seenIds.add(tid);
      const t = tagsById.get(tid);
      if (!t) continue;
      let label = htmlToPlain(t.title ?? '').replace(/\s+/g, ' ').trim();
      if (!label) continue;
      if (label.length > 40) {
        label = label.slice(0, 40).trimEnd();
        report.add('tag_name_cut');
      }
      if (seenLabels.has(label.toLowerCase())) continue;
      if (out.length >= 8) {
        dropped++;
        continue;
      }
      seenLabels.add(label.toLowerCase());
      out.push({ label, color: tagColor(t.fillColor) });
    }
    report.add('tag_limit', dropped);
    return out.length ? out : undefined;
  };

  // ---- Ausgabe ----
  const objects: Obj[] = [];
  const assets: AssetNeed[] = [];
  /** Miro-ID → Stachel-ID (Verbinder-Enden) */
  const idMap = new Map<string, string>();
  /** Stachel-ID → Lage (Verbinder-Mittelpunkte) */
  const boxes = new Map<string, Box>();
  let mindCount = 0;
  const budgetLeft = () => maxObjects - objects.length - mindCount;

  /** Objekte eines Miro-Objekts übernehmen (alles oder nichts, Obergrenze beachten). */
  const emit = (miroId: string | undefined, list: Obj[]): boolean => {
    if (!list.length) return false;
    if (list.length > budgetLeft()) {
      report.add('object_limit', list.length);
      return false;
    }
    for (const o of list) {
      objects.push(o);
      boxes.set(o.id, { x: o.x, y: o.y, w: o.w, h: o.h });
    }
    // Verbinder docken an das letzte Objekt (bei Text mit Fläche: am Text)
    if (miroId) idMap.set(miroId, list[list.length - 1]!.id);
    return true;
  };

  /** Grundfelder eines Objekts: ID, Lage, Drehung, Gruppe. */
  const base = (it: MiroItem, type: string, box = rawBox(it)): Obj => {
    const o: Obj = { id: newId(), type, x: r2(clamp(box.x, -COORD, COORD)), y: r2(clamp(box.y, -COORD, COORD)), w: r2(box.w), h: r2(box.h) };
    const rot = num(it.geometry?.rotation);
    if (Number.isFinite(rot) && Math.abs(rot % 360) > 0.001) o.rotation = r2(((rot % 360) + 360) % 360);
    const g = groupOf.get(it.id);
    if (g) o.groupId = g;
    return o;
  };

  /** Rich-Text setzen (text = Klartext-Spiegel); leerer Text → nur `text: ''`. */
  const setRich = (o: Obj, doc: PMDoc, plain: string, truncated: boolean) => {
    if (truncated) report.add('text_cut');
    o.text = plain;
    if (plain || doc.content.length > 1 || doc.content[0]?.content) o.content = doc;
  };

  const setFont = (o: Obj, family: unknown) => {
    const f = mapFont(family);
    if (f.font) o.fontFamily = f.font;
    if (f.changed) report.add('font_family');
  };

  // -- Haftnotiz --
  const mapSticky = (it: MiroItem): Obj[] => {
    const box = { ...rawBox(it) };
    // Form wie Stachel: Quadrat w = h, Rechteck w = 1,75 · h (Mitte bleibt)
    const shape = it.data?.shape;
    if (shape === 'square' || shape === 'rectangle') {
      const h = shape === 'square' ? box.w : box.w / 1.75;
      box.y += (box.h - h) / 2;
      box.h = h;
    }
    const o = base(it, 'sticky', box);
    const c = stickyColor(it.style?.fillColor, palette, !!opts.keepColors);
    o.color = c.color;
    if (c.color.toLowerCase() !== c.source.toLowerCase() || !c.known) report.add('sticky_color');
    const { doc, plain, truncated } = htmlToDoc(it.data?.content);
    setRich(o, doc, plain, truncated);
    const a = alignOf(it.style?.textAlign);
    if (a) o.align = a;
    const v = valignOf(it.style?.textAlignVertical);
    if (v) o.valign = v;
    if (it.style?.fontFamily) setFont(o, it.style.fontFamily);
    const tags = tagsFor(it);
    if (tags) o.tags = tags;
    return [o];
  };

  // -- Form --
  const mapShapeItem = (it: MiroItem): Obj[] => {
    const d = it.data ?? {};
    const st = it.style ?? {};
    const sm = mapShape(d.shape);
    const box = { ...rawBox(it) };
    let rotationExtra = 0;
    if (!sm) {
      report.add('shape_unknown');
      if (typeof d.shape === 'string') report.unknownShapes.add(d.shape.slice(0, 60));
    } else {
      if (sm.fidelity === 'similar') report.add('shape_similar');
      if (sm.rotate90) {
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        [box.w, box.h] = [box.h, box.w];
        box.x = cx - box.w / 2;
        box.y = cy - box.h / 2;
        rotationExtra = 90;
      }
    }
    const o = base(it, 'shape', box);
    if (rotationExtra) o.rotation = r2((((o.rotation as number | undefined) ?? 0) + rotationExtra) % 360);
    o.shape = sm?.shape ?? 'rect';
    // Füllung
    const fill = parseColor(st.fillColor);
    let fo = clamp(numOr(st.fillOpacity, 1), 0, 1);
    let bo = numOr(st.borderOpacity, 1);
    if (experimental.has(it.id) && fo === 0 && bo === 0) {
      // v2-experimental meldet Flussdiagramm-Formen mit Deckkraft 0 für Füllung und Rand, obwohl Farben gesetzt sind –
      // ganz unsichtbar übernehmen wäre sinnlos: Füllung und Rand sichtbar (Bericht)
      fo = 1;
      bo = 1;
      report.add('shape_opacity');
    }
    if (!fill || fill.a === 0) {
      o.color = '#ffffff';
      o.fillOpacity = 0;
    } else {
      o.color = toHex(fill);
      const op = r2(fo * fill.a);
      if (op < 1) o.fillOpacity = op;
    }
    // Rand
    const bw = numOr(st.borderWidth, 2);
    const bc = parseColor(st.borderColor);
    if (bw <= 0 || bo <= 0 || (bc && bc.a === 0) || st.borderColor === 'transparent') o.strokeWidth = 0;
    else {
      o.stroke = bc ? toHex(bc) : '#1a1a1a';
      const sw = roundStroke(bw);
      if (Math.abs(sw - bw) > 0.01) report.add('stroke_width');
      o.strokeWidth = sw;
      if (st.borderStyle === 'dashed' || st.borderStyle === 'dotted') o.dash = st.borderStyle;
    }
    // Text
    const fs = clamp(numOr(st.fontSize, 14), 1, 2000);
    o.fontSize = fs;
    let { doc, plain, truncated } = htmlToDoc(d.content, { baseFontSize: fs });
    const ink = hex6(st.color);
    if (!isDefaultInk(ink) && plain) doc = colorizeDoc(doc, ink!);
    setRich(o, doc, plain, truncated);
    const a = alignOf(st.textAlign);
    if (a) o.align = a;
    const v = valignOf(st.textAlignVertical);
    if (v) o.valign = v;
    setFont(o, st.fontFamily);
    return [o];
  };

  // -- Text (Hintergrundfläche → Form dahinter, gruppiert) --
  const textObj = (it: MiroItem, html: unknown, fontSizeDefault: number, extra?: (o: Obj) => void): Obj[] => {
    const st = it.style ?? {};
    const fs = clamp(numOr(st.fontSize, fontSizeDefault), 1, 2000);
    const { doc, plain, truncated } = htmlToDoc(html, { baseFontSize: fs });
    const box = { ...rawBox(it) };
    if (!Number.isFinite(num(it.geometry?.height))) {
      // Miro liefert bei Texten oft keine Höhe: aus Zeilen schätzen (der Browser misst nach)
      const lines = Math.max(1, plain.split('\n').length);
      const h = Math.round(lines * fs * 1.4 + 8);
      box.y += (box.h - h) / 2;
      box.h = h;
    }
    const o = base(it, 'text', box);
    o.fontSize = fs;
    const ink = hex6(st.color);
    o.color = ink ?? '#1a1a1a';
    setRich(o, doc, plain, truncated);
    o.align = alignOf(st.textAlign) ?? 'left';
    setFont(o, st.fontFamily);
    extra?.(o);
    const fill = parseColor(st.fillColor);
    const fo = clamp(numOr(st.fillOpacity, 1), 0, 1);
    if (!fill || fill.a * fo <= 0) return [o];
    report.add('text_background');
    const bg: Obj = { id: newId(), type: 'shape', shape: 'rect', x: o.x, y: o.y, w: o.w, h: o.h, color: toHex(fill), strokeWidth: 0 };
    const op = r2(fill.a * fo);
    if (op < 1) bg.fillOpacity = op;
    if (o.rotation !== undefined) bg.rotation = o.rotation;
    const gid = (o.groupId as string | undefined) ?? newId();
    bg.groupId = gid;
    o.groupId = gid;
    return [bg, o];
  };

  // -- Karte / App-Karte --
  const mapCard = (it: MiroItem, app: boolean): Obj[] => {
    const box = { ...rawBox(it) };
    if (box.w < 160) {
      box.x -= (160 - box.w) / 2;
      box.w = 160;
    }
    const o = base(it, 'card', box);
    const d = it.data ?? {};
    o.text = htmlToPlain(d.title).slice(0, 20_000);
    const lines: string[] = [];
    const desc = htmlToPlain(d.description);
    if (desc) lines.push(desc);
    if (app && Array.isArray(d.fields)) {
      for (const f of d.fields as Record<string, unknown>[]) {
        if (!f || typeof f !== 'object') continue;
        const value = htmlToPlain(f.value).trim();
        const name = htmlToPlain(f.tooltip).trim();
        if (value || name) lines.push(name && value ? `${name}: ${value}` : value || name);
      }
    }
    const full = lines.join('\n');
    if (full) {
      if (full.length > 20_000) report.add('text_cut');
      o.desc = full.slice(0, 20_000);
    }
    const due = typeof d.dueDate === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(d.dueDate)?.[1] : undefined;
    if (due) o.due = due;
    const color = hex6(app ? it.style?.fillColor : (it.style?.cardTheme ?? it.style?.fillColor));
    if (color) o.color = color;
    const tags = tagsFor(it);
    if (tags) o.tags = tags;
    if (d.assigneeId || d.assignee) report.add('card_assignee');
    if (app) report.add('app_card');
    return [o];
  };

  // -- Rahmen --
  const mapFrame = (it: MiroItem): Obj[] => {
    const o = base(it, 'frame');
    delete o.rotation;
    o.title = htmlToPlain(it.data?.title).replace(/\s+/g, ' ').trim().slice(0, 300);
    const fill = parseColor(it.style?.fillColor);
    if (fill && fill.a > 0) o.color = toHex(fill);
    return [o];
  };

  let assetCount = 0;
  // -- Bild --
  const mapImage = (it: MiroItem): Obj[] => {
    const url = it.data?.imageUrl;
    if (typeof url !== 'string' || !url) {
      report.add('image_missing');
      return [];
    }
    if (assetCount >= maxImages) {
      report.add('image_limit');
      return [];
    }
    const o = base(it, 'image');
    o.imageId = '';
    return [o];
  };

  // -- Dokument (nur PDF; sonst Karte mit Dateinamen) --
  const mapDocument = (it: MiroItem): Obj[] => {
    const title = htmlToPlain(it.data?.title).trim().slice(0, 300);
    const url = it.data?.documentUrl;
    const ext = /\.([a-z0-9]{1,8})$/i.exec(title)?.[1]?.toLowerCase();
    if (typeof url === 'string' && url && (!ext || ext === 'pdf')) {
      if (assetCount >= maxImages) {
        report.add('image_limit');
        return [];
      }
      const o = base(it, 'document');
      o.docFile = '';
      o.docName = title || 'Dokument.pdf';
      return [o];
    }
    report.add('document_type');
    const box = { ...rawBox(it) };
    const o = base(it, 'card', { x: box.x, y: box.y, w: Math.max(160, box.w), h: 96 });
    o.text = title || 'Datei aus Miro';
    o.desc = 'Datei aus Miro – nicht übernommen.';
    return [o];
  };

  // -- Embed / Link-Vorschau → Text mit Link --
  const mapLink = (it: MiroItem): Obj[] => {
    const d = it.data ?? {};
    const title = htmlToPlain(d.title ?? d.providerName ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
    const rawUrl = typeof d.url === 'string' ? d.url.trim() : '';
    const href = safeHref(rawUrl);
    const content: PMNode[] = [];
    if (title) content.push({ type: 'paragraph', content: [{ type: 'text', text: title, marks: [{ type: 'bold' }] }] });
    if (href && href.toLowerCase().startsWith('https:')) content.push({ type: 'paragraph', content: [{ type: 'text', text: href, marks: [linkMark(href)] }] });
    else if (rawUrl) {
      report.add('link_unsafe');
      if (/^https?:\/\//i.test(rawUrl)) content.push({ type: 'paragraph', content: [{ type: 'text', text: rawUrl.slice(0, 2048) }] });
    }
    if (!content.length) content.push({ type: 'paragraph', content: [{ type: 'text', text: 'Eingebetteter Inhalt aus Miro' }] });
    report.add('embed_link');
    const doc: PMDoc = { type: 'doc', content };
    const plain = content.map((p) => p.content?.[0]?.text ?? '').join('\n');
    const box = { ...rawBox(it) };
    const fs = 16;
    const h = Math.round(content.length * fs * 1.4 + 8);
    const o = base(it, 'text', { x: box.x, y: box.y + (box.h - h) / 2, w: Math.max(200, box.w), h });
    o.fontSize = fs;
    o.color = '#1a1a1a';
    o.align = 'left';
    o.text = plain;
    o.content = doc;
    return [o];
  };

  // -- Miro-Doc → Text mit Rich-Text --
  const mapDocFormat = (it: MiroItem): Obj[] => {
    report.add('doc_format');
    const html = data.docs?.[it.id] ?? it.data?.content ?? '<p>Miro-Doc</p>';
    return textObj({ ...it, style: { ...(it.style ?? {}), fontSize: it.style?.fontSize ?? 16, fillColor: undefined } }, html, 16);
  };

  // ---- 1. Rahmen (unten), 2. alle anderen in /items-Reihenfolge ----
  const isFrame = (it: MiroItem) => it.type === 'frame';
  const ordered = [...items.filter(isFrame), ...items.filter((i) => !isFrame(i))];
  for (const it of ordered) {
    if (mindIds.has(it.id)) continue;
    if (it.isSupported === false && !['data_table_format', 'table', 'paint', 'stroke', 'mindmap_node'].includes(it.type)) {
      report.add('unsupported_item');
      continue;
    }
    let list: Obj[];
    switch (it.type) {
      case 'sticky_note':
        list = mapSticky(it);
        break;
      case 'shape':
        list = mapShapeItem(it);
        break;
      case 'text':
        list = textObj(it, it.data?.content, 14);
        break;
      case 'card':
        list = mapCard(it, false);
        break;
      case 'app_card':
        list = mapCard(it, true);
        break;
      case 'frame':
        list = mapFrame(it);
        break;
      case 'image':
        list = mapImage(it);
        break;
      case 'document':
        list = mapDocument(it);
        break;
      case 'embed':
      case 'preview':
        list = mapLink(it);
        break;
      case 'doc_format':
        list = mapDocFormat(it);
        break;
      case 'data_table_format':
      case 'table':
        report.add('table');
        continue;
      case 'paint':
      case 'stroke':
        report.add('freehand');
        continue;
      case 'mindmap_node':
        report.add('mindmap_node');
        continue;
      default:
        report.add('unknown_type');
        report.unknownTypes.add(String(it.type).slice(0, 40));
        continue;
    }
    if (!emit(it.id, list)) continue;
    for (const o of list) {
      if (o.type === 'image') {
        assetCount++;
        assets.push({ objectId: o.id, kind: 'image', apiUrl: String(it.data!.imageUrl), ...(it.data?.title ? { title: htmlToPlain(it.data.title).slice(0, 300) } : {}) });
      } else if (o.type === 'document') {
        assetCount++;
        assets.push({ objectId: o.id, kind: 'document', apiUrl: String(it.data!.documentUrl), title: o.docName as string });
      }
    }
  }

  // ---- 3. Mindmaps (Bäume für mind.tree; IDs wie web-impl: Wurzel = rootId, dann `${rootId}-${n}` in Vorordnung) ----
  const minds: MappedBoard['minds'] = [];
  if (mindNodes.length) {
    const kids = new Map<string, MiroMindNode[]>();
    const roots: MiroMindNode[] = [];
    for (const n of mindNodes) {
      const p = n.parent && typeof n.parent.id === 'string' ? n.parent.id : undefined;
      if (n.data?.isRoot === true || !p || !mindIds.has(p) || p === n.id) roots.push(n);
      else {
        const list = kids.get(p) ?? [];
        list.push(n);
        kids.set(p, list);
      }
    }
    const center = (n: MiroMindNode) => {
      const b = rawBox(n);
      return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    };
    const order = (list: MiroMindNode[]) => list.slice().sort((a, b) => center(a).y - center(b).y || center(a).x - center(b).x);
    const textOf = (n: MiroMindNode) => {
      const html = n.data?.nodeView?.data?.content ?? n.data?.content ?? n.data?.text ?? '';
      return htmlToPlain(html).replace(/\s*\n\s*/g, ' ').trim().slice(0, NATIVE_MIND_LIMITS.maxText);
    };
    const visited = new Set<string>();
    let dropped = 0;
    const countAll = (n: MiroMindNode): number => {
      if (visited.has(n.id)) return 0;
      visited.add(n.id);
      return 1 + (kids.get(n.id) ?? []).reduce((s, k) => s + countAll(k), 0);
    };
    for (const root of order(roots)) {
      if (visited.has(root.id)) continue;
      const rootId = newId();
      let n = 0;
      let count = 0;
      const rc = center(root);
      const build = (node: MiroMindNode, depth: number, idHere: string): MindTree => {
        visited.add(node.id);
        idMap.set(node.id, idHere);
        count++;
        const tree: MindTree = { text: textOf(node) };
        if (depth === 2) {
          const dir = node.data?.direction;
          tree.side = dir === 'start' ? 'l' : dir === 'end' ? 'r' : center(node).x < rc.x ? 'l' : 'r';
        }
        const children: MindTree[] = [];
        for (const k of order(kids.get(node.id) ?? [])) {
          if (visited.has(k.id)) continue;
          if (depth + 1 > NATIVE_MIND_LIMITS.maxDepth || count >= NATIVE_MIND_LIMITS.maxNodes || count >= budgetLeft()) {
            dropped += countAll(k);
            continue;
          }
          children.push(build(k, depth + 1, `${rootId}-${++n}`));
        }
        if (children.length) tree.children = children;
        return tree;
      };
      if (budgetLeft() < 1) {
        const lost = countAll(root);
        report.add('object_limit', lost);
        continue;
      }
      const tree = build(root, 1, rootId);
      mindCount += count;
      minds.push({ rootId, x: r2(rc.x), y: r2(rc.y), tree });
      report.add('mindmap_layout');
    }
    report.add('mindmap_limit', dropped);
    if (mindCount) report.imported.mindnode = mindCount;
  }

  // ---- 4. Verbinder (oben) ----
  const endPoint = (end: MiroConnectorEnd | null | undefined): { end: Record<string, unknown>; at: { x: number; y: number } } | null => {
    const mid = end && typeof end.id === 'string' ? end.id : undefined;
    if (!mid) return null;
    const sid = idMap.get(mid);
    const rawIt = raw.get(mid);
    const rb = rawIt ? rawBox(rawIt) : undefined;
    if (sid) {
      const b = boxes.get(sid) ?? rb;
      const at = b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : { x: 0, y: 0 };
      const e: Record<string, unknown> = { objectId: sid };
      const side = mindIds.has(mid) ? undefined : sideOf(end);
      if (side) e.side = side;
      return { end: e, at };
    }
    if (rb) {
      report.add('connector_free_end');
      const at = { x: r2(clamp(rb.x + rb.w / 2, -COORD, COORD)), y: r2(clamp(rb.y + rb.h / 2, -COORD, COORD)) };
      return { end: { ...at }, at };
    }
    return null;
  };
  const extraTexts: Obj[] = [];
  for (const c of (data.connectors ?? []) as MiroConnector[]) {
    if (!c || typeof c.id !== 'string') continue;
    const a = endPoint(c.startItem);
    const b = endPoint(c.endItem);
    if (!a || !b) {
      report.add('connector_no_end');
      continue;
    }
    const st = c.style ?? {};
    const minX = Math.min(a.at.x, b.at.x);
    const minY = Math.min(a.at.y, b.at.y);
    const o: Obj = {
      id: newId(),
      type: 'connector',
      x: r2(minX),
      y: r2(minY),
      w: r2(Math.max(1, Math.abs(a.at.x - b.at.x))),
      h: r2(Math.max(1, Math.abs(a.at.y - b.at.y))),
      from: a.end,
      to: b.end,
    };
    const ls = mapLineStyle(c.shape);
    if (ls !== 'straight') o.lineStyle = ls;
    const caps: [CapStyle, CapStyle] = [mapCap(st.startStrokeCap, 'start').cap, mapCap(st.endStrokeCap, 'end').cap];
    for (const [k, v] of [['start', st.startStrokeCap], ['end', st.endStrokeCap]] as const) {
      const note = mapCap(v, k).note;
      if (note === 'erd') report.add('connector_erd');
      else if (note === 'unknown') report.add('connector_cap_unknown');
    }
    // wie capPatch (web/src/features/shapes/model.ts): arrowStart/arrowEnd passend für ältere Clients, `triangle` ohne capX
    if (caps[0] !== 'none') o.arrowStart = true;
    if (caps[0] !== 'none' && caps[0] !== 'triangle') o.capStart = caps[0];
    o.arrowEnd = caps[1] !== 'none';
    if (caps[1] !== 'none' && caps[1] !== 'triangle') o.capEnd = caps[1];
    o.color = hex6(st.strokeColor) ?? '#1a1a1a';
    const swRaw = numOr(st.strokeWidth, 2);
    const sw = roundStroke(swRaw);
    if (Math.abs(sw - swRaw) > 0.01) report.add('stroke_width');
    o.strokeWidth = sw;
    if (st.strokeStyle === 'dashed' || st.strokeStyle === 'dotted') o.dash = st.strokeStyle;
    const caps0 = Array.isArray(c.captions) ? c.captions.filter((x) => x && typeof x.content === 'string' && htmlToPlain(x.content).trim()) : [];
    const fs = numOr(st.fontSize, NaN);
    if (caps0.length) {
      const first = caps0[0]!;
      let { doc, plain, truncated } = htmlToDoc(first.content);
      const ink = hex6(st.color);
      if (!isDefaultInk(ink)) doc = colorizeDoc(doc, ink!);
      setRich(o, doc, plain, truncated);
      const p = pct(first.position);
      if (Number.isFinite(p) && Math.abs(p - 0.5) > 0.001) o.labelPos = r2(clamp(p, 0, 1));
      if (Number.isFinite(fs)) o.fontSize = clamp(fs, 1, 2000);
      setFont(o, st.fontFamily);
      if (st.textOrientation === 'aligned') report.add('connector_text_orientation');
      for (const extra of caps0.slice(1)) {
        const t = clamp(numOr(pct(extra.position), 0.5), 0, 1);
        const px = a.at.x + (b.at.x - a.at.x) * t;
        const py = a.at.y + (b.at.y - a.at.y) * t;
        const efs = Number.isFinite(fs) ? clamp(fs, 1, 2000) : 14;
        const r = htmlToDoc(extra.content, { baseFontSize: efs });
        const lines = Math.max(1, r.plain.split('\n').length);
        const w = 200;
        const h = Math.round(lines * efs * 1.4 + 8);
        const to: Obj = { id: newId(), type: 'text', x: r2(px - w / 2), y: r2(py - h / 2), w, h, fontSize: efs, color: ink ?? '#1a1a1a', align: 'center' };
        setRich(to, r.doc, r.plain, r.truncated);
        extraTexts.push(to);
        report.add('connector_caption_extra');
      }
    }
    if (!emit(undefined, [o])) continue;
  }
  for (const t of extraTexts) emit(undefined, [t]);

  // ---- 5. Board-Beschreibung als Text oben links ----
  let descriptionId: string | undefined;
  const descText = typeof data.board?.description === 'string' ? data.board.description.replace(/\r\n?/g, '\n').trim() : '';
  if (opts.description !== false && descText) {
    let minX = Infinity;
    let minY = Infinity;
    for (const o of objects) {
      if (o.type === 'connector') continue;
      minX = Math.min(minX, o.x);
      minY = Math.min(minY, o.y);
    }
    for (const m of minds) {
      minX = Math.min(minX, m.x - 100);
      minY = Math.min(minY, m.y - 30);
    }
    if (!Number.isFinite(minX)) minX = minY = 0;
    const fs = 20;
    const w = 640;
    const text = descText.slice(0, 20_000);
    if (descText.length > 20_000) report.add('text_cut');
    const perLine = Math.max(10, Math.floor(w / (fs * 0.5)));
    const lines = text.split('\n').reduce((s, l) => s + Math.max(1, Math.ceil(l.length / perLine)), 0);
    const h = Math.round(lines * fs * 1.4 + 8);
    descriptionId = newId();
    emit(undefined, [{ id: descriptionId, type: 'text', x: r2(minX), y: r2(minY - h - 60), w, h, fontSize: fs, color: '#1a1a1a', align: 'left', text }]);
  }

  // ---- Gruppen mit nur einem Mitglied auflösen ----
  const groupCount = new Map<string, number>();
  for (const o of objects) if (typeof o.groupId === 'string') groupCount.set(o.groupId, (groupCount.get(o.groupId) ?? 0) + 1);
  for (const o of objects) if (typeof o.groupId === 'string' && (groupCount.get(o.groupId) ?? 0) < 2) delete o.groupId;

  for (const o of objects) report.imported[o.type] = (report.imported[o.type] ?? 0) + 1;
  const title = (typeof data.board?.name === 'string' ? data.board.name.replace(/\s+/g, ' ').trim() : '').slice(0, 200) || 'Import aus Miro';
  return { title, objects, minds, assets, report: report.build(), ...(descriptionId ? { descriptionId } : {}) };
}
