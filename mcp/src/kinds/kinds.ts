// Objekttypen für den Assistenten: Anlegen (Schema + Bau), Lesen (kompakte Sicht) und Ändern (erlaubte Felder).
// Neue Typen (z. B. Timeline, PDF) kommen als weiterer Eintrag in KINDS dazu; die Tools richten sich danach.
// Datenformat: docs/contract.md §4, docs/features/{shapes,structure,tools,richtext}.md.
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { NewObj, Obj, Patch } from '../board/model';
import { colorLabel, STICKY_COLORS } from '../board/palette';
import { autoTextWidth, cardHeight, CARD_COLORS, CARD_W, tableH, textHeight } from '../layout/sizes';
import { tableFrom } from '../../../web/src/features/structure/table/model';
import { STICKY_RECT_RATIO } from '../../../web/src/features/shapes/stickyGeom';
import {
  Align,
  Cap,
  color,
  ColorStr,
  Dash,
  End,
  FontFamily,
  LineStyle,
  mustGet,
  placeFields,
  Size,
  Tag,
  textFields,
  textOf,
  ToolError,
  TextMd,
  VAlign,
  type BuildCtx,
} from './common';

export const SHAPE_KINDS = [
  'rect', 'roundrect', 'ellipse', 'diamond', 'triangle', 'pentagon', 'hexagon', 'octagon', 'star', 'parallelogram', 'trapezoid',
  'cylinder', 'cloud', 'callout', 'arrowRight', 'arrowLeft', 'arrowDouble', 'arrowUp', 'arrowDown', 'chevron', 'cross',
  'braceLeft', 'braceRight', 'terminator', 'document', 'predefined', 'manualInput', 'delay', 'pentagonArrow', 'heart',
  'manualOperation', 'offPage', 'merge', 'card', 'sort', 'multiDocument', 'display', 'storedData', 'internalStorage', 'summing', 'or',
] as const;
export const STAMPS = ['like', 'heart', 'check', 'question', 'plusOne', 'star', 'exclaim', 'dislike'] as const;
export const CARD_STATUS = ['todo', 'doing', 'blocked', 'done'] as const;

type Built = NewObj & { id: string };

export interface Kind {
  type: string;
  label: string;
  /** Beschreibung für Schema-Ressource und Tool-Texte */
  about: string;
  /** Eintrag in create_objects (mit `type`-Literal); fehlt = nur über eigene Tools bzw. gar nicht anlegbar */
  create?: z.ZodObject<any>;
  build?(input: any, ctx: BuildCtx): Built;
  /** Felder, die update_objects bei diesem Typ ändern darf */
  updatable: readonly string[];
  patch?(o: Obj, u: UpdateInput, ctx: BuildCtx): Patch;
  /** typspezifische Felder der kompakten Sicht */
  read(o: Obj): Record<string, unknown>;
}

const BOX = ['x', 'y', 'w', 'h', 'rotation', 'locked', 'hidden', 'linkTo'] as const;
const TEXTUAL = ['text', 'fontSize', 'bold', 'italic', 'strike', 'align', 'fontFamily'] as const;

const tagsOut = (tags: unknown) =>
  Array.isArray(tags) && tags.length ? tags.map((t: { label?: string; color?: string }) => (t.color ? `${t.label} (${colorLabel(t.color)?.split(' ')[0]})` : t.label)) : undefined;
const tagsIn = (tags: z.infer<typeof Tag>[] | undefined) =>
  tags === undefined ? undefined : tags.slice(0, 8).map((t, i) => ({ label: t.label.trim(), color: color(t.color, 'ink', `tags[${i}].color`) ?? '#1763b5' }));

const formatOut = (o: Obj) => ({
  fontSize: o.fontSize,
  bold: o.bold || undefined,
  italic: o.italic || undefined,
  align: o.align,
  valign: o.valign,
  fontFamily: o.fontFamily,
});

// ---- Haftnotiz ------------------------------------------------------------------------------------------------------

const StickyCreate = z
  .object({
    type: z.literal('sticky'),
    text: TextMd.optional(),
    color: ColorStr.optional().describe('Notizfarbe (Standard yellow); passende Namen: yellow, green, pink, blue, orange, violet, white'),
    shape: z.enum(['square', 'rect']).optional().describe('square = 200×200 (Standard), rect = 350×200 (Rechteck)'),
    size: Size(80, 1200).optional().describe('Höhe in Punkten (Standard 200); Breite folgt aus shape'),
    tags: z.array(Tag).max(8).optional(),
    fontSize: Size(6, 200).optional().describe('feste Schriftgröße; ohne passt sie sich automatisch an'),
    align: Align.optional(),
    valign: VAlign.optional(),
    ...placeFields,
  })
  .strict();

const sticky: Kind = {
  type: 'sticky',
  label: 'Haftnotiz',
  about: 'Haftnotiz (Standard 200×200, Rechteck 350×200); Schrift passt sich automatisch an.',
  create: StickyCreate,
  build(i: z.infer<typeof StickyCreate>) {
    const h = i.size ?? 200;
    const w = i.shape === 'rect' ? Math.round(h * STICKY_RECT_RATIO) : h;
    return {
      id: nanoid(),
      type: 'sticky',
      x: i.x ?? 0,
      y: i.y ?? 0,
      w,
      h,
      color: color(i.color, 'fill') ?? STICKY_COLORS[0],
      ...textFields(i.text ?? '', 'sticky'),
      tags: tagsIn(i.tags),
      fontSize: i.fontSize,
      align: i.align,
      valign: i.valign,
      rotation: i.rotation,
    };
  },
  updatable: [...BOX, ...TEXTUAL, 'valign', 'color', 'tags', 'shape'],
  patch(o, u) {
    const p: Patch = {};
    if (u.tags !== undefined) p.tags = u.tags.length ? tagsIn(u.tags) : undefined;
    if (u.shape !== undefined) {
      if (u.shape !== 'square' && u.shape !== 'rect') throw new ToolError('Bei Haftnotizen ist `shape` "square" oder "rect".');
      const w = u.shape === 'rect' ? Math.round(o.h * STICKY_RECT_RATIO) : o.h;
      p.x = Math.round(o.x + (o.w - w) / 2);
      p.w = w;
    }
    return p;
  },
  read: (o) => {
    const r = o.w / Math.max(1, o.h);
    return { text: textOf(o), color: colorLabel(o.color), shape: Math.abs(r - 1) < 0.03 ? 'square' : Math.abs(r - STICKY_RECT_RATIO) < 0.04 ? 'rect' : 'free', tags: tagsOut(o.tags), ...formatOut(o) };
  },
};

// ---- Text -------------------------------------------------------------------------------------------------------------

const TextCreate = z
  .object({
    type: z.literal('text'),
    text: TextMd,
    fontSize: Size(6, 400).optional().describe('Schriftgröße (Standard 24; Überschrift 40–64, Untertitel 28–32, Fließtext 18–24)'),
    color: ColorStr.optional().describe('Textfarbe (Standard black)'),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    align: Align.optional(),
    fontFamily: FontFamily.optional(),
    width: Size(20, 4000).optional().describe('feste Breite mit Zeilenumbruch; ohne passt sich die Breite dem Text an'),
    ...placeFields,
  })
  .strict();

const text: Kind = {
  type: 'text',
  label: 'Text',
  about: 'Freier Text ohne Hintergrund (Überschriften, Beschriftungen); Breite folgt dem Text, außer `width` ist gesetzt.',
  create: TextCreate,
  build(i: z.infer<typeof TextCreate>) {
    const tf = textFields(i.text, 'text');
    const fontSize = i.fontSize ?? 24;
    const fmt = { text: String(tf.text), fontSize, bold: i.bold, italic: i.italic };
    return {
      id: nanoid(),
      type: 'text',
      x: i.x ?? 0,
      y: i.y ?? 0,
      w: i.width ?? autoTextWidth(fmt),
      h: textHeight(fmt, i.width),
      fontSize,
      ...tf,
      color: color(i.color, 'ink') ?? '#0a0a0a',
      bold: i.bold || undefined,
      italic: i.italic || undefined,
      align: i.align,
      fontFamily: i.fontFamily && i.fontFamily !== 'default' ? i.fontFamily : undefined,
      autoWidth: i.width ? undefined : true,
      rotation: i.rotation,
    };
  },
  updatable: [...BOX, ...TEXTUAL, 'color'],
  patch(o, u) {
    const p: Patch = {};
    // Breite folgt dem Text, solange autoWidth an ist (wie adjustPatch in der Web-App); feste Breite schaltet es aus
    if (u.w !== undefined) p.autoWidth = undefined;
    const next = { text: (u.text !== undefined ? String(textFields(u.text, 'text').text) : o.text) as string, fontSize: u.fontSize ?? o.fontSize, bold: u.bold ?? o.bold, italic: u.italic ?? o.italic };
    if (o.autoWidth && u.w === undefined && (u.text !== undefined || u.fontSize !== undefined || u.bold !== undefined)) p.w = autoTextWidth(next);
    if (u.h === undefined && (u.text !== undefined || u.fontSize !== undefined || u.w !== undefined)) p.h = textHeight(next, o.autoWidth && u.w === undefined ? undefined : (u.w ?? o.w));
    return p;
  },
  read: (o) => ({ text: textOf(o), color: colorLabel(o.color), autoWidth: o.autoWidth || undefined, ...formatOut(o) }),
};

// ---- Form -------------------------------------------------------------------------------------------------------------

const ShapeCreate = z
  .object({
    type: z.literal('shape'),
    shape: z.enum(SHAPE_KINDS).optional().describe('Formart (Standard rect). Flussdiagramm: rect Prozess, diamond Entscheidung, parallelogram Daten, terminator Start/Ende, cylinder Datenbank, document Dokument'),
    text: TextMd.optional(),
    w: Size(8, 20000).optional().describe('Breite (Standard 180)'),
    h: Size(8, 20000).optional().describe('Höhe (Standard 120)'),
    color: ColorStr.optional().describe('Füllfarbe (Standard white)'),
    stroke: ColorStr.optional().describe('Randfarbe (Standard black)'),
    strokeWidth: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(4), z.literal(8)]).optional().describe('Randstärke 0 (ohne), 1, 2 (Standard), 4, 8'),
    dash: Dash.optional().describe('Randart'),
    fillOpacity: z.number().min(0).max(1).optional().describe('Deckkraft der Füllung 0…1'),
    fontSize: Size(6, 200).optional().describe('größte Schriftgröße (Standard 20; schrumpft, wenn der Text sonst nicht passt)'),
    bold: z.boolean().optional(),
    align: Align.optional(),
    valign: VAlign.optional(),
    fontFamily: FontFamily.optional(),
    ...placeFields,
  })
  .strict();

const shape: Kind = {
  type: 'shape',
  label: 'Form',
  about: `Form mit Text (Standard 180×120, weiß mit schwarzem Rand). Formarten: ${SHAPE_KINDS.join(', ')}.`,
  create: ShapeCreate,
  build(i: z.infer<typeof ShapeCreate>) {
    return {
      id: nanoid(),
      type: 'shape',
      shape: i.shape ?? 'rect',
      x: i.x ?? 0,
      y: i.y ?? 0,
      w: i.w ?? 180,
      h: i.h ?? 120,
      color: color(i.color, 'fill') ?? '#ffffff',
      stroke: color(i.stroke, 'ink', 'stroke') ?? '#0a0a0a',
      strokeWidth: i.strokeWidth ?? 2,
      dash: i.dash && i.dash !== 'solid' ? i.dash : undefined,
      fillOpacity: i.fillOpacity,
      fontSize: i.fontSize ?? 20,
      ...textFields(i.text ?? '', 'shape'),
      bold: i.bold || undefined,
      align: i.align,
      valign: i.valign,
      fontFamily: i.fontFamily && i.fontFamily !== 'default' ? i.fontFamily : undefined,
      rotation: i.rotation,
    };
  },
  updatable: [...BOX, ...TEXTUAL, 'valign', 'color', 'shape', 'stroke', 'strokeWidth', 'dash', 'fillOpacity'],
  patch(_o, u) {
    const p: Patch = {};
    if (u.shape !== undefined) {
      if (!(SHAPE_KINDS as readonly string[]).includes(u.shape)) throw new ToolError(`Unbekannte Formart „${u.shape}“. Erlaubt: ${SHAPE_KINDS.join(', ')}.`);
      p.shape = u.shape;
    }
    if (u.stroke !== undefined) p.stroke = color(u.stroke, 'ink', 'stroke');
    if (u.strokeWidth !== undefined) p.strokeWidth = u.strokeWidth;
    if (u.dash !== undefined) p.dash = u.dash === 'solid' ? undefined : u.dash;
    if (u.fillOpacity !== undefined) p.fillOpacity = u.fillOpacity >= 1 ? undefined : u.fillOpacity;
    return p;
  },
  read: (o) => ({
    shape: o.shape ?? 'rect',
    text: textOf(o) || undefined,
    color: colorLabel(o.color),
    stroke: o.strokeWidth === 0 ? 'none' : colorLabel(o.stroke ?? '#0a0a0a'),
    strokeWidth: o.strokeWidth,
    dash: o.dash,
    fillOpacity: o.fillOpacity,
    ...formatOut(o),
  }),
};

// ---- Rahmen -----------------------------------------------------------------------------------------------------------

const FORMATS: Record<string, [number, number]> = { '16:9': [1280, 720], '4:3': [1024, 768], a4: [794, 1123], 'a4-quer': [1123, 794], handy: [390, 844], quadrat: [800, 800] };

const FrameCreate = z
  .object({
    type: z.literal('frame'),
    title: z.string().max(120).optional().describe('Titel (steht über dem Rahmen)'),
    w: Size(40, 50000).optional().describe('Breite (Standard 800)'),
    h: Size(40, 50000).optional().describe('Höhe (Standard 600)'),
    format: z.enum(['16:9', '4:3', 'a4', 'a4-quer', 'handy', 'quadrat']).optional().describe('feste Größe statt w/h (z. B. 16:9 = 1280×720 für Folien)'),
    color: ColorStr.optional().describe('Hintergrund (Standard white)'),
    ...placeFields,
  })
  .strict();

const frame: Kind = {
  type: 'frame',
  label: 'Rahmen',
  about: 'Rahmen (Bereich/Folie mit Titel); liegt immer unter allem anderen; enthält geometrisch alles, was ganz darin liegt. Verschieben nimmt den Inhalt mit.',
  create: FrameCreate,
  build(i: z.infer<typeof FrameCreate>, ctx) {
    const [fw, fh] = i.format ? FORMATS[i.format]! : [i.w ?? 800, i.h ?? 600];
    const n = ctx.all.filter((o) => o.type === 'frame').length + [...ctx.pending.values()].filter((o) => o.type === 'frame').length;
    return { id: nanoid(), type: 'frame', x: i.x ?? 0, y: i.y ?? 0, w: fw, h: fh, title: i.title ?? `Rahmen ${n + 1}`, color: color(i.color, 'fill') ?? '#ffffff' };
  },
  updatable: ['x', 'y', 'w', 'h', 'locked', 'hidden', 'linkTo', 'title', 'color'],
  patch(_o, u) {
    return u.title !== undefined ? { title: u.title } : {};
  },
  read: (o) => ({ title: o.title, color: colorLabel(o.color) }),
};

// ---- Karte ------------------------------------------------------------------------------------------------------------

const CardCreate = z
  .object({
    type: z.literal('card'),
    title: z.string().min(1).max(300),
    desc: z.string().max(5000).optional().describe('Beschreibung (Klartext)'),
    status: z.enum(CARD_STATUS).optional().describe('todo Offen, doing In Arbeit, blocked Blockiert, done Erledigt'),
    due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Fälligkeit YYYY-MM-DD'),
    tags: z.array(Tag).max(8).optional(),
    assignee: z.string().max(120).optional().describe('zuständige Person (Name, wie sie sich bei Stachel angemeldet hat)'),
    color: ColorStr.optional().describe('Farbstreifen links (Standard blue)'),
    w: Size(160, 2000).optional().describe('Breite (Standard 300)'),
    ...placeFields,
  })
  .strict();

function person(ctx: BuildCtx, name: string) {
  const n = name.trim().toLowerCase();
  const hit = ctx.people.find((p) => p.name.toLowerCase() === n) ?? ctx.people.find((p) => p.name.toLowerCase().startsWith(n));
  if (!hit) throw new ToolError(`Person „${name}“ kenne ich nicht. Bekannt: ${ctx.people.map((p) => p.name).join(', ') || '(niemand)'}.`);
  return { key: hit.key, name: hit.name };
}

const chipsOf = (c: { status?: string; tags?: unknown[]; due?: string }) => (c.status ? 1 : 0) + (c.tags?.length ?? 0) + (c.due ? 1 : 0);

const card: Kind = {
  type: 'card',
  label: 'Karte',
  about: 'Aufgabenkarte (Titel, Beschreibung, Status, Fälligkeit, Tags, zuständige Person) mit Farbstreifen – für Kanban und Planung.',
  create: CardCreate,
  build(i: z.infer<typeof CardCreate>, ctx) {
    const w = i.w ?? CARD_W;
    const tags = tagsIn(i.tags);
    return {
      id: nanoid(),
      type: 'card',
      x: i.x ?? 0,
      y: i.y ?? 0,
      w,
      h: cardHeight(w, i.title, i.desc, chipsOf({ status: i.status, tags, due: i.due })),
      text: i.title,
      desc: i.desc,
      status: i.status,
      due: i.due,
      tags,
      assignee: i.assignee ? person(ctx, i.assignee) : undefined,
      color: color(i.color, 'ink') ?? CARD_COLORS[0],
    };
  },
  updatable: ['x', 'y', 'w', 'locked', 'hidden', 'linkTo', 'title', 'desc', 'status', 'due', 'tags', 'assignee', 'color'],
  patch(o, u, ctx) {
    const p: Patch = {};
    if (u.title !== undefined) p.text = u.title;
    if (u.desc !== undefined) p.desc = u.desc || undefined;
    if (u.status !== undefined) {
      if (u.status !== 'none' && !(CARD_STATUS as readonly string[]).includes(u.status)) throw new ToolError('`status` einer Karte: todo, doing, blocked, done oder none.');
      p.status = u.status === 'none' ? undefined : u.status;
    }
    if (u.due !== undefined) p.due = u.due || undefined;
    if (u.tags !== undefined) p.tags = u.tags.length ? tagsIn(u.tags) : undefined;
    if (u.assignee !== undefined) p.assignee = u.assignee ? person(ctx, u.assignee) : undefined;
    const next = { ...o, ...p } as Obj;
    const w = u.w ?? o.w;
    p.h = cardHeight(w, String(next.text ?? ''), typeof next.desc === 'string' ? next.desc : undefined, chipsOf(next as { status?: string; tags?: unknown[]; due?: string }));
    return p;
  },
  read: (o) => ({
    title: o.text,
    desc: o.desc || undefined,
    status: o.status,
    due: o.due,
    tags: tagsOut(o.tags),
    assignee: (o.assignee as { name?: string } | undefined)?.name,
    color: colorLabel(o.color),
  }),
};

// ---- Tabelle ----------------------------------------------------------------------------------------------------------

const TableCreate = z
  .object({
    type: z.literal('table'),
    rows: z.array(z.array(z.string().max(2000)).min(1).max(40)).min(1).max(300).describe('Zeilen mit Zelltexten; die erste Zeile ist die Kopfzeile'),
    w: Size(80, 20000).optional().describe('Gesamtbreite (Standard 160 je Spalte, mindestens 320)'),
    columnWidths: z.array(z.number().positive().max(100)).optional().describe('relative Spaltenbreiten, z. B. [2,1,1]'),
    head: z.enum(['row', 'col', 'both', 'none']).optional().describe('Kopf hervorheben: row (Standard), col, both, none'),
    color: ColorStr.optional().describe('Farbe der Kopfzeile (Standard black)'),
    ...placeFields,
  })
  .strict();

const tableKind: Kind = {
  type: 'table',
  label: 'Tabelle',
  about: 'Tabelle mit Kopfzeile; Zeilenhöhe folgt dem Text.',
  create: TableCreate,
  build(i: z.infer<typeof TableCreate>) {
    const cols = Math.max(...i.rows.map((r) => r.length));
    const w = i.w ?? Math.max(320, cols * 160);
    const data = tableFrom(i.rows, i.columnWidths);
    const head = i.head ?? 'row';
    return { id: nanoid(), type: 'table', x: i.x ?? 0, y: i.y ?? 0, w, h: tableH(data, w, head), table: data, color: color(i.color, 'ink') ?? '#0a0a0a', tableHead: head !== 'row' ? head : undefined };
  },
  updatable: ['x', 'y', 'w', 'locked', 'hidden', 'linkTo', 'rows', 'head', 'columnWidths', 'color'],
  patch(o, u) {
    const p: Patch = {};
    let data = o.table as ReturnType<typeof tableFrom>;
    if (u.rows !== undefined) {
      data = tableFrom(u.rows, u.columnWidths);
      p.table = data;
    } else if (u.columnWidths !== undefined && data) {
      const widths: Record<string, number> = {};
      data.cols.forEach((c, i) => {
        const v = u.columnWidths![i];
        if (v !== undefined && v !== 1) widths[c] = v;
      });
      data = { ...data, widths };
      p.table = data;
    }
    if (u.head !== undefined) p.tableHead = u.head === 'row' ? undefined : u.head;
    if (data) p.h = tableH(data, u.w ?? o.w, u.head ?? o.tableHead ?? 'row');
    return p;
  },
  read: (o) => {
    const d = o.table as { rows?: string[]; cols?: string[]; cells?: Record<string, string> } | undefined;
    const rows = d?.rows && d.cols ? d.rows.map((r) => d.cols!.map((c) => d.cells?.[`${r}:${c}`] ?? '')) : undefined;
    return { rows, head: o.tableHead ?? 'row', color: colorLabel(o.color) };
  },
};

// ---- Sticker ----------------------------------------------------------------------------------------------------------

const StickerCreate = z
  .object({
    type: z.literal('sticker'),
    emoji: z.string().min(1).max(16).optional().describe('ein Emoji, z. B. "🌵"'),
    stamp: z.enum(STAMPS).optional().describe('Stempel statt Emoji'),
    size: Size(16, 2000).optional().describe('Kantenlänge (Standard 96)'),
    ...placeFields,
  })
  .strict();

const sticker: Kind = {
  type: 'sticker',
  label: 'Sticker',
  about: `Emoji oder Stempel (${STAMPS.join(', ')}).`,
  create: StickerCreate,
  build(i: z.infer<typeof StickerCreate>) {
    if (!i.emoji === !i.stamp) throw new ToolError('Sticker: genau eins von `emoji` oder `stamp` angeben.');
    const s = i.size ?? 96;
    return { id: nanoid(), type: 'sticker', x: i.x ?? 0, y: i.y ?? 0, w: s, h: s, emoji: i.emoji, stamp: i.stamp, rotation: i.rotation };
  },
  updatable: [...BOX, 'emoji', 'stamp'],
  patch(_o, u) {
    const p: Patch = {};
    if (u.emoji !== undefined) Object.assign(p, { emoji: u.emoji, stamp: undefined });
    if (u.stamp !== undefined) {
      if (!(STAMPS as readonly string[]).includes(u.stamp)) throw new ToolError(`Stempel: ${STAMPS.join(', ')}.`);
      Object.assign(p, { stamp: u.stamp, emoji: undefined });
    }
    return p;
  },
  read: (o) => ({ emoji: o.emoji, stamp: o.stamp }),
};

// ---- Verbinder --------------------------------------------------------------------------------------------------------

export const ConnectorFields = {
  from: End.describe('Start: id/ref eines Objekts, {id, side} oder {x, y}'),
  to: End.describe('Ziel: id/ref eines Objekts, {id, side} oder {x, y}'),
  label: z.string().max(500).optional().describe('Beschriftung in der Linienmitte'),
  style: LineStyle.optional(),
  startCap: Cap.optional().describe('Spitze am Anfang (Standard none)'),
  endCap: Cap.optional().describe('Spitze am Ende (Standard triangle = Pfeil)'),
  color: ColorStr.optional().describe('Linienfarbe (Standard black)'),
  width: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(6), z.literal(8)]).optional().describe('Linienstärke (Standard 2)'),
  dash: Dash.optional(),
  labelPosition: z.number().min(0.02).max(0.98).optional().describe('Lage der Beschriftung entlang der Linie 0…1 (Standard 0,5)'),
};

const ConnectorCreate = z.object({ type: z.literal('connector'), ref: placeFields.ref, ...ConnectorFields }).strict();

/** Ende eines Verbinders auflösen (id/ref/{id,side}/{x,y}). */
export function resolveEnd(e: z.infer<typeof End>, ctx: BuildCtx, field: string): { objectId: string; side?: string } | { x: number; y: number } {
  if (typeof e === 'string') {
    const o = mustGet(ctx, e, `Ziel von \`${field}\``);
    if (o.type === 'connector') throw new ToolError(`\`${field}\` zeigt auf einen Verbinder – Verbinder verbinden nur Objekte.`);
    return { objectId: o.id };
  }
  if ('id' in e) {
    const o = mustGet(ctx, e.id, `Ziel von \`${field}\``);
    if (o.type === 'connector') throw new ToolError(`\`${field}\` zeigt auf einen Verbinder – Verbinder verbinden nur Objekte.`);
    return e.side ? { objectId: o.id, side: e.side } : { objectId: o.id };
  }
  return { x: e.x, y: e.y };
}

/** Spitzen wie shapes/model.ts `capPatch`: arrowStart/arrowEnd für ältere Clients passend mitschreiben. */
function capFields(end: 'start' | 'end', cap: string): Patch {
  const value = cap === 'triangle' || cap === 'none' ? undefined : cap;
  return end === 'start' ? { capStart: value, arrowStart: cap === 'none' ? undefined : true } : { capEnd: value, arrowEnd: cap !== 'none' };
}

export function buildConnector(i: z.infer<typeof ConnectorCreate> | (Record<string, any> & { from: unknown; to: unknown }), ctx: BuildCtx): Built {
  const from = resolveEnd(i.from as z.infer<typeof End>, ctx, 'from');
  const to = resolveEnd(i.to as z.infer<typeof End>, ctx, 'to');
  if ('objectId' in from && 'objectId' in to && from.objectId === to.objectId) throw new ToolError('Ein Verbinder braucht zwei verschiedene Objekte (from = to).');
  const attached = 'objectId' in from && 'objectId' in to;
  const style = i.style ?? (attached ? 'curved' : 'straight');
  return {
    id: nanoid(),
    type: 'connector',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    from,
    to,
    color: color(i.color, 'ink') ?? '#0a0a0a',
    strokeWidth: i.width ?? 2,
    lineStyle: style === 'straight' ? undefined : style,
    dash: i.dash && i.dash !== 'solid' ? i.dash : undefined,
    ...(i.label ? textFields(i.label, 'connector') : {}),
    labelPos: i.labelPosition,
    ...capFields('start', i.startCap ?? 'none'),
    ...capFields('end', i.endCap ?? 'triangle'),
  };
}

const endOut = (e: any) => (e && typeof e === 'object' ? ('objectId' in e ? (e.side ? { id: e.objectId, side: e.side } : e.objectId) : { x: Math.round(e.x), y: Math.round(e.y) }) : undefined);
const capOut = (o: Obj, end: 'start' | 'end') => {
  const c = end === 'start' ? o.capStart : o.capEnd;
  if (typeof c === 'string') return c;
  return end === 'start' ? (o.arrowStart ? 'triangle' : 'none') : o.arrowEnd !== false ? 'triangle' : 'none';
};

const connector: Kind = {
  type: 'connector',
  label: 'Verbinder',
  about: 'Linie/Pfeil zwischen zwei Objekten (dockt an, wandert mit) oder freien Punkten; Beschriftung, Linienart, Spitzen.',
  create: ConnectorCreate,
  build: buildConnector,
  updatable: ['from', 'to', 'label', 'text', 'style', 'startCap', 'endCap', 'color', 'width', 'dash', 'labelPosition', 'locked', 'hidden'],
  patch(o, u, ctx) {
    const p: Patch = {};
    if (u.from !== undefined) p.from = resolveEnd(u.from, ctx, 'from');
    if (u.to !== undefined) p.to = resolveEnd(u.to, ctx, 'to');
    const label = u.label ?? u.text;
    if (label !== undefined) Object.assign(p, textFields(label, 'connector'));
    if (u.style !== undefined) p.lineStyle = u.style === 'straight' ? undefined : u.style;
    if (u.startCap !== undefined) Object.assign(p, capFields('start', u.startCap));
    if (u.endCap !== undefined) Object.assign(p, capFields('end', u.endCap));
    if (u.width !== undefined) p.strokeWidth = u.width;
    if (u.dash !== undefined) p.dash = u.dash === 'solid' ? undefined : u.dash;
    if (u.labelPosition !== undefined) p.labelPos = u.labelPosition;
    void o;
    return p;
  },
  read: (o) => ({
    from: endOut(o.from),
    to: endOut(o.to),
    label: textOf(o) || undefined,
    style: o.lineStyle ?? 'straight',
    startCap: capOut(o, 'start'),
    endCap: capOut(o, 'end'),
    color: colorLabel(o.color),
    width: o.strokeWidth,
    dash: o.dash,
  }),
};

// ---- Mindmap-Knoten (Anlegen über create_mindmap) --------------------------------------------------------------------

const mindnode: Kind = {
  type: 'mindnode',
  label: 'Mindmap-Knoten',
  about: 'Knoten einer Mindmap (Anlegen mit create_mindmap; Lage berechnet das Auto-Layout, die Wurzel bleibt stehen).',
  updatable: ['text', 'color', 'collapsed', 'parent', 'side', 'x', 'y', 'locked', 'hidden'],
  read: (o) => ({
    text: o.text,
    color: colorLabel(o.color),
    parent: o.mind?.parent,
    level: o.mind?.level,
    side: o.mind?.side,
    collapsed: o.mind?.collapsed || undefined,
  }),
};

// ---- Nur lesen --------------------------------------------------------------------------------------------------------

const image: Kind = { type: 'image', label: 'Bild', about: 'Hochgeladenes Bild (nur lesen/verschieben).', updatable: [...BOX], read: (o) => ({ imageId: o.imageId }) };
const pen: Kind = { type: 'pen', label: 'Stiftstrich', about: 'Freihand-Strich (nur lesen/verschieben).', updatable: ['x', 'y', 'color', 'locked', 'hidden'], read: (o) => ({ color: colorLabel(o.color), marker: o.marker || undefined }) };
const icon: Kind = { type: 'icon', label: 'Icon', about: 'Icon aus dem Iconset (nur lesen/verschieben/färben).', updatable: [...BOX, 'color'], read: (o) => ({ icon: o.icon, color: colorLabel(o.color) }) };

export const KINDS: Kind[] = [sticky, text, shape, frame, card, tableKind, sticker, connector, mindnode, image, pen, icon];
const BY_TYPE = new Map(KINDS.map((k) => [k.type, k]));
export const kindOf = (type: string): Kind | undefined => BY_TYPE.get(type);
/** Typen, die create_objects anlegen kann. */
export const CREATABLE = KINDS.filter((k) => k.create);

// ---- update_objects ---------------------------------------------------------------------------------------------------

export const UpdateItem = z
  .object({
    id: z.string().describe('id des Objekts'),
    x: z.number().min(-1_000_000).max(1_000_000).optional(),
    y: z.number().min(-1_000_000).max(1_000_000).optional(),
    w: Size(8, 50000).optional(),
    h: Size(8, 50000).optional(),
    rotation: z.number().min(-360).max(360).optional(),
    color: ColorStr.optional().describe('Füllfarbe (Notiz, Form, Rahmen), Textfarbe (Text), Linienfarbe (Verbinder), Streifen (Karte), Zweigfarbe (Mindmap)'),
    text: TextMd.optional().describe('neuer Text (Markdown); bei Verbindern die Beschriftung'),
    title: z.string().max(300).optional().describe('Titel (Rahmen, Karte)'),
    fontSize: Size(6, 400).optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    strike: z.boolean().optional(),
    align: Align.optional(),
    valign: VAlign.optional(),
    fontFamily: FontFamily.optional(),
    tags: z.array(Tag).max(8).optional().describe('Tags (Notiz, Karte); [] entfernt alle'),
    shape: z.string().optional().describe('Formart (Form) bzw. square/rect (Haftnotiz)'),
    stroke: ColorStr.optional(),
    strokeWidth: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(4), z.literal(8)]).optional(),
    dash: Dash.optional(),
    fillOpacity: z.number().min(0).max(1).optional(),
    desc: z.string().max(5000).optional().describe('Kartenbeschreibung ("" entfernt)'),
    status: z.enum([...CARD_STATUS, 'none']).optional(),
    due: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional().describe('YYYY-MM-DD, "" entfernt'),
    assignee: z.string().max(120).optional().describe('Name der zuständigen Person, "" entfernt'),
    rows: z.array(z.array(z.string().max(2000)).min(1).max(40)).min(1).max(300).optional().describe('Tabelle: kompletter neuer Inhalt'),
    head: z.enum(['row', 'col', 'both', 'none']).optional(),
    columnWidths: z.array(z.number().positive().max(100)).optional(),
    from: End.optional(),
    to: End.optional(),
    label: z.string().max(500).optional(),
    style: LineStyle.optional(),
    startCap: Cap.optional(),
    endCap: Cap.optional(),
    width: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(6), z.literal(8)]).optional(),
    labelPosition: z.number().min(0.02).max(0.98).optional(),
    emoji: z.string().min(1).max(16).optional(),
    stamp: z.string().optional(),
    collapsed: z.boolean().optional().describe('Mindmap: Zweig einklappen'),
    parent: z.string().optional().describe('Mindmap: neuer Elternknoten (umhängen)'),
    side: z.enum(['left', 'right']).optional().describe('Mindmap: Seite eines Hauptthemas'),
    locked: z.boolean().optional(),
    hidden: z.boolean().optional().describe('ausblenden (für alle unsichtbar)'),
    linkTo: z.string().optional().describe('Link zu einem anderen Objekt/Rahmen (id), "" entfernt'),
  })
  .strict();
export type UpdateInput = z.infer<typeof UpdateItem>;
